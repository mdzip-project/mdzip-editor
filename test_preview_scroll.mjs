import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  console.log('Loading demo...');
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  
  // Wait for split mode
  await page.waitForSelector('.mdzip-root');
  
  // Click split button if needed
  const splitBtn = await page.locator('[data-ref="split-btn"]');
  const isSplitActive = await splitBtn.evaluate(el => el.classList.contains('active'));
  
  if (!isSplitActive) {
    await splitBtn.click();
    await page.waitForTimeout(500);
  }
  
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('[data-ref="preview-pane"]');
  
  console.log('Testing preview scroll sync to editor...');
  
  // Get preview bounds for mouse movement
  const previewBounds = await preview.boundingBox();
  const centerX = previewBounds.x + previewBounds.width / 2;
  const centerY = previewBounds.y + previewBounds.height / 2;
  
  // Move mouse to preview and scroll down with wheel
  await page.mouse.move(centerX, centerY);
  
  const scrollBefore = await preview.evaluate(el => el.scrollTop);
  console.log(`Preview scroll before: ${scrollBefore}`);
  
  // Scroll preview down using wheel
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 3);
    await page.waitForTimeout(100);
  }
  
  const previewScrollAfter = await preview.evaluate(el => el.scrollTop);
  const editorScrollAfter = await editor.evaluate(el => el.scrollTop);
  
  console.log(`Preview scroll after: ${previewScrollAfter}`);
  console.log(`Editor scroll after: ${editorScrollAfter}`);
  
  if (editorScrollAfter > 0) {
    console.log('✓ PASS: Editor scrolled when preview scrolled (sync working!)');
  } else {
    console.log('✗ FAIL: Editor did not scroll');
  }
  
  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
