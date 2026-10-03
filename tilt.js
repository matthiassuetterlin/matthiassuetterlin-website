(() => {
  /**
   * Phone motion for the MS and the liquid drop.
   *
   * Tilting the phone acts like gravity: window.motion.x / .y (−1 … 1)
   * say where "down" is, relative to how the phone was held a moment ago
   * (the neutral pose drifts along slowly, so any grip feels level).
   * Moving the phone quickly gives a short push the other way
   * (window.motion.ax / .ay, like liquid sloshing in a glass).
   * fieldlines.js lets the MS lean and flow that way; fluid.js lets the
   * drop roll around on its own while no finger is on the screen.
   *
   * iOS only hands out sensor data after the visitor allows it, and only
   * asks from a tap: the first tap on the page (or the button in the
   * settings menu) asks once.
   */
  const T = (window.tiltTune = Object.assign(
    {
      on: true, // use the motion sensor at all
      ms: 1, // how strongly the MS follows the tilt
      roll: true, // the drop rolls around by itself when nobody touches the screen
      gravity: 0.6, // how strongly tilt pulls the drop
      friction: 0.96, // how long the drop keeps rolling (1 = forever)
      shake: 1, // push from moving the phone quickly
      range: 25, // degrees of tilt for the full effect
    },
    window.tiltTune || {}
  ));

  const M = (window.motion = { x: 0, y: 0, ax: 0, ay: 0, active: false, state: "off" });
  const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!coarse || calm || typeof window.DeviceOrientationEvent === "undefined") {
    M.state = "unavailable";
    return;
  }

  let base = null; // neutral pose [beta, gamma]
  let lastSeen = 0;
  const clamp = (v) => Math.max(-1, Math.min(1, v));

  // Device axes to screen axes, for any screen rotation
  function toScreen(x, y) {
    const a = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * (Math.PI / 180);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x * c + y * s, -x * s + y * c];
  }

  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    if (!T.on) {
      M.active = false;
      return;
    }
    const b = e.beta;
    const g = e.gamma;
    if (!base) base = [b, g];
    // The neutral pose follows slowly (about ten seconds)
    base[0] += (b - base[0]) * 0.002;
    base[1] += (g - base[1]) * 0.002;
    const [sx, sy] = toScreen((g - base[1]) / T.range, (b - base[0]) / T.range);
    M.x += (clamp(sx) - M.x) * 0.25;
    M.y += (clamp(sy) - M.y) * 0.25;
    M.active = true;
    lastSeen = performance.now();
    if (window.fxKick) window.fxKick();
  }

  function onMotion(e) {
    const a = e.acceleration;
    if (!T.on || !a || a.x == null) return;
    // m/s², device y points up; the screen's y points down
    const [sx, sy] = toScreen(a.x, -a.y);
    M.ax += (sx - M.ax) * 0.5;
    M.ay += (sy - M.ay) * 0.5;
  }

  // Readings stop (sensor off, tab hidden): fall back to the idle behaviour
  setInterval(() => {
    if (M.active && performance.now() - lastSeen > 1000) {
      M.active = false;
      M.x = M.y = M.ax = M.ay = 0;
      base = null;
    }
  }, 500);

  function listen() {
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    window.addEventListener("devicemotion", onMotion, { passive: true });
    M.state = "on";
  }

  // Ask for access (iOS) — must run inside a tap
  window.motionEnable = () => {
    const DOE = window.DeviceOrientationEvent;
    const DME = window.DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const asks = [DOE.requestPermission()];
      if (DME && typeof DME.requestPermission === "function") asks.push(DME.requestPermission().catch(() => "denied"));
      return Promise.all(asks)
        .then(([orient]) => {
          if (orient === "granted") listen();
          else M.state = "denied";
          return M.state;
        })
        .catch(() => {
          M.state = "denied";
          return M.state;
        });
    }
    if (M.state !== "on") listen();
    return Promise.resolve(M.state);
  };

  const needsAsk = typeof DeviceOrientationEvent.requestPermission === "function";
  if (!needsAsk) {
    listen(); // Android: no prompt needed
  } else {
    M.state = "ask";
    const firstTap = () => {
      window.removeEventListener("touchend", firstTap);
      if (T.on && M.state === "ask") window.motionEnable();
    };
    window.addEventListener("touchend", firstTap, { passive: true });
  }
})();
