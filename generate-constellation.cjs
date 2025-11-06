#!/usr/bin/env node

/**
 * TLE Constellation Generator
 *
 * Generates a constellation of satellites on the same orbit at evenly spaced intervals.
 * The spacing is achieved by modifying the Mean Anomaly (MA) parameter in the TLE.
 *
 * Usage:
 *   node generate-constellation.cjs <num-satellites> <tle-line1> <tle-line2>
 *   node generate-constellation.cjs <num-satellites> <tle-file>
 *
 * Examples:
 *   node generate-constellation.cjs 4 "1 39634U ..." "2 39634  98.1822..."
 *   node generate-constellation.cjs 6 input.tle
 *
 * The tool will generate N satellites evenly spaced around the orbit by adjusting
 * the Mean Anomaly by 360/N degrees for each satellite.
 */

const fs = require('fs');
const path = require('path');

/**
 * Calculate TLE checksum
 * Checksum is the modulo 10 of the sum of all numerical digits and +1 for each minus sign
 */
function calculateChecksum(line) {
  let sum = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    if (char >= '0' && char <= '9') {
      sum += parseInt(char, 10);
    } else if (char === '-') {
      sum += 1;
    }
  }
  return sum % 10;
}

/**
 * Parse a TLE and extract orbital parameters
 */
function parseTLE(line1, line2) {
  // Line 1 format (columns are 1-indexed in TLE spec, but 0-indexed in strings)
  const satNumber = line1.substring(2, 7).trim();
  const classification = line1.substring(7, 8);
  const intlDesignator = line1.substring(9, 17).trim();
  const epochYear = line1.substring(18, 20);
  const epochDay = line1.substring(20, 32);
  const firstDerivativeMeanMotion = line1.substring(33, 43);
  const secondDerivativeMeanMotion = line1.substring(44, 52);
  const bstarDrag = line1.substring(53, 61);
  const ephemerisType = line1.substring(62, 63);
  const elementSetNumber = line1.substring(64, 68).trim();

  // Line 2 format
  const inclination = line2.substring(8, 16).trim();
  const rightAscension = parseFloat(line2.substring(17, 25).trim());
  const eccentricity = line2.substring(26, 33).trim();
  const argumentOfPerigee = parseFloat(line2.substring(34, 42).trim());
  const meanAnomaly = parseFloat(line2.substring(43, 51).trim());
  const meanMotion = line2.substring(52, 63).trim();
  const revNumber = line2.substring(63, 68).trim();

  return {
    line1: {
      satNumber,
      classification,
      intlDesignator,
      epochYear,
      epochDay,
      firstDerivativeMeanMotion,
      secondDerivativeMeanMotion,
      bstarDrag,
      ephemerisType,
      elementSetNumber,
    },
    line2: {
      satNumber,
      inclination,
      rightAscension,
      eccentricity,
      argumentOfPerigee,
      meanAnomaly,
      meanMotion,
      revNumber,
    },
  };
}

/**
 * Generate a new TLE with modified Mean Anomaly, Argument of Perigee, and RAAN
 */
