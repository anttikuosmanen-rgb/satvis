import { Cartesian3, Color, JulianDate, VerticalOrigin } from "@cesium/engine";
import { PlanetaryPositions } from "./PlanetaryPositions";

/**
 * Manages rendering of planets as celestial point sources in Cesium
 * Supports both billboards and point primitives
 */
export class PlanetManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.planetary = new PlanetaryPositions();
    this.enabled = false;
    this.renderMode = "billboard"; // 'billboard' or 'point'
    this.planetEntities = [];
    this.pointPrimitives = null;
    this.updateInterval = null;
  }

  /**
   * Enable planet rendering
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

    // Update planet positions every 5 minutes
    this.updateInterval = setInterval(() => {
      this.updatePositions();
    }, 5 * 60 * 1000);

    // Initial position update
    this.updatePositions();

    console.log(`Planet rendering enabled in ${mode} mode`);
  }

  /**
   * Disable planet rendering
   */
  disable() {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;

    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Remove billboards
    if (this.renderMode === "billboard") {
      this.planetEntities.forEach((entity) => {
        this.viewer.entities.remove(entity);
      });
      this.planetEntities = [];
    }

    // Remove point primitives
    if (this.renderMode === "point" && this.pointPrimitives) {
      this.viewer.scene.primitives.remove(this.pointPrimitives);
      this.pointPrimitives = null;
    }

    console.log("Planet rendering disabled");
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
   * Create billboard entities for planets
   */
  createBillboards() {
    const planets = this.planetary.getPlanetNames();

    planets.forEach((planetName) => {
      const planetData = this.planetary.planets.find((p) => p.name === planetName);

      // Create billboard entity
      const entity = this.viewer.entities.add({
        id: `planet-${planetName}`,
        name: planetName,
        position: new Cartesian3(0, 0, 0), // Will be updated
        billboard: {
          image: this.createPlanetCanvas(planetData.color, 16),
          scale: 1.0,
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always visible
          scaleByDistance: null, // Keep constant size
        },
        description: `Planet: ${planetName}`,
      });

      this.planetEntities.push(entity);
    });
  }

  /**
   * Create point primitives for planets
   */
  async createPointPrimitives() {
    const { PointPrimitiveCollection } = await import("@cesium/engine");

    this.pointPrimitives = this.viewer.scene.primitives.add(new PointPrimitiveCollection());

    const planets = this.planetary.getPlanetNames();

    planets.forEach((planetName) => {
      const planetData = this.planetary.planets.find((p) => p.name === planetName);

      // Create point primitive
      const point = this.pointPrimitives.add({
        id: planetName,
        position: new Cartesian3(0, 0, 0), // Will be updated
        color: Color.fromBytes(planetData.color[0], planetData.color[1], planetData.color[2], 255),
        pixelSize: 8,
        outlineColor: Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always visible
      });

      point.planetName = planetName; // Store planet name for updates
    });
  }

  /**
   * Update planet positions based on current simulation time
   */
  updatePositions() {
    if (!this.enabled) {
      return;
    }

    const currentTime = this.viewer.clock.currentTime;
    const positions = this.planetary.calculatePositions(currentTime);

    if (this.renderMode === "billboard") {
      positions.forEach((planetData) => {
        const entity = this.planetEntities.find((e) => e.name === planetData.name);
        if (entity) {
          entity.position = planetData.position;

          // Update description with current data
          entity.description = this.generateDescription(planetData);

          // Adjust size based on magnitude (brighter = larger)
          const scale = this.magnitudeToScale(planetData.magnitude);
          entity.billboard.scale = scale;
        }
      });
    } else if (this.renderMode === "point" && this.pointPrimitives) {
      positions.forEach((planetData) => {
        const point = this.pointPrimitives._pointPrimitives.find((p) => p.planetName === planetData.name);
        if (point) {
          point.position = planetData.position;

          // Adjust size based on magnitude (brighter = larger)
          const pixelSize = this.magnitudeToPixelSize(planetData.magnitude);
          point.pixelSize = pixelSize;
        }
      });
    }
  }

  /**
   * Convert magnitude to billboard scale
   * Brighter planets (more negative magnitude) get larger scale
   * @param {number} magnitude - Visual magnitude
   * @returns {number} Scale factor
   */
  magnitudeToScale(magnitude) {
    // Venus can be -4.6, Jupiter -2.9, Mercury -1.9, Mars -2.9, Saturn 0.5
    // Scale from 0.5 (dim) to 2.0 (bright)
    const scale = 1.5 - magnitude * 0.15;
    return Math.max(0.5, Math.min(2.5, scale));
  }

  /**
   * Convert magnitude to point pixel size
   * @param {number} magnitude - Visual magnitude
   * @returns {number} Pixel size
   */
  magnitudeToPixelSize(magnitude) {
    // Scale from 4 (dim) to 14 (bright)
    const size = 10 - magnitude * 1.5;
    return Math.max(4, Math.min(14, size));
  }

  /**
   * Generate HTML description for planet
   * @param {Object} planetData - Planet data from PlanetaryPositions
   * @returns {string} HTML description
   */
  generateDescription(planetData) {
    return `
      <h3>${planetData.name}</h3>
      <table>
        <tr><th>Right Ascension</th><td>${planetData.ra.toFixed(4)} hours</td></tr>
        <tr><th>Declination</th><td>${planetData.dec.toFixed(2)}°</td></tr>
        <tr><th>Magnitude</th><td>${planetData.magnitude.toFixed(2)}</td></tr>
        <tr><th>Illumination</th><td>${planetData.illumination.toFixed(1)}%</td></tr>
        <tr><th>Distance</th><td>${planetData.distance_au.toFixed(4)} AU</td></tr>
      </table>
    `;
  }

  /**
   * Create a canvas with a colored circle for planet billboard
   * @param {Array<number>} rgb - RGB color array [r, g, b]
   * @param {number} size - Canvas size in pixels
   * @returns {HTMLCanvasElement} Canvas element
   */
  createPlanetCanvas(rgb, size = 16) {
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
    ctx.fillStyle = `rgba(255, 255, 255, 0.9)`;
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
   * Check if planets are enabled
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return this.enabled;
  }
}
