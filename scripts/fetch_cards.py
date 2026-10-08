"""Build the member card dataset for the cardoku from haneoka.org.

haneoka serves the card, character and band tables as id-keyed objects, each
localised string being an array ordered ja, en, zh-Hant, zh-Hans, ko.

Two things the cardoku needs are not in that API in a usable shape:

  * School and school year. haneoka has them, but the year is buried in a
    localised sentence ("First-Year Student, Class A (1-A)"). The wordle
    already stores both as clean fields, so each card is joined back to
    data/characters/characters.json and reuses them.
  * Instrument. haneoka's bandPart is a short composite string ("Gt.&Vo.",
    "DJ&Mp."). The wordle's positions list is already split and spelled out,
    so it is reused too, which lets a card match both Guitarist and Vocalist.

The join key is the English name with its words sorted, because the two
sources disagree on name order: haneoka says "Tomori Takamatsu", the wordle
says "Takamatsu Tomori".

Thumbnails are 384x512 PNGs of about 230KB. The grid draws them at roughly
130px wide, so they are downscaled to 240x320 WebP on the way in: the same
63 cards go from ~14MB to under 1MB of committed data.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from collections import Counter
from io import BytesIO

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import CARDS_JSON, CARD_THUMB_DIR, CHARACTERS_JSON

HANEOKA = "https://haneoka.org"
HEADERS = {"User-Agent": "bangdream-ournotes-cardoku/1.0 (card fetch; github.com/thesuperRL)"}

# Index of the English string inside haneoka's localised arrays.
EN = 1
JA = 0

# The birthday card is a one-off with no attribute of its own, so the game
# leaves it out and every rarity below is a real gacha rarity.
BIRTHDAY_RARITY = 20

# Verified against the card pages on haneoka.org, which label these as the
# alt text of the rarity and attribute icons (see member-cards/1).
RARITY_LABEL = {2: "R", 3: "SR", 4: "SSR"}
ATTRIBUTE_LABEL = {1: "Ruby", 2: "Azure", 3: "Jade", 4: "Amber", 5: "Violet"}

# Year codes as stored by the wordle -> the label the chips show.
YEAR_LABEL = {
    "HS1": "High 1",
    "HS2": "High 2",
    "HS3": "High 3",
    "JHS2": "Jr High 2",
    "JHS3": "Jr High 3",
    "Univ1": "Uni 1",
}

THUMB_WIDTH = 240
THUMB_HEIGHT = 320


def fetch(path):
    request = urllib.request.Request(HANEOKA + path, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def name_key(name):
    """An English name reduced to a form both sources agree on.

    Three disagreements have to be absorbed. Word order: haneoka writes
    "Tomori Takamatsu", the wordle writes "Takamatsu Tomori", so the words are
    sorted. Ave Mujica stage names: haneoka prefixes them,
    "Oblivionis / Sakiko Togawa", so only the part after the slash is kept.
    Long vowels: haneoka marks them with a macron ("Rāna", "Yūtenji") where the
    wordle doubles the letter ("Raana", "Yuutenji"), so once the accent is
    stripped a run of one letter collapses to a single one.
    """
    real_name = name.rsplit("/", 1)[-1]
    ascii_name = unicodedata.normalize("NFKD", real_name).encode("ascii", "ignore").decode()
    letters = re.sub(r"[^a-z ]", "", ascii_name.lower())
    return "".join(sorted(re.sub(r"(.)\1+", r"\1", letters).split()))


def save_thumbnail(card_id, destination):
    """Download one card thumbnail and store it downscaled as WebP."""
    url = f"{HANEOKA}/assets/intl/Assets/AddressableResources/MemberCard/{card_id}/member_thumbnail.png"
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    image = Image.open(BytesIO(raw)).convert("RGBA")
    image = image.resize((THUMB_WIDTH, THUMB_HEIGHT), Image.LANCZOS)
    image.save(destination, "WEBP", quality=82, method=6)
    return os.path.getsize(destination)


def build_cards():
    cards = fetch("/api/v1/cards")
    characters = fetch("/api/v1/characters")
    bands = fetch("/api/v1/bands")

    with open(CHARACTERS_JSON, encoding="utf-8") as handle:
        local_characters = json.load(handle)
    local_by_name = {name_key(c["names"]["en"]): c for c in local_characters}

    built = []
    unmatched = set()
    for card in cards.values():
        if card["rarity"] == BIRTHDAY_RARITY:
            continue

        character = characters[str(card["characterId"])]
        band = bands[str(character["bandId"])]
        english_name = character["characterName"][EN]

        local = local_by_name.get(name_key(english_name))
        if local is None:
            unmatched.add(english_name)
            continue

        built.append({
            "id": card["cardId"],
            "title": card["prefix"][EN],
            "titleJa": card["prefix"][JA],
            "character": local["names"]["en"],
            "characterJa": local["names"]["ja"],
            "stageName": local["stageName"],
            "band": band["bandName"][EN],
            "bandColor": band["color"],
            "positions": local["positions"],
            "rarity": card["rarity"],
            "rarityLabel": RARITY_LABEL.get(card["rarity"], str(card["rarity"])),
            "attribute": card["cardType"],
            "attributeLabel": ATTRIBUTE_LABEL.get(card["cardType"], str(card["cardType"])),
            "school": local["school"],
            "year": local["year"],
            "yearLabel": YEAR_LABEL.get(local["year"], local["year"]),
            "thumbnail": f"cards/thumbnails/{card['cardId']}.webp",
        })

    if unmatched:
        raise SystemExit(
            "No entry in characters.json for: " + ", ".join(sorted(unmatched))
        )

    built.sort(key=lambda card: card["id"])
    return built


def report(cards):
    """Print the distributions the puzzle generator depends on, so a game
    update that collapses one of them is visible rather than silent."""
    print(f"\n{len(cards)} cards")
    for field in ("band", "rarityLabel", "attributeLabel", "school", "yearLabel"):
        counts = Counter(card[field] for card in cards)
        print(f"  {field}: {dict(counts)}")
    print(f"  positions: {dict(Counter(p for c in cards for p in c['positions']))}")

    # Attribute is only worth using as a puzzle axis if it cuts across bands.
    print("\n  attribute per band:")
    for band in sorted({card["band"] for card in cards}):
        spread = Counter(c["attributeLabel"] for c in cards if c["band"] == band)
        print(f"    {band}: {dict(spread)}")


def main():
    cards = build_cards()
    report(cards)

    os.makedirs(os.path.dirname(CARDS_JSON), exist_ok=True)
    with open(CARDS_JSON, "w", encoding="utf-8") as handle:
        json.dump(cards, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"\nWrote {CARDS_JSON}")

    os.makedirs(CARD_THUMB_DIR, exist_ok=True)
    print(f"Thumbnails -> {CARD_THUMB_DIR}")
    missing = []
    for card in cards:
        destination = os.path.join(CARD_THUMB_DIR, f"{card['id']}.webp")
        if os.path.exists(destination):
            continue
        try:
            size = save_thumbnail(card["id"], destination)
            print(f"  {card['id']:3d}  {size // 1024:3d}KB  {card['title']}")
        except Exception as error:
            print(f"  {card['id']:3d}  failed: {error}")
            missing.append(card["id"])
        time.sleep(0.15)

    if missing:
        print(f"\n{len(missing)} thumbnails missing: {missing}")
    else:
        print("\nAll thumbnails present.")


if __name__ == "__main__":
    main()
