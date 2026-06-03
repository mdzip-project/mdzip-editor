import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  // Listen to console messages
  page.on('console', msg => console.log('Browser console:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('Page error:', err));
  
  console.log('Loading demo...');
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  
  await page.waitForSelector('.mdzip-root');
  
  // Check if there are scroll listeners attached
  const previewHasListener = await page.locator('[data-ref="preview-pane"]').evaluate(el => {
    const listeners = getEventListeners(el);
    console.log('Preview listeners:', Object.keys(listeners || {}));
    return listeners && listeners.scroll && listeners.scroll.length > 0;
  }).catch(() => false);
  
  console.log('Preview has scroll listener:', previewHasListener);
  
  // Add debug logging
  await page.evaluate(() => {
    const preview = document.querySelector('[data-ref="preview-pane"]');
    const editor = document.querySelector('.cm-scroller');
    
    if (preview && editor) {
      const originalPreviewScroll = preview.scrollTop;
      
      preview.addEventListener('scroll', () => {
        console.log(`Preview scrolled to ${preview.scrollTop}, editor at ${editor.scrollTop}`);
      });
      
      editor.addEventListener('scroll', () => {
        console.log(`Editor scrolled to ${editor.scrollTop}, preview at ${preview.scrollTop}`);
      });
    }
  });
  
  // Test scroll
  const preview = page.locator('[data-ref="preview-pane"]');
  const previewBounds = await preview.boundingBox();
  
  console.log('Scrolling preview...');
  await page.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2);
  
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 5);
    await page.waitForTimeout(200);
  }
  
  const editor = page.locator('.cm-scroller');
  const previewScroll = await preview.evaluate(el => el.scrollTop);
  const editorScroll = await editor.evaluate(el => el.scrollTop);
  
  console.log(`Final - Preview: ${previewScroll}, Editor: ${editorScroll}`);
  
  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
