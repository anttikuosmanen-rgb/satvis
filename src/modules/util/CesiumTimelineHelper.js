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
          console.log(`Pass clicked for satellite: ${satelliteName}`);

          // Find the satellite entity by name and track it
          const entities = viewer.entities.values;
          console.log(`Total entities: ${entities.length}`);

          // Debug: log all satellite-related entities
          const satelliteEntities = entities.filter(entity =>
            entity.name && entity.name.includes(satelliteName)
          );
          console.log(`Entities for ${satelliteName}:`, satelliteEntities.map(e => e.name));

          // Try to find the main satellite entity (usually the Point component)
          let satelliteEntity = entities.find(entity =>
            entity.name && entity.name.includes(satelliteName) && entity.name.includes('Point')
          );

          // If not found with "Point", try the first entity with the satellite name
          if (!satelliteEntity && satelliteEntities.length > 0) {
            satelliteEntity = satelliteEntities[0];
          }

          if (satelliteEntity) {
            console.log(`Found entity to track: ${satelliteEntity.name}`);

            // Force clear tracking and camera
            viewer.trackedEntity = null;
            viewer.selectedEntity = null;

            // Also try to trigger tracking through the satellite manager
            // This should ensure proper satellite switching
            if (window.cc && window.cc.sats) {
              try {
                const satManager = window.cc.sats;
                console.log(`Tracking satellite through manager: ${satelliteName}`);
                satManager.trackedSatellite = satelliteName;
              } catch (error) {
                console.warn('Could not use satellite manager:', error);
              }
            }

            // Small delay to ensure the selection is processed
            setTimeout(() => {
              viewer.trackedEntity = satelliteEntity;
              console.log(`Now tracking: ${satelliteEntity.name}`);
            }, 100);
          } else {
            console.warn(`Could not find satellite entity for ${satelliteName}`);
            console.log('All available entities:', entities.map(e => e.name).filter(n => n));
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
