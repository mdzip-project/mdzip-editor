# MDZip Editor Theming

MDZip Editor uses CSS custom properties for its UI colors. The same theming
approach applies to the JavaScript API and the Angular, React, and Vue wrappers
because every integration renders the same `.mdzip-root` workspace.

## Color Schemes

The editor has built-in `light` and `dark` color schemes:

```ts
const view = new MdzipWorkspaceView(container, {
  initialColorScheme: 'dark',
  onColorSchemeChanged(colorScheme) {
    console.log(colorScheme);
  }
});
```

The framework wrappers expose the same options:

- Angular: `[initialColorScheme]` and `(colorSchemeChanged)`
- React: `initialColorScheme` and `onColorSchemeChanged`
- Vue: `initialColorScheme` and the `colorSchemeChanged` event

Set `controls.colorScheme` to `false` when the host application owns color
scheme selection:

```ts
const view = new MdzipWorkspaceView(container, {
  initialColorScheme: 'dark',
  controls: {
    preset: 'standalone-editor',
    colorScheme: false
  }
});
```

When no initial scheme is supplied, the editor reads
`prefers-color-scheme: dark` when the view is created.

## Create A Custom Theme

Place a class on the host that contains the editor, then assign `--theme-*`
tokens to that host:

```html
<div id="editor" class="mdzip-theme-ocean"></div>
```

```css
.mdzip-theme-ocean {
  --theme-editor-background-color: #071a2b;
  --theme-editor-foreground-color: #d9f1ff;
  --theme-editor-cursor-color: #69d2ff;
  --theme-toolbar-background-color: #0b2438;
  --theme-sidebar-background-color: #0a2032;
  --theme-sidebar-foreground-color: #c6e8f7;
  --theme-border-color: #24465d;
  --theme-widget-background-color: #102d43;
  --theme-widget-border-color: #31566e;
  --theme-accent-color: #26a8e0;
  --theme-accent-foreground-color: #00131f;
  --theme-control-foreground-color: #d9f1ff;
  --theme-control-hover-background-color: #173b52;
  --theme-link-color: #69d2ff;
  --theme-hover-background-color: rgb(105 210 255 / 10%);
  --theme-selection-background-color: rgb(38 168 224 / 24%);
  --theme-focus-outline-color: #69d2ff;
  --theme-tree-guide-color: #41667d;
  --theme-muted-foreground-color: #8bb5c9;
  --theme-code-background-color: #0d283d;
  --theme-line-number-foreground-color: #6f9caf;
}
```

Theme variables can be set on `:root`, directly on the editor container, or on
any ancestor. The editor maps them to its internal `--mdzip-*` variables. A
consumer `--theme-*` value takes precedence over the active built-in light or
dark default.

You do not need to assign every token. Unspecified tokens continue to use the
active built-in scheme.

## Theme Both Built-In Schemes

The theme buttons change the editor between its light and dark built-in
fallbacks. Consumer theme tokens continue to take precedence in either mode:

```css
.brand-editor {
  --theme-accent-color: #7c3aed;
  --theme-focus-outline-color: #a78bfa;
  --theme-link-color: #8b5cf6;
}
```

When a host wants different custom values for each scheme, apply a host class
alongside the selected application theme:

```css
.brand-editor.app-theme-light {
  --theme-accent-color: #6d28d9;
  --theme-selection-background-color: rgb(109 40 217 / 14%);
}

.brand-editor.app-theme-dark {
  --theme-accent-color: #a78bfa;
  --theme-selection-background-color: rgb(167 139 250 / 24%);
}
```

## Theme-Level And Direct Tokens

Each color has two token names:

- `--theme-*` is the public consumer token. Use this for application and
  product themes.
- `--mdzip-*` is the resolved component token consumed internally by workspace
  styles.

The resolution order is:

1. Consumer `--theme-*` value inherited from the host page.
2. Active built-in light or dark value.
3. Hardcoded light fallback.

Consumers normally do not need to define `--mdzip-*` variables. A direct
`--mdzip-*` declaration remains available for a narrowly scoped component
override, but it must target `.mdzip-root` because the editor defines its
resolved mapping there.

## CSS Variable Reference

All color values accept any valid CSS color. The light and dark columns show
the values supplied by the built-in schemes.

