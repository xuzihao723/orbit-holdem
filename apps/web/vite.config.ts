import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['socket.io-client'] },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/health': { target: 'http://127.0.0.1:3001' },
      '/api/auth': { target: 'http://127.0.0.1:3001' },
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': { target: 'http://127.0.0.1:3001' },
      '/api/auth': { target: 'http://127.0.0.1:3001' },
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
    },
  },
});
