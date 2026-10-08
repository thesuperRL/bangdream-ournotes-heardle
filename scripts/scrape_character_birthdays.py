"""Add each character's birthday to characters.json from the BanG Dream! Wiki.

Birthdays are not a guessable column: they only drive the confetti the game
throws when you solve a character during their birthday week. They are stored
as "MM-DD" so the page can compare them without parsing month names or caring
about the year.

The Mugendai MewType members have two pages each, the VTuber one and the
in-universe "(Character)" one. Only the latter carries the school details the
rest of the game uses, so it is the one read here too.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import CHARACTERS_JSON

API = "https://bandori.miraheze.org/w/api.php"
HEADERS = {"User-Agent": "bandori-ournotes-wordle/1.0 (birthday scrape; github.com/thesuperRL)"}

# Character id -> wiki page title. Keyed by id because several names differ
# between the page title and the name the game shows.
PAGES = {
    "tomori": "Takamatsu Tomori", "anon": "Chihaya Anon", "raana": "Kaname Raana",
    "soyo": "Nagasaki Soyo", "taki": "Shiina Taki",
    "uika": "Misumi Uika", "mutsumi": "Wakaba Mutsumi", "umiri": "Yahata Umiri",
    "nyamu": "Yuutenji Nyamu", "sakiko": "Togawa Sakiko",
    "arale": "Nakamachi Arale (Character)", "nonoka": "Miyanaga Nonoka (Character)",
    "ritsu": "Minetsuki Ritsu (Character)", "miyako": "Fuji Miyako (Character)",
    "yuno": "Sengoku Yuno (Character)",
    "hotaru": "Shiomi Hotaru", "natsume": "Izawa Natsume", "nagi": "Kotohira Nagi",
    "mahoro": "Hamasaki Mahoro", "houka": "Izumi Houka",
    "raika": "Suga Raika", "miku": "Mahashi Miku", "yomogi": "Yakura Yomogi",
    "chieri": "Umezato Chieri", "shizuku": "Shinomiya Shizuku",
}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def fetch_wikitext(titles):
    """Map page titles to their raw wikitext."""
    query = urllib.parse.urlencode({
        "action": "query",
        "titles": "|".join(titles),
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "format": "json",
    })
    request = urllib.request.Request(f"{API}?{query}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)

    result = payload.get("query", {})
    canonical = {n["to"]: n["from"] for n in result.get("normalized", [])}
    pages = {}
    for page in result.get("pages", {}).values():
        title = canonical.get(page["title"], page["title"])
        revisions = page.get("revisions")
        pages[title] = revisions[0]["slots"]["main"]["*"] if revisions else None
    return pages


def parse_birthday(text):
    """Pull "MM-DD" out of an infobox. Two templates are in play: the character
    pages use `Birthday`, the VTuber-style MewType pages use `birth_date`."""
    if not text:
        return None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        key, _, value = stripped[1:].partition("=")
        if key.strip().lower().replace("_", " ") not in ("birthday", "birth date"):
            continue
        # Values trail into references and templates: "July 16<ref>...".
        words = value.replace("<", " <").replace("[", " [").split()
        if len(words) < 2:
            continue
        month = MONTHS.get(words[0].strip().lower())
        day = "".join(c for c in words[1] if c.isdigit())
        if month and day:
            return f"{month:02d}-{int(day):02d}"
    return None


def main():
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        characters = json.load(f)

    pages = fetch_wikitext(list(PAGES.values()))

    missing = []
    for character in characters:
        title = PAGES.get(character["id"])
        birthday = parse_birthday(pages.get(title)) if title else None
        if birthday:
            character["birthday"] = birthday
            print(f"  {character['id']:9} {birthday}  ({title})")
        else:
            # Left out rather than set to a placeholder: the page treats a
            # missing birthday as "never a birthday week", which is correct.
            character.pop("birthday", None)
            missing.append(character["id"])

    with open(CHARACTERS_JSON, "w", encoding="utf-8") as f:
        json.dump(characters, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"\nWrote {CHARACTERS_JSON}: "
          f"{len(characters) - len(missing)}/{len(characters)} birthdays.")
    if missing:
        print(f"No birthday found for: {', '.join(missing)}")


if __name__ == "__main__":
    main()
