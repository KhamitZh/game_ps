import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  server: { host: true, port: 5173, fs: { allow: [here('..')] } },
  build: {
    rollupOptions: { input: { main: here('index.html'), host: here('host.html') } },
  },
});
