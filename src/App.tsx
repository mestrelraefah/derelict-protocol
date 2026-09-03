/* DERELICT PROTOCOL — first-person sci-fi roguelite dungeon crawler */

import { useEffect, useReducer, useRef, useState } from "react";
import {
  CLASSES, type ClassId, type Member, MONSTERS, FLOOR_POOLS, scaleMonster,
  rollSquad, levelUp, ri, pick, chance, clamp, UPGRADES, loadMeta, saveMeta, type MetaState,
} from "./game/data";
import { genDungeon, type Dungeon, idx, isWall, encounterSize } from "./game/dungeon";
import {
  VIEW, DIRV, drawView, drawMinimap, drawCombat, drawStarfield, newFx,
  type FxState, type EnemyView, type Particle,
} from "./game/render";
import { initAudio, sfx, toggleMute, isMuted } from "./game/audio";

/* ================= types ================= */

const MAX_FLOOR = 5;
const SECTOR_NAMES = ["", "CARGO HOLD", "CREW DECK", "REACTOR RING", "COMMAND SPIRE", "CORE SANCTUM"];

interface LogLine { t: string; c: string; k: number; }
interface CombatEnemy extends EnemyView { atk: number; def: number; xp: number; cores: number; }
interface Combat {
  enemies: CombatEnemy[];
  queue: number[];
  actorIdx: number;
  phase: "choose" | "busy" | "won";
  target: number;
  round: number;
  boss: boolean;
  ambush: boolean;
}
interface GS {
  mode: "title" | "squad" | "run" | "over" | "win";
  sub: "explore" | "combat" | "descend";
  paused: boolean;
  dungeon: Dungeon;
  pos: { x: number; y: number };
  dir: number;
  explored: Set<number>;
  party: Member[];
  items: { medkit: number; revive: number };
  cores: number; kills: number; steps: number;
  floor: number;
  time0: number; elapsed: number;
  combat: Combat | null;
  fx: FxState;
  log: LogLine[];
  logKey: number;
  lastEncounter: number;
  bob: number;
  token: number;
  toasts: { id: number; t: string; c: string }[];
  toastKey: number;
  introBanner: boolean;
}

let toastId = 0;
const freshDungeon = () => genDungeon(1);

