(() => {
  /**
   * Restrained gooey MS — Larose circle-along-path + SVG gooey filter.
   * gooey-2d-interact: full 2D pointer — X scrubs M↔MS↔S, Y biases
   * path sampling, goo radius, and blur slightly for a livelier feel.
   * Serif skeletons from Playfair-like metrics kept intact.
   */
  const home = document.getElementById("view-home");
  const circlesLayer = document.getElementById("ms-circles");
  const pathsLayer = document.getElementById("ms-paths");
  const gooBlur = document.getElementById("ms-goo-blur");
  const stateBtns = [...document.querySelectorAll("[data-ms-shape]")];
  if (!home || !circlesLayer || !pathsLayer) return;

  // viewBox 0 0 320 260 — serif centerlines (Playfair Display proportions)
  const PATHS = {
    m:
      "M 14,222 " +
      "C 18,236 44,238 58,228 " +
      "L 62,220 L 62,40 " +
      "C 62,28 50,24 28,24 " +
      "L 16,24 L 62,24 L 62,48 " +
      "L 62,220 L 62,48 " +
      "L 112,188 L 162,48 " +
      "L 162,24 L 208,24 L 192,24 " +
      "C 172,24 162,28 162,40 " +
      "L 162,220 L 162,48 L 162,220 " +
      "L 166,228 " +
      "C 180,238 208,236 212,222",
    s:
      "M 298,64 " +
      "C 296,36 268,20 232,20 " +
      "C 188,20 148,42 142,84 " +
      "C 136,122 168,142 218,156 " +
      "C 268,170 304,190 300,226 " +
      "C 296,260 258,272 210,266 " +
      "C 170,260 138,240 132,206",
    ms:
      "M 12,222 " +
      "C 16,236 38,238 50,228 " +
      "L 54,220 L 54,40 " +
      "C 54,28 44,24 26,24 " +
      "L 16,24 L 54,24 L 54,48 " +
      "L 54,210 L 54,48 " +
      "L 96,178 L 138,48 " +
      "L 138,24 L 168,24 L 156,24 " +
      "C 144,24 138,28 138,40 " +
      "L 138,200 " +
      "C 144,244 192,260 234,240 " +
      "C 272,222 288,176 258,146 " +
      "C 232,120 190,128 192,160 " +
      "C 194,188 228,202 266,186 " +
      "C 292,172 310,190 306,222 " +
      "C 302,256 264,270 220,262 " +
      "C 184,254 154,236 148,208",
  };

  const NB = 42;
  const RADIUS_BASE = 18;
  const STAGGER = 0.005;
  const DURATION = 1300;
  const BLEND_EASE = 0.07;
  const Y_EASE = 0.1;
  const BLUR_BASE = 12;
  const VIEW_H = 260;

  const order = ["m", "ms", "s"];
  let index = 1;
  let animToken = 0;
  const pathEls = {};
  const circleEls = [];
  let cachedPts = null;
  let blend = 1;
  let targetBlend = 1;
  let pointerDriven = true;

  // Smoothed 2D pointer state (normalized)
  let ptr = { nx: 0.5, ny: 0.5 };
  let smoothY = 0; // -1..1 relative to vertical center
  let targetY = 0;
  let smoothRadius = RADIUS_BASE;
  let smoothBlur = BLUR_BASE;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function build() {
    const ns = "http://www.w3.org/2000/svg";
    Object.keys(PATHS).forEach((key) => {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", PATHS[key]);
      p.setAttribute("fill", "none");
      pathsLayer.appendChild(p);
      pathEls[key] = p;
    });
    for (let i = 0; i < NB; i++) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("r", String(RADIUS_BASE));
      c.setAttribute("cx", "160");
      c.setAttribute("cy", "130");
      c.setAttribute("fill", "#000");
      circlesLayer.appendChild(c);
      circleEls.push(c);
    }
  }

  function samplePath(shapeIndex) {
    const path = pathEls[order[shapeIndex]];
    const length = path.getTotalLength();
    const pts = [];
    for (let i = 0; i < NB; i++) {
      const t = NB === 1 ? 0 : i / (NB - 1);
      const pt = path.getPointAtLength(length * t);
      pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  }

  function cachePoints() {
    cachedPts = [0, 1, 2].map(samplePath);
  }

  function pointsAtBlend(b, yBias) {
    const clamped = Math.max(0, Math.min(2, b));
    const i0 = Math.floor(clamped);
    const i1 = Math.min(2, i0 + 1);
    const t = easeInOutCubic(clamped - i0);
    const a = cachedPts[i0];
    const c = cachedPts[i1];
    const out = [];
    // yBias (-1..1): vertical shift + slight path-parameter warp for 2D life
    const bias = yBias || 0;
    for (let i = 0; i < NB; i++) {
      const u = NB === 1 ? 0 : i / (NB - 1);
      // Mid-path samples get more vertical pull; ends stay anchored (clean terminals)
      const mid = Math.sin(u * Math.PI);
      const yOff = bias * 14 * mid;
      // Secondary axis: slight X sway from Y so morph feels cross-coupled
      const xOff = bias * 4 * Math.sin(u * Math.PI * 2) * mid;
      out.push({
        x: a[i].x + (c[i].x - a[i].x) * t + xOff,
        y: a[i].y + (c[i].y - a[i].y) * t + yOff,
      });
    }
    return out;
  }

  function applyPoints(pts, radius) {
    const r = radius == null ? RADIUS_BASE : radius;
    for (let i = 0; i < NB; i++) {
      circleEls[i].setAttribute("cx", String(pts[i].x));
      circleEls[i].setAttribute("cy", String(pts[i].y));
      circleEls[i].setAttribute("r", String(r));
    }
  }

  function syncButtons(shapeIndex) {
    index = shapeIndex;
    stateBtns.forEach((btn) => {
      const on = Number(btn.dataset.msShape) === index;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function morphTo(shapeIndex, instant) {
    if (shapeIndex < 0 || shapeIndex > 2) return;
    pointerDriven = false;
    syncButtons(shapeIndex);
    targetBlend = shapeIndex;
    const token = ++animToken;

    if (instant) {
      blend = shapeIndex;
      applyPoints(pointsAtBlend(blend, smoothY), smoothRadius);
      pointerDriven = true;
      return;
    }

    const fromPts = pointsAtBlend(blend, smoothY);
    const toPts = pointsAtBlend(shapeIndex, smoothY);
    const startAt = performance.now();
    const fromR = smoothRadius;
    const toR = RADIUS_BASE;

    circleEls.forEach((circle, i) => {
      const delay = i * STAGGER * 1000;
      const tick = (now) => {
        if (token !== animToken) return;
        const elapsed = now - startAt - delay;
        if (elapsed < 0) {
          requestAnimationFrame(tick);
          return;
        }
        const t = Math.min(1, elapsed / DURATION);
        const e = easeInOutCubic(t);
        circle.setAttribute(
          "cx",
          String(fromPts[i].x + (toPts[i].x - fromPts[i].x) * e)
        );
        circle.setAttribute(
          "cy",
          String(fromPts[i].y + (toPts[i].y - fromPts[i].y) * e)
        );
        circle.setAttribute("r", String(fromR + (toR - fromR) * e));
        if (t < 1) {
          requestAnimationFrame(tick);
        } else if (i === NB - 1) {
          blend = shapeIndex;
          pointerDriven = true;
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // X → primary morph axis (0=M .. 2=S); richer curve than pure linear
  function blendFromPointer(clientX, clientY) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const nx = clamp(clientX / w, 0, 1);
    const ny = clamp(clientY / h, 0, 1);
    ptr.nx = nx;
    ptr.ny = ny;
    // Mild ease so edges feel intentional (scrub richness)
    const scrub = easeInOutCubic(nx) * 2;
    // Tiny Y cross-talk on blend so vertical motion nudges morph axis
    const yNudge = (ny - 0.5) * 0.12;
    return clamp(scrub + yNudge, 0, 2);
  }

  function yFromPointer(clientY) {
    const h = window.innerHeight || 1;
    // -1 top .. +1 bottom, relative to center
    return clamp((clientY / h - 0.5) * 2, -1, 1);
  }

  function nearestShape(b) {
    return Math.max(0, Math.min(2, Math.round(b)));
  }

  function updateGooFromY(y) {
    // |Y| slightly widens goo radius / blur — more alive without losing serif read
    const mag = Math.abs(y);
    const targetR = RADIUS_BASE * (1 + mag * 0.14 - (y > 0 ? 0.02 : -0.02));
    const targetBlur = BLUR_BASE * (1 + mag * 0.18);
    smoothRadius = lerp(smoothRadius, clamp(targetR, 15.5, 22), Y_EASE);
    smoothBlur = lerp(smoothBlur, clamp(targetBlur, 10, 15.5), Y_EASE);
    if (gooBlur) {
      gooBlur.setAttribute("stdDeviation", smoothBlur.toFixed(2));
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!home.classList.contains("is-active")) return;
    if (!pointerDriven) return;

    smoothY = lerp(smoothY, targetY, Y_EASE);
    updateGooFromY(smoothY);

    const diff = targetBlend - blend;
    if (Math.abs(diff) < 0.0008 && Math.abs(targetY - smoothY) < 0.002) {
      if (blend !== targetBlend) {
        blend = targetBlend;
        applyPoints(pointsAtBlend(blend, smoothY), smoothRadius);
        syncButtons(nearestShape(blend));
      } else {
        // Still apply radius/Y bias even when blend settled
        applyPoints(pointsAtBlend(blend, smoothY), smoothRadius);
      }
      return;
    }
    blend += diff * BLEND_EASE;
    applyPoints(pointsAtBlend(blend, smoothY), smoothRadius);
    const shape = nearestShape(blend);
    if (shape !== index) syncButtons(shape);
  }

  home.addEventListener(
    "pointermove",
    (e) => {
      if (!home.classList.contains("is-active")) return;
      targetBlend = blendFromPointer(e.clientX, e.clientY);
      targetY = yFromPointer(e.clientY);
      if (!pointerDriven) {
        animToken++;
        pointerDriven = true;
      }
    },
    { passive: true }
  );

  // Also listen on window so full-page Y motion feels as rich as GSAP scrub
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!home.classList.contains("is-active")) return;
      if (!pointerDriven) return;
      targetBlend = blendFromPointer(e.clientX, e.clientY);
      targetY = yFromPointer(e.clientY);
    },
    { passive: true }
  );

  stateBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      morphTo(Number(btn.dataset.msShape), false);
    });
  });

  build();
  requestAnimationFrame(() => {
    cachePoints();
    morphTo(1, true);
    loop();
  });
})();
