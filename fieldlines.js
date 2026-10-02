(() => {
  /**
   * Elastic M/S: each letter is its own deformable body.
   *
   * Every glyph is turned into a signed distance field of its real Playfair
   * contour. Per frame the page pixels are pulled back through an elastic
   * displacement field and both fields are combined with a small smooth-min,
   * so the letters themselves stretch, lean and bulge — and only fuse where
   * their contours actually come close. No overlay, no blur layer.
   *
   * Interaction: entering the middle between M and S grabs the pair. Moving
   * left drags M along and S follows behind (and vice versa); the facing
   * sides reach for each other under tension. Leaving the zone lets go.
   */
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!canvas || !letterM || !letterS || !home) return;

  const ctx = canvas.getContext("2d");
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");

  const FONT_FAMILY = '"Playfair Display", "Times New Roman", Times, Georgia, serif';
  const PAD = 48; // CSS px of field around each glyph
  const TILE = 8; // device px per tile for empty/solid skipping
  const MAX_PIXELS = 3200000;
  const INF = 1e20;

  let geo = null;
  let dirty = true;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  // Distance-field samples per CSS px — follows the display density
  let SDF_RES = 2;
  let lastRegion = null;
  let checkAge = 0;
  const t0 = performance.now();

  const mouse = { x: 0, y: 0, active: false };
  let latched = false;
  const eng = { x: 0.2, v: 0 };
  const uLead = { x: 0, v: 0 };
  const uTrail = { x: 0, v: 0 };
  const vLead = { x: 0, v: 0 };
  const vTrail = { x: 0, v: 0 };
  const grabY = { x: 0, v: 0 };

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function spring(s, target, k, damp) {
    s.v = (s.v + (target - s.x) * k) * damp;
    s.x += s.v;
  }

  // --- Signed distance field (Felzenszwalb & Huttenlocher EDT) ----------

  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }

  function edt2d(grid, w, h) {
    const n = Math.max(w, h);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) f[x] = grid[o + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) grid[o + x] = d[x];
    }
  }

  function buildGlyph(ch, rect, fontPx) {
    const font = `700 ${fontPx}px ${FONT_FAMILY}`;
    octx.font = font;
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5 + fontPx * 0.03;
    const m = octx.measureText(ch);
    const box = {
      l: cx - m.actualBoundingBoxLeft,
      r: cx + m.actualBoundingBoxRight,
      t: cy - m.actualBoundingBoxAscent,
      b: cy + m.actualBoundingBoxDescent,
    };
    const x0 = box.l - PAD;
    const y0 = box.t - PAD;
    const w = Math.ceil((box.r - box.l + PAD * 2) * SDF_RES);
    const h = Math.ceil((box.b - box.t + PAD * 2) * SDF_RES);

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.setTransform(SDF_RES, 0, 0, SDF_RES, -x0 * SDF_RES, -y0 * SDF_RES);
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#000";
    g.fillText(ch, cx, cy);
    const px = g.getImageData(0, 0, w, h).data;

    const toIn = new Float64Array(w * h);
    const toOut = new Float64Array(w * h);
    for (let i = 0, j = 3; i < w * h; i++, j += 4) {
      const inside = px[j] >= 128;
      toIn[i] = inside ? 0 : INF;
      toOut[i] = inside ? INF : 0;
    }
    edt2d(toIn, w, h);
    edt2d(toOut, w, h);

    const data = new Float32Array(w * h);
    const inv = 1 / SDF_RES;
    for (let i = 0; i < w * h; i++) {
      data[i] =
        toIn[i] > 0
          ? (Math.sqrt(toIn[i]) - 0.5) * inv
          : -(Math.sqrt(toOut[i]) - 0.5) * inv;
    }
    return { x0, y0, w, h, data, box };
  }

  function sample(G, x, y) {
    let fx = (x - G.x0) * SDF_RES - 0.5;
    let fy = (y - G.y0) * SDF_RES - 0.5;
    let ox = 0;
    let oy = 0;
    const mx = G.w - 1;
    const my = G.h - 1;
    if (fx < 0) {
      ox = -fx;
      fx = 0;
    } else if (fx > mx) {
      ox = fx - mx;
      fx = mx;
    }
    if (fy < 0) {
      oy = -fy;
      fy = 0;
    } else if (fy > my) {
      oy = fy - my;
      fy = my;
    }
    const ix = fx | 0;
    const iy = fy | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const ix1 = ix < mx ? ix + 1 : ix;
    const iy1 = iy < my ? iy + 1 : iy;
    const D = G.data;
    const r0 = iy * G.w;
    const r1 = iy1 * G.w;
    const a = D[r0 + ix] + (D[r0 + ix1] - D[r0 + ix]) * tx;
    const b = D[r1 + ix] + (D[r1 + ix1] - D[r1 + ix]) * tx;
    let v = a + (b - a) * ty;
    if (ox || oy) v += Math.sqrt(ox * ox + oy * oy) / SDF_RES;
    return v;
  }

  // --- Layout -------------------------------------------------------------

  function readRects() {
    letterM.style.transform = "";
    letterS.style.transform = "";
    return [letterM.getBoundingClientRect(), letterS.getBoundingClientRect()];
  }

  function rebuild() {
    dpr = window.devicePixelRatio || 1;
    cssW = Math.max(2, window.innerWidth | 0);
    cssH = Math.max(2, window.innerHeight | 0);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastRegion = null;
    SDF_RES = Math.min(3, Math.max(2, dpr));

    const [rm, rs] = readRects();
    if (rm.width < 2 || rs.width < 2) {
      geo = null;
      return;
    }
    const fontPx = parseFloat(getComputedStyle(letterM).fontSize) || rm.height;
    const M = buildGlyph("M", rm, fontPx);
    const S = buildGlyph("S", rs, fontPx);

    const H = Math.max(M.box.b - M.box.t, S.box.b - S.box.t);
    const W = (M.box.r - M.box.l + S.box.r - S.box.l) * 0.5;
    const mL = M.box.l;
    const mR = M.box.r;
    const sL = S.box.l;
    const sR = S.box.r;
    const midX = (mR + sL) * 0.5;
    const midY = (Math.min(M.box.t, S.box.t) + Math.max(M.box.b, S.box.b)) * 0.5;
    const Umax = W * 0.5;
    const Vmax = H * 0.3;

    // Render region: both glyph fields plus the furthest drag
    const rx0 = Math.max(0, Math.floor(Math.min(M.x0, S.x0) - Umax - 12));
    const rx1 = Math.min(cssW, Math.ceil(Math.max(M.x0 + M.w / SDF_RES, S.x0 + S.w / SDF_RES) + Umax + 12));
    const ry0 = Math.max(0, Math.floor(Math.min(M.y0, S.y0) - Vmax * 0.5 - 8));
    const ry1 = Math.min(cssH, Math.ceil(Math.max(M.y0 + M.h / SDF_RES, S.y0 + S.h / SDF_RES) + Vmax * 0.5 + 8));
    const rw = Math.max(1, rx1 - rx0);
    const rh = Math.max(1, ry1 - ry0);
    let q = Math.min(dpr, 2);
    if (rw * rh * q * q > MAX_PIXELS) q = Math.sqrt(MAX_PIXELS / (rw * rh));
    const bw = Math.max(1, Math.round(rw * q));
    const bh = Math.max(1, Math.round(rh * q));
    off.width = bw;
    off.height = bh;
    const img = octx.createImageData(bw, bh);

    geo = {
      M,
      S,
      H,
      W,
      mL,
      mR,
      sL,
      sR,
      midX,
      midY,
      Umax,
      Vmax,
      rects: [rm, rs],
      region: { x: rx0, y: ry0, w: rw, h: rh, q, bw, bh },
      img,
      buf: new Uint32Array(img.data.buffer),
    };
  }

  function rectsMoved() {
    const [rm, rs] = readRects();
    const [om, os] = geo.rects;
    return (
      Math.abs(rm.left - om.left) > 0.5 ||
      Math.abs(rm.top - om.top) > 0.5 ||
      Math.abs(rs.left - os.left) > 0.5 ||
      Math.abs(rm.height - om.height) > 0.5
    );
  }

  // --- Frame --------------------------------------------------------------

  function frame(now) {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) {
      if (lastRegion) {
        ctx.clearRect(lastRegion.x, lastRegion.y, lastRegion.w, lastRegion.h);
        lastRegion = null;
      }
      return;
    }
    if (++checkAge > 30) {
      checkAge = 0;
      if (geo && rectsMoved()) dirty = true;
    }
    if (dirty || window.innerWidth !== cssW || window.innerHeight !== cssH) {
      dirty = false;
      rebuild();
    }
    if (!geo) return;

    const G = geo;
    const time = (now - t0) / 1000;
    const H = G.H;
    const W = G.W;

    // Interaction targets
    let eT;
    let uT;
    let vT;
    let gyT = G.midY;
    if (mouse.active) {
      const dx = mouse.x - G.midX;
      const dy = mouse.y - G.midY;
      const hx = (G.sR - G.mL) * 0.5 + W * 0.3;
      const hy = H * 0.85;
      const ex = 1 - smoothstep(hx, hx + W * 0.6, Math.abs(dx));
      const ey = 1 - smoothstep(hy, hy + H * 0.5, Math.abs(dy));
      const inMiddle = Math.abs(dx) < (G.sL - G.mR) * 0.5 + W * 0.22 && Math.abs(dy) < H * 0.6;
      if (inMiddle) latched = true;
      if (ex * ey < 0.02) latched = false;
      if (latched) {
        eT = ex * ey;
        gyT = clamp(mouse.y, G.midY - H * 0.5, G.midY + H * 0.5);
        uT = G.Umax * Math.tanh(dx / G.Umax) * eT;
        vT = G.Vmax * 0.45 * Math.tanh(dy / G.Vmax) * eT;
      } else {
        // Approaching the pair: faint pre-attraction, no drag yet
        eT = 0.35 * ey * (1 - smoothstep(0, hx, Math.abs(dx)));
        uT = 0;
        vT = 0;
      }
    } else {
      latched = false;
      eT = 0.18 + 0.07 * Math.sin(time * 0.6);
      uT = Math.sin(time * 0.4) * W * 0.02;
      vT = 0;
    }

    // Leading side follows fast, trailing side lags — elastic stretch
    spring(eng, eT, 0.08, 0.82);
    spring(uLead, uT, 0.14, 0.8);
    spring(uTrail, uT, 0.055, 0.86);
    spring(vLead, vT, 0.14, 0.8);
    spring(vTrail, vT, 0.055, 0.86);
    spring(grabY, gyT, 0.1, 0.8);

    const e = clamp(eng.x, 0, 1);
    const pull = Math.abs(uLead.x);
    // Neck: a narrow, horizontally reaching lobe at mid-height on each facing side
    const sigX = H * 0.3;
    const sigY = H * 0.2;
    const invX = 1 / (2 * sigX * sigX);
    const invY = 1 / (2 * sigY * sigY);
    const bulge = Math.min(sigX * 0.5, e * H * 0.08 + pull * 0.15 * e);
    // Fuse only where the reaching contours actually meet — kept small
    const kMerge = Math.max(0.001, Math.min(H * 0.07, e * H * 0.03 + pull * 0.05 * e));
    const lean = e * H * 0.025;
    const lam = 0.5 + 0.5 * Math.tanh(uLead.x / 15);
    const span = Math.max(1, G.sR - G.mL);
    const gapC = G.midX;
    const sigW = H * 0.16;
    const cMx = G.mR - W * 0.12;
    const cSx = G.sL + W * 0.12;
    const cY = G.midY + H * 0.05;
    const TRAIL = 0.15;
    const uL = uLead.x;
    const uTr = uTrail.x * TRAIL;
    const vL = vLead.x;
    const vTr = vTrail.x * TRAIL;
    // Rows near the grab height are dragged hardest — the bodies bend
    const gY = grabY.x;
    const invBend = 1 / (2 * (H * 0.55) * (H * 0.55));
    const M = G.M;
    const S = G.S;
    const mL = G.mL;

    function field(x, y) {
      // Chain displacement along the pair (0 = left end, 1 = right end)
      const lin = clamp((x - mL) / span, 0, 1);
      const sig = 1 / (1 + Math.exp(-(x - gapC) / sigW));
      const h = 0.35 * lin + 0.65 * sig;
      const g = lerp(1 - h, h, lam);
      const by = y - gY;
      const bend = 0.55 + 0.45 * Math.exp(-by * by * invBend);
      const qx = x - lerp(uTr, uL, g) * bend;
      const qy = y - lerp(vTr, vL, g);
      // Facing-side necks, evaluated in rest coordinates
      const dmx = qx - cMx;
      const dmy = qy - cY;
      const ny = Math.exp(-dmy * dmy * invY);
      const bm = bulge * ny * Math.exp(-dmx * dmx * invX);
      const dsx = qx - cSx;
      const bs = bulge * ny * Math.exp(-dsx * dsx * invX);
      const a = sample(M, qx - bm - lean, qy);
      const b = sample(S, qx + bs + lean, qy);
      // Polynomial smooth-min: fuse only where contours come within kMerge
      const hh = kMerge - Math.abs(a - b);
      if (hh <= 0) return a < b ? a : b;
      return (a < b ? a : b) - (hh * hh) / (4 * kMerge);
    }

    const R = G.region;
    const q = R.q;
    const buf = G.buf;
    const bw = R.bw;
    const bh = R.bh;
    buf.fill(0);
    const invQ = 1 / q;
    const tileRad = ((TILE * 0.7072) / q) * 3 + invQ;
    const SOLID = 0xff000000 | 0;

    for (let ty = 0; ty < bh; ty += TILE) {
      const ty1 = Math.min(bh, ty + TILE);
      for (let tx = 0; tx < bw; tx += TILE) {
        const tx1 = Math.min(bw, tx + TILE);
        const dc = field(R.x + (tx + TILE * 0.5) * invQ, R.y + (ty + TILE * 0.5) * invQ);
        if (dc > tileRad) continue;
        if (dc < -tileRad) {
          for (let py = ty; py < ty1; py++) buf.fill(SOLID, py * bw + tx, py * bw + tx1);
          continue;
        }
        for (let py = ty; py < ty1; py++) {
          const cy = R.y + (py + 0.5) * invQ;
          let i = py * bw + tx;
          for (let px = tx; px < tx1; px++, i++) {
            const d = field(R.x + (px + 0.5) * invQ, cy);
            const t = 0.5 - d * q;
            if (t <= 0) continue;
            buf[i] = t >= 1 ? SOLID : ((t * 255) | 0) << 24;
          }
        }
      }
    }

    octx.putImageData(G.img, 0, 0);
    if (lastRegion) ctx.clearRect(lastRegion.x, lastRegion.y, lastRegion.w, lastRegion.h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, R.x, R.y, R.w, R.h);
    lastRegion = R;
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
  window.addEventListener(
    "blur",
    () => {
      mouse.active = false;
    },
    { passive: true }
  );
  window.addEventListener(
    "resize",
    () => {
      dirty = true;
    },
    { passive: true }
  );
  if (document.fonts) {
    document.fonts.load('700 220px "Playfair Display"').then(() => (dirty = true), () => {});
    document.fonts.ready.then(() => (dirty = true));
  }

  requestAnimationFrame(frame);
})();
