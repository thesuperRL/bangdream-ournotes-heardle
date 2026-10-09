"""Build the support card dataset for the memory cardoku from bdon.moe.

bdon (Moenotes) has no public JSON API for support cards, so this reads the
rendered pages. Each field below is pinned to a marker that is part of the
page's meaning rather than its styling - an asset filename, an icon's alt
text, the heading of the skill block - so a Tailwind class churn does not
silently empty a column. Anything that cannot be found raises instead of
being dropped, because a card missing its band or rarity would still look
like a valid grid answer to the game.

Run: python scripts/fetch_support_cards.py
Writes: data/support-cards/support_cards.json
        data/support-cards/thumbnails/<id>.webp
"""

import json
import os
import re
import sys
import time
import urllib.request
from html import unescape
from io import BytesIO

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import SUPPORT_CARDS_JSON, SUPPORT_CARD_THUMB_DIR

BDON_BASE = "https://bdon.moe"
ASSET_BASE = "https://assets.bdon.moe"
HEADERS = {"User-Agent": "bangdream-ournotes-heardle/1.0 (support card scraper; github.com/thesuperRL)"}

# Official band colours, same values the member card dataset carries.
BAND_COLORS = {
    "MyGO!!!!!": "#3388BB",
    "Ave Mujica": "#881144",
    "Mugendai MewType": "#FF7788",
    "millsage": "#AA22EE",
    "Ikka Dumb Rock!": "#FFAA33",
}

# The rarity codes bdon files its icons under, spelled out so a clue reads as
# words instead of initials. EX is the limit-break rarity; bdon labels its
# icon "Special", which is the wording used here.
RARITY_NAMES = {"R": "Rare", "SR": "Super Rare", "SSR": "Super Super Rare", "EX": "Special"}

# The live skill headings bdon prints, shortened to chip-sized labels. The
# heading is the authority rather than the skill icon beside it: card 68 is
# drawn with the score-up icon while its skill is LIVE Skill Duration Up.
SKILL_LABELS = {
    "LIVE Skill Duration Up": "Duration Up",
    "LIFE Recovery": "Life Recovery",
    "HIT Support": "Hit Support",
}

# Card art is 512x288; the grid shows it a fifth of that wide. Stored at 384
# so a retina cell still has pixels to spare, which is 24 KB a card against
# the 235 KB bdon serves.
THUMB_WIDTH = 384
THUMB_HEIGHT = 216

RATE_LIMIT_SECS = 0.3


