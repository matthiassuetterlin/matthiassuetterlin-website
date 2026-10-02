(() => {
  /**
   * Gooey M/S (after olivierlarose/gooey-morph).
   *
   * M, S and a chain of droplets live in one SVG group under a "goo" filter:
   * Gaussian blur, then a steep alpha curve. Shapes that come close flow
   * into one mass with a crisp edge — the browser does the work on the GPU.
   *
   * Radial principle: the closer the pointer is to the centre between M and
   * S, the stronger the goo, the more M and S are pulled together and the
   * more droplet mass gathers between them (drawn toward the pointer).
   * Moving away in any direction — left, right, up or down — lets the
   * letters drift apart and sharpen again.
   */
  const svg = document.getElementById("ms-goo");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!svg || !letterM || !letterS || !home) return;

  const NS = "http://www.w3.org/2000/svg";

  // Tunable parameters (adjusted live by the settings menu, tune.js)
  const T = (window.msTune = Object.assign(
    {
      weight: 600, // Playfair weight 400–900
      color: "#000000",
      merge: 0.085, // goo blur at the centre, × letter height
      thicken: 0.8, // stroke that keeps hairlines while merging, × blur
      mass: 0.4, // alpha threshold at the centre (lower = more mass)
      drops: 0.07, // droplet chain size, × letter height
      satellites: 0.045, // droplets drawn towards the pointer, × letter height
      pull: 1, // how far M and S are drawn together at the centre
      spread: 0.04, // gap away from the centre, × letter width
      reach: 1, // radius of the pointer's influence
      hole: 0.06, // hole in the S, × font size
      lean: 0.07, // lean of both letters towards the pointer
      stretch: 0.05, // horizontal stretch while merging
    },
    window.msTune || {}
  ));
  const FONT_FAMILY = '"Playfair Display", "Times New Roman", Times, Georgia, serif';
  const CHAIN = 12;
  const SATELLITES = 4;

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // --- SVG scaffold ---------------------------------------------------------
  const defs = el("defs", {}, svg);
  const filter = el("filter", { id: "ms-goo-f", filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" }, defs);
  const blur = el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "1", result: "blur" }, filter);
  const matrix = el("feColorMatrix", { in: "blur", type: "matrix", values: "" }, filter);
  // Mask keeps the S's lower counter open while everything melts
  const mask = el("mask", { id: "ms-goo-m", maskUnits: "userSpaceOnUse" }, defs);
  const maskBg = el("rect", { fill: "#fff" }, mask);
  const hole = el("circle", { fill: "#000", r: "0" }, mask);
  const gooOuter = el("g", { filter: "url(#ms-goo-f)", fill: "#000" }, svg);
  const goo = el("g", { mask: "url(#ms-goo-m)" }, gooOuter);
  const textAttrs = {
    "font-family": FONT_FAMILY,
    "font-weight": "700",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    stroke: "#000",
    "stroke-linejoin": "round",
    "stroke-width": "0",
  };
  const tM = el("text", textAttrs, goo);
  const tS = el("text", textAttrs, goo);
  tM.textContent = "M";
  tS.textContent = "S";
  const drops = [];
  for (let i = 0; i < CHAIN + SATELLITES; i++) {
    drops.push({ node: el("circle", { r: "0", cx: "0", cy: "0" }, goo), x: NaN, y: NaN });
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function spring(s, target, k, damp) {
    s.v = (s.v + (target - s.x) * k) * damp;
    s.x += s.v;
  }

  let geo = null;
  let dirty = true;
  let cssW = 0;
  let cssH = 0;
  let checkAge = 0;
  const t0 = performance.now();
  const mouse = { x: 0, y: 0, active: false };
  const aim = { x: NaN, y: NaN };
  const close = { x: 0, v: 0 };
  const sep = { x: 0, v: 0 };

  function readRects() {
    letterM.style.transform = "";
    letterS.style.transform = "";
    return [letterM.getBoundingClientRect(), letterS.getBoundingClientRect()];
  }

  function rebuild() {
    cssW = Math.max(2, window.innerWidth | 0);
    cssH = Math.max(2, window.innerHeight | 0);
    svg.setAttribute("viewBox", `0 0 ${cssW} ${cssH}`);
    for (const [k, v] of [["x", 0], ["y", 0], ["width", cssW], ["height", cssH]]) {
      mask.setAttribute(k, v);
      maskBg.setAttribute(k, v);
    }
    const [rm, rs] = readRects();
    if (rm.width < 2 || rs.width < 2) {
      geo = null;
      return;
    }
    const fontPx = parseFloat(getComputedStyle(letterM).fontSize) || rm.height;
    const fy = fontPx * 0.03;
    const m = { x: rm.left + rm.width / 2, y: rm.top + rm.height / 2 + fy };
    const s = { x: rs.left + rs.width / 2, y: rs.top + rs.height / 2 + fy };
    for (const t of [tM, tS]) t.setAttribute("font-size", fontPx.toFixed(2));
    // Glyph extents for anchors and the filter region
    const H = fontPx * 0.68;
    const W = (rm.width + rs.width) * 0.5;
    const mR = m.x + rm.width * 0.36;
    const sL = s.x - rs.width * 0.36;
    const midX = (mR + sL) * 0.5;
    const midY = (m.y + s.y) * 0.5;
    const pad = W * 1.1;
    filter.setAttribute("x", (rm.left - pad).toFixed(1));
    filter.setAttribute("y", (midY - H * 1.4).toFixed(1));
    filter.setAttribute("width", (rs.right - rm.left + pad * 2).toFixed(1));
    filter.setAttribute("height", (H * 2.8).toFixed(1));
    geo = {
      fontPx,
      m,
      s,
      H,
      W,
      mR,
      sL,
      midX,
      midY,
      gap: Math.max(0, sL - mR),
      Rx: (s.x - m.x) * 0.5 + W * 0.85,
      Ry: H * 1.05,
      rects: [rm, rs],
    };
    if (aim.x !== aim.x) {
      aim.x = midX;
      aim.y = midY;
    }
  }

  function rectsMoved() {
    const [rm, rs] = readRects();
    const [om, os] = geo.rects;
    return (
      Math.abs(rm.left - om.left) > 0.5 ||
      Math.abs(rm.top - om.top) > 0.5 ||
      Math.abs(rs.left - os.left) > 0.5 ||
      Math.abs(rm.height - om.height) > 0.5
    );
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) return;
    if (++checkAge > 30) {
      checkAge = 0;
      if (geo && rectsMoved()) dirty = true;
    }
    if (dirty || window.innerWidth !== cssW || window.innerHeight !== cssH) {
      dirty = false;
      rebuild();
    }
    if (!geo) return;

    const G = geo;
    const H = G.H;
    const W = G.W;
    const time = (now - t0) / 1000;

    // Pointer, or a slow idle orbit that drifts in and out of the centre
    const tx = mouse.active ? mouse.x : G.midX + Math.cos(time * 0.33) * G.Rx * 0.75;
    const ty = mouse.active ? mouse.y : G.midY + Math.sin(time * 0.47) * G.Ry * 0.45;
    aim.x = lerp(aim.x, tx, 0.14);
    aim.y = lerp(aim.y, ty, 0.14);

    if (tM.getAttribute("font-weight") !== String(T.weight)) {
      tM.setAttribute("font-weight", T.weight);
      tS.setAttribute("font-weight", T.weight);
    }
    if (gooOuter.getAttribute("fill") !== T.color) {
      gooOuter.setAttribute("fill", T.color);
      tM.setAttribute("stroke", T.color);
      tS.setAttribute("stroke", T.color);
    }

    // Radial closeness to the centre between M and S (elliptical falloff)
    const dx = (aim.x - G.midX) / (G.Rx * T.reach);
    const dy = (aim.y - G.midY) / (G.Ry * T.reach);
    const dist = Math.sqrt(dx * dx + dy * dy);
    spring(close, 1 - smoothstep(0.06, 1, dist), 0.09, 0.8);
    const c = clamp(close.x, 0, 1.15);
    const cc = clamp(c, 0, 1);

    // Far: letters drift apart. Centre: pulled into each other.
    const spread = W * T.spread;
    const pull = (G.gap * 0.5 + W * 0.1) * T.pull;
    spring(sep, lerp(spread, -pull, c), 0.1, 0.78);

    // Both bodies lean toward the pointer, strongest when close
    const leanK = T.lean * cc;
    const offMx = -sep.x + clamp((aim.x - G.m.x) * leanK, -W * 0.12, W * 0.12);
    const offMy = clamp((aim.y - G.m.y) * leanK, -H * 0.1, H * 0.1);
    const offSx = sep.x + clamp((aim.x - G.s.x) * leanK, -W * 0.12, W * 0.12);
    const offSy = clamp((aim.y - G.s.y) * leanK, -H * 0.1, H * 0.1);
    // Stretch toward each other as they merge
    const sx = 1 + T.stretch * cc;
    tM.setAttribute(
      "transform",
      `translate(${(G.m.x + offMx).toFixed(2)} ${(G.m.y + offMy).toFixed(2)}) scale(${sx.toFixed(3)} 1)`
    );
    tS.setAttribute(
      "transform",
      `translate(${(G.s.x + offSx).toFixed(2)} ${(G.s.y + offSy).toFixed(2)}) scale(${sx.toFixed(3)} 1)`
    );
    tM.setAttribute("x", "0");
    tM.setAttribute("y", "0");
    tS.setAttribute("x", "0");
    tS.setAttribute("y", "0");

    // Lower counter of the S (Playfair 700), opened up as the letters merge
    hole.setAttribute("cx", (G.s.x + offSx + G.fontPx * 0.06 * sx).toFixed(1));
    hole.setAttribute("cy", (G.s.y + offSy + G.fontPx * 0.12).toFixed(1));
    hole.setAttribute("r", (G.fontPx * T.hole * Math.pow(cc, 0.8)).toFixed(1));

    // Goo: blur radius and threshold grow with closeness
    const sigma = lerp(0.9, H * T.merge, Math.pow(cc, 1.15));
    const thr = lerp(0.5, T.mass, cc);
    // Thicken the glyphs as the goo grows so hairlines melt instead of vanishing
    const sw = (sigma * T.thicken).toFixed(2);
    tM.setAttribute("stroke-width", sw);
    tS.setAttribute("stroke-width", sw);
    const A = 50;
    blur.setAttribute("stdDeviation", sigma.toFixed(2));
    matrix.setAttribute("values", `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${A} ${(-A * thr).toFixed(2)}`);

    // Droplet chain from M's facing side to S's, bowed toward the pointer
    const p0x = G.mR - W * 0.1 + offMx;
    const p0y = G.midY + offMy;
    const p2x = G.sL + W * 0.1 + offSx;
    const p2y = G.midY + offSy;
    const mx = (p0x + p2x) * 0.5;
    const my = (p0y + p2y) * 0.5;
    const p1x = mx + (aim.x - mx) * 0.6 * cc;
    const p1y = my + (aim.y - my) * 0.6 * cc;
    const rMax = H * T.drops * Math.pow(cc, 1.3);
    for (let i = 0; i < CHAIN; i++) {
      const d = drops[i];
      const t = (i + 0.5) / CHAIN;
      const u = 1 - t;
      let x = u * u * p0x + 2 * u * t * p1x + t * t * p2x;
      let y = u * u * p0y + 2 * u * t * p1y + t * t * p2y;
      y += Math.sin(time * 2.1 + i * 1.3) * H * 0.02 * cc;
      // Staggered follow — the mass flows rather than snaps
      const k = 0.07 + 0.05 * ((i * 7) % 3);
      if (d.x !== d.x) {
        d.x = x;
        d.y = y;
      }
      d.x = lerp(d.x, x, k);
      d.y = lerp(d.y, y, k);
      const r = rMax * (0.7 + 0.3 * Math.sin(t * Math.PI)) * (0.85 + 0.15 * Math.sin(time * 1.7 + i));
      d.node.setAttribute("cx", d.x.toFixed(1));
      d.node.setAttribute("cy", d.y.toFixed(1));
      d.node.setAttribute("r", Math.max(0, r).toFixed(1));
    }
    // Satellites: mass drawn out toward the pointer
    for (let j = 0; j < SATELLITES; j++) {
      const d = drops[CHAIN + j];
      const f = 0.3 + 0.16 * j;
      const x = lerp(mx, aim.x, f * cc);
      const y = lerp(my, aim.y, f * cc);
      if (d.x !== d.x) {
        d.x = x;
        d.y = y;
      }
      const k = 0.05 + 0.02 * j;
      d.x = lerp(d.x, x, k);
      d.y = lerp(d.y, y, k);
      const r = H * T.satellites * Math.pow(cc, 1.5) * (1 - 0.18 * j);
      d.node.setAttribute("cx", d.x.toFixed(1));
      d.node.setAttribute("cy", d.y.toFixed(1));
      d.node.setAttribute("r", Math.max(0, r).toFixed(1));
    }
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      mouse.active = true;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    },
    { passive: true }
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      clearTimeout(touchT);
      mouse.active = true;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    },
    { passive: true }
  );
  document.addEventListener(
    "pointerleave",
    () => {
      mouse.active = false;
    },
    { passive: true }
  );
  // Touch: after the finger lifts, linger briefly, then drift back to idle
  let touchT = null;
  const touchEnd = (e) => {
    if (e.pointerType === "mouse") return;
    clearTimeout(touchT);
    touchT = setTimeout(() => (mouse.active = false), 700);
  };
  window.addEventListener("pointerup", touchEnd, { passive: true });
  window.addEventListener("pointercancel", touchEnd, { passive: true });
  window.addEventListener(
    "blur",
    () => {
      mouse.active = false;
    },
    { passive: true }
  );
  window.addEventListener(
    "resize",
    () => {
      dirty = true;
    },
    { passive: true }
  );
  if (document.fonts) {
    document.fonts.ready.then(() => (dirty = true));
  }

  requestAnimationFrame(frame);
})();
