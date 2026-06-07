# Changelog

## [1.2.0] - 2026-06-07

### Added
- Comprehensive developer guide with API documentation for all frameworks
- Detailed theming guide with CSS variable reference and custom theme examples
- New theme test suite (`theme.test.mjs`)
- Theme system with built-in light and dark color schemes
- Exported theme constants: `MDZIP_VARIABLES_CSS`, `MDZIP_LIGHT_THEME_CSS`, `MDZIP_DARK_THEME_CSS`

### Changed
- Refactored workspace view architecture for better separation of concerns
- Redesigned rendering pipeline with improved Markdown-to-HTML conversion
- Updated all framework wrappers (Angular, React, Vue) with new API surface
- Migrated syntax highlighting to highlight.js with reliable language fallbacks
- Enhanced theme integration across all component layers

### Fixed
- Language fallback for unsupported code block languages
- Proper timing for dynamic language loading
- Archive utility functions for better MDZ handling

### Dependencies
- Updated to `mdzip-core-js` 1.2.0
