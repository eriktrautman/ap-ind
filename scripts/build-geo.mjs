// Build one TopoJSON file per state whose units match AP's reporting units:
//   43 states: counties from us-atlas (id = 5-digit county FIPS, matches AP fipsCode)
//   CT, MA, ME, NH, RI, VT: towns from Census TIGER county subdivisions (match AP by name)
//   AK: State House Districts from Census TIGER SLDL (match AP by name)
// Output: watch-party/public/geo/<ST>.json with properties { name, kind } and feature id.
// Usage: node scripts/build-geo.mjs <work-dir containing counties-10m.json and tiger/*.zip>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as topojson from "topojson-client";
import * as topoServer from "topojson-server";

const WORK = process.argv[2];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "watch-party", "public", "geo");
mkdirSync(OUT, { recursive: true });
const MAPSHAPER = join(WORK, "node_modules", ".bin", "mapshaper");

const FIPS = { AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56" };
const TOWN_STATES = ["CT", "MA", "ME", "NH", "RI", "VT"];

// 1. counties from us-atlas
const us = JSON.parse(readFileSync(join(WORK, "counties-10m.json"), "utf8"));
const all = topojson.feature(us, us.objects.counties).features;
for (const [st, pre] of Object.entries(FIPS)) {
  if (st === "AK" || st === "DC" || TOWN_STATES.includes(st)) continue;
  const feats = all.filter((f) => String(f.id).startsWith(pre)).map((f) => ({ type: "Feature", id: String(f.id), properties: { name: f.properties.name, kind: "county" }, geometry: f.geometry }));
  const topo = topoServer.topology({ units: { type: "FeatureCollection", features: feats } }, 1e5);
  writeFileSync(join(OUT, `${st}.json`), JSON.stringify(topo));
}

// 2. TIGER-derived states via mapshaper (simplified, fields renamed to name/kind, id set)
function tiger(st, zip, expr, filter) {
  const out = join(OUT, `${st}.json`);
  const args = [join(WORK, "tiger", zip)];
  if (filter) args.push("-filter", filter);
  args.push("-simplify", "10%", "keep-shapes", "-each", expr, "-filter-fields", "name,kind,uid", "-rename-layers", "units", "-o", "format=topojson", "id-field=uid", "precision=0.0001", out);
  execFileSync(MAPSHAPER, args, { stdio: ["ignore", "ignore", "inherit"] });
}
for (const st of TOWN_STATES) {
  // NAME is the bare town name AP uses ("Barkhamsted"); drop undefined/water subdivisions
  tiger(st, `tl_2024_${FIPS[st]}_cousub.zip`, `name=NAME, kind='town', uid=GEOID`, `!/not defined/i.test(NAME)`);
}
tiger("AK", "tl_2024_02_sldl.zip", `name=NAMELSAD, kind='house-district', uid=SLDLST`);

// 3. report
for (const st of Object.keys(FIPS)) {
  const p = join(OUT, `${st}.json`);
  if (!existsSync(p)) continue;
  const t = JSON.parse(readFileSync(p, "utf8"));
  const n = Object.values(t.objects)[0].geometries.length;
  console.log(`${st}: ${n} units, ${(readFileSync(p).length / 1024).toFixed(0)} KB`);
}
