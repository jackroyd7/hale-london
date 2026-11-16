"""Turn an Overpass JSON export of London wellness places into venues.json for Hale.

Usage (usually via build.py --refresh): python3 -I process_osm.py london_osm.json boroughs.min.json venues.json
Everything shown in the app comes from OpenStreetMap tags; nothing is invented.
"""
import json, math, re, sys

src, b_src, dst = sys.argv[1:4]
raw = json.load(open(src, encoding="utf-8"))
osm = raw["venues"]["elements"]
st_raw = raw["stations"]["elements"]
boroughs = json.load(open(b_src))["features"]

def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def borough_at(lat, lng):
    for f in boroughs:
        for poly in f["geometry"]["coordinates"]:
            if in_ring(lng, lat, poly[0]) and not any(in_ring(lng, lat, h) for h in poly[1:]):
                return f["properties"]["name"]
    return None

def metres(a, b):
    r = math.pi / 180
    dlat = (b[0] - a[0]) * r; dlng = (b[1] - a[1]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dlng / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))

def coords(e):
    if "lat" in e: return e["lat"], e["lon"]
    if "center" in e: return e["center"]["lat"], e["center"]["lon"]
    return None

# ---- stations ----
stations = {}
for e in st_raw:
    t = e.get("tags", {}); c = coords(e)
    if not c or not t.get("name"): continue
    name = re.sub(r"\s+(Underground|Rail|DLR|Overground)\s+Station$", "", t["name"]).strip()
    if re.fullmatch(r"Station [A-Z0-9]", name): continue
    key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if key in stations: continue
    if not borough_at(*c): continue
    stations[key] = [name, round(c[0], 5), round(c[1], 5)]
st_list = list(stations.items())

# ---- opening hours ----
DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
def parse_hours(s):
    """Return 7 lists of [open, close] for Mon..Sun, or None when the format is not understood."""
    if not s: return None
    s = s.strip()
    if s == "24/7": return [[["00:00", "24:00"]] for _ in range(7)]
    week = [None] * 7
    for rule in [r.strip() for r in s.split(";") if r.strip()]:
        rule = re.sub(r"\bPH\b[^,;]*", "", rule).strip().rstrip(",").strip()
        if not rule: continue
        m = re.fullmatch(r"((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)+)\s+(off|closed|(?:\d{1,2}:\d{2}-\d{1,2}:\d{2}\+?(?:,\s*)?)+)", rule)
        if not m:
            m2 = re.fullmatch(r"((?:\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\s*)?)+)", rule)
            if m2:
                m = (None, "Mo-Su", m2.group(1))
            else:
                return None
        dpart, tpart = (m[1], m[2]) if isinstance(m, tuple) else (m.group(1), m.group(2))
        days = set()
        for chunk in re.split(r"\s*,\s*", dpart.strip().rstrip(",")):
            if not chunk: continue
            if "-" in chunk:
                a, b = chunk.split("-"); ia, ib = DAYS.index(a), DAYS.index(b)
                i = ia
                while True:
                    days.add(i)
                    if i == ib: break
                    i = (i + 1) % 7
            else:
                days.add(DAYS.index(chunk))
        if tpart in ("off", "closed"):
            ivs = []
        else:
            ivs = []
            for iv in re.split(r"\s*,\s*", tpart.strip().rstrip(",")):
                if not iv: continue
                o, c = iv.rstrip("+").split("-")
                o = o.zfill(5); c = c.zfill(5)
                ivs.append([o, c])
        for d in days: week[d] = ivs
    if all(w is None for w in week): return None
    return [w if w is not None else [] for w in week]

