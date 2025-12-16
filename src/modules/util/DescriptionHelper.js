import { CallbackProperty, JulianDate } from "@cesium/engine";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import { useSatStore } from "../../stores/sat";
import { GroundStationConditions } from "./GroundStationConditions";
import { TimeFormatHelper } from "./TimeFormatHelper";

dayjs.extend(relativeTime);
dayjs.extend(utc);

// Track how many pass batches have been loaded (persists across re-renders)
// Key is entity identifier, value is number of batches shown
const loadedPassBatches = new Map();

export class DescriptionHelper {
  // Get/set loaded batch count for current entity
  static getLoadedBatches(entityId) {
    return loadedPassBatches.get(entityId) || 0;
  }

  static incrementLoadedBatches(entityId) {
    const current = loadedPassBatches.get(entityId) || 0;
    loadedPassBatches.set(entityId, current + 1);
    return current + 1;
  }

  static resetLoadedBatches(entityId) {
    loadedPassBatches.delete(entityId);
  }
  /** cachedCallbackProperty
   * Caches the results of a callback property to prevent unnecessary recalculation.
   * The cache accounts for clock multiplier to prevent excessive re-evaluation during fast playback.
   * @param {function} callback - The function to call when cache is invalid
   * @param {number} baseUpdateThreshold - Base simulation time threshold in seconds (default 1)
   * @param {number} usageTreshold - The number of invocations to serve the same result
   */
  static cachedCallbackProperty(callback, baseUpdateThreshold = 1, usageTreshold = 1000) {
    let cache;
    let lastRealTime = null;

    return new CallbackProperty((time) => {
      const currentRealTime = performance.now();

      // Get clock multiplier from the global viewer if available
      // This allows the cache to adapt to simulation speed
      const viewer = typeof window !== "undefined" && window.cc ? window.cc.viewer : null;
      const clockMultiplier = viewer ? Math.abs(viewer.clock.multiplier || 1) : 1;

      // Adjust threshold based on clock multiplier
      // At 1x: updateThreshold = 1 second simulation time
      // At 100x: updateThreshold = 100 seconds simulation time
      // At 2000x: updateThreshold = 2000 seconds simulation time
      const adjustedThreshold = baseUpdateThreshold * Math.max(1, clockMultiplier);

      // Real-time throttle: at high speeds, reduce update frequency significantly
      // At 1x: update every 1 second real time
      // At 10x-100x: update every 3 seconds real time
      // At 100x+: update every 5 seconds real time (countdown doesn't need precision during fast-forward)
      const minRealTimeInterval = clockMultiplier > 100 ? 5000 : clockMultiplier > 10 ? 3000 : 1000;
      const realTimeSinceLastUpdate = lastRealTime ? currentRealTime - lastRealTime : Infinity;

      if (cache && JulianDate.equalsEpsilon(time, cache.time, adjustedThreshold) && cache.usage < usageTreshold && realTimeSinceLastUpdate < minRealTimeInterval) {
        cache.usage += 1;
        return cache.content;
      }

      const content = callback(time);
      cache = {
        time: JulianDate.clone(time),
        content,
        usage: 0,
      };
      lastRealTime = currentRealTime;
      return content;
    }, false);
  }

