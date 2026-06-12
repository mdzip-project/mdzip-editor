import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Angular decorators need the legacy decorator transform; tests run the
  // JIT compiler (via the '@angular/compiler' import in the test file), so
  // no ng build is required to test the source.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts']
  }
});