# ---- classification ----
BRANDS_GYM = re.compile(r"pure ?gym|the gym|anytime fitness|fitness first|virgin active|nuffield|david lloyd|third space|gymbox|everyone active|better|1life|jd gym|snap fitness|easygym|bannatyne|f45|orangetheory|barry'?s|1rebel|psycle|frame|digme|third space|the castle|fitness4less|énergie|energie", re.I)
SUB_NEEDS = {
    "Physiotherapy": ["back-pain", "injury", "running"], "Osteopathy": ["back-pain", "injury"], "Chiropractic": ["back-pain"],
    "Acupuncture": ["stress", "sleep", "back-pain"], "Podiatry": ["running", "injury"], "Nutrition & dietetics": ["gut-health", "healthy-eating", "energy"],
    "Counselling & therapy": ["stress", "sleep"], "Meditation centre": ["stress", "sleep", "focus"],
    "Gym": ["strength", "energy"], "Yoga": ["flexibility", "stress"], "Pilates": ["strength", "back-pain", "flexibility"],
    "Climbing": ["strength", "social", "focus"], "Boxing & martial arts": ["strength", "stress"], "Dance": ["energy", "social", "flexibility"],
    "Swimming pool": ["strength", "recovery", "energy"], "Lido & open water": ["social", "recovery", "stress"], "Leisure centre": ["strength", "energy"],
    "Sauna & bathhouse": ["recovery", "stress", "social"], "Spa": ["recovery", "stress"], "Massage": ["recovery", "back-pain", "stress"], "Sports & remedial massage": ["recovery", "injury", "back-pain", "running"], "Boutique studio": ["strength", "energy", "social"],
    "Vegan": ["healthy-eating"], "Vegetarian": ["healthy-eating"], "Juice & smoothies": ["healthy-eating", "energy"], "Healthy food": ["healthy-eating"],
    "Health food shop": ["healthy-eating", "gut-health"], "Alcohol-free bar": ["sober", "social"],
}
def classify(t):
    hc = t.get("healthcare"); spec = (t.get("healthcare:speciality") or "").lower()
    leisure = t.get("leisure"); amenity = t.get("amenity"); shop = t.get("shop")
    sport = (t.get("sport") or "").lower(); name = t.get("name", "")
    cuisine = (t.get("cuisine") or "").lower()
    if hc == "physiotherapist": return "clinic", "Physiotherapy"
    if hc == "podiatrist": return "clinic", "Podiatry"
    if hc in ("dietitian", "nutrition_counselling"): return "clinic", "Nutrition & dietetics"
    if hc in ("psychotherapist", "counselling"): return "mind", "Counselling & therapy"
    if hc == "alternative":
        if "osteopath" in spec or re.search(r"osteopath", name, re.I): return "clinic", "Osteopathy"
        if "chiropract" in spec or re.search(r"chiropract", name, re.I): return "clinic", "Chiropractic"
        if "acupuncture" in spec or re.search(r"acupunct", name, re.I): return "clinic", "Acupuncture"
        if "massage" in spec or "reflexology" in spec: return "recover", "Massage"
        return None
    if leisure in ("swimming_pool", "sports_centre") and re.search(r"\blido\b|\bponds?\b|outdoor (swimming )?pool|\blake\b", name, re.I): return "move", "Lido & open water"
    if leisure in ("fitness_centre", "sports_centre"):
        if "yoga" in sport or re.search(r"\byoga\b", name, re.I): return "move", "Yoga"
        if "pilates" in sport or re.search(r"pilates|reformer", name, re.I): return "move", "Pilates"
        if "climbing" in sport or re.search(r"climb|boulder", name, re.I): return "move", "Climbing"
        if re.search(r"boxing|martial|karate|judo|jiu|taekwondo|kickbox|muay|mma", sport + " " + name, re.I): return "move", "Boxing & martial arts"
        if "dance" in sport: return "move", "Dance"
        if leisure == "sports_centre":
            if "swimming" in sport: return "move", "Swimming pool"
            return "move", "Leisure centre"
        return "move", "Gym"
    if leisure == "swimming_pool": return "move", "Lido & open water" if re.search(r"lido|pond", name, re.I) else "Swimming pool"
    if leisure == "sauna" or amenity in ("sauna", "public_bath"): return "recover", "Sauna & bathhouse"
    if leisure == "spa" or amenity == "spa": return "recover", "Spa"
    if shop == "massage": return "recover", "Massage"
    if shop == "health_food": return "eat", "Health food shop"
    if amenity == "bar" and t.get("drink:alcohol") == "no": return "eat", "Alcohol-free bar"
    if amenity in ("place_of_worship", "community_centre"): return "mind", "Meditation centre"
    if amenity in ("cafe", "restaurant", "fast_food", "bar"):
        if t.get("diet:vegan") == "only": return "eat", "Vegan"
        if t.get("diet:vegetarian") == "only": return "eat", "Vegetarian"
        if re.search(r"juice|smoothie|acai", cuisine): return "eat", "Juice & smoothies"
        if re.search(r"salad|healthy|poke|raw", cuisine): return "eat", "Healthy food"
    return None

