import type { LucideIconNode } from './md-markdown.js';

// Page-width menu icons: a page outline with two text lines whose length shows
// the reading-column width. Drawn on lucide's 24px grid and stroke so they sit
// with the other toolbar icons.
function pageWidthIcon(halfWidth: number): LucideIconNode {
  return [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['path', { d: `M${12 - halfWidth} 10h${halfWidth * 2}` }],
    ['path', { d: `M${12 - halfWidth} 14h${halfWidth * 2}` }]
  ];
}

export const PAGE_WIDTH_NARROW_ICON = pageWidthIcon(1.5);
export const PAGE_WIDTH_DEFAULT_ICON = pageWidthIcon(3);
export const PAGE_WIDTH_WIDE_ICON = pageWidthIcon(4.5);
export const PAGE_WIDTH_FULL_ICON = pageWidthIcon(6);
