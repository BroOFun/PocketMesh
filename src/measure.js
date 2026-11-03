// Measurement coordinates are world-space snapshots, independent of object selection.
export function normalizeRuler(value = {}) {
  const point = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  return {
    metersPerUnit: Number.isFinite(value?.metersPerUnit) && value.metersPerUnit > 0 ? value.metersPerUnit : 1,
    unit: ['m', 'cm', 'mm', 'ft'].includes(value?.unit) ? value.unit : 'm',
    snap: value?.snap !== false,
    measurements: (Array.isArray(value?.measurements) ? value.measurements : []).filter((m) => point(m?.a) && point(m?.b)).slice(0, 200).map((m) => ({ a: m.a.slice(), b: m.b.slice() })),
  };
}
export function measurementMeters(a, b, metersPerUnit = 1) {
  return Math.hypot(...a.map((x, i) => b[i] - x)) * metersPerUnit;
}
export function formatMeasurement(meters, unit = 'm') {
  const factor = { m: 1, cm: 100, mm: 1000, ft: 1 / .3048 }[unit] || 1;
  const value = meters * factor;
  return (value !== 0 && Math.abs(value) < .001 ? value.toExponential(2) : String(+value.toFixed(3))) + ' ' + unit;
}
// Screen-space interpolation must account for perspective before snapping in 3D.
export function perspectiveEdgeParameter(screenT, clipWA, clipWB) {
  return (screenT / clipWB) / ((1 - screenT) / clipWA + screenT / clipWB);
}
