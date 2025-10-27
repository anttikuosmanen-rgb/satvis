import * as Astronomy from "astronomy-engine";

console.log("=== Testing Planetary Positions ===\n");

// Current time
const now = new Date();
console.log("Current time:", now.toISOString());

// Define the 5 brightest planets
const planets = [
  { body: Astronomy.Body.Mercury, name: "Mercury" },
  { body: Astronomy.Body.Venus, name: "Venus" },
  { body: Astronomy.Body.Mars, name: "Mars" },
  { body: Astronomy.Body.Jupiter, name: "Jupiter" },
  { body: Astronomy.Body.Saturn, name: "Saturn" },
];

console.log("\n--- Planetary Positions ---");

for (const planet of planets) {
  try {
    // Get equatorial coordinates (RA and Dec) for the planet
    const equatorial = Astronomy.Equator(planet.body, now, null, true, true);

    // Get illumination data
    const illum = Astronomy.Illumination(planet.body, now);

    console.log(`\n${planet.name}:`);
    console.log(`  RA: ${equatorial.ra.toFixed(4)} hours (${(equatorial.ra * 15).toFixed(2)}°)`);
    console.log(`  Dec: ${equatorial.dec.toFixed(2)}°`);
    console.log(`  Magnitude: ${illum.mag.toFixed(2)}`);
    console.log(`  Illumination: ${(illum.phase_fraction * 100).toFixed(1)}%`);
    console.log(`  Distance: ${equatorial.dist.toFixed(4)} AU`);

    // Convert to Cartesian (example)
    const ra = equatorial.ra * 15; // Convert to degrees
    const dec = equatorial.dec;
    const distance = 1e10; // Large distance for celestial sphere

    const raRad = (ra * Math.PI) / 180;
    const decRad = (dec * Math.PI) / 180;

    const x = distance * Math.cos(decRad) * Math.cos(raRad);
    const y = distance * Math.cos(decRad) * Math.sin(raRad);
    const z = distance * Math.sin(decRad);

    console.log(`  Cartesian: (${x.toExponential(2)}, ${y.toExponential(2)}, ${z.toExponential(2)})`);
  } catch (error) {
    console.error(`Error calculating ${planet.name}:`, error.message);
  }
}

// Test visibility from a location
const latitude = 60.17; // Helsinki
const longitude = 24.94;

console.log(`\n\n--- Visible Planets from Helsinki (${latitude}°, ${longitude}°) ---`);

const observer = new Astronomy.Observer(latitude, longitude, 0);

let visibleCount = 0;
for (const planet of planets) {
  try {
    const equatorial = Astronomy.Equator(planet.body, now, observer, true, true);
    const horizontal = Astronomy.Horizon(now, observer, equatorial.ra, equatorial.dec, "normal");
    const illum = Astronomy.Illumination(planet.body, now);

    if (horizontal.altitude > 0) {
      visibleCount++;
      console.log(`\n${planet.name}:`);
      console.log(`  Altitude: ${horizontal.altitude.toFixed(2)}° (above horizon)`);
      console.log(`  Azimuth: ${horizontal.azimuth.toFixed(2)}° from North`);
      console.log(`  Magnitude: ${illum.mag.toFixed(2)}`);
    }
  } catch (error) {
    console.error(`Error for ${planet.name}:`, error.message);
  }
}

if (visibleCount === 0) {
  console.log("\nNo planets currently visible above the horizon.");
}

console.log("\n=== Test Complete ===");
