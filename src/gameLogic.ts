export type PropKind = "crate" | "bin" | "parasol" | "barrel" | "sign";

const propValues: Record<PropKind, number> = {
  crate: 100,
  bin: 125,
  parasol: 175,
  barrel: 140,
  sign: 110,
};

const wantedThresholds = [8, 20, 35, 52, 70, 88];

export function scoreForProp(kind: PropKind, combo: number): number {
  const multiplier = Math.min(8, Math.max(1, Math.floor(combo)));
  return propValues[kind] * multiplier;
}

export function nextCombo(previousCombo: number, elapsedMs: number): number {
  return elapsedMs <= 2800 ? previousCombo + 1 : 1;
}

export function wantedStars(heat: number): number {
  const boundedHeat = Math.max(0, Math.min(100, heat));
  return wantedThresholds.filter((threshold) => boundedHeat >= threshold).length;
}

export function policeCount(stars: number): number {
  return stars === 0 ? 0 : Math.min(3, Math.ceil(stars / 2));
}