function newGs(): GS {
  const d = freshDungeon();
  return {
    mode: "title", sub: "explore", paused: false,
    dungeon: d, pos: { ...d.start }, dir: 2, explored: new Set(),
    party: [], items: { medkit: 2, revive: 0 },
    cores: 0, kills: 0, steps: 0, floor: 1,
    time0: 0, elapsed: 0, combat: null, fx: newFx(),
    log: [], logKey: 0, lastEncounter: 0, bob: 0, token: 0,
    toasts: [], toastKey: 0, introBanner: false,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ================= component ================= */

export default function App() {
  const gsRef = useRef<GS>(newGs());
  const [, force] = useReducer((x: number) => x + 1, 0);
  const sync = () => force();

  const bgRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);

  const [meta, setMeta] = useState<MetaState>(() => loadMeta());
  const [muted, setMuted] = useState(isMuted());
  const [squadPrev, setSquadPrev] = useState<Member[]>([]);

  const gs = gsRef.current;

  /* ---------- helpers ---------- */
  const log = (t: string, c = "#7188b3") => {
    const g = gsRef.current;
    g.log.push({ t, c, k: g.logKey++ });
    if (g.log.length > 42) g.log.shift();
  };
  const toast = (t: string, c = "#3fe3ff") => {
    const g = gsRef.current;
    const id = ++toastId;
    g.toasts.push({ id, t, c });
    setTimeout(() => {
      g.toasts = g.toasts.filter((x) => x.id !== id);
      sync();
    }, 2900);
  };
  const burst = (x: number, y: number, color: string, n: number, spd = 160) => {
    const fx = gsRef.current.fx;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spd * (0.3 + Math.random() * 0.7);
      fx.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9, color,
        size: 2 + Math.random() * 3.5, grav: 260,
      } as Particle);
    }
  };
  const floatText = (x: number, y: number, text: string, color: string, big = false) => {
    gsRef.current.fx.texts.push({ x: x + (Math.random() - 0.5) * 24, y, text, color, life: 1.1, maxLife: 1.1, big });
  };

  /* ---------- meta ---------- */
  const commitMeta = (m: MetaState) => { setMeta({ ...m }); saveMeta(m); };
  const buyUpgrade = (uid: string) => {
    initAudio();
    const def = UPGRADES.find((u) => u.id === uid)!;
    const lvl = meta.up[uid] ?? 0;
    if (lvl >= def.max) return;
    const cost = def.costs[lvl];
    if (meta.cores < cost) { sfx.denied(); return; }
    sfx.core();
    const m = { ...meta, cores: meta.cores - cost, up: { ...meta.up, [uid]: lvl + 1 } };
    commitMeta(m);
  };

  /* ---------- run setup ---------- */
  const openSquad = () => {
    initAudio(); sfx.ui();
    setSquadPrev(rollSquad(meta.up.vitals ?? 0, meta.up.armory ?? 0));
    gsRef.current.mode = "squad";
    sync();
  };
  const rerollSquad = () => {
    initAudio(); sfx.ui();
    setSquadPrev(rollSquad(meta.up.vitals ?? 0, meta.up.armory ?? 0));
  };

  const startRun = () => {
    initAudio(); sfx.stairs();
    const g = gsRef.current;
    g.token++;
    const d = freshDungeon();
    g.mode = "run"; g.sub = "explore"; g.paused = false;
    g.dungeon = d; g.pos = { ...d.start }; g.dir = 2;
    g.explored = new Set(); g.party = squadPrev.map((m) => ({ ...m }));
    g.items = { medkit: 2 + (meta.up.supply ?? 0), revive: meta.up.supply >= 2 ? 1 : 0 };
    g.cores = 0; g.kills = 0; g.steps = 0; g.floor = 1;
    g.time0 = performance.now(); g.elapsed = 0;
    g.combat = null; g.fx = newFx(); g.log = []; g.logKey = 0;
    g.lastEncounter = 0; g.bob = 0; g.toasts = []; g.introBanner = false;
    commitMeta({ ...meta, runs: meta.runs + 1 });
    log("▸ DROP POD DOCKED — ERV KARKINOS, SECTOR 1: " + SECTOR_NAMES[1], "#3fe3ff");
    log("Find the stairwell. Reach the Core Sanctum. Kill the Sentinel.", "#7188b3");
    reveal(g);
    sync();
  };

  const reveal = (g: GS) => {
    const { x, y } = g.pos;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < g.dungeon.w && ny < g.dungeon.h && !isWall(g.dungeon, nx, ny))
          g.explored.add(idx(g.dungeon, nx, ny));
      }
  };

  /* ---------- movement & events ---------- */
  const tryMove = (kind: "fwd" | "back" | "left" | "right" | "turnL" | "turnR") => {
    const g = gsRef.current;
    if (g.mode !== "run" || g.paused || g.sub !== "explore") return;
    initAudio();
    if (kind === "turnL" || kind === "turnR") {
      g.dir = (g.dir + (kind === "turnR" ? 1 : 3)) % 4;
      sfx.turn(); g.bob = 0.35;
      sync(); return;
    }
    const dv =
      kind === "fwd" ? DIRV[g.dir] :
      kind === "back" ? DIRV[(g.dir + 2) % 4] :
      kind === "left" ? DIRV[(g.dir + 3) % 4] : DIRV[(g.dir + 1) % 4];
    const nx = g.pos.x + dv.x, ny = g.pos.y + dv.y;
    if (isWall(g.dungeon, nx, ny)) {
      sfx.bump(); g.fx.shake = Math.max(g.fx.shake, 5);
      sync(); return;
    }
    g.pos = { x: nx, y: ny }; g.steps++; g.bob = 1;
    sfx.move();
    reveal(g);
    afterStep(g);
    sync();
  };

  const afterStep = (g: GS) => {
    const k = idx(g.dungeon, g.pos.x, g.pos.y);
    const ev = g.dungeon.events.get(k);
    if (ev && !ev.used) { handleEvent(g, ev.type, k); return; }
    // random encounter
    if (g.steps - g.lastEncounter > 3 && chance(0.13 + 0.022 * g.floor)) {
      const n = encounterSize(g.floor);
      const ids = Array.from({ length: n }, () => pick(FLOOR_POOLS[g.floor]));
      log("Sensors spike — hostiles closing!", "#ff4d6d");
      startCombat(g, ids, false, false);
    }
  };

  const handleEvent = (g: GS, type: string, k: number) => {
    const ev = g.dungeon.events.get(k)!;
    ev.used = true;
    switch (type) {
      case "stairs":
        sfx.stairs();
        g.sub = "descend";
        log("Stairwell detected — hatch to SECTOR " + (g.floor + 1) + " is open.", "#ffb84d");
        break;
      case "boss":
        sfx.boss();
        g.fx.flashColor = "#ff4d6d"; g.fx.flashA = 0.5; g.fx.shake = 14;
        log("⚠ THE CORE SENTINEL DETACHES FROM THE REACTOR. NO RETREAT.", "#ff4d6d");
        startCombat(g, ["sentinel"], true, false);
        break;
      case "treasure": {
        if (chance(0.12)) {
          sfx.alarm();
          log("The cache was RIGGED — ambush!", "#ff4d6d");
          const n = encounterSize(g.floor);
          startCombat(g, Array.from({ length: n }, () => pick(FLOOR_POOLS[g.floor])), false, true);
        } else {
          sfx.core();
          g.fx.flashColor = "#ffd76a"; g.fx.flashA = 0.18;
          const roll = Math.random();
          if (roll < 0.34) { g.items.medkit++; log("Supply cache: +1 MEDKIT.", "#ffd76a"); toast("+1 MEDKIT", "#ffd76a"); }
          else if (roll < 0.55) { g.items.revive++; log("Supply cache: +1 REVIVE STIM.", "#ffd76a"); toast("+1 REVIVE STIM", "#ffd76a"); }
          else { const c = ri(4, 8) + g.floor; g.cores += c; log(`Supply cache: +${c} DATA CORES.`, "#ffd76a"); toast(`+${c} DATA CORES`, "#ffd76a"); }
        }
        break;
      }
      case "trap": {
        if (chance(0.55)) {
          sfx.trap();
          const alive = g.party.filter((m) => !m.down);
          const m = pick(alive);
          const dmg = ri(6, 10) + g.floor * 3;
          m.hp = Math.max(0, m.hp - dmg);
          g.fx.hurt = 1; g.fx.shake = 8;
          log(`Plasma conduit bursts — ${m.name} takes ${dmg}!`, "#ff4d6d");
          if (m.hp <= 0) { m.down = true; sfx.memberDown(); log(`${m.name} is DOWN!`, "#ff4d6d"); checkWipe(g); }
        } else {
          sfx.alarm();
          log("Tripwire alarm! Something is coming — FAST.", "#ffb84d");
          const n = Math.min(4, encounterSize(g.floor) + 1);
          startCombat(g, Array.from({ length: n }, () => pick(FLOOR_POOLS[g.floor])), false, true);
        }
        break;
      }
      case "shrine": {
        sfx.shrine();
        g.fx.healGlow = 1;
        g.fx.flashColor = "#59ffb0"; g.fx.flashA = 0.14;
        for (const m of g.party) {
          m.down = false; m.hp = m.maxHp; m.ep = m.maxEp; m.guard = false;
        }
        log("Nanite shrine hums — the squad is fully restored.", "#59ffb0");
        toast("SQUAD RESTORED", "#59ffb0");
        break;
      }
      case "core": {
        sfx.core();
        const c = 5 + g.floor + ri(0, 3);
        g.cores += c;
        g.fx.flashColor = "#3fe3ff"; g.fx.flashA = 0.14;
        log(`Salvaged a data cache: +${c} DATA CORES.`, "#3fe3ff");
        toast(`+${c} DATA CORES`, "#3fe3ff");
        break;
      }
    }
  };

  const checkWipe = (g: GS) => {
    if (g.party.every((m) => m.down)) endRun(g, false);
  };

  const endRun = (g: GS, won: boolean) => {
    g.token++;
    const banked = g.cores + (won ? 50 : 0);
    const m: MetaState = {
      ...meta,
      cores: meta.cores + banked,
      bestFloor: Math.max(meta.bestFloor, g.floor),
      bestKills: Math.max(meta.bestKills, g.kills),
      wins: meta.wins + (won ? 1 : 0),
    };
    commitMeta(m);
    if (won) { sfx.win(); g.mode = "win"; }
    else { sfx.death(); g.mode = "over"; }
    g.combat = null;
    sync();
  };

  const descend = () => {
    const g = gsRef.current;
    if (g.mode !== "run" || g.sub !== "descend") return;
    initAudio(); sfx.stairs();
    g.cores += 10;
    toast("SECTOR CLEARED  +10 DATA CORES", "#ffb84d");
    g.floor += 1;
    g.dungeon = genDungeon(g.floor);
    g.pos = { ...g.dungeon.start };
    g.dir = 2;
    g.explored = new Set();
    g.sub = "explore";
    g.fx.flashColor = "#3fe3ff"; g.fx.flashA = 0.35;
    log(`▸ DESCENDED — SECTOR ${g.floor}: ${SECTOR_NAMES[g.floor]}${g.floor === MAX_FLOOR ? "  ⚠ SENTINEL SIGNATURE DETECTED" : ""}`, g.floor === MAX_FLOOR ? "#ff4d6d" : "#3fe3ff");
    reveal(g);
    sync();
  };

  /* ---------- combat ---------- */
  const startCombat = (g: GS, ids: string[], boss: boolean, ambush: boolean) => {
    g.lastEncounter = g.steps;
    const enemies: CombatEnemy[] = ids.map((id) => {
      const def = MONSTERS[id];
      const s = scaleMonster(id, g.floor);
      return {
        id, name: def.name, hp: s.maxHp, maxHp: s.maxHp, atk: s.atk, def: s.defStat,
        xp: s.xp, cores: s.cores, color: def.color, glow: def.glow, size: def.size,
        flash: 0, lunge: 0, dying: 1, stagger: false,
      };
    });
    g.combat = {
      enemies,
      queue: g.party.filter((m) => !m.down).map((m) => m.id),
      actorIdx: 0, phase: "busy", target: 0, round: 1, boss, ambush,
    };
    g.sub = "combat";
    g.introBanner = true;
    g.fx.shake = Math.max(g.fx.shake, 8);
    g.fx.flashColor = ambush ? "#ffb84d" : "#ff4d6d";
    g.fx.flashA = 0.3;
    sfx.encounter();
    setTimeout(() => { g.introBanner = false; sync(); }, 900);
    const tk = g.token;
    sleep(950).then(() => {
      if (tk !== g.token || !g.combat) return;
      g.combat.phase = "choose";
      sync();
    });
  };

  const ensureTarget = (cb: Combat) => {
    if (!cb.enemies[cb.target] || cb.enemies[cb.target].hp <= 0) {
      const i = cb.enemies.findIndex((e) => e.hp > 0);
      cb.target = i >= 0 ? i : cb.target;
    }
  };

  const enemyCenter = (e: CombatEnemy) => {
    const b = e.box ?? { x: VIEW.w / 2 - 60, y: 220, w: 120, h: 150 };
    return { x: b.x + b.w / 2, y: b.y + b.h / 3 };
  };

  const damageEnemy = (g: GS, cb: Combat, ei: number, raw: number, color: string, critChance = 0.12) => {
    const e = cb.enemies[ei];
    if (!e || e.hp <= 0) return 0;
    const crit = chance(critChance);
    const dmg = Math.max(1, Math.round(raw * (crit ? 1.8 : 1)) - e.def);
    e.hp = Math.max(0, e.hp - dmg);
    e.flash = 1;
    const c = enemyCenter(e);
    floatText(c.x, c.y - 20, `${dmg}`, crit ? "#ffd76a" : color, crit);
    burst(c.x, c.y, crit ? "#ffd76a" : color, crit ? 26 : 14);
    if (crit) { sfx.crit(); g.fx.shake = Math.max(g.fx.shake, 7); }
    else sfx.hit();
    if (e.hp <= 0) {
      e.dying = 1;
      sfx.enemyDie();
      g.kills++;
      log(`${e.name} destroyed.`, "#59ffb0");
      burst(c.x, c.y, e.glow, 30, 220);
    }
    return dmg;
  };

  const act = async (action: "strike" | "skill" | "guard" | "medkit" | "flee") => {
    const g = gsRef.current;
    const cb = g.combat;
    if (!cb || cb.phase !== "choose" || g.paused) return;
    const m = g.party.find((p) => p.id === cb.queue[cb.actorIdx]);
    if (!m || m.down) { advanceActor(g, cb); return; }
    cb.phase = "busy";
    sync();
    const tk = g.token;
    const ok = () => tk === g.token && g.combat === cb;

    ensureTarget(cb);
    const cdef = CLASSES[m.cls];

    if (action === "flee") {
      if (cb.boss) {
        log("The Sentinel seals the corridor — NO ESCAPE.", "#ff4d6d");
        sfx.denied();
      } else if (chance(0.55 + cb.round * 0.05)) {
        sfx.flee();
        log("The squad slips into the dark. Contact broken.", "#7188b3");
        g.combat = null; g.sub = "explore"; g.lastEncounter = g.steps;
        sync(); return;
      } else {
        log("Escape failed — hostiles block the corridor!", "#ffb84d");
        sfx.denied();
      }
      await sleep(500);
      if (!ok()) return;
      if (g.combat) await enemyPhase(g, cb);
      return;
    }

    if (action === "strike") {
      const c = enemyCenter(cb.enemies[cb.target]);
      g.fx.beams.push({ x1: VIEW.w / 2, y1: VIEW.h + 10, x2: c.x, y2: c.y, life: 0.22, maxLife: 0.22, color: "#3fe3ff" });
      await sleep(90); if (!ok()) return;
      damageEnemy(g, cb, cb.target, m.atk + ri(0, 4), "#3fe3ff");
      log(`${m.name} fires on ${cb.enemies[cb.target].name}.`, "#7188b3");
    } else if (action === "skill") {
      if (m.ep < cdef.skill.cost) { sfx.denied(); cb.phase = "choose"; sync(); return; }
      m.ep -= cdef.skill.cost;
      if (m.cls === "vanguard") {
        sfx.railgun();
        const c = enemyCenter(cb.enemies[cb.target]);
        g.fx.beams.push({ x1: VIEW.w / 2, y1: VIEW.h + 10, x2: c.x, y2: c.y, life: 0.3, maxLife: 0.3, color: "#ff7a3a" });
        g.fx.shake = Math.max(g.fx.shake, 6);
        await sleep(110); if (!ok()) return;
        damageEnemy(g, cb, cb.target, (m.atk + ri(0, 4)) * 2.3, "#ff7a3a", 0.2);
        log(`${m.name} unleashes RAILGUN BURST!`, "#ff7a3a");
      } else if (m.cls === "medic") {
        sfx.heal();
        const wounded = g.party.filter((p) => !p.down && p.hp < p.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] ?? m;
        const amt = 26 + 7 * m.level;
        wounded.hp = clamp(wounded.hp + amt, 0, wounded.maxHp);
        g.fx.healGlow = 1;
        floatText(180 + wounded.id * 160, 500, `+${amt}`, "#59ffb0", true);
        burst(180 + wounded.id * 160, 520, "#59ffb0", 16, 120);
        log(`${m.name} casts NANO MEND — ${wounded.name} +${amt} HP.`, "#59ffb0");
      } else if (m.cls === "psion") {
        sfx.psion();
        log(`${m.name} tears through with MIND SPIKE!`, "#b78bff");
        for (let i = 0; i < cb.enemies.length; i++) {
          const e = cb.enemies[i];
          if (e.hp <= 0) continue;
          const c = enemyCenter(e);
          g.fx.rings.push({ x: c.x, y: c.y, r: 8, vr: 240, life: 0.4, maxLife: 0.4, color: "#b78bff" });
        }
        await sleep(130); if (!ok()) return;
        for (let i = 0; i < cb.enemies.length; i++) {
          const e = cb.enemies[i];
          if (e.hp <= 0) continue;
          damageEnemy(g, cb, i, (m.atk + ri(0, 3)) * 0.85, "#b78bff", 0.08);
          if (ok() && e.hp > 0 && chance(0.25)) { e.stagger = true; log(`${e.name} is STAGGERED.`, "#b78bff"); }
        }
      } else if (m.cls === "tech") {
        sfx.tesla();
        log(`${m.name} discharges TESLA FIELD!`, "#3fe3ff");
        for (const e of cb.enemies) {
          if (e.hp <= 0) continue;
          const c = enemyCenter(e);
          g.fx.rings.push({ x: c.x, y: c.y, r: 6, vr: 300, life: 0.35, maxLife: 0.35, color: "#3fe3ff" });
        }
        g.fx.flashColor = "#3fe3ff"; g.fx.flashA = 0.12;
        await sleep(130); if (!ok()) return;
        for (let i = 0; i < cb.enemies.length; i++)
          if (cb.enemies[i].hp > 0) damageEnemy(g, cb, i, (m.atk + ri(0, 3)) * 1.0, "#3fe3ff", 0.08);
      }
    } else if (action === "guard") {
      sfx.guard();
      m.guard = true;
      log(`${m.name} raises guard. (+EP trickle)`, "#ffb84d");
      m.ep = clamp(m.ep + 4, 0, m.maxEp);
    } else if (action === "medkit") {
      if (g.items.medkit <= 0) { sfx.denied(); cb.phase = "choose"; sync(); return; }
      const wounded = g.party.filter((p) => !p.down && p.hp < p.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (!wounded) { sfx.denied(); cb.phase = "choose"; sync(); return; }
      g.items.medkit--;
      sfx.heal();
      const amt = 45;
      wounded.hp = clamp(wounded.hp + amt, 0, wounded.maxHp);
      g.fx.healGlow = 1;
      floatText(180 + wounded.id * 160, 500, `+${amt}`, "#59ffb0");
      log(`${m.name} uses a MEDKIT — ${wounded.name} +${amt} HP.`, "#59ffb0");
    }

    await sleep(430);
    if (!ok()) return;

    if (cb.enemies.every((e) => e.hp <= 0)) { await winCombat(g, cb); return; }
    advanceActor(g, cb);
  };

  const advanceActor = (g: GS, cb: Combat) => {
    cb.actorIdx++;
    while (cb.actorIdx < cb.queue.length) {
      const m = g.party.find((p) => p.id === cb.queue[cb.actorIdx]);
      if (m && !m.down) break;
      cb.actorIdx++;
    }
    if (cb.actorIdx >= cb.queue.length) {
      enemyPhase(g, cb);
    } else {
      cb.phase = "choose";
      ensureTarget(cb);
      sync();
    }
  };

  const enemyPhase = async (g: GS, cb: Combat) => {
    const tk = g.token;
    const ok = () => tk === g.token && g.combat === cb && g.mode === "run";
    await sleep(420);
    for (let i = 0; i < cb.enemies.length; i++) {
      if (!ok()) return;
      const e = cb.enemies[i];
      if (e.hp <= 0) continue;
      if (e.stagger) {
        e.stagger = false;
        log(`${e.name} reels, unable to act.`, "#b78bff");
        await sleep(300);
        continue;
      }
      const alive = g.party.filter((m) => !m.down);
      if (!alive.length) return;
      const m = pick(alive);
      e.lunge = 1;
      await sleep(180); if (!ok()) return;
      let dmg = Math.max(1, e.atk + ri(0, 3) - m.def);
      if (m.guard) dmg = Math.max(1, Math.round(dmg * 0.4));
      m.hp = Math.max(0, m.hp - dmg);
      g.fx.hurt = 1;
      g.fx.shake = Math.max(g.fx.shake, 7);
      sfx.hurt();
      floatText(180 + m.id * 160, 505, `-${dmg}`, m.guard ? "#ffb84d" : "#ff4d6d");
      log(`${e.name} hits ${m.name} for ${dmg}${m.guard ? " (guarded)" : ""}.`, "#ff4d6d");
      if (m.hp <= 0) {
        m.down = true; m.guard = false;
        sfx.memberDown();
        log(`☠ ${m.name} is DOWN!`, "#ff4d6d");
        g.fx.flashColor = "#ff4d6d"; g.fx.flashA = 0.3;
        if (g.party.every((p) => p.down)) { await sleep(700); if (ok()) endRun(g, false); return; }
      }
      sync();
      await sleep(380);
    }
    // boss void pulse every 3 rounds
    if (ok() && cb.boss && cb.round % 3 === 0) {
      log("⚠ CORE SENTINEL channels a VOID PULSE!", "#ff4d6d");
      sfx.boss();
      g.fx.rings.push({ x: VIEW.w / 2, y: 300, r: 30, vr: 520, life: 0.7, maxLife: 0.7, color: "#ff4d6d" });
      g.fx.flashColor = "#ff4d6d"; g.fx.flashA = 0.28;
      await sleep(350); if (!ok()) return;
      for (const m of g.party) {
        if (m.down) continue;
        let dmg = Math.max(1, Math.round((cb.enemies[0].atk * 0.55) + ri(0, 4) - m.def));
        if (m.guard) dmg = Math.max(1, Math.round(dmg * 0.4));
        m.hp = Math.max(0, m.hp - dmg);
        floatText(180 + m.id * 160, 505, `-${dmg}`, "#ff4d6d");
        if (m.hp <= 0) { m.down = true; log(`☠ ${m.name} is DOWN!`, "#ff4d6d"); }
      }
      g.fx.hurt = 1; g.fx.shake = 12; sfx.hurt();
      if (g.party.every((p) => p.down)) { await sleep(700); if (ok()) endRun(g, false); return; }
      sync();
      await sleep(400);
    }
    if (!ok()) return;
    // new round
    cb.round++;
    for (const m of g.party) { m.guard = false; if (!m.down) m.ep = clamp(m.ep + 3, 0, m.maxEp); }
    cb.queue = g.party.filter((m) => !m.down).map((m) => m.id);
    cb.actorIdx = 0;
    cb.phase = "choose";
    ensureTarget(cb);
    log(`— ROUND ${cb.round} —`, "#7188b3");
    sync();
  };

  const winCombat = async (g: GS, cb: Combat) => {
    const tk = g.token;
    cb.phase = "won";
    sync();
    const xpSum = cb.enemies.reduce((s, e) => s + e.xp, 0);
    const coreSum = cb.enemies.reduce((s, e) => s + e.cores, 0);
    g.cores += coreSum;
    await sleep(650);
    if (tk !== g.token) return;
    log(`Victory! +${xpSum} XP, +${coreSum} DATA CORES.`, "#ffd76a");
    toast(`+${coreSum} DATA CORES`, "#ffd76a");
    if (chance(0.2)) { g.items.medkit++; log("The wreckage yields a MEDKIT.", "#ffd76a"); }
    for (const m of g.party) {
      if (m.down) continue;
      m.xp += xpSum;
      while (m.xp >= m.xpNext) {
        m.xp -= m.xpNext;
        levelUp(m, meta.up.armory ?? 0);
        sfx.level();
        g.fx.flashColor = "#ffd76a"; g.fx.flashA = 0.2;
        log(`★ ${m.name} reached LEVEL ${m.level}!`, "#ffd76a");
        toast(`${m.name} → LVL ${m.level}`, "#ffd76a");
      }
    }
    sync();
    await sleep(900);
    if (tk !== g.token) return;
    if (cb.boss) { endRun(g, true); return; }
    g.combat = null;
    g.sub = "explore";
    g.lastEncounter = g.steps;
    sync();
  };

  const useRevive = (memberId: number) => {
    const g = gsRef.current;
    if (g.items.revive <= 0) { sfx.denied(); return; }
    const m = g.party.find((p) => p.id === memberId);
    if (!m || !m.down) return;
    initAudio(); sfx.heal();
    g.items.revive--;
    m.down = false;
    m.hp = Math.round(m.maxHp * 0.35);
    g.fx.healGlow = 1;
    log(`REVIVE STIM — ${m.name} is back on their feet!`, "#59ffb0");
    toast(`${m.name} REVIVED`, "#59ffb0");
    sync();
  };

  const useMedkitField = () => {
    const g = gsRef.current;
    if (g.mode !== "run" || g.items.medkit <= 0) { sfx.denied(); return; }
    const wounded = g.party.filter((p) => !p.down && p.hp < p.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!wounded) { sfx.denied(); return; }
    initAudio(); sfx.heal();
    g.items.medkit--;
    wounded.hp = clamp(wounded.hp + 45, 0, wounded.maxHp);
    g.fx.healGlow = 1;
    log(`MEDKIT — ${wounded.name} +45 HP.`, "#59ffb0");
    sync();
  };

  const togglePause = () => {
    const g = gsRef.current;
    if (g.mode !== "run") return;
    if (!g.paused) { g.elapsed += (performance.now() - g.time0) / 1000; g.paused = true; sfx.uiBack(); }
    else { g.time0 = performance.now(); g.paused = false; sfx.ui(); }
    sync();
  };

  const quitToTitle = () => {
    const g = gsRef.current;
    g.token++;
    g.mode = "title";
    g.combat = null;
    sfx.uiBack();
    sync();
  };

  /* ---------- input ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gsRef.current;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (k === "m") { setMuted(toggleMute()); return; }
      if (g.mode === "title" && (k === "enter" || k === " ")) { openSquad(); return; }
      if (g.mode === "squad" && k === "enter") { startRun(); return; }
      if (g.mode === "over" || g.mode === "win") { if (k === "enter") quitToTitle(); return; }
      if (g.mode !== "run") return;
      if (k === "p" || k === "escape") { togglePause(); return; }
      if (g.paused) return;
      if (g.sub === "descend" && k === "enter") { descend(); return; }
      if (g.sub === "explore") {
        if (k === "w" || k === "arrowup") tryMove("fwd");
        else if (k === "s" || k === "arrowdown") tryMove("back");
        else if (k === "arrowleft" || k === "q") tryMove("turnL");
        else if (k === "arrowright" || k === "e") tryMove("turnR");
        else if (k === "a") tryMove("left");
        else if (k === "d") tryMove("right");
      } else if (g.sub === "combat" && g.combat?.phase === "choose") {
        if (k === "1") act("strike");
        else if (k === "2") act("skill");
        else if (k === "3") act("guard");
        else if (k === "4") act("medkit");
        else if (k === "5") act("flee");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, squadPrev]);

  /* ---------- render loop ---------- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tRef.current += dt;
      const t = tRef.current;
      const g = gsRef.current;
      const fx = g.fx;

      // fx decay & updates
      fx.shake = Math.max(0, fx.shake - dt * 26);
      fx.flashA = Math.max(0, fx.flashA - dt * 1.8);
      fx.hurt = Math.max(0, fx.hurt - dt * 1.6);
      fx.healGlow = Math.max(0, fx.healGlow - dt * 1.2);
      g.bob = Math.max(0, g.bob - dt * 2.6);
      fx.particles = fx.particles.filter((p) => {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
        return p.life > 0;
      });
      fx.texts = fx.texts.filter((ft) => { ft.life -= dt; ft.y -= 46 * dt; return ft.life > 0; });
      fx.beams = fx.beams.filter((b) => { b.life -= dt; return b.life > 0; });
      fx.rings = fx.rings.filter((r) => { r.life -= dt; r.r += r.vr * dt; return r.life > 0; });
      if (g.combat) {
        for (const e of g.combat.enemies) {
          e.flash = Math.max(0, e.flash - dt * 4.5);
          e.lunge = Math.max(0, e.lunge - dt * 3);
          if (e.hp <= 0 && e.dying > 0) e.dying = Math.max(0, e.dying - dt * 1.7);
        }
      }

      // background
      const bg = bgRef.current;
      if (bg) {
        const bctx = bg.getContext("2d");
        if (bctx) {
          if (bg.width !== window.innerWidth || bg.height !== window.innerHeight) {
            bg.width = window.innerWidth; bg.height = window.innerHeight;
          }
          drawStarfield(bctx, bg.width, bg.height, t);
        }
      }

      if (g.mode === "run" || g.mode === "over" || g.mode === "win") {
        const v = viewRef.current;
        if (v) {
          const vctx = v.getContext("2d");
          if (vctx) {
            if (g.sub === "combat" && g.combat) {
              drawCombat(vctx, {
                enemies: g.combat.enemies,
                target: g.combat.target,
                fx, t, boss: g.combat.boss, intro: g.introBanner ? 1 : 0,
              });
            } else {
              drawView(vctx, { dungeon: g.dungeon, pos: g.pos, dir: g.dir, bob: g.bob, t, fx });
            }
          }
        }
        const mp = mapRef.current;
        if (mp) {
          const mctx = mp.getContext("2d");
          if (mctx) drawMinimap(mctx, g.dungeon, g.explored, g.pos, g.dir, t);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------- timer tick ---------- */
  useEffect(() => {
    const iv = setInterval(() => {
      const g = gsRef.current;
      if (g.mode === "run" && !g.paused) sync();
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  /* ---------- log autoscroll ---------- */
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [gs.log.length, gs.mode]);

  /* ---------- combat canvas click → target ---------- */
  const onViewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const g = gsRef.current;
    if (g.sub !== "combat" || !g.combat) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (VIEW.w / rect.width);
    const y = (e.clientY - rect.top) * (VIEW.h / rect.height);
    g.combat.enemies.forEach((en, i) => {
      if (en.hp > 0 && en.box && x >= en.box.x && x <= en.box.x + en.box.w && y >= en.box.y && y <= en.box.y + en.box.h) {
        if (g.combat!.target !== i) { g.combat!.target = i; sfx.select(); sync(); }
      }
    });
  };

  /* ================= render ================= */
  const elapsed = gs.mode === "run" && !gs.paused && gs.time0 ? gs.elapsed + (performance.now() - gs.time0) / 1000 : gs.elapsed;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = Math.floor(elapsed % 60).toString().padStart(2, "0");
  const cb = gs.combat;
  const actor = cb ? gs.party.find((p) => p.id === cb.queue[cb.actorIdx]) : undefined;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <canvas ref={bgRef} className="fixed inset-0 z-0" />
      <div className="pointer-events-none fixed inset-0 z-0" style={{ background: "radial-gradient(ellipse 120% 90% at 50% 110%, rgba(29,48,84,0.35), transparent 60%)" }} />

      {/* ============ TITLE ============ */}
      {gs.mode === "title" && (
        <div className="relative z-10 mx-auto flex min-h-screen max-w-[1240px] flex-col justify-center gap-8 px-6 py-10 lg:flex-row lg:items-center">
          <div className="flex-1 rise-in">
            <div className="mb-3 flex items-center gap-3">
              <span className="led bg-cyan text-cyan" />
              <span className="font-display text-[10px] tracking-[0.4em] text-dim">ROGUELITE CRAWLER // DEEP SPACE</span>
            </div>
            <h1 className="font-display leading-[0.9]">
              <span className="title-glow block text-[64px] font-black tracking-tight text-ink sm:text-[86px]">DERELICT</span>
              <span className="block text-[40px] font-bold tracking-[0.24em] text-transparent sm:text-[54px]" style={{ WebkitTextStroke: "1.5px #3fe3ff" }}>PROTOCOL</span>
            </h1>
            <p className="mt-5 max-w-[520px] text-[15px] leading-relaxed text-dim">
              The colony ship <span className="text-ink">ERV Karkinos</span> went dark mid-jump. Your four-person salvage squad
              drops into its bowels — five decks of corrupted machinery, down to the <span className="text-blood">Core Sentinel</span> that
              killed the crew. Crawl. Fight. Descend. Whatever cores you bank <span className="text-gold">survive your death</span>.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button className="btn btn-amber btn-big" onClick={openSquad}>▸ INITIALIZE SQUAD</button>
              <div className="font-display text-xs tracking-[0.2em] text-dim">
                OR PRESS <span className="text-amber">ENTER</span>
              </div>
            </div>
            <div className="panel cut mt-8 max-w-[560px] p-4">
              <div className="panel-title mb-3">CONTROL SCHEME</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] text-dim">
                <div><K>W</K><K>↑</K> step forward · <K>S</K><K>↓</K> back</div>
                <div><K>←</K><K>Q</K> turn left · <K>→</K><K>E</K> turn right</div>
                <div><K>A</K>/<K>D</K> strafe</div>
                <div><K>1</K>–<K>5</K> combat orders</div>
                <div><K>P</K> pause · <K>M</K> mute</div>
                <div>click hostiles to target</div>
              </div>
            </div>
          </div>
          <div className="w-full max-w-[400px] space-y-4 rise-in" style={{ animationDelay: "0.1s" }}>
            <div className="panel cut p-4">
              <div className="panel-title mb-3">REQUISITIONS — PERMANENT UPGRADES</div>
              {UPGRADES.map((u) => {
                const lvl = meta.up[u.id] ?? 0;
                const maxed = lvl >= u.max;
                const cost = maxed ? 0 : u.costs[lvl];
                return (
                  <div key={u.id} className="mb-3 flex items-center gap-3 last:mb-0">
                    <div className="flex-1">
                      <div className="font-display text-[12px] font-bold tracking-[0.18em]" style={{ color: u.color }}>{u.name}</div>
                      <div className="text-[11px] text-dim">{u.desc}</div>
                      <div className="mt-1 flex gap-1">
                        {Array.from({ length: u.max }).map((_, i) => (
                          <span key={i} className="h-[5px] w-5" style={{ background: i < lvl ? u.color : "#1d3054" }} />
                        ))}
                      </div>
                    </div>
                    <button className="btn btn-ghost px-3 py-2 text-[10px]" disabled={maxed || meta.cores < cost} onClick={() => buyUpgrade(u.id)}>
                      {maxed ? "MAX" : `◆ ${cost}`}
                    </button>
                  </div>
                );
              })}
              <div className="mt-3 border-t border-line pt-2 text-right font-display text-[11px] tracking-[0.2em] text-gold">
                BANKED ◆ {meta.cores}
              </div>
            </div>
            <div className="panel cut p-4">
              <div className="panel-title mb-3">SERVICE RECORD</div>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Stat label="DEEPEST SECTOR" v={meta.bestFloor ? `${meta.bestFloor}/5` : "—"} c="#ffb84d" />
                <Stat label="BEST KILL COUNT" v={String(meta.bestKills)} c="#ff4d6d" />
                <Stat label="DROPS LAUNCHED" v={String(meta.runs)} c="#3fe3ff" />
                <Stat label="SENTINELS SLAIN" v={String(meta.wins)} c="#59ffb0" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ SQUAD SETUP ============ */}
      {gs.mode === "squad" && (
        <div className="relative z-10 mx-auto flex min-h-screen max-w-[1100px] flex-col justify-center px-6 py-10">
          <div className="rise-in">
            <div className="mb-2 flex items-center gap-3">
              <span className="led bg-amber text-amber" />
              <span className="font-display text-[10px] tracking-[0.4em] text-dim">DROP PREPARATION // SQUAD ROSTER</span>
            </div>
            <h2 className="font-display text-4xl font-black tracking-wide text-ink">ASSIGN YOUR <span className="text-amber">SALVAGE SQUAD</span></h2>
            <p className="mt-2 text-[13px] text-dim">Four specialists. One corridor at a time. The dead stay dead — banked cores do not.</p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {squadPrev.map((m, i) => {
                const c = CLASSES[m.cls];
                return (
                  <div key={m.id} className="panel cut p-4 rise-in" style={{ animationDelay: `${i * 0.06}s`, borderColor: `${c.color}55` }}>
                    <ClassIcon cls={m.cls} />
                    <div className="mt-2 font-display text-lg font-bold tracking-[0.12em] text-ink">{m.name}</div>
                    <div className="font-display text-[10px] tracking-[0.24em]" style={{ color: c.color }}>{c.name} · {c.role}</div>
                    <div className="mt-3 space-y-2">
                      <MiniStat label="HP" v={m.maxHp} color="#59ffb0" />
                      <MiniStat label="EP" v={m.maxEp} color="#3fe3ff" />
                      <MiniStat label="ATK" v={m.atk} color="#ff7a3a" />
                      <MiniStat label="DEF" v={m.def} color="#ffb84d" />
                    </div>
                    <div className="mt-3 border-t border-line pt-2 text-[11px] text-dim">
                      <span style={{ color: c.color }}>{c.skill.name}</span> — {c.skill.desc} · {c.skill.cost} EP
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button className="btn btn-amber btn-big" onClick={startRun}>▸ DEPLOY TO THE KARKINOS</button>
              <button className="btn" onClick={rerollSquad}>⟳ RE-ROLL ROSTER</button>
              <button className="btn btn-ghost" onClick={quitToTitle}>◂ BACK</button>
              <span className="text-[11px] text-dim">SUPPLY: {2 + (meta.up.supply ?? 0)} medkits{meta.up.supply >= 2 ? " + 1 revive stim" : ""} at drop</span>
            </div>
          </div>
        </div>
      )}

      {/* ============ GAME ============ */}
      {(gs.mode === "run" || gs.mode === "over" || gs.mode === "win") && (
        <div className="relative z-10 mx-auto max-w-[1360px] px-3 py-3 lg:px-5">
          {/* header */}
          <header className="panel cut mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`led ${gs.mode !== "run" ? "bg-blood text-blood" : gs.sub === "combat" ? "bg-blood text-blood" : "bg-mint text-mint"}`} />
              <span className="font-display text-sm font-black tracking-[0.2em] text-ink">DERELICT<span className="text-cyan">//</span>PROTOCOL</span>
            </div>
            <div className="font-display text-[11px] tracking-[0.22em] text-amber">
              SECTOR {gs.floor}/5 · {SECTOR_NAMES[gs.floor]}
            </div>
            <div className="hidden font-display text-[11px] tracking-[0.22em] text-dim sm:block">
              GRID {String(gs.pos.x).padStart(2, "0")}:{String(gs.pos.y).padStart(2, "0")} · {["N", "E", "S", "W"][gs.dir]}
            </div>
            <div className="ml-auto flex items-center gap-4">
              <span className="stat-num text-[13px] text-dim">{mm}:{ss}</span>
              <span className="stat-num text-[13px] text-blood">☠ {gs.kills}</span>
              <span className="stat-num text-[13px] font-bold text-gold">◆ {gs.cores}</span>
              <button className="btn btn-ghost px-2.5 py-1.5 text-[10px]" onClick={() => setMuted(toggleMute())}>{muted ? "SND OFF" : "SND ON"}</button>
              <button className="btn btn-ghost px-2.5 py-1.5 text-[10px]" onClick={togglePause}>{gs.paused ? "RESUME" : "PAUSE"}</button>
            </div>
          </header>

          <main className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_300px]">
            {/* left: viewport + pad */}
            <div className="min-w-0">
              <div className="panel hud-bracket relative overflow-hidden" style={{ aspectRatio: "960/600" }}>
                <canvas
                  ref={viewRef} width={VIEW.w} height={VIEW.h}
                  className="h-full w-full cursor-crosshair"
                  onClick={onViewClick}
                />
                <div className="scanlines" />
                <div className="crt-vignette" />

                {/* combat top strip */}
                {gs.sub === "combat" && cb && (
                  <div className="absolute left-3 top-3 space-y-1.5">
                    {cb.enemies.filter((e) => e.hp > 0).map((e) => {
                      const i = cb.enemies.indexOf(e);
                      return (
                        <button
                          key={i}
                          onClick={() => { if (cb.target !== i) { cb.target = i; sfx.select(); sync(); } }}
                          className={`block w-[190px] border px-2 py-1 text-left transition-all ${cb.target === i ? "border-amber bg-amber/10" : "border-line bg-abyss/70 hover:border-line2"}`}
                        >
                          <div className="flex justify-between font-display text-[10px] tracking-[0.14em]">
                            <span style={{ color: e.glow }}>{e.name}</span>
                            {e.stagger && <span className="text-psiv">STG</span>}
                          </div>
                          <div className="mt-1 h-[5px] w-full bg-hull">
                            <div className="h-full transition-all duration-300" style={{ width: `${(e.hp / e.maxHp) * 100}%`, background: e.glow }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {gs.sub === "combat" && cb && (
                  <div className="absolute right-3 top-3 text-right font-display text-[10px] tracking-[0.2em] text-dim">
                    ROUND {cb.round}{cb.boss && <span className="block text-blood">NO RETREAT</span>}
                    {cb.ambush && <span className="block text-amber">AMBUSH</span>}
                  </div>
                )}

                {/* intro banner */}
                {gs.sub === "combat" && gs.introBanner && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="danger-pulse border-2 border-blood bg-abyss/80 px-8 py-3 font-display text-2xl font-black tracking-[0.3em] text-blood">
                      HOSTILES DETECTED
                    </div>
                  </div>
                )}

                {/* combat action bar */}
                {gs.sub === "combat" && cb && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-abyss via-abyss/90 to-transparent px-3 pb-2.5 pt-8">
                    {actor && cb.phase !== "won" ? (
                      <>
                        <div className="mb-1.5 flex items-center gap-3">
                          <span className="font-display text-[12px] font-bold tracking-[0.18em] text-ink">▸ {actor.name}</span>
                          <span className="font-display text-[9px] tracking-[0.2em]" style={{ color: CLASSES[actor.cls].color }}>{CLASSES[actor.cls].name}</span>
                          <span className="stat-num text-[11px] text-mint">{actor.hp}/{actor.maxHp}</span>
                          <span className="stat-num text-[11px] text-cyan">{actor.ep}/{actor.maxEp} EP</span>
                          {cb.phase === "busy" && <span className="blink font-display text-[10px] tracking-[0.2em] text-amber">RESOLVING…</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <ActBtn n="1" label="STRIKE" onClick={() => act("strike")} disabled={cb.phase !== "choose"} />
                          <ActBtn n="2" label={CLASSES[actor.cls].skill.name} sub={`${CLASSES[actor.cls].skill.cost} EP`}
                            onClick={() => act("skill")} disabled={cb.phase !== "choose" || actor.ep < CLASSES[actor.cls].skill.cost}
                            color={CLASSES[actor.cls].color} />
                          <ActBtn n="3" label="GUARD" sub="+4 EP" onClick={() => act("guard")} disabled={cb.phase !== "choose"} color="#ffb84d" />
                          <ActBtn n="4" label={`MEDKIT ×${gs.items.medkit}`}
                            onClick={() => act("medkit")}
                            disabled={cb.phase !== "choose" || gs.items.medkit <= 0 || !gs.party.some((p) => !p.down && p.hp < p.maxHp)}
                            color="#59ffb0" />
                          <ActBtn n="5" label="FLEE" sub={cb.boss ? "SEALED" : "55%+"} onClick={() => act("flee")} disabled={cb.phase !== "choose" || cb.boss} color="#ff4d6d" />
                        </div>
                      </>
                    ) : cb.phase === "won" ? (
                      <div className="py-2 text-center font-display text-lg font-black tracking-[0.3em] text-mint">AREA SECURED</div>
                    ) : null}
                  </div>
                )}

                {/* descend banner */}
                {gs.sub === "descend" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-abyss/60">
                    <div className="panel cut border-amber/60 p-6 text-center rise-in">
                      <div className="font-display text-[10px] tracking-[0.4em] text-amber">HATCH OPEN</div>
                      <div className="mt-1 font-display text-2xl font-black tracking-[0.14em] text-ink">STAIRWELL DETECTED</div>
                      <div className="mt-1 text-[12px] text-dim">Descend to SECTOR {gs.floor + 1}: {SECTOR_NAMES[gs.floor + 1]}</div>
                      <button className="btn btn-amber btn-big mt-4" onClick={descend}>▸ DESCEND <span className="opacity-60">[ENTER]</span></button>
                    </div>
                  </div>
                )}

                {/* toasts */}
                <div className="pointer-events-none absolute right-3 top-16 space-y-2">
                  {gs.toasts.map((t) => (
                    <div key={t.id} className="toast-anim border px-3 py-1.5 font-display text-[11px] font-bold tracking-[0.16em]"
                      style={{ borderColor: t.c, color: t.c, background: "rgba(4,7,15,0.85)", boxShadow: `0 0 14px ${t.c}44` }}>
                      {t.t}
                    </div>
                  ))}
                </div>

                {/* explore hint */}
                {gs.sub === "explore" && gs.steps < 4 && (
                  <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 font-display text-[10px] tracking-[0.3em] text-dim">
                    <span className="text-cyan">W</span> FORWARD · <span className="text-cyan">Q/E</span> TURN · <span className="text-cyan">A/D</span> STRAFE
                  </div>
                )}
              </div>

              {/* movement pad */}
              <div className="panel cut mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="grid grid-cols-3 gap-1.5">
                  <button className="keycap" onClick={() => tryMove("turnL")}>⟲<span className="sub">Q TURN</span></button>
                  <button className="keycap" onClick={() => tryMove("fwd")}>▲<span className="sub">W FWD</span></button>
                  <button className="keycap" onClick={() => tryMove("turnR")}>⟳<span className="sub">E TURN</span></button>
                  <button className="keycap" onClick={() => tryMove("left")}>◂<span className="sub">A STRAFE</span></button>
                  <button className="keycap" onClick={() => tryMove("back")}>▼<span className="sub">S BACK</span></button>
                  <button className="keycap" onClick={() => tryMove("right")}>▸<span className="sub">D STRAFE</span></button>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-display text-[10px] tracking-[0.24em] text-dim">SUPPLY</div>
                    <div className="mt-1 flex items-center gap-2">
                      <button className="btn btn-mint px-3 py-1.5 text-[10px]" onClick={useMedkitField} disabled={gs.items.medkit <= 0}>
                        ✚ MEDKIT ×{gs.items.medkit}
                      </button>
                      <span className="stat-num text-[12px] text-psiv">◈ STIM ×{gs.items.revive}</span>
                    </div>
                  </div>
                  <div className="hidden max-w-[300px] text-[11px] leading-snug text-dim md:block">
                    {gs.sub === "combat"
                      ? "Click a hostile — or its plate — to target. Orders execute top-down through the squad."
                      : "Glowing floor markers ahead signal caches, shrines and stairwells. Traps don't glow."}
                  </div>
                </div>
              </div>
            </div>

            {/* right column */}
            <aside className="space-y-3">
              <div className="panel cut p-3">
                <div className="panel-title mb-2">DECK SCAN — AUTOMAP</div>
                <canvas ref={mapRef} width={232} height={232} className="mx-auto block" />
              </div>
              <div className="panel cut p-3">
                <div className="panel-title mb-2">SQUAD ROSTER</div>
                <div className="space-y-2">
                  {gs.party.map((m) => {
                    const c = CLASSES[m.cls];
                    const isActor = actor?.id === m.id && cb?.phase !== "won";
                    const hpPct = m.hp / m.maxHp;
                    return (
                      <div key={m.id}
                        className={`relative border p-2 transition-all ${m.down ? "danger-pulse border-blood bg-blood/5" : isActor ? "border-cyan bg-cyan/5" : "border-line bg-hull/40"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isActor && <span className="blink font-display text-[10px] text-cyan">▸</span>}
                            <span className="font-display text-[12px] font-bold tracking-[0.12em] text-ink">{m.name}</span>
                            <span className="font-display text-[8px] tracking-[0.2em]" style={{ color: c.color }}>L{m.level} {c.name}</span>
                          </div>
                          {m.down ? (
                            gs.items.revive > 0
                              ? <button className="btn btn-mint px-2 py-0.5 text-[9px]" onClick={() => useRevive(m.id)}>◈ REVIVE</button>
                              : <span className="font-display text-[9px] tracking-[0.2em] text-blood">DOWN</span>
                          ) : m.guard ? <span className="font-display text-[9px] tracking-[0.2em] text-amber">GUARD</span>
                            : <span className="font-display text-[9px] tracking-[0.2em] text-mint">OK</span>}
                        </div>
                        <div className="mt-1.5 space-y-1">
                          <Bar v={m.hp} max={m.maxHp} color={m.down ? "#ff4d6d" : hpPct > 0.5 ? "#59ffb0" : hpPct > 0.25 ? "#ffb84d" : "#ff4d6d"} label="HP" />
                          <Bar v={m.ep} max={m.maxEp} color="#3fe3ff" label="EP" />
                          <div className="flex items-center gap-2">
                            <span className="w-6 font-display text-[8px] text-dim">XP</span>
                            <div className="h-[3px] flex-1 bg-hull">
                              <div className="h-full bg-psiv transition-all duration-500" style={{ width: `${(m.xp / m.xpNext) * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="panel cut p-3">
                <div className="panel-title mb-2">SHIP LOG<span className="blink text-cyan">▊</span></div>
                <div ref={logRef} className="h-[168px] space-y-1 overflow-y-auto pr-1 text-[11.5px] leading-snug">
                  {gs.log.map((l) => (
                    <div key={l.k} className="rise-in" style={{ color: l.c }}>{l.t}</div>
                  ))}
                </div>
              </div>
            </aside>
          </main>
        </div>
      )}

      {/* ============ PAUSE ============ */}
      {gs.mode === "run" && gs.paused && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-abyss/80">
          <div className="panel cut w-[340px] p-6 text-center rise-in">
            <div className="font-display text-2xl font-black tracking-[0.3em] text-cyan">PAUSED</div>
            <div className="mt-2 text-[12px] text-dim">The Karkinos waits. It is patient.</div>
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn btn-amber" onClick={togglePause}>▸ RESUME [P]</button>
              <button className="btn btn-ghost" onClick={() => { const g = gsRef.current; g.paused = false; quitToTitle(); }}>ABANDON RUN</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ GAME OVER / VICTORY ============ */}
      {(gs.mode === "over" || gs.mode === "win") && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-abyss/85 p-4">
          <div className="panel cut w-full max-w-[520px] p-7 text-center rise-in" style={{ borderColor: gs.mode === "win" ? "#59ffb0" : "#ff4d6d" }}>
            <div className="font-display text-[10px] tracking-[0.4em] text-dim">{gs.mode === "win" ? "MISSION COMPLETE" : "SIGNAL LOST"}</div>
            <h2 className={`mt-1 font-display text-4xl font-black tracking-[0.1em] ${gs.mode === "win" ? "text-mint" : "text-blood"}`}>
              {gs.mode === "win" ? "EXTRACTION" : "SQUAD LOST"}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-dim">
              {gs.mode === "win"
                ? "The Core Sentinel shatters. Reactor light floods the decks — the Karkinos is yours. Salvage crews inbound."
                : `The squad goes dark in SECTOR ${gs.floor}: ${SECTOR_NAMES[gs.floor]}. The Karkinos keeps what it kills.`}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Stat label="SECTOR REACHED" v={`${gs.floor}/5`} c="#ffb84d" />
              <Stat label="HOSTILES DESTROYED" v={String(gs.kills)} c="#ff4d6d" />
              <Stat label="STEPS TAKEN" v={String(gs.steps)} c="#3fe3ff" />
              <Stat label="RUN TIME" v={`${mm}:${ss}`} c="#d7e7ff" />
            </div>
            <div className="mt-4 border border-line bg-hull/50 p-3">
              <div className="font-display text-[10px] tracking-[0.3em] text-dim">DATA CORES BANKED</div>
              <div className="stat-num mt-1 text-3xl font-black text-gold">
                ◆ {gs.cores}{gs.mode === "win" && <span className="text-base text-mint"> +50 BONUS</span>}
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-3">
              <button className="btn btn-amber btn-big" onClick={quitToTitle}>▸ RETURN TO TITLE <span className="opacity-60">[ENTER]</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= small components ================= */

function Bar({ v, max, color, label }: { v: number; max: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 font-display text-[8px] text-dim">{label}</span>
      <div className="h-[7px] flex-1 border border-line bg-hull">
        <div className="h-full transition-all duration-300" style={{ width: `${Math.max(0, (v / max) * 100)}%`, background: color, boxShadow: `0 0 8px ${color}66` }} />
      </div>
      <span className="stat-num w-14 text-right text-[10px] text-ink">{v}/{max}</span>
    </div>
  );
}

function MiniStat({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-dim">{label}</span>
      <span className="stat-num font-bold" style={{ color }}>{v}</span>
    </div>
  );
}

function Stat({ label, v, c }: { label: string; v: string; c: string }) {
  return (
    <div className="border border-line bg-hull/40 px-3 py-2 text-left">
      <div className="font-display text-[8px] tracking-[0.24em] text-dim">{label}</div>
      <div className="stat-num text-lg font-bold" style={{ color: c }}>{v}</div>
    </div>
  );
}

function ActBtn({ n, label, sub, onClick, disabled, color = "#3fe3ff" }: {
  n: string; label: string; sub?: string; onClick: () => void; disabled?: boolean; color?: string;
}) {
  return (
    <button className="btn px-3 py-2 text-[11px]" style={{ "--acc": color } as React.CSSProperties} onClick={onClick} disabled={disabled}>
      <span className="mr-1.5 opacity-50">{n}</span>{label}
      {sub && <span className="ml-1.5 text-[9px] opacity-60">{sub}</span>}
    </button>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return <kbd className="mx-0.5 inline-block border border-line2 bg-panel px-1.5 py-0.5 font-display text-[10px] font-bold text-cyan">{children}</kbd>;
}

function ClassIcon({ cls }: { cls: ClassId }) {
  const c = CLASSES[cls].color;
  const common = { width: 34, height: 34, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: 1.8 } as const;
  return (
    <svg {...common}>
      {cls === "vanguard" && (<><path d="M12 2 20 6v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" /><path d="M8 11h8M12 7v8" /></>)}
      {cls === "medic" && (<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>)}
      {cls === "psion" && (<><circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2 19 19M19 5l-2.8 2.8M7.8 16.2 5 19" /></>)}
      {cls === "tech" && (<><path d="M14.5 2 6 13h5l-1.5 9L18 10h-5l1.5-8Z" /></>)}
    </svg>
  );
}
