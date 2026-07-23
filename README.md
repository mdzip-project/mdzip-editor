[![MDZip logo][mdzip-logo]][mdzip-url]

[mdzip-logo]: resources/mdzip-mark.svg
[mdzip-url]: https://mdzip.org

# mdzip-editor

[![@mdzip/editor on npm](https://img.shields.io/npm/v/@mdzip/editor?logo=npm&label=%40mdzip%2Feditor)](https://www.npmjs.com/package/@mdzip/editor)
[![license](https://img.shields.io/npm/l/@mdzip/editor)](LICENSE)

Reusable JavaScript, Angular, React, and Vue workspace packages for Markdown and MDZip files.

## Packages

* [![npm](https://img.shields.io/npm/v/@mdzip/editor)](https://www.npmjs.com/package/@mdzip/editor) `@mdzip/editor` is the framework-independent workspace engine built on `@mdzip/core-js`.
* [![npm](https://img.shields.io/npm/v/@mdzip/editor-ng)](https://www.npmjs.com/package/@mdzip/editor-ng) `@mdzip/editor-ng` is the Angular component wrapper for the workspace engine.
* [![npm](https://img.shields.io/npm/v/@mdzip/editor-react)](https://www.npmjs.com/package/@mdzip/editor-react) `@mdzip/editor-react` is the React component wrapper.
* [![npm](https://img.shields.io/npm/v/@mdzip/editor-vue)](https://www.npmjs.com/package/@mdzip/editor-vue) `@mdzip/editor-vue` is the Vue 3 component wrapper.

The interactive demo (raw JS, Angular, React, and Vue tabs proving the
packages run outside VS Code) lives in
[mdzip.org's `editor-demo/app`](https://github.com/mdzip-project/mdzip.org/tree/main/editor-demo/app),
not in this repo — see `private/Publish.mdz` §2 for testing local editor
changes against it before publishing.

## Development

```sh
npm install
npm run build
npm test
```

## Using The Library

See [docs/developer-guide.md](docs/developer-guide.md) for standalone and hosted
usage, granular toolbar configuration, and framework examples.

See [docs/theming.md](docs/theming.md) for custom themes and the complete CSS
variable reference.
