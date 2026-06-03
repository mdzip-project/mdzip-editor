/**
 * CSS variable mapping: --mdzip-* resolves from --theme-* with hardcoded fallbacks.
 *
 * To theme the editor, define --theme-* variables on :root or any ancestor element.
 * To override individual tokens, set --mdzip-* directly on the container or an ancestor.
 */
export const MDZIP_VARIABLES_CSS = `
  /* Editor surface */
  --mdzip-editor-background-color:          var(--theme-editor-background-color, #ffffff);
  --mdzip-editor-foreground-color:          var(--theme-editor-foreground-color, #1f2328);
  --mdzip-editor-cursor-color:              var(--theme-editor-cursor-color, var(--theme-editor-foreground-color, #1f2328));

  /* Chrome */
  --mdzip-toolbar-background-color:         var(--theme-toolbar-background-color, var(--theme-editor-background-color, #ffffff));
  --mdzip-toolbar-icon-fill-color:          var(--theme-toolbar-icon-fill-color, #ffffff);
  --mdzip-sidebar-background-color:         var(--theme-sidebar-background-color, #f7f7f9);
  --mdzip-sidebar-foreground-color:         var(--theme-sidebar-foreground-color, #202124);
  --mdzip-border-color:                     var(--theme-border-color, #e5e7eb);

  /* Widgets / popovers */
  --mdzip-widget-background-color:          var(--theme-widget-background-color, #f6f8fa);
  --mdzip-widget-border-color:              var(--theme-widget-border-color, #d8dee4);

  /* Accent / primary action */
  --mdzip-accent-color:                     var(--theme-accent-color, #0969da);
  --mdzip-accent-foreground-color:          var(--theme-accent-foreground-color, #ffffff);

  /* Secondary controls */
  --mdzip-control-foreground-color:         var(--theme-control-foreground-color, #24292f);
  --mdzip-control-hover-background-color:   var(--theme-control-hover-background-color, #eaeef2);

  /* Links */
  --mdzip-link-color:                       var(--theme-link-color, var(--theme-accent-color, #0969da));

  /* List / nav states */
  --mdzip-hover-background-color:           var(--theme-hover-background-color, rgba(175, 184, 193, 0.18));
  --mdzip-selection-background-color:       var(--theme-selection-background-color, rgba(9, 105, 218, 0.12));
  --mdzip-focus-outline-color:              var(--theme-focus-outline-color, var(--theme-accent-color, #0969da));
  --mdzip-tree-guide-color:                 var(--theme-tree-guide-color, #a8b0ba);

  /* Text variants */
  --mdzip-muted-foreground-color:           var(--theme-muted-foreground-color, #57606a);

  /* Code / editor gutter */
  --mdzip-code-background-color:            var(--theme-code-background-color, #f6f8fa);
  --mdzip-line-number-foreground-color:     var(--theme-line-number-foreground-color, #8c959f);
`;

/** Drop-in light theme. Set these on :root or a parent element. */
export const MDZIP_LIGHT_THEME_CSS = `
  --theme-editor-background-color:         #ffffff;
  --theme-editor-foreground-color:         #1f2328;
  --theme-toolbar-background-color:        #ffffff;
  --theme-sidebar-background-color:        #f7f7f9;
  --theme-sidebar-foreground-color:        #202124;
  --theme-border-color:                    #e5e7eb;
  --theme-widget-background-color:         #f6f8fa;
  --theme-widget-border-color:             #d8dee4;
  --theme-accent-color:                    #0969da;
  --theme-accent-foreground-color:         #ffffff;
  --theme-control-foreground-color:        #24292f;
  --theme-control-hover-background-color:  #eaeef2;
  --theme-link-color:                      #0969da;
  --theme-hover-background-color:          rgba(175, 184, 193, 0.18);
  --theme-selection-background-color:      rgba(9, 105, 218, 0.12);
  --theme-focus-outline-color:             #0969da;
  --theme-tree-guide-color:                #a8b0ba;
  --theme-muted-foreground-color:          #57606a;
  --theme-code-background-color:           #f6f8fa;
  --theme-line-number-foreground-color:    #8c959f;
`;

/** Drop-in dark theme. Set these on :root or a parent element. */
export const MDZIP_DARK_THEME_CSS = `
  --theme-editor-background-color:         #1e1e1e;
  --theme-editor-foreground-color:         #d4d4d4;
  --theme-toolbar-background-color:        #252526;
  --theme-sidebar-background-color:        #252526;
  --theme-sidebar-foreground-color:        #cccccc;
  --theme-border-color:                    #3c3c3c;
  --theme-widget-background-color:         #2d2d2d;
  --theme-widget-border-color:             #454545;
  --theme-accent-color:                    #0078d4;
  --theme-accent-foreground-color:         #ffffff;
  --theme-control-foreground-color:        #cccccc;
  --theme-control-hover-background-color:  #3a3a3a;
  --theme-link-color:                      #4fc1ff;
  --theme-hover-background-color:          rgba(255, 255, 255, 0.08);
  --theme-selection-background-color:      rgba(0, 120, 212, 0.20);
  --theme-focus-outline-color:             #0078d4;
  --theme-tree-guide-color:                #6f747a;
  --theme-muted-foreground-color:          #8c8c8c;
  --theme-code-background-color:           #2d2d2d;
  --theme-line-number-foreground-color:    #6f7378;
`;
