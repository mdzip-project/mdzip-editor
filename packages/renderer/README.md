# @mdzip/renderer

Renders MDZip Markdown, and `.mdz` archives, to HTML. It's the renderer behind the preview in [MDZip Studio](https://github.com/mdzip-project/mdzip-studio), the [VS Code extension](https://github.com/mdzip-project/mdzip-vscode) and the web editor on [mdzip.org](https://mdzip.org), so a page you build with it looks the way the document looked while it was written.

It runs in the browser and in Node.

```sh
npm install @mdzip/renderer
npm install jsdom   # only in Node, for sanitizing
```

There are two layers:

- **`@mdzip/renderer`**: Markdown to HTML.
- **`@mdzip/renderer/page`**: an `.mdz` archive to a static page, with its pictures.

## Markdown to HTML

```js
import { renderMdzipMarkdown } from '@mdzip/renderer';

const html = renderMdzipMarkdown('# Hello\n\nSome *Markdown*.');
// <h1 id="hello">Hello</h1>\n<p>Some <em>Markdown</em>.</p>\n
```

What you get:

- GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks.
- Footnotes (`[^1]`), collected in a section at the end.
- Code highlighted with highlight.js for common languages (`<code class="hljs language-js">`). Include a highlight.js theme style sheet to color it.
- ` ```mermaid ` blocks left as `<pre><code class="language-mermaid">`, for Mermaid (or another client-side renderer) to draw.
- Tables wrapped in `<div class="mdzip-table-scroll">`, so a wide table can scroll on its own.
- An id on every heading (see below).
- HTML sanitized with DOMPurify: no scripts, event handlers, `<style>`, inline styles, forms or embeds.

### Options

```js
renderMdzipMarkdown(markdown, {
  resolveLink: (href) => href.replace(/\.md$/, '.html'), // relative Markdown links only
  externalLinks: 'new-tab',      // target="_blank" rel="noopener" on links to other sites
  headingIdPrefix: 'user-content-', // the editor's preview uses this, as GitHub does
  sanitize: false                // only for Markdown you trust
});
```

### Heading ids

Every heading gets an id made from its text, the same way in the editor, on mdzip.org and in the [MDZip Pandoc filter](https://github.com/mdzip-project/mdzip-pandoc), so a link to `#a-heading` works everywhere:

- lowercase;
- punctuation and emoji removed (letters in any language are kept);
- each run of spaces and hyphens becomes one `-`, with none at either end;
- a repeated heading gets `-1`, `-2`, … as on GitHub.

| Heading | Id |
|---|---|
| `## Why isn't it "here"?` | `why-isnt-it-here` |
| `## mdz — the command line` | `mdz-the-command-line` |
| `## 🪟 Windows` | `windows` |
| `## Über Café` | `über-café` |
| `## Install` (the second one) | `install-1` |

`slugifyMdzipHeading(text)` gives you the slug for any text.

### In Node

Sanitizing needs a DOM. In the browser there's one; in Node, give the renderer a window once:

```js
import { JSDOM } from 'jsdom';
import { useMdzipDomWindow, renderMdzipMarkdown } from '@mdzip/renderer';

useMdzipDomWindow(new JSDOM('').window);
renderMdzipMarkdown(markdown);
```

`renderMdzPage()` below does this for you when jsdom is installed. Without a window, `renderMdzipMarkdown()` throws unless you pass `sanitize: false`.

### Rendering in parts

For a long document you want to render a part at a time (the editor's preview renders the parts near the screen):

```js
import { tokenizeMdzipMarkdown, parseMdzipTokens, sanitizeMdzipHtml } from '@mdzip/renderer';

const tokens = tokenizeMdzipMarkdown(markdown);   // heading ids assigned over the whole document
const html = sanitizeMdzipHtml(parseMdzipTokens(tokens.slice(0, 20)));
```

HTML from `parseMdzipTokens()` isn't finished until it goes through `sanitizeMdzipHtml()`, or `finishMdzipHtml()` for trusted input: those turn the renderer's markers into task-list checkboxes and heading ids.

## An .mdz as a static page

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderMdzPage } from '@mdzip/renderer/page';

const page = await renderMdzPage(await readFile('guide.mdz'));

await writeFile('index.html', `<!doctype html>
<meta charset="utf-8">
<title>${page.title ?? 'Guide'}</title>
<meta name="description" content="${page.description ?? ''}">
${page.html}`);

for (const asset of page.assets) {
  await mkdir('assets/page-images', { recursive: true });
  await writeFile(asset.path, asset.bytes);
}
```

(Escape `title` and `description` before putting them in HTML; they come from the archive.)

The page is the archive's entry-point document. `page` has:

| Field | |
|---|---|
| `html` | The document's HTML, sanitized. No `<html>`, `<head>` or style sheet: put it in your own page. |
| `title`, `description` | From the manifest, or `null`. |
| `manifest`, `entryPoint` | The manifest, and the archive path of the document. |
| `assets` | The pictures the document uses: `{ archivePath, fileName, path, url, bytes }`. |

### Pictures

Each picture the document uses (Markdown images, `<img>`, and the `<source>`s of a `<picture>`) becomes an asset named by a hash of its bytes, such as `a1b2c3d4e5f6.png`, so the same picture used by several pages is stored once. With no options, its `path` is `assets/page-images/<fileName>`, the HTML points there, and saving each asset at its `path` beside the page is all you need.

- **`assetDir`**: another folder, relative to the page.
- **`assetUrl(fileName, asset)`**: the address to use for pictures stored somewhere else (a CDN, `../assets/…`). `path` stays the same.
- **`page.withAssetUrls(urls)`**: for hosts that only know a picture's address after uploading it, such as a CMS media library. Render, upload each asset, then get the page with the real addresses. `urls` maps `archivePath` (or `fileName`) to an address, or is a function of the asset.

  ```js
  const urls = {};
  for (const asset of page.assets) urls[asset.archivePath] = await upload(asset.bytes);
  const published = page.withAssetUrls(urls);
  ```

- **`inlineImages: true`**: the pictures go into the HTML as `data:` URIs, for one self-contained page, and `assets` is empty. Binary pictures are base64-encoded; SVGs are percent-encoded (`data:image/svg+xml,…`), which is usually smaller. Big pictures make a big page.

### SVG diagrams with links

An SVG shown with `<img>` is a flat picture: its links can't be clicked. An SVG that contains links (a draw.io diagram saved as `.drawio.svg`, say) is put into the page instead, inside a declarative shadow root (`<template shadowrootmode="open">`), so its styles and ids can't affect the page. Browsers attach it from the HTML alone, without script, and the original `<img>` stays next to it for browsers without declarative shadow DOM, and for crawlers.

An SVG with anything script-like (a script, an event handler, a `javascript:` link) or that loads something from outside itself isn't inlined: it stays an `<img>`, which can't run or load anything, and `onWarning` is told why. `inlineLinkedSvg: false` keeps every SVG an `<img>`.

A `<picture>` that has such an SVG among its sources becomes one option per image, with a small style sheet that shows the one the `<picture>` would have picked.

### Other options

`resolveLink`, `externalLinks`, `headingIdPrefix` and `sanitize` work as for `renderMdzipMarkdown()`. `onWarning(message)` reports problems that don't stop the render.

## License

Apache-2.0
