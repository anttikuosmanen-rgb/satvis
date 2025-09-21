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

          // Try different naming patterns to find the satellite entity
          let satelliteEntity = entities.find(entity =>
            entity.name && entity.name.includes(satelliteName) && entity.name.includes('Point')
          );

          // If not found with "Point", try just the satellite name
          if (!satelliteEntity) {
            satelliteEntity = entities.find(entity =>
              entity.name && entity.name === satelliteName
            );
          }

          // If still not found, try partial match
          if (!satelliteEntity) {
            satelliteEntity = entities.find(entity =>
              entity.name && entity.name.includes(satelliteName)
            );
          }

          if (satelliteEntity) {
            // First clear any existing tracking to ensure clean switch
            viewer.trackedEntity = undefined;

            // Small delay to ensure the untracking is processed
            setTimeout(() => {
              viewer.trackedEntity = satelliteEntity;
              console.log(`Tracking ${satelliteName} - pass clicked (entity: ${satelliteEntity.name})`);
            }, 50);
          } else {
            console.warn(`Could not find satellite entity for ${satelliteName}`);
            console.log('Available entities:', entities.map(e => e.name).filter(n => n));
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
