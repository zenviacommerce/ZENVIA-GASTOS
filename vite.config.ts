import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    // iPadOS/Safari can lag desktop browsers by several ECMAScript releases.
    // Keep the production bundle conservative so older supported iPads do not
    // fail before React mounts and leave a blank screen.
    target: ['es2018', 'safari13'],
    cssTarget: 'safari13',
  }
});
