import { CallbackProperty, JulianDate } from "@cesium/engine";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(relativeTime);
dayjs.extend(utc);

export class DescriptionHelper {
  /** cachedCallbackProperty
   * Caches the results of a callback property to prevent unnecessary recalculation.
   * @param {function} callback - The amount of simulation time to use the calculated result
   * @param {number} updateTreshold - The amount of simulation time to use the calculated result
   * @param {number} usageTreshold - The number of invocations to serve the same result
   */
  static cachedCallbackProperty(callback, updateTreshold = 1, usageTreshold = 1000) {
    let cache;
    return new CallbackProperty((time) => {
      if (cache && JulianDate.equalsEpsilon(time, cache.time, updateTreshold) && cache.usage < usageTreshold) {
        // console.log("Cached callback", time, cache.usage);
        cache.usage += 1;
        return cache.content;
      }
      const content = callback(time);
      cache = {
        time,
        content,
        usage: 0,
      };
      return content;
    }, false);
  }

  static renderSatelliteDescription(time, position, props) {
    const { name, passes, orbit, overpassMode } = props;
    const { tle, julianDate } = orbit;
    const description = `
      <div class="ib">
        <h3>Position</h3>
        <table class="ibt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Altitude</th>
              <th>Velocity</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${name}</td>
              <td>${position.latitude.toFixed(2)}&deg</td>
              <td>${position.longitude.toFixed(2)}&deg</td>
              <td>${(position.height / 1000).toFixed(2)} km</td>
              <td>${position.velocity.toFixed(2)} km/s</td>
            </tr>
          </tbody>
        </table>
        ${this.renderPasses(passes, time, false, overpassMode)}
        ${this.renderTLE(tle, julianDate)}
      </div>
    `;
    return description;
  }

  static renderGroundstationDescription(time, name, position, passes, overpassMode = null) {
    const description = `
      <div class="ib">
        <h3>Position</h3>
        <table class="ibt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Latitude</th>
              <th>Longitude</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${name}</td>
              <td>${position.latitude.toFixed(2)}&deg</td>
              <td>${position.longitude.toFixed(2)}&deg</td>
            </tr>
          </tbody>
        </table>
        ${this.renderPasses(passes, time, true, overpassMode)}
      </div>
    `;
    return description;
  }

  static renderPasses(passes, time, isGroundStation, overpassMode) {
    if (passes.length === 0) {
      if (isGroundStation) {
        return `
          <h3>Passes</h3>
          <div class="ib-text">No passes available</div>
          `;
      }
      return `
        <h3>Passes</h3>
        <div class="ib-text">No ground station set</div>
        `;
    }

    const start = dayjs(time);
    const upcomingPassIdx = passes.findIndex((pass) => dayjs(pass.end).isAfter(start));
    if (upcomingPassIdx < 0) {
      return "";
    }
    const upcomingPasses = passes.slice(upcomingPassIdx);

    const passNameField = isGroundStation ? "name" : "groundStationName";
    const htmlName = passNameField ? "<th>Name</th>\n" : "";
    const html = `
      <h3>Passes (${overpassMode.charAt(0).toUpperCase() + overpassMode.slice(1)})</h3>
      <table class="ibt">
        <thead>
          <tr>
            ${htmlName}
            <th>Countdown</th>
            <th>Start</th>
            <th>End</th>
            <th>${overpassMode === "elevation" ? "El" : "Dist"}</th>
            <th>${overpassMode === "elevation" ? "Az" : "Swath"}</th>
            <th>Conditions</th>
          </tr>
        </thead>
        <tbody>
          ${upcomingPasses.map((pass) => this.renderPass(start, pass, passNameField, overpassMode)).join("")}
        </tbody>
      </table>
    `;
    return html;
  }

  static renderPass(time, pass, passNameField = "name", overpassMode = "elevation") {
    function pad2(num) {
      return String(num).padStart(2, "0");
    }
    let countdown = "ONGOING";
    if (dayjs(pass.end).diff(time) < 0) {
      countdown = "PREVIOUS";
    } else if (dayjs(pass.start).diff(time) > 0) {
      countdown = `${pad2(dayjs(pass.start).diff(time, "days"))}:${pad2(dayjs(pass.start).diff(time, "hours") % 24)}:${pad2(dayjs(pass.start).diff(time, "minutes") % 60)}:${pad2(dayjs(pass.start).diff(time, "seconds") % 60)}`;
    }

    // Generate ground station lighting conditions display
    let conditionsHtml = "";
    if (pass.groundStationDarkAtStart !== undefined && pass.groundStationDarkAtEnd !== undefined) {
      const startCondition = pass.groundStationDarkAtStart ? "🌙" : "☀️";
      const endCondition = pass.groundStationDarkAtEnd ? "🌙" : "☀️";
      const startText = pass.groundStationDarkAtStart ? "Dark" : "Light";
      const endText = pass.groundStationDarkAtEnd ? "Dark" : "Light";

      if (pass.groundStationDarkAtStart === pass.groundStationDarkAtEnd) {
        // Same condition throughout pass
        conditionsHtml = `<span title="Ground station lighting: ${startText} throughout pass">${startCondition} ${startText}</span>`;
      } else {
        // Different conditions at start and end
        conditionsHtml = `<span title="Ground station lighting: ${startText} → ${endText}">${startCondition}→${endCondition}</span>`;
      }
    } else {
      conditionsHtml = "—";
    }

    const htmlName = passNameField ? `<td>${pass[passNameField]}</td>\n` : "";

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

    const html = `
      <tr>
        ${htmlName}
        <td>${countdown}</td>
        <td><a onclick='parent.postMessage(${JSON.stringify(pass)}, "*")'>${dayjs.utc(pass.start).format("DD.MM HH:mm:ss")}</td>
        <td>${dayjs.utc(pass.end).format("HH:mm:ss")}</td>
        <td class="ibt-right">${elevationCell}</td>
        <td class="ibt-right">${azimuthCell}</td>
        <td class="ibt-center">${conditionsHtml}</td>
      </tr>
    `;
    return html;
  }

  static renderTLE(tle, julianDate) {
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    const tleDate = new JulianDate(julianDayNumber, secondsOfDay);
    const formattedDate = dayjs.utc(tleDate).format("YYYY-MM-DD HH:mm:ss");
    const html = `
      <h3>TLE (Epoch ${formattedDate})</h3>
      <div class="ib-code"><code>${tle.slice(1, 3).join("\n")}</code></div>`;
    return html;
  }
}
