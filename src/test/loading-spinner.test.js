import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LoadingSpinner } from "../modules/util/LoadingSpinner.js";

describe("LoadingSpinner", () => {
  let mockViewer;
  let loadingSpinner;

  beforeEach(() => {
    // Create a container element for the viewer
    const container = document.createElement("div");
    container.id = "cesiumContainer";
    document.body.appendChild(container);

    mockViewer = {
      container: container,
    };

    loadingSpinner = new LoadingSpinner(mockViewer);
  });

  afterEach(() => {
    // Clean up DOM
    loadingSpinner.destroy();
    const container = document.getElementById("cesiumContainer");
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe("constructor", () => {
    it("should initialize with viewer reference", () => {
      expect(loadingSpinner.viewer).toBe(mockViewer);
    });

    it("should initialize with null spinnerElement", () => {
      expect(loadingSpinner.spinnerElement).toBeNull();
    });

    it("should initialize with isVisible as false", () => {
      expect(loadingSpinner.isVisible).toBe(false);
    });
  });

  describe("show", () => {
    it("should create spinner element on first call", () => {
      loadingSpinner.show();

      expect(loadingSpinner.spinnerElement).not.toBeNull();
      expect(loadingSpinner.spinnerElement).toBeInstanceOf(HTMLDivElement);
    });

    it("should add spinner element to viewer container", () => {
      loadingSpinner.show();

      const spinnerInDOM = mockViewer.container.querySelector("#satellite-loading-spinner");
      expect(spinnerInDOM).not.toBeNull();
      expect(spinnerInDOM).toBe(loadingSpinner.spinnerElement);
    });

    it("should set isVisible to true", () => {
      loadingSpinner.show();

      expect(loadingSpinner.isVisible).toBe(true);
    });

    it("should set correct CSS styling on spinner element", () => {
      loadingSpinner.show();

      const styles = loadingSpinner.spinnerElement.style;
      expect(styles.position).toBe("absolute");
      expect(styles.bottom).toBe("35px");
      expect(styles.zIndex).toBe("1000");
      expect(styles.display).toBe("flex");
    });

    it("should create SVG spinner with correct attributes", () => {
      loadingSpinner.show();

      const svg = loadingSpinner.spinnerElement.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg.getAttribute("width")).toBe("20");
      expect(svg.getAttribute("height")).toBe("20");
      expect(svg.getAttribute("viewBox")).toBe("0 0 50 50");
    });

    it("should create circle element inside SVG", () => {
      loadingSpinner.show();

      const circle = loadingSpinner.spinnerElement.querySelector("circle");
      expect(circle).not.toBeNull();
      expect(circle.getAttribute("cx")).toBe("25");
      expect(circle.getAttribute("cy")).toBe("25");
      expect(circle.getAttribute("r")).toBe("20");
      expect(circle.getAttribute("stroke")).toBe("white");
    });

    it("should create text element with loading message", () => {
      loadingSpinner.show();

      const text = loadingSpinner.spinnerElement.querySelector("span");
      expect(text).not.toBeNull();
      expect(text.textContent).toBe("Loading satellites...");
    });

    it("should add CSS animation styles to document head", () => {
      loadingSpinner.show();

      const styles = document.head.querySelectorAll("style");
      const animationStyle = Array.from(styles).find((style) => style.textContent.includes("@keyframes spin"));
      expect(animationStyle).not.toBeNull();
    });

    it("should not create new element on second call (when already visible)", () => {
      loadingSpinner.show();
      const firstElement = loadingSpinner.spinnerElement;

      loadingSpinner.show();
      const secondElement = loadingSpinner.spinnerElement;

      expect(firstElement).toBe(secondElement);
    });

    it("should reuse existing element on show after hide", () => {
      loadingSpinner.show();
      const firstElement = loadingSpinner.spinnerElement;

      loadingSpinner.hide();
      loadingSpinner.show();

      expect(loadingSpinner.spinnerElement).toBe(firstElement);
      expect(loadingSpinner.spinnerElement.style.display).toBe("flex");
    });
  });

  describe("hide", () => {
    it("should set display to none", () => {
      loadingSpinner.show();
      loadingSpinner.hide();

      expect(loadingSpinner.spinnerElement.style.display).toBe("none");
    });

    it("should set isVisible to false", () => {
      loadingSpinner.show();
      loadingSpinner.hide();

      expect(loadingSpinner.isVisible).toBe(false);
    });

    it("should not throw error when called without showing first", () => {
      expect(() => loadingSpinner.hide()).not.toThrow();
    });

    it("should be idempotent (can be called multiple times)", () => {
      loadingSpinner.show();
      loadingSpinner.hide();
      loadingSpinner.hide();

      expect(loadingSpinner.isVisible).toBe(false);
    });

    it("should keep element in DOM (not remove it)", () => {
      loadingSpinner.show();
      loadingSpinner.hide();

      const spinnerInDOM = mockViewer.container.querySelector("#satellite-loading-spinner");
      expect(spinnerInDOM).not.toBeNull();
    });
  });

  describe("destroy", () => {
    it("should remove spinner element from DOM", () => {
      loadingSpinner.show();
      loadingSpinner.destroy();

      const spinnerInDOM = mockViewer.container.querySelector("#satellite-loading-spinner");
      expect(spinnerInDOM).toBeNull();
    });

    it("should set spinnerElement to null", () => {
      loadingSpinner.show();
      loadingSpinner.destroy();

      expect(loadingSpinner.spinnerElement).toBeNull();
    });

    it("should set isVisible to false", () => {
      loadingSpinner.show();
      loadingSpinner.destroy();

      expect(loadingSpinner.isVisible).toBe(false);
    });

    it("should not throw error when called without showing first", () => {
      expect(() => loadingSpinner.destroy()).not.toThrow();
    });

    it("should be idempotent (can be called multiple times)", () => {
      loadingSpinner.show();
      loadingSpinner.destroy();
      loadingSpinner.destroy();

      expect(loadingSpinner.spinnerElement).toBeNull();
      expect(loadingSpinner.isVisible).toBe(false);
    });
  });

  describe("multiple show/hide cycles", () => {
    it("should handle multiple show/hide cycles correctly", () => {
      // Cycle 1
      loadingSpinner.show();
      expect(loadingSpinner.isVisible).toBe(true);

      loadingSpinner.hide();
      expect(loadingSpinner.isVisible).toBe(false);

      // Cycle 2
      loadingSpinner.show();
      expect(loadingSpinner.isVisible).toBe(true);

      loadingSpinner.hide();
      expect(loadingSpinner.isVisible).toBe(false);

      // Cycle 3
      loadingSpinner.show();
      expect(loadingSpinner.isVisible).toBe(true);
    });

    it("should maintain element reference across cycles", () => {
      loadingSpinner.show();
      const element1 = loadingSpinner.spinnerElement;

      loadingSpinner.hide();
      loadingSpinner.show();
      const element2 = loadingSpinner.spinnerElement;

      loadingSpinner.hide();
      loadingSpinner.show();
      const element3 = loadingSpinner.spinnerElement;

      expect(element1).toBe(element2);
      expect(element2).toBe(element3);
    });

    it("should create new element after destroy and show", () => {
      loadingSpinner.show();
      const element1 = loadingSpinner.spinnerElement;

      loadingSpinner.destroy();

      loadingSpinner.show();
      const element2 = loadingSpinner.spinnerElement;

      expect(element1).not.toBe(element2);
      expect(element2).not.toBeNull();
    });
  });
});
