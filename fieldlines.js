(() => {
  /**
   * Liquid poured into Playfair M / S molds (top-down).
   * Shape memory + contour liquefaction + magnetic MS link + point attraction.
   */
  const stage = document.getElementById("ms-stage");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !canvas || !letterM || !letterS) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d", { willReadFrequently: true });

  let particles = [];
  let mouse = { x: 0, y: 0, active: false };
  let fontReady = false;
  let seeded = false;
  let lastW = 0;
  let lastH = 0;
  let links = []; // magnetic pairs (i, j)

  const CELL = 28;
  let grid = new Map();

  function key(cx, cy) {
    return cx + "," + cy;
  }

  function rebuildGrid() {
    grid.clear();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const cx = (p.x / CELL) | 0;
      const cy = (p.y / CELL) | 0;
      const k = key(cx, cy);
      let bucket = grid.get(k);
      if (!bucket) {
        bucket = [];
        grid.set(k, bucket);
      }
      bucket.push(i);
    }
  }

  function neighbors(i, radius) {
    const p = particles[i];
    const cx = (p.x / CELL) | 0;
    const cy = (p.y / CELL) | 0;
    const r2 = radius * radius;
    const out = [];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = grid.get(key(cx + ox, cy + oy));
        if (!bucket) continue;
        for (let n = 0; n < bucket.length; n++) {
          const j = bucket[n];
          if (j === i) continue;
          const q = particles[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2 && d2 > 0.0001) out.push({ j, dx, dy, d2 });
        }
      }
    }
    return out;
  }

  function waitFonts() {
    if (document.fonts && document.fonts.load) {
      return document.fonts.load('700 200px "Playfair Display"').then(() => {
        fontReady = true;
      });
    }
    fontReady = true;
    return Promise.resolve();
  }

  function layoutSize() {
    const sr = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(sr.width));
    const h = Math.max(1, Math.round(sr.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { sr, w, h, dpr };
  }

  function sampleLetter(ch, rect, sr, group) {
    const pad = 4;
    const bw = Math.max(2, Math.ceil(rect.width) + pad * 2);
    const bh = Math.max(2, Math.ceil(rect.height) + pad * 2);
    mask.width = bw;
    mask.height = bh;
    mctx.clearRect(0, 0, bw, bh);
    mctx.fillStyle = "#000";
    mctx.textAlign = "center";
    mctx.textBaseline = "middle";
    const fs = rect.height * 1.02;
    mctx.font = `700 ${fs}px "Playfair Display", "Times New Roman", Times, serif`;
    mctx.fillText(ch, bw / 2, bh / 2 + fs * 0.03);

    const img = mctx.getImageData(0, 0, bw, bh).data;
    const step = Math.max(3, Math.round(Math.min(bw, bh) / 55));
    const ox = rect.left - sr.left - pad;
    const oy = rect.top - sr.top - pad;
    const out = [];

    // Edge distance approx: interior vs contour (for liquefaction)
    for (let y = 0; y < bh; y += step) {
      for (let x = 0; x < bw; x += step) {
        const a = img[(y * bw + x) * 4 + 3];
        if (a < 128) continue;
        // sample neighborhood for edge factor
        let edge = 0;
        const probes = [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
        ];
        for (let p = 0; p < probes.length; p++) {
          const px = x + probes[p][0];
          const py = y + probes[p][1];
          if (px < 0 || py < 0 || px >= bw || py >= bh) {
            edge += 1;
            continue;
          }
          if (img[(py * bw + px) * 4 + 3] < 128) edge += 1;
        }
        const contour = edge / 4; // 0 interior … 1 contour
        out.push({
          x: ox + x,
          y: oy + y,
          rx: ox + x,
          ry: oy + y,
          vx: 0,
          vy: 0,
          group,
          contour,
          r: step * 0.72,
        });
      }
    }
    return out;
  }

  function seed() {
    const { sr, w, h } = layoutSize();
    const mRect = letterM.getBoundingClientRect();
    const sRect = letterS.getBoundingClientRect();
    if (mRect.width < 8 || sRect.width < 8) return false;

    const mParts = sampleLetter("M", mRect, sr, 0);
    const sParts = sampleLetter("S", sRect, sr, 1);
    particles = mParts.concat(sParts);

    // Magnetic links: nearest opposite-group particles across the gap
    links = [];
    const mOnly = [];
    const sOnly = [];
    for (let i = 0; i < particles.length; i++) {
      if (particles[i].group === 0) mOnly.push(i);
      else sOnly.push(i);
    }
    // Link a subset along facing edges (highest x for M, lowest x for S)
    mOnly.sort((a, b) => particles[b].rx - particles[a].rx);
    sOnly.sort((a, b) => particles[a].rx - particles[b].rx);
    const linkCount = Math.min(48, mOnly.length, sOnly.length);
    const mFace = mOnly.slice(0, Math.min(120, mOnly.length));
    const sFace = sOnly.slice(0, Math.min(120, sOnly.length));
    for (let n = 0; n < linkCount; n++) {
      const mi = mFace[(n / linkCount) * (mFace.length - 1) | 0];
      let best = sFace[0];
      let bestD = Infinity;
      const py = particles[mi].ry;
      for (let k = 0; k < sFace.length; k++) {
        const sj = sFace[k];
        const dy = particles[sj].ry - py;
        const dx = particles[sj].rx - particles[mi].rx;
        const d = dx * dx + dy * dy * 2.2;
        if (d < bestD) {
          bestD = d;
          best = sj;
        }
      }
      links.push([mi, best]);
    }

    lastW = w;
    lastH = h;
    seeded = true;
    return true;
  }

  function step() {
    const { sr, w, h } = layoutSize();
    if (!seeded || Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2) {
      if (fontReady) seed();
      if (!seeded) return;
    }

    const mx = mouse.active ? mouse.x - sr.left : -9999;
    const my = mouse.active ? mouse.y - sr.top : -9999;
    const attractR = Math.max(70, Math.min(w, h) * 0.22);
    const attractR2 = attractR * attractR;

    rebuildGrid();

    // Forces
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let fx = 0;
      let fy = 0;

      // Shape memory (stronger in core, weaker at contour → liquefies at edges)
      const memory = 0.045 + (1 - p.contour) * 0.09;
      fx += (p.rx - p.x) * memory;
      fy += (p.ry - p.y) * memory;

      // Viscosity / cohesion with same-group neighbors
      const near = neighbors(i, 26);
      for (let n = 0; n < near.length; n++) {
        const { j, dx, dy, d2 } = near[n];
        const q = particles[j];
        const d = Math.sqrt(d2);
        if (p.group === q.group) {
          const rest = (p.r + q.r) * 0.95;
          const diff = d - rest;
          const str = 0.08;
          fx += (dx / d) * diff * str;
          fy += (dy / d) * diff * str;
          // damp relative velocity
          fx += (q.vx - p.vx) * 0.02;
          fy += (q.vy - p.vy) * 0.02;
        }
      }

      // Point attraction exactly under cursor
      if (mouse.active) {
        const dx = mx - p.x;
        const dy = my - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < attractR2 && d2 > 0.5) {
          const d = Math.sqrt(d2);
          // Falloff peaked at cursor — stronger for contour liquid
          const fall = 1 - d / attractR;
          const power = (0.55 + p.contour * 0.85) * fall * fall;
          fx += (dx / d) * power * 14;
          fy += (dy / d) * power * 14;
        }
      }

      p.vx = (p.vx + fx) * 0.84;
      p.vy = (p.vy + fy) * 0.84;
    }

    // Magnetic coupling between M and S
    for (let n = 0; n < links.length; n++) {
      const ia = links[n][0];
      const ib = links[n][1];
      const a = particles[ia];
      const b = particles[ib];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = 18;
      const pull = (d - rest) * 0.035;
      const fx = (dx / d) * pull;
      const fy = (dy / d) * pull;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
      // Extra tug when mouse is near the bridge
      if (mouse.active) {
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        const mdx = mx - midX;
        const mdy = my - midY;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < attractR2) {
          const md = Math.sqrt(md2) || 1;
          const f = (1 - md / attractR) * 0.9;
          a.vx += (mdx / md) * f;
          a.vy += (mdy / md) * f;
          b.vx += (mdx / md) * f;
          b.vy += (mdy / md) * f;
        }
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  function paint() {
    const { w, h } = layoutSize();
    ctx.clearRect(0, 0, w, h);

    // Magnetic bridges as flat black liquid fillets
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let n = 0; n < links.length; n++) {
      const a = particles[links[n][0]];
      const b = particles[links[n][1]];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const thick = Math.max(2.2, 7.5 - d * 0.035);
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5 + Math.sin(n + a.x * 0.01) * 2;
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
    }

    // Liquid body — overlapping discs read as continuous pour from above
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const rad = p.r * (1.05 + p.contour * 0.15);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active")) return;
    step();
    if (seeded) paint();
  }

  windowFonts().then(() => {
    seed();
  });

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
    "pointerleave",
    () => {
      mouse.active = false;
    },
    { passive: true }
  );
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) seeded = false;
  });

  requestAnimationFrame(frame);
})();
