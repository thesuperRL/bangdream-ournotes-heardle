import re
import sys

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, "scripts")
from slugify import song_file

WIKI_URL = "https://bandori.miraheze.org/wiki/BanG_Dream!_Our_Notes/Track_List"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; bangdream-heardle-bot/1.0)"
}


def cell_titles(cell):
    """Return (romanized, native). Wiki title cells read
    "<native> (<link:romanization>)"; English-titled songs have only the link."""
    full = cell.get_text(strip=True)
    link = cell.find("a")
    roman = link.get_text(strip=True) if link else full
    suffix = f"({roman})"
    native = full[: -len(suffix)] if full.endswith(suffix) and full != suffix else full
    # Wiki has a stray trailing comma on at least one entry (真夜中遊園地,).
    return roman, native.strip(" ,")


def clean_source(text):
    """Cover source cells read "<artist> (<anime/media it came from>)".
    Keep only the artist so labels stay short."""
    return re.sub(r"\s*\([^()]*\)\s*$", "", text).strip()


def row_song(cells, type_):
    performer = cells[0].get_text(strip=True).lstrip("*").strip()
    roman, native = cell_titles(cells[1])
    song = {
        "title": roman,
        "titles": {"en": roman, "ja": native},
        "performer": performer,
        "type": type_,
        "source": clean_source(cells[2].get_text(strip=True)) if type_ == "Cover" else None,
    }
    song["file"] = song_file(song)
    return song


def pick_table(tables, keyword):
    for t in tables:
        heading = t.find_previous(["h2", "h3"])
        if heading and keyword.lower() in heading.get_text().lower():
            return t
    raise RuntimeError(f"No wikitable found under a '{keyword}' heading")


def scrape():
    r = requests.get(WIKI_URL, headers=HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    tables = soup.find_all("table", {"class": "wikitable"})
    if len(tables) < 2:
        raise RuntimeError(f"Expected at least 2 wikitables, found {len(tables)}")

    songs = []
    for table, type_, min_cells in (
        (pick_table(tables, "Original"), "Original", 2),
        (pick_table(tables, "Cover"), "Cover", 3),
    ):
        for row in table.find_all("tr")[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < min_cells:
                continue
            songs.append(row_song(cells, type_))
    return songs


if __name__ == "__main__":
    import json
    print(json.dumps(scrape(), indent=2, ensure_ascii=False))
