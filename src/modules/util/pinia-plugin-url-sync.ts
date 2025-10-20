import { PiniaPluginContext } from "pinia";
import type { Router } from "vue-router";

export interface SyncConfigEntry {
  name: string; // Object name/path in pinia store
  url?: string; // Alternative name of url param, defaults to name
  serialize?: (value: unknown) => string; // Convert state to url string
  deserialize?: (value: string) => unknown; // Convert url string to state
  valid?: (value: unknown) => boolean; // Run validation function after deserialization to filter invalid values
  default?: unknown; // Default value (removes this value from url)
}

// Extend Pinia plugin options to include our custom urlsync config
interface UrlSyncConfig {
  enabled?: boolean;
  config: SyncConfigEntry[];
}

// Extend DefineStoreOptions to include urlsync
declare module "pinia" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface DefineStoreOptionsBase<S, Store> {
    urlsync?: UrlSyncConfig;
  }
}

// Extended store type with our custom properties
interface ExtendedStore {
  router: Router;
  customConfig: Record<string, Record<string, unknown>>;
  defaults: Record<string, unknown>;
  $id: string;
  [key: string]: unknown;
}

const defaultSerialize = (v: unknown) => String(v);
const defaultDeserialize = (v: string) => String(v);

function resolve(path: string | string[], obj: Record<string, unknown>, separator = "."): unknown {
  const properties = Array.isArray(path) ? path : path.split(separator);
  return properties.reduce((prev: unknown, curr: string) => {
    if (prev && typeof prev === "object" && curr in prev) {
      return (prev as Record<string, unknown>)[curr];
    }
    return undefined;
  }, obj);
}

function urlToState(store: ExtendedStore, syncConfig: SyncConfigEntry[]): void {
  const { router, customConfig } = store;
  const route = router.currentRoute.value;
  store.defaults = {};

  // Override store default values with custom app config
  const storeConfig = customConfig[store.$id];
  if (storeConfig) {
    Object.entries(storeConfig).forEach(([key, val]) => {
      store[key] = val;
    });
  }

  syncConfig.forEach((config: SyncConfigEntry) => {
    const param = config.url || config.name;
    const deserialize = config.deserialize || defaultDeserialize;

    // Save default value of merged app config
    store.defaults[config.name] = store[config.name];

    const query = { ...route.query };
    if (!(param in query)) {
      return;
    }
    try {
      console.info("Parse url param", param, route.query[param]);
      const queryValue = query[param];
      if (typeof queryValue !== "string") {
        throw new TypeError("Query param is not a string");
      }
      const value = deserialize(queryValue);
      if ("valid" in config && config.valid && !config.valid(value)) {
        throw new TypeError("Validation failed");
      }
      // TODO: Resolve nested values
      store[config.name] = value;
    } catch (error) {
      console.error(`Invalid url param ${param} ${route.query[param]}: ${error}`);
      delete query[param];
      router.replace({ query });
    }
  });
}

function stateToUrl(store: ExtendedStore, syncConfig: SyncConfigEntry[]): void {
  const params = new URLSearchParams(location.search);
  syncConfig.forEach((config: SyncConfigEntry) => {
    const value = resolve(config.name, store as Record<string, unknown>);
    const param = config.url || config.name;
    const serialize = config.serialize || defaultSerialize;
    console.info("State update", config.name, value);

    if (config.name in store.defaults && serialize(store.defaults[config.name]) === serialize(value)) {
      params.delete(param);
    } else {
      params.set(param, serialize(value));
    }
  });
  window.history.pushState({}, "", `?${params.toString().replaceAll("%2C", ",")}`);
}

function createUrlSync({ options, store }: PiniaPluginContext): void {
  // console.info("createUrlSync", options);
  if (!options.urlsync?.enabled && !options.urlsync?.config) {
    return;
  }

  const extendedStore = store as unknown as ExtendedStore;

  // Set state from url params on page load
  extendedStore.router.isReady().then(() => {
    urlToState(extendedStore, options.urlsync!.config);
  });

  // Subscribe to store updates and sync them to url params
  store.$subscribe(() => {
    stateToUrl(extendedStore, options.urlsync!.config);
  });
}

export default createUrlSync;
