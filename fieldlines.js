(() => {
  /**
   * M/S with a liquid bridge.
   *
   * Each glyph is a signed distance field of its real Playfair contour, so the
   * letters stay crisp and intact. Between them a viscous neck is drawn out of
   * the facing contours: a smooth-min with the letters gives it concave,
   * trumpet-like flares; pulled further it thins, beads into drops and its
   * edge starts to ripple like ink. M and S never fuse directly.
   *
   * Interaction: approaching the middle lets the bridge reach out; entering it
   * grabs the pair. Moving left drags M along and S follows behind (and vice
   * versa), stretching the neck. Leaving the zone lets go.
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
  const grabY = { x: NaN, v: 0 };

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
    const Umax = W * 0.75;
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

  // First x (stepping from x0 toward x1) where the glyph is solid at row y
  function contourX(G, y, x0, x1) {
    const dir = x1 > x0 ? 1 : -1;
    let x = x0;
    for (let i = 0; i < 400; i++) {
      const d = sample(G, x, y);
      if (d <= 0) return x;
      // Distance field lets us jump safely
      const step = Math.max(0.5, d);
      x += dir * step;
      if ((x - x1) * dir > 0) break;
    }
    return (G.box.l + G.box.r) * 0.5;
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
    let eT = 0;
    let uT = 0;
    let vT = 0;
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
        gyT = clamp(mouse.y, G.midY - H * 0.28, G.midY + H * 0.28);
        uT = G.Umax * Math.tanh(dx / G.Umax) * eT;
        vT = G.Vmax * 0.45 * Math.tanh(dy / G.Vmax) * eT;
      } else {
        // Approaching the middle: the bridge starts to reach out
        eT = 0.45 * ey * (1 - smoothstep(0, hx, Math.abs(dx)));
      }
    } else {
      latched = false;
    }

    // Leading letter follows fast, the other one is dragged behind
    spring(eng, eT, 0.08, 0.82);
    spring(uLead, uT, 0.14, 0.8);
    spring(uTrail, uT, 0.05, 0.87);
    spring(vLead, vT, 0.14, 0.8);
    spring(vTrail, vT, 0.05, 0.87);
    if (grabY.x !== grabY.x) grabY.x = G.midY;
    spring(grabY, gyT, 0.1, 0.8);

    const e = clamp(eng.x, 0, 1);
    const TRAIL = 0.4;
    const lam = 0.5 + 0.5 * Math.tanh(uLead.x / 15); // 0: dragging left, 1: right
    const offM = lerp(uLead.x, uTrail.x * TRAIL, lam);
    const offS = lerp(uTrail.x * TRAIL, uLead.x, lam);
    const offMy = lerp(vLead.x, vTrail.x * TRAIL, lam) * 0.5;
    const offSy = lerp(vTrail.x * TRAIL, vLead.x, lam) * 0.5;
    const M = G.M;
    const S = G.S;

    // Bridge anchors: the facing contours at grab height, slightly inside
    const gy = grabY.x;
    const inset = H * 0.03;
    const axR = contourX(M, gy, M.box.r, M.box.l);
    const sy = gy;
    const bxR = contourX(S, sy, S.box.l, S.box.r);
    const Ax = axR - inset + offM;
    const Ay = gy + offMy;
    const Bx = bxR + inset + offS;
    const By = sy + offSy;
    const L0 = Math.max(1, bxR - axR + inset * 2);
    const L = Math.hypot(Bx - Ax, By - Ay);
    // Stretch: the neck thins as it is pulled out (volume stays roughly constant)
    const tau = clamp((L - L0) / (H * 0.7), 0, 1);
    const bridgeOn = e > 0.02;
    // Hourglass profile: wide concave flares at the letters, thin waist between
    const r = e * H * 0.035 * (1 - 0.6 * tau);
    const rA = e * H * 0.3 * (1 - 0.25 * tau);
    const rB = e * H * 0.19 * (1 - 0.25 * tau);
    // Meniscus flare where the neck meets each letter — scales with the span
    const kFlare = Math.max(0.001, e * H * 0.07);
    const flareS = 1 / (2 * Math.pow(H * 0.35, 2));
    const nearLim = H * 0.45;
    let nearB = false;
    const Cx = (Ax + Bx) * 0.5;
    const Cy = (Ay + By) * 0.5 + vLead.x * 0.25 + H * 0.05 * tau;
    // Beading under tension (Plateau–Rayleigh): drops along the thinning neck
    const bead = r * 2.1 * smoothstep(0.3, 0.75, tau);
    const kBead = H * 0.04 * e;
    const b1x = lerp(Ax, Bx, 0.36);
    const b1y = lerp(Ay, Cy, 0.72) + bead * 0.3;
    const b2x = lerp(Ax, Bx, 0.63);
    const b2y = lerp(Cy, By, 0.26) + bead * 0.5;
    // Ink ripple, only on the bridge surface
    const ripple = e * H * (0.004 + 0.01 * tau);
    const rippleS = 1 / (2 * Math.pow(H * 0.08, 2));
    const fq = 9 / H;

    // Bounding box outside which the bridge cannot change the shape
    const margin = Math.max(rA, rB) + kFlare + bead * 2 + ripple + 2;
    const bx0 = Math.min(Ax, Bx) - margin;
    const bx1 = Math.max(Ax, Bx) + margin;
    const by0 = Math.min(Ay, By, Cy) - margin;
    const by1 = Math.max(Ay, By, Cy) + margin;

    function segDist(px, py, x0, y0, x1, y1, t0, t1) {
      const vx = x1 - x0;
      const vy = y1 - y0;
      const wx = px - x0;
      const wy = py - y0;
      const l2 = vx * vx + vy * vy || 1;
      const t = clamp((wx * vx + wy * vy) / l2, 0, 1);
      const dx = wx - vx * t;
      const dy = wy - vy * t;
      const tg = lerp(t0, t1, t);
      const u = Math.abs(tg - 0.5) * 2; // 0 at waist, 1 at letters
      const rEnd = tg < 0.5 ? rA : rB;
      return Math.sqrt(dx * dx + dy * dy) - (r + (rEnd - r) * u * u * u);
    }

    function smin(a, b, k) {
      const h = k - Math.abs(a - b);
      if (h <= 0) return a < b ? a : b;
      return (a < b ? a : b) - (h * h) / (4 * k);
    }

    function field(x, y) {
      const dM = sample(M, x - offM, y - offMy);
      const dS = sample(S, x - offS, y - offSy);
      nearB = false;
      if (!bridgeOn || x < bx0 || x > bx1 || y < by0 || y > by1) return dM < dS ? dM : dS;
      let dn = Math.min(
        segDist(x, y, Ax, Ay, Cx, Cy, 0, 0.5),
        segDist(x, y, Cx, Cy, Bx, By, 0.5, 1)
      );
      // Cut the wide M end flat inside the stem so it never shows behind it
      const ex0 = Ax - x;
      if (ex0 > dn) dn = ex0;
      nearB = dn < nearLim;
      if (bead > 0.3) {
        const d1 = Math.hypot(x - b1x, y - b1y) - bead;
        const d2 = Math.hypot(x - b2x, y - b2y) - bead * 0.8;
        dn = smin(dn, Math.min(d1, d2), kBead);
      }
      // Letters never fuse directly — only through the bridge
      const ax = x - Ax;
      const ay = y - Ay;
      const bx = x - Bx;
      const by = y - By;
      let a = dM < dn ? dM : dn;
      let b = dS < dn ? dS : dn;
      if (Math.abs(dM - dn) < kFlare) a = smin(dM, dn, kFlare * Math.exp(-(ax * ax + ay * ay) * flareS) + 0.001);
      if (Math.abs(dS - dn) < kFlare) b = smin(dS, dn, kFlare * Math.exp(-(bx * bx + by * by) * flareS) + 0.001);
      let d = a < b ? a : b;
      const w = Math.exp(-dn * dn * rippleS);
      if (w > 0.02) {
        d +=
          ripple *
          w *
          Math.sin(x * fq + time * 1.3 + Math.sin(y * fq * 1.7 - time * 0.9) * 1.6) *
          Math.sin(y * fq * 1.3 - time * 0.7);
      }
      return d;
    }

    const R = G.region;
    const q = R.q;
    const buf = G.buf;
    const bw = R.bw;
    const bh = R.bh;
    buf.fill(0);
    const invQ = 1 / q;
    const tileRad = ((TILE * 0.7072) / q) * 4 + invQ + H * 0.03;
    const eps = 0.5 * invQ;
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
            const cx = R.x + (px + 0.5) * invQ;
            let d = field(cx, cy);
            if (d * q > 3) continue;
            if (nearB && d * q > -3) {
              // Normalise by the local slope so flares and drops stay crisp
              const gx = field(cx + eps, cy) - d;
              const gy = field(cx, cy + eps) - d;
              const gl = Math.sqrt(gx * gx + gy * gy) / eps;
              if (gl > 0.05) d /= gl;
            }
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
