import { ref } from "vue";
import { registerSW } from "virtual:pwa-register";

interface UsePWAUpdateOptions {
  /**
   * Whether to automatically reload the app when a new version is detected.
   * @default false
   */
  autoUpdate?: boolean;
  /**
   * Interval in seconds to check for updates.
   * Set to 0 to disable periodic checks.
   * @default 86400 (24 hours)
   */
  updateInterval?: number;
}

/**
 * Composable for managing PWA service worker updates.
 *
 * @param options - Configuration options
 * @returns Object containing PWA update state and methods
 *
 * @example
 * // Automatic updates (recommended for production)
 * const { registerPWA } = usePWAUpdate({ autoUpdate: true });
 * registerPWA();
 *
 * @example
 * // Manual updates with UI notification
 * const { needRefresh, updateApp, registerPWA } = usePWAUpdate();
 * registerPWA();
 * // In your component, watch needRefresh and show update prompt
 * watch(needRefresh, (value) => {
 *   if (value) {
 *     // Show toast/dialog asking user to update
 *     updateApp(); // Call this when user confirms
 *   }
 * });
 */
export function usePWAUpdate(options: UsePWAUpdateOptions = {}) {
  const { autoUpdate = false, updateInterval = 60 * 60 * 24 } = options;

  const needRefresh = ref(false);
  const offlineReady = ref(false);
  const updateSW = ref<((reloadPage?: boolean) => Promise<void>) | undefined>();

  const updateApp = async () => {
    if (updateSW.value) {
      try {
        await updateSW.value(true);
        needRefresh.value = false;
      } catch (error) {
        console.error("PWA: Failed to update app:", error);
      }
    }
  };

  const onNeedRefresh = () => {
    console.log("PWA: Update available - need refresh");
    needRefresh.value = true;

    if (autoUpdate) {
      console.log("PWA: Auto-update enabled, updating app...");
      updateApp();
    }
  };

  const onOfflineReady = () => {
    console.log("PWA: App is ready to work offline");
    offlineReady.value = true;
  };

  const onRegistered = (registration: ServiceWorkerRegistration | undefined) => {
    console.log("PWA: Service worker registered successfully");

    // Set up periodic update checks
    if (registration && updateInterval > 0) {
      setInterval(() => {
        console.log("PWA: Checking for updates...");
        registration.update();
      }, updateInterval * 1000);
    }
  };

  const onRegisterError = (error: Error) => {
    console.error("PWA: Service worker registration error:", error);
  };

  const registerPWA = () => {
    const update = registerSW({
      onNeedRefresh,
      onOfflineReady,
      onRegistered,
      onRegisterError,
      immediate: true,
    });
    updateSW.value = update;
  };

  return {
    needRefresh,
    offlineReady,
    updateApp,
    registerPWA,
  };
}
