/* DERELICT PROTOCOL — procedural deck generation (maze + braid + events) */

import { ri, chance } from "./data";

export type EventType = "stairs" | "treasure" | "trap" | "shrine" | "core" | "boss";
export interface CellEvent { type: EventType; used: boolean; }

export interface Dungeon {
  floor: number;
  w: number; h: number;
  walls: Uint8Array;
  start: { x: number; y: number };
  stairs: { x: number; y: number };
  events: Map<number, CellEvent>;
}

export const idx = (d: Dungeon, x: number, y: number) => y * d.w + x;
export const isWall = (d: Dungeon, x: number, y: number) =>
  x < 0 || y < 0 || x >= d.w || y >= d.h || d.walls[y * d.w + x] === 1;

/* recursive backtracker on odd lattice, then braid loops in */
export function genDungeon(floor: number): Dungeon {
  const w = 11 + floor * 2; // 13 → 21
  const h = w;
  const walls = new Uint8Array(w * h).fill(1);
  const at = (x: number, y: number) => y * w + x;

  const carve = (x: number, y: number) => {
    walls[at(x, y)] = 0;
    const dirs = [[0, -2], [2, 0], [0, 2], [-2, 0]].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && walls[at(nx, ny)] === 1) {
        walls[at(x + dx / 2, y + dy / 2)] = 0;
        carve(nx, ny);
      }
    }
  };
  carve(1, 1);

  // braid: knock out some dead-end walls to create loops
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (walls[at(x, y)] === 1) {
        const openH = walls[at(x - 1, y)] === 0 && walls[at(x + 1, y)] === 0;
        const openV = walls[at(x, y - 1)] === 0 && walls[at(x, y + 1)] === 0;
        if (openH !== openV && chance(0.14)) walls[at(x, y)] = 0;
      }
    }
  }

  const floors: { x: number; y: number }[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      if (walls[at(x, y)] === 0) floors.push({ x, y });

  const start = { x: 1, y: 1 };

  // BFS distance from start → farthest reachable cell becomes the stairwell
  const dist = new Int32Array(w * h).fill(-1);
  dist[at(start.x, start.y)] = 0;
  const q: { x: number; y: number }[] = [start];
  let far = start, farD = 0;
  while (q.length) {
    const c = q.shift()!;
    const cd = dist[at(c.x, c.y)];
    if (cd > farD) { farD = cd; far = c; }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && walls[at(nx, ny)] === 0 && dist[at(nx, ny)] === -1) {
        dist[at(nx, ny)] = cd + 1;
        q.push({ x: nx, y: ny });
      }
    }
  }
  const stairs = { ...far };

  const events = new Map<number, CellEvent>();
  const isBossFloor = floor >= 5;
  events.set(at(stairs.x, stairs.y), { type: isBossFloor ? "boss" : "stairs", used: false });

  // sprinkle events on floor cells away from the entry hatch
  const candidates = floors
    .filter((f) => dist[at(f.x, f.y)] > 5 && !(f.x === stairs.x && f.y === stairs.y))
    .sort(() => Math.random() - 0.5);
  const put = (type: EventType, n: number) => {
    let placed = 0;
    while (placed < n && candidates.length) {
      const c = candidates.pop()!;
      const k = at(c.x, c.y);
      if (!events.has(k)) { events.set(k, { type, used: false }); placed++; }
    }
  };
  put("treasure", 3 + Math.min(2, floor - 1));
  put("trap", 2 + Math.floor(floor / 2));
  put("core", 3);
  put("shrine", chance(0.85) ? 1 : 2);

  return { floor, w, h, walls, start, stairs, events };
}

/** how many monsters can appear in a random encounter on this floor */
export function encounterSize(floor: number): number {
  const roll = ri(0, 3);
  const cap = floor <= 1 ? 2 : floor <= 3 ? 3 : 4;
  return Math.min(cap, 1 + Math.floor(floor / 2) + (roll >= 2 ? 1 : 0) - (roll === 0 ? 1 : 0)) || 1;
}
