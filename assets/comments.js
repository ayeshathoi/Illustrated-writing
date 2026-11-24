// Anonymous comments, stored in the site owner's Google Sheet
// (see comments/google-apps-script.js and the README for the one-time setup).
window.mountComments = function (container, pageId, url) {
  if (!container) return;
  if (!url) { container.hidden = true; return; }
  container.hidden = false;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  container.innerHTML = `
    <h2 class="comments-title">Comments</h2>
    <form class="comment-form">
      <label class="visually-hidden" for="c-name-${pageId}">Name</label>
      <input class="input" id="c-name-${pageId}" name="name" maxlength="60" placeholder="Your name (optional)" autocomplete="nickname">
      <label class="visually-hidden" for="c-text-${pageId}">Comment</label>
      <textarea class="input" id="c-text-${pageId}" name="text" maxlength="2000" required placeholder="Share a kind thought about this story…"></textarea>
      <input name="website" tabindex="-1" autocomplete="off" class="visually-hidden" aria-hidden="true">
      <div class="comment-actions">
        <span class="muted small">No sign-in needed. Leave the name empty to post anonymously.</span>
        <button class="btn primary" type="submit">Post comment</button>
      </div>
      <p class="comment-status" role="status"></p>
    </form>
    <ol class="comment-list"><li class="muted">Loading comments…</li></ol>`;
  const list = container.querySelector(".comment-list");
  const form = container.querySelector(".comment-form");
  const status = container.querySelector(".comment-status");

  const item = (c) => `<li class="comment">
      <div class="comment-head"><span class="comment-avatar" aria-hidden="true">${esc((c.name || "A").trim()[0] || "A").toUpperCase()}</span>
      <strong>${esc(c.name || "Anonymous")}</strong><time>${c.time ? new Date(c.time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "just now"}</time></div>
      <p>${esc(c.text)}</p></li>`;

  function load() {
    fetch(`${url}?page=${encodeURIComponent(pageId)}`)
      .then((r) => r.json())
      .then((data) => {
        const all = (data.comments || []).slice().reverse();
        list.innerHTML = all.length ? all.map(item).join("") : `<li class="muted">No comments yet. Be the first to say something kind!</li>`;
      })
      .catch(() => { list.innerHTML = `<li class="muted">Comments couldn't be loaded right now.</li>`; });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = { page: pageId, name: String(fd.get("name") || "").trim(), text: String(fd.get("text") || "").trim(), website: fd.get("website") };
    if (!payload.text) return;
    const btn = form.querySelector("button");
    btn.disabled = true;
    status.textContent = "Posting…";
    // text/plain keeps this a "simple" request that Google Apps Script accepts.
    fetch(url, { method: "POST", body: JSON.stringify(payload) })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) throw new Error(res.error || "failed");
        form.reset();
        status.textContent = "Thank you! Your comment is posted.";
        if (list.querySelector(".muted")) list.innerHTML = "";
        list.insertAdjacentHTML("afterbegin", item({ name: payload.name, text: payload.text }));
      })
      .catch(() => { status.textContent = "Sorry, your comment couldn't be posted. Please try again."; })
      .finally(() => { btn.disabled = false; });
  });
  load();
};
