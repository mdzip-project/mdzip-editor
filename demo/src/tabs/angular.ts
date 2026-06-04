import 'zone.js';
import '@angular/compiler'; // JIT fallback if analog plugin didn't AOT-compile this file

import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  provideZoneChangeDetection,
  signal,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MdzipWorkspaceComponent } from '@mdzip/editor-ng';
import type { MdzipWorkspaceMode, MdzipWorkspaceSave } from '@mdzip/editor';
import type { TabController } from '../tab-controller.js';

let _onSaved: (b: Uint8Array) => void = () => {};
let _onFailed: (e: unknown) => void = () => {};
let _appRef: ApplicationRef | null = null;

const _bytes = signal<Uint8Array | null>(null);
const _mode = signal<MdzipWorkspaceMode>('editable');
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
      controls="standalone-editor"
      (saved)="onSaved($event)"
      (failed)="onFailed($event)"
    />
  `,
  styles: [':host { display:block; height:100%; }'],
})
class AngularTabComponent {
  readonly bytes = _bytes;
  readonly mode = _mode;
  readonly fileName = _fileName;

  onSaved(event: MdzipWorkspaceSave): void {
    _onSaved(event.bytes);
  }

  onFailed(error: unknown): void {
    _onFailed(error);
  }
}

export async function initAngular(
  container: HTMLElement,
  onSaved: (b: Uint8Array) => void,
  onFailed: (e: unknown) => void
): Promise<TabController> {
  _onSaved = onSaved;
  _onFailed = onFailed;
  _appRef?.destroy();
  _appRef = null;
  _bytes.set(null);
  _mode.set('editable');
  _fileName.set('document.mdz');

  const host = document.createElement('demo-angular-tab');
  host.style.cssText = 'height:100%;display:block';
  container.appendChild(host);

  _appRef = await bootstrapApplication(AngularTabComponent, {
    providers: [provideZoneChangeDetection({ eventCoalescing: true })],
  });

  return {
    update(bytes: Uint8Array, mode: string, fileName: string): void {
      _bytes.set(bytes);
      _mode.set(mode as MdzipWorkspaceMode);
      _fileName.set(fileName);
      _appRef?.tick();
    },
    destroy(): void {
      _appRef?.destroy();
      _appRef = null;
    },
  };
}
