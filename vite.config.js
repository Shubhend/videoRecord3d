import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/edge_ai/',
  server: {
    allowedHosts: ['video.lovetoreads.com']
  },
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
        properties: {
          regex: /^_/,
        },
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        models: resolve(__dirname, 'models.html'),
        settings: resolve(__dirname, 'settings.html'),
        cameras: resolve(__dirname, 'cameras.html'),
        faceFollow: resolve(__dirname, 'face-follow.html')
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
