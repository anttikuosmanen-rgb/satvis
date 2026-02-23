import { defineStore } from "pinia";

export const useCesiumStore = defineStore("cesium", {
  state: () => ({
    layers: ["OfflineHighres"],
    skyMaps: ["Tycho2K_1"],
    terrainProvider: "None",
    sceneMode: "3D",
    cameraMode: "Fixed",
    qualityPreset: "high",
    background: true,
    showFps: false,
    pickMode: false,
  }),
  urlsync: {
    enabled: true,
    config: [
      {
        name: "layers",
        url: "layers",
        serialize: (v) => v.join(","),
        deserialize: (v) => v.split(",").filter((e) => e),
        valid: (v) => v.every((l) => ["Offline", "OfflineHighres", "ArcGis", "OSM", "Topo", "BlackMarble", "Tiles", "GOES-IR", "Nextrad"].includes(l.split("_")[0])),
        default: ["OfflineHighres"],
      },
      {
        name: "skyMaps",
        url: "sky",
        serialize: (v) => v.join(","),
        deserialize: (v) => v.split(",").filter((e) => e),
        valid: (v) => {
          /* global __SATVIS_LOCAL_DEV__ */
          const names = ["MilkyWay", "Tycho2K", "HipTyc16K", "Constellations"];
          if (__SATVIS_LOCAL_DEV__) names.push("MilkyWay8K", "Starmap8K");
          return v.every((l) => names.includes(l.split("_")[0]));
        },
        default: ["Tycho2K_1"],
      },
      {
        name: "terrainProvider",
        url: "terrain",
        default: "None",
      },
      {
        name: "sceneMode",
        url: "scene",
        default: "3D",
      },
      {
        name: "cameraMode",
        url: "camera",
        default: "Fixed",
      },
      {
        name: "qualityPreset",
        url: "quality",
        default: "high",
      },
      {
        name: "showFps",
        url: "fps",
        default: "false",
      },
      {
        name: "background",
        url: "bg",
        serialize: (v) => `${v}`,
        deserialize: (v) => v === "true",
        default: "true",
      },
    ],
  },
});
