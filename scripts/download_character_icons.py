"""Download character icons and band logos for the wordle from the BanG Dream! Wiki.

The wiki stores a file's real URL under a content hash, so the filename alone is
not enough: every name is resolved through the MediaWiki API first.

Ave Mujica icons are filed under each member's stage name (Doloris, Mortis, ...),
but they are saved locally under the character id so the JSON stays uniform.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import ICON_DIR, LOGO_DIR

API = "https://bandori.miraheze.org/w/api.php"
# Miraheze serves a challenge page to clients without a real user agent.
HEADERS = {"User-Agent": "bandori-ournotes-wordle/1.0 (icon fetch; github.com/thesuperRL)"}

# Character id -> wiki file basename. Ave Mujica uses stage names.
ICONS = {
    "tomori": "Tomori", "anon": "Anon", "raana": "Raana", "soyo": "Soyo", "taki": "Taki",
    "uika": "Doloris", "mutsumi": "Mortis", "umiri": "Timoris",
    "nyamu": "Amoris", "sakiko": "Oblivionis",
    "arale": "Arale", "nonoka": "Nonoka", "ritsu": "Ritsu",
    "miyako": "Miyako", "yuno": "Yuno",
    "hotaru": "Hotaru", "natsume": "Natsume", "nagi": "Nagi",
    "mahoro": "Mahoro", "houka": "Houka",
    "raika": "Raika", "miku": "Miku", "yomogi": "Yomogi",
    "chieri": "Chieri", "shizuku": "Shizuku",
}

# Band slug (matches BAND_SLUGS in wordle/js/main.js) -> wiki file title.
LOGOS = {
    "mygo": "MyGO!!!!! logo.png",
    "avemujica": "Ave Mujica logo.png",
    "mewtype": "Mugendai MewType logo.png",
    "millsage": "Millsage logo.png",
    "ikka": "Ikka Dumb Rock! logo.png",
}


def resolve(titles):
    """Map wiki file titles to their direct URLs. Missing files are left out.

    The API normalises titles (underscores to spaces), so the response is keyed
    back to the request through the `normalized` table rather than by position.
    """
    query = urllib.parse.urlencode({
        "action": "query",
        "titles": "|".join(titles),
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    })
    request = urllib.request.Request(f"{API}?{query}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)

    result = payload.get("query", {})
    canonical = {n["to"]: n["from"] for n in result.get("normalized", [])}
    urls = {}
    for page in result.get("pages", {}).values():
        if "imageinfo" not in page:
            continue
        title = page["title"]
        urls[canonical.get(title, title)] = page["imageinfo"][0]["url"]
    return urls


def download(url, destination):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    with open(destination, "wb") as f:
        f.write(data)
    return len(data)


def fetch_group(wanted, directory, label):
    """wanted maps output stem -> wiki file title. Returns the number missing."""
    os.makedirs(directory, exist_ok=True)
    urls = resolve([f"File:{title}" for title in wanted.values()])

    missing = 0
    for stem, title in wanted.items():
        destination = os.path.join(directory, f"{stem}.png")
        url = urls.get(f"File:{title}")
        if not url:
            print(f"  MISSING {label}: {title} (no file on the wiki)")
            missing += 1
            continue
        if os.path.exists(destination):
            print(f"  have    {stem}.png")
            continue
        size = download(url, destination)
        print(f"  saved   {stem}.png ({size // 1024} KB)")
    return missing


def main():
    print(f"Icons -> {ICON_DIR}")
    missing = fetch_group({k: f"{v} (icon).png" for k, v in ICONS.items()}, ICON_DIR, "icon")
    print(f"Logos -> {LOGO_DIR}")
    missing += fetch_group(LOGOS, LOGO_DIR, "logo")

    if missing:
        # The page falls back to plain text for a missing logo, and to the
        # character's initial for a missing icon, so this is a warning not a stop.
        print(f"\n{missing} file(s) not on the wiki yet; re-run once they are uploaded.")
    else:
        print("\nAll icons and logos downloaded.")


if __name__ == "__main__":
    main()
