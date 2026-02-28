#!/usr/bin/env node

import * as https from "https";
import * as fs from "fs";
import * as process from "process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Change dir to the location of this script
process.chdir(__dirname);

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function downloadTLE(groupName) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${groupName}&FORMAT=tle`;
  const path = "groups/";
  const filename = `${groupName}.txt`;

  https.get(url, (res) => {
    const writeStream = fs.createWriteStream(path + filename);
    res.pipe(writeStream);
    writeStream.on("finish", () => {
      writeStream.close();
      console.log(`Downloaded ${filename}`);
    });
  });
}

async function downloadPrelaunchTLEs() {
  try {
    // Fetch the supplemental index page
    const indexUrl = "https://celestrak.org/NORAD/elements/supplemental/";
    const html = await fetchUrl(indexUrl);

    // Find all prelaunch entries by looking for lines with "Pre-Launch"
    // and extracting the FILE parameter from those lines
    const prelaunchFiles = new Set();
    const lines = html.split("\n");

    for (const line of lines) {
      if (line.includes("Pre-Launch")) {
        const fileMatch = line.match(/sup-gp\.php\?FILE=([^&]+)&FORMAT=tle/);
        if (fileMatch) {
          prelaunchFiles.add(fileMatch[1]);
        }
      }
    }

    const files = [...prelaunchFiles];
    if (files.length === 0) {
      console.log("No prelaunch TLEs found");
      return;
    }

    // Download each prelaunch TLE
    const tlePromises = files.map(async (file) => {
      const url = `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=${file}&FORMAT=tle`;
      return fetchUrl(url);
    });

    const tleData = await Promise.all(tlePromises);

    // Combine and write to groups/prelaunch.txt (where the app expects it)
    const combined = tleData.join("");
    fs.writeFileSync("groups/prelaunch.txt", combined);
    console.log(`Downloaded groups/prelaunch.txt (${files.length} launches)`);
  } catch (error) {
    console.error("Failed to download prelaunch TLEs:", error.message);
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

groups.forEach((group) => {
  downloadTLE(group);
});

// Also download prelaunch TLEs from supplemental data
downloadPrelaunchTLEs();
