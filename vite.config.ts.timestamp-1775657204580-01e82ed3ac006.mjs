// vite.config.ts
import { defineConfig } from "file:///sessions/blissful-kind-dijkstra/mnt/sokratai/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/blissful-kind-dijkstra/mnt/sokratai/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///sessions/blissful-kind-dijkstra/mnt/sokratai/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/sessions/blissful-kind-dijkstra/mnt/sokratai";
var projectRoot = path.resolve(__vite_injected_original_dirname);
var vite_config_default = defineConfig(({ mode }) => ({
  root: projectRoot,
  server: {
    host: "::",
    port: parseInt(process.env.PORT || "8080")
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvYmxpc3NmdWwta2luZC1kaWprc3RyYS9tbnQvc29rcmF0YWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy9ibGlzc2Z1bC1raW5kLWRpamtzdHJhL21udC9zb2tyYXRhaS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvYmxpc3NmdWwta2luZC1kaWprc3RyYS9tbnQvc29rcmF0YWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0LXN3Y1wiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xyXG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcclxuXHJcbmNvbnN0IHByb2plY3RSb290ID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSk7XHJcblxyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4gKHtcclxuICByb290OiBwcm9qZWN0Um9vdCxcclxuICBzZXJ2ZXI6IHtcclxuICAgIGhvc3Q6IFwiOjpcIixcclxuICAgIHBvcnQ6IHBhcnNlSW50KHByb2Nlc3MuZW52LlBPUlQgfHwgJzgwODAnKSxcclxuICB9LFxyXG4gIHBsdWdpbnM6IFtcclxuICAgIHJlYWN0KCksIFxyXG4gICAgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpLFxyXG4gIF0uZmlsdGVyKEJvb2xlYW4pLFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUocHJvamVjdFJvb3QsIFwic3JjXCIpLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIGJ1aWxkOiB7XHJcbiAgICAvLyBFbmFibGUgbW9kdWxlUHJlbG9hZCBmb3IgYmV0dGVyIHJlc291cmNlIGxvYWRpbmdcclxuICAgIG1vZHVsZVByZWxvYWQ6IHtcclxuICAgICAgcG9seWZpbGw6IHRydWUsXHJcbiAgICAgIHJlc29sdmVEZXBlbmRlbmNpZXM6IChmaWxlbmFtZSwgZGVwcykgPT4ge1xyXG4gICAgICAgIHJldHVybiBkZXBzO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gICAgLy8gT3B0aW1pemUgY2h1bmsgc2l6ZSBmb3IgYmV0dGVyIGxvYWRpbmcgd2l0aCBjb2RlIHNwbGl0dGluZ1xyXG4gICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICBvdXRwdXQ6IHtcclxuICAgICAgICBtYW51YWxDaHVua3M6IHtcclxuICAgICAgICAgIC8vIENvcmUgdmVuZG9yIC0gbG9hZGVkIG9uIGV2ZXJ5IHBhZ2VcclxuICAgICAgICAgICdyZWFjdC12ZW5kb3InOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXHJcbiAgICAgICAgICAndWktY29tcG9uZW50cyc6IFtcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1kaWFsb2cnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWRyb3Bkb3duLW1lbnUnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNsb3QnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXRvYXN0J1xyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIC8vIFN1cGFiYXNlIC0gbG9hZGVkIG9uIGF1dGggcGFnZXNcclxuICAgICAgICAgICdzdXBhYmFzZSc6IFsnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJ10sXHJcbiAgICAgICAgICAvLyBNYXRoL0xhVGVYIC0gbG9hZGVkIG9ubHkgb24gQ2hhdC9zdHVkZW50IHBhZ2VzXHJcbiAgICAgICAgICAnbWF0aC1yZW5kZXJpbmcnOiBbJ2thdGV4JywgJ3JlYWN0LWthdGV4JywgJ3JlYWN0LW1hcmtkb3duJ10sXHJcbiAgICAgICAgICAvLyBDaGFydHMgLSBsb2FkZWQgb25seSBvbiBhZG1pbi9hbmFseXRpY3MgcGFnZXNcclxuICAgICAgICAgICdjaGFydHMnOiBbJ3JlY2hhcnRzJ10sXHJcbiAgICAgICAgfSxcclxuICAgICAgICAvLyBPcHRpbWl6ZSBjaHVuayBuYW1lc1xyXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgIGFzc2V0RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uW2V4dF0nXHJcbiAgICAgIH1cclxuICAgIH0sXHJcbiAgICAvLyBUYXJnZXQgU2FmYXJpIDE1KyBhbmQgQ2hyb21lIDkwKyBmb3IgY3Jvc3MtYnJvd3NlciBjb21wYXRpYmlsaXR5XHJcbiAgICB0YXJnZXQ6IFsnZXMyMDIwJywgJ3NhZmFyaTE1JywgJ2Nocm9tZTkwJ10sXHJcbiAgICAvLyBVc2UgZGVmYXVsdCBlc2J1aWxkIG1pbmlmaWVyIChmYXN0ZXIgdGhhbiB0ZXJzZXIpXHJcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcclxuICAgIC8vIFNldCBjaHVuayBzaXplIHdhcm5pbmcgbGltaXRcclxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogNjAwXHJcbiAgfVxyXG59KSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBeVQsU0FBUyxvQkFBb0I7QUFDdFYsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHVCQUF1QjtBQUhoQyxJQUFNLG1DQUFtQztBQUt6QyxJQUFNLGNBQWMsS0FBSyxRQUFRLGdDQUFTO0FBSTFDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUEsRUFDekMsTUFBTTtBQUFBLEVBQ04sUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTSxTQUFTLFFBQVEsSUFBSSxRQUFRLE1BQU07QUFBQSxFQUMzQztBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sU0FBUyxpQkFBaUIsZ0JBQWdCO0FBQUEsRUFDNUMsRUFBRSxPQUFPLE9BQU87QUFBQSxFQUNoQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxhQUFhLEtBQUs7QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQTtBQUFBLElBRUwsZUFBZTtBQUFBLE1BQ2IsVUFBVTtBQUFBLE1BQ1YscUJBQXFCLENBQUMsVUFBVSxTQUFTO0FBQ3ZDLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSxlQUFlO0FBQUEsTUFDYixRQUFRO0FBQUEsUUFDTixjQUFjO0FBQUE7QUFBQSxVQUVaLGdCQUFnQixDQUFDLFNBQVMsYUFBYSxrQkFBa0I7QUFBQSxVQUN6RCxpQkFBaUI7QUFBQSxZQUNmO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRjtBQUFBO0FBQUEsVUFFQSxZQUFZLENBQUMsdUJBQXVCO0FBQUE7QUFBQSxVQUVwQyxrQkFBa0IsQ0FBQyxTQUFTLGVBQWUsZ0JBQWdCO0FBQUE7QUFBQSxVQUUzRCxVQUFVLENBQUMsVUFBVTtBQUFBLFFBQ3ZCO0FBQUE7QUFBQSxRQUVBLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSxRQUFRLENBQUMsVUFBVSxZQUFZLFVBQVU7QUFBQTtBQUFBLElBRXpDLFFBQVE7QUFBQTtBQUFBLElBRVIsdUJBQXVCO0FBQUEsRUFDekI7QUFDRixFQUFFOyIsCiAgIm5hbWVzIjogW10KfQo=
