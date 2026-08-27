#!/usr/bin/env node
/**
 * Generate a print-ready PDF of selected rhymes (or the whole book) from index.html,
 * using the site's own print CSS (A4/A5, hole-punch guides, decorative frame).
 *
 * Usage:
 *   node scripts/generate_print_pack.js "Los pollitos dicen" "Arroz con leche" --out packs/pack.pdf
 *   node scripts/generate_print_pack.js --all --out packs/full-book.pdf
 *   node scripts/generate_print_pack.js --format a5 "Pin Pon"
 *
 * Rhyme titles match against each card's <h2> text — a substring is enough
 * ("Aserrín" matches "Aserrín, aserrán"). Run without arguments for this help.
 *
 * Requires a Chrome/Chromium executable on this machine (see findChrome() below)
 * and `npm install` once for playwright-core.
 */
const { chromium } = require('playwright-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const args = { rhymes: [], out: 'packs/print-pack.pdf', format: 'a4', all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args.rhymes.push(a);
  }
  return args;
}

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(
    'No Chrome/Chromium/Edge found in the usual macOS locations. ' +
    'Add your executable path to the candidates list in findChrome().'
  );
}

function serveProjectRoot(root) {
  const MIME = { '.html': 'text/html', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.all && args.rhymes.length === 0)) {
    console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 15).join('\n').replace(/^\s*\*\/?\s?/gm, ''));
    process.exit(args.help ? 0 : 1);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const server = serveProjectRoot(projectRoot);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });

    if (args.format === 'a5') {
      await page.evaluate(() => document.querySelector('.a4-preview').setAttribute('data-format', 'a5'));
    }

    if (!args.all) {
      const result = await page.evaluate((names) => {
        const preview = document.querySelector('.a4-preview');
        const fronts = [...preview.querySelectorAll(':scope > .a4-sheet:not(.translation)')];
        preview.querySelectorAll(':scope > .a4-sheet').forEach(s => s.classList.remove('is-selected'));
        const found = [];
        const missing = [];
        names.forEach(name => {
          const front = fronts.find(f => f.querySelector('h2')?.textContent.includes(name));
          if (front) {
            front.classList.add('is-selected');
            front.nextElementSibling?.classList.add('is-selected');
            found.push(front.querySelector('h2').textContent);
          } else {
            missing.push(name);
          }
        });
        return { found, missing };
      }, args.rhymes);

      if (result.missing.length) {
        console.error('Could not find these rhyme titles (check spelling/accents):');
        result.missing.forEach(m => console.error('  - ' + m));
        process.exit(1);
      }
      console.error(`Selected ${result.found.length} rhyme(s):`);
      result.found.forEach(f => console.error('  - ' + f));

      await page.addStyleTag({ content: `
        @media print {
          .a4-preview.browse-mode > .a4-sheet { display: none !important; }
          .a4-preview.browse-mode > .a4-sheet.is-selected { display: flex !important; }
        }
      `});
    }

    const outPath = path.resolve(projectRoot, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true });
    console.error(`Wrote ${outPath}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
