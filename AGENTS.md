# Guidance for AI Agents

This document provides guidance for AI agents (Claude, etc.) working on this project.

## Package Selection

### Prefer ESM-Native Packages

This project uses `"type": "module"` in package.json, making it an ES modules-only codebase.

**When adding dependencies, prefer packages with native ESM (ECMAScript Module) support.**

- Check the package's `package.json` for `exports` field with ESM entry points
- Verify ESM compatibility before adding the package
- If a package lacks ESM support, consider alternatives first
- Document why if a non-ESM package is necessary

**Example:** Prism.js has excellent ESM support by design and is preferred over highlight.js for syntax highlighting in this project.

**Why:** Packages without proper ESM exports can cause compatibility issues, build problems, or require workarounds (CommonJS wrappers). ESM packages work seamlessly with this project's module system.
