# Editor test bench

A document that exercises the editor's preview features, one section each.
The bench page has buttons for the ones only reachable through the API.

## Toolbar

- **Color scheme** (monitor, sun or moon icon): Light, Dark or System. System
  follows the operating system's setting live. Switching keeps the preview in
  place: nothing moves, and the diagrams below are redrawn in the new colors.
  Tick **System follows a host theme** on the bench: System becomes "Host
  theme" with a palette icon and follows the dark/light list beside it, as
  it follows the VS Code theme in the extension.
- **Page width** (page icon, between zoom and color scheme): Narrow, Default,
  Wide or Full Width, labeled with the pixel width each gives at the current
  zoom. Hidden in edit layout.

## Task lists

- [x] Completed task (checked, greyed: the preview is read-only)
- [ ] Open task
- [ ] Parent task
  - [x] Completed subtask
  - [ ] Open subtask
- A plain bullet in the same list (keeps its bullet)

## Horizontal rules

Three styles below should show as three separate thin lines:

***

---

___

## Footnotes

Here is a statement with a footnote.[^1] And another one.[^note] The first again.[^1]

This reference has no definition, so it stays as text: [^missing].

Click a superscript number to jump down, then the ↩ to come back.

[^1]: The first footnote.
[^note]: A named footnote with **formatting** and a [link](https://mdzip.org).

## Copying

Right-click the preview. With text selected, **Copy** offers Plain Text,
Formatted Text and HTML; **Copy All** offers the same for the whole document,
plus Markdown. Each item has a hover tip. **Select All** (Ctrl+A) selects the
rendered document; Ctrl+C then copies all of it as Formatted Text. Ctrl+C on any
other selection copies just that, as Formatted Text.

Paste into Notepad and Word to compare. Formatted Text embeds the image below,
so it shows in Word; HTML keeps its path, `images/sample.png`. Neither has a
`blob:` URL, and plain text never includes a diagram's stylesheet.

![Sample image](images/sample.png)

```js
// Code block: its header (language, Copy button) is never copied.
const answer = 42;
```

## Diagrams

On Mermaid 12, ER diagrams and flowcharts use the ELK layout: right-angle lines.

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "ordered in"
  CUSTOMER }|..|{ DELIVERY_ADDRESS : uses
```

This one declares `layout: dagre` itself, so it keeps curved lines:

```mermaid
---
config:
  layout: dagre
---
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "ordered in"
```

```mermaid
flowchart LR
  A[Start] --> B{Choice}
  B -->|yes| C[Done]
  B -->|no| A
```

## Links in SVG diagrams

An SVG with links is shown inline, so its links can be clicked (an SVG image is
a flat picture). Click each box: **Chapter** opens `docs/chapter.md`, **Deep
section** opens it at that heading, **#toolbar** scrolls to the Toolbar section,
and **mdzip.org** opens the website in a new tab. Each click is in the log. The
diagram should sit on the right with this text beside it, like any
`align="right"` image.

<img src="images/links.svg" alt="Test diagram: chapter, deep section, toolbar and mdzip.org links" width="420" align="right">

For the full set (draw.io's real Project diagram, an SVG without links and a
hostile SVG that must never show an alert), choose
`TestFiles/svg-links-test.mdz` with **Choose File**.

## Deep link into another file

[Chapter, deep section](docs/chapter.md#deep-section) opens the chapter and
lands on its "Deep section" heading. The bench's **openPath** button does the
same through the API.
