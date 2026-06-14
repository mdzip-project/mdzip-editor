import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const demoTsconfig = fileURLToPath(new URL('./tsconfig.json', import.meta.url));
const editorDist = fileURLToPath(new URL('../packages/editor/dist/index.js', import.meta.url));
const editorNgDist = fileURLToPath(
  new URL('../packages/editor-ng/dist/fesm2022/mdzip-editor-ng.mjs', import.meta.url)
);

export default defineConfig({
  plugins: [angular({ tsconfig: demoTsconfig })],
  resolve: {
    alias: {
      'mdzip-editor': editorDist,
      '@mdzip/editor-ng': editorNgDist,
    },
  },
  optimizeDeps: {
    include: ['zone.js'],
  },
});
