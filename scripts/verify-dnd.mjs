// Verifies nav-pane drag-and-drop: internal move (synthetic DataTransfer) and
// external OS-file drop.
import { chromium } from 'playwright';

const BASE = process.env.DEMO_URL ?? 'http://localhost:5199/';
let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

try {
  await page.goto(BASE);
  const tree = page.locator('#tab-raw .nav-tree');
  await tree.locator('[data-nav-path]').first().waitFor({ timeout: 20000 });

  // Pick a movable file (draggable, i.e. not entry/manifest) and a target dir.
  const sourcePath = await page.evaluate(() => {
    const el = document.querySelector('#tab-raw .nav-tree [data-nav-path][draggable="true"]');
    return el?.getAttribute('data-nav-path') ?? null;
  });
  check('found a draggable file', Boolean(sourcePath), sourcePath ?? 'none');

  // Internal move: drop the file onto the root blank area (dir '').
  const baseName = sourcePath.split('/').pop();
  const expectsMove = sourcePath.includes('/');
  await page.evaluate((path) => {
    const dt = new DataTransfer();
    dt.setData('application/x-mdzip-path', path);
    const target = document.querySelector('#tab-raw .nav-tree');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, sourcePath);
  if (expectsMove) {
    await tree.locator(`[data-nav-path="${baseName}"]`).waitFor({ timeout: 10000 });
    check('internal drop moved file to root',
      await tree.locator(`[data-nav-path="${sourcePath}"]`).count() === 0, `${sourcePath} → ${baseName}`);
  } else {
    check('internal drop to same dir is a no-op',
      await tree.locator(`[data-nav-path="${sourcePath}"]`).count() === 1);
  }

  // External drop: a File object dropped on the pane root.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['external drop contents'], 'dropped-note.txt', { type: 'text/plain' }));
    const target = document.querySelector('#tab-raw .nav-tree');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await tree.locator('[data-nav-path="dropped-note.txt"]').waitFor({ timeout: 10000 });
  check('external file drop added asset at root', true);

  // External drop of a duplicate name auto-suffixes.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['second copy'], 'dropped-note.txt', { type: 'text/plain' }));
    const target = document.querySelector('#tab-raw .nav-tree');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await tree.locator('[data-nav-path="dropped-note-2.txt"]').waitFor({ timeout: 10000 });
  check('duplicate external drop auto-suffixed', true);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll DnD checks passed' : `\n${failures} DnD check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
