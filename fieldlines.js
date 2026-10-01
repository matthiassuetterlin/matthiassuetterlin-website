(() => {
  const stage = document.getElementById("ms-stage");
  const svg = document.getElementById("fieldlines");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !svg || !letterM || !letterS) return;

  const RIBBONS = 14;
  const BLOBS = 5;
  const DROPS = 9;

  const ribbons = [];
  const blobs = [];
  const drops = [];

  for (let i = 0; i < RIBBONS; i++) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "ribbon");
    svg.appendChild(p);
    ribbons.push(p);
  }
  for (let i = 0; i < BLOBS; i++) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "blob");
    svg.appendChild(p);
    blobs.push(p);
  }
  for (let i = 0; i < DROPS; i++) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", "drop");
    svg.appendChild(c);
    drops.push({ el: c, phase: Math.random() * Math.PI * 2, speed: 0.35 + Math.random() * 0.55, r: 3 + Math.random() * 9 });
  }

  let mouse = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  let hasMouse = false;
  let t0 = performance.now();

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function softNoise(t, seed) {
    return Math.sin(t * 0.9 + seed * 12.9898) * 0.55 + Math.sin(t * 1.7 + seed * 4.1) * 0.45;
  }

  /** Anchor points along letter edges that act as “serifs” pulling toward each other */
  function serifAnchors(rect, sr, side) {
    const x0 = rect.left - sr.left;
    const y0 = rect.top - sr.top;
    const w = rect.width;
    const h = rect.height;
    const pts = [];
    // top serif, mid stem, bottom serif — plus extras for viscosity
    const ys = [0.08, 0.22, 0.38, 0.5, 0.62, 0.78, 0.92];
    for (let i = 0; i < ys.length; i++) {
      const u = ys[i];
      const y = y0 + h * u;
      if (side === "m") {
        pts.push({
          u,
          outer: { x: x0 + w * 0.08, y },
          inner: { x: x0 + w * 0.94, y },
          tip: { x: x0 + w * (u < 0.2 || u > 0.8 ? 0.98 : 0.88), y: y + (u - 0.5) * h * 0.04 },
        });
      } else {
        pts.push({
          u,
          outer: { x: x0 + w * 0.92, y },
          inner: { x: x0 + w * 0.06, y },
          tip: { x: x0 + w * (u < 0.2 || u > 0.8 ? 0.02 : 0.12), y: y + (u - 0.5) * h * 0.04 },
        });
      }
    }
    return pts;
  }

  function draw(now) {
    requestAnimationFrame(draw);
    if (!home.classList.contains("is-active")) return;

    const sr = stage.getBoundingClientRect();
    const mr = letterM.getBoundingClientRect();
    const srr = letterS.getBoundingClientRect();
    if (sr.width < 8) return;

    svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);
    svg.setAttribute("width", String(sr.width));
    svg.setAttribute("height", String(sr.height));

    const time = (now - t0) / 1000;
    const targetX = hasMouse ? mouse.x - sr.left : sr.width * 0.5 + softNoise(time * 0.6, 1) * sr.width * 0.04;
    const targetY = hasMouse ? mouse.y - sr.top : sr.height * 0.42 + softNoise(time * 0.5, 2) * sr.height * 0.03;
    // Viscous lag — slow, heavy
    smooth.x = lerp(smooth.x, targetX, 0.045);
    smooth.y = lerp(smooth.y, targetY, 0.045);

    const midX = (mr.right + srr.left) / 2 - sr.left;
    const midY = (mr.top + mr.bottom) / 2 - sr.top;
    const pullX = (smooth.x - midX) * 0.55;
    const pullY = (smooth.y - midY) * 0.55;

    // Gentle squash toward each other — serifs “attract”
    const attract = 10 + Math.abs(softNoise(time, 0)) * 6;
    const mx = clamp(pullX * 0.04 + softNoise(time * 0.7, 3) * 4, -14, 14);
    const my = clamp(pullY * 0.035 + softNoise(time * 0.65, 4) * 3, -10, 10);
    letterM.style.transform = `translate(${mx + attract * 0.35}px, ${my}px) scale(${1.02 + softNoise(time * 0.5, 5) * 0.015}, ${0.985 + softNoise(time * 0.55, 6) * 0.012})`;
    letterS.style.transform = `translate(${-mx - attract * 0.35}px, ${-my * 0.9}px) scale(${1.02 + softNoise(time * 0.5, 7) * 0.015}, ${0.985 + softNoise(time * 0.55, 8) * 0.012})`;

    const mA = serifAnchors(mr, sr, "m");
    const sA = serifAnchors(srr, sr, "s");

    // Thick viscous ribbons between facing serifs
    for (let i = 0; i < RIBBONS; i++) {
      const ai = Math.min(mA.length - 1, Math.floor((i / (RIBBONS - 1)) * (mA.length - 1)));
      const a = mA[ai];
      const b = sA[ai];
      const n1 = softNoise(time * 1.1, i * 1.7);
      const n2 = softNoise(time * 0.85, i * 2.3 + 2);
      const fan = (a.u - 0.5) * 2;

      const x0 = a.tip.x;
      const y0 = a.tip.y + n1 * 6;
      const x1 = lerp(a.tip.x, b.tip.x, 0.28) + pullX * 0.2 + n2 * 10;
      const y1 = lerp(a.tip.y, b.tip.y, 0.22) + fan * 18 + n1 * 14 + pullY * 0.25;
      const x2 = lerp(a.tip.x, b.tip.x, 0.5) + pullX * 0.45 + n1 * 16;
      const y2 = lerp(a.tip.y, b.tip.y, 0.5) + pullY * 0.5 + fan * (28 + Math.abs(n2) * 12) + Math.sin(time * 1.2 + i) * 10;
      const x3 = lerp(a.tip.x, b.tip.x, 0.72) - pullX * 0.15 + n2 * 10;
      const y3 = lerp(a.tip.y, b.tip.y, 0.78) - fan * 16 + n1 * 12;
      const x4 = b.tip.x;
      const y4 = b.tip.y + n2 * 6;

      const d = `M ${x0.toFixed(1)} ${y0.toFixed(1)} C ${x1.toFixed(1)} ${y1.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)} C ${x3.toFixed(1)} ${y3.toFixed(1)}, ${x4.toFixed(1)} ${y4.toFixed(1)}, ${x4.toFixed(1)} ${y4.toFixed(1)}`;
      ribbons[i].setAttribute("d", d);
      // Thick center filaments, thinner outer — milk-bridge look
      const weight = 4.5 + (1 - Math.abs(fan)) * 7 + Math.abs(n1) * 3;
      ribbons[i].setAttribute("stroke-width", weight.toFixed(2));
      ribbons[i].style.opacity = String(0.55 + (1 - Math.abs(fan)) * 0.35);
    }

    // Soft filled bridges / puddles in the gap (viscous mass)
    for (let i = 0; i < BLOBS; i++) {
      const u = (i + 0.5) / BLOBS;
      const a = mA[Math.min(mA.length - 1, Math.round(u * (mA.length - 1)))];
      const b = sA[Math.min(sA.length - 1, Math.round(u * (sA.length - 1)))];
      const n = softNoise(time * 0.9, i * 5.1);
      const cx = lerp(a.tip.x, b.tip.x, 0.5) + pullX * 0.35 + n * 8;
      const cy = lerp(a.tip.y, b.tip.y, 0.5) + pullY * 0.35 + softNoise(time, i) * 10;
      const rx = 22 + (1 - Math.abs(u - 0.5) * 2) * 38 + Math.abs(n) * 14;
      const ry = 16 + Math.abs(n) * 18 + Math.sin(time + i) * 6;
      const left = a.tip.x - 4;
      const right = b.tip.x + 4;
      const d = [
        `M ${left.toFixed(1)} ${a.tip.y.toFixed(1)}`,
        `C ${(left + rx * 0.4).toFixed(1)} ${(a.tip.y - ry).toFixed(1)}, ${(cx - rx * 0.3).toFixed(1)} ${(cy - ry * 1.1).toFixed(1)}, ${cx.toFixed(1)} ${(cy - ry * 0.7).toFixed(1)}`,
        `C ${(cx + rx * 0.35).toFixed(1)} ${(cy - ry).toFixed(1)}, ${(right - rx * 0.35).toFixed(1)} ${(b.tip.y - ry * 0.6).toFixed(1)}, ${right.toFixed(1)} ${b.tip.y.toFixed(1)}`,
        `C ${(right - 6).toFixed(1)} ${(b.tip.y + ry * 0.85).toFixed(1)}, ${(cx + rx * 0.2).toFixed(1)} ${(cy + ry * 1.05).toFixed(1)}, ${cx.toFixed(1)} ${(cy + ry * 0.75).toFixed(1)}`,
        `C ${(cx - rx * 0.25).toFixed(1)} ${(cy + ry).toFixed(1)}, ${(left + 8).toFixed(1)} ${(a.tip.y + ry * 0.7).toFixed(1)}, ${left.toFixed(1)} ${a.tip.y.toFixed(1)}`,
        "Z",
      ].join(" ");
      blobs[i].setAttribute("d", d);
      blobs[i].style.opacity = String(0.35 + (1 - Math.abs(u - 0.5) * 2) * 0.4);
    }

    // Floating droplets above / around the melt
    for (let i = 0; i < DROPS; i++) {
      const d = drops[i];
      const orbit = softNoise(time * d.speed, i * 3);
      const bx = midX + pullX * 0.2 + Math.sin(time * d.speed + d.phase) * (sr.width * 0.18);
      const by = midY - sr.height * 0.22 + Math.cos(time * d.speed * 0.8 + d.phase) * (sr.height * 0.12) + orbit * 12;
      const r = d.r * (0.85 + 0.2 * Math.sin(time * 2 + d.phase));
      d.el.setAttribute("cx", bx.toFixed(1));
      d.el.setAttribute("cy", by.toFixed(1));
      d.el.setAttribute("r", r.toFixed(1));
      d.el.style.opacity = String(0.45 + Math.abs(orbit) * 0.35);
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
