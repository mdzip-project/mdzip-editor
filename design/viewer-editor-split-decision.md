# Viewer / Editor Split — Decision Record

## Decision

Do not split `@mdzip/editor` into separate viewer and editor packages. Do not introduce a plugin system for CodeMirror. Revisit if concrete evidence of a real-world pain point emerges.

## Context

The question arose because CodeMirror dominates the bundle (~570 KB gzipped) and is unused by consumers who only need read-only rendering (`preview` / `viewer` control presets).

Three approaches were considered:

### 1. Separate viewer and editor packages
`@mdzip/viewer` + `@mdzip/editor` (extends viewer), with framework wrappers targeting the common base.

**Rejected** — breaks the single-install DX. Consumers would need to choose at install time, and the framework wrappers named `@mdzip/editor-react` pairing with `@mdzip/viewer` is confusing. If someone starts with viewer and later needs editing it becomes a dependency swap, not an addition.

### 2. Plugin system
`@mdzip/viewer` as the base; `@mdzip/editor` registered as a plugin at runtime.

**Rejected** — trades an aesthetic dependency-tree problem for a real one: plugin registration API, version coordination, and a two-step install story. The complexity isn't justified.

### 3. Lazy-load CodeMirror inside `@mdzip/editor`
Dynamically import CodeMirror the first time an editor preset (`standalone-editor` / `hosted-editor`) is activated. Viewer presets never trigger the import.

**Preferred if the split is ever pursued.** Preserves the single-install experience, gives viewer consumers a meaningfully smaller initial bundle at no API cost, and only fails to remove CodeMirror from `package.json` — which matters to almost nobody in practice (MIT licence, clean security record).

## Why do nothing now

- CodeMirror is MIT-licensed with a clean security record — no audit or licence risk.
- Modern bundlers tree-shake unused code paths, so viewer-only consumers don't pay the bundle cost today.
- The only real problem is cosmetic: CodeMirify appears in `package.json` for consumers who don't need it.
- All three solutions add maintenance surface. The cost exceeds the benefit until there is concrete evidence (user requests, bundle-size complaints) that it matters.
