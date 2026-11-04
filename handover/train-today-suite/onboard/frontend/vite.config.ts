import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      // Proxy only in local development. In production configure your reverse proxy.
      proxy: env.VITE_DEV_API_PROXY_TARGET ? {
        '/api': { target: env.VITE_DEV_API_PROXY_TARGET, changeOrigin: true, secure: true },
      } : undefined,
    },
  };
});
