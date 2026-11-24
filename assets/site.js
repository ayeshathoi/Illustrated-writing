// Shared bits for every public page: site settings, navigation, footer.
window.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

window.siteReady = fetch("books/site.json", { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((site) => {
    site.siteTitle = site.siteTitle || "Thoithoi’s Tales";
    document.querySelectorAll("[data-site-title]").forEach((el) => (el.textContent = site.siteTitle));
    document.querySelectorAll("[data-site-tagline]").forEach((el) => (el.textContent = site.tagline || ""));
    document.querySelectorAll("[data-owner]").forEach((el) => (el.textContent = site.owner || ""));
    document.querySelectorAll("[data-if-owner]").forEach((el) => (el.hidden = !site.owner));
    document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
    return site;
  });

// Navigation: mark the current page, and a menu button on phones.
(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const target = a.getAttribute("href").split("#")[0] || "index.html";
    if (target === here && !a.getAttribute("href").includes("#")) a.setAttribute("aria-current", "page");
  });
  const toggle = document.querySelector(".nav-toggle");
  const bar = document.querySelector(".topbar");
  if (toggle && bar) {
    toggle.addEventListener("click", () => {
      const open = bar.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    bar.querySelectorAll(".nav-links a").forEach((a) => a.addEventListener("click", () => bar.classList.remove("open")));
  }
  const onScroll = () => bar && bar.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

window.formatDate = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

// A journal entry preview card (home page and journal list).
window.journalCard = function (e) {
  const bn = window.isMostlyBengali(e.title + " " + e.excerpt) ? ' lang="bn"' : "";
  return `<a class="journal-card" href="journal.html?entry=${encodeURIComponent(e.id)}">
    ${e.cover ? `<div class="journal-thumb"><img src="journal/${encodeURIComponent(e.id)}/${encodeURIComponent(e.cover)}" alt="" loading="lazy"></div>` : ""}
    <div class="journal-body"${bn}>
      <time>${esc(formatDate(e.date))}</time>
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.excerpt)}</p>
      <span class="text-link">Read more →</span>
    </div>
  </a>`;
};

// True when most letters are Bengali (an English post with a Bengali quote stays English).
window.isMostlyBengali = function (text) {
  const bn = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return bn > latin;
};
