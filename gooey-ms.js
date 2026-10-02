(() => {
  /**
   * Gooey MS with Cap-quality letter ends.
   * X scrubs M ↔ MS ↔ S; Y adds subtle 2D life.
   * At full-left / full-right extremes the goo resolves toward crisp
   * Playfair Display M / S (matching Cap / Tab 1). Middle stays gooey morph.
   * Shape buttons removed — pointer only.
   */
  const home = document.getElementById("view-home");
  const circlesLayer = document.getElementById("ms-circles");
  const pathsLayer = document.getElementById("ms-paths");
  const gooBlur = document.getElementById("ms-goo-blur");
  const gooMatrix = document.getElementById("ms-goo-matrix");
  const crispM = document.getElementById("ms-crisp-m");
  const crispS = document.getElementById("ms-crisp-s");
  if (!home || !circlesLayer || !pathsLayer) return;

  // viewBox 0 0 320 260 — Playfair-like serif centerlines (rechecked metrics)
  // Extra stem travel thickens stems under goo; ends designed to land under
  // the crisp Playfair stamps that fade in at extremes.
  const PATHS = {
    m:
      // Bracketed foot → thick left stem (double) → top left serif
      // → left diagonal → crotch → right diagonal → top right serif
      // → thick right stem → bracketed foot
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
      // High-contrast Playfair S: beak terminals, deep bowls
      "M 292,62 " +
      "C 290,34 264,18 230,18 " +
      "C 188,18 150,40 144,82 " +
      "C 138,120 170,140 218,154 " +
      "C 266,168 300,188 296,224 " +
      "C 292,258 256,270 210,264 " +
      "C 172,258 142,238 136,206",
    ms:
      // Continuous snake: serif M into serif S bowls
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

  // Higher density → cleaner letter stems at extremes
  const NB = 64;
  const RADIUS_MID = 15.5;
  const RADIUS_END = 11.5;
  const BLUR_MID = 11;
  const BLUR_END = 5.5;
  // colorMatrix alpha row: multiplier / bias — stronger at ends = sharper threshold
  const CM_MUL_MID = 24;
  const CM_BIAS_MID = -13;
  const CM_MUL_END = 36;
  const CM_BIAS_END = -18;
  const BLEND_EASE = 0.08;
  const Y_EASE = 0.1;

  const order = ["m", "ms", "s"];
  const pathEls = {};
  const circleEls = [];
  let cachedPts = null;
  let blend = 1;
  let targetBlend = 1;
  let ptr = { nx: 0.5, ny: 0.5 };
  let smoothY = 0;
  let targetY = 0;
  let smoothRadius = RADIUS_MID;
  let smoothBlur = BLUR_MID;
  let smoothGooOpacity = 1;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  // Smooth hermite 0..1
  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
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
      c.setAttribute("r", String(RADIUS_MID));
      c.setAttribute("cx", "160");
      c.setAttribute("cy", "130");
      c.setAttribute("fill", "#0a0a0a");
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
    const bias = yBias || 0;
    for (let i = 0; i < NB; i++) {
      const u = NB === 1 ? 0 : i / (NB - 1);
      const mid = Math.sin(u * Math.PI);
      // Ends stay anchored for clean terminals; mid gets Y life
      const yOff = bias * 12 * mid;
      const xOff = bias * 3.5 * Math.sin(u * Math.PI * 2) * mid;
      out.push({
        x: a[i].x + (c[i].x - a[i].x) * t + xOff,
        y: a[i].y + (c[i].y - a[i].y) * t + yOff,
      });
    }
    return out;
  }

  function applyPoints(pts, radius, opacity) {
    const r = radius == null ? RADIUS_MID : radius;
    const op = opacity == null ? 1 : opacity;
    for (let i = 0; i < NB; i++) {
      circleEls[i].setAttribute("cx", String(pts[i].x));
      circleEls[i].setAttribute("cy", String(pts[i].y));
      circleEls[i].setAttribute("r", String(r));
      circleEls[i].setAttribute("fill-opacity", String(op));
    }
  }

  // How close to a letter extreme (0=M, 2=S). 0 mid, 1 fully at end.
  function endness(b) {
    // Near 0 → M endness; near 2 → S endness
    const mEnd = 1 - smoothstep(0.0, 0.42, b);
    const sEnd = smoothstep(1.58, 2.0, b);
    return { m: mEnd, s: sEnd, any: Math.max(mEnd, sEnd) };
  }

  function setColorMatrix(mul, bias) {
    if (!gooMatrix) return;
    // Keep RGB identity; only alpha contrast changes
    gooMatrix.setAttribute(
      "values",
      `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${mul.toFixed(2)} ${bias.toFixed(2)}`
    );
  }

  function blendFromPointer(clientX, clientY) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const nx = clamp(clientX / w, 0, 1);
    const ny = clamp(clientY / h, 0, 1);
    ptr.nx = nx;
    ptr.ny = ny;
    const scrub = easeInOutCubic(nx) * 2;
    const yNudge = (ny - 0.5) * 0.1;
    return clamp(scrub + yNudge, 0, 2);
  }

  function yFromPointer(clientY) {
    const h = window.innerHeight || 1;
    return clamp((clientY / h - 0.5) * 2, -1, 1);
  }

  function updateLook(b, y) {
    const ends = endness(b);
    const e = ends.any;
    const mag = Math.abs(y);

    // Radius / blur: mid = gooey, ends = tighter toward letter stroke
    const targetR = lerp(RADIUS_MID, RADIUS_END, e) * (1 + mag * 0.06 * (1 - e));
    const targetBlur = lerp(BLUR_MID, BLUR_END, e) * (1 + mag * 0.1 * (1 - e));
    const targetMul = lerp(CM_MUL_MID, CM_MUL_END, e);
    const targetBias = lerp(CM_BIAS_MID, CM_BIAS_END, e);

    smoothRadius = lerp(smoothRadius, clamp(targetR, 10, 18), Y_EASE);
    smoothBlur = lerp(smoothBlur, clamp(targetBlur, 4.5, 13), Y_EASE);
    if (gooBlur) gooBlur.setAttribute("stdDeviation", smoothBlur.toFixed(2));
    setColorMatrix(targetMul, targetBias);

    // Crisp Playfair stamps resolve in only at true extremes
    const mOp = ends.m * ends.m; // ease in late
    const sOp = ends.s * ends.s;
    if (crispM) crispM.setAttribute("opacity", mOp.toFixed(3));
    if (crispS) crispS.setAttribute("opacity", sOp.toFixed(3));

    // Soften goo under the stamp so the letter reads solid (not double-blurry)
    const targetGooOp = 1 - Math.max(mOp, sOp) * 0.72;
    smoothGooOpacity = lerp(smoothGooOpacity, targetGooOp, 0.14);
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!home.classList.contains("is-active")) return;

    smoothY = lerp(smoothY, targetY, Y_EASE);
    updateLook(blend, smoothY);

    const diff = targetBlend - blend;
    if (Math.abs(diff) > 0.0005) {
      blend += diff * BLEND_EASE;
    } else {
      blend = targetBlend;
    }
    applyPoints(pointsAtBlend(blend, smoothY * (1 - endness(blend).any * 0.7)), smoothRadius, smoothGooOpacity);
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
    applyPoints(pointsAtBlend(1, 0), RADIUS_MID, 1);
    updateLook(1, 0);
    loop();
  });
})();
