import { defineStore } from "pinia";

// Export urlsync config for testing
export const satStoreUrlSyncConfig = [
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
  {
    name: "hideSunlightPasses",
    url: "hideLight",
    serialize: (v) => (v ? "1" : "0"),
    deserialize: (v) => v === "1",
    default: true,
  },
  {
    name: "showOnlyLitPasses",
    url: "onlyLit",
    serialize: (v) => (v ? "1" : "0"),
    deserialize: (v) => v === "1",
    default: true,
  },
  {
    name: "useLocalTime",
    url: "localTime",
    serialize: (v) => (v ? "1" : "0"),
    deserialize: (v) => v === "1",
    default: false,
  },
  {
    name: "customSatellites",
    url: "sat",
    serialize: (v) => {
      if (!v || v.length === 0) return "";
      // Array of TLE strings - concatenate directly (no separator needed)
      return v.join("");
    },
    deserialize: (v) => {
      if (!v) return [];

      // Parse TLEs by detecting line boundaries
      // TLE lines have fixed structure:
      // - Line 1 starts with "1 " (69 chars)
      // - Line 2 starts with "2 " (69 chars)
      // - Name line (optional, variable length, doesn't start with "1 " or "2 ")

      const tles = [];
      let buffer = v.trim();

      while (buffer.length > 0) {
        // Find next "1 " that starts a TLE line 1
        const line1Index = buffer.search(/1 \d{5}/);

        if (line1Index === -1) break; // No more TLEs found

        // Everything before line 1 is the name (if any)
        const namePart = buffer.substring(0, line1Index).trim();

        // Extract line 1 (69 characters starting from line1Index)
        const line1Start = line1Index;
        const line1End = line1Start + 69;
        const line1 = buffer.substring(line1Start, line1End);

        // Find line 2 (should be right after line 1, starts with "2 ")
        const line2Start = buffer.substring(line1End).search(/2 \d{5}/);

        if (line2Start === -1) break; // Invalid TLE, missing line 2

        const line2Pos = line1End + line2Start;
        const line2End = line2Pos + 69;
        const line2 = buffer.substring(line2Pos, line2End);

        // Build complete TLE (with or without name)
        let currentTle;
        if (namePart) {
          currentTle = `${namePart}\n${line1}\n${line2}`;
        } else {
          currentTle = `${line1}\n${line2}`;
        }

        tles.push(currentTle);

        // Move buffer forward past this TLE
        buffer = buffer.substring(line2End).trim();
      }

      return tles;
    },
    default: [],
  },
];

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
    hideSunlightPasses: true,
    showOnlyLitPasses: true,
    useLocalTime: false,
    enableSwathPasses: false,
    debugConsoleLog: false,
    customSatellite: null,
  }),
  urlsync: {
    enabled: true,
    config: satStoreUrlSyncConfig,
  },
});
