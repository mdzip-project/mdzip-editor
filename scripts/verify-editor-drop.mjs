// Verifies dragging nav-tree files onto the editor surface inserts markdown
// links/embeds, and that OS image files dropped on the editor are embedded.
import { chromium } from 'playwright';

const BASE = process.env.DEMO_URL ?? 'http://localhost:5199/';
let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

try {
  await page.goto(BASE);
  const tree = page.locator('#tab-raw .nav-tree');
  await tree.locator('[data-nav-path]').first().waitFor({ timeout: 20000 });

  // Switch to split layout so the editor surface is visible.
  await page.locator('#tab-raw [data-ref="split-btn"]').click();
  const editor = page.locator('#tab-raw .cm-content');
  await editor.waitFor({ state: 'visible', timeout: 10000 });

  // 1. Entry point and other files are draggable; manifest is not.
  check('entry point is draggable',
    await tree.locator('.nav-file.entry-point[draggable="true"]').count() === 1);
  check('manifest is not draggable',
    await tree.locator('[data-nav-path="manifest.json"][draggable="true"]').count() === 0);

  // 2. Drop an image path onto the editor → image embed inserted.
  const imagePath = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#tab-raw .nav-tree [data-nav-path]')]
      .find((node) => /\.(png|jpe?g|gif|webp|svg)$/i.test(node.getAttribute('data-nav-path')));
    return el?.getAttribute('data-nav-path') ?? null;
  });
  check('found an image in the tree', Boolean(imagePath), imagePath ?? 'none');
  await page.evaluate((path) => {
    const dt = new DataTransfer();
    dt.setData('application/x-mdzip-path', path);
    document.querySelector('#tab-raw .cm-content')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, imagePath);
  const imageName = imagePath.split('/').pop();
  await page.waitForFunction((name) =>
    document.querySelector('#tab-raw .cm-content')?.textContent.includes(`![${name}](`),
    imageName, { timeout: 10000 });
  check('image drop inserted ![name](relative) embed', true);

  // 3. Drop a markdown path (the entry point itself) → plain link inserted.
  const entryPath = await tree.locator('.nav-file.entry-point').getAttribute('data-nav-path');
  await page.evaluate((path) => {
    const dt = new DataTransfer();
    dt.setData('application/x-mdzip-path', path);
    document.querySelector('#tab-raw .cm-content')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, entryPath);
  await page.waitForFunction((path) =>
    document.querySelector('#tab-raw .cm-content')?.textContent.includes(`[${path.split('/').pop()}](`),
    entryPath, { timeout: 10000 });
  const editorText = await editor.textContent();
  check('md drop inserted [name](relative) link without image bang',
    !editorText.includes(`![${entryPath.split('/').pop()}](`), entryPath);

  // 4. OS image file dropped on the editor → embedded as pasted image.
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dropped-image.png', { type: 'image/png' }));
    document.querySelector('#tab-raw .cm-content')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, PNG_1X1_BASE64);
  await page.waitForFunction(() =>
    document.querySelector('#tab-raw .cm-content')?.textContent.includes('![Pasted image]('),
    null, { timeout: 10000 });
  check('OS image drop embedded as pasted image', true);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#tab-raw .nav-tree [data-nav-path]')]
      .some((node) => /images\/pasted-\d+/.test(node.getAttribute('data-nav-path'))),
    null, { timeout: 10000 });
  check('embedded image asset added to archive', true);
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll editor-drop checks passed' : `\n${failures} editor-drop check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
