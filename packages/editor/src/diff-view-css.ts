const DIFF_STYLE_ID = 'mdzip-diff-view-styles';

export function injectDiffViewStyles(doc: Document): void {
  if (doc.getElementById(DIFF_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = DIFF_STYLE_ID;
  style.textContent = `
.mdzip-diff-root{height:100%;display:grid;grid-template-columns:minmax(220px,300px) 1fr;color:var(--mdzip-foreground-color,#24292f);background:var(--mdzip-background-color,#fff);font:14px system-ui,sans-serif}
.mdzip-diff-nav{border-right:1px solid var(--mdzip-border-color,#d0d7de);overflow:auto;min-width:0}
.mdzip-diff-summary{position:sticky;top:0;z-index:1;padding:12px;background:inherit;border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-labels{font-weight:600;margin-bottom:8px;overflow-wrap:anywhere}
.mdzip-diff-counts{color:var(--mdzip-muted-foreground-color,#57606a);font-size:12px;margin-bottom:8px}
.mdzip-diff-filter{display:flex;gap:6px;align-items:center;font-size:12px}
.mdzip-diff-list{display:flex;flex-direction:column;padding:6px}
.mdzip-diff-entry{display:grid;grid-template-columns:18px 1fr;gap:4px;border:0;background:transparent;color:inherit;text-align:left;padding:6px 8px;border-radius:4px;cursor:pointer}
.mdzip-diff-entry:hover,.mdzip-diff-entry.active{background:var(--mdzip-hover-background-color,#f3f4f6)}
.mdzip-diff-entry.added .mdzip-diff-status{color:#1a7f37}.mdzip-diff-entry.removed .mdzip-diff-status{color:#cf222e}.mdzip-diff-entry.changed .mdzip-diff-status{color:#9a6700}
.mdzip-diff-entry.unchanged{opacity:.65}.mdzip-diff-path{overflow-wrap:anywhere}
.mdzip-diff-content{min-width:0;display:flex;flex-direction:column;overflow:hidden}
.mdzip-diff-heading{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--mdzip-border-color,#d0d7de);font-weight:600}
.mdzip-diff-heading>div{padding:10px 14px;overflow-wrap:anywhere}.mdzip-diff-heading>div+div{border-left:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-body{flex:1;min-height:0;overflow:auto;position:relative}.mdzip-diff-body .cm-mergeView{height:100%;overflow:auto}
.mdzip-diff-body .cm-editor{height:100%;font-size:13px}.mdzip-diff-body .cm-scroller{overflow:auto}
.mdzip-diff-message{padding:24px;color:var(--mdzip-muted-foreground-color,#57606a)}
.mdzip-diff-pair{display:grid;grid-template-columns:1fr 1fr;height:100%}.mdzip-diff-side{padding:18px;overflow:auto}
.mdzip-diff-side+.mdzip-diff-side{border-left:1px solid var(--mdzip-border-color,#d0d7de)}
.mdzip-diff-image{max-width:100%;max-height:70vh;display:block;margin:auto}.mdzip-diff-meta{margin-top:12px;white-space:pre-wrap;font:12px ui-monospace,monospace}
.mdzip-diff-error{color:#cf222e}
@media(max-width:700px){.mdzip-diff-root{grid-template-columns:1fr;grid-template-rows:minmax(140px,35%) 1fr}.mdzip-diff-nav{border-right:0;border-bottom:1px solid var(--mdzip-border-color,#d0d7de)}}
`;
  doc.head.appendChild(style);
}
