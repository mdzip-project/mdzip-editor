Status: ready-to-commit
Last: Fixed editor/preview scroll jumping on edit (#46), plus webview bundle-size fix (#45)

Two independent pieces of work, both verified against real reproductions
(not just synthetic tests) and ready to commit.

## Scroll jumping on edit (#46)

Kyle reported both the source editor and the preview jumping scroll
position — sometimes on every keystroke, sometimes seconds later,
decoupled from any edit — on a real file with images and a mermaid
diagram. Every fix below was driven by live debug logging added to a test
build and read back from Kyle's actual DevTools console; none of this
reproduced in a synthetic repro, and three earlier attempted fixes each
turned out to be real but insufficient on their own. Root cause was two
independent, compounding problems:

1. **Cross-pane propagation of non-user scroll events.** An edit that
   changes a mounted element's height (mermaid re-render, image decode,
   CodeMirror's own line-height re-measurement) can produce a genuine,
   non-echo `scroll` event with no explicit write behind it — native CSS
   scroll anchoring, or CodeMirror's own internal viewport/anchor
   recalculation, silently adjusting `scrollTop` (visible at one point as a
   `Viewport failed to stabilize` console warning). Indistinguishable from
   a real user scroll to the editor/preview sync listeners, so it
   propagated to the other pane. Fixed by requiring positive evidence of
   user intent: `syncScrollFromPreview`/`syncScrollToPreview` now only act
   within a short window after a genuine wheel/touch/mousedown gesture on
   that specific pane — deliberately not `keydown` on the editor side,
   since `.cm-scroller` receives every keystroke typed, not just
   navigation keys (a real bug in an earlier iteration: ordinary typing
   kept the gesture window "warm", letting edit-driven scroll noise
   through on every keystroke).
2. **The preview's own scroll position getting silently clamped.** Every
   preview re-render — a chunk reconcile or a full cold-start reset — has
   a real window where the preview is shorter than before (old DOM torn
   down, replacement mounted asynchronously). If scroll position no longer
   fits that transient shrink, the browser clamps `scrollTop` and never
   un-clamps once the real height returns. Fixed by capturing `scrollTop`
   at the start of every `updatePreview()` call and restoring it in
   `firePreviewRendered`, the one point every rendering path (reconciled or
   cold-start) already calls once mounted.

Also landed along the way, both real fixes but insufficient alone against
the two root causes above: `overflow-anchor: none` on both scroll panes,
and a real-scrollable-overflow guard on `syncScrollToPreview`'s "is the
editor at the document's end" check (a document that simply fits within
the viewport was tripping it).

Verified: added tests to `preview-copy-all.test.mjs` covering the
gesture-gate settle window and both scroll-clamp scenarios (reconcile and
cold-start) — jsdom doesn't implement real layout, so these simulate the
browser's clamp-on-shrink behavior directly at the DOM-mutation point.
Confirmed each new test fails without its fix and passes with it. Full
suite: 271 `node --test` + 49 vitest, all green.

## Reduce webview bundle size (#45)

`highlight.js`'s default entry point registers all ~384 bundled language
grammars at import time. New `highlight-core.ts` imports
`highlight.js/lib/core` plus only the languages
`DEFAULT_CODE_BLOCK_LANGUAGES` (view.ts) actually offers in the code-block
picker; `rendering.ts` and `front-matter-extension.ts` import from it
instead of the raw package. A fenced code block naming an uncurated
language now renders unhighlighted instead of highlighted — both call
sites already guarded with `hljs.getLanguage(language)` before
highlighting, so this degrades the same way an unrecognized language name
already did.

Measured: mdzip-vscode's webview bundle dropped from ~5.3MB to ~4.3MB.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
