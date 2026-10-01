(() => {
  const world = document.getElementById("world");
  const viewport = document.getElementById("viewport");
  const btnOut = document.getElementById("btn-out");
  const hint = document.getElementById("hint");

  const rooms = {
    home: { x: 0.5, y: 0.48, scale: 1 },
    about: { x: 0.28, y: -0.15, scale: 2.4 },
    projects: { x: 0.42, y: 1.35, scale: 2.1 },
    contact: { x: 1.25, y: 0.55, scale: 2.3 },
    fernen: { x: 0.12, y: 2.25, scale: 2.6 },
    adac: { x: 0.72, y: 2.25, scale: 2.6 },
    dreamco: { x: 1.35, y: 2.25, scale: 2.6 },
  };

  let current = "home";
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let animating = false;

  function applyTransform(animate = true) {
    world.style.transition = animate ? "" : "none";
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    btnOut.hidden = current === "home" && scale < 1.15;
    document.querySelectorAll(".room").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.room === current);
    });
    if (current === "home") {
      hint.textContent = "Klicke auf Typografie · Scroll zum Zoomen · Esc = hinaus";
    } else {
      hint.textContent = "Raum: " + current + " · ↑ hinaus oder Esc";
    }
  }

  function goTo(name, animate = true) {
    const target = rooms[name] || rooms.home;
    current = rooms[name] ? name : "home";
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    scale = target.scale;
    // Center the focal point (normalized coords in viewport units of base layout)
    tx = vw / 2 - target.x * vw * scale;
    ty = vh / 2 - target.y * vh * scale;
    animating = true;
    applyTransform(animate);
    window.setTimeout(() => {
      animating = false;
    }, 900);
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const worldX = (x - tx) / scale;
    const worldY = (y - ty) / scale;
    const next = Math.min(6, Math.max(0.55, scale * factor));
    scale = next;
    tx = x - worldX * scale;
    ty = y - worldY * scale;
    if (scale < 1.1) current = "home";
    applyTransform(false);
  }

  function goOut() {
    if (current === "fernen" || current === "adac" || current === "dreamco") {
      goTo("projects");
    } else if (current !== "home") {
      goTo("home");
    } else if (scale > 1.05) {
      goTo("home");
    }
  }

  document.querySelectorAll("[data-target]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = el.getAttribute("data-target");
      if (t) goTo(t);
    });
  });

  btnOut.addEventListener("click", goOut);

  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false }
  );

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    dragging = true;
    viewport.classList.add("dragging");
    lastX = e.clientX;
    lastY = e.clientY;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging || animating) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyTransform(false);
  });
  function endDrag(e) {
    dragging = false;
    viewport.classList.remove("dragging");
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Backspace") {
      e.preventDefault();
      goOut();
    }
  });

  window.addEventListener("resize", () => goTo(current, false));

  goTo("home", false);
  viewport.focus({ preventScroll: true });
})();
