(() => {
  /**
   * Gooey MS — uniform contour across M / MS / S.
   * One rendering mode only: circle skeletons + fixed goo filter.
   * No crisp SVG stamp crossfade (that caused soft vs sharp dual edges).
   * X scrubs M ↔ MS ↔ S; Y adds subtle 2D life. Contour weight/sharpness
   * stay constant so morph regions match unchanged letter parts.
   */
  const home = document.getElementById("view-home");
  const circlesLayer = document.getElementById("ms-circles");
  const pathsLayer = document.getElementById("ms-paths");
  const gooBlur = document.getElementById("ms-goo-blur");
  const gooMatrix = document.getElementById("ms-goo-matrix");
  if (!home || !circlesLayer || !pathsLayer) return;

  // viewBox 0 0 320 260 — Playfair-like serif centerlines
  const PATHS = {
    m:
      "M 16,224 " +
      "C 20,238 46,240 60,230 " +
      "L 64,222 L 64,38 " +
      "C 64,26 52,22 30,22 " +
      "L 18,22 L 64,22 L 64,46 " +
      "L 64,222 L 64,46 " +
      "L 113,186 L 162,46 " +
      "L 162,22 L 208,22 L 192,22 " +
      "C 172,22 162,26 162,38 " +
      "L 162,222 L 162,46 L 162,222 " +
      "L 166,230 " +
      "C 180,240 208,238 212,224",
    s:
      "M 292,62 " +
      "C 290,34 264,18 230,18 " +
      "C 188,18 150,40 144,82 " +
      "C 138,120 170,140 218,154 " +
      "C 266,168 300,188 296,224 " +
      "C 292,258 256,270 210,264 " +
      "C 172,258 142,238 136,206",
    ms:
      "M 14,224 " +
      "C 18,238 40,240 52,230 " +
      "L 56,222 L 56,38 " +
      "C 56,26 46,22 28,22 " +
      "L 18,22 L 56,22 L 56,46 " +
      "L 56,210 L 56,46 " +
      "L 98,178 L 140,46 " +
      "L 140,22 L 170,22 L 158,22 " +
      "C 146,22 140,26 140,38 " +
      "L 140,200 " +
      "C 146,244 192,260 232,240 " +
      "C 270,222 286,176 256,146 " +
      "C 230,120 190,128 192,160 " +
      "C 194,188 226,202 264,186 " +
      "C 290,172 308,190 304,222 " +
      "C 300,256 262,270 218,262 " +
      "C 182,254 152,236 146,208",
  };

  // Uniform edge language — locked for the whole scrub range
  const NB = 72;
  const RADIUS = 12.5;
  const BLUR = 6.5;
  const CM_MUL = 34;
  const CM_BIAS = -17;
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
    // Lock filter once — never retune mid / end
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
      out.push({
        x: a[i].x + (c[i].x - a[i].x) * t + xOff,
        y: a[i].y + (c[i].y - a[i].y) * t + yOff,
      });
    }
    return out;
  }

  function applyPoints(pts) {
    for (let i = 0; i < NB; i++) {
      circleEls[i].setAttribute("cx", String(pts[i].x));
      circleEls[i].setAttribute("cy", String(pts[i].y));
      circleEls[i].setAttribute("r", String(RADIUS));
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
