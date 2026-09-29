// The converter lives next to update-tle.js so the data update script also works
// from the deployed dist/data/tle directory, where src/ is not available.
export { decodeAlpha5, encodeAlpha5, isOmmText, ommTextToTles, ommToTle, parseOmm } from "../../../data/tle/OmmConverter";
