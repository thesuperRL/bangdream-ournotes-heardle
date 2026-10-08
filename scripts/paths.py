import os

# Repo layout: each game owns a folder at the root, and the scripts live beside
# them. Paths resolve from this file so the scripts work from any directory.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME_DIR = os.path.join(ROOT, "heardle")

SONGS_JSON = os.path.join(GAME_DIR, "songs", "songs.json")
ORDER_JSON = os.path.join(GAME_DIR, "songs", "order.json")
# Tracks the wiki track list does not carry (in-game "Others" category, etc.).
MANUAL_JSON = os.path.join(GAME_DIR, "songs", "manual.json")


def clip_path(song):
    """Disk location of a song's clip. songs.json stores the path the web page
    requests ("audio/..."), which is relative to the game folder."""
    return os.path.join(GAME_DIR, song["file"])
