#!/usr/bin/env python3
"""Download London wellness venues from OpenStreetMap for Hale London.

Run from the repository root:  python3 build/fetch_london_venues.py
Needs only Python 3 and an internet connection. London is split into 12 areas so each
request stays small; progress is saved, so if the servers are busy you can run it again
and it carries on where it stopped.

Writes build/data/london_osm.json.
Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
"""
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
os.makedirs(DATA, exist_ok=True)
PROGRESS = os.path.join(DATA, "london_osm_progress.json")
OUT = os.path.join(DATA, "london_osm.json")
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

S, W, N, E = 51.28, -0.52, 51.70, 0.34
ROWS, COLS = 3, 4
TILES = []
for r in range(ROWS):
    for c in range(COLS):
        s = S + (N - S) * r / ROWS; n = S + (N - S) * (r + 1) / ROWS
        w = W + (E - W) * c / COLS; e = W + (E - W) * (c + 1) / COLS
        TILES.append(f"{s:.4f},{w:.4f},{n:.4f},{e:.4f}")


def venue_query(b):
    return (f'nwr["healthcare"~"^(physiotherapist|psychotherapist|counselling|podiatrist|dietitian|nutrition_counselling|alternative)$"]({b});'
            f'nwr["leisure"~"^(fitness_centre|sauna|spa)$"]({b});'
            f'nwr["leisure"="sports_centre"]["sport"~"yoga|pilates|climbing|boxing|swimming|martial_arts|fitness|dance"]({b});'
            f'nwr["amenity"~"^(public_bath|spa|sauna)$"]({b});'
            f'nwr["shop"~"^(massage|health_food)$"]({b});'
            f'nwr["leisure"="swimming_pool"]["name"~"[Ll]ido|[Pp]onds?$|[Bb]aths"]({b});'
            f'nwr["amenity"~"^(cafe|restaurant|fast_food)$"]["diet:vegan"="only"]({b});'
            f'nwr["amenity"~"^(cafe|restaurant|fast_food)$"]["diet:vegetarian"="only"]({b});'
            f'nwr["amenity"~"^(cafe|restaurant|fast_food|bar)$"]["cuisine"~"juice|smoothie|salad|healthy|acai|poke|raw"]({b});'
            f'nwr["amenity"="bar"]["drink:alcohol"="no"]({b});'
            f'nwr["amenity"~"^(place_of_worship|community_centre)$"]["name"~"[Mm]editation|[Bb]uddhist [Cc]entre|[Kk]adampa"]({b});')


JOBS = [(f"venues area {i + 1}/{len(TILES)}", venue_query(t)) for i, t in enumerate(TILES)]
JOBS.append(("stations", f'nwr["railway"="station"]["name"]({S},{W},{N},{E});'))


def fetch(label, body):
    q = f"[out:json][timeout:90];({body});out center tags;"
    data = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(5):
        for url in SERVERS:
            host = url.split("/")[2]
            try:
                req = urllib.request.Request(url, data=data, headers={"User-Agent": "hale-london/1.0 (personal project)"})
                with urllib.request.urlopen(req, timeout=150) as r:
                    els = json.load(r).get("elements", [])
                print(f"  got {len(els)} from {host}", flush=True)
                return els
            except urllib.error.HTTPError as e:
                print(f"  {host}: {e.code} {e.reason}", flush=True)
            except Exception as e:
                print(f"  {host}: {e}", flush=True)
            time.sleep(4)
        wait = 20 * (attempt + 1)
        print(f"  all servers busy, waiting {wait}s...", flush=True)
        time.sleep(wait)
    return None


done = {}
if os.path.exists(PROGRESS):
    with open(PROGRESS, encoding="utf-8") as f:
        done = json.load(f)
    print(f"Resuming: {len(done)} of {len(JOBS)} parts already downloaded.")

for label, body in JOBS:
    if label in done:
        continue
    print(f"Downloading {label}...", flush=True)
    els = fetch(label, body)
    if els is None:
        sys.exit(f"\nStopped at {label}. Progress is saved: run the same command again later and it will carry on.")
    done[label] = els
    with open(PROGRESS, "w", encoding="utf-8") as f:
        json.dump(done, f, ensure_ascii=False)
    time.sleep(2)

venues = [e for k, v in done.items() if k != "stations" for e in v]
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"venues": {"elements": venues}, "stations": {"elements": done["stations"]}}, f, ensure_ascii=False)
os.remove(PROGRESS)
print(f"\nSaved {OUT} ({os.path.getsize(OUT) // 1024} KB, {len(venues)} venues).")
print("Next: python3 build/build.py --refresh")
