/**
 * Pure helper functions for the zenith view interaction layer.
 * Extracted for unit testability — no Cesium or DOM dependencies.
 */

// Map colorState (0-4) → third tooltip line; 0 = below horizon (no line)
export const SMART_PATH_LABELS = [null, "Satellite in shadow", "Satellite sunlit", "Satellite in shadow", "Satellite sunlit"];

/**
 * Returns multi-line tooltip text for cursor hover over the zenith canvas.
 * @param {number} alt - Altitude in degrees
 * @param {number} az - Azimuth in degrees (north-based clockwise)
 * @param {number|undefined} smartPathState - State index (0-4) or undefined if no satellite picked
 * @returns {string}
 */
export function formatZenithTooltip(alt, az, smartPathState) {
  const lines = [`Alt: ${alt.toFixed(1)}°`, `Az: ${az.toFixed(1)}°`];
  const label = smartPathState !== undefined ? SMART_PATH_LABELS[smartPathState] : null;
  if (label) lines.push(label);
  return lines.join("\n");
}

/**
 * Returns the shortest signed angular difference between two azimuths in degrees.
 * Result is in the range (-180, 180].
 * @param {number} a - First azimuth in degrees
 * @param {number} b - Second azimuth in degrees
 * @returns {number} Signed difference (a - b), wrapped to (-180, 180]
 */
export function azimuthDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

/**
 * Returns true if azimuth `az` lies within the arc from `leftAz` to `rightAz`
 * going clockwise. Handles wraparound across 0°/360°.
 * @param {number} az - Azimuth to test (degrees)
 * @param {number} leftAz - Left edge of arc (degrees)
 * @param {number} rightAz - Right edge of arc (degrees)
 * @returns {boolean}
 */
export function azimuthInRange(az, leftAz, rightAz) {
  return (az - leftAz + 360) % 360 <= (rightAz - leftAz + 360) % 360;
}

/**
 * Returns multi-line tooltip text for the sun symbol hover.
 * @param {number} altitude - Sun altitude in degrees
 * @param {number} azimuth - Sun azimuth in degrees (north-based clockwise)
 * @returns {string}
 */
export function formatSunTooltip(altitude, azimuth) {
  return [`Alt: ${altitude.toFixed(1)}°`, `Az: ${azimuth.toFixed(1)}°`].join("\n");
}
