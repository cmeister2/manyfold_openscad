// Only this exported demo intercepts backend actions. The plugin stays unchanged.
document.addEventListener("submit", (event) => {
  if (event.target.matches("[data-parameters]")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, {capture: true});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-demo-inert]")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const toggle = event.target.closest("[data-bs-toggle]");
  if (!toggle) return;
  if (toggle.dataset.bsToggle === "collapse") {
    const target = document.querySelector(toggle.dataset.bsTarget);
    if (target) {
      const open = target.classList.toggle("show");
      toggle.setAttribute("aria-expanded", String(open));
    }
  } else if (toggle.dataset.bsToggle === "dropdown") {
    const menu = toggle.parentElement.querySelector(".dropdown-menu");
    if (menu) {
      const open = menu.classList.toggle("show");
      toggle.setAttribute("aria-expanded", String(open));
    }
  }
});

const configElement = document.querySelector("[data-openscad-config]");
const config = JSON.parse(configElement.textContent);
for (const [key, value] of Object.entries(config.assets)) {
  config.assets[key] = new URL(value, document.baseURI).href;
}
configElement.textContent = JSON.stringify(config);
await import("./assets/customizer.mjs");
