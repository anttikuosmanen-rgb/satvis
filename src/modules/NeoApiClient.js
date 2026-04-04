/**
 * API client for NASA NeoWs (Near Earth Object Web Service) and JPL SBDB (Small-Body Database).
 */
export class NeoApiClient {
  /**
   * Fetch close-approach NEOs from NASA NeoWs API.
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format (max 7 days from start)
   * @param {string} apiKey - NASA API key (default: DEMO_KEY)
   * @returns {Promise<Array<Object>>} Flat array of NEO objects
   */
  static async fetchCloseApproaches(startDate, endDate, apiKey = "DEMO_KEY") {
    const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${startDate}&end_date=${endDate}&api_key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`NeoWs API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const neos = [];

    // NeoWs returns NEOs grouped by date
    for (const dateKey of Object.keys(data.near_earth_objects)) {
      for (const neo of data.near_earth_objects[dateKey]) {
        // Get the closest approach for this date window
        const approach = neo.close_approach_data[0];
        if (!approach) continue;

        neos.push({
          id: neo.id,
          name: neo.name,
          designation: neo.neo_reference_id,
          magnitude: neo.absolute_magnitude_h,
          diameter_km: neo.estimated_diameter?.kilometers
            ? (neo.estimated_diameter.kilometers.estimated_diameter_min + neo.estimated_diameter.kilometers.estimated_diameter_max) / 2
            : null,
          is_hazardous: neo.is_potentially_hazardous_asteroid,
          close_approach: {
            date: approach.close_approach_date_full,
            velocity_kms: parseFloat(approach.relative_velocity?.kilometers_per_second) || 0,
            miss_distance_km: parseFloat(approach.miss_distance?.kilometers) || 0,
            miss_distance_lunar: parseFloat(approach.miss_distance?.lunar) || 0,
          },
        });
      }
    }

    // Deduplicate by ID (same NEO can appear on multiple dates)
    const seen = new Set();
    return neos.filter((neo) => {
      if (seen.has(neo.id)) return false;
      seen.add(neo.id);
      return true;
    });
  }

  /**
   * Fetch orbital elements for a specific NEO from JPL SBDB API.
   * @param {string} designation - NEO designation or SPK-ID
   * @returns {Promise<Object|null>} Orbital elements or null if not found
   */
  static async fetchOrbitalElements(designation, retries = 3) {
    // Use Vite dev server proxy to bypass CORS (proxied to ssd-api.jpl.nasa.gov/sbdb.api)
    const url = `/api/sbdb?sstr=${encodeURIComponent(designation)}&phys-par=1`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url);

      if (response.status === 503 || response.status === 429) {
        // JPL API overloaded — wait and retry
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        return null;
      }

      return NeoApiClient._parseOrbitalElements(designation, await response.json());
    }
    return null;
  }

  static _parseOrbitalElements(designation, data) {
    if (!data.orbit || !data.orbit.elements) {
      return null;
    }

    // Parse orbital elements from the SBDB response
    const elementsArray = data.orbit.elements;
    const getElement = (name) => {
      const el = elementsArray.find((e) => e.name === name);
      return el ? parseFloat(el.value) : null;
    };

    const e = getElement("e");
    const a = getElement("a");
    const i = getElement("i");
    const om = getElement("om");
    const w = getElement("w");
    const ma = getElement("ma");
    const n = getElement("n");
    const tp = getElement("tp"); // Time of perihelion (JD TDB)

    // Epoch is stored separately
    const epoch_jd = data.orbit.epoch ? parseFloat(data.orbit.epoch) : null;

    if (e === null || a === null || epoch_jd === null) {
      return null;
    }

    // Compute mean motion if not provided (n = 360 / period_days)
    let n_deg_day = n;
    if (n_deg_day === null && a !== null) {
      // Kepler's third law: P = a^(3/2) years for heliocentric orbits
      const period_years = Math.pow(a, 1.5);
      const period_days = period_years * 365.25;
      n_deg_day = 360 / period_days;
    }

    // Compute mean anomaly at epoch if not provided
    let ma_deg = ma;
    if (ma_deg === null && tp !== null && n_deg_day !== null && epoch_jd !== null) {
      ma_deg = n_deg_day * (epoch_jd - tp);
      // Normalize to [0, 360)
      ma_deg = ((ma_deg % 360) + 360) % 360;
    }

    // Get physical parameters
    let diameter_km = null;
    if (data.phys_par) {
      const diamParam = data.phys_par.find((p) => p.name === "diameter");
      if (diamParam) {
        diameter_km = parseFloat(diamParam.value);
      }
    }

    const period_days = n_deg_day ? 360 / n_deg_day : null;

    return {
      name: data.object?.fullname || data.object?.des || designation,
      designation: data.object?.des || designation,
      epoch_jd,
      e,
      a_au: a,
      i_deg: i || 0,
      om_deg: om || 0,
      w_deg: w || 0,
      ma_deg: ma_deg || 0,
      n_deg_day: n_deg_day || 0,
      period_days,
      H: data.object?.H ? parseFloat(data.object.H) : null,
      diameter_km,
      orbit_class: data.orbit?.orbit_class?.name || null,
    };
  }

  /**
   * Fetch state vectors for any Horizons-identifiable body (planets, spacecraft, small bodies).
   * @param {string} command - Horizons COMMAND string (e.g. '399', '-234', 'Apophis')
   * @param {Date} centerDate - Center of the time window (default: now)
   * @param {number} windowDays - Total window size in days (default: 1)
   * @returns {Promise<{name: string, vectors: Array<{julianDate: number, x: number, y: number, z: number}>}|null>}
   */
  static async fetchEphemerisVectors(command, centerDate = new Date(), windowDays = 1) {
    const halfMs = (windowDays / 2) * 86400000;
    const start = new Date(centerDate.getTime() - halfMs).toISOString().split("T")[0];
    const stop = new Date(centerDate.getTime() + halfMs).toISOString().split("T")[0];

    // Ensure start != stop (minimum 1-day window)
    const stopDate = stop === start ? new Date(centerDate.getTime() + 86400000).toISOString().split("T")[0] : stop;

    const params = new URLSearchParams({
      format: "json",
      COMMAND: `'${command}'`,
      EPHEM_TYPE: "'VECTORS'",
      CENTER: "'@399'",
      START_TIME: `'${start}'`,
      STOP_TIME: `'${stopDate}'`,
      STEP_SIZE: "'1h'",
      OUT_UNITS: "'KM-S'",
      REF_SYSTEM: "'ICRF'",
      REF_PLANE: "'FRAME'",
      VEC_TABLE: "'1'",
    });

    const response = await fetch(`/api/horizons?${params}`);
    if (!response.ok) {
      throw new Error(`Horizons API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = NeoApiClient._parseHorizonsVectors(data);

    // If no vectors returned, check for "no ephemeris prior to" warning and retry
    if (result && result.vectors.length === 0) {
      const ephStart = NeoApiClient._parseEphemerisStart(data.result);
      if (ephStart) {
        // Add 2-minute buffer so START_TIME is strictly after the ephemeris start
        const buffered = new Date(ephStart.getTime() + 120000);
        const retryStart = NeoApiClient._formatHorizonsDate(buffered);
        const retryStop = NeoApiClient._formatHorizonsDate(new Date(buffered.getTime() + windowDays * 86400000));
        console.log(`[Horizons] Retrying ${command} with START_TIME='${retryStart}'`);
        params.set("START_TIME", `'${retryStart}'`);
        params.set("STOP_TIME", `'${retryStop}'`);
        const retryResponse = await fetch(`/api/horizons?${params}`);
        if (retryResponse.ok) {
          return NeoApiClient._parseHorizonsVectors(await retryResponse.json());
        }
      }
    }

    return result;
  }

