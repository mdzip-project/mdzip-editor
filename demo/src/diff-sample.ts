import { SAMPLE_FILES } from './sample-files.js';

let baseBytesPromise: Promise<Uint8Array> | null = null;

/**
 * Fetches and caches the shared "before" sample used by every framework
 * tab's Diff mode, so switching frameworks never re-fetches it.
 */
export function loadDiffBaseBytes(): Promise<Uint8Array> {
  baseBytesPromise ??= (async () => {
    const sample = SAMPLE_FILES.find((f) => f.label === 'sample.mdz');
    if (!sample) throw new Error('Missing diff base sample.mdz in the samples folder');
    const response = await fetch(sample.url);
    if (!response.ok) throw new Error(`Failed to load diff base: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  })();
  return baseBytesPromise;
}
