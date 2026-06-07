# mdzip-editor

Reusable JavaScript and Angular workspace packages for MDZip files.

## Packages

* `@mdzip/editor` is the framework-independent workspace engine built on `mdzip-core-js`.
* `@mdzip/editor-ng` is the Angular component layer for the workspace engine.
* `demo` is a small Angular application that proves the packages run outside VS Code.

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
