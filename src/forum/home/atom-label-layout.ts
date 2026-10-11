export type AtomLabelRect = { x: number; y: number; width: number; height: number };
type AtomLabelAnchor = { x: number; y: number; width: number; height: number };
export type AtomLabelState = { side: number; offset: { x: number; y: number } };

const ATOM_LABEL_GAP = 14;
const EDGE = 8;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const overlapArea = (a: AtomLabelRect, b: AtomLabelRect, gap = 0) =>
  Math.max(0, Math.min(a.x + a.width + gap, b.x + b.width) - Math.max(a.x - gap, b.x))
  * Math.max(0, Math.min(a.y + a.height + gap, b.y + b.height) - Math.max(a.y - gap, b.y));

function atomLabelSides(width: number, height: number) {
  const g = ATOM_LABEL_GAP, d = ATOM_LABEL_GAP * .7;
  return [
    { x: g, y: -height / 2 }, { x: -width - g, y: -height / 2 },
    { x: -width / 2, y: -height - g }, { x: -width / 2, y: g },
    { x: d, y: -height - d }, { x: d, y: d },
    { x: -width - d, y: -height - d }, { x: -width - d, y: d },
  ];
}

export function placeAtomLabels(anchors: AtomLabelAnchor[], previous: AtomLabelState[],
  bounds: { width: number; height: number }, obstacles: AtomLabelRect[], center: { x: number; y: number },
  dt: number, immediate = false) {
  const alpha = 1 - Math.exp(-14 * clamp(dt, 0, .04));
  const states: AtomLabelState[] = [], rects: AtomLabelRect[] = [];

  for (const [index, anchor] of anchors.entries()) {
    const { width, height } = anchor, old = previous[index];
    const outX = anchor.x - center.x, outY = anchor.y - center.y, outLength = Math.hypot(outX, outY);
    const [dirX, dirY] = outLength > 1 ? [outX / outLength, outY / outLength] : [1, 0];
    let side = 0, score = Infinity;
    for (const [candidate, offset] of atomLabelSides(width, height).entries()) {
      const box = { x: anchor.x + offset.x, y: anchor.y + offset.y, width, height };
      const out = Math.max(0, EDGE - box.x) + Math.max(0, box.x + width - bounds.width + EDGE)
        + Math.max(0, EDGE - box.y) + Math.max(0, box.y + height - bounds.height + EDGE);
      const toX = box.x + width / 2 - anchor.x, toY = box.y + height / 2 - anchor.y, toLength = Math.hypot(toX, toY) || 1;
      let cost = out * 60 + (1 - (toX * dirX + toY * dirY) / toLength) * 400;
      for (const other of rects) cost += overlapArea(box, other, ATOM_LABEL_GAP / 2) * 4;
      for (const obstacle of obstacles) cost += overlapArea(box, obstacle) * 1.5;
      if (old && old.side === candidate) cost -= 300;
      if (cost < score) { side = candidate; score = cost; }
    }
    const goal = atomLabelSides(width, height)[side];
    const offset = old && !immediate
      ? { x: old.offset.x + (goal.x - old.offset.x) * alpha, y: old.offset.y + (goal.y - old.offset.y) * alpha }
      : goal;
    states.push({ side, offset });
    rects.push({
      x: clamp(anchor.x + offset.x, EDGE, Math.max(EDGE, bounds.width - width - EDGE)),
      y: clamp(anchor.y + offset.y, EDGE, Math.max(EDGE, bounds.height - height - EDGE)),
      width, height,
    });
  }
  return { states, rects };
}
