import * as Cesium from "@cesium/engine";
import { getTimes } from "../../../suncalc/suncalc";

export class CesiumTimelineHelper {
  static clearHighlightRanges(viewer) {
    // eslint-disable-next-line
    if (!viewer.timeline || viewer.timeline._highlightRanges.length === 0) {
      return;
    }
    // Only clear satellite pass highlights (priority 0), preserve daytime ranges (priority -1)
    // eslint-disable-next-line
    const highlightRanges = viewer.timeline._highlightRanges;
    // eslint-disable-next-line
    viewer.timeline._highlightRanges = highlightRanges.filter((range) =>
      // Keep daytime ranges (priority -1), remove satellite pass ranges (priority 0)
      // eslint-disable-next-line
      range._base === -1
    );
    viewer.timeline.updateFromClock();
    viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }

  static addHighlightRanges(viewer, ranges, satelliteName) {
    if (!viewer.timeline) {
      return;
    }
    ranges.forEach((range) => {
      const startJulian = Cesium.JulianDate.fromDate(new Date(range.start));
      const endJulian = Cesium.JulianDate.fromDate(new Date(range.end));
      const highlightRange = viewer.timeline.addHighlightRange(Cesium.Color.BLUE, 100, 0);
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
          console.log(`Pass clicked for satellite: ${satelliteName}`);

          // Find the satellite entity by name and track it
          const entities = viewer.entities.values;
          console.log(`Total entities: ${entities.length}`);

          // Debug: log all satellite-related entities
          const satelliteEntities = entities.filter((entity) => entity.name && entity.name.includes(satelliteName));
          console.log(`Entities for ${satelliteName}:`, satelliteEntities.map((e) => e.name));

          // Try to find the main satellite entity (usually the Point component)
          let satelliteEntity = entities.find((entity) => entity.name && entity.name.includes(satelliteName) && entity.name.includes("Point"));

          // If not found with "Point", try the first entity with the satellite name
          if (!satelliteEntity && satelliteEntities.length > 0) {
            satelliteEntity = satelliteEntities[0];
          }

          if (satelliteEntity) {
            console.log(`Found entity to track: ${satelliteEntity.name}`);

            // Force clear tracking and camera
            viewer.trackedEntity = null;
            viewer.selectedEntity = null;

            // Also try to trigger tracking through the satellite manager
            // This should ensure proper satellite switching
            if (window.cc && window.cc.sats) {
              try {
                const satManager = window.cc.sats;
                console.log(`Tracking satellite through manager: ${satelliteName}`);
                satManager.trackedSatellite = satelliteName;
              } catch (error) {
                console.warn("Could not use satellite manager:", error);
              }
            }

            // Small delay to ensure the selection is processed
            setTimeout(() => {
              viewer.trackedEntity = satelliteEntity;
              console.log(`Now tracking: ${satelliteEntity.name}`);
            }, 100);
          } else {
            console.warn(`Could not find satellite entity for ${satelliteName}`);
            console.log("All available entities:", entities.map((e) => e.name).filter((n) => n));
          }
        };

        highlightRange._element.addEventListener("click", highlightRange._clickListener);
      }

      viewer.timeline.updateFromClock();
      viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
    });
  }

  static updateHighlightRanges(viewer, ranges, satelliteName) {
    this.clearHighlightRanges(viewer);
    this.addHighlightRanges(viewer, ranges, satelliteName);
  }

  static addGroundStationDaytimeRanges(viewer, groundStation) {
    if (!viewer.timeline || !groundStation) {
      return;
    }

    const startTime = viewer.clock.startTime;
    const stopTime = viewer.clock.stopTime;

    // Calculate daytime periods for a broader range (extend by 7 days on each side)
    const extendedStart = Cesium.JulianDate.addDays(startTime, -7, new Cesium.JulianDate());
    const extendedStop = Cesium.JulianDate.addDays(stopTime, 7, new Cesium.JulianDate());

    const startDate = Cesium.JulianDate.toDate(extendedStart);
    const stopDate = Cesium.JulianDate.toDate(extendedStop);

    const { latitude: lat, longitude: lon } = groundStation.position;

    // Calculate sunrise/sunset for each day in the timeline range
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0); // Start at beginning of day

    while (currentDate <= stopDate) {
      try {
        const sunTimes = getTimes(currentDate, lat, lon);

        // Create daytime range from sunrise to sunset
        if (sunTimes.sunrise && sunTimes.sunset) {
          const sunriseJulian = Cesium.JulianDate.fromDate(sunTimes.sunrise);
          const sunsetJulian = Cesium.JulianDate.fromDate(sunTimes.sunset);

          // Add all daytime ranges (don't limit to visible timeline)
          if (sunriseJulian && sunsetJulian) {
            // Use full sunrise to sunset range
            const rangeStart = sunriseJulian;
            const rangeEnd = sunsetJulian;

            // Try a completely different approach - use WHITE color to test if ANY color works
            const testColor = Cesium.Color.WHITE.withAlpha(0.7);
            console.log('Creating daytime highlight with WHITE color to test');
            const highlightRange = viewer.timeline.addHighlightRange(testColor, 60, -1);
            highlightRange.setRange(rangeStart, rangeEnd);

            console.log('Daytime highlight created:', highlightRange);
            console.log('Element:', highlightRange._element);
            console.log('Color set to:', highlightRange._color);

            // Try to inspect and override the element
            if (highlightRange._element) {
              console.log('Element computed style:', window.getComputedStyle(highlightRange._element).backgroundColor);

              // Try a MutationObserver to catch when Cesium changes the style
              const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                  if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    console.log('Style changed, forcing white background');
                    highlightRange._element.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
                  }
                });
              });

              observer.observe(highlightRange._element, {
                attributes: true,
                attributeFilter: ['style']
              });

              // Force white immediately
              highlightRange._element.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
              console.log('Set backgroundColor to white');
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to calculate sun times for ${currentDate}:`, error);
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    viewer.timeline.updateFromClock();
    viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }

  static clearGroundStationDaytimeRanges(viewer) {
    if (!viewer.timeline) {
      return;
    }

    // Remove daytime highlight ranges (priority -1)
    // eslint-disable-next-line
    const highlightRanges = viewer.timeline._highlightRanges;
    // eslint-disable-next-line
    viewer.timeline._highlightRanges = highlightRanges.filter((range) =>
      // eslint-disable-next-line
      range._base !== -1
    );

    viewer.timeline.updateFromClock();
    viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }
}