# Venues reviewed by hand and excluded: men-only saunas not tagged as such in OSM,
# and massage listings whose names suggest they are not wellness businesses.
EXCLUDE_NAMES = {"covent garden health spa", "sailors", "rio's relaxation spa", "thai angels", "jolly good time massage", "ruean siam"}

def clean_url(u):
    if not u: return ""
    u = u.strip().split(";")[0].strip()
    if not re.match(r"https?://", u): u = "https://" + u
    return u if re.match(r"https?://[^\s/]+\.[^\s]+", u) else ""

venues, seen = [], []
for e in osm:
    t = e.get("tags", {}); c = coords(e)
    if not c or not t.get("name"): continue
    if t.get("disused") or t.get("opening_hours") == "closed" or t.get("access") == "private": continue
    cl = classify(t)
    if not cl: continue
    cat, sub = cl
    # Keep only places that present themselves as wellness businesses.
    web_all = " ".join(str(t.get(k, "")) for k in ("website", "contact:website", "url")).lower()
    if t.get("lgbtq:men") in ("only", "primary") or (cat == "recover" and t.get("lgbtq") == "primary"):
        continue  # men-only / cruising saunas
    nm = t["name"].strip()
    if re.search(r"tantric|tantaliz|erotic|naturist|adult|happy ending", nm + " " + web_all, re.I) or re.search(r"gaysauna|pleasuredrome|sweatbox", web_all):
        continue
    if nm.lower() in EXCLUDE_NAMES:
        continue
    if sub == "Massage":
        # Only sports and remedial massage clinics, not general massage shops.
        blob = " ".join([nm, web_all, str(t.get("description", "")), str(t.get("massage", "")), str(t.get("healthcare:speciality", ""))]).lower()
        named = (nm + " " + web_all).lower()
        if re.search(r"thai|siam|chinese|tantr", named):
            continue
        if not (t.get("massage") in ("sport", "sports", "remedial", "deep_tissue")
                or re.search(r"sports? massage|remedial|deep.tissue|injur|rehab|physio", blob)
                or re.search(r"clinic", named)):
            continue
        sub = "Sports & remedial massage"
    if sub == "Spa" and re.search(r"massage|thai|siam", nm, re.I):
        continue  # massage shops filed as spas
    if cat == "recover" and not (web_all.strip() or t.get("contact:instagram") or t.get("operator")):
        continue  # unverifiable sauna/spa/massage listings
    if (t.get("shop") == "massage" or (sub in ("Spa", "Massage") and not t.get("leisure") and not t.get("amenity"))) and not (t.get("website") or t.get("contact:website")):
        continue
    b = borough_at(*c)
    if not b: continue
    name = t["name"].strip()
    if any(s[0] == name.lower() and metres(s[1], c) < 120 for s in seen): continue
    seen.append((name.lower(), c))
    near = min(st_list, key=lambda kv: metres((kv[1][1], kv[1][2]), c))
    dist = metres((near[1][1], near[1][2]), c)
    brand = t.get("brand") or ""
    chain = bool(brand) or bool(cat == "move" and BRANDS_GYM.search(name))
    addr = " ".join(x for x in [t.get("addr:housenumber", ""), t.get("addr:street", "")] if x).strip()
    pc = t.get("addr:postcode", "")
    v = {
        "id": f"{e['type'][0]}{e['id']}", "name": name, "cat": cat, "sub": sub,
        "lat": round(c[0], 5), "lng": round(c[1], 5), "borough": b,
        "st": near[1][0], "stWalk": max(1, round(dist * 1.25 / 80)),
        "needs": SUB_NEEDS.get(sub, []),
    }
    w = clean_url(t.get("website") or t.get("contact:website") or t.get("url"))
    if w: v["web"] = w
    ph = t.get("phone") or t.get("contact:phone")
    if ph: v["phone"] = ph.split(";")[0].strip()
    if addr or pc: v["addr"] = ", ".join(x for x in [addr, pc] if x)
    oh = t.get("opening_hours")
    if oh:
        v["ohRaw"] = oh[:160]
        ph_ = parse_hours(oh)
        if ph_: v["hours"] = ph_
    wc = t.get("wheelchair")
    if wc in ("yes", "limited", "no"): v["wc"] = wc
    if t.get("diet:vegan") in ("yes", "only"): v["vegan"] = t["diet:vegan"]
    if t.get("diet:vegetarian") in ("yes", "only"): v["veggie"] = t["diet:vegetarian"]
    if t.get("diet:gluten_free") in ("yes", "only"): v["gf"] = 1
    if chain: v["chain"] = brand or 1
    if t.get("female") == "only" or t.get("women") == "only": v["women"] = 1
    if t.get("fee") == "no": v["free"] = 1
    if t.get("branch"): v["_branch"] = t["branch"]
    v["osm"] = f"https://www.openstreetmap.org/{e['type']}/{e['id']}"
    venues.append(v)

