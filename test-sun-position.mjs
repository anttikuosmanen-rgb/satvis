import { JulianDate, Simon1994PlanetaryPositions, Cartesian3 } from "@cesium/engine";

// Test Cesium's Sun position calculation
const now = JulianDate.now();
const sunPosition = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(now);

console.log("Cesium Sun position in Earth-Inertial frame:");
console.log(`X: ${sunPosition.x.toExponential(3)}`);
console.log(`Y: ${sunPosition.y.toExponential(3)}`);
console.log(`Z: ${sunPosition.z.toExponential(3)}`);

// Convert to spherical to see RA/Dec
const distance = Cartesian3.magnitude(sunPosition);
const dec = Math.asin(sunPosition.z / distance) * (180 / Math.PI);
const ra = Math.atan2(sunPosition.y, sunPosition.x) * (180 / Math.PI);

console.log(`\nDerived coordinates:`);
console.log(`Distance: ${(distance / 1e9).toFixed(2)} billion meters`);
console.log(`RA: ${(ra / 15).toFixed(4)} hours (${ra.toFixed(2)}°)`);
console.log(`Dec: ${dec.toFixed(2)}°`);
