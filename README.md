# Drift

**Find what moved between two images.** Drop in two photos of the same scene;
Drift measures how far one shifted, lines them up, and paints every real
difference in red.

**[Open it →](https://onuryildirim26.github.io/drift/)** ·
[Examples](https://onuryildirim26.github.io/drift/examples.html) ·
[Turkish readme](README.tr.md)

Nothing is uploaded. There is no server, no account and no build step — the
whole thing is three JavaScript files that run in the tab you opened.

---

## What it does

Two frames of the same scene are rarely taken from exactly the same place. The
camera drifts, the page goes through the scanner crooked, the survey flight
comes back a little lower. Compare such a pair pixel by pixel and *everything*
looks different, which tells you nothing.

Drift separates the two things that are mixed together in that comparison:

1. **How the frame moved** — horizontal and vertical shift, and optionally
   rotation and scale.
2. **What actually changed** — what is left once the movement is undone.

The first is reported as numbers. The second is painted red.

## How it works

**Measuring the shift.** Both images go through a Fourier transform. Dividing
out the magnitude leaves only phase, and the inverse transform of that is a
single sharp spike sitting exactly at the offset between them. This is
[phase correlation](https://en.wikipedia.org/wiki/Phase_correlation); because
the magnitude is discarded, it does not care that one photo is brighter than
the other. The peak is then refined against its neighbours by fitting a
parabola, which takes the estimate below one pixel.

**Rotation and scale.** Turn that option on and a second pass runs first, on a
log-polar resampling of each spectrum. In those coordinates a rotation becomes
a sideways shift and a zoom becomes a vertical one, so the same phase
correlation recovers both — the
[Fourier–Mellin](https://en.wikipedia.org/wiki/Fourier%E2%80%93Mellin_transform)
approach. The second image is then un-rotated and un-scaled before the shift is
measured.

**Marking the difference.** What remains after alignment is real change. Pixels
differing by more than the sensitivity threshold are painted red, and a 3×3
majority filter removes speckle. The filter needs six of nine neighbours rather
than a bare five: sub-pixel alignment error leaves a one-pixel rim along every
high-contrast edge, and five lets those outlines through.

### Two details that are easy to get wrong

The FFT needs a square, power-of-two grid, so each image is resampled to
512×512 — **letterboxed, not stretched**. Stretching scales the axes by
different amounts, and a non-uniform scale does not preserve angles: a true
6.5° rotation measured on a 640×480 photo squashed into a square comes back as
`atan(1.067/0.8 · tan 6.5°)` = 8.6°. Letterboxing keeps one scale factor for
both axes, so the reported figures are in the source image's own units.

The padding that letterboxing adds does not move with the content, so it is
excluded from the comparison rather than allowed to paint red along the seams.
The same mask also removes the wedges a rotation opens up at the corners, where
there is simply no second image to compare against.

## Accuracy

Against the four [generated examples](ornek/_uret.py), whose transforms are
applied on purpose and therefore known exactly:

| Pair | Applied | Measured |
|---|---|---|
| Car park | +23, +11 px | +22.9, +11.1 px |
| Circuit board | −14, +7 px | −13.9, +7.1 px |
| Scanned page | 6.5° clockwise | 6.41° clockwise |
| Aerial survey | +9, −6 px, ×1.18 | +8.7, −6.1 px, ×1.184 |

## Where it works and where it does not

It needs the two frames to show **the same scene**, with **most of the frame
unchanged** — the alignment is read from what stayed the same, so once more
than roughly half the frame differs there is no dominant shift left to find.

Two unrelated photographs produce a correlation surface with no clear winner.
Drift measures this as the peak-to-sidelobe ratio — how far the peak stands
above the rest of the surface, in standard deviations — and warns when it falls
below 42. That number comes from measurement: across 26 cases, genuine pairs
never scored below 50 and unrelated pairs never above 36. It is a heuristic
rather than a proof, so it adds a warning beside the result instead of
withholding it.

Brightness and exposure differences are fine. A change of perspective is not:
Drift models shift, rotation and uniform scale, so a camera that moved
*sideways* rather than panning will not line up.

## Running it locally

There is nothing to install, but the examples page fetches a JSON manifest, so
it needs to be served over HTTP rather than opened from disk:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

Tests need Node 20 or newer:

```bash
node --test tests/*.test.js
```

Regenerating the example pairs needs Python with Pillow:

```bash
python ornek/_uret.py
```

Every example is synthetic — drawn by that script, not photographed — which
keeps this repository free of any licensing or privacy question.

## Layout

```
index.html        the tool
examples.html     four pairs with known answers
js/fft.js         radix-2 FFT, no dependencies
js/register.js    the engine: phase correlation, log-polar, warp, diff mask
js/app.js         wiring, drawing, the letterbox
js/theme.js       light/dark: system setting, time of day, and the button
ornek/_uret.py    generates the example pairs and their ground truth
tests/            node --test
```

`js/register.js` has no DOM dependency and exports under both CommonJS and a
browser global, so it can be used on its own:

```js
const R = require("./js/register.js");
const res = R.align(grayA, grayB, 512, 512, { rotation: true });
// res.dx, res.dy are the correction that undoes the offset.
// res.angle, res.scale describe how B sits relative to A.
const diff = R.differenceMask(grayA, res.aligned, 512, 512, 42);
```

## Licence

[MIT](LICENSE). Built by [Onur Yıldırım](https://github.com/onuryildirim26).
If it saved you some time, you can
[buy me a coffee](https://buymeacoffee.com/onuryildirim26).
