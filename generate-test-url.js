#!/usr/bin/env node

/**
 * Helper script to generate test URLs for custom satellite feature
 * Usage: node generate-test-url.js [port]
 */

// Example TLE data for ISS
const testTLE = `ISS (ZARYA)
1 25544U 98067A   21001.00000000  .00002182  00000-0  41420-4 0  9990
2 25544  51.6461 339.8014 0002571  34.5857 120.4689 15.48919393261961`;

// URL encode the TLE
const encoded = encodeURIComponent(testTLE);

// Get port from command line or default to 5173
const port = process.argv[2] || '5173';
const baseUrl = `http://localhost:${port}`;

console.log('Custom Satellite Test URL Generator');
console.log('=====================================\n');
console.log('Test TLE (ISS):');
console.log('---');
console.log(testTLE);
console.log('---\n');
console.log('URL encoded:');
console.log(encoded);
console.log('\n');
console.log('Test URL:');
console.log(`${baseUrl}/?sat=${encoded}`);
console.log('\n');
console.log('You can also paste TLE directly in the browser address bar:');
console.log(`${baseUrl}/?sat=ISS%20(ZARYA)%0A1%2025544U%20...`);
console.log('\n');
console.log('Expected behavior:');
console.log('1. Satellite should appear as "[Custom] ISS (ZARYA)" in the UI');
console.log('2. Satellite should be automatically enabled');
console.log('3. Satellite should have "Custom" tag');
console.log('4. Satellite should render on the globe');
console.log('5. No name clash with existing satellites');
console.log('\n');
console.log('To test with a different satellite, edit this script or use:');
console.log('node generate-custom-url.js "<name>\\n<line1>\\n<line2>"');
