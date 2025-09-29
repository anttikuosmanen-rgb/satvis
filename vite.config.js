import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig({
  base: "",
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
        move: path.resolve(__dirname, "move.html"),
        ot: path.resolve(__dirname, "ot.html"),
        embedded: path.resolve(__dirname, "embedded.html"),
        test: path.resolve(__dirname, "test.html"),
      },
      output: {
        // Separate vendor chunks for better caching
        manualChunks: (id) => {
          if ((id.includes("vue") && !id.includes("primevue")) || id.includes("vue-router") || id.includes("pinia")) {
            return "vue-vendor";
          }
          if (id.includes("primevue") || id.includes("@primevue/themes") || id.includes("@primeuix")) {
            return "primevue-vendor";
          }
          if (id.includes("@fortawesome")) {
            return "icons-vendor";
          }
          if (id.includes("cesium")) {
            return "cesium-vendor";
          }
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
  define: {
    // Define relative base path in cesium for loading assets
    CESIUM_BASE_URL: JSON.stringify("./cesium"),
  },
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        // Copy Cesium Assets, Widgets, and Workers to a static directory
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
        // Copy data files
        { src: ["data/*", "!data/custom"], dest: "data" },
        { src: ["data/custom/dist/*"], dest: "data" },
      ],
    }),
    VitePWA({
      strategies: "generateSW",
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
        globPatterns: ["**/*.{css,html,js,png,svg}", "cesium/Assets/**/*.{jpg,png,xml,json}"],
        globIgnores: ["cesium/ThirdParty/**/*", "cesium/Widgets/**/*", "cesium/Workers/**/*", "cesium/Assets/Textures/maki/*", "**/*.map"],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /cesium\/(Assets|Widgets|Workers)\/.*\.(css|js|json|jpg)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "cesium-cache",
              expiration: {
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /data\/cesium-assets\/imagery\/.*\.(jpg|png|xml)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "cesium-tile-cache",
              expiration: {
                maxEntries: 20000,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                purgeOnQuotaError: true,
              },
            },
          },
          {
            urlPattern: /data\/tle\/.*\.txt$/,
            handler: "CacheFirst",
            // handler: "StaleWhileRevalidate",
            options: {
              cacheName: "satellite-data-cache",
              expiration: {
                maxAgeSeconds: 48 * 60 * 60, // 2 days
                maxEntries: 50,
              },
            },
          },
        ],
      },
      manifest: {
        name: "Satellite Orbit Visualization",
        short_name: "SatVis",
        description: "Satellite Orbit Visualization with CesiumJS",
        start_url: "/",
        scope: "/",
        id: "satvis.space",
        orientation: "natural",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#0B222D",
      },
      pwaAssets: {
        htmlPreset: "2023",
        preset: {
          transparent: {
            sizes: [64, 192, 512],
            favicons: [[48, "favicon.ico"]],
          },
          maskable: {
            sizes: [512],
            padding: 0,
          },
          apple: {
            sizes: [180],
            padding: 0,
          },
        },
        image: "public/logo.svg",
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
});
