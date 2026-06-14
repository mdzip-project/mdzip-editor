import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  MdzipDiffView,
  type MdzipDiffControlsOptions,
  type MdzipDiffSelectionEvent,
  type MdzipDiffSideInput,
  type MdzipDiffToolbarAction
} from '@mdzip/editor/diff-view';

export interface MdzipDiffProps {
  before: MdzipDiffSideInput;
  after: MdzipDiffSideInput;
  initialPath?: string;
  showUnchanged?: boolean;
  navigationVisible?: boolean;
  controls?: MdzipDiffControlsOptions;
  toolbarActions?: readonly MdzipDiffToolbarAction[];
  onSelectionChanged?: (event: MdzipDiffSelectionEvent) => void;
  onFailed?: (error: Error) => void;
}

export interface MdzipDiffHandle {
  openPath(path: string): Promise<boolean>;
  openPreviousChange(): Promise<boolean>;
  openNextChange(): Promise<boolean>;
  setShowUnchanged(show: boolean): void;
  setNavigationVisible(visible: boolean): void;
  setToolbarActions(actions: readonly MdzipDiffToolbarAction[]): void;
}

export const MdzipDiff = forwardRef<MdzipDiffHandle, MdzipDiffProps>(
function MdzipDiff(props, forwardedRef) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MdzipDiffView | null>(null);
  const callbacksRef = useRef({
    onSelectionChanged: props.onSelectionChanged,
    onFailed: props.onFailed
  });
  callbacksRef.current = {
    onSelectionChanged: props.onSelectionChanged,
    onFailed: props.onFailed
  };
  const firstOpenRef = useRef(true);
  const initialOptionsRef = useRef({
    before: props.before,
    after: props.after,
    initialPath: props.initialPath,
    showUnchanged: props.showUnchanged,
    navigationVisible: props.navigationVisible,
    controls: props.controls,
    toolbarActions: props.toolbarActions
  });

  useImperativeHandle(forwardedRef, () => ({
    openPath: (path) => viewRef.current?.openPath(path) ?? Promise.resolve(false),
    openPreviousChange: () => viewRef.current?.openPreviousChange() ?? Promise.resolve(false),
    openNextChange: () => viewRef.current?.openNextChange() ?? Promise.resolve(false),
    setShowUnchanged: (show) => viewRef.current?.setShowUnchanged(show),
    setNavigationVisible: (visible) => viewRef.current?.setNavigationVisible(visible),
    setToolbarActions: (actions) => viewRef.current?.setToolbarActions(actions)
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const initial = initialOptionsRef.current;
    const view = new MdzipDiffView(hostRef.current, {
      before: initial.before,
      after: initial.after,
      initialPath: initial.initialPath,
      showUnchanged: initial.showUnchanged,
      navigationVisible: initial.navigationVisible,
      controls: initial.controls,
      toolbarActions: initial.toolbarActions,
      onSelectionChanged: (event) => callbacksRef.current.onSelectionChanged?.(event),
      onFailed: (error) => callbacksRef.current.onFailed?.(error)
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (firstOpenRef.current) {
      firstOpenRef.current = false;
      return;
    }
    void viewRef.current?.open({
      before: props.before,
      after: props.after,
      initialPath: props.initialPath,
      onSelectionChanged: (event) => callbacksRef.current.onSelectionChanged?.(event),
      onFailed: (error) => callbacksRef.current.onFailed?.(error)
    });
  }, [
    props.before,
    props.after,
    props.initialPath
  ]);

  useEffect(() => {
    viewRef.current?.setShowUnchanged(props.showUnchanged ?? true);
  }, [props.showUnchanged]);

  useEffect(() => {
    viewRef.current?.setNavigationVisible(props.navigationVisible ?? true);
  }, [props.navigationVisible]);

  useEffect(() => {
    viewRef.current?.setToolbarActions(props.toolbarActions ?? []);
  }, [props.toolbarActions]);

  return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
});
