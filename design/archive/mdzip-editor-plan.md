# Extract Reusable MDZip Workspace Functionality from `mdzip-vscode`

## Objective

Extract the reusable MDZip workspace functionality from `mdzip-vscode` into a new monorepo:

```text
mdzip-editor
```

The goal is to separate:

* MDZip viewing logic
* MDZip editing logic
* UI framework implementations
* Host-specific integrations

into independent layers that can be reused throughout the MDZip ecosystem.

Target architecture:

```text
mdzip-core-js
      |
 @mdzip/editor
      |
 +--------------+---------------+
 |              |               |
 v              v               v
mdzip-vscode  @mdzip/editor-ng  future hosts
```

Future applications such as a standalone MDZip desktop application should be able to consume `@mdzip/editor-ng` directly.

Future hosts should be able to consume `@mdzip/editor` without depending on Angular.

***

# Scope

The current `mdzip-vscode` implementation provides both viewing and editing capabilities.

The extracted libraries must preserve both responsibilities.

The resulting architecture should support:

* Viewing MDZip archives
* Navigating MDZip archives
* Inspecting archive contents
* Rendering Markdown content
* Viewing assets
* Viewing manifests
* Editing Markdown content
* Managing assets
* Managing manifests
* Saving archives

This effort is not limited to editing functionality.

The goal is to create the canonical MDZip workspace library.

***

# Existing Source

Use:

```text
mdzip-vscode
```

as the source of truth.

Relevant sibling repositories:

```text
mdzip-core-js
mdzip-vscode
mdzip-viewer
```

`mdzip-core-js` is the lower-level archive library and should be consumed directly.

`mdzip-vscode` is the implementation source of truth for current workspace, document, viewing, editing, asset, manifest, and save behavior.

`mdzip-viewer` may be used as behavioral reference only. Do not depend on it from this repository. Its viewing functionality is expected to become obsolete if `@mdzip/editor` successfully becomes the canonical workspace library with view-only mode.

Do not rewrite functionality unless necessary.

The objective is extraction and reuse.

***

# Repository Structure

Repository:

```text
mdzip-editor
```

Use plain npm workspaces.

Recommended structure:

```text
mdzip-editor/
├── packages/
│   ├── editor/
│   └── editor-ng/
│
├── demo/
├── README.md
├── MIGRATION.md
├── package.json
├── tsconfig.json
└── .github/
```

Published packages:

```text
@mdzip/editor
@mdzip/editor-ng
```

Future framework implementations may be added later:

```text
packages/
├── editor/
├── editor-ng/
├── editor-react/
└── editor-vue/
```

Do not create React or Vue implementations at this time.

The architecture should simply allow them to be added later without modifying the core package.

***

# Architecture

## Layer 1

```text
mdzip-core-js
```

Already exists.

Responsibilities:

* MDZip archive reading
* MDZip archive writing
* Manifest support
* Validation
* Packaging
* Extraction

Do not duplicate functionality already provided by `mdzip-core-js`.

***

## Layer 2

```text
@mdzip/editor
```

Framework-independent MDZip workspace library.

This is the primary deliverable of this effort.

Responsibilities:

* Archive state management
* Document management
* Archive navigation
* Archive inspection
* Rendering coordination
* Editing workflows
* Asset management
* Manifest management
* Validation orchestration
* Host abstractions

Must contain:

* No Angular dependencies
* No VS Code dependencies
* No Electron dependencies
* No `mdzip-viewer` dependency

`@mdzip/editor` must support opening workspaces in read-only mode. In read-only mode, mutation APIs must be disabled at the core level, not only hidden by UI packages.

***

## Layer 3

```text
@mdzip/editor-ng
```

Angular implementation of the workspace UI.

The first implementation should be architecture-first. It should prove that Angular components can consume `@mdzip/editor` cleanly before attempting full visual or behavioral parity with the existing VS Code webview.

The existing VS Code webview assets are reference material, not Angular source to extract directly.

Responsibilities:

