import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// MDZip spec test T-016 (hostile content), against the default sanitizing renderer
// that Studio, VS Code and mdzip.org use. jsdom fetches nothing, so instead of
// watching the canary server this checks the rendered HTML: nothing that could run
// code or reach the canary may survive, except an http: <img src>, whose loading
// is the host's decision (spec 9.2: Studio's request filter, VS Code's CSP).
if (typeof globalThis.window === 'undefined') {
  globalThis.window = new JSDOM('<!doctype html><html><body></body></html>').window;
}
globalThis.document = globalThis.window.document;
globalThis.HTMLElement = globalThis.window.HTMLElement;
globalThis.Node = globalThis.window.Node;
const { MdzipWorkspaceService, defaultSafeMarkdownRenderer } = await import('../dist/index.js');

const fixture = (name) => new URL(`./fixtures/spec/${name}`, import.meta.url);
const cases = JSON.parse(readFileSync(fixture('hostile-content-cases.json'), 'utf8'));

const workspace = await MdzipWorkspaceService.open(new Uint8Array(readFileSync(fixture('hostile-content.mdz'))), {
  mode: 'read-only',
  fileName: 'hostile-content.mdz'
});
const markdown = workspace.snapshot().content.markdownText;
const html = defaultSafeMarkdownRenderer.render(markdown);
const rendered = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const elements = [...rendered.body.querySelectorAll('*')];

// Every place a URL can hide in the rendered markup, as [element, attribute, value].
const urlBearing = elements.flatMap((el) =>
  [...el.attributes].map((attr) => [el, attr.name.toLowerCase(), attr.value])
);
const referencesTo = (id) => {
  const target = `${cases.canary}/${id}`;
  const inAttributes = urlBearing
    .filter(([, , value]) => value.includes(target))
    .map(([el, name]) => `${el.tagName.toLowerCase()}[${name}]`);
  const inCode = elements
    .filter((el) => ['script', 'style'].includes(el.tagName.toLowerCase()) && el.textContent.includes(target))
    .map((el) => `${el.tagName.toLowerCase()} text`);
  return [...inAttributes, ...inCode];
};

test('the fixture is the one the cases describe', () => {
  assert.equal(workspace.snapshot().content.entryPoint, cases.document);
  assert.match(markdown, /## script-element/);
});

test("the archive's own image still renders", () => {
  for (const path of cases.renders) {
    assert.ok(
      [...rendered.querySelectorAll('img')].some((img) => img.getAttribute('src') === path),
      `expected <img src="${path}">`
    );
  }
});

test('nothing executable survives', () => {
  assert.equal(rendered.querySelectorAll('script').length, 0, 'no <script>');
  assert.deepEqual(
    urlBearing.filter(([, name]) => name.startsWith('on')).map(([el, name]) => `${el.tagName.toLowerCase()}[${name}]`),
    [],
    'no event-handler attributes'
  );
  assert.equal(rendered.querySelectorAll('svg').length, 0, 'no inline SVG under the default policy');
  for (const tag of ['base', 'meta', 'link', 'iframe', 'object', 'embed', 'form', 'style']) {
    assert.equal(rendered.querySelectorAll(tag).length, 0, `no <${tag}>`);
  }
});

for (const c of cases.cases) {
  test(`${c.id} (${c.requirement}, §${c.section})`, () => {
    if (c.check === 'dom') {
      const javascriptUrls = urlBearing.filter(
        ([, name, value]) => ['href', 'src', 'data', 'action', 'formaction'].includes(name) && /^\s*javascript:/i.test(value)
      );
      assert.deepEqual(javascriptUrls.map(([el, name]) => `${el.tagName.toLowerCase()}[${name}]`), []);
      return;
    }
    const survivors = referencesTo(c.id);
    if (c.id === 'http-image') {
      // Left as a plain image; whether it loads is the host's policy (spec 9.2).
      assert.deepEqual(survivors, ['img[src]']);
      return;
    }
    assert.deepEqual(survivors, [], `${c.construct} must not survive rendering`);
  });
}
