(() => {
  /**
   * Solid Playfair M/S — organic serif merge.
   * Letters are solid shapes (not fills inside outlines).
   * Serifs morph into one shared element; gravity/attraction kept.
   * No gradients, no specular FX, no beads, no line webs.
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
    const m = letterM.getBoundingClientRect();
    const s = letterS.getBoundingClientRect();
    return {
      m: {
        x: m.left - sr.left,
        y: m.top - sr.top,
        w: m.width,
        h: m.height,
        cx: m.left - sr.left + m.width * 0.5,
        cy: m.top - sr.top + m.height * 0.5,
      },
      s: {
        x: s.left - sr.left,
        y: s.top - sr.top,
        w: s.width,
        h: s.height,
        cx: s.left - sr.left + s.width * 0.5,
        cy: s.top - sr.top + s.height * 0.5,
      },
    };
  }

  function drawSolidGlyph(target, ch, box, ox, oy) {
    const fs = Math.max(12, box.h * 1.02);
    target.fillStyle = "#fff";
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.font = FONT.replace("1px", fs + "px");
    target.fillText(ch, box.cx + ox, box.cy + oy + fs * 0.03);
  }

  function blob(target, x, y, r, a) {
    const g = target.createRadialGradient(x, y, 0, x, y, r);
    // flat field contribution only (threshold later → solid black)
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    target.fillStyle = g;
    target.beginPath();
    target.arc(x, y, r, 0, Math.PI * 2);
    target.fill();
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

    const tx = mouse.active ? mouse.x - sr.left : midX;
    const ty = mouse.active ? mouse.y - sr.top : midY;
    smooth.x = lerp(smooth.x || tx, tx, 0.1);
    smooth.y = lerp(smooth.y || ty, ty, 0.1);

    // Gravity / attraction between the two solid letters
    const gap = b.s.x - (b.m.x + b.m.w);
    const mousePull = mouse.active
      ? clamp(1 - Math.hypot(smooth.x - midX, smooth.y - midY) / (Math.min(w, h) * 0.5), 0, 1)
      : 0.35 + 0.08 * Math.sin(time * 0.8);
    const attract = 0.35 + mousePull * 0.9;

    // Solid letters drift toward each other (and slightly toward mouse)
    const oxM =
      attract * Math.min(18, gap * 0.22) +
      (mouse.active ? (smooth.x - b.m.cx) * 0.02 * attract : 0) +
      Math.sin(time * 0.9) * 1.5;
    const oyM =
      (mouse.active ? (smooth.y - b.m.cy) * 0.025 * attract : 0) +
      Math.cos(time * 0.7) * 1.2;
    const oxS =
      -attract * Math.min(18, gap * 0.22) +
      (mouse.active ? (smooth.x - b.s.cx) * 0.02 * attract : 0) +
      Math.sin(time * 0.9 + 1) * 1.5;
    const oyS =
      (mouse.active ? (smooth.y - b.s.cy) * 0.025 * attract : 0) +
      Math.cos(time * 0.7 + 1) * 1.2;

    // Hit targets follow the visual drift
    letterM.style.transform = `translate(${oxM.toFixed(1)}px, ${oyM.toFixed(1)}px)`;
    letterS.style.transform = `translate(${oxS.toFixed(1)}px, ${oyS.toFixed(1)}px)`;

    // --- Field: solid glyphs + serif merge mass (white on black) ---
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, w, h);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, w, h);

    drawSolidGlyph(fctx, "M", b.m, oxM, oyM);
    drawSolidGlyph(fctx, "S", b.s, oxS, oyS);

    // Serif merge zone: facing edges / bottom-left of S + right foot of M
    const mRight = b.m.cx + oxM + b.m.w * 0.28;
    const sLeft = b.s.cx + oxS - b.s.w * 0.28;
    const mergeY0 = midY + Math.min(b.m.h, b.s.h) * 0.18; // lower serifs / feet
    const mergeY1 = midY - Math.min(b.m.h, b.s.h) * 0.05;
    const plump = 12 + attract * 28;

    // Organic bridge between facing serifs (the "Witz")
    for (let i = 0; i < 8; i++) {
      const u = i / 7;
      const x = lerp(mRight, sLeft, u);
      const y =
        lerp(mergeY0, mergeY1, Math.sin(u * Math.PI) * 0.35 + 0.5) +
        Math.sin(time * 1.1 + u * 3) * (2 + attract * 3);
      const r = plump * (0.55 + Math.sin(u * Math.PI) * 0.7);
      blob(fctx, x, y, r, 0.95);
    }

    // Extra mass on M's right foot / serif and S's lower-left serif
    blob(fctx, mRight - 4, mergeY0, plump * 0.85, 1);
    blob(fctx, sLeft + 4, mergeY0 + 2, plump * 0.9, 1);
    blob(fctx, lerp(mRight, sLeft, 0.5), mergeY0 - 2, plump * 1.05, 1);

    // Upper serif whisper-connect when attraction is high
    if (attract > 0.7) {
      const yTop = midY - Math.min(b.m.h, b.s.h) * 0.28;
      for (let i = 0; i < 5; i++) {
        const u = i / 4;
        blob(
          fctx,
          lerp(mRight, sLeft, u),
          yTop + Math.sin(u * Math.PI) * 6,
          plump * 0.35 * attract,
          0.7
        );
      }
    }

    // Blur → one solid organic silhouette
    fctx.filter = "blur(11px)";
    fctx.drawImage(field, 0, 0);
    fctx.filter = "none";

    // Threshold to flat solid black (no gradient shading)
    const img = fctx.getImageData(0, 0, w, h);
    const d = img.data;
    const thr = 150;
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
  document.addEventListener("pointerleave", () => {
    mouse.active = false;
  }, { passive: true });

  requestAnimationFrame(frame);
})();
