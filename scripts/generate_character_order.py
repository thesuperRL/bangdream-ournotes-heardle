"""Create or extend the daily character order for the wordle.

Same contract as generate_order.py: order.json holds a start date and a
permutation of indices into characters.json, so day N serves order[N].
"""

import argparse
import datetime
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import CHARACTERS_JSON, CHARACTER_ORDER_JSON


def today():
    return datetime.datetime.now(datetime.timezone.utc).date()


def shuffled(characters):
    order = list(range(len(characters)))
    random.shuffle(order)
    return order


def main():
    parser = argparse.ArgumentParser(description="Create or extend the daily character order.")
    parser.add_argument("--rotate", action="store_true",
                        help="reshuffle from today once every character has had their day")
    args = parser.parse_args()

    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        characters = json.load(f)

    if not os.path.exists(CHARACTER_ORDER_JSON):
        schedule = {"start": today().isoformat(), "order": shuffled(characters)}
        print(f"Created new order for {len(characters)} characters.")
    else:
        with open(CHARACTER_ORDER_JSON, encoding="utf-8") as f:
            schedule = json.load(f)
        start = datetime.date.fromisoformat(schedule["start"])
        days_played = (today() - start).days

        if args.rotate and days_played >= len(schedule["order"]):
            schedule = {"start": today().isoformat(), "order": shuffled(characters)}
            print(f"Cycle finished after {days_played} day(s); reshuffled from today.")
        else:
            existing = set(schedule["order"])
            new_indices = [i for i in range(len(characters)) if i not in existing]
            random.shuffle(new_indices)
            schedule["order"].extend(new_indices)
            if args.rotate:
                print(f"Cycle not finished ({days_played}/{len(schedule['order'])} days).")
            print(f"Appended {len(new_indices)} new indices.")

    with open(CHARACTER_ORDER_JSON, "w", encoding="utf-8") as f:
        json.dump(schedule, f)
        f.write("\n")
    print(f"Wrote {CHARACTER_ORDER_JSON} (start {schedule['start']}, "
          f"{len(schedule['order'])} entries).")


if __name__ == "__main__":
    main()
