(() => {
  /**
   * Dual magnetic fluids: whole-body attraction, continuous melt bridge.
   * Cleaner field (fewer soft masses, more blur) — less pixel noise.
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
  let deformM = { sx: 1, sy: 1, skew: 0, pullX: 0, pullY: 0 };
  let deformS = { sx: 1, sy: 1, skew: 0, pullX: 0, pullY: 0 };
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
  const MAX_EDGE = 1280;

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

  // Full-resolution black glyphs — crisp contour on top of soft fluid
  function drawSharpGlyph(ch, cx, cy, boxH) {
    const fs = Math.max(12, boxH * 1.02);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = FONT.replace("1px", fs + "px");
    ctx.fillText(ch, cx, cy + fs * 0.03);
  }

  function drawGlyphWarped(ch, cx, cy, boxH, def) {
    const fs = Math.max(12, boxH * 1.02);
    fctx.save();
    fctx.translate(cx, cy);
    fctx.transform(def.sx, 0, Math.tan(def.skew * 0.55), def.sy, 0, 0);
    fctx.fillStyle = "#fff";
    fctx.textAlign = "center";
    fctx.textBaseline = "middle";
    fctx.font = FONT.replace("1px", fs + "px");
    fctx.fillText(ch, 0, fs * 0.03);
    fctx.restore();
  }

  function drawSharpGlyphWarped(ch, cx, cy, boxH, def) {
    const fs = Math.max(12, boxH * 1.02);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.transform(def.sx, 0, Math.tan(def.skew * 0.55), def.sy, 0, 0);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = FONT.replace("1px", fs + "px");
    ctx.fillText(ch, 0, fs * 0.03);
    ctx.restore();
  }

  function blob(x, y, r, a) {
    if (r < 0.5) return;
    const g = fctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.45, `rgba(255,255,255,${a * 0.55})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.arc(x, y, r, 0, Math.PI * 2);
    fctx.fill();
  }

  // Soft ellipse mass — covers a letter body or a continuous bridge lobe
  function softEllipse(x, y, rx, ry, a) {
    if (rx < 0.5 || ry < 0.5) return;
    fctx.save();
    fctx.translate(x, y);
    fctx.scale(rx, ry);
    const g = fctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.arc(0, 0, 1, 0, Math.PI * 2);
    fctx.fill();
    fctx.restore();
  }

  // Continuous magnetic filament between two points (whole-body link, not dotted)
  function softCapsule(x0, y0, x1, y1, radius, a) {
    if (radius < 0.5) return;
    fctx.save();
    fctx.strokeStyle = `rgba(255,255,255,${a})`;
    fctx.lineWidth = radius * 2;
    fctx.lineCap = "round";
    fctx.lineJoin = "round";
    fctx.shadowColor = `rgba(255,255,255,${a * 0.85})`;
    fctx.shadowBlur = radius * 1.1;
    fctx.beginPath();
    fctx.moveTo(x0, y0);
    fctx.lineTo(x1, y1);
    fctx.stroke();
    fctx.restore();
  }

  function softThreshold() {
    const img = fctx.getImageData(0, 0, iw, ih);
    const d = img.data;
    // Slightly wider ramp + higher res = less stair-step noise
    const lo = 132;
    const hi = 172;
    const inv = 1 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      if (v <= lo) {
        d[i + 3] = 0;
      } else {
        const tt = v >= hi ? 1 : (v - lo) * inv;
        // smoothstep for cleaner edges
        const t = tt * tt * (3 - 2 * tt);
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
    const reach = Math.min(iw, ih) * 0.62;
    const outward = mouse.active ? clamp(dist / reach, 0, 1.45) : 0.12;
    const inward = mouse.active ? clamp(1 - dist / (reach * 0.72), 0, 1) : 0.5;
    // Proximity to either letter (field space) — drives form warp
    const dM = Math.hypot(smooth.x - b.m.cx, smooth.y - b.m.cy);
    const dS = Math.hypot(smooth.x - b.s.cx, smooth.y - b.s.cy);
    const nearR = Math.min(b.m.h, b.s.h) * 1.35;
    const proxM = mouse.active ? clamp(1 - dM / nearR, 0, 1) : 0;
    const proxS = mouse.active ? clamp(1 - dS / nearR, 0, 1) : 0;
    // Soft proximity — never strong enough to collapse into one cursor blob
    const prox = Math.max(proxM, proxS, inward * 0.65) * 0.72;
    // How hard the two fluids want to melt into each other (not toward the cursor)
    const melt = mouse.active
      ? clamp(inward * 0.85 + (1 - clamp(outward, 0, 1)) * 0.55 + prox * 0.25, 0, 1)
      : 0.4 + 0.12 * Math.sin(time * 0.55);

    // Pull-together capped — two bodies stay readable while magnetically linking
    const MERGE_CAP = 1.05;
    const together = mouse.active
      ? lerp(38 + melt * 10, -55, clamp(outward, 0, 1))
      : 10 + Math.sin(time * 0.7) * 4;
    const attractMerge = mouse.active
      ? clamp(
          lerp(0.35 + melt * 0.85, 0.14, clamp(outward / 1.05, 0, 1)) * (0.75 + prox * 0.25),
          0.12,
          MERGE_CAP
        )
      : 0.42 + 0.14 * Math.sin(time * 0.65);

    const leanAmt = 0.12 + prox * 0.18;
    const leanM = mouse.active ? ((smooth.x - b.m.cx) / scale) * leanAmt * (0.55 + outward * 0.5 + proxM) : 0;
    const leanS = mouse.active ? ((smooth.x - b.s.cx) / scale) * leanAmt * (0.55 + outward * 0.5 + proxS) : 0;
    const leanMY = mouse.active ? ((smooth.y - b.m.cy) / scale) * (0.14 + proxM * 0.12) : 0;
    const leanSY = mouse.active ? ((smooth.y - b.s.cy) / scale) * (0.14 + proxS * 0.12) : 0;

    // Snappier springs
    springToward(
      posM,
      together + leanM + Math.sin(time * 1.1) * 2.5,
      leanMY + Math.cos(time * 0.9) * 2.2,
      0.11,
      0.82
    );
    springToward(
      posS,
      -together + leanS + Math.sin(time * 1.1 + 1.2) * 2.5,
      leanSY + Math.cos(time * 0.9 + 0.8) * 2.2,
      0.11,
      0.82
    );

    const mergeTarget = attractMerge;
    mergeVel = (mergeVel + (mergeTarget - mergeAmp) * 0.14) * 0.88;
    mergeAmp = clamp(mergeAmp + mergeVel, 0.12, MERGE_CAP);

    // Letter-form distortion toward the cursor (skew / stretch / squash)
    function aimDeform(def, cx, cy, proxLetter, towardSiblingX) {
      const dx = mouse.active ? (smooth.x - cx) / scale : 0;
      const dy = mouse.active ? (smooth.y - cy) / scale : 0;
      const pull = proxLetter * proxLetter * 0.75;
      const magnetic = melt * melt;
      const tSx =
        1 +
        pull * clamp(dx / 180, -0.28, 0.28) +
        magnetic * 0.1 +
        towardSiblingX * magnetic * 0.06;
      const tSy = 1 + pull * clamp(dy / 200, -0.24, 0.24) - prox * 0.05 * pull - magnetic * 0.04;
      const tSkew = pull * clamp(dx / 120, -0.32, 0.32) + towardSiblingX * magnetic * 0.12;
      const tPullX = pull * clamp(dx * 0.12, -18, 18) + towardSiblingX * magnetic * 10;
      const tPullY = pull * clamp(dy * 0.1, -14, 14);
      def.sx = lerp(def.sx, tSx, 0.16);
      def.sy = lerp(def.sy, clamp(tSy, 0.82, 1.22), 0.16);
      def.skew = lerp(def.skew, tSkew, 0.16);
      def.pullX = lerp(def.pullX, tPullX, 0.16);
      def.pullY = lerp(def.pullY, tPullY, 0.16);
    }
    // +1 = stretch toward S (right), -1 = stretch toward M (left)
    aimDeform(deformM, b.m.cx, b.m.cy, Math.max(proxM, inward * 0.55), 1);
    aimDeform(deformS, b.s.cx, b.s.cy, Math.max(proxS, inward * 0.55), -1);

    // Keep a readable gap between glyph centers (never fully fused)
    const minSep = Math.max(b.m.w, b.s.w) / scale * 0.42;
    const gapX = (b.s.cx - b.m.cx) / scale + (posS.x + deformS.pullX) - (posM.x + deformM.pullX);
    if (gapX < minSep) {
      const fix = (minSep - gapX) * 0.5;
      posM.x -= fix;
      posS.x += fix;
    }

    letterM.style.transform =
      `translate(${(posM.x + deformM.pullX).toFixed(2)}px, ${(posM.y + deformM.pullY).toFixed(2)}px) ` +
      `skewX(${(deformM.skew * 18).toFixed(2)}deg) scale(${deformM.sx.toFixed(3)}, ${deformM.sy.toFixed(3)})`;
    letterS.style.transform =
      `translate(${(posS.x + deformS.pullX).toFixed(2)}px, ${(posS.y + deformS.pullY).toFixed(2)}px) ` +
      `skewX(${(deformS.skew * 18).toFixed(2)}deg) scale(${deformS.sx.toFixed(3)}, ${deformS.sy.toFixed(3)})`;

    // Invalidate box cache when letters move a lot
    if (Math.abs(posM.vx) + Math.abs(posS.vx) > 0.4) boxAge = 99;

    const mCx = b.m.cx + (posM.x + deformM.pullX) * scale;
    const mCy = b.m.cy + (posM.y + deformM.pullY) * scale;
    const sCx = b.s.cx + (posS.x + deformS.pullX) * scale;
    const sCy = b.s.cy + (posS.y + deformS.pullY) * scale;

    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, iw, ih);

    drawGlyphWarped("M", mCx, mCy, b.m.h, deformM);
    drawGlyphWarped("S", sCx, sCy, b.s.h, deformS);

    const mRight = mCx + b.m.w * 0.28;
    const sLeft = sCx - b.s.w * 0.28;
    const letterH = Math.min(b.m.h, b.s.h);
    const baseY = (mCy + sCy) * 0.5 + letterH * 0.12;
    const gap = Math.max(4, sLeft - mRight);
    const strand = clamp(gap / (90 * scale), 0, 1);
    const meltStrength = clamp(
      mergeAmp * (0.35 + melt * 0.75) * (1 - strand * 0.65),
      0,
      MERGE_CAP
    );

    // Whole-body magnetic auras — attraction from the full letter mass
    softEllipse(mCx, mCy, b.m.w * 0.48, b.m.h * 0.52, 0.55 + meltStrength * 0.2);
    softEllipse(sCx, sCy, b.s.w * 0.46, b.s.h * 0.52, 0.55 + meltStrength * 0.2);
    // Facing halves stretch toward each other as continuous bodies
    const bodyReach = gap * (0.12 + meltStrength * 0.38);
    softEllipse(
      mCx + b.m.w * 0.18 + bodyReach * 0.35,
      mCy + letterH * 0.06,
      b.m.w * (0.38 + meltStrength * 0.22) + bodyReach * 0.25,
      b.m.h * (0.42 + meltStrength * 0.08),
      0.75 + meltStrength * 0.2
    );
    softEllipse(
      sCx - b.s.w * 0.18 - bodyReach * 0.35,
      sCy + letterH * 0.04,
      b.s.w * (0.36 + meltStrength * 0.22) + bodyReach * 0.25,
      b.s.h * (0.42 + meltStrength * 0.08),
      0.75 + meltStrength * 0.2
    );

    // Continuous melt bridges (capsules) — not dotted point chains
    const bendY = mouse.active
      ? (smooth.y - baseY) * 0.1 * (0.5 + meltStrength * 0.5)
      : Math.sin(time * 1.3) * 3 * scale;
    const bridgeW = (6 + meltStrength * 28) * scale * (1 - strand * 0.45);
    const yBands = [
      baseY - letterH * 0.16,
      baseY,
      baseY + letterH * 0.14,
    ];
    for (let bi = 0; bi < yBands.length; bi++) {
      const by = yBands[bi] + bendY * (bi === 1 ? 1 : 0.45);
      const wMul = bi === 1 ? 1 : 0.62 + meltStrength * 0.2;
      // Skip side bands when far / low melt — keeps dual contours clear
      if (bi !== 1 && meltStrength < 0.28 && strand > 0.55) continue;
      softCapsule(
        mRight - 4 * scale,
        by + Math.sin(time * 1.7 + bi) * 2 * scale,
        sLeft + 4 * scale,
        by + Math.cos(time * 1.6 + bi) * 2 * scale,
        bridgeW * wMul,
        0.55 + meltStrength * 0.4
      );
    }

    // Soft mid mass when strongly melting — one continuous pool, not a cursor blot
    if (meltStrength > 0.45 && strand < 0.55) {
      softEllipse(
        lerp(mRight, sLeft, 0.5) + Math.sin(time * 1.5) * 3 * scale,
        baseY + bendY * 0.5,
        gap * (0.28 + meltStrength * 0.22) + bridgeW,
        bridgeW * (1.1 + meltStrength * 0.5),
        0.7 + meltStrength * 0.25
      );
    }

    // Extra blur pass — smooths capsules/ellipses, kills pixel noise
    const blurPx = Math.max(3.8, 8.2 * scale);
    fctx.filter = `blur(${blurPx.toFixed(2)}px)`;
    fctx.drawImage(field, 0, 0);
    fctx.filter = "none";

    softThreshold();

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(field, 0, 0, cssW, cssH);

    // Stamp crisp Playfair on top (display resolution)
    const mCxCss = b.m.cx / scale + posM.x;
    const mCyCss = b.m.cy / scale + posM.y;
    const sCxCss = b.s.cx / scale + posS.x;
    const sCyCss = b.s.cy / scale + posS.y;
    drawSharpGlyphWarped("M", mCxCss + deformM.pullX, mCyCss + deformM.pullY, b.m.h / scale, deformM);
    drawSharpGlyphWarped("S", sCxCss + deformS.pullX, sCyCss + deformS.pullY, b.s.h / scale, deformS);
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
