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
  
  // Get scroll heights
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('[data-ref="preview-pane"]');
  
  const editorScroll = await editor.evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop
  }));
  
  const previewScroll = await preview.evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop
  }));
  
  console.log('Editor scroll info:', editorScroll);
  console.log('Preview scroll info:', previewScroll);
  
  // Check if editor is scrollable
  const editorScrollable = editorScroll.scrollHeight > editorScroll.clientHeight;
  const previewScrollable = previewScroll.scrollHeight > previewScroll.clientHeight;
  
  console.log(`Editor scrollable: ${editorScrollable} (height: ${editorScroll.scrollHeight - editorScroll.clientHeight}px)`);
  console.log(`Preview scrollable: ${previewScrollable} (height: ${previewScroll.scrollHeight - previewScroll.clientHeight}px)`);
  
  // Test with mouse wheel scroll (which should trigger events)
  if (editorScrollable) {
    console.log('Testing editor scroll with wheel event...');
    
    // Get center of editor
    const editorBounds = await editor.boundingBox();
    const centerX = editorBounds.x + editorBounds.width / 2;
    const centerY = editorBounds.y + editorBounds.height / 2;
    
    // Scroll with wheel
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 3); // Scroll down 3 units
    
    await page.waitForTimeout(500);
    
    const editorScrollAfter = await editor.evaluate(el => el.scrollTop);
    const previewScrollAfter = await preview.evaluate(el => el.scrollTop);
    
    console.log(`Editor scroll after wheel: ${editorScrollAfter}`);
    console.log(`Preview scroll after wheel: ${previewScrollAfter}`);
    
    if (previewScrollAfter > 0) {
      console.log('✓ PASS: Scroll sync working!');
    } else {
      console.log('✗ FAIL: Scroll sync not working');
    }
  }
  
  await browser.close();
})().catch(err => {
  console.error('Debug failed:', err);
  process.exit(1);
});
