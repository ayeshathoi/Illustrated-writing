#!/usr/bin/env python3
"""
Storybook & Comics - local publishing tool.

The public website (index.html, read.html, assets/, books/) is 100% static,
so it can be hosted for free on GitHub Pages. This small server is only for
YOU, on your own computer: it powers the /admin page where you upload books.

    python3 server.py                  # open http://localhost:8000/admin
    python3 server.py --set-password   # change the admin password

Workflow: upload/arrange pages in /admin  ->  git commit + push  ->  live site updates.

No dependencies - just Python 3.10+.
"""
import argparse
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
BOOKS = ROOT / "books"                       # public: committed to git
SITE_FILE = BOOKS / "site.json"              # public: site title & tagline
INDEX_FILE = BOOKS / "index.json"            # public: list of published books
PRIVATE = ROOT / ".admin"                    # private: git-ignored
CONFIG_FILE = PRIVATE / "config.json"
JOURNAL = ROOT / "journal"                   # public journal entries: committed to git
JOURNAL_INDEX = JOURNAL / "index.json"
PRIVATE_JOURNAL = ROOT / "private" / "journal"  # private entries: git-ignored, never online

MAX_UPLOAD = 80 * 1024 * 1024
MAX_JSON = 1024 * 1024
SESSION_SECONDS = 14 * 24 * 3600
COOKIE = "sb_session"
LOCK = threading.RLock()

BOOK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
PAGE_FILE = re.compile(r"^p-[a-f0-9]{16}\.(png|jpg|gif|webp)$")
BACKGROUND_FILE = re.compile(r"^background-[a-f0-9]{12}\.(png|jpg|gif|webp)$")
BOOK_TYPES = {"storybook", "comic", "visual"}
IMAGE_FILE = re.compile(r"^i-[a-f0-9]{16}\.(png|jpg|gif|webp)$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMAGE_REF = re.compile(r"!\[[^\]]*\]\((i-[a-f0-9]{16}\.(?:png|jpg|gif|webp))\)")
DIRECTIONS = {"ltr", "rtl"}

PUBLIC_PAGES = {"": "index.html", "index.html": "index.html", "read.html": "read.html",
                "story.html": "story.html", "journal.html": "journal.html",
                "admin": "admin.html", "admin.html": "admin.html"}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".wav": "audio/wav",
}
MUSIC_FILE = re.compile(r"^music-[a-f0-9]{12}\.(mp3|m4a|ogg|wav)$")
MUSIC_MODES = {"auto", "file", "off"}


# --------------------------------------------------------------------------- storage

def write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_json_file(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 240_000)
    return f"{salt}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    salt = stored.split("$", 1)[0]
    return hmac.compare_digest(hash_password(password, salt), stored)


def ensure_setup() -> dict:
    BOOKS.mkdir(exist_ok=True)
    PRIVATE.mkdir(exist_ok=True)
    if not SITE_FILE.exists():
        write_json(SITE_FILE, {"siteTitle": "Thoithoi’s Tales",
                               "tagline": "Illustrated storybooks & comics"})
    cfg = read_json_file(CONFIG_FILE, {})
    if "secret" not in cfg:
        cfg["secret"] = secrets.token_hex(32)
    if "passwordHash" not in cfg:
        password = os.environ.get("ADMIN_PASSWORD")
        if not password:
            password = secrets.token_urlsafe(9)
            print("\n  First run: an admin password was created for you.")
            print(f"  Admin password: {password}")
            print("  Change it any time with:  python3 server.py --set-password\n")
        cfg["passwordHash"] = hash_password(password)
    write_json(CONFIG_FILE, cfg)
    site = read_json_file(SITE_FILE, {})
    if "background" in site:  # older single-photo setting -> list of photos
        old = site.pop("background")
        site.setdefault("backgrounds", [])
        if old and old not in site["backgrounds"]:
            site["backgrounds"].insert(0, old)
        write_json(SITE_FILE, site)
    JOURNAL.mkdir(exist_ok=True)
    PRIVATE_JOURNAL.mkdir(parents=True, exist_ok=True)
    rebuild_index()
    rebuild_journal_index()
    return cfg


def book_dir(book_id: str) -> Path:
    if not BOOK_ID.match(book_id):
        raise ApiError(404, "Book not found")
    return BOOKS / book_id


