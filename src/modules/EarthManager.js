import { Cartesian3, Color, VerticalOrigin, HorizontalOrigin, CallbackProperty, Simon1994PlanetaryPositions } from "@cesium/engine";

/**
 * Manages Earth and Moon rendering as billboards/point primitives when zoomed far away
 * Shows Earth and Moon as point sources when the globe rendering stops
 */
export class EarthManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.enabled = false;
    this.renderMode = "billboard"; // 'billboard' or 'point'
    this.earthEntity = null;
    this.moonEntity = null;
    this.pointPrimitives = null;
    this.preRenderListener = null;
    this.showLabels = true;
    this.distanceThreshold = 1e10; // 10,000,000 km (10 million km) - distance at which to show Earth/Moon as points
    this.lastGlobeShowState = true; // Track globe visibility state
    this.lastMoonShowState = true; // Track moon visibility state
  }

  /**
   * Enable Earth and Moon point rendering
   * @param {string} mode - 'billboard' or 'point'
   */
  async enable(mode = "billboard") {
    if (this.enabled) {
      this.disable();
    }

    this.enabled = true;
    this.renderMode = mode;

    if (mode === "billboard") {
      this.createBillboards();
    } else if (mode === "point") {
      await this.createPointPrimitives();
    }

    // Add preRender listener to check camera distance
    this.preRenderListener = this.viewer.scene.preUpdate.addEventListener(() => {
      this.updateVisibility();
    });

    console.log(`Earth and Moon point rendering enabled in ${mode} mode`);
  }

  /**
   * Disable Earth and Moon point rendering
   */
  disable() {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;

    // Clear preRender listener
    if (this.preRenderListener) {
      this.preRenderListener();
      this.preRenderListener = null;
    }

    // Remove entities (billboards or labels)
    if (this.earthEntity) {
      this.viewer.entities.remove(this.earthEntity);
      this.earthEntity = null;
    }
    if (this.moonEntity) {
      this.viewer.entities.remove(this.moonEntity);
      this.moonEntity = null;
    }

    // Remove point primitives
    if (this.renderMode === "point" && this.pointPrimitives) {
      this.viewer.scene.primitives.remove(this.pointPrimitives);
      this.pointPrimitives = null;
    }

    // Ensure globe and moon are visible when we disable
    this.viewer.scene.globe.show = true;
    this.viewer.scene.moon.show = true;
    this.lastGlobeShowState = true;
    this.lastMoonShowState = true;

    console.log("Earth and Moon point rendering disabled");
  }

  /**
   * Switch between billboard and point rendering modes
   * @param {string} mode - 'billboard' or 'point'
   */
  async setRenderMode(mode) {
    if (this.renderMode === mode) {
      return;
    }

    const wasEnabled = this.enabled;
    if (wasEnabled) {
      this.disable();
      await this.enable(mode);
    }
  }

  /**
   * Create billboard entities for Earth and Moon
   */
  createBillboards() {
    // Earth position is at (0, 0, 0) in Fixed frame
    const earthPosition = new Cartesian3(0, 0, 0);

    // Create Earth billboard entity
    this.earthEntity = this.viewer.entities.add({
      id: "earth-point",
      name: "Planet: Earth",
      position: earthPosition,
      billboard: {
        image: this.createBodyCanvas([100, 149, 237], 12), // Cornflower blue
        scale: 1.0,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => this.shouldShowPoints(), false),
      },
      label: {
        text: "♁", // Earth symbol
        font: "18px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2, // FILL_AND_OUTLINE
        verticalOrigin: VerticalOrigin.TOP,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian3(0, 10, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => this.showLabels && this.shouldShowPoints(), false),
      },
      description: this.generateEarthDescription(),
    });

    // Create Moon billboard entity with dynamic position
    const moonPositionCallback = new CallbackProperty((time, result) => {
      const moonPosition = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, result);
      return moonPosition;
    }, false);

    this.moonEntity = this.viewer.entities.add({
      id: "moon-point",
      name: "Moon",
      position: moonPositionCallback,
      billboard: {
        image: this.createBodyCanvas([192, 192, 192], 10), // Light gray
        scale: 0.7,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => this.shouldShowPoints(), false),
      },
      label: {
        text: "☾", // Moon symbol
        font: "16px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2,
        verticalOrigin: VerticalOrigin.TOP,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian3(0, 8, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => this.showLabels && this.shouldShowPoints(), false),
      },
      description: this.generateMoonDescription(),
    });
  }

  /**
   * Create point primitives for Earth and Moon
   */
  async createPointPrimitives() {
    const { PointPrimitiveCollection } = await import("@cesium/engine");

    this.pointPrimitives = this.viewer.scene.primitives.add(new PointPrimitiveCollection());

    // Earth point at origin
    const earthPosition = new Cartesian3(0, 0, 0);
    this.pointPrimitives.add({
      id: "earth",
      position: earthPosition,
      color: Color.fromBytes(100, 149, 237, 255), // Cornflower blue
      pixelSize: 6,
      outlineColor: Color.WHITE,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: true, // Controlled by updateVisibility
    });

    // Moon point - needs dynamic position update
    this.moonPoint = this.pointPrimitives.add({
      id: "moon",
      position: new Cartesian3(0, 0, 0), // Will be updated
      color: Color.fromBytes(192, 192, 192, 255), // Light gray
      pixelSize: 5,
      outlineColor: Color.WHITE,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: true,
    });

    // Create label entities for the point primitives
    const earthPosition2 = new Cartesian3(0, 0, 0);
    this.earthEntity = this.viewer.entities.add({
      id: "earth-label",
      name: "Planet: Earth",
      position: earthPosition2,
      label: {
        text: "♁",
        font: "18px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2,
        verticalOrigin: VerticalOrigin.TOP,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian3(0, 10, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => this.showLabels && this.shouldShowPoints(), false),
      },
      description: this.generateEarthDescription(),
    });

    const moonPositionCallback = new CallbackProperty((time, result) => {
      const moonPosition = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time, result);
      return moonPosition;
    }, false);

    this.moonEntity = this.viewer.entities.add({
      id: "moon-label",
      name: "Moon",
      position: moonPositionCallback,
      label: {
        text: "☾",
        font: "16px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2,
        verticalOrigin: VerticalOrigin.TOP,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian3(0, 8, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: new CallbackProperty(() => this.showLabels && this.shouldShowPoints(), false),
      },
      description: this.generateMoonDescription(),
    });

    // Update moon point position on each frame
    this.lastMoonUpdateTime = null;
    this.moonUpdateListener = this.viewer.scene.preRender.addEventListener(() => {
      if (this.moonPoint && this.enabled) {
        const currentTime = this.viewer.clock.currentTime;
        // Update moon position every frame for point primitives
        const moonPosition = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(currentTime);
        this.moonPoint.position = moonPosition;
      }
    });
  }

  /**
   * Check if we should show Earth/Moon as points (camera far enough)
   * @returns {boolean} True if camera is far enough
   */
  shouldShowPoints() {
    if (!this.enabled) {
      return false;
    }

    const cameraHeight = this.viewer.camera.positionCartographic.height;
    return cameraHeight > this.distanceThreshold;
  }

  /**
   * Update visibility based on camera distance
   * Hides globe/moon and shows points when far away, and vice versa
   */
  updateVisibility() {
    if (!this.enabled) {
      return;
    }

    const shouldShow = this.shouldShowPoints();

    // Toggle globe visibility
    const globeShow = !shouldShow;
    if (this.viewer.scene.globe.show !== globeShow) {
      this.viewer.scene.globe.show = globeShow;
      this.lastGlobeShowState = globeShow;
    }

    // Toggle moon visibility
    if (this.viewer.scene.moon) {
      const moonShow = !shouldShow;
      if (this.viewer.scene.moon.show !== moonShow) {
        this.viewer.scene.moon.show = moonShow;
        this.lastMoonShowState = moonShow;
      }
    }

    // Update point primitives visibility if using point mode
    if (this.renderMode === "point" && this.pointPrimitives && this.pointPrimitives._pointPrimitives.length > 0) {
      this.pointPrimitives._pointPrimitives.forEach((point) => {
        point.show = shouldShow;
      });
    }
  }

  /**
   * Generate HTML description for Earth
   * @returns {string} HTML description
   */
  generateEarthDescription() {
    return `
      <h3>Earth</h3>
      <table>
        <tr><th>Type</th><td>Planet</td></tr>
        <tr><th>Radius (equatorial)</th><td>6,378 km</td></tr>
        <tr><th>Radius (polar)</th><td>6,357 km</td></tr>
        <tr><th>Mass</th><td>5.972 × 10²⁴ kg</td></tr>
        <tr><th>Orbital Period</th><td>365.25 days</td></tr>
        <tr><th>Rotation Period</th><td>23h 56m 4s</td></tr>
      </table>
    `;
  }

  /**
   * Generate HTML description for Moon
   * @returns {string} HTML description
   */
  generateMoonDescription() {
    return `
      <h3>Moon</h3>
      <table>
        <tr><th>Type</th><td>Natural Satellite</td></tr>
        <tr><th>Radius</th><td>1,737 km</td></tr>
        <tr><th>Mass</th><td>7.342 × 10²² kg</td></tr>
        <tr><th>Orbital Period</th><td>27.3 days</td></tr>
        <tr><th>Distance from Earth</th><td>~384,400 km</td></tr>
      </table>
    `;
  }

  /**
   * Create a canvas with colored circle for billboard
   * @param {Array<number>} rgb - RGB color array [r, g, b]
   * @param {number} size - Canvas size in pixels
   * @returns {HTMLCanvasElement} Canvas element
   */
  createBodyCanvas(rgb, size = 16) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");

    // Draw glow
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)`);
    gradient.addColorStop(0.5, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.8)`);
    gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Draw bright center
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 4, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fill();

    return canvas;
  }

  /**
   * Get current render mode
   * @returns {string} Current mode ('billboard' or 'point')
   */
  getRenderMode() {
    return this.renderMode;
  }

  /**
   * Check if Earth/Moon point rendering is enabled
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Update component visibility based on enabled components
   * @param {Array<string>} enabledComponents - Array of enabled component names
   */
  updateComponents(enabledComponents) {
    this.showLabels = enabledComponents.includes("Label");
  }

  /**
   * Set distance threshold for showing Earth/Moon as points
   * @param {number} distance - Distance in meters
   */
  setDistanceThreshold(distance) {
    this.distanceThreshold = distance;
  }
}
