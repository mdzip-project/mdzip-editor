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
  ViewChild
} from '@angular/core';
import type {
  MdzipDiffControlsOptions,
  MdzipDiffSelectionEvent,
  MdzipDiffSideInput,
  MdzipDiffToolbarAction,
  MdzipDiffView,
  MdzipDiffViewOptions
} from '@mdzip/editor/diff-view';

@Component({
  selector: 'mdzip-diff',
  standalone: true,
  template: '<div #host></div>',
  styles: [':host { display:block; height:100%; } div { height:100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MdzipDiffComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) before!: MdzipDiffSideInput;
  @Input({ required: true }) after!: MdzipDiffSideInput;
  @Input() initialPath?: string;
  @Input() showUnchanged = true;
  @Input() navigationVisible = true;
  @Input() controls?: MdzipDiffControlsOptions;
  @Input() toolbarActions: readonly MdzipDiffToolbarAction[] = [];
  @Output() readonly selectionChanged = new EventEmitter<MdzipDiffSelectionEvent>();
  @Output() readonly failed = new EventEmitter<Error>();

  @ViewChild('host') private readonly hostRef!: ElementRef<HTMLDivElement>;
  private view: MdzipDiffView | null = null;
  private destroyed = false;

  ngAfterViewInit(): void {
    void this.createView();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.view) return;
    if (changes['before'] || changes['after'] || changes['initialPath']) {
      void this.view.open(this.options());
    }
    if (changes['showUnchanged']) this.view.setShowUnchanged(this.showUnchanged);
    if (changes['navigationVisible']) this.view.setNavigationVisible(this.navigationVisible);
    if (changes['toolbarActions']) this.view.setToolbarActions(this.toolbarActions);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.view?.destroy();
    this.view = null;
  }

  openPath(path: string): Promise<boolean> {
    return this.view?.openPath(path) ?? Promise.resolve(false);
  }

  openPreviousChange(): Promise<boolean> {
    return this.view?.openPreviousChange() ?? Promise.resolve(false);
  }

  openNextChange(): Promise<boolean> {
    return this.view?.openNextChange() ?? Promise.resolve(false);
  }

  setShowUnchanged(show: boolean): void {
    this.view?.setShowUnchanged(show);
  }

  setNavigationVisible(visible: boolean): void {
    this.view?.setNavigationVisible(visible);
  }

  setToolbarActions(actions: readonly MdzipDiffToolbarAction[]): void {
    this.view?.setToolbarActions(actions);
  }

  private async createView(): Promise<void> {
    const { MdzipDiffView } = await import('@mdzip/editor/diff-view');
    if (this.destroyed) return;
    this.view = new MdzipDiffView(this.hostRef.nativeElement, this.options());
  }

  private options(): MdzipDiffViewOptions {
    return {
      before: this.before,
      after: this.after,
      initialPath: this.initialPath,
      showUnchanged: this.showUnchanged,
      navigationVisible: this.navigationVisible,
      controls: this.controls,
      toolbarActions: this.toolbarActions,
      onSelectionChanged: (event) => this.selectionChanged.emit(event),
      onFailed: (error) => this.failed.emit(error)
    };
  }
}
