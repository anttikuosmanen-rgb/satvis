import * as Cesium from "@cesium/engine";

export class CesiumTimelineHelper {
  static clearHighlightRanges(viewer) {
     
    if (!viewer.timeline || viewer.timeline._highlightRanges.length === 0) {
      return;
    }
     
    viewer.timeline._highlightRanges = [];
    viewer.timeline.updateFromClock();
    viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }

  static addHighlightRanges(viewer, ranges) {
    if (!viewer.timeline) {
      return;
    }
    ranges.forEach((range) => {
      const startJulian = Cesium.JulianDate.fromDate(new Date(range.start));
      const endJulian = Cesium.JulianDate.fromDate(new Date(range.end));
      const highlightRange = viewer.timeline.addHighlightRange(Cesium.Color.BLUE, 100, 0);
      highlightRange.setRange(startJulian, endJulian);
      viewer.timeline.updateFromClock();
      viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
    });
  }

  static updateHighlightRanges(viewer, ranges) {
    this.clearHighlightRanges(viewer);
    this.addHighlightRanges(viewer, ranges);
  }
}
