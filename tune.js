(() => {
  /**
   * Settings menu: a small hamburger (bottom right) that opens sliders for
   * the MS goo (window.msTune, fieldlines.js) and the dot grid
   * (window.gridTune, grid.js). Values apply live and are remembered in
   * this browser; "Werte kopieren" copies them as JSON to share.
   */
  const MS = window.msTune;
  const GRID = window.gridTune;
  if (!MS || !GRID) return;
  const KEY = "ms-tune-v1";
  const DEFAULTS = { ms: { ...MS }, grid: { ...GRID } };

  // [key, label, min, max, step] — or [key, label, "color"] / [key, label, "toggle"]
  const GROUPS = [
    {
      title: "MS",
      target: MS,
      rows: [
        ["weight", "Schriftstärke", 400, 900, 100],
        ["color", "Farbe", "color"],
        ["merge", "Verschmelzung", 0, 0.12, 0.005],
        ["thicken", "Dicke beim Verschmelzen", 0, 1.6, 0.05],
        ["mass", "Masse (weniger = mehr)", 0.25, 0.5, 0.01],
        ["drops", "Tropfen zwischen M und S", 0, 0.15, 0.005],
        ["satellites", "Tropfen zur Maus", 0, 0.1, 0.005],
        ["pull", "Anziehung M ↔ S", 0, 2, 0.05],
        ["spread", "Abstand außen", 0, 0.3, 0.01],
        ["reach", "Reichweite der Maus", 0.4, 2, 0.05],
        ["hole", "Loch im S", 0, 0.12, 0.005],
        ["lean", "Neigung zur Maus", 0, 0.2, 0.005],
        ["stretch", "Dehnung", 0, 0.2, 0.01],
      ],
    },
    {
      title: "Punkte",
      target: GRID,
      rebuild: ["spacing"],
      rows: [
        ["spacing", "Rasterabstand", 0.12, 0.35, 0.01],
        ["restSize", "Größe in Ruhe (px)", 1, 8, 0.5],
        ["maxSize", "Größe in Bewegung", 0.1, 0.8, 0.01],
        ["roundness", "Rundung (2 = Kreis)", 2, 12, 0.5],
        ["catchR", "Anziehungsradius", 0.5, 4, 0.1],
        ["pullNear", "Anziehungskraft nah", 0, 1, 0.05],
        ["pullFar", "Anziehungskraft fern", 0, 1, 0.05],
        ["leash", "Leinenlänge", 1, 6, 0.1],
        ["follow", "Folgen (Steifigkeit)", 0.03, 0.5, 0.01],
        ["spring", "Rückfederung", 0.01, 0.3, 0.005],
        ["wobble", "Nachwippen", 0.5, 0.97, 0.01],
        ["goo", "Verschmelzen", 0, 1, 0.05],
        ["restColor", "Farbe Ruhe", "color"],
        ["peakColor", "Farbe Bewegung", "color"],
        ["fadeColor", "Farbe groß", "color"],
        ["peakAt", "Dunkelster Punkt bei", 0.05, 0.95, 0.05],
        ["outline", "Outline", "toggle"],
        ["outlineColor", "Farbe Outline", "color"],
        ["outlineWidth", "Stärke Outline", 0.3, 4, 0.1],
        ["outlineFrom", "Outline ab Helligkeit", 0, 0.95, 0.05],
        ["textFollow", "Schrift folgt", 0, 1.5, 0.05],
      ],
    },
  ];

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ms: MS, grid: GRID }));
    } catch (e) {
      /* storage unavailable */
    }
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.ms) Object.assign(MS, v.ms);
      if (v && v.grid) Object.assign(GRID, v.grid);
    } catch (e) {
      /* ignore */
    }
  }

  let rebuildT = null;
  function applyGrid(key, group) {
    if (group.rebuild && group.rebuild.includes(key)) {
      clearTimeout(rebuildT);
      rebuildT = setTimeout(() => window.gridRebuild && window.gridRebuild(), 150);
    } else if (window.gridRefresh) {
      window.gridRefresh();
    }
  }

  // --- DOM -----------------------------------------------------------------
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "tune-btn";
  btn.setAttribute("aria-label", "Einstellungen");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = "<span></span><span></span><span></span>";

  const panel = document.createElement("div");
  panel.id = "tune-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Einstellungen");

  const inputs = [];
  function fmt(v, step) {
    if (typeof v !== "number") return "";
    const dec = String(step).includes(".") ? String(step).split(".")[1].length : 0;
    return v.toFixed(dec);
  }

  for (const group of GROUPS) {
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = group.title;
    sec.appendChild(h);
    for (const [key, label, a, b, step] of group.rows) {
      const row = document.createElement("label");
      row.className = "tune-row";
      const name = document.createElement("span");
      name.className = "tune-name";
      name.textContent = label;
      const out = document.createElement("span");
      out.className = "tune-val";
      const input = document.createElement("input");
      if (a === "color") {
        input.type = "color";
      } else if (a === "toggle") {
        input.type = "checkbox";
      } else {
        input.type = "range";
        input.min = a;
        input.max = b;
        input.step = step;
      }
      const sync = () => {
        const v = group.target[key];
        if (input.type === "checkbox") input.checked = !!v;
        else input.value = v;
        out.textContent = input.type === "range" ? fmt(v, step) : "";
      };
      input.addEventListener("input", () => {
        const v = input.type === "checkbox" ? input.checked : input.type === "color" ? input.value : parseFloat(input.value);
        group.target[key] = v;
        out.textContent = input.type === "range" ? fmt(v, step) : "";
        if (group.target === GRID) applyGrid(key, group);
        save();
      });
      inputs.push(sync);
      sync();
      row.append(name, out, input);
      sec.appendChild(row);
    }
    panel.appendChild(sec);
  }

  const actions = document.createElement("div");
  actions.className = "tune-actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Zurücksetzen";
  reset.addEventListener("click", () => {
    Object.assign(MS, DEFAULTS.ms);
    Object.assign(GRID, DEFAULTS.grid);
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
    inputs.forEach((f) => f());
    if (window.gridRebuild) window.gridRebuild();
  });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Werte kopieren";
  copy.addEventListener("click", async () => {
    const text = JSON.stringify({ ms: MS, grid: GRID }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Kopiert ✓";
    } catch (e) {
      window.prompt("Werte:", text);
    }
    setTimeout(() => (copy.textContent = "Werte kopieren"), 1600);
  });
  actions.append(reset, copy);
  panel.appendChild(actions);

  function toggle(open) {
    panel.hidden = !open;
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
  }
  btn.addEventListener("click", () => toggle(panel.hidden));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      e.stopPropagation();
      toggle(false);
    }
  }, true);

  // Dragging sliders shouldn't drag the dots or the MS behind the panel
  for (const t of ["pointermove", "pointerdown", "touchmove"]) {
    panel.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }

  document.body.append(panel, btn);

  // Saved values apply after the elements exist
  load();
  inputs.forEach((f) => f());
  if (window.gridRebuild) window.gridRebuild();
})();
