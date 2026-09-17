Status: ready-to-commit
Last: Fixed a real race in reconciliation — an edit landing mid-mount could duplicate/orphan preview DOM

Kyle spotted this from a screenshot: after a minor edit, the preview pane
showed unrelated later-document content stacked at the top instead of the
front matter/heading he was editing near. Correctly read as a genuine
reconciliation bug, not a scroll artifact.

Root cause: `chunkedRenderState.cursor` is only updated *after* an edit's
batch mount (cold start's initial batch, or a reconciliation's replacement
middle range) fully completes — but `updatePreview`'s `reconcileEligible`
check only required the state to exist and match the current generation, not
that any of its own async mounting had actually finished. If a second edit
(or the tail end of the initial cold-start mount) landed while a batch mount
for the *same* generation was still in flight — a real possibility once
`renderChunk` genuinely crosses a macrotask boundary (an async extension, or
`mountAllChunksEagerly`'s `requestAnimationFrame` yields between batches,
matching ordinary typing speed against non-trivial documents) — the new
reconciliation would diff against a `cursor`/`records` snapshot that didn't
yet reflect the in-flight mount's real progress. The in-flight mount's own
generation guard stops it from appending *more* once superseded, but never
retroactively removes what it had already appended in earlier loop
iterations of the same call — those nodes were simply orphaned, duplicated
alongside whatever the newer operation mounted in their place.

Fix: `chunkedRenderState` gains a `mounting: boolean` field, true for the
whole duration of any edit-triggered batch mount (cold-start's initial
batch/eager mount, a reconciliation's middle-mount, a sentinel-triggered
lazy continuation, and Copy All's force-drain), false once it settles.
`reconcileEligible` now also requires `!mounting`. When that fails, the
existing "not eligible" path already does a full reset — `replaceChildren()`
unconditionally wipes any orphaned nodes the stale in-flight mount left
behind, so falling back is always correct, just loses the reconciliation
optimization for that one edit (rare in practice — requires typing during a
render that's still crossing an macrotask boundary).

Verified: added two tests to `preview-chunking.test.mjs` using a
`transformHtml` extension with a real `setTimeout`-based delay (so the mount
genuinely spans a macrotask, the same condition needed for a real keystroke
to land mid-mount) — one edit landing during the initial cold-start mount,
one landing during a prior edit's own reconciliation. Confirmed both
actually catch the bug: temporarily reverted the `mounting` guard and
re-ran — both failed with duplicated/missing paragraphs, exactly the
reported symptom; restored the fix and both pass. Full suite: 267 `node
--test` + 49 vitest, all green; `npm run verify` clean across every wrapper
package. Redeployed to mdzip.org's `demo/`/`dist/` (IIS) via the same manual
pipeline as the two prior fixes.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
