import * as Cesium from "@cesium/engine";
import { getTimes } from "../../../suncalc/suncalc";

export class CesiumTimelineHelper {
  // Store calculated range for each ground station to detect when recalculation is needed
  static _daytimeRangeCache = new Map();

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

          // Get the time range for this pass
          const passStartTime = startJulian;
          const passEndTime = endJulian;
          const currentTime = viewer.clock.currentTime;

          // If current time is outside the pass range, set it to pass start
          if (Cesium.JulianDate.lessThan(currentTime, passStartTime) ||
              Cesium.JulianDate.greaterThan(currentTime, passEndTime)) {
            viewer.clock.currentTime = passStartTime;
            console.log(`Set time to pass start: ${Cesium.JulianDate.toDate(passStartTime)}`);
          }

          // Find the satellite entity by name and track it
          const entities = viewer.entities.values;
          console.log(`Total entities: ${entities.length}`);

          // Debug: log all satellite-related entities
          const satelliteEntities = entities.filter((entity) => entity.name && entity.name.includes(satelliteName));
          console.log(`Entities for ${satelliteName}:`, satelliteEntities.map((e) => e.name));

          // Try to find the satellite entity by name
          // First try exact name match
          let satelliteEntity = entities.find((entity) => entity && entity.name === satelliteName);

