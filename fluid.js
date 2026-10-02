(() => {
  /**
   * Liquid drop that follows the pointer, drawn by one WebGL shader.
   *
   * A short chain of drops hangs on springs behind the pointer: the first
   * follows the pointer, each further one the drop before it. The shader
   * melts them with a smooth minimum of their distance fields, so the
   * contour is exact at any size and costs the same at any resolution.
   *
   * The drop also works as a lens. The text under it is drawn once into a
   * texture (every visible character at its place, colour and opacity), and
   * inside the drop the shader samples that texture through a dome-shaped
   * surface: magnified in the middle, squeezed at the rim, with a faint
   * colour fringe and a highlight, like a drop of water lying on the page.
   * The MS sits above the drop and keeps its own goo.
   *
   * window.fxMode switches between this ("fluid") and the dot grid
   * ("dots", grid.js); window.fxSetMode(mode) switches live.
   */
  const root = document.documentElement;
  const stage = document.getElementById("stage");
  const letterM = document.getElementById("letter-m");
  const MODE_KEY = "ms-fx-mode";
  const coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;

  const T = (window.fluidTune = Object.assign(
    {
      size: 0.14, // drop radius, × MS font size
      rest: 0.4, // size while the pointer rests, share of the full size
      count: 8, // drops in the chain
      taper: 0.6, // how much smaller the last drop is than the first
      follow: 0.25, // spring stiffness of the chain
      wobble: 0.72, // damping (higher = more overshoot)
      merge: 1, // smooth-minimum radius, × drop radius
      decay: 0.96, // how slowly the drop shrinks back after a move
      lens: 0.25, // magnification inside the drop
      rim: 0.12, // extra refraction towards the rim
      fringe: 0.3, // colour fringe of the refraction
      gloss: 0.6, // highlight and rim shade
      fillColor: "#ffffff",
      fill: 0, // tint of the drop with the fill colour
      outline: true,
      outlineColor: "#595959",
      outlineWidth: 0.8, // px
    },
    window.fluidTune || {}
  ));

  // --- Mode ------------------------------------------------------------------

  let mode = "fluid";
  try {
    mode = localStorage.getItem(MODE_KEY) || mode;
  } catch (e) {
    /* ignore */
  }

  const canvas = document.createElement("canvas");
  canvas.className = "fx-fluid-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = stage && (canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false }) || null);
  window.fxAvailable = !!gl;
  if (!gl) mode = "dots";

  let onMode = null; // set once the renderer is ready
  function setMode(m) {
    mode = m === "fluid" && gl ? "fluid" : "dots";
    window.fxMode = mode;
    root.classList.toggle("fx-fluid", mode === "fluid");
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch (e) {
      /* ignore */
    }
    if (window.gridRebuild) window.gridRebuild(); // dots home, letters reset
    if (onMode) onMode();
  }
  window.fxMode = mode;
  root.classList.toggle("fx-fluid", mode === "fluid");
  window.fxSetMode = setMode;
  if (!gl) return;
  stage.appendChild(canvas);

  // --- Shader ----------------------------------------------------------------

  const MAX = 12;
  const VS = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;      // canvas size, device px
uniform float uDpr;
uniform vec4 uDrop[${MAX}]; // x, y (css px), radius
uniform int uN;
uniform float uK;       // smooth-minimum radius
uniform sampler2D uText;
uniform vec3 uBg;
uniform vec3 uFill;
uniform float uFillA;
uniform float uLens;
uniform float uRim;
uniform float uFringe;
uniform float uGloss;
uniform vec3 uLine;
uniform float uLineW;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float rl; // radius of the nearest drop (set by field)
float field(vec2 p) {
  float d = 1e5;
  float best = 1e5;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    vec4 c = uDrop[i];
    float di = length(p - c.xy) - c.z;
    if (di < best) { best = di; rl = c.z; }
    d = smin(d, di, uK);
  }
  return d;
}
vec4 text(vec2 p) {
  return texture2D(uText, p * uDpr / uRes);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float d = field(p);
  float aa = 0.75 / uDpr;
  float lw = uLineW * 0.5;
  if (d > lw + aa * 2.0) { gl_FragColor = vec4(0.0); return; }

  float r = max(rl, 1.0);
  vec2 g = vec2(field(p + vec2(1.0, 0.0)) - field(p - vec2(1.0, 0.0)),
                field(p + vec2(0.0, 1.0)) - field(p - vec2(0.0, 1.0))) * 0.5;
  g /= max(length(g), 1e-4); // outward normal of the contour

  // rho: 0 in the middle of a drop, 1 at its rim
  float rho = clamp(1.0 + d / r, 0.0, 1.0);
  float rho2 = rho * rho;
  float slope = rho2 * rho2; // surface tilt, steep only near the rim

  // Refraction: sample closer to the middle — an even magnification plus a
  // squeeze towards the rim; red and blue a little apart for a faint fringe
  vec2 disp = -g * r * (uLens * rho + uRim * rho2 * rho2 * rho2);
  float f = uFringe * 0.18;
  vec4 tr = text(p + disp * (1.0 + f));
  vec4 tg = text(p + disp);
  vec4 tb = text(p + disp * (1.0 - f));
  vec3 col = vec3(uBg.r * (1.0 - tr.a) + tr.r,
                  uBg.g * (1.0 - tg.a) + tg.g,
                  uBg.b * (1.0 - tb.a) + tb.b);
  col = mix(col, uFill, uFillA);

  // Light from the top left: highlight on the rim, soft shade opposite
  vec3 n = normalize(vec3(g * slope * 2.0, 1.0));
  vec3 L = normalize(vec3(-0.55, -0.75, 1.1));
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 70.0);
  float shade = slope * max(dot(g, vec2(0.6, 0.8)), 0.0);
  col = col * (1.0 - uGloss * 0.14 * shade) + uGloss * 0.9 * spec;

  float inside = 1.0 - smoothstep(-aa, aa, d);
  float line = uLineW > 0.0 ? 1.0 - smoothstep(lw - aa, lw + aa, abs(d)) : 0.0;
  line *= clamp(uLineW + 0.35, 0.0, 1.0); // hairlines thinner than a pixel fade
  col = mix(col, uLine, line);
  float a = max(inside, line);
  gl_FragColor = vec4(col * a, a);
}`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ["uRes", "uDpr", "uDrop", "uN", "uK", "uText", "uBg", "uFill", "uFillA", "uLens", "uRim", "uFringe", "uGloss", "uLine", "uLineW"]) {
    U[n] = gl.getUniformLocation(prog, n);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.uniform1i(U.uText, 0);
  gl.clearColor(0, 0, 0, 0);

  function rgb(hex) {
    const n = parseInt(String(hex).replace("#", ""), 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function cssRgb(str) {
    const m = String(str).match(/[\d.]+/g) || [255, 255, 255];
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  }

  // --- Size --------------------------------------------------------------------

  let W = 0;
  let H = 0;
  let dpr = 1;
  let R = 40; // full drop radius, css px
  const textCanvas = document.createElement("canvas");
  const tc = textCanvas.getContext("2d");

  function resize() {
    W = root.clientWidth;
    H = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    textCanvas.width = canvas.width;
    textCanvas.height = canvas.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const fontPx = letterM ? parseFloat(getComputedStyle(letterM).fontSize) : 0;
    // A finger covers small drops: on touch screens they stay bigger
    R = Math.max(coarse ? 34 : 18, (fontPx || 300) * T.size);
    textDirty = true;
  }

  // --- Text texture --------------------------------------------------------------

  let textDirty = true;
  let textSig = "";
  const ascents = {};
  const SKIP = "svg, script, style, #tune-panel, .fx-fluid-canvas";

  function opacityOf(el, cache) {
    if (!el || el === document.body) return 1;
    let v = cache.get(el);
    if (v === undefined) {
      v = (parseFloat(getComputedStyle(el).opacity) || 0) * opacityOf(el.parentElement, cache);
      cache.set(el, v);
    }
    return v;
  }

  // Every visible character with its place, font and colour
  function collect() {
    const items = [];
    const styles = new Map();
    const ops = new Map();
    const range = document.createRange();
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const txt = n.nodeValue;
      if (!txt.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest(SKIP)) continue;
      let st = styles.get(el);
      if (!st) {
        const cs = getComputedStyle(el);
        const c = cs.color.match(/[\d.]+/g) || [0, 0, 0];
        const alpha = (c.length > 3 ? parseFloat(c[3]) : 1) * opacityOf(el, ops);
        st = {
          ok: cs.visibility === "visible" && alpha > 0.01,
          font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
          color: `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`,
          upper: cs.textTransform === "uppercase",
        };
        styles.set(el, st);
      }
      if (!st.ok) continue;
      const add = (ch, r) => {
        if (!r || (r.width === 0 && r.height === 0)) return;
        if (r.bottom < -40 || r.top > H + 40 || r.right < -40 || r.left > W + 40) return;
        items.push({ ch: st.upper ? ch.toUpperCase() : ch, x: r.left, y: r.top, h: r.height, st });
      };
      if (el.classList.contains("gc")) {
        add(txt, el.getBoundingClientRect());
      } else {
        for (let i = 0; i < txt.length; i++) {
          if (/\s/.test(txt[i])) continue;
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          add(txt[i], range.getClientRects()[0]);
        }
      }
    }
    // List dashes set as ::before content, on the first line of the item
    for (const li of stage.querySelectorAll("li")) {
      const content = getComputedStyle(li, "::before").content;
      const m = content && content.match(/^"(.+)"$/);
      const first = m && li.querySelector(".gc");
      const st = first && styles.get(first);
      if (!st || !st.ok) continue;
      const r = first.getBoundingClientRect();
      if (r.bottom < 0 || r.top > H) continue;
      items.push({ ch: m[1], x: li.getBoundingClientRect().left, y: r.top, h: r.height, st });
    }
    // Underlines drawn as borders
    const lines = [];
    for (const el of stage.querySelectorAll("button, a")) {
      if (el.closest(SKIP)) continue;
      const cs = getComputedStyle(el);
      const bw = parseFloat(cs.borderBottomWidth) || 0;
      if (!bw || cs.borderBottomStyle === "none") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > H) continue;
      const c = cs.borderBottomColor.match(/[\d.]+/g) || [0, 0, 0];
      const alpha = (c.length > 3 ? parseFloat(c[3]) : 1) * opacityOf(el, ops);
      if (alpha < 0.01) continue;
      lines.push({ x: r.left, y: r.bottom - bw, w: r.width, h: bw, color: `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})` });
    }
    return { items, lines };
  }

  function refreshText(force) {
    const { items, lines } = collect();
    let sig = `${W}x${H}|`;
    for (const it of items) sig += `${it.ch}${Math.round(it.x * 2)},${Math.round(it.y * 2)}${it.st.color};`;
    for (const l of lines) sig += `_${Math.round(l.x)},${Math.round(l.y)},${Math.round(l.w)}${l.color}`;
    if (!force && sig === textSig) return;
    textSig = sig;
    tc.setTransform(dpr, 0, 0, dpr, 0, 0);
    tc.clearRect(0, 0, W, H);
    tc.textBaseline = "alphabetic";
    let font = "";
    let fill = "";
    for (const it of items) {
      if (it.st.font !== font) {
        font = it.st.font;
        tc.font = font;
      }
      if (it.st.color !== fill) {
        fill = it.st.color;
        tc.fillStyle = fill;
      }
      let fm = ascents[font];
      if (fm === undefined) {
        const m = tc.measureText("H");
        const size = parseFloat(font.split(" ")[2]) || 16;
        fm = ascents[font] = [m.fontBoundingBoxAscent || size * 0.92, m.fontBoundingBoxDescent || size * 0.23];
      }
      // Baseline: half the leading below the box top, then the ascent
      // (inline boxes have no leading, inline-block letters do)
      tc.fillText(it.ch, it.x, it.y + (it.h - fm[0] - fm[1]) / 2 + fm[0]);
    }
    for (const l of lines) {
      tc.fillStyle = l.color;
      tc.fillRect(l.x, l.y, l.w, l.h);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    textDirty = false;
  }

  // --- Drops -----------------------------------------------------------------------

  const ptr = { x: NaN, y: NaN, on: false };
  let drops = [];
  let energy = 0; // grows with pointer speed, decays when still
  let presence = 0; // fades the drop in and out with the pointer
  let lastX = NaN;
  let lastY = NaN;

  function syncCount() {
    const n = Math.max(1, Math.min(MAX, Math.round(T.count)));
    while (drops.length < n) {
      const prev = drops[drops.length - 1];
      drops.push({ x: prev ? prev.x : ptr.x, y: prev ? prev.y : ptr.y, vx: 0, vy: 0 });
    }
    drops.length = n;
  }

  // One physics step of 1/60 s
  function step() {
    if (ptr.on) {
      if (!drops[0] || isNaN(drops[0].x)) for (const d of drops) Object.assign(d, { x: ptr.x, y: ptr.y, vx: 0, vy: 0 });
      const speed = isNaN(lastX) ? 0 : Math.hypot(ptr.x - lastX, ptr.y - lastY);
      lastX = ptr.x;
      lastY = ptr.y;
      const target = Math.min(1, speed / 22);
      energy = target > energy ? energy + (target - energy) * 0.3 : energy * T.decay;
    } else {
      lastX = NaN;
      energy *= T.decay;
    }
    presence += ((ptr.on ? 1 : 0) - presence) * (ptr.on ? 0.15 : 0.06);
    let moving = 0;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const tx = i ? drops[i - 1].x : ptr.on ? ptr.x : d.x;
      const ty = i ? drops[i - 1].y : ptr.on ? ptr.y : d.y;
      const k = T.follow * (i ? 1 - 0.25 * (i / drops.length) : 1.4);
      d.vx = (d.vx + (tx - d.x) * Math.min(0.9, k)) * T.wobble;
      d.vy = (d.vy + (ty - d.y) * Math.min(0.9, k)) * T.wobble;
      d.x += d.vx;
      d.y += d.vy;
      moving += Math.abs(d.vx) + Math.abs(d.vy);
    }
    return moving;
  }

  // As many steps as 60 per second need, so the drop behaves the same at
  // any frame rate
  let lastT = 0;
  let acc = 0;
  function advance(now) {
    syncCount();
    acc = Math.min(acc + (lastT ? now - lastT : 16.7), 100);
    lastT = now;
    let moving = 0;
    while (acc >= 16.7) {
      moving = step();
      acc -= 16.7;
    }
    return moving;
  }

  const dropData = new Float32Array(MAX * 4);
  function draw() {
    const scale = presence * (T.rest + (1 - T.rest) * Math.min(1, energy));
    const n = drops.length;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      const r = R * scale * (1 - T.taper * (n > 1 ? i / (n - 1) : 0));
      dropData[i * 4] = d.x;
      dropData[i * 4 + 1] = d.y;
      dropData[i * 4 + 2] = r;
      if (r > 0.3) {
        x0 = Math.min(x0, d.x - r);
        y0 = Math.min(y0, d.y - r);
        x1 = Math.max(x1, d.x + r);
        y1 = Math.max(y1, d.y + r);
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (x1 < x0) return false;
    if (textDirty) refreshText(true);
    const m = R * T.merge * 0.5 + T.outlineWidth + 4;
    const sx = Math.max(0, Math.floor((x0 - m) * dpr));
    const sy = Math.max(0, Math.floor((H - y1 - m) * dpr));
    const sw = Math.min(canvas.width, Math.ceil((x1 + m) * dpr)) - sx;
    const sh = Math.min(canvas.height, Math.ceil((H - y0 + m) * dpr)) - sy;
    if (sw <= 0 || sh <= 0) return false;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, sy, sw, sh);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform4fv(U.uDrop, dropData);
    gl.uniform1i(U.uN, n);
    gl.uniform1f(U.uK, Math.max(0.01, R * scale * T.merge));
    gl.uniform3fv(U.uBg, cssRgb(getComputedStyle(document.body).backgroundColor));
    gl.uniform3fv(U.uFill, rgb(T.fillColor));
    gl.uniform1f(U.uFillA, T.fill);
    gl.uniform1f(U.uLens, T.lens);
    gl.uniform1f(U.uRim, T.rim);
    gl.uniform1f(U.uFringe, T.fringe);
    gl.uniform1f(U.uGloss, T.gloss);
    gl.uniform3fv(U.uLine, rgb(T.outlineColor));
    gl.uniform1f(U.uLineW, T.outline ? T.outlineWidth : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  // --- Loop --------------------------------------------------------------------------

  let raf = null;
  let frame = 0;
  let shown = false;
  let moving = 0;
  function tick(now) {
    raf = null;
    if (mode !== "fluid") {
      lastT = 0;
      if (shown) {
        gl.disable(gl.SCISSOR_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);
        shown = false;
      }
      return;
    }
    moving = advance(now) || moving;
    frame++;
    // Text changes (fades, hovers, scrolling) are picked up as they happen
    if (shown && frame % 8 === 0) refreshText(false);
    shown = draw();
    if (ptr.on || moving > 0.05 || presence > 0.01) kick();
    else {
      lastT = 0;
      if (shown) {
        gl.disable(gl.SCISSOR_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);
        shown = false;
      }
    }
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // --- Input ---------------------------------------------------------------------------

  function point(x, y) {
    ptr.x = x;
    ptr.y = y;
    ptr.on = true;
    kick();
  }
  function leave() {
    ptr.on = false;
    kick();
  }
  window.addEventListener("pointermove", (e) => point(e.clientX, e.clientY), { passive: true });
  window.addEventListener("pointerdown", (e) => point(e.clientX, e.clientY), { passive: true });
  document.addEventListener("pointerleave", leave, { passive: true });
  window.addEventListener("blur", leave, { passive: true });
  // While the page scrolls, pointer events stop but touch events go on
  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t) point(t.clientX, t.clientY);
    },
    { passive: true }
  );
  const touchEnd = (e) => {
    if (!e.touches.length) leave();
  };
  window.addEventListener("touchend", touchEnd, { passive: true });
  window.addEventListener("touchcancel", touchEnd, { passive: true });
  window.addEventListener(
    "scroll",
    () => {
      textDirty = true;
      kick();
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    resize();
    kick();
  });
  new MutationObserver(() => {
    textDirty = true;
    kick();
  }).observe(stage, { attributes: true, attributeFilter: ["hidden", "class"], subtree: true });
  if (document.fonts) {
    document.fonts.ready.then(() => {
      for (const k in ascents) delete ascents[k];
      resize();
    });
  }
  // Size changes from the settings menu
  window.fluidRefresh = () => {
    resize();
    kick();
  };

  onMode = () => {
    textDirty = true;
    kick();
  };
  resize();
})();
