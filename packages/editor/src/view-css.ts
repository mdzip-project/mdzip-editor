import {
  MDZIP_DARK_THEME_CSS,
  MDZIP_LIGHT_THEME_CSS,
  MDZIP_VARIABLES_CSS
} from './theme.js';

export const WORKSPACE_CSS = `
.mdzip-root {
  /* Layout variables */
  --mdz-zoom: 1;
  --nav-pane-width: 280px;
  --editor-pane-offset: 12px;
  --workspace-pane-offset: 0px;
  --split-edit-ratio: 0.5;

  /* Theme variable mappings */
  ${MDZIP_VARIABLES_CSS}

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 520px;
  background: var(--mdzip-editor-background-color);
  color: var(--mdzip-editor-foreground-color);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  overflow: hidden;
  box-sizing: border-box;
}

.mdzip-root.mdzip-theme-light {
  color-scheme: light;
  ${MDZIP_LIGHT_THEME_CSS}
}

.mdzip-root.mdzip-theme-dark {
  color-scheme: dark;
  ${MDZIP_DARK_THEME_CSS}
}

.mdzip-root *,
.mdzip-root *::before,
.mdzip-root *::after {
  box-sizing: border-box;
}

.mdzip-root [hidden] {
  display: none !important;
}

.mdzip-root .document-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 40px;
  padding: 8px 12px;
  background: var(--mdzip-toolbar-background-color);
  border-bottom: 2px solid var(--mdzip-border-color);
  flex: 0 0 auto;
}

.mdzip-root .toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  padding: 4px 12px;
  background: var(--mdzip-toolbar-background-color);
  border-bottom: 1px solid var(--mdzip-border-color);
  min-height: 48px;
  flex: 0 0 auto;
  position: relative;
  z-index: 5;
}

.mdzip-root .toolbar-left,
.mdzip-root .toolbar-controls {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.mdzip-root .toolbar-start {
  display: flex;
  align-items: center;
  justify-self: start;
  min-width: 0;
  gap: 12px;
}

.mdzip-root.navigation-pane-visible {
  --editor-pane-offset: calc(var(--nav-pane-width) + 6px);
  --workspace-pane-offset: calc(var(--nav-pane-width) + 6px);
}

.mdzip-root .toolbar-left {
  flex: 0 0 auto;
  overflow: hidden;
}

.mdzip-root .toolbar-controls {
  grid-column: 3;
  justify-self: end;
  position: relative;
}

.mdzip-root .title-button {
  flex: 1 1 auto;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  color: var(--mdzip-editor-foreground-color);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mdzip-root .title-button:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.mdzip-root .title-button:disabled {
  color: var(--mdzip-editor-foreground-color);
  text-decoration: none;
  cursor: default;
}

.mdzip-root .title-filename {
  font-weight: 400;
  opacity: 0.6;
}

.mdzip-root .document-info-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--mdzip-muted-foreground-color);
  cursor: pointer;
}

.mdzip-root .document-info-button:hover,
.mdzip-root .document-info-button:focus-visible {
  outline: none;
  background: var(--mdzip-control-hover-background-color);
  color: var(--mdzip-control-foreground-color);
}

.mdzip-root .document-info-icon {
  width: 15px;
  height: 15px;
}

.mdzip-root .toolbar-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-self: center;
  padding: 3px;
  border: 1px solid var(--mdzip-widget-border-color);
  border-radius: 8px;
  background: var(--mdzip-widget-background-color);
}

.mdzip-root .view-mode-toggle-group {
  position: absolute;
  left: calc((100% + var(--workspace-pane-offset)) / 2);
  top: 50%;
  transform: translate(-50%, -50%);
  gap: 2px;
}

.mdzip-root .icon-toggle {
  width: 42px;
  height: 36px;
  padding: 0;
  cursor: pointer;
  background: transparent;
  color: var(--mdzip-control-foreground-color);
  border: none;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mdzip-root .icon-toggle.active {
  background: var(--mdzip-accent-color);
  color: var(--mdzip-accent-foreground-color);
}

.mdzip-root .icon-toggle:hover:not(.active):not(:disabled) {
  background: var(--mdzip-control-hover-background-color);
}

.mdzip-root .icon-toggle:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mdzip-root .toggle-icon {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
}

.mdzip-root .view-mode-toggle {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--mdzip-control-foreground-color);
}

.mdzip-root .view-mode-toggle.active {
  background: var(--mdzip-control-hover-background-color);
  color: var(--mdzip-link-color);
}

.mdzip-root .view-mode-toggle:hover:not(.active):not(:disabled) {
  background: var(--mdzip-control-hover-background-color);
}

.mdzip-root .view-mode-toggle.active:hover:not(:disabled) {
  background: var(--mdzip-control-hover-background-color);
}

.mdzip-root .view-mode-toggle .commandbar-flex-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.mdzip-root .view-mode-toggle .toggle-icon {
  width: 1.5em;
  height: 1.5em;
}

.mdzip-root .nav-toggle {
  width: 32px;
  height: 32px;
  border-radius: 6px;
}

.mdzip-root .nav-toggle.active {
  background: var(--mdzip-control-hover-background-color);
  color: var(--mdzip-link-color);
}

.mdzip-root .nav-toggle .toggle-icon {
  width: 1.9em;
  height: 1.9em;
}

.mdzip-root .zoom-toggle .toggle-icon {
  width: 1.5em;
  height: 1.5em;
}

.mdzip-root .zoom-toggle.active {
  background: var(--mdzip-control-hover-background-color);
  color: var(--mdzip-link-color);
}

.mdzip-root .theme-toggle-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--mdzip-widget-border-color);
  border-radius: 8px;
  background: var(--mdzip-widget-background-color);
}

.mdzip-root .theme-toggle {
  width: 32px;
  height: 32px;
  border-radius: 6px;
}

.mdzip-root .theme-toggle.active {
  background: var(--mdzip-control-hover-background-color);
  color: var(--mdzip-link-color);
}

.mdzip-root .theme-toggle .toggle-icon {
  width: 18px;
  height: 18px;
}

.mdzip-root .workspace-shell {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.mdzip-root.resizing,
.mdzip-root.resizing * {
  cursor: col-resize !important;
  user-select: none;
}

.mdzip-root .nav-pane {
  flex: 0 0 var(--nav-pane-width);
  width: var(--nav-pane-width);
  min-width: 180px;
  max-width: 60vw;
  border-right: 1px solid var(--mdzip-border-color);
  background: var(--mdzip-sidebar-background-color);
  color: var(--mdzip-sidebar-foreground-color);
  overflow: auto;
  transition:
    flex-basis 0.18s ease,
    width 0.18s ease,
    min-width 0.18s ease,
    opacity 0.14s ease,
    border-color 0.18s ease;
}

.mdzip-root .nav-pane.hidden {
  flex-basis: 0;
  width: 0;
  min-width: 0;
  border-right-color: transparent;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.mdzip-root .nav-resizer {
  position: relative;
  flex: 0 0 6px;
  background: transparent;
  cursor: col-resize;
  opacity: 1;
  transition:
    flex-basis 0.18s ease,
    opacity 0.14s ease;
}

.mdzip-root .nav-resizer.hidden {
  flex-basis: 0;
  opacity: 0;
  pointer-events: none;
}

.mdzip-root .nav-resizer::before,
.mdzip-root .split-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: transparent;
  transition: background 0.12s ease;
}

.mdzip-root .nav-resizer:hover::before,
.mdzip-root .split-resizer:hover::before {
  background: var(--mdzip-focus-outline-color);
}

.mdzip-root .nav-tree {
  padding: 14px 8px 24px;
}

.mdzip-root .nav-directory {
  margin: 0;
  position: relative;
}

.mdzip-root .nav-directory > summary {
  list-style: none;
  cursor: pointer;
  position: relative;
}

.mdzip-root .nav-directory > summary::-webkit-details-marker {
  display: none;
}

.mdzip-root .nav-directory > summary,
.mdzip-root .nav-file {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 5px 9px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
}

.mdzip-root .nav-file {
  cursor: pointer;
}

.mdzip-root .nav-directory > summary:hover,
.mdzip-root .nav-file:hover {
  background: var(--mdzip-hover-background-color);
}

.mdzip-root .nav-directory-children {
  position: relative;
  margin-left: 19px;
  padding-left: 14px;
}

.mdzip-root .nav-directory-children > .nav-file,
.mdzip-root .nav-directory-children > .nav-directory > summary {
  position: relative;
}

.mdzip-root .nav-directory-children > .nav-file::before,
.mdzip-root .nav-directory-children > .nav-directory > summary::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 22px;
  background: var(--mdzip-tree-guide-color);
  -webkit-mask: url("data:image/svg+xml,%3Csvg viewBox='0 0 22 34' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0.5 0 V17.5 H22' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E") left top / 22px 100% no-repeat;
  mask: url("data:image/svg+xml,%3Csvg viewBox='0 0 22 34' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0.5 0 V17.5 H22' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E") left top / 22px 100% no-repeat;
}

.mdzip-root .nav-directory-children > .nav-file:not(:last-child)::before,
.mdzip-root .nav-directory-children > .nav-directory:not(:last-child) > summary::before {
  -webkit-mask: url("data:image/svg+xml,%3Csvg viewBox='0 0 22 34' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0.5 0 V34 M0.5 17.5 H22' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E") left top / 22px 100% no-repeat;
  mask: url("data:image/svg+xml,%3Csvg viewBox='0 0 22 34' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0.5 0 V34 M0.5 17.5 H22' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E") left top / 22px 100% no-repeat;
}

.mdzip-root .nav-caret {
  position: relative;
  width: 10px;
  flex: 0 0 10px;
  color: var(--mdzip-muted-foreground-color);
}

.mdzip-root .nav-directory > summary .nav-caret::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 50%;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  transform: translateY(-50%);
}

.mdzip-root .nav-directory[open] > summary .nav-caret::before {
  transform: translateY(-45%) rotate(90deg);
}

.mdzip-root .nav-folder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  color: var(--mdzip-control-foreground-color);
}

.mdzip-root .nav-folder-icon svg {
  display: block;
  width: 21px;
  height: 21px;
}

.mdzip-root .nav-directory[open] > summary .nav-folder-icon.closed,
.mdzip-root .nav-directory:not([open]) > summary .nav-folder-icon.open {
  display: none;
}

.mdzip-root .nav-file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 30px;
  width: 30px;
  height: 24px;
  border: 1px solid var(--mdzip-border-color);
  border-radius: 3px;
  background: var(--mdzip-widget-background-color);
  color: var(--mdzip-muted-foreground-color);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.mdzip-root .nav-file-icon svg {
  display: block;
}

.mdzip-root .nav-file-icon.markdown svg {
  width: 21px;
  height: 21px;
}

.mdzip-root .nav-file-icon.manifest svg {
  width: 21px;
  height: 21px;
}

.mdzip-root .nav-file-icon.markdown {
  border: 0;
  background: transparent;
}

.mdzip-root .nav-file-icon.manifest {
  border: 0;
  background: transparent;
  color: #d18616;
}

.mdzip-root .nav-file-icon.image {
  border: 0 !important;
  background: transparent !important;
}

.mdzip-root .nav-file-icon.image svg {
  width: 21px;
  height: 21px;
}

.mdzip-root .nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mdzip-root .nav-file.current-entry {
  background: var(--mdzip-selection-background-color);
}

.mdzip-root .nav-file.current-entry::after {
  content: '';
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  border-radius: 50%;
  background: var(--mdzip-link-color);
}

.mdzip-root .nav-file.orphaned-asset {
  color: var(--mdzip-muted-foreground-color);
}

.mdzip-root .nav-orphan-button {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #9a6700;
  cursor: pointer;
}

.mdzip-root .nav-orphan-button:hover {
  background: rgba(154, 103, 0, 0.12);
}

.mdzip-root .nav-orphan-button svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}

.mdzip-root .orphan-context-menu {
  position: fixed;
  z-index: 200;
  min-width: 190px;
  padding: 4px;
  border: 1px solid var(--mdzip-widget-border-color);
  border-radius: 4px;
  background: var(--mdzip-editor-background-color);
  color: var(--mdzip-editor-foreground-color);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.mdzip-root .orphan-context-menu button {
  display: block;
  width: 100%;
  min-height: 28px;
  padding: 4px 10px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mdzip-root .orphan-context-menu button:hover,
.mdzip-root .orphan-context-menu button:focus-visible {
  outline: none;
  background: var(--mdzip-hover-background-color);
}

.mdzip-root .mdzip-tooltip {
  position: fixed;
  z-index: 10000;
  max-width: min(320px, calc(100vw - 16px));
  padding: 5px 8px;
  border: 1px solid var(--mdzip-border-color);
  border-radius: 5px;
  background: var(--mdzip-editor-foreground-color);
  color: var(--mdzip-editor-background-color);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  pointer-events: none;
}

.mdzip-root .pane-stack {
  display: block;
  flex: 1;
  min-width: 0;
  height: 100%;
}

.mdzip-root .pane-stack.split-mode {
  display: flex;
  flex-direction: row;
}

.mdzip-root .pane {
  display: none;
  height: 100%;
  overflow: hidden;
}

.mdzip-root .pane.active {
  display: block;
}

.mdzip-root .pane-stack.split-mode .pane {
  display: block !important;
  min-width: 0;
  height: 100%;
}

.mdzip-root .pane-stack.split-mode .edit-pane {
  flex: 0 0 calc((100% - 6px) * var(--split-edit-ratio));
}

.mdzip-root .pane-stack.split-mode .preview-pane {
  flex: 1 1 auto;
}

.mdzip-root .preview-pane {
  overflow: auto;
}

.mdzip-root .edit-pane {
  overflow: hidden;
  flex-direction: column;
}

.mdzip-root .edit-pane.active {
  display: flex;
}

.mdzip-root .pane-stack.split-mode .edit-pane {
  display: flex !important;
}

.mdzip-root .edit-toolbar {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0;
  overflow: visible;
  border: 0;
  background: transparent;
  flex: 0 0 auto;
  position: absolute;
  left: var(--editor-pane-offset);
  top: 50%;
  transform: translateY(-50%);
  z-index: 6;
}

.mdzip-root:not(.navigation-pane-visible) .edit-toolbar {
  position: static;
  transform: none;
}

.mdzip-root .edit-toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.mdzip-root .edit-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--mdzip-control-foreground-color);
  cursor: pointer;
}

.mdzip-root .edit-toolbar button:hover,
.mdzip-root .edit-toolbar button:focus-visible {
  outline: none;
  background: var(--mdzip-control-hover-background-color);
}

.mdzip-root .edit-toolbar button:focus-visible {
  box-shadow: inset 0 0 0 1px var(--mdzip-focus-outline-color);
}

.mdzip-root .edit-toolbar .format-menu {
  position: relative;
  flex: 0 0 auto;
}

.mdzip-root .edit-toolbar .format-menu-toggle {
  width: 42px;
  gap: 2px;
}

.mdzip-root .edit-toolbar .format-menu-toggle[aria-expanded="true"] {
  background: var(--mdzip-control-hover-background-color);
  box-shadow: inset 0 0 0 1px var(--mdzip-focus-outline-color);
}

.mdzip-root .edit-toolbar .format-menu-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  min-width: 164px;
  padding: 5px;
  border: 1px solid var(--mdzip-widget-border-color);
  border-radius: 7px;
  background: var(--mdzip-widget-background-color);
  color: var(--mdzip-editor-foreground-color);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
}

.mdzip-root .edit-toolbar .format-menu-popover button {
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  white-space: nowrap;
}

.mdzip-root .edit-toolbar .format-menu-popover button:hover,
.mdzip-root .edit-toolbar .format-menu-popover button:focus-visible {
  background: var(--mdzip-control-hover-background-color);
  box-shadow: none;
}

.mdzip-root .edit-toolbar .format-menu-popover strong {
  display: inline-block;
  width: 22px;
  color: var(--mdzip-muted-foreground-color);
  font-size: 11px;
  text-align: center;
}

.mdzip-root .format-icon {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
}

.mdzip-root .format-chevron {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
}

.mdzip-root .edit-toolbar-divider {
  width: 1px;
  height: 22px;
  background: var(--mdzip-border-color);
  flex: 0 0 auto;
}

.mdzip-root .editor-host {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.mdzip-root .editor-host .cm-editor {
  height: 100%;
}

.mdzip-root .split-resizer {
  display: none;
  position: relative;
  flex: 0 0 6px;
  cursor: col-resize;
}

.mdzip-root .pane-stack.split-mode .split-resizer {
  display: block;
}

.mdzip-root .pane-stack.split-mode .split-resizer::before {
  background: var(--mdzip-border-color);
}

.mdzip-root .pane-stack.split-mode .split-resizer:hover::before {
  background: var(--mdzip-focus-outline-color);
}

.mdzip-root .preview-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 36px 32px 48px;
  line-height: 1.55;
  font-size: calc(16px * var(--mdz-zoom));
}

.mdzip-root .preview-content h1,
.mdzip-root .preview-content h2,
.mdzip-root .preview-content h3,
.mdzip-root .preview-content h4,
.mdzip-root .preview-content h5,
.mdzip-root .preview-content h6 {
  color: var(--mdzip-editor-foreground-color);
  margin-top: 1.4em;
  margin-bottom: 0.4em;
  line-height: 1.25;
}

.mdzip-root .preview-content h1 {
  font-size: 2em;
  border-bottom: 1px solid var(--mdzip-border-color);
  padding-bottom: 0.25em;
}

.mdzip-root .preview-content > :first-child {
  margin-top: 0;
}

.mdzip-root .preview-content h2 {
  font-size: 1.5em;
  border-bottom: 1px solid var(--mdzip-border-color);
  padding-bottom: 0.2em;
}

.mdzip-root .preview-content h3 {
  font-size: 1.2em;
}

.mdzip-root .preview-content p {
  margin: 0.8em 0;
}

.mdzip-root .preview-content code {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.9em;
  background: var(--mdzip-code-background-color);
  border: 1px solid var(--mdzip-border-color);
  border-radius: 3px;
  padding: 1px 5px;
}

.mdzip-root .preview-content pre {
  background: var(--mdzip-code-background-color);
  border: 1px solid var(--mdzip-border-color);
  border-radius: 5px;
  padding: 14px 18px;
  overflow-x: auto;
}

.mdzip-root .preview-content pre code {
  background: none;
  border: none;
  padding: 0;
}

.mdzip-root .preview-content blockquote {
  border-left: 4px solid var(--mdzip-link-color);
  margin: 1em 0;
  padding: 0.5em 1em;
  color: var(--mdzip-muted-foreground-color);
  background: var(--mdzip-code-background-color);
}

.mdzip-root .preview-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.mdzip-root .plain-text-preview {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: calc(20px * var(--mdz-zoom));
  line-height: 1.5;
}

.mdzip-root .asset-preview-wrap {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 240px;
}

.mdzip-root .asset-preview-image {
  max-width: min(100%, 1200px);
  max-height: calc(100vh - 140px);
  width: auto;
  height: auto;
  border: 1px solid var(--mdzip-border-color);
  background: var(--mdzip-widget-background-color);
}

.mdzip-root .asset-preview-empty {
  padding: 14px 16px;
  border: 1px solid var(--mdzip-border-color);
  border-radius: 6px;
  background: var(--mdzip-widget-background-color);
  color: var(--mdzip-muted-foreground-color);
}

.mdzip-root .md-syntax-heading   { color: #c36f00; }
.mdzip-root .md-syntax-marker,
.mdzip-root .md-syntax-quote     { color: #7a5c00; font-weight: 700; }
.mdzip-root .md-syntax-code,
.mdzip-root .md-syntax-fence     { color: #8a8f00; }
.mdzip-root .md-syntax-link      { color: #0969da; }
.mdzip-root .md-syntax-image     { color: #d100d1; }
.mdzip-root .md-syntax-emphasis  { color: #008b8b; }
.mdzip-root .md-syntax-rule      { color: #6a9955; }

.mdzip-root .mdzip-empty {
  padding: 24px;
  color: var(--mdzip-muted-foreground-color);
}

.mdzip-root .zoom-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--mdzip-widget-border-color);
  border-radius: 7px;
  background: var(--mdzip-widget-background-color);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.mdzip-root .zoom-level {
  min-width: 44px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--mdzip-editor-foreground-color);
}

.mdzip-root .zoom-stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding-left: 8px;
  border-left: 1px solid var(--mdzip-widget-border-color);
}

.mdzip-root .zoom-popover button {
  height: 24px;
  min-width: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--mdzip-control-foreground-color);
  cursor: pointer;
}

.mdzip-root .zoom-popover button:hover {
  background: var(--mdzip-control-hover-background-color);
}

.mdzip-root .zoom-reset {
  padding: 0 12px;
  border-radius: 999px !important;
  background: var(--mdzip-control-hover-background-color) !important;
  font-size: 12px;
}

.mdzip-root .title-dialog-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  z-index: 100;
}

.mdzip-root .title-dialog {
  width: min(420px, calc(100vw - 32px));
  background: var(--mdzip-editor-background-color);
  border: 1px solid var(--mdzip-widget-border-color);
  border-radius: 6px;
  padding: 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
}

.mdzip-root .title-dialog h3 {
  margin: 0;
  font-size: 14px;
}

.mdzip-root .title-dialog p {
  margin: 8px 0 10px;
  font-size: 12px;
  color: var(--mdzip-muted-foreground-color);
}

.mdzip-root .title-dialog input {
  width: 100%;
  border: 1px solid var(--mdzip-widget-border-color);
  background: var(--mdzip-editor-background-color);
  color: var(--mdzip-editor-foreground-color);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 13px;
}

.mdzip-root .title-dialog-validation {
  color: #cf222e !important;
}

.mdzip-root .title-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.mdzip-root .title-dialog-actions button {
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 3px;
  border: 1px solid var(--mdzip-border-color);
  background: var(--mdzip-editor-background-color);
  color: var(--mdzip-editor-foreground-color);
}

.mdzip-root .title-dialog-actions .reset-title {
  margin-right: auto;
}

.mdzip-root .title-dialog-actions .save-title {
  border-color: var(--mdzip-accent-color);
  background: var(--mdzip-accent-color);
  color: var(--mdzip-accent-foreground-color);
}

.mdzip-root .metadata-dialog dl {
  margin: 12px 0 0;
}

.mdzip-root .metadata-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--mdzip-border-color);
  font-size: 12px;
}

.mdzip-root .metadata-row:last-child {
  border-bottom: 0;
}

.mdzip-root .metadata-row dt {
  color: var(--mdzip-muted-foreground-color);
  font-weight: 600;
}

.mdzip-root .metadata-row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .mdzip-root { --nav-pane-width: 220px; }
  .mdzip-root .toolbar {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    row-gap: 4px;
  }
  .mdzip-root .toolbar-start {
    display: contents;
  }
  .mdzip-root .toolbar-left {
    grid-column: 1;
    grid-row: 1;
  }
  .mdzip-root .edit-toolbar {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: start;
    position: static;
    transform: none;
  }
  .mdzip-root .view-mode-toggle-group {
    position: static;
    transform: none;
  }
  .mdzip-root .toolbar-controls {
    grid-column: 3;
    grid-row: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mdzip-root .nav-pane,
  .mdzip-root .nav-resizer {
    transition: none;
  }
}

@media (max-width: 640px) {
  .mdzip-root .toolbar {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    row-gap: 6px;
  }
  .mdzip-root .edit-toolbar {
    overflow-x: auto;
  }
  .mdzip-root .toolbar-controls {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
  }
}
`;
