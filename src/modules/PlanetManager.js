import { Cartesian3, Color, JulianDate, VerticalOrigin, HorizontalOrigin, CallbackProperty, ReferenceFrame } from "@cesium/engine";
import * as Astronomy from "astronomy-engine";
import { PlanetaryPositions } from "./PlanetaryPositions";
import { CelestialOrbitRenderer } from "./CelestialOrbitRenderer";

/**
 * Manages rendering of planets as celestial point sources in Cesium
 * Supports both billboards and point primitives
 */
export class PlanetManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.planetary = new PlanetaryPositions();
    this.orbitRenderer = new CelestialOrbitRenderer(viewer);
    this.enabled = false;
    this.renderMode = "billboard"; // 'billboard' or 'point'
    this.planetEntities = [];
    this.pointPrimitives = null;
    this.updateInterval = null;
    this.preRenderListener = null;
    this.lastUpdateTime = null; // Last simulation time we updated point primitives
    this.lastRealUpdate = null; // Last real-world time we updated
    this.showLabels = true; // Whether to show planet labels
    this.showOrbits = false; // Whether to show planet orbits
    this.trackedEntityListener = null; // Listener to prevent planet tracking
    this.occlusionCheckListener = null; // Listener for checking Earth globe occlusion
    this.earthRadius = 6378137.0; // Earth's radius in meters
    this.lastOcclusionCheck = 0; // Last time we checked occlusion (in milliseconds)
    this.occlusionCheckInterval = 1000; // Check occlusion every 1 second
    this.isInZenithView = false; // Track if we're in zenith view mode
    this.zenithViewChangeHandler = null; // Handler for zenith view state changes

    // Orbital periods for planets around the Sun (in seconds)
    // Source: NASA Solar System Dynamics
    this.orbitalPeriods = {
      Mercury: 87.969 * 24 * 60 * 60, // 87.969 days
      Venus: 224.701 * 24 * 60 * 60, // 224.701 days
      Mars: 686.98 * 24 * 60 * 60, // 686.980 days
      Jupiter: 4332.589 * 24 * 60 * 60, // 11.862 years
      Saturn: 10759.22 * 24 * 60 * 60, // 29.457 years
      Uranus: 30688.5 * 24 * 60 * 60, // 84.01 years
      Neptune: 60182.0 * 24 * 60 * 60, // 164.8 years
    };
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
      // Update metadata every 5 minutes for billboards
      this.updateInterval = setInterval(
        () => {
          this.updatePositions();
        },
        5 * 60 * 1000,
      );
    } else if (mode === "point") {
      await this.createPointPrimitives();
      // For point primitives, update on smooth scrubbing (every 0.5 seconds real time)
      this.preRenderListener = this.viewer.scene.preUpdate.addEventListener(() => {
        this.updatePointPrimitivesForScrubbing();
      });
    }

    // Listen for ClockMonitor time jump events to update planet positions
    this.handleClockTimeJump = (event) => {
      const { jumpSeconds } = event.detail;
      // Update positions on time jumps >1 hour
      if (Math.abs(jumpSeconds) > 3600) {
        this.updatePositions();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("cesium:clockTimeJumped", this.handleClockTimeJump);
    }

    // Initial position update
    this.updatePositions();

    // Add listener to prevent planet tracking
    this.trackedEntityListener = this.viewer.trackedEntityChanged.addEventListener(() => {
      const tracked = this.viewer.trackedEntity;
      if (tracked && tracked.id && tracked.id.startsWith("planet")) {
        // Don't allow tracking planets - clear tracked entity
        this.viewer.trackedEntity = undefined;
      }
    });

    // Add listener to check for Earth globe occlusion (throttled to 1 second)
    this.occlusionCheckListener = this.viewer.scene.preRender.addEventListener(() => {
      this.updatePlanetOcclusion();
    });

    // Listen for zenith view state changes
    this.zenithViewChangeHandler = (event) => {
      this.isInZenithView = event.detail.active;
    };
    window.addEventListener("zenithViewChanged", this.zenithViewChangeHandler);
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

    // Clear preRender listener
    if (this.preRenderListener) {
      this.preRenderListener();
      this.preRenderListener = null;
    }

    // Clear tracked entity listener
    if (this.trackedEntityListener) {
      this.trackedEntityListener();
      this.trackedEntityListener = null;
    }

    // Clear occlusion check listener
    if (this.occlusionCheckListener) {
      this.occlusionCheckListener();
      this.occlusionCheckListener = null;
    }

    // Remove zenith view change listener
    if (this.zenithViewChangeHandler) {
      window.removeEventListener("zenithViewChanged", this.zenithViewChangeHandler);
      this.zenithViewChangeHandler = null;
    }

    // Remove ClockMonitor listener
    if (typeof window !== "undefined" && this.handleClockTimeJump) {
      window.removeEventListener("cesium:clockTimeJumped", this.handleClockTimeJump);
    }

    // Clear all orbits
    this.orbitRenderer.clear();

    // Remove entities (billboards or labels)
    this.planetEntities.forEach((entity) => {
      this.viewer.entities.remove(entity);
    });
    this.planetEntities = [];

    // Remove point primitives
    if (this.renderMode === "point" && this.pointPrimitives) {
      this.viewer.scene.primitives.remove(this.pointPrimitives);
      this.pointPrimitives = null;
    }

    // Reset update tracking
    this.lastUpdateTime = null;
    this.lastRealUpdate = null;
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

      // Create a callback property that calculates position at render time
      // Positions are transformed from ICRF to Fixed frame in PlanetaryPositions
      const positionCallback = new CallbackProperty((time, result) => {
        const positions = this.planetary.calculatePositions(time);
        const planet = positions.find((p) => p.name === planetName);
        if (planet) {
          return Cartesian3.clone(planet.position, result);
        }
        return result;
      }, false);

      // Create billboard entity
      const entity = this.viewer.entities.add({
        id: `planet-${planetName}`,
        name: `Planet: ${planetName}`,
        position: positionCallback,
        billboard: {
          image: this.createPlanetCanvas(planetData.color, 10),
          scale: 0.8,
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always visible
          scaleByDistance: null, // Keep constant size
        },
        label: {
          text: planetData.symbol,
          font: "16px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 2, // FILL_AND_OUTLINE
          verticalOrigin: VerticalOrigin.TOP,
          horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian3(0, 8, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: new CallbackProperty(() => this.showLabels, false),
        },
        description: new CallbackProperty((time) => {
          const positions = this.planetary.calculatePositions(time || this.viewer.clock.currentTime);
          const planet = positions.find((p) => p.name === planetName);
          return planet ? this.generateDescription(planet) : "";
        }, false),
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
        pixelSize: 5,
        outlineColor: Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always visible
      });

      point.planetName = planetName; // Store planet name for updates

      // Create label entity for the point primitive
      // Labels must be entities, not primitives
      const positionCallback = new CallbackProperty((time, result) => {
        const positions = this.planetary.calculatePositions(time);
        const planet = positions.find((p) => p.name === planetName);
        if (planet) {
          return Cartesian3.clone(planet.position, result);
        }
        return result;
      }, false);

      const labelEntity = this.viewer.entities.add({
        id: `planet-label-${planetName}`,
        name: `Planet: ${planetName}`,
        position: positionCallback,
        label: {
          text: planetData.symbol,
          font: "16px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 2, // FILL_AND_OUTLINE
          verticalOrigin: VerticalOrigin.TOP,
          horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian3(0, 8, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: new CallbackProperty(() => this.showLabels, false),
        },
        description: new CallbackProperty((time) => {
          const positions = this.planetary.calculatePositions(time || this.viewer.clock.currentTime);
          const planet = positions.find((p) => p.name === planetName);
          return planet ? this.generateDescription(planet) : "";
        }, false),
      });

      this.planetEntities.push(labelEntity); // Store for cleanup
    });
  }

  /**
   * Update point primitives during smooth scrubbing
   * Only updates if 0.5 seconds of real time passed (for continuous animation/scrubbing)
   * Time jumps are handled by ClockMonitor event listener
   */
  updatePointPrimitivesForScrubbing() {
    if (!this.enabled || this.renderMode !== "point") {
      return;
    }

    const now = Date.now();

    // Update if this is first time
    if (!this.lastRealUpdate) {
      this.lastRealUpdate = now;
      this.updatePositions();
      return;
    }

    // Update if 0.5 seconds of real time passed (for smooth scrubbing)
    if (now - this.lastRealUpdate > 500) {
      this.lastRealUpdate = now;
      this.updatePositions();
    }
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
      // Billboards use CallbackProperty which auto-updates position and description
      // We only need to update scale based on magnitude
      positions.forEach((planetData) => {
        const entity = this.planetEntities.find((e) => e.id === `planet-${planetData.name}`);
        if (entity) {
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
    // Scale from 0.6 (dim) to 1.2 (bright) - smaller overall
    const scale = 0.9 - magnitude * 0.1;
    return Math.max(0.6, Math.min(1.2, scale));
  }

  /**
   * Convert magnitude to point pixel size
   * @param {number} magnitude - Visual magnitude
   * @returns {number} Pixel size
   */
  magnitudeToPixelSize(magnitude) {
    // Scale from 3 (dim) to 8 (bright) - smaller overall
    const size = 5.5 - magnitude * 0.9;
    return Math.max(3, Math.min(8, size));
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

  /**
   * Update component visibility based on enabled components
   * @param {Array<string>} enabledComponents - Array of enabled component names
   */
  updateComponents(enabledComponents) {
    this.showLabels = enabledComponents.includes("Label");

    // Check if planet orbits should be shown
    const shouldShowOrbits = enabledComponents.includes("Planet orbits");
    if (shouldShowOrbits !== this.showOrbits) {
      this.showOrbits = shouldShowOrbits;
      this.updatePlanetOrbitsVisibility();
    }
  }

  /**
   * Check if a planet is occluded by Earth's globe
   * @param {Cartesian3} planetPosition - Planet position in world coordinates
   * @returns {boolean} True if planet is behind Earth from camera perspective
   */
  isPlanetOccludedByEarth(planetPosition) {
    const cameraPosition = this.viewer.camera.position;
    const earthCenter = Cartesian3.ZERO;

    // Vector from camera to planet (normalized)
    const cameraToPlanet = Cartesian3.subtract(planetPosition, cameraPosition, new Cartesian3());
    Cartesian3.normalize(cameraToPlanet, cameraToPlanet);

    // Vector from camera to Earth center (normalized)
    const cameraToEarth = Cartesian3.subtract(earthCenter, cameraPosition, new Cartesian3());
    const distanceToEarth = Cartesian3.magnitude(cameraToEarth);
    Cartesian3.normalize(cameraToEarth, cameraToEarth);

    // Calculate angular separation between planet and Earth center
    const angle = Cartesian3.angleBetween(cameraToPlanet, cameraToEarth);

    // Calculate Earth's angular radius as seen from camera
    const earthAngularRadius = Math.asin(this.earthRadius / distanceToEarth);

    // For normal views: Check if planet is within Earth's angular radius
    // This handles the case where you're looking at Earth from the side
    if (!this.isInZenithView) {
      return angle < earthAngularRadius;
    }

    // For zenith view mode: Use dot product to check if planet is below horizon
    // If dot product is positive, camera→planet and camera→Earth point in similar directions
    // This means the planet is beyond Earth (below the horizon)
    const dotProduct = Cartesian3.dot(cameraToPlanet, cameraToEarth);
    return dotProduct > 0;
  }

  /**
   * Update occlusion state for all planets
   * Throttled to run every 1 second to avoid performance impact
   */
  updatePlanetOcclusion() {
    if (!this.enabled) {
      return;
    }

    // Throttle to once per second
    const now = Date.now();
    if (now - this.lastOcclusionCheck < this.occlusionCheckInterval) {
      return;
    }
    this.lastOcclusionCheck = now;

    const currentTime = this.viewer.clock.currentTime;
    const positions = this.planetary.calculatePositions(currentTime);

    const cameraDist = Cartesian3.magnitude(this.viewer.camera.positionWC);

    positions.forEach((planetData) => {
      const isOccluded = this.isPlanetOccludedByEarth(planetData.position);
      const planetInfo = this.planetary.planets.find((p) => p.name === planetData.name);
      const minDist = planetInfo?.minDistance || 0;
      const tooClose = minDist > 0 && cameraDist < minDist;

      // Compute fade alpha (0→1) over 20% range beyond minDistance
      let fadeAlpha = 1.0;
      if (minDist > 0 && !tooClose) {
        const fadeEnd = minDist * 1.2;
        fadeAlpha = Math.min((cameraDist - minDist) / (fadeEnd - minDist), 1.0);
      }

      const visible = !isOccluded && !tooClose;

      if (this.renderMode === "billboard") {
        const entity = this.planetEntities.find((e) => e.id === `planet-${planetData.name}`);
        if (entity && entity.billboard) {
          entity.billboard.show = visible;
          if (visible && minDist > 0) {
            entity.billboard.color = Color.WHITE.withAlpha(fadeAlpha);
          }
        }
        if (entity && entity.label) {
          entity.label.show = visible && this.showLabels;
          if (visible && minDist > 0) {
            entity.label.fillColor = Color.WHITE.withAlpha(fadeAlpha);
          }
        }
      } else if (this.renderMode === "point" && this.pointPrimitives) {
        const point = this.pointPrimitives._pointPrimitives.find((p) => p.planetName === planetData.name);
        if (point) {
          point.show = visible;
          if (visible && minDist > 0) {
            const baseColor = Color.fromBytes(planetInfo.color[0], planetInfo.color[1], planetInfo.color[2], Math.round(fadeAlpha * 255));
            point.color = baseColor;
          }
        }
        const labelEntity = this.planetEntities.find((e) => e.id === `planet-label-${planetData.name}`);
        if (labelEntity && labelEntity.label) {
          labelEntity.label.show = visible && this.showLabels;
          if (visible && minDist > 0) {
            labelEntity.label.fillColor = Color.WHITE.withAlpha(fadeAlpha);
          }
        }
      }
    });
  }

  /**
   * Get planet position in heliocentric inertial frame (Sun-centered ICRF).
   * Returns pure heliocentric coordinates — the modelMatrix in
   * CelestialOrbitRenderer handles the Earth offset for display.
   * @param {string} planetName - Name of the planet
   * @param {JulianDate} time - Time for position calculation
   * @returns {Cartesian3} Position in ICRF frame relative to Sun
   */
  getPlanetPositionInertial(planetName, time) {
    const jsDate = JulianDate.toDate(time);
    const planet = this.planetary.planets.find((p) => p.name === planetName);
    if (!planet) {
      return new Cartesian3(0, 0, 0);
    }

    // Get heliocentric position (planet relative to Sun) in ICRF frame
    // HelioVector returns position in AU, we need to convert to meters
    const AU_TO_METERS = 1.496e11;
    const helioVector = Astronomy.HelioVector(planet.body, jsDate);

    return new Cartesian3(helioVector.x * AU_TO_METERS, helioVector.y * AU_TO_METERS, helioVector.z * AU_TO_METERS);
  }

  /**
   * Update planet orbit visibility
   * Called when showOrbits state changes
   */
  updatePlanetOrbitsVisibility() {
    if (!this.enabled) {
      return;
    }

    const planets = this.planetary.getPlanetNames();

    if (this.showOrbits) {
      planets.forEach((planetName) => {
        if (!this.orbitRenderer.hasOrbit(planetName)) {
          const orbitalPeriod = this.orbitalPeriods[planetName];

          if (!orbitalPeriod) {
            console.warn(`No orbital period defined for ${planetName}`);
            return;
          }

          // Create position function that returns inertial frame position
          const positionFunction = (time) => {
            return this.getPlanetPositionInertial(planetName, time);
          };

          const planetInfo = this.planetary.planets.find((p) => p.name === planetName);

          // Add orbit with planet-specific color
          this.orbitRenderer.addOrbit(planetName, positionFunction, {
            orbitalPeriod: orbitalPeriod,
            color: Color.MEDIUMPURPLE,
            width: 3, // Thicker to be more visible
            resolution: orbitalPeriod / 200, // 200 samples per orbit for smooth ellipses
            leadTimeFraction: 1.0, // Show full orbit ahead
            trailTimeFraction: 0.0, // Don't show trail behind
            referenceFrame: ReferenceFrame.INERTIAL,
            usePrimitive: true, // Use Primitive + modelMatrix for LOD-culling-free rendering
            heliocentric: true, // Sun-centric orbit — proper ellipses centered on the Sun
            minDistance: planetInfo?.minDistance || 0,
          });
        }
      });
    } else {
      // Remove all planet orbits
      planets.forEach((planetName) => {
        if (this.orbitRenderer.hasOrbit(planetName)) {
          this.orbitRenderer.removeOrbit(planetName);
        }
      });
    }
  }
}
