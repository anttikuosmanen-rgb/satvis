import { Cartesian3, Color, JulianDate } from "@cesium/engine";
import suncalc from "suncalc";

/**
 * Add a highlight range to the timeline without triggering resize().
 * Cesium's addHighlightRange() calls resize() on every addition, which
 * causes O(n²) DOM re-renders when adding many ranges in a loop.
 * Call timeline.resize() once after all ranges are added.
 */
function addHighlightRangeNoResize(timeline, color, heightInPx, base) {
  // Replicate Timeline.addHighlightRange but skip the resize() call
  const range = { _color: color, _height: heightInPx, _base: base ?? 0, _start: null, _stop: null };
  range.setRange = function (start, stop) {
    this._start = start;
    this._stop = stop;
  };
  range.render = function (renderState) {
    if (!this._start || !this._stop || !this._color) return "";
    const highlightStart = JulianDate.secondsDifference(this._start, renderState.epochJulian);
    let highlightLeft = Math.round(renderState.timeBarWidth * renderState.getAlpha(highlightStart));
    const highlightStop = JulianDate.secondsDifference(this._stop, renderState.epochJulian);
    let highlightWidth = Math.round(renderState.timeBarWidth * renderState.getAlpha(highlightStop)) - highlightLeft;
    if (highlightLeft < 0) {
      highlightWidth += highlightLeft;
      highlightLeft = 0;
    }
    if (highlightLeft + highlightWidth > renderState.timeBarWidth) {
      highlightWidth = renderState.timeBarWidth - highlightLeft;
    }
    if (highlightWidth > 0) {
      return `<span class="cesium-timeline-highlight" style="left: ${highlightLeft}px; width: ${highlightWidth}px; bottom: ${this._base}px; height: ${this._height}px; background-color: ${this._color};"></span>`;
    }
    return "";
  };
  timeline._highlightRanges.push(range);
  return range;
}

export class CesiumTimelineHelper {
  // Store calculated range for each ground station to detect when recalculation is needed
  static _daytimeRangeCache = new Map();

  // Timeline update batching - prevents redundant re-renders
  static _timelineUpdateScheduled = false;
  static _pendingViewers = new Set();

  /**
   * Schedule a batched timeline update using requestAnimationFrame
   * Multiple calls within the same frame will be batched into a single update
   * @param {Object} viewer - Cesium viewer with timeline
   */
  static scheduleTimelineUpdate(viewer) {
    if (!viewer || !viewer.timeline) {
      return;
    }

    // Add viewer to pending set
    this._pendingViewers.add(viewer);

    // Schedule update if not already scheduled
    if (!this._timelineUpdateScheduled) {
      this._timelineUpdateScheduled = true;

      requestAnimationFrame(() => {
        // Process all pending viewer updates
        this._pendingViewers.forEach((v) => {
          if (v.timeline) {
            v.timeline.updateFromClock();
            if (v.timeline._makeTics) {
              v.timeline._makeTics();
            }
          }
        });

        // Clear pending set and reset flag
        this._pendingViewers.clear();
        this._timelineUpdateScheduled = false;
      });
    }
  }

  static clearHighlightRanges(viewer) {
    if (!viewer.timeline || viewer.timeline._highlightRanges.length === 0) {
      return;
    }
    // Only clear satellite pass highlights (priority 0), preserve daytime ranges (priority -1)

    const highlightRanges = viewer.timeline._highlightRanges;

    // Clean up event listeners before removing ranges to prevent memory leaks
    highlightRanges.forEach((range) => {
      if (range._base === 0 && range._clickListener && range._element) {
        range._element.removeEventListener("click", range._clickListener);
        range._clickListener = null;
      }
    });

    viewer.timeline._highlightRanges = highlightRanges.filter(
      (range) =>
        // Keep daytime ranges (priority -1), remove satellite pass ranges (priority 0)

        range._base === -1,
    );

    // Use batched update instead of immediate update
    this.scheduleTimelineUpdate(viewer);
  }

