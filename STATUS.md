Status: ready-to-commit
Last: Implemented click-to-edit for existing images (closes #39)

Clicking an existing image reference (Markdown `![]()` or raw HTML `<img>`,
incl. `<p align>`-wrapped) in the source editor now shows a small edit
affordance; clicking it invokes a new opt-in `imageEditHandler` hook with
the image's current alt/width/height/position, and rewrites that exact
reference in place with the returned decision (reuses `imageInsertHandler`'s
decision shape, per the issue). Fully opt-in like the issue's acceptance
criteria specify — no handler set means no affordance ever appears, no
built-in fallback dialog (scope decision, confirmed with the human).

New `packages/editor/src/image-edit.ts`: offset-aware parser using the
Lezer markdown syntax tree (`Image`/`URL`/`LinkMark` nodes for Markdown,
`HTMLBlock`/`HTMLTag` + a small attribute regex for raw HTML) plus
`formatImageEditMarkdown`. `view.ts` adds a click-triggered
`Decoration.widget` affordance, `MdzipImageEditRequest`/`MdzipImageEditHandler`
types, `setImageEditOptions()`, and `openImageEditFlow()` (with a
revalidate-before-apply guard against the doc changing while the handler's
promise is pending). Wired through `editor-ng`/`editor-react`/`editor-vue`
identically to `imageInsertHandler`. `mdzip.org`'s editor-demo got a real
interactive host dialog (`editor-demo/app/src/image-edit-dialog.ts`) behind
a new "Image edit (host dialog)" Settings toggle, so the feature is
click-through-able in a browser, not just unit tested.

Verified: full test suite (195 + 29 editor tests, plus editor-ng/-react/-vue
suites) and lint/typecheck all pass; also drove the actual demo end-to-end
with Playwright (dev server + headless Chromium) — affordance appears only
when the handler is set, dialog pre-fills correctly, both Markdown and
HTML+size+position rewrites land correctly, no console errors. READMEs
updated (editor, editor-ng, editor-react, editor-vue). Not yet committed.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
