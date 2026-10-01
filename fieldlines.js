(() => {
  /**
   * Solid Playfair M/S: clear forms + fluid merge, full-page mouse.
   * Perf: low-res field + soft threshold + upscale (target ~60fps).
   */
  const stage = document.getElementById("ms-stage");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !canvas || !letterM || !letterS || !home) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { willReadFrequently: true });

  let mouse = { x: 0, y: 0, active: false };
  let smooth = { x: 0, y: 0 };
  let posM = { x: 0, y: 0, vx: 0, vy: 0 };
  let posS = { x: 0, y: 0, vx: 0, vy: 0 };
  let mergeAmp = 0.55;
  let mergeVel = 0;
  let cssW = 0;
  let cssH = 0;
  let iw = 0;
  let ih = 0;
  let scale = 1;
  let dpr = 1;
  let t0 = performance.now();
  let lastBox = null;
  let boxAge = 0;

  // Cap internal sim resolution — biggest FPS win vs full-viewport × SS
  const MAX_EDGE = 900;

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
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const nw = Math.max(2, window.innerWidth | 0);
    const nh = Math.max(2, window.innerHeight | 0);
    if (nw === cssW && nh === cssH) {
      return;
    }
    cssW = nw;
    cssH = nh;
    scale = Math.min(1, MAX_EDGE / Math.max(nw, nh));
    iw = Math.max(2, Math.round(nw * scale));
    ih = Math.max(2, Math.round(nh * scale));

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    field.width = iw;
    field.height = ih;
  }

  function readBoxes() {
    // Cache letter metrics most frames — layout rarely changes mid-hover
    boxAge++;
    if (lastBox && boxAge < 8) return lastBox;

    const tm = letterM.style.transform;
    const ts = letterS.style.transform;
    letterM.style.transform = "none";
    letterS.style.transform = "none";
    const m = letterM.getBoundingClientRect();
    const s = letterS.getBoundingClientRect();
    letterM.style.transform = tm;
    letterS.style.transform = ts;

    lastBox = {
      m: {
        w: m.width * scale,
        h: m.height * scale,
        cx: (m.left + m.width * 0.5) * scale,
        cy: (m.top + m.height * 0.5) * scale,
      },
      s: {
        w: s.width * scale,
        h: s.height * scale,
        cx: (s.left + s.width * 0.5) * scale,
        cy: (s.top + s.height * 0.5) * scale,
      },
    };
    boxAge = 0;
    return lastBox;
  }

  function springToward(state, tx, ty, k, damp) {
    state.vx = (state.vx + (tx - state.x) * k) * damp;
    state.vy = (state.vy + (ty - state.y) * k) * damp;
    state.x += state.vx;
    state.y += state.vy;
  }

  function drawGlyph(ch, cx, cy, boxH) {
    const fs = Math.max(12, boxH * 1.02);
    fctx.fillStyle = "#fff";
    fctx.textAlign = "center";
    fctx.textBaseline = "middle";
    fctx.font = FONT.replace("1px", fs + "px");
    fctx.fillText(ch, cx, cy + fs * 0.03);
  }

  function blob(x, y, r, a) {
    if (r < 0.5) return;
    const g = fctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.5})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.arc(x, y, r, 0, Math.PI * 2);
    fctx.fill();
  }

  function softThreshold() {
    const img = fctx.getImageData(0, 0, iw, ih);
    const d = img.data;
    const lo = 110;
    const hi = 175;
    const inv = 1 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      if (v <= lo) {
        d[i + 3] = 0;
      } else {
        const t = v >= hi ? 1 : (v - lo) * inv;
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = (t * 255) | 0;
      }
    }
    fctx.putImageData(img, 0, 0);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) return;

    layout();
    if (iw < 8) return;

    const time = (now - t0) / 1000;
    const b = readBoxes();
    const midX = (b.m.cx + b.s.cx) * 0.5;
    const midY = (b.m.cy + b.s.cy) * 0.5;

    const tx = mouse.active ? mouse.x * scale : midX + Math.sin(time * 0.5) * 18 * scale;
    const ty = mouse.active ? mouse.y * scale : midY + Math.cos(time * 0.4) * 10 * scale;
    smooth.x = lerp(smooth.x || tx, tx, 0.14);
    smooth.y = lerp(smooth.y || ty, ty, 0.14);

    const dist = Math.hypot(smooth.x - midX, smooth.y - midY);
    const reach = Math.min(iw, ih) * 0.55;
    const outward = mouse.active ? clamp(dist / reach, 0, 1.35) : 0.15;
    const inward = mouse.active ? clamp(1 - dist / (reach * 0.55), 0, 1) : 0.55;

    const together = mouse.active
      ? lerp(28, -36, clamp(outward, 0, 1))
      : 10 + Math.sin(time * 0.7) * 4;
    const attractMerge = mouse.active
      ? lerp(1.25, 0.15, clamp(outward / 1.1, 0, 1))
      : 0.55 + 0.2 * Math.sin(time * 0.65);

    const leanM = mouse.active ? ((smooth.x - b.m.cx) / scale) * 0.04 * (0.4 + outward) : 0;
    const leanS = mouse.active ? ((smooth.x - b.s.cx) / scale) * 0.04 * (0.4 + outward) : 0;
    const leanMY = mouse.active ? ((smooth.y - b.m.cy) / scale) * 0.05 * (0.5 + outward * 0.5) : 0;
    const leanSY = mouse.active ? ((smooth.y - b.s.cy) / scale) * 0.05 * (0.5 + outward * 0.5) : 0;

    // Springs stay in CSS-pixel space for letter transforms
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

    // Invalidate box cache when letters move a lot
    if (Math.abs(posM.vx) + Math.abs(posS.vx) > 0.4) boxAge = 99;

    const mCx = b.m.cx + posM.x * scale;
    const mCy = b.m.cy + posM.y * scale;
    const sCx = b.s.cx + posS.x * scale;
    const sCy = b.s.cy + posS.y * scale;

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, iw, ih);

    drawGlyph("M", mCx, mCy, b.m.h);
    drawGlyph("S", sCx, sCy, b.s.h);

    const mRight = mCx + b.m.w * 0.3;
    const sLeft = sCx - b.s.w * 0.3;
    const baseY = (mCy + sCy) * 0.5 + Math.min(b.m.h, b.s.h) * 0.16;
    const gap = Math.max(4, sLeft - mRight);

    const plump = (8 + mergeAmp * 32) * scale;
    const strand = clamp(gap / (90 * scale), 0, 1);
    // Fewer lobes when stretched thin — cheaper, still reads as fluid
    const lobes = 7 + Math.round(strand * 4);

    for (let i = 0; i < lobes; i++) {
      const u = i / (lobes - 1 || 1);
      const wave =
        Math.sin(time * 2.0 + u * Math.PI * 2) * (4 + mergeAmp * 8) * scale * (1 - strand * 0.5) +
        Math.sin(time * 3.1 + u * 5) * 2 * scale * (1 - strand * 0.4);
      const x = lerp(mRight, sLeft, u);
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
      blob(x, y, Math.max(3 * scale, r), 0.95);
    }

    blob(mRight - scale, baseY + Math.sin(time * 2) * 3 * scale, plump * (0.85 - strand * 0.2), 1);
    blob(sLeft + scale, baseY + Math.cos(time * 2.1) * 3 * scale, plump * (0.9 - strand * 0.2), 1);
    blob(
      lerp(mRight, sLeft, 0.5) + Math.sin(time * 1.6) * (4 - strand * 2) * scale,
      baseY - 3 * scale + (mouse.active && outward > 0.4 ? (smooth.y - baseY) * 0.12 * outward : 0),
      plump * (1.0 - strand * 0.35) * (0.9 + inward * 0.2),
      1
    );

    if (mergeAmp > 0.7 && strand < 0.45) {
      const yMid = (mCy + sCy) * 0.5;
      for (let i = 0; i < 4; i++) {
        const u = i / 3;
        blob(
          lerp(mRight, sLeft, u),
          yMid + Math.sin(time * 2 + u * 5) * 6 * mergeAmp * scale,
          plump * 0.25 * mergeAmp,
          0.7
        );
      }
    }

    // Blur at low-res (cheap) ≈ stronger blur when upscaled
    const blurPx = Math.max(4, 12 * scale);
    fctx.filter = `blur(${blurPx}px)`;
    fctx.drawImage(field, 0, 0);
    fctx.filter = "none";

    softThreshold();

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(field, 0, 0, cssW, cssH);
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
      cssW = 0; // force layout refresh
      lastBox = null;
    },
    { passive: true }
  );

  requestAnimationFrame(frame);
})();
