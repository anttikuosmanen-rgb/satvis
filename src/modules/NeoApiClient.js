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