def read_book(book_id: str) -> dict:
    book = read_json_file(book_dir(book_id) / "book.json", None)
    if book is None:
        raise ApiError(404, "Book not found")
    return book


def save_book(book: dict) -> None:
    book["updated"] = int(time.time())
    write_json(book_dir(book["id"]) / "book.json", book)
    rebuild_index()


def all_books() -> list[dict]:
    books = [b for b in (read_json_file(p, None) for p in BOOKS.glob("*/book.json")) if b]
    books.sort(key=lambda b: b.get("created", 0), reverse=True)
    return books


def rebuild_index() -> None:
    """books/index.json is what the public library page reads."""
    shelf = []
    for b in all_books():
        if b.get("published") and b.get("pages"):
            shelf.append({k: b.get(k) for k in
                          ("id", "title", "type", "author", "description", "direction", "created")}
                         | {"cover": b["pages"][0], "pageCount": len(b["pages"]),
                            "coverRatio": b.get("coverRatio")})
    write_json(INDEX_FILE, {"books": shelf})


# ---- journal

def entry_dir(entry_id: str, public: bool) -> Path:
    if not BOOK_ID.match(entry_id):
        raise ApiError(404, "Entry not found")
    return (JOURNAL if public else PRIVATE_JOURNAL) / entry_id


def find_entry(entry_id: str) -> tuple[dict, Path]:
    for public in (True, False):
        folder = entry_dir(entry_id, public)
        entry = read_json_file(folder / "entry.json", None)
        if entry:
            return entry, folder
    raise ApiError(404, "Entry not found")


def all_entries() -> list[dict]:
    entries = []
    for base in (JOURNAL, PRIVATE_JOURNAL):
        entries += [e for e in (read_json_file(p, None) for p in base.glob("*/entry.json")) if e]
    entries.sort(key=lambda e: (e.get("date", ""), e.get("created", 0)), reverse=True)
    return entries


def excerpt(body: str, limit: int = 220) -> str:
    text = IMAGE_REF.sub("", body)
    text = re.sub(r"[*#_>]", "", text)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def rebuild_journal_index() -> None:
    """journal/index.json is what the public Journal page reads (public entries only)."""
    items = []
    for e in all_entries():
        if e.get("public"):
            images = IMAGE_REF.findall(e.get("body", ""))
            items.append({"id": e["id"], "title": e["title"], "date": e["date"],
                          "excerpt": excerpt(e.get("body", "")), "cover": images[0] if images else None})
    write_json(JOURNAL_INDEX, {"entries": items})


def save_entry(entry: dict, folder: Path) -> None:
    entry["updated"] = int(time.time())
    write_json(folder / "entry.json", entry)
    # Remove pictures that are no longer used in the text.
    used = set(IMAGE_REF.findall(entry.get("body", "")))
    for f in folder.iterdir():
        if IMAGE_FILE.match(f.name) and f.name not in used:
            f.unlink(missing_ok=True)
    rebuild_journal_index()


def valid_date(value) -> str:
    return value if isinstance(value, str) and DATE.match(value) else time.strftime("%Y-%m-%d")


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].strip("-")
    return f"{slug or 'book'}-{secrets.token_hex(2)}"


