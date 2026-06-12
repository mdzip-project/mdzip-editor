import { Directive, Input, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import type { MdzipEntryRenderContext, MdzipEntryRenderer } from '@mdzip/editor';

/** Template context available via `let-context` (also the `$implicit` value). */
export interface MdzipEntryRendererTemplateContext {
  $implicit: MdzipEntryRenderContext;
  context: MdzipEntryRenderContext;
}

/**
 * Declares an entry renderer template inside `<mdzip-workspace>`:
 *
 * ```html
 * <mdzip-workspace [bytes]="bytes" mode="editable">
 *   <ng-template mdzipEntryRenderer="manifest.json" let-context>
 *     <app-internals [manifest]="context.manifest" />
 *   </ng-template>
 * </mdzip-workspace>
 * ```
 *
 * Match either by exact archive path(s) via `mdzipEntryRenderer`, or with a
 * predicate via `[mdzipEntryRendererMatch]`. The embedded view is created in
 * the workspace component's view container (so change detection and
 * dependency injection work normally), its DOM is moved into the editor's
 * entry pane, and the view is destroyed when the selection changes or the
 * workspace is destroyed.
 */
@Directive({
  selector: 'ng-template[mdzipEntryRenderer], ng-template[mdzipEntryRendererMatch]',
  standalone: true
})
export class MdzipEntryRendererDirective {
  readonly templateRef = inject(TemplateRef<MdzipEntryRendererTemplateContext>);
  private readonly viewContainerRef = inject(ViewContainerRef);

  /** Exact archive path(s) to claim, case-insensitive. */
  @Input() mdzipEntryRenderer: string | readonly string[] = '';
  /** Predicate alternative for extension/MIME/path-family matching. */
  @Input() mdzipEntryRendererMatch?: (context: MdzipEntryRenderContext) => boolean;
  /** Stable id used for renderer diffing. Defaults to the matched paths. */
  @Input() mdzipEntryRendererId?: string;
  /** Matching priority relative to the `entryRenderers` input. Default 0. */
  @Input() mdzipEntryRendererPriority?: number;

  /** Adapts this template onto the framework-independent renderer contract. */
  toEntryRenderer(index: number): MdzipEntryRenderer {
    const paths = (typeof this.mdzipEntryRenderer === 'string'
      ? [this.mdzipEntryRenderer]
      : this.mdzipEntryRenderer
    ).filter((path) => path.length > 0).map((path) => path.toLowerCase());

    return {
      id: this.mdzipEntryRendererId
        ?? (paths.length > 0 ? `mdzip-ng-template:${paths.join(',')}` : `mdzip-ng-template#${index}`),
      priority: this.mdzipEntryRendererPriority ?? 0,
      matches: (context) => this.mdzipEntryRendererMatch
        ? this.mdzipEntryRendererMatch(context)
        : paths.includes(context.path.toLowerCase()),
      mount: (container, context) => {
        const templateContext: MdzipEntryRendererTemplateContext = {
          $implicit: context,
          context
        };
        const viewRef = this.viewContainerRef.createEmbeddedView(this.templateRef, templateContext);
        viewRef.detectChanges();
        const movedNodes = [...(viewRef.rootNodes as Node[])];
        for (const node of movedNodes) {
          container.appendChild(node);
        }
        return {
          update: (next) => {
            templateContext.$implicit = next;
            templateContext.context = next;
            viewRef.markForCheck();
            viewRef.detectChanges();
          },
          destroy: () => {
            viewRef.destroy();
            // The nodes were moved out of Angular's host container; make
            // sure none linger if the renderer did not remove them.
            for (const node of movedNodes) {
              node.parentNode?.removeChild(node);
            }
          }
        };
      }
    };
  }
}
