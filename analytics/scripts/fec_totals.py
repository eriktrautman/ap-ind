"""National House and Senate totals from an FEC results workbook (analytics/raw/fec-resultsNN.xls): Democrats, Republicans, everyone else.
A candidate on several ballot lines (fusion in CT, NY and SC) counts under the major party if one of those lines is one. Needs xlrd 2.0.1."""
import sys, collections
import xlrd
SKIP = ("blank", "void", "over vote", "under vote", "overvote", "undervote", "no vote", "none of these")
def rows(path):
    b = xlrd.open_workbook(path)
    for s in [x for x in b.sheets() if "House" in x.name or "Senate" in x.name]:
        head = None
        for r in range(0, min(12, s.nrows)):
            vals = [str(s.cell_value(r, c)).strip().upper() for c in range(s.ncols)]
            if "PARTY" in vals: head = {v: i for i, v in enumerate(vals)}; start = r + 1; break
        if not head: continue
        col = lambda *names: next(i for n in names for k, i in head.items() if k.startswith(n))
        ST, DI, ID, NM, PA, GE = col("STATE ABB"), col("DISTRICT", "D"), col("FEC ID"), col("CANDIDATE NAME (LAST", "LAST NAME", "CANDIDATE NAME"), col("PARTY"), col("GENERAL", "GE")
        for r in range(start, s.nrows):
            g = s.cell_value(r, GE)
            if not isinstance(g, (int, float)): continue
            yield dict(st=str(s.cell_value(r, ST)).strip(), dist=str(s.cell_value(r, DI)).strip(), id=str(s.cell_value(r, ID)).strip(), name=str(s.cell_value(r, NM)).strip(), party=str(s.cell_value(r, PA)).strip().upper(), votes=int(g))
def totals(path):
    seats = collections.defaultdict(lambda: collections.defaultdict(lambda: {"votes": 0, "parties": set(), "name": ""}))
    for x in rows(path):
        if not x["name"] or x["name"].lower().startswith(SKIP) or "TOTAL" in x["name"].upper(): continue
        d = x["dist"].upper(); office = "S" if d.startswith("S") else "H"
        c = seats[(office, x["st"], d)][x["id"] if x["id"].lower() != "n/a" else x["name"]]
        c["votes"] += x["votes"]; c["parties"].add(x["party"]); c["name"] = x["name"]
    out = {o: {"dem": 0, "gop": 0, "other": 0, "races": 0} for o in "SH"}; top = []
    for (o, st, d), cs in seats.items():
        out[o]["races"] += 1
        for c in cs.values():
            p = c["parties"]; k = "dem" if any(q.startswith(("DEM", "DFL", "DNL", "D/", "D*", "W(D)")) or q == "D" for q in p) else "gop" if any(q.startswith(("REP", "R/", "R*", "W(R)")) or q == "R" for q in p) else "other"
            out[o][k] += c["votes"]
            if k == "other": top.append((c["votes"], o, st, d, c["name"], sorted(p)))
    for o in out:
        t = out[o]; t["total"] = t["dem"] + t["gop"] + t["other"]
        for k in ("dem", "gop", "other"): t[k + "Pct"] = round(t[k] / t["total"] * 100, 2)
    return out, sorted(top, reverse=True), seats
if __name__ == "__main__":
    for f in sys.argv[1:]:
        o, top, seats = totals(f); print(f); print(" S", o["S"]); print(" H", o["H"]); print(" top", top[:8])
        print(" other share of all", round((o["S"]["other"] + o["H"]["other"]) / (o["S"]["total"] + o["H"]["total"]) * 100, 2))
        print(" ME-2", {c["name"]: (c["votes"], sorted(c["parties"])) for c in seats[("H", "ME", "02")].values()})
        print(" labels", collections.Counter(q for s in seats.values() for c in s.values() for q in c["parties"]).most_common(24))
        print(" parties seen in top-of-race", sorted({q for s in seats.values() for c in s.values() for q in c["parties"] if q[:3] in ("DEM", "REP") or q in ("D", "R")})[:20])
        print(" big races", sorted(((sum(c["votes"] for c in s.values()), k) for k, s in seats.items() if k[0] == "H"), reverse=True)[:3])
