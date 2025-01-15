import * as Cesium from "@cesium/engine";
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
    return new Cesium.CallbackProperty((time) => {
      if (cache && Cesium.JulianDate.equalsEpsilon(time, cache.time, updateTreshold) && cache.usage < usageTreshold) {
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
    const name = props.name;
    const passes = props.passes;
    const tle = props.orbit.tle;
    const julianDate = props.orbit.julianDate;
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
        ${this.renderPasses(passes, time, false)}
        ${this.renderTLE(tle, julianDate)}
      </div>
    `;
    return description;
  }

  static renderGroundstationDescription(time, name, position, passes) {
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
        ${this.renderPasses(passes, time, true)}
      </div>
    `;
    return description;
  }

  static renderPasses(passes, time, isGroundStation) {
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
      <h3>Passes</h3>
      <table class="ibt">
        <thead>
          <tr>
            ${htmlName}
            <th>Countdown</th>
            <th>Start</th>
            <th>End</th>
            <th>El</th>
            <th>Az</th>
          </tr>
        </thead>
        <tbody>
          ${upcomingPasses.map((pass) => this.renderPass(start, pass, passNameField)).join("")}
        </tbody>
      </table>
    `;
    return html;
  }

  static renderPass(time, pass, passNameField = "name") {
    function pad2(num) {
      return String(num).padStart(2, "0");
    }
    let countdown = "ONGOING";
    if (dayjs(pass.end).diff(time) < 0) {
      countdown = "PREVIOUS";
    } else if (dayjs(pass.start).diff(time) > 0) {
      countdown = `${pad2(dayjs(pass.start).diff(time, "days"))}:${pad2(dayjs(pass.start).diff(time, "hours") % 24)}:${pad2(dayjs(pass.start).diff(time, "minutes") % 60)}:${pad2(dayjs(pass.start).diff(time, "seconds") % 60)}`;
    }
    const htmlName = passNameField ? `<td>${pass[passNameField]}</td>\n` : "";
    const html = `
      <tr>
        ${htmlName}
        <td>${countdown}</td>
        <td><a onclick='parent.postMessage(${JSON.stringify(pass)}, "*")'>${dayjs.utc(pass.start).format("DD.MM HH:mm:ss")}</td>
        <td>${dayjs.utc(pass.end).format("HH:mm:ss")}</td>
        <td class="ibt-right">${pass.maxElevation.toFixed(0)}&deg</td>
        <td class="ibt-right">${pass.azimuthApex.toFixed(2)}&deg</td>
      </tr>
    `;
    return html;
  }

  static renderTLE(tle, julianDate) {
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    const tleDate = new Cesium.JulianDate(julianDayNumber, secondsOfDay);
    const formattedDate = dayjs.utc(tleDate).format("YYYY-MM-DD HH:mm:ss");
    const html = `
      <h3>TLE (Epoch ${formattedDate})</h3>
      <div class="ib-code"><code>${tle.slice(1, 3).join("\n")}</code></div>`;
    return html;
  }
}
