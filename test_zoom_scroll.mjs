import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  console.log('Loading demo...');
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  
  await page.waitForSelector('.mdzip-root');
  
  // Zoom in to make content taller
  const zoomBtn = page.locator('[data-ref="zoom-btn"]');
  await zoomBtn.click();
  await page.waitForTimeout(300);
  
  // Click zoom in button 3 times
  const zoomInBtn = page.locator('[data-action="zoom-in"]');
  for (let i = 0; i < 3; i++) {
    await zoomInBtn.click();
    await page.waitForTimeout(200);
  }
  
  const splitBtn = await page.locator('[data-ref="split-btn"]');
  const isSplitActive = await splitBtn.evaluate(el => el.classList.contains('active'));
  
  if (!isSplitActive) {
    await splitBtn.click();
    await page.waitForTimeout(500);
  }
  
  const editor = page.locator('.cm-scroller');
  const preview = page.locator('[data-ref="preview-pane"]');
  
  // Check scroll heights after zoom
  const editorScroll = await editor.evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    isScrollable: el.scrollHeight > el.clientHeight
  }));
  
  const previewScroll = await preview.evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    isScrollable: el.scrollHeight > el.clientHeight
  }));
  
  console.log('After zoom - Editor:', editorScroll);
  console.log('After zoom - Preview:', previewScroll);
  
  if (!editorScroll.isScrollable) {
    console.log('Editor still not scrollable even with zoom');
    // Try more zoom
    for (let i = 0; i < 5; i++) {
      await zoomInBtn.click();
      await page.waitForTimeout(200);
    }
    
    const editorScroll2 = await editor.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      isScrollable: el.scrollHeight > el.clientHeight
    }));
    console.log('After more zoom - Editor:', editorScroll2);
  }
  
  // Now test scroll sync
  console.log('Testing scroll sync...');
  
  const previewBounds = await preview.boundingBox();
  await page.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2);
  
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 3);
    await page.waitForTimeout(150);
  }
  
  const finalEditor = await editor.evaluate(el => el.scrollTop);
  const finalPreview = await preview.evaluate(el => el.scrollTop);
  
  console.log(`Final - Preview scrollTop: ${finalPreview}, Editor scrollTop: ${finalEditor}`);
  
  if (finalEditor > 0) {
    console.log('✓ PASS: Editor scrolled in sync with preview');
  } else {
    console.log('✗ FAIL: Editor did not scroll');
  }
  
  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
