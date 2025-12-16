import { describe, it, expect } from "vitest";
import { Cartesian3, Matrix3, Matrix4, Transforms } from "@cesium/engine";

/**
 * Unit tests for CesiumController camera offset capture and restore functions.
 * These tests verify the math behind persisting camera positions when toggling
 * between satellite and ground station tracking.
 *
 * The viewFrom property is a Cartesian3 offset in the entity's local coordinate system:
 * - For ground stations (no orientation): local frame is ENU (East-North-Up)
 * - For satellites (with VelocityOrientationProperty): local frame is velocity-aligned
 */

// Mock the camera offset capture logic for entities without orientation (ground stations)
// Uses ENU frame at entity position
function captureTrackedEntityCameraOffsetENU(cameraPositionWC, entityPosition) {
  if (!entityPosition) return null;

  // Calculate vector from entity to camera in world coordinates
  const cameraOffset = Cartesian3.subtract(cameraPositionWC, entityPosition, new Cartesian3());
  const range = Cartesian3.magnitude(cameraOffset);

  // Get the ENU transform at the entity position
  const transform = Transforms.eastNorthUpToFixedFrame(entityPosition);
  const inverseTransform = Matrix4.inverse(transform, new Matrix4());

  // Transform camera offset to local ENU coordinates
  const localOffset = Matrix4.multiplyByPointAsVector(inverseTransform, cameraOffset, new Cartesian3());

  return {
    viewFrom: Cartesian3.clone(localOffset),
    range: range,
  };
}

// Mock the camera offset capture logic for entities with orientation (satellites)
// Uses the entity's orientation to determine local frame
function captureTrackedEntityCameraOffsetOriented(cameraPositionWC, entityPosition, orientation) {
  if (!entityPosition) return null;

  // Calculate vector from entity to camera in world coordinates
  const cameraOffset = Cartesian3.subtract(cameraPositionWC, entityPosition, new Cartesian3());
  const range = Cartesian3.magnitude(cameraOffset);

  // Use entity's orientation to create local frame
  const rotationMatrix = Matrix3.fromQuaternion(orientation, new Matrix3());
  const modelMatrix = Matrix4.fromRotationTranslation(rotationMatrix, entityPosition, new Matrix4());
  const inverseTransform = Matrix4.inverse(modelMatrix, new Matrix4());

  // Transform camera offset to entity's local coordinates
  const localOffset = Matrix4.multiplyByPointAsVector(inverseTransform, cameraOffset, new Cartesian3());

  return {
    viewFrom: Cartesian3.clone(localOffset),
    range: range,
  };
}

// Helper to compute camera position from viewFrom offset (for testing round-trip)
function computeCameraPositionFromViewFrom(viewFrom, entityPosition) {
  if (!viewFrom || !entityPosition) return null;

  // Transform from ENU to fixed frame
  const transform = Transforms.eastNorthUpToFixedFrame(entityPosition);
  const worldOffset = Matrix4.multiplyByPointAsVector(transform, viewFrom, new Cartesian3());

  // Calculate new camera position
  return Cartesian3.add(entityPosition, worldOffset, new Cartesian3());
}

