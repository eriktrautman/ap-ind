#!/usr/bin/env python3
"""
Fetch candidate photos for every race with an independent or third-party candidate.

Sources, in order of trust:
  1. Incumbents: official congressional portraits (public domain) from the
     unitedstates/images archive, keyed by Bioguide ID via congress-legislators.
  2. Everyone else: Ballotpedia's per-state 2026 election pages, using the
     candidate-row pairing (thumbnail beside the candidate link). Ballotpedia has
     known mis-attached photos, so each image gets a confidence score and all of
     them go to contact sheets for a human pass.

Usage: python3 -I scripts/fetch-candidate-photos.py <work-dir>
  <work-dir>/candidates-todo.json   input: candidates from /api/races
  <work-dir>/src/legislators-current.yaml
  <work-dir>/raw/<apid>.jpg         output images
  <work-dir>/manifest.json          output: per-candidate source, url, confidence
"""
import json, re, sys, time, os, urllib.request, urllib.parse, html

WORK = sys.argv[1]
UA = "Mozilla/5.0 (Macintosh) ap-ind-candidate-index/0.1 (+https://github.com/eriktrautman/ap-ind)"
DELAY = 1.0
STATE_NAMES = {"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New_Hampshire","NJ":"New_Jersey","NM":"New_Mexico","NY":"New_York","NC":"North_Carolina","ND":"North_Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode_Island","SC":"South_Carolina","SD":"South_Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West_Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District_of_Columbia"}

def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = r.read()
            return data if binary else data.decode("utf-8", "ignore")
    except Exception as e:
        return None
    finally:
        time.sleep(DELAY)

def norm(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"\(.*?\)", "", s)            # drop "(write-in)" etc.
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    s = re.sub(r"[^a-z' -]", "", s)
    return re.sub(r"\s+", " ", s).strip()

def last_token(name):
    toks = norm(name).split()
    return toks[-1] if toks else ""

# ---------- 1. incumbents via congress-legislators ----------
def parse_legislators(path):
    text = open(path, encoding="utf-8").read()
    members = []
    for block in text.split("\n- id:")[1:]:
        bio = re.search(r"\n\s+bioguide:\s*(\S+)", block)
        last = re.search(r"\n\s+last:\s*(.+)", block)
        first = re.search(r"\n\s+first:\s*(.+)", block)
        terms = re.findall(r"\n  - type:\s*(\w+)\n(?:.*\n)*?\s+state:\s*(\w+)(?:\n\s+district:\s*(-?\d+))?", block)
        if not (bio and last and terms):
            continue
        t = terms[-1]
        members.append({"bioguide": bio.group(1), "last": last.group(1).strip().strip("'\""), "first": (first.group(1) if first else "").strip().strip("'\""),
                        "type": t[0], "state": t[1], "district": int(t[2]) if t[2] not in (None, "") else None})
    return members

def match_incumbent(c, members):
    # Match on chamber + state + last name. District is only a tiebreaker: after
    # redistricting an incumbent often runs under a new district number.
    chamber = "rep" if c["office"] == "H" else "sen"
    cands = [x for x in members if x["type"] == chamber and x["state"] == c["state"]]
    ln = last_token(c["name"])
    exact = [x for x in cands if norm(x["last"]).split()[-1:] == [ln]]
    if len(exact) == 1:
        return exact[0], "high"
    if len(exact) > 1 and c["office"] == "H":
        m = re.match(r"[A-Z]{2}-(\d+|AL)", c["race"])
        dist = 0 if (not m or m.group(1) == "AL") else int(m.group(1))
        same = [x for x in exact if x["district"] == dist]
        if len(same) == 1:
            return same[0], "high"
    return None, None

# ---------- 2. Ballotpedia rows ----------
ROW = re.compile(r'<tr class="results_row[^"]*">(.*?)</tr>', re.S)
IMG = re.compile(r'<img[^>]+src="(https://s3\.amazonaws\.com/ballotpedia-api4/files/[^"]+)"[^>]*alt="Image of ([^"]+)"')
LINK = re.compile(r'<a href="https://ballotpedia\.org/([^"]+)">([^<]+)</a>\s*\(([^)]*)\)')

def bp_pages(state):
    n = STATE_NAMES[state]
    return [f"https://ballotpedia.org/United_States_Senate_election_in_{n},_2026",
            f"https://ballotpedia.org/United_States_House_of_Representatives_elections_in_{n},_2026"]

def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"

def bp_district_page(c):
    # House candidates are listed on the district page, not the state overview.
    n = STATE_NAMES[c["state"]]
    m = re.match(r"[A-Z]{2}-(\d+|AL)", c["race"])
    d = "At-Large" if (not m or m.group(1) == "AL") else ordinal(int(m.group(1)))
    return f"https://ballotpedia.org/{n}%27s_{d}_Congressional_District_election,_2026"

def bp_rows(page_html):
    rows = []
    for row in ROW.findall(page_html):
        img = IMG.search(row); link = LINK.search(row)
        if not link:
            continue
        rows.append({"slug": urllib.parse.unquote(link.group(1)), "name": html.unescape(link.group(2)).strip(), "party": html.unescape(link.group(3)).strip(),
                     "img": img.group(1) if img else None, "alt": html.unescape(img.group(2)).strip() if img else None})
    return rows

