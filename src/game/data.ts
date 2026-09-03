/* DERELICT PROTOCOL — game data: classes, monsters, meta upgrades, rng */

export type ClassId = "vanguard" | "medic" | "psion" | "tech";

export interface SkillDef { name: string; desc: string; cost: number; }
export interface ClassDef {
  id: ClassId; name: string; role: string; color: string;
  baseHp: number; baseEp: number; baseAtk: number; baseDef: number;
  skill: SkillDef;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  vanguard: {
    id: "vanguard", name: "VANGUARD", role: "BREACHER", color: "#ff7a3a",
    baseHp: 46, baseEp: 18, baseAtk: 11, baseDef: 4,
    skill: { name: "RAILGUN BURST", desc: "2.3× damage to one target", cost: 6 },
  },
  medic: {
    id: "medic", name: "MEDIC", role: "LIFELINE", color: "#59ffb0",
    baseHp: 34, baseEp: 30, baseAtk: 7, baseDef: 2,
    skill: { name: "NANO MEND", desc: "Restore 26 + 7×LVL HP to most wounded", cost: 5 },
  },
  psion: {
    id: "psion", name: "PSION", role: "MINDWIRE", color: "#b78bff",
    baseHp: 30, baseEp: 34, baseAtk: 9, baseDef: 1,
    skill: { name: "MIND SPIKE", desc: "Hit ALL enemies, 25% stagger each", cost: 9 },
  },
  tech: {
    id: "tech", name: "TECH", role: "VOLTEER", color: "#3fe3ff",
    baseHp: 36, baseEp: 26, baseAtk: 9, baseDef: 3,
    skill: { name: "TESLA FIELD", desc: "Shock ALL enemies for 1.0× damage", cost: 8 },
  },
};

export const NAME_POOL = [
  "VEX", "KANE", "SABLE", "OKO", "RIGG", "MARA", "JUNO", "HALCYON",
  "DREZZ", "NYX", "BRANDT", "SURI", "KOVA", "ASH", "PETRA", "MOTH",
  "ILKKA", "ROOK", "ZEPH", "TALIA", "GRIT", "ECHO", "VARN", "LUCE",
];

export interface Member {
  id: number; name: string; cls: ClassId;
  level: number; xp: number; xpNext: number;
  hp: number; maxHp: number; ep: number; maxEp: number;
  atk: number; def: number;
  down: boolean; guard: boolean;
}

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const ri = (a: number, b: number) => Math.floor(rnd(a, b + 1));
export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p: number) => Math.random() < p;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function xpForLevel(level: number) { return 30 + level * 26; }

export function rollSquad(vitalsLvl: number, armoryLvl: number): Member[] {
  const ids: ClassId[] = ["vanguard", "medic", "psion", "tech"];
  const names = [...NAME_POOL].sort(() => Math.random() - 0.5);
  return ids.map((cid, i) => {
    const c = CLASSES[cid];
    const hpBonus = ri(0, 6);
    const maxHp = Math.round((c.baseHp + hpBonus) * (1 + 0.1 * vitalsLvl));
    return {
      id: i, name: names[i], cls: cid,
      level: 1, xp: 0, xpNext: xpForLevel(1),
      hp: maxHp, maxHp,
      ep: c.baseEp, maxEp: c.baseEp,
      atk: Math.round(c.baseAtk * (1 + 0.08 * armoryLvl)) + ri(0, 2),
      def: c.baseDef + ri(0, 1),
      down: false, guard: false,
    };
  });
}

export function levelUp(m: Member, armoryLvl: number): Member {
  const c = CLASSES[m.cls];
  m.level += 1;
  m.xpNext = xpForLevel(m.level);
  const hpGain = 10 + Math.round(c.baseHp * 0.18) + ri(0, 4);
  m.maxHp += hpGain;
  m.maxEp += 4 + ri(0, 3);
  m.atk += 2 + (m.cls === "vanguard" ? 1 : 0) + Math.round(0.08 * armoryLvl);
  m.def += 1;
  m.hp = clamp(m.hp + Math.round(m.maxHp * 0.55), 0, m.maxHp);
  m.ep = clamp(m.ep + Math.round(m.maxEp * 0.6), 0, m.maxEp);
  if (m.down && m.hp > 0) m.down = false;
  return m;
}

/* ---------------- monsters ---------------- */

