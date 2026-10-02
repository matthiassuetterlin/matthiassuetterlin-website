(() => {
  /**
   * gooey-olgiati-bridge — uniform sharp contour, Olgiati-style mid bridge.
   * Mid-scrub: organic bone-like bridge (pinched waist) between M right stem
   * and S mid, same black material as letters. Continuous pointer morph M↔MS↔S.
   * One rendering mode: circle skeletons + locked goo filter (no soft overlay).
   */
  const home = document.getElementById("view-home");
  const circlesLayer = document.getElementById("ms-circles");
  const pathsLayer = document.getElementById("ms-paths");
  const gooBlur = document.getElementById("ms-goo-blur");
  const gooMatrix = document.getElementById("ms-goo-matrix");
  if (!home || !circlesLayer || !pathsLayer) return;

  // viewBox 0 0 320 260 — Playfair-like serif centerlines
  // MS path routes through M, crosses a pinched bone bridge, then S.
  const PATHS = {
    m:
      "M 18,224 " +
      "C 22,236 48,238 60,228 " +
      "L 64,218 L 64,40 " +
      "C 64,28 52,24 30,24 " +
      "L 18,24 L 64,24 L 64,48 " +
      "L 64,214 L 64,48 " +
      "L 112,180 L 160,48 " +
      "L 160,24 L 206,24 L 190,24 " +
      "C 170,24 160,28 160,40 " +
      "L 160,214 L 160,48 L 160,214 " +
      "L 164,228 " +
      "C 178,238 206,236 210,222",
    s:
      "M 292,58 " +
      "C 290,30 264,14 230,14 " +
      "C 188,14 150,36 144,78 " +
      "C 138,116 170,136 218,150 " +
      "C 266,164 300,184 296,220 " +
      "C 292,254 256,266 210,260 " +
      "C 172,254 142,234 136,202",
    ms:
      // M body (slightly tighter)
      "M 16,224 " +
      "C 20,236 42,238 54,228 " +
      "L 58,218 L 58,40 " +
      "C 58,28 48,24 30,24 " +
      "L 18,24 L 58,24 L 58,48 " +
      "L 58,210 L 58,48 " +
      "L 100,176 L 142,48 " +
      "L 142,24 L 172,24 L 160,24 " +
      "C 148,24 142,28 142,40 " +
      // right stem → bridge attach
      "L 142,152 " +
      // bone bridge (pinched waist) — path folds to thicken solid join
      "C 152,144 164,140 176,144 " +
      "C 188,148 198,158 200,170 " +
      "C 202,182 196,192 186,198 " +
      "C 176,204 162,202 154,194 " +
      "C 146,186 144,174 150,164 " +
      "C 156,154 170,148 186,150 " +
      "C 202,152 218,160 234,168 " +
      // into S and finish
      "C 250,176 268,186 280,204 " +
      "C 292,222 288,248 260,260 " +
      "C 232,272 196,266 172,250 " +
      "C 148,234 136,210 140,186 " +
      "C 144,162 168,148 196,142 " +
      "C 224,136 250,128 262,108 " +
      "C 274,88 266,62 240,50 " +
      "C 214,38 180,42 160,64 " +
      "C 140,86 138,110 150,128",
  };

  // Uniform sharp contour — locked across whole scrub (harder threshold = razor edge)
  const NB = 96;
  const RADIUS = 12.2;
  const BLUR = 6.0;
  const CM_MUL = 42;
  const CM_BIAS = -20;
  const BLEND_EASE = 0.08;
  const Y_EASE = 0.1;

  const order = ["m", "ms", "s"];
  const pathEls = {};
  const circleEls = [];
  let cachedPts = null;
  let blend = 1;
  let targetBlend = 1;
  let smoothY = 0;
  let targetY = 0;

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
      c.setAttribute("r", String(RADIUS));
      c.setAttribute("cx", "160");
      c.setAttribute("cy", "130");
      c.setAttribute("fill", "#0a0a0a");
      circlesLayer.appendChild(c);
      circleEls.push(c);
    }
    if (gooBlur) gooBlur.setAttribute("stdDeviation", String(BLUR));
    if (gooMatrix) {
      gooMatrix.setAttribute(
        "values",
        `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${CM_MUL} ${CM_BIAS}`
      );
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

  function radiusAt(shapeIndex, i) {
    // Mid MS: slight pinch on bridge bead band (indices ~0.38–0.55 of path)
    if (shapeIndex !== 1) return RADIUS;
    const u = NB === 1 ? 0 : i / (NB - 1);
    if (u > 0.36 && u < 0.58) {
      const local = (u - 0.36) / 0.22;
      const pinch = Math.sin(local * Math.PI); // 0 at ends of band, 1 at center
      return RADIUS - 2.8 * pinch;
    }
    return RADIUS;
  }

  function pointsAtBlend(b, yBias) {
    const clamped = Math.max(0, Math.min(2, b));
    const i0 = Math.floor(clamped);
    const i1 = Math.min(2, i0 + 1);
    const t = easeInOutCubic(clamped - i0);
    const a = cachedPts[i0];
    const c = cachedPts[i1];
    const out = [];
    const bias = yBias || 0;
    for (let i = 0; i < NB; i++) {
      const u = NB === 1 ? 0 : i / (NB - 1);
      const mid = Math.sin(u * Math.PI);
      const yOff = bias * 12 * mid;
      const xOff = bias * 3.5 * Math.sin(u * Math.PI * 2) * mid;
      const r0 = radiusAt(i0, i);
      const r1 = radiusAt(i1, i);
      out.push({
        x: a[i].x + (c[i].x - a[i].x) * t + xOff,
        y: a[i].y + (c[i].y - a[i].y) * t + yOff,
        r: r0 + (r1 - r0) * t,
      });
    }
    return out;
  }

  function applyPoints(pts) {
    for (let i = 0; i < NB; i++) {
      circleEls[i].setAttribute("cx", String(pts[i].x));
      circleEls[i].setAttribute("cy", String(pts[i].y));
      circleEls[i].setAttribute("r", String(pts[i].r));
      circleEls[i].setAttribute("fill-opacity", "1");
    }
  }

  function blendFromPointer(clientX, clientY) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const nx = clamp(clientX / w, 0, 1);
    const ny = clamp(clientY / h, 0, 1);
    const scrub = easeInOutCubic(nx) * 2;
    const yNudge = (ny - 0.5) * 0.1;
    return clamp(scrub + yNudge, 0, 2);
  }

  function yFromPointer(clientY) {
    const h = window.innerHeight || 1;
    return clamp((clientY / h - 0.5) * 2, -1, 1);
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!home.classList.contains("is-active")) return;

    smoothY = lerp(smoothY, targetY, Y_EASE);
    const diff = targetBlend - blend;
    if (Math.abs(diff) > 0.0005) {
      blend += diff * BLEND_EASE;
    } else {
      blend = targetBlend;
    }
    applyPoints(pointsAtBlend(blend, smoothY));
  }

  function onPointer(e) {
    if (!home.classList.contains("is-active")) return;
    targetBlend = blendFromPointer(e.clientX, e.clientY);
    targetY = yFromPointer(e.clientY);
  }

  home.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("pointermove", onPointer, { passive: true });

  build();
  requestAnimationFrame(() => {
    cachePoints();
    blend = 1;
    targetBlend = 1;
    applyPoints(pointsAtBlend(1, 0));
    loop();
  });
})();
