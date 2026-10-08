import os
import re
import subprocess
import sys
import time
import unicodedata
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import SONGS_JSON, clip_path

CLIP_SECONDS = 24
# Uploads open on a logo sting or silence, so the clip starts a second in.
SKIP_SECONDS = 1


def _depunct(title):
    """YouTube search returns nothing for titles carrying decorative
    punctuation (✞animaるパーティ✞開催中✞, "Chu, Tayousei."), so symbols
    become spaces in the fallback queries."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", title)).strip()


def search_queries(song):
    """Queries to try, best first. The native (Japanese) title is what YouTube
    actually tags these uploads with; the romanization is the fallback. Game
    exclusives only surface under the "Our Notes" suffix. Manual entries whose
    performer is the catch-all "Other" carry their own `search` string."""
    if song.get("search"):
        return [song["search"]]
    titles = song.get("titles") or {}
    ja = titles.get("ja") or song["title"]
    en = titles.get("en") or song["title"]
    performer = song["performer"]
    queries = [
        f"{ja} {performer}",
        f"{en} {performer}",
        # "MyGO!!!!!" and friends make YouTube search return nothing at all.
        f"{_depunct(ja)} {_depunct(performer)}",
        f"{_depunct(en)} {_depunct(performer)} Our Notes",
        # Covers that only exist inside the game: chart captures carry tap SFX
        # over the music, which is why this is the last resort.
        f"{_depunct(en)} Our Notes EXPERT",
    ]
    return list(dict.fromkeys(queries))


def _norm(s):
    """Comparison form: width/case folded, punctuation and spacing dropped."""
    return re.sub(r"[^\w]", "", unicodedata.normalize("NFKC", s)).lower()


def _title_matches(song, video_title):
    """`ytsearch1` happily returns an unrelated video when the title is a common
    word (searching 'UNDEAD Mugendai MewType' returns 夢我夢中), so a hit only
    counts if the video title carries the song title."""
    if song.get("search"):
        return True
    titles = song.get("titles") or {}
    wanted = {t for t in (titles.get("ja"), titles.get("en"), song["title"]) if t}
    haystack = _norm(video_title)
    return any(_norm(t) in haystack for t in wanted)


def _fetch(song, query, tmp):
    """Download the first YouTube search hit's audio as mp3 into tmp and return
    (path, credit). YouTube throttles bursts, so one retry: ~15% of back-to-back
    requests came back empty in bulk runs and succeeded immediately on a retry."""
    for attempt in range(2):
        result = subprocess.run(
            [
                "yt-dlp", "--no-playlist", "--no-warnings",
                "-x", "--audio-format", "mp3",
                "--download-sections", f"*0-{SKIP_SECONDS + CLIP_SECONDS + 5}",
                "--no-simulate", "--print", "%(title)s\t%(webpage_url)s\t%(channel)s",
                "-o", os.path.join(tmp, "%(id)s.%(ext)s"),
                f"ytsearch1:{query}",
            ],
            capture_output=True, text=True
        )
        mp3_files = [f for f in os.listdir(tmp) if f.endswith(".mp3")]
        if mp3_files:
            video_title, url, channel = result.stdout.strip().splitlines()[0].split("\t")
            if not _title_matches(song, video_title):
                print(f"  rejected (wrong song): {video_title}")
                return None, None
            print(f"  matched: {video_title}")
            credit = {"video": video_title, "url": url, "channel": channel}
            return os.path.join(tmp, mp3_files[0]), credit
        if attempt == 0:
            time.sleep(5)
    return None, None


def download_and_trim(song):
    """Download song audio and trim to CLIP_SECONDS. Returns True on success."""
    out_path = clip_path(song)
    if os.path.exists(out_path):
        print(f"  skip (exists): {out_path}")
        return True

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    for query in search_queries(song):
        print(f"Downloading: {query}")
        with tempfile.TemporaryDirectory() as tmp:
            src, credit = _fetch(song, query, tmp)
            if not src:
                continue
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-ss", str(SKIP_SECONDS), "-i", src,
                     "-t", str(CLIP_SECONDS), "-acodec", "copy", out_path],
                    check=True, capture_output=True
                )
            except subprocess.CalledProcessError as e:
                print(f"  FAILED (ffmpeg): {e.stderr.decode()[-300:]}")
                return False
        song["credit"] = credit
        print(f"  OK: {out_path}")
        return True

    print(f"  FAILED: no YouTube result for {song['title']}")
    return False


if __name__ == "__main__":
    # Bootstrap: download every song in songs.json that has no file yet,
    # writing back the source attribution the credits page renders.
    import json
    with open(SONGS_JSON, encoding="utf-8") as f:
        songs = json.load(f)
    failed = [s["title"] for s in songs if not download_and_trim(s)]
    with open(SONGS_JSON, "w", encoding="utf-8") as f:
        json.dump(songs, f, indent=4, ensure_ascii=False)
        f.write("\n")
    if failed:
        print("\nFailed:")
        for t in failed:
            print(f"  {t}")
