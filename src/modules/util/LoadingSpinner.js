/**
 * LoadingSpinner - Displays a loading animation during satellite operations
 * Positioned at bottom middle, above the timeline
 */
export class LoadingSpinner {
  constructor(viewer) {
    this.viewer = viewer;
    this.spinnerElement = null;
    this.isVisible = false;
  }

  /**
   * Show the loading spinner
   */
  show() {
    if (this.isVisible) {
      return;
    }

    // Create spinner element if it doesn't exist
    if (!this.spinnerElement) {
      this.spinnerElement = document.createElement("div");
      this.spinnerElement.id = "satellite-loading-spinner";
      this.spinnerElement.style.cssText = `
        position: absolute;
        bottom: 35px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 20px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        pointer-events: none;
      `;

      // Create spinner SVG
      const spinner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      spinner.setAttribute("width", "20");
      spinner.setAttribute("height", "20");
      spinner.setAttribute("viewBox", "0 0 50 50");
      spinner.style.animation = "spin 1s linear infinite";

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "25");
      circle.setAttribute("cy", "25");
      circle.setAttribute("r", "20");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "white");
      circle.setAttribute("stroke-width", "5");
      circle.setAttribute("stroke-dasharray", "31.4 94.2");
      circle.setAttribute("stroke-linecap", "round");

      spinner.appendChild(circle);

      // Create text element
      const text = document.createElement("span");
      text.textContent = "Loading satellites...";

      this.spinnerElement.appendChild(spinner);
      this.spinnerElement.appendChild(text);

      // Add CSS animation for spinner rotation
      const style = document.createElement("style");
      style.textContent = `
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);

      this.viewer.container.appendChild(this.spinnerElement);
    }

    this.spinnerElement.style.display = "flex";
    this.isVisible = true;
  }

  /**
   * Hide the loading spinner
   */
  hide() {
    if (!this.isVisible || !this.spinnerElement) {
      return;
    }

    this.spinnerElement.style.display = "none";
    this.isVisible = false;
  }

  /**
   * Remove the spinner element completely
   */
  destroy() {
    if (this.spinnerElement && this.spinnerElement.parentNode) {
      this.spinnerElement.parentNode.removeChild(this.spinnerElement);
      this.spinnerElement = null;
    }
    this.isVisible = false;
  }
}
