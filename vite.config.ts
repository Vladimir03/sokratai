import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

const projectRoot = path.resolve(__dirname);

// Bundle analyzer — gated by ANALYZE=1 env var (Phase 0 TASK-5, 2026-05-26).
// Run via `npm run analyze:visual` → выдаёт dist/stats.html treemap.
// Не в CI пока (отдельная задача после baseline measurement).
const ANALYZE = process.env.ANALYZE === "1";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  root: projectRoot,
  server: {
    host: "::",
    port: parseInt(process.env.PORT || '8080'),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mcpPlugin(),
    ANALYZE && visualizer({
      filename: "dist/stats.html",
      template: "treemap",   // sunburst | treemap | network
      gzipSize: true,
      brotliSize: true,
      open: false,           // не открывать автоматически — Vladimir сам решит
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
    },
  },
  build: {
    // Enable modulePreload for better resource loading
    modulePreload: {
      polyfill: true,
      resolveDependencies: (filename, deps) => {
        return deps;
      }
    },
    // Optimize chunk size for better loading with code splitting
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendor - loaded on every page
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-components': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-slot',
            '@radix-ui/react-toast'
          ],
          // Supabase - loaded on auth pages
          'supabase': ['@supabase/supabase-js'],
          // NOTE: katex/react-katex/react-markdown and recharts are intentionally
          // NOT in manualChunks. Forcing them into named chunks made Rollup hoist
          // them eagerly into the landing page's preload graph (~265KB wasted JS,
          // ~600ms main-thread on the landing). Letting Rollup auto-split keeps
          // them inside the lazy route chunks that actually use them.
        },
        // Optimize chunk names
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    // Target Safari 15+ and Chrome 90+ for cross-browser compatibility
    target: ['es2020', 'safari15', 'chrome90'],
    // Use default esbuild minifier (faster than terser)
    minify: 'esbuild',
    // Set chunk size warning limit
    chunkSizeWarningLimit: 600
  }
}));
