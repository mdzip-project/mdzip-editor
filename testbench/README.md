# Editor test bench

A local page running the editor as built from this repo, for trying changes by
hand before a release. It opens a sample document (`sample/`) that exercises
the preview's features, and has buttons for the ones only reachable through
the API. Nothing here is published.

## Run it

From the repo root:

```powershell
npm run testbench
```

This builds `@mdzip/editor`, bundles the page and packs `sample/` into
`dist/sample.mdz`, then serves the page. Open `http://localhost:8790/`
(`$env:PORT=8791; npm run testbench` for another port). Leave it running and,
after changing the editor, run `npm run testbench:build` in another terminal
and refresh the page.

The server also prints this machine's LAN addresses. A page opened through one
of those is not a secure context (`crypto.subtle` is undefined), which the
editor has to handle.

**Choose File** opens any other `.mdz` or `.md`.

## What to try

| Feature | Where | Expected |
|---|---|---|
| Color scheme | Toolbar, right end | Light, Dark, System; switching keeps the preview in place and redraws the diagrams |
| Page width | Toolbar, before the color scheme | Narrow, Default, Wide (with pixel widths), Full Width; hidden in edit layout |
| Copying | Right-click the preview; Ctrl+A, Ctrl+C | See the "Copying" section of the sample; paste into Notepad and Word |
| Task lists, rules, footnotes | Sample sections | As described in each section |
| Diagrams | "Diagrams" section | ER and flowchart with right-angle lines; the `layout: dagre` one curved |
| Deep link | Link at the end of the sample, or **openPath** | Opens `docs/chapter.md` with "Deep section" at the top |
| Keep file on reload | Open `docs/chapter.md`, then **Reload, keep file** | Still on `docs/chapter.md`; **Reload, back to entry point** returns to `index.md` |
| Rename in place | **Rename in place** | Title shows the new name, same file open; a `.md` name is refused (log says `false`) |
| Plain HTTP | A LAN address | Header says "NOT a secure context"; the archive still opens and images show |

The log at the bottom shows API results and the editor's callbacks.

When a change adds something worth checking by hand, add a section to
`sample/index.md` (and a row here) in the same change.
