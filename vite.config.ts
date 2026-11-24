import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { iaPlugin } from './servidor/ia.ts';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // No site publicado (GitHub Pages) os arquivos ficam numa subpasta: caminhos relativos.
    base: command === 'build' ? './' : '/',
    plugins: [react(), iaPlugin(env)],
    server: { port: 5173, open: true },
    test: { environment: 'node' },
  };
});