* Angular components
* Angular services
* Workspace UI
* Viewer UI
* Preview UI
* Navigation UI
* Asset browser UI
* Manifest editor UI

Must depend on:

```text
@mdzip/editor
```

Must contain:

* No VS Code dependencies

***

# Create Package: @mdzip/editor

## Purpose

Provide a framework-independent MDZip workspace engine built on top of `mdzip-core-js`.

This package should support both viewing and editing scenarios.

Viewing is a first-class mode of `@mdzip/editor`, not a separate dependency on `mdzip-viewer`.

This package should eventually be reusable by:

* VS Code
* Angular applications
* Electron applications
* Browser applications
* Future React implementations
* Future Vue implementations

***

## Archive State

Maintain state for:

* manifest
* markdown files
* assets
* archive metadata

Track:

* dirty state
* modified files
* created files
* deleted files

Track workspace mode:

* read-only
* editable

***

## Document Management

Support:

* loading documents
* switching documents
* tracking changes
* saving changes

Support:

* document mode archives
* project mode archives

In read-only mode:

* document loading is allowed
* document switching is allowed
* inspection is allowed
* rendering coordination is allowed
* edits, asset insertion/removal, manifest mutation, and save operations must fail with explicit read-only errors

***

## Archive Navigation

Support:

* archive structure
* file navigation
* project navigation
* entry point discovery

***

## Archive Inspection

Support:

* read-only archive access
* manifest inspection
* asset inspection
* metadata inspection

The package must be useful even when no editing is performed.

***

## Rendering Coordination

Provide rendering-related abstractions and state management.

The package should support hosts that render Markdown content but should not be tightly coupled to a specific rendering implementation.

Rendering coordination should define:

* the current render source
* asset URL resolution hooks
* renderer injection points
* a clear boundary for HTML sanitization responsibilities

***

## Asset Management

Support:

* asset discovery
* asset metadata
* image references
* asset insertion

Expose APIs only.

Do not create UI.

***

## Manifest Management

Support:

* manifest loading
* manifest editing
* manifest validation

***

## Validation

Support:

* entry point validation
* manifest validation
* archive consistency checks

Reuse existing MDZip validation logic whenever possible.

***

## Host Abstractions

Introduce interfaces for host-specific functionality.

Examples:

```typescript
interface FilePickerService
interface ClipboardService
interface SaveService
interface AssetUrlResolver
```

The workspace library depends on abstractions.

Hosts provide implementations.

Examples:

* VS Code
* Electron
* Browser

Keep UI prompts and notifications outside the required core abstractions where possible. The core package should expose state, events, and errors; hosts decide how to present them.

***

## Suggested Public API

```typescript
MdzipArchiveService
MdzipDocumentService
MdzipAssetService
MdzipManifestService
MdzipValidationService
MdzipNavigationService
MdzipWorkspaceService
```

Names may be adjusted if better alternatives are identified.

***

## Initial Extraction Inventory

Start from the current `mdzip-vscode` implementation.

Move or adapt into `@mdzip/editor`:

* archive helpers from `src/mdzArchiveUtils.ts`
* document/workspace state from `src/mdzDocument.ts`
* title and metadata helpers from `src/shared/editorMetadata.ts`
* archive navigation and path classification behavior currently split between `MdzDocument`, `MdzEditorProvider`, and the webview script

Keep in `mdzip-vscode` for future migration:

* VS Code extension activation and command registration
* custom editor provider integration
* VS Code file system, dialog, notification, and webview APIs
* MCP server integration

Use as UI reference only:

* `media/editor.js`
* `media/editor.css`
* bundled webview HTML structure in `MdzEditorProvider`

***

# Create Package: @mdzip/editor-ng

## Purpose

Provide reusable Angular UI components built on top of `@mdzip/editor`.

Use:

* Angular 20
* Standalone Components
* Signals where appropriate
* OnPush change detection

Use Angular 20 unless implementation work uncovers a concrete compatibility or maintenance reason to move to Angular 21.

Follow existing Angular patterns used in the MDZip ecosystem.

