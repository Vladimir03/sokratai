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
}));
