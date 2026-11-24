# Thoithoi’s Tales ✨

Illustrated storybooks and comics by Ayesha Binte Mostofa. Readers open a book and turn the pages one by one, like a real book.

- **Library**: a Pinterest-style shelf of covers over a dreamy nature backdrop (your own photo, or a painted pastel meadow) with drifting petals, plus filters for storybooks and comics.
- **Reader**: 3D page turns, two-page spreads on big screens and single pages on phones. You can tap, swipe, or use the arrow keys, and there's a full-screen mode, a page slider and right-to-left (manga) reading. It also remembers where each reader stopped.
- **Studio** (`/admin`): runs on your computer. Create a book, drop in page images or a whole PDF, drag pages into order, and publish.

The public site is fully static, so it can be hosted free on **GitHub Pages**.

## Adding books

You need Python 3.10 or newer. Nothing else to install.

```bash
python3 server.py
```

1. Open http://localhost:8000/admin. On the first run the terminal prints an admin password. To pick your own, run `python3 server.py --set-password`.
2. Click **+ New book**, then drop your pages in: PNG, JPG, WebP, GIF, or a PDF (each PDF page becomes a book page). Images are added in file-name order, so name them `01.png`, `02.png`, and so on. The first page is the cover.
3. Drag pages to reorder them, then switch **Published** on.
4. Check it at http://localhost:8000.

## Putting it online

Everything you upload is saved as plain files in the `books/` folder. To publish:

```bash
git add -A
git commit -m "Add new story"
git push
```

**One-time GitHub Pages setup:** on GitHub, open the repo's **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. Your site will appear at `https://<username>.github.io/<repo>/`.

> The studio only works on your computer. The live site is read-only, so nobody else can change your books. Draft books are hidden from the library, but their files are still pushed to GitHub with everything else, so leave a book out of the repo until it's ready if it must stay private.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Library / home page |
| `read.html` | The book reader (`read.html?book=<id>`) |
| `admin.html` | The studio (needs `server.py` running) |
| `assets/` | Styles and scripts |
| `books/` | Your books: one folder per book, plus `index.json` (published list) and `site.json` (site name & tagline) |
| `server.py` | Local studio server, never needed online |
| `.admin/` | Your private password settings (git-ignored) |
