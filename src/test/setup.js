/**
 * Vitest test setup file
 * Handles global test configuration and error handling
 */

import { vi } from "vitest";

// Stub localStorage globally before any imports that might use it
vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  length: 0,
});

// Suppress unhandled promise rejections from astronomy-engine network requests
// These are typically from the astronomy-engine library trying to fetch data
// but failing in the test environment (no network access, missing cache, etc.)
const originalUnhandledRejection = process.listeners("unhandledRejection");

process.removeAllListeners("unhandledRejection");

process.on("unhandledRejection", (reason, promise) => {
  // Check if this is a RequestErrorEvent from astronomy-engine or similar libraries
  if (reason && (reason.constructor?.name === "RequestErrorEvent" || reason.type === "RequestErrorEvent")) {
    // Silently ignore these errors - they're from astronomy-engine network requests
    // that fail in CI but don't affect test results
    console.warn("[Test Setup] Suppressed RequestErrorEvent from astronomy-engine");
    return;
  }

  // For other unhandled rejections, call the original handler
  originalUnhandledRejection.forEach((handler) => {
    handler(reason, promise);
  });
});
