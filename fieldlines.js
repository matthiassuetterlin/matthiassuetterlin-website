(() => {
  const stage = document.getElementById("ms-stage");
  const svg = document.getElementById("fieldlines");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !svg || !letterM || !letterS) return;

  // Dense threads that run THROUGH both glyphs and merge in the gap
  const LINE_COUNT = 28;
  const paths = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(p);
    paths.push(p);
  }

  let mouse = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  let hasMouse = false;
  let t0 = performance.now();

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function glyphBands(rect, stageRect, side) {
    // Sample points that feel like they sit on/inside a serif letter
    const x0 = rect.left - stageRect.left;
    const y0 = rect.top - stageRect.top;
    const w = rect.width;
    const h = rect.height;
    const pts = [];
    for (let i = 0; i < LINE_COUNT; i++) {
      const u = i / (LINE_COUNT - 1);
      // Vertical distribution denser near serifs (top/bottom)
      const serifEase = Math.pow(Math.abs(u - 0.5) * 2, 1.1);
      const y = y0 + h * (0.06 + u * 0.88);
      // Horizontal: weave across the glyph width (dissolve through the letter)
      const weave = Math.sin(u * Math.PI * 3) * 0.12;
      let x;
      if (side === "m") {
        // Start near left stem, exit toward right of M
        x = x0 + w * (0.12 + weave * 0.5 + serifEase * 0.05);
        const xOut = x0 + w * (0.82 + weave * 0.15);
        pts.push({ xin: x, xout: xOut, y, u });
      } else {
        const xIn = x0 + w * (0.18 + weave * 0.15);
        x = x0 + w * (0.78 + weave * 0.4 - serifEase * 0.05);
        pts.push({ xin: xIn, xout: x, y, u });
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
    if (sr.width < 10 || sr.height < 10) return;

    svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);
    svg.setAttribute("width", String(sr.width));
    svg.setAttribute("height", String(sr.height));

    const targetX = hasMouse ? mouse.x - sr.left : sr.width * 0.5;
    const targetY = hasMouse ? mouse.y - sr.top : sr.height * 0.42;
    smooth.x += (targetX - smooth.x) * 0.1;
    smooth.y += (targetY - smooth.y) * 0.1;

    const midX = (mr.right + srr.left) / 2 - sr.left;
    const midY = (mr.top + mr.bottom) / 2 - sr.top;
    const pullX = (smooth.x - midX) * 0.65;
    const pullY = (smooth.y - midY) * 0.65;
    const time = (now - t0) / 1000;

    // Soft magnetic nudge of the glyph shells (weight unchanged)
    const attract = hasMouse ? 1 : 0.4;
    const mx = Math.max(-12, Math.min(12, pullX * 0.045 * attract));
    const my = Math.max(-9, Math.min(9, pullY * 0.04 * attract));
    letterM.style.transform = `translate(${mx}px, ${my}px)`;
    letterS.style.transform = `translate(${-mx}px, ${-my * 0.9}px)`;

    const mPts = glyphBands(mr, sr, "m");
    const sPts = glyphBands(srr, sr, "s");

    for (let i = 0; i < LINE_COUNT; i++) {
      const a = mPts[i];
      const b = sPts[i];
      const u = a.u;
      const fan = (u - 0.5) * 2;
      const wobble = Math.sin(time * 1.6 + u * 9) * 10 + Math.cos(time * 1.1 + u * 5) * 6;

      // Continuum: inside M → leave M → fluid gap → enter S → through S
      const p0 = { x: a.xin, y: a.y + Math.sin(time * 1.3 + i) * 3 };
      const p1 = { x: a.xout, y: a.y + wobble * 0.25 };
      const gapX = lerp(a.xout, b.xin, 0.5) + pullX * 0.5;
      const gapY =
        lerp(a.y, b.y, 0.5) +
        pullY * 0.55 +
        fan * (26 + Math.abs(pullX) * 0.05) +
        wobble;
      const p2 = { x: gapX, y: gapY };
      const p3 = { x: b.xin, y: b.y - wobble * 0.2 };
      const p4 = { x: b.xout, y: b.y + Math.cos(time * 1.4 + i * 0.7) * 3 };

      // One continuous cubic chain — letter strokes dissolving into shared mass
      const d = [
        `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`,
        `C ${lerp(p0.x, p1.x, 0.5).toFixed(1)} ${(p0.y + pullY * 0.1).toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`,
        `C ${lerp(p1.x, p2.x, 0.45).toFixed(1)} ${lerp(p1.y, p2.y, 0.2).toFixed(1)}, ${lerp(p1.x, p2.x, 0.75).toFixed(1)} ${p2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
        `C ${lerp(p2.x, p3.x, 0.35).toFixed(1)} ${p2.y.toFixed(1)}, ${lerp(p2.x, p3.x, 0.7).toFixed(1)} ${lerp(p2.y, p3.y, 0.7).toFixed(1)}, ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}`,
        `C ${lerp(p3.x, p4.x, 0.5).toFixed(1)} ${p3.y.toFixed(1)}, ${p4.x.toFixed(1)} ${(p4.y + pullY * 0.08).toFixed(1)}, ${p4.x.toFixed(1)} ${p4.y.toFixed(1)}`,
      ].join(" ");

      paths[i].setAttribute("d", d);
      const weight = 0.7 + Math.sin(u * Math.PI) * 0.9;
      paths[i].setAttribute("stroke-width", weight.toFixed(2));
      paths[i].style.opacity = String(0.22 + Math.sin(u * Math.PI) * 0.45);
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
  document.addEventListener(
    "pointerleave",
    () => {
      hasMouse = false;
    },
    { passive: true }
  );

  requestAnimationFrame(draw);
})();
