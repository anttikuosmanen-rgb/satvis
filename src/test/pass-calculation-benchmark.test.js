/**
 * Pass Calculation Benchmark Tests
 *
 * These tests directly call the pass calculation functions with stats enabled
 * to measure performance and identify bottlenecks.
 *
 * Run with: npm test -- --testPathPattern=pass-calculation-benchmark
 */

import { describe, it, expect } from "vitest";
import Orbit from "../modules/Orbit.js";

// Generate fresh TLE epoch for today
function generateFreshEpoch() {
  const now = new Date();
  const year = now.getUTCFullYear() % 100;
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const fractionOfDay = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86400;
  return `${year.toString().padStart(2, "0")}${(dayOfYear + fractionOfDay).toFixed(8).padStart(12, "0")}`;
}

// Fresh ISS TLE with dynamic epoch
const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   ${generateFreshEpoch()}  .00016717  00000-0  10270-3 0  9991
2 25544  51.6416 247.4627 0006703  85.5961 274.6009 15.49478733123456`;

// Ground stations for testing
const MUNICH_GS = {
  latitude: 48.1351,
  longitude: 11.582,
  height: 520, // meters
};

const TOKYO_GS = {
  latitude: 35.6762,
  longitude: 139.6503,
  height: 40,
};

const NEW_YORK_GS = {
  latitude: 40.7128,
  longitude: -74.006,
  height: 10,
};

describe("Pass Calculation Benchmark", () => {
  describe("computePassesElevationSync", () => {
    it("should benchmark 7-day pass calculation with stats", () => {
      const orbit = new Orbit("ISS (ZARYA)", ISS_TLE);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Run with stats collection enabled
      const result = orbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 50, true);

      expect(result).toHaveProperty("passes");
      expect(result).toHaveProperty("stats");
      expect(result.stats).toHaveProperty("totalTime");
      expect(result.stats).toHaveProperty("propagationTime");
      expect(result.stats).toHaveProperty("propagationCalls");
      expect(result.stats).toHaveProperty("iterations");
      expect(result.stats).toHaveProperty("passesFound");

      // Log stats for analysis
      console.log("\n=== 7-Day Pass Calculation (Munich) ===");
      console.log(`Total time: ${result.stats.totalTime.toFixed(1)}ms`);
      console.log(`Iterations: ${result.stats.iterations}`);
      console.log(`Propagation: ${result.stats.propagationTime.toFixed(1)}ms (${((result.stats.propagationTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`  Calls: ${result.stats.propagationCalls} @ ${(result.stats.propagationTime / result.stats.propagationCalls).toFixed(3)}ms avg`);
      console.log(`Look angles: ${result.stats.lookAnglesTime.toFixed(1)}ms (${((result.stats.lookAnglesTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Eclipse: ${result.stats.eclipseTime.toFixed(1)}ms (${((result.stats.eclipseTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Transitions: ${result.stats.transitionTime.toFixed(1)}ms (${((result.stats.transitionTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Darkness: ${result.stats.darknessTime.toFixed(1)}ms (${((result.stats.darknessTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Passes found: ${result.stats.passesFound}`);

      // Verify we found some passes
      expect(result.passes.length).toBeGreaterThan(0);
      expect(result.stats.passesFound).toBeGreaterThan(0);
    });

    it("should benchmark with different calculation windows", () => {
      const orbit = new Orbit("ISS (ZARYA)", ISS_TLE);
      const startDate = new Date();

      const windows = [
        { days: 1, label: "1 day" },
        { days: 3, label: "3 days" },
        { days: 7, label: "7 days" },
        { days: 14, label: "14 days" },
      ];

      console.log("\n=== Window Size Comparison ===");

      for (const window of windows) {
        const endDate = new Date(startDate.getTime() + window.days * 24 * 60 * 60 * 1000);
        const result = orbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 100, true);

        console.log(`${window.label}: ${result.stats.totalTime.toFixed(1)}ms, ${result.stats.iterations} iterations, ${result.stats.passesFound} passes`);
      }
    });

    it("should benchmark with different ground stations", () => {
      const orbit = new Orbit("ISS (ZARYA)", ISS_TLE);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const stations = [
        { gs: MUNICH_GS, name: "Munich" },
        { gs: TOKYO_GS, name: "Tokyo" },
        { gs: NEW_YORK_GS, name: "New York" },
      ];

      console.log("\n=== Ground Station Comparison (7 days) ===");

      for (const station of stations) {
        const result = orbit.computePassesElevationSync(station.gs, startDate, endDate, 5, 50, true);

        console.log(`${station.name}: ${result.stats.totalTime.toFixed(1)}ms, ${result.stats.passesFound} passes, ${result.stats.propagationCalls} propagations`);
      }
    });
  });

  describe("computePassesSwathSync", () => {
    it("should benchmark swath-based pass calculation", () => {
      const orbit = new Orbit("ISS (ZARYA)", ISS_TLE);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      // 500km swath width (typical for imaging satellites)
      const result = orbit.computePassesSwathSync(MUNICH_GS, 500, startDate, endDate, 50, true);

      expect(result).toHaveProperty("passes");
      expect(result).toHaveProperty("stats");

      console.log("\n=== 7-Day Swath Calculation (500km, Munich) ===");
      console.log(`Total time: ${result.stats.totalTime.toFixed(1)}ms`);
      console.log(`Iterations: ${result.stats.iterations}`);
      console.log(`Propagation: ${result.stats.propagationTime.toFixed(1)}ms (${((result.stats.propagationTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Distance calc: ${result.stats.distanceCalcTime.toFixed(1)}ms (${((result.stats.distanceCalcTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Eclipse: ${result.stats.eclipseTime.toFixed(1)}ms (${((result.stats.eclipseTime / result.stats.totalTime) * 100).toFixed(1)}%)`);
      console.log(`Passes found: ${result.stats.passesFound}`);
    });

    it("should compare different swath widths", () => {
      const orbit = new Orbit("ISS (ZARYA)", ISS_TLE);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const swathWidths = [100, 250, 500, 1000, 2000];

      console.log("\n=== Swath Width Comparison (7 days) ===");

      for (const swath of swathWidths) {
        const result = orbit.computePassesSwathSync(MUNICH_GS, swath, startDate, endDate, 50, true);
        console.log(`${swath}km swath: ${result.stats.totalTime.toFixed(1)}ms, ${result.stats.passesFound} passes, ${result.stats.iterations} iterations`);
      }
    });
  });

  describe("Intense multi-satellite benchmark", () => {
    // Iridium NEXT TLEs with fresh epochs
    const generateIridiumTles = () => {
      const epoch = generateFreshEpoch();
      return [
        {
          name: "IRIDIUM 106",
          tle: `IRIDIUM 106\n1 41917U 17003A   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41917  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 103",
          tle: `IRIDIUM 103\n1 41918U 17003B   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41918  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 109",
          tle: `IRIDIUM 109\n1 41919U 17003C   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41919  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 102",
          tle: `IRIDIUM 102\n1 41920U 17003D   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41920  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 105",
          tle: `IRIDIUM 105\n1 41921U 17003E   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41921  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 104",
          tle: `IRIDIUM 104\n1 41922U 17003F   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41922  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 114",
          tle: `IRIDIUM 114\n1 41923U 17003G   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41923  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 108",
          tle: `IRIDIUM 108\n1 41924U 17003H   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41924  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 112",
          tle: `IRIDIUM 112\n1 41925U 17003J   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41925  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 111",
          tle: `IRIDIUM 111\n1 41926U 17003K   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 41926  86.3958 156.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 113",
          tle: `IRIDIUM 113\n1 42803U 17039A   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42803  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 123",
          tle: `IRIDIUM 123\n1 42804U 17039B   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42804  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 120",
          tle: `IRIDIUM 120\n1 42805U 17039C   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42805  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 115",
          tle: `IRIDIUM 115\n1 42806U 17039D   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42806  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 118",
          tle: `IRIDIUM 118\n1 42807U 17039E   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42807  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 116",
          tle: `IRIDIUM 116\n1 42808U 17039F   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42808  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 124",
          tle: `IRIDIUM 124\n1 42809U 17039G   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42809  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 119",
          tle: `IRIDIUM 119\n1 42810U 17039H   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42810  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 122",
          tle: `IRIDIUM 122\n1 42811U 17039J   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42811  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 117",
          tle: `IRIDIUM 117\n1 42812U 17039K   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42812  86.3958 126.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 130",
          tle: `IRIDIUM 130\n1 42955U 17061A   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42955  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 131",
          tle: `IRIDIUM 131\n1 42956U 17061B   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42956  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 125",
          tle: `IRIDIUM 125\n1 42957U 17061C   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42957  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 126",
          tle: `IRIDIUM 126\n1 42958U 17061D   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42958  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 128",
          tle: `IRIDIUM 128\n1 42959U 17061E   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42959  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 132",
          tle: `IRIDIUM 132\n1 42960U 17061F   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42960  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 127",
          tle: `IRIDIUM 127\n1 42961U 17061G   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42961  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 133",
          tle: `IRIDIUM 133\n1 42962U 17061H   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42962  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 129",
          tle: `IRIDIUM 129\n1 42963U 17061J   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42963  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
        {
          name: "IRIDIUM 134",
          tle: `IRIDIUM 134\n1 42964U 17061K   ${epoch}  .00000086  00000+0  24717-4 0  9991\n2 42964  86.3958  96.5764 0002278  87.8379 272.3067 14.34216935405887`,
        },
      ];
    };

    it("should benchmark 30 satellites with 7-day pass calculation", () => {
      const satellites = generateIridiumTles();
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      console.log("\n=== INTENSE BENCHMARK: 30 Iridium NEXT Satellites (7 days) ===");

      const overallStart = performance.now();
      let totalPasses = 0;
      let totalIterations = 0;
      let totalPropagationTime = 0;
      let totalEclipseTime = 0;
      let totalTransitionTime = 0;

      const results = [];

      for (const sat of satellites) {
        const orbit = new Orbit(sat.name, sat.tle);
        const result = orbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 50, true);

        totalPasses += result.stats.passesFound;
        totalIterations += result.stats.iterations;
        totalPropagationTime += result.stats.propagationTime;
        totalEclipseTime += result.stats.eclipseTime;
        totalTransitionTime += result.stats.transitionTime;

        results.push({
          name: sat.name,
          time: result.stats.totalTime,
          passes: result.stats.passesFound,
        });
      }

      const overallTime = performance.now() - overallStart;

      console.log(`\nSatellites processed: ${satellites.length}`);
      console.log(`Total wall-clock time: ${overallTime.toFixed(0)}ms`);
      console.log(`Total passes found: ${totalPasses}`);
      console.log(`Total iterations: ${totalIterations}`);
      console.log(`\nBreakdown:`);
      console.log(`  Propagation: ${totalPropagationTime.toFixed(0)}ms (${((totalPropagationTime / overallTime) * 100).toFixed(1)}%)`);
      console.log(`  Eclipse: ${totalEclipseTime.toFixed(0)}ms (${((totalEclipseTime / overallTime) * 100).toFixed(1)}%)`);
      console.log(`  Transitions: ${totalTransitionTime.toFixed(0)}ms (${((totalTransitionTime / overallTime) * 100).toFixed(1)}%)`);
      console.log(`\nPer-satellite average: ${(overallTime / satellites.length).toFixed(1)}ms`);

      // Show top 5 slowest
      results.sort((a, b) => b.time - a.time);
      console.log(`\nSlowest satellites:`);
      results.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.name}: ${r.time.toFixed(1)}ms (${r.passes} passes)`);
      });

      expect(totalPasses).toBeGreaterThan(0);
    });

    it("should benchmark sequential vs theoretical parallel speedup", () => {
      const satellites = generateIridiumTles().slice(0, 10); // Use 10 satellites
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      console.log("\n=== PARALLEL POTENTIAL: 10 Satellites ===");

      // Sequential benchmark
      const seqStart = performance.now();
      const times = [];

      for (const sat of satellites) {
        const satStart = performance.now();
        const orbit = new Orbit(sat.name, sat.tle);
        orbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 50, false);
        times.push(performance.now() - satStart);
      }

      const seqTotal = performance.now() - seqStart;
      const maxTime = Math.max(...times);

      console.log(`Sequential total: ${seqTotal.toFixed(0)}ms`);
      console.log(`Longest single: ${maxTime.toFixed(0)}ms`);
      console.log(`Theoretical parallel (max): ${maxTime.toFixed(0)}ms`);
      console.log(`Potential speedup: ${(seqTotal / maxTime).toFixed(1)}x`);
    });
  });

  describe("Performance comparison without stats", () => {
    it("should verify stats collection has minimal overhead", () => {
      const orbit = new Orbit("ISS (ZARYA)", ISS_TLE);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Run without stats multiple times
      const runsWithoutStats = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        orbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 50, false);
        runsWithoutStats.push(performance.now() - start);
      }

      // Run with stats multiple times
      const runsWithStats = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        orbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 50, true);
        runsWithStats.push(performance.now() - start);
      }

      const avgWithout = runsWithoutStats.reduce((a, b) => a + b, 0) / runsWithoutStats.length;
      const avgWith = runsWithStats.reduce((a, b) => a + b, 0) / runsWithStats.length;
      const overhead = ((avgWith - avgWithout) / avgWithout) * 100;

      console.log("\n=== Stats Collection Overhead ===");
      console.log(`Without stats: ${avgWithout.toFixed(1)}ms (avg of 3 runs)`);
      console.log(`With stats: ${avgWith.toFixed(1)}ms (avg of 3 runs)`);
      console.log(`Overhead: ${overhead.toFixed(1)}%`);

      // Stats collection should add less than 50% overhead
      // (threshold is generous to account for timing variability in CI)
      expect(overhead).toBeLessThan(50);
    });
  });
});
