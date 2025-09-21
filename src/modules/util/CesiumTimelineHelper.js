import { Color, JulianDate } from "@cesium/engine";

export class CesiumTimelineHelper {
  static clearHighlightRanges(viewer) {
    if (!viewer.timeline || viewer.timeline._highlightRanges.length === 0) {
      return;
    }

    viewer.timeline._highlightRanges = [];
    viewer.timeline.updateFromClock();
    viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }

  static addHighlightRanges(viewer, ranges, satelliteName) {
    if (!viewer.timeline) {
      return;
    }
    ranges.forEach((range) => {
      const startJulian = JulianDate.fromDate(new Date(range.start));
      const endJulian = JulianDate.fromDate(new Date(range.end));
      const highlightRange = viewer.timeline.addHighlightRange(Color.BLUE, 100, 0);
      highlightRange.setRange(startJulian, endJulian);

      // Add click functionality to focus on satellite when pass is clicked
      if (satelliteName && highlightRange._element) {
        highlightRange._element.style.cursor = 'pointer';
        highlightRange._element.title = `Click to track ${satelliteName} during this pass`;

        // Remove any existing click listeners
        if (highlightRange._clickListener) {
          highlightRange._element.removeEventListener('click', highlightRange._clickListener);
        }

        // Add click listener to track the satellite
        highlightRange._clickListener = () => {
          // Find the satellite entity by name and track it
          const entities = viewer.entities.values;
          const satelliteEntity = entities.find(entity =>
            entity.name && entity.name.includes(satelliteName) && entity.name.includes('Point')
          );

          if (satelliteEntity) {
            viewer.trackedEntity = satelliteEntity;
            console.log(`Tracking ${satelliteName} - pass clicked`);
          }
        };

        highlightRange._element.addEventListener('click', highlightRange._clickListener);
      }

      viewer.timeline.updateFromClock();
      viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
    });
  }

  static updateHighlightRanges(viewer, ranges, satelliteName) {
    this.clearHighlightRanges(viewer);
    this.addHighlightRanges(viewer, ranges, satelliteName);
  }
}
