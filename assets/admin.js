(function () {
  const $ = (id) => document.getElementById(id);
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let books = [];
  let current = null; // the book open in the editor

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pageUrl = (b, p) => `books/${encodeURIComponent(b.id)}/${encodeURIComponent(p)}`;

  let toastTimer;
  function toast(text, error) {
    const t = $("toast");
    t.textContent = text;
    t.classList.toggle("error", !!error);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), error ? 5000 : 2400);
  }

  async function api(method, path, body, raw) {
    const opts = { method, headers: { "X-Requested-With": "storyshelf" } };
    if (body !== undefined) {
      if (raw) { opts.body = body; opts.headers["Content-Type"] = "application/octet-stream"; }
      else { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
    }
    const res = await fetch("api/" + path, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "login") { showLogin(); }
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
    return data;
  }

  // ------------------------------------------------------------------ sign in
  function showLogin() { $("app").hidden = true; $("logout-btn").hidden = true; $("login").hidden = false; $("password").focus(); }

  async function boot() {
    let session;
    try {
      const res = await fetch("api/session", { cache: "no-store" });
      if (!res.ok) throw new Error();
      session = await res.json();
    } catch {
      $("offline").hidden = false; // static hosting (e.g. GitHub Pages): no studio here
      return;
    }
    if (!session.admin) return showLogin();
    showApp();
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("POST", "login", { password: $("password").value });
      $("password").value = "";
      showApp();
    } catch (err) { toast(err.message, true); }
  });

  $("logout-btn").addEventListener("click", async () => { await api("POST", "logout", {}); location.reload(); });

  async function showApp() {
    $("login").hidden = true;
    $("app").hidden = false;
    $("logout-btn").hidden = false;
    fetch("books/site.json", { cache: "no-cache" }).then((r) => r.json()).then((s) => {
      $("site-title").value = s.siteTitle || "";
      $("site-tagline").value = s.tagline || "";
      $("site-owner").value = s.owner || "";
      renderBackground(s.background);
    }).catch(() => {});
    await loadBooks();
    const wanted = new URLSearchParams(location.search).get("book");
    if (wanted && books.some((b) => b.id === wanted)) openBook(wanted);
  }

  $("site-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("PATCH", "site", { siteTitle: $("site-title").value, tagline: $("site-tagline").value, owner: $("site-owner").value });
      toast("Site details saved");
    } catch (err) { toast(err.message, true); }
  });

  // ------------------------------------------------------------------ background photo
  function renderBackground(name) {
    const url = name ? "books/" + encodeURIComponent(name) : "";
    $("bg-preview").style.backgroundImage = url ? `url("${url}")` : "";
    $("bg-preview").querySelector("span").textContent = url ? "Your photo" : "Painted meadow (default)";
    $("bg-remove").hidden = !url;
    if (window.storyshelfBackground) window.storyshelfBackground(url);
  }

  // Shrink big camera photos so the site loads quickly (backgrounds never need more).
  async function shrinkPhoto(file, maxSide = 2400) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  }

  $("bg-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      toast("Setting your background…");
      const site = await api("POST", "site/background", await shrinkPhoto(file), true);
      renderBackground(site.background);
      toast("Background updated. Push to GitHub to show it online");
    } catch (err) { toast(err.message, true); }
  });

  $("bg-remove").addEventListener("click", async () => {
    try {
      await api("DELETE", "site/background");
      renderBackground(null);
      toast("Back to the painted meadow");
    } catch (err) { toast(err.message, true); }
  });

  // ------------------------------------------------------------------ book list
  async function loadBooks() {
    books = (await api("GET", "books")).books;
    renderList();
  }

  function renderList() {
    $("book-list").innerHTML = books.length ? books.map((b) => `
      <li><button data-id="${esc(b.id)}" aria-current="${current && current.id === b.id}">
        <span class="thumb">${b.pages[0] ? `<img src="${pageUrl(b, b.pages[0])}" alt="" loading="lazy">` : ""}</span>
        <span><span class="name">${esc(b.title)}</span>
        <span class="small">${b.published ? "Published" : "Draft"} · ${b.pages.length} pages</span></span>
      </button></li>`).join("") : `<li class="muted">No books yet.</li>`;
  }

  $("book-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (btn) openBook(btn.dataset.id);
  });

  $("new-btn").addEventListener("click", () => {
    current = null; renderList();
    $("welcome").hidden = true; $("editor").hidden = true; $("new-form").hidden = false;
    $("new-title").focus();
  });
  $("new-cancel").addEventListener("click", () => { $("new-form").hidden = true; $("welcome").hidden = false; });

  $("new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const book = await api("POST", "books", { title: $("new-title").value, type: $("new-type").value, author: $("new-author").value });
      $("new-form").reset();
      books.unshift(book);
      openBook(book.id);
      toast("Book created. Now add some pages!");
    } catch (err) { toast(err.message, true); }
  });

  // ------------------------------------------------------------------ editor
  function openBook(id) {
    current = books.find((b) => b.id === id);
    if (!current) return;
    history.replaceState(null, "", "?book=" + encodeURIComponent(id));
    $("welcome").hidden = true; $("new-form").hidden = true; $("editor").hidden = false;
    $("ed-heading").textContent = current.title;
    $("ed-title").value = current.title;
    $("ed-type").value = current.type;
    $("ed-author").value = current.author || "";
    $("ed-direction").value = current.direction || "ltr";
    $("ed-desc").value = current.description || "";
    $("ed-preview").href = "read.html?book=" + encodeURIComponent(id);
    renderPublished();
    renderList();
    renderPages();
  }

  function replaceCurrent(book) {
    const i = books.findIndex((b) => b.id === book.id);
    if (i >= 0) books[i] = book;
    current = book;
    renderList();
  }

  function renderPublished() {
    $("ed-published").checked = !!current.published;
    $("ed-pub-label").textContent = current.published ? "Published" : "Draft";
  }

  $("meta-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      replaceCurrent(await api("PATCH", "books/" + current.id, {
        title: $("ed-title").value, type: $("ed-type").value, author: $("ed-author").value,
        direction: $("ed-direction").value, description: $("ed-desc").value,
      }));
      $("ed-heading").textContent = current.title;
      toast("Saved");
    } catch (err) { toast(err.message, true); }
  });

  $("ed-published").addEventListener("change", async (e) => {
    if (e.target.checked && !current.pages.length) {
      e.target.checked = false;
      return toast("Add at least one page before publishing", true);
    }
    try {
      replaceCurrent(await api("PATCH", "books/" + current.id, { published: e.target.checked }));
      renderPublished();
      toast(current.published ? "Published. Push to GitHub to put it online" : "Moved back to drafts");
    } catch (err) { toast(err.message, true); renderPublished(); }
  });

  $("delete-btn").addEventListener("click", async () => {
    if (!confirm(`Delete “${current.title}” and all ${current.pages.length} pages? This can't be undone.`)) return;
    try {
      await api("DELETE", "books/" + current.id);
      books = books.filter((b) => b.id !== current.id);
      current = null;
      history.replaceState(null, "", location.pathname);
      $("editor").hidden = true; $("welcome").hidden = false;
      renderList();
      toast("Book deleted");
    } catch (err) { toast(err.message, true); }
  });

  // ------------------------------------------------------------------ pages grid
  function renderPages() {
    const b = current;
    $("pages-empty").hidden = b.pages.length > 0;
    $("pages").innerHTML = b.pages.map((p, i) => `
      <div class="page-tile" draggable="true" data-page="${esc(p)}">
        ${i === 0 ? '<span class="badge cover-tag">Cover</span>' : ""}
        <img src="${pageUrl(b, p)}" alt="Page ${i + 1}" loading="lazy">
        <div class="num"><span>${i + 1}</span>
          <span class="tools">
            <button type="button" data-act="left" aria-label="Move page ${i + 1} earlier" ${i === 0 ? "disabled" : ""}>◀</button>
            <button type="button" data-act="right" aria-label="Move page ${i + 1} later" ${i === b.pages.length - 1 ? "disabled" : ""}>▶</button>
            <button type="button" class="del" data-act="del" aria-label="Delete page ${i + 1}">✕</button>
          </span></div>
      </div>`).join("");
  }

  async function saveOrder(order) {
    const oldFirst = current.pages[0];
    try {
      replaceCurrent(await api("PATCH", "books/" + current.id, { pages: order }));
      renderPages();
      if (current.pages[0] !== oldFirst) updateCoverRatio();
    } catch (err) { toast(err.message, true); }
  }

  $("pages").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const page = btn.closest(".page-tile").dataset.page;
    const order = current.pages.slice();
    const i = order.indexOf(page);
    if (btn.dataset.act === "del") {
      if (!confirm(`Delete page ${i + 1}?`)) return;
      try {
        replaceCurrent(await api("DELETE", `books/${current.id}/pages/${page}`));
        renderPages();
        if (i === 0) updateCoverRatio();
      } catch (err) { toast(err.message, true); }
      return;
    }
    const j = btn.dataset.act === "left" ? i - 1 : i + 1;
    [order[i], order[j]] = [order[j], order[i]];
    saveOrder(order);
  });

  // Drag to reorder
  let dragged = null;
  const grid = $("pages");
  const clearMarks = () => grid.querySelectorAll(".drop-before,.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  grid.addEventListener("dragstart", (e) => {
    const tile = e.target.closest(".page-tile");
    if (!tile) return;
    dragged = tile.dataset.page;
    tile.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragged);
  });
  grid.addEventListener("dragend", (e) => { e.target.closest(".page-tile")?.classList.remove("dragging"); clearMarks(); dragged = null; });
  grid.addEventListener("dragover", (e) => {
    if (!dragged) return;
    const tile = e.target.closest(".page-tile");
    if (!tile) return;
    e.preventDefault();
    clearMarks();
    const box = tile.getBoundingClientRect();
    tile.classList.add(e.clientX < box.left + box.width / 2 ? "drop-before" : "drop-after");
  });
  grid.addEventListener("drop", (e) => {
    if (!dragged) return;
    e.preventDefault();
    const tile = e.target.closest(".page-tile");
    if (!tile || tile.dataset.page === dragged) return clearMarks();
    const after = tile.classList.contains("drop-after");
    clearMarks();
    const order = current.pages.filter((p) => p !== dragged);
    let at = order.indexOf(tile.dataset.page);
    if (after) at += 1;
    order.splice(at, 0, dragged);
    saveOrder(order);
  });

  async function updateCoverRatio() {
    if (!current.pages[0]) return;
    const img = new Image();
    img.src = pageUrl(current, current.pages[0]);
    try { await img.decode(); } catch { return; }
    if (!img.naturalWidth) return;
    try { replaceCurrent(await api("PATCH", "books/" + current.id, { coverRatio: img.naturalWidth / img.naturalHeight })); } catch {}
  }

  // ------------------------------------------------------------------ uploads
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
    if (dragged) return;
    e.preventDefault(); drop.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { if (dragged) return; e.preventDefault(); uploadFiles(e.dataTransfer.files); });
  $("file-input").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });

  const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  let uploading = false;

  function progress(done, total, label) {
    $("progress-wrap").hidden = false;
    $("progress-bar").style.width = (total ? (done / total) * 100 : 0) + "%";
    $("progress-label").textContent = label;
  }

  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFJS + "pdf.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load the PDF reader. Are you online?"));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    return window.pdfjsLib;
  }

  async function pdfPageToBlob(pdf, n) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 2000 / base.width); // ~2000px wide: crisp but not huge
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  }

  async function uploadFiles(fileList) {
    if (!current || uploading) return;
    const files = [...fileList].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const skipped = files.filter((f) => f.type !== "application/pdf" && !IMAGE_TYPES.includes(f.type));
    const usable = files.filter((f) => !skipped.includes(f));
    if (skipped.length) toast(`Skipped ${skipped.map((f) => f.name).join(", ")}: use PNG, JPG, WebP, GIF or PDF`, true);
    if (!usable.length) return;

    uploading = true;
    const hadCover = current.pages[0];
    let pdfLib = null;
    // Count the total pages first so the progress bar is honest.
    const jobs = [];
    try {
      for (const f of usable) {
        if (f.type === "application/pdf") {
          progress(0, 1, `Opening ${f.name}…`);
          pdfLib = pdfLib || await loadPdfJs();
          const pdf = await pdfLib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let n = 1; n <= pdf.numPages; n++) jobs.push({ label: `${f.name} · page ${n}`, get: () => pdfPageToBlob(pdf, n) });
        } else {
          jobs.push({ label: f.name, get: async () => f });
        }
      }
      for (let i = 0; i < jobs.length; i++) {
        progress(i, jobs.length, `Adding ${jobs[i].label} (${i + 1} of ${jobs.length})`);
        const blob = await jobs[i].get();
        replaceCurrent(await api("POST", `books/${current.id}/pages`, blob, true));
        renderPages();
      }
      progress(1, 1, `Added ${jobs.length} page${jobs.length === 1 ? "" : "s"} ✨`);
      if (current.pages[0] !== hadCover) updateCoverRatio();
    } catch (err) {
      toast(err.message, true);
      progress(0, 1, "Upload stopped: " + err.message);
    } finally {
      uploading = false;
    }
  }

  boot();
})();
