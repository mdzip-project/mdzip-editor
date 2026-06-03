import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  console.log('Loading demo with zoom...');
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  
  await page.waitForSelector('.mdzip-root');
  
  // Zoom in to make content scrollable
  const zoomBtn = page.locator('[data-ref="zoom-btn"]');
  await zoomBtn.click();
  await page.waitForTimeout(300);
  
  const zoomInBtn = page.locator('[data-action="zoom-in"]');
  for (let i = 0; i < 8; i++) {
    await zoomInBtn.click();
    await page.waitForTimeout(100);
  }
  
  // Enable split mode
  const splitBtn = page.locator('[data-ref="split-btn"]');
  const isSplitActive = await splitBtn.evaluate(el => el.classList.contains('active'));
  if (!isSplitActive) {
    await splitBtn.click();
    await page.waitForTimeout(500);
  }
  
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('[data-ref="preview-pane"]');
  
  console.log('\n=== TEST 1: Preview → Editor Sync ===');
  
  // Scroll preview and check editor
  const previewBounds = await preview.boundingBox();
  await page.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2);
  
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 4);
    await page.waitForTimeout(100);
  }
  
  let previewScroll = await preview.evaluate(el => el.scrollTop);
  let editorScroll = await editor.evaluate(el => el.scrollTop);
  
  console.log(`Preview: ${previewScroll}, Editor: ${editorScroll}`);
  
  if (editorScroll > 0 && previewScroll > 0) {
    const ratio1 = editorScroll / previewScroll;
    console.log(`✓ PASS: Scroll ratio ~${ratio1.toFixed(2)} (should be similar for both panes)`);
  } else {
    console.log('✗ FAIL: One or both panes did not scroll');
  }
  
  console.log('\n=== TEST 2: Editor → Preview Sync ===');
  
  // Scroll back to top
  await preview.evaluate(el => { el.scrollTop = 0; });
  await editor.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  
  // Now scroll editor
  const editorBounds = await editor.boundingBox();
  await page.mouse.move(editorBounds.x + editorBounds.width / 2, editorBounds.y + editorBounds.height / 2);
  
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 4);
    await page.waitForTimeout(150);
  }
  
  editorScroll = await editor.evaluate(el => el.scrollTop);
  previewScroll = await preview.evaluate(el => el.scrollTop);
  
  console.log(`Editor: ${editorScroll}, Preview: ${previewScroll}`);
  
  if (editorScroll > 0 && previewScroll > 0) {
    const ratio2 = previewScroll / editorScroll;
    console.log(`✓ PASS: Editor→Preview sync working, ratio ~${ratio2.toFixed(2)}`);
  } else {
    console.log('✗ FAIL: One or both panes did not scroll');
  }
  
  console.log('\n=== TEST 3: Proportional Sync ===');
  
  // Reset and test proportional behavior
  await preview.evaluate(el => { el.scrollTop = 0; });
  await editor.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  
  // Get max scroll amounts
  const editorInfo = await editor.evaluate(el => ({
    max: el.scrollHeight - el.clientHeight
  }));
  
  const previewInfo = await preview.evaluate(el => ({
    max: el.scrollHeight - el.clientHeight
  }));
  
  console.log(`Editor max scroll: ${editorInfo.max}px`);
  console.log(`Preview max scroll: ${previewInfo.max}px`);
  
  // Scroll preview to 50%
  const targetPreviewScroll = previewInfo.max / 2;
  await preview.evaluate((el, target) => { el.scrollTop = target; }, targetPreviewScroll);
  await page.waitForTimeout(300);
  
  previewScroll = await preview.evaluate(el => el.scrollTop);
  editorScroll = await editor.evaluate(el => el.scrollTop);
  
  console.log(`\nPreview at 50% scroll (${previewScroll}px):`);
  console.log(`Editor scroll: ${editorScroll}px (expected ~50% = ${editorInfo.max / 2}px)`);
  
  const editorRatio = editorScroll / editorInfo.max;
  console.log(`Editor is at ~${(editorRatio * 100).toFixed(0)}% scroll`);
  
  if (Math.abs(editorRatio - 0.5) < 0.1) {
    console.log('✓ PASS: Proportional sync working correctly');
  } else {
    console.log('✗ FAIL: Proportional sync not correct');
  }
  
  await browser.close();
  console.log('\n=== All tests complete ===');
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
