import {defineConfig} from 'vitest/config';

// Unit tests for shared code. The discount Function has its own vitest setup
// in extensions/free-gift-discount (it builds and runs the wasm).
export default defineConfig({
  test: {
    root: '.',
    include: ['shared/**/*.test.ts'],
  },
});
