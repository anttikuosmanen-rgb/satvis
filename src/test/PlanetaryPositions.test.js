import { JulianDate } from "@cesium/engine";
import { PlanetaryPositions } from "../modules/PlanetaryPositions";

/**
 * Test planetary position calculations
 */
console.log("=== Testing Planetary Positions ===\n");

const planetary = new PlanetaryPositions();

// Test with current time
const now = JulianDate.now();
console.log("Current time:", JulianDate.toDate(now).toISOString());
console.log("\n--- All Planets ---");

const positions = planetary.calculatePositions(now);
positions.forEach((planet) => {
  console.log(`\n${planet.name}:`);
  console.log(`  RA: ${planet.ra.toFixed(4)} hours (${(planet.ra * 15).toFixed(2)}°)`);
  console.log(`  Dec: ${planet.dec.toFixed(2)}°`);
  console.log(`  Magnitude: ${planet.magnitude.toFixed(2)}`);
  console.log(`  Illumination: ${planet.illumination.toFixed(1)}%`);
  console.log(`  Distance: ${planet.distance_au.toFixed(4)} AU`);
  console.log(`  Position: (${planet.position.x.toExponential(2)}, ${planet.position.y.toExponential(2)}, ${planet.position.z.toExponential(2)})`);
});

// Test visibility from a specific location (e.g., San Francisco)
const latitude = 37.7749; // San Francisco
const longitude = -122.4194;

console.log(`\n\n--- Visible Planets from (${latitude}°, ${longitude}°) ---`);

const visiblePlanets = planetary.getVisiblePlanets(now, latitude, longitude);
if (visiblePlanets.length === 0) {
  console.log("No planets currently visible above the horizon.");
} else {
  visiblePlanets.forEach((planet) => {
    console.log(`\n${planet.name}:`);
    console.log(`  Altitude: ${planet.altitude.toFixed(2)}° (${planet.altitude > 0 ? "above" : "below"} horizon)`);
    console.log(`  Azimuth: ${planet.azimuth.toFixed(2)}° from North`);
    console.log(`  Magnitude: ${planet.magnitude.toFixed(2)}`);
  });
}

console.log("\n=== Test Complete ===");