def fetch_html(path):
    request = urllib.request.Request(BDON_BASE + path, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode()


def card_ids_from_list():
    html = fetch_html("/en/support-cards/")
    ids = {int(found) for found in re.findall(r'href="/en/support-cards/(\d+)"', html)}
    if not ids:
        raise SystemExit("The support card list page linked no cards")
    return sorted(ids)


def need(pattern, html, card_id, what):
    match = re.search(pattern, html)
    if match is None:
        raise SystemExit(f"Support card {card_id}: no {what} on the page")
    # Page text is HTML-escaped: titles carry &#x27; where they mean an
    # apostrophe, and the dataset is read by JS that would print it raw.
    return unescape(match.group(1)).strip()


def parse_card(card_id, html):
    title = need(r"<h2[^>]*>([^<]+)</h2>", html, card_id, "title")

    # The Characters row lists one face icon per featured member, and the icon
    # carries the English name in its title attribute.
    characters = [unescape(name) for name in re.findall(
        r'<img[^>]+character_face_icon/character_face_icon\.webp[^>]+title="([^"]+)"',
        html,
    )]
    if not characters:
        raise SystemExit(f"Support card {card_id}: no character face icons on the page")

    rarity = need(r"SP_CardRarityIcon_(\w+)\.png", html, card_id, "rarity icon")
    if rarity not in RARITY_NAMES:
        raise SystemExit(f"Support card {card_id}: unknown rarity {rarity}")

    attribute = need(r"CardType-(\w+)\.png", html, card_id, "attribute icon")

    # The band name is the span that follows the band logo in the page header.
    band = need(
        r"band_logo_white/band_logo_white\.webp[^>]*>\s*<span[^>]*>([^<]+)</span>",
        html,
        card_id,
        "band name",
    )
    if band not in BAND_COLORS:
        raise SystemExit(f"Support card {card_id}: unknown band {band}")

    # A card has a Live Support Skill and may also have a Gekiso Support Skill;
    # only the live one is a clue, so the block is found by its own heading.
    skill = need(
        r"Live Support Skill</p><h3[^>]*>([^<]+)</h3>",
        html,
        card_id,
        "live support skill",
    )
    # Band-matched cards suffix the heading with "(<band> Bonus)"; the bonus is
    # a band fact the band clue already covers, so the skill keeps its family.
    skill = re.sub(r"\s*\([^)]*Bonus\)\s*$", "", skill)
    if skill not in SKILL_LABELS:
        raise SystemExit(f"Support card {card_id}: unknown live skill {skill!r}")

    return {
        "id": card_id,
        "title": title,
        "characters": characters,
        "characterCount": len(characters),
        "band": band,
        "bandColor": BAND_COLORS[band],
        "rarity": rarity,
        "rarityName": RARITY_NAMES[rarity],
        "attribute": attribute,
        "liveSkill": SKILL_LABELS[skill],
        "thumbnail": f"support-cards/thumbnails/{card_id}.webp",
    }


def save_thumbnail(card_id, destination):
    """Download one card thumbnail and store it downscaled as WebP."""
    url = f"{ASSET_BASE}/en/zh-Hans/SupportCard/{card_id}/snap_thumbnail/snap_thumbnail.webp"
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    image = Image.open(BytesIO(raw)).convert("RGB")
    image = image.resize((THUMB_WIDTH, THUMB_HEIGHT), Image.LANCZOS)
    image.save(destination, "WEBP", quality=82, method=6)
    return os.path.getsize(destination)


def report(cards):
    """Print the spread of every clue axis, so a game that stops building
    grids can be traced to the data rather than the generator."""
    for field in ("band", "rarityName", "attribute", "characterCount", "liveSkill"):
        spread = {}
        for card in cards:
            spread[card[field]] = spread.get(card[field], 0) + 1
        print(f"  {field}: {dict(sorted(spread.items(), key=lambda kv: str(kv[0])))}")
    featured = {}
    for card in cards:
        for character in card["characters"]:
            featured[character] = featured.get(character, 0) + 1
    print(f"  featured characters: {len(featured)}, fewest cards on one: {min(featured.values())}")


def main():
    os.makedirs(SUPPORT_CARD_THUMB_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(SUPPORT_CARDS_JSON), exist_ok=True)

    ids = card_ids_from_list()
    print(f"{len(ids)} support cards listed")

    cards = []
    downloaded = 0
    for card_id in ids:
        cards.append(parse_card(card_id, fetch_html(f"/en/support-cards/{card_id}")))
        time.sleep(RATE_LIMIT_SECS)

        thumbnail = os.path.join(SUPPORT_CARD_THUMB_DIR, f"{card_id}.webp")
        if not os.path.exists(thumbnail):
            save_thumbnail(card_id, thumbnail)
            downloaded += 1
            time.sleep(RATE_LIMIT_SECS)

    with open(SUPPORT_CARDS_JSON, "w", encoding="utf-8") as handle:
        json.dump(cards, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    print(f"Wrote {len(cards)} cards to {SUPPORT_CARDS_JSON}")
    print(f"Thumbnails: {downloaded} downloaded, {len(ids) - downloaded} already present")
    missing = [card["id"] for card in cards
               if not os.path.exists(os.path.join(SUPPORT_CARD_THUMB_DIR, f"{card['id']}.webp"))]
    print(f"Missing thumbnails: {missing}" if missing else "All thumbnails present.")
    report(cards)


if __name__ == "__main__":
    main()