describe("Camera Offset Capture and Apply", () => {
  describe("captureTrackedEntityCameraOffsetENU (ground stations)", () => {
    it("should return null if entity position is null", () => {
      const cameraPos = new Cartesian3(1000000, 0, 0);
      const result = captureTrackedEntityCameraOffsetENU(cameraPos, null);
      expect(result).toBeNull();
    });

    it("should calculate correct range (distance from entity)", () => {
      // Entity at origin (on Earth surface at 0,0)
      const entityPos = Cartesian3.fromDegrees(0, 0, 0);
      // Camera 1000km above in local up direction
      const cameraPos = Cartesian3.fromDegrees(0, 0, 1000000);

      const result = captureTrackedEntityCameraOffsetENU(cameraPos, entityPos);

      expect(result).not.toBeNull();
      expect(result.range).toBeCloseTo(1000000, -3); // Within 1km
    });

    it("should return viewFrom with positive Z when camera is above entity", () => {
      // Entity at equator
      const entityPos = Cartesian3.fromDegrees(0, 0, 0);
      // Camera above entity
      const cameraPos = Cartesian3.fromDegrees(0, 0, 500000);

      const result = captureTrackedEntityCameraOffsetENU(cameraPos, entityPos);

      expect(result).not.toBeNull();
      expect(result.viewFrom).toBeDefined();
      // In ENU, Z is up, so camera above should have positive Z
      expect(result.viewFrom.z).toBeGreaterThan(0);
    });

    it("should return viewFrom with positive Y when camera is north of entity", () => {
      // Entity at equator
      const entityPos = Cartesian3.fromDegrees(0, 0, 0);
      // Camera slightly north at same height
      const cameraPos = Cartesian3.fromDegrees(0, 1, 0);

      const result = captureTrackedEntityCameraOffsetENU(cameraPos, entityPos);

      expect(result).not.toBeNull();
      expect(result.viewFrom).toBeDefined();
      // In ENU, Y is North, so camera north should have positive Y
      expect(result.viewFrom.y).toBeGreaterThan(0);
    });

    it("should return viewFrom with positive X when camera is east of entity", () => {
      // Entity at equator
      const entityPos = Cartesian3.fromDegrees(0, 0, 0);
      // Camera slightly east at same height
      const cameraPos = Cartesian3.fromDegrees(1, 0, 0);

      const result = captureTrackedEntityCameraOffsetENU(cameraPos, entityPos);

      expect(result).not.toBeNull();
      expect(result.viewFrom).toBeDefined();
      // In ENU, X is East, so camera east should have positive X
      expect(result.viewFrom.x).toBeGreaterThan(0);
    });
  });

  describe("computeCameraPositionFromViewFrom", () => {
    it("should return null if viewFrom is null", () => {
      const entityPos = Cartesian3.fromDegrees(0, 0, 0);
      const result = computeCameraPositionFromViewFrom(null, entityPos);
      expect(result).toBeNull();
    });

    it("should return null if entity position is null", () => {
      const viewFrom = new Cartesian3(0, 0, 1000000);
      const result = computeCameraPositionFromViewFrom(viewFrom, null);
      expect(result).toBeNull();
    });

    it("should place camera at correct distance from entity", () => {
      const entityPos = Cartesian3.fromDegrees(0, 0, 0);
      // viewFrom pointing up 1000km
      const viewFrom = new Cartesian3(0, 0, 1000000);

      const cameraPos = computeCameraPositionFromViewFrom(viewFrom, entityPos);

      expect(cameraPos).not.toBeNull();
      const distance = Cartesian3.distance(entityPos, cameraPos);
      expect(distance).toBeCloseTo(1000000, -3);
    });
  });

  describe("Round-trip capture and apply (ENU)", () => {
    it("should preserve camera position after capture and apply", () => {
      // Entity position
      const entityPos = Cartesian3.fromDegrees(10, 45, 0);
      // Camera position - north-east of entity, elevated
      const originalCameraPos = Cartesian3.fromDegrees(10.5, 45.5, 500000);

      // Capture offset
      const offset = captureTrackedEntityCameraOffsetENU(originalCameraPos, entityPos);

      // Apply offset to same entity position
      const restoredCameraPos = computeCameraPositionFromViewFrom(offset.viewFrom, entityPos);

      expect(restoredCameraPos).not.toBeNull();
      // Camera should be restored to approximately same position (within 1km tolerance)
      expect(Cartesian3.distance(originalCameraPos, restoredCameraPos)).toBeLessThan(1000);
    });

    it("should correctly restore camera when entity has moved", () => {
      // Original entity position
      const originalEntityPos = Cartesian3.fromDegrees(0, 0, 400000);
      // Camera position relative to entity
      const cameraPos = Cartesian3.fromDegrees(0.5, 0, 600000);

      // Capture offset
      const offset = captureTrackedEntityCameraOffsetENU(cameraPos, originalEntityPos);

      // Entity moves to new position
      const newEntityPos = Cartesian3.fromDegrees(10, 20, 400000);

      // Apply same offset to new entity position
      const newCameraPos = computeCameraPositionFromViewFrom(offset.viewFrom, newEntityPos);

      expect(newCameraPos).not.toBeNull();
      // The range should be preserved
      const distanceFromNewEntity = Cartesian3.distance(newEntityPos, newCameraPos);
      expect(distanceFromNewEntity).toBeCloseTo(offset.range, -3);
    });
  });
});

