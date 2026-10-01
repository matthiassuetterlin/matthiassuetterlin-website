(() => {
  /**
   * Ferrofluid MS — Playfair Display 700 molds as glossy black fluid on
   * brushed metal. Letters magnetically attract, stretch, and bridge.
   * Mouse modulates pull between M and S. No spikes.
   *
   * Never block seeding on document.fonts.load — under file:// that promise
   * often never resolves.
   */
  const stage = document.getElementById("ms-stage");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !canvas || !letterM || !letterS || !home) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d", { willReadFrequently: true });

  const FONT =
    '700 1px "Playfair Display", "Times New Roman", Times, Georgia, serif';

  let particles = [];
  let mouse = { x: 0, y: 0, active: false };
  let seeded = false;
  let lastW = 0;
  let lastH = 0;
  let links = [];
  let metalPattern = null;
  let metalKey = "";
  let t0 = performance.now();

  const CELL = 32;
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

  function buildMetal(w, h) {
    const k = w + "x" + h;
    if (metalPattern && metalKey === k) return;
    metalKey = k;
    const tile = document.createElement("canvas");
    const tw = Math.min(320, Math.max(160, w));
    const th = Math.min(240, Math.max(120, h));
    tile.width = tw;
    tile.height = th;
    const tctx = tile.getContext("2d");
    // Charcoal base
    tctx.fillStyle = "#2a2c2e";
    tctx.fillRect(0, 0, tw, th);
    // Soft vertical shading (tray depth)
    const vg = tctx.createLinearGradient(0, 0, 0, th);
    vg.addColorStop(0, "rgba(255,255,255,0.06)");
    vg.addColorStop(0.45, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.18)");
    tctx.fillStyle = vg;
    tctx.fillRect(0, 0, tw, th);
    // Horizontal brush scratches
    tctx.lineCap = "butt";
    for (let i = 0; i < 140; i++) {
      const y = (Math.random() * th) | 0;
      const x0 = Math.random() * tw;
      const len = 20 + Math.random() * (tw * 0.55);
      const a = 0.025 + Math.random() * 0.07;
      const lite = Math.random() > 0.55;
      tctx.strokeStyle = lite
        ? "rgba(210,215,220," + a + ")"
        : "rgba(0,0,0," + (a * 1.4) + ")";
      tctx.lineWidth = 0.6 + Math.random() * 1.4;
      tctx.beginPath();
      tctx.moveTo(x0, y + (Math.random() - 0.5) * 1.5);
      tctx.lineTo(x0 + len, y + (Math.random() - 0.5) * 1.5);
      tctx.stroke();
    }
    // Subtle noise
    const img = tctx.getImageData(0, 0, tw, th);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    tctx.putImageData(img, 0, 0);
    metalPattern = ctx.createPattern(tile, "repeat");
  }

  function sampleLetter(ch, rect, sr, group) {
    const pad = 6;
    const bw = Math.max(2, Math.ceil(rect.width) + pad * 2);
    const bh = Math.max(2, Math.ceil(rect.height) + pad * 2);
    mask.width = bw;
    mask.height = bh;
    mctx.clearRect(0, 0, bw, bh);
    mctx.fillStyle = "#000";
    mctx.textAlign = "center";
    mctx.textBaseline = "middle";
    const fs = Math.max(12, rect.height * 1.02);
    mctx.font = FONT.replace("1px", fs + "px");
    mctx.fillText(ch, bw / 2, bh / 2 + fs * 0.03);

    const img = mctx.getImageData(0, 0, bw, bh).data;
    const step = Math.max(3, Math.round(Math.min(bw, bh) / 52));
    const ox = rect.left - sr.left - pad;
    const oy = rect.top - sr.top - pad;
    const out = [];
    const cx = ox + bw / 2;
    const cy = oy + bh / 2;

    for (let y = 0; y < bh; y += step) {
      for (let x = 0; x < bw; x += step) {
        const a = img[(y * bw + x) * 4 + 3];
        if (a < 128) continue;
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
        const contour = edge / 4;
        // Distance from glyph center for soft shade
        const gx = ox + x;
        const gy = oy + y;
        const ndx = (gx - cx) / Math.max(1, bw * 0.5);
        const ndy = (gy - cy) / Math.max(1, bh * 0.5);
        const depth = Math.min(1, Math.sqrt(ndx * ndx + ndy * ndy));
        out.push({
          x: gx,
          y: gy,
          rx: gx,
          ry: gy,
          vx: 0,
          vy: 0,
          group,
          contour,
          depth,
          r: step * 0.78,
        });
      }
    }
    return out;
  }

  function buildLinks() {
    links = [];
    const mOnly = [];
    const sOnly = [];
    for (let i = 0; i < particles.length; i++) {
      if (particles[i].group === 0) mOnly.push(i);
      else sOnly.push(i);
    }
    if (!mOnly.length || !sOnly.length) return;
    // Facing edges: right side of M, left side of S
    mOnly.sort((a, b) => particles[b].rx - particles[a].rx);
    sOnly.sort((a, b) => particles[a].rx - particles[b].rx);
    const linkCount = Math.min(56, mOnly.length, sOnly.length);
    const mFace = mOnly.slice(0, Math.min(140, mOnly.length));
    const sFace = sOnly.slice(0, Math.min(140, sOnly.length));
    for (let n = 0; n < linkCount; n++) {
      const mi = mFace[((n / linkCount) * (mFace.length - 1)) | 0];
      let best = sFace[0];
      let bestD = Infinity;
      const py = particles[mi].ry;
      for (let k = 0; k < sFace.length; k++) {
        const sj = sFace[k];
        const dy = particles[sj].ry - py;
        const dx = particles[sj].rx - particles[mi].rx;
        const d = dx * dx + dy * dy * 2.4;
        if (d < bestD) {
          bestD = d;
          best = sj;
        }
      }
      links.push([mi, best]);
    }
  }

  function seed() {
    const { sr, w, h } = layoutSize();
    const mRect = letterM.getBoundingClientRect();
    const sRect = letterS.getBoundingClientRect();
    if (mRect.width < 4 || sRect.width < 4 || w < 8 || h < 8) {
      seeded = false;
      return false;
    }

    const mParts = sampleLetter("M", mRect, sr, 0);
    const sParts = sampleLetter("S", sRect, sr, 1);
    particles = mParts.concat(sParts);
    if (particles.length < 20) {
      seeded = false;
      return false;
    }

    buildLinks();
    buildMetal(w, h);
    lastW = w;
    lastH = h;
    seeded = true;
    return true;
  }

  function centroids() {
    let mx = 0,
      my = 0,
      mc = 0,
      sx = 0,
      sy = 0,
      sc = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.group === 0) {
        mx += p.x;
        my += p.y;
        mc++;
      } else {
        sx += p.x;
        sy += p.y;
        sc++;
      }
    }
    return {
      m: { x: mx / Math.max(1, mc), y: my / Math.max(1, mc) },
      s: { x: sx / Math.max(1, sc), y: sy / Math.max(1, sc) },
    };
  }

  function step() {
    const { sr, w, h } = layoutSize();
    if (!seeded || Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2) {
      seed();
    }
    if (!seeded) return;

    const mx = mouse.active ? mouse.x - sr.left : -9999;
    const my = mouse.active ? mouse.y - sr.top : -9999;
    const now = performance.now();
    const wobble = Math.sin((now - t0) * 0.0011) * 0.35;

    // Mouse modulates magnetic pull between M and S (not spike fields)
    const c = centroids();
    const midX = (c.m.x + c.s.x) * 0.5;
    const midY = (c.m.y + c.s.y) * 0.5;
    let pullScale = 1 + wobble * 0.15;
    let pullBiasY = 0;
    if (mouse.active) {
      const dx = mx - midX;
      const dy = my - midY;
      const reach = Math.max(90, Math.min(w, h) * 0.55);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const prox = Math.max(0, 1 - dist / reach);
      // Closer to gap → stronger mutual attraction; offset shifts stretch direction
      pullScale = 0.55 + prox * 1.55 + Math.max(0, -dx / reach) * 0.35;
      pullBiasY = (dy / reach) * 0.9;
    }

    rebuildGrid();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let fx = 0;
      let fy = 0;

      // Shape memory — soft return to Playfair mold
      const memory = 0.038 + (1 - p.contour) * 0.08;
      fx += (p.rx - p.x) * memory;
      fy += (p.ry - p.y) * memory;

      // Intra-letter cohesion (viscous body)
      const near = neighbors(i, 28);
      for (let n = 0; n < near.length; n++) {
        const { j, dx, dy, d2 } = near[n];
        const q = particles[j];
        if (p.group !== q.group) continue;
        const d = Math.sqrt(d2);
        const rest = (p.r + q.r) * 0.92;
        const diff = d - rest;
        const str = 0.07;
        fx += (dx / d) * diff * str;
        fy += (dy / d) * diff * str;
        fx += (q.vx - p.vx) * 0.018;
        fy += (q.vy - p.vy) * 0.018;
      }

      // Mutual magnetic attraction toward the other letter's centroid
      const target = p.group === 0 ? c.s : c.m;
      const tdx = target.x - p.x;
      const tdy = target.y - p.y + pullBiasY * 40;
      const td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      // Stronger on facing contour particles
      const faceBoost =
        p.group === 0
          ? Math.max(0, (p.rx - c.m.x) / Math.max(1, w * 0.15))
          : Math.max(0, (c.s.x - p.rx) / Math.max(1, w * 0.15));
      const mag = (0.12 + faceBoost * 0.55 + p.contour * 0.2) * pullScale;
      fx += (tdx / td) * mag;
      fy += (tdy / td) * mag * 0.85;

      p.vx = (p.vx + fx) * 0.86;
      p.vy = (p.vy + fy) * 0.86;
    }

    // Viscous bridges between facing edges — stretch with pullScale
    const restBase = 22 - Math.min(12, (pullScale - 0.55) * 10);
    for (let n = 0; n < links.length; n++) {
      const ia = links[n][0];
      const ib = links[n][1];
      const a = particles[ia];
      const b = particles[ib];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = restBase + Math.abs(pullBiasY) * 8;
      const pull = (d - rest) * (0.028 + pullScale * 0.012);
      const fx = (dx / d) * pull;
      const fy = (dy / d) * pull;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
      // Mild shared drift along mouse bias
      if (mouse.active) {
        a.vy += pullBiasY * 0.25;
        b.vy += pullBiasY * 0.25;
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  function paintMetal(w, h) {
    buildMetal(w, h);
    ctx.fillStyle = metalPattern || "#2a2c2e";
    ctx.fillRect(0, 0, w, h);
    // Soft vignette / tray rim
    const g = ctx.createRadialGradient(
      w * 0.5,
      h * 0.45,
      Math.min(w, h) * 0.15,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.75
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function paintGrooveLips(sr) {
    // Slightly lighter raised lips around Playfair molds (metal rim)
    const mRect = letterM.getBoundingClientRect();
    const sRect = letterS.getBoundingClientRect();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const drawLip = (ch, rect) => {
      const fs = Math.max(12, rect.height * 1.02);
      const x = rect.left - sr.left + rect.width / 2;
      const y = rect.top - sr.top + rect.height / 2 + fs * 0.03;
      ctx.font = FONT.replace("1px", fs + "px");
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2.5, fs * 0.018);
      ctx.strokeStyle = "rgba(170,175,180,0.28)";
      ctx.strokeText(ch, x, y);
      ctx.lineWidth = Math.max(1.2, fs * 0.008);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.strokeText(ch, x + 0.6, y + 0.8);
    };
    drawLip("M", mRect);
    drawLip("S", sRect);
    ctx.restore();
  }

  function paintFallbackGlyphs(sr) {
    const mRect = letterM.getBoundingClientRect();
    const sRect = letterS.getBoundingClientRect();
    ctx.fillStyle = "#050506";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const draw = (ch, rect) => {
      const fs = Math.max(12, rect.height * 1.02);
      ctx.font = FONT.replace("1px", fs + "px");
      ctx.fillText(
        ch,
        rect.left - sr.left + rect.width / 2,
        rect.top - sr.top + rect.height / 2 + fs * 0.03
      );
    };
    draw("M", mRect);
    draw("S", sRect);
  }

  function paintFluidBlob(p) {
    // Glossy jet-black ferrofluid droplet with top-light specular
    const rad = p.r * (1.08 + p.contour * 0.22);
    const gx = p.x - rad * 0.28;
    const gy = p.y - rad * 0.38;
    const grad = ctx.createRadialGradient(gx, gy, rad * 0.05, p.x, p.y, rad);
    const shade = 8 + Math.floor((1 - p.depth) * 10);
    grad.addColorStop(0, "rgb(" + (shade + 22) + "," + (shade + 22) + "," + (shade + 24) + ")");
    grad.addColorStop(0.45, "rgb(" + shade + "," + shade + "," + (shade + 2) + ")");
    grad.addColorStop(1, "rgb(2,2,3)");
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // Wet specular highlight
    if (p.contour < 0.75) {
      ctx.beginPath();
      ctx.arc(gx, gy, rad * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(210,215,220,0.14)";
      ctx.fill();
    }
  }

  function paint() {
    const { sr, w, h } = layoutSize();
    paintMetal(w, h);
    paintGrooveLips(sr);

    if (!seeded || particles.length < 20) {
      paintFallbackGlyphs(sr);
      return;
    }

    // Sticky magnetic bridges between facing edges
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let n = 0; n < links.length; n++) {
      const a = particles[links[n][0]];
      const b = particles[links[n][1]];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const thick = Math.max(1.8, 8.5 - d * 0.04);
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5 + Math.sin(n * 0.7 + (performance.now() - t0) * 0.002) * 1.2;
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, "rgba(8,8,10,0.95)");
      grad.addColorStop(0.5, "rgba(18,18,20,0.88)");
      grad.addColorStop(1, "rgba(8,8,10,0.95)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(midX, midY, b.x, b.y);
      ctx.stroke();
      // Soft highlight on bridge
      ctx.strokeStyle = "rgba(180,185,190,0.08)";
      ctx.lineWidth = Math.max(0.8, thick * 0.28);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - thick * 0.2);
      ctx.quadraticCurveTo(midX, midY - thick * 0.25, b.x, b.y - thick * 0.2);
      ctx.stroke();
    }

    // Fluid body — draw contour particles slightly larger last for soft edge
    const order = particles.slice().sort((a, b) => a.contour - b.contour);
    for (let i = 0; i < order.length; i++) {
      paintFluidBlob(order[i]);
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) return;
    step();
    paint();
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load('700 200px "Playfair Display"').catch(() => {});
    document.fonts.ready
      .then(() => {
        seeded = false;
        seed();
      })
      .catch(() => {});
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

  window.addEventListener("resize", () => {
    seeded = false;
    metalPattern = null;
    metalKey = "";
  });

  let tries = 0;
  const boot = setInterval(() => {
    tries += 1;
    if (seed() || tries > 40) clearInterval(boot);
  }, 100);

  requestAnimationFrame(frame);
})();
