Status: ready-to-commit
Last: Fixed a mount-progress race that duplicated chunks, and made mermaid's transformHtml synchronous when idle

Four pieces of work, all verified (including live confirmation in Studio
for the chunking/mermaid fixes) and ready to commit.

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

## Chunk isolation and mount-progress fixes (per-keystroke flash in mdzip-studio)

Found while testing #46 live in mdzip-studio against a real document: every
keystroke caused a visible flash. This turned out to be **three separate,
compounding bugs** in the chunked-rendering pipeline, found over an extended
live-debugging session (console instrumentation plus, eventually, frame-by-
frame video analysis of a screen recording — the single most productive step,
after many rounds of console logs failed to pin down the exact mechanism).
The actual on-screen flash Kyle was seeing turned out to be a fourth,
Studio-side CSS issue (see `../mdzip-studio/STATUS.md`) — these three are
real bugs in their own right, found and fixed along the way, but were not
individually sufficient to explain the reported symptom.

1. **Unrelated content sharing a chunk.** `groupTokensIntoChunks` groups
   tokens purely by a char/token budget (2000 chars / 40 tokens by default).
   A document small enough to fit several sections — headings, a table, an
   image — under that budget merged them all into one chunk, so editing
   prose in one section tore down and rebuilt everything else sharing its
   chunk too, including a mermaid diagram and an unrelated `<img>`. Fixed
   two ways: `MdzipMarkdownRenderExtension` gained an optional
   `shouldIsolateChunk(token)` hook (`mdzipMermaidExtension` implements it
   for fenced ` ```mermaid ` blocks) plus a new built-in `tokenEmbedsImage`
   check (Markdown `![]()` or a raw `<img>` tag) — both isolate the matching
   token into its own chunk via `MdzipChunkOptions.shouldIsolate`. Separately,
   a new `MdzipChunkOptions.shouldStartChunk` option (bound to `tokenIsHeading`
   in `view.ts`'s `chunkOptions()`) forces a fresh chunk boundary at every
   heading, so sibling sections never share a chunk regardless of how well
   they'd otherwise fit the budget.
2. **`mdzipMermaidExtension`'s `transformHtml` always returned a Promise.**
   It was declared `async`, so calling it returned a Promise even on the
   trivial "no mermaid block in this chunk" path. Since every registered
   extension's `transformHtml` runs on every chunk regardless of content,
   this forced the *entire* chunk-render pipeline (`chainRenderStage`) onto
   a microtask chain for every chunk in every document once mermaid was
   registered — mermaid or not. Fixed by splitting the check out: the
   no-op path now returns the HTML string synchronously, only going async
   when there's an actual diagram to render.
3. **A real mount-progress race.** `armChunkSentinel`'s lazy continuation,
   `mountAllChunksEagerly`'s batch loop, and `mountReconciledMiddle`'s
   completion all discarded a batch's mount progress whenever a newer edit
   had landed by the time that batch's (possibly slow) work resolved. The
   chunks it mounted were already physically in the DOM, but
   `chunkedRenderState.cursor` never advanced, so the next edit's reconcile
   saw the same stale, un-advanced cursor and re-armed a sentinel from that
   same starting point — re-rendering and re-appending (duplicating) chunks
   that were already correctly mounted. Confirmed via a screen recording:
   an already-settled `<img>` visibly went to broken and back roughly every
   keystroke as a fresh duplicate silently replaced it (`oldValue: null` on
   its `style`/`src` attributes proved it was a brand-new element each
   time, not a mutation of the existing one). Fixed by recording progress
   unconditionally at all three sites — safe, since `recordChunkProgress`
   already has its own internal staleness guard — and only gating further
   work (not the bookkeeping) on whether the edit is still current.

Verified: full suite green throughout (276 `node --test` + 49 vitest for
editor, 8 vitest for editor-ng), including new regression tests for image
isolation and heading-boundary isolation, and a test confirming
`transformHtml`'s no-op path returns synchronously. A fourth regression test
attempting to reproduce the mount-progress race directly in jsdom couldn't
be made to discriminate reliably (the real race depends on Electron IPC
latency a synthetic delay didn't replicate) and was removed rather than kept
as a false safety net — the fix itself is sound by inspection
(`recordChunkProgress`'s guard makes it a safe no-op when genuinely stale)
and was confirmed live in Studio.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