export interface MonsterDef {
  id: string; name: string; tier: number;
  hp: number; atk: number; def: number;
  xp: number; cores: number;
  color: string; glow: string; size: number;
}

export const MONSTERS: Record<string, MonsterDef> = {
  mite:    { id: "mite",    name: "RUST MITE",      tier: 1, hp: 14, atk: 5,  def: 0, xp: 9,  cores: 1, color: "#c97b4a", glow: "#ff9d5c", size: 0.55 },
  drone:   { id: "drone",   name: "NULL DRONE",     tier: 1, hp: 20, atk: 7,  def: 1, xp: 13, cores: 2, color: "#8fa8c9", glow: "#3fe3ff", size: 0.7 },
  hound:   { id: "hound",   name: "VOLT HOUND",     tier: 2, hp: 30, atk: 10, def: 1, xp: 19, cores: 2, color: "#7d8aa6", glow: "#9be8ff", size: 0.85 },
  stalker: { id: "stalker", name: "SCRAP STALKER",  tier: 2, hp: 38, atk: 12, def: 2, xp: 24, cores: 3, color: "#a66b6b", glow: "#ff4d6d", size: 1.0 },
  android: { id: "android", name: "FERAL ANDROID",  tier: 3, hp: 52, atk: 15, def: 3, xp: 32, cores: 4, color: "#9aa7bd", glow: "#ff7a3a", size: 1.05 },
  wraith:  { id: "wraith",  name: "PSIONIC WRAITH", tier: 3, hp: 44, atk: 18, def: 2, xp: 36, cores: 4, color: "#8f7fc9", glow: "#b78bff", size: 0.95 },
  acolyte: { id: "acolyte", name: "CORE ACOLYTE",   tier: 4, hp: 64, atk: 20, def: 4, xp: 46, cores: 6, color: "#c9b98f", glow: "#ffd76a", size: 1.1 },
  sentinel:{ id: "sentinel",name: "CORE SENTINEL",  tier: 5, hp: 340, atk: 24, def: 5, xp: 220, cores: 60, color: "#c94f63", glow: "#ff4d6d", size: 2.1 },
};

export const FLOOR_POOLS: string[][] = [
  [],
  ["mite", "mite", "drone"],
  ["drone", "hound", "stalker"],
  ["stalker", "hound", "android", "wraith"],
  ["android", "wraith", "acolyte"],
  ["wraith", "acolyte", "acolyte"],
];

export function scaleMonster(id: string, floor: number) {
  const d = MONSTERS[id];
  const mult = 1 + 0.16 * (floor - 1);
  return {
    def: d,
    maxHp: Math.round(d.hp * mult),
    atk: Math.round(d.atk * mult),
    defStat: d.def + Math.floor((floor - 1) / 2),
    xp: Math.round(d.xp * mult),
    cores: d.cores + Math.floor((floor - 1) / 2),
  };
}

/* ---------------- meta upgrades ---------------- */

export interface UpgradeDef { id: "vitals" | "armory" | "supply"; name: string; desc: string; max: number; costs: number[]; color: string; }
export const UPGRADES: UpgradeDef[] = [
  { id: "vitals", name: "VITALS", desc: "+10% squad max HP per rank", max: 5, costs: [20, 45, 80, 130, 200], color: "#59ffb0" },
  { id: "armory", name: "ARMORY", desc: "+8% squad damage per rank", max: 5, costs: [25, 55, 95, 150, 220], color: "#ff7a3a" },
  { id: "supply", name: "SUPPLY", desc: "+1 medkit at deployment per rank", max: 3, costs: [15, 40, 90], color: "#3fe3ff" },
];

export interface MetaState { cores: number; up: Record<string, number>; bestFloor: number; bestKills: number; runs: number; wins: number; }
export const META_KEY = "dp.meta.v1";

export function loadMeta(): MetaState {
  const def: MetaState = { cores: 0, up: { vitals: 0, armory: 0, supply: 0 }, bestFloor: 0, bestKills: 0, runs: 0, wins: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<MetaState>;
      if (m && typeof m.cores === "number" && m.up) {
        return {
          cores: m.cores,
          up: { vitals: 0, armory: 0, supply: 0, ...m.up },
          bestFloor: m.bestFloor ?? 0,
          bestKills: m.bestKills ?? 0,
          runs: m.runs ?? 0,
          wins: m.wins ?? 0,
        };
      }
    }
  } catch { /* ignore */ }
  return def;
}
export function saveMeta(m: MetaState) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