# ---- official chain club lists (chains.json) override and complete OSM ----
import os as _os
_chains_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "chains.json")
if _os.path.exists(_chains_path):
    official = json.load(open(_chains_path, encoding="utf-8"))["chains"]
    by_brand = {}
    for c in official: by_brand.setdefault(c["brand"], []).append(c)
    for brand, clubs in by_brand.items():
        bl = brand.lower()
        aliases = [a.lower() for a in clubs[0].get("aliases", [bl])] + [bl]
        sub_ = clubs[0].get("sub", "Gym")
        pcs = {c["addr"].rsplit(", ", 1)[-1].replace(" ", "").upper() for c in clubs}
        def is_cand(v):
            pc = (v.get("addr") or "").rsplit(", ", 1)[-1].replace(" ", "").upper()
            nm_, ch_ = v["name"].lower(), str(v.get("chain", "")).lower()
            return v["cat"] == "move" and (any(a in nm_ or a in ch_ for a in aliases) or (pc in pcs and bl.split()[0] in nm_))
        cands = [v for v in venues if is_cand(v)]
        used = set()
        for c in clubs:
            best = min((v for v in cands if id(v) not in used), key=lambda v: metres((v["lat"], v["lng"]), (c["lat"], c["lng"])), default=None)
            if best is not None and metres((best["lat"], best["lng"]), (c["lat"], c["lng"])) < 400:
                used.add(id(best)); v = best
            else:
                near = min(st_list, key=lambda kv: metres((kv[1][1], kv[1][2]), (c["lat"], c["lng"])))
                v = {"id": re.sub(r"[^a-z0-9]+", "-", f"{brand} {c['branch']}".lower()).strip("-"), "cat": "move", "sub": sub_,
                     "lat": c["lat"], "lng": c["lng"], "borough": borough_at(c["lat"], c["lng"]) or "",
                     "st": near[1][0], "stWalk": max(1, round(metres((near[1][1], near[1][2]), (c["lat"], c["lng"])) * 1.25 / 80)),
                     "needs": SUB_NEEDS.get(sub_, SUB_NEEDS["Gym"])}
                venues.append(v)
            v.update({"name": brand, "branch": c["branch"], "addr": c["addr"], "web": c["web"], "chain": brand, "src": brand, "sub": sub_, "needs": SUB_NEEDS.get(sub_, v["needs"])})
        removed = [v for v in cands if id(v) not in used]
        for v in removed: venues.remove(v)
        print(f"{brand}: {len(used)} matched in OSM, {len(clubs) - len(used)} added, {len(removed)} OSM entries not on the official list removed")

# Tell branches of the same name apart (e.g. "Third Space"): use OSM's branch tag, else the nearest station.
from collections import Counter as _C
_names = _C(v["name"].lower() for v in venues)
for v in venues:
    if _names[v["name"].lower()] > 1:
        v["branch"] = v.get("branch") or v.pop("_branch", None) or v["st"]
    v.pop("_branch", None)
venues.sort(key=lambda v: (v["cat"], v["name"].lower()))
json.dump({"venues": venues, "stations": stations}, open(dst, "w"), separators=(",", ":"), ensure_ascii=False)
from collections import Counter
print(len(venues), "venues;", len(stations), "stations")
print(Counter(v["cat"] for v in venues)); print(Counter(v["sub"] for v in venues))
print("with website", sum("web" in v for v in venues), "hours parsed", sum("hours" in v for v in venues), "hours raw", sum("ohRaw" in v for v in venues))
