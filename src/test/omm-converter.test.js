import { describe, test, expect } from "vitest";
import * as satellitejs from "satellite.js";
import { decodeAlpha5, encodeAlpha5, isOmmText, ommTextToTles, ommToTle, parseOmm, placeholderCatalogNumber } from "../modules/util/OmmConverter.js";
import Orbit from "../modules/Orbit";

// Real CelesTrak SupGP CSV rows (2026-09-29) with the TLEs CelesTrak served for the same data
const CSV_HEADER =
  "OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT,RMS,DATA_SOURCE";
const CSV_STARLINK_2606 =
  "STARLINK-2606,2021-038AK,2026-09-29T07:45:42.000019,15.31702978,.000124,53.1571,117.8503,105.0679,184.2086,0,C,48386,272,1,-.21121E-3,-.65675E-4,0,0.269,SpaceX-E";
const CSV_STARLINK_3068 =
  "STARLINK-3068,2021-082AA,2026-09-29T08:03:42.000019,14.97508869,.000256,69.9992,122.4133,269.0914,172.6485,0,C,49154,272,1,.25342E-3,.29605E-4,0,0.288,SpaceX-E";
const CSV_STARLINK_38128 =
  "STARLINK-38128,2026-160A,2026-09-29T09:43:41.999981,15.42456401,.0003323,69.9994,170.8340,273.6876,179.4318,0,C,100001,272,1,-.56082E-1,-.23408E-1,0,0.244,SpaceX-E";
const CSV_TEMPORARY_CATNR =
  "STARLINK-40083,2026-225A,2026-09-29T09:43:41.999981,15.42456401,.0003323,69.9994,170.8340,273.6876,179.4318,0,C,799501648,272,1,-.56082E-1,-.23408E-1,0,0.244,SpaceX-E";

const TLE_STARLINK_2606 = [
  "STARLINK-2606",
  "1 48386C 21038AK  26272.32340278 -.00006568  00000+0 -21121-3 0  2721",
  "2 48386  53.1571 117.8503 0001240 105.0679 184.2086 15.31702978    16",
].join("\n");
const TLE_STARLINK_3068 = [
  "STARLINK-3068",
  "1 49154C 21082AA  26272.33590278  .00002961  00000+0  25342-3 0  2722",
  "2 49154  69.9992 122.4133 0002560 269.0914 172.6485 14.97508869    10",
].join("\n");

