import { JulianDate, Simon1994PlanetaryPositions, Cartesian3 } from "@cesium/engine";
import * as Astronomy from "astronomy-engine";

const now = JulianDate.now();
const jsDate = JulianDate.toDate(now);

// Cesium's Sun
const cesiumSun = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(now);

// Astronomy-engine's Sun
const observer = new Astronomy.Observer(0, 0, 0);
const astroSun = Astronomy.Equator(Astronomy.Body.Sun, jsDate, observer, true, true);

console.log("Cesium Sun (Earth-Inertial):");
console.log(`  X: ${cesiumSun.x.toExponential(3)} m`);
console.log(`  Y: ${cesiumSun.y.toExponential(3)} m`);
console.log(`  Z: ${cesiumSun.z.toExponential(3)} m`);

console.log("\nAstronomy-Engine Sun (Equatorial J2000):");
console.log(`  RA: ${astroSun.ra.toFixed(4)} hours (${(astroSun.ra * 15).toFixed(2)}°)`);
console.log(`  Dec: ${astroSun.dec.toFixed(2)}°`);
console.log(`  Distance: ${astroSun.dist.toFixed(6)} AU`);

// Convert astronomy-engine to Cartesian
const ra = astroSun.ra * 15; // to degrees
const dec = astroSun.dec;
const distance = astroSun.dist * 1.496e11; // AU to meters

const raRad = (ra * Math.PI) / 180;
const decRad = (dec * Math.PI) / 180;

const x = distance * Math.cos(decRad) * Math.cos(raRad);
const y = distance * Math.cos(decRad) * Math.sin(raRad);
const z = distance * Math.sin(decRad);

console.log("\nAstronomy-Engine converted to Cartesian:");
console.log(`  X: ${x.toExponential(3)} m`);
console.log(`  Y: ${y.toExponential(3)} m`);
console.log(`  Z: ${z.toExponential(3)} m`);

console.log("\nDifference:");
console.log(`  ΔX: ${(x - cesiumSun.x).toExponential(3)} m`);
console.log(`  ΔY: ${(y - cesiumSun.y).toExponential(3)} m`);
console.log(`  ΔZ: ${(z - cesiumSun.z).toExponential(3)} m`);
