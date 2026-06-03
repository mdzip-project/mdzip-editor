import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  
  console.log('Opening demo...');
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  
  // Take a screenshot
  await page.screenshot({ path: 'test-initial.png' });
  console.log('Initial screenshot taken');
  
  // Keep browser open for manual testing
  console.log('Browser open for 30 seconds - test scroll sync manually');
  await new Promise(r => setTimeout(r, 30000));
  
  await browser.close();
})();
