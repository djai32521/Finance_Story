import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  resolve: {
    alias: {
      '@contracts': path.resolve(__dirname, 'contracts'),
      '@pipeline': path.resolve(__dirname, 'pipeline'),
      '@src': path.resolve(__dirname, 'src'),
      '@data': path.resolve(__dirname, 'data'),
      '@story': path.resolve(__dirname, 'story'),
    },
  },
  server: {
    port: 4173,
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4174',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('/data/transactions.json')) {
            return 'transactions';
          }
          if (id.includes('/data/') || id.includes('/story/')) {
            return 'data';
          }
          return undefined;
        },
      },
    },
  },
});
