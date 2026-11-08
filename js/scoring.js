// scoring.js — raw -> scaled (domain) -> weighted -> general estimate.
// Pure functions; takes the answer sheet's `scoring` block.

// Scaled score (50-150) for a raw number correct across BOTH chapters of a domain.
// Clamps raw to maxRaw (NITE sometimes cancels a question).
export function scaledScore(scoring, domain, rawCorrect) {
  const table = scoring?.rawToScaled?.[domain];
  if (!Array.isArray(table) || table.length === 0) return null;
  const maxRaw = scoring?.maxRaw?.[domain] ?? (table.length - 1);
  let r = Math.max(0, Math.min(rawCorrect, maxRaw, table.length - 1));
  return table[r];
}

// Weighted scores from scaled V and Q, using the formulae in the sheet
// (general "(V+Q)/2", verbalEmphasis "(3V+Q)/4", quantEmphasis "(3Q+V)/4").
export function weightedScores(V, Q) {
  return {
    twoDomain: (V + Q) / 2,
    verbalEmphasis: (3 * V + Q) / 4,
    quantEmphasis: (3 * Q + V) / 4,
  };
}

// General score (200-800) for a weighted value, by linear interpolation within
// its range in weightedToGeneral. Returns a rounded integer (an estimate).
export function generalScore(scoring, weighted) {
  const ranges = scoring?.weightedToGeneral;
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  // clamp to table bounds
  const first = ranges[0], last = ranges[ranges.length - 1];
  if (weighted <= first.weightedFrom) return first.generalFrom;
  if (weighted >= last.weightedTo) return last.generalTo;

  for (const rg of ranges) {
    if (weighted >= rg.weightedFrom && weighted <= rg.weightedTo) {
      const span = rg.weightedTo - rg.weightedFrom;
      if (span <= 0) return rg.generalFrom;
      const frac = (weighted - rg.weightedFrom) / span;
      return Math.round(rg.generalFrom + frac * (rg.generalTo - rg.generalFrom));
    }
  }
  // gap between ranges (e.g. 55.0 -> 55.5): snap to the nearer edge
  let best = null, bestDist = Infinity;
  for (const rg of ranges) {
    for (const [w, g] of [[rg.weightedFrom, rg.generalFrom], [rg.weightedTo, rg.generalTo]]) {
      const d = Math.abs(w - weighted);
      if (d < bestDist) { bestDist = d; best = g; }
    }
  }
  return best;
}

// Full estimate from raw correct in each domain.
// Returns { V, Q, weighted:{...}, general:{twoDomain, verbalEmphasis, quantEmphasis} }.
export function estimateFromRaw(scoring, rawVerbal, rawQuant) {
  const V = scaledScore(scoring, 'verbal', rawVerbal);
  const Q = scaledScore(scoring, 'quant', rawQuant);
  if (V == null || Q == null) return { V, Q, weighted: null, general: null };
  const w = weightedScores(V, Q);
  return {
    V, Q,
    weighted: w,
    general: {
      twoDomain: generalScore(scoring, w.twoDomain),
      verbalEmphasis: generalScore(scoring, w.verbalEmphasis),
      quantEmphasis: generalScore(scoring, w.quantEmphasis),
    },
  };
}
