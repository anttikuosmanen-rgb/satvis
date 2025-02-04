import satvisSetup from "./app";

const { cc } = satvisSetup({
  sat: {
    enabledTags: ["OT"],
    enabledComponents: ["Point", "Label", "Orbit", "Sensor cone"],
  },
  cesium: {
    layers: ["ArcGis"],
  },
});

cc.sats.addFromTleUrls([
  ["data/tle/ot.txt", ["OT"]],
  ["data/tle/wfs.txt", ["WFS"]],
  ["data/tle/forest-3-launch.txt", ["FOREST-3"]],
  ["data/tle/otc.txt", ["OTC"]],
  ["data/tle/groups/iridium-NEXT.txt", ["IridiumNEXT"]],
]);