| Theme token | Direct token | Light | Dark | Used for |
| --- | --- | --- | --- | --- |
| `--theme-editor-background-color` | `--mdzip-editor-background-color` | `#ffffff` | `#1e1e1e` | Main editor, preview, dialogs, and menu surfaces |
| `--theme-editor-foreground-color` | `--mdzip-editor-foreground-color` | `#1f2328` | `#d4d4d4` | Primary text and icons |
| `--theme-editor-cursor-color` | `--mdzip-editor-cursor-color` | Editor foreground | Editor foreground | Source editor caret |
| `--theme-toolbar-background-color` | `--mdzip-toolbar-background-color` | `#ffffff` | `#252526` | Command toolbar |
| `--theme-toolbar-icon-fill-color` | `--mdzip-toolbar-icon-fill-color` | `#ffffff` | `#ffffff` | Reserved toolbar icon fill token |
| `--theme-sidebar-background-color` | `--mdzip-sidebar-background-color` | `#f7f7f9` | `#252526` | Package navigation background |
| `--theme-sidebar-foreground-color` | `--mdzip-sidebar-foreground-color` | `#202124` | `#cccccc` | Package navigation text |
| `--theme-border-color` | `--mdzip-border-color` | `#e5e7eb` | `#3c3c3c` | General separators and borders |
| `--theme-widget-background-color` | `--mdzip-widget-background-color` | `#f6f8fa` | `#2d2d2d` | Buttons, gutters, cards, and popovers |
| `--theme-widget-border-color` | `--mdzip-widget-border-color` | `#d8dee4` | `#454545` | Control and popover borders |
| `--theme-accent-color` | `--mdzip-accent-color` | `#0969da` | `#0078d4` | Selected controls and primary actions |
| `--theme-accent-foreground-color` | `--mdzip-accent-foreground-color` | `#ffffff` | `#ffffff` | Text and icons on the accent color |
| `--theme-control-foreground-color` | `--mdzip-control-foreground-color` | `#24292f` | `#cccccc` | Toolbar and control icons |
| `--theme-control-hover-background-color` | `--mdzip-control-hover-background-color` | `#eaeef2` | `#3a3a3a` | Hovered controls |
| `--theme-link-color` | `--mdzip-link-color` | `#0969da` | `#4fc1ff` | Links and link-like active icons |
| `--theme-hover-background-color` | `--mdzip-hover-background-color` | `rgba(175, 184, 193, 0.18)` | `rgba(255, 255, 255, 0.08)` | Navigation hover and focused editor selection |
| `--theme-selection-background-color` | `--mdzip-selection-background-color` | `rgba(9, 105, 218, 0.12)` | `rgba(0, 120, 212, 0.20)` | Selected navigation entries and text selection |
| `--theme-focus-outline-color` | `--mdzip-focus-outline-color` | `#0969da` | `#0078d4` | Keyboard focus outlines and resize indicators |
| `--theme-tree-guide-color` | `--mdzip-tree-guide-color` | `#a8b0ba` | `#6f747a` | Package tree connector guides |
| `--theme-muted-foreground-color` | `--mdzip-muted-foreground-color` | `#57606a` | `#8c8c8c` | Secondary text, metadata, and empty states |
| `--theme-code-background-color` | `--mdzip-code-background-color` | `#f6f8fa` | `#2d2d2d` | Inline code, code blocks, and blockquotes |
| `--theme-line-number-foreground-color` | `--mdzip-line-number-foreground-color` | `#8c959f` | `#6f7378` | Source editor line numbers |

`--mdzip-toolbar-icon-fill-color` is part of the exported token set but is not
currently consumed by the built-in Lucide icons, which use `currentColor`.

## Exported Theme Constants

The package exports the CSS declaration strings used internally:

```ts
import {
  MDZIP_VARIABLES_CSS,
  MDZIP_LIGHT_THEME_CSS,
  MDZIP_DARK_THEME_CSS
} from 'mdzip-editor';
```

- `MDZIP_VARIABLES_CSS` maps every `--mdzip-*` token to its `--theme-*`
  counterpart and fallback.
- `MDZIP_LIGHT_THEME_CSS` contains the built-in light `--theme-*` values.
- `MDZIP_DARK_THEME_CSS` contains the built-in dark `--theme-*` values.

These exports are declaration blocks without a selector. A host can place one
inside its own generated CSS rule:

```ts
const style = document.createElement('style');
style.textContent = `
  .embedded-editor {
    ${MDZIP_DARK_THEME_CSS}
    --theme-accent-color: #a78bfa;
  }
`;
document.head.append(style);
```

## Scope Multiple Editors

Themes can be scoped independently when a page contains more than one editor:

```css
#review-editor {
  --theme-accent-color: #d97706;
}

#authoring-editor {
  --theme-accent-color: #059669;
}
```

Changing a CSS variable updates the rendered editor immediately. Recreating the
workspace view is not required.

## Accessibility

Custom themes should preserve:

- readable contrast between editor foreground and background;
- visible focus outlines against widgets and editor surfaces;
- distinguishable hover, selection, and accent states;
- readable accent foreground text on the accent color;
- visible borders between the toolbar, navigation, editor, and preview.

Test both read-only and editable modes because each exposes a different set of
controls and states.
