// Playwright verification of the host link/anchor APIs (#48 onLinkActivated,
// #49 externalLinks, #50 scrollToAnchor/getAvailableAnchors) in real
// Chromium — the layout-dependent behavior jsdom can't check: real scroll
// offsets, images loading above the target, new-tab navigation.
//
// Self-contained: bundles a test page from packages/editor/dist (run
// `npm run build -w @mdzip/editor` first) and serves it, plus deliberately
// slow images, from a local server. Usage: node scripts/verify-link-host-api.mjs
// (HEADED=1 to watch).
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DELAY_MS = 1500;
const TOLERANCE_PX = 2;

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// A solid-grey RGB PNG with no width/height in the markup, so the browser
// only learns its size when it arrives — the layout shift we want to provoke.
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x99)]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const bundleDir = await mkdtemp(path.join(os.tmpdir(), 'mdzip-link-verify-'));
const entry = path.join(bundleDir, 'entry.js');
await writeFile(entry, `
import { MdzipWorkspaceView } from ${JSON.stringify(path.join(repoRoot, 'packages/editor/dist/index.js').split(path.sep).join('/'))};
window.MdzipWorkspaceView = MdzipWorkspaceView;
`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(bundleDir, 'bundle.js'),
  logLevel: 'error',
  nodePaths: [path.join(repoRoot, 'node_modules')]
});
const bundle = await readFile(path.join(bundleDir, 'bundle.js'));
const image = png(800, 600);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>link verify</title>
<style>html, body { margin: 0; } #host { height: 700px; }</style></head>
<body><div id="host"></div><script type="module" src="/bundle.js"></script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  } else if (url.pathname === '/bundle.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle);
  } else if (url.pathname.startsWith('/img/')) {
    setTimeout(() => res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(image),
      IMAGE_DELAY_MS);
  } else if (url.pathname === '/external') {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>external</title>external page');
  } else {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Long enough that progressive rendering leaves the target unmounted, with
// slow images above the target and plenty of content after it (so the pane
// can actually scroll the heading to its top edge).
const filler = (label, count) => Array.from({ length: count },
  (_, i) => `${label} paragraph ${i} with enough padding text that each block has some real height on screen.`).join('\n\n');
const SOURCE = [
  '# Top',
  '',
  `[Jump down](#target-section) · [Repo file](../README.md) · [Site](${BASE}/external) · [Mail](mailto:a@example.com)`,
  '',
  `<a href="${BASE}/external?raw=1">Raw HTML link</a>`,
  '',
  filler('Intro', 40),
  '',
  ...[1, 2, 3, 4].map((n) => `![slow image ${n}](${BASE}/img/${n}.png)\n\n${filler(`Section ${n}`, 60)}\n`),
  '## Target Section',
  '',
  filler('Target', 30),
  '',
  '## Tail Heading',
  '',
  filler('Tail', 120),
  ''
].join('\n');

const browser = await chromium.launch({ headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

// Mounts a fresh view. When `anchorBeforeOpen` is set, scrollToAnchor is
// called *before* open() — the deep-link-on-first-load case from #50.
async function mount(anchorBeforeOpen) {
  await page.goto(BASE);
  await page.waitForFunction(() => window.MdzipWorkspaceView);
  return page.evaluate(async ({ source, anchor }) => {
    window.events = [];
    window.unresolved = [];
    const view = new window.MdzipWorkspaceView(document.getElementById('host'), {
      controls: 'standalone-editor',
      initialLayout: 'split',
      initialColorScheme: 'light',
      progressiveTextRendering: true,
      externalLinks: { target: '_blank' },
      onLinkActivated: (event) => {
        if (event.kind === 'relative' && event.ctrlKey) {
          event.preventDefault();
        }
        window.events.push({
          kind: event.kind, path: event.path, anchor: event.anchor, text: event.text,
          ctrlKey: event.ctrlKey, defaultPrevented: event.defaultPrevented
        });
      },
      onUnresolvedLinkClick: (href) => window.unresolved.push(href)
    });
    window.view = view;
    const scrolled = anchor ? view.scrollToAnchor(anchor) : null;
    await view.open(new TextEncoder().encode(source), { mode: 'editable', fileName: 'notes.md' });
    return scrolled ? await scrolled : null;
  }, { source: SOURCE, anchor: anchorBeforeOpen });
}

// Heading top relative to the preview pane's top edge: 0 means it sits
// exactly where scrollToAnchor put it.
const headingOffset = (id) => page.evaluate((headingId) => {
  const pane = document.querySelector('[data-ref="preview-pane"]');
  const heading = document.getElementById(headingId);
  return heading ? Math.round(heading.getBoundingClientRect().top - pane.getBoundingClientRect().top) : null;
}, id);

const imagesSettled = () => page.waitForFunction(
  () => [...document.querySelectorAll('[data-ref="preview-content"] img')]
    .filter((img) => img.src.includes('/img/'))
    .every((img) => img.complete && img.naturalHeight > 0),
  null, { timeout: 15000 });

const link = (text) => page.locator('[data-ref="preview-content"] a', { hasText: text }).first();

try {
  // --- #50: deep link on first load, before the preview exists --------------
  const resolved = await mount('#target-section');
  check('scrollToAnchor called before open() resolves true', resolved === true, String(resolved));
  const offsetNow = await headingOffset('user-content-target-section');
  check('heading lands at the top of the preview pane', offsetNow !== null && Math.abs(offsetNow) <= TOLERANCE_PX,
    `offset ${offsetNow}px`);

  const pendingImages = await page.evaluate(() => [...document.querySelectorAll('[data-ref="preview-content"] img')]
    .filter((img) => img.src.includes('/img/') && !img.complete).length);
  check('sanity: slow images above the target were still loading at scroll time', pendingImages > 0,
    `${pendingImages} pending`);
  await imagesSettled();
  await page.waitForTimeout(300);
  const offsetAfterImages = await headingOffset('user-content-target-section');
  check('heading stays put once the images above it finish loading',
    offsetAfterImages !== null && Math.abs(offsetAfterImages) <= TOLERANCE_PX,
    `offset ${offsetAfterImages}px after images (was ${offsetNow}px)`);

  // The hold on the heading must end as soon as the user scrolls themselves.
  const pane = page.locator('[data-ref="preview-pane"]');
  await pane.hover();
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  const userScrollTop = await pane.evaluate((el) => el.scrollTop);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'verify-spacer';
    spacer.style.height = '500px';
    document.querySelector('[data-ref="preview-content"]').prepend(spacer);
  });
  await page.waitForTimeout(300);
  const scrollTopAfterGrow = await pane.evaluate((el) => el.scrollTop);
  check('after the user scrolls, growing content no longer snaps back to the heading',
    scrollTopAfterGrow === userScrollTop, `scrollTop ${userScrollTop} -> ${scrollTopAfterGrow}`);
  await page.evaluate(() => document.getElementById('verify-spacer').remove());

  const anchors = await page.evaluate(() => window.view.getAvailableAnchors());
  check('getAvailableAnchors lists every heading in order', JSON.stringify(anchors) ===
    JSON.stringify(['top', 'target-section', 'tail-heading']), JSON.stringify(anchors));

  // --- #50 via a click: #fragment link --------------------------------------
  await page.evaluate(() => { document.querySelector('[data-ref="preview-pane"]').scrollTop = 0; });
  await link('Jump down').click();
  await page.waitForTimeout(300);
  const offsetAfterClick = await headingOffset('user-content-target-section');
  check('clicking a #fragment link scrolls the heading to the top',
    offsetAfterClick !== null && Math.abs(offsetAfterClick) <= TOLERANCE_PX, `offset ${offsetAfterClick}px`);
  check('the page URL hash is untouched', !page.url().includes('#'), page.url());

  // --- #49: external link attributes and real new-tab navigation ------------
  const attrs = (text) => link(text).evaluate((a) => ({ target: a.getAttribute('target'), rel: a.getAttribute('rel') }));
  for (const text of ['Site', 'Mail', 'Raw HTML link']) {
    const value = await attrs(text);
    check(`"${text}" gets target=_blank rel="noopener noreferrer"`,
      value.target === '_blank' && value.rel === 'noopener noreferrer', JSON.stringify(value));
  }
  for (const text of ['Jump down', 'Repo file']) {
    const value = await attrs(text);
    check(`"${text}" is left without target/rel`, value.target === null && value.rel === null, JSON.stringify(value));
  }
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 5000 }),
    link('Site').click()
  ]);
  await popup.waitForLoadState();
  check('clicking an external link opens it in a new tab', popup.url() === `${BASE}/external`, popup.url());
  check('the new tab has no window.opener', await popup.evaluate(() => window.opener === null));
  await popup.close();
  check('the editor page itself did not navigate', page.url() === `${BASE}/`, page.url());

  // --- #48: host takes over a relative link; unprevented keeps old behavior -
  let extraTab = null;
  const onPage = (opened) => { extraTab = opened; };
  context.on('page', onPage);
  await link('Repo file').click({ modifiers: ['Control'] });
  await page.waitForTimeout(800);
  context.off('page', onPage);
  check('Ctrl+click with preventDefault: no new tab and no navigation',
    extraTab === null && page.url() === `${BASE}/`, extraTab ? extraTab.url() : page.url());
  check('Ctrl+click with preventDefault: onUnresolvedLinkClick skipped',
    (await page.evaluate(() => window.unresolved.length)) === 0);

  await link('Repo file').click();
  await page.waitForTimeout(300);
  check('plain click (unprevented) still reaches onUnresolvedLinkClick',
    JSON.stringify(await page.evaluate(() => window.unresolved)) === JSON.stringify(['../README.md']));
  check('plain click on the relative link did not navigate', page.url() === `${BASE}/`, page.url());

  const events = await page.evaluate(() => window.events);
  const summary = events.map((e) => `${e.text}:${e.kind}${e.anchor ? `#${e.anchor}` : ''}${e.defaultPrevented ? '(prevented)' : ''}`);
  check('onLinkActivated saw every click with the right kind and anchor', JSON.stringify(summary) === JSON.stringify([
    'Jump down:anchor#target-section',
    'Site:external',
    'Repo file:relative(prevented)',
    'Repo file:relative'
  ]), summary.join(', '));

  // --- #49: policy survives an edit that re-renders the links' chunk --------
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await page.waitForFunction(() => document.querySelector('[data-ref="preview-content"] h1')?.textContent.includes('edited'),
    null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const afterEdit = await attrs('Site');
  check('after an edit re-renders the chunk, external links keep the policy',
    afterEdit.target === '_blank' && afterEdit.rel === 'noopener noreferrer', JSON.stringify(afterEdit));

  await page.evaluate(() => window.view.setExternalLinks(undefined));
  const cleared = await attrs('Site');
  check('setExternalLinks(undefined) removes target/rel live', cleared.target === null && cleared.rel === null,
    JSON.stringify(cleared));
} catch (error) {
  check('script ran to completion', false, error.message);
} finally {
  await browser.close();
  server.close();
  await rm(bundleDir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
