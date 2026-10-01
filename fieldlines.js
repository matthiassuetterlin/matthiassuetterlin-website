(() => {
  /**
   * Ferrofluid MS — continuous glossy jet-black liquid poured into
   * Playfair Display 700 letter molds on brushed metal.
   * Metaball / soft-field fill (no beads, no straight webs, no spray).
   * Magnetic M↔S attraction with soft bulbous bridges; mouse modulates pull.
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

  // Offscreen: letter masks + fluid field
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  const fluid = document.createElement("canvas");
  const fctx = fluid.getContext("2d", { willReadFrequently: true });

  const FONT =
    '700 1px "Playfair Display", "Times New Roman", Times, Georgia, serif';

  let particles = [];
  let bridges = []; // soft bridge metaballs between facing edges
  let mouse = { x: 0, y: 0, active: false };
  let seeded = false;
  let lastW = 0;
  let lastH = 0;
  let metalPattern = null;
  let metalKey = "";
  let t0 = performance.now();
  let pullScale = 1;
  let pullBiasY = 0;

  // Coarse field grid for metaball threshold paint
  const CELL = 3;
  let fieldW = 0;
  let fieldH = 0;
  let field = null;

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
    tctx.fillStyle = "#2a2c2e";
    tctx.fillRect(0, 0, tw, th);
    const vg = tctx.createLinearGradient(0, 0, 0, th);
    vg.addColorStop(0, "rgba(255,255,255,0.06)");
    vg.addColorStop(0.45, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.18)");
    tctx.fillStyle = vg;
    tctx.fillRect(0, 0, tw, th);
    tctx.lineCap = "butt";
    for (let i = 0; i < 140; i++) {
      const y = (Math.random() * th) | 0;
      const x0 = Math.random() * tw;
      const len = 20 + Math.random() * (tw * 0.55);
      const a = 0.025 + Math.random() * 0.07;
      const lite = Math.random() > 0.55;
      tctx.strokeStyle = lite
        ? "rgba(210,215,220," + a + ")"
        : "rgba(0,0,0," + a * 1.4 + ")";
      tctx.lineWidth = 0.6 + Math.random() * 1.4;
      tctx.beginPath();
      tctx.moveTo(x0, y + (Math.random() - 0.5) * 1.5);
      tctx.lineTo(x0 + len, y + (Math.random() - 0.5) * 1.5);
      tctx.stroke();
    }
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
    const pad = 4;
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
    // Dense enough that metaball radii fully fuse inside the glyph
    const step = Math.max(4, Math.round(Math.min(bw, bh) / 38));
    const ox = rect.left - sr.left - pad;
    const oy = rect.top - sr.top - pad;
    const out = [];
    const cx = ox + bw / 2;
    const cy = oy + bh / 2;
    const influence = step * 1.65;

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
          r: influence,
        });
      }
    }
    return out;
  }

  function seedBridges(mParts, sParts) {
    bridges = [];
    if (!mParts.length || !sParts.length) return;
    // Facing samples: right of M, left of S
    const mFace = mParts
      .slice()
      .sort((a, b) => b.rx - a.rx)
      .slice(0, Math.min(48, mParts.length));
    const sFace = sParts
      .slice()
      .sort((a, b) => a.rx - b.rx)
      .slice(0, Math.min(48, sParts.length));
    const count = Math.min(18, mFace.length, sFace.length);
    for (let n = 0; n < count; n++) {
      const t = count === 1 ? 0.5 : n / (count - 1);
      const mi = mFace[((t * (mFace.length - 1)) | 0)];
      // match by Y
      let best = sFace[0];
      let bestD = Infinity;
      for (let k = 0; k < sFace.length; k++) {
        const dy = sFace[k].ry - mi.ry;
        const d = dy * dy;
        if (d < bestD) {
          bestD = d;
          best = sFace[k];
        }
      }
      const midX = (mi.rx + best.rx) * 0.5;
      const midY = (mi.ry + best.ry) * 0.5;
      bridges.push({
        x: midX,
        y: midY,
        rx: midX,
        ry: midY,
        vx: 0,
        vy: 0,
        r0: 10,
        r: 10,
        ma: mi,
        sb: best,
        t,
      });
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

    seedBridges(mParts, sParts);
    buildMetal(w, h);

    fieldW = Math.ceil(w / CELL) + 1;
    fieldH = Math.ceil(h / CELL) + 1;
    field = new Float32Array(fieldW * fieldH);

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

    const c = centroids();
    const midX = (c.m.x + c.s.x) * 0.5;
    const midY = (c.m.y + c.s.y) * 0.5;
    pullScale = 1 + wobble * 0.12;
    pullBiasY = 0;
    if (mouse.active) {
      const dx = mx - midX;
      const dy = my - midY;
      const reach = Math.max(90, Math.min(w, h) * 0.55);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const prox = Math.max(0, 1 - dist / reach);
      pullScale = 0.5 + prox * 1.65 + Math.max(0, -dx / reach) * 0.3;
      pullBiasY = (dy / reach) * 0.95;
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let fx = 0;
      let fy = 0;

      // Soft shape memory — hold Playfair mold (stronger in letter core)
      const memory = 0.055 + (1 - p.contour) * 0.09;
      fx += (p.rx - p.x) * memory;
      fy += (p.ry - p.y) * memory;

      // Mutual magnetic attraction — facing edges stretch toward each other
      const target = p.group === 0 ? c.s : c.m;
      const tdx = target.x - p.x;
      const tdy = target.y - p.y + pullBiasY * 36;
      const td = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      const faceBoost =
        p.group === 0
          ? Math.max(0, (p.rx - c.m.x) / Math.max(1, w * 0.14))
          : Math.max(0, (c.s.x - p.rx) / Math.max(1, w * 0.14));
      // Contour facing edges pull more → organic bulge / stretch
      const mag =
        (0.06 + faceBoost * 0.62 + p.contour * 0.18) * pullScale;
      fx += (tdx / td) * mag;
      fy += (tdy / td) * mag * 0.8;

      p.vx = (p.vx + fx) * 0.84;
      p.vy = (p.vy + fy) * 0.84;
      p.x += p.vx;
      p.y += p.vy;
    }

    // Soft viscous bridges: plump when pull is strong, recede when weak
    const bridgeStrength = Math.max(0, (pullScale - 0.55) / 1.6);
    for (let n = 0; n < bridges.length; n++) {
      const b = bridges[n];
      const a = b.ma;
      const s = b.sb;
      const midX = (a.x + s.x) * 0.5;
      const midY = (a.y + s.y) * 0.5 + pullBiasY * 10;
      const gap = Math.hypot(s.x - a.x, s.y - a.y);
      // Target radius: bulbous when letters close / pull strong
      const plump = 8 + bridgeStrength * 22 + Math.max(0, 48 - gap) * 0.35;
      b.r0 = plump;
      b.r += (plump - b.r) * 0.12;
      b.vx = (b.vx + (midX - b.x) * 0.12) * 0.82;
      b.vy = (b.vy + (midY - b.y) * 0.12) * 0.82;
      b.x += b.vx;
      b.y += b.vy;
      // Only show bridge when attraction is meaningful
      b.visible = bridgeStrength > 0.08 && gap < 120 + bridgeStrength * 80;
    }
  }

  function paintMetal(w, h) {
    buildMetal(w, h);
    ctx.fillStyle = metalPattern || "#2a2c2e";
    ctx.fillRect(0, 0, w, h);
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
    // Subtle raised metal rim of the Playfair molds (under the poured fluid)
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
      ctx.lineWidth = Math.max(3, fs * 0.022);
      ctx.strokeStyle = "rgba(160,165,170,0.22)";
      ctx.strokeText(ch, x, y);
      ctx.lineWidth = Math.max(1.4, fs * 0.01);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeText(ch, x + 0.7, y + 0.9);
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

  function groupOffset(group) {
    let dx = 0,
      dy = 0,
      n = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.group !== group) continue;
      dx += p.x - p.rx;
      dy += p.y - p.ry;
      n++;
    }
    if (!n) return { x: 0, y: 0 };
    return { x: dx / n, y: dy / n };
  }

  /**
   * Continuous ferrofluid fill:
   * 1) Solid Playfair glyph molds (deformed by magnetic pull)
   * 2) Soft bulbous bridge blobs between facing edges
   * 3) Blur → alpha threshold → glossy jet-black shade
   * Result: poured liquid letters + organic bridges — no beads/webs/spray.
   */
  function paintMetaballs(w, h, sr) {
    if (fluid.width !== w || fluid.height !== h) {
      fluid.width = w;
      fluid.height = h;
    }
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, w, h);
    fctx.fillStyle = "#000";
    fctx.textAlign = "center";
    fctx.textBaseline = "middle";

    const mRect = letterM.getBoundingClientRect();
    const sRect = letterS.getBoundingClientRect();
    const offM = groupOffset(0);
    const offS = groupOffset(1);

    // Soft blur so letter fills + bridge lobes fuse into one liquid body
    if (typeof fctx.filter === "string") {
      fctx.filter = "blur(5.5px)";
    }

    const drawMold = (ch, rect, off, skewX) => {
      const fs = Math.max(12, rect.height * 1.02);
      const x = rect.left - sr.left + rect.width / 2 + off.x;
      const y = rect.top - sr.top + rect.height / 2 + fs * 0.03 + off.y;
      fctx.save();
      fctx.translate(x, y);
      // Mild horizontal stretch toward the other letter (viscous pull)
      fctx.transform(1 + Math.abs(skewX) * 0.04, 0, skewX * 0.12, 1, 0, 0);
      fctx.font = FONT.replace("1px", fs + "px");
      fctx.fillText(ch, 0, 0);
      fctx.restore();
    };

    // M pulls right / S pulls left when attraction rises
    const stretch = Math.max(0, pullScale - 0.7) * 0.55;
    drawMold("M", mRect, offM, stretch);
    drawMold("S", sRect, offS, -stretch);

    // Soft rounded bridge lobes (capsules) — never stroked lines
    for (let n = 0; n < bridges.length; n++) {
      const b = bridges[n];
      if (!b.visible || b.r < 2) continue;
      const a = b.ma;
      const s = b.sb;
      // Organic sausage of overlapping ellipses along the gap
      const steps = 5;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = a.x + (s.x - a.x) * t;
        const y = a.y + (s.y - a.y) * t + Math.sin(t * Math.PI) * pullBiasY * 6;
        // Fatter in the middle → bulbous viscous bridge
        const fat = Math.sin(t * Math.PI);
        const rx = b.r * (0.55 + fat * 0.75);
        const ry = b.r * (0.4 + fat * 0.55);
        fctx.beginPath();
        fctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        fctx.fill();
      }
    }

    // Facing-edge bulge kernels from particles (soft SDF-like plump)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.contour < 0.35) continue;
      const face =
        p.group === 0
          ? Math.max(0, p.x - p.rx)
          : Math.max(0, p.rx - p.x);
      if (face < 1.5 && pullScale < 1.05) continue;
      const rad = Math.min(18, 4 + face * 0.45 + p.contour * 5);
      fctx.beginPath();
      fctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      fctx.fill();
    }

    fctx.filter = "none";

    // Threshold soft field → solid continuous liquid, then gloss-shade
    const img = fctx.getImageData(0, 0, w, h);
    const data = img.data;
    const alpha = new Uint8ClampedArray(w * h);
    for (let p = 0, i = 3; p < alpha.length; p++, i += 4) {
      alpha[p] = data[i];
    }
    const THRESH = 90; // after blur, mid-alpha becomes the liquid iso-surface
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const p = py * w + px;
        const a = alpha[p];
        const i = p * 4;
        if (a < THRESH) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 0;
          continue;
        }
        const edge = Math.min(1, (a - THRESH) / 80);
        const depth = Math.min(1, (a - THRESH) / 140);
        let shine = 0;
        if (px > 0 && py > 0) {
          const up = alpha[(py - 1) * w + px];
          const left = alpha[py * w + (px - 1)];
          const nx = (a - left) / 255;
          const ny = (a - up) / 255;
          shine =
            Math.pow(Math.max(0, nx * 0.4 + ny * 0.65 + 0.08), 2.2) * edge;
        }
        const base = 3 + depth * 7;
        data[i] = Math.min(255, (base + shine * 155) | 0);
        data[i + 1] = Math.min(255, (base + shine * 160) | 0);
        data[i + 2] = Math.min(255, (base + 2 + shine * 170) | 0);
        data[i + 3] = Math.min(255, (230 + edge * 25) | 0);
      }
    }
    fctx.putImageData(img, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (typeof ctx.filter === "string") {
      ctx.filter = "blur(0.6px)";
    }
    ctx.drawImage(fluid, 0, 0);
    ctx.filter = "none";

    // Poured-from-above wet sheen
    ctx.globalCompositeOperation = "screen";
    const hg = ctx.createLinearGradient(0, h * 0.12, 0, h * 0.5);
    hg.addColorStop(0, "rgba(210,215,220,0.08)");
    hg.addColorStop(0.45, "rgba(200,205,210,0.025)");
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  function paint() {
    const { sr, w, h } = layoutSize();
    paintMetal(w, h);
    paintGrooveLips(sr);

    if (!seeded || particles.length < 20) {
      paintFallbackGlyphs(sr);
      return;
    }

    paintMetaballs(w, h, sr);
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
