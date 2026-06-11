// Real-mouse drag-and-drop verification (Playwright dragTo drives Chromium's
// native DnD pipeline, including effectAllowed/dropEffect negotiation — the
// part synthetic drop events bypass).
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

  await page.locator('#tab-raw [data-ref="split-btn"]').click();
  const editor = page.locator('#tab-raw .cm-content');
  await editor.waitFor({ state: 'visible', timeout: 10000 });

  // Real drag: image file from the tree onto the editor surface.
  const image = tree.locator('[data-nav-path$=".png"]').first();
  const imagePath = await image.getAttribute('data-nav-path');
  const imageName = imagePath.split('/').pop();
  await image.dragTo(editor);
  await page.waitForFunction((name) =>
    document.querySelector('#tab-raw .cm-content')?.textContent.includes(`![${name}](`),
    imageName, { timeout: 10000 });
  check('real mouse drag of image inserted embed', true, imagePath);

  // Real drag: markdown (entry point) onto the editor → plain link.
  const entry = tree.locator('.nav-file.entry-point');
  const entryName = (await entry.getAttribute('data-nav-path')).split('/').pop();
  await entry.dragTo(editor);
  await page.waitForFunction((name) =>
    document.querySelector('#tab-raw .cm-content')?.textContent.includes(`[${name}](`),
    entryName, { timeout: 10000 });
  check('real mouse drag of md file inserted link', true, entryName);

  // Real drag: tree-internal move still works (image into root blank area).
  const movable = tree.locator('[data-nav-path*="/"][draggable="true"]').first();
  if (await movable.count() > 0) {
    const sourcePath = await movable.getAttribute('data-nav-path');
    const baseName = sourcePath.split('/').pop();
    const treeBox = await tree.boundingBox();
    await movable.dragTo(tree, {
      targetPosition: { x: 20, y: treeBox.height - 8 }
    });
    await tree.locator(`[data-nav-path="${baseName}"]`).waitFor({ timeout: 10000 });
    check('real mouse drag moved file within tree', true, `${sourcePath} → ${baseName}`);
  } else {
    check('found a nested movable file for tree move', false);
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll real-drag checks passed' : `\n${failures} real-drag check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
