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
   * tiny squares that ride both lines. A square at rest is small and crisp;
   * as soon as it moves it grows and its corners round into a squircle
   * (superellipse |x|^n + |y|^n = 1, n from ~30 down to 4), shrinking and
   * sharpening again when it settles. Crossings that come close melt into
   * each other through a gooey neck, the way M and S do.
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
  let dotHalf = 1;
  let dotBig = 8;
  let necks = [];
  let necksUsed = 0;
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
    necks = [];
    necksUsed = 0;
    // Tiny squares at rest, squircles of about a quarter step in motion
    dotHalf = Math.max(0.9, spacing * 0.022);
    dotBig = Math.max(4, spacing * 0.13);
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
        svg.appendChild(el);
        const d = { h, v, el, round: 0, near: 0, px: v.pos, py: h.pos, x: NaN, y: NaN, n: NaN, a: NaN };
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
  // exponent n, drawn as a closed polygon fine enough for a few pixels.
  // A crossing at rest is a tiny square; in motion it grows to a squircle.
  const SEG = 32;
  const COS = [];
  const SIN = [];
  for (let k = 0; k < SEG; k++) {
    COS.push(Math.cos((k / SEG) * Math.PI * 2));
    SIN.push(Math.sin((k / SEG) * Math.PI * 2));
  }
  function halfOf(round) {
    return lerp(dotHalf, dotBig, Math.pow(round, 0.8));
  }
  function drawDot(d, x, y, round) {
    const n = 30 - 26 * Math.pow(round, 0.7);
    const a = halfOf(round);
    if (Math.abs(x - d.x) < 0.05 && Math.abs(y - d.y) < 0.05 && Math.abs(n - d.n) < 0.2 && Math.abs(a - d.a) < 0.03) return;
    d.x = x;
    d.y = y;
    d.n = n;
    d.a = a;
    if (n > 29) {
      d.el.setAttribute("d", `M${(x - a).toFixed(2)} ${(y - a).toFixed(2)}h${(2 * a).toFixed(2)}v${(2 * a).toFixed(2)}h${(-2 * a).toFixed(2)}z`);
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

  // Gooey neck between two round blobs (metaball connector after
  // Hiroyuki Sato): two tangents with bezier handles that thin out and
  // tear as the blobs drift apart — the same melting as M and S.
  function neck(x1, y1, r1, x2, y2, r2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const maxDist = r1 + r2 * 2.5;
    if (r1 <= 0 || r2 <= 0 || d > maxDist || d <= Math.abs(r1 - r2)) return "";
    const v = 0.5;
    let u1 = 0;
    let u2 = 0;
    if (d < r1 + r2) {
      u1 = Math.acos(Math.max(-1, Math.min(1, (r1 * r1 + d * d - r2 * r2) / (2 * r1 * d))));
      u2 = Math.acos(Math.max(-1, Math.min(1, (r2 * r2 + d * d - r1 * r1) / (2 * r2 * d))));
    }
    const ab = Math.atan2(y2 - y1, x2 - x1);
    const spread = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
    const a1 = ab + u1 + (spread - u1) * v;
    const a2 = ab - u1 - (spread - u1) * v;
    const a3 = ab + Math.PI - u2 - (Math.PI - u2 - spread) * v;
    const a4 = ab - Math.PI + u2 + (Math.PI - u2 - spread) * v;
    const p1x = x1 + r1 * Math.cos(a1);
    const p1y = y1 + r1 * Math.sin(a1);
    const p2x = x1 + r1 * Math.cos(a2);
    const p2y = y1 + r1 * Math.sin(a2);
    const p3x = x2 + r2 * Math.cos(a3);
    const p3y = y2 + r2 * Math.sin(a3);
    const p4x = x2 + r2 * Math.cos(a4);
    const p4y = y2 + r2 * Math.sin(a4);
    const hs = Math.min(v * 2.4, Math.hypot(p3x - p1x, p3y - p1y) / (r1 + r2)) * Math.min(1, (d * 2) / (r1 + r2));
    const H = Math.PI / 2;
    const f = (n) => n.toFixed(2);
    const h1x = p1x + r1 * hs * Math.cos(a1 - H);
    const h1y = p1y + r1 * hs * Math.sin(a1 - H);
    const h2x = p2x + r1 * hs * Math.cos(a2 + H);
    const h2y = p2y + r1 * hs * Math.sin(a2 + H);
    const h3x = p3x + r2 * hs * Math.cos(a3 + H);
    const h3y = p3y + r2 * hs * Math.sin(a3 + H);
    const h4x = p4x + r2 * hs * Math.cos(a4 - H);
    const h4y = p4y + r2 * hs * Math.sin(a4 - H);
    return (
      `M${f(p1x)} ${f(p1y)}C${f(h1x)} ${f(h1y)} ${f(h3x)} ${f(h3y)} ${f(p3x)} ${f(p3y)}` +
      `A${f(r2)} ${f(r2)} 0 ${d > r1 ? 1 : 0} 0 ${f(p4x)} ${f(p4y)}` +
      `C${f(h4x)} ${f(h4y)} ${f(h2x)} ${f(h2y)} ${f(p2x)} ${f(p2y)}z`
    );
  }

  // Move every crossing with its two lines; grow and round it while it
  // moves, and let crossings that come close melt into each other
  function moveDots() {
    let settling = false;
    const full = spacing * 0.2;
    // Positions and motion
    for (const d of dots) {
      const dx = offsetAt(d.v, d.h.pos);
      const dy = offsetAt(d.h, d.v.pos);
      d.px = d.v.pos + dx;
      d.py = d.h.pos + dy;
      const target = Math.min(1, (Math.abs(dx) + Math.abs(dy)) / full);
      // Round up quickly, sharpen back slowly
      d.round += (target - d.round) * (target > d.round ? 0.35 : 0.08);
      if (d.round < 0.01) d.round = 0;
      else settling = true;
      d.near = 0;
    }
    // Neighbours a moving crossing comes close to swell toward it
    const reach = spacing * 0.75;
    const pairs = [];
    const cols = vLines.length;
    const rows = hLines.length;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const d = dots[i * cols + j];
        if (!d.round) continue;
        for (let ii = Math.max(0, i - 2); ii <= Math.min(rows - 1, i + 2); ii++) {
          for (let jj = Math.max(0, j - 2); jj <= Math.min(cols - 1, j + 2); jj++) {
            const k = ii * cols + jj;
            const o = dots[k];
            if (o === d || (o.round && k < i * cols + j)) continue;
            const dist = Math.hypot(o.px - d.px, o.py - d.py);
            if (dist >= reach) continue;
            const t = 1 - dist / reach;
            const pull = t * t * (3 - 2 * t);
            d.near = Math.max(d.near, pull);
            o.near = Math.max(o.near, pull);
            pairs.push(d, o);
          }
        }
      }
    }
    for (const d of dots) drawDot(d, d.px, d.py, Math.max(d.round, d.near));
    // Necks between crossings that are close enough to melt
    let used = 0;
    for (let p = 0; p < pairs.length; p += 2) {
      const a = pairs[p];
      const b = pairs[p + 1];
      const path = neck(a.px, a.py, a.a, b.px, b.py, b.a);
      if (!path) continue;
      if (used === necks.length) {
        const el = document.createElementNS(NS, "path");
        svg.appendChild(el);
        necks.push(el);
      }
      necks[used++].setAttribute("d", path);
    }
    for (let k = used; k < necksUsed; k++) necks[k].setAttribute("d", "");
    necksUsed = used;
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
