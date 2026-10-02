(() => {
  /**
   * Pluckable grid that carries the type.
   *
   * Horizontal and vertical lines at an even spacing of about one M stem
   * (a little more), laid out in page coordinates so they scroll with the
   * content. Crossing a line grabs it; it follows the pointer until it
   * snaps free and swings out like a plucked string.
   *
   * Text sits on the grid: titles put their baseline on a grid line, finer
   * text uses a line height that divides the grid evenly. Every letter is
   * its own span and rides the horizontal lines: a letter on a line moves
   * exactly with it, one between two lines follows both proportionally.
   */
  const svg = document.getElementById("bg-grid");
  const letterM = document.getElementById("letter-m");
  if (!svg) return;

  const NS = "http://www.w3.org/2000/svg";
  const root = document.documentElement;

  // Full grid lines for titles, sub-grid (line height) for finer text
  const SNAP_GRID = ".panel h2, .project-name, .tagline";
  const SNAP_SUB = ".panel p, .facts li, .local-nav, .project-meta, .home-hint";
  const SPLIT = ".panel, .tagline, .home-hint";

  let hLines = [];
  let vLines = [];
  let letters = [];
  let W = 0;
  let D = 0; // document height
  let spacing = 70;
  let unit = 35;
  let ox = 0;
  let oy = 0;
  let snapDist = 90;
  let raf = null;
  let moved = false;
  const ptr = { x: NaN, y: NaN };

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

  // Snap each container's blocks relative to its first baseline (so centred
  // layouts don't drift), then move the whole container onto the grid with
  // relative positioning, which leaves the centring untouched.
  function snapText() {
    const sel = `${SNAP_GRID}, ${SNAP_SUB}`;
    for (const box of document.querySelectorAll(".panel, .home-inner")) {
      box.style.removeProperty("top");
      const blocks = [...box.querySelectorAll(sel)];
      // Padding, not margin: margins would collapse with their neighbours
      for (const el of blocks) el.style.removeProperty("padding-top");
      if (!visible(box)) continue;
      const first = blocks.find((el) => baseline(el) !== null);
      if (!first) continue;
      for (const el of blocks) {
        if (el === first) continue;
        const b = baseline(el);
        if (b === null) continue;
        const step = el.matches(SNAP_GRID) ? spacing : unit;
        const rel = b - baseline(first);
        // Next line at or below (1.5 px tolerance for sub-pixel rounding)
        const delta = Math.ceil((rel - 1.5) / step) * step - rel;
        if (delta > 0.25) {
          const pt = parseFloat(getComputedStyle(el).paddingTop) || 0;
          el.style.setProperty("padding-top", `${(pt + delta).toFixed(2)}px`, "important");
        }
      }
      const b0 = baseline(first);
      const shift = oy + Math.round((b0 - oy) / spacing) * spacing - b0;
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
    snapDist = Math.max(40, spacing * 1.4);
    root.style.setProperty("--grid", `${spacing}px`);
    root.style.setProperty("--lh", `${unit}px`);
    W = root.clientWidth;
    ox = (W / 2) % spacing;
    oy = (window.innerHeight / 2) % spacing;

    snapText();

    D = Math.max(window.innerHeight, root.scrollHeight);
    svg.setAttribute("viewBox", `0 0 ${W} ${D}`);
    svg.style.width = `${W}px`;
    svg.style.height = `${D}px`;
    svg.textContent = "";
    hLines = [];
    vLines = [];
    const add = (list, vertical, pos) => {
      const path = document.createElementNS(NS, "path");
      svg.appendChild(path);
      const l = { vertical, pos, path, progress: 0, cur: 0, at: 0.5, time: 0, grabbed: false, swinging: false };
      draw(l, 0);
      list.push(l);
    };
    for (let y = oy; y <= D; y += spacing) add(hLines, false, y);
    for (let x = ox; x <= W; x += spacing) add(vLines, true, x);

    measureLetters();
  }

  function draw(l, p) {
    l.cur = p;
    if (l.vertical) {
      const y = (D * l.at).toFixed(1);
      l.path.setAttribute("d", `M${l.pos} 0 Q${(l.pos + p).toFixed(1)} ${y}, ${l.pos} ${D}`);
    } else {
      const x = (W * l.at).toFixed(1);
      l.path.setAttribute("d", `M0 ${l.pos} Q${x} ${(l.pos + p).toFixed(1)}, ${W} ${l.pos}`);
    }
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
      moved = busy;
    }
    if (busy) kick();
  }

  function kick() {
    moved = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function onMove(x, y) {
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
        if (Math.abs(pull) > snapDist) {
          release(l);
          continue;
        }
        l.progress = pull * 2;
        draw(l, l.progress);
        kick();
      }
    }
  }

  window.addEventListener("pointermove", (e) => onMove(e.pageX, e.pageY), { passive: true });
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
  // Scrolling moves the page under a still pointer — don't treat it as a pluck
  window.addEventListener("scroll", () => {
    ptr.x = NaN;
    ptr.y = NaN;
  }, { passive: true });

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
