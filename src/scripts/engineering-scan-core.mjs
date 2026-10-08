const MILLIMETERS_PER_INCH = 25.4;

function assertFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

export function convertLength(value, fromUnit, toUnit) {
  assertFinite(value, "Length");
  const supported = new Set(["mm", "in"]);
  if (!supported.has(fromUnit) || !supported.has(toUnit)) {
    throw new RangeError(`Unsupported unit conversion: ${fromUnit} to ${toUnit}.`);
  }
  if (fromUnit === toUnit) return value;
  return fromUnit === "mm" ? value / MILLIMETERS_PER_INCH : value * MILLIMETERS_PER_INCH;
}

export function calibrateScale(referenceMm, measuredSceneUnits, uncertaintyMm = 0) {
  [referenceMm, measuredSceneUnits].forEach((value, index) => {
    assertFinite(value, index === 0 ? "Reference length" : "Measured length");
    if (value <= 0) throw new RangeError("Reference and measured lengths must be greater than zero.");
  });
  assertFinite(uncertaintyMm, "Reference uncertainty");
  if (uncertaintyMm < 0) throw new RangeError("Reference uncertainty cannot be negative.");
  return {
    factor: referenceMm / measuredSceneUnits,
    referenceMm,
    uncertaintyMm,
  };
}

export function distanceBetween(pointA, pointB, scale = 1) {
  assertFinite(scale, "Scale");
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const dz = pointB.z - pointA.z;
  return Math.hypot(dx, dy, dz) * scale;
}

function axisValue(minimum, maximum, index, count) {
  return count === 1 ? minimum : minimum + ((maximum - minimum) * index) / (count - 1);
}

export function buildHeightMap({ bounds, columns, rows, sample }) {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError("Height-map rows and columns must be positive integers.");
  }
  if (typeof sample !== "function") throw new TypeError("A height sampler is required.");

  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const y = axisValue(bounds.minY, bounds.maxY, row, rows);
    for (let column = 0; column < columns; column += 1) {
      const x = axisValue(bounds.minX, bounds.maxX, column, columns);
      const sampled = sample(x, y);
      const height = Number.isFinite(sampled) ? sampled : null;
      cells.push({
        x,
        y,
        height,
        valid: height !== null,
        reason: height === null ? "no_intersection" : "",
      });
    }
  }
  return { bounds: { ...bounds }, columns, rows, cells };
}

export function summarizeHeightMap(map) {
  const heights = map.cells.filter((cell) => cell.valid).map((cell) => cell.height);
  if (heights.length === 0) {
    return { validCount: 0, missingCount: map.cells.length, minimum: null, maximum: null, mean: null };
  }
  return {
    validCount: heights.length,
    missingCount: map.cells.length - heights.length,
    minimum: Math.min(...heights),
    maximum: Math.max(...heights),
    mean: heights.reduce((sum, value) => sum + value, 0) / heights.length,
  };
}

function csvNumber(value) {
  if (value === null || value === undefined) return "";
  return Number(value.toFixed(6)).toString();
}

export function heightMapToCsv(map, unit = "mm") {
  if (!new Set(["mm", "in"]).has(unit)) throw new RangeError(`Unsupported unit: ${unit}.`);
  const scale = unit === "mm" ? 1 : 1 / MILLIMETERS_PER_INCH;
  const rows = map.cells.map((cell) => [
    csvNumber(cell.x * scale),
    csvNumber(cell.y * scale),
    cell.valid ? csvNumber(cell.height * scale) : "",
    String(cell.valid),
    cell.reason,
  ].join(","));
  return [`x_${unit},y_${unit},height_${unit},valid,reason`, ...rows].join("\n");
}

export function measurementToCsv(measurements, unit = "mm") {
  if (!new Set(["mm", "in"]).has(unit)) throw new RangeError(`Unsupported unit: ${unit}.`);
  const rows = measurements.map((measurement) => [
    measurement.id,
    csvNumber(convertLength(measurement.distanceMm, "mm", unit)),
    measurement.status,
  ].join(","));
  return [`id,distance_${unit},status`, ...rows].join("\n");
}
