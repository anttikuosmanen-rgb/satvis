/**
 * OMM (Orbit Mean-Elements Message) parsing and conversion to TLE.
 *
 * CelesTrak ran out of 5-digit catalog numbers on 2026-07-11. Objects with
 * catalog numbers >= 100000 are not served in TLE format, only in OMM formats
 * (CSV, JSON, XML, KVN). The rest of the app works with TLE strings, so OMM
 * records are converted to TLEs using the Alpha-5 catalog number scheme
 * (e.g. 100001 -> "A0001"), which covers catalog numbers up to 339999.
 *
 * This module has no dependencies so it can be used from both the browser
 * and the Node data update scripts.
 */

// Alpha-5 skips I and O to avoid confusion with 1 and 0
const ALPHA5_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ALPHA5_MAX = 339999;

/**
 * Encode a catalog number as a 5-character TLE field (Alpha-5 for >= 100000)
 * @param {number|string} catnr - NORAD catalog number
 * @returns {string} 5-character catalog field
 */
export function encodeAlpha5(catnr) {
  const num = Number(catnr);
  if (!Number.isInteger(num) || num < 0 || num > ALPHA5_MAX) {
    throw new RangeError(`Catalog number ${catnr} cannot be represented in TLE format`);
  }
  if (num < 100000) {
    return String(num).padStart(5, "0");
  }
  const letter = ALPHA5_LETTERS[Math.floor(num / 10000) - 10];
  return `${letter}${String(num % 10000).padStart(4, "0")}`;
}

/**
 * Decode a TLE catalog field (plain or Alpha-5) to a numeric string
 * @param {string} field - Catalog field from a TLE line, e.g. "25544", "  694" or "A0001"
 * @returns {string} Catalog number without leading zeros, e.g. "25544", "694" or "100001"
 */
export function decodeAlpha5(field) {
  const value = String(field).trim();
  const index = ALPHA5_LETTERS.indexOf(value[0]?.toUpperCase());
  if (index === -1) {
    return String(parseInt(value, 10));
  }
  return String((index + 10) * 10000 + parseInt(value.slice(1), 10));
}

/**
 * Check whether a text blob looks like OMM data (JSON or CelesTrak CSV) rather than TLE
 * @param {string} text
 * @returns {boolean}
 */
export function isOmmText(text) {
  const start = text.trimStart();
  return start.startsWith("[") || start.startsWith("{") || /^OBJECT_NAME,/.test(start);
}

/**
 * Split a single CSV line, handling double-quoted fields
 */
function splitCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse OMM records from CelesTrak JSON or CSV text
 * @param {string} text - OMM data as JSON (array or single object) or CSV with header row
 * @returns {Object[]} OMM records keyed by OMM field name
 */
export function parseOmm(text) {
  const start = text.trimStart();
  if (start.startsWith("[") || start.startsWith("{")) {
    const data = JSON.parse(start);
    return Array.isArray(data) ? data : [data];
  }

  const lines = start.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(header.map((key, i) => [key, values[i]?.trim()]));
  });
}

/**
 * Compute the TLE checksum (modulo 10) of the first 68 characters of a line
 */
function tleChecksum(line) {
  let sum = 0;
  for (const c of line.slice(0, 68)) {
    if (c >= "0" && c <= "9") {
      sum += c.charCodeAt(0) - 48;
    } else if (c === "-") {
      sum += 1;
    }
  }
  return sum % 10;
}

/**
 * Round half-up on the decimal value, avoiding binary float artifacts (2.9605e-5 * 1e8 = 2960.4999...)
 */
function roundDecimal(value) {
  return Math.round(Number(value.toPrecision(12)));
}

/**
 * Format a value in TLE decimal-point-assumed exponential notation, e.g. -0.000123 -> "-12300-3"
 */
function formatTleExponential(value) {
  const v = Number(value) || 0;
  let mantissa = 0;
  let exponent = 0;
  if (v !== 0) {
    exponent = Math.floor(Math.log10(Math.abs(v))) + 1;
    mantissa = roundDecimal((Math.abs(v) / 10 ** exponent) * 1e5);
    if (mantissa >= 100000) {
      mantissa = 10000;
      exponent += 1;
    }
    if (exponent < -9) {
      mantissa = 0;
      exponent = 0;
    }
  }
  const sign = v < 0 && mantissa !== 0 ? "-" : " ";
  const expSign = exponent < 0 ? "-" : "+";
  return `${sign}${String(mantissa).padStart(5, "0")}${expSign}${Math.abs(exponent)}`;
}

