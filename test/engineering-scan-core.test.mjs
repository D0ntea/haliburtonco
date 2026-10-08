import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHeightMap,
  calibrateScale,
  convertLength,
  distanceBetween,
  heightMapToCsv,
  measurementToCsv,
  summarizeHeightMap,
} from "../src/scripts/engineering-scan-core.mjs";

test("converts millimeters and inches without losing the round trip", () => {
  const inches = convertLength(25.4, "mm", "in");
  assert.equal(inches, 1);
  assert.equal(convertLength(inches, "in", "mm"), 25.4);
  assert.throws(() => convertLength(1, "cm", "mm"), /Unsupported unit/);
});

test("recovers metric scale from a known reference", () => {
  const calibration = calibrateScale(50, 42.5, 0.05);
  assert.equal(calibration.factor, 50 / 42.5);
  assert.equal(calibration.referenceMm, 50);
  assert.equal(calibration.uncertaintyMm, 0.05);
  assert.throws(() => calibrateScale(50, 0, 0.05), /greater than zero/);
});

test("measures 3D point distance with the current scale", () => {
  const pointA = { x: 0, y: 0, z: 0 };
  const pointB = { x: 3, y: 4, z: 12 };
  assert.equal(distanceBetween(pointA, pointB, 2), 26);
});

test("builds a signed height map and preserves missing cells", () => {
  const map = buildHeightMap({
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
    columns: 3,
    rows: 3,
    sample: (x, y) => (x === 1 && y === 1 ? null : x >= 1 ? 2 : 0),
  });

  assert.equal(map.cells.length, 9);
  assert.deepEqual(map.cells[4], {
    x: 1,
    y: 1,
    height: null,
    valid: false,
    reason: "no_intersection",
  });
  assert.deepEqual(summarizeHeightMap(map), {
    validCount: 8,
    missingCount: 1,
    minimum: 0,
    maximum: 2,
    mean: 1.25,
  });
});

test("exports engineering CSV with validity and units", () => {
  const map = buildHeightMap({
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0 },
    columns: 2,
    rows: 1,
    sample: (x) => (x === 0 ? 0 : null),
  });
  const csv = heightMapToCsv(map, "mm");
  assert.match(csv, /^x_mm,y_mm,height_mm,valid,reason/m);
  assert.match(csv, /0,0,0,true,/);
  assert.match(csv, /1,0,,false,no_intersection/);

  const measurementCsv = measurementToCsv([
    { id: "M-001", distanceMm: 25.4, status: "Unvalidated" },
  ], "in");
  assert.match(measurementCsv, /^id,distance_in,status/m);
  assert.match(measurementCsv, /M-001,1,Unvalidated/);
});

test("reports an entirely missing sample region", () => {
  const map = buildHeightMap({
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    columns: 1,
    rows: 1,
    sample: () => undefined,
  });
  assert.deepEqual(summarizeHeightMap(map), {
    validCount: 0,
    missingCount: 1,
    minimum: null,
    maximum: null,
    mean: null,
  });
});

test("rejects invalid height grids and export units", () => {
  assert.throws(() => buildHeightMap({
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    columns: 0,
    rows: 2,
    sample: () => 0,
  }), /positive integers/);
  assert.throws(() => heightMapToCsv({ cells: [] }, "cm"), /Unsupported unit/);
  assert.throws(() => measurementToCsv([], "cm"), /Unsupported unit/);
});
