import dayjs from "dayjs";

export class PushManager {
  constructor(options = {}) {
    this.options = options;
    this.timers = [];
  }

  get available() {
    if ("webkit" in window) {
      return true;
    }
    if (!("Notification" in window)) {
      console.log("Notification API not supported!");
      return false;
    }
    switch (Notification.permission) {
      case "granted":
        return true;
      case "default":
        this.requestPermission();
        return true;
      case "denied":
        return false;
      default:
        return false;
    }
  }

  requestPermission() {
    Notification.requestPermission((result) => {
      console.log(`Notifcation permission result: ${result}`);
    });
  }

  get active() {
    return this.timers.length > 0;
  }

  clearTimers() {
    this.timers.forEach((timer) => {
      clearTimeout(timer.id);
    });
    this.timers = [];
  }

  persistentNotification(message, options) {
    if (!this.available) {
      return;
    }
    const optionsMerged = { ...this.options, ...options };

    // Helper to show regular notification as fallback
    const showFallbackNotification = () => {
      try {
        new Notification(message, optionsMerged);
      } catch (err) {
        console.log(`Notification API error: ${err}`);
      }
    };

    // Try service worker notification first (persistent, survives page close)
    if (navigator.serviceWorker) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (reg) {
            reg.showNotification(message, optionsMerged);
          } else {
            // No service worker registered, fall back to regular notification
            showFallbackNotification();
          }
        })
        .catch((err) => {
          console.log(`Service Worker registration error: ${err}`);
          showFallbackNotification();
        });
    } else {
      // No service worker support, use regular notification
      showFallbackNotification();
    }
  }

  notifyInMs(ms, message, options) {
    if (!this.available) {
      return;
    }
    console.log(`Notify "${message}" in ${ms / 1000}s`);
    setTimeout(() => {
      this.persistentNotification(message, options);
    }, ms);
  }

  notifyAtDate(date, message, options) {
    if (!this.available) {
      return;
    }
    const waitMs = dayjs(date).diff(dayjs());
    if (waitMs < 0) {
      return;
    }
    if (this.timers.some((timer) => Math.abs(timer.date.diff(date, "seconds")) < 10)) {
      console.log("Ignore duplicate entry");
      return;
    }
    console.log(`Notify "${message}" at ${date}s ${dayjs(date).unix()}`);

    if ("webkit" in window) {
      const content = {
        date: dayjs(date).unix(),
        delay: waitMs / 1000,
        message,
      };
      window.webkit.messageHandlers.iosNotify.postMessage(content);
    } else {
      const id = setTimeout(() => {
        this.persistentNotification(message, options);
      }, waitMs);
      this.timers.push({
        id,
        date,
        message,
      });
    }
  }
}