/**
 * Format the first derivative of mean motion, e.g. 0.00002182 -> " .00002182"
 */
function formatMeanMotionDot(value) {
  const v = Number(value) || 0;
  const scaled = roundDecimal(Math.abs(v) * 1e8);
  const sign = v < 0 && scaled !== 0 ? "-" : " ";
  const integer = Math.floor(scaled / 1e8);
  return `${sign}${integer || ""}.${String(scaled % 1e8).padStart(8, "0")}`;
}

/**
 * Format an OMM epoch (ISO 8601, UTC) as TLE epoch YYDDD.DDDDDDDD
 */
function formatEpoch(epoch) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(epoch);
  if (!match) {
    throw new Error(`Invalid OMM epoch: ${epoch}`);
  }
  const [, year, month, day, hour, minute, second] = match;
  const dayStart = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const dayOfYear = (dayStart - Date.UTC(Number(year), 0, 1)) / 86400000 + 1;
  const fraction = (Number(hour) * 3600 + Number(minute) * 60 + Number(second)) / 86400;
  const yy = String(Number(year) % 100).padStart(2, "0");
  return `${yy}${(dayOfYear + fraction).toFixed(8).padStart(12, "0")}`;
}

/**
 * Format an OMM OBJECT_ID (e.g. "1998-067A") as TLE international designator ("98067A  ")
 */
function formatIntlDesignator(objectId) {
  const match = /^\d{2}(\d{2})-(\d{3})([A-Z]{0,3})$/.exec(String(objectId ?? "").trim());
  return (match ? `${match[1]}${match[2]}${match[3]}` : "").padEnd(8, " ");
}

/**
 * Format an angle in degrees as TLE field (8 chars, 4 decimals)
 */
function formatAngle(value) {
  return Number(value).toFixed(4).padStart(8, " ");
}

/**
 * Convert an OMM record to a three-line element set
 * @param {Object} omm - OMM record (CelesTrak JSON/CSV field names)
 * @returns {string} TLE string "NAME\nLINE1\nLINE2"
 */
export function ommToTle(omm) {
  const catalog = encodeAlpha5(omm.NORAD_CAT_ID);
  const classification = (omm.CLASSIFICATION_TYPE || "U").slice(0, 1);
  const ephemerisType = String(omm.EPHEMERIS_TYPE ?? 0).slice(0, 1);
  const elementSet = String(Number(omm.ELEMENT_SET_NO || 999) % 10000).padStart(4, " ");

  const eccentricity = Number(omm.ECCENTRICITY);
  if (!(eccentricity >= 0 && eccentricity < 1)) {
    throw new RangeError(`Eccentricity ${omm.ECCENTRICITY} of ${omm.OBJECT_NAME} cannot be represented in TLE format`);
  }

  const line1Body = [
    `1 ${catalog}${classification}`,
    formatIntlDesignator(omm.OBJECT_ID),
    formatEpoch(omm.EPOCH),
    formatMeanMotionDot(omm.MEAN_MOTION_DOT),
    formatTleExponential(omm.MEAN_MOTION_DDOT),
    formatTleExponential(omm.BSTAR),
    ephemerisType,
    elementSet,
  ].join(" ");

  const line2Body = [
    `2 ${catalog}`,
    formatAngle(omm.INCLINATION),
    formatAngle(omm.RA_OF_ASC_NODE),
    String(Math.round(eccentricity * 1e7)).padStart(7, "0"),
    formatAngle(omm.ARG_OF_PERICENTER),
    formatAngle(omm.MEAN_ANOMALY),
    `${Number(omm.MEAN_MOTION).toFixed(8).padStart(11, " ")}${String(Number(omm.REV_AT_EPOCH || 0) % 100000).padStart(5, " ")}`,
  ].join(" ");

  const name = String(omm.OBJECT_NAME ?? "").trim() || `NORAD ${omm.NORAD_CAT_ID}`;
  return `${name}\n${line1Body}${tleChecksum(line1Body)}\n${line2Body}${tleChecksum(line2Body)}`;
}

/**
 * Convert OMM text (JSON or CSV) to TLE strings, skipping records that cannot be represented
 * @param {string} text - OMM data
 * @param {(record: Object, error: Error) => void} [onSkip] - Called for each skipped record
 * @returns {string[]} TLE strings "NAME\nLINE1\nLINE2"
 */
export function ommTextToTles(text, onSkip) {
  const tles = [];
  for (const record of parseOmm(text)) {
    try {
      tles.push(ommToTle(record));
    } catch (error) {
      onSkip?.(record, error);
    }
  }
  return tles;
}