def bigger(url):
    # 100x100 thumbs -> try larger renditions
    for size in ("400/600", "300/450", "200/300"):
        u = re.sub(r"/thumbs/\d+/\d+/", f"/thumbs/{size}/", url)
        data = get(u, binary=True)
        if data and len(data) > 2000 and data[:3] in (b"\xff\xd8\xff", b"\x89PN"):
            return u, data
    data = get(url, binary=True)
    return (url, data) if data else (None, None)

def main():
    todo = json.load(open(f"{WORK}/candidates-todo.json"))
    members = parse_legislators(f"{WORK}/src/legislators-current.yaml")
    os.makedirs(f"{WORK}/raw", exist_ok=True)
    manifest = {}
    mpath = f"{WORK}/manifest.json"
    if os.path.exists(mpath):
        manifest = json.load(open(mpath))
        manifest = {k: v for k, v in manifest.items() if v.get("source")}   # retry anything that failed last time
    def save():
        json.dump(manifest, open(mpath, "w"), indent=1)

    # incumbents
    inc = [c for c in todo if c["incumbent"] and c["id"] not in manifest]
    print(f"incumbents to fetch: {len(inc)}", flush=True)
    for c in inc:
        m, conf = match_incumbent(c, members)
        if not m:
            manifest[c["id"]] = {"source": None, "note": "incumbent not matched in congress-legislators"}
            continue
        url = f"https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/450x550/{m['bioguide']}.jpg"
        data = get(url, binary=True)
        if data and data[:3] == b"\xff\xd8\xff":
            open(f"{WORK}/raw/{c['id']}.jpg", "wb").write(data)
            manifest[c["id"]] = {"source": "congress", "url": url, "license": "Public domain (official congressional portrait)", "credit": "U.S. Congress",
                                 "page": f"https://bioguide.congress.gov/search/bio/{m['bioguide']}", "confidence": conf, "matched": f"{m['first']} {m['last']} ({m['bioguide']})"}
        # no portrait in the archive (new members): fall through to the Ballotpedia phase
        save()

    # ballotpedia, state by state
    rest = [c for c in todo if c["id"] not in manifest]
    by_state = {}
    for c in rest:
        by_state.setdefault(c["state"], []).append(c)
    print(f"ballotpedia: {len(rest)} candidates in {len(by_state)} states", flush=True)
    for state, cands in sorted(by_state.items()):
        rows = []
        for url in bp_pages(state):
            h = get(url)
            if h:
                rows += bp_rows(h)
        district_rows = {}
        for c in cands:
            if c["office"] == "H":
                if c["race"] not in district_rows:
                    h = get(bp_district_page(c))
                    district_rows[c["race"]] = bp_rows(h) if h else []
        for c in cands:
            rows_for = district_rows.get(c["race"], []) if c["office"] == "H" else rows
            if not rows_for:
                rows_for = rows
            ln = last_token(c["name"]); fn = norm(c["name"]).split()[0] if norm(c["name"]) else ""
            hits = [r for r in rows_for if last_token(r["name"]) == ln]
            if len(hits) > 1:
                hits = [r for r in hits if norm(r["name"]).split()[0][:1] == fn[:1]] or hits
            if len(hits) > 1:
                hits = [r for r in hits if norm(r["name"]).split()[0] == fn] or hits
            hit = hits[0] if len(hits) == 1 else (hits[0] if hits and all(h["slug"] == hits[0]["slug"] for h in hits) else None)
            if not hit:
                manifest[c["id"]] = {"source": None, "note": f"no unique Ballotpedia row ({len(hits)} matches)"}
                save(); continue
            entry = {"source": "ballotpedia", "page": f"https://ballotpedia.org/{hit['slug']}", "bp_name": hit["name"], "bp_party": hit["party"], "license": "Ballotpedia / campaign-supplied; fair use for identification", "credit": "Ballotpedia"}
            if not hit["img"]:
                entry.update({"note": "Ballotpedia row has no photo", "confidence": None})
                manifest[c["id"]] = entry; save(); continue
            fname = os.path.basename(urllib.parse.urlparse(hit["img"]).path).lower()
            name_in_file = ln.replace("'", "") in fname.replace("_", "").replace("-", "")
            exact_name = norm(hit["name"]) == norm(c["name"])
            conf = "high" if (name_in_file and exact_name) else "medium" if (name_in_file or exact_name) else "low"
            u, data = bigger(hit["img"])
            if data:
                ext = ".png" if data[:3] == b"\x89PN" else ".jpg"
                open(f"{WORK}/raw/{c['id']}{ext}", "wb").write(data)
                entry.update({"url": u, "confidence": conf, "file": f"{c['id']}{ext}", "filename_matches_name": name_in_file})
            else:
                entry.update({"note": "image download failed", "confidence": None})
            manifest[c["id"]] = entry; save()
        print(f"  {state}: {len(cands)} candidates, {len(rows)} rows", flush=True)
    save()
    srcs = {}
    for v in manifest.values():
        srcs[v.get("source")] = srcs.get(v.get("source"), 0) + 1
    print("done:", srcs, flush=True)

if __name__ == "__main__":
    main()
