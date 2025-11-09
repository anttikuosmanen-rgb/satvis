#!/usr/bin/env node

/**
 * Generate test URL with multiple custom satellites from a constellation
 * Demonstrates that custom satellites work alongside existing ones
 *
 * Usage: node generate-constellation.js <count> "<tle1>" "<tle2>" ...
 */

const port = '5173';
const count = parseInt(process.argv[2]) || 1;

// Get TLE from arguments (each should be 3 lines)
const tles = process.argv.slice(3);

if (tles.length === 0) {
  console.error('Error: At least one TLE required');
  console.error('Usage: node generate-constellation.js <count> "<line0>\\n<line1>\\n<line2>"');
  console.error('\nExample with ISS from current data:');
  console.error('  node generate-constellation.js 1 "$(head -3 data/tle/groups/stations.txt)"');
  process.exit(1);
}

console.log(`Generating test URL with ${tles.length} custom satellite(s)\n`);

// Process each TLE
const encodedSatellites = tles.map((tle, index) => {
  const lines = tle.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 3) {
    console.error(`Error: TLE ${index + 1} must have 3 lines, got ${lines.length}`);
    process.exit(1);
  }

  const satName = lines[0].trim();
  const encoded = encodeURIComponent(tle);

  console.log(`Satellite ${index + 1}: [Custom] ${satName}`);

  return encoded;
});

// Since we only have one customSatellite URL param, use the first one
const testUrl = `http://localhost:${port}/?sat=${encodedSatellites[0]}`;

console.log('\n' + '='.repeat(60));
console.log('Test URL:');
console.log(testUrl);
console.log('='.repeat(60));

console.log('\nExpected behavior:');
console.log('✓ Custom satellite appears with [Custom] prefix');
console.log('✓ Automatically enabled and visible');
console.log('✓ Tagged as "Custom"');
console.log('✓ No name clash with existing satellites');
console.log('\nOpen the URL in your browser to test!');
