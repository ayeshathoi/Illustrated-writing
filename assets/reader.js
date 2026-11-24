(function () {
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), bookEl = $("book"), leaf = $("leaf");
  const leftEl = bookEl.querySelector(".page.left"), rightEl = bookEl.querySelector(".page.right");
  const frontFace = leaf.querySelector(".front"), backFace = leaf.querySelector(".back");
  const scrub = $("scrub"), countEl = $("count"), endCard = $("end");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const id = new URLSearchParams(location.search).get("book") || "";
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const posKey = "storyshelf-pos-" + id, viewKey = "storyshelf-view";

  let book, urls = [], ratio = 0.75;
  let rtl = false, mode = "spread", spreads = [], si = 0;
  let anim = null, pendingFinish = null;

  function storage(fn) { try { return fn(localStorage); } catch { return null; } }
  function showMsg(html) { $("msg").innerHTML = html; $("msg").hidden = false; bookEl.hidden = true; }

  // ------------------------------------------------------------------ loading
  if (!/^[a-z0-9-]+$/.test(id)) return showMsg('That book could not be found. <a href="index.html">Back to the library</a>');

  fetch(`books/${id}/book.json`, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then((b) => {
      if (!b.published && !isLocal) throw new Error();
      if (!b.pages.length) return showMsg('This book has no pages yet. <a href="index.html">Back to the library</a>');
      book = b;
      rtl = b.direction === "rtl";
      urls = b.pages.map((p) => `books/${encodeURIComponent(id)}/${encodeURIComponent(p)}`);
      document.title = b.title;
      $("book-title").textContent = b.title;
      $("book-sub").textContent = [b.author && "by " + b.author, b.type === "comic" ? "Comic" : "Storybook", !b.published && "Draft preview"].filter(Boolean).join(" · ");
      scrub.dataset.rtl = String(rtl);
      setupComments(b.id);
      window.setupBookMusic && window.setupBookMusic(b, $("music-btn"));
      const first = new Image();
      first.onload = () => { if (first.naturalWidth) ratio = first.naturalWidth / first.naturalHeight; start(); };
      first.onerror = start;
      first.src = urls[0];
    })
    .catch(() => showMsg('That book could not be found. <a href="index.html">Back to the library</a>'));

  function start() {
    bookEl.hidden = false;
    const saved = Number(storage((s) => s.getItem(posKey)) || 0);
    layout(saved < urls.length ? saved : 0);
    const hint = $("hint");
    hint.classList.add("show");
    setTimeout(() => hint.classList.remove("show"), 3500);
    window.addEventListener("resize", () => layout(currentPage()));
  }

  // ------------------------------------------------------------------ layout
  // A spread is { first, second }: page indexes in reading order (null = empty side).
  // In left-to-right books "first" sits on the left; right-to-left books mirror it.
  const farEl = () => (rtl ? rightEl : leftEl);
  const nearEl = () => (rtl ? leftEl : rightEl);

  function buildSpreads() {
    const n = urls.length;
    if (mode === "single") return urls.map((_, i) => ({ first: null, second: i }));
    const out = [{ first: null, second: 0 }];
    for (let i = 1; i < n; i += 2) out.push({ first: i, second: i + 1 < n ? i + 1 : null });
    return out;
  }

  function currentPage() {
    const s = spreads[si];
    return s ? (s.first ?? s.second) : 0;
  }

  function spreadForPage(p) {
    return spreads.findIndex((s) => s.first === p || s.second === p);
  }

  function chooseMode(W, H) {
    const pref = storage((s) => s.getItem(viewKey));
    if (pref === "single" || pref === "spread") return pref;
    const spreadW = Math.min(W / 2, H * ratio), singleW = Math.min(W, H * ratio);
    return W > 700 && spreadW >= singleW * 0.78 ? "spread" : "single";
  }

  function layout(page) {
    finishAnim();
    const cs = getComputedStyle(stage);
    const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    mode = chooseMode(W, H);
    const pw = mode === "spread" ? Math.min(W / 2, H * ratio) : Math.min(W, H * ratio);
    const ph = pw / ratio;
    bookEl.style.width = Math.floor(mode === "spread" ? pw * 2 : pw) + "px";
    bookEl.style.height = Math.floor(ph) + "px";
    bookEl.classList.toggle("single", mode === "single");
    $("view-btn").setAttribute("aria-pressed", String(mode === "single"));
    $("view-btn").setAttribute("aria-label", mode === "single" ? "Show two pages at a time" : "Show one page at a time");
    spreads = buildSpreads();
    si = Math.max(0, spreadForPage(page));
    scrub.max = String(spreads.length - 1);
    render();
  }

  function setImg(el, idx) {
    const img = el.querySelector("img");
    if (idx == null) { el.classList.add("blank"); img.removeAttribute("src"); img.alt = ""; return; }
    el.classList.remove("blank");
    if (img.getAttribute("src") !== urls[idx]) img.src = urls[idx];
    img.alt = `Page ${idx + 1}`;
  }

  function shiftFor(s) {
    bookEl.classList.remove("shift-left", "shift-right");
    if (mode !== "spread") return;
    // A lone cover / back page slides to the middle, like a closed book.
    if (s.first == null) bookEl.classList.add(rtl ? "shift-right" : "shift-left");
    else if (s.second == null) bookEl.classList.add(rtl ? "shift-left" : "shift-right");
  }

  function render() {
    const s = spreads[si];
    if (mode === "spread") { setImg(farEl(), s.first); setImg(nearEl(), s.second); }
    else { setImg(rightEl, s.second); }
    shiftFor(s);
    updateUi();
    preload();
    storage((st) => st.setItem(posKey, String(currentPage())));
  }

  function updateUi() {
    const s = spreads[si], n = urls.length;
    scrub.value = String(si);
    const shown = [s.first, s.second].filter((x) => x != null).map((x) => x + 1);
    countEl.textContent = currentPage() === 0 && shown.length === 1 && shown[0] === 1 ? `Cover · ${n} pages`
      : shown.length === 2 ? `${shown[0]}–${shown[1]} of ${n}` : `${shown[0]} of ${n}`;
    // Arrows are visual: in right-to-left books the "next" arrow is on the left.
    $("arrow-left").disabled = rtl ? false : si === 0;
    $("arrow-right").disabled = rtl ? si === 0 : false;
  }

  function preload() {
    for (let d = -1; d <= 2; d++) {
      const s = spreads[si + d];
      if (!s) continue;
      [s.first, s.second].forEach((i) => { if (i != null) new Image().src = urls[i]; });
    }
  }

  // ------------------------------------------------------------------ turning pages
  function finishAnim() {
    if (anim) { anim.finish(); }
  }

  function go(dir) {
    if (!spreads.length) return;
    finishAnim();
    const target = si + dir;
    if (target >= spreads.length) return showEnd();
    if (target < 0) return;
    if (reduceMotion) { si = target; return render(); }
    mode === "spread" ? flipSpread(dir) : flipSingle(dir);
  }

  function leafSetup(onLeft, full) {
    leaf.style.left = full || onLeft ? "0" : "50%";
    leaf.style.width = full ? "100%" : "50%";
    leaf.style.transformOrigin = onLeft ? "right center" : "left center";
    leaf.classList.add("on");
  }

  function faceImg(face, idx) {
    const img = face.querySelector("img");
    if (idx == null) { img.removeAttribute("src"); face.style.visibility = "hidden"; return; }
    face.style.visibility = "";
    img.src = urls[idx];
  }

  function flipSpread(dir) {
    const cur = spreads[si], nxt = spreads[si + dir];
    // Going forward the leaf lifts from the "near" side, going back from the "far" side.
    const leafEl = dir > 0 ? nearEl() : farEl();
    const onLeft = leafEl === leftEl;
    faceImg(frontFace, dir > 0 ? cur.second : cur.first);
    faceImg(backFace, dir > 0 ? nxt.first : nxt.second);
    // Reveal what lies underneath the turning leaf.
    if (dir > 0) setImg(nearEl(), nxt.second); else setImg(farEl(), nxt.first);
    leafSetup(onLeft, false);
    shiftFor(nxt);
    const end = onLeft ? 180 : -180;
    run([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${end}deg)` }], 900, () => { si += dir; render(); });
  }

  function flipSingle(dir) {
    // One page at a time: the current page lifts away (or the previous one settles back).
    const onLeft = rtl; // hinge on the reading edge
    const angle = rtl ? 105 : -105;
    backFace.style.visibility = "hidden";
    leafSetup(onLeft, true);
    leaf.style.transformOrigin = rtl ? "right center" : "left center";
    if (dir > 0) {
      faceImg(frontFace, spreads[si].second);
      setImg(rightEl, spreads[si + 1].second);
      run([{ transform: "rotateY(0deg)", opacity: 1 }, { transform: `rotateY(${angle}deg)`, opacity: 0 }], 650, () => { si += 1; render(); });
    } else {
      faceImg(frontFace, spreads[si - 1].second);
      run([{ transform: `rotateY(${angle}deg)`, opacity: 0 }, { transform: "rotateY(0deg)", opacity: 1 }], 650, () => { si -= 1; render(); });
    }
    backFace.style.visibility = "hidden";
  }

  function run(frames, duration, done) {
    const easing = "cubic-bezier(.45,.05,.25,1)";
    anim = leaf.animate(frames, { duration, easing });
    const shades = [frontFace.querySelector(".shade"), backFace.querySelector(".shade")];
    const shadeAnims = [
      shades[0].animate([{ opacity: 0 }, { opacity: 0.28 }], { duration, easing }),
      shades[1].animate([{ opacity: 0.28 }, { opacity: 0 }], { duration, easing }),
    ];
    const current = anim;
    current.onfinish = () => {
      shadeAnims.forEach((a) => a.cancel());
      if (anim !== current) return;
      anim = null;
      done();
      leaf.classList.remove("on");
    };
    updateUi();
  }

  // ------------------------------------------------------------------ comments drawer
  function setupComments(bookId) {
    window.siteReady.then((site) => {
      if (!site.commentsUrl) return;
      $("comments-btn").hidden = false;
      $("end-comment-btn").hidden = false;
      let mounted = false;
      const open = () => {
        if (!mounted) { window.mountComments($("comments"), "book:" + bookId, site.commentsUrl); mounted = true; }
        endCard.hidden = true;
        $("drawer").hidden = false;
        $("drawer").querySelector("textarea")?.focus();
      };
      $("comments-btn").addEventListener("click", () => ($("drawer").hidden ? open() : ($("drawer").hidden = true)));
      $("end-comment-btn").addEventListener("click", open);
      $("drawer-close").addEventListener("click", () => ($("drawer").hidden = true));
    });
  }

  // ------------------------------------------------------------------ end of book
  function showEnd() {
    $("end-sub").textContent = `Thank you for reading “${book.title}”.`;
    endCard.hidden = false;
    $("again-btn").focus();
  }
  $("again-btn").addEventListener("click", () => { endCard.hidden = true; finishAnim(); si = 0; render(); });
  endCard.addEventListener("click", (e) => { if (e.target === endCard) endCard.hidden = true; });

  // ------------------------------------------------------------------ input
  // "Right" / "left" are what the reader sees; RTL books swap their meaning.
  const pressRight = () => go(rtl ? -1 : 1);
  const pressLeft = () => go(rtl ? 1 : -1);

  $("arrow-right").addEventListener("click", pressRight);
  $("arrow-left").addEventListener("click", pressLeft);

  document.addEventListener("keydown", (e) => {
    if (e.target === scrub || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea, .drawer")) return;
    if (!endCard.hidden && e.key === "Escape") { endCard.hidden = true; return; }
    switch (e.key) {
      case "ArrowRight": pressRight(); break;
      case "ArrowLeft": pressLeft(); break;
      case " ": case "PageDown": go(e.shiftKey ? -1 : 1); break;
      case "PageUp": go(-1); break;
      case "Home": finishAnim(); si = 0; render(); break;
      case "End": finishAnim(); si = spreads.length - 1; render(); break;
      case "f": case "F": toggleFullscreen(); break;
      default: return;
    }
    e.preventDefault();
  });

  // Tap the left or right half of the book; swipe on touch screens.
  let down = null;
  bookEl.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  bookEl.addEventListener("pointerup", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? pressRight() : pressLeft();
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const box = bookEl.getBoundingClientRect();
      e.clientX > box.left + box.width / 2 ? pressRight() : pressLeft();
    }
  });

  scrub.addEventListener("input", () => { finishAnim(); si = Number(scrub.value); render(); });

  $("view-btn").addEventListener("click", () => {
    const page = currentPage();
    storage((s) => s.setItem(viewKey, mode === "spread" ? "single" : "spread"));
    layout(page);
  });

  const fsTarget = document.documentElement;
  const canFs = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
  if (!canFs) $("fs-btn").hidden = true;
  function toggleFullscreen() {
    if (!canFs) return;
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget);
  }
  $("fs-btn").addEventListener("click", toggleFullscreen);
})();