  static renderSatelliteDescription(time, position, props) {
    const { name, passes, orbit, overpassMode, groundStationAvailable } = props;
    const { tle, julianDate } = orbit;

    // Name already has asterisk if epoch is in future (set in constructor)
    const epochInFuture = name.endsWith(" *");

    // Get current eclipse status if orbit object is available
    let eclipseStatus = "—";
    if (orbit && typeof orbit.isInEclipse === "function") {
      try {
        const isEclipsed = orbit.isInEclipse(new Date(time));
        eclipseStatus = isEclipsed ? "🌑 Eclipse" : "☀️ Sunlit";
      } catch (error) {
        console.warn("Failed to get eclipse status:", error);
        eclipseStatus = "—";
      }
    }

    const description = `
      <div class="ib">
        <style>
          .passes-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .pass-card {
            background: rgba(0, 0, 0, 0.1);
            border: 1px solid #444;
            border-radius: 4px;
            padding: 6px 8px;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          .pass-card:hover {
            background: rgba(0, 0, 0, 0.2);
          }
          .pass-line-1 {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 3px;
            font-size: 14px;
          }
          .pass-line-2 {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 14px;
            color: #ccc;
          }
          .pass-countdown {
            font-size: 14px;
            color: #aaa;
            font-family: monospace;
          }
          .pass-conditions {
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 60%;
          }
        </style>
        <h3>Position</h3>
        <table class="ibt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Altitude</th>
              <th>Velocity</th>
              <th>Illumination</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${name}</td>
              <td>${position.latitude.toFixed(2)}&deg</td>
              <td>${position.longitude.toFixed(2)}&deg</td>
              <td>${(position.height / 1000).toFixed(2)} km</td>
              <td>${position.velocity.toFixed(2)} km/s</td>
              <td class="ibt-center" title="Current satellite illumination status">${eclipseStatus}</td>
            </tr>
          </tbody>
        </table>
        ${this.renderPasses(passes, time, false, overpassMode, epochInFuture, orbit.orbitalPeriod, groundStationAvailable, name)}
        ${this.renderTLE(tle, julianDate)}
      </div>
    `;
    return description;
  }

  static renderGroundstationDescription(time, name, position, passes, overpassMode = null) {
    // Get current lighting conditions
    const currentTime = JulianDate.toDate(time);
    const lightingCondition = GroundStationConditions.getLightingConditionWithEmoji(position, currentTime);

    const description = `
      <div class="ib">
        <style>
          .passes-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .pass-card {
            background: rgba(0, 0, 0, 0.1);
            border: 1px solid #444;
            border-radius: 4px;
            padding: 6px 8px;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          .pass-card:hover {
            background: rgba(0, 0, 0, 0.2);
          }
          .pass-line-1 {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 3px;
            font-size: 14px;
          }
          .pass-line-2 {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 14px;
            color: #ccc;
          }
          .pass-countdown {
            font-size: 14px;
            color: #aaa;
            font-family: monospace;
          }
          .pass-conditions {
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 60%;
          }
        </style>
        <h3>Position</h3>
        <table class="ibt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Conditions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${name}</td>
              <td>${position.latitude.toFixed(2)}&deg</td>
              <td>${position.longitude.toFixed(2)}&deg</td>
              <td class="ibt-center" title="Current ground station lighting conditions">${lightingCondition}</td>
            </tr>
          </tbody>
        </table>
        ${this.renderPasses(passes, time, true, overpassMode, false, 0, false, name)}
      </div>
    `;
    return description;
  }

