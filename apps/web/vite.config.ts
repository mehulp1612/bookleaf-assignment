import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = { ...loadEnv(mode, root, ''), ...process.env };
  const apiPort = Number(env.PORT || 3000);
  const webPort = Number(env.WEB_PORT || 5173);
  for (const port of [apiPort, webPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT and WEB_PORT must be valid TCP ports.');
    }
  }
  return {
    plugins: [react()],
    // No server environment variables are injected into the browser bundle.
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}` },
        '/health': { target: `http://127.0.0.1:${apiPort}` },
      },
    },
  };
});
