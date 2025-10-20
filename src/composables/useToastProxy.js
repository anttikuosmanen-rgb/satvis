// Toast utility for use in non-Vue contexts
// This allows CesiumController and other plain JS classes to show toast notifications

let toast = null;

export const initToastProxy = (t) => (toast = t);

export const useToastProxy = () => toast || { add: () => console.warn("Toast not initialized") };
