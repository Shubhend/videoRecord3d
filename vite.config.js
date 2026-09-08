import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      'mindar-face-three': resolve(__dirname, 'node_modules/mind-ar/dist/mindar-face-three.prod.js'),
    },
  },
  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
      mangle: {
        toplevel: true,
        // NOTE: property mangling DISABLED intentionally.
        // MindAR + bundled MediaPipe Tasks WASM glue code uses a set of known
        // property-name strings (e.g. "__cxa_allocate_exception", "env") on the
        // Emscripten module object to resolve WASM function imports. Mangling
        // those property names breaks the import resolution and triggers:
        //   LinkError: Import #N "env" "__cxa_*": function import requires a callable.
        // Local / toplevel variable mangling still applies via toplevel: true.
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        legacyIndex: resolve(__dirname, 'legacy-index.html'),
        models: resolve(__dirname, 'models.html'),
        settings: resolve(__dirname, 'settings.html'),
        cameras: resolve(__dirname, 'cameras.html'),
        faceFollow: resolve(__dirname, 'face-follow.html'),
        record: resolve(__dirname, 'record.html')
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
