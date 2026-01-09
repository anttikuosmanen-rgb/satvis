// Global setup that runs before vitest starts
// This is for one-time setup before all tests

export default function () {
  // Mock localStorage for tests
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}