  static renderPasses(passes, time, isGroundStation, overpassMode, epochInFuture = false, orbitalPeriod = 0, groundStationAvailable = false, entityId = "default") {
    const epochNote = epochInFuture ? " (* Epoch in future)" : "";
    if (passes.length === 0) {
      if (isGroundStation) {
        return `
          <h3>Passes${epochNote}</h3>
          <div class="ib-text">No passes available</div>
          `;
      }
      // Check if ground station is not set
      if (!groundStationAvailable) {
        return `
          <h3>Passes${epochNote}</h3>
          <div class="ib-text">No ground station set</div>
          `;
      }
      // Check if this is a high-altitude satellite (orbital period > 600 minutes)
      // These satellites have continuous visibility, not traditional passes
      if (orbitalPeriod > 600) {
        return `
          <h3>Passes${epochNote}</h3>
          <div class="ib-text">Continuous visibility (no passes)</div>
          `;
      }
      // Ground station is set but no passes found
      // This can happen with low inclination satellites and high latitude ground stations
      return `
        <h3>Passes${epochNote}</h3>
        <div class="ib-text">No passes found</div>
        `;
    }

    // Filter out passes before epoch - 90 minutes for future epoch satellites
    // Note: For ground stations, this filtering also happens in GroundStationEntity._filterAndSortPasses
    let filteredPasses = passes.filter((pass) => {
      if (pass.epochInFuture && pass.epochTime) {
        const epochMinus90 = new Date(pass.epochTime.getTime() - 90 * 60 * 1000);
        const passStart = new Date(pass.start);
        return passStart >= epochMinus90;
      }
      return true;
    });

    // Apply sunlight filtering if enabled
    const satStore = useSatStore();
    if (satStore.hideSunlightPasses) {
      filteredPasses = filteredPasses.filter(
        (pass) =>
          // Show pass if either start or end is in darkness
          pass.groundStationDarkAtStart || pass.groundStationDarkAtEnd,
      );
    }

    // Check if any passes remain after filtering
    if (filteredPasses.length === 0) {
      if (satStore.hideSunlightPasses) {
        return `
          <h3>Passes</h3>
          <div class="ib-text">No passes in darkness available</div>
          `;
      }
    }

    const start = dayjs(time);
    const upcomingPassIdx = filteredPasses.findIndex((pass) => dayjs(pass.end).isAfter(start));
    if (upcomingPassIdx < 0) {
      return "";
    }
    const upcomingPasses = filteredPasses.slice(upcomingPassIdx);

    // Determine initial batch size based on clock speed
    // At real-time or slower (-1 to +1), show more passes
    // At faster speeds, limit to 6 for performance
    const viewer = typeof window !== "undefined" && window.cc ? window.cc.viewer : null;
    const clockMultiplier = viewer ? viewer.clock.multiplier : 1;
    const isRealTimeOrSlower = Math.abs(clockMultiplier) <= 1;
    const INITIAL_PASSES = isRealTimeOrSlower ? 20 : 6;
    const LOAD_MORE_COUNT = 10;

    // Reset loaded batches when switching to fast-forward mode
    if (!isRealTimeOrSlower && this.getLoadedBatches(entityId) > 0) {
      this.resetLoadedBatches(entityId);
    }

    const displayedPasses = upcomingPasses.slice(0, INITIAL_PASSES);
    const passNameField = isGroundStation ? "name" : null;

    // Pre-render ALL passes but hide extras with CSS, show on button click
    const remainingPasses = upcomingPasses.slice(INITIAL_PASSES);
    const remainingRendered = remainingPasses.map((pass) => this.renderPassCard(start, pass, passNameField));

    // Get how many batches have been loaded for this entity (persists across re-renders)
    const loadedBatchCount = this.getLoadedBatches(entityId);

    // Render passes in batches - show already-loaded batches, hide the rest
    let batchesHtml = "";
    const totalBatches = Math.ceil(remainingRendered.length / LOAD_MORE_COUNT);
    for (let batch = 0; batch < totalBatches; batch++) {
      const batchPasses = remainingRendered.slice(batch * LOAD_MORE_COUNT, (batch + 1) * LOAD_MORE_COUNT);
      const isVisible = batch < loadedBatchCount;
      batchesHtml += `<div class="passes-batch" data-batch="${batch + 1}" style="display: ${isVisible ? "block" : "none"};">${batchPasses.join("")}</div>`;
    }

    // Calculate remaining hidden passes
    const visibleExtraPasses = loadedBatchCount * LOAD_MORE_COUNT;
    const stillHiddenCount = Math.max(0, remainingRendered.length - visibleExtraPasses);

    // Button uses postMessage to parent which handles showing batches
    const loadMoreButton =
      stillHiddenCount > 0
        ? `
      <button id="load-more-passes"
              style="width: 100%; padding: 8px; margin-top: 8px; background: #303336; border: 1px solid #444; color: #fff; cursor: pointer; border-radius: 4px;"
              onclick="parent.postMessage({action: 'loadMorePasses', entityId: '${entityId}', batchSize: ${LOAD_MORE_COUNT}, totalHidden: ${stillHiddenCount}}, '*')">
        Load ${Math.min(LOAD_MORE_COUNT, stillHiddenCount)} more (${stillHiddenCount} remaining)
      </button>
    `
        : "";

    const html = `
      <h3>Passes (${overpassMode.charAt(0).toUpperCase() + overpassMode.slice(1)})${epochNote}</h3>
      <div class="passes-list">
        ${displayedPasses.map((pass) => this.renderPassCard(start, pass, passNameField)).join("")}
        ${batchesHtml}
      </div>
      ${loadMoreButton}
    `;
    return html;
  }

