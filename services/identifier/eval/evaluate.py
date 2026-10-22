"""
Accuracy check for photo identification, run against a live Featherkeeper stack.

  python3 evaluate.py http://localhost:8080 [report.md]

Creates two catalogues on a fresh site (first account = admin, so only use a test site):
  near:      species recorded within 25 km of Cochrane, AB; photos identified with a map pin there
  province:  every species recorded in Alberta; photos identified with no location
Then identifies each test species from the lead photo of its Wikipedia article and reports
whether the right species came first or in the top 3, and how long it took.
"""

import http.cookiejar
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request
import uuid

BASE = sys.argv[1].rstrip("/")
REPORT = sys.argv[2] if len(sys.argv) > 2 else None
UA = "FeatherkeeperEval/0.1 (https://github.com/tposella/featherkeeper)"
COCHRANE = (51.19, -114.47)

# (Wikipedia article, expected eBird common name). Includes look-alike pairs on purpose.
SPECIES = [
    ("American robin", "American Robin"),
    ("Black-billed magpie", "Black-billed Magpie"),
    ("Black-capped chickadee", "Black-capped Chickadee"),
    ("Mountain chickadee", "Mountain Chickadee"),
    ("Canada goose", "Canada Goose"),
    ("Mallard", "Mallard"),
    ("Common merganser", "Common Merganser"),
    ("Red-winged blackbird", "Red-winged Blackbird"),
    ("Bald eagle", "Bald Eagle"),
    ("Red-tailed hawk", "Red-tailed Hawk"),
    ("Great horned owl", "Great Horned Owl"),
    ("Northern flicker", "Northern Flicker"),
    ("Downy woodpecker", "Downy Woodpecker"),
    ("Hairy woodpecker", "Hairy Woodpecker"),
    ("Mountain bluebird", "Mountain Bluebird"),
    ("Common raven", "Common Raven"),
    ("Dark-eyed junco", "Dark-eyed Junco"),
    ("Yellow warbler", "Yellow Warbler"),
    ("Great blue heron", "Great Blue Heron"),
    ("Bohemian waxwing", "Bohemian Waxwing"),
    ("Cedar waxwing", "Cedar Waxwing"),
    ("House sparrow", "House Sparrow"),
    ("American goldfinch", "American Goldfinch"),
    ("Pine siskin", "Pine Siskin"),
    ("Killdeer", "Killdeer"),
]

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with opener.open(req, timeout=timeout) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        raise SystemExit(f"{method} {path} -> HTTP {err.code}: {err.read().decode()[:500]}") from None


def multipart(path, image, fields, timeout=400):
    boundary = uuid.uuid4().hex
    parts = b""
    for k, v in fields.items():
        parts += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    parts += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="bird.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode() + image + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + path, data=parts, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    started = time.time()
    try:
        with opener.open(req, timeout=timeout) as res:
            return json.load(res), time.time() - started
    except urllib.error.HTTPError as err:
        return {"error": f"HTTP {err.code}: {err.read().decode()[:300]}"}, time.time() - started


def wiki_photo(title):
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"))
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as res:
        summary = json.load(res)
    src = (summary.get("thumbnail") or {}).get("source")
    if not src:
        return None
    # Wikimedia serves only standard thumbnail widths; 960 px is one (URLs look like .../330px-Name.jpg).
    urls = [src]
    if "px-" in src:
        head, tail = src.rsplit("/", 1)
        urls.insert(0, f"{head}/960px-{tail.split('px-', 1)[1]}")
    for url in urls:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError:
            continue
    return None


def rank_of(expected, suggestions):
    for i, s in enumerate(suggestions):
        if (s.get("commonName") or "").lower() == expected.lower():
            return i + 1
    return None


