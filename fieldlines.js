(() => {
  const stage = document.getElementById("ms-stage");
  const svg = document.getElementById("fieldlines");
  const canvas = document.getElementById("ms-canvas");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !svg || !canvas || !letterM || !letterS) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const off = document.createElement("canvas");
  const octx = off.getContext("2d", { alpha: true });

  // One flat 2D mass silhouette + a few flat filament fills (no tubes)
  const mass = document.createElementNS("http://www.w3.org/2000/svg", "path");
  mass.setAttribute("class", "mass");
  svg.appendChild(mass);
  const filaments = [];
  for (let i = 0; i < 6; i++) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "mass");
    svg.appendChild(p);
    filaments.push(p);
  }

  let mouse = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  let hasMouse = false;
  let t0 = performance.now();
  let fontReady = false;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function soft(t, seed) {
    return Math.sin(t * 0.85 + seed * 12.9) * 0.6 + Math.sin(t * 1.55 + seed * 3.7) * 0.4;
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load('700 120px "Playfair Display"').then(() => {
      fontReady = true;
    });
  } else {
    fontReady = true;
  }

  function layout() {
    const sr = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(sr.width));
    const h = Math.max(1, Math.round(sr.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    return { sr, w, h };
  }

  /** Draw one Playfair glyph into offscreen, then mesh-warp into ctx */
  function drawWarpedLetter(ch, rect, sr, pullX, pullY, side, time) {
    const pad = 28;
    const bw = Math.max(2, Math.ceil(rect.width + pad * 2));
    const bh = Math.max(2, Math.ceil(rect.height + pad * 2));
    off.width = bw;
    off.height = bh;
    octx.clearRect(0, 0, bw, bh);
    octx.fillStyle = "#000";
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    const fs = rect.height * 1.05;
    octx.font = `700 ${fs}px "Playfair Display", "Times New Roman", Times, serif`;
    octx.fillText(ch, bw / 2, bh / 2 + fs * 0.04);

    const cols = 28;
    const rows = 18;
    const tension = Math.hypot(pullX, pullY);
    // Stretch toward / away from the gap + mouse
    const toward = side === "m" ? 1 : -1;
    const stretch = clamp(tension / 180, 0, 1.4);

    const destX = rect.left - sr.left - pad;
    const destY = rect.top - sr.top - pad;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u0 = i / cols;
        const v0 = j / rows;
        const u1 = (i + 1) / cols;
        const v1 = (j + 1) / rows;

        const cell = (u, v) => {
          // source in offscreen
          const sx = u * bw;
          const sy = v * bh;
          // normalized from letter center / inner edge
          const nx = side === "m" ? u : 1 - u; // 0 = outer, 1 = facing gap
          const ny = v - 0.5;
          // Elastic pull: inner edge stretches into the gap; outer lags
          const edge = nx * nx;
          const sep = pullX * toward;
          // When mouse drives letters apart (sep > 0 for both if pull away from mid...)
          // pullX is mouse-mid; positive = mouse right of mid
          const apart = side === "m" ? -pullX : pullX; // positive when mouse pulls this letter outward
          const warpX =
            toward * edge * (18 + stretch * 42) + // melt into center
            apart * edge * 0.22 + // stretch when pulled apart
            soft(time + u * 2, side === "m" ? 1 : 2) * edge * 6 +
            pullY * ny * edge * 0.12;
          const warpY =
            pullY * edge * 0.28 +
            apart * ny * edge * 0.15 +
            soft(time * 1.1 + v, 4) * edge * 8 +
            Math.sin((v + time * 0.4) * Math.PI) * edge * stretch * 10;
          return {
            dx: destX + sx + warpX,
            dy: destY + sy + warpY,
            sx,
            sy,
          };
        };

        const a = cell(u0, v0);
        const b = cell(u1, v0);
        const c = cell(u1, v1);
        const d = cell(u0, v1);

        // Flat 2D textured quad (no perspective)
        const sw = bw / cols;
        const sh = bh / rows;
        // Approximate with two triangles via drawImage slices — use path clip + drawImage
        octx; // keep ref
        // Map source rect with destination corners using transform approximation:
        // draw four-corner patch by slicing vertically (affine per column strip)
      }
    }

    // Column-strip warp (stable, flat, readable)
    const strips = 36;
    for (let i = 0; i < strips; i++) {
      const u0 = i / strips;
      const u1 = (i + 1) / strips;
      const sx = u0 * bw;
      const sw = Math.ceil((u1 - u0) * bw) + 1;
      const nx = side === "m" ? (u0 + u1) / 2 : 1 - (u0 + u1) / 2;
      const edge = nx * nx;
      const apart = side === "m" ? -pullX : pullX;
      const warpX =
        toward * edge * (16 + stretch * 38) +
        apart * edge * 0.25 +
        soft(time + u0 * 3, side === "m" ? 1 : 2) * edge * 5;
      // Vertical shear varies by column — letterform bends
      const shear = pullY * edge * 0.35 + apart * edge * 0.08 + soft(time, i) * edge * 4;

      for (let j = 0; j < 12; j++) {
        const v0 = j / 12;
        const v1 = (j + 1) / 12;
        const sy = v0 * bh;
        const sh = Math.ceil((v1 - v0) * bh) + 1;
        const ny = (v0 + v1) / 2 - 0.5;
        const warpY =
          shear * (ny * 2) +
          pullY * edge * 0.2 +
          soft(time * 1.05 + v0, 5) * edge * 7 +
          Math.sin(v0 * Math.PI) * edge * stretch * 8;

        const dx = destX + sx + warpX;
        const dy = destY + sy + warpY;
        // slight vertical stretch on inner edge when apart
        const vScale = 1 + edge * stretch * 0.12 + Math.abs(apart) * edge * 0.0008;
        ctx.drawImage(off, sx, sy, sw, sh, dx, dy, sw, sh * vScale);
      }
    }
  }

  function flatMass(mRect, sRect, sr, pullX, pullY, time) {
    const ml = mRect.left - sr.left;
    const mt = mRect.top - sr.top;
    const mw = mRect.width;
    const mh = mRect.height;
    const sl = sRect.left - sr.left;
    const st = sRect.top - sr.top;
    const sw = sRect.width;
    const sh = sRect.height;

    // Facing edges
    const left = ml + mw * 0.72;
    const right = sl + sw * 0.28;
    const top = Math.min(mt, st) + Math.min(mh, sh) * 0.12;
    const bot = Math.max(mt + mh, st + sh) - Math.min(mh, sh) * 0.1;
    const midX = (left + right) / 2 + pullX * 0.25;
    const midY = (top + bot) / 2 + pullY * 0.25;
    const bulge = 18 + Math.hypot(pullX, pullY) * 0.08 + soft(time, 9) * 10;
    const apart = Math.max(0, right - left);

    // Flat silhouette (single closed path) — no round tubes
    const d = [
      `M ${left.toFixed(1)} ${(mt + mh * 0.18).toFixed(1)}`,
      `L ${left.toFixed(1)} ${(mt + mh * 0.82).toFixed(1)}`,
      `Q ${(midX - bulge).toFixed(1)} ${(bot + soft(time, 1) * 8).toFixed(1)}, ${midX.toFixed(1)} ${(bot + bulge * 0.35).toFixed(1)}`,
      `Q ${(midX + bulge).toFixed(1)} ${(bot + soft(time, 2) * 8).toFixed(1)}, ${right.toFixed(1)} ${(st + sh * 0.82).toFixed(1)}`,
      `L ${right.toFixed(1)} ${(st + sh * 0.18).toFixed(1)}`,
      `Q ${(midX + bulge).toFixed(1)} ${(top - soft(time, 3) * 8).toFixed(1)}, ${midX.toFixed(1)} ${(top - bulge * 0.35).toFixed(1)}`,
      `Q ${(midX - bulge).toFixed(1)} ${(top - soft(time, 4) * 8).toFixed(1)}, ${left.toFixed(1)} ${(mt + mh * 0.18).toFixed(1)}`,
      "Z",
    ].join(" ");
    mass.setAttribute("d", d);
    mass.style.opacity = String(clamp(0.55 + (1 - clamp(apart / 120, 0, 1)) * 0.4, 0.35, 0.95));

    // Flat filled filaments (thin 2D shapes, not stroked tubes)
    for (let i = 0; i < filaments.length; i++) {
      const u = (i + 0.5) / filaments.length;
      const y0 = lerp(mt + mh * 0.15, mt + mh * 0.85, u);
      const y1 = lerp(st + sh * 0.15, st + sh * 0.85, u);
      const n = soft(time * 1.1, i * 2.2);
      const c1x = lerp(left, right, 0.35) + pullX * 0.15 + n * 12;
      const c1y = lerp(y0, y1, 0.3) + pullY * 0.2 + n * 10;
      const c2x = lerp(left, right, 0.65) + pullX * 0.15 - n * 10;
      const c2y = lerp(y0, y1, 0.7) + pullY * 0.2 - n * 8;
      const thick = 3.5 + (1 - Math.abs(u - 0.5) * 2) * 5;
      // Parallel curve offset → flat ribbon polygon
      const fd = [
        `M ${left.toFixed(1)} ${(y0 - thick).toFixed(1)}`,
        `C ${c1x.toFixed(1)} ${(c1y - thick).toFixed(1)}, ${c2x.toFixed(1)} ${(c2y - thick).toFixed(1)}, ${right.toFixed(1)} ${(y1 - thick).toFixed(1)}`,
        `L ${right.toFixed(1)} ${(y1 + thick).toFixed(1)}`,
        `C ${c2x.toFixed(1)} ${(c2y + thick).toFixed(1)}, ${c1x.toFixed(1)} ${(c1y + thick).toFixed(1)}, ${left.toFixed(1)} ${(y0 + thick).toFixed(1)}`,
        "Z",
      ].join(" ");
      filaments[i].setAttribute("d", fd);
      filaments[i].style.opacity = String(0.25 + (1 - Math.abs(u - 0.5) * 2) * 0.35);
    }
  }

  function draw(now) {
    requestAnimationFrame(draw);
    if (!home.classList.contains("is-active")) return;

    const { sr, w, h } = layout();
    const mRect = letterM.getBoundingClientRect();
    const sRect = letterS.getBoundingClientRect();
    if (sr.width < 8) return;

    const time = (now - t0) / 1000;
    const targetX = hasMouse ? mouse.x - sr.left : w * 0.5 + soft(time * 0.55, 1) * w * 0.03;
    const targetY = hasMouse ? mouse.y - sr.top : h * 0.42 + soft(time * 0.5, 2) * h * 0.02;
    smooth.x = lerp(smooth.x, targetX, 0.06);
    smooth.y = lerp(smooth.y, targetY, 0.06);

    const midX = (mRect.right + sRect.left) / 2 - sr.left;
    const midY = (mRect.top + mRect.bottom) / 2 - sr.top;
    const pullX = (smooth.x - midX) * 0.9;
    const pullY = (smooth.y - midY) * 0.9;

    // Move hit targets slightly so clicks stay aligned with warped mass
    const apartBoost = clamp(Math.abs(pullX) / 200, 0, 1);
    letterM.style.transform = `translate(${(-pullX * 0.04 - 6 - apartBoost * 8).toFixed(1)}px, ${(pullY * 0.03).toFixed(1)}px)`;
    letterS.style.transform = `translate(${(-pullX * 0.04 + 6 + apartBoost * 8).toFixed(1)}px, ${(-pullY * 0.03).toFixed(1)}px)`;

    flatMass(mRect, sRect, sr, pullX, pullY, time);

    ctx.clearRect(0, 0, w, h);
    if (fontReady) {
      drawWarpedLetter("M", mRect, sr, pullX, pullY, "m", time);
      drawWarpedLetter("S", sRect, sr, pullX, pullY, "s", time);
    }
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      hasMouse = true;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    },
    { passive: true }
  );
  document.addEventListener("pointerleave", () => { hasMouse = false; }, { passive: true });

  requestAnimationFrame(draw);
})();