  static renderPassCard(time, pass, passNameField = "name") {
    const satStore = useSatStore();
    const useLocalTime = satStore.useLocalTime;

    // Get first ground station position for timezone
    const groundStationPosition = satStore.groundStations.length > 0 ? { latitude: satStore.groundStations[0].lat, longitude: satStore.groundStations[0].lon } : null;

    function pad2(num) {
      return String(num).padStart(2, "0");
    }

    function formatDuration(durationMs) {
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }

    // Simplified countdown calculation - avoid expensive dayjs operations
    const passStartMs = new Date(pass.start).getTime();
    const passEndMs = new Date(pass.end).getTime();
    const currentMs = time.valueOf();

    let countdown = "ONGOING";
    if (currentMs > passEndMs) {
      countdown = "PREVIOUS";
    } else if (currentMs < passStartMs) {
      const diffMs = passStartMs - currentMs;
      const days = Math.floor(diffMs / 86400000);
      const hours = Math.floor((diffMs % 86400000) / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      countdown = `${pad2(days)}:${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }

    // Generate ground station lighting conditions display
    let groundConditionsHtml = "";
    if (pass.groundStationDarkAtStart !== undefined && pass.groundStationDarkAtEnd !== undefined) {
      const startCondition = pass.groundStationDarkAtStart ? "🌙" : "☀️";
      const endCondition = pass.groundStationDarkAtEnd ? "🌙" : "☀️";
      const startText = pass.groundStationDarkAtStart ? "Dark" : "Light";
      const endText = pass.groundStationDarkAtEnd ? "Dark" : "Light";

      if (pass.groundStationDarkAtStart === pass.groundStationDarkAtEnd) {
        groundConditionsHtml = `<span title="Ground station lighting: ${startText} throughout pass">${startCondition}</span>`;
      } else {
        groundConditionsHtml = `<span title="Ground station lighting: ${startText} → ${endText}">${startCondition}→${endCondition}</span>`;
      }
    } else {
      groundConditionsHtml = "—";
    }

    // Generate satellite eclipse conditions display
    let satelliteConditionsHtml = "";
    if (pass.satelliteEclipsedAtStart !== undefined && pass.satelliteEclipsedAtEnd !== undefined) {
      const startCondition = pass.satelliteEclipsedAtStart ? "🌑" : "☀️";
      const endCondition = pass.satelliteEclipsedAtEnd ? "🌑" : "☀️";
      const startText = pass.satelliteEclipsedAtStart ? "Eclipse" : "Sunlit";
      const endText = pass.satelliteEclipsedAtEnd ? "Eclipse" : "Sunlit";

      let transitionText = "";
      let transitionDetails = "";
      if (pass.eclipseTransitions && pass.eclipseTransitions.length > 0) {
        const transitionCount = pass.eclipseTransitions.length;
        transitionText = ` (${transitionCount} transition${transitionCount > 1 ? "s" : ""})`;

        const transitionTimes = pass.eclipseTransitions
          .map((transition) => {
            const time = TimeFormatHelper.formatTransitionTime(transition.time, useLocalTime, groundStationPosition);
            const direction = transition.toShadow ? "→🌑" : "→☀️";
            const description = transition.toShadow ? "enters eclipse" : "exits eclipse";
            return `${time} ${direction} (${description})`;
          })
          .join(", ");

        transitionDetails = ` - Transitions: ${transitionTimes}`;
      }

      if (pass.satelliteEclipsedAtStart === pass.satelliteEclipsedAtEnd) {
        satelliteConditionsHtml = `<span title="Satellite illumination: ${startText} throughout pass${transitionText}${transitionDetails}">${startCondition}</span>`;
      } else {
        satelliteConditionsHtml = `<span title="Satellite illumination: ${startText} → ${endText}${transitionText}${transitionDetails}">${startCondition}→${endCondition}</span>`;
      }
    } else {
      satelliteConditionsHtml = "—";
    }

    // Generate eclipse transition times for display
    let transitionsDisplay = "";
    if (pass.eclipseTransitions && pass.eclipseTransitions.length > 0) {
      const transitionList = pass.eclipseTransitions
        .map((transition) => {
          const time = TimeFormatHelper.formatTransitionTime(transition.time, useLocalTime, groundStationPosition);
          const icon = transition.toShadow ? "🌑" : "☀️";
          const desc = transition.toShadow ? "eclipse" : "sunlit";
          return `${time} ${icon} ${desc}`;
        })
        .join(", ");
      transitionsDisplay = ` | ${transitionList}`;
    }

    // passNameField contains the satellite name which may already have an asterisk
    const passName = passNameField && pass[passNameField] ? `${pass[passNameField]} - ` : "";
    const formattedPassStart = TimeFormatHelper.formatPassTime(pass.start, useLocalTime, groundStationPosition);

    // Determine display text based on pass type (swath vs elevation)
    let passDetailsText;
    if (pass.swathWidth !== undefined) {
      // Swath mode - show minimum distance and swath width
      passDetailsText = `Min dist ${pass.minDistance.toFixed(1)}km | Swath ${pass.swathWidth.toFixed(0)}km | ${formatDuration(pass.duration)}`;
    } else {
      // Elevation mode - show max elevation and azimuth
      passDetailsText = `Max ${pass.maxElevation.toFixed(0)}° ${pass.azimuthApex.toFixed(0)}° | ${formatDuration(pass.duration)}`;
    }

    const html = `
      <div class="pass-card" onclick='parent.postMessage(${JSON.stringify(pass)}, "*")'>
        <div class="pass-line-1">
          <strong>${passName}${formattedPassStart}</strong>
          <span class="pass-countdown">${countdown}</span>
        </div>
        <div class="pass-line-2">
          <span>${passDetailsText}</span>
          <span class="pass-conditions">Ground: ${groundConditionsHtml} | Sat: ${satelliteConditionsHtml}${transitionsDisplay}</span>
        </div>
      </div>
    `;
    return html;
  }

  static renderPass(time, pass, passNameField = "name", overpassMode = "elevation") {
    const satStore = useSatStore();
    const useLocalTime = satStore.useLocalTime;

    // Get first ground station position for timezone
    const groundStationPosition = satStore.groundStations.length > 0 ? { latitude: satStore.groundStations[0].lat, longitude: satStore.groundStations[0].lon } : null;

    function pad2(num) {
      return String(num).padStart(2, "0");
    }

    function formatDuration(durationMs) {
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
    let countdown = "ONGOING";
    if (dayjs(pass.end).diff(time) < 0) {
      countdown = "PREVIOUS";
    } else if (dayjs(pass.start).diff(time) > 0) {
      countdown = `${pad2(dayjs(pass.start).diff(time, "days"))}:${pad2(dayjs(pass.start).diff(time, "hours") % 24)}:${pad2(dayjs(pass.start).diff(time, "minutes") % 60)}:${pad2(dayjs(pass.start).diff(time, "seconds") % 60)}`;
    }

    // Generate ground station lighting conditions display
    let groundConditionsHtml = "";
    if (pass.groundStationDarkAtStart !== undefined && pass.groundStationDarkAtEnd !== undefined) {
      const startCondition = pass.groundStationDarkAtStart ? "🌙" : "☀️";
      const endCondition = pass.groundStationDarkAtEnd ? "🌙" : "☀️";
      const startText = pass.groundStationDarkAtStart ? "Dark" : "Light";
      const endText = pass.groundStationDarkAtEnd ? "Dark" : "Light";

      if (pass.groundStationDarkAtStart === pass.groundStationDarkAtEnd) {
        // Same condition throughout pass
        groundConditionsHtml = `<span title="Ground station lighting: ${startText} throughout pass">${startCondition}</span>`;
      } else {
        // Different conditions at start and end
        groundConditionsHtml = `<span title="Ground station lighting: ${startText} → ${endText}">${startCondition}→${endCondition}</span>`;
      }
    } else {
      groundConditionsHtml = "—";
    }

    // Generate satellite eclipse conditions display
    let satelliteConditionsHtml = "";
    if (pass.satelliteEclipsedAtStart !== undefined && pass.satelliteEclipsedAtEnd !== undefined) {
      const startCondition = pass.satelliteEclipsedAtStart ? "🌑" : "☀️";
      const endCondition = pass.satelliteEclipsedAtEnd ? "🌑" : "☀️";
      const startText = pass.satelliteEclipsedAtStart ? "Eclipse" : "Sunlit";
      const endText = pass.satelliteEclipsedAtEnd ? "Eclipse" : "Sunlit";

      let transitionText = "";
      let transitionDetails = "";
      if (pass.eclipseTransitions && pass.eclipseTransitions.length > 0) {
        const transitionCount = pass.eclipseTransitions.length;
        transitionText = ` (${transitionCount} transition${transitionCount > 1 ? "s" : ""})`;

        // Create detailed transition time information
        const transitionTimes = pass.eclipseTransitions
          .map((transition) => {
            const time = TimeFormatHelper.formatTransitionTime(transition.time, useLocalTime, groundStationPosition);
            const direction = transition.toShadow ? "→🌑" : "→☀️";
            const description = transition.toShadow ? "enters eclipse" : "exits eclipse";
            return `${time} ${direction} (${description})`;
          })
          .join(", ");

        transitionDetails = ` - Transitions: ${transitionTimes}`;
      }

      if (pass.satelliteEclipsedAtStart === pass.satelliteEclipsedAtEnd) {
        // Same condition throughout pass
        satelliteConditionsHtml = `<span title="Satellite illumination: ${startText} throughout pass${transitionText}${transitionDetails}">${startCondition}</span>`;
      } else {
        // Different conditions at start and end
        satelliteConditionsHtml = `<span title="Satellite illumination: ${startText} → ${endText}${transitionText}${transitionDetails}">${startCondition}→${endCondition}</span>`;
      }
    } else {
      satelliteConditionsHtml = "—";
    }

    // Generate eclipse transition times display
    let transitionsHtml = "—";
    if (pass.eclipseTransitions && pass.eclipseTransitions.length > 0) {
      const transitionList = pass.eclipseTransitions
        .map((transition) => {
          const time = TimeFormatHelper.formatTransitionTime(transition.time, useLocalTime, groundStationPosition);
          const icon = transition.toShadow ? "🌑" : "☀️";
          return `${time} ${icon}`;
        })
        .join("<br>");

      transitionsHtml = `<div class="transition-times" title="Eclipse transition times during pass">${transitionList}</div>`;
    }

    // passNameField contains the satellite name which may already have an asterisk
    const htmlName = passNameField && pass[passNameField] ? `<td>${pass[passNameField]}</td>\n` : "";

    // Handle different pass types based on overpass mode
    let elevationCell, azimuthCell;
    if (overpassMode === "swath") {
      elevationCell = `${pass.minDistance.toFixed(1)}km`;
      azimuthCell = `${pass.swathWidth.toFixed(0)}km`;
    } else {
      // Default to elevation mode
      elevationCell = `${pass.maxElevation.toFixed(0)}&deg`;
      azimuthCell = `${pass.azimuthApex.toFixed(2)}&deg`;
    }
    const formattedPassStart = TimeFormatHelper.formatPassTime(pass.start, useLocalTime, groundStationPosition);
    const formattedPassEnd = TimeFormatHelper.formatTime(pass.end, useLocalTime, "HH:mm:ss", true, groundStationPosition);
    const html = `
      <tr>
        ${htmlName}
        <td>${countdown}</td>
        <td><a onclick='parent.postMessage(${JSON.stringify(pass)}, "*")'>${formattedPassStart}</td>
        <td>${formattedPassEnd}</td>
        <td class="ibt-center">${formatDuration(pass.duration)}</td>
        <td class="ibt-right">${elevationCell}</td>
        <td class="ibt-right">${azimuthCell}</td>
        <td class="ibt-center">${groundConditionsHtml}</td>
        <td class="ibt-center">${satelliteConditionsHtml}</td>
        <td class="ibt-center">${transitionsHtml}</td>
      </tr>
    `;
    return html;
  }

  static renderTLE(tle, julianDate) {
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    const tleDate = new JulianDate(julianDayNumber, secondsOfDay);
    const formattedDate = TimeFormatHelper.formatTLEEpoch(tleDate);
    const html = `
      <h3>TLE (Epoch ${formattedDate})</h3>
      <div class="ib-code"><code>${tle.slice(1, 3).join("\n")}</code></div>`;
    return html;
  }
}