***

# Viewing Capabilities

Provide reusable UI components for:

* Markdown rendering
* Archive navigation
* Asset viewing
* Manifest viewing
* Read-only archive inspection

The package must support viewing-only scenarios.

***

# Editor Modes

Provide:

### Read-Only Mode

Allow hosts to display MDZip content without enabling editing.

Read-only mode must be backed by core-level mutation guards in `@mdzip/editor`.

### Source Mode

Markdown editor.

### Split Mode

Editor + preview.

### Preview Mode

Rendered output only.

***

### Future Mode

Do not implement now.

Design extension points for:

```text
WYSIWYG Mode
```

***

# Navigation

Provide UI for:

* document lists
* project trees
* archive structure

***

# Asset Browser

Provide UI for:

* asset browsing
* asset viewing
* image insertion
* drag/drop support
* image paste support

Use host abstractions rather than VS Code APIs directly.

***

# Manifest Editor

Provide:

* manifest viewer
* manifest editor

***

# Suggested Public Components

```typescript
MdzipWorkspaceComponent
MdzipEditorComponent
MdzipPreviewComponent
MdzipAssetBrowserComponent
MdzipManifestEditorComponent
MdzipNavigationComponent
```

Names may be adjusted if better alternatives are identified.

***

# Refactoring Rules

Do NOT:

* redesign the UI
* rewrite working functionality
* change behavior unnecessarily

Do:

* extract reusable functionality
* separate UI from workspace logic
* remove VS Code coupling
* introduce clean abstractions

***

# Future Integrations

Migration of `mdzip-vscode` is NOT part of this effort.

The immediate objective is to:

* Create `@mdzip/editor`
* Create `@mdzip/editor-ng`
* Establish clean package boundaries
* Validate the architecture
* Ensure the workspace can operate independently of VS Code

Once the workspace library has stabilized, future consumers may include:

* `mdzip-vscode`
* `mdzip-studio`
* Angular applications
* Browser applications
* Future React implementations
* Future Vue implementations

`mdzip-studio` is a future consumer and does not exist yet.

This effort should focus on creating a solid reusable foundation rather than migrating existing consumers.

***

# Demo

Create a small local demo that proves the packages can run outside VS Code.

The demo should:

* depend on `@mdzip/editor` and `@mdzip/editor-ng`
* open a sample `.mdz`
* render/preview Markdown
* navigate archive contents
* demonstrate read-only mode
* demonstrate a minimal editable session and save/export path

The demo is for architecture validation, not a polished product.

***

# Documentation

Create:

```text
README.md
```

explaining:

* repository structure
* package responsibilities
* architecture
* public APIs
* integration model
* future framework strategy

***

# Migration Document

Create:

```text
MIGRATION.md
```

describing:

* what was extracted
* what remains in `mdzip-vscode`
* recommended future migration path
* package dependency hierarchy

***

# Success Criteria

The extraction is successful when:

* `@mdzip/editor` contains no Angular dependencies
* `@mdzip/editor` contains no VS Code dependencies
* `@mdzip/editor` contains no Electron dependencies
* `@mdzip/editor` contains no `mdzip-viewer` dependency
* `@mdzip/editor-ng` contains no VS Code dependencies
* Viewing functionality can be hosted outside VS Code
* Editing functionality can be hosted outside VS Code
* Future desktop applications can consume `@mdzip/editor-ng`
* Package boundaries are clean and maintainable
* npm workspace install/build succeeds
* `@mdzip/editor` unit tests cover archive loading, read-only mutation blocking, edit/save behavior, asset operations, manifest title updates, and entry-point handling
* dependency boundary checks prove `@mdzip/editor` has no Angular, VS Code, Electron, or `mdzip-viewer` dependency
* the demo runs outside VS Code and exercises view-only and editable sessions

The resulting architecture should establish:

```text
mdzip-core-js
      |
 @mdzip/editor
      |
 framework-specific implementations
```

as the canonical MDZip workspace stack for the MDZip ecosystem.
