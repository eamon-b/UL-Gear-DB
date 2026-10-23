export type Unit = 'g' | 'oz' | 'lb';
export const G_PER_OZ = 28.3495;
export const G_PER_LB = 453.592;

export function toUnit(g: number, u: Unit) {
  return u === 'g' ? g : u === 'oz' ? g / G_PER_OZ : g / G_PER_LB;
}
export function fromUnit(v: number, u: Unit) {
  return u === 'g' ? v : u === 'oz' ? v * G_PER_OZ : v * G_PER_LB;
}
export function fmtW(g: number | null | undefined, u: Unit, withUnit = true) {
  if (g == null || !Number.isFinite(g)) return '–';
  const v = toUnit(g, u);
  let s: string;
  if (u === 'g') s = Math.abs(v) >= 10000 ? (v / 1000).toFixed(2) + (withUnit ? ' kg' : '') : Math.round(v).toLocaleString('en-US');
  else if (u === 'oz') s = v.toFixed(Math.abs(v) < 10 ? 2 : 1);
  else s = v.toFixed(2);
  if (u === 'g' && Math.abs(v) >= 10000) return s;
  return withUnit ? `${s} ${u}` : s;
}
/** signed delta */
export function fmtDW(g: number, u: Unit) {
  const s = fmtW(Math.abs(g), u);
  return (g > 0 ? '+' : g < 0 ? '−' : '±') + s;
}
