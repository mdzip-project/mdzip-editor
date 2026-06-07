import 'zone.js';
import '@angular/compiler'; // JIT fallback if analog plugin didn't AOT-compile this file

import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  provideZoneChangeDetection,
  signal,
  ViewChild,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MdzipWorkspaceComponent } from '@mdzip/editor-ng';
import type {
  MdzipControlPreset,
  MdzipWorkspaceMode,
  MdzipWorkspaceSave,
} from 'mdzip-editor';
import type { TabController } from '../tab-controller.js';
import { createDemoTabControls } from '../tab-controls.js';

let _onSaved: (b: Uint8Array, fileName?: string) => void = () => {};
let _onFailed: (e: unknown) => void = () => {};
let _appRef: ApplicationRef | null = null;

const _bytes = signal<Uint8Array | null>(null);
const _mode = signal<MdzipWorkspaceMode>('editable');
const _controls = signal<MdzipControlPreset>('standalone-editor');
const _fileName = signal('document.mdz');

@Component({
  selector: 'demo-angular-tab',
  standalone: true,
  imports: [MdzipWorkspaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mdzip-workspace
      [bytes]="bytes()"
      [mode]="mode()"
      [fileName]="fileName()"
      [controls]="controls()"
      (saved)="onSaved($event)"
      (failed)="onFailed($event)"
    />
  `,
  styles: [':host { display:block; height:100%; }'],
})
class AngularTabComponent {
  @ViewChild(MdzipWorkspaceComponent) private workspace?: MdzipWorkspaceComponent;
  readonly bytes = _bytes;
  readonly mode = _mode;
  readonly controls = _controls;
  readonly fileName = _fileName;

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
  _mode.set('editable');
  _controls.set('standalone-editor');
  _fileName.set('document.mdz');
  container.replaceChildren();

  const tabControls = createDemoTabControls(
    container,
    _mode(),
    _controls(),
    (mode, controls) => {
      _mode.set(mode);
      _controls.set(controls);
      _appRef?.tick();
    }
  );
  const host = document.createElement('demo-angular-tab');
  host.style.cssText = 'height:100%;display:block';
  tabControls.content.appendChild(host);

  _appRef = await bootstrapApplication(AngularTabComponent, {
    providers: [provideZoneChangeDetection({ eventCoalescing: true })],
  });

  return {
    update(bytes: Uint8Array, mode: string, fileName: string): void {
      _bytes.set(bytes);
      _mode.set(mode as MdzipWorkspaceMode);
      _controls.set(tabControls.setMode(mode as MdzipWorkspaceMode));
      _fileName.set(fileName);
      _appRef?.tick();
    },
    markPersisted(): void {
      _appRef?.components[0]?.instance.markPersisted();
    },
    destroy(): void {
      _appRef?.destroy();
      _appRef = null;
      tabControls.destroy();
    },
  };
}
