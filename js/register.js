/* Drift — register.js
 *
 * Finds how far one image moved relative to another, then marks what actually
 * changed. Two steps, both built on the FFT in fft.js:
 *
 *   1. Phase correlation gives the translation. The cross-power spectrum of
 *      two shifted copies of the same scene is a pure phase ramp, so its
 *      inverse transform is a single sharp spike at the shift. Discarding the
 *      magnitude is what makes this robust to brightness and contrast changes.
 *
 *   2. Optionally, rotation and scale first. The magnitude of a Fourier
 *      transform does not care about translation, so resampling it on a
 *      log-polar grid turns rotation into a shift along one axis and scale
 *      into a shift along the other — and the same phase correlation reads
 *      them off. This is the Fourier–Mellin trick.
 *
 * Everything is grayscale Float64Array in [0,255], row-major.
 */
(function (global) {
  "use strict";

  const FFT = (typeof module === "object" && module.exports)
    ? require("./fft.js")
    : global.Drift.fft;

  /** Rec. 709 luma from RGBA bytes. */
  function toGray(rgba, w, h) {
    const g = new Float64Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    }
    return g;
  }

  /** Nearest-neighbour resample of a grayscale plane. */
  function resize(src, sw, sh, dw, dh) {
    const out = new Float64Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, (y * sh / dh) | 0);
      for (let x = 0; x < dw; x++) {
        out[y * dw + x] = src[sy * sw + Math.min(sw - 1, (x * sw / dw) | 0)];
      }
    }
    return out;
  }

  /**
   * A 2-D Hann window. Phase correlation assumes the image wraps around; real
   * photographs do not, and the resulting edge discontinuity puts a bright
   * cross through the correlation surface. Tapering to zero at the border
   * removes it, at the cost of ignoring the outermost pixels.
   */
  function hann(img, w, h) {
    const out = new Float64Array(w * h);
    const wx = new Float64Array(w), wy = new Float64Array(h);
    for (let x = 0; x < w; x++) wx[x] = 0.5 - 0.5 * Math.cos(2 * Math.PI * x / (w - 1));
    for (let y = 0; y < h; y++) wy[y] = 0.5 - 0.5 * Math.cos(2 * Math.PI * y / (h - 1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] = img[y * w + x] * wy[y] * wx[x];
    }
    return out;
  }

  /**
   * Phase correlation. Returns the shift that maps image B onto image A,
   * with a parabolic sub-pixel refinement and a confidence score (the peak
   * height relative to the mean of the surface — a flat surface means the
   * two images share no structure, and the answer should not be trusted).
   */
  /* Peak-to-sidelobe ratio spans roughly 6 to 2000 across real inputs, so it
   * is mapped to 0..1 on a log scale rather than a linear one. The two ends
   * were measured, not guessed: across 26 cases — shifts from 3 to 200 px,
   * rotations, scale changes, heavy noise, severe brightness differences, and
   * pairs with nothing whatever in common — genuine pairs never fell below
   * 50 and unrelated pairs never rose above 36.
   *
   * PSR_SUSPECT sits in that gap. It is a heuristic, not a proof: real
   * photographs are messier than test fixtures, so it is used to add a warning
   * beside the result, never to withhold the result. */
  var PSR_FLOOR = 10, PSR_GOOD = 250, PSR_SUSPECT = 42;

  function psrToConfidence(psr) {
    if (!(psr > PSR_FLOOR)) return 0;
    var t = Math.log(psr / PSR_FLOOR) / Math.log(PSR_GOOD / PSR_FLOOR);
    return Math.max(0, Math.min(1, t));
  }

  function phaseCorrelate(a, b, w, h) {
    const aRe = Float64Array.from(a), aIm = new Float64Array(w * h);
    const bRe = Float64Array.from(b), bIm = new Float64Array(w * h);
    FFT.fft2d(aRe, aIm, w, h, false);
    FFT.fft2d(bRe, bIm, w, h, false);

    // R = A · conj(B) / |A · conj(B)|
    const rRe = new Float64Array(w * h), rIm = new Float64Array(w * h);
    for (let i = 0; i < rRe.length; i++) {
      const cr = aRe[i] * bRe[i] + aIm[i] * bIm[i];
      const ci = aIm[i] * bRe[i] - aRe[i] * bIm[i];
      const mag = Math.hypot(cr, ci) || 1e-12;
      rRe[i] = cr / mag;
      rIm[i] = ci / mag;
    }
    FFT.fft2d(rRe, rIm, w, h, true);

    let peak = -Infinity, px = 0, py = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = rRe[y * w + x];
        if (v > peak) { peak = v; px = x; py = y; }
      }
    }

    /* Peak-to-sidelobe ratio: how far the peak stands above the rest of the
     * surface, counted in standard deviations of the rest. This is what tells
     * a real registration from two unrelated pictures. A plain peak-over-mean
     * cannot: the surface of an honest match and the surface of noise have
     * similar means, and it is the *spread* around that mean which differs.
     * The window around the peak is left out so the peak's own shoulders do
     * not inflate the figure it is being measured against. */
    const EX = 5;                                   // half-width of the exclusion
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 0; y < h; y++) {
      // The correlation surface wraps, so distance does too.
      let dy = Math.abs(y - py); if (dy > h / 2) dy = h - dy;
      for (let x = 0; x < w; x++) {
        let dx = Math.abs(x - px); if (dx > w / 2) dx = w - dx;
        if (dx <= EX && dy <= EX) continue;
        const v = rRe[y * w + x];
        sum += v; sumSq += v * v; n++;
      }
    }
    const mean = n ? sum / n : 0;
    const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0;
    // Two identical images give a perfect delta: one spike and a surface of
    // exact zeros. Dividing by that zero spread would score a flawless match
    // as no match at all, so the divisor has a floor tied to the peak itself.
    const sd = Math.max(Math.sqrt(variance), Math.abs(peak) * 1e-9);
    const psr = sd > 0 ? (peak - mean) / sd : 0;

    const at = (x, y) => rRe[((y + h) % h) * w + ((x + w) % w)];
    const sub = (m, c, p) => {
      const d = m - 2 * c + p;
      return Math.abs(d) < 1e-12 ? 0 : Math.max(-1, Math.min(1, 0.5 * (m - p) / d));
    };
    const dxSub = sub(at(px - 1, py), peak, at(px + 1, py));
    const dySub = sub(at(px, py - 1), peak, at(px, py + 1));

    // The surface is circular: a peak past the midpoint means a shift the
    // other way.
    let dx = px + dxSub, dy = py + dySub;
    if (dx > w / 2) dx -= w;
    if (dy > h / 2) dy -= h;

    return { dx, dy, confidence: psrToConfidence(psr), psr, peak };
  }

  /** Centred magnitude spectrum, log-compressed and high-pass filtered. */
  function logMagnitude(img, w, h) {
    const re = Float64Array.from(img), im = new Float64Array(w * h);
    FFT.fft2d(re, im, w, h, false);
    const mag = new Float64Array(w * h);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.log1p(Math.hypot(re[i], im[i]));
    const shifted = FFT.fftShift(mag, w, h);

    // Suppress the DC hump so the polar correlation keys on structure, not on
    // overall brightness.
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - cx, y - cy) / (Math.min(w, h) / 2);
        shifted[y * w + x] *= Math.sin(Math.PI * Math.min(1, r)) ** 2;
      }
    }
    return shifted;
  }

  /** Resample a centred spectrum onto a log-polar grid: angle × log-radius. */
  function logPolar(src, w, h, nAng, nRad) {
    const out = new Float64Array(nAng * nRad);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(cx, cy);
    const logBase = Math.log(maxR) / nRad;
    for (let a = 0; a < nAng; a++) {
      const th = Math.PI * a / nAng;          // 0..π: the spectrum is symmetric
      const ct = Math.cos(th), st = Math.sin(th);
      for (let r = 0; r < nRad; r++) {
        const rad = Math.exp(r * logBase);
        const x = Math.round(cx + rad * ct), y = Math.round(cy + rad * st);
        out[r * nAng + a] = (x >= 0 && x < w && y >= 0 && y < h) ? src[y * w + x] : 0;
      }
    }
    return { data: out, logBase, nAng, nRad };
  }

  /**
   * How B differs from A: `angle` is the degrees B is rotated anticlockwise
   * relative to A, `scale` is how many times larger B is. Both describe B as
   * it sits, so undoing the transform means warping B by the negated angle and
   * the reciprocal scale — which is what `align` does.
   *
   * Both figures are in the coordinate frame of the grid handed in. A grid
   * whose aspect ratio differs from the source image shears the angle, so the
   * caller must letterbox rather than stretch — see `fitToGrid` in app.js.
   */
  function estimateRotationScale(a, b, w, h) {
    const N = 256;
    const la = logPolar(logMagnitude(a, w, h), w, h, N, N);
    const lb = logPolar(logMagnitude(b, w, h), w, h, N, N);
    const r = phaseCorrelate(la.data, lb.data, N, N);
    return {
      angle: r.dx * 180 / N,             // one column is π/N radians
      scale: Math.exp(r.dy * la.logBase),
      confidence: r.confidence,
      psr: r.psr
    };
  }

  /** Bilinear sample with edge clamping. */
  function sampleBilinear(src, w, h, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const cl = (v, m) => v < 0 ? 0 : (v > m ? m : v);
    const x1 = cl(x0 + 1, w - 1), y1 = cl(y0 + 1, h - 1);
    const xa = cl(x0, w - 1), ya = cl(y0, h - 1);
    const p00 = src[ya * w + xa], p10 = src[ya * w + x1];
    const p01 = src[y1 * w + xa], p11 = src[y1 * w + x1];
    return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
         + p01 * (1 - fx) * fy       + p11 * fx * fy;
  }

  /**
   * Apply rotation (deg, anticlockwise), uniform scale and translation about
   * the centre, in the forward direction: `warp(src, w, h, 12, 2, 0, 0)` turns
   * the content 12° anticlockwise and makes it twice as big. To undo a
   * measured transform, pass the negated angle and the reciprocal scale.
   */
  function warp(src, w, h, angleDeg, scale, dx, dy) {
    const out = new Float64Array(w * h);
    const rad = angleDeg * Math.PI / 180;
    const c = Math.cos(rad) / scale, s = Math.sin(rad) / scale;
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ux = x - cx - dx, uy = y - cy - dy;
        out[y * w + x] = sampleBilinear(src, w, h, ux * c - uy * s + cx, ux * s + uy * c + cy);
      }
    }
    return out;
  }

  /* A local search around the log-polar estimate was tried and removed. The
   * estimate is already accurate to about a tenth of a degree on anything with
   * real structure, and the search made it worse: `confidence` saturates at 1
   * once the correlation peak is sharp, so every candidate scored the same and
   * the winner was decided by sweep order rather than by fit. Where the
   * estimate does struggle — a near-blank page, or corners filled in by the
   * rotation itself — a finer search does not help either, because the
   * spectrum genuinely carries less information there. */

  /**
   * Full alignment. `opts.rotation` turns on the log-polar stage; leave it off
   * when the two frames differ only by a shift, which is both faster and more
   * accurate.
   */
  function align(grayA, grayB, w, h, opts) {
    const options = opts || {};
    let angle = 0, scale = 1, rsConfidence = null;

    if (options.rotation) {
      const rs = estimateRotationScale(hann(grayA, w, h), hann(grayB, w, h), w, h);
      // Reject implausible readings rather than warping the image into nonsense.
      // The log-polar surface is coarser than the translation one, so its PSR
      // runs much lower and needs its own bar. Measured: pairs that really do
      // differ by a rotation or a scale scored 22.7 and up, pairs with nothing
      // in common never above 7.9. Hence 14, in the gap.
      if (rs.psr > 14 && isFinite(rs.scale) && rs.scale > 0.4 && rs.scale < 2.5) {
        angle = rs.angle; scale = rs.scale; rsConfidence = rs.confidence;
      }
    }

    // Undo what was measured: the opposite rotation, the reciprocal scale.
    const undoAngle = -angle, undoScale = 1 / scale;
    const bPre = (angle !== 0 || scale !== 1)
      ? warp(grayB, w, h, undoAngle, undoScale, 0, 0) : grayB;
    const t = phaseCorrelate(hann(grayA, w, h), hann(bPre, w, h), w, h);

    return {
      dx: t.dx, dy: t.dy, angle, scale,
      confidence: t.confidence, psr: t.psr, rotationConfidence: rsConfidence,
      aligned: warp(grayB, w, h, undoAngle, undoScale, t.dx, t.dy)
    };
  }

  /**
   * Per-pixel change mask. `threshold` is 0..255 on the luma difference;
   * anything above it counts as changed. A 3×3 majority pass removes the
   * single-pixel speckle that sensor noise and resampling leave behind.
   *
   * Pass `valid` — a 0/1 mask of the pixels where both frames hold real
   * content — to keep letterbox padding, and anything the alignment pulled in
   * from outside the frame, out of both the mask and the ratio.
   */
  function differenceMask(a, alignedB, w, h, threshold, valid) {
    const raw = new Uint8Array(w * h);
    const diff = new Float64Array(w * h);
    for (let i = 0; i < raw.length; i++) {
      if (valid && !valid[i]) { diff[i] = 0; raw[i] = 0; continue; }
      const d = Math.abs(a[i] - alignedB[i]);
      diff[i] = d;
      raw[i] = d > threshold ? 1 : 0;
    }

    // Six of nine rather than five: sub-pixel alignment error leaves a one-pixel
    // rim of difference along every high-contrast edge, and a bare majority lets
    // those rims through. Six keeps solid regions and drops the outlines.
    const mask = new Uint8Array(w * h);
    let changed = 0, considered = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i0 = y * w + x;
        if (valid && !valid[i0]) continue;
        considered++;
        let n = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) n += raw[(y + j) * w + (x + i)];
        }
        if (n >= 6) { mask[i0] = 1; changed++; }
      }
    }
    // Ratio over what was actually compared, not the whole grid: a letterboxed
    // or partly out-of-frame comparison would otherwise read as less changed
    // than it is.
    return { mask, diff, changedPixels: changed, consideredPixels: considered,
             changedRatio: considered ? changed / considered : 0 };
  }

  const api = {
    toGray, resize, hann, phaseCorrelate, estimateRotationScale,
    warp, align, differenceMask, logMagnitude, logPolar,
    PSR_SUSPECT
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else (global.Drift = global.Drift || {}).register = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
