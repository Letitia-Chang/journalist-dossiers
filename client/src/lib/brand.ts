/**
 * Brand theming. The app's palette is a set of CSS variables (--brand-50 … --brand-900,
 * stored as "r g b" triplets so Tailwind opacity modifiers keep working). Given one
 * brand color we derive the whole scale and set the variables at runtime.
 */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

// The given color is the 600 shade; lighter shades mix toward white, darker toward black.
const STEPS: Record<number, { toward: 'white' | 'black'; t: number }> = {
  50: { toward: 'white', t: 0.92 }, 100: { toward: 'white', t: 0.84 }, 200: { toward: 'white', t: 0.68 },
  300: { toward: 'white', t: 0.5 }, 400: { toward: 'white', t: 0.28 }, 500: { toward: 'white', t: 0.12 },
  600: { toward: 'white', t: 0 }, 700: { toward: 'black', t: 0.14 }, 800: { toward: 'black', t: 0.3 }, 900: { toward: 'black', t: 0.44 },
};

export function brandScale(hex: string): Record<number, string> | null {
  const base = hexToRgb(hex);
  if (!base) return null;
  const out: Record<number, string> = {};
  for (const [shade, { toward, t }] of Object.entries(STEPS)) {
    const [r, g, b] = mix(base, toward === 'white' ? WHITE : BLACK, t);
    out[Number(shade)] = `${r} ${g} ${b}`;
  }
  return out;
}

export function applyBrandColor(hex: string): void {
  const scale = brandScale(hex);
  if (!scale) return;
  const root = document.documentElement.style;
  for (const [shade, triplet] of Object.entries(scale)) root.setProperty(`--brand-${shade}`, triplet);
}