  static addHighlightRanges(viewer, ranges, satelliteName, options = {}) {
    if (!viewer.timeline) {
      return;
    }

    if (ranges.length === 0) {
      return;
    }

    // Get VISIBLE timeline range (use timeline's zoomed view, not clock bounds)
    // timeline._startJulian/_endJulian reflect the user's zoomed view
    const timeline = viewer.timeline;
    const timelineStart = timeline?._startJulian ? JulianDate.toDate(timeline._startJulian) : JulianDate.toDate(viewer.clock.startTime);
    const timelineStop = timeline?._endJulian ? JulianDate.toDate(timeline._endJulian) : JulianDate.toDate(viewer.clock.stopTime);

    // Filter ranges to only those visible in current timeline (with some overlap)
    const timelineStartMs = timelineStart.getTime();
    const timelineStopMs = timelineStop.getTime();

    const visibleRanges = ranges.filter((range) => {
      const rangeStart = new Date(range.start).getTime();
      const rangeEnd = new Date(range.end).getTime();
      // Include range if it overlaps with timeline at all
      return rangeEnd >= timelineStartMs && rangeStart <= timelineStopMs;
    });

    // Limit to 8 passes per satellite for performance (unless skipPerSatelliteLimit is set)
    // When caller has already done global prioritization, skip this limit
    const maxPasses = options.skipPerSatelliteLimit ? visibleRanges.length : 8;
    const limitedRanges = visibleRanges.slice(0, maxPasses);

    limitedRanges.forEach((range) => {
      const startJulian = JulianDate.fromDate(new Date(range.start));
      const endJulian = JulianDate.fromDate(new Date(range.end));
      const highlightRange = viewer.timeline.addHighlightRange(Color.BLUE, 100, 0);
      highlightRange.setRange(startJulian, endJulian);

      // Add click functionality to focus on satellite when pass is clicked
      if (satelliteName && highlightRange._element) {
        highlightRange._element.style.cursor = "pointer";
        highlightRange._element.title = `Click to track ${satelliteName} during this pass`;

        // Remove any existing click listeners
        if (highlightRange._clickListener) {
          highlightRange._element.removeEventListener("click", highlightRange._clickListener);
        }

        // Add click listener to track the satellite
        highlightRange._clickListener = () => {
          // Find the satellite entity by name
          const entities = viewer.entities.values;

          // Try to find the main satellite entity (usually the Point component)
          let satelliteEntity = entities.find((entity) => entity.name && entity.name.includes(satelliteName) && entity.name.includes("Point"));

          // If not found with "Point", try any entity with the satellite name
          if (!satelliteEntity) {
            satelliteEntity = entities.find((entity) => entity.name && entity.name.includes(satelliteName));
          }

          if (satelliteEntity) {
            // Check if we're in zenith view
            const isInZenithView = window.cc && window.cc.sats && window.cc.sats.isInZenithView;

            if (isInZenithView) {
              // In zenith view: point camera at satellite without moving position
              const satellitePosition = satelliteEntity.position.getValue(viewer.clock.currentTime);
              if (satellitePosition) {
                const cameraPosition = viewer.camera.positionWC;
                const direction = Cartesian3.subtract(satellitePosition, cameraPosition, new Cartesian3());
                Cartesian3.normalize(direction, direction);
                viewer.camera.direction = direction;
              }
            } else {
              // Normal mode: track the satellite
              viewer.trackedEntity = null;

              // Also try to trigger tracking through the satellite manager
              if (window.cc && window.cc.sats) {
                try {
                  window.cc.sats.trackedSatellite = satelliteName;
                } catch (error) {
                  console.warn("Could not use satellite manager:", error);
                }
              }

              // Small delay to ensure the selection is processed
              setTimeout(() => {
                viewer.trackedEntity = satelliteEntity;
              }, 100);
            }
          }
        };

        highlightRange._element.addEventListener("click", highlightRange._clickListener);
      }
    });

    // Use batched update instead of immediate update
    this.scheduleTimelineUpdate(viewer);
  }

  static updateHighlightRanges(viewer, ranges, satelliteName) {
    this.clearHighlightRanges(viewer);
    this.addHighlightRanges(viewer, ranges, satelliteName);
  }

