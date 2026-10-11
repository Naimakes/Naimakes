import { EXTRACT, dockRect, flightProgress } from "./search-timeline";

export type Rect = { x: number; y: number; w: number; h: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Pose = Box & { depth: number; facing: number };
export type Motion = { poses: Pose[]; presence: Box; emerge: number };
export type Site = { x: number; y: number; depth: number; travel: number; lane: number; block: number };
export type ExtractionFrame = { width: number; height: number; area: Rect; wells: Rect[] };
export type ExtractionPlan = { picks: number[]; x: number; y: number; depth: number; span: number; overlap: number };
type Framing = { k: number; ox: number; oy: number };
type Attempt = { picks: number[]; framing: Framing; overlap: number; score: number };

export const POSE_STEP = 0.01;
const SPACING = 0.5;
const REUSE_GAP = 0.25;
const FLIGHT_CLEAR = 0.3;
const CLEAR = 4;
const EMERGE = 18;
const EDGE = 12;
const SPAN_STEP = 1.075;
const LEVELS = 24;
const SHIFT_STEP = 0.35;
const NODES = 1500;
const LEVEL_COST = 2;
const COLUMN_PASSES = [
  { flights: false, distinct: true, bounded: true, column: 2, shifts: 24, replays: 3 },
  { flights: false, distinct: true, bounded: true, column: 1, shifts: 16, replays: 3 },
];
const PASSES = [
  { flights: false, distinct: true, bounded: true, column: 0, shifts: 24, replays: 3 },
  { flights: false, distinct: true, bounded: true, column: 0, shifts: 10, replays: 6 },
  { flights: false, distinct: false, bounded: true, column: 0, shifts: 10, replays: 6 },
  { flights: false, distinct: false, bounded: false, column: 0, shifts: 4, replays: 4 },
];

const steps = (seconds: number) => Math.round(seconds / POSE_STEP);
const rectBox = (r: Rect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
const boxRect = (b: Box): Rect => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

function conflictBoxes(poses: Pose[], lag: number) {
  const boxes: Box[] = [];
  for (let j = 0; j + lag < poses.length; j++) {
    const a = poses[j + lag], b = poses[j];
    const box = { x0: a.x0 - b.x1 - SPACING, x1: a.x1 - b.x0 + SPACING, y0: a.y0 - b.y1 - SPACING, y1: a.y1 - b.y0 + SPACING };
    const last = boxes[boxes.length - 1];
    if (last && Math.abs(last.x0 - box.x0) < 0.02 && Math.abs(last.x1 - box.x1) < 0.02 && Math.abs(last.y0 - box.y0) < 0.02 && Math.abs(last.y1 - box.y1) < 0.02) {
      last.x0 = Math.min(last.x0, box.x0);
      last.x1 = Math.max(last.x1, box.x1);
      last.y0 = Math.min(last.y0, box.y0);
      last.y1 = Math.max(last.y1, box.y1);
    } else boxes.push(box);
  }
  return boxes;
}

function overlapArea(a: Box, b: Box) {
  const w = Math.min(a.x1, b.x1) + CLEAR - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) + CLEAR - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function tracks(picked: Site[], motion: Motion, frame: ExtractionFrame, { k, ox, oy }: Framing, depth: number, dist: number) {
  const cx = frame.width / 2, cy = frame.height / 2;
  const handoff = Math.min(steps(EXTRACT.handoff), motion.poses.length - 1);
  const flight = steps(EXTRACT.flight);
  const face = motion.poses[motion.poses.length - 1].depth;
  return picked.map((site, i) => {
    const lean = depth - site.depth - face;
    const track: Box[] = motion.poses.map((pose) => {
      const s = dist / (dist - (site.depth + pose.depth + lean * pose.facing - depth));
      const x = ox + site.x * k, y = oy - site.y * k;
      return { x0: cx + (x + pose.x0 * k - cx) * s, x1: cx + (x + pose.x1 * k - cx) * s, y0: cy + (y - pose.y1 * k - cy) * s, y1: cy + (y - pose.y0 * k - cy) * s };
    });
    const from = boxRect(track[handoff]);
    for (let f = 0; f < flight; f++) track.push(rectBox(dockRect(from, frame.wells[i], flightProgress(f / flight))));
    return track;
  });
}

function replay(paths: Box[][], clearFrom: number, frame: ExtractionFrame, cap: number) {
  const { area, wells } = frame;
  const lag = steps(EXTRACT.gap);
  const lifted = steps(EXTRACT.handoff + EXTRACT.crossfade);
  let bad = 0;
  for (const path of paths)
    for (let j = clearFrom; j < lifted; j++) {
      const b = path[j];
      bad += (Math.max(0, b.x1 - area.x - area.w - EDGE) + Math.max(0, area.x - EDGE - b.x0) + Math.max(0, area.y - EDGE - b.y0) + Math.max(0, b.y1 - area.y - area.h - EDGE)) * 400;
    }
  const total = (paths.length - 1) * lag + (paths[0]?.length ?? 0);
  const shapes: Box[] = [];
  for (let t = 0; t < total && bad <= cap; t++) {
    shapes.length = 0;
    paths.forEach((path, i) => {
      const local = t - i * lag;
      if (local < 0) return;
      const shape = local < path.length ? path[local] : rectBox(wells[i]);
      for (const other of shapes) bad += overlapArea(shape, other);
      shapes.push(shape);
    });
  }
  return bad;
}

function bands(sites: Site[][], motion: Motion, reach: number, low: number) {
  const { presence, emerge } = motion;
  let feasible: [number, number][] = [[-Infinity, Infinity]];
  for (const list of sites) {
    const spans = list
      .map((s): [number, number] => [s.y + presence.y1 - reach, Math.min(s.y + presence.y0 + reach, s.y + emerge + low)])
      .filter(([a, b]) => a <= b)
      .sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    const next: [number, number][] = [];
    for (const [a, b] of feasible) for (const [c, d] of merged) if (Math.max(a, c) <= Math.min(b, d)) next.push([Math.max(a, c), Math.min(b, d)]);
    feasible = next;
    if (!feasible.length) return [];
  }
  return feasible;
}

export function planExtraction(
  sites: Site[][],
  motion: Motion,
  frame: ExtractionFrame,
  view: { dist: number; minSpan: number; groups: number[] },
): ExtractionPlan {
  const n = sites.length;
  const { area, wells, height } = frame;
  const { poses, presence, emerge } = motion;
  const face = poses[poses.length - 1];
  const faceW = face.x1 - face.x0 + REUSE_GAP, faceH = face.y1 - face.y0 + REUSE_GAP;
  const clearFrom = Math.max(0, poses.findIndex((pose) => pose.y0 >= presence.y0 - 1e-6));
  const lag = steps(EXTRACT.gap);
  const rules = [conflictBoxes(poses, lag), conflictBoxes(poses, 2 * lag)];
  const apart = sites.map((list, i) =>
    sites.map((next, j) => {
      if (j <= i) return null;
      const table = new Uint8Array(list.length * next.length);
      const rule = rules[j - i - 1];
      list.forEach((a, p) =>
        next.forEach((b, q) => {
          const dx = b.x - a.x, dy = b.y - a.y;
          const hit = rule ? rule.some((r) => dx > r.x0 && dx < r.x1 && dy > r.y0 && dy < r.y1) : Math.abs(dx) < faceW && Math.abs(dy) < faceH;
          if (!hit) table[p * next.length + q] = 1;
        }),
      );
      return table;
    }),
  );
  const depthOf = (picks: number[]) => Math.max(...picks.map((pick, i) => sites[i][pick].depth + face.depth));
  const plan = ({ picks, framing: { k, ox, oy }, overlap }: Attempt): ExtractionPlan => ({
    picks,
    x: (frame.width / 2 - ox) / k,
    y: (oy - height / 2) / k,
    depth: depthOf(picks),
    span: height / k,
    overlap,
  });
  const anchor = sites.reduce((sum, list) => sum + list[0].y, 0) / Math.max(1, n) + (presence.y0 + presence.y1) / 2;
  let best = null as Attempt | null;
  const attempt = (level: number, pass: (typeof PASSES | typeof COLUMN_PASSES)[number]) => {
    const k = height / (view.minSpan * SPAN_STEP ** level);
    const inset = EDGE / k;
    const reach = area.h / k / 2 - inset;
    const low = (height - EMERGE - area.y - area.h / 2) / k;
    const mids: number[] = [];
    for (const [a, b] of bands(sites, motion, reach, low)) {
      const from = Math.min(b, Math.max(a, anchor));
      for (let m = from; m <= b + 1e-9; m += SHIFT_STEP) mids.push(m);
      for (let m = from - SHIFT_STEP; m >= a - 1e-9; m -= SHIFT_STEP) mids.push(m);
    }
    mids.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
    for (const mid of mids.slice(0, pass.shifts)) {
      const oy = mid * k + area.y + area.h / 2;
      const top = mid + reach, bottom = mid - reach, floor = mid - low;
      const eligible = sites.map((list) =>
        list
          .map((site, index) => ({ site, index }))
          .filter(({ site }) => site.y + presence.y1 <= top + 1e-9 && site.y + presence.y0 >= bottom - 1e-9 && site.y + emerge >= floor - 1e-9)
          .sort((a, b) => a.site.travel - b.site.travel),
      );
      if (eligible.some((list) => !list.length)) continue;
      const sweep = sites.map((list, i) => {
        const w0 = (oy - wells[i].y - wells[i].h) / k, w1 = (oy - wells[i].y) / k;
        return list.map((site) => [Math.min(site.y + face.y0, w0) - FLIGHT_CLEAR, Math.max(site.y + face.y1, w1) + FLIGHT_CLEAR]);
      });
      const flies = (i: number, p: number, j: number, q: number) => {
        const a = sites[i][p], b = sites[j][q];
        if (b.x + presence.x1 + FLIGHT_CLEAR <= a.x + face.x0) return true;
        const [lo, hi] = sweep[i][p];
        return b.y + presence.y0 >= hi || b.y + presence.y1 <= lo;
      };
      const maxWidth = pass.bounded ? area.w / k - 2 * inset : Infinity;
      const picks: number[] = [];
      let nodes = 0, tried = 0, done = false;
      const search = (j: number, x0: number, x1: number) => {
        if (j === n) {
          const framing = { k, ox: area.x + area.w / 2 - ((x0 + x1) / 2) * k, oy };
          const cap = best ? Math.max(0, (best.score - LEVEL_COST * level) * k * k) : Infinity;
          const overlap = replay(tracks(picks.map((pick, i) => sites[i][pick]), motion, frame, framing, depthOf(picks), view.dist), clearFrom, frame, cap);
          const score = overlap / (k * k) + LEVEL_COST * level;
          if (overlap === 0 || !best || score < best.score) best = { picks: [...picks], framing, overlap, score };
          done = overlap === 0 || ++tried >= pass.replays;
          return;
        }
        for (const { site, index } of eligible[j]) {
          if (done || ++nodes > NODES) return;
          let ok = true;
          for (let i = 0; i < j && ok; i++) {
            const fit = apart[i][j]![picks[i] * sites[j].length + index] === 1;
            ok = j - i > 2 ? fit || !pass.distinct : fit && (!pass.flights || flies(i, picks[i], j, index));
          }
          if (ok && pass.column)
            for (let i = 0; i < j && ok; i++) {
              if (view.groups[i] !== view.groups[j]) continue;
              const other = sites[i][picks[i]];
              ok = other.lane === site.lane && (pass.column < 2 || other.block === site.block);
            }
          if (!ok) continue;
          const nx0 = Math.min(x0, site.x + presence.x0), nx1 = Math.max(x1, site.x + presence.x1);
          if (nx1 - nx0 > maxWidth) continue;
          picks[j] = index;
          search(j + 1, nx0, nx1);
        }
      };
      search(0, Infinity, -Infinity);
      if (best && best.overlap === 0) return true;
    }
    return false;
  };
  const grouped = new Set(view.groups).size < n;
  if (n && grouped)
    for (let level = 0; level < LEVELS; level++) for (const pass of COLUMN_PASSES) if (attempt(level, pass)) return plan(best!);
  if (grouped) best = null;
  if (n) for (const pass of PASSES) for (let level = 0; level < LEVELS; level++) if (attempt(level, pass)) return plan(best!);
  if (best) return plan(best);
  const picks = sites.map((list) => list.reduce((b, site, i) => (site.travel < list[b].travel ? i : b), 0));
  return plan({ picks, framing: { k: height / (view.minSpan * SPAN_STEP ** (LEVELS - 1)), ox: area.x + area.w / 2, oy: area.y + area.h / 2 }, overlap: Infinity, score: Infinity });
}
