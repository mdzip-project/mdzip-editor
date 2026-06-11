// Playwright verification of the nav-pane context menu feature set against the
// running demo (vite dev server on :5199, raw tab, standalone-editor preset).
import { chromium } from 'playwright';

const BASE = process.env.DEMO_URL ?? 'http://localhost:5199/';
const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

try {
  await page.goto(BASE);
  const tree = page.locator('#tab-raw .nav-tree');
  await tree.locator('[data-nav-path]').first().waitFor({ timeout: 20000 });

  // 1. Entry point is visually marked
  const entryButton = tree.locator('.nav-file.entry-point');
  check('entry point marked bold', await entryButton.count() === 1,
    await entryButton.first().getAttribute('data-nav-path'));
  const entryPath = await entryButton.first().getAttribute('data-nav-path');

  // 2. Right-click blank tree area → directory menu
  await tree.click({ button: 'right', position: { x: 30, y: (await tree.boundingBox()).height - 10 } });
  const menu = page.locator('.nav-context-menu');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  const dirItems = await menu.locator('[data-menu-action]').allTextContents();
  check('blank-area menu has New .md File + New Folder',
    dirItems.includes('New .md File') && dirItems.includes('New Folder'), dirItems.join(', '));

  // 3. New .md file at root
  await menu.locator('[data-menu-action="new-file"]').click();
  const nameInput = page.locator('[data-ref="name-input"]');
  await nameInput.waitFor({ state: 'visible' });
  await nameInput.fill('verify-note.md');
  await page.locator('[data-ref="name-confirm-btn"]').click();
  const newFile = tree.locator('[data-nav-path="verify-note.md"]');
  await newFile.waitFor({ timeout: 10000 });
  check('new .md file created and present in tree', await newFile.count() === 1);
  check('new file opened in editor', (await page.locator('#tab-raw .cm-content').textContent())?.includes('# verify-note'));

  // 4. File context menu on the new (non-entry) markdown file
  await newFile.click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  const fileItems = await menu.locator('[data-menu-action]').allTextContents();
  check('md file menu items',
    ['Set as Entry Point', 'Copy Markdown Link', 'Rename…', 'Duplicate', 'Download', 'Delete…']
      .every((label) => fileItems.includes(label)),
    fileItems.join(', '));
  check('md file menu has no Replace', !fileItems.includes('Replace…'));

  // 5. Set as entry point → bold marker moves
  await menu.locator('[data-menu-action="set-entry-point"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#tab-raw .nav-file.entry-point')?.getAttribute('data-nav-path') === 'verify-note.md',
    null, { timeout: 10000 });
  check('entry point reassigned to new file', true);

  // 6. Old entry is now deletable; restore entry point first
  await tree.locator(`[data-nav-path="${entryPath}"]`).click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  const oldEntryItems = await menu.locator('[data-menu-action]').allTextContents();
  check('old entry point now offers Set as Entry Point + Delete',
    oldEntryItems.includes('Set as Entry Point') && oldEntryItems.includes('Delete…'), oldEntryItems.join(', '));
  await menu.locator('[data-menu-action="set-entry-point"]').click();
  await page.waitForFunction((path) =>
    document.querySelector('#tab-raw .nav-file.entry-point')?.getAttribute('data-nav-path') === path,
    entryPath, { timeout: 10000 });

  // 7. Rename the file (move into a folder via path edit)
  await tree.locator('[data-nav-path="verify-note.md"]').click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  await menu.locator('[data-menu-action="rename"]').click();
  await nameInput.waitFor({ state: 'visible' });
  await nameInput.fill('notes/verify-note.md');
  await page.locator('[data-ref="name-confirm-btn"]').click();
  const movedFile = tree.locator('[data-nav-path="notes/verify-note.md"]');
  await movedFile.waitFor({ timeout: 10000 });
  check('rename-as-move created folder + moved file',
    await tree.locator('details[data-nav-dir="notes"]').count() === 1);

  // 8. Copy markdown link
  await movedFile.click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  await menu.locator('[data-menu-action="copy-link"]').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('copy markdown link', clip.includes('verify-note.md') && clip.startsWith('['), clip);

  // 9. Duplicate
  await movedFile.click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  await menu.locator('[data-menu-action="duplicate"]').click();
  const dupFile = tree.locator('[data-nav-path="notes/verify-note-2.md"]');
  await dupFile.waitFor({ timeout: 10000 });
  check('duplicate created with -2 suffix', await dupFile.count() === 1);

  // 10. New folder (pending) via folder context menu
  await tree.locator('details[data-nav-dir="notes"] > summary').click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  await menu.locator('[data-menu-action="new-folder"]').click();
  await nameInput.waitFor({ state: 'visible' });
  await nameInput.fill('drafts');
  await page.locator('[data-ref="name-confirm-btn"]').click();
  const pendingDir = tree.locator('details[data-nav-dir="notes/drafts"].pending-folder');
  await pendingDir.waitFor({ timeout: 10000 });
  check('pending folder rendered dimmed', await pendingDir.count() === 1);

  // 11. Delete with confirmation
  await dupFile.click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  await menu.locator('[data-menu-action="delete"]').click();
  const deleteDialog = page.locator('[data-ref="delete-dialog"]');
  await deleteDialog.waitFor({ state: 'visible' });
  check('delete shows confirmation dialog',
    (await deleteDialog.locator('[data-ref="delete-dialog-text"]').textContent()).includes('notes/verify-note-2.md'));
  await page.locator('[data-ref="delete-confirm-btn"]').click();
  await dupFile.waitFor({ state: 'detached', timeout: 10000 });
  check('file deleted after confirm', await tree.locator('[data-nav-path="notes/verify-note-2.md"]').count() === 0);

  // 12. Image asset menu (cover + replace + embed)
  const image = tree.locator('[data-nav-path$=".png"], [data-nav-path$=".jpg"], [data-nav-path$=".svg"], [data-nav-path$=".webp"]').first();
  if (await image.count() > 0) {
    await image.click({ button: 'right' });
    await menu.waitFor({ state: 'visible' });
    const imageItems = await menu.locator('[data-menu-action]').allTextContents();
    check('image menu has cover/replace/embed',
      imageItems.includes('Set as Cover Image') && imageItems.includes('Replace…') && imageItems.includes('Copy Image Embed'),
      imageItems.join(', '));
    await menu.locator('[data-menu-action="set-cover"]').click();
    await page.waitForTimeout(500);
    await image.click({ button: 'right' });
    await menu.waitFor({ state: 'visible' });
    const afterCover = await menu.locator('[data-menu-action]').allTextContents();
    check('cover toggles to Remove Cover Image', afterCover.includes('Remove Cover Image'), afterCover.join(', '));
    await menu.locator('[data-menu-action="remove-cover"]').click();
  } else {
    check('image asset present in demo archive', false, 'no image found — cover/replace untested');
  }

  // 13. Manifest menu: download only
  const manifest = tree.locator('[data-nav-path="manifest.json"]');
  if (await manifest.count() > 0) {
    await manifest.click({ button: 'right' });
    await menu.waitFor({ state: 'visible' });
    const manifestItems = await menu.locator('[data-menu-action]').allTextContents();
    check('manifest menu is Download only', manifestItems.length === 1 && manifestItems[0] === 'Download',
      manifestItems.join(', '));
    await page.keyboard.press('Escape');
  }

  // 14. Entry point menu has no Delete / Set as Entry Point
  await page.waitForTimeout(300);
  await tree.locator('.nav-file.entry-point').click({ button: 'right' });
  await menu.waitFor({ state: 'visible' });
  const entryItems = await menu.locator('[data-menu-action]').allTextContents();
  check('entry menu lacks Delete and Set as Entry Point',
    !entryItems.some((label) => label.startsWith('Delete')) && !entryItems.includes('Set as Entry Point'),
    entryItems.join(', '));
  await page.keyboard.press('Escape');
  check('Escape closes the menu', await menu.isHidden());

  // 15. Viewer preset: mutating items gone, Copy/Download still offered
  await page.locator('#mode-group .tab-btn[data-preset="viewer"]').click();
  await page.waitForTimeout(1000);
  await tree.locator('[data-nav-path]').first().waitFor({ timeout: 10000 });
  await tree.locator('.nav-file.entry-point').click({ button: 'right' });
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  const viewerItems = await menu.locator('[data-menu-action]').allTextContents();
  check('viewer preset shows only Copy/Download',
    viewerItems.every((label) => label.startsWith('Copy') || label === 'Download'),
    viewerItems.join(', '));
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'scripts/verify-nav-menu.png', fullPage: true });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
