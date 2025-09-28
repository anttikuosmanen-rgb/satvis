import { createApp, markRaw } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import Tooltip from "primevue/tooltip";
import Toast from "vue-toastification";
import * as Sentry from "@sentry/browser";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { faLayerGroup, faGlobeAfrica, faMobileAlt, faHammer, faEye } from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

import App from "./App.vue";
import { router } from "./router";
import piniaUrlSync from "./modules/util/pinia-plugin-url-sync.ts";
import { CesiumController } from "./modules/CesiumController";

function satvisSetup(customConfig = {}) {
  // Enable sentry for production version
  if (window.location.href.includes("satvis.space")) {
    Sentry.init({ dsn: "https://6c17c8b3e731026b3e9e0df0ecfc1b83@o294643.ingest.us.sentry.io/1541793" });
  }

  // Setup and init app
  const app = createApp(App);
  const cc = new CesiumController();
  app.config.globalProperties.cc = cc;
  const pinia = createPinia();
  pinia.use(({ store }) => {
    store.router = markRaw(router);
  });
  pinia.use(({ store }) => {
    store.customConfig = markRaw(customConfig);
  });
  pinia.use(piniaUrlSync);
  app.use(pinia);
  app.use(router);
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
    },
  });
  app.directive("tooltip", Tooltip);
  app.use(Toast, {
    position: "bottom-right",
  });
  library.add(faLayerGroup, faGlobeAfrica, faMobileAlt, faHammer, faEye, faGithub);
  app.component("FontAwesomeIcon", FontAwesomeIcon);
  app.mount("#app");

  return { app, cc };
}

export default satvisSetup;
