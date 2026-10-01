(() => {
  const guide = document.getElementById("guide");
  const guideOk = document.getElementById("guide-ok");
  const btnOut = document.getElementById("btn-out");
  const crumb = document.getElementById("crumb");
  const views = [...document.querySelectorAll(".view")];

  const labels = {
    home: "Start",
    about: "Über mich",
    projects: "Projekte",
    fernen: "ferner.Welten",
    adac: "ADAC Koblenz",
    dreamco: "DreamCo",
    contact: "Kontakt",
  };

  const parentOf = {
    home: null,
    about: "home",
    projects: "home",
    contact: "home",
    fernen: "projects",
    adac: "projects",
    dreamco: "projects",
  };

  let current = "home";

  function show(name) {
    if (!labels[name]) name = "home";
    current = name;
    views.forEach((v) => {
      const on = v.dataset.view === name;
      v.classList.toggle("is-active", on);
      v.hidden = !on;
    });
    btnOut.hidden = name === "home";
    crumb.textContent = labels[name];
    window.scrollTo(0, 0);
  }

  function goOut() {
    const parent = parentOf[current];
    if (parent) show(parent);
  }

  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => show(el.getAttribute("data-go")));
  });

  btnOut.addEventListener("click", goOut);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!guide.classList.contains("is-gone")) {
        dismissGuide();
        return;
      }
      goOut();
    }
  });

  function dismissGuide() {
    guide.classList.add("is-gone");
    try {
      sessionStorage.setItem("ms-guide-seen", "1");
    } catch (_) {}
  }

  guideOk.addEventListener("click", dismissGuide);

  // Auto-fade after a few seconds if ignored
  window.setTimeout(() => {
    if (!guide.classList.contains("is-gone")) dismissGuide();
  }, 10000);

  try {
    if (sessionStorage.getItem("ms-guide-seen") === "1") {
      guide.classList.add("is-gone");
    }
  } catch (_) {}

  show("home");
})();
