import os

# Repo layout: each game owns a folder at the root and holds only its markup,
# styles and scripts. Every dataset the games read lives under data/, shared
# rather than copied, so a second game can use the same songs or characters
# without a second copy drifting out of date.
#
# The one rule datasets follow: any path stored inside one ("audio/...",
# "characters/icons/...") is relative to DATA_DIR, never to a game folder or
# to the site root. That is what lets both games read the same file.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

SONGS_JSON = os.path.join(DATA_DIR, "songs", "songs.json")
ORDER_JSON = os.path.join(DATA_DIR, "songs", "order.json")
# Tracks the wiki track list does not carry (in-game "Others" category, etc.).
MANUAL_JSON = os.path.join(DATA_DIR, "songs", "manual.json")

CHARACTERS_JSON = os.path.join(DATA_DIR, "characters", "characters.json")
CHARACTER_ORDER_JSON = os.path.join(DATA_DIR, "characters", "order.json")
ICON_DIR = os.path.join(DATA_DIR, "characters", "icons")
LOGO_DIR = os.path.join(DATA_DIR, "characters", "logos")


def data_path(relative):
    """Disk location of a file a dataset points at, such as a song clip or a
    character icon."""
    return os.path.join(DATA_DIR, relative)


def clip_path(song):
    """Disk location of a song's clip."""
    return data_path(song["file"])
