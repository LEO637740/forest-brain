/** Adapted from dgreenheck/tidewater src/util/Noise.js (retrieved 2026-09-24).
 * Copyright (c) 2026 DRG Software Solutions LLC. MIT, see THIRD_PARTY_NOTICES.md.
 * Changes: TypeScript fields/signatures; retain only mulberry32, noise and fbm.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class Noise2D {
  perm: Uint8Array;
  grad: Float32Array;
  constructor(seed = 1) {
    const rand = mulberry32(seed), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(512);
    for (let i = 0; i < 256; i++) {
      const a = rand() * Math.PI * 2;
      this.grad[i * 2] = Math.cos(a); this.grad[i * 2 + 1] = Math.sin(a);
    }
  }
  noise(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255, perm = this.perm, g = this.grad;
    const h00 = perm[X + perm[Y]], h10 = perm[X + 1 + perm[Y]];
    const h01 = perm[X + perm[Y + 1]], h11 = perm[X + 1 + perm[Y + 1]];
    const d00 = g[h00 * 2] * xf + g[h00 * 2 + 1] * yf;
    const d10 = g[h10 * 2] * (xf - 1) + g[h10 * 2 + 1] * yf;
    const d01 = g[h01 * 2] * xf + g[h01 * 2 + 1] * (yf - 1);
    const d11 = g[h11 * 2] * (xf - 1) + g[h11 * 2 + 1] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u, b = d01 + (d11 - d01) * u;
    return (a + (b - a) * v) * 1.414;
  }
  fbm(x: number, y: number, octaves = 3, lacunarity = 2, gain = .5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq + i * 17.13, y * freq - i * 9.71) * amp;
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }
}
