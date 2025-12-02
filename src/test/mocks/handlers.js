import { http, HttpResponse } from "msw";

/**
 * MSW (Mock Service Worker) handlers for API mocking in integration tests
 * Mocks TLE data endpoints to prevent network requests during testing
 */

/**
 * Calculate TLE epoch string from current date
 * TLE epoch format: YYDDD.FFFFFFFF where YY=year, DDD=day of year, F=fractional day
 * @returns {string} Epoch string (e.g., "25320.50000000" for Nov 16, 2025 at noon)
 */
function getCurrentTLEEpoch() {
  const now = new Date();
  const year = now.getFullYear() % 100; // Last 2 digits of year
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const fractionalDay = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;

  return `${year.toString().padStart(2, "0")}${dayOfYear.toString().padStart(3, "0")}.${fractionalDay.toFixed(8).split(".")[1]}`;
}

// Generate TLE data with current epoch (updates daily automatically)
const currentEpoch = getCurrentTLEEpoch();

const MOCK_TLE_STATIONS = `ISS (ZARYA)
1 25544U 98067A   ${currentEpoch}  .00016717  00000-0  10270-3 0  9991
2 25544  51.6416 247.4627 0006703  85.5961 274.6009 15.49478733123456
TIANGONG
1 48274U 21035A   ${currentEpoch}  .00001234  00000-0  12345-4 0  9997
2 48274  41.4688 123.4567 0004321 123.4567 236.7890 15.59876543234567`;

const MOCK_TLE_STARLINK = `STARLINK-1007
1 44713U 19074A   ${currentEpoch}  .00002345  00000-0  16789-4 0  9990
2 44713  53.0543 123.4567 0001234  90.1234 269.8765 15.06380987123456
STARLINK-1008
1 44714U 19074B   ${currentEpoch}  .00002456  00000-0  17890-4 0  9991
2 44714  53.0544 124.5678 0001345  91.2345 268.7654 15.06381098234567`;

const MOCK_CUSTOM_SATELLITE = `CUSTOM-SAT-1
1 99999U 24001A   ${currentEpoch}  .00001000  00000-0  10000-4 0  9999
2 99999  98.0000 180.0000 0010000 100.0000 260.0000 14.50000000100000`;

export const handlers = [
  // Mock TLE data from local files (used in development)
  http.get("*/data/tle/stations.txt", () => {
    return HttpResponse.text(MOCK_TLE_STATIONS);
  }),

  http.get("*/data/tle/starlink.txt", () => {
    return HttpResponse.text(MOCK_TLE_STARLINK);
  }),

  // Mock Celestrak API endpoints (external TLE sources)
  http.get("https://celestrak.org/NORAD/elements/stations.txt", () => {
    return HttpResponse.text(MOCK_TLE_STATIONS);
  }),

  http.get("https://celestrak.org/NORAD/elements/starlink.txt", () => {
    return HttpResponse.text(MOCK_TLE_STARLINK);
  }),

  // Mock custom TLE endpoint
  http.post("*/api/custom-tle", async ({ request }) => {
    const body = await request.json();
    if (body.tle) {
      return HttpResponse.json({ success: true, tle: body.tle });
    }
    return HttpResponse.json({ success: false, error: "Invalid TLE" }, { status: 400 });
  }),

  // Mock imagery tiles (for offline testing)
  http.get("*/data/cesium-assets/*", () => {
    // Return empty image response
    return HttpResponse.arrayBuffer(new ArrayBuffer(0), {
      headers: { "Content-Type": "image/png" },
    });
  }),
];

// Helper function to simulate network errors
export const errorHandlers = [
  http.get("*/data/tle/stations.txt", () => {
    return HttpResponse.error();
  }),

  http.get("https://celestrak.org/*", () => {
    return HttpResponse.error();
  }),
];

// Helper to get TLE by name
export function getMockTLE(satelliteName) {
  const tleData = {
    "ISS (ZARYA)": MOCK_TLE_STATIONS.split("\n").slice(0, 3).join("\n"),
    TIANGONG: MOCK_TLE_STATIONS.split("\n").slice(3, 6).join("\n"),
    "STARLINK-1007": MOCK_TLE_STARLINK.split("\n").slice(0, 3).join("\n"),
    "CUSTOM-SAT-1": MOCK_CUSTOM_SATELLITE,
  };

  return tleData[satelliteName] || null;
}
