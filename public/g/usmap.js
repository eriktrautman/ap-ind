// Shared national map for the D graphics: a geographic state map (us-atlas via CDN, Albers USA)
// and a tile-grid map, both drawn into an SVG with d3. Fill rules are the caller's.

const FIPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };

/** Tile grid: [col, row] per state. */
const TILES = {
  AK: [0, 0], ME: [11, 0],
  VT: [10, 1], NH: [11, 1],
  WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], WI: [7, 2], MI: [8, 2], NY: [9, 2], RI: [10, 2], MA: [11, 2],
  OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3],
  CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
  AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
  OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
  HI: [0, 7], TX: [4, 7], FL: [9, 7],
};

const ATLAS = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json";
let atlasPromise = null;
function loadStates() {
  atlasPromise ??= fetch(ATLAS).then((r) => r.json()).then((topo) => {
    const feats = topojson.feature(topo, topo.objects.states).features.filter((f) => FIPS[f.id]);
    for (const f of feats) f.postal = FIPS[f.id];
    return { feats, mesh: topojson.mesh(topo, topo.objects.states, (a, b) => a !== b) };
  });
  return atlasPromise;
}

/** Hatch pattern defs for "leading" fills: one per party colour. */
export function hatchDefs(svg, colors) {
  const defs = svg.append("defs");
  for (const [k, color] of Object.entries(colors)) {
    const p = defs.append("pattern").attr("id", `hatch-${k}`).attr("patternUnits", "userSpaceOnUse").attr("width", 8).attr("height", 8).attr("patternTransform", "rotate(45)");
    p.append("rect").attr("width", 8).attr("height", 8).attr("fill", color).attr("fill-opacity", 0.35);
    p.append("rect").attr("width", 3.5).attr("height", 8).attr("fill", color);
  }
}

/**
 * Geographic map. fill(postal) → colour or url(#hatch-x); stroke(postal) → {color, width} or null.
 * labels: optional (postal) → text drawn at the state centroid.
 */
export async function drawStateMap(svg, { width = 975, height = 610, fill, stroke, labels } = {}) {
  const { feats, mesh } = await loadStates();
  const fc = { type: "FeatureCollection", features: feats };
  const path = d3.geoPath(d3.geoAlbersUsa().fitSize([width, height], fc));
  svg.selectAll("g.states").remove();
  const g = svg.append("g").attr("class", "states");
  g.selectAll("path.st").data(feats, (d) => d.id).enter().append("path").attr("class", "st").attr("d", path)
    .attr("fill", (d) => fill?.(d.postal) ?? "#1b2a4a").attr("stroke", "#071222").attr("stroke-width", 0.8);
  g.append("path").datum(mesh).attr("fill", "none").attr("stroke", "#071222").attr("stroke-width", 1).attr("d", path);
  if (stroke) g.selectAll("path.hl").data(feats.filter((d) => stroke(d.postal))).enter().append("path").attr("class", "hl").attr("d", path)
    .attr("fill", "none").attr("stroke", (d) => stroke(d.postal).color).attr("stroke-width", (d) => stroke(d.postal).width ?? 3);
  if (labels) g.selectAll("text").data(feats.filter((d) => labels(d.postal))).enter().append("text")
    .attr("x", (d) => path.centroid(d)[0]).attr("y", (d) => path.centroid(d)[1]).attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .attr("fill", "#fff").attr("font-size", 18).attr("font-weight", 700).attr("font-family", "Helvetica Neue, Helvetica, Arial, sans-serif").attr("paint-order", "stroke").attr("stroke", "#071222").attr("stroke-width", 3)
    .text((d) => labels(d.postal));
  return { path };
}

/** Tile map. size = tile edge; fill/stroke as above; sub(postal) → small text under the postal code. */
export function drawTileMap(svg, { size = 68, gap = 6, x0 = 0, y0 = 0, fill, stroke, sub } = {}) {
  svg.selectAll("g.tiles").remove();
  const g = svg.append("g").attr("class", "tiles");
  const states = Object.entries(TILES);
  const t = g.selectAll("g.tile").data(states).enter().append("g").attr("class", "tile").attr("transform", ([, [c, r]]) => `translate(${x0 + c * (size + gap)},${y0 + r * (size + gap)})`);
  t.append("rect").attr("width", size).attr("height", size).attr("rx", 6).attr("fill", ([st]) => fill?.(st) ?? "#1b2a4a").attr("stroke", ([st]) => stroke?.(st)?.color ?? "none").attr("stroke-width", ([st]) => stroke?.(st)?.width ?? 0);
  t.append("text").attr("x", size / 2).attr("y", sub ? size / 2 - 6 : size / 2).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("fill", "#fff").attr("font-size", size * 0.34).attr("font-weight", 700).attr("font-family", "Helvetica Neue, Helvetica, Arial, sans-serif").text(([st]) => st);
  if (sub) t.append("text").attr("x", size / 2).attr("y", size / 2 + 16).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("fill", "#fff").attr("fill-opacity", 0.85).attr("font-size", size * 0.2).attr("font-family", "Helvetica Neue, Helvetica, Arial, sans-serif").text(([st]) => sub(st) ?? "");
  return { cols: 12, rows: 8, width: 12 * (size + gap), height: 8 * (size + gap) };
}
