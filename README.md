[![MDZip logo][mdzip-logo]][mdzip-url]

[mdzip-logo]: https://raw.githubusercontent.com/mdzip-project/mdzip-editor/main/resources/mdzip-mark.svg
[mdzip-url]: https://mdzip.org

# mdzip-editor

Reusable JavaScript, Angular, React, and Vue workspace packages for MDZip files.

## Packages

* `@mdzip/editor` is the framework-independent workspace engine built on `@mdzip/core-js`.
* `@mdzip/editor-ng` is the Angular component wrapper for the workspace engine.
* `@mdzip/editor-react` is the React component wrapper.
* `@mdzip/editor-vue` is the Vue 3 component wrapper.
* `demo` is a browser application with raw JS, Angular, React, and Vue tabs that proves the packages run outside VS Code.

## Development

```sh
npm install
npm run build
npm test
npm run start:demo
```

## Using The Library

See [docs/developer-guide.md](docs/developer-guide.md) for standalone and hosted
usage, granular toolbar configuration, and framework examples.

See [docs/theming.md](docs/theming.md) for custom themes and the complete CSS
variable reference.
