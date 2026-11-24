// Turns journal text into HTML. Supported writing:
//   blank line          -> new paragraph
//   # Heading           -> heading
//   > quote             -> quote
//   **bold**  *italic*
//   ![caption](i-xxxx.jpg) on its own line -> picture (inserted by the studio)
window.renderMarkup = function (body, imageBase) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  const blocks = String(body || "").replace(/\r/g, "").split(/\n\s*\n/);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const img = line.trim().match(/^!\[([^\]]*)\]\((i-[a-f0-9]{16}\.(?:png|jpg|gif|webp))\)$/);
      if (img) {
        flush();
        out.push(`<figure><img src="${imageBase}/${img[2]}" alt="${esc(img[1])}" loading="lazy">${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ""}</figure>`);
      } else if (/^#{1,3}\s/.test(line)) {
        flush();
        out.push(`<h2>${inline(line.replace(/^#{1,3}\s+/, ""))}</h2>`);
      } else if (/^>\s?/.test(line)) {
        flush();
        out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      } else if (line.trim()) {
        para.push(line);
      }
    }
    flush();
    return out.join("\n");
  }).join("\n");
};
