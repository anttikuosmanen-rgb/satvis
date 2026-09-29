#!/usr/bin/env node

import * as fs from "fs";
import * as process from "process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { ommTextToTles } from "./OmmConverter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Change dir to the location of this script
process.chdir(__dirname);

const SUPPLEMENTAL_URL = "https://celestrak.org/NORAD/elements/supplemental/";

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.trim().split("\n")[0]}`);
  }
  return text;
}

/**
 * Fetch OMM data as CSV and convert it to TLEs.
 * CelesTrak does not serve TLEs for catalog numbers >= 100000, so the OMM data is
 * converted locally using Alpha-5 catalog numbers.
 */
async function fetchOmmAsTles(url, label) {
  const text = await fetchText(url);
  if (!text.trimStart().startsWith("OBJECT_NAME,")) {
    // CelesTrak answers with plain text (e.g. "No GP data found") when nothing matches
    return [];
  }
  let skipped = 0;
  const tles = ommTextToTles(text, () => skipped++);
  if (skipped > 0) {
    console.log(`${label}: skipped ${skipped} objects not representable as TLE (e.g. temporary catalog numbers)`);
  }
  return tles;
}

function writeTles(filename, tles) {
  fs.writeFileSync(`groups/${filename}`, tles.length > 0 ? `${tles.join("\n")}\n` : "");
}

async function downloadGroup(groupName) {
  const filename = `${groupName}.txt`;
  try {
    const tles = await fetchOmmAsTles(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${groupName}&FORMAT=csv`, groupName);
    if (tles.length === 0) {
      console.log(`No data for ${groupName}, keeping existing ${filename}`);
      return;
    }
    writeTles(filename, tles);
    console.log(`Downloaded ${filename} (${tles.length} satellites)`);
  } catch (error) {
    // Keep the existing file on errors, e.g. CelesTrak's 403 when data has not changed in the last 2 hours
    console.error(`Failed to download ${groupName}, keeping existing ${filename}: ${error.message}`);
  }
}

async function downloadPrelaunch() {
  try {
    // Pre-launch data sets are listed on the supplemental index page as "<Launch> Pre-Launch"
    // entries. Backup launch opportunities are listed separately and ignored here.
    const html = await fetchText(SUPPLEMENTAL_URL);
    const files = new Set();
    for (const line of html.split("\n")) {
      if (line.includes("Pre-Launch")) {
        const match = line.match(/sup-gp\.php\?FILE=([^&"]+)/);
        if (match) {
          files.add(match[1]);
        }
      }
    }

    const results = await Promise.all([...files].map((file) => fetchOmmAsTles(`${SUPPLEMENTAL_URL}sup-gp.php?FILE=${file}&FORMAT=csv`, file)));
    const tles = results.flat();
    // Always rewrite so launched missions do not linger as pre-launch satellites
    writeTles("prelaunch.txt", tles);
    console.log(files.size > 0 ? `Downloaded prelaunch.txt (${files.size} launches, ${tles.length} objects)` : "No prelaunch data available, cleared prelaunch.txt");
  } catch (error) {
    console.error(`Failed to download prelaunch data, keeping existing prelaunch.txt: ${error.message}`);
  }
}

// https://celestrak.org/NORAD/elements/
// [...document.links].filter((link) => link.href.match(/gp.php\?GROUP=/)).map((link => link.href.match(/GROUP=(?<name>.*)&FORMAT/).groups.name));
const groups = [
  "last-30-days",
  "stations",
  // "visual",
  "active",
  // "analyst",
  // "1982-092",
  // "1999-025",
  // "iridium-33-debris",
  // "cosmos-2251-debris",
  "weather",
  // "noaa",
  // "goes",
  "resource",
  // "sarsat",
  // "dmc",
  // "tdrss",
  // "argos",
  "planet",
  "spire",
  // "geo",
  // "intelsat",
  // "ses",
  // "iridium",
  "iridium-NEXT",
  "starlink",
  "oneweb",
  // "orbcomm",
  "globalstar",
  // "swarm",
  // "amateur",
  // "x-comm",
  // "other-comm",
  // "satnogs",
  // "gorizont",
  // "raduga",
  // "molniya",
  "gnss",
  // "gps-ops",
  // "glo-ops",
  // "galileo",
  // "beidou",
  // "sbas",
  // "nnss",
  // "musson",
  "science",
  // "geodetic",
  // "engineering",
  // "education",
  // "military",
  // "radar",
  "cubesat",
  // "other",
  "eutelsat",
];

await Promise.all([...groups.map((group) => downloadGroup(group)), downloadPrelaunch()]);
