import { createRouter, createWebHistory } from "vue-router";

import Satvis from "../components/Satvis.vue";

export const router = createRouter({
  history: createWebHistory(document.location.pathname.match(".*/")[0]),
  routes: [
    { path: "/", component: Satvis },
    { path: "/ot.html", component: Satvis, alias: "/ot" },
    { path: "/move.html", component: Satvis, alias: "/move" },
  ],
});
