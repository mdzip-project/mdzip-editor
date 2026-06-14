import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  MdzipDiffView,
  type MdzipDiffSelectionEvent,
  type MdzipDiffSideInput
} from '@mdzip/editor/diff-view';

export interface MdzipDiffProps {
  before: MdzipDiffSideInput;
  after: MdzipDiffSideInput;
  initialPath?: string;
  showUnchanged?: boolean;
  navigationVisible?: boolean;
  onSelectionChanged?: (event: MdzipDiffSelectionEvent) => void;
  onFailed?: (error: Error) => void;
}

export interface MdzipDiffHandle {
  openPath(path: string): Promise<boolean>;
  setShowUnchanged(show: boolean): void;
  setNavigationVisible(visible: boolean): void;
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
    navigationVisible: props.navigationVisible
  });

  useImperativeHandle(forwardedRef, () => ({
    openPath: (path) => viewRef.current?.openPath(path) ?? Promise.resolve(false),
    setShowUnchanged: (show) => viewRef.current?.setShowUnchanged(show),
    setNavigationVisible: (visible) => viewRef.current?.setNavigationVisible(visible)
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
      showUnchanged: props.showUnchanged,
      navigationVisible: props.navigationVisible,
      onSelectionChanged: (event) => callbacksRef.current.onSelectionChanged?.(event),
      onFailed: (error) => callbacksRef.current.onFailed?.(error)
    });
  }, [
    props.before,
    props.after,
    props.initialPath,
    props.showUnchanged,
    props.navigationVisible
  ]);

  return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
});
