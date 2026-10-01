(() => {
  /**
   * Dual magnetic fluids (from v2): clear letter contours that melt together
   * on approach. Readable forms, merge cap, no cursor blot, full-page mouse.
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
  const MAX_EDGE = 1120;

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
    g.addColorStop(0.4, `rgba(255,255,255,${a * 0.65})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.arc(x, y, r, 0, Math.PI * 2);
    fctx.fill();
  }

  function softThreshold() {
    const img = fctx.getImageData(0, 0, iw, ih);
    const d = img.data;
    // Narrow ramp → cleaner contour, still slightly soft for fluid
    const lo = 148;
    const hi = 168;
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
    const baseY = (mCy + sCy) * 0.5 + Math.min(b.m.h, b.s.h) * 0.14;
    const gap = Math.max(4, sLeft - mRight);
    const strand = clamp(gap / (90 * scale), 0, 1);
    // meltStrength: thick bridge when close; thin whisper when far (clear dual contours)
    const meltStrength = clamp(mergeAmp * (0.35 + melt * 0.75) * (1 - strand * 0.65), 0, MERGE_CAP);
    const plump = (7 + meltStrength * 34) * scale;

    // Facing magnetic bulges — each fluid reaches toward the other
    const bulge = (10 + meltStrength * 38) * scale * (0.55 + melt * 0.55);
    const reachFrac = 0.15 + meltStrength * 0.42 * (1 - strand * 0.5);
    blob(mRight + gap * reachFrac * 0.45, baseY + Math.sin(time * 1.8) * 4 * scale, bulge, 1);
    blob(sLeft - gap * reachFrac * 0.45, baseY + Math.cos(time * 1.9) * 4 * scale, bulge * 1.05, 1);
    // Secondary facing lobes (serif / waist height) for dual-body read
    blob(
      mRight + gap * reachFrac * 0.25,
      baseY - Math.min(b.m.h, b.s.h) * 0.22 + Math.sin(time * 2.3) * 3 * scale,
      bulge * 0.55,
      0.9
    );
    blob(
      sLeft - gap * reachFrac * 0.25,
      baseY - Math.min(b.m.h, b.s.h) * 0.18 + Math.cos(time * 2.1) * 3 * scale,
      bulge * 0.55,
      0.9
    );

    // Magnetic bridges: several soft strands that thicken as they melt
    const bridges = 3;
    for (let bi = 0; bi < bridges; bi++) {
      const by =
        baseY +
        (bi - 1) * Math.min(b.m.h, b.s.h) * (0.1 + melt * 0.06) +
        Math.sin(time * 1.4 + bi) * 2.5 * scale;
      const lobes = 6 + Math.round(meltStrength * 3);
      for (let i = 0; i < lobes; i++) {
        const u = i / (lobes - 1 || 1);
        const x0 = lerp(mRight, sLeft, u);
        const bend = u * (1 - u) * 4;
        const wave =
          Math.sin(time * 2.1 + u * Math.PI * 2 + bi) *
            (3 + meltStrength * 7) *
            scale *
            (1 - strand * 0.45) +
          Math.sin(time * 3.2 + u * 4 + bi * 0.7) * 1.5 * scale;
        const pullY = mouse.active ? (smooth.y - by) * bend * (0.14 + prox * 0.1) : 0;
        const pullX = mouse.active ? (smooth.x - x0) * bend * (0.07 + prox * 0.06) : 0;
        // Radius peaks at mid when melting; stays thin at ends so letters stay letter-shaped
        const mid = Math.sin(u * Math.PI);
        const r =
          plump *
          (0.22 + mid * (0.55 + meltStrength * 0.55)) *
          (0.55 + meltStrength * 0.5) *
          (1 - strand * 0.5) *
          (0.88 + 0.12 * Math.sin(time * 2.4 + i + bi));
        // When far apart / low melt, almost no mid bridge — clear dual contours
        if (r < 2.2 * scale && meltStrength < 0.35 && mid > 0.25) continue;
        blob(x0 + pullX, by + wave * mid + pullY, Math.max(2.2 * scale, r), 0.92);
      }
    }

    // Anchor beads on each letter's facing edge (two fluids, not one puddle)
    blob(mRight - 2 * scale, baseY, plump * (0.7 + meltStrength * 0.25), 1);
    blob(sLeft + 2 * scale, baseY, plump * (0.75 + meltStrength * 0.25), 1);

    // Light blur only — fluid merge without mushy letter edges
    const blurPx = Math.max(2.2, 5.2 * scale);
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
