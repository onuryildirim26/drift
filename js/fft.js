/* Drift — fft.js
 *
 * A radix-2 Cooley–Tukey FFT, in place, plus the 2-D wrapper Drift needs.
 * Deliberately small and dependency-free: the whole registration engine runs
 * on this file and nothing else.
 *
 * Arrays are plain Float64Array of equal length; `re` and `im` are the real
 * and imaginary parts of the same signal. Length must be a power of two —
 * callers pad first (see register.js `padToPow2`).
 */
(function (global) {
  "use strict";

  /** Largest power of two <= n. */
  function prevPow2(n) {
    let p = 1;
    while (p * 2 <= n) p *= 2;
    return p;
  }

  /** Smallest power of two >= n. */
  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  /**
   * In-place 1-D FFT. `inverse` runs the inverse transform and divides by n,
   * so fft(fft(x, false), true) returns x.
   */
  function fft1d(re, im, inverse) {
    const n = re.length;
    if (n <= 1) return;

    // Bit-reversal permutation. Walking j as a reversed counter avoids
    // computing the reversal per index.
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const ang = sign * 2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const aRe = re[i + k],        aIm = im[i + k];
          const bRe = re[i + k + half], bIm = im[i + k + half];
          const tRe = bRe * curRe - bIm * curIm;
          const tIm = bRe * curIm + bIm * curRe;
          re[i + k] = aRe + tRe;  im[i + k] = aIm + tIm;
          re[i + k + half] = aRe - tRe;  im[i + k + half] = aIm - tIm;
          const nextRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nextRe;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  /**
   * In-place 2-D FFT over a w×h buffer stored row-major.
   * Rows first, then columns — the transform is separable, so this is exact.
   */
  function fft2d(re, im, w, h, inverse) {
    const rowRe = new Float64Array(w), rowIm = new Float64Array(w);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      rowRe.set(re.subarray(off, off + w));
      rowIm.set(im.subarray(off, off + w));
      fft1d(rowRe, rowIm, inverse);
      re.set(rowRe, off);
      im.set(rowIm, off);
    }

    const colRe = new Float64Array(h), colIm = new Float64Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) { colRe[y] = re[y * w + x]; colIm[y] = im[y * w + x]; }
      fft1d(colRe, colIm, inverse);
      for (let y = 0; y < h; y++) { re[y * w + x] = colRe[y]; im[y * w + x] = colIm[y]; }
    }
  }

  /**
   * Move the zero-frequency component to the centre of a w×h buffer,
   * the way numpy's fftshift does. Used before the log-polar step so the
   * spectrum's origin sits where the polar sampling expects it.
   */
  function fftShift(src, w, h) {
    const out = new Float64Array(w * h);
    const hw = w >> 1, hh = h >> 1;
    for (let y = 0; y < h; y++) {
      const sy = (y + hh) % h;
      for (let x = 0; x < w; x++) {
        out[y * w + x] = src[sy * w + ((x + hw) % w)];
      }
    }
    return out;
  }

  const api = { fft1d, fft2d, fftShift, nextPow2, prevPow2 };

  if (typeof module === "object" && module.exports) module.exports = api;
  else (global.Drift = global.Drift || {}).fft = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
