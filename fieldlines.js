(() => {
  /**
   * Ferrofluid MS — ground-up rebuild.
   * Continuous glossy liquid in Playfair 700 molds on brushed metal.
   * Soft rounded attraction lobes + viscous threads toward the mouse.
   * Never paints discrete beads or straight line meshes.
   */
  const stage = document.getElementById("ms-stage");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !canvas || !letterM || !letterS || !home) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { willReadFrequently: true });
  const shade = document.createElement("canvas");
  const sctx = shade.getContext("2d");
  const metal = document.createElement("canvas");
  const mctx = metal.getContext("2d");

  let mouse = { x: 0, y: 0, active: false };
  let smoothMouse = { x: 0, y: 0 };
  let w = 0;
  let h = 0;
  let dpr = 1;
  let t0 = performance.now();
  let fontReady = false;
  let metalDirty = true;

  const FONT =
    '700 1px "Playfair Display", "Times New Roman", Times, Georgia, serif';

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function ensureFonts() {
    if (document.fonts && document.fonts.load) {
      document.fonts
        .load('700 220px "Playfair Display"')
        .then(() => {
          fontReady = true;
        })
        .catch(() => {
          fontReady = true;
        });
      setTimeout(() => {
        fontReady = true;
      }, 600);
    } else {
      fontReady = true;
    }
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
      shade.width = w;
      shade.height = h;
      metal.width = w;
      metal.height = h;
      metalDirty = true;
    }
    return sr;
  }

  function paintMetal() {
    const g = mctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2c3036");
    g.addColorStop(0.5, "#23262b");
    g.addColorStop(1, "#1a1d21");
    mctx.fillStyle = g;
    mctx.fillRect(0, 0, w, h);

    // Horizontal brushed grain
    mctx.globalAlpha = 0.08;
    for (let y = 0; y < h; y += 2) {
      const shadeN = 40 + ((y * 17) % 50);
      mctx.strokeStyle = `rgb(${shadeN},${shadeN + 2},${shadeN + 4})`;
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(0, y + 0.5);
      // slight irregularity
      for (let x = 0; x < w; x += 48) {
        mctx.lineTo(x + 24, y + 0.5 + ((x + y) % 3) - 1);
        mctx.lineTo(x + 48, y + 0.5);
      }
      mctx.stroke();
    }
    mctx.globalAlpha = 0.045;
    for (let i = 0; i < 1200; i++) {
      const x = (i * 97) % w;
      const y = (i * 53) % h;
      mctx.fillStyle = i % 2 ? "#000" : "#fff";
      mctx.fillRect(x, y, 1, 1);
    }
    mctx.globalAlpha = 1;

    // Soft tray vignette
    const v = mctx.createRadialGradient(
      w * 0.5,
      h * 0.42,
      Math.min(w, h) * 0.15,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.75
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    mctx.fillStyle = v;
    mctx.fillRect(0, 0, w, h);
    metalDirty = false;
  }

  function glyphMetrics(sr) {
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

  function drawGlyph(target, ch, box, fill, extraScale) {
    const fs = Math.max(12, box.h * 1.02 * (extraScale || 1));
    target.fillStyle = fill;
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.font = FONT.replace("1px", fs + "px");
    target.fillText(ch, box.cx, box.cy + fs * 0.03);
  }

  function softBlob(target, x, y, r, alpha) {
    const g = target.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    target.fillStyle = g;
    target.beginPath();
    target.arc(x, y, r, 0, Math.PI * 2);
    target.fill();
  }

  function buildField(sr, time) {
    const g = glyphMetrics(sr);
    const mx = smoothMouse.x;
    const my = smoothMouse.y;

    // Pull amount: stronger when mouse between / near letters
    const midX = (g.m.cx + g.s.cx) * 0.5;
    const midY = (g.m.cy + g.s.cy) * 0.5;
    const toMouse = mouse.active
      ? Math.hypot(mx - midX, my - midY)
      : 9999;
    const attract = mouse.active
      ? clamp(1 - toMouse / (Math.min(w, h) * 0.55), 0, 1)
      : 0.25 + 0.1 * Math.sin(time * 0.7);

    // Letters lean slightly toward each other / mouse
    const pullM = {
      x: lerp(0, (g.s.cx - g.m.cx) * 0.04 + (mouse.active ? (mx - g.m.cx) * 0.03 : 0), attract),
      y: lerp(0, (mouse.active ? (my - g.m.cy) * 0.04 : Math.sin(time) * 2), attract),
    };
    const pullS = {
      x: lerp(0, (g.m.cx - g.s.cx) * 0.04 + (mouse.active ? (mx - g.s.cx) * 0.03 : 0), attract),
      y: lerp(0, (mouse.active ? (my - g.s.cy) * 0.04 : Math.cos(time) * 2), attract),
    };

    const boxM = {
      cx: g.m.cx + pullM.x,
      cy: g.m.cy + pullM.y,
      h: g.m.h,
      w: g.m.w,
    };
    const boxS = {
      cx: g.s.cx + pullS.x,
      cy: g.s.cy + pullS.y,
      h: g.s.h,
      w: g.s.w,
    };

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, w, h);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, w, h);

    // Continuous letter bodies (white = liquid field)
    drawGlyph(fctx, "M", boxM, "#fff", 1);
    drawGlyph(fctx, "S", boxS, "#fff", 1);

    // Soft plumping of serifs / body toward partner (magnetic)
    const faceMX = boxM.cx + boxM.w * 0.28;
    const faceSX = boxS.cx - boxS.w * 0.28;
    for (let i = 0; i < 9; i++) {
      const u = i / 8;
      const y = lerp(boxM.cy - boxM.h * 0.32, boxM.cy + boxM.h * 0.32, u);
      const y2 = lerp(boxS.cy - boxS.h * 0.32, boxS.cy + boxS.h * 0.32, u);
      const r = (10 + attract * 18) * (0.75 + Math.sin(u * Math.PI) * 0.35);
      softBlob(fctx, faceMX, y, r, 0.85);
      softBlob(fctx, faceSX, y2, r, 0.85);
    }

    // Viscous bridge between facing edges
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const x = lerp(faceMX, faceSX, u);
      const y =
        lerp(boxM.cy, boxS.cy, u) +
        Math.sin(u * Math.PI) * (8 + attract * 22) * Math.sin(time * 1.2 + u);
      const r = (14 + attract * 26) * (0.55 + Math.sin(u * Math.PI) * 0.7);
      softBlob(fctx, x, y, r, 0.7 + attract * 0.25);
    }

    // Soft rounded lobes / sticky threads toward mouse (not sharp spikes)
    if (mouse.active && attract > 0.02) {
      const targets = [
        { x: faceMX, y: boxM.cy },
        { x: faceSX, y: boxS.cy },
        { x: boxM.cx, y: boxM.cy - boxM.h * 0.15 },
        { x: boxS.cx, y: boxS.cy + boxS.h * 0.1 },
      ];
      for (let t = 0; t < targets.length; t++) {
        const a = targets[t];
        for (let k = 1; k <= 8; k++) {
          const u = k / 8;
          const x = lerp(a.x, mx, u);
          const y = lerp(a.y, my, u);
          const r =
            (18 - u * 11) * (0.55 + attract) +
            Math.sin(time * 3 + t + u * 6) * 2;
          softBlob(fctx, x, y, Math.max(4, r), 0.55 * (1 - u * 0.35));
        }
        // bulbous tip near cursor
        softBlob(fctx, lerp(a.x, mx, 0.82), lerp(a.y, my, 0.82), 10 + attract * 14, 0.75);
      }
      softBlob(fctx, mx, my, 12 + attract * 16, 0.65);
    }

    // Idle breathing bulge between letters
    if (!mouse.active) {
      softBlob(
        fctx,
        midX + Math.sin(time) * 6,
        midY + Math.cos(time * 0.8) * 4,
        16 + Math.sin(time * 1.3) * 4,
        0.55
      );
    }

    // Blur → continuous liquid surface
    fctx.filter = "blur(14px)";
    fctx.drawImage(field, 0, 0);
    fctx.filter = "none";

    return { boxM, boxS, attract };
  }

  function thresholdAndShade() {
    const img = fctx.getImageData(0, 0, w, h);
    const data = img.data;
    const out = sctx.createImageData(w, h);
    const od = out.data;
    const thr = 140;

    for (let i = 0; i < data.length; i += 4) {
      const v = data[i]; // red channel of white field
      if (v < thr) {
        od[i + 3] = 0;
        continue;
      }
      // Edge softness
      const t = clamp((v - thr) / (255 - thr), 0, 1);
      const px = (i / 4) % w;
      const py = ((i / 4) / w) | 0;
      // Fake glossy lighting from top-left
      const nx = (px / w) * 2 - 1;
      const ny = (py / h) * 2 - 1;
      const lit = clamp(0.22 + (-nx * 0.15 - ny * 0.55) + t * 0.15, 0.05, 0.85);
      const spec = Math.pow(clamp(0.55 - ny * 0.9 - Math.abs(nx) * 0.25, 0, 1), 8);
      const c = Math.round(8 + lit * 38 + spec * 160);
      od[i] = c;
      od[i + 1] = c;
      od[i + 2] = Math.min(255, c + 4);
      od[i + 3] = Math.round(230 + t * 25);
    }
    sctx.putImageData(out, 0, 0);
  }

  function drawLips(boxM, boxS) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "round";
    const drawRim = (ch, box) => {
      const fs = Math.max(12, box.h * 1.02);
      ctx.font = FONT.replace("1px", fs + "px");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "rgba(170,175,180,0.28)";
      ctx.strokeText(ch, box.cx, box.cy + fs * 0.03);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.strokeText(ch, box.cx + 0.8, box.cy + fs * 0.03 + 1);
    };
    drawRim("M", boxM);
    drawRim("S", boxS);
    ctx.restore();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!home.classList.contains("is-active") || home.hidden) return;

    const sr = layout();
    if (w < 8 || h < 8) return;

    const time = (now - t0) / 1000;
    const targetX = mouse.active ? mouse.x - sr.left : w * 0.5;
    const targetY = mouse.active ? mouse.y - sr.top : h * 0.42;
    smoothMouse.x = lerp(smoothMouse.x || targetX, targetX, 0.12);
    smoothMouse.y = lerp(smoothMouse.y || targetY, targetY, 0.12);

    if (metalDirty) paintMetal();
    ctx.drawImage(metal, 0, 0);

    const { boxM, boxS } = buildField(sr, time);
    thresholdAndShade();
    drawLips(boxM, boxS);
    ctx.drawImage(shade, 0, 0);
  }

  ensureFonts();
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
    metalDirty = true;
  });

  requestAnimationFrame(frame);
})();
