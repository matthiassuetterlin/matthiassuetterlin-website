(() => {
  /**
   * Pluckable grid: horizontal and vertical lines at an even spacing of
   * about one M stem (a little more), centred on the viewport.
   *
   * Same mechanics as string.js, but for many lines in one SVG and one
   * animation loop: crossing a line grabs it, it follows the pointer
   * (the curve passes through the pointer) until it snaps free and swings
   * out like a plucked string.
   */
  const svg = document.getElementById("bg-grid");
  const letterM = document.getElementById("letter-m");
  if (!svg) return;

  const NS = "http://www.w3.org/2000/svg";
  let lines = [];
  let W = 0;
  let H = 0;
  let spacing = 70;
  let snap = 90;
  let raf = null;
  const ptr = { x: NaN, y: NaN };

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function build() {
    W = document.documentElement.clientWidth;
    H = window.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const fontPx = letterM ? parseFloat(getComputedStyle(letterM).fontSize) : 0;
    // M stem ≈ 0.165 em; the grid runs a little wider
    spacing = Math.max(36, Math.round((fontPx || 350) * 0.2));
    snap = Math.max(40, spacing * 1.4);
    svg.textContent = "";
    lines = [];
    const add = (vertical, pos) => {
      const path = document.createElementNS(NS, "path");
      svg.appendChild(path);
      const l = { vertical, pos, path, progress: 0, at: 0.5, time: Math.PI / 2, grabbed: false, swinging: false };
      draw(l, 0);
      lines.push(l);
    };
    const ox = (W / 2) % spacing;
    const oy = (H / 2) % spacing;
    for (let y = oy; y <= H; y += spacing) add(false, y);
    for (let x = ox; x <= W; x += spacing) add(true, x);
  }

  function draw(l, p) {
    if (l.vertical) {
      const y = (H * l.at).toFixed(1);
      l.path.setAttribute("d", `M${l.pos} 0 Q${(l.pos + p).toFixed(1)} ${y}, ${l.pos} ${H}`);
    } else {
      const x = (W * l.at).toFixed(1);
      l.path.setAttribute("d", `M0 ${l.pos} Q${x} ${(l.pos + p).toFixed(1)}, ${W} ${l.pos}`);
    }
  }

  function release(l) {
    l.grabbed = false;
    if (Math.abs(l.progress) > 0.75) {
      l.swinging = true;
      l.time = Math.PI / 2;
      kick();
    } else {
      l.progress = 0;
      draw(l, 0);
    }
  }

  function tick() {
    raf = null;
    let busy = false;
    for (const l of lines) {
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
    if (busy) kick();
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      const x = e.clientX;
      const y = e.clientY;
      const px = ptr.x;
      const py = ptr.y;
      ptr.x = x;
      ptr.y = y;
      if (px !== px) return;
      for (const l of lines) {
        const c = l.vertical ? x : y;
        const prev = l.vertical ? px : py;
        if (!l.grabbed && (prev - l.pos) * (c - l.pos) <= 0 && prev !== c) {
          // Crossed this line: grab it (interrupting any swing)
          l.grabbed = true;
          l.swinging = false;
        }
        if (!l.grabbed) continue;
        const pull = c - l.pos;
        l.at = Math.min(1, Math.max(0, l.vertical ? y / H : x / W));
        if (Math.abs(pull) > snap) {
          release(l);
          continue;
        }
        l.progress = pull * 2;
        draw(l, l.progress);
      }
    },
    { passive: true }
  );
  const releaseAll = () => {
    ptr.x = NaN;
    ptr.y = NaN;
    for (const l of lines) if (l.grabbed) release(l);
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

  let resizeT = null;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(build, 120);
    },
    { passive: true }
  );
  if (document.fonts) document.fonts.ready.then(build);
  build();
})();
