import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import tzlookup from "tz-lookup";

dayjs.extend(utc);

export class TimeFormatHelper {
  /**
   * Get timezone from ground station coordinates
   * Uses tz-lookup library to accurately determine IANA timezone including DST rules
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {string} IANA timezone identifier (e.g., "Europe/Helsinki", "America/New_York")
   */
  static getTimezoneFromCoordinates(lat, lon) {
    try {
      // Use tz-lookup to find the timezone for the given coordinates
      // Returns a single IANA timezone identifier
      const timezone = tzlookup(lat, lon);
      if (timezone) {
        return timezone;
      }
    } catch (error) {
      console.warn('Error looking up timezone for coordinates:', lat, lon, error);
    }

    // Fallback to simple longitude-based calculation if tz-lookup fails
    const offsetHours = Math.round(lon / 15);
    if (offsetHours === 0) {
      return 'UTC';
    } else if (offsetHours > 0) {
      return `Etc/GMT-${offsetHours}`;
    } else {
      return `Etc/GMT+${Math.abs(offsetHours)}`;
    }
  }

  /**
   * Get timezone offset in UTC+x format
   * @param {string} timezone - IANA timezone identifier
   * @param {Date} date - The date to get offset for (defaults to now)
   * @returns {string} Timezone offset (e.g., "UTC+2", "UTC-5", "UTC")
   */
  static getTimezoneOffset(timezone = null, date = new Date()) {
    if (!timezone) {
      return 'UTC';
    }

    try {
      // Get the offset in minutes by comparing UTC and local time
      const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
      const offsetMinutes = (tzDate.getTime() - utcDate.getTime()) / 60000;
      const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
      const offsetMins = Math.abs(offsetMinutes) % 60;

      if (offsetMinutes === 0) {
        return 'UTC';
      }

      const sign = offsetMinutes > 0 ? '+' : '-';
      if (offsetMins === 0) {
        return `UTC${sign}${offsetHours}`;
      } else {
        return `UTC${sign}${offsetHours}:${offsetMins.toString().padStart(2, '0')}`;
      }
    } catch {
      return 'UTC';
    }
  }

  /**
   * Get timezone abbreviation for a specific timezone
   * @param {string} timezone - IANA timezone identifier
   * @returns {string} Timezone abbreviation (e.g., "EST", "PST", "CET")
   */
  static getTimezoneAbbreviation(timezone = null) {
    const date = new Date();
    const options = {
      timeZoneName: 'short',
    };

    if (timezone) {
      options.timeZone = timezone;
    }

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(date);
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');

    return timeZonePart ? timeZonePart.value : (timezone || 'Local');
  }

  /**
   * Format a timestamp for display, either in UTC or ground station local time
   * @param {Date|number} timestamp - The timestamp to format
   * @param {boolean} useLocalTime - Whether to use local time
   * @param {string} format - The dayjs format string
   * @param {boolean} includeTimezone - Whether to include timezone abbreviation
   * @param {Object} groundStationPosition - Ground station position {latitude, longitude}
   * @returns {string} Formatted time string
   */
  static formatTime(timestamp, useLocalTime = false, format = "DD.MM HH:mm:ss", includeTimezone = false, groundStationPosition = null) {
    if (useLocalTime && groundStationPosition) {
      // Format in ground station's local time using Intl API
      const date = new Date(timestamp);
      const timezone = this.getTimezoneFromCoordinates(groundStationPosition.latitude, groundStationPosition.longitude);

      const options = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };

      const formatter = new Intl.DateTimeFormat('en-GB', options);
      const formatted = formatter.format(date).replace(/\//g, '.').replace(',', '');

      if (includeTimezone) {
        const tzOffset = this.getTimezoneOffset(timezone, date);
        return `${formatted} ${tzOffset}`;
      }
      return formatted;
    } else {
      const formatted = dayjs.utc(timestamp).format(format);
      return includeTimezone ? `${formatted} UTC` : formatted;
    }
  }

  /**
   * Format eclipse transition time
   * @param {Date|number} timestamp - The timestamp to format
   * @param {boolean} useLocalTime - Whether to use local time
   * @param {Object} groundStationPosition - Ground station position
   * @returns {string} Formatted time string with timezone
   */
  static formatTransitionTime(timestamp, useLocalTime = false, groundStationPosition = null) {
    return this.formatTime(timestamp, useLocalTime, "HH:mm:ss", true, groundStationPosition);
  }

  /**
   * Format pass start/end time
   * @param {Date|number} timestamp - The timestamp to format
   * @param {boolean} useLocalTime - Whether to use local time
   * @param {Object} groundStationPosition - Ground station position
   * @returns {string} Formatted time string with timezone
   */
  static formatPassTime(timestamp, useLocalTime = false, groundStationPosition = null) {
    return this.formatTime(timestamp, useLocalTime, "DD.MM HH:mm:ss", true, groundStationPosition);
  }

  /**
   * Format TLE epoch time (always UTC)
   * @param {Date|number} timestamp - The timestamp to format
   * @returns {string} Formatted time string with UTC indicator
   */
  static formatTLEEpoch(timestamp) {
    return `${dayjs.utc(timestamp).format("YYYY-MM-DD HH:mm:ss")} UTC`;
  }
}
