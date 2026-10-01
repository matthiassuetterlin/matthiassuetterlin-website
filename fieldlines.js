(() => {
  /**
   * Playfair outline stays crisp; only the fill morphs as fluid.
   * Soft-field fill (no hard pixel threshold), springs kept, centered layout via CSS.
   */
  const stage = document.getElementById("ms-stage");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !canvas || !letterM || !letterS || !home) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  // Hi-res working buffers for smooth fluid (not chunky pixels)
  const fluid = document.createElement("canvas");
  const fctx = fluid.getContext("2d", { willReadFrequently: false });
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d");
  const tmp = document.createElement("canvas");
  const tctx = tmp.getContext("2d");

  let mouse = { x: 0, y: 0, active: false };
  let smooth = { x: 0, y: 0 };
  let posM = { x: 0, y: 0, vx: 0, vy: 0 };
  let posS = { x: 0, y: 0, vx: 0, vy: 0 };
  let mergeAmp = 0.5;
  let mergeVel = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let scale = 2; // internal supersampling
  let t0 = performance.now();

  const FONT =
    '700 1px "Playfair Display", "Times New Roman", Times, Georgia, serif';

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load('700 220px "Playfair Display"').catch(() => {});
  }

  function layout() {
    const sr = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.max(2, Math.round(sr.width));
    const nh = Math.max(2, Math.round(sr.height));
    if (nw !== w || nh !== h) {
      w = nw;
      h = nh;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const iw = Math.round(w * scale);
      const ih = Math.round(h * scale);
      fluid.width = iw;
      fluid.height = ih;
      mask.width = iw;
      mask.height = ih;
      tmp.width = iw;
      tmp.height = ih;
    }
    return sr;
  }

  function boxes(sr) {
    const tm = letterM.style.transform;
    const ts = letterS.style.transform;
    letterM.style.transform = "none";
    letterS.style.transform = "none";
    const m = letterM.getBoundingClientRect();
    const s = letterS.getBoundingClientRect();
    letterM.style.transform = tm;
    letterS.style.transform = ts;
    return {
      m: {
        w: m.width,
        h: m.height,
        cx: m.left - sr.left + m.width * 0.5,
        cy: m.top - sr.top + m.height * 0.5,
      },
      s: {
        w: s.width,
        h: s.height,
        cx: s.left - sr.left + s.width * 0.5,
        cy: s.top - sr.top + s.height * 0.5,
      },
    };
  }

  function springToward(state, tx, ty, k, damp) {
    state.vx = (state.vx + (tx - state.x) * k) * damp;
    state.vy = (state.vy + (ty - state.y) * k) * damp;
    state.x += state.vx;
    state.y += state.vy;
  }

  function drawFillGlyph(c, ch, cx, cy, boxH, s) {
    const fs = Math.max(12, boxH * 1.02) * s;
    c.fillStyle = "#fff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = FONT.replace("1px", fs + "px");
    c.fillText(ch, cx * s, cy * s + fs * 0.03);
  }

  function drawOutlineGlyph(c, ch, cx, cy, boxH) {
    const fs = Math.max(12, boxH * 1.02);
    c.font = FONT.replace("1px", fs + "px");
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineCap = "round";
    // Crisp vector outline — base of the letter
    c.strokeStyle = "#000";
    c.lineWidth = Math.max(1.5, fs * 0.018);
    c.strokeText(ch, cx, cy + fs * 0.03);
  }

  function blob(c, x, y, r, a, s) {
    const g = c.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    c.fill();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) return;

    const sr = layout();
    if (w < 8) return;
    const s = scale;
    const time = (now - t0) / 1000;
    const b = boxes(sr);
    const midX = (b.m.cx + b.s.cx) * 0.5;
    const midY = (b.m.cy + b.s.cy) * 0.5;
    const gap0 = b.s.cx - b.m.cx - (b.m.w + b.s.w) * 0.28;

    const tx = mouse.active ? mouse.x - sr.left : midX + Math.sin(time * 0.55) * 24;
    const ty = mouse.active ? mouse.y - sr.top : midY + Math.cos(time * 0.45) * 14;
    smooth.x = lerp(smooth.x || tx, tx, 0.14);
    smooth.y = lerp(smooth.y || ty, ty, 0.14);

    const distMouse = Math.hypot(smooth.x - midX, smooth.y - midY);
    const mouseNear = clamp(1 - distMouse / (Math.min(w, h) * 0.55), 0, 1);
    const attract = mouse.active
      ? 0.4 + mouseNear * 1.1
      : 0.5 + 0.22 * Math.sin(time * 0.65);

    const together = clamp(attract * Math.min(24, Math.max(6, gap0 * 0.32)), 0, 28);
    springToward(
      posM,
      together + (smooth.x - b.m.cx) * 0.05 * attract + Math.sin(time * 1.1) * 3,
      (smooth.y - b.m.cy) * 0.065 * attract + Math.cos(time * 0.9) * 2.8,
      0.08,
      0.86
    );
    springToward(
      posS,
      -together + (smooth.x - b.s.cx) * 0.05 * attract + Math.sin(time * 1.1 + 1.2) * 3,
      (smooth.y - b.s.cy) * 0.065 * attract + Math.cos(time * 0.9 + 0.8) * 2.8,
      0.08,
      0.86
    );

    const mergeTarget = 0.35 + attract * 0.9 + mouseNear * 0.3;
    mergeVel = (mergeVel + (mergeTarget - mergeAmp) * 0.12) * 0.88;
    mergeAmp += mergeVel;

    letterM.style.transform = `translate(${posM.x.toFixed(2)}px, ${posM.y.toFixed(2)}px)`;
    letterS.style.transform = `translate(${posS.x.toFixed(2)}px, ${posS.y.toFixed(2)}px)`;

    const mCx = b.m.cx + posM.x;
    const mCy = b.m.cy + posM.y;
    const sCx = b.s.cx + posS.x;
    const sCy = b.s.cy + posS.y;

    // --- 1) Mask: letter interiors (slightly padded via blur later) ---
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mask.width, mask.height);
    drawFillGlyph(mctx, "M", mCx, mCy, b.m.h, s);
    drawFillGlyph(mctx, "S", sCx, sCy, b.s.h, s);
    // Soft enlarge mask so fill can breathe inside outline
    mctx.filter = `blur(${4 * s}px)`;
    mctx.drawImage(mask, 0, 0);
    mctx.filter = "none";

    // --- 2) Fluid field inside morphing mass ---
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fluid.width, fluid.height);

    // Base fill follows letter shapes
    drawFillGlyph(fctx, "M", mCx, mCy, b.m.h, s);
    drawFillGlyph(fctx, "S", sCx, sCy, b.s.h, s);

    const mRight = mCx + b.m.w * 0.3;
    const sLeft = sCx - b.s.w * 0.3;
    const baseY = (mCy + sCy) * 0.5 + Math.min(b.m.h, b.s.h) * 0.16;
    const plump = 9 + mergeAmp * 30;

    // Internal fluid motion + serif merge (fill only)
    for (let i = 0; i < 14; i++) {
      const u = i / 13;
      const wave =
        Math.sin(time * 2.2 + u * Math.PI * 2) * (4 + mergeAmp * 9) +
        Math.sin(time * 3.4 + u * 5) * 2;
      const x = lerp(mRight, sLeft, u);
      const y = baseY + wave * Math.sin(u * Math.PI);
      const r = plump * (0.35 + Math.sin(u * Math.PI) * 0.9);
      blob(fctx, x, y, Math.max(5, r), 0.9, s);
    }
    // Swirl inside each letter body
    for (let i = 0; i < 6; i++) {
      const u = i / 5;
      blob(
        fctx,
        mCx + Math.sin(time * 1.3 + u * 4) * b.m.w * 0.18,
        mCy + Math.cos(time * 1.1 + u * 3) * b.m.h * 0.22,
        10 + mergeAmp * 8,
        0.55,
        s
      );
      blob(
        fctx,
        sCx + Math.cos(time * 1.25 + u * 4) * b.s.w * 0.16,
        sCy + Math.sin(time * 1.05 + u * 3) * b.s.h * 0.2,
        10 + mergeAmp * 8,
        0.55,
        s
      );
    }
    blob(fctx, mRight, baseY + Math.sin(time * 2) * 3, plump * 0.9, 1, s);
    blob(fctx, sLeft, baseY + Math.cos(time * 2.1) * 3, plump * 0.95, 1, s);
    blob(
      fctx,
      lerp(mRight, sLeft, 0.5) + Math.sin(time * 1.6) * 4,
      baseY - 3,
      plump * (1 + mouseNear * 0.2),
      1,
      s
    );

    if (mouse.active && mouseNear > 0.12) {
      for (let k = 1; k <= 5; k++) {
        const u = k / 5;
        blob(
          fctx,
          lerp(lerp(mRight, sLeft, 0.5), smooth.x, u * 0.7),
          lerp(baseY, smooth.y, u * 0.7),
          (14 - u * 8) * (0.55 + mouseNear),
          0.65,
          s
        );
      }
    }

    // Smooth liquid blur at hi-res
    fctx.filter = `blur(${12 * s}px)`;
    fctx.drawImage(fluid, 0, 0);
    fctx.filter = "none";

    // Clip fluid to letter mask (fill stays "in" the outline forms)
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(fluid, 0, 0);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(mask, 0, 0);
    tctx.globalCompositeOperation = "source-over";

    // Allow soft serif bridge outside mask (organic connection)
    tctx.globalCompositeOperation = "source-over";
    // re-add bridge only in the gap, soft
    const bridge = document.createElement("canvas");
    bridge.width = tmp.width;
    bridge.height = tmp.height;
    const bctx = bridge.getContext("2d");
    for (let i = 0; i < 10; i++) {
      const u = i / 9;
      const x = lerp(mRight, sLeft, u);
      const y =
        baseY +
        Math.sin(time * 2 + u * Math.PI * 2) * (3 + mergeAmp * 6) * Math.sin(u * Math.PI);
      blob(bctx, x, y, plump * (0.4 + Math.sin(u * Math.PI) * 0.7), 0.85, s);
    }
    bctx.filter = `blur(${10 * s}px)`;
    bctx.drawImage(bridge, 0, 0);
    bctx.filter = "none";
    tctx.globalAlpha = clamp(mergeAmp * 0.85, 0.2, 0.95);
    tctx.drawImage(bridge, 0, 0);
    tctx.globalAlpha = 1;

    // Tint fluid to solid black with soft alpha (anti-aliased, not pixel-stepped)
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.globalCompositeOperation = "source-over";

    // --- Composite to screen ---
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tmp, 0, 0, w, h);

    // Crisp outlines on top (the typeface as basis)
    drawOutlineGlyph(ctx, "M", mCx, mCy, b.m.h);
    drawOutlineGlyph(ctx, "S", sCx, sCy, b.s.h);
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

  requestAnimationFrame(frame);
})();
