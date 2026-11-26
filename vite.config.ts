import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Keep stable vendors separate from the eagerly bundled route screens.
          // Earlier versions used lazy screen chunks; this produced a first-tap loading flash.
          // 
          // the per-screen React.lazy splits are real (45 chunks) -- but a clean
          // build still produced a single 1,516 kB entry chunk, because every
          // third-party library was bundled into it alongside App.tsx. Splitting
          // the big, rarely-changing vendors out means a code change no longer
          // invalidates them in the browser/WebView cache, which is what
          // actually costs time on an Android cold start after an app update.
          manualChunks: {
            "vendor-react": ["react", "react-dom"],
            "vendor-supabase": ["@supabase/supabase-js"],
            "vendor-sqlite": ["sql.js"],
            "vendor-icons": ["lucide-react"],
            "vendor-scanner": ["@zxing/browser"],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
