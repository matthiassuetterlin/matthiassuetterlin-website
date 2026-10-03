(() => {
  /**
   * Settings menu: a small hamburger (bottom right) that opens sliders for
   * the MS goo (window.msTune, fieldlines.js), the liquid drop
   * (window.fluidTune, fluid.js) and the dot grid (window.gridTune,
   * grid.js); a switch on top picks the drop or the dots. Values apply live. Settings can be stored
   * as numbered saves ("Speicherung 01", 02, …): load by clicking, delete
   * with ×, and tick one as the default that loads on every visit. Saves
   * 01 (the earlier look) and 02 (the code defaults) ship with the site;
   * further saves and the default tick live in this browser (localStorage). "Werte kopieren" copies the current
   * values as JSON to share.
   */
  const MS = window.msTune;
  const GRID = window.gridTune;
  const FLUID = window.fluidTune || {};
  const MELT = window.meltTune || {};
  const TILT = window.tiltTune || {};
  if (!MS || !GRID) return;
  const STORE = "ms-tune-saves-v1";
  const DEFAULTS = { ms: { ...MS }, grid: { ...GRID }, fluid: { ...FLUID }, melt: { ...MELT }, tilt: { ...TILT } };

  // Saves that ship with the site: 01 = the earlier look, 02 = the code defaults
  const BUILTIN = [
    {
      name: "Speicherung 01",
      ms: {
        weight: 600,
        color: "#000000",
        merge: 0.085,
        thicken: 0.8,
        mass: 0.4,
        drops: 0.07,
        satellites: 0.045,
        pull: 1,
        spread: 0.04,
        reach: 1,
        hole: 0.06,
        lean: 0.07,
        stretch: 0.05,
      },
      grid: {
        spacing: 0.2,
        restSize: 2,
        maxSize: 0.75,
        catchR: 1.1,
        leash: 4.4,
        pullNear: 0.25,
        pullFar: 0.5,
        follow: 0.2,
        spring: 0.025,
        wobble: 0.5,
        roundness: 12,
        restColor: "#ffffff",
        peakColor: "#ffffff",
        fadeColor: "#ffffff",
        peakAt: 0.05,
        goo: 1,
        outline: true,
        outlineColor: "#2b2b2b",
        outlineWidth: 0.3,
        outlineFrom: 0,
        textFollow: 0.45,
      },
    },
    { name: "Speicherung 02", ms: { ...DEFAULTS.ms }, grid: { ...DEFAULTS.grid } },
  ];

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
      title: "Fluid",
      target: FLUID,
      mode: "fluid",
      rows: [
        ["size", "Tropfengröße", 0.04, 0.4, 0.01],
        ["rest", "Größe in Ruhe", 0, 1, 0.05],
        ["count", "Anzahl Tropfen", 1, 12, 1],
        ["taper", "Verjüngung der Spur", 0, 0.95, 0.05],
        ["follow", "Folgen (Steifigkeit)", 0.05, 0.6, 0.01],
        ["wobble", "Nachwippen", 0.4, 0.95, 0.01],
        ["merge", "Verschmelzen", 0.1, 3, 0.05],
        ["decay", "Abklingen", 0.85, 0.995, 0.005],
        ["lens", "Linse (Vergrößerung)", 0, 0.6, 0.01],
        ["rim", "Brechung am Rand", 0, 0.4, 0.01],
        ["fringe", "Farbsaum", 0, 1, 0.05],
        ["gloss", "Glanz", 0, 1, 0.05],
        ["fillColor", "Füllfarbe", "color"],
        ["fill", "Füllung", 0, 1, 0.05],
        ["outline", "Outline", "toggle"],
        ["outlineColor", "Farbe Outline", "color"],
        ["outlineWidth", "Stärke Outline", 0, 4, 0.1],
      ],
    },
    {
      title: "Verschmelzen MS ↔ Fluid",
      target: MELT,
      mode: "fluid",
      rows: [
        ["reach", "Abstand: Beginn (× Tropfen, 0 = aus)", 0, 4, 0.05],
        ["overlap", "Ganz verschmolzen bei Überlappung", -1, 1.5, 0.05],
        ["outlineFrom", "Kontur geht über – ab", 0, 1, 0.05],
        ["outlineTo", "Kontur geht über – bis", 0, 1, 0.05],
        ["colorFrom", "Farbe kommt – ab", 0, 1, 0.05],
        ["colorTo", "Farbe kommt – bis", 0, 1, 0.05],
        ["inSpeed", "Tempo hinein", 0.02, 1, 0.01],
        ["outSpeed", "Tempo heraus (Farbe geht raus)", 0.02, 1, 0.01],
        ["bridge", "Brücke zum Buchstaben", 0, 2, 0.05],
        ["soften", "Weichheit des MS beim Verschmelzen", 0, 1.5, 0.05],
      ],
    },
    {
      title: "Handy-Bewegung",
      target: TILT,
      rows: [
        ["on", "Bewegungssensor an", "toggle"],
        ["ms", "MS folgt der Neigung", 0, 2, 0.05],
        ["roll", "Tropfen rollt von selbst (Fluid)", "toggle"],
        ["gravity", "Schwerkraft", 0, 2, 0.05],
        ["friction", "Rollen (1 = endlos)", 0.85, 0.995, 0.005],
        ["shake", "Schwappen bei schneller Bewegung", 0, 3, 0.05],
        ["range", "Neigung für volle Wirkung (Grad)", 5, 60, 1],
      ],
    },
    {
      title: "Punkte",
      target: GRID,
      mode: "dots",
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

  // { saves: [{ name, ms, grid }], def: name | null, next: number }
  function readState() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v && Array.isArray(v.saves)) return v;
    } catch (e) {
      /* ignore */
    }
    return { saves: BUILTIN.map((p) => JSON.parse(JSON.stringify(p))), def: "Speicherung 02", next: 3 };
  }
  function writeState() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable */
    }
  }
  const state = readState();
  let current = null; // name of the save the sliders currently match

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

  // --- Saves -----------------------------------------------------------------
  const savesSec = document.createElement("section");
  savesSec.className = "tune-saves";
  const savesH = document.createElement("h3");
  savesH.textContent = "Speicherungen";
  const savesList = document.createElement("div");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tune-add";
  addBtn.textContent = "+ Speichern";
  const savesNote = document.createElement("p");
  savesNote.className = "tune-note";
  savesNote.textContent = "Häkchen = Standard beim Öffnen. Eigene Speicherungen gelten nur in diesem Browser.";
  savesSec.append(savesH, savesList, addBtn, savesNote);
  panel.appendChild(savesSec);

  function apply(save) {
    Object.assign(MS, DEFAULTS.ms, save.ms);
    Object.assign(GRID, DEFAULTS.grid, save.grid);
    Object.assign(FLUID, DEFAULTS.fluid, save.fluid || {});
    Object.assign(MELT, DEFAULTS.melt, save.melt || {});
    Object.assign(TILT, DEFAULTS.tilt, save.tilt || {});
    inputs.forEach((f) => f());
    if (window.gridRebuild) window.gridRebuild();
    if (window.fluidRefresh) window.fluidRefresh();
    current = save.name;
    renderSaves();
  }

  function renderSaves() {
    savesList.textContent = "";
    for (const sv of state.saves) {
      const row = document.createElement("div");
      row.className = "tune-save" + (sv.name === current ? " is-current" : "");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = state.def === sv.name;
      tick.title = "Als Standard beim Öffnen";
      tick.setAttribute("aria-label", `${sv.name} als Standard`);
      tick.addEventListener("change", () => {
        state.def = tick.checked ? sv.name : state.def === sv.name ? null : state.def;
        writeState();
        renderSaves();
      });
      const name = document.createElement("button");
      name.type = "button";
      name.className = "tune-save-name";
      name.textContent = sv.name;
      name.title = "Laden";
      name.addEventListener("click", () => apply(sv));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "tune-save-del";
      del.textContent = "×";
      del.title = "Löschen";
      del.setAttribute("aria-label", `${sv.name} löschen`);
      del.addEventListener("click", () => {
        if (!window.confirm(`${sv.name} löschen?`)) return;
        state.saves = state.saves.filter((x) => x !== sv);
        if (state.def === sv.name) state.def = null;
        if (current === sv.name) current = null;
        writeState();
        renderSaves();
      });
      row.append(tick, name, del);
      savesList.appendChild(row);
    }
  }

  addBtn.addEventListener("click", () => {
    const name = `Speicherung ${String(state.next).padStart(2, "0")}`;
    state.next += 1;
    state.saves.push({ name, ms: { ...MS }, grid: { ...GRID }, fluid: { ...FLUID }, melt: { ...MELT }, tilt: { ...TILT } });
    current = name;
    writeState();
    renderSaves();
  });

  // --- Mode: dot grid (old) or liquid drop (new) ------------------------------
  const groupSecs = [];
  const modeSec = document.createElement("section");
  const modeH = document.createElement("h3");
  modeH.textContent = "Hintergrund";
  const modeRow = document.createElement("div");
  modeRow.className = "tune-mode";
  const modeBtns = [
    ["dots", "Punkte (alt)"],
    ["fluid", "Fluid (neu)"],
  ].map(([m, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset.mode = m;
    b.disabled = m === "fluid" && !window.fxAvailable;
    b.addEventListener("click", () => {
      if (window.fxSetMode) window.fxSetMode(m);
      syncMode();
    });
    modeRow.appendChild(b);
    return b;
  });
  modeSec.append(modeH, modeRow);
  panel.insertBefore(modeSec, savesSec);
  function syncMode() {
    const m = window.fxMode || "dots";
    for (const b of modeBtns) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    for (const [sec, group] of groupSecs) sec.hidden = !!group.mode && group.mode !== m;
  }

  for (const group of GROUPS) {
    const sec = document.createElement("section");
    groupSecs.push([sec, group]);
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
        if (group.target === FLUID && key === "size" && window.fluidRefresh) window.fluidRefresh();
        current = null; // edited: no longer matches a save
        renderSaves();
      });
      inputs.push(sync);
      sync();
      row.append(name, out, input);
      sec.appendChild(row);
    }
    panel.appendChild(sec);
  }

  // Sensor access (iOS asks once, from a tap)
  const mo = window.motion;
  if (mo && mo.state !== "unavailable") {
    const tiltSec = groupSecs.find(([, g]) => g.target === TILT)[0];
    const sensor = document.createElement("button");
    sensor.type = "button";
    sensor.className = "tune-add";
    const label = () => {
      sensor.textContent =
        mo.state === "on" ? (mo.active ? "Sensor aktiv ✓" : "Sensor an – Handy bewegen") : mo.state === "denied" ? "Sensor nicht erlaubt (Safari-Einstellungen)" : "Bewegungssensor erlauben";
    };
    sensor.addEventListener("click", () => {
      if (window.motionEnable) window.motionEnable().then(label);
    });
    label();
    setInterval(() => !panel.hidden && label(), 1000);
    tiltSec.insertBefore(sensor, tiltSec.children[1]);
  } else {
    const tiltSec = groupSecs.find(([, g]) => g.target === TILT)[0];
    tiltSec.hidden = true;
    groupSecs.splice(groupSecs.findIndex(([, g]) => g.target === TILT), 1);
  }

  const actions = document.createElement("div");
  actions.className = "tune-actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Zurücksetzen";
  reset.addEventListener("click", () => apply(BUILTIN[1]));
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Werte kopieren";
  copy.addEventListener("click", async () => {
    const text = JSON.stringify({ ms: MS, grid: GRID, fluid: FLUID, melt: MELT, tilt: TILT }, null, 2);
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
  syncMode();

  // The default save (if any) loads on every visit
  try {
    localStorage.removeItem("ms-tune-v1"); // old auto-saved slider state
  } catch (e) {
    /* ignore */
  }
  const def = state.saves.find((x) => x.name === state.def);
  if (def) apply(def);
  else renderSaves();
})();
