/* Drift — app.js
 *
 * Wires the page to the engine. Everything runs on the main thread; the
 * registration grid is capped at 512×512, which keeps a comparison inside a
 * few hundred milliseconds while staying far more precise than the eye.
 */
(function () {
  "use strict";

  const R = Drift.register;
  const GRID = 512;                 // power of two, required by the FFT
  const $ = (id) => document.getElementById(id);

  const state = { A: null, B: null, view: "overlay", last: null };

  /* ---------- loading ---------- */

  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        return reject(new Error("That file is not an image."));
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
      img.src = url;
    });
  }

  function loadFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load " + url));
      img.src = url;
    });
  }

  /**
   * Draw the image into the square registration grid and pull the pixels back.
   *
   * The grid has to be square and a power of two for the FFT, but the image
   * almost never is, so it is letterboxed rather than stretched. Stretching
   * would scale x and y by different amounts, and a non-uniform scale does not
   * preserve angles: a 6.5° rotation measured on a 640×480 photo squashed into
   * 512×512 comes back as atan(1.067/0.8 · tan 6.5°) = 8.6°. Letterboxing
   * keeps one scale factor for both axes, so the reported angle, scale and
   * shift are all in the source image's own units.
   */
  function fitToGrid(img, grid) {
    const c = document.createElement("canvas");
    c.width = grid; c.height = grid;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // Mid grey: identical in both frames, so it contributes nothing to the
    // difference, and no hard black edge for the window to ring against.
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, grid, grid);
    const s = Math.min(grid / img.width, grid / img.height);
    const dw = img.width * s, dh = img.height * s;
    const ox = Math.round((grid - dw) / 2), oy = Math.round((grid - dh) / 2);
    ctx.drawImage(img, ox, oy, dw, dh);

    // Which grid pixels hold real content. The outermost ring is left at 0 so
    // that `warp`, which clamps samples to the edge, reports anything pulled in
    // from beyond the frame as invalid instead of replicating a border pixel.
    const rect = { x: ox, y: oy, w: Math.round(dw), h: Math.round(dh) };
    const content = new Uint8Array(grid * grid);
    for (let y = Math.max(1, rect.y); y < Math.min(grid - 1, rect.y + rect.h); y++) {
      for (let x = Math.max(1, rect.x); x < Math.min(grid - 1, rect.x + rect.w); x++) {
        content[y * grid + x] = 1;
      }
    }
    // One grid pixel is `1 / s` source pixels, on both axes.
    return { data: ctx.getImageData(0, 0, grid, grid), perPx: 1 / s, rect, content };
  }

  function setSlot(which, img) {
    state[which] = img;
    const drop = $("drop" + which), thumb = $("thumb" + which);
    const box = thumb.parentElement.getBoundingClientRect();
    const tw = Math.max(1, Math.round(box.width)) || 400;
    thumb.width = tw; thumb.height = 190;
    const ctx = thumb.getContext("2d");
    ctx.fillStyle = "#1a2026"; ctx.fillRect(0, 0, tw, 190);
    const s = Math.min(tw / img.width, 190 / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (tw - dw) / 2, (190 - dh) / 2, dw, dh);
    thumb.hidden = false;
    drop.classList.add("has");
    drop.querySelector(".dropText strong").textContent =
      img.width + " × " + img.height;
    drop.querySelector(".dropText span").textContent = "Click to replace";
    maybeCompare();
  }

  /* ---------- comparison ---------- */

  let timer = null;
  function maybeCompare() {
    if (!state.A || !state.B) return;
    clearTimeout(timer);
    timer = setTimeout(compare, 30);
  }

  function compare() {
    $("busy").hidden = false;
    $("result").hidden = true;
    $("busyText").textContent = $("rot").checked
      ? "Measuring rotation, scale and shift…" : "Lining the images up…";

    // Yield once so the spinner has a chance to paint before the synchronous
    // work begins. A plain timeout rather than requestAnimationFrame: rAF does
    // not fire in a tab the browser is not compositing — a background tab, a
    // minimised window, an embedded pane — and gating the work on a frame that
    // never arrives leaves the spinner up for ever.
    setTimeout(() => {
      try { runCompare(); }
      catch (err) {
        $("busy").hidden = true;
        $("verdict").textContent = "Something went wrong: " + err.message;
        $("verdict").className = "verdict warn";
        $("result").hidden = false;
      }
    }, 30);
  }

  function runCompare() {
    const A = state.A, B = state.B;
    const fitA = fitToGrid(A, GRID), fitB = fitToGrid(B, GRID);
    const imgA = fitA.data, imgB = fitB.data;
    const gA = R.toGray(imgA.data, GRID, GRID);
    const gB = R.toGray(imgB.data, GRID, GRID);

    const res = R.align(gA, gB, GRID, GRID, { rotation: $("rot").checked });
    const thr = Number($("sens").value);

    // Compare only where both frames have real content after alignment. B's
    // own content mask goes through exactly the warp that produced
    // `res.aligned`, so padding that moved under the shift cannot read as
    // change, and neither can the wedges a rotation opens up at the corners.
    const movedB = R.warp(fitB.content, GRID, GRID,
                          -res.angle, 1 / res.scale, res.dx, res.dy);
    const valid = new Uint8Array(GRID * GRID);
    for (let i = 0; i < valid.length; i++) {
      valid[i] = (fitA.content[i] && movedB[i] > 0.999) ? 1 : 0;
    }
    const diff = R.differenceMask(gA, res.aligned, GRID, GRID, thr, valid);

    // The grid is letterboxed, so one factor converts both axes back to source
    // pixels. `res.dx` is the correction that undoes the offset, so where the
    // second image actually *sits* is its negation — what a reader expects.
    const sx = fitA.perPx, sy = fitA.perPx;
    state.last = { res, diff, imgA, imgB, sx, sy, valid, rect: fitA.rect };

    $("rDx").textContent = fmtPx(-res.dx * sx);
    $("rDy").textContent = fmtPx(-res.dy * sy);
    $("cellRot").hidden = !$("rot").checked;
    $("cellScale").hidden = !$("rot").checked;
    $("rRot").textContent = fmtDeg(res.angle);
    $("rScale").textContent = "×" + res.scale.toFixed(3);
    $("rChanged").textContent = (diff.changedRatio * 100).toFixed(1) + "%";
    $("rConf").textContent = Math.round(res.confidence * 100) + "%";

    writeVerdict(res, diff, sx, sy);
    draw();
    $("busy").hidden = true;
    $("result").hidden = false;
  }

  function fmtPx(v) {
    let r = Math.round(v * 10) / 10;
    if (r === 0) r = 0;                      // otherwise -0 prints as "-0.0"
    return (r > 0 ? "+" : "") + r.toFixed(1) + " px";
  }

  /** Anticlockwise is positive, matching the engine and ordinary geometry. */
  function fmtDeg(v) {
    const r = Math.round(v * 10) / 10;
    if (Math.abs(r) < 0.05) return "0°";
    return Math.abs(r).toFixed(1) + "° " + (r > 0 ? "anticlockwise" : "clockwise");
  }

  function writeVerdict(res, diff, sx, sy) {
    const el = $("verdict");
    const ux = -res.dx * sx, uy = -res.dy * sy;   // where B sits, in source pixels
    const pct = diff.changedRatio * 100;
    let txt, warn = false;

    if (res.confidence < 0.08) {
      txt = "These two images do not appear to show the same scene — the alignment " +
            "found no clear match, so the red marks below are not meaningful.";
      warn = true;
    } else {
      // Two separate clauses: where it sits, and how it is turned. Folding a
      // rotation into the "sits ... of the first" phrasing reads wrongly.
      const moved = [];
      if (Math.abs(ux) >= 0.5) moved.push(Math.abs(ux).toFixed(0) + " px " + (ux > 0 ? "right" : "left"));
      if (Math.abs(uy) >= 0.5) moved.push(Math.abs(uy).toFixed(0) + " px " + (uy > 0 ? "down" : "up"));
      const turned = [];
      if (Math.abs(res.angle) >= 0.2) {
        turned.push("turned " + Math.abs(res.angle).toFixed(1) + "° " +
                    (res.angle > 0 ? "anticlockwise" : "clockwise"));
      }
      if (Math.abs(res.scale - 1) >= 0.005) {
        turned.push((res.scale > 1 ? "enlarged " : "shrunk ") +
                    "×" + res.scale.toFixed(2));
      }

      let shift;
      if (moved.length && turned.length) {
        shift = "The second image sits " + moved.join(" and ") + " of the first, and is " +
                turned.join(" and ") + ". ";
      } else if (moved.length) {
        shift = "The second image sits " + moved.join(" and ") + " of the first. ";
      } else if (turned.length) {
        shift = "The second image is " + turned.join(" and ") + " relative to the first. ";
      } else {
        shift = "The two images are already aligned. ";
      }
      const change = pct < 0.3 ? "After lining them up, nothing meaningful differs."
                   : pct < 3   ? "After lining them up, " + pct.toFixed(1) + "% of the frame differs — the red areas."
                               : pct.toFixed(1) + "% of the frame differs. If that looks like too much, drag sensitivity down.";
      txt = shift + change;
    }
    el.textContent = txt;
    el.className = warn ? "verdict warn" : "verdict";
  }

  /* ---------- drawing ---------- */

  /* Everything is computed on the square grid, but the grid is letterboxed, so
   * every view is cropped back to the content rectangle before it is shown.
   * Otherwise the result would carry grey bars the user never uploaded. */
  function draw() {
    if (!state.last) return;
    const { res, diff, imgA, imgB, rect } = state.last;
    const c = $("out"), ctx = c.getContext("2d");
    const swipe = $("swipe");
    swipe.hidden = state.view !== "swipe";

    if (state.view === "side") {
      c.width = rect.w * 2 + 8; c.height = rect.h;
      ctx.fillStyle = "#1a2026"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.putImageData(imgA, -rect.x, -rect.y);
      ctx.putImageData(imgB, rect.w + 8 - rect.x, -rect.y);
      return;
    }

    c.width = rect.w; c.height = rect.h;

    if (state.view === "swipe") {
      const cut = Math.round(rect.w * Number(swipe.value) / 100);
      ctx.putImageData(imgA, -rect.x, -rect.y);
      // Aligned B on the right of the cut, so the seam shows the fit.
      const bAl = grayToImageData(res.aligned, GRID, GRID);
      ctx.putImageData(bAl, -rect.x, -rect.y,
                       rect.x + cut, rect.y, rect.w - cut, rect.h);
      ctx.fillStyle = "#e5484d";
      ctx.fillRect(cut - 1, 0, 2, rect.h);
      return;
    }

    // Overlay: image A, dimmed, with changed pixels in red.
    const out = ctx.createImageData(rect.w, rect.h);
    const src = imgA.data, m = diff.mask;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const i = (y + rect.y) * GRID + (x + rect.x);
        const sp = i * 4, p = (y * rect.w + x) * 4;
        if (m[i]) {
          out.data[p] = 229; out.data[p + 1] = 40; out.data[p + 2] = 50;
        } else {
          const g = 0.2126 * src[sp] + 0.7152 * src[sp + 1] + 0.0722 * src[sp + 2];
          const v = 60 + g * 0.62;               // flatten so red dominates
          out.data[p] = v; out.data[p + 1] = v; out.data[p + 2] = v;
        }
        out.data[p + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  function grayToImageData(g, w, h) {
    const d = new ImageData(w, h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      const v = Math.max(0, Math.min(255, g[i]));
      d.data[p] = v; d.data[p + 1] = v; d.data[p + 2] = v; d.data[p + 3] = 255;
    }
    return d;
  }

  /* ---------- wiring ---------- */

  function wireDrop(which) {
    const drop = $("drop" + which), input = $("file" + which);
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", async () => {
      if (input.files[0]) {
        try { setSlot(which, await readImage(input.files[0])); }
        catch (e) { alert(e.message); }
      }
    });
    ["dragenter", "dragover"].forEach(ev =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev =>
      drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", async (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) { try { setSlot(which, await readImage(f)); } catch (err) { alert(err.message); } }
    });
  }

  wireDrop("A"); wireDrop("B");

  // Paste fills the empty slot first, so two pastes in a row just work.
  document.addEventListener("paste", async (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (!item) return;
    const which = !state.A ? "A" : "B";
    try { setSlot(which, await readImage(item.getAsFile())); } catch (err) { alert(err.message); }
  });

  $("sens").addEventListener("input", () => {
    const v = Number($("sens").value);
    $("sensVal").textContent = v < 22 ? "picks up everything" : v < 50 ? "medium" : "only big changes";
    if (state.last) maybeCompare();
  });
  $("rot").addEventListener("change", maybeCompare);
  $("swipe").addEventListener("input", draw);

  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("is-on"));
      t.classList.add("is-on");
      state.view = t.dataset.view;
      draw();
    });
  });

  $("download").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = "drift-" + state.view + ".png";
    a.href = $("out").toDataURL("image/png");
    a.click();
  });

  $("reset").addEventListener("click", () => {
    state.A = state.B = state.last = null;
    ["A", "B"].forEach(w => {
      const d = $("drop" + w);
      d.classList.remove("has");
      $("thumb" + w).hidden = true;
      $("file" + w).value = "";
      d.querySelector(".dropText strong").textContent = (w === "A" ? "First" : "Second") + " image";
      d.querySelector(".dropText span").textContent = "Click, drop or paste";
    });
    $("result").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* Deep link from the examples page: ?a=…&b=…&rot=1 */
  (async function fromQuery() {
    const q = new URLSearchParams(location.search);
    const a = q.get("a"), b = q.get("b");
    if (!a || !b) return;
    if (q.get("rot") === "1") $("rot").checked = true;
    if (q.get("sens")) $("sens").value = q.get("sens");
    $("busy").hidden = false;
    try {
      const [ia, ib] = await Promise.all([loadFromUrl(a), loadFromUrl(b)]);
      setSlot("A", ia); setSlot("B", ib);
      $("tryLine").hidden = true;
    } catch (e) {
      $("busy").hidden = true;
      alert(e.message);
    }
  })();
})();
