(() => {
  /**
   * Restrained gooey MS — Larose circle-along-path + SVG gooey filter.
   * Serif skeletons from Playfair-like metrics: bracketed foot/head serifs,
   * thicker outer stems (extra path travel), classic proportions.
   * Soft easeInOut + continuous pointer blend for organic motion.
   */
  const home = document.getElementById("view-home");
  const circlesLayer = document.getElementById("ms-circles");
  const pathsLayer = document.getElementById("ms-paths");
  const stateBtns = [...document.querySelectorAll("[data-ms-shape]")];
  if (!home || !circlesLayer || !pathsLayer) return;

  // viewBox 0 0 320 260 — serif centerlines (Playfair Display proportions)
  // Extra stem travel + out-and-back serifs thicken stems/terminals under goo.
  const PATHS = {
    m:
      // Left bracketed foot serif → thick left stem (double pass) → top serif
      // → left diagonal → crotch → right diagonal → top serif → thick right stem
      // → bracketed foot serif
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
      // High-contrast S: beak terminals, deep bowls (Playfair stress)
      "M 298,64 " +
      "C 296,36 268,20 232,20 " +
      "C 188,20 148,42 142,84 " +
      "C 136,122 168,142 218,156 " +
      "C 268,170 304,190 300,226 " +
      "C 296,260 258,272 210,266 " +
      "C 170,260 138,240 132,206",
    ms:
      // Continuous snake: serif M into serif S bowls
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
  const RADIUS = 18;
  const STAGGER = 0.005;
  const DURATION = 1300;
  const BLEND_EASE = 0.07;

  const order = ["m", "ms", "s"];
  let index = 1;
  let animToken = 0;
  const pathEls = {};
  const circleEls = [];
  let cachedPts = null;
  let blend = 1;
  let targetBlend = 1;
  let pointerDriven = true;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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

  function pointsAtBlend(b) {
    const clamped = Math.max(0, Math.min(2, b));
    const i0 = Math.floor(clamped);
    const i1 = Math.min(2, i0 + 1);
    const t = easeInOutCubic(clamped - i0);
    const a = cachedPts[i0];
    const c = cachedPts[i1];
    const out = [];
    for (let i = 0; i < NB; i++) {
      out.push({
        x: a[i].x + (c[i].x - a[i].x) * t,
        y: a[i].y + (c[i].y - a[i].y) * t,
      });
    }
    return out;
  }

  function applyPoints(pts) {
    for (let i = 0; i < NB; i++) {
      circleEls[i].setAttribute("cx", String(pts[i].x));
      circleEls[i].setAttribute("cy", String(pts[i].y));
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
      applyPoints(pointsAtBlend(blend));
      pointerDriven = true;
      return;
    }

    const fromPts = pointsAtBlend(blend);
    const toPts = pointsAtBlend(shapeIndex);
    const startAt = performance.now();

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

  function blendFromPointer(clientX) {
    const n = Math.max(0, Math.min(1, clientX / (window.innerWidth || 1)));
    return n * 2;
  }

  function nearestShape(b) {
    return Math.max(0, Math.min(2, Math.round(b)));
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!home.classList.contains("is-active")) return;
    if (!pointerDriven) return;

    const diff = targetBlend - blend;
    if (Math.abs(diff) < 0.0008) {
      if (blend !== targetBlend) {
        blend = targetBlend;
        applyPoints(pointsAtBlend(blend));
        syncButtons(nearestShape(blend));
      }
      return;
    }
    blend += diff * BLEND_EASE;
    applyPoints(pointsAtBlend(blend));
    const shape = nearestShape(blend);
    if (shape !== index) syncButtons(shape);
  }

  home.addEventListener(
    "pointermove",
    (e) => {
      if (!home.classList.contains("is-active")) return;
      targetBlend = blendFromPointer(e.clientX);
      if (!pointerDriven) {
        animToken++;
        pointerDriven = true;
      }
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
