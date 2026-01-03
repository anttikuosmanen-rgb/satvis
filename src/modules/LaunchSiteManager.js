import { BillboardGraphics, Cartesian3, Cartographic, Color, HorizontalOrigin, Math as CesiumMath, NearFarScalar, VerticalOrigin } from "cesium";
import rocketIcon from "../images/icons/rocket.svg";

/**
 * Launch Site data - major orbital launch facilities worldwide
 */
const LAUNCH_SITES = [
  // USA
  { name: "Cape Canaveral / KSC", lat: 28.5721, lon: -80.648, country: "USA" },
  { name: "Vandenberg SFB", lat: 34.742, lon: -120.5724, country: "USA" },
  // Russia/Kazakhstan
  { name: "Baikonur Cosmodrome", lat: 45.965, lon: 63.305, country: "Kazakhstan" },
  { name: "Plesetsk Cosmodrome", lat: 62.9271, lon: 40.5777, country: "Russia" },
  { name: "Vostochny Cosmodrome", lat: 51.884, lon: 128.334, country: "Russia" },
  // Europe
  { name: "Guiana Space Centre", lat: 5.232, lon: -52.7686, country: "French Guiana" },
  // China
  { name: "Jiuquan SLC", lat: 40.9606, lon: 100.291, country: "China" },
  { name: "Taiyuan SLC", lat: 38.849, lon: 111.608, country: "China" },
  { name: "Wenchang SLS", lat: 19.6145, lon: 110.951, country: "China" },
  // India
  { name: "Satish Dhawan SC", lat: 13.7199, lon: 80.2304, country: "India" },
  // New Zealand
  { name: "Rocket Lab LC-1", lat: -39.2615, lon: 177.8649, country: "New Zealand" },
];

/**
 * Manages launch site visualization on the globe
 */
export class LaunchSiteManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.launchSiteEntities = [];
    this.prominent = false;
  }

  /**
   * Initialize all launch site billboard entities
   */
  initialize() {
    LAUNCH_SITES.forEach((site) => {
      const position = Cartesian3.fromDegrees(site.lon, site.lat, 0);

      const entity = this.viewer.entities.add({
        id: `launch-site-${site.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: `Launch Site: ${site.name}`,
        position,
        billboard: this.createBillboard(this.prominent),
        description: this.generateDescription(site),
      });

      // Store reference with position info
      this.launchSiteEntities.push({
        entity,
        name: site.name,
        lat: site.lat,
        lon: site.lon,
        country: site.country,
        cartesian: position,
        cartographic: Cartographic.fromDegrees(site.lon, site.lat, 0),
      });
    });
  }

  /**
   * Create billboard graphics for launch site
   * @param {boolean} prominent - If true, use larger and more opaque appearance
   */
  createBillboard(prominent = false) {
    return new BillboardGraphics({
      image: rocketIcon,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      // Default: small and semi-transparent
      // Prominent: larger and fully opaque
      scaleByDistance: prominent ? new NearFarScalar(1e2, 0.4, 4e7, 0.2) : new NearFarScalar(1e2, 0.15, 4e7, 0.08),
      color: prominent ? Color.WHITE : Color.WHITE.withAlpha(0.4),
    });
  }

  /**
   * Generate HTML description for launch site info box
   */
  generateDescription(site) {
    return `
      <div style="font-family: Arial, sans-serif;">
        <h3 style="margin: 0 0 10px 0;">${site.name}</h3>
        <table style="border-collapse: collapse;">
          <tr>
            <td style="padding: 3px 10px 3px 0; font-weight: bold;">Country:</td>
            <td style="padding: 3px 0;">${site.country}</td>
          </tr>
          <tr>
            <td style="padding: 3px 10px 3px 0; font-weight: bold;">Latitude:</td>
            <td style="padding: 3px 0;">${site.lat.toFixed(4)}°</td>
          </tr>
          <tr>
            <td style="padding: 3px 10px 3px 0; font-weight: bold;">Longitude:</td>
            <td style="padding: 3px 0;">${site.lon.toFixed(4)}°</td>
          </tr>
        </table>
      </div>
    `;
  }

  /**
   * Toggle between default (small/transparent) and prominent mode
   * @param {boolean} enabled - If true, show prominent mode
   */
  setProminent(enabled) {
    this.prominent = enabled;
    this.launchSiteEntities.forEach((site) => {
      site.entity.billboard = this.createBillboard(enabled);
    });
  }

  /**
   * Show all launch site entities
   */
  show() {
    this.launchSiteEntities.forEach((site) => {
      site.entity.show = true;
    });
  }

  /**
   * Hide all launch site entities
   */
  hide() {
    this.launchSiteEntities.forEach((site) => {
      site.entity.show = false;
    });
  }

  /**
   * Find nearest launch site to a given position
   * Uses Haversine formula for great-circle distance
   * @param {Cartesian3} cartesianPosition - Position to check
   * @returns {Object|null} Launch site object with { name, lat, lon, country, cartesian, cartographic }
   */
  findNearestLaunchSite(cartesianPosition) {
    const cartographic = Cartographic.fromCartesian(cartesianPosition);
    const satLat = CesiumMath.toDegrees(cartographic.latitude);
    const satLon = CesiumMath.toDegrees(cartographic.longitude);

    let nearestSite = null;
    let minDistance = Infinity;

    for (const site of this.launchSiteEntities) {
      const distance = this.haversineDistance(satLat, satLon, site.lat, site.lon);
      if (distance < minDistance) {
        minDistance = distance;
        nearestSite = site;
      }
    }

    return nearestSite;
  }

  /**
   * Calculate great-circle distance between two points using Haversine formula
   * @param {number} lat1 - Latitude of first point (degrees)
   * @param {number} lon1 - Longitude of first point (degrees)
   * @param {number} lat2 - Latitude of second point (degrees)
   * @param {number} lon2 - Longitude of second point (degrees)
   * @returns {number} Distance in kilometers
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Cleanup all entities when manager is destroyed
   */
  destroy() {
    this.launchSiteEntities.forEach((site) => {
      this.viewer.entities.remove(site.entity);
    });
    this.launchSiteEntities = [];
  }
}
