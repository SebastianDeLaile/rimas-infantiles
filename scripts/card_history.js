#!/usr/bin/env node
/**
 * Render how one card has changed over the life of the repo.
 *
 * Usage:
 *   node scripts/card_history.js "Los pollitos dicen"
 *   node scripts/card_history.js "Estrellita" --max 12 --out history/estrellita
 *
 * Walks the commits that touched index.html, checks each one out into a
 * throwaway git worktree, renders the matching card from THAT commit's own
 * HTML/CSS/JS, and writes one PNG per commit plus a contact sheet.
 *
 * Nothing needs to have been captured in advance -- git already holds every
 * version of the markup, the stylesheet and the artwork, so this works
 * retroactively. Commits where the card doesn't exist yet, or whose markup
 * the harness can't read, are skipped rather than failing the run.
 */
const { chromium } = require('playwright-core');
const { execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

function parseArgs(argv) {
  const a = { title: null, max: 24, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max') a.max = parseInt(argv[++i], 10);
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (!a.title) a.title = argv[i];
  }
  return a;
}
function findChrome() {
  for (const c of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                   '/Applications/Chromium.app/Contents/MacOS/Chromium'])
    if (fs.existsSync(c)) return c;
  throw new Error('No Chrome found');
}
function serve(root) {
  const MIME = { '.html': 'text/html', '.png': 'image/png', '.css': 'text/css',
                 '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const fp = path.join(root, p === '/' ? 'index.html' : p);
    if (!fp.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(d);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title) {
    console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18)
      .join('\n').replace(/^\s*\*\/?\s?/gm, ''));
    process.exit(1);
  }
  const root = path.resolve(__dirname, '..');
  const slug = args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const outDir = path.resolve(root, args.out || path.join('history', slug));
  fs.mkdirSync(outDir, { recursive: true });

  // oldest -> newest, so the contact sheet reads left to right in time
  let commits = execSync('git log --reverse --format=%H%x09%ad --date=short -- index.html',
    { cwd: root, encoding: 'utf8' }).trim().split('\n').map(l => {
      const [sha, date] = l.split('\t'); return { sha, date };
    });
  if (commits.length > args.max) {   // sample evenly, always keeping the newest
    const step = (commits.length - 1) / (args.max - 1);
    commits = Array.from({ length: args.max }, (_, i) => commits[Math.round(i * step)]);
  }
  console.error(`${args.title}: rendering ${commits.length} commits`);

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhist-'));
  execSync(`git worktree add --detach -f ${JSON.stringify(wt)} HEAD`, { cwd: root, stdio: 'ignore' });
  const server = serve(wt);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const shots = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 2200 } });
    for (const [i, c] of commits.entries()) {
      try {
        execSync(`git checkout --detach -f ${c.sha}`, { cwd: wt, stdio: 'ignore' });
        await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
        // render through the site's own print stylesheet: it already reveals
        // every card and hides the screen-only chrome, so no manual DOM
        // surgery is needed (and none of the layout shifts that caused)
        await page.emulateMedia({ media: 'print' });
        await page.waitForTimeout(350);
        const found = await page.evaluate((title) => {
          const sheets = [...document.querySelectorAll('.a4-sheet, .page, .card')];
          const hit = sheets.find(s => {
            const h = s.querySelector('h1,h2,h3');
            return h && h.textContent.toLowerCase().includes(title.toLowerCase())
              && !s.classList.contains('translation');
          });
          if (!hit) return false;
          hit.style.display = 'flex';
          hit.id = '__histcard';
          return true;
        }, args.title);
        if (!found) { console.error(`  ${c.date} ${c.sha.slice(0,7)} - not present, skipped`); continue; }
        const file = path.join(outDir, `${String(i).padStart(3, '0')}_${c.date}_${c.sha.slice(0, 7)}.png`);
        // element screenshot, not a page clip -- it handles scroll position and
        // sheets wider than the viewport correctly
        await page.locator('#__histcard').screenshot({ path: file });
        shots.push({ file, date: c.date, sha: c.sha.slice(0, 7) });
        console.error(`  ${c.date} ${c.sha.slice(0,7)} - ok`);
      } catch (e) {
        console.error(`  ${c.date} ${c.sha.slice(0,7)} - render failed, skipped`);
      }
    }
  } finally {
    await browser.close();
    server.close();
    execSync(`git worktree remove --force ${JSON.stringify(wt)}`, { cwd: root, stdio: 'ignore' });
  }

  // contact sheet
  if (shots.length) {
    const manifest = path.join(outDir, 'timeline.json');
    fs.writeFileSync(manifest, JSON.stringify(shots.map(s => ({ date: s.date, sha: s.sha, file: path.basename(s.file) })), null, 1));
    const cells = shots.map(s =>
      `<figure style="margin:0"><img src="${path.basename(s.file)}" style="width:100%;border:1px solid #ccc">
       <figcaption style="font:12px system-ui;padding:4px 0;color:#444">${s.date} · ${s.sha}</figcaption></figure>`).join('');
    fs.writeFileSync(path.join(outDir, 'index.html'),
      `<body style="margin:0;padding:16px;background:#eee;font:14px system-ui">
       <h2 style="font:600 18px system-ui">${args.title} — ${shots.length} versions</h2>
       <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px">${cells}</div></body>`);
    console.error(`\nWrote ${shots.length} frames to ${outDir}`);
    console.error(`Open ${path.join(outDir, 'index.html')}`);
  } else {
    console.error('\nNo frames rendered.');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
