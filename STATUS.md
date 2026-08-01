Status: awaiting-test
Last: Excluded code blocks, inline code, and link/image URLs from source-editor spellcheck

Fenced/indented code blocks, inline code spans, and link/image URLs were
getting spellcheck-underlined even though they aren't prose (reported via a
screenshot of the dev-guide markdown, e.g. `@mdzip/editor-ng` and an image
filename both flagged). Added a syntax-tree-driven CodeMirror decoration
(`noSpellcheckHighlight` in `packages/editor/src/view.ts`) that tags
`FencedCode`/`CodeBlock`/`InlineCode`/`URL` node ranges with
`spellcheck="false"`, alongside the existing raw-HTML-tag exclusion.
Typecheck, lint, and full test suite (179 + 29 tests) pass. Not yet
committed — please try it against a real markdown doc with code blocks and
image refs to confirm the underlines are gone.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
