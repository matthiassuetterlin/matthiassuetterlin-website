(() => {
  /**
   * Magnetic dot grid that carries the type.
   *
   * A grid of tiny squares at an even spacing of about one M stem (a little
   * more), laid out in page coordinates so it scrolls with the content.
   * Near the pointer the dots grow into squircles (superellipse
   * |x|^n + |y|^n = 1, n from ~30 down to 4) and are drawn towards it —
   * the closer, the stronger. Caught dots trail behind the pointer like on
   * a leash; once the pointer is too far from a dot's home, it lets go and
   * springs back with a little overshoot. Grown dots sit under a goo filter
   * like the MS, so dots that come close melt into each other. Their grey
   * follows an arc over their size (light at rest, darkest mid-size, white
   * at full size) while a hairline outline grows in along the melted
   * contour — at the pointer only the outline remains.
   *
   * Text hangs on the grid: main text (titles, project names, tagline)
   * stands above a grid line with a clear gap, its sub text hangs below the
   * same line with the same gap. Finer text uses a line height that divides
   * the grid evenly. Every letter is its own span and follows the vertical
   * shift of the dots around it.
   */
  const svg = document.getElementById("bg-grid");
  const letterM = document.getElementById("letter-m");
  if (!svg) return;

  const NS = "http://www.w3.org/2000/svg";
  const root = document.documentElement;

  // Tunable parameters (adjusted live by the settings menu, tune.js)
  const T = (window.gridTune = Object.assign(
    {
      spacing: 0.2, // grid step, × MS font size (rebuilds the layout)
      restSize: 2, // dot size at rest, px
      maxSize: 0.32, // dot size in full motion, × grid step
      catchR: 1.5, // pointer catches dots within this many grid steps
      leash: 2.4, // caught dots let go beyond this many grid steps
      pullNear: 0.9, // share of the way the nearest dots follow the pointer
      pullFar: 0.3, // … and the farthest caught ones
      follow: 0.2, // spring stiffness while caught
      spring: 0.07, // spring stiffness on the way home
      wobble: 0.86, // damping on the way home (higher = more overshoot)
      roundness: 4, // superellipse exponent in full motion (2 = circle)
      restColor: "#969696",
      peakColor: "#737373",
      fadeColor: "#ffffff",
      peakAt: 0.35, // share of the full size where the dot is darkest
      goo: 0.45, // blur that melts dots together, × max size
      outline: true,
      outlineColor: "#737373",
      outlineWidth: 1, // px-ish
      outlineFrom: 0.6, // fill lightness from which the outline appears
      textFollow: 0.6, // how much the text follows the dots' vertical shift
    },
    window.gridTune || {}
  ));
  const hexCache = {};
  function rgb(hex) {
    let c = hexCache[hex];
    if (!c) {
      const n = parseInt(String(hex).replace("#", ""), 16) || 0;
      c = hexCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c;
  }

  // Main text stands above a line, sub text hangs below it
  const MAIN = ".panel h2, .project-name, .tagline";
  const SUB = ".panel p, .facts li, .local-nav, .project-meta, .home-hint";
  const CAP = 0.716; // cap height of Helvetica/Arial per em
  const SPLIT = ".panel, .tagline, .home-hint";

  let cols = 0;
  let rows = 0;
  const active = new Set(); // dots that are moving, grown or caught
  let dots = [];
  let dotHalf = 1; // half size at rest
  let dotMax = 11; // half size in full motion
  let crisp = null;
  let gooG = null;
  let gooFilter = null;
  let letters = [];
  let W = 0;
  let D = 0; // document height
  let spacing = 70;
  let unit = 35;
  let gap = 14;
  let ox = 0;
  let oy = 0;
  let raf = null;
  let lettersMoved = false;
  // Pointer in client coordinates (page = client + scroll, so dots also
  // react while the page scrolls under a resting mouse)
  const ptr = { x: NaN, y: NaN, on: false, touch: false };
  const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Haptic tick. Android: Vibration API. iOS has none for the web, but
  // Safari (iOS 18+) ticks when a native switch is toggled from a user
  // gesture (e.g. touchend) — so briefly add a hidden switch and click it.
  const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  function haptic() {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(6);
        return;
      }
      if (!coarse) return;
      const label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.display = "none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      label.remove();
    } catch (err) {
      /* no haptics here */
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // --- Letters ---------------------------------------------------------

  function split(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeValue.trim() && !n.parentElement.closest(".gc")) nodes.push(n);
    }
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of n.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          continue;
        }
        const w = document.createElement("span");
        w.className = "gw";
        for (const ch of part) {
          const c = document.createElement("span");
          c.className = "gc";
          c.textContent = ch;
          w.appendChild(c);
        }
        frag.appendChild(w);
      }
      n.replaceWith(frag);
    }
  }

  function visible(el) {
    return el.offsetParent !== null || getComputedStyle(el).position === "fixed";
  }

  // --- Snapping ----------------------------------------------------------

  function baseline(el) {
    const first = el.querySelector(".gc");
    if (!first) return null;
    const probe = document.createElement("span");
    probe.className = "gp";
    first.before(probe);
    const y = probe.getBoundingClientRect().top + window.scrollY;
    probe.remove();
    return y;
  }

  function lastBaseline(el) {
    const all = el.querySelectorAll(".gc");
    const last = all[all.length - 1];
    if (!last) return null;
    const probe = document.createElement("span");
    probe.className = "gp";
    last.after(probe);
    const y = probe.getBoundingClientRect().top + window.scrollY;
    probe.remove();
    return y;
  }

  function capOf(el) {
    return (parseFloat(getComputedStyle(el).fontSize) || 16) * CAP;
  }

  // Move a block so its first baseline lands on target() (margins zeroed
  // around snapped blocks, so a margin-top shift is exact). The target is
  // re-read each time because centred layouts move when a block moves.
  function placeAt(el, target) {
    for (let k = 0; k < 4; k++) {
      const d = target() - baseline(el);
      if (Math.abs(d) < 0.2) return;
      const m = parseFloat(el.style.marginTop) || 0;
      el.style.setProperty("margin-top", `${(m + d).toFixed(2)}px`, "important");
    }
  }

  // Lay each container out relative to its first anchor line, then move the
  // container onto the grid with relative positioning, which leaves the
  // centring untouched. All positions are kept relative to that anchor.
  function snapText() {
    const sel = `${MAIN}, ${SUB}`;
    for (const box of document.querySelectorAll(".panel, .home-inner")) {
      box.style.removeProperty("top");
      const blocks = [...box.querySelectorAll(sel)].filter((el) => el.querySelector(".gc"));
      for (const el of blocks) {
        el.style.setProperty("margin-top", "0px", "important");
        el.style.setProperty("margin-bottom", "0px", "important");
      }
      if (!visible(box) || !blocks.length) continue;

      const first = blocks[0];
      const firstCap = capOf(first);
      const firstSpan = lastBaseline(first) - baseline(first);
      // Anchor line of the first block, measured fresh every time
      const a0 = first.matches(MAIN) ? firstSpan + gap : -firstCap - gap;
      const A = () => baseline(first) + a0;

      let line = 0; // current anchor line, relative to A
      let prevEnd = 0; // previous block's last baseline + descent, relative to A
      let prev = null;
      for (const el of blocks) {
        const main = el.matches(MAIN);
        const cap = capOf(el);
        const span = lastBaseline(el) - baseline(el);
        let rel;
        if (el === first) {
          rel = -a0;
        } else if (main) {
          // Next line with room: the cap top clears the previous block
          line = Math.max(line + spacing, Math.ceil((prevEnd + gap + cap + span + gap) / spacing) * spacing);
          rel = line - gap - span;
        } else if (prev && prev.matches(MAIN)) {
          rel = line + gap + cap; // hangs from the main text's line
        } else if (prev && prev.tagName === "LI" && el.tagName === "LI") {
          rel = prevEnd - cap * 0.3 + unit; // list items follow line by line
        } else {
          // New paragraph / group: hang from the next free line
          line = Math.ceil((prevEnd + gap) / spacing) * spacing;
          rel = line + gap + cap;
        }
        if (el !== first) placeAt(el, () => A() + rel);
        prevEnd = lastBaseline(el) + cap * 0.3 - A();
        prev = el;
      }
      const a = A();
      const shift = oy + Math.round((a - oy) / spacing) * spacing - a;
      box.style.position = "relative";
      box.style.top = `${shift.toFixed(2)}px`;
    }
  }

  function measureLetters() {
    letters = [];
    for (const c of document.querySelectorAll(".gc")) {
      c.style.transform = "";
      if (!visible(c)) continue;
      const r = c.getBoundingClientRect();
      letters.push({ el: c, x: r.left + r.width / 2, y: r.top + window.scrollY + r.height * 0.72, dy: 0 });
    }
  }

  // --- Grid --------------------------------------------------------------

  function build() {
    const fontPx = letterM ? parseFloat(getComputedStyle(letterM).fontSize) : 0;
    // M stem ≈ 0.165 em; the grid runs a little wider
    spacing = Math.max(36, Math.round((fontPx || 350) * T.spacing));
    unit = spacing / Math.max(1, Math.round(spacing / 30));
    gap = Math.max(9, Math.round(spacing * 0.2));
    root.style.setProperty("--grid", `${spacing}px`);
    root.style.setProperty("--lh", `${unit}px`);
    W = root.clientWidth;
    ox = (W / 2) % spacing;
    oy = (window.innerHeight / 2) % spacing;

    snapText();

    D = Math.max(window.innerHeight, root.scrollHeight);
    // Pages that don't scroll hand vertical finger moves to the grid too
    root.classList.toggle("grid-scrolls", D > window.innerHeight + 2);
    svg.setAttribute("viewBox", `0 0 ${W} ${D}`);
    svg.style.width = `${W}px`;
    svg.style.height = `${D}px`;
    svg.textContent = "";
    dots = [];
    sizes();
    const defs = document.createElementNS(NS, "defs");
    gooFilter = document.createElementNS(NS, "filter");
    gooFilter.id = "dot-goo";
    // Region is set per frame to the grown dots' bounds (see step)
    gooFilter.setAttribute("filterUnits", "userSpaceOnUse");
    gooFilter.setAttribute("color-interpolation-filters", "sRGB");
    defs.appendChild(gooFilter);
    setFilter();
    crisp = document.createElementNS(NS, "g");
    crisp.setAttribute("class", "dots");
    gooG = document.createElementNS(NS, "g");
    gooG.setAttribute("class", "dots");
    gooG.setAttribute("filter", "url(#dot-goo)");
    svg.append(defs, crisp, gooG);
    // One square per grid crossing; each has a home and moves freely
    cols = 0;
    rows = 0;
    for (let x = ox; x <= W; x += spacing) cols++;
    for (let y = oy; y <= D; y += spacing) rows++;
    active.clear();
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const hx = ox + j * spacing;
        const hy = oy + i * spacing;
        const el = document.createElementNS(NS, "path");
        crisp.appendChild(el);
        const d = { i, j, hx, hy, px: hx, py: hy, vx: 0, vy: 0, caught: false, s: 0, round: 0, el, x: NaN, y: NaN, n: NaN, a: NaN, inGoo: false, grey: -1 };
        drawDot(d, hx, hy, 0);
        dots.push(d);
      }
    }

    measureLetters();
  }

  function sizes() {
    dotHalf = Math.max(0.5, T.restSize / 2);
    dotMax = Math.max(dotHalf * 3.5, (spacing * T.maxSize) / 2);
  }

  // Goo filter: melt grown dots; optional hairline outline along the
  // melted contour (the band between the goo edge and a slightly higher
  // threshold of the same blur — cheap, no morphology), tinted and faded
  // in by how light the fill is, so at the pointer only it remains.
  function setFilter() {
    const f = gooFilter;
    if (!f) return;
    f.textContent = "";
    const prim = (tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      f.appendChild(el);
      return el;
    };
    prim("feGaussianBlur", { in: "SourceGraphic", stdDeviation: (dotMax * T.goo).toFixed(2), result: "blur" });
    // Keep each dot's own colour; only the alpha is thresholded
    prim("feColorMatrix", { in: "blur", type: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -9", result: "goo" });
    if (!T.outline) return;
    const edge = 0.3958 + 0.0135 * T.outlineWidth; // inner threshold (alpha)
    prim("feColorMatrix", {
      in: "blur",
      type: "matrix",
      values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 40 ${(-(40 * edge - 0.5)).toFixed(2)}`,
      result: "inner",
    });
    const [r, g, b] = rgb(T.outlineColor).map((v) => (v / 255).toFixed(3));
    const k = 1 / Math.max(0.05, 1 - T.outlineFrom);
    prim("feColorMatrix", {
      in: "goo",
      type: "matrix",
      values: `0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${k.toFixed(2)} 0 0 0 ${(-k * T.outlineFrom).toFixed(2)}`,
      result: "tint",
    });
    prim("feComposite", { in: "tint", in2: "inner", operator: "out", result: "line" });
    const merge = prim("feMerge", {});
    for (const n of ["goo", "line"]) {
      const node = document.createElementNS(NS, "feMergeNode");
      node.setAttribute("in", n);
      merge.appendChild(node);
    }
  }

  // Square (round = 0) to squircle (round = 1): superellipse with
  // exponent n, drawn as a closed polygon fine enough for a few pixels
  const SEG = 32;
  const COS = [];
  const SIN = [];
  for (let k = 0; k < SEG; k++) {
    COS.push(Math.cos((k / SEG) * Math.PI * 2));
    SIN.push(Math.sin((k / SEG) * Math.PI * 2));
  }
  function drawDot(d, x, y, round) {
    const n = 30 - (30 - T.roundness) * Math.pow(round, 0.7);
    const a = dotHalf + (dotMax - dotHalf) * Math.pow(round, 1.2);
    if (Math.abs(x - d.x) < 0.05 && Math.abs(y - d.y) < 0.05 && Math.abs(n - d.n) < 0.2 && Math.abs(a - d.a) < 0.05) return;
    d.x = x;
    d.y = y;
    d.n = n;
    d.a = a;
    // Colour arc: rest colour → peak colour at mid size → fade colour (white
    // by default, i.e. invisible) at full size
    const grow = (a - dotHalf) / (dotMax - dotHalf);
    const pk = Math.min(0.95, Math.max(0.05, T.peakAt));
    let from;
    let to;
    let t;
    if (grow <= pk) {
      from = rgb(T.restColor);
      to = rgb(T.peakColor);
      t = grow / pk;
    } else {
      from = rgb(T.peakColor);
      to = rgb(T.fadeColor);
      t = (grow - pk) / (1 - pk);
    }
    t = t * t * (3 - 2 * t);
    const fill = `rgb(${Math.round(from[0] + (to[0] - from[0]) * t)},${Math.round(from[1] + (to[1] - from[1]) * t)},${Math.round(from[2] + (to[2] - from[2]) * t)})`;
    if (fill !== d.grey) {
      d.el.setAttribute("fill", fill);
      d.grey = fill;
    }
    // Big enough to survive the goo threshold → melt with neighbours
    const goo = a > dotHalf * 3;
    if (goo !== d.inGoo) {
      (goo ? gooG : crisp).appendChild(d.el);
      d.inGoo = goo;
    }
    if (n > 29) {
      d.el.setAttribute("d", `M${(x - a).toFixed(2)} ${(y - a).toFixed(2)}h${2 * a}v${2 * a}h${-2 * a}z`);
      return;
    }
    const e = 2 / n;
    let path = "";
    for (let k = 0; k < SEG; k++) {
      const c = COS[k];
      const s = SIN[k];
      const px = x + a * Math.sign(c) * Math.pow(Math.abs(c), e);
      const py = y + a * Math.sign(s) * Math.pow(Math.abs(s), e);
      path += `${k ? "L" : "M"}${px.toFixed(2)} ${py.toFixed(2)}`;
    }
    d.el.setAttribute("d", path + "z");
  }

  // --- Physics -----------------------------------------------------------

  function pointerPage() {
    return ptr.on ? { x: ptr.x + window.scrollX, y: ptr.y + window.scrollY } : null;
  }

  // Dots whose home lies within r of p are woken up
  function wakeAround(p, r) {
    const j0 = Math.max(0, Math.floor((p.x - r - ox) / spacing));
    const j1 = Math.min(cols - 1, Math.ceil((p.x + r - ox) / spacing));
    const i0 = Math.max(0, Math.floor((p.y - r - oy) / spacing));
    const i1 = Math.min(rows - 1, Math.ceil((p.y + r - oy) / spacing));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) active.add(dots[i * cols + j]);
  }

  function step() {
    const rCatch = spacing * T.catchR;
    const rBreak = spacing * Math.max(T.leash, T.catchR + 0.1);
    const rGrow = spacing * (T.catchR + 0.2);
    const C = pointerPage();
    if (C) wakeAround(C, rBreak);
    let snapped = false;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const d of active) {
      const toHome = C ? Math.hypot(C.x - d.hx, C.y - d.hy) : Infinity;
      if (C && !d.caught && toHome < rCatch) {
        // Caught: nearer dots follow the pointer more closely
        d.caught = true;
        d.s = T.pullFar + (T.pullNear - T.pullFar) * Math.pow(1 - toHome / rCatch, 0.7);
      } else if (d.caught && toHome > rBreak) {
        d.caught = false; // leash breaks: spring home
        snapped = true;
      }
      const tx = d.caught ? d.hx + (C.x - d.hx) * d.s : d.hx;
      const ty = d.caught ? d.hy + (C.y - d.hy) * d.s : d.hy;
      // Caught: firm, slightly lagging follow. Free: softer, overshooting
      const k = d.caught ? T.follow : T.spring;
      const damp = d.caught ? 0.72 : T.wobble;
      d.vx = (d.vx + (tx - d.px) * k) * damp;
      d.vy = (d.vy + (ty - d.py) * k) * damp;
      d.px += d.vx;
      d.py += d.vy;
      // Grow near the pointer and while displaced
      const near = C ? Math.max(0, 1 - Math.hypot(C.x - d.px, C.y - d.py) / rGrow) : 0;
      const off = Math.hypot(d.px - d.hx, d.py - d.hy);
      const target = Math.min(1, Math.max(near, off / (spacing * 0.9)));
      d.round += (target - d.round) * (target > d.round ? 0.3 : 0.07);
      const resting = !d.caught && d.round < 0.01 && off < 0.05 && Math.abs(d.vx) + Math.abs(d.vy) < 0.02;
      if (resting) {
        d.round = 0;
        d.px = d.hx;
        d.py = d.hy;
        d.vx = 0;
        d.vy = 0;
        active.delete(d);
      }
      drawDot(d, d.px, d.py, d.round);
      if (d.inGoo) {
        if (d.x < x0) x0 = d.x;
        if (d.x > x1) x1 = d.x;
        if (d.y < y0) y0 = d.y;
        if (d.y > y1) y1 = d.y;
      }
    }
    // Filter only where grown dots are (+ room for size and blur)
    if (x1 >= x0 && gooFilter) {
      const m = dotMax * 3;
      gooFilter.setAttribute("x", (x0 - m).toFixed(0));
      gooFilter.setAttribute("y", (y0 - m).toFixed(0));
      gooFilter.setAttribute("width", (x1 - x0 + 2 * m).toFixed(0));
      gooFilter.setAttribute("height", (y1 - y0 + 2 * m).toFixed(0));
    }
    if (snapped && ptr.touch) haptic();
  }

  // Vertical shift of the dot field at (x, y): bilinear between the four
  // surrounding dots
  function shiftAt(x, y) {
    const fx = (x - ox) / spacing;
    const fy = (y - oy) / spacing;
    const j = Math.floor(fx);
    const i = Math.floor(fy);
    const tx = fx - j;
    const ty = fy - i;
    const at = (ii, jj) => {
      if (ii < 0 || jj < 0 || ii >= rows || jj >= cols) return 0;
      const d = dots[ii * cols + jj];
      return d.py - d.hy;
    };
    const top = lerp(at(i, j), at(i, j + 1), tx);
    const bottom = lerp(at(i + 1, j), at(i + 1, j + 1), tx);
    return lerp(top, bottom, ty);
  }

  function moveLetters() {
    for (const L of letters) {
      // Text follows the field a little softer than the dots, to stay readable
      const dy = calm ? 0 : shiftAt(L.x, L.y) * T.textFollow;
      if (Math.abs(dy - L.dy) > 0.05) {
        L.dy = dy;
        L.el.style.transform = dy ? `translateY(${dy.toFixed(2)}px)` : "";
      }
    }
  }

  function tick() {
    raf = null;
    step();
    if (active.size || lettersMoved) {
      moveLetters();
      lettersMoved = active.size > 0;
    }
    if (active.size || ptr.on) kick();
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // --- Input ---------------------------------------------------------------

  function point(x, y, touch) {
    ptr.x = x;
    ptr.y = y;
    ptr.on = true;
    ptr.touch = touch;
    kick();
  }
  function leave() {
    ptr.on = false;
    kick(); // let caught dots go home
  }

  window.addEventListener("pointermove", (e) => point(e.clientX, e.clientY, e.pointerType !== "mouse"), { passive: true });
  window.addEventListener("pointerdown", (e) => point(e.clientX, e.clientY, e.pointerType !== "mouse"), { passive: true });
  document.addEventListener("pointerleave", leave, { passive: true });
  window.addEventListener("blur", leave, { passive: true });
  // While the browser scrolls, pointer events stop (pointercancel) but touch
  // events keep coming: the finger keeps dragging dots
  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t) point(t.clientX, t.clientY, true);
    },
    { passive: true }
  );
  const touchEnd = (e) => {
    if (e.touches.length) return;
    leave();
  };
  window.addEventListener("touchend", touchEnd, { passive: true });
  window.addEventListener("touchcancel", touchEnd, { passive: true });

  // Scrolling nudges the visible dots: they lag a little and wobble back
  let lastY = window.scrollY;
  let lastT = performance.now();
  window.addEventListener(
    "scroll",
    () => {
      const now = performance.now();
      const v = ((window.scrollY - lastY) / Math.max(8, now - lastT)) * 16; // px per frame
      lastY = window.scrollY;
      lastT = now;
      if (calm || Math.abs(v) < 1.5 || !dots.length) {
        kick();
        return;
      }
      const top = Math.max(0, Math.floor((window.scrollY - oy) / spacing));
      const bottom = Math.min(rows - 1, Math.ceil((window.scrollY + window.innerHeight - oy) / spacing));
      const push = Math.max(-spacing * 0.3, Math.min(spacing * 0.3, v * 0.35));
      for (let i = top; i <= bottom; i++) {
        for (let j = 0; j < cols; j++) {
          const d = dots[i * cols + j];
          d.vy += push * (0.8 + 0.2 * Math.sin(d.hx * 0.05));
          active.add(d);
        }
      }
      kick();
    },
    { passive: true }
  );

  // --- Settings hooks (tune.js) --------------------------------------------

  // Sizes, colours, outline and goo change in place; spacing needs a rebuild
  window.gridRefresh = () => {
    sizes();
    setFilter();
    for (const d of dots) {
      d.a = NaN;
      drawDot(d, d.px, d.py, d.round);
    }
  };
  window.gridRebuild = () => scheduleBuild(80);

  // --- Lifecycle ---------------------------------------------------------

  let buildT = null;
  function scheduleBuild(delay) {
    clearTimeout(buildT);
    buildT = setTimeout(build, delay);
  }

  for (const el of document.querySelectorAll(SPLIT)) split(el);
  window.addEventListener("resize", () => scheduleBuild(120), { passive: true });
  const stage = document.getElementById("stage");
  if (stage) {
    new MutationObserver(() => scheduleBuild(0)).observe(stage, {
      attributes: true,
      attributeFilter: ["hidden"],
      subtree: true,
    });
  }
  if (document.fonts) document.fonts.ready.then(build);
  build();
})();
