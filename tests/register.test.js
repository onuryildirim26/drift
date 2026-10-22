/* Drift — registration tests
 *
 * Every case builds a scene, transforms it by a known amount, and checks the
 * engine reads that amount back. Ground truth is exact because it is applied
 * here, so a failure is the estimator's and not the fixture's.
 *
 *   node --test tests/*.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const R = require("../js/register.js");

const W = 256, H = 256;

/** A scene with structure at several scales — flat fields give no peak. */
function scene(w, h, seed) {
  const img = new Float64Array(w * h);
  let s = seed || 7;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const blobs = Array.from({ length: 14 }, () => ({
    x: rnd() * w, y: rnd() * h, r: 8 + rnd() * 26, v: 60 + rnd() * 160
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 40 + 25 * Math.sin(x / 11) * Math.cos(y / 13);
      for (const b of blobs) {
        if (Math.hypot(x - b.x, y - b.y) < b.r) v = b.v;
      }
      img[y * w + x] = Math.max(0, Math.min(255, v));
    }
  }
  return img;
}

/**
 * Rotate anticlockwise on screen, with y growing downward, by sampling the
 * source at the inverse map. Deliberately written out here rather than calling
 * `R.warp`: a test that builds its input with the same code it is checking can
 * only prove the engine is self-consistent, not that it agrees with the
 * convention everyone else uses. This version was checked frame-for-frame
 * against PIL's `Image.rotate`, which is anticlockwise-positive.
 */
function rotateCCW(src, w, h, deg) {
  const th = deg * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
  const cx = w / 2, cy = h / 2, out = new Float64Array(w * h);
  const cl = (v, m) => (v < 0 ? 0 : v > m ? m : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x - cx, py = y - cy;
      const sx = ct * px - st * py + cx, sy = st * px + ct * py + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const xa = cl(x0, w - 1), xb = cl(x0 + 1, w - 1);
      const ya = cl(y0, h - 1), yb = cl(y0 + 1, h - 1);
      out[y * w + x] = src[ya * w + xa] * (1 - fx) * (1 - fy)
                     + src[ya * w + xb] * fx * (1 - fy)
                     + src[yb * w + xa] * (1 - fx) * fy
                     + src[yb * w + xb] * fx * fy;
    }
  }
  return out;
}

test("phase correlation recovers a whole-pixel shift", () => {
  const a = scene(W, H, 3);
  const b = R.warp(a, W, H, 0, 1, -17, 9);   // b is a moved left/down
  const r = R.align(a, b, W, H, {});
  assert.ok(Math.abs(r.dx - 17) < 1.0, `dx was ${r.dx.toFixed(2)}, expected ~17`);
  assert.ok(Math.abs(r.dy + 9) < 1.0, `dy was ${r.dy.toFixed(2)}, expected ~-9`);
  assert.ok(r.confidence > 0.1, `confidence ${r.confidence.toFixed(3)} too low`);
});

test("a shift of zero reads as zero", () => {
  const a = scene(W, H, 11);
  const r = R.align(a, a, W, H, {});
  assert.ok(Math.abs(r.dx) < 0.6 && Math.abs(r.dy) < 0.6,
    `expected no shift, got ${r.dx.toFixed(2)}, ${r.dy.toFixed(2)}`);
});

test("brightness changes do not move the estimate", () => {
  const a = scene(W, H, 5);
  const shifted = R.warp(a, W, H, 0, 1, -12, -6);
  const brighter = shifted.map(v => Math.min(255, v * 1.35 + 20));
  const r = R.align(a, brighter, W, H, {});
  assert.ok(Math.abs(r.dx - 12) < 1.2, `dx was ${r.dx.toFixed(2)}, expected ~12`);
  assert.ok(Math.abs(r.dy - 6) < 1.2, `dy was ${r.dy.toFixed(2)}, expected ~6`);
});

test("log-polar stage recovers a rotation, with the right sign", () => {
  for (const truth of [12, -12]) {
    const a = scene(W, H, 23);
    const b = rotateCCW(a, W, H, truth);
    const rs = R.estimateRotationScale(R.hann(a, W, H), R.hann(b, W, H), W, H);
    assert.ok(Math.abs(rs.angle - truth) < 3.5,
      `angle was ${rs.angle.toFixed(2)}, expected ~${truth}`);
  }
});

