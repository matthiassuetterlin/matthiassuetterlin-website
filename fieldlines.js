(() => {
  const stage = document.getElementById("ms-stage");
  const svg = document.getElementById("fieldlines");
  const letterM = document.getElementById("letter-m");
  const letterS = document.getElementById("letter-s");
  const home = document.getElementById("view-home");
  if (!stage || !svg || !letterM || !letterS) return;

  const LINE_COUNT = 11;
  const paths = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(p);
    paths.push(p);
  }

  let mouse = { x: 0, y: 0 };
  let smooth = { x: 0, y: 0 };
  let hasMouse = false;
  let raf = 0;

  function anchors() {
    const sr = stage.getBoundingClientRect();
    const mr = letterM.getBoundingClientRect();
    const srr = letterS.getBoundingClientRect();
    const left = [];
    const right = [];
    // Serif-ish attachment bands: outer edges of each glyph
    for (let i = 0; i < LINE_COUNT; i++) {
      const t = i / (LINE_COUNT - 1);
      // Emphasize top/bottom serif zones with ease
      const yBias = Math.pow(Math.abs(t - 0.5) * 2, 1.35) * Math.sign(t - 0.5 || 1);
      const yM = mr.top + mr.height * (0.12 + t * 0.76) - sr.top;
      const yS = srr.top + srr.height * (0.12 + t * 0.76) - sr.top;
      left.push({
        x: mr.right - sr.left - mr.width * 0.06,
        y: yM + yBias * mr.height * 0.02,
      });
      right.push({
        x: srr.left - sr.left + srr.width * 0.06,
        y: yS - yBias * srr.height * 0.02,
      });
    }
    return { left, right, sr, mr, srr };
  }

  function draw() {
    if (!home.classList.contains("is-active")) {
      raf = requestAnimationFrame(draw);
      return;
    }

    const { left, right, sr, mr, srr } = anchors();
    svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);
    svg.setAttribute("width", String(sr.width));
    svg.setAttribute("height", String(sr.height));

    // Lerp mouse in stage coords
    const targetX = hasMouse ? mouse.x - sr.left : sr.width * 0.5;
    const targetY = hasMouse ? mouse.y - sr.top : sr.height * 0.45;
    smooth.x += (targetX - smooth.x) * 0.12;
    smooth.y += (targetY - smooth.y) * 0.12;

    const midX = (mr.right + srr.left) / 2 - sr.left;
    const midY = (mr.top + mr.bottom) / 2 - sr.top;
    const pullX = (smooth.x - midX) * 0.55;
    const pullY = (smooth.y - midY) * 0.55;

    // Subtle letter magnetism
    const attract = hasMouse ? 1 : 0.35;
    const mx = Math.max(-10, Math.min(10, pullX * 0.04 * attract));
    const my = Math.max(-8, Math.min(8, pullY * 0.035 * attract));
    letterM.style.transform = `translate(${mx}px, ${my}px)`;
    letterS.style.transform = `translate(${-mx}px, ${-my * 0.85}px)`;

    for (let i = 0; i < LINE_COUNT; i++) {
      const a = left[i];
      const b = right[i];
      const t = i / (LINE_COUNT - 1);
      // Field-line bow: stronger in the middle band, pulled by mouse
      const fan = (t - 0.5) * 2; // -1..1
      const c1x = a.x + (b.x - a.x) * 0.28 + pullX * 0.35;
      const c1y = a.y + pullY * 0.4 + fan * 28 + Math.sin(t * Math.PI) * pullY * 0.15;
      const c2x = a.x + (b.x - a.x) * 0.72 + pullX * 0.35;
      const c2y = b.y + pullY * 0.4 - fan * 28 + Math.sin(t * Math.PI) * pullY * 0.15;
      const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      paths[i].setAttribute("d", d);
      paths[i].style.opacity = String(0.28 + Math.sin(t * Math.PI) * 0.35);
    }

    raf = requestAnimationFrame(draw);
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
  window.addEventListener(
    "pointerleave",
    () => {
      hasMouse = false;
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    /* redraw on next frame via anchors() */
  });

  raf = requestAnimationFrame(draw);
})();
