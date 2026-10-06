import argparse
import datetime
import json
import os
import random

SONGS_JSON = "songs/songs.json"
ORDER_JSON = "songs/order.json"


def today():
    return datetime.datetime.now(datetime.timezone.utc).date()


def shuffled(songs):
    order = list(range(len(songs)))
    random.shuffle(order)
    return order


def main():
    parser = argparse.ArgumentParser(description="Create or extend the daily song order.")
    parser.add_argument("--rotate", action="store_true",
                        help="reshuffle from today once every song has had its day")
    args = parser.parse_args()

    with open(SONGS_JSON, encoding="utf-8") as f:
        songs = json.load(f)

    if not os.path.exists(ORDER_JSON):
        schedule = {"start": today().isoformat(), "order": shuffled(songs)}
        print(f"Created new order for {len(songs)} songs.")
    else:
        with open(ORDER_JSON, encoding="utf-8") as f:
            schedule = json.load(f)
        start = datetime.date.fromisoformat(schedule["start"])
        days_played = (today() - start).days

        if args.rotate and days_played >= len(schedule["order"]):
            schedule = {"start": today().isoformat(), "order": shuffled(songs)}
            print(f"Cycle finished after {days_played} day(s); reshuffled from today.")
        else:
            existing = set(schedule["order"])
            new_indices = [i for i in range(len(songs)) if i not in existing]
            random.shuffle(new_indices)
            schedule["order"].extend(new_indices)
            if args.rotate:
                print(f"Cycle not finished ({days_played}/{len(schedule['order'])} days).")
            print(f"Appended {len(new_indices)} new indices.")

    with open(ORDER_JSON, "w", encoding="utf-8") as f:
        json.dump(schedule, f)
        f.write("\n")
    print(f"Wrote {ORDER_JSON} (start {schedule['start']}, {len(schedule['order'])} entries).")


if __name__ == "__main__":
    main()
