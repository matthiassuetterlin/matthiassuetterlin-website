(() => {
  /**
   * Solid Playfair M/S: clear letter forms + fluid merge.
   * Full-viewport canvas — no letter-box edge; mouse is site-wide.
   * Outward → stretch apart; inward → stronger merge.
   */
  const stage = document.getElementById("ms-stage");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !canvas || !letterM || !letterS || !home) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { willReadFrequently: true });

  let mouse = { x: 0, y: 0, active: false };
  let smooth = { x: 0, y: 0 };
  let posM = { x: 0, y: 0, vx: 0, vy: 0 };
  let posS = { x: 0, y: 0, vx: 0, vy: 0 };
  let mergeAmp = 0.55;
  let mergeVel = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const SS = 2; // supersample to reduce pixelation
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
    // Full viewport — morph paints anywhere, not clipped to the letter box
    const sr = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
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
      field.width = Math.round(w * SS);
      field.height = Math.round(h * SS);
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

  function drawGlyph(c, ch, cx, cy, boxH, ss) {
    const fs = Math.max(12, boxH * 1.02) * ss;
    c.fillStyle = "#fff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = FONT.replace("1px", fs + "px");
    c.fillText(ch, cx * ss, cy * ss + fs * 0.03);
  }

  function blob(c, x, y, r, a, ss) {
    const g = c.createRadialGradient(x * ss, y * ss, 0, x * ss, y * ss, r * ss);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.5})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x * ss, y * ss, r * ss, 0, Math.PI * 2);
    c.fill();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) return;

    const sr = layout();
    if (w < 8) return;

    const time = (now - t0) / 1000;
    const b = boxes(sr);
    const midX = (b.m.cx + b.s.cx) * 0.5;
    const midY = (b.m.cy + b.s.cy) * 0.5;

    const tx = mouse.active ? mouse.x - sr.left : midX + Math.sin(time * 0.5) * 18;
    const ty = mouse.active ? mouse.y - sr.top : midY + Math.cos(time * 0.4) * 10;
    smooth.x = lerp(smooth.x || tx, tx, 0.14);
    smooth.y = lerp(smooth.y || ty, ty, 0.14);

    // Outwardness: how far mouse is from the MS mid — drives stretch-apart
    const dist = Math.hypot(smooth.x - midX, smooth.y - midY);
    const reach = Math.min(w, h) * 0.55;
    const outward = mouse.active ? clamp(dist / reach, 0, 1.35) : 0.15;
    const inward = mouse.active ? clamp(1 - dist / (reach * 0.55), 0, 1) : 0.55;

    // Idle: gentle breathe-together; mouse in: merge; mouse out: stretch apart
    const together = mouse.active
      ? lerp(28, -36, clamp(outward, 0, 1)) // positive = pull in, negative = push apart
      : 10 + Math.sin(time * 0.7) * 4;
    const attractMerge = mouse.active
      ? lerp(1.25, 0.15, clamp(outward / 1.1, 0, 1))
      : 0.55 + 0.2 * Math.sin(time * 0.65);

    // Lean toward mouse a bit while stretching
    const leanM = mouse.active ? (smooth.x - b.m.cx) * 0.04 * (0.4 + outward) : 0;
    const leanS = mouse.active ? (smooth.x - b.s.cx) * 0.04 * (0.4 + outward) : 0;
    const leanMY = mouse.active ? (smooth.y - b.m.cy) * 0.05 * (0.5 + outward * 0.5) : 0;
    const leanSY = mouse.active ? (smooth.y - b.s.cy) * 0.05 * (0.5 + outward * 0.5) : 0;

    springToward(
      posM,
      together + leanM + Math.sin(time * 1.1) * 2.5,
      leanMY + Math.cos(time * 0.9) * 2.2,
      0.075,
      0.87
    );
    springToward(
      posS,
      -together + leanS + Math.sin(time * 1.1 + 1.2) * 2.5,
      leanSY + Math.cos(time * 0.9 + 0.8) * 2.2,
      0.075,
      0.87
    );

    const mergeTarget = attractMerge;
    mergeVel = (mergeVel + (mergeTarget - mergeAmp) * 0.11) * 0.9;
    mergeAmp += mergeVel;

    letterM.style.transform = `translate(${posM.x.toFixed(2)}px, ${posM.y.toFixed(2)}px)`;
    letterS.style.transform = `translate(${posS.x.toFixed(2)}px, ${posS.y.toFixed(2)}px)`;

    const mCx = b.m.cx + posM.x;
    const mCy = b.m.cy + posM.y;
    const sCx = b.s.cx + posS.x;
    const sCy = b.s.cy + posS.y;

    const ss = SS;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, field.width, field.height);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, field.width, field.height);

    // Solid letter forms — clearly readable
    drawGlyph(fctx, "M", mCx, mCy, b.m.h, ss);
    drawGlyph(fctx, "S", sCx, sCy, b.s.h, ss);

    const mRight = mCx + b.m.w * 0.3;
    const sLeft = sCx - b.s.w * 0.3;
    const baseY = (mCy + sCy) * 0.5 + Math.min(b.m.h, b.s.h) * 0.16;
    const gap = Math.max(4, sLeft - mRight);

    // Fluid bridge: fat when together, long thin strand when stretched apart
    const plump = 8 + mergeAmp * 32;
    const strand = clamp(gap / 90, 0, 1);
    const lobes = 10 + Math.round(strand * 8);

    for (let i = 0; i < lobes; i++) {
      const u = i / (lobes - 1);
      const wave =
        Math.sin(time * 2.0 + u * Math.PI * 2) * (4 + mergeAmp * 8) * (1 - strand * 0.5) +
        Math.sin(time * 3.1 + u * 5) * 2 * (1 - strand * 0.4);
      const x = lerp(mRight, sLeft, u);
      // When stretched, fluid is pulled toward mouse if outward
      const pullY =
        mouse.active && outward > 0.35
          ? (smooth.y - baseY) * u * (1 - u) * 0.55 * outward
          : 0;
      const y = baseY + wave * Math.sin(u * Math.PI) + pullY;
      const r =
        plump *
        (0.35 + Math.sin(u * Math.PI) * 0.9) *
        (1 - strand * 0.55) *
        (0.85 + 0.15 * Math.sin(time * 2.2 + i));
      blob(fctx, x, y, Math.max(4, r), 0.95, ss);
    }

    // Serif anchors — stay connected to letter feet, stretch with gap
    blob(fctx, mRight - 1, baseY + Math.sin(time * 2) * 3, plump * (0.85 - strand * 0.2), 1, ss);
    blob(fctx, sLeft + 1, baseY + Math.cos(time * 2.1) * 3, plump * (0.9 - strand * 0.2), 1, ss);
    blob(
      fctx,
      lerp(mRight, sLeft, 0.5) + Math.sin(time * 1.6) * (4 - strand * 2),
      baseY - 3 + (mouse.active && outward > 0.4 ? (smooth.y - baseY) * 0.12 * outward : 0),
      plump * (1.0 - strand * 0.35) * (0.9 + inward * 0.2),
      1,
      ss
    );

    // Mid whisper only when close
    if (mergeAmp > 0.7 && strand < 0.45) {
      const yMid = (mCy + sCy) * 0.5;
      for (let i = 0; i < 5; i++) {
        const u = i / 4;
        blob(
          fctx,
          lerp(mRight, sLeft, u),
          yMid + Math.sin(time * 2 + u * 5) * 6 * mergeAmp,
          plump * 0.25 * mergeAmp,
          0.7,
          ss
        );
      }
    }

    // Soft hi-res blur
    fctx.filter = `blur(${13 * ss}px)`;
    fctx.drawImage(field, 0, 0);
    fctx.filter = "none";

    // Soft threshold (ramp) → less pixelated than hard cut
    const img = fctx.getImageData(0, 0, field.width, field.height);
    const d = img.data;
    const lo = 110;
    const hi = 175;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      if (v <= lo) {
        d[i + 3] = 0;
      } else {
        const t = v >= hi ? 1 : (v - lo) / (hi - lo);
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = Math.round(255 * t);
      }
    }
    fctx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(field, 0, 0, w, h);
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

  requestAnimationFrame(frame);
})();
