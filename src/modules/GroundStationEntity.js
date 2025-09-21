import * as Cesium from "@cesium/engine";
import dayjs from "dayjs";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { DescriptionHelper } from "./util/DescriptionHelper";
import { useSatStore } from "../stores/sat";

import icon from "../images/icons/dish.svg";

export class GroundStationEntity extends CesiumComponentCollection {
  constructor(viewer, sats, position, givenName = "") {
    super(viewer);
    this.sats = sats;
    this.position = position;
    this.givenName = givenName;

    this.createEntities();
  }

  createEntities() {
    this.createDescription();
    this.createGroundStation();
  }

  createGroundStation() {
    const billboard = new Cesium.BillboardGraphics({
      image: icon,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      scaleByDistance: new Cesium.NearFarScalar(1e2, 0.2, 4e7, 0.1),
    });
    this.createCesiumEntity("Groundstation", "billboard", billboard, this.name, this.description, this.position.cartesian, false);
  }

  createDescription() {
    this.description = DescriptionHelper.cachedCallbackProperty((time) => {
      const passes = this.passes(time);
      const content = DescriptionHelper.renderGroundstationDescription(time, this.name, this.position, passes);
      return content;
    });
  }

  get hasName() {
    return this.givenName !== "";
  }

  get name() {
    if (this.givenName) {
      return this.givenName;
    }
    return `Groundstation [${this.position.latitude.toFixed(2)}°, ${this.position.longitude.toFixed(2)}°]`;
  }

  passes(time, deltaHours = 48) {
    let passes = [];
    // Aggregate passes from all visible satellites
    this.sats.visibleSatellites.forEach((sat) => {
      sat.props.updatePasses(this.viewer.clock.currentTime);
      passes.push(...sat.props.passes);
    });

    // Filter passes based on time
    passes = passes.filter((pass) => dayjs(pass.start).diff(time, "hours") < deltaHours);

    // Filter passes based on groundstation
    passes = passes.filter((pass) => pass.groundStationName === this.name);

    // Filter out passes in sunlight if option is enabled
    const satStore = useSatStore();
    if (satStore.hideSunlightPasses) {
      passes = passes.filter((pass) =>
        // Show pass if either start or end is in darkness
        pass.groundStationDarkAtStart || pass.groundStationDarkAtEnd);
    }

    // Sort passes by time
    passes = passes.sort((a, b) => a.start - b.start);
    return passes;
  }
}