def sniff_image(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def sniff_audio(data: bytes) -> str | None:
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "mp3"
    if data[4:8] == b"ftyp":
        return "m4a"
    if data[:4] == b"OggS":
        return "ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    return None


def clean_text(value, limit: int) -> str:
    if not isinstance(value, str):
        raise ApiError(400, "Expected text")
    return value.strip()[:limit]


# --------------------------------------------------------------------------- http

class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class Handler(BaseHTTPRequestHandler):
    server_version = "StoryShelf/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    @property
    def cfg(self) -> dict:
        return self.server.cfg  # type: ignore[attr-defined]

    def send_json(self, obj, status=200, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path):
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            with path.open("rb") as fh:
                shutil.copyfileobj(fh, self.wfile)

    def read_body(self, limit: int) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ApiError(400, "Empty request")
        if length > limit:
            raise ApiError(413, "That file is too large")
        return self.rfile.read(length)

    def read_json(self) -> dict:
        try:
            data = json.loads(self.read_body(MAX_JSON))
        except ValueError:
            raise ApiError(400, "Invalid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "Invalid JSON")
        return data

    # ---- auth
    def _sign(self, expires: str) -> str:
        key = (self.cfg["secret"] + self.cfg["passwordHash"]).encode()
        return hmac.new(key, expires.encode(), hashlib.sha256).hexdigest()

    def is_admin(self) -> bool:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except Exception:
            return False
        morsel = cookie.get(COOKIE)
        if not morsel or "." not in morsel.value:
            return False
        expires, sig = morsel.value.split(".", 1)
        if not expires.isdigit() or int(expires) < time.time():
            return False
        return hmac.compare_digest(self._sign(expires), sig)

    def require_admin(self):
        if not self.is_admin():
            raise ApiError(401, "Please sign in")
        if self.headers.get("X-Requested-With") != "storyshelf":  # CSRF guard
            raise ApiError(403, "Missing request header")

    def cookie_header(self, value: str, max_age: int) -> dict:
        return {"Set-Cookie": f"{COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict"}

    # ---- dispatch
    def do_HEAD(self): self.route("GET")
    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PATCH(self): self.route("PATCH")
    def do_DELETE(self): self.route("DELETE")

    def route(self, method: str):
        parts = [unquote(p) for p in urlparse(self.path).path.split("/") if p]
        is_api = parts[:1] == ["api"]
        try:
            if is_api:
                self.api(method, parts[1:])
            elif method == "GET":
                self.static(parts)
            else:
                raise ApiError(405, "Method not allowed")
        except ApiError as err:
            if is_api:
                self.send_json({"error": err.message}, err.status)
            else:
                self.send_error(err.status, err.message)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def static(self, parts: list[str]):
        """Serve only the public site files - never server.py or .admin/."""
        key = "/".join(parts)
        if key in PUBLIC_PAGES:
            return self.send_file(ROOT / PUBLIC_PAGES[key])
        if parts and (parts[0] in ("assets", "books", "journal") or (parts[0] == "private" and self.is_admin())):
            target = (ROOT / key).resolve()
            base = (ROOT / parts[0]).resolve()
            if base in target.parents and target.is_file() and target.suffix.lower() in CONTENT_TYPES:
                return self.send_file(target)
        if key == "favicon.ico":
            return self.send_file(ROOT / "assets" / "favicon.svg")
        raise ApiError(404, "Not found")

    def api(self, method: str, parts: list[str]):
        if parts == ["session"] and method == "GET":
            return self.send_json({"admin": self.is_admin()})

        if parts == ["login"] and method == "POST":
            data = self.read_json()
            time.sleep(0.4)
            if not check_password(str(data.get("password", "")), self.cfg["passwordHash"]):
                raise ApiError(401, "Wrong password")
            expires = str(int(time.time()) + SESSION_SECONDS)
            return self.send_json({"ok": True},
                                  headers=self.cookie_header(f"{expires}.{self._sign(expires)}", SESSION_SECONDS))

        if parts == ["logout"] and method == "POST":
            return self.send_json({"ok": True}, headers=self.cookie_header("", 0))

        # Everything below is admin-only.
        if method == "GET":
            if not self.is_admin():
                raise ApiError(401, "Please sign in")
        else:
            self.require_admin()

        if parts == ["site"] and method == "PATCH":
            data = self.read_json()
            with LOCK:
                site = read_json_file(SITE_FILE, {})
                if "siteTitle" in data:
                    site["siteTitle"] = clean_text(data["siteTitle"], 120) or "Thoithoi’s Tales"
                if "tagline" in data:
                    site["tagline"] = clean_text(data["tagline"], 240)
                if "owner" in data:
                    site["owner"] = clean_text(data["owner"], 120)
                if "about" in data:
                    site["about"] = clean_text(data["about"], 4000)
                if "commentsUrl" in data:
                    url = clean_text(data["commentsUrl"], 400)
                    if url and not re.match(r"^https://script\.google(usercontent)?\.com/", url):
                        raise ApiError(400, "That doesn't look like a Google Apps Script web app link")
                    site["commentsUrl"] = url
                write_json(SITE_FILE, site)
            return self.send_json(site)

        if parts == ["site", "backgrounds"] and method == "POST":
            data = self.read_body(MAX_UPLOAD)
            ext = sniff_image(data)
            if not ext:
                raise ApiError(415, "Backgrounds must be PNG, JPG, GIF or WebP images")
            with LOCK:
                site = read_json_file(SITE_FILE, {})
                name = f"background-{secrets.token_hex(6)}.{ext}"
                (BOOKS / name).write_bytes(data)
                site.setdefault("backgrounds", []).append(name)
                write_json(SITE_FILE, site)
            return self.send_json(site)

        if len(parts) == 3 and parts[:2] == ["site", "backgrounds"] and method == "DELETE":
            name = parts[2]
            with LOCK:
                site = read_json_file(SITE_FILE, {})
                if name not in site.get("backgrounds", []) or not BACKGROUND_FILE.match(name):
                    raise ApiError(404, "Background not found")
                site["backgrounds"].remove(name)
                (BOOKS / name).unlink(missing_ok=True)
                write_json(SITE_FILE, site)
            return self.send_json(site)

        if parts == ["books"] and method == "GET":
            return self.send_json({"books": all_books()})

        if parts == ["books"] and method == "POST":
            data = self.read_json()
            title = clean_text(data.get("title", ""), 200)
            if not title:
                raise ApiError(400, "Give your book a title")
            if data.get("type", "storybook") not in BOOK_TYPES:
                raise ApiError(400, "Unknown book type")
            with LOCK:
                book_id = slugify(title)
                while (BOOKS / book_id).exists():
                    book_id = slugify(title)
                (BOOKS / book_id).mkdir()
                book = {"id": book_id, "title": title, "type": data.get("type", "storybook"),
                        "author": clean_text(data.get("author", ""), 200),
                        "description": clean_text(data.get("description", ""), 4000),
                        "direction": "ltr", "published": False, "pages": [],
                        "coverRatio": None, "created": int(time.time())}
                save_book(book)
            return self.send_json(book, 201)

        if len(parts) >= 2 and parts[0] == "books":
            book_id, rest = parts[1], parts[2:]

            if not rest and method == "PATCH":
                data = self.read_json()
                with LOCK:
                    book = read_book(book_id)
                    for key, limit in (("title", 200), ("author", 200), ("description", 4000)):
                        if key in data:
                            book[key] = clean_text(data[key], limit)
                    if not book["title"]:
                        raise ApiError(400, "Give your book a title")
                    if "type" in data:
                        if data["type"] not in BOOK_TYPES:
                            raise ApiError(400, "Unknown book type")
                        book["type"] = data["type"]
                    if "direction" in data:
                        if data["direction"] not in DIRECTIONS:
                            raise ApiError(400, "Unknown reading direction")
                        book["direction"] = data["direction"]
                    if "published" in data:
                        book["published"] = bool(data["published"])
                    if "musicMode" in data:
                        if data["musicMode"] not in MUSIC_MODES:
                            raise ApiError(400, "Unknown music setting")
                        book["musicMode"] = data["musicMode"]
                    if "coverRatio" in data:
                        ratio = data["coverRatio"]
                        if not isinstance(ratio, (int, float)) or not 0.2 < ratio < 5:
                            raise ApiError(400, "Bad cover ratio")
                        book["coverRatio"] = round(float(ratio), 4)
                    if "captions" in data:
                        caps = data["captions"]
                        if not isinstance(caps, dict):
                            raise ApiError(400, "Bad captions")
                        book.setdefault("captions", {})
                        for key, text in caps.items():
                            if key in book["pages"]:
                                book["captions"][key] = clean_text(text, 5000)
                    if "pages" in data:
                        order = data["pages"]
                        if not isinstance(order, list) or sorted(order) != sorted(book["pages"]):
                            raise ApiError(409, "Page list is out of date - reload and try again")
                        book["pages"] = order
                    save_book(book)
                return self.send_json(book)

            if not rest and method == "DELETE":
                with LOCK:
                    read_book(book_id)
                    shutil.rmtree(book_dir(book_id))
                    rebuild_index()
                return self.send_json({"ok": True})

            if rest == ["pages"] and method == "POST":
                data = self.read_body(MAX_UPLOAD)
                ext = sniff_image(data)
                if not ext:
                    raise ApiError(415, "Pages must be PNG, JPG, GIF or WebP images")
                with LOCK:
                    book = read_book(book_id)
                    name = f"p-{secrets.token_hex(8)}.{ext}"
                    (book_dir(book_id) / name).write_bytes(data)
                    book["pages"].append(name)
                    save_book(book)
                return self.send_json(book, 201)

            if rest == ["music"] and method in ("POST", "DELETE"):
                data = self.read_body(MAX_UPLOAD) if method == "POST" else b""
                ext = sniff_audio(data) if data else None
                if method == "POST" and not ext:
                    raise ApiError(415, "Music must be an MP3, M4A, OGG or WAV file")
                with LOCK:
                    book = read_book(book_id)
                    old = book.pop("music", None)
                    if old and MUSIC_FILE.match(old):
                        (book_dir(book_id) / old).unlink(missing_ok=True)
                    if ext:
                        book["music"] = f"music-{secrets.token_hex(6)}.{ext}"
                        (book_dir(book_id) / book["music"]).write_bytes(data)
                        book["musicMode"] = "file"
                    elif book.get("musicMode") == "file":
                        book["musicMode"] = "auto"
                    save_book(book)
                return self.send_json(book)

            if len(rest) == 2 and rest[0] == "pages" and method == "DELETE":
                name = rest[1]
                with LOCK:
                    book = read_book(book_id)
                    if name not in book["pages"] or not PAGE_FILE.match(name):
                        raise ApiError(404, "Page not found")
                    book["pages"].remove(name)
                    book.get("captions", {}).pop(name, None)
                    (book_dir(book_id) / name).unlink(missing_ok=True)
                    save_book(book)
                return self.send_json(book)

        if parts == ["journal"] and method == "GET":
            return self.send_json({"entries": all_entries()})

        if parts == ["journal"] and method == "POST":
            data = self.read_json()
            title = clean_text(data.get("title", ""), 200) or "Untitled"
            public = bool(data.get("public", False))
            with LOCK:
                entry_id = slugify(title)
                while (JOURNAL / entry_id).exists() or (PRIVATE_JOURNAL / entry_id).exists():
                    entry_id = slugify(title)
                folder = entry_dir(entry_id, public)
                folder.mkdir(parents=True)
                entry = {"id": entry_id, "title": title, "date": valid_date(data.get("date")),
                         "body": clean_text(data.get("body", ""), 200_000), "public": public,
                         "created": int(time.time())}
                save_entry(entry, folder)
            return self.send_json(entry, 201)

        if len(parts) >= 2 and parts[0] == "journal":
            entry_id, rest = parts[1], parts[2:]
            if not rest and method == "PATCH":
                data = self.read_json()
                with LOCK:
                    entry, folder = find_entry(entry_id)
                    if "title" in data:
                        entry["title"] = clean_text(data["title"], 200) or "Untitled"
                    if "date" in data:
                        entry["date"] = valid_date(data["date"])
                    if "body" in data:
                        entry["body"] = clean_text(data["body"], 200_000)
                    if "public" in data and bool(data["public"]) != bool(entry.get("public")):
                        target = entry_dir(entry_id, bool(data["public"]))
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(folder), str(target))
                        folder, entry["public"] = target, bool(data["public"])
                    save_entry(entry, folder)
                return self.send_json(entry)
            if not rest and method == "DELETE":
                with LOCK:
                    _, folder = find_entry(entry_id)
                    shutil.rmtree(folder)
                    rebuild_journal_index()
                return self.send_json({"ok": True})
            if rest == ["images"] and method == "POST":
                data = self.read_body(MAX_UPLOAD)
                ext = sniff_image(data)
                if not ext:
                    raise ApiError(415, "Pictures must be PNG, JPG, GIF or WebP")
                with LOCK:
                    entry, folder = find_entry(entry_id)
                    name = f"i-{secrets.token_hex(8)}.{ext}"
                    (folder / name).write_bytes(data)
                base = "journal" if entry.get("public") else "private/journal"
                return self.send_json({"name": name, "url": f"{base}/{entry_id}/{name}"}, 201)

        raise ApiError(404, "Not found")


def main():
    parser = argparse.ArgumentParser(description="Storybook & comics - local publishing tool")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    parser.add_argument("--set-password", action="store_true", help="change the admin password")
    args = parser.parse_args()

    cfg = ensure_setup()
    if args.set_password:
        first = getpass.getpass("New admin password: ")
        if len(first) < 6:
            sys.exit("Use at least 6 characters.")
        if getpass.getpass("Type it again: ") != first:
            sys.exit("Passwords didn't match.")
        cfg["passwordHash"] = hash_password(first)
        write_json(CONFIG_FILE, cfg)
        print("Password updated.")
        return

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.cfg = cfg  # type: ignore[attr-defined]
    print(f"  Your site:   http://localhost:{args.port}")
    print(f"  Admin page:  http://localhost:{args.port}/admin")
    print("  Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