def main():
    call("POST", "/api/auth/register", {"email": "eval@example.com", "password": "evaluation-password", "displayName": "Eval"})
    near = call("POST", "/api/catalogues", {"name": "Eval near Cochrane"})["catalogue"]["slug"]
    lat, lng = COCHRANE
    n = call("POST", f"/api/catalogues/{near}/import/ebird", {"latitude": lat, "longitude": lng, "radiusKm": 25, "areaLabel": "Cochrane"})
    prov = call("POST", "/api/catalogues", {"name": "Eval Alberta"})["catalogue"]["slug"]
    p = call("POST", f"/api/catalogues/{prov}/import/ebird", {"regionCode": "CA-AB"})
    print(f"near-Cochrane dex: {n['total']} species; Alberta dex: {p['total']} species", flush=True)

    rows = []
    for title, expected in SPECIES:
        try:
            photo = wiki_photo(title)
        except Exception as err:  # noqa: BLE001
            print(f"skip {expected}: could not fetch photo ({err})", flush=True)
            continue
        if not photo:
            print(f"skip {expected}: no lead photo", flush=True)
            continue
        a, ta = multipart(f"/api/catalogues/{near}/identify", photo, {"latitude": str(lat), "longitude": str(lng)})
        b, tb = multipart(f"/api/catalogues/{prov}/identify", photo, {})
        sa, sb = a.get("suggestions", []), b.get("suggestions", [])
        row = {
            "expected": expected,
            "near_rank": rank_of(expected, sa),
            "near_top": f"{sa[0]['commonName']} {sa[0]['confidence']:.0%}" if sa else a.get("error", "?"),
            "near_s": ta,
            "near_loc": (a.get("location") or {}).get("source"),
            "prov_rank": rank_of(expected, sb),
            "prov_top": f"{sb[0]['commonName']} {sb[0]['confidence']:.0%}" if sb else b.get("error", "?"),
            "prov_s": tb,
            "prov_loc": (b.get("location") or {}).get("source"),
            "pool": (a.get("pool") or {}).get("candidates"),
        }
        rows.append(row)
        print(
            f"{expected:24} near: #{row['near_rank'] or '-'} ({row['near_top']}, {ta:.1f}s)   "
            f"province: #{row['prov_rank'] or '-'} ({row['prov_top']}, {tb:.1f}s)",
            flush=True,
        )

    if len(rows) < len(SPECIES) // 2:
        raise SystemExit(f"Only {len(rows)} of {len(SPECIES)} test photos could be fetched; not a meaningful result.")

    def acc(key, k):
        return sum(1 for r in rows if r[key] and r[key] <= k) / max(1, len(rows))

    times = [r["near_s"] for r in rows[1:]] + [r["prov_s"] for r in rows[1:]]  # skip the first (cold cache)
    lines = [
        "# Identification accuracy",
        "",
        f"{len(rows)} species, lead photo of each Wikipedia article.",
        f"Candidates near Cochrane: {rows[0]['pool'] if rows else '?'} species; Alberta-wide: {p['total']} species.",
        "",
        "| Setting | Top 1 | Top 3 |",
        "| --- | --- | --- |",
        f"| 25 km of Cochrane + recent sightings | {acc('near_rank', 1):.0%} | {acc('near_rank', 3):.0%} |",
        f"| All of Alberta, no location | {acc('prov_rank', 1):.0%} | {acc('prov_rank', 3):.0%} |",
        "",
        f"First identification (encodes every candidate name): {rows[0]['near_s']:.1f} s" if rows else "",
        f"Typical identification after that: median {statistics.median(times):.1f} s, max {max(times):.1f} s" if times else "",
        "",
        "| Species | Near Cochrane | Alberta, no location |",
        "| --- | --- | --- |",
    ]
    for r in rows:
        lines.append(
            f"| {r['expected']} | #{r['near_rank'] or '-'}: {r['near_top']} | #{r['prov_rank'] or '-'}: {r['prov_top']} |"
        )
    report = "\n".join(lines)
    print("\n" + report)
    if REPORT:
        with open(REPORT, "w") as f:
            f.write(report + "\n")


if __name__ == "__main__":
    main()
