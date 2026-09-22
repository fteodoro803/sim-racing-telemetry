// Tyre-temperature-to-colour zones for the Tyres widget (D26 in DECISIONS.md).
//
// GT7 gives a surface temperature per tyre but no ideal window (GT7_TELEMETRY.md), so these
// thresholds are a placeholder, not calibrated against real data - revisit once real sessions show
// what temperatures this project's cars actually reach.

const COLD_MAX = 70;      // below this: hasn't come up to temperature
const OPTIMAL_MAX = 90;   // 70-90 C: the assumed working range
const HOT_MAX = 105;      // 90-105 C: getting hot; above that, overheating

/** Which temperature zone a tyre reading falls into ('cold', 'optimal', 'hot' or 'overheating'), or null. */
export function tyreZone(tempC) {
  if (tempC == null || !isFinite(tempC)) return null;
  if (tempC < COLD_MAX) return 'cold';
  if (tempC < OPTIMAL_MAX) return 'optimal';
  if (tempC < HOT_MAX) return 'hot';
  return 'overheating';
}
