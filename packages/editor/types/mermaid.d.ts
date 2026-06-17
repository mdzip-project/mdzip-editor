// Build-time ambient declaration for the optional, lazily-imported `mermaid`
// dependency, so `@mdzip/editor` type-checks without bundling mermaid (~1MB+).
// Consumers that enable the mermaid extension install `mermaid` (an optional
// peer dependency) themselves; it is imported on demand via dynamic import only
// when a document contains a mermaid block.
//
// Kept outside `src/` so it ships nothing to `dist` (ambient `.d.ts` inputs are
// never emitted) and does not trip the source-tree boundary check.
declare module 'mermaid';
