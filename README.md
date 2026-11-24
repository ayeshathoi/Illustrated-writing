# Thoithoi’s Tales ✨

Illustrated storybooks, comics, visual stories and a journal by Ayesha Binte Mostofa.

Live site: https://ayeshathoi.github.io/Illustrated-writing/

## What's on the site

- **Stories:** storybooks and comics that readers turn page by page with 3D page turns, plus scrolling *visual stories* made of pictures with words.
- **Journal:** notes and sketches. Each entry can be public (shown on the site) or private (kept only on your computer).
- **Comments:** readers can leave anonymous comments on stories and journal entries (once set up, see below).
- **Music:** every book has a ♫ button. By default it plays a gentle music-box tune composed in the browser just for that book; you can upload your own music instead, or switch it off.
- **Backgrounds:** a random dreamy painting on each visit, from the collection you manage in the studio.

## The studio (on your computer)

You need Python 3.10 or newer. Nothing else to install.

```bash
python3 server.py
```

Open http://localhost:8000/admin and sign in. To change the password, run `python3 server.py --set-password`.

- **Books & stories:** create a Storybook, Comic or Visual story, drop in pictures or a PDF, and drag pages into order.
  - **✍ Make a page with text** writes your words onto a picture (choose lettering, color, size and position).
  - In a Visual story, type the words for each scene next to its picture.
  - Set the music, then switch **Published** on.
- **Journal:** write entries with pictures, headings, quotes, **bold** and *italic*. The 🔒/🌿 switch makes an entry private or public. Entries save automatically.
- **Site settings:** site name, tagline, your name, the About text, background pictures and the comments link.

## Putting it online

Everything is saved as plain files. To publish:

```bash
git add -A
git commit -m "New story"
git push
```

Your site updates about a minute later.

Draft books are hidden from the shelf, but their files are still pushed to GitHub. Private journal entries are never pushed: they live in `private/`, which is git-ignored. Back that folder up yourself.

## Setting up anonymous comments (once, about 5 minutes)

Comments are stored in a Google Sheet that only you control. Full steps are in `comments/google-apps-script.js` and in the studio under **Site settings → Comments**. In short:

1. Create a Google Sheet, then choose **Extensions → Apps Script** and paste in `comments/google-apps-script.js`.
2. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access: Anyone*.
3. Paste the web app link into the studio, save, then commit and push.

To remove a comment, delete its row in the sheet, or type anything in its *hidden* column.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Home: stories, latest journal entries, About |
| `read.html` | Page-turning reader for storybooks and comics |
| `story.html` | Scrolling reader for visual stories |
| `journal.html` | Journal list and entries |
| `admin.html` | The studio (needs `server.py` running) |
| `assets/` | Styles and scripts |
| `books/` | Books, background pictures, `index.json` (published list) and `site.json` (site settings) |
| `journal/` | Public journal entries |
| `private/` | Private journal entries (git-ignored, never online) |
| `comments/` | The Google Apps Script for comments |
| `server.py` | Local studio server, never needed online |
| `.admin/` | Your password settings (git-ignored) |

## Background art credits

These are public-domain paintings from Wikimedia Commons:

- Vincent van Gogh, *Almond Blossom* (1890)
- Claude Monet, *Water Lilies*
- Gustav Klimt, *Birch Forest* (1903)
- Gustav Klimt, *Rosebushes under the Trees* (c. 1905)
- Gustav Klimt, *Poppy Field / Blühender Mohn* (1907)