test("warp applies a rotation in the same direction it is reported", () => {
  const a = scene(W, H, 67);
  const mine = rotateCCW(a, W, H, 15);
  const theirs = R.warp(a, W, H, 15, 1, 0, 0);
  // Compare the interior only; the corners differ by how each clamps.
  let s = 0, n = 0;
  for (let y = 70; y < H - 70; y++) {
    for (let x = 70; x < W - 70; x++) {
      const d = mine[y * W + x] - theirs[y * W + x];
      s += d * d; n++;
    }
  }
  const rms = Math.sqrt(s / n);
  assert.ok(rms < 6, `warp disagrees with an independent rotation (rms ${rms.toFixed(2)})`);
});

test("align undoes a rotation rather than doubling it", () => {
  const a = scene(W, H, 71);
  const b = rotateCCW(a, W, H, -9);
  const r = R.align(a, b, W, H, { rotation: true });
  const rmsOf = (x) => {
    let s = 0, n = 0;
    for (let y = 60; y < H - 60; y++) {
      for (let j = 60; j < W - 60; j++) { const d = a[y * W + j] - x[y * W + j]; s += d * d; n++; }
    }
    return Math.sqrt(s / n);
  };
  assert.ok(rmsOf(r.aligned) < rmsOf(b) * 0.5,
    `alignment did not improve the fit: ${rmsOf(r.aligned).toFixed(1)} vs ${rmsOf(b).toFixed(1)}`);
});

test("log-polar stage recovers a scale change", () => {
  const a = scene(W, H, 31);
  const b = R.warp(a, W, H, 0, 1.25, 0, 0);
  const rs = R.estimateRotationScale(R.hann(a, W, H), R.hann(b, W, H), W, H);
  assert.ok(Math.abs(rs.scale - 1.25) < 0.12,
    `scale was ${rs.scale.toFixed(3)}, expected ~1.25`);
});

test("difference mask finds a planted object and ignores the shift", () => {
  const a = scene(W, H, 41);
  const b = R.warp(a, W, H, 0, 1, -20, 14);
  // Plant a square in b, in b's own coordinates.
  for (let y = 120; y < 150; y++) {
    for (let x = 60; x < 90; x++) b[y * W + x] = 255;
  }
  const r = R.align(a, b, W, H, {});
  const d = R.differenceMask(a, r.aligned, W, H, 40);

  assert.ok(d.changedRatio > 0.005, `nothing flagged (${d.changedRatio})`);
  assert.ok(d.changedRatio < 0.12, `too much flagged (${d.changedRatio}) — alignment likely failed`);

  // b[u,v] = a[u+20, v-14], so aligned[x,y] = b[x-20, y+14]. The square drawn
  // at b(60..90, 120..150) therefore lands at aligned(80..110, 106..136);
  // check well inside it so edge softening cannot decide the result.
  let inside = 0;
  for (let y = 112; y < 130; y++) {
    for (let x = 86; x < 104; x++) if (d.mask[y * W + x]) inside++;
  }
  assert.ok(inside > 200, `planted square not flagged (${inside} px)`);
});

test("a validity mask keeps excluded pixels out of the result", () => {
  const a = scene(W, H, 59);
  const b = Float64Array.from(a);
  for (let y = 40; y < 80; y++) {
    for (let x = 40; x < 80; x++) b[y * W + x] = 255;   // a change, all inside
  }
  const all = R.differenceMask(a, b, W, H, 40);
  assert.ok(all.changedPixels > 500, `change not seen at all (${all.changedPixels})`);

  // Mask off the half of the frame the change sits in.
  const valid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = W / 2; x < W; x++) valid[y * W + x] = 1;
  }
  const half = R.differenceMask(a, b, W, H, 40, valid);
  assert.strictEqual(half.changedPixels, 0, "masked-off change still reported");
  assert.ok(half.consideredPixels > 0 && half.consideredPixels < W * H,
    `considered count wrong (${half.consideredPixels})`);
  assert.strictEqual(half.changedRatio, 0, "ratio should be over compared pixels only");
});

test("identical images report almost no change", () => {
  const a = scene(W, H, 53);
  const r = R.align(a, a, W, H, {});
  const d = R.differenceMask(a, r.aligned, W, H, 25);
  assert.ok(d.changedRatio < 0.002, `expected ~0 change, got ${d.changedRatio}`);
});

test("the FFT round-trips", () => {
  const F = require("../js/fft.js");
  const n = 64;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 3) * 10 + i);
  const im = new Float64Array(n);
  const orig = Float64Array.from(re);
  F.fft1d(re, im, false);
  F.fft1d(re, im, true);
  for (let i = 0; i < n; i++) {
    assert.ok(Math.abs(re[i] - orig[i]) < 1e-9, `sample ${i} drifted`);
  }
});
