import { WORKSPACE_CSS } from './view-css.js';

const DIFF_STYLE_ID = 'mdzip-diff-view-styles';
// The workspace view marks its stylesheet with the same attribute, so a page
// holding both an editor and a diff view gets the preview styles once.
const WORKSPACE_STYLE_ATTR = 'data-mdzip-ws-styles';

/** Adds the workspace preview's styles, which the rendered comparison reuses. */
export function injectPreviewStyles(doc: Document): void {
  if (doc.querySelector(`style[${WORKSPACE_STYLE_ATTR}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(WORKSPACE_STYLE_ATTR, '');
  style.textContent = WORKSPACE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function injectDiffViewStyles(doc: Document): void {
  if (doc.getElementById(DIFF_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = DIFF_STYLE_ID;
  style.textContent = `
.mdzip-diff-root{height:100%;display:flex;flex-direction:column;color:var(--mdzip-foreground-color,#24292f);background:var(--mdzip-background-color,#fff);font:14px system-ui,sans-serif}
.mdzip-diff-toolbar{display:flex;align-items:center;gap:4px;min-height:42px;padding:4px 8px;border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-toolbar-actions{display:flex;align-items:center;gap:4px;margin-left:auto}
.mdzip-diff-toolbar-button{min-width:32px;height:32px;display:inline-grid;place-items:center;border:0;border-radius:6px;padding:6px;background:transparent;color:inherit;cursor:pointer;transition:background .12s ease,color .12s ease}
.mdzip-diff-toolbar-button[hidden],.mdzip-diff-toolbar-group[hidden]{display:none}
.mdzip-diff-toolbar-group{display:inline-flex;gap:2px;margin-left:6px;padding-left:8px;border-left:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-toolbar-button:hover:not(:disabled){background:var(--mdzip-hover-background-color,#f3f4f6)}
.mdzip-diff-toolbar-button.active,.mdzip-diff-toolbar-button.active:hover:not(:disabled){color:var(--mdzip-active-foreground-color,var(--mdzip-accent-color,#0969da));background:var(--mdzip-active-background-color,rgba(127,127,127,.22));box-shadow:inset 0 0 0 1px var(--mdzip-active-border-color,transparent)}
.mdzip-diff-toolbar-button:focus-visible{outline:2px solid var(--mdzip-accent-color,#0969da);outline-offset:-2px}
.mdzip-diff-toolbar-button:disabled{opacity:.5;cursor:default}.mdzip-diff-toolbar-icon{width:18px;height:18px}
.mdzip-diff-workspace{flex:1;min-height:0;display:flex;flex-direction:row}
.mdzip-diff-nav{flex:0 0 var(--mdzip-diff-nav-width,280px);width:var(--mdzip-diff-nav-width,280px);min-width:0;border-right:1px solid var(--mdzip-border-color,#d0d7de);overflow:auto;transition:flex-basis .18s ease,width .18s ease,opacity .14s ease,border-color .18s ease}
.mdzip-diff-nav.hidden{flex-basis:0;width:0;opacity:0;overflow:hidden;pointer-events:none;border-right-color:transparent}
.mdzip-diff-summary{position:sticky;top:0;z-index:1;padding:12px;background:inherit;border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-labels{font-weight:600;margin-bottom:8px;overflow-wrap:anywhere}
.mdzip-diff-counts{color:var(--mdzip-muted-foreground-color,#57606a);font-size:12px;margin-bottom:8px}
.mdzip-diff-filter{display:flex;gap:6px;align-items:center;font-size:12px}
.mdzip-diff-list{display:flex;flex-direction:column;padding:6px}
.mdzip-diff-directory{padding:7px 8px 3px calc(8px + var(--mdzip-diff-depth)*16px);font-size:12px;font-weight:600;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-diff-directory::before{content:"▾";display:inline-block;width:18px}
.mdzip-diff-entry{display:grid;grid-template-columns:18px 1fr;gap:4px;border:0;background:transparent;color:inherit;text-align:left;padding:6px 8px 6px calc(8px + var(--mdzip-diff-depth)*16px);border-radius:4px;cursor:pointer}
.mdzip-diff-entry:hover,.mdzip-diff-entry.active{background:var(--mdzip-hover-background-color,#f3f4f6)}
.mdzip-diff-entry:focus-visible{outline:2px solid var(--mdzip-accent-color,#0969da);outline-offset:-2px}
.mdzip-diff-entry.added .mdzip-diff-status{color:#1a7f37}.mdzip-diff-entry.removed .mdzip-diff-status{color:#cf222e}.mdzip-diff-entry.changed .mdzip-diff-status{color:#9a6700}
.mdzip-diff-entry.unchanged{opacity:.65}.mdzip-diff-path{overflow-wrap:anywhere}
.mdzip-diff-content{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.mdzip-diff-heading{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--mdzip-border-color,#d0d7de);font-weight:600}
.mdzip-diff-heading>div{padding:10px 14px;overflow-wrap:anywhere}.mdzip-diff-heading>div+div{border-left:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-body{flex:1;min-height:0;overflow:auto;position:relative}.mdzip-diff-body .cm-mergeView{height:100%;overflow:auto}
.mdzip-diff-body .cm-editor{height:100%;font-size:13px}.mdzip-diff-body .cm-scroller{overflow:auto}
/* Line-number gutters follow the host's colors, like the main editor's (#37), instead of
   CodeMirror's light default (#60). Three classes deep to outrank CodeMirror's own
   two-class base-theme rule, which is added at runtime and may come after this sheet. */
.mdzip-diff-body .cm-editor .cm-gutters{background:transparent;border-right:1px solid var(--mdzip-border-color,#d0d7de);color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-diff-message{padding:24px;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-diff-pair{display:grid;grid-template-columns:1fr 1fr;height:100%}.mdzip-diff-side{padding:18px;overflow:auto;min-width:0}
.mdzip-diff-side+.mdzip-diff-side{border-left:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-text-side{padding:0}.mdzip-diff-text-side .cm-editor{height:100%}
.mdzip-diff-missing{display:grid;place-items:center;color:var(--mdzip-muted-foreground-color,#57606a);font-style:italic}
.mdzip-diff-image{max-width:100%;max-height:70vh;display:block;margin:auto}.mdzip-diff-meta{margin-top:12px;white-space:pre-wrap;font:12px ui-monospace,monospace}
.mdzip-diff-error{color:#cf222e}
/* Rendered comparison: each side is the workspace preview's own .mdzip-root .preview-content,
   minus the root's full-height app layout. Two classes outrank the single-class .mdzip-root rule. */
.mdzip-diff-rendered-side{padding:0}
.mdzip-root.mdzip-diff-preview-scope{display:block;width:auto;height:auto;min-height:100%;overflow:visible;background:transparent;--mdzip-preview-content-padding:20px 28px 40px}
.mdzip-diff-preview::after{content:"";display:block;clear:both}
.mdzip-diff-preview>.mdzip-diff-block-added,.mdzip-diff-preview>.mdzip-diff-block-removed{border-radius:3px}
.mdzip-diff-preview>.mdzip-diff-block-added{background:rgba(26,127,55,.16);box-shadow:0 0 0 6px rgba(26,127,55,.16),-9px 0 0 0 #1a7f37}
.mdzip-diff-preview>.mdzip-diff-block-removed{background:rgba(207,34,46,.14);box-shadow:0 0 0 6px rgba(207,34,46,.14),-9px 0 0 0 #cf222e}
.mdzip-diff-preview img.mdzip-diff-image-missing{min-width:48px;min-height:32px;outline:1px dashed var(--mdzip-border-color,#d0d7de)}
@media(max-width:700px){.mdzip-diff-workspace{flex-direction:column}.mdzip-diff-nav{flex:0 0 35%;width:auto;min-height:140px;border-right:0;border-bottom:1px solid var(--mdzip-border-color,#d0d7de);transition:flex-basis .18s ease,opacity .14s ease,border-color .18s ease}.mdzip-diff-nav.hidden{flex-basis:0;min-height:0;height:0;border-bottom-color:transparent}}
@media(prefers-reduced-motion:reduce){.mdzip-diff-nav{transition:none}}
`;
  doc.head.appendChild(style);
}
