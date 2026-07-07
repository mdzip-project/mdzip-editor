import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const demoTsconfig = fileURLToPath(new URL('./tsconfig.json', import.meta.url));
const editorDist = fileURLToPath(new URL('../packages/editor/dist/index.js', import.meta.url));
const editorDiffDist = fileURLToPath(
  new URL('../packages/editor/dist/diff-view.js', import.meta.url)
);
const editorMermaidDist = fileURLToPath(
  new URL('../packages/editor/dist/mermaid.js', import.meta.url)
);
const editorNgDist = fileURLToPath(
  new URL('../packages/editor-ng/dist/fesm2022/mdzip-editor-ng.mjs', import.meta.url)
);

export default defineConfig({
  plugins: [angular({ tsconfig: demoTsconfig })],
  resolve: {
    alias: {
      'mdzip-editor/diff-view': editorDiffDist,
      'mdzip-editor/mermaid': editorMermaidDist,
      'mdzip-editor': editorDist,
      '@mdzip/editor-ng': editorNgDist,
    },
  },
  optimizeDeps: {
    include: ['zone.js'],
  },
});
