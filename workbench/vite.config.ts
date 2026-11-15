import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    react(), tailwindcss(),
    {
      name: 'paperclip-notice',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'paperclip-MIT.txt',
          source: readFileSync(new URL('../licenses/paperclip-MIT.txt', import.meta.url), 'utf8') });
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL('../dist/workbench', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
