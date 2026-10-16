# Guidance for AI Agents

This document provides guidance for AI agents (Claude, etc.) working on this project.

## Test bench

`npm run testbench` serves a page running this repo's editor on a sample
document (`testbench/`, port 8790). Point the owner at it for anything to
check by hand, and when a change adds a user-visible preview or toolbar
feature, add a section for it to `testbench/sample/index.md` and a row to
`testbench/README.md` in the same change. See `testbench/README.md`.

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
