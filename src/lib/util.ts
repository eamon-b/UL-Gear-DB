export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function loadLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode */
  }
}

/** Only http(s) links are rendered: list data can come from share links and CSVs, so `javascript:` etc. must not reach an href. */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const p = new URL(u.trim());
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : null;
  } catch {
    return null;
  }
}

export const fmtPrice = (p: number | null | undefined, digits = 0) =>
  p == null ? '–' : '$' + p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function humanizeKey(k: string) {
  const map: Record<string, string> = {
    r_value: 'R-value', volume_l: 'Volume (L)', max_load_lb: 'Max load (lb)', temp_rating_f: 'Temp (°F)',
    fill_power: 'Fill power', fill_weight_g: 'Fill wt (g)', length_in: 'Length (in)', width_in: 'Width (in)',
    thickness_in: 'Thick (in)', output_btu: 'BTU', boil_time_min: 'Boil (min)', capacity_ml: 'Cap. (ml)',
    flow_rate_lpm: 'Flow (L/min)', pore_size_micron: 'Pore (µm)', lifespan_l: 'Lifespan (L)', capacity_l: 'Cap. (L)',
    waterproof_rating_mm: 'Waterproof (mm)', gsm: 'GSM', drop_mm: 'Drop (mm)', stack_mm: 'Stack (mm)',
    runtime_hr: 'Runtime (h)', capacity_mah: 'mAh', output_w: 'Output (W)', collapsed_length_in: 'Collapsed (in)',
    two_way: '2-way', pit_zips: 'Pit zips', removes_viruses: 'Viruses',
  };
  if (map[k]) return map[k];
  const s = k.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function download(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
