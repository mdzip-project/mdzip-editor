import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  console.log('Loading demo...');
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  
  // Wait for the sample.mdz to be loaded
  await page.waitForSelector('.mdzip-root', { timeout: 10000 });
  
  console.log('Demo loaded, taking initial screenshot...');
  await page.screenshot({ path: 'verify-initial.png' });
  
  // Check if split mode is active by looking for the split button
  const splitBtn = await page.locator('[data-ref="split-btn"]');
  const isSplitActive = await splitBtn.evaluate(el => el.classList.contains('active'));
  
  console.log(`Split mode active: ${isSplitActive}`);
  
  // If not in split mode, click the split button
  if (!isSplitActive) {
    console.log('Clicking split mode button...');
    await splitBtn.click();
    await page.waitForTimeout(500);
  }
  
  // Take screenshot of split mode
  await page.screenshot({ path: 'verify-split-mode.png' });
  console.log('Split mode screenshot taken');
  
  // Get editor and preview elements
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('[data-ref="preview-pane"]');
  
  // Get initial scroll positions
  const editorScrollBefore = await editor.evaluate(el => el.scrollTop);
  const previewScrollBefore = await preview.evaluate(el => el.scrollTop);
  
  console.log(`Initial editor scroll: ${editorScrollBefore}`);
  console.log(`Initial preview scroll: ${previewScrollBefore}`);
  
  // Scroll the editor
  console.log('Scrolling editor down...');
  await editor.evaluate(el => { el.scrollTop = 300; });
  await page.waitForTimeout(200);
  
  // Check if preview scrolled in sync
  const previewScrollAfter = await preview.evaluate(el => el.scrollTop);
  console.log(`Preview scroll after editor scroll: ${previewScrollAfter}`);
  
  if (previewScrollAfter > 0) {
    console.log('✓ PASS: Preview scrolled when editor scrolled');
  } else {
    console.log('✗ FAIL: Preview did not scroll');
  }
  
  // Now scroll the preview
  console.log('Scrolling preview down...');
  await preview.evaluate(el => { el.scrollTop = 400; });
  await page.waitForTimeout(200);
  
  // Check if editor scrolled
  const editorScrollAfter = await editor.evaluate(el => el.scrollTop);
  console.log(`Editor scroll after preview scroll: ${editorScrollAfter}`);
  
  if (editorScrollAfter > 100) {
    console.log('✓ PASS: Editor scrolled when preview scrolled');
  } else {
    console.log('✗ FAIL: Editor did not scroll');
  }
  
  await page.screenshot({ path: 'verify-after-scroll.png' });
  
  await browser.close();
  console.log('Test complete');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
