import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PassCountdownTimer from "../components/PassCountdownTimer.vue";

describe("PassCountdownTimer.vue", () => {
  let wrapper;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Component Setup & Props", () => {
    it("should mount correctly with default props", () => {
      wrapper = mount(PassCountdownTimer);
      expect(wrapper.exists()).toBe(true);
    });

    it("should not render when show is false", () => {
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: false,
          trackedSatellite: "ISS",
          passes: [],
        },
      });
      expect(wrapper.find(".pass-countdown-overlay").exists()).toBe(false);
    });

    it("should not render when no passes are available", () => {
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [],
        },
      });
      expect(wrapper.find(".pass-countdown-overlay").exists()).toBe(false);
    });

    it("should handle missing trackedSatellite prop", () => {
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          passes: [
            {
              start: new Date(Date.now() + 300000).toISOString(),
              end: new Date(Date.now() + 600000).toISOString(),
            },
          ],
        },
      });
      expect(wrapper.find(".pass-countdown-overlay").exists()).toBe(false);
    });
  });

  describe("Computed Properties - minutes", () => {
    it("should format minutes with zero padding", () => {
      const futureTime = Date.now() + 125000; // 2 minutes 5 seconds
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000); // Trigger updateCountdown

      const vm = wrapper.vm;
      expect(vm.minutes).toEqual(["0", "2"]);
    });

    it("should handle single digit minutes", () => {
      const futureTime = Date.now() + 65000; // 1 minute 5 seconds
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.minutes).toEqual(["0", "1"]);
    });

    it("should handle double digit minutes", () => {
      const futureTime = Date.now() + 845000; // 14 minutes 5 seconds
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.minutes).toEqual(["1", "4"]);
    });
  });

  describe("Computed Properties - seconds", () => {
    it("should format seconds with zero padding", () => {
      const now = Date.now();
      const futureTime = now + 125000; // 2 minutes 5 seconds
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.setSystemTime(now + 1000); // Advance time by 1 second
      vi.advanceTimersByTime(1000); // Trigger interval

      const vm = wrapper.vm;
      // Should be close to 04 seconds (within 2 seconds due to timing)
      expect(vm.seconds[0]).toBe("0");
      expect(parseInt(vm.seconds[1])).toBeLessThanOrEqual(5);
      expect(parseInt(vm.seconds[1])).toBeGreaterThanOrEqual(3);
    });

    it("should handle zero seconds", () => {
      const now = Date.now();
      const futureTime = now + 120000; // Exactly 2 minutes
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.setSystemTime(now + 1000); // Advance time by 1 second
      vi.advanceTimersByTime(1000); // Trigger interval

      const vm = wrapper.vm;
      // Should be close to 59 seconds (within 2 seconds due to timing)
      expect(vm.seconds[0]).toBe("5");
      expect(parseInt(vm.seconds[1])).toBeLessThanOrEqual(9);
      expect(parseInt(vm.seconds[1])).toBeGreaterThanOrEqual(7);
    });

    it("should handle double digit seconds", () => {
      const now = Date.now();
      const futureTime = now + 45000; // 45 seconds
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.setSystemTime(now + 1000); // Advance time by 1 second
      vi.advanceTimersByTime(1000); // Trigger interval

      const vm = wrapper.vm;
      // Should be close to 44 seconds (within 2 seconds due to timing)
      expect(vm.seconds[0]).toBe("4");
      expect(parseInt(vm.seconds[1])).toBeLessThanOrEqual(5);
      expect(parseInt(vm.seconds[1])).toBeGreaterThanOrEqual(2);
    });
  });

  describe("findNextPass Function", () => {
    it("should find the next upcoming pass", () => {
      const now = Date.now();
      const passes = [
        {
          start: new Date(now + 100000).toISOString(),
          end: new Date(now + 400000).toISOString(),
        },
        {
          start: new Date(now + 500000).toISOString(),
          end: new Date(now + 800000).toISOString(),
        },
      ];

      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes,
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeTruthy();
      expect(vm.nextPass.start).toBe(passes[0].start);
    });

    it("should find current ongoing pass", () => {
      const now = Date.now();
      const passes = [
        {
          start: new Date(now - 10000).toISOString(), // Started 10 sec ago
          end: new Date(now + 290000).toISOString(), // Ends in 290 sec
        },
      ];

      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes,
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeTruthy();
      expect(vm.nextPass.start).toBe(passes[0].start);
    });

    it("should return null when no upcoming passes", () => {
      const now = Date.now();
      const passes = [
        {
          start: new Date(now - 400000).toISOString(),
          end: new Date(now - 100000).toISOString(), // Ended 100 sec ago
        },
      ];

      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes,
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeNull();
      expect(vm.showTimer).toBe(false);
    });

    it("should handle empty passes array", () => {
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [],
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeNull();
      expect(vm.showTimer).toBe(false);
    });

    it("should skip past passes and find next one", () => {
      const now = Date.now();
      const passes = [
        {
          start: new Date(now - 400000).toISOString(),
          end: new Date(now - 100000).toISOString(), // Past
        },
        {
          start: new Date(now + 100000).toISOString(),
          end: new Date(now + 400000).toISOString(), // Future - should select this
        },
      ];

      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes,
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeTruthy();
      expect(vm.nextPass.start).toBe(passes[1].start);
    });
  });

  describe("updateCountdown Function", () => {
    it("should count down to pass start (before pass)", () => {
      const futureTime = Date.now() + 60000; // 1 minute from now
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.countdown).toBeGreaterThan(50); // Should be around 59-60 seconds
      expect(vm.countdown).toBeLessThan(61);
      expect(vm.isPassActive).toBe(false);
    });

    it("should count down to pass end (during pass)", () => {
      const now = Date.now();
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(now - 10000).toISOString(), // Started 10 sec ago
              end: new Date(now + 50000).toISOString(), // Ends in 50 sec
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.countdown).toBeGreaterThan(40); // Should be around 49-50 seconds
      expect(vm.countdown).toBeLessThan(51);
      expect(vm.isPassActive).toBe(true);
    });

    it("should set isPassActive to false before pass starts", () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.isPassActive).toBe(false);
    });

    it("should set isPassActive to true during pass", () => {
      const now = Date.now();
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(now - 10000).toISOString(),
              end: new Date(now + 50000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.isPassActive).toBe(true);
    });

    it("should apply active class when pass is active", async () => {
      const now = Date.now();
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(now - 10000).toISOString(),
              end: new Date(now + 50000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".countdown-display.active").exists()).toBe(true);
    });

    it("should not apply active class when pass is not active", async () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".countdown-display.active").exists()).toBe(false);
    });
  });

  describe("Watchers", () => {
    it("should update when trackedSatellite changes to valid value", async () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: null,
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      const vm = wrapper.vm;
      expect(vm.showTimer).toBe(false);

      await wrapper.setProps({ trackedSatellite: "ISS" });
      vi.advanceTimersByTime(1000);

      expect(vm.showTimer).toBe(true);
      expect(vm.nextPass).toBeTruthy();
    });

    it("should hide timer when trackedSatellite becomes null", async () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);

      const vm = wrapper.vm;
      expect(vm.showTimer).toBe(true);

      await wrapper.setProps({ trackedSatellite: null });

      expect(vm.showTimer).toBe(false);
      expect(vm.nextPass).toBeNull();
    });

    it("should update when passes prop changes", async () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [],
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeNull();

      await wrapper.setProps({
        passes: [
          {
            start: new Date(futureTime).toISOString(),
            end: new Date(futureTime + 300000).toISOString(),
          },
        ],
      });

      vi.advanceTimersByTime(1000);

      expect(vm.nextPass).toBeTruthy();
    });
  });

  describe("Lifecycle Hooks", () => {
    it("should start interval on mount", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");

      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [],
        },
      });

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it("should clear interval on unmount", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [],
        },
      });

      wrapper.unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should find next pass on mount if satellite is tracked", () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      const vm = wrapper.vm;
      expect(vm.nextPass).toBeTruthy();
    });
  });

  describe("Rendering", () => {
    it("should render countdown overlay when conditions are met", async () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".pass-countdown-overlay").exists()).toBe(true);
      expect(wrapper.find(".countdown-display").exists()).toBe(true);
    });

    it("should render time segments with digits", async () => {
      const futureTime = Date.now() + 125000; // 2:05
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      const digits = wrapper.findAll(".digit");
      expect(digits.length).toBe(4); // MM:SS = 4 digits
    });

    it("should render separator between minutes and seconds", async () => {
      const futureTime = Date.now() + 60000;
      wrapper = mount(PassCountdownTimer, {
        props: {
          show: true,
          trackedSatellite: "ISS",
          passes: [
            {
              start: new Date(futureTime).toISOString(),
              end: new Date(futureTime + 300000).toISOString(),
            },
          ],
        },
      });

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".separator").exists()).toBe(true);
      expect(wrapper.find(".separator").text()).toBe(":");
    });
  });
});
