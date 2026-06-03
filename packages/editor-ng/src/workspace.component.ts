import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { MdzipWorkspaceView } from '@mdzip/editor';
import type { MdzipWorkspaceMode } from '@mdzip/editor';

@Component({
  selector: 'mdzip-workspace',
  standalone: true,
  template: '<div #host></div>',
  styles: [':host { display: block; height: 100%; } div { height: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MdzipWorkspaceComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() bytes: Uint8Array | null = null;
  @Input() fileName = 'document.mdz';
  @Input() mode: MdzipWorkspaceMode = 'read-only';
  @Output() readonly saved = new EventEmitter<Uint8Array>();
  @Output() readonly failed = new EventEmitter<unknown>();

  @ViewChild('host') private readonly hostRef!: ElementRef<HTMLDivElement>;
  private view: MdzipWorkspaceView | null = null;

  ngAfterViewInit(): void {
    this.view = new MdzipWorkspaceView(this.hostRef.nativeElement, {
      onSaved: (b) => this.saved.emit(b),
      onFailed: (e) => this.failed.emit(e),
    });
    this.syncView();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.view && (changes['bytes'] || changes['mode'] || changes['fileName'])) {
      this.syncView();
    }
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }

  private syncView(): void {
    if (this.view && this.bytes) {
      void this.view.open(this.bytes, { mode: this.mode, fileName: this.fileName });
    }
  }
}
