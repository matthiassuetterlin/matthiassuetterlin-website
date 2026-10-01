(() => {
  const stage = document.getElementById("ms-stage");
  const svg = document.getElementById("fieldlines");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !svg || !letterM || !letterS) return;

  const LINE_COUNT = 52;
  const paths = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(p);
    paths.push(p);
  }

  let mouse = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  let vel = { x: 0, y: 0 };
  let hasMouse = false;
  let t0 = performance.now();

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function noise(t, seed) {
    return Math.sin(t * 1.7 + seed * 12.9898) * Math.cos(t * 2.3 + seed * 78.233);
  }

  function bands(rect, sr, side) {
    const x0 = rect.left - sr.left;
    const y0 = rect.top - sr.top;
    const w = rect.width;
    const h = rect.height;
    const out = [];
    for (let i = 0; i < LINE_COUNT; i++) {
      const u = i / (LINE_COUNT - 1);
      const y = y0 + h * (-0.05 + u * 1.1);
      const swirl = Math.sin(u * Math.PI * 5) * 0.2;
      if (side === "m") {
        out.push({
          u,
          xin: x0 + w * (0.02 + Math.abs(swirl) * 0.25),
          xmid: x0 + w * (0.45 + swirl * 0.35),
          xout: x0 + w * (0.92 + swirl * 0.2),
          y,
        });
      } else {
        out.push({
          u,
          xin: x0 + w * (0.05 + swirl * 0.2),
          xmid: x0 + w * (0.5 - swirl * 0.35),
          xout: x0 + w * (0.98 - Math.abs(swirl) * 0.2),
          y,
        });
      }
    }
    return out;
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

    const targetX = hasMouse ? mouse.x - sr.left : sr.width * 0.5 + Math.sin((now - t0) / 900) * sr.width * 0.08;
    const targetY = hasMouse ? mouse.y - sr.top : sr.height * 0.4 + Math.cos((now - t0) / 1100) * sr.height * 0.06;
    vel.x = (targetX - smooth.x) * 0.18;
    vel.y = (targetY - smooth.y) * 0.18;
    smooth.x += vel.x;
    smooth.y += vel.y;

    const midX = (mr.right + srr.left) / 2 - sr.left;
    const midY = (mr.top + mr.bottom) / 2 - sr.top;
    const pullX = (smooth.x - midX) * 1.15;
    const pullY = (smooth.y - midY) * 1.15;
    const speed = Math.hypot(vel.x, vel.y);
    const time = (now - t0) / 1000;

    // Wild glyph drift — still Playfair 700, just moving hard
    const mx = clamp(pullX * 0.09 + noise(time, 1) * 14, -28, 28);
    const my = clamp(pullY * 0.08 + noise(time, 2) * 12, -22, 22);
    const rotM = clamp(pullY * 0.02 + noise(time, 3) * 3.5, -8, 8);
    const rotS = clamp(-pullY * 0.02 + noise(time, 4) * 3.5, -8, 8);
    letterM.style.transform = `translate(${mx}px, ${my}px) rotate(${rotM}deg)`;
    letterS.style.transform = `translate(${-mx * 1.1}px, ${-my * 0.95}px) rotate(${rotS}deg)`;

    const mPts = bands(mr, sr, "m");
    const sPts = bands(srr, sr, "s");

    for (let i = 0; i < LINE_COUNT; i++) {
      const a = mPts[i];
      const b = sPts[i];
      const u = a.u;
      const fan = (u - 0.5) * 2;
      const n1 = noise(time * 2.2, u * 10 + i);
      const n2 = noise(time * 1.6, u * 17 + 3);
      const n3 = noise(time * 2.8, i * 0.37);
      const chaos = 38 + speed * 2.5;

      const p0x = a.xin + n1 * 18;
      const p0y = a.y + n2 * 22 + Math.sin(time * 3 + i) * 16;
      const p1x = a.xmid + pullX * 0.15 + n3 * 20;
      const p1y = a.y + fan * 20 + n1 * chaos * 0.35;
      const p2x = a.xout + n2 * 14;
      const p2y = a.y + n3 * 18;

      const gapX = lerp(a.xout, b.xin, 0.5) + pullX * 0.85 + n1 * chaos;
      const gapY =
        lerp(a.y, b.y, 0.5) +
        pullY * 0.9 +
        fan * (55 + Math.abs(pullX) * 0.12) +
        n2 * chaos * 1.2 +
        Math.sin(time * 4.5 + u * 14) * 28;

      const p3x = b.xin + n3 * 14;
      const p3y = b.y - n1 * 18;
      const p4x = b.xmid - pullX * 0.12 + n2 * 18;
      const p4y = b.y - fan * 18 + n3 * chaos * 0.3;
      const p5x = b.xout + n1 * 16;
      const p5y = b.y + Math.cos(time * 3.2 + i * 0.9) * 18;

      // Extra loop in the gap so the mass tangles
      const loopX = gapX + Math.cos(time * 3 + i) * (30 + speed);
      const loopY = gapY + Math.sin(time * 3 + i) * (34 + speed);

      const d = [
        `M ${p0x.toFixed(1)} ${p0y.toFixed(1)}`,
        `C ${p1x.toFixed(1)} ${p1y.toFixed(1)}, ${p2x.toFixed(1)} ${p2y.toFixed(1)}, ${p2x.toFixed(1)} ${p2y.toFixed(1)}`,
        `C ${lerp(p2x, gapX, 0.4).toFixed(1)} ${lerp(p2y, gapY, 0.25).toFixed(1)}, ${loopX.toFixed(1)} ${loopY.toFixed(1)}, ${gapX.toFixed(1)} ${gapY.toFixed(1)}`,
        `C ${(gapX + (gapX - loopX)).toFixed(1)} ${(gapY + (gapY - loopY)).toFixed(1)}, ${lerp(gapX, p3x, 0.55).toFixed(1)} ${lerp(gapY, p3y, 0.6).toFixed(1)}, ${p3x.toFixed(1)} ${p3y.toFixed(1)}`,
        `C ${p4x.toFixed(1)} ${p4y.toFixed(1)}, ${p5x.toFixed(1)} ${p5y.toFixed(1)}, ${p5x.toFixed(1)} ${p5y.toFixed(1)}`,
      ].join(" ");

      paths[i].setAttribute("d", d);
      const weight = 0.55 + Math.abs(n2) * 1.4 + (i % 3 === 0 ? 1.1 : 0);
      paths[i].setAttribute("stroke-width", weight.toFixed(2));
      paths[i].style.opacity = String(0.18 + Math.abs(n1) * 0.35 + Math.sin(u * Math.PI) * 0.25);
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
