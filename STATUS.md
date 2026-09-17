Status: ready-to-commit
Last: Image hydration fast path — already-resolved images no longer flash on re-mount

Kyle reported the preview visibly flashing embedded images on unrelated
edits, and confirmed it by comparing versions: mdzip-studio v1.3.20 does not
have the issue, the current published 1.4.0 does.

Diffed `view.ts` between `v1.3.20` and `v1.4.0` directly to find the cause.
In v1.3.20, `mountProgressivePreview` created each image's slot and started
`resolveImage()` immediately, synchronously, no intersection check. Commit
`f5da4a5` (progressive/chunked rendering) split this into
`collectPendingImages` (still sync) + `hydrateImages`, which now creates an
`IntersectionObserver` and only calls `resolveImage()` once its callback
confirms the image is near the viewport — a real async detour v1.3.20 never
had. Every re-mount of a chunk containing an image now pays that detour
again, even for an image already fully resolved earlier in the session:
a fresh, blank `<img>` sits there for at least one intersection-callback
tick before resolution even restarts.

Fix: `MdzipAssetSession` gets a new synchronous `resolveKnownImage(path,
currentPath)` (asset-cache.ts) — mirrors `resolveImage` but reads only the
already-cached URL+size, no async work. `collectPendingImages` (view.ts)
checks it first for every archive-relative image: a cache hit applies the
URL immediately, in place, with no slot wrapper, no loading class, and no
`hydrateImages`/`IntersectionObserver` involvement at all — matching how an
external image is already handled. Only a genuinely first-time image (never
resolved this session) still goes through the async placeholder path.

Verified: 257 `node --test` cases (new `resolveKnownImage` unit test in
asset-cache.test.mjs; updated the one existing test whose assertions
described the old "still slotted, just not animated" behavior — now
correctly asserts no slot at all for a known image) + 49 vitest, all green;
lint clean. Not yet built/redeployed to mdzip.org's demo under this specific
commit boundary — see the next commit for the reconciliation work layered on
top and the combined redeploy.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