describe("OmmConverter", () => {
  describe("Alpha-5 catalog numbers", () => {
    test.each([
      [694, "00694"],
      [25544, "25544"],
      [99999, "99999"],
      [100000, "A0000"],
      [100001, "A0001"],
      [179999, "H9999"],
      [180000, "J0000"], // I is skipped
      [230000, "P0000"], // O is skipped
      [339999, "Z9999"],
    ])("encodes %i as %s and decodes back", (catnr, field) => {
      expect(encodeAlpha5(catnr)).toBe(field);
      expect(decodeAlpha5(field)).toBe(String(catnr));
    });

    test("decodes space-padded catalog fields", () => {
      expect(decodeAlpha5("  694")).toBe("694");
    });

    test("rejects catalog numbers beyond Alpha-5 range", () => {
      expect(() => encodeAlpha5(340000)).toThrow(RangeError);
      expect(() => encodeAlpha5(799501648)).toThrow(RangeError);
    });
  });

  describe("isOmmText", () => {
    test("detects CSV and JSON OMM data", () => {
      expect(isOmmText(`${CSV_HEADER}\n${CSV_STARLINK_2606}`)).toBe(true);
      expect(isOmmText('[{"OBJECT_NAME":"ISS"}]')).toBe(true);
      expect(isOmmText('\n{"OBJECT_NAME":"ISS"}')).toBe(true);
    });

    test("does not treat TLE data as OMM", () => {
      expect(isOmmText(TLE_STARLINK_2606)).toBe(false);
    });
  });

  describe("ommToTle", () => {
    test("produces the same TLE as CelesTrak", () => {
      const records = parseOmm(`${CSV_HEADER}\n${CSV_STARLINK_2606}\n${CSV_STARLINK_3068}\n`);
      expect(ommToTle(records[0])).toBe(TLE_STARLINK_2606);
      // Mean motion dot .29605E-4 must round half-up to .00002961
      expect(ommToTle(records[1])).toBe(TLE_STARLINK_3068);
    });

    test("converts JSON records the same way as CSV records", () => {
      const [csvRecord] = parseOmm(`${CSV_HEADER}\n${CSV_STARLINK_2606}`);
      const json = JSON.stringify([
        {
          ...csvRecord,
          MEAN_MOTION: 15.31702978,
          ECCENTRICITY: 0.000124,
          NORAD_CAT_ID: 48386,
          BSTAR: -0.00021121,
          MEAN_MOTION_DOT: -0.000065675,
          MEAN_MOTION_DDOT: 0,
        },
      ]);
      expect(ommTextToTles(json)).toEqual([TLE_STARLINK_2606]);
    });

    test("encodes 6-digit catalog numbers as Alpha-5 and produces a propagatable TLE", () => {
      const [record] = parseOmm(`${CSV_HEADER}\n${CSV_STARLINK_38128}`);
      const [name, line1, line2] = ommToTle(record).split("\n");

      expect(name).toBe("STARLINK-38128");
      expect(line1).toHaveLength(69);
      expect(line2).toHaveLength(69);
      expect(line1.slice(0, 8)).toBe("1 A0001C");
      expect(line2.slice(0, 7)).toBe("2 A0001");

      const satrec = satellitejs.twoline2satrec(line1, line2);
      expect(satrec.error).toBe(0);
      expect(satellitejs.propagate(satrec, new Date("2026-09-29T12:00:00Z")).position).toBeTruthy();
    });

    test("pads the international designator and omits it when missing", () => {
      const [record] = parseOmm(`${CSV_HEADER}\n${CSV_STARLINK_38128}`);
      expect(ommToTle(record).split("\n")[1].slice(9, 17)).toBe("26160A  ");
      expect(
        ommToTle({ ...record, OBJECT_ID: "" })
          .split("\n")[1]
          .slice(9, 17),
      ).toBe("        ");
    });
  });

  describe("ommTextToTles", () => {
    test("maps temporary catalog numbers to stable placeholder numbers", () => {
      const tles = ommTextToTles(`${CSV_HEADER}\n${CSV_STARLINK_2606}\n${CSV_TEMPORARY_CATNR}\n`);
      expect(tles).toHaveLength(2);
      expect(tles[0]).toBe(TLE_STARLINK_2606);
      // 799501648 -> 330000 + 1648 = 331648 = "Z1648"
      const [name, line1, line2] = tles[1].split("\n");
      expect(name).toBe("STARLINK-40083");
      expect(line1.slice(0, 7)).toBe("1 Z1648");
      expect(line2.slice(0, 7)).toBe("2 Z1648");
      expect(placeholderCatalogNumber(799501648)).toBe(331648);
      expect(decodeAlpha5("Z1648")).toBe("331648");
      const satrec = satellitejs.twoline2satrec(line1, line2);
      expect(satrec.error).toBe(0);
    });

    test("skips records that cannot be represented when placeholders are disabled", () => {
      const skipped = [];
      const tles = ommTextToTles(`${CSV_HEADER}\n${CSV_STARLINK_2606}\n${CSV_TEMPORARY_CATNR}\n`, (record) => skipped.push(record.OBJECT_NAME), {
        placeholderCatalogNumbers: false,
      });
      expect(tles).toEqual([TLE_STARLINK_2606]);
      expect(skipped).toEqual(["STARLINK-40083"]);
    });

    test("returns no TLEs for an empty CSV", () => {
      expect(ommTextToTles(`${CSV_HEADER}\n`)).toEqual([]);
    });
  });

  describe("Orbit integration", () => {
    test("reports decoded catalog number for Alpha-5 TLEs", () => {
      const [record] = parseOmm(`${CSV_HEADER}\n${CSV_STARLINK_38128}`);
      const orbit = new Orbit("STARLINK-38128", ommToTle(record));
      expect(orbit.satnum).toBe("100001");
    });

    test("reports catalog number for regular TLEs", () => {
      const orbit = new Orbit("STARLINK-2606", TLE_STARLINK_2606);
      expect(orbit.satnum).toBe("48386");
    });
  });
});
