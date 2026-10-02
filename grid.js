(() => {
  /**
   * Pluckable grid that carries the type.
   *
   * Horizontal and vertical lines at an even spacing of about one M stem
   * (a little more), laid out in page coordinates so they scroll with the
   * content. Crossing a line grabs it; it follows the pointer until it
   * snaps free and swings out like a plucked string.
   *
   * The lines themselves are invisible: only their crossings are drawn, as
   * tiny squares that ride both lines. As soon as one moves it grows and
   * its corners round into a squircle (superellipse |x|^n + |y|^n = 1,
   * n from ~30 down to 4). Its grey follows an arc over its size: light
   * grey at rest, darkest at mid size (swinging out, melting), fading to
   * white at full size — while a hairline outline along the (melted)
   * contour grows in, so at the pointer only the outline remains. Moving dots sit under a goo filter
   * like the MS, so when they come close they melt into each other.
   * Settling, they shrink and sharpen back into tiny grey squares.
   *
   * Text hangs on the grid: main text (titles, project names, tagline)
   * stands above a grid line with a clear gap, its sub text hangs below the
   * same line with the same gap. Finer text uses a line height that divides
   * the grid evenly. Every letter is its own span and rides the horizontal
   * lines: near a line it moves with it, between two lines proportionally.
   */
  const svg = document.getElementById("bg-grid");
  const letterM = document.getElementById("letter-m");
  if (!svg) return;

  const NS = "http://www.w3.org/2000/svg";
  const root = document.documentElement;

  // Main text stands above a line, sub text hangs below it
  const MAIN = ".panel h2, .project-name, .tagline";
  const SUB = ".panel p, .facts li, .local-nav, .project-meta, .home-hint";
  const CAP = 0.716; // cap height of Helvetica/Arial per em
  const SPLIT = ".panel, .tagline, .home-hint";

  let hLines = [];
  let dots = [];
  let dotHalf = 1; // half size at rest
  let dotMax = 11; // half size in full motion
  let crisp = null;
  let gooG = null;
  let gooBlur = null;
  let gooFilter = null;
  let vLines = [];
  let letters = [];
  let W = 0;
  let D = 0; // document height
  let spacing = 70;
  let unit = 35;
  let gap = 14;
  let ox = 0;
  let oy = 0;
  let snapDist = 90;
  let raf = null;
  let moved = false;
  const ptr = { x: NaN, y: NaN };
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
    spacing = Math.max(36, Math.round((fontPx || 350) * 0.2));
    unit = spacing / Math.max(1, Math.round(spacing / 30));
    gap = Math.max(9, Math.round(spacing * 0.2));
    snapDist = Math.max(40, spacing * 1.4);
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
    dotHalf = Math.max(1, spacing * 0.014); // ≥ 2 px, also on phones
    dotMax = Math.max(5, spacing * 0.16);
    // Resting dots stay crisp; moving ones go into the goo group
    const defs = document.createElementNS(NS, "defs");
    const f = document.createElementNS(NS, "filter");
    f.id = "dot-goo";
    // Region is set per frame to the moving dots' bounds (see moveDots)
    f.setAttribute("filterUnits", "userSpaceOnUse");
    gooFilter = f;
    f.setAttribute("color-interpolation-filters", "sRGB");
    gooBlur = document.createElementNS(NS, "feGaussianBlur");
    gooBlur.setAttribute("in", "SourceGraphic");
    gooBlur.setAttribute("result", "blur");
    gooBlur.setAttribute("stdDeviation", (dotMax * 0.45).toFixed(2));
    const cm = document.createElementNS(NS, "feColorMatrix");
    cm.setAttribute("type", "matrix");
    // Keep each dot's own grey (it fades to white as it grows); only the
    // alpha is thresholded
    cm.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -9");
    cm.setAttribute("result", "goo");
    // Hairline outline along the melted contour: the band between the goo
    // edge and a slightly higher threshold of the same blur (cheap — no
    // morphology). Its strength follows how light the fill is, so it
    // appears as a dot grows and whitens; at the pointer only it remains.
    const prim = (tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };
    const inner = prim("feColorMatrix", {
      in: "blur",
      type: "matrix",
      values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 40 -16.4",
      result: "inner",
    });
    // Light fill → opaque outline (alpha from the red channel, from ~60 % up)
    const tint = prim("feColorMatrix", {
      in: "goo",
      type: "matrix",
      values: `0 0 0 0 ${OUTLINE}  0 0 0 0 ${OUTLINE}  0 0 0 0 ${OUTLINE}  2.6 0 0 0 -1.55`,
      result: "tint",
    });
    // Light parts of the shape, minus its inside → only the edge band stays
    const line = prim("feComposite", { in: "tint", in2: "inner", operator: "out", result: "line" });
    const merge = prim("feMerge", {});
    merge.append(prim("feMergeNode", { in: "goo" }), prim("feMergeNode", { in: "line" }));
    f.append(gooBlur, cm, inner, tint, line, merge);
    defs.appendChild(f);
    crisp = document.createElementNS(NS, "g");
    crisp.setAttribute("class", "dots");
    gooG = document.createElementNS(NS, "g");
    gooG.setAttribute("class", "dots");
    gooG.setAttribute("filter", "url(#dot-goo)");
    svg.append(defs, crisp, gooG);
    hLines = [];
    vLines = [];
    const add = (list, vertical, pos) => {
      list.push({ vertical, pos, progress: 0, cur: 0, at: 0.5, time: 0, grabbed: false, swinging: false });
    };
    for (let y = oy; y <= D; y += spacing) add(hLines, false, y);
    for (let x = ox; x <= W; x += spacing) add(vLines, true, x);
    // One square per crossing
    for (const h of hLines) {
      for (const v of vLines) {
        const el = document.createElementNS(NS, "path");
        crisp.appendChild(el);
        const d = { h, v, el, round: 0, x: NaN, y: NaN, n: NaN, a: NaN, inGoo: false, grey: -1 };
        drawDot(d, v.pos, h.pos, 0);
        dots.push(d);
      }
    }

    measureLetters();
  }

  // The lines only carry state; the crossings are what gets drawn
  function draw(l, p) {
    l.cur = p;
  }

  // Square (round = 0) to squircle (round = 1): superellipse with
  // exponent n, drawn as a closed polygon fine enough for a few pixels
  const SEG = 32;
  const REST_GREY = 150; // ≈ 40 % black on white
  const PEAK_GREY = 115; // ≈ 55 % — most visible while swinging out
  const PEAK_AT = 0.35; // share of the full size where it is darkest
  const OUTLINE = 0.45; // outline grey (0 black … 1 white) of grown dots
  const COS = [];
  const SIN = [];
  for (let k = 0; k < SEG; k++) {
    COS.push(Math.cos((k / SEG) * Math.PI * 2));
    SIN.push(Math.sin((k / SEG) * Math.PI * 2));
  }
  function drawDot(d, x, y, round) {
    const n = 30 - 26 * Math.pow(round, 0.7);
    const a = dotHalf + (dotMax - dotHalf) * Math.pow(round, 1.2);
    if (Math.abs(x - d.x) < 0.05 && Math.abs(y - d.y) < 0.05 && Math.abs(n - d.n) < 0.2 && Math.abs(a - d.a) < 0.05) return;
    d.x = x;
    d.y = y;
    d.n = n;
    d.a = a;
    // Visibility arc: rest grey → darkest at mid size → white at full size
    const grow = (a - dotHalf) / (dotMax - dotHalf);
    let grey;
    if (grow <= PEAK_AT) {
      const t = grow / PEAK_AT;
      grey = REST_GREY + (PEAK_GREY - REST_GREY) * t * t * (3 - 2 * t);
    } else {
      const t = (grow - PEAK_AT) / (1 - PEAK_AT);
      grey = PEAK_GREY + (255 - PEAK_GREY) * t * t * (3 - 2 * t);
    }
    grey = Math.round(grey);
    if (grey !== d.grey) {
      d.el.setAttribute("fill", `rgb(${grey},${grey},${grey})`);
      d.grey = grey;
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

  // Move every crossing with its two lines; round it while it moves
  function moveDots() {
    let settling = false;
    const full = spacing * 0.2;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const d of dots) {
      const dx = offsetAt(d.v, d.h.pos);
      const dy = offsetAt(d.h, d.v.pos);
      const target = Math.min(1, (Math.abs(dx) + Math.abs(dy)) / full);
      // Round up quickly, sharpen back slowly
      d.round += (target - d.round) * (target > d.round ? 0.35 : 0.08);
      if (d.round < 0.01) d.round = 0;
      else settling = true;
      drawDot(d, d.v.pos + dx, d.h.pos + dy, d.round);
      if (d.inGoo) {
        if (d.x < x0) x0 = d.x;
        if (d.x > x1) x1 = d.x;
        if (d.y < y0) y0 = d.y;
        if (d.y > y1) y1 = d.y;
      }
    }
    // Filter only where moving dots are (+ room for size and blur)
    if (x1 >= x0 && gooFilter) {
      const m = dotMax * 3;
      gooFilter.setAttribute("x", (x0 - m).toFixed(0));
      gooFilter.setAttribute("y", (y0 - m).toFixed(0));
      gooFilter.setAttribute("width", (x1 - x0 + 2 * m).toFixed(0));
      gooFilter.setAttribute("height", (y1 - y0 + 2 * m).toFixed(0));
    }
    return settling;
  }

  // Offset of a line at position s along it (x for horizontal, y for vertical)
  function offsetAt(l, s) {
    if (!l || l.cur === 0) return 0;
    const len = l.vertical ? D : W;
    const c = len * l.at;
    const a = len - 2 * c;
    let t;
    if (Math.abs(a) < 1e-6) t = s / (2 * c || 1);
    else t = (-2 * c + Math.sqrt(Math.max(0, 4 * c * c + 4 * a * s))) / (2 * a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return 2 * t * (1 - t) * l.cur;
  }

  function moveLetters() {
    for (const L of letters) {
      const fy = (L.y - oy) / spacing;
      const i = Math.floor(fy);
      const dy = lerp(offsetAt(hLines[i], L.x), offsetAt(hLines[i + 1], L.x), fy - i);
      if (Math.abs(dy - L.dy) > 0.05) {
        L.dy = dy;
        L.el.style.transform = dy ? `translateY(${dy.toFixed(2)}px)` : "";
      }
    }
  }

  // --- Plucking ----------------------------------------------------------

  function release(l) {
    l.grabbed = false;
    if (Math.abs(l.progress) > 0.75) {
      l.swinging = true;
      l.time = Math.PI / 2;
    } else {
      l.progress = 0;
      draw(l, 0);
    }
    kick();
  }

  function tick() {
    raf = null;
    let busy = false;
    for (const list of [hLines, vLines]) {
      for (const l of list) {
        if (l.grabbed) busy = true;
        if (!l.swinging) continue;
        const p = l.progress * Math.sin(l.time);
        l.progress = lerp(l.progress, 0, 0.03);
        l.time += 0.2;
        if (Math.abs(l.progress) > 0.75) {
          draw(l, p);
          busy = true;
        } else {
          l.swinging = false;
          l.progress = 0;
          draw(l, 0);
        }
      }
    }
    if (busy || moved) {
      moveLetters();
      if (moveDots()) busy = true;
      moved = busy;
    }
    if (busy) kick();
  }

  function kick() {
    moved = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function onMove(x, y, snap) {
    const px = ptr.x;
    const py = ptr.y;
    ptr.x = x;
    ptr.y = y;
    if (px !== px) return;
    for (const list of [hLines, vLines]) {
      for (const l of list) {
        const c = l.vertical ? x : y;
        const prev = l.vertical ? px : py;
        if (!l.grabbed && (prev - l.pos) * (c - l.pos) <= 0 && prev !== c) {
          l.grabbed = true;
          l.swinging = false;
        }
        if (!l.grabbed) continue;
        const pull = c - l.pos;
        l.at = Math.min(1, Math.max(0, l.vertical ? y / D : x / W));
        if (Math.abs(pull) > snap) {
          release(l);
          // A short tick under the finger when a line snaps free (Android)
          if (snap !== snapDist) haptic();
          continue;
        }
        l.progress = pull * 2;
        draw(l, l.progress);
        kick();
      }
    }
  }

  // Fingers drag lines about one grid step before they snap — further and
  // the dense phone grid pushes lines of text into each other
  const touchSnap = () => Math.max(40, spacing * 1.1);
  window.addEventListener(
    "pointermove",
    (e) => onMove(e.pageX, e.pageY, e.pointerType === "mouse" ? snapDist : touchSnap()),
    { passive: true }
  );

  // Pluck one line, as if flicked at x: it swings out from `amp`
  function flick(l, x, amp) {
    if (!l || l.grabbed) return;
    const cur = l.swinging ? l.progress * Math.sin(l.time) : 0;
    if (Math.abs(amp) < Math.abs(cur) + 1) return;
    l.at = Math.min(1, Math.max(0, x / W));
    l.progress = amp;
    l.time = Math.PI / 2;
    l.swinging = true;
    kick();
  }

  // --- Touch ---------------------------------------------------------------
  // While the browser scrolls, pointer events stop (pointercancel) but touch
  // events keep coming: use them so the grid still follows the finger.
  let finger = null; // client position of the finger, while it's down
  let lastFingerX = NaN;
  let pointerLive = false;
  let tap = null;
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "mouse") pointerLive = true;
    },
    { passive: true }
  );
  window.addEventListener("pointercancel", () => (pointerLive = false), { passive: true });
  window.addEventListener("pointerup", () => (pointerLive = false), { passive: true });
  window.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      finger = { x: t.clientX, y: t.clientY };
      lastFingerX = t.clientX;
      tap = e.touches.length === 1 ? { x: t.pageX, y: t.pageY, t: performance.now() } : null;
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      finger = { x: t.clientX, y: t.clientY };
      lastFingerX = t.clientX;
      // Sideways moves still pluck vertical lines while the page scrolls
      if (!pointerLive) onMove(t.pageX, t.pageY, touchSnap());
    },
    { passive: true }
  );
  const touchEnd = (e) => {
    if (e.touches.length) return;
    finger = null;
    if (!pointerLive) releaseAll();
    // Tap on empty space: pluck the nearest horizontal line there. Runs in
    // touchend, which iOS accepts as a user gesture for the haptic tick.
    const t = e.changedTouches[0];
    if (tap && t && e.type === "touchend" && !(e.target.closest && e.target.closest("button, a"))) {
      const moved = Math.hypot(t.pageX - tap.x, t.pageY - tap.y);
      if (moved < 10 && performance.now() - tap.t < 350) {
        const l = hLines[Math.round((t.pageY - oy) / spacing)];
        if (l) {
          let pull = t.pageY - l.pos;
          if (Math.abs(pull) < spacing * 0.25) pull = spacing * 0.5 * (pull < 0 ? -1 : 1);
          flick(l, t.pageX, pull * 2.4);
          haptic();
        }
      }
    }
    tap = null;
  };
  window.addEventListener("touchend", touchEnd, { passive: true });
  window.addEventListener("touchcancel", touchEnd, { passive: true });

  const releaseAll = () => {
    ptr.x = NaN;
    ptr.y = NaN;
    for (const list of [hLines, vLines]) for (const l of list) if (l.grabbed) release(l);
  };
  document.addEventListener("pointerleave", releaseAll, { passive: true });
  window.addEventListener("pointercancel", releaseAll, { passive: true });
  window.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType !== "mouse") releaseAll();
    },
    { passive: true }
  );
  // Scrolling: the net lags behind like rubber — visible horizontal lines
  // swing with the scroll speed and the text rides along. With a finger on
  // the screen the finger holds the net: lines under it move with it, lines
  // further away lag, and the bend sits where the finger is. (A still mouse
  // over moving lines is not treated as crossing them.)
  let lastY = window.scrollY;
  let lastT = performance.now();
  window.addEventListener(
    "scroll",
    () => {
      if (!finger) {
        ptr.x = NaN;
        ptr.y = NaN;
      }
      const now = performance.now();
      const v = ((window.scrollY - lastY) / Math.max(8, now - lastT)) * 16; // px per frame
      lastY = window.scrollY;
      lastT = now;
      if (calm || Math.abs(v) < 1.5) return;
      const top = window.scrollY - spacing;
      const bottom = window.scrollY + window.innerHeight + spacing;
      const cap = spacing * 1.2;
      const fy = finger ? finger.y + window.scrollY : NaN;
      const hold2 = 2 * Math.pow(spacing * 1.3, 2);
      for (const l of hLines) {
        if (l.pos < top || l.pos > bottom) continue;
        const vary = 0.75 + 0.25 * Math.sin(l.pos * 0.05);
        const held = finger ? Math.exp(-Math.pow(l.pos - fy, 2) / hold2) : 0;
        const amp = Math.max(-cap, Math.min(cap, v * 1.6)) * vary * (1 - held);
        const x = lastFingerX === lastFingerX ? lastFingerX : W * (0.5 + 0.3 * Math.sin(l.pos * 0.013));
        flick(l, x, amp);
      }
    },
    { passive: true }
  );

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
