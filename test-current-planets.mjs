import { JulianDate } from "@cesium/engine";
import * as Astronomy from "astronomy-engine";

const now = JulianDate.now();
const jsDate = JulianDate.toDate(now);

console.log(`Current time: ${jsDate.toISOString()}\n`);

const planets = [
  { body: Astronomy.Body.Mercury, name: "Mercury" },
  { body: Astronomy.Body.Venus, name: "Venus" },
  { body: Astronomy.Body.Mars, name: "Mars" },
  { body: Astronomy.Body.Jupiter, name: "Jupiter" },
  { body: Astronomy.Body.Saturn, name: "Saturn" },
  { body: Astronomy.Body.Sun, name: "Sun" },
];

const observer = new Astronomy.Observer(0, 0, 0);

console.log("Current planet positions:");
console.log("═".repeat(80));

planets.forEach((planet) => {
  const equatorial = Astronomy.Equator(planet.body, jsDate, observer, true, true);
  const ra = equatorial.ra * 15; // Convert to degrees
  const dec = equatorial.dec;

  console.log(`\n${planet.name}:`);
  console.log(`  RA:  ${equatorial.ra.toFixed(4)} hours = ${ra.toFixed(2)}°`);
  console.log(`  Dec: ${dec.toFixed(2)}°`);
  console.log(`  Dist: ${equatorial.dist.toFixed(4)} AU`);
});

console.log("\n" + "═".repeat(80));
console.log("\nAngular separations from Sun:");

const sunEq = Astronomy.Equator(Astronomy.Body.Sun, jsDate, observer, true, true);

planets.forEach((planet) => {
  if (planet.name === "Sun") return;

  const planetEq = Astronomy.Equator(planet.body, jsDate, observer, true, true);

  // Calculate angular separation
  const ra1 = sunEq.ra * 15 * Math.PI / 180;
  const dec1 = sunEq.dec * Math.PI / 180;
  const ra2 = planetEq.ra * 15 * Math.PI / 180;
  const dec2 = planetEq.dec * Math.PI / 180;

  const cosSep = Math.sin(dec1) * Math.sin(dec2) +
                 Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  const separation = Math.acos(Math.max(-1, Math.min(1, cosSep))) * 180 / Math.PI;

  console.log(`  ${planet.name}: ${separation.toFixed(1)}° from Sun`);
});
