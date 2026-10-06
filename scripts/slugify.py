import hashlib
import re
import unicodedata

PERFORMER_SLUGS = {
    "MyGO!!!!!": "mygo",
    "Ave Mujica": "avemujica",
    "Mugendai MewType": "mewtype",
    "millsage": "millsage",
    "Ikka Dumb Rock!": "ikka",
    # In-game "Others" category: tracks by acts that aren't playable bands,
    # e.g. CRYCHiC's 春日影.
    "Other": "other",
}


def slugify(s):
    # Fold accents and drop non-ASCII (e.g. "Música" -> "musica", "✞" -> "")
    # so every generated path is URL- and filesystem-safe on GitHub Pages.
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = s.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    return s.strip("-")


def song_file(song):
    perf = PERFORMER_SLUGS.get(song["performer"], slugify(song["performer"]))
    # A title with no Latin characters (an unromanized wiki row) slugifies to
    # "", which would collapse every such song of a band onto one path.
    title = slugify(song["title"]) or hashlib.sha1(
        song["title"].encode("utf-8")).hexdigest()[:8]
    return f"audio/{perf}/{perf}-{title}.mp3"
