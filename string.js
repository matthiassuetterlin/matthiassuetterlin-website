(() => {
  /**
   * Pluckable lines (after olivierlarose/svg-bezier-curve).
   *
   * A thin line drawn as a quadratic Bézier. Crossing it grabs the line:
   * it follows the pointer up or down until it snaps free (beyond SNAP px)
   * and swings out like a plucked string. Works with mouse and touch.
   * The line always spans the full page width, wherever it sits.
   */
  function snapDistance() {
    return Math.max(90, Math.min(180, window.innerHeight * 0.2));
  }

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
    let grabbed = false;

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

    function release() {
      if (!grabbed) return;
      grabbed = false;
      if (!reqId && Math.abs(progress) > 0.75) animateOut();
    }

    hit.addEventListener("pointerenter", () => {
      if (reqId) {
        cancelAnimationFrame(reqId);
        reqId = null;
        reset();
      }
      grabbed = true;
    });
    // While grabbed, the line passes through the pointer (control = 2 × pull)
    window.addEventListener(
      "pointermove",
      (e) => {
        if (!grabbed) return;
        const pull = e.clientY - host.getBoundingClientRect().top;
        x = Math.min(1, Math.max(0, e.clientX / w));
        if (Math.abs(pull) > snapDistance()) {
          release();
          return;
        }
        progress = pull * 2;
        setPath(progress);
      },
      { passive: true }
    );
    window.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener(
      "pointerup",
      (e) => {
        if (e.pointerType !== "mouse") release();
      },
      { passive: true }
    );
    document.addEventListener("pointerleave", release, { passive: true });

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