  static async addHighlightRangesAsync(viewer, passesBySatellite) {
    if (!viewer.timeline) {
      return;
    }

    const satellites = Object.entries(passesBySatellite);
    if (satellites.length === 0) {
      return;
    }

    // Process satellites in chunks to avoid blocking
    const chunkSize = 3;
    for (let i = 0; i < satellites.length; i += chunkSize) {
      const chunk = satellites.slice(i, i + chunkSize);

      // Add highlights for this chunk (without resize to avoid redundant calls)
      chunk.forEach(([satelliteName, satellitePasses]) => {
        // Call addHighlightRanges without its internal resize
        this._addHighlightRangesWithoutResize(viewer, satellitePasses, satelliteName);
      });

      // Yield to browser after each chunk
      if (i + chunkSize < satellites.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Use batched update instead of immediate update
    this.scheduleTimelineUpdate(viewer);
  }

  static _addHighlightRangesWithoutResize(viewer, ranges, satelliteName) {
    if (!viewer.timeline || ranges.length === 0) {
      return;
    }

    // Get VISIBLE timeline range (use timeline's zoomed view, not clock bounds)
    const timeline = viewer.timeline;
    const timelineStart = timeline?._startJulian ? JulianDate.toDate(timeline._startJulian) : JulianDate.toDate(viewer.clock.startTime);
    const timelineStop = timeline?._endJulian ? JulianDate.toDate(timeline._endJulian) : JulianDate.toDate(viewer.clock.stopTime);
    const timelineStartMs = timelineStart.getTime();
    const timelineStopMs = timelineStop.getTime();

    const visibleRanges = ranges.filter((range) => {
      const rangeStart = new Date(range.start).getTime();
      const rangeEnd = new Date(range.end).getTime();
      return rangeEnd >= timelineStartMs && rangeStart <= timelineStopMs;
    });

    // Limit to 8 passes per satellite for performance
    const maxPasses = 8;
    const limitedRanges = visibleRanges.slice(0, maxPasses);

    limitedRanges.forEach((range) => {
      const startJulian = JulianDate.fromDate(new Date(range.start));
      const endJulian = JulianDate.fromDate(new Date(range.end));
      const highlightRange = viewer.timeline.addHighlightRange(Color.BLUE, 100, 0);
      highlightRange.setRange(startJulian, endJulian);

      // Add click functionality
      if (satelliteName && highlightRange._element) {
        highlightRange._element.style.cursor = "pointer";
        highlightRange._element.title = `Click to track ${satelliteName} during this pass`;

        if (highlightRange._clickListener) {
          highlightRange._element.removeEventListener("click", highlightRange._clickListener);
        }

        highlightRange._clickListener = () => {
          const entities = viewer.entities.values;
          let satelliteEntity = entities.find((entity) => entity.name && entity.name.includes(satelliteName) && entity.name.includes("Point"));
          if (!satelliteEntity) {
            satelliteEntity = entities.find((entity) => entity.name && entity.name.includes(satelliteName));
          }
          if (satelliteEntity) {
            // Check if we're in zenith view
            const isInZenithView = window.cc && window.cc.sats && window.cc.sats.isInZenithView;

            if (isInZenithView) {
              // In zenith view: point camera at satellite without moving position
              const satellitePosition = satelliteEntity.position.getValue(viewer.clock.currentTime);
              if (satellitePosition) {
                const cameraPosition = viewer.camera.positionWC;
                const direction = Cartesian3.subtract(satellitePosition, cameraPosition, new Cartesian3());
                Cartesian3.normalize(direction, direction);
                viewer.camera.direction = direction;
              }
            } else {
              // Normal mode: track the satellite
              viewer.trackedEntity = null;
              if (window.cc && window.cc.sats) {
                try {
                  window.cc.sats.trackedSatellite = satelliteName;
                } catch (error) {
                  console.warn("Could not use satellite manager:", error);
                }
              }
              setTimeout(() => {
                viewer.trackedEntity = satelliteEntity;
              }, 100);
            }
          }
        };

        highlightRange._element.addEventListener("click", highlightRange._clickListener);
      }
    });
  }

  static needsRecalculation(viewer, groundStation) {
    if (!viewer.timeline || !groundStation) {
      return false;
    }

    const cacheKey = `${groundStation.position.latitude}_${groundStation.position.longitude}`;
    const cachedRange = this._daytimeRangeCache.get(cacheKey);

    if (!cachedRange) {
      return true; // No cache, needs calculation
    }

    // Check both clock bounds AND the visible timeline window
    // The user can zoom/scroll the timeline beyond the clock bounds
    const timeline = viewer.timeline;
    const visibleStart = timeline._startJulian || viewer.clock.startTime;
    const visibleStop = timeline._endJulian || viewer.clock.stopTime;

    return JulianDate.lessThan(visibleStart, cachedRange.start) || JulianDate.greaterThan(visibleStop, cachedRange.stop);
  }

  static async addGroundStationDaytimeRanges(viewer, groundStation) {
    if (!viewer.timeline || !groundStation) {
      return;
    }

    // Use the wider of clock bounds and visible timeline window
    const timeline = viewer.timeline;
    const clockStart = viewer.clock.startTime;
    const clockStop = viewer.clock.stopTime;
    const visibleStart = timeline._startJulian || clockStart;
    const visibleStop = timeline._endJulian || clockStop;
    const startTime = JulianDate.lessThan(visibleStart, clockStart) ? visibleStart : clockStart;
    const stopTime = JulianDate.greaterThan(visibleStop, clockStop) ? visibleStop : clockStop;

    // Calculate daytime periods for a broader range (extend by 60 days on each side)
    const extendedStart = JulianDate.addDays(startTime, -60, new JulianDate());
    const extendedStop = JulianDate.addDays(stopTime, 60, new JulianDate());

    // Cache the calculated range for this ground station
    const cacheKey = `${groundStation.position.latitude}_${groundStation.position.longitude}`;
    this._daytimeRangeCache.set(cacheKey, {
      start: JulianDate.clone(extendedStart),
      stop: JulianDate.clone(extendedStop),
    });

    const startDate = JulianDate.toDate(extendedStart);
    const stopDate = JulianDate.toDate(extendedStop);

    const { latitude: lat, longitude: lon } = groundStation.position;

    // Sample sun altitude at regular intervals to find daylight periods.
    // This avoids all edge cases with cross-day sunrise/sunset at different longitudes
    // and polar day/night transitions that broke the previous day-classification approach.
    const sampleIntervalMs = 15 * 60 * 1000; // 15 minutes
    const grayColor = Color.GRAY.withAlpha(0.5);

    let inDaylight = false;
    let rangeStartDate = null;
    let samplesProcessed = 0;
    const yieldInterval = 200; // yield to browser every N samples

    for (let t = startDate.getTime(); t <= stopDate.getTime(); t += sampleIntervalMs) {
      const sampleDate = new Date(t);
      const sunPos = suncalc.getPosition(sampleDate, lat, lon);
      const sunUp = sunPos.altitude > 0;

      if (sunUp && !inDaylight) {
        // Transition to daylight — start a new range
        rangeStartDate = sampleDate;
        inDaylight = true;
      } else if (!sunUp && inDaylight) {
        // Transition to night — close the range
        const highlightRange = addHighlightRangeNoResize(viewer.timeline, grayColor, 60, -1);
        highlightRange.setRange(JulianDate.fromDate(rangeStartDate), JulianDate.fromDate(sampleDate));
        inDaylight = false;
        rangeStartDate = null;
      }

      samplesProcessed++;
      if (samplesProcessed % yieldInterval === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Close any open range at the end
    if (inDaylight && rangeStartDate) {
      const highlightRange = addHighlightRangeNoResize(viewer.timeline, grayColor, 60, -1);
      highlightRange.setRange(JulianDate.fromDate(rangeStartDate), JulianDate.fromDate(stopDate));
    }

    // Force a single resize+render now that all highlights are added
    // (addHighlightRangeNoResize skipped per-addition resize calls)
    if (viewer.timeline._lastWidth !== undefined) {
      viewer.timeline._lastWidth = undefined; // Force resize to run
    }
    this.scheduleTimelineUpdate(viewer);
  }

  static clearGroundStationDaytimeRanges(viewer) {
    if (!viewer.timeline) {
      return;
    }

    // Remove daytime highlight ranges (priority -1)

    const highlightRanges = viewer.timeline._highlightRanges;

    viewer.timeline._highlightRanges = highlightRanges.filter((range) => range._base !== -1);

    // Use batched update instead of immediate update
    this.scheduleTimelineUpdate(viewer);
  }
}
