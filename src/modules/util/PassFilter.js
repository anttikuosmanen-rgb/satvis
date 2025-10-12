import dayjs from "dayjs";
import { useSatStore } from "../../stores/sat";

/**
 * Filter and sort satellite passes based on time, sunlight, and eclipse conditions
 * @param {Array} passes - Array of pass objects
 * @param {Date|Cesium.JulianDate} time - Current time for filtering
 * @param {number} deltaHours - How many hours ahead to include passes (default: 48)
 * @returns {Array} Filtered and sorted passes
 */
export function filterAndSortPasses(passes, time, deltaHours = 48) {
  // Filter passes based on time
  let filtered = passes.filter((pass) => dayjs(pass.start).diff(time, "hours") < deltaHours);

  // Filter out passes before epoch - 90 minutes for future epoch satellites
  // This must happen BEFORE sunlight filtering to ensure correct filtering order
  filtered = filtered.filter((pass) => {
    if (pass.epochInFuture && pass.epochTime) {
      const epochMinus90 = new Date(pass.epochTime.getTime() - 90 * 60 * 1000);
      const passStart = new Date(pass.start);
      return passStart >= epochMinus90;
    }
    return true;
  });

  // Filter out passes in sunlight if option is enabled
  const satStore = useSatStore();
  if (satStore.hideSunlightPasses) {
    filtered = filtered.filter((pass) =>
      // Show pass if either start or end in darkness
      pass.groundStationDarkAtStart || pass.groundStationDarkAtEnd);
  }

  // Filter out passes where satellite is eclipsed for the entire pass if option is enabled
  if (satStore.showOnlyLitPasses) {
    filtered = filtered.filter((pass) => {
      // Show pass if satellite is lit at start OR end OR has any eclipse transitions
      // (transitions mean it goes from lit to eclipsed or vice versa during the pass)
      const litAtStart = !pass.satelliteEclipsedAtStart;
      const litAtEnd = !pass.satelliteEclipsedAtEnd;
      const hasTransitions = pass.eclipseTransitions && pass.eclipseTransitions.length > 0;

      return litAtStart || litAtEnd || hasTransitions;
    });
  }

  // Sort passes by time
  filtered = filtered.sort((a, b) => a.start - b.start);
  return filtered;
}
