(function () {
  const shelf = document.getElementById("shelf");
  const empty = document.getElementById("empty");
  const TYPES = { storybook: "Storybook", comic: "Comic", visual: "Visual story" };
  let books = [];
  let filter = "all";

  const link = (b) => (b.type === "visual" ? "story.html" : "read.html") + "?book=" + encodeURIComponent(b.id);

  function render() {
    const shown = books.filter((b) => filter === "all" || b.type === filter);
    empty.hidden = shown.length > 0;
    document.getElementById("empty-text").textContent = books.length
      ? `No ${TYPES[filter] ? TYPES[filter].toLowerCase() + "s" : "stories"} yet.`
      : "New stories are on their way.";
    shelf.innerHTML = shown.map((b) => `
      <a class="book-card" href="${link(b)}">
        <div class="cover" style="--ratio:${b.coverRatio || 0.75}">
          <img src="books/${encodeURIComponent(b.id)}/${encodeURIComponent(b.cover)}" alt="" loading="lazy">
        </div>
        <div class="book-info">
          <span class="badge ${esc(b.type)}">${TYPES[b.type] || "Story"}</span>
          <h3>${esc(b.title)}</h3>
          ${b.description ? `<p class="desc">${esc(b.description)}</p>` : ""}
          <p class="meta">${b.author ? esc(b.author) + " · " : ""}${b.pageCount} ${b.type === "visual" ? "scenes" : "pages"}</p>
        </div>
      </a>`).join("");
  }

  // The newest story is shown beside the introduction.
  function renderFeatured() {
    const b = books[0];
    const el = document.getElementById("featured");
    if (!b) return;
    el.href = link(b);
    el.hidden = false;
    document.querySelector(".hero").classList.add("has-featured");
    el.innerHTML = `
      <div class="featured-cover" style="--ratio:${b.coverRatio || 0.75}">
        <img src="books/${encodeURIComponent(b.id)}/${encodeURIComponent(b.cover)}" alt="">
      </div>
      <div class="featured-caption">
        <span class="eyebrow">Latest work</span>
        <strong>${esc(b.title)}</strong>
        <span class="text-link">Read →</span>
      </div>`;
  }

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filter = chip.dataset.filter;
      document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      render();
    });
  });

  fetch("books/index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { books: [] }))
    .then((data) => { books = data.books || []; render(); renderFeatured(); })
    .catch(() => { books = []; render(); });

  // Latest journal entries
  fetch("journal/index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { entries: [] }))
    .then((data) => {
      const entries = (data.entries || []).slice(0, 3);
      if (!entries.length) return;
      document.getElementById("journal-latest").hidden = false;
      document.getElementById("latest").innerHTML = entries.map(journalCard).join("");
    })
    .catch(() => {});

  window.siteReady.then((site) => {
    if (site.siteTitle) document.title = site.owner ? `${site.siteTitle} · ${site.owner}` : site.siteTitle;
    if (site.about) {
      document.getElementById("about").hidden = false;
      document.getElementById("about-text").innerHTML = window.esc(site.about).split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
      document.querySelectorAll("[data-if-about]").forEach((el) => (el.hidden = false));
    }
  });
})();

