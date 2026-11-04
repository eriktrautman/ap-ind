#!/usr/bin/env python3
"""Builds studio/public/analytics/baseline: one row per race (Cook rating, forecast, polling, 2022 and 2024) and 2024 presidential by county.
No AP calls: 2022 and 2024 come from the AP history database already on this machine. Run from the repo root."""
import csv, io, json, re, sqlite3, collections, os, datetime, sys

RAW = "analytics/raw"; OUT = "studio/public/analytics/baseline"; os.makedirs(OUT, exist_ok=True)
SP = RAW
WIKI = {"House": f"{SP}/wiki-2026_United_States_House_of_Representatives_election_ratings.txt", "Senate": f"{SP}/wiki-2026_United_States_Senate_elections.txt", "Governor": f"{SP}/wiki-2026_United_States_gubernatorial_elections.txt"}
ST = dict(Alabama="AL", Alaska="AK", Arizona="AZ", Arkansas="AR", California="CA", Colorado="CO", Connecticut="CT", Delaware="DE", Florida="FL", Georgia="GA", Hawaii="HI", Idaho="ID", Illinois="IL", Indiana="IN", Iowa="IA", Kansas="KS", Kentucky="KY", Louisiana="LA", Maine="ME", Maryland="MD", Massachusetts="MA", Michigan="MI", Minnesota="MN", Mississippi="MS", Missouri="MO", Montana="MT", Nebraska="NE", Nevada="NV", Ohio="OH", Oklahoma="OK", Oregon="OR", Pennsylvania="PA", Tennessee="TN", Texas="TX", Utah="UT", Vermont="VT", Virginia="VA", Washington="WA", Wisconsin="WI", Wyoming="WY")
ST.update({"New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "West Virginia": "WV"})
# Margins are always Republican minus Democrat, in points: positive is R, negative is D.

def cook_ratings(office):
    """The Cook column of Wikipedia's ratings table. Cook's own site refuses automated reads, so this is second-hand, as of the date in the column."""
    lines = open(WIKI[office], errors="ignore").read().split("\n")
    i0 = next(i for i, l in enumerate(lines) if re.match(r"^!.*Cook( Political Report)?\]\]", l.replace("''", "")) or re.match(r"^! *''?\[\[The Cook", l))
    out, cur = {}, None
    for i in range(i0, len(lines)):
        l = lines[i]
        if l.startswith("|}"): break
        if l.startswith("|-"): cur = None; continue
        lab = None
        if l.startswith("!"):
            if office == "House":
                m = re.search(r"ushr\|([A-Z]{2})\|([A-Z0-9]+)", l, re.I); lab = f"{m[1].upper()}-{m[2].upper()}" if m else None
            elif office == "Senate":
                m = re.search(r"Senate (?:special )?election in ([A-Za-z ]+)", l); lab = f"{ST[m[1].strip()]}-SEN" if m and m[1].strip() in ST else None
            else:
                m = re.search(r"2026 ([A-Za-z ]+) gubernatorial election", l); lab = f"{ST[m[1].strip()]}-GOV" if m and m[1].strip() in ST else None
            if lab: cur = lab; continue
        m = re.search(r"\{\{USRaceRating\|([A-Za-z]+)(?:\|([A-Za-z]+))?", l, re.I)
        if m and cur and cur not in out:
            t = m[1].capitalize(); p = (m[2] or "").upper()
            out[cur] = "Toss Up" if t == "Tossup" else f"{t} {p}".strip()
    return out

COOK = {}
for off in WIKI: COOK.update(cook_ratings(off))
SEATS = {"Toss Up": 0, "Tilt": 1, "Lean": 2, "Likely": 3, "Solid": 4, "Safe": 4}
def cook_side(c):
    if not c or c == "Toss Up": return None
    return "R" if c.endswith("R") else "D" if c.endswith("D") else None   # D here covers an independent Cook rates with the Democrats' column

model = json.load(open(f"{RAW}/onpoint-model.json"))
MODEL = {}
for r in model["races"]:
    d = r["district"]
    lab = f'{r["st"]}-SEN' if r["office"] == "senate" else f'{r["st"]}-GOV' if r["office"] == "governor" else f'{r["st"]}-{d if d and d > 0 else "AL"}'
    MODEL[lab] = r
if "house-AK-01" in {r["id"] for r in model["races"]}:
    for r in model["races"]:
        if r["office"] == "house" and r["id"].endswith("-01") and r["st"] in ("AK", "WY", "ND", "SD", "VT", "DE"):
            MODEL[f'{r["st"]}-AL'] = r; MODEL.pop(f'{r["st"]}-1', None)

db = sqlite3.connect("file:/Users/eriktrautman/ap-ind/data/ap-history.sqlite?mode=ro", uri=True)
def margins(date, office):
    """state + seat -> {r, d, total, margin} from AP's statewide row of the general election. Top Dem and top GOP vote-getters."""
    out = {}
    q = """select ra.state_postal, ra.race_id, ra.seat_num, ra.race_type, res.party, res.vote_count
           from races ra join results res on res.election_date=ra.election_date and res.state_postal=ra.state_postal and res.race_id=ra.race_id
           join reporting_units ru on ru.election_date=res.election_date and ru.state_postal=res.state_postal and ru.race_id=res.race_id and ru.ru_key=res.ru_key and ru.ru_level=1
           where ra.election_date=? and ra.office_id=? and ra.race_type in ('General','Open Primary','Special General')"""
    rows = collections.defaultdict(lambda: {"seat": None, "type": None, "D": 0, "R": 0, "all": 0, "partyVotes": collections.Counter()})
    for st, rid, seat, rtype, party, votes in db.execute(q, (date, office)):
        v = votes or 0; x = rows[(st, rid)]; x["seat"] = seat; x["type"] = rtype; x["all"] += v
        x["partyVotes"][party] += v
        if party == "Dem": x["D"] = max(x["D"], v)
        if party == "GOP": x["R"] = max(x["R"], v)
    for (st, rid), x in rows.items():
        if not x["all"]: continue
        key = (st, str(x["seat"] or ""), x["type"])
        cur = out.get((st, str(x["seat"] or "")))
        if cur and cur["all"] >= x["all"] and x["type"] != "General": continue
        out[(st, str(x["seat"] or ""))] = {"all": x["all"], "D": x["D"], "R": x["R"], "marginRD": round((x["R"] - x["D"]) / x["all"] * 100, 1), "dPct": round(x["D"] / x["all"] * 100, 1), "rPct": round(x["R"] / x["all"] * 100, 1), "contested": bool(x["D"] and x["R"]), "type": x["type"]}
    return out
H22, S22, S24, H24 = margins("2022-11-08", "H"), margins("2022-11-08", "S"), margins("2024-11-05", "S"), margins("2024-11-05", "H")
P24 = margins("2024-11-05", "P")
S22_BY = {k[0]: v for k, v in S22.items()}
P24_BY = {k[0]: v for k, v in P24.items()}

def gov22():
    """2022 governor results, from Wikipedia's table: AP history here holds federal offices only."""
    out = {}; t = open(f"{RAW}/gov22.wiki", errors="ignore").read()
    for m in re.finditer(r"! \[\[2022 ([A-Za-z ]+) gubernatorial election\|[^\]]+\]\](.*?)(?=\n\|-\n! \[\[2022 |\n\|\}\n)", t, re.S):
        st = ST.get(m[1].strip())
        if not st: continue
        cands = re.findall(r"\{\{Party stylesheet\|([^}]+)\}\}|\[\[([^\]\|]+)(?:\|[^\]]+)?\]\][^\n]*?\(?(Democratic|Republican)\)?[^\n]*?(\d+\.\d+)%", m[2])
        pairs = re.findall(r"(Democratic|Republican)[^\n]*?(\d+\.\d+)%", re.sub(r"<ref.*?(</ref>|/>)", "", m[2], flags=re.S))
        d = next((float(p) for party, p in pairs if party == "Democratic"), None); r = next((float(p) for party, p in pairs if party == "Republican"), None)
        if d is not None and r is not None: out[st] = {"dPct": d, "rPct": r, "marginRD": round(r - d, 1), "source": "Wikipedia"}
    return out
G22 = gov22()

# 2024 presidential by district, on the lines being used this year: The Downballot's table.
PD = {}
with open(f"{RAW}/db-pres-0.csv", encoding="utf8") as f:
    for row in csv.reader(f):
        m = re.match(r"^([A-Z]{2})-(AL|\d+)$", row[0] if row else "")
        if not m: continue
        try: h, t, diff = float(row[3]), float(row[4]), float(row[5])
        except (ValueError, IndexError): continue
        PD[f'{m[1]}-{"AL" if m[2] == "AL" else int(m[2])}'] = {"dPct": h, "rPct": t, "marginRD": -diff}   # the sheet's margin is Harris minus Trump

# Lines changed since 2022: there, a district's 2022 result is another map's and is marked so.
CHANGED_SINCE_2022 = set("AL GA LA NY NC FL TX CA OH TN UT".split())   # 2024 redraws, plus the 2025-2026 list on Wikipedia; Missouri and Virginia were blocked or left in place

# A Senate seat not up in 2022 gets the state's 2022 House vote instead: the party's midterm vote there, marked as such.
H22ST = {}
for (st, seat), v in H22.items():
    x = H22ST.setdefault(st, {"D": 0, "R": 0, "all": 0}); x["D"] += v["D"]; x["R"] += v["R"]; x["all"] += v["all"]
H22ST = {st: {**x, "marginRD": round((x["R"] - x["D"]) / x["all"] * 100, 1), "dPct": round(x["D"] / x["all"] * 100, 1), "rPct": round(x["R"] / x["all"] * 100, 1), "stateHouse": True} for st, x in H22ST.items() if x["all"]}

idx = json.load(open("studio/data/index.json"))["races"]
rows = []
for r in idx:
    if r["office"] not in ("S", "H", "G"): continue
    lab = r["label"]; st = r["state"]; off = {"S": "Senate", "H": "House", "G": "Governor"}[r["office"]]
    m = MODEL.get(lab); est = (m or {}).get("est") or {}
    seat = lab.split("-")[1] if off == "House" else ""
    seatN = "" if seat in ("AL", "") else str(int(seat))
    row = {"label": lab, "id": r["id"], "state": st, "stateName": r["stateName"], "office": off, "cook": COOK.get(lab)}
    row["cookSide"] = cook_side(row["cook"])
    row["model"] = None
    if m:
        unopposed = abs(est.get("margin", 0)) >= 100
        row["model"] = {"margin": None if unopposed else round(est["margin"], 1), "p10": None if unopposed else est.get("p10"), "p90": None if unopposed else est.get("p90"), "dWinProb": round(1 - est.get("prob", 0), 3) if not unopposed else None, "dem": m.get("dem"), "gop": m.get("gop"), "pollAvg": m.get("pollAvg"), "nPolls": len(m.get("polls") or []), "unopposed": unopposed}
    # 2022 midterm, same office
    if off == "House":
        row["y2022"] = H22.get((st, seatN)) or H22.get((st, "1" if not seatN else seatN))
        if row["y2022"]: row["y2022"] = {**row["y2022"], "otherLines": st in CHANGED_SINCE_2022}
        row["pres2024"] = PD.get(lab)
    elif off == "Senate":
        row["y2022"] = S22_BY.get(st) or H22ST.get(st); row["pres2024"] = P24_BY.get(st)
    else:
        row["y2022"] = G22.get(st); row["pres2024"] = P24_BY.get(st)
    rows.append(row)

# 2024 presidential by county, summed from AP's towns where a state reports by town.
NAMES = collections.defaultdict(lambda: collections.defaultdict(lambda: {"D": 0, "R": 0, "all": 0}))
q = """select ru.state_postal, ru.ru_name, res.party, res.vote_count from results res
       join reporting_units ru on ru.election_date=res.election_date and ru.state_postal=res.state_postal and ru.race_id=res.race_id and ru.ru_key=res.ru_key
       where res.election_date='2024-11-05' and res.race_id='0' and ru.ru_level=2"""
for st, name, party, v in db.execute(q):
    x = NAMES[st][name]; v = v or 0; x["all"] += v
    if party == "Dem": x["D"] += v
    if party == "GOP": x["R"] += v
county = {st: {"n": {n: {"m": round((x["R"] - x["D"]) / x["all"] * 100, 1), "t": x["all"]} for n, x in us.items() if x["all"]}} for st, us in NAMES.items()}   # by AP's unit name: counties, or towns where a state reports by town

meta = {"built": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "marginSign": "Republican minus Democrat, points",
        "sources": {"cook": "Cook Political Report ratings, Nov. 2, 2026 for House and Senate, Oct. 29 for governors, read from Wikipedia's ratings tables because Cook's site refuses automated reads", "model": f"On Point Politics forecast, model.json, updated {model['meta']['updated']}", "polls": "On Point Politics' polling average, where a race has polls", "y2022": "AP (Senate and House, from the history database on this machine), Wikipedia (governors)", "pres2024": "AP (statewide and county, history database), The Downballot (by congressional district)"}}
json.dump({"meta": meta, "races": rows}, open(f"{OUT}/races.json", "w"), separators=(",", ":"))
json.dump(county, open(f"{OUT}/county2024.json", "w"), separators=(",", ":"))
with open(f"{OUT}/races.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["race", "office", "cook", "forecast_margin_RminusD", "forecast_p10", "forecast_p90", "poll_avg_RminusD", "polls", "2022_margin_RminusD", "2022_other_lines", "2024_pres_margin_RminusD"])
    for x in rows:
        mo = x["model"] or {}; y = x["y2022"] or {}; p = x["pres2024"] or {}
        w.writerow([x["label"], x["office"], x["cook"], mo.get("margin"), mo.get("p10"), mo.get("p90"), mo.get("pollAvg"), mo.get("nPolls"), y.get("marginRD"), y.get("otherLines", ""), p.get("marginRD")])

C = collections.Counter
print("rows", len(rows), C(x["office"] for x in rows))
for off in ("Senate", "Governor", "House"):
    s = [x for x in rows if x["office"] == off]
    print(off, "cook", sum(1 for x in s if x["cook"]), "model", sum(1 for x in s if x["model"]), "margin", sum(1 for x in s if (x["model"] or {}).get("margin") is not None), "polls", sum(1 for x in s if (x["model"] or {}).get("pollAvg") is not None), "2022", sum(1 for x in s if x["y2022"]), "2024", sum(1 for x in s if x["pres2024"]))
print("cook mix", C(x["cook"] for x in rows))
print("no cook", [x["label"] for x in rows if not x["cook"]][:25])
print("no model", [x["label"] for x in rows if not x["model"]][:25])
print("no 2022 senate/gov", [x["label"] for x in rows if x["office"] != "House" and not x["y2022"]])
print("no 2022 house", [x["label"] for x in rows if x["office"] == "House" and not x["y2022"]][:20], "no pres", [x["label"] for x in rows if not x["pres2024"]][:20])
for L in ("TX-SEN", "NE-SEN", "IA-SEN", "OH-GOV", "NE-2", "TX-35", "KY-6", "AK-AL"):
    print(json.dumps(next(x for x in rows if x["label"] == L))[:440])
print("county states", len(county), "NE sample", list(county["NE"]["n"].items())[:1], "CT", len(county["CT"]["n"]), "ME", len(county["ME"]["n"]), "AK", len(county["AK"]["n"]))
