// Mock for @vue/devtools-kit to prevent localStorage.getItem errors in tests
export const setupDevtoolsPlugin = () => {};
export const devtools = {};
export default { setupDevtoolsPlugin, devtools };
