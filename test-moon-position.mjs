import { JulianDate, Simon1994PlanetaryPositions, Cartesian3 } from "@cesium/engine";
import * as Astronomy from "astronomy-engine";

const now = JulianDate.now();
const jsDate = JulianDate.toDate(now);

// Cesium's Moon
const cesiumMoon = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(now);

// Astronomy-engine's Moon
const observer = new Astronomy.Observer(0, 0, 0);
const astroMoon = Astronomy.Equator(Astronomy.Body.Moon, jsDate, observer, true, true);

console.log("Cesium Moon (Earth-Inertial):");
console.log(`  X: ${cesiumMoon.x.toExponential(3)} m`);
console.log(`  Y: ${cesiumMoon.y.toExponential(3)} m`);
console.log(`  Z: ${cesiumMoon.z.toExponential(3)} m`);

// Derive RA/Dec from Cesium position
const cesiumDistance = Cartesian3.magnitude(cesiumMoon);
const cesiumDec = Math.asin(cesiumMoon.z / cesiumDistance) * (180 / Math.PI);
const cesiumRA = Math.atan2(cesiumMoon.y, cesiumMoon.x) * (180 / Math.PI);

console.log(`  Derived RA: ${(cesiumRA / 15).toFixed(4)} hours (${cesiumRA.toFixed(2)}°)`);
console.log(`  Derived Dec: ${cesiumDec.toFixed(2)}°`);

console.log("\nAstronomy-Engine Moon (Equatorial J2000):");
console.log(`  RA: ${astroMoon.ra.toFixed(4)} hours (${(astroMoon.ra * 15).toFixed(2)}°)`);
console.log(`  Dec: ${astroMoon.dec.toFixed(2)}°`);
console.log(`  Distance: ${astroMoon.dist.toFixed(6)} AU`);

// Convert astronomy-engine to Cartesian (without rotation)
const ra = astroMoon.ra * 15; // to degrees
const dec = astroMoon.dec;
const distance = astroMoon.dist * 1.496e11; // AU to meters

const raRad = (ra * Math.PI) / 180;
const decRad = (dec * Math.PI) / 180;

const x = distance * Math.cos(decRad) * Math.cos(raRad);
const y = distance * Math.cos(decRad) * Math.sin(raRad);
const z = distance * Math.sin(decRad);

console.log("\nAstronomy-Engine converted to Cartesian (no rotation):");
console.log(`  X: ${x.toExponential(3)} m`);
console.log(`  Y: ${y.toExponential(3)} m`);
console.log(`  Z: ${z.toExponential(3)} m`);

console.log("\nDifference:");
console.log(`  ΔX: ${(x - cesiumMoon.x).toExponential(3)} m (${((x - cesiumMoon.x) / cesiumDistance * 100).toFixed(2)}%)`);
console.log(`  ΔY: ${(y - cesiumMoon.y).toExponential(3)} m (${((y - cesiumMoon.y) / cesiumDistance * 100).toFixed(2)}%)`);
console.log(`  ΔZ: ${(z - cesiumMoon.z).toExponential(3)} m (${((z - cesiumMoon.z) / cesiumDistance * 100).toFixed(2)}%)`);

// Now try with different rotations to see which one matches
console.log("\n--- Testing different RA offsets ---");
for (let offset of [-180, -90, 0, 90, 180]) {
  const raRad2 = ((ra + offset) * Math.PI) / 180;
  const x2 = distance * Math.cos(decRad) * Math.cos(raRad2);
  const y2 = distance * Math.cos(decRad) * Math.sin(raRad2);
  const z2 = distance * Math.sin(decRad);

  const diff = Math.sqrt(
    Math.pow(x2 - cesiumMoon.x, 2) +
    Math.pow(y2 - cesiumMoon.y, 2) +
    Math.pow(z2 - cesiumMoon.z, 2)
  );

  console.log(`RA offset ${offset}°: difference = ${(diff / cesiumDistance * 100).toFixed(2)}%`);
}
