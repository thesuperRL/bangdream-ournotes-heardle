import json
import os
import subprocess
import sys

sys.path.insert(0, "scripts")
from scrape_wiki import scrape
from download_song import download_and_trim

SONGS_JSON = "songs/songs.json"
# Tracks the wiki track list does not carry (in-game "Others" category, etc.).
MANUAL_JSON = "songs/manual.json"

with open(SONGS_JSON, encoding="utf-8") as f:
    existing = json.load(f)

# A song is already known if its title/performer pair OR its audio path is
# taken: a wiki romanization edit changes the title, and songs/manual.json
# entries can reappear in the scrape under their real performer.
seen_keys = {(s["title"], s["performer"]) for s in existing}
seen_files = {s["file"] for s in existing}

catalog = scrape()
if os.path.exists(MANUAL_JSON):
    with open(MANUAL_JSON, encoding="utf-8") as f:
        catalog += json.load(f)

new_songs = []
for song in catalog:
    if (song["title"], song["performer"]) in seen_keys or song["file"] in seen_files:
        continue
    seen_keys.add((song["title"], song["performer"]))
    seen_files.add(song["file"])
    new_songs.append(song)

if not new_songs:
    print("No new songs found.")
    sys.exit(0)

print(f"Found {len(new_songs)} new song(s):")
failed = []
for song in new_songs:
    print(f"  {song['title']} - {song['performer']}")
    if download_and_trim(song):
        existing.append(song)
    else:
        failed.append(song["title"])

with open(SONGS_JSON, "w", encoding="utf-8") as f:
    json.dump(existing, f, indent=4, ensure_ascii=False)
    f.write("\n")

if failed:
    print(f"\nWARNING: {len(failed)} song(s) failed to download: {failed}")
    print("Add them manually. songs.json NOT updated for failed entries.")

subprocess.run([sys.executable, "scripts/generate_order.py"], check=True)
