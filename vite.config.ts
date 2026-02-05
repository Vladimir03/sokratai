import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Plugin to make CSS non-render-blocking
function asyncCssPlugin() {
  return {
    name: 'async-css',
    transformIndexHtml(html: string) {
      // Transform CSS link tags to load asynchronously
      return html.replace(
        /<link([^>]*?)rel="stylesheet"([^>]*?)>/g,
        '<link$1rel="preload"$2 as="style" onload="this.onload=null;this.rel=\'stylesheet\'"><noscript><link$1rel="stylesheet"$2></noscript>'
      );
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    asyncCssPlugin()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
          // Math/LaTeX - loaded only on Chat/student pages
          'math-rendering': ['katex', 'react-katex', 'react-markdown'],
          // Animations - separate chunk, only loaded by pages that need it
          'animations': ['framer-motion'],
          // Charts - loaded only on admin/analytics pages
          'charts': ['recharts'],
        },
        // Optimize chunk names
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    // Use default esbuild minifier (faster than terser)
    minify: 'esbuild',
    // Set chunk size warning limit
    chunkSizeWarningLimit: 600
  }
}));