  // Parse "No ephemeris ... prior to A.D. YYYY-MON-DD HH:MM:SS" from Horizons result text
  static _parseEphemerisStart(text) {
    if (!text) return null;
    const months = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
    const m = text.match(/prior to A\.D\.\s+(\d{4})-([A-Z]{3})-(\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (!m) return null;
    return new Date(`${m[1]}-${months[m[2]]}-${m[3]}T${m[4]}Z`);
  }

  /**
   * Fetch the ephemeris time span for a Horizons body.
   * Queries ±3 years around the given center date with 30-day steps (≤73 samples).
   *
   * Start: detected from "No ephemeris prior to" message (exact) or absence thereof (null = unlimited).
   * End: Horizons does not emit an "after" message — detected by comparing the last sample
   *   Julian date against the requested stop time. If the data ends >90 days before the
   *   stop, the ephemeris is bounded there; otherwise it extends beyond the query window (null = unlimited).
   *
   * @param {string} command - Horizons COMMAND string
   * @param {Date} [centerDate] - Center of the search window (default: now)
   * @returns {Promise<{start: Date|null, end: Date|null}>}
   */
  static async fetchEphemerisSpan(command, centerDate = new Date()) {
    const THREE_YEARS_MS = 3 * 365.25 * 86400000;
    const queryStart = new Date(centerDate.getTime() - THREE_YEARS_MS);
    const queryStop = new Date(centerDate.getTime() + THREE_YEARS_MS);

    const params = new URLSearchParams({
      format: "json",
      COMMAND: `'${command}'`,
      EPHEM_TYPE: "'VECTORS'",
      CENTER: "'@399'",
      START_TIME: `'${NeoApiClient._formatHorizonsDate(queryStart)}'`,
      STOP_TIME: `'${NeoApiClient._formatHorizonsDate(queryStop)}'`,
      STEP_SIZE: "'30d'",
      OUT_UNITS: "'KM-S'",
      REF_SYSTEM: "'ICRF'",
      REF_PLANE: "'FRAME'",
      VEC_TABLE: "'1'",
    });

    const response = await fetch(`/api/horizons?${params}`);
    if (!response.ok) return { start: null, end: null };
    const data = await response.json();
    const text = data.result;
    if (!text) return { start: null, end: null };

    let start = null;
    let end = null;

    // "prior to" message → exact start date (only present when query starts before ephemeris)
    const ephStart = NeoApiClient._parseEphemerisStart(text);
    if (ephStart) start = ephStart;
    // No message → ephemeris extends at least to queryStart → start = null (unlimited backward)

    // Detect end from last Julian date in the data block.
    // Horizons silently stops returning data at the trajectory end without an explicit message.
    const soeIdx = text.indexOf("$$SOE");
    const eoeIdx = text.indexOf("$$EOE");
    if (soeIdx >= 0 && eoeIdx >= 0) {
      const block = text.substring(soeIdx + 5, eoeIdx);
      const jdMatches = [...block.matchAll(/(\d{7,}\.\d+)\s*=/g)];
      if (jdMatches.length > 0) {
        const lastJd = parseFloat(jdMatches[jdMatches.length - 1][1]);
        const lastMs = (lastJd - 2440587.5) * 86400000;
        // If the last sample is >90 days before the stop, the ephemeris ends there
        if (queryStop.getTime() - lastMs > 90 * 86400000) {
          end = new Date(lastMs);
        }
        // Otherwise ephemeris extends to/beyond the query window → end = null (unlimited)
      }
    }

    return { start, end };
  }

  // Format Date as 'YYYY-MM-DD HH:MM:SS' for Horizons START_TIME/STOP_TIME
  static _formatHorizonsDate(date) {
    return date.toISOString().replace("T", " ").substring(0, 19);
  }

  /**
   * Fetch the full Horizons major bodies list (planets, moons, spacecraft, etc.).
   * @returns {Promise<Array<{id: string, name: string}>>}
   */
  static async fetchMajorBodies() {
    const params = new URLSearchParams({ format: "json", COMMAND: "'MB'" });
    const response = await fetch(`/api/horizons?${params}`);
    if (!response.ok) {
      throw new Error(`Horizons API error: ${response.status}`);
    }
    const data = await response.json();
    return NeoApiClient._parseMajorBodies(data.result);
  }

  static _parseMajorBodies(text) {
    if (!text) return [];
    const bodies = [];
    // Each line: right-aligned ID (may be negative), 2+ spaces, name
    // e.g.: "      399  Earth                                           Geocenter"
    const lineRegex = /^\s*(-?\d+)\s{2,}(\S[^\n]*)/gm;
    let match;
    while ((match = lineRegex.exec(text)) !== null) {
      const id = match[1];
      // Name is everything before a run of 3+ spaces (separates name from designation)
      const name = match[2].split(/\s{3,}/)[0].trim();
      if (name) bodies.push({ id, name });
    }
    return bodies;
  }

  static _parseHorizonsVectors(data) {
    const result = data.result;
    if (!result) return null;

    // Extract object name from "Target body name:" header line
    const nameMatch = result.match(/Target body name:\s*([^\n{]+)/);
    const name = nameMatch ? nameMatch[1].trim() : "Unknown";

    // Parse $$SOE...$$EOE block
    const soeIdx = result.indexOf("$$SOE");
    const eoeIdx = result.indexOf("$$EOE");
    if (soeIdx < 0 || eoeIdx < 0) return { name, vectors: [] };

    const block = result.substring(soeIdx + 5, eoeIdx);
    const vectors = [];

    // Each record: Julian date line followed by X= Y= Z= line
    // Format: "2460000.500000000 = A.D. 2023-Feb-25 00:00:00.0000 TDB"
    //         " X = 1.234E+04 Y = 5.678E+03 Z =-1.234E+02"
    const recordRegex = /(\d+\.\d+)\s*=.*?\n\s*X\s*=\s*([^\s]+)\s+Y\s*=\s*([^\s]+)\s+Z\s*=\s*([^\s]+)/g;
    let match;
    while ((match = recordRegex.exec(block)) !== null) {
      vectors.push({
        julianDate: parseFloat(match[1]),
        x: parseFloat(match[2]),
        y: parseFloat(match[3]),
        z: parseFloat(match[4]),
      });
    }

    if (vectors.length === 0) return null;
    return { name, vectors };
  }

  /**
   * Fetch orbital elements for multiple NEOs with concurrency limiting.
   * @param {Array<string>} designations - Array of NEO designations
   * @param {number} concurrency - Max concurrent requests (default: 3)
   * @param {Function} onProgress - Optional callback(completed, total)
   * @returns {Promise<Map<string, Object>>} Map of designation → orbital elements
   */
  static async fetchOrbitalElementsBatch(designations, concurrency = 1, onProgress = null) {
    const results = new Map();
    let completed = 0;

    // Process in batches
    for (let i = 0; i < designations.length; i += concurrency) {
      const batch = designations.slice(i, i + concurrency);
      const promises = batch.map(async (des) => {
        const elements = await NeoApiClient.fetchOrbitalElements(des);
        if (elements) {
          results.set(des, elements);
        }
        completed++;
        if (onProgress) {
          onProgress(completed, designations.length);
        }
      });

      await Promise.all(promises);
    }

    return results;
  }
}
