import { defineStore } from "pinia";

export const useSatStore = defineStore("sat", {
  state: () => ({
    enabledComponents: ["Point", "Label"],
    availableSatellitesByTag: [],
    availableTags: [],
    enabledSatellites: [],
    enabledTags: [],
    groundStations: [],
    trackedSatellite: "",
    overpassMode: "elevation",
  }),
  urlsync: {
    enabled: true,
    config: [
      {
        name: "enabledComponents",
        url: "elements",
        serialize: (v) => v.join(",").replaceAll(" ", "-"),
        deserialize: (v) =>
          v
            .replaceAll("-", " ")
            .split(",")
            .filter((e) => e),
        default: ["Point", "Label"],
      },
      {
        name: "enabledSatellites",
        url: "sats",
        serialize: (v) => v.join(",").replaceAll(" ", "~"),
        deserialize: (v) =>
          v
            .replaceAll("~", " ")
            .split(",")
            .filter((e) => e),
        default: [],
      },
      {
        name: "enabledTags",
        url: "tags",
        serialize: (v) => v.join(",").replaceAll(" ", "-"),
        deserialize: (v) =>
          v
            .replaceAll("-", " ")
            .split(",")
            .filter((e) => e),
        default: [],
      },
      {
        name: "groundStations",
        url: "gs",
        serialize: (v) => v.map((gs) => `${gs.lat.toFixed(4)},${gs.lon.toFixed(4)}${gs.name ? `,${gs.name}` : ""}`).join("_"),
        deserialize: (v) =>
          v.split("_").map((gs) => {
            const g = gs.split(",");
            return {
              lat: parseFloat(g[0], 10),
              lon: parseFloat(g[1], 10),
              name: g[2],
            };
          }),
        default: [],
      },
      {
        name: "trackedSatellite",
        url: "track",
        default: "",
      },
      {
        name: "overpassMode",
        url: "overpass",
        default: "elevation",
      },
    ],
  },
});
