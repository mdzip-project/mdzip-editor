Status: ready-to-commit
Last: v1.4.8 release prep done (verify green) — navigation and lazy open no longer rebuild the whole archive (books.mdz read timeouts); awaiting commit, then tag/release/publish; 1.4.7 is live on npm

**Next release:** make the four packages' `description` fields consistent (seen on the npm search page). Now: editor "Framework-independent MDZip workspace engine.", editor-ng "Angular UI components for the MDZip workspace engine.", editor-react / editor-vue "<Framework> wrapper for the MDZip workspace editor." — ng is the odd one out, and "engine" vs "editor" is mixed.

v1.4.5 shipped 2026-09-23/24 — see the CHANGELOG's `[1.4.5]` entry. It adds
heading anchors (#47, closed), `onUnresolvedLinkClick` (mdzip-vscode#13), the
Shift+Right-Click fix (mdzip-studio#22) and the duplicated-tail fix for a
regression in 1.4.4. Sections below are the write-ups behind each item.

## Regression in the published 1.4.4: tail duplicated on every keystroke

Reported from VS Code against `TestFiles/star-wars-demo/index.md`: each
character typed added another "Skywalker Family Tree" section (heading +
mermaid) at the bottom of the preview. Reproduced in jsdom (progressive
rendering + mermaid extension + an IntersectionObserver that fires at once),
and confirmed it also reproduces on the committed HEAD — i.e. it ships in
**1.4.4**, not something from the heading-anchor work.

Cause: `mountReconciledMiddle` mounts the changed "middle" via
`renderAndMountChunkBatch`, whose loop ran to `records.length`. A batch that
finished the one changed chunk inside its 4000-char / 10ms budget carried on
into the surviving suffix chunks (already mounted, unchanged) and mounted
them again — replacing `record.root` and orphaning the first copy in the DOM,
where nothing ever removes it. Any document of short heading-delimited
sections hits it (each heading starts a chunk); the existing reconciliation
tests used 150 equal paragraphs whose chunks exceed the batch budget, so
they never did. Fix: `renderAndMountChunkBatch` takes an `endCursor`, and
`mountReconciledMiddle` passes `middleEnd`.

Verified: new `preview-chunking` test (small heading sections, progressive on
and off, two consecutive edits) fails without the fix and passes with it.
Full suite: 295 `node --test` + 70 vitest. **Worth a 1.4.5 soon** — Studio
and the VS Code extension both ship 1.4.4.

## Heading anchors (#47)

`[x](#some-heading)` was a no-op: headings rendered as bare `<hN>`, and the
click fell through to browser hash navigation with nothing to land on.

- **Ids**: `assignMdzipHeadingIds` (rendering.ts) walks the *whole
  document's* tokens — blockquote/list-nested headings included — and gives
  each a GitHub-slugger-style id with `-1`/`-2` dedupe. It has to run before
  chunking: a chunk rendered alone can't know how many earlier chunks used
  a slug. A `heading` renderer override emits it as `user-content-<slug>`.
  The prefix is deliberate: DOMPurify strips an `id` equal to a
  document/form property, and "Images", "Links", "Title", "Location" are
  ordinary heading names. (First attempt used DOMPurify's
  `SANITIZE_NAMED_PROPS`; rejected — it prefixes *every* id, which would
  break mermaid's internal `url(#id)`/CSS id references.)
- **Reconciliation**: `chunkSourceKey` now folds in the chunk's heading ids.
  An unchanged chunk whose ids shifted (an earlier duplicate was added)
  would otherwise be reused with stale DOM ids.
- **Click handling** (view.ts): `#fragment` links are intercepted;
  `scrollPreviewToAnchor` matches `id`/`name` (bare or prefixed,
  case-insensitive, percent-decoded). If the target sits in an unmounted
  progressive chunk it finds the record via its heading ids (or a raw
  `id=`/`name=` scan) and reuses `drainRemainingChunks` — extended with a
  `stopAfterRecordIndex` — to mount up to it, then re-arms the sentinel.
  `#`/`#top` scroll to top. `other.md#heading` links stash the fragment and
  scroll after that document's preview mounts (deferred a frame so it can't
  race the sentinel arming).
- Not done: the `## Heading {#custom-id}` syntax from the issue's
  "consider" list. Cross-document `file.md#heading` for links that leave
  the archive (mdzip-vscode#13's path) drops the fragment — the host would
  have to carry it into the new editor.

Verified: new `heading-anchors.test.mjs` (13 tests: slug rules, dedupe,
entities, nesting, property-name headings, cross-chunk uniqueness, key
shift, click-scroll, case/percent-decoding, explicit `<a id>`, no-match/top,
and the unmounted-chunk drain). Confirmed the key-shift and unmounted-chunk
tests fail with their fix removed. Three existing assertions updated for the
new `id` on `<hN>`. Full suite: 294 `node --test` + 70 vitest, lint and
boundary checks pass. Not yet exercised in a real browser/webview.

## onUnresolvedLinkClick hook (mdzip-vscode#13)

Asked "are there other Studio/VS Code issues that actually need an editor
fix?" while closing out #22/#23 in Studio. Checked every open issue in both
repos against the actual code rather than titles alone; the one real hit was
mdzip-vscode#13 ("preview links to workspace files/folders should
open/reveal like VS Code's built-in preview"). Its own implementation notes
assumed a host-facing hook already existed for links that don't resolve
inside the archive — it didn't: the preview's click handler
(`elPreviewPane`'s `click` listener in `view.ts`) only ever acted on
archive-internal Markdown links (`resolveMdzipArchiveLinkTarget`); anything
else silently fell through to the browser's own (usually broken, inside a
webview) default navigation, with no way for a host to intercept it.

Added `MdzipWorkspaceViewOptions.onUnresolvedLinkClick(href, snapshot)`:
fires (and suppresses default navigation) for a link that's workspace-
relative-shaped but didn't resolve to an archive-internal Markdown doc —
skipped entirely for plain external URLs/`mailto:`/bare `#fragment`s via
the new exported `isMdzipWorkspaceRelativeLink(href)` predicate (refactored
out of `resolveMdzipArchiveLinkTarget`, which now uses it too — pure
extraction, no behavior change there). Unset by default, so existing hosts
(Studio, the standalone demo) see no change; `mdzip-vscode` is the intended
first consumer, wiring it to a postMessage that resolves against the
document's on-disk location and either opens the target file or reveals a
folder in Explorer, per that issue's spec.

Verified: new tests cover the predicate directly, plus a DOM-level mount
confirming the hook fires with the raw href and current snapshot for an
unresolved workspace-relative link (and that default navigation is
suppressed), does *not* fire for an external URL, and — with no handler
registered — behaves exactly as before (unprevented, no-op). Full suite:
281 `node --test` + 70 vitest, boundary checks pass.

## Shift+Right-Click spell-check bypass (mdzip-studio#22)

While implementing the Studio side of #22 (a native Electron context-menu
handler for spelling suggestions), found that `@mdzip/editor`'s own editor
contextmenu handler unconditionally called `preventDefault()` — no
`shiftKey` check existed anywhere, despite the menu's own disabled
"Spelling Suggestions" item having pointed at "Shift+Right-Click" since the
feature was first built (a 1.3.13-era commit). That hint was aspirational:
the bypass it promised was never actually wired up, so the host's native
context menu — the only place spell-check suggestions can come from — was
always suppressed. Fixed with a one-line early return in the `contextmenu`
listener when `event.shiftKey` is set.

Verified: new regression test asserts a shift+right-click event is left
un-prevented and the formatting menu stays closed; confirmed it fails
without the fix (reverted locally) and passes with it. Full suite: 277
`node --test` + 70 vitest across all four packages, boundary checks pass.

Not yet published — `@mdzip/editor` consumers (mdzip-studio, mdzip-vscode,
mdzip.org) won't see this until a new version ships.

Four pieces of work below this release, all verified (including live
confirmation in Studio for the chunking/mermaid fixes):

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
