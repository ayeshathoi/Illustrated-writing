(function () {
  const $ = (id) => document.getElementById(id);
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let books = [];
  let current = null; // the book open in the editor

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KIND = { storybook: "Storybook", comic: "Comic", visual: "Visual story" };
  const readerUrl = (b) => (b.type === "visual" ? "story.html" : "read.html") + "?book=" + encodeURIComponent(b.id);
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
  const VIEWS = ["books", "journal", "settings"];
  function showLogin() {
    VIEWS.forEach((v) => ($("view-" + v).hidden = true));
    $("tabs").hidden = true; $("logout-btn").hidden = true; $("login").hidden = false; $("password").focus();
  }

  function showTab(name) {
    if (!VIEWS.includes(name)) name = "books";
    VIEWS.forEach((v) => ($("view-" + v).hidden = v !== name));
    document.querySelectorAll("#tabs [data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    const url = new URL(location.href);
    url.searchParams.set("tab", name);
    if (name !== "books") url.searchParams.delete("book");
    if (name !== "journal") url.searchParams.delete("entry");
    history.replaceState(null, "", url);
    if (name === "journal") loadEntries();
  }
  document.querySelectorAll("#tabs [data-tab]").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

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
    $("tabs").hidden = false;
    $("logout-btn").hidden = false;
    fetch("books/site.json", { cache: "no-cache" }).then((r) => r.json()).then((s) => {
      $("site-title").value = s.siteTitle || "";
      $("site-tagline").value = s.tagline || "";
      $("site-owner").value = s.owner || "";
      $("site-about").value = s.about || "";
      $("site-comments").value = s.commentsUrl || "";
      $("comments-state").textContent = s.commentsUrl ? "✓ Comments are switched on." : "Comments are off until you add a link.";
      renderBackgrounds(s.backgrounds || []);
    }).catch(() => {});
    await loadBooks();
    const params = new URLSearchParams(location.search);
    showTab(params.get("tab") || "books");
    const wanted = params.get("book");
    if (wanted && books.some((b) => b.id === wanted)) openBook(wanted);
  }

  $("site-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("PATCH", "site", { siteTitle: $("site-title").value, tagline: $("site-tagline").value, owner: $("site-owner").value, about: $("site-about").value });
      toast("Site details saved");
    } catch (err) { toast(err.message, true); }
  });

  $("comments-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const site = await api("PATCH", "site", { commentsUrl: $("site-comments").value.trim() });
      $("comments-state").textContent = site.commentsUrl ? "✓ Comments are switched on." : "Comments are off until you add a link.";
      toast(site.commentsUrl ? "Comments switched on. Push to GitHub to go live" : "Comments switched off");
    } catch (err) { toast(err.message, true); }
  });

  // ------------------------------------------------------------------ background pictures
  function renderBackgrounds(list) {
    $("bg-grid").innerHTML = list.length ? list.map((name) => `
      <figure class="bg-tile">
        <img src="books/${encodeURIComponent(name)}" alt="" loading="lazy">
        <button type="button" class="bg-del" data-bg="${esc(name)}" aria-label="Remove this background">✕</button>
      </figure>`).join("") : `<div class="bg-preview"><span>Painted meadow (default)</span></div>`;
  }

  $("bg-grid").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-bg]");
    if (!btn || !confirm("Remove this background picture?")) return;
    try {
      const site = await api("DELETE", "site/backgrounds/" + encodeURIComponent(btn.dataset.bg));
      renderBackgrounds(site.backgrounds || []);
      toast("Background removed");
    } catch (err) { toast(err.message, true); }
  });

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
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    try {
      let site;
      for (const [i, file] of files.entries()) {
        toast(`Adding background ${i + 1} of ${files.length}…`);
        site = await api("POST", "site/backgrounds", await shrinkPhoto(file), true);
      }
      renderBackgrounds(site.backgrounds || []);
      toast("Backgrounds updated. Push to GitHub to show them online");
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
        <span class="small">${b.published ? "Published" : "Draft"} · ${KIND[b.type] || "Book"} · ${b.pages.length}</span></span>
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
    renderPublished();
    renderMusic();
    renderList();
    renderPages();
  }

  function replaceCurrent(book) {
    const i = books.findIndex((b) => b.id === book.id);
    if (i >= 0) books[i] = book;
    current = book;
    renderList();
  }

  function renderKind() {
    const visual = current.type === "visual";
    $("ed-preview").href = readerUrl(current);
    $("direction-field").hidden = visual;
    $("pages-heading").textContent = visual ? "Scenes" : "Pages";
    $("scenes-help").hidden = !visual;
    $("compose-btn").hidden = visual;
  }

  function renderMusic() {
    const mode = current.musicMode || "auto";
    $("ed-music").value = mode;
    $("ed-music-upload").hidden = mode !== "file";
    $("ed-music-hint").textContent = mode === "file"
      ? (current.music ? "✓ Your music file is uploaded. Upload again to replace it." : "Upload an MP3, M4A, OGG or WAV file you have the rights to use.")
      : mode === "auto" ? "Each book gets its own soft music-box tune. Readers press ♫ to play it." : "No music button for this book.";
  }

  $("ed-music").addEventListener("change", async (e) => {
    const mode = e.target.value;
    if (mode === "file" && !current.music) { $("ed-music-upload").hidden = false; renderMusicHintOnly(); return; }
    try { replaceCurrent(await api("PATCH", "books/" + current.id, { musicMode: mode })); renderMusic(); toast("Music setting saved"); }
    catch (err) { toast(err.message, true); renderMusic(); }
  });
  function renderMusicHintOnly() { $("ed-music-hint").textContent = "Now choose a music file (MP3, M4A, OGG or WAV) you have the rights to use."; }

  $("ed-music-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      toast("Uploading music…");
      replaceCurrent(await api("POST", `books/${current.id}/music`, file, true));
      renderMusic();
      toast("Music added");
    } catch (err) { toast(err.message, true); renderMusic(); }
  });

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
      renderPages();
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
    const visual = b.type === "visual";
    renderKind();
    $("pages-empty").hidden = b.pages.length > 0;
    $("pages").classList.toggle("scenes", visual);
    const caps = b.captions || {};
    const tools = (i) => `<span class="tools">
            <button type="button" data-act="left" aria-label="Move ${i + 1} earlier" ${i === 0 ? "disabled" : ""}>${visual ? "▲" : "◀"}</button>
            <button type="button" data-act="right" aria-label="Move ${i + 1} later" ${i === b.pages.length - 1 ? "disabled" : ""}>${visual ? "▼" : "▶"}</button>
            ${visual ? "" : `<button type="button" data-act="compose" aria-label="Write text on page ${i + 1}" title="Write text on this page">✎</button>`}
            <button type="button" class="del" data-act="del" aria-label="Delete ${i + 1}">✕</button>
          </span>`;
    $("pages").innerHTML = b.pages.map((p, i) => visual ? `
      <div class="page-tile scene-row" data-page="${esc(p)}">
        <div class="scene-pic">
          <img src="${pageUrl(b, p)}" alt="Scene ${i + 1}" loading="lazy">
          <div class="num"><span>Scene ${i + 1}</span>${tools(i)}</div>
        </div>
        <textarea class="input scene-caption" data-caption="${esc(p)}" placeholder="Write the words for this scene…" aria-label="Words for scene ${i + 1}">${esc(caps[p] || "")}</textarea>
      </div>` : `
      <div class="page-tile" draggable="true" data-page="${esc(p)}">
        ${i === 0 ? '<span class="badge cover-tag">Cover</span>' : ""}
        <img src="${pageUrl(b, p)}" alt="Page ${i + 1}" loading="lazy">
        <div class="num"><span>${i + 1}</span>${tools(i)}</div>
      </div>`).join("");
  }

  // Scene words save automatically while you type.
  const pendingCaptions = {};
  let captionTimer;
  $("pages").addEventListener("input", (e) => {
    const box = e.target.closest("[data-caption]");
    if (!box) return;
    pendingCaptions[box.dataset.caption] = box.value;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(saveCaptions, 700);
  });
  async function saveCaptions() {
    const batch = { ...pendingCaptions };
    Object.keys(pendingCaptions).forEach((k) => delete pendingCaptions[k]);
    if (!Object.keys(batch).length || !current) return;
    try {
      const book = await api("PATCH", "books/" + current.id, { captions: batch });
      const i = books.findIndex((x) => x.id === book.id);
      if (i >= 0) books[i] = book;
      if (current.id === book.id) current = book;
      toast("Words saved");
    } catch (err) { toast(err.message, true); }
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
    if (btn.dataset.act === "compose") return openComposer(page);
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

  // ------------------------------------------------------------------ page maker (write text on a picture)
  const cm = { img: null, replace: null };
  const canvas = $("composer-canvas");
  const ctx = canvas.getContext("2d");
  const FONTS = {
    Lora: ['500', '"Lora", Georgia, serif', 1],
    Parisienne: ['400', '"Parisienne", cursive', 1.3],
    Quicksand: ['600', '"Quicksand", sans-serif', 1],
    Caveat: ['700', '"Caveat", cursive', 1.3],
  };
  const fontsReady = Promise.all(Object.keys(FONTS).map((f) => document.fonts.load(`40px "${f}"`))).catch(() => {});

  async function loadImage(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  }

  async function openComposer(page) {
    cm.img = null;
    cm.replace = page || null;
    $("composer-title").textContent = page ? "Write on this page" : "Make a page with text";
    $("cm-save").textContent = page ? "Replace page" : "Add page";
    $("composer").showModal();
    if (page) {
      try { cm.img = await loadImage(pageUrl(current, page)); } catch { toast("Couldn't open that page", true); }
    }
    draw();
  }
  $("compose-btn").addEventListener("click", () => openComposer(null));
  $("composer-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { cm.img = await loadImage(URL.createObjectURL(f)); draw(); } catch { toast("That picture couldn't be opened", true); }
  });
  ["cm-text", "cm-font", "cm-color", "cm-size", "cm-pos", "cm-align", "cm-back"].forEach((id) => $(id).addEventListener("input", draw));

  function wrapLines(text, maxW) {
    const out = [];
    text.split("\n").forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      let line = words.shift();
      for (const w of words) {
        if (ctx.measureText(line + " " + w).width <= maxW) line += " " + w;
        else { out.push(line); line = w; }
      }
      out.push(line);
    });
    return out;
  }

  async function draw() {
    await fontsReady;
    const has = !!cm.img;
    $("composer-pick").hidden = has;
    canvas.hidden = !has;
    $("cm-save").disabled = !has;
    if (!has) return;
    const scale = Math.min(1, 2400 / Math.max(cm.img.naturalWidth, cm.img.naturalHeight));
    const W = (canvas.width = Math.round(cm.img.naturalWidth * scale));
    const H = (canvas.height = Math.round(cm.img.naturalHeight * scale));
    ctx.drawImage(cm.img, 0, 0, W, H);
    const text = $("cm-text").value.trim();
    if (!text) return;

    const [weight, family, boost] = FONTS[$("cm-font").value];
    const size = (W * Number($("cm-size").value) / 100) * boost;
    ctx.font = `${weight} ${size}px ${family}`;
    const pad = size * 0.75;
    const margin = W * 0.05;
    const lines = wrapLines(text, W - margin * 2 - pad * 2);
    const lh = size * 1.32;
    const blockH = lines.length * lh;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = widest + pad * 2, boxH = blockH + pad * 2;
    const top = margin + (H - margin * 2 - boxH) * Number($("cm-pos").value) / 100;
    const align = $("cm-align").value;
    const boxX = align === "left" ? margin : align === "right" ? W - margin - boxW : (W - boxW) / 2;
    const x = align === "left" ? boxX + pad : align === "right" ? boxX + boxW - pad : W / 2;
    const back = $("cm-back").value;

    if (back === "box") {
      ctx.fillStyle = "rgba(251, 246, 236, 0.86)";
      ctx.beginPath();
      ctx.roundRect(boxX, top, boxW, boxH, size * 0.6);
      ctx.fill();
    } else if (back === "band") {
      ctx.fillStyle = "rgba(251, 246, 236, 0.82)";
      ctx.fillRect(0, top, W, boxH);
    }
    ctx.fillStyle = $("cm-color").value;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    const paint = () => lines.forEach((l, i) => ctx.fillText(l, x, top + pad + lh * i + lh / 2));
    if (back === "glow") {
      ctx.shadowColor = "rgba(255, 250, 240, 0.95)";
      ctx.shadowBlur = size * 0.7;
      paint(); paint();
      ctx.shadowBlur = 0;
    }
    paint();
  }

  $("cm-save").addEventListener("click", async () => {
    if (!cm.img || !current) return;
    const btn = $("cm-save");
    btn.disabled = true;
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      const oldFirst = current.pages[0];
      let book = await api("POST", `books/${current.id}/pages`, blob, true);
      if (cm.replace) {
        // Put the new page where the old one was, then remove the old one.
        const added = book.pages[book.pages.length - 1];
        const order = book.pages.filter((p) => p !== added);
        order.splice(order.indexOf(cm.replace), 0, added);
        book = await api("PATCH", "books/" + current.id, { pages: order });
        book = await api("DELETE", `books/${current.id}/pages/${cm.replace}`);
      }
      replaceCurrent(book);
      renderPages();
      if (current.pages[0] !== oldFirst) updateCoverRatio();
      $("composer").close();
      toast(cm.replace ? "Page updated" : "Page added");
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------------ journal
  let entries = [];
  let entry = null;
  let entriesLoaded = false;
  let entryDirty = false;
  let entryTimer;
  const body = $("entry-body");
  const imageBase = (e) => (e.public ? "journal" : "private/journal") + "/" + encodeURIComponent(e.id);
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const niceDate = (iso) => { const d = new Date(iso + "T12:00:00"); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };

  async function loadEntries() {
    if (entriesLoaded) return;
    entriesLoaded = true;
    try {
      entries = (await api("GET", "journal")).entries;
    } catch (err) { entriesLoaded = false; return toast(err.message, true); }
    renderEntries();
    const want = new URLSearchParams(location.search).get("entry");
    if (want && entries.some((e) => e.id === want)) openEntry(want);
  }

  function renderEntries() {
    $("entry-list").innerHTML = entries.length ? entries.map((e) => {
      const d = new Date(e.date + "T12:00:00");
      return `<li><button data-entry="${esc(e.id)}" aria-current="${!!entry && entry.id === e.id}">
        <span class="thumb date-thumb"><b>${isNaN(d) ? "" : d.getDate()}</b><small>${isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short" })}</small></span>
        <span><span class="name">${e.public ? "" : "🔒 "}${esc(e.title)}</span>
        <span class="small">${e.public ? "Public" : "Private"} · ${esc(niceDate(e.date))}</span></span>
      </button></li>`;
    }).join("") : `<li class="muted">No entries yet.</li>`;
  }

  $("entry-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-entry]");
    if (!btn) return;
    await saveEntry();
    openEntry(btn.dataset.entry);
  });

  $("new-entry-btn").addEventListener("click", async () => {
    await saveEntry();
    try {
      const title = prompt("Title for your new entry:", "");
      if (title === null) return;
      const created = await api("POST", "journal", { title: title.trim() || "Untitled entry", date: today(), public: false, body: "" });
      entries.unshift(created);
      openEntry(created.id);
      body.focus();
    } catch (err) { toast(err.message, true); }
  });

  function openEntry(id) {
    entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const url = new URL(location.href);
    url.searchParams.set("entry", id);
    history.replaceState(null, "", url);
    $("journal-welcome").hidden = true;
    $("entry-form").hidden = false;
    $("entry-title").value = entry.title;
    $("entry-date").value = entry.date;
    body.value = entry.body || "";
    setPreview(false);
    renderEntryPublic();
    $("entry-status").textContent = "Last saved " + new Date((entry.updated || entry.created) * 1000).toLocaleString();
    entryDirty = false;
    renderEntries();
  }

  function renderEntryPublic() {
    $("entry-public").checked = !!entry.public;
    $("entry-public-label").textContent = entry.public ? "🌿 Public" : "🔒 Private";
    $("entry-view").hidden = !entry.public;
    $("entry-view").href = "journal.html?entry=" + encodeURIComponent(entry.id);
  }

  function markDirty() {
    if (!entry) return;
    entryDirty = true;
    $("entry-status").textContent = "Unsaved changes…";
    clearTimeout(entryTimer);
    entryTimer = setTimeout(saveEntry, 1500);
  }
  ["entry-title", "entry-date"].forEach((id) => $(id).addEventListener("input", markDirty));
  body.addEventListener("input", markDirty);

  async function saveEntry() {
    clearTimeout(entryTimer);
    if (!entry || !entryDirty) return;
    entryDirty = false;
    try {
      const saved = await api("PATCH", "journal/" + entry.id, { title: $("entry-title").value, date: $("entry-date").value, body: body.value });
      Object.assign(entry, saved);
      $("entry-status").textContent = "Saved ✓ " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      entries.sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));
      renderEntries();
    } catch (err) {
      entryDirty = true;
      toast(err.message, true);
    }
  }

  $("entry-form").addEventListener("submit", (e) => { e.preventDefault(); entryDirty = true; saveEntry(); });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !$("view-journal").hidden && entry) {
      e.preventDefault(); entryDirty = true; saveEntry();
    }
  });
  window.addEventListener("beforeunload", (e) => { if (entryDirty) { saveEntry(); e.preventDefault(); } });

  $("entry-public").addEventListener("change", async (e) => {
    await saveEntry();
    try {
      Object.assign(entry, await api("PATCH", "journal/" + entry.id, { public: e.target.checked }));
      renderEntryPublic();
      renderEntries();
      toast(entry.public ? "Public: push to GitHub to show it on your site" : "Private: this entry stays on your computer only");
    } catch (err) { toast(err.message, true); renderEntryPublic(); }
  });

  $("entry-delete").addEventListener("click", async () => {
    if (!entry || !confirm(`Delete “${entry.title}”? This can't be undone.`)) return;
    try {
      await api("DELETE", "journal/" + entry.id);
      entries = entries.filter((x) => x.id !== entry.id);
      entry = null;
      entryDirty = false;
      $("entry-form").hidden = true;
      $("journal-welcome").hidden = false;
      renderEntries();
      toast("Entry deleted");
    } catch (err) { toast(err.message, true); }
  });

  // Formatting buttons wrap the selected text.
  function surround(before, after = before, placeholder = "text") {
    const { selectionStart: a, selectionEnd: b, value } = body;
    const chosen = value.slice(a, b) || placeholder;
    body.setRangeText(before + chosen + after, a, b, "end");
    body.setSelectionRange(a + before.length, a + before.length + chosen.length);
    body.focus();
    markDirty();
  }
  function prefixLine(prefix) {
    const a = body.selectionStart;
    const start = body.value.lastIndexOf("\n", a - 1) + 1;
    body.setRangeText(prefix, start, start, "end");
    body.focus();
    markDirty();
  }
  document.querySelectorAll("[data-fmt]").forEach((btn) => btn.addEventListener("click", () => {
    ({ bold: () => surround("**"), italic: () => surround("*"), heading: () => prefixLine("# "), quote: () => prefixLine("> ") })[btn.dataset.fmt]();
  }));
  body.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key.toLowerCase() === "b") { e.preventDefault(); surround("**"); }
    if (e.key.toLowerCase() === "i") { e.preventDefault(); surround("*"); }
  });

  $("entry-image").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !entry) return;
    try {
      toast("Adding picture…");
      const res = await api("POST", `journal/${entry.id}/images`, await shrinkPhoto(file, 2000), true);
      const a = body.selectionStart;
      const needsBreak = a > 0 && body.value[a - 1] !== "\n";
      body.setRangeText(`${needsBreak ? "\n\n" : ""}![](${res.name})\n\n`, a, body.selectionEnd, "end");
      body.focus();
      entryDirty = true;
      await saveEntry();
      toast("Picture added. Type a caption between the [ ] if you like");
    } catch (err) { toast(err.message, true); }
  });

  function setPreview(on) {
    $("entry-preview-btn").setAttribute("aria-pressed", String(on));
    $("entry-preview-btn").textContent = on ? "Edit" : "Preview";
    body.hidden = on;
    $("entry-preview").hidden = !on;
    if (on) $("entry-preview").innerHTML = window.renderMarkup(body.value, imageBase(entry)) || '<p class="muted">Nothing written yet.</p>';
  }
  $("entry-preview-btn").addEventListener("click", () => setPreview(body.hidden === false));

  boot();
})();
