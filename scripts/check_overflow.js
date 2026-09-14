#!/usr/bin/env node
/**
 * Check that no card's content runs into (or past) its decorative frame.
 *
 * Usage:  node scripts/check_overflow.js [--min 15]
 *
 * Renders every card through the print stylesheet and measures the gap
 * between the bottom of the last text block and the top of the frame's
 * bottom strip. Anything closer than --min px (default 15) is reported and
 * the script exits non-zero, so it can gate a release.
 *
 * Lives in the repo rather than /tmp because it's the check that catches
 * the failure mode this layout is most prone to: a verse that no longer
 * fits after a font, spacing or illustration-sizing change.
 */
const { chromium } = require('playwright-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const MIN = (() => {
  const i = process.argv.indexOf('--min');
  return i === -1 ? 15 : parseFloat(process.argv[i + 1]);
})();

function findChrome() {
  for (const c of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                   '/Applications/Chromium.app/Contents/MacOS/Chromium'])
    if (fs.existsSync(c)) return c;
  throw new Error('No Chrome found');
}
function serve(root) {
  const MIME = { '.html': 'text/html', '.png': 'image/png', '.css': 'text/css',
                 '.js': 'text/javascript', '.svg': 'image/svg+xml' };
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
  const root = path.resolve(__dirname, '..');
  const server = serve(root);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => {
      const out = [];
      for (const sheet of document.querySelectorAll('.a4-preview > .a4-sheet')) {
        const blocks = sheet.querySelectorAll('.verse, .chorus, .movement-intro, .movement-list');
        if (!blocks.length) continue;
        const last = blocks[blocks.length - 1].getBoundingClientRect();
        const page_ = sheet.querySelector('.a4-page');
        const strip = sheet.querySelector('.frame-bgi-strip-bottom, .frame-bgi-strip2-bottom, .frame-strip-bottom');
        const limit = strip ? strip.getBoundingClientRect().top
                            : page_.getBoundingClientRect().bottom;
        out.push({
          title: sheet.querySelector('h2')?.textContent?.trim() || '?',
          side: sheet.classList.contains('translation') ? 'back' : 'front',
          clearance: Math.round(limit - last.bottom),
        });
      }
      return out;
    });
    const bad = rows.filter(r => r.clearance < MIN).sort((a, b) => a.clearance - b.clearance);
    console.log(`checked ${rows.length} pages, min clearance ${MIN}px`);
    if (bad.length) {
      console.log(`FLAGGED ${bad.length}:`);
      bad.forEach(r => console.log(`  ${String(r.clearance).padStart(5)}px  ${r.side}  ${r.title}`));
    } else {
      console.log('all clear');
    }
    process.exitCode = bad.length ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exit(2); });