function generateTLE(name, parsed, newMeanAnomaly, newArgumentOfPerigee, newRightAscension, satelliteIndex, totalSatellites) {
  // Increment satellite number for each new satellite
  const newSatNumber = (parseInt(parsed.line1.satNumber, 10) + satelliteIndex).toString().padStart(5, '0');

  // Modify international designator letter (A -> B -> C, etc.)
  let intlDesignator = parsed.line1.intlDesignator;
  if (intlDesignator.length > 0) {
    const lastChar = intlDesignator[intlDesignator.length - 1];
    if (lastChar >= 'A' && lastChar <= 'Z') {
      const newChar = String.fromCharCode(lastChar.charCodeAt(0) + satelliteIndex);
      intlDesignator = intlDesignator.substring(0, intlDesignator.length - 1) + newChar;
    }
  }

  // Format Mean Anomaly to 8 characters with 4 decimal places
  const maStr = newMeanAnomaly.toFixed(4).padStart(8, ' ');

  // Format Argument of Perigee to 8 characters with 4 decimal places
  const apStr = newArgumentOfPerigee.toFixed(4).padStart(8, ' ');

  // Format Right Ascension to 8 characters with 4 decimal places
  const raStr = newRightAscension.toFixed(4).padStart(8, ' ');

  // Build line 1 (without checksum)
  let line1 = '1 ';
  line1 += newSatNumber;
  line1 += parsed.line1.classification;
  line1 += ' ';
  line1 += intlDesignator.padEnd(8, ' ');
  line1 += ' ';
  line1 += parsed.line1.epochYear;
  line1 += parsed.line1.epochDay;
  line1 += ' ';
  line1 += parsed.line1.firstDerivativeMeanMotion;
  line1 += ' ';
  line1 += parsed.line1.secondDerivativeMeanMotion;
  line1 += ' ';
  line1 += parsed.line1.bstarDrag;
  line1 += ' ';
  line1 += parsed.line1.ephemerisType;
  line1 += ' ';
  line1 += parsed.line1.elementSetNumber.padStart(4, ' ');

  // Calculate and append checksum
  const checksum1 = calculateChecksum(line1);
  line1 += checksum1;

  // Build line 2 (without checksum)
  let line2 = '2 ';
  line2 += newSatNumber;
  line2 += ' ';
  line2 += parsed.line2.inclination.padStart(8, ' ');
  line2 += ' ';
  line2 += raStr;
  line2 += ' ';
  line2 += parsed.line2.eccentricity.padStart(7, '0');
  line2 += ' ';
  line2 += apStr;
  line2 += ' ';
  line2 += maStr;
  line2 += ' ';
  line2 += parsed.line2.meanMotion;
  line2 += parsed.line2.revNumber.padStart(5, ' ');

  // Calculate and append checksum
  const checksum2 = calculateChecksum(line2);
  line2 += checksum2;

  // Generate name with phase indicator
  const phaseDegrees = (360 / totalSatellites) * satelliteIndex;
  const newName = satelliteIndex === 0 ? name : `${name} +${phaseDegrees.toFixed(0)}°`;

  return {
    name: newName,
    line1,
    line2,
  };
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node generate-constellation.cjs <num-satellites> [options] <tle-line1> <tle-line2>');
    console.error('   or: node generate-constellation.cjs <num-satellites> [options] <tle-file>');
    console.error('');
    console.error('Options:');
    console.error('  +A<degrees>  Add degrees to Argument of Perigee (e.g., +A45 adds 45°)');
    console.error('  -A<degrees>  Subtract degrees from Argument of Perigee (e.g., -A90 subtracts 90°)');
    console.error('  +R<degrees>  Add degrees to Right Ascension (RAAN) (e.g., +R30 adds 30°)');
    console.error('  -R<degrees>  Subtract degrees from Right Ascension (RAAN) (e.g., -R45 subtracts 45°)');
    console.error('');
    console.error('Examples:');
    console.error('  node generate-constellation.cjs 4 "1 39634U ..." "2 39634  98.1822..."');
    console.error('  node generate-constellation.cjs 6 input.tle');
    console.error('  node generate-constellation.cjs 4 +A45 "1 39634U ..." "2 39634  98.1822..."');
    console.error('  node generate-constellation.cjs 6 -A90 input.tle');
    console.error('  node generate-constellation.cjs 4 +R30 -A10 "1 39634U ..." "2 39634  98.1822..."');
    process.exit(1);
  }

  const numSatellites = parseInt(args[0], 10);

  if (isNaN(numSatellites) || numSatellites < 1) {
    console.error('Error: Number of satellites must be a positive integer');
    process.exit(1);
  }

  // Check for orbital parameter adjustment options
  let argumentOfPerigeeAdjust = 0;
  let rightAscensionAdjust = 0;
  let argOffset = 1; // Index where TLE args start

  // Parse all option arguments (+A/-A and +R/-R)
  while (args.length > argOffset + 1) {
    const arg = args[argOffset];

    if (arg.startsWith('+A') || arg.startsWith('-A')) {
      // Argument of Perigee adjustment
      const sign = arg[0];
      const degreeStr = arg.substring(2);
      const degrees = parseFloat(degreeStr);

      if (isNaN(degrees)) {
        console.error(`Error: Invalid Argument of Perigee adjustment: ${arg}`);
        console.error('Expected format: +A<degrees> or -A<degrees> (e.g., +A45, -A90)');
        process.exit(1);
      }

      argumentOfPerigeeAdjust = sign === '+' ? degrees : -degrees;
      argOffset++;
    } else if (arg.startsWith('+R') || arg.startsWith('-R')) {
      // Right Ascension adjustment
      const sign = arg[0];
      const degreeStr = arg.substring(2);
      const degrees = parseFloat(degreeStr);

      if (isNaN(degrees)) {
        console.error(`Error: Invalid Right Ascension adjustment: ${arg}`);
        console.error('Expected format: +R<degrees> or -R<degrees> (e.g., +R30, -R45)');
        process.exit(1);
      }

      rightAscensionAdjust = sign === '+' ? degrees : -degrees;
      argOffset++;
    } else {
      // Not an option, break and parse TLE args
      break;
    }
  }

  let name = '';
  let line1 = '';
  let line2 = '';

  // Check if the TLE argument is a file (accounting for optional +A/-A option)
  const tleArgIndex = argOffset;
  const remainingArgs = args.length - argOffset;

  if (remainingArgs === 1 && fs.existsSync(args[tleArgIndex])) {
    // File input
    const filePath = args[tleArgIndex];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

    if (lines.length < 2) {
      console.error('Error: TLE file must contain at least 2 lines');
      process.exit(1);
    }

    // Check if file has 3-line format (name + TLE) or 2-line format
    if (lines.length >= 3 && !lines[0].startsWith('1 ')) {
      name = lines[0].trim();
      line1 = lines[1].trim();
      line2 = lines[2].trim();
    } else {
      name = 'Satellite';
      line1 = lines[0].trim();
      line2 = lines[1].trim();
    }
  } else if (remainingArgs === 2) {
    // Direct TLE input (line1 line2)
    name = 'Satellite';
    line1 = args[tleArgIndex].trim();
    line2 = args[tleArgIndex + 1].trim();
  } else if (remainingArgs === 3) {
    // Name + TLE input (name line1 line2)
    name = args[tleArgIndex].trim();
    line1 = args[tleArgIndex + 1].trim();
    line2 = args[tleArgIndex + 2].trim();
  } else {
    console.error('Error: Invalid arguments');
    console.error('Usage: node generate-constellation.cjs <num-satellites> [+A<degrees>|-A<degrees>] <tle-line1> <tle-line2>');
    console.error('   or: node generate-constellation.cjs <num-satellites> [+A<degrees>|-A<degrees>] <name> <tle-line1> <tle-line2>');
    console.error('   or: node generate-constellation.cjs <num-satellites> [+A<degrees>|-A<degrees>] <tle-file>');
    process.exit(1);
  }

  // Validate TLE format
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    console.error('Error: Invalid TLE format');
    console.error('Line 1 must start with "1 " and Line 2 must start with "2 "');
    process.exit(1);
  }

  // Parse the input TLE
  const parsed = parseTLE(line1, line2);
  const baseMeanAnomaly = parsed.line2.meanAnomaly;
  const baseArgumentOfPerigee = parsed.line2.argumentOfPerigee;
  const baseRightAscension = parsed.line2.rightAscension;

  // Calculate the phase increment (degrees)
  const phaseIncrement = 360.0 / numSatellites;

  // Build status message
  let statusMsg = `Generating ${numSatellites} satellites with ${phaseIncrement.toFixed(2)}° spacing`;
  const adjustments = [];
  if (argumentOfPerigeeAdjust !== 0) {
    const sign = argumentOfPerigeeAdjust > 0 ? '+' : '';
    adjustments.push(`Argument of Perigee ${sign}${argumentOfPerigeeAdjust.toFixed(2)}°`);
  }
  if (rightAscensionAdjust !== 0) {
    const sign = rightAscensionAdjust > 0 ? '+' : '';
    adjustments.push(`RAAN ${sign}${rightAscensionAdjust.toFixed(2)}°`);
  }
  if (adjustments.length > 0) {
    statusMsg += ` (${adjustments.join(', ')})`;
  }
  console.error(statusMsg + '\n');

  // Generate constellation
  const tles = [];
  for (let i = 0; i < numSatellites; i++) {
    // Calculate new Mean Anomaly
    let newMA = baseMeanAnomaly + (i * phaseIncrement);

    // Normalize to 0-360 range
    while (newMA >= 360) {
      newMA -= 360;
    }
    while (newMA < 0) {
      newMA += 360;
    }

    // Calculate new Argument of Perigee with adjustment
    let newAP = baseArgumentOfPerigee + argumentOfPerigeeAdjust;

    // Normalize to 0-360 range
    while (newAP >= 360) {
      newAP -= 360;
    }
    while (newAP < 0) {
      newAP += 360;
    }

    // Calculate new Right Ascension with adjustment
    let newRA = baseRightAscension + rightAscensionAdjust;

    // Normalize to 0-360 range
    while (newRA >= 360) {
      newRA -= 360;
    }
    while (newRA < 0) {
      newRA += 360;
    }

    const tle = generateTLE(name, parsed, newMA, newAP, newRA, i, numSatellites);
    tles.push(tle);

    // Output TLE in 3-line format
    console.log(tle.name);
    console.log(tle.line1);
    console.log(tle.line2);
  }

  console.error(`\nGenerated ${tles.length} TLEs successfully`);
}

// Run main function
main();
