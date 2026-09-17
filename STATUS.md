Status: ready-to-commit
Last: Renamed the front matter option expandable to collapsible (feedback)

Front matter parsing + configurable rendering is implemented across
`@mdzip/editor` core and the `editor-react`/`editor-vue`/`editor-ng`
wrappers (see prior entries in this file's history / CHANGELOG.md's
Unreleased section): `enabled` / `display` (table|raw) / `collapsible` /
`label` (custom string or the `'first-line'` sentinel).

Kyle's feedback on the naming: "expandable doesn't make sense, the option is
really if it is collapsable or not." Renamed `expandable` -> `collapsible`
(same boolean semantics — `true` default wraps the panel in `<details>`,
`false` renders a static block; no value inversion, just the name). It's a
real accuracy fix, not just cosmetic: the panel starts *open*, so "can this
be collapsed" describes the actual affordance better than "can this be
expanded" (which implies starting closed).

Renamed everywhere the field name appears as an identifier or in prose:
`packages/editor/src/front-matter-extension.ts` (the option itself + the
`renderPanel` check), its test file, all three wrapper README prop tables
and test files (`expandable: false` -> `collapsible: false` in the
passthrough-test object literals), and the root CHANGELOG.md entry. The
wrapper packages' own source needed no changes — `frontMatter` passes
through them as an opaque `MdzipFrontMatterOptions`, so the field name never
appears as an identifier there. Also renamed throughout
`mdzip.org/editor-demo/app` (checkbox id `frontmatter-expandable-toggle` ->
`frontmatter-collapsible-toggle`, its label "FM expandable" -> "FM
collapsible", `DemoFrontMatterChoice.expandable` -> `.collapsible`, and the
matching state var/listener/status-line text in `main.ts`).

Verified: full editor suite (`node --test` incl. all 15 front-matter cases)
and vitest pass; editor-react/-vue/-ng each pass their existing suite plus
the renamed `frontMatter` passthrough test; `vite build --base ./` for
editor-demo/app succeeds (same three pre-existing, unrelated `tsc --noEmit`
artifacts as before — Uint8Array generics, a duplicate-Vue-copy prop-type
blowup from linking, vite.config.ts's `node:url` types — none block the
actual esbuild-based build). Confirmed via Playwright against both the dev
server and the IIS site: the new `#frontmatter-collapsible-toggle` id is
present and working (toggling it switches the default-loaded
developer-guide.mdz's front matter panel between `<details>` and the static
`<div>` variant), the old `#frontmatter-expandable-toggle` id is gone. Not
yet committed — layered on top of the already-uncommitted front matter work
from earlier in this session.

<!-- Dashboard reads these two lines.
     Status: idle | in-progress | awaiting-test | ready-to-commit | blocked
     Last:   one-line description of the most recent action.
     Agents update these as they work — see ../.github/AGENTS.md. -->