          // If not found, try the first entity that matches the satellite name
          if (!satelliteEntity && satelliteEntities.length > 0) {
            // Prefer entities with position and not ground stations
            satelliteEntity = satelliteEntities.find((entity) =>
              entity.position && !entity.name.includes("Ground station")
            ) || satelliteEntities[0];
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

  static needsRecalculation(viewer, groundStation) {
    if (!viewer.timeline || !groundStation) {
      return false;
    }

    const cacheKey = `${groundStation.position.latitude}_${groundStation.position.longitude}`;
    const cachedRange = this._daytimeRangeCache.get(cacheKey);

    if (!cachedRange) {
      return true; // No cache, needs calculation
    }

    const currentStart = viewer.clock.startTime;
    const currentStop = viewer.clock.stopTime;

    // Check if current timeline is outside the cached range
    return Cesium.JulianDate.lessThan(currentStart, cachedRange.start) ||
           Cesium.JulianDate.greaterThan(currentStop, cachedRange.stop);
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

    // Cache the calculated range for this ground station
    const cacheKey = `${groundStation.position.latitude}_${groundStation.position.longitude}`;
    this._daytimeRangeCache.set(cacheKey, {
      start: Cesium.JulianDate.clone(extendedStart),
      stop: Cesium.JulianDate.clone(extendedStop)
    });

    const startDate = Cesium.JulianDate.toDate(extendedStart);
    const stopDate = Cesium.JulianDate.toDate(extendedStop);

    const { latitude: lat, longitude: lon } = groundStation.position;

    // Calculate sunrise/sunset for each day in the timeline range
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0); // Start at beginning of day

    while (currentDate <= stopDate) {
      try {
        const sunTimes = getTimes(currentDate, lat, lon);

        // Determine what type of day this is based on SunCalc results
        const hasValidSunrise = sunTimes.sunrise && !isNaN(sunTimes.sunrise.getTime());
        const hasValidSunset = sunTimes.sunset && !isNaN(sunTimes.sunset.getTime());

        if (hasValidSunrise && hasValidSunset) {
          // Check if sunrise/sunset actually occur on the current day or the next day
          const sunriseDate = new Date(sunTimes.sunrise);
          const sunsetDate = new Date(sunTimes.sunset);
          const sunriseUTCDay = sunriseDate.toISOString().substring(0, 10);
          const sunsetUTCDay = sunsetDate.toISOString().substring(0, 10);
          const currentUTCDay = currentDate.toISOString().substring(0, 10);

          const sunriseOnCurrentDay = sunriseUTCDay === currentUTCDay;
          const sunsetOnCurrentDay = sunsetUTCDay === currentUTCDay;

          if (!sunriseOnCurrentDay && !sunsetOnCurrentDay) {
            // Both sunrise and sunset are on the next day - could be a gap day or normal cross-day behavior

            // Check if previous day was a polar day or transition day
            const prevDate = new Date(currentDate);
            prevDate.setUTCDate(prevDate.getUTCDate() - 1);
            const prevSunTimes = getTimes(prevDate, lat, lon);

            // Check previous day conditions
            const prevHasValidSunrise = prevSunTimes.sunrise && !isNaN(prevSunTimes.sunrise.getTime());
            const prevHasValidSunset = prevSunTimes.sunset && !isNaN(prevSunTimes.sunset.getTime());
            const prevWasPolarDay = !prevHasValidSunrise && !prevHasValidSunset;

            let prevWasTransitionDay = false;
            if (prevHasValidSunrise && prevHasValidSunset) {
              const prevSunriseHour = prevSunTimes.sunrise.getUTCHours();
              prevWasTransitionDay = prevSunriseHour >= 18;
            }

            // Check if the current day's sunrise/sunset times indicate it should be treated as a gap
            // Gap days typically have very late sunrises/sunsets on the next day (early morning)
            const nextDaySunriseHour = sunTimes.sunrise.getUTCHours();
            const isVeryEarlySunrise = nextDaySunriseHour <= 2; // Sunrise within first 2 hours of next day

            if ((prevWasPolarDay || prevWasTransitionDay) && isVeryEarlySunrise) {
              // This is likely a gap day that should be filled

              const dayStart = new Date(currentDate);
              dayStart.setUTCHours(0, 0, 0, 0);
              const dayEnd = new Date(dayStart);
              dayEnd.setUTCHours(23, 59, 59, 999);

              const rangeStart = Cesium.JulianDate.fromDate(dayStart);
              const rangeEnd = Cesium.JulianDate.fromDate(dayEnd);

              const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
              const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
              highlightRange.setRange(rangeStart, rangeEnd);
            } else {
              // This is normal cross-day behavior - create proper day/night ranges

              // For normal cross-day events, we still need to highlight the daytime portion
              // Since both sunrise and sunset are on the next day, we need to determine
              // if there's any daylight on the current day

              // Check if there was a sunset on the current day from the previous day's calculation
              const prevSunsetDate = new Date(prevSunTimes.sunset);
              const prevSunsetUTCDay = prevSunsetDate.toISOString().substring(0, 10);

              if (prevHasValidSunset && prevSunsetUTCDay === currentUTCDay) {
                // Previous day's sunset is on current day - highlight from start of day to sunset
                const dayStart = new Date(currentDate);
                dayStart.setUTCHours(0, 0, 0, 0);
                const dayStartJulian = Cesium.JulianDate.fromDate(dayStart);
                const prevSunsetJulian = Cesium.JulianDate.fromDate(prevSunTimes.sunset);

                const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                highlightRange.setRange(dayStartJulian, prevSunsetJulian);
              } else {
                // No sunset on current day, check if this should be filled based on reasonable daylight logic
                // If sunrise is very early next morning, there might be continuous daylight
                if (nextDaySunriseHour <= 6) {
                  const dayStart = new Date(currentDate);
                  dayStart.setUTCHours(0, 0, 0, 0);
                  const dayEnd = new Date(dayStart);
                  dayEnd.setUTCHours(23, 59, 59, 999);

                  const rangeStart = Cesium.JulianDate.fromDate(dayStart);
                  const rangeEnd = Cesium.JulianDate.fromDate(dayEnd);

                  const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                  const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                  highlightRange.setRange(rangeStart, rangeEnd);
                } else {
                }
              }
            }
          } else {
            // Check if this is a transition day from polar day to normal day/night cycle
            // If sunrise is very late (after 18:00), it might be continuing from a polar day period
            const sunriseHour = sunTimes.sunrise.getUTCHours();
            const isLateSunrise = sunriseHour >= 18;

            // Check if previous day was a polar day (no sunrise/sunset) OR a transition day
            const prevDate = new Date(currentDate);
            prevDate.setUTCDate(prevDate.getUTCDate() - 1);
            const prevSunTimes = getTimes(prevDate, lat, lon);
            const prevWasPolarDay = (!prevSunTimes.sunrise || isNaN(prevSunTimes.sunrise.getTime())) &&
                                    (!prevSunTimes.sunset || isNaN(prevSunTimes.sunset.getTime()));

            // Also check if previous day was a transition day (had very late sunrise)
            const prevHadLateSunrise = prevSunTimes.sunrise && !isNaN(prevSunTimes.sunrise.getTime()) &&
                                       prevSunTimes.sunrise.getUTCHours() >= 18;

            if (isLateSunrise && (prevWasPolarDay || prevHadLateSunrise)) {
              // This day should get full coverage because it's continuing from polar day or transition period

              const dayStart = new Date(currentDate);
              dayStart.setUTCHours(0, 0, 0, 0);
              const dayEnd = new Date(dayStart);
              dayEnd.setUTCHours(23, 59, 59, 999);

              const rangeStart = Cesium.JulianDate.fromDate(dayStart);
              const rangeEnd = Cesium.JulianDate.fromDate(dayEnd);

              const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
              const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
              highlightRange.setRange(rangeStart, rangeEnd);
            } else {
              // Normal day processing - but handle cross-day events
              if (!sunriseOnCurrentDay || !sunsetOnCurrentDay) {

                // For cross-day events, create appropriate ranges
                if (!sunriseOnCurrentDay && sunsetOnCurrentDay) {
                  // Sunrise is tomorrow, sunset is today - cover from start of day to sunset
                  const dayStart = new Date(currentDate);
                  dayStart.setUTCHours(0, 0, 0, 0);
                  const dayStartJulian = Cesium.JulianDate.fromDate(dayStart);
                  const sunsetJulian = Cesium.JulianDate.fromDate(sunTimes.sunset);

                  const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                  const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                  highlightRange.setRange(dayStartJulian, sunsetJulian);
                } else if (sunriseOnCurrentDay && !sunsetOnCurrentDay) {
                  // Sunrise is today, sunset is tomorrow - cover from sunrise to end of day
                  const sunriseJulian = Cesium.JulianDate.fromDate(sunTimes.sunrise);
                  const dayEnd = new Date(currentDate);
                  dayEnd.setUTCHours(23, 59, 59, 999);
                  const dayEndJulian = Cesium.JulianDate.fromDate(dayEnd);

                  const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                  const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                  highlightRange.setRange(sunriseJulian, dayEndJulian);
                }
              } else {
                // Both events on same day - normal processing

                const sunriseJulian = Cesium.JulianDate.fromDate(sunTimes.sunrise);
                const sunsetJulian = Cesium.JulianDate.fromDate(sunTimes.sunset);

                const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                highlightRange.setRange(sunriseJulian, sunsetJulian);
              }
            }
          }

        } else if (!hasValidSunrise && !hasValidSunset) {
          // No sunrise/sunset for this day - could be polar day/night OR a transition day

          // Check if the next day has a sunrise that actually occurred on the current day
          const nextDate = new Date(currentDate);
          nextDate.setUTCDate(nextDate.getUTCDate() + 1);
          const nextDaySunTimes = getTimes(nextDate, lat, lon);

          const nextHasValidSunrise = nextDaySunTimes.sunrise && !isNaN(nextDaySunTimes.sunrise.getTime());

          if (nextHasValidSunrise) {
          }

          // Check if next day's sunrise actually occurs on current day
          if (nextHasValidSunrise) {
            const nextSunriseDate = new Date(nextDaySunTimes.sunrise);
            const nextSunriseUTCDay = nextSunriseDate.toISOString().substring(0, 10);
            const currentUTCDay = currentDate.toISOString().substring(0, 10);


            if (nextSunriseUTCDay === currentUTCDay) {
              // Next day's sunrise is actually on current day

              // Calculate previous day conditions to determine if this needs full coverage
              const prevDate = new Date(currentDate);
              prevDate.setUTCDate(prevDate.getUTCDate() - 1);
              const prevSunTimes = getTimes(prevDate, lat, lon);

              const prevWasPolarDay = (!prevSunTimes.sunrise || isNaN(prevSunTimes.sunrise.getTime())) &&
                                      (!prevSunTimes.sunset || isNaN(prevSunTimes.sunset.getTime()));

              const prevWasTransitionDay = prevSunTimes.sunrise && !isNaN(prevSunTimes.sunrise.getTime()) &&
                                           prevSunTimes.sunrise.getUTCHours() >= 18;

              // For cross-day sunrise following polar/transition days, ALWAYS provide full day coverage
              // This ensures no gap from start of day to the cross-day sunrise time
              if (prevWasPolarDay || prevWasTransitionDay) {
                const sunriseHour = nextDaySunTimes.sunrise.getUTCHours();

                const dayStart = new Date(currentDate);
                dayStart.setUTCHours(0, 0, 0, 0);
                const dayEnd = new Date(dayStart);
                dayEnd.setUTCHours(23, 59, 59, 999);

                const rangeStart = Cesium.JulianDate.fromDate(dayStart);
                const rangeEnd = Cesium.JulianDate.fromDate(dayEnd);

                const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                highlightRange.setRange(rangeStart, rangeEnd);

              } else {
                // Normal cross-day sunrise - partial coverage from sunrise to end of day
                const sunriseHour = nextDaySunTimes.sunrise.getUTCHours();

                const sunriseJulian = Cesium.JulianDate.fromDate(nextDaySunTimes.sunrise);
                const dayEnd = new Date(currentDate);
                dayEnd.setUTCHours(23, 59, 59, 999);
                const dayEndJulian = Cesium.JulianDate.fromDate(dayEnd);

                const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                highlightRange.setRange(sunriseJulian, dayEndJulian);

              }

              // For cross-day sunrise, we need to handle the next day's coverage
              // The sunrise on currentDay continues into the next day
              const nextDayDate = new Date(currentDate);
              nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
              const nextDayUTCDay = nextDayDate.toISOString().substring(0, 10);


              // Try to get sun times for next day
              let nextDayHasValidSunset = false;
              try {
                const nextDayTimes = getTimes(nextDayDate, lat, lon);
                nextDayHasValidSunset = nextDayTimes.sunset && !isNaN(nextDayTimes.sunset.getTime());

                if (nextDayHasValidSunset) {
                  // Next day has sunset - cover from start of day to sunset

                  const nextDayStart = new Date(nextDayDate);
                  nextDayStart.setUTCHours(0, 0, 0, 0);
                  const nextDayStartJulian = Cesium.JulianDate.fromDate(nextDayStart);
                  const nextDaySunsetJulian = Cesium.JulianDate.fromDate(nextDayTimes.sunset);

                  const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                  const nextDayRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                  nextDayRange.setRange(nextDayStartJulian, nextDaySunsetJulian);

                } else {
                  // Next day has no sunset - likely transitioning to or continuing polar day
                  // Give it full day coverage as a transition day

                  const nextDayStart = new Date(nextDayDate);
                  nextDayStart.setUTCHours(0, 0, 0, 0);
                  const nextDayEnd = new Date(nextDayStart);
                  nextDayEnd.setUTCHours(23, 59, 59, 999);

                  const nextDayStartJulian = Cesium.JulianDate.fromDate(nextDayStart);
                  const nextDayEndJulian = Cesium.JulianDate.fromDate(nextDayEnd);

                  const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                  const nextDayRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                  nextDayRange.setRange(nextDayStartJulian, nextDayEndJulian);

                }
              } catch (error) {
                // If sun time calculation fails, treat as transition day

                const nextDayStart = new Date(nextDayDate);
                nextDayStart.setUTCHours(0, 0, 0, 0);
                const nextDayEnd = new Date(nextDayStart);
                nextDayEnd.setUTCHours(23, 59, 59, 999);

                const nextDayStartJulian = Cesium.JulianDate.fromDate(nextDayStart);
                const nextDayEndJulian = Cesium.JulianDate.fromDate(nextDayEnd);

                const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
                const nextDayRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
                nextDayRange.setRange(nextDayStartJulian, nextDayEndJulian);

              }

              // Skip both current and next day in the main loop since we handled both
              currentDate.setDate(currentDate.getDate() + 2);
              continue;
            }
          }

          // If no cross-day sunrise found, use polar day/night logic
          if (sunTimes.solarNoon && !isNaN(sunTimes.solarNoon.getTime())) {
            const dayOfYear = Math.floor((currentDate - new Date(currentDate.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const isNorthernHemisphere = lat > 0;

            const summerSolstice = 172;
            const winterSolstice = 355;

            let isContinuousDaylight = false;
            if (isNorthernHemisphere) {
              const distToSummer = Math.min(Math.abs(dayOfYear - summerSolstice),
                                           Math.abs(dayOfYear - summerSolstice - 365));
              const distToWinter = Math.min(Math.abs(dayOfYear - winterSolstice),
                                           Math.abs(dayOfYear - winterSolstice + 365));
              isContinuousDaylight = distToSummer < distToWinter;
            } else {
              const distToSummer = Math.min(Math.abs(dayOfYear - summerSolstice),
                                           Math.abs(dayOfYear - summerSolstice - 365));
              const distToWinter = Math.min(Math.abs(dayOfYear - winterSolstice),
                                           Math.abs(dayOfYear - winterSolstice + 365));
              isContinuousDaylight = distToWinter < distToSummer;
            }

            if (isContinuousDaylight) {

              const dayStart = new Date(currentDate);
              dayStart.setUTCHours(0, 0, 0, 0);
              const dayEnd = new Date(dayStart);
              dayEnd.setUTCHours(23, 59, 59, 999);

              const rangeStart = Cesium.JulianDate.fromDate(dayStart);
              const rangeEnd = Cesium.JulianDate.fromDate(dayEnd);

              const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
              const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
              highlightRange.setRange(rangeStart, rangeEnd);
            } else {
            }
          }

        } else if (hasValidSunrise && !hasValidSunset) {
          // Sunrise but no sunset - sun rises but doesn't set (entering polar day)
          // Check if this is a transition day to polar day with very early sunrise
          const sunriseHour = sunTimes.sunrise.getUTCHours();
          const isEarlySunrise = sunriseHour <= 6;

          // Check if next day will be a polar day (no sunrise/sunset)
          const nextDate = new Date(currentDate);
          nextDate.setUTCDate(nextDate.getUTCDate() + 1);
          const nextSunTimes = getTimes(nextDate, lat, lon);
          const nextWillBePolarDay = (!nextSunTimes.sunrise || isNaN(nextSunTimes.sunrise.getTime())) &&
                                     (!nextSunTimes.sunset || isNaN(nextSunTimes.sunset.getTime()));

          if (isEarlySunrise && nextWillBePolarDay) {
            // This day should get full coverage because it's transitioning to polar day

            const dayStart = new Date(currentDate);
            dayStart.setUTCHours(0, 0, 0, 0);
            const dayEnd = new Date(dayStart);
            dayEnd.setUTCHours(23, 59, 59, 999);

            const rangeStart = Cesium.JulianDate.fromDate(dayStart);
            const rangeEnd = Cesium.JulianDate.fromDate(dayEnd);

            const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
            const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
            highlightRange.setRange(rangeStart, rangeEnd);
          } else {
            // Normal sunrise-only day processing

            const sunriseJulian = Cesium.JulianDate.fromDate(sunTimes.sunrise);
            const dayEnd = new Date(currentDate);
            dayEnd.setUTCHours(23, 59, 59, 999);
            const dayEndJulian = Cesium.JulianDate.fromDate(dayEnd);

            const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
            const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
            highlightRange.setRange(sunriseJulian, dayEndJulian);
          }

        } else if (!hasValidSunrise && hasValidSunset) {
          // Sunset but no sunrise - sun sets but doesn't rise (entering polar night)
          // Check if this is a transition day from polar night with very late sunset
          const sunsetHour = sunTimes.sunset.getUTCHours();
          const isLateSunset = sunsetHour >= 18;

          // Check if previous day was a polar night (no sunrise/sunset)
          const prevDate = new Date(currentDate);
          prevDate.setUTCDate(prevDate.getUTCDate() - 1);
          const prevSunTimes = getTimes(prevDate, lat, lon);
          const prevWasPolarNight = (!prevSunTimes.sunrise || isNaN(prevSunTimes.sunrise.getTime())) &&
                                    (!prevSunTimes.sunset || isNaN(prevSunTimes.sunset.getTime())) &&
                                    prevSunTimes.solarNoon && !isNaN(prevSunTimes.solarNoon.getTime());

          if (isLateSunset && prevWasPolarNight) {
            // This day should get no coverage because it's transitioning from polar night
          } else {
            // Normal sunset-only day processing

            const dayStart = new Date(currentDate);
            dayStart.setUTCHours(0, 0, 0, 0);
            const dayStartJulian = Cesium.JulianDate.fromDate(dayStart);

            const sunsetJulian = Cesium.JulianDate.fromDate(sunTimes.sunset);

            const grayColor = Cesium.Color.GRAY.withAlpha(0.5);
            const highlightRange = viewer.timeline.addHighlightRange(grayColor, 60, -1);
            highlightRange.setRange(dayStartJulian, sunsetJulian);
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
