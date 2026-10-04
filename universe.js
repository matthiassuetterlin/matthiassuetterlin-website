(() => {
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
    if (e.key === "Escape") goOut();
  });

  show("home");
})();
