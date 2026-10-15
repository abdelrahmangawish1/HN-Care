const menuToggle = document.querySelector(".menu-toggle");
const mainNavigation = document.querySelector("#main-navigation");

const menuLabels = {
  en: { open: "Open menu", close: "Close menu" },
  ar: { open: "فتح القائمة", close: "إغلاق القائمة" },
  fr: { open: "Ouvrir le menu", close: "Fermer le menu" },
  it: { open: "Apri menu", close: "Chiudi menu" },
  zh: { open: "打开菜单", close: "关闭菜单" },
};

function updateMenuLabel(isOpen) {
  const selectedLanguage = document.documentElement.lang === "zh-CN"
    ? "zh"
    : document.documentElement.lang;
  const labels = menuLabels[selectedLanguage] || menuLabels.en;
  menuToggle.setAttribute("aria-label", isOpen ? labels.close : labels.open);
}

menuToggle.addEventListener("click", () => {
  const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";

  menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  updateMenuLabel(!isExpanded);
  mainNavigation.classList.toggle("is-open", !isExpanded);
});

document.addEventListener("hncare:languagechange", (event) => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-label", isOpen ? event.detail.close : event.detail.open);
});

mainNavigation.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    menuToggle.setAttribute("aria-expanded", "false");
    updateMenuLabel(false);
    mainNavigation.classList.remove("is-open");
  }
});
