(() => {
  /**
   * Pluckable lines (after olivierlarose/svg-bezier-curve).
   *
   * A thin line drawn as a quadratic Bézier. Moving the pointer across it
   * bends it at the pointer position with the vertical movement; leaving
   * lets it swing out like a plucked string. Works with mouse and touch.
   * The line always spans the full page width, wherever it sits.
   */
  const MAX_BEND = 120;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function makeString(host) {
    host.classList.add("string");
    host.setAttribute("aria-hidden", "true");
    const hit = document.createElement("div");
    hit.className = "string-hit";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    host.append(svg, hit);

    let progress = 0;
    let x = 0.5;
    let time = Math.PI / 2;
    let reqId = null;
    let lastY = null;

    let w = 0;

    // Stretch line and hit area from the left to the right page edge
    function fit() {
      const left = host.getBoundingClientRect().left;
      w = document.documentElement.clientWidth;
      for (const n of [svg, hit]) {
        n.style.left = `${-left}px`;
        n.style.width = `${w}px`;
      }
    }

    function setPath(p) {
      path.setAttribute("d", `M0 250 Q${(w * x).toFixed(1)} ${(250 + p).toFixed(1)}, ${w} 250`);
    }

    function reset() {
      time = Math.PI / 2;
      progress = 0;
    }

    function animateOut() {
      const p = progress * Math.sin(time);
      progress = lerp(progress, 0, 0.025);
      time += 0.2;
      setPath(p);
      if (Math.abs(progress) > 0.75) {
        reqId = requestAnimationFrame(animateOut);
      } else {
        reqId = null;
        reset();
        setPath(0);
      }
    }

    hit.addEventListener("pointerenter", (e) => {
      if (reqId) {
        cancelAnimationFrame(reqId);
        reqId = null;
        reset();
      }
      lastY = e.clientY;
    });
    hit.addEventListener("pointermove", (e) => {
      x = Math.min(1, Math.max(0, e.clientX / w));
      const dy = lastY === null ? 0 : e.clientY - lastY;
      lastY = e.clientY;
      progress = Math.max(-MAX_BEND, Math.min(MAX_BEND, progress + dy));
      setPath(progress);
    });
    const release = () => {
      lastY = null;
      if (!reqId && Math.abs(progress) > 0.75) animateOut();
    };
    hit.addEventListener("pointerleave", release);
    hit.addEventListener("pointercancel", release);
    hit.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "mouse") release();
    });

    const refit = () => {
      fit();
      setPath(reqId ? progress : 0);
    };
    new ResizeObserver(refit).observe(host);
    window.addEventListener("resize", refit, { passive: true });
    refit();
  }

  // One under every content heading, plus any placed by hand
  document.querySelectorAll(".panel h2").forEach((h2) => {
    const line = document.createElement("div");
    h2.after(line);
    makeString(line);
  });
  document.querySelectorAll("[data-string]").forEach(makeString);
})();
