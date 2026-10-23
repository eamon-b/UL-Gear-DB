import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base + hash routing => works at any GitHub Pages subpath.
// Override with VITE_BASE=/repo-name/ if you prefer absolute asset URLs.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
});
