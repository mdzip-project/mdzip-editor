// Auto-discovers sample .mdz/.md files from the designated samples folder at
// build time, so the "Open" dropdown always lists whatever's in ./assets
// without needing a manually maintained list.
//
// ./assets is empty in a fresh checkout: the sample content belongs to
// mdzip.org (the site), not this library, so it isn't committed here.
// mdzip.org's build-demo.mjs copies its own editor-demo/samples/ into this
// folder before building. For local/standalone testing, drop your own
// .md/.mdz files in ./assets — they'll show up in the dropdown.
const modules = import.meta.glob('./assets/*.{md,mdz}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface SampleFile {
  label: string;
  url: string;
}

export const SAMPLE_FILES: SampleFile[] = Object.entries(modules)
  .map(([path, url]) => ({ label: path.replace('./assets/', ''), url }))
  .sort((a, b) => a.label.localeCompare(b.label));
