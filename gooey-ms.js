(() => {
  /**
   * Restrained gooey MS — Larose circle-along-path + SVG gooey filter.
   * Paths sampled via getPointAtLength; morph M ↔ MS ↔ S.
   */
  const home = document.getElementById("view-home");
  const circlesLayer = document.getElementById("ms-circles");
  const pathsLayer = document.getElementById("ms-paths");
  const stateBtns = [...document.querySelectorAll("[data-ms-shape]")];
  if (!home || !circlesLayer || !pathsLayer) return;

  // viewBox 0 0 320 260 — relative radius ~ Larose (20/256)
  const PATHS = {
    m: "M 40,230 L 40,40 L 110,170 L 180,40 L 180,230",
    s: "M 265,55 C 230,30 175,35 160,75 C 145,115 205,130 240,145 C 280,165 285,205 250,225 C 215,245 170,235 155,205",
    // Continuous MS snake through both columns (readable dual letter)
    ms: "M 35,230 L 35,40 L 95,165 L 155,40 L 155,230 L 155,195 C 170,240 220,250 255,225 C 290,200 295,155 260,130 C 225,105 185,120 190,155 C 195,185 240,190 270,170",
  };

  const NB = 30;
  const RADIUS = 20;
  const STAGGER = 0.012;
  const DURATION = 700;

  const order = ["m", "ms", "s"];
  let index = 1;
  let animToken = 0;
  const pathEls = {};
  const circleEls = [];

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
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

  function pointsFor(shapeIndex) {
    const path = pathEls[order[shapeIndex]];
    const length = path.getTotalLength();
    const pts = [];
    for (let i = 0; i < NB; i++) {
      const pt = path.getPointAtLength((length * i) / NB);
      pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  }

  function morphTo(shapeIndex, instant) {
    if (shapeIndex < 0 || shapeIndex > 2) return;
    index = shapeIndex;
    stateBtns.forEach((btn) => {
      const on = Number(btn.dataset.msShape) === index;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    const pts = pointsFor(index);
    const token = ++animToken;

    circleEls.forEach((circle, i) => {
      const target = pts[i];
      if (instant) {
        circle.setAttribute("cx", String(target.x));
        circle.setAttribute("cy", String(target.y));
        return;
      }
      const fromX = parseFloat(circle.getAttribute("cx")) || target.x;
      const fromY = parseFloat(circle.getAttribute("cy")) || target.y;
      const delay = i * STAGGER * 1000;
      const startAt = performance.now() + delay;

      const tick = (now) => {
        if (token !== animToken) return;
        if (now < startAt) {
          requestAnimationFrame(tick);
          return;
        }
        const t = Math.min(1, (now - startAt) / DURATION);
        const e = easeOutCubic(t);
        circle.setAttribute("cx", String(fromX + (target.x - fromX) * e));
        circle.setAttribute("cy", String(fromY + (target.y - fromY) * e));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  let lastAuto = 1;
  function shapeFromPointer(clientX) {
    const n = clientX / (window.innerWidth || 1);
    if (n < 0.34) return 0;
    if (n > 0.66) return 2;
    return 1;
  }

  home.addEventListener(
    "pointermove",
    (e) => {
      if (!home.classList.contains("is-active")) return;
      const next = shapeFromPointer(e.clientX);
      if (next !== lastAuto) {
        lastAuto = next;
        morphTo(next, false);
      }
    },
    { passive: true }
  );

  stateBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.msShape);
      lastAuto = i;
      morphTo(i, false);
    });
  });

  build();
  requestAnimationFrame(() => morphTo(1, true));
})();
