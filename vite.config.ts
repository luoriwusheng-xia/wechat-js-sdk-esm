import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite 8 库模式：只编译 ES Module。
 * - 不产出 CJS / UMD / IIFE。
 * - .d.ts 由 npm run build 中单独执行的 tsc 生成。
 * - Vite 8 以 Rolldown 为构建引擎；这里无需 rollupOptions。
 */
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: true,
    minify: false, // 保留构建结果可读性；需要更小产物可改为 'oxc'
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
});