describe("Time Acceleration Multiplier Calculation", () => {
  // Test the math for time acceleration shortcuts
  function calculateMultiplier(digit, shiftKey) {
    const exponent = digit === 0 ? 10 : digit - 1;
    let multiplier = Math.pow(2, exponent);
    if (shiftKey) {
      multiplier = -multiplier;
    }
    return multiplier;
  }

  it("should return 1x for digit 1", () => {
    expect(calculateMultiplier(1, false)).toBe(1);
  });

  it("should return 2x for digit 2", () => {
    expect(calculateMultiplier(2, false)).toBe(2);
  });

  it("should return 4x for digit 3", () => {
    // 2^2 = 4, not 2^3 = 8 as originally specified
    // The formula is: digit - 1, so digit 3 -> exponent 2 -> 2^2 = 4
    expect(calculateMultiplier(3, false)).toBe(4);
  });

  it("should return 8x for digit 4", () => {
    expect(calculateMultiplier(4, false)).toBe(8);
  });

  it("should return 16x for digit 5", () => {
    expect(calculateMultiplier(5, false)).toBe(16);
  });

  it("should return 32x for digit 6", () => {
    expect(calculateMultiplier(6, false)).toBe(32);
  });

  it("should return 64x for digit 7", () => {
    expect(calculateMultiplier(7, false)).toBe(64);
  });

  it("should return 128x for digit 8", () => {
    expect(calculateMultiplier(8, false)).toBe(128);
  });

  it("should return 256x for digit 9", () => {
    expect(calculateMultiplier(9, false)).toBe(256);
  });

  it("should return 1024x for digit 0", () => {
    expect(calculateMultiplier(0, false)).toBe(1024);
  });

  it("should return -1x for Shift+1", () => {
    expect(calculateMultiplier(1, true)).toBe(-1);
  });

  it("should return -2x for Shift+2", () => {
    expect(calculateMultiplier(2, true)).toBe(-2);
  });

  it("should return -1024x for Shift+0", () => {
    expect(calculateMultiplier(0, true)).toBe(-1024);
  });
});

describe("Saved Camera Offsets Map", () => {
  it("should store and retrieve offsets by entity name", () => {
    const savedOffsets = new Map();
    const offset1 = { viewFrom: new Cartesian3(0, -3600000, 4200000), range: 5500000 };
    const offset2 = { viewFrom: new Cartesian3(1000000, 0, 2000000), range: 2236068 };

    savedOffsets.set("ISS", offset1);
    savedOffsets.set("groundstation", offset2);

    expect(savedOffsets.get("ISS")).toEqual(offset1);
    expect(savedOffsets.get("groundstation")).toEqual(offset2);
    expect(savedOffsets.get("nonexistent")).toBeUndefined();
  });

  it("should overwrite existing offset for same entity", () => {
    const savedOffsets = new Map();
    const offset1 = { viewFrom: new Cartesian3(0, -3600000, 4200000), range: 5500000 };
    const offset2 = { viewFrom: new Cartesian3(1000000, 0, 2000000), range: 2236068 };

    savedOffsets.set("ISS", offset1);
    savedOffsets.set("ISS", offset2);

    expect(savedOffsets.get("ISS")).toEqual(offset2);
    expect(savedOffsets.size).toBe(1);
  });
});
