#!/usr/bin/env node

/**
 * Generate custom satellite URL from TLE data
 * Usage:
 *   node generate-custom-url.js <port> "<line0>\n<line1>\n<line2>"
 *   node generate-custom-url.js 5173 "$(cat path/to/tle.txt)"
 */

const port = process.argv[2] || '5173';
const tleData = process.argv[3];

if (!tleData) {
  console.error('Error: TLE data required');
  console.error('Usage: node generate-custom-url.js <port> "<name>\\n<line1>\\n<line2>"');
  console.error('Example: node generate-custom-url.js 5173 "$(cat tle.txt)"');
  process.exit(1);
}

// Validate TLE has 3 lines
const lines = tleData.split(/\r?\n/).filter(line => line.trim());
if (lines.length < 3) {
  console.error('Error: TLE must have 3 lines (name, line1, line2)');
  console.error(`Got ${lines.length} lines`);
  process.exit(1);
}

// URL encode
const encoded = encodeURIComponent(tleData);

const baseUrl = `http://localhost:${port}`;
const testUrl = `${baseUrl}/?sat=${encoded}`;

console.log('Custom Satellite URL Generated');
console.log('================================\n');
console.log('Input TLE:');
console.log('---');
console.log(tleData);
console.log('---\n');
console.log('Expected satellite name: [Custom] ' + lines[0].trim());
console.log('\nTest URL:');
console.log(testUrl);
console.log('\nTo use: Copy URL and paste in browser while dev server is running');
console.log('\nNote: You can also manually paste the TLE in the address bar.');
console.log('The browser will automatically URL-encode it when you press Enter.');
