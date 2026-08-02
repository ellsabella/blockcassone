import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './api.mjs';

// The dev/preview server shares the exact same API implementation as the production
// standalone server (server.mjs) via api.mjs — no drift between local and deployed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', ''); // repo-root .env (one level up)
  const api = {
    name: 'allowlist-api',
    configureServer: s => { const h = createApiHandler(env); s.middlewares.use(async (req, res, next) => { if (!(await h(req, res))) next(); }); },
    configurePreviewServer: s => { const h = createApiHandler(env); s.middlewares.use(async (req, res, next) => { if (!(await h(req, res))) next(); }); },
  };
  return {
    plugins: [react(), api],
    server: { port: 5173 },
    preview: { port: 5173 },
    // WalletConnect project id comes from the repo-root .env at build time (client value,
    // safe to embed) so it's a one-line .env change, not a source edit. See DEPLOY.md.
    define: { 'import.meta.env.VITE_WC_PROJECT_ID': JSON.stringify(env.WALLETCONNECT_PROJECT_ID || '') },
  };
});
