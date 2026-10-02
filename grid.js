(() => {
  /**
   * Pluckable grid that carries the type.
   *
   * Horizontal and vertical lines at an even spacing of about one M stem
   * (a little more), laid out in page coordinates so they scroll with the
   * content. Crossing a line grabs it; it follows the pointer until it
   * snaps free and swings out like a plucked string.
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
  // Safari (iOS 18+) ticks when a native switch toggles — so toggle a
  // hidden one. Only works inside a touch gesture; elsewhere it's a no-op.
  let iosSwitch = null;
  if (!navigator.vibrate) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.id = "grid-haptic";
    input.tabIndex = -1;
    const label = document.createElement("label");
    label.htmlFor = input.id;
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
    wrap.append(input, label);
    document.body.appendChild(wrap);
    iosSwitch = label;
  }
  function haptic() {
    if (navigator.vibrate) navigator.vibrate(6);
    else if (iosSwitch) iosSwitch.click();
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
          if (snap > snapDist) haptic();
          continue;
        }
        l.progress = pull * 2;
        draw(l, l.progress);
        kick();
      }
    }
  }

  // Fingers are less precise than a mouse: give them more travel
  window.addEventListener(
    "pointermove",
    (e) => onMove(e.pageX, e.pageY, e.pointerType === "mouse" ? snapDist : snapDist * 1.7),
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

  // Tap on empty space (touch): pluck the nearest horizontal line there
  let down = null;
  window.addEventListener(
    "pointerdown",
    (e) => {
      down = e.pointerType === "mouse" ? null : { x: e.pageX, y: e.pageY, t: performance.now() };
    },
    { passive: true }
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      if (!down || e.target.closest("button, a")) return;
      const moved = Math.hypot(e.pageX - down.x, e.pageY - down.y);
      if (moved < 10 && performance.now() - down.t < 350) {
        const l = hLines[Math.round((e.pageY - oy) / spacing)];
        if (l) {
          let pull = e.pageY - l.pos;
          if (Math.abs(pull) < spacing * 0.25) pull = spacing * 0.5 * (pull < 0 ? -1 : 1);
          flick(l, e.pageX, pull * 2.4);
          haptic();
        }
      }
      down = null;
    },
    { passive: true }
  );
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
  // swing with the scroll speed, and the text rides along. (A still pointer
  // over moving lines is not treated as crossing them.)
  let lastY = window.scrollY;
  let lastT = performance.now();
  window.addEventListener(
    "scroll",
    () => {
      ptr.x = NaN;
      ptr.y = NaN;
      const now = performance.now();
      const v = ((window.scrollY - lastY) / Math.max(8, now - lastT)) * 16; // px per frame
      lastY = window.scrollY;
      lastT = now;
      if (calm || Math.abs(v) < 1.5) return;
      const top = window.scrollY - spacing;
      const bottom = window.scrollY + window.innerHeight + spacing;
      const cap = spacing * 1.2;
      for (const l of hLines) {
        if (l.pos < top || l.pos > bottom) continue;
        const vary = 0.75 + 0.25 * Math.sin(l.pos * 0.05);
        const amp = Math.max(-cap, Math.min(cap, v * 1.6)) * vary;
        flick(l, W * (0.5 + 0.3 * Math.sin(l.pos * 0.013)), amp);
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
