import { createRouter, createWebHistory } from "vue-router";

import { getConfigPreset, updateMetadata } from "../config/presets";
import Satvis from "../components/Satvis.vue";

const base = document.location.pathname.match(".*/")[0];

export const router = createRouter({
  history: createWebHistory(base),
  routes: [
    { path: "/", component: Satvis, name: "default" },
    { path: "/move", component: Satvis, name: "move" },
    { path: "/ot", component: Satvis, name: "ot" },
    // Legacy routes for backward compatibility
    { path: "/index.html", redirect: "/" },
    { path: "/move.html", redirect: "/move" },
    { path: "/ot.html", redirect: "/ot" },
  ],
});

/**
 * Router guard to handle configuration changes when navigating between routes
 */
export function setupRouterGuards(router, cc) {
  router.beforeEach((to, from, next) => {
    // Get the new configuration preset based on the target route
    const preset = getConfigPreset(to.path);

    // Update document title and meta description
    updateMetadata(preset);

    // Load TLE data for the new route configuration
    cc.sats.addFromTleUrls(preset.tleData);

    next();
  });
}
