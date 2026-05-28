import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { notionDevPlugin } from './notion-plugin.js';

export default defineConfig({
  plugins: [react(), notionDevPlugin()],
  server: {
    port: 5181,
  },
});
