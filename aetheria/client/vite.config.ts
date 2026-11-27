import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WORKSPACE_ROOT, '');
  const apiPort = env.PORT || '3002';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@aetheria/shared': path.resolve(__dirname, '../shared/src/index.ts')
      }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (_err, _req, res) => {
              if (res && 'writeHead' in res && !res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: `Backend server (port ${apiPort}) is not running. Start the full app with \`npm run dev\` in the aetheria folder.`
                  })
                );
              }
            });
          }
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom', 'zustand'],
            leaflet: ['leaflet'],
            recharts: ['recharts']
          }
        }
      }
    }
  };
});
