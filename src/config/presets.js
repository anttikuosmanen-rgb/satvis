/**
 * Configuration manager for different application presets
 * Maps routes to their respective configurations and TLE data
 */
export const presets = {
  default: {
    title: "Satellite Orbit Visualization",
    config: {
      sat: {
        enabledTags: ["Weather"],
      },
    },
    tleData: [
      ["data/tle/groups/cubesat.txt", ["Cubesat"]],
      ["data/tle/groups/globalstar.txt", ["Globalstar"]],
      ["data/tle/groups/gnss.txt", ["GNSS"]],
      ["data/tle/groups/iridium-NEXT.txt", ["IridiumNEXT"]],
      ["data/tle/groups/last-30-days.txt", ["New"]],
      ["data/tle/groups/oneweb.txt", ["OneWeb"]],
      ["data/tle/groups/planet.txt", ["Planet"]],
      ["data/tle/groups/resource.txt", ["Resource"]],
      ["data/tle/groups/science.txt", ["Science"]],
      ["data/tle/groups/spire.txt", ["Spire"]],
      ["data/tle/groups/starlink.txt", ["Starlink"]],
      ["data/tle/groups/stations.txt", ["Stations"]],
      ["data/tle/groups/weather.txt", ["Weather"]],
      ["data/tle/groups/eutelsat.txt", ["Eutelsat"]],
      // ["data/tle/groups/active.txt", ["Active"]],
    ],
  },
  move: {
    title: "MOVE Satellite Orbit Visualization",
    config: {
      sat: {
        enabledTags: ["MOVE"],
      },
    },
    tleData: [["data/tle/move.txt", ["MOVE"]]],
  },
  ot: {
    title: "OT Satellite Orbit Visualization",
    config: {
      sat: {
        enabledTags: ["OT"],
        enabledComponents: ["Point", "Label", "Orbit", "Sensor cone", "Ground track"],
        overpassMode: "swath",
      },
      cesium: {
        layers: ["ArcGis"],
      },
    },
    tleData: [
      ["data/tle/ot.txt", ["OT"]],
      ["data/tle/wfs.txt", ["WFS"]],
      ["data/tle/otc.txt", ["OTC"]],
      ["data/tle/groups/iridium-NEXT.txt", ["IridiumNEXT"]],
    ],
  },
};

/**
 * Get configuration preset based on current route/path
 */
export function getConfigPreset(path = window.location.pathname) {
  // Remove leading slash and .html extension for matching
  const routeName = path.replace(/^\//, "").replace(/\.html$/, "");

  switch (routeName) {
    case "move":
      return presets.move;
    case "ot":
      return presets.ot;
    default:
      return presets.default;
  }
}

/**
 * Update document title and meta description based on preset
 * @param {Object} preset - Configuration preset with title and description
 */
export function updateMetadata(preset) {
  document.title = preset.title;
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) {
    metaDescription.setAttribute("content", preset.description);
  }
}
