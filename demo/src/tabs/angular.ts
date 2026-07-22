import 'zone.js';
import '@angular/compiler';

import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  provideZoneChangeDetection,
  signal,
  ViewChild,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MdzipWorkspaceComponent, MdzipDiffComponent } from '@mdzip/editor-ng';
import type { MdzipPackFilesInput, MdzipPackFilesResult, MdzipWorkspaceSave } from 'mdzip-editor';
import { mdzipMermaidExtension } from 'mdzip-editor/mermaid';
import { modeFromControls, type DemoControls, type DemoDensity, type DemoImageInsertOptions } from '../tab-controls.js';
import type { TabController } from '../tab-controller.js';
import { loadDiffBaseBytes } from '../diff-sample.js';

const mermaidExtension = mdzipMermaidExtension();

let _onSaved: (b: Uint8Array, fileName?: string) => void = () => {};
let _onFailed: (e: unknown) => void = () => {};
let _appRef: ApplicationRef | null = null;

const _bytes = signal<Uint8Array | null>(null);
const _controls = signal<DemoControls>('standalone-editor');
const _imageInsert = signal<DemoImageInsertOptions>({ mode: 'markdown' });
const _density = signal<DemoDensity>({ toolbarDensity: 'comfortable', contentDensity: 'comfortable' });
const _fileName = signal('document.mdz');
const _diffMode = signal(false);
const _diffBaseBytes = signal<Uint8Array | null>(null);

@Component({
  selector: 'demo-angular-tab',
  standalone: true,
  imports: [MdzipWorkspaceComponent, MdzipDiffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (diffMode()) {
      <mdzip-diff
        [before]="diffBefore()"
        [after]="diffAfter()"
        [showUnchanged]="true"
        (failed)="onFailed($event)"
      />
    } @else {
      <mdzip-workspace
        [bytes]="bytes()"
        [mode]="mode()"
        [fileName]="fileName()"
        [controls]="controls()"
        imageHydrationAnimation="initial"
        [imageInsertMode]="imageInsert().mode"
        [imageInsertHandler]="imageInsert().handler"
        [toolbarDensity]="density().toolbarDensity"
        [contentDensity]="density().contentDensity"
        [markdownExtensions]="markdownExtensions"
        (saved)="onSaved($event)"
        (failed)="onFailed($event)"
      />
    }
  `,
  styles: [':host { display:block; height:100%; }'],
})
class AngularTabComponent {
  @ViewChild(MdzipWorkspaceComponent) private workspace?: MdzipWorkspaceComponent;
  readonly bytes = _bytes;
  readonly controls = _controls;
  readonly imageInsert = _imageInsert;
  readonly density = _density;
  readonly fileName = _fileName;
  readonly diffMode = _diffMode;
  readonly mode = () => modeFromControls(_controls());
  readonly diffBefore = () => ({ bytes: _diffBaseBytes() ?? new Uint8Array(), label: 'sample.mdz' });
  readonly diffAfter = () => ({ bytes: _bytes() ?? new Uint8Array(), label: _fileName() });
  readonly markdownExtensions = [mermaidExtension];

  onSaved(event: MdzipWorkspaceSave): void {
    _onSaved(event.bytes, event.snapshot.fileName);
    this.workspace?.markPersisted();
  }

  onFailed(error: unknown): void {
    _onFailed(error);
  }

  markPersisted(): void {
    this.workspace?.markPersisted();
  }

  packFilesAsWorkspace(
    files: readonly MdzipPackFilesInput[],
    options?: { title?: string; fileName?: string }
  ): Promise<MdzipPackFilesResult | null> {
    return this.workspace?.packFilesAsWorkspace(files, options) ?? Promise.resolve(null);
  }
}

export async function initAngular(
  container: HTMLElement,
  onSaved: (b: Uint8Array, fileName?: string) => void,
  onFailed: (e: unknown) => void
): Promise<TabController> {
  _onSaved = onSaved;
  _onFailed = onFailed;
  _appRef?.destroy();
  _appRef = null;
  _bytes.set(null);
  _controls.set('standalone-editor');
  _imageInsert.set({ mode: 'markdown' });
  _density.set({ toolbarDensity: 'comfortable', contentDensity: 'comfortable' });
  _fileName.set('document.mdz');
  _diffMode.set(false);
  _diffBaseBytes.set(null);
  container.replaceChildren();

  const host = document.createElement('demo-angular-tab');
  host.style.cssText = 'height:100%;display:block';
  container.appendChild(host);

  _appRef = await bootstrapApplication(AngularTabComponent, {
    providers: [provideZoneChangeDetection({ eventCoalescing: true })],
  });

  return {
    update(bytes: Uint8Array, fileName: string, controls: DemoControls, imageInsert: DemoImageInsertOptions, density: DemoDensity): void {
      _bytes.set(bytes);
      _controls.set(controls);
      _imageInsert.set(imageInsert);
      _density.set(density);
      _fileName.set(fileName);
      _appRef?.tick();
    },
    setControls(controls: DemoControls): void {
      _controls.set(controls);
      _appRef?.tick();
    },
    setImageInsertOptions(imageInsert: DemoImageInsertOptions): void {
      _imageInsert.set(imageInsert);
      _appRef?.tick();
    },
    setDensity(density: DemoDensity): void {
      _density.set(density);
      _appRef?.tick();
    },
    setDiffMode(enabled: boolean): void {
      _diffMode.set(enabled);
      if (enabled && !_diffBaseBytes()) {
        void loadDiffBaseBytes().then((bytes) => {
          _diffBaseBytes.set(bytes);
          _appRef?.tick();
        }).catch(onFailed);
      }
      _appRef?.tick();
    },
    markPersisted(): void {
      _appRef?.components[0]?.instance.markPersisted();
    },
    packFilesAsWorkspace(
      files: readonly MdzipPackFilesInput[],
      options?: { title?: string; fileName?: string }
    ): Promise<MdzipPackFilesResult | null> {
      return _appRef?.components[0]?.instance.packFilesAsWorkspace(files, options) ?? Promise.resolve(null);
    },
    destroy(): void {
      _appRef?.destroy();
      _appRef = null;
    },
  };
}
