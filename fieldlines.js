(() => {
  /**
   * Solid Playfair M/S with lively fluid attraction.
   * Clear solid silhouette (no gradients) + soft, living merge/pull.
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
  // Spring state for each letter (fluid feel)
  let posM = { x: 0, y: 0, vx: 0, vy: 0 };
  let posS = { x: 0, y: 0, vx: 0, vy: 0 };
  let mergeAmp = 0.45;
  let mergeVel = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
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
      field.width = w;
      field.height = h;
    }
    return sr;
  }

  function boxes(sr) {
    // read layout WITHOUT transform so spring offsets stay absolute
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

  function drawGlyph(target, ch, cx, cy, boxH) {
    const fs = Math.max(12, boxH * 1.02);
    target.fillStyle = "#fff";
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.font = FONT.replace("1px", fs + "px");
    target.fillText(ch, cx, cy + fs * 0.03);
  }

  function blob(target, x, y, r, a) {
    const g = target.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    target.fillStyle = g;
    target.beginPath();
    target.arc(x, y, r, 0, Math.PI * 2);
    target.fill();
  }

  function springToward(state, targetX, targetY, stiffness, damping) {
    const ax = (targetX - state.x) * stiffness;
    const ay = (targetY - state.y) * stiffness;
    state.vx = (state.vx + ax) * damping;
    state.vy = (state.vy + ay) * damping;
    state.x += state.vx;
    state.y += state.vy;
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
    const gap0 = b.s.cx - b.m.cx - (b.m.w + b.s.w) * 0.28;

    const tx = mouse.active ? mouse.x - sr.left : midX + Math.sin(time * 0.55) * 28;
    const ty = mouse.active ? mouse.y - sr.top : midY + Math.cos(time * 0.45) * 16;
    smooth.x = lerp(smooth.x || tx, tx, 0.14);
    smooth.y = lerp(smooth.y || ty, ty, 0.14);

    const distMouse = Math.hypot(smooth.x - midX, smooth.y - midY);
    const mouseNear = clamp(1 - distMouse / (Math.min(w, h) * 0.55), 0, 1);
    const attract = mouse.active
      ? 0.4 + mouseNear * 1.15
      : 0.5 + 0.25 * Math.sin(time * 0.65);

    // Target offsets: pull together + lean toward mouse + light orbit
    const together = clamp(attract * Math.min(26, Math.max(8, gap0 * 0.35)), 0, 30);
    const targetM = {
      x:
        together +
        (smooth.x - b.m.cx) * 0.055 * attract +
        Math.sin(time * 1.15) * 3.5,
      y:
        (smooth.y - b.m.cy) * 0.07 * attract +
        Math.cos(time * 0.95) * 3.2,
    };
    const targetS = {
      x:
        -together +
        (smooth.x - b.s.cx) * 0.055 * attract +
        Math.sin(time * 1.15 + 1.2) * 3.5,
      y:
        (smooth.y - b.s.cy) * 0.07 * attract +
        Math.cos(time * 0.95 + 0.8) * 3.2,
    };

    // Soft spring — fluid, not stiff
    springToward(posM, targetM.x, targetM.y, 0.08, 0.86);
    springToward(posS, targetS.x, targetS.y, 0.08, 0.86);

    // Merge amplitude springs with attraction (breathing bridge)
    const mergeTarget = 0.35 + attract * 0.95 + mouseNear * 0.35;
    mergeVel = (mergeVel + (mergeTarget - mergeAmp) * 0.12) * 0.88;
    mergeAmp += mergeVel;

    letterM.style.transform = `translate(${posM.x.toFixed(2)}px, ${posM.y.toFixed(2)}px)`;
    letterS.style.transform = `translate(${posS.x.toFixed(2)}px, ${posS.y.toFixed(2)}px)`;

    const mCx = b.m.cx + posM.x;
    const mCy = b.m.cy + posM.y;
    const sCx = b.s.cx + posS.x;
    const sCy = b.s.cy + posS.y;

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, w, h);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, w, h);

    drawGlyph(fctx, "M", mCx, mCy, b.m.h);
    drawGlyph(fctx, "S", sCx, sCy, b.s.h);

    // Facing serifs
    const mRight = mCx + b.m.w * 0.3;
    const sLeft = sCx - b.s.w * 0.3;
    const baseY = (mCy + sCy) * 0.5 + Math.min(b.m.h, b.s.h) * 0.16;
    const plump = 10 + mergeAmp * 34;

    // Flowing multi-lobe bridge (living organic merge)
    const lobes = 12;
    for (let i = 0; i < lobes; i++) {
      const u = i / (lobes - 1);
      const wave =
        Math.sin(time * 2.1 + u * Math.PI * 2) * (5 + mergeAmp * 10) +
        Math.sin(time * 3.3 + u * 5) * 2.5;
      const x = lerp(mRight, sLeft, u) + Math.sin(time + u * 4) * 2;
      const y = baseY + wave * Math.sin(u * Math.PI) - mergeAmp * 6 * Math.sin(u * Math.PI);
      const r =
        plump *
        (0.4 + Math.sin(u * Math.PI) * 0.85) *
        (0.85 + 0.15 * Math.sin(time * 2.4 + i));
      blob(fctx, x, y, Math.max(6, r), 0.95);
    }

    // Serif anchors — feet morph into shared mass
    blob(fctx, mRight - 2, baseY + Math.sin(time * 2) * 4, plump * 0.95, 1);
    blob(fctx, sLeft + 2, baseY + Math.cos(time * 2.2) * 4, plump * 1.0, 1);
    blob(
      fctx,
      lerp(mRight, sLeft, 0.5) + Math.sin(time * 1.7) * 5,
      baseY - 4 + Math.cos(time * 2.5) * 5,
      plump * (1.05 + mouseNear * 0.25),
      1
    );

    // Secondary whisper connect near mid-height when strongly attracted
    if (mergeAmp > 0.75) {
      const yMid = (mCy + sCy) * 0.5;
      for (let i = 0; i < 6; i++) {
        const u = i / 5;
        blob(
          fctx,
          lerp(mRight, sLeft, u),
          yMid + Math.sin(time * 2 + u * 6) * 8 * mergeAmp,
          plump * 0.28 * mergeAmp,
          0.75
        );
      }
    }

    // Soft tendrils toward mouse when close — still solid after threshold
    if (mouse.active && mouseNear > 0.15) {
      const tips = [
        { x: mRight, y: baseY },
        { x: sLeft, y: baseY },
        { x: lerp(mRight, sLeft, 0.5), y: baseY },
      ];
      for (let t = 0; t < tips.length; t++) {
        for (let k = 1; k <= 6; k++) {
          const u = k / 6;
          const x = lerp(tips[t].x, smooth.x, u * 0.85);
          const y = lerp(tips[t].y, smooth.y, u * 0.85);
          const r = (16 - u * 10) * (0.5 + mouseNear) + Math.sin(time * 4 + t + u) * 2;
          blob(fctx, x, y, Math.max(5, r), 0.7 * (1 - u * 0.3));
        }
      }
    }

    // Stronger blur = softer, more liquid contour (still flat solid after threshold)
    fctx.filter = "blur(14px)";
    fctx.drawImage(field, 0, 0);
    fctx.filter = "none";

    const img = fctx.getImageData(0, 0, w, h);
    const d = img.data;
    const thr = 145;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= thr) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 255;
      } else {
        d[i + 3] = 0;
      }
    }
    fctx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(field, 0, 0);
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
