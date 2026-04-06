// vite.config.ts
import { defineConfig } from "file:///sessions/optimistic-keen-davinci/mnt/sokratai/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/optimistic-keen-davinci/mnt/sokratai/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///sessions/optimistic-keen-davinci/mnt/sokratai/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/sessions/optimistic-keen-davinci/mnt/sokratai";
var projectRoot = path.resolve(__vite_injected_original_dirname);
var vite_config_default = defineConfig(({ mode }) => ({
  root: projectRoot,
  server: {
    host: "::",
    port: 8080
  },
  plugins: [
    react(),
    mode === "development" && componentTagger()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src")
    }
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
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-components": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-slot",
            "@radix-ui/react-toast"
          ],
          // Supabase - loaded on auth pages
          "supabase": ["@supabase/supabase-js"],
          // Math/LaTeX - loaded only on Chat/student pages
          "math-rendering": ["katex", "react-katex", "react-markdown"],
          // Animations - separate chunk, only loaded by pages that need it
          "animations": ["framer-motion"],
          // Charts - loaded only on admin/analytics pages
          "charts": ["recharts"]
        },
        // Optimize chunk names
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]"
      }
    },
    // Target Safari 15+ and Chrome 90+ for cross-browser compatibility
    target: ["es2020", "safari15", "chrome90"],
    // Use default esbuild minifier (faster than terser)
    minify: "esbuild",
    // Set chunk size warning limit
    chunkSizeWarningLimit: 600
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvb3B0aW1pc3RpYy1rZWVuLWRhdmluY2kvbW50L3Nva3JhdGFpXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvb3B0aW1pc3RpYy1rZWVuLWRhdmluY2kvbW50L3Nva3JhdGFpL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9vcHRpbWlzdGljLWtlZW4tZGF2aW5jaS9tbnQvc29rcmF0YWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0LXN3Y1wiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xyXG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcclxuXHJcbmNvbnN0IHByb2plY3RSb290ID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSk7XHJcblxyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4gKHtcclxuICByb290OiBwcm9qZWN0Um9vdCxcclxuICBzZXJ2ZXI6IHtcclxuICAgIGhvc3Q6IFwiOjpcIixcclxuICAgIHBvcnQ6IDgwODAsXHJcbiAgfSxcclxuICBwbHVnaW5zOiBbXHJcbiAgICByZWFjdCgpLCBcclxuICAgIG1vZGUgPT09IFwiZGV2ZWxvcG1lbnRcIiAmJiBjb21wb25lbnRUYWdnZXIoKSxcclxuICBdLmZpbHRlcihCb29sZWFuKSxcclxuICByZXNvbHZlOiB7XHJcbiAgICBhbGlhczoge1xyXG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKHByb2plY3RSb290LCBcInNyY1wiKSxcclxuICAgIH0sXHJcbiAgfSxcclxuICBidWlsZDoge1xyXG4gICAgLy8gRW5hYmxlIG1vZHVsZVByZWxvYWQgZm9yIGJldHRlciByZXNvdXJjZSBsb2FkaW5nXHJcbiAgICBtb2R1bGVQcmVsb2FkOiB7XHJcbiAgICAgIHBvbHlmaWxsOiB0cnVlLFxyXG4gICAgICByZXNvbHZlRGVwZW5kZW5jaWVzOiAoZmlsZW5hbWUsIGRlcHMpID0+IHtcclxuICAgICAgICByZXR1cm4gZGVwcztcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIC8vIE9wdGltaXplIGNodW5rIHNpemUgZm9yIGJldHRlciBsb2FkaW5nIHdpdGggY29kZSBzcGxpdHRpbmdcclxuICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICAvLyBDb3JlIHZlbmRvciAtIGxvYWRlZCBvbiBldmVyeSBwYWdlXHJcbiAgICAgICAgICAncmVhY3QtdmVuZG9yJzogWydyZWFjdCcsICdyZWFjdC1kb20nLCAncmVhY3Qtcm91dGVyLWRvbSddLFxyXG4gICAgICAgICAgJ3VpLWNvbXBvbmVudHMnOiBbXHJcbiAgICAgICAgICAgICdAcmFkaXgtdWkvcmVhY3QtZGlhbG9nJyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1kcm9wZG93bi1tZW51JyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1zbG90JyxcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC10b2FzdCdcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICAvLyBTdXBhYmFzZSAtIGxvYWRlZCBvbiBhdXRoIHBhZ2VzXHJcbiAgICAgICAgICAnc3VwYWJhc2UnOiBbJ0BzdXBhYmFzZS9zdXBhYmFzZS1qcyddLFxyXG4gICAgICAgICAgLy8gTWF0aC9MYVRlWCAtIGxvYWRlZCBvbmx5IG9uIENoYXQvc3R1ZGVudCBwYWdlc1xyXG4gICAgICAgICAgJ21hdGgtcmVuZGVyaW5nJzogWydrYXRleCcsICdyZWFjdC1rYXRleCcsICdyZWFjdC1tYXJrZG93biddLFxyXG4gICAgICAgICAgLy8gQW5pbWF0aW9ucyAtIHNlcGFyYXRlIGNodW5rLCBvbmx5IGxvYWRlZCBieSBwYWdlcyB0aGF0IG5lZWQgaXRcclxuICAgICAgICAgICdhbmltYXRpb25zJzogWydmcmFtZXItbW90aW9uJ10sXHJcbiAgICAgICAgICAvLyBDaGFydHMgLSBsb2FkZWQgb25seSBvbiBhZG1pbi9hbmFseXRpY3MgcGFnZXNcclxuICAgICAgICAgICdjaGFydHMnOiBbJ3JlY2hhcnRzJ10sXHJcbiAgICAgICAgfSxcclxuICAgICAgICAvLyBPcHRpbWl6ZSBjaHVuayBuYW1lc1xyXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgIGFzc2V0RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uW2V4dF0nXHJcbiAgICAgIH1cclxuICAgIH0sXHJcbiAgICAvLyBUYXJnZXQgU2FmYXJpIDE1KyBhbmQgQ2hyb21lIDkwKyBmb3IgY3Jvc3MtYnJvd3NlciBjb21wYXRpYmlsaXR5XHJcbiAgICB0YXJnZXQ6IFsnZXMyMDIwJywgJ3NhZmFyaTE1JywgJ2Nocm9tZTkwJ10sXHJcbiAgICAvLyBVc2UgZGVmYXVsdCBlc2J1aWxkIG1pbmlmaWVyIChmYXN0ZXIgdGhhbiB0ZXJzZXIpXHJcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcclxuICAgIC8vIFNldCBjaHVuayBzaXplIHdhcm5pbmcgbGltaXRcclxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogNjAwXHJcbiAgfVxyXG59KSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBNFQsU0FBUyxvQkFBb0I7QUFDelYsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHVCQUF1QjtBQUhoQyxJQUFNLG1DQUFtQztBQUt6QyxJQUFNLGNBQWMsS0FBSyxRQUFRLGdDQUFTO0FBSTFDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUEsRUFDekMsTUFBTTtBQUFBLEVBQ04sUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1I7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFNBQVMsaUJBQWlCLGdCQUFnQjtBQUFBLEVBQzVDLEVBQUUsT0FBTyxPQUFPO0FBQUEsRUFDaEIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsYUFBYSxLQUFLO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUE7QUFBQSxJQUVMLGVBQWU7QUFBQSxNQUNiLFVBQVU7QUFBQSxNQUNWLHFCQUFxQixDQUFDLFVBQVUsU0FBUztBQUN2QyxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFBQTtBQUFBLElBRUEsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBO0FBQUEsVUFFWixnQkFBZ0IsQ0FBQyxTQUFTLGFBQWEsa0JBQWtCO0FBQUEsVUFDekQsaUJBQWlCO0FBQUEsWUFDZjtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFVBQ0Y7QUFBQTtBQUFBLFVBRUEsWUFBWSxDQUFDLHVCQUF1QjtBQUFBO0FBQUEsVUFFcEMsa0JBQWtCLENBQUMsU0FBUyxlQUFlLGdCQUFnQjtBQUFBO0FBQUEsVUFFM0QsY0FBYyxDQUFDLGVBQWU7QUFBQTtBQUFBLFVBRTlCLFVBQVUsQ0FBQyxVQUFVO0FBQUEsUUFDdkI7QUFBQTtBQUFBLFFBRUEsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsTUFDbEI7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUVBLFFBQVEsQ0FBQyxVQUFVLFlBQVksVUFBVTtBQUFBO0FBQUEsSUFFekMsUUFBUTtBQUFBO0FBQUEsSUFFUix1QkFBdUI7QUFBQSxFQUN6QjtBQUNGLEVBQUU7IiwKICAibmFtZXMiOiBbXQp9Cg==
