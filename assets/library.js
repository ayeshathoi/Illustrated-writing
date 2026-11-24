(function () {
  const shelf = document.getElementById("shelf");
  const empty = document.getElementById("empty");
  let books = [];
  let filter = "all";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render() {
    const shown = books.filter((b) => filter === "all" || b.type === filter);
    empty.hidden = shown.length > 0;
    if (!books.length) document.getElementById("empty-text").textContent = "The shelf is empty for now. New stories are on their way!";
    else if (!shown.length) document.getElementById("empty-text").textContent = filter === "comic" ? "No comics yet." : "No storybooks yet.";
    shelf.innerHTML = shown.map((b) => `
      <a class="book-card" href="read.html?book=${encodeURIComponent(b.id)}">
        <div class="cover" style="--ratio:${b.coverRatio || 0.75}">
          <img src="books/${encodeURIComponent(b.id)}/${encodeURIComponent(b.cover)}" alt="" loading="lazy">
        </div>
        <h3>${esc(b.title)}</h3>
        <div class="meta">
          <span class="badge ${b.type === "comic" ? "comic" : ""}">${b.type === "comic" ? "Comic" : "Storybook"}</span>
          <span>${b.author ? esc(b.author) + " · " : ""}${b.pageCount} pages</span>
        </div>
        ${b.description ? `<p class="desc">${esc(b.description)}</p>` : ""}
      </a>`).join("");
  }

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filter = chip.dataset.filter;
      document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      render();
    });
  });

  fetch("books/site.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then((site) => {
    if (!site) return;
    document.getElementById("site-title").textContent = site.siteTitle;
    document.getElementById("site-tagline").textContent = site.tagline || "";
    document.getElementById("footer-name").textContent = site.siteTitle;
    document.title = site.siteTitle;
  }).catch(() => {});

  fetch("books/index.json", { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : { books: [] })
    .then((data) => { books = data.books || []; render(); })
    .catch(() => { books = []; render(); });
})();
