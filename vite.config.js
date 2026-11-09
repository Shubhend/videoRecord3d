import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { rawVideosPlugin } from './vite.rawVideos.js';

export default defineConfig({
  base: './',
  plugins: [react(), rawVideosPlugin(__dirname)],
  server: {
    port: 3003,
    strictPort: true,
  },
  resolve: {
    alias: {
      'mindar-face-three': resolve(__dirname, 'node_modules/mind-ar/dist/mindar-face-three.prod.js'),
    },
  },
  build: {
    outDir: 'dist',
    // NOTE: minification disabled intentionally for diagnostic clarity.
    // MindAR bundles its own @mediapipe/tasks-vision WASM + Emscripten glue; any
    // aggressive property/identifier mangling can break WebAssembly import name
    // matching and trigger LinkError on instantiate (see prior _emval_new_array
    // and __cxa_allocate_exception crashes). Once this build is confirmed
    // stable, you can re-enable `minify: 'esbuild'` as a lower-risk option.
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        legacyIndex: resolve(__dirname, 'legacy-index.html'),
        models: resolve(__dirname, 'models.html'),
        settings: resolve(__dirname, 'settings.html'),
        cameras: resolve(__dirname, 'cameras.html'),
        faceFollow: resolve(__dirname, 'face-follow.html'),
        record: resolve(__dirname, 'record.html'),
      },
      output: {
        entryFileNames: 'assets/app.[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash].[ext]',
      },
    },
    copyPublicDir: true,
  },
  publicDir: 'public',
});
