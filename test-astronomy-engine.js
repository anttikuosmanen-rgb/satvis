/**
 * Simple test script to demonstrate astronomy-engine integration
 * Run with: node test-astronomy-engine.js
 */
import { GroundStationConditions } from './src/modules/util/GroundStationConditions.js';

// Example ground station position (approximately in Finland)
const groundStation = {
  latitude: 60.1695,
  longitude: 24.9354,
  height: 0
};

const testTime = new Date('2024-01-15T18:00:00Z');

console.log('=== Astronomy Engine Integration Test ===\n');

console.log('Ground Station:', groundStation);
console.log('Test Time:', testTime.toISOString(), '\n');

// Test SunCalc method (existing)
console.log('--- SunCalc Method ---');
try {
  const isInDarknessSunCalc = GroundStationConditions.isInDarkness(groundStation, testTime, "suncalc");
  const sunPositionSunCalc = GroundStationConditions.getSunPosition(groundStation, testTime, "suncalc");

  console.log('Is in darkness:', isInDarknessSunCalc);
  console.log('Sun position:', sunPositionSunCalc);
  console.log('Lighting condition:', GroundStationConditions.getLightingConditionWithEmoji(groundStation, testTime));
} catch (error) {
  console.error('SunCalc test failed:', error);
}

console.log('\n--- Astronomy Engine Method ---');
try {
  const isInDarknessAstroEngine = GroundStationConditions.isInDarkness(groundStation, testTime, "astronomy-engine");
  const sunPositionAstroEngine = GroundStationConditions.getSunPosition(groundStation, testTime, "astronomy-engine");

  console.log('Is in darkness:', isInDarknessAstroEngine);
  console.log('Sun position:', sunPositionAstroEngine);
} catch (error) {
  console.error('Astronomy Engine test failed:', error);
}

console.log('\n--- Twilight Times ---');
try {
  const twilightTimes = GroundStationConditions.getTwilightTimes(groundStation, testTime);
  console.log('Twilight times:', twilightTimes);
} catch (error) {
  console.error('Twilight times test failed:', error);
}

console.log('\n=== Test Complete ===');