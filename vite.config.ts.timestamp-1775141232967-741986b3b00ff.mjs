// vite.config.ts
import { defineConfig } from "file:///sessions/tender-affectionate-lamport/mnt/sokratai/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/tender-affectionate-lamport/mnt/sokratai/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///sessions/tender-affectionate-lamport/mnt/sokratai/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/sessions/tender-affectionate-lamport/mnt/sokratai";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvdGVuZGVyLWFmZmVjdGlvbmF0ZS1sYW1wb3J0L21udC9zb2tyYXRhaVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL3RlbmRlci1hZmZlY3Rpb25hdGUtbGFtcG9ydC9tbnQvc29rcmF0YWkvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL3RlbmRlci1hZmZlY3Rpb25hdGUtbGFtcG9ydC9tbnQvc29rcmF0YWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0LXN3Y1wiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xyXG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcclxuXHJcbmNvbnN0IHByb2plY3RSb290ID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSk7XHJcblxyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4gKHtcclxuICByb290OiBwcm9qZWN0Um9vdCxcclxuICBzZXJ2ZXI6IHtcclxuICAgIGhvc3Q6IFwiOjpcIixcclxuICAgIHBvcnQ6IHBhcnNlSW50KHByb2Nlc3MuZW52LlBPUlQgfHwgJzgwODAnKSxcclxuICB9LFxyXG4gIHBsdWdpbnM6IFtcclxuICAgIHJlYWN0KCksIFxyXG4gICAgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpLFxyXG4gIF0uZmlsdGVyKEJvb2xlYW4pLFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUocHJvamVjdFJvb3QsIFwic3JjXCIpLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIGJ1aWxkOiB7XHJcbiAgICAvLyBFbmFibGUgbW9kdWxlUHJlbG9hZCBmb3IgYmV0dGVyIHJlc291cmNlIGxvYWRpbmdcclxuICAgIG1vZHVsZVByZWxvYWQ6IHtcclxuICAgICAgcG9seWZpbGw6IHRydWUsXHJcbiAgICAgIHJlc29sdmVEZXBlbmRlbmNpZXM6IChmaWxlbmFtZSwgZGVwcykgPT4ge1xyXG4gICAgICAgIHJldHVybiBkZXBzO1xyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gICAgLy8gT3B0aW1pemUgY2h1bmsgc2l6ZSBmb3IgYmV0dGVyIGxvYWRpbmcgd2l0aCBjb2RlIHNwbGl0dGluZ1xyXG4gICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICBvdXRwdXQ6IHtcclxuICAgICAgICBtYW51YWxDaHVua3M6IHtcclxuICAgICAgICAgIC8vIENvcmUgdmVuZG9yIC0gbG9hZGVkIG9uIGV2ZXJ5IHBhZ2VcclxuICAgICAgICAgICdyZWFjdC12ZW5kb3InOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXHJcbiAgICAgICAgICAndWktY29tcG9uZW50cyc6IFtcclxuICAgICAgICAgICAgJ0ByYWRpeC11aS9yZWFjdC1kaWFsb2cnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LWRyb3Bkb3duLW1lbnUnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXNsb3QnLFxyXG4gICAgICAgICAgICAnQHJhZGl4LXVpL3JlYWN0LXRvYXN0J1xyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIC8vIFN1cGFiYXNlIC0gbG9hZGVkIG9uIGF1dGggcGFnZXNcclxuICAgICAgICAgICdzdXBhYmFzZSc6IFsnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJ10sXHJcbiAgICAgICAgICAvLyBNYXRoL0xhVGVYIC0gbG9hZGVkIG9ubHkgb24gQ2hhdC9zdHVkZW50IHBhZ2VzXHJcbiAgICAgICAgICAnbWF0aC1yZW5kZXJpbmcnOiBbJ2thdGV4JywgJ3JlYWN0LWthdGV4JywgJ3JlYWN0LW1hcmtkb3duJ10sXHJcbiAgICAgICAgICAvLyBBbmltYXRpb25zIC0gc2VwYXJhdGUgY2h1bmssIG9ubHkgbG9hZGVkIGJ5IHBhZ2VzIHRoYXQgbmVlZCBpdFxyXG4gICAgICAgICAgJ2FuaW1hdGlvbnMnOiBbJ2ZyYW1lci1tb3Rpb24nXSxcclxuICAgICAgICAgIC8vIENoYXJ0cyAtIGxvYWRlZCBvbmx5IG9uIGFkbWluL2FuYWx5dGljcyBwYWdlc1xyXG4gICAgICAgICAgJ2NoYXJ0cyc6IFsncmVjaGFydHMnXSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIE9wdGltaXplIGNodW5rIG5hbWVzXHJcbiAgICAgICAgY2h1bmtGaWxlTmFtZXM6ICdhc3NldHMvW25hbWVdLVtoYXNoXS5qcycsXHJcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdhc3NldHMvW25hbWVdLVtoYXNoXS5qcycsXHJcbiAgICAgICAgYXNzZXRGaWxlTmFtZXM6ICdhc3NldHMvW25hbWVdLVtoYXNoXS5bZXh0XSdcclxuICAgICAgfVxyXG4gICAgfSxcclxuICAgIC8vIFRhcmdldCBTYWZhcmkgMTUrIGFuZCBDaHJvbWUgOTArIGZvciBjcm9zcy1icm93c2VyIGNvbXBhdGliaWxpdHlcclxuICAgIHRhcmdldDogWydlczIwMjAnLCAnc2FmYXJpMTUnLCAnY2hyb21lOTAnXSxcclxuICAgIC8vIFVzZSBkZWZhdWx0IGVzYnVpbGQgbWluaWZpZXIgKGZhc3RlciB0aGFuIHRlcnNlcilcclxuICAgIG1pbmlmeTogJ2VzYnVpbGQnLFxyXG4gICAgLy8gU2V0IGNodW5rIHNpemUgd2FybmluZyBsaW1pdFxyXG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiA2MDBcclxuICB9XHJcbn0pKTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF3VSxTQUFTLG9CQUFvQjtBQUNyVyxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsdUJBQXVCO0FBSGhDLElBQU0sbUNBQW1DO0FBS3pDLElBQU0sY0FBYyxLQUFLLFFBQVEsZ0NBQVM7QUFJMUMsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE9BQU87QUFBQSxFQUN6QyxNQUFNO0FBQUEsRUFDTixRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNLFNBQVMsUUFBUSxJQUFJLFFBQVEsTUFBTTtBQUFBLEVBQzNDO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixTQUFTLGlCQUFpQixnQkFBZ0I7QUFBQSxFQUM1QyxFQUFFLE9BQU8sT0FBTztBQUFBLEVBQ2hCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGFBQWEsS0FBSztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBO0FBQUEsSUFFTCxlQUFlO0FBQUEsTUFDYixVQUFVO0FBQUEsTUFDVixxQkFBcUIsQ0FBQyxVQUFVLFNBQVM7QUFDdkMsZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUVBLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQTtBQUFBLFVBRVosZ0JBQWdCLENBQUMsU0FBUyxhQUFhLGtCQUFrQjtBQUFBLFVBQ3pELGlCQUFpQjtBQUFBLFlBQ2Y7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFlBQ0E7QUFBQSxVQUNGO0FBQUE7QUFBQSxVQUVBLFlBQVksQ0FBQyx1QkFBdUI7QUFBQTtBQUFBLFVBRXBDLGtCQUFrQixDQUFDLFNBQVMsZUFBZSxnQkFBZ0I7QUFBQTtBQUFBLFVBRTNELGNBQWMsQ0FBQyxlQUFlO0FBQUE7QUFBQSxVQUU5QixVQUFVLENBQUMsVUFBVTtBQUFBLFFBQ3ZCO0FBQUE7QUFBQSxRQUVBLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSxRQUFRLENBQUMsVUFBVSxZQUFZLFVBQVU7QUFBQTtBQUFBLElBRXpDLFFBQVE7QUFBQTtBQUFBLElBRVIsdUJBQXVCO0FBQUEsRUFDekI7QUFDRixFQUFFOyIsCiAgIm5hbWVzIjogW10KfQo=
