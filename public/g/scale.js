// Axis helpers shared by the charts that draw a series over the years, so a chart keeps a readable axis whatever its Start year.

/** Years to label on an axis from first to last drawn across px pixels. The step is the smallest of steps whose labels
 *  stay minGap pixels apart; labels fall on multiples of the step (shifted by offset; pass the first year to count from it). The first year is always labelled, the last too with keepLast, and a label too close to either is dropped. */
export function yearTicks(first, last, px, { minGap = 90, steps = [1, 2, 4, 5, 10, 20, 50], offset = 0, keepLast = false } = {}) {
  const per = px / Math.max(1, last - first);
  const step = steps.find((s) => s * per >= minGap) ?? steps.at(-1);
  const ticks = [first];
  for (let y = Math.ceil((first - offset) / step) * step + offset; y <= last; y += step) {
    if ((y - first) * per >= minGap && (!keepLast || (last - y) * per >= minGap)) ticks.push(y);
  }
  if (keepLast && last !== first) ticks.push(last);
  return ticks;
}
