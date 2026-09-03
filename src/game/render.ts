/* DERELICT PROTOCOL — canvas renderer: pseudo-3D corridor, automap, combat scene */

import type { Dungeon } from "./dungeon";
import { isWall, idx } from "./dungeon";

export const VIEW = { w: 960, h: 600 };
const CW = VIEW.w, CH = VIEW.h;
const CX = CW / 2, CY = 282, HW = CW / 2, HH = CH / 2 - 6;
const DEPTH = 5;

/* direction vectors: 0=N 1=E 2=S 3=W */
export const DIRV = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/* ---------------- fx types ---------------- */
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; grav: number; }
export interface FloatText { x: number; y: number; text: string; color: string; life: number; maxLife: number; big: boolean; }
export interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; maxLife: number; color: string; }
export interface Ring { x: number; y: number; r: number; vr: number; life: number; maxLife: number; color: string; }
export interface FxState {
  particles: Particle[]; texts: FloatText[]; beams: Beam[]; rings: Ring[];
  shake: number; flashColor: string; flashA: number; hurt: number; healGlow: number;
}
export const newFx = (): FxState => ({ particles: [], texts: [], beams: [], rings: [], shake: 0, flashColor: "#ffffff", flashA: 0, hurt: 0, healGlow: 0 });

export interface EnemyView {
  id: string; name: string; hp: number; maxHp: number;
  color: string; glow: string; size: number;
  flash: number; lunge: number; dying: number; stagger: boolean;
  box?: { x: number; y: number; w: number; h: number };
}

/* ---------------- helpers ---------------- */
const hash2 = (x: number, y: number) => {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return Math.abs(n ^ (n >> 16));
};
const light = (k: number) => 0.95 * Math.pow(0.76, Math.max(0, k - 1));
const wallFill = (L: number) => `rgb(${Math.round(26 * L + 9)},${Math.round(42 * L + 11)},${Math.round(70 * L + 15)})`;

function frame(s: number) {
  return { x0: CX - HW * s, x1: CX + HW * s, y0: CY - HH * s, y1: CY + HH * s };
}
const sc = (d: number) => 1 / (d + 1);

/* ---------------- starfield background ---------------- */
const stars = Array.from({ length: 140 }, () => ({
  x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, tw: Math.random() * Math.PI * 2,
}));
export function drawStarfield(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#050a16");
  g.addColorStop(0.5, "#04070f");
  g.addColorStop(1, "#060913");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const neb = (nx: number, ny: number, r: number, c: string) => {
    const rg = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
    rg.addColorStop(0, c); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(nx - r, ny - r, r * 2, r * 2);
  };
  neb(w * 0.82 + Math.sin(t * 0.05) * 30, h * 0.2, 260, "rgba(63,227,255,0.045)");
  neb(w * 0.12, h * 0.75 + Math.cos(t * 0.04) * 24, 300, "rgba(183,139,255,0.04)");
  neb(w * 0.5, h * 0.4, 380, "rgba(255,77,109,0.025)");
  for (const s of stars) {
    const sx = (s.x * w + t * 2.2 * s.z) % w;
    const a = 0.25 + 0.6 * s.z * (0.6 + 0.4 * Math.sin(t * 1.7 + s.tw));
    ctx.fillStyle = `rgba(190,225,255,${a.toFixed(3)})`;
    const sz = s.z > 0.8 ? 2 : 1;
    ctx.fillRect(sx, s.y * h, sz, sz);
  }
}

/* ---------------- dungeon view ---------------- */
export interface ViewOpts {
  dungeon: Dungeon;
  pos: { x: number; y: number };
  dir: number;
  bob: number;
  t: number;
  fx: FxState;
}

export function drawView(ctx: CanvasRenderingContext2D, o: ViewOpts) {
  const { dungeon: d, pos, dir, t, fx } = o;
  const bobY = o.bob * 9 * Math.sin(o.t * 26);
  const swayX = Math.sin(t * 0.7) * 2.2;
  const swayY = Math.sin(t * 1.1) * 1.4;

  ctx.save();
  ctx.clearRect(0, 0, CW, CH);
  const shx = (Math.random() - 0.5) * fx.shake;
  const shy = (Math.random() - 0.5) * fx.shake;
  ctx.translate(swayX + shx, swayY + shy + bobY);

  ctx.fillStyle = "#04070f";
  ctx.fillRect(-24, -24, CW + 48, CH + 48);

  const f5 = frame(sc(DEPTH));

  // ceiling
  let g = ctx.createLinearGradient(0, 0, 0, CY);
  g.addColorStop(0, "#0c1729");
  g.addColorStop(1, "#060b16");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-24, -24); ctx.lineTo(CW + 24, -24);
  ctx.lineTo(f5.x1, f5.y0); ctx.lineTo(f5.x0, f5.y0);
  ctx.closePath(); ctx.fill();

  // floor
  g = ctx.createLinearGradient(0, CH, 0, CY);
  g.addColorStop(0, "#12203a");
  g.addColorStop(1, "#060b16");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-24, CH + 24); ctx.lineTo(CW + 24, CH + 24);
  ctx.lineTo(f5.x1, f5.y1); ctx.lineTo(f5.x0, f5.y1);
  ctx.closePath(); ctx.fill();

  // floor grid + ceiling ribs
  ctx.strokeStyle = "rgba(63,227,255,0.09)";
  ctx.lineWidth = 1;
  for (let k = 1; k <= DEPTH; k++) {
    const f = frame(sc(k));
    ctx.beginPath(); ctx.moveTo(f.x0, f.y1); ctx.lineTo(f.x1, f.y1); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(63,227,255,0.12)";
  ctx.beginPath(); ctx.moveTo(0, CH); ctx.lineTo(f5.x0, f5.y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CW, CH); ctx.lineTo(f5.x1, f5.y1); ctx.stroke();
  ctx.strokeStyle = "rgba(63,227,255,0.05)";
  for (let k = 1; k <= DEPTH; k++) {
    const f = frame(sc(k));
    ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y0); ctx.stroke();
  }

  // far fog wall
  ctx.fillStyle = "#04070f";
  ctx.fillRect(f5.x0, f5.y0, f5.x1 - f5.x0, f5.y1 - f5.y0);

  const fwd = DIRV[dir];
  const left = DIRV[(dir + 3) % 4];
  const cellAt = (k: number, off = 0) => ({ x: pos.x + fwd.x * k + left.x * off, y: pos.y + fwd.y * k + left.y * off });
  const eventColor: Record<string, string> = { stairs: "#ffb84d", shrine: "#59ffb0", treasure: "#ffd76a", core: "#3fe3ff", boss: "#ff4d6d" };

  const drawFrontWall = (k: number, cxw: number, cyw: number) => {
    const f = frame(sc(k - 1));
    const L = light(k);
    ctx.fillStyle = wallFill(L);
    ctx.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
    const hsh = hash2(cxw, cyw);
    ctx.strokeStyle = `rgba(5,9,18,${0.55 * L})`;
    ctx.lineWidth = Math.max(1, 4 * sc(k - 1));
    const ix = (f.x1 - f.x0) * 0.14, iy = (f.y1 - f.y0) * 0.12;
    ctx.strokeRect(f.x0 + ix, f.y0 + iy, f.x1 - f.x0 - ix * 2, f.y1 - f.y0 - iy * 2);
    ctx.beginPath();
    ctx.moveTo(CX, f.y0 + iy); ctx.lineTo(CX, f.y1 - iy);
    ctx.stroke();
    ctx.strokeStyle = `rgba(63,227,255,${0.4 * L})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(f.x0 + 1, f.y0 + 1, f.x1 - f.x0 - 2, f.y1 - f.y0 - 2);
    if (hsh % 4 === 0) {
      const flick = 0.72 + 0.28 * Math.sin(t * 3.1 + (hsh % 7));
      const sy = f.y0 + (f.y1 - f.y0) * 0.3;
      const shh = Math.max(2, (f.y1 - f.y0) * 0.045);
      ctx.fillStyle = `rgba(255,184,77,${0.55 * L * flick})`;
      ctx.fillRect(f.x0 + ix, sy, f.x1 - f.x0 - ix * 2, shh);
      ctx.fillStyle = `rgba(255,184,77,${0.14 * L * flick})`;
      ctx.fillRect(f.x0 + ix, sy - shh, f.x1 - f.x0 - ix * 2, shh * 3);
    }
    if (hsh % 3 === 0) {
      ctx.strokeStyle = `rgba(10,16,30,${0.7 * L})`;
      ctx.lineWidth = Math.max(1, (f.x1 - f.x0) * 0.02);
      const px = f.x0 + (f.x1 - f.x0) * (0.25 + 0.25 * ((hsh >> 4) % 3));
      ctx.beginPath(); ctx.moveTo(px, f.y0 + iy); ctx.lineTo(px, f.y1 - iy); ctx.stroke();
    }
  };

  const drawSide = (side: "L" | "R", k: number, cxw: number, cyw: number) => {
    const near = k === 0 ? frame(1.7) : frame(sc(k - 1));
    const far = frame(sc(k));
    const L = light(k) * 0.6;
    const xN = side === "L" ? near.x0 : near.x1;
    const xF = side === "L" ? far.x0 : far.x1;
    ctx.fillStyle = wallFill(L);
    ctx.beginPath();
    ctx.moveTo(xN, near.y0); ctx.lineTo(xF, far.y0);
    ctx.lineTo(xF, far.y1); ctx.lineTo(xN, near.y1);
    ctx.closePath(); ctx.fill();
    const hsh = hash2(cxw * 3 + (side === "L" ? 1 : 9), cyw * 5 + k);
    ctx.strokeStyle = `rgba(5,9,18,${0.5 * L})`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(xN, near.y0 + (near.y1 - near.y0) * (0.25 + 0.25 * i));
      ctx.lineTo(xF, far.y0 + (far.y1 - far.y0) * (0.25 + 0.25 * i));
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(63,227,255,${0.3 * L})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xF, far.y0); ctx.lineTo(xF, far.y1); ctx.stroke();
    ctx.strokeStyle = `rgba(63,227,255,${0.16 * L})`;
    ctx.beginPath(); ctx.moveTo(xN, near.y1); ctx.lineTo(xF, far.y1); ctx.stroke();
    if (hsh % 5 === 0) {
      const flick = 0.7 + 0.3 * Math.sin(t * 2.6 + (hsh % 9));
      ctx.strokeStyle = `rgba(255,184,77,${0.4 * L * flick})`;
      ctx.lineWidth = Math.max(1, (near.y1 - near.y0) * 0.02);
      ctx.beginPath();
      ctx.moveTo(xN, near.y0 + (near.y1 - near.y0) * 0.34);
      ctx.lineTo(xF, far.y0 + (far.y1 - far.y0) * 0.34);
      ctx.stroke();
    }
  };

  for (let k = DEPTH; k >= 0; k--) {
    const c = cellAt(k);
    if (k >= 1) {
      if (isWall(d, c.x, c.y)) { drawFrontWall(k, c.x, c.y); break; }
      const ev = d.events.get(idx(d, c.x, c.y));
      if (ev && !ev.used && eventColor[ev.type]) {
        const fn = frame(sc(k - 1)), ff = frame(sc(k));
        const my = ff.y1 + (fn.y1 - ff.y1) * 0.42;
        const r = Math.max(4, (fn.y1 - ff.y1) * 0.16) * (ev.type === "boss" ? 1.5 : 1);
        const col = eventColor[ev.type];
        const pulse = 0.6 + 0.4 * Math.sin(t * (ev.type === "boss" ? 5 : 2.6) + k);
        ctx.save();
        ctx.translate(CX, my);
        ctx.scale(1, 0.45);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.28 * pulse;
        ctx.fillRect(-r * 1.9, -r * 1.9, r * 3.8, r * 3.8);
        ctx.globalAlpha = 0.85 * pulse;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#04070f";
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.strokeRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.9);
        ctx.restore();
      }
    }
    const lc = cellAt(k, -1), rc = cellAt(k, 1);
    if (isWall(d, lc.x, lc.y)) drawSide("L", k, lc.x, lc.y);
    if (isWall(d, rc.x, rc.y)) drawSide("R", k, rc.x, rc.y);
  }

  // horizon haze
  const hz = ctx.createLinearGradient(0, CY - 70, 0, CY + 90);
  hz.addColorStop(0, "rgba(4,7,15,0)");
  hz.addColorStop(0.5, "rgba(4,7,15,0.55)");
  hz.addColorStop(1, "rgba(4,7,15,0)");
  ctx.fillStyle = hz;
  ctx.fillRect(0, CY - 70, CW, 160);
  ctx.restore();

  const vg = ctx.createRadialGradient(CX, CH / 2, CH * 0.35, CX, CH / 2, CH * 0.85);
  vg.addColorStop(0, "rgba(2,4,10,0)");
  vg.addColorStop(1, "rgba(2,4,10,0.6)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CW, CH);

  drawFxScreen(ctx, fx, CW, CH);
}

/* ---------------- screen-space fx ---------------- */
export function drawFxScreen(ctx: CanvasRenderingContext2D, fx: FxState, w: number, h: number) {
  if (fx.healGlow > 0) {
    const gg = ctx.createRadialGradient(w / 2, h, 40, w / 2, h, h * 0.9);
    gg.addColorStop(0, `rgba(89,255,176,${0.2 * fx.healGlow})`);
    gg.addColorStop(1, "rgba(89,255,176,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.hurt > 0) {
    const hg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.78);
    hg.addColorStop(0, "rgba(255,45,80,0)");
    hg.addColorStop(1, `rgba(255,45,80,${0.5 * fx.hurt})`);
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.flashA > 0) {
    ctx.globalAlpha = Math.min(1, fx.flashA);
    ctx.fillStyle = fx.flashColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}

/* ---------------- minimap ---------------- */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  d: Dungeon,
  explored: Set<number>,
  pos: { x: number; y: number },
  dir: number,
  t: number,
) {
  const W = 232, H = 232;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#060b16";
  ctx.fillRect(0, 0, W, H);
  const cs = Math.floor(Math.min((W - 14) / d.w, (H - 14) / d.h));
  const ox = Math.floor((W - cs * d.w) / 2);
  const oy = Math.floor((H - cs * d.h) / 2);

  ctx.lineWidth = 1.4;
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const k = idx(d, x, y);
      if (!explored.has(k)) continue;
      const px = ox + x * cs, py = oy + y * cs;
      ctx.fillStyle = "rgba(63,227,255,0.05)";
      ctx.fillRect(px, py, cs, cs);
      ctx.strokeStyle = "rgba(63,227,255,0.75)";
      if (isWall(d, x, y - 1)) { ctx.beginPath(); ctx.moveTo(px, py + 0.5); ctx.lineTo(px + cs, py + 0.5); ctx.stroke(); }
      if (isWall(d, x - 1, y)) { ctx.beginPath(); ctx.moveTo(px + 0.5, py); ctx.lineTo(px + 0.5, py + cs); ctx.stroke(); }
      if (isWall(d, x, y + 1)) { ctx.beginPath(); ctx.moveTo(px, py + cs - 0.5); ctx.lineTo(px + cs, py + cs - 0.5); ctx.stroke(); }
      if (isWall(d, x + 1, y)) { ctx.beginPath(); ctx.moveTo(px + cs - 0.5, py); ctx.lineTo(px + cs - 0.5, py + cs); ctx.stroke(); }
      const ev = d.events.get(k);
      if (ev && !ev.used) {
        const cxm = px + cs / 2, cym = py + cs / 2;
        if (ev.type === "stairs") { ctx.fillStyle = "#ffb84d"; ctx.fillRect(cxm - 2, cym - 2, 4, 4); }
        if (ev.type === "boss") {
          const p = 0.6 + 0.4 * Math.sin(t * 5);
          ctx.fillStyle = `rgba(255,77,109,${p})`;
          ctx.save(); ctx.translate(cxm, cym); ctx.rotate(Math.PI / 4); ctx.fillRect(-3, -3, 6, 6); ctx.restore();
        }
        if (ev.type === "shrine") { ctx.strokeStyle = "#59ffb0"; ctx.beginPath(); ctx.moveTo(cxm - 2.5, cym); ctx.lineTo(cxm + 2.5, cym); ctx.moveTo(cxm, cym - 2.5); ctx.lineTo(cxm, cym + 2.5); ctx.stroke(); }
        if (ev.type === "treasure") { ctx.fillStyle = "#ffd76a"; ctx.beginPath(); ctx.arc(cxm, cym, 2, 0, Math.PI * 2); ctx.fill(); }
        if (ev.type === "core") { ctx.fillStyle = "#3fe3ff"; ctx.beginPath(); ctx.arc(cxm, cym, 2, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  }

  const px = ox + pos.x * cs + cs / 2, py = oy + pos.y * cs + cs / 2;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#3fe3ff";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(0, -cs * 0.42);
  ctx.lineTo(cs * 0.34, cs * 0.36);
  ctx.lineTo(0, cs * 0.16);
  ctx.lineTo(-cs * 0.34, cs * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---------------- combat scene ---------------- */
export interface CombatViewOpts {
  enemies: EnemyView[];
  target: number;
  fx: FxState;
  t: number;
  boss: boolean;
  intro: number;
}

export function drawCombat(ctx: CanvasRenderingContext2D, o: CombatViewOpts) {
  const { fx, t } = o;
  ctx.save();
  ctx.clearRect(0, 0, CW, CH);
  ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);

  ctx.fillStyle = "#04070f";
  ctx.fillRect(-24, -24, CW + 48, CH + 48);
  const vx = CX, vy = 292;
  const bw = o.boss ? 330 : 270, bh = o.boss ? 250 : 220;
  let g = ctx.createLinearGradient(0, vy - bh, 0, vy + 30);
  g.addColorStop(0, "#0d1a30");
  g.addColorStop(1, "#08101f");
  ctx.fillStyle = g;
  ctx.fillRect(vx - bw, vy - bh, bw * 2, bh + 30);
  ctx.strokeStyle = "rgba(63,227,255,0.14)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const xx = vx - bw + (bw * 2 * i) / 6;
    ctx.beginPath(); ctx.moveTo(xx, vy - bh); ctx.lineTo(xx, vy + 30); ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const yy = vy - bh + ((bh + 30) * i) / 4;
    ctx.beginPath(); ctx.moveTo(vx - bw, yy); ctx.lineTo(vx + bw, yy); ctx.stroke();
  }
  const seamY = vy - bh * 0.62;
  const seamCol = o.boss ? "255,77,109" : "63,227,255";
  const flick = 0.7 + 0.3 * Math.sin(t * 3);
  ctx.fillStyle = `rgba(${seamCol},${0.5 * flick})`;
  ctx.fillRect(vx - bw, seamY, bw * 2, 3);
  ctx.fillStyle = `rgba(${seamCol},${0.12 * flick})`;
  ctx.fillRect(vx - bw, seamY - 8, bw * 2, 19);
  const side = (x0: number, x1: number) => {
    g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(x0 < x1 ? 0 : 1, "#050a14");
    g.addColorStop(x0 < x1 ? 1 : 0, "#0a1426");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, -24); ctx.lineTo(x1, vy - bh); ctx.lineTo(x1, vy + 30); ctx.lineTo(x0, CH + 24);
    ctx.closePath(); ctx.fill();
  };
  side(-24, vx - bw);
  side(CW + 24, vx + bw);
  g = ctx.createLinearGradient(0, 0, 0, vy - bh);
  g.addColorStop(0, "#050a14");
  g.addColorStop(1, "#0a1424");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-24, -24); ctx.lineTo(CW + 24, -24); ctx.lineTo(vx + bw, vy - bh); ctx.lineTo(vx - bw, vy - bh);
  ctx.closePath(); ctx.fill();
  g = ctx.createLinearGradient(0, CH, 0, vy);
  g.addColorStop(0, "#152442");
  g.addColorStop(1, "#070d1a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-24, CH + 24); ctx.lineTo(CW + 24, CH + 24); ctx.lineTo(vx + bw, vy + 30); ctx.lineTo(vx - bw, vy + 30);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(63,227,255,0.1)";
  for (let i = 1; i <= 5; i++) {
    const p = i / 5;
    const yy = vy + 30 + (CH - vy - 30) * (p * p);
    const xxo = bw + (CW / 2 + 24 - bw) * (p * p);
    ctx.beginPath(); ctx.moveTo(vx - xxo, yy); ctx.lineTo(vx + xxo, yy); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(63,227,255,0.07)";
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(vx + i * 60, vy + 30); ctx.lineTo(vx + i * 210, CH + 24); ctx.stroke();
  }

  const alive = o.enemies;
  const n = alive.length;
  const gap = o.boss ? 0 : Math.min(240, 780 / Math.max(1, n));
  alive.forEach((e, i) => {
    if (e.dying <= 0.02) return; // fully dissolved — keep layout slot, skip draw
    const ex = o.boss ? CX : CX + (i - (n - 1) / 2) * gap;
    const baseY = o.boss ? 350 : 402;
    drawEnemy(ctx, e, ex, baseY, t, i);
  });

  const tgt = o.enemies[o.target];
  if (tgt && tgt.box && tgt.hp > 0) {
    const b = tgt.box;
    const p = 4 + Math.sin(t * 6) * 2.5;
    ctx.strokeStyle = "#ffb84d";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#ffb84d";
    ctx.shadowBlur = 8;
    const c = 14;
    const corners: [number, number, number, number][] = [
      [b.x - p, b.y - p, 1, 1],
      [b.x + b.w + p, b.y - p, -1, 1],
      [b.x - p, b.y + b.h + p, 1, -1],
      [b.x + b.w + p, b.y + b.h + p, -1, -1],
    ];
    for (const [xx, yy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(xx + sx * c, yy);
      ctx.lineTo(xx, yy);
      ctx.lineTo(xx, yy + sy * c);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  drawFxWorld(ctx, fx);
  ctx.restore();
  drawFxScreen(ctx, fx, CW, CH);
}

function drawFxWorld(ctx: CanvasRenderingContext2D, fx: FxState) {
  for (const b of fx.beams) {
    const a = b.life / b.maxLife;
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = a;
    ctx.lineWidth = 7;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  for (const r of fx.rings) {
    const a = r.life / r.maxLife;
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = a * 0.85;
    ctx.lineWidth = 3;
    ctx.shadowColor = r.color;
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  for (const p of fx.particles) {
    const a = p.life / p.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  for (const ft of fx.texts) {
    const a = Math.min(1, (ft.life / ft.maxLife) * 1.6);
    ctx.globalAlpha = a;
    ctx.font = ft.big ? "900 34px Orbitron, sans-serif" : "700 21px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#04070f";
    ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
    ctx.fillStyle = ft.color;
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = 10;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

/* ---------------- monster sprites ---------------- */
function drawEnemy(ctx: CanvasRenderingContext2D, e: EnemyView, ex: number, baseY: number, t: number, i: number) {
  const s = 92 * e.size;
  const bob = Math.sin(t * 2.1 + i * 1.7) * 6;
  const lungeOff = e.lunge * 46;
  const y = baseY + bob + lungeOff * 0.3;
  const alpha = e.dying < 1 ? Math.max(0, e.dying) : 1;
  const scale = (1 + e.lunge * 0.22) * (e.dying < 1 ? 0.6 + 0.4 * e.dying : 1);

  ctx.save();
  ctx.translate(ex, y + (1 - alpha) * 40);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath(); ctx.ellipse(0, 8, s * 0.75, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hexA(e.glow, 0.1);
  ctx.beginPath(); ctx.ellipse(0, 8, s * 0.6, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();

  ctx.shadowColor = e.glow;
  ctx.shadowBlur = 16;
  sprite(ctx, e.id, s, t, e, i);
  ctx.shadowBlur = 0;

  if (e.stagger) {
    ctx.strokeStyle = "#b78bff";
    ctx.lineWidth = 2;
    for (let z = 0; z < 3; z++) {
      const a = t * 4 + (z * Math.PI * 2) / 3;
      const zx = Math.cos(a) * s * 0.5;
      const zy = -s * 1.05 + Math.sin(a) * 6;
      ctx.beginPath();
      ctx.moveTo(zx - 5, zy); ctx.lineTo(zx - 1, zy + 4); ctx.lineTo(zx + 1, zy); ctx.lineTo(zx + 5, zy + 4);
      ctx.stroke();
    }
  }

  if (e.flash > 0) {
    ctx.globalAlpha = alpha * Math.min(1, e.flash * 1.4);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.ellipse(0, -s * 0.45, s * 0.62, s * 0.72, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  e.box = { x: ex - s * 0.7, y: y - s * 1.45, w: s * 1.4, h: s * 1.55 };
}

function hexA(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${gg},${b},${a})`;
}

function sprite(ctx: CanvasRenderingContext2D, id: string, s: number, t: number, e: EnemyView, i: number) {
  const C = e.color, G = e.glow;
  switch (id) {
    case "mite": {
      ctx.fillStyle = C;
      ctx.beginPath(); ctx.ellipse(0, -s * 0.28, s * 0.5, s * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hexA(C, 0.8);
      ctx.beginPath(); ctx.ellipse(-s * 0.02, -s * 0.5, s * 0.3, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexA(C, 0.9);
      ctx.lineWidth = s * 0.06;
      for (let l = 0; l < 3; l++) {
        const wob = Math.sin(t * 8 + l) * s * 0.05;
        ctx.beginPath(); ctx.moveTo(-s * 0.35, -s * 0.25); ctx.quadraticCurveTo(-s * 0.7, -s * 0.4 + wob, -s * 0.66, s * 0.02); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.35, -s * 0.25); ctx.quadraticCurveTo(s * 0.7, -s * 0.4 - wob, s * 0.66, s * 0.02); ctx.stroke();
      }
      ctx.fillStyle = G;
      ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.52, s * 0.05, 0, Math.PI * 2); ctx.arc(s * 0.12, -s * 0.52, s * 0.05, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "drone": {
      const rot = t * 1.6 + i;
      ctx.strokeStyle = hexA(C, 0.9);
      ctx.lineWidth = s * 0.07;
      for (let a = 0; a < 3; a++) {
        ctx.beginPath();
        ctx.arc(0, -s * 0.5, s * 0.55, rot + (a * Math.PI * 2) / 3, rot + (a * Math.PI * 2) / 3 + 1.4);
        ctx.stroke();
      }
      ctx.fillStyle = C;
      ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.34, 0, Math.PI * 2); ctx.fill();
      const coreP = 0.6 + 0.4 * Math.sin(t * 5 + i);
      ctx.fillStyle = hexA(G, coreP);
      ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hexA(G, 0.5 * coreP);
      ctx.beginPath(); ctx.moveTo(-s * 0.12, -s * 0.14); ctx.lineTo(s * 0.12, -s * 0.14); ctx.lineTo(0, s * 0.06 + coreP * s * 0.08); ctx.closePath(); ctx.fill();
      break;
    }
    case "hound": {
      ctx.fillStyle = C;
      ctx.beginPath();
      ctx.moveTo(-s * 0.62, -s * 0.3);
      ctx.quadraticCurveTo(0, -s * 0.66, s * 0.5, -s * 0.42);
      ctx.lineTo(s * 0.66, -s * 0.6);
      ctx.lineTo(s * 0.7, -s * 0.3);
      ctx.quadraticCurveTo(s * 0.4, -s * 0.1, -s * 0.3, -s * 0.14);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexA(C, 0.95);
      ctx.lineWidth = s * 0.09;
      const run = Math.sin(t * 7 + i) * s * 0.08;
      ctx.beginPath(); ctx.moveTo(-s * 0.45, -s * 0.18); ctx.lineTo(-s * 0.52, s * 0.05 + run); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.15, -s * 0.16); ctx.lineTo(-s * 0.1, s * 0.05 - run); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.2, -s * 0.2); ctx.lineTo(s * 0.28, s * 0.05 + run); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.48, -s * 0.28); ctx.lineTo(s * 0.55, s * 0.03 - run); ctx.stroke();
      ctx.fillStyle = G;
      ctx.beginPath(); ctx.arc(s * 0.58, -s * 0.48, s * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexA(G, 0.6 + 0.4 * Math.sin(t * 11));
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let ax = -s * 0.55, ay = -s * 0.42;
      ctx.moveTo(ax, ay);
      for (let z = 0; z < 6; z++) { ax += s * 0.18; ay = -s * 0.42 + (Math.random() - 0.5) * s * 0.3; ctx.lineTo(ax, ay); }
      ctx.stroke();
      break;
    }
    case "stalker": {
      ctx.fillStyle = C;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.95);
      ctx.lineTo(s * 0.34, -s * 0.35);
      ctx.lineTo(s * 0.2, -s * 0.05);
      ctx.lineTo(-s * 0.2, -s * 0.05);
      ctx.lineTo(-s * 0.34, -s * 0.35);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexA(C, 0.95);
      ctx.lineWidth = s * 0.07;
      for (let l = 0; l < 4; l++) {
        const sd = l < 2 ? -1 : 1;
        const k = l % 2;
        const wob = Math.sin(t * 3 + l * 2) * s * 0.04;
        const sx = sd * s * 0.22, sy = -s * (0.3 + k * 0.28);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sd * s * 0.85, sy - s * 0.3, sd * (s * 0.72 + k * s * 0.12), s * 0.02 + wob);
        ctx.stroke();
      }
      ctx.fillStyle = G;
      for (let ei = 0; ei < 3; ei++) {
        ctx.beginPath();
        ctx.arc(-s * 0.1 + ei * s * 0.1, -s * (0.62 - Math.abs(ei - 1) * 0.06), s * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "android": {
      ctx.fillStyle = C;
      ctx.fillRect(-s * 0.28, -s * 0.78, s * 0.56, s * 0.62);
      ctx.fillStyle = hexA(C, 0.85);
      ctx.fillRect(-s * 0.17, -s * 1.02, s * 0.34, s * 0.24);
      ctx.fillRect(-s * 0.3, -s * 0.16, s * 0.24, s * 0.2);
      ctx.fillRect(s * 0.06, -s * 0.16, s * 0.24, s * 0.2);
      ctx.strokeStyle = hexA(C, 0.95);
      ctx.lineWidth = s * 0.09;
      const sw = Math.sin(t * 2.4 + i) * s * 0.06;
      ctx.beginPath(); ctx.moveTo(-s * 0.28, -s * 0.7); ctx.lineTo(-s * 0.55, -s * 0.4 + sw); ctx.lineTo(-s * 0.5, -s * 0.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.28, -s * 0.7); ctx.lineTo(s * 0.62, -s * 0.5 - sw); ctx.stroke();
      ctx.lineWidth = s * 0.045;
      for (let c2 = 0; c2 < 3; c2++) {
        ctx.beginPath(); ctx.moveTo(s * 0.62, -s * 0.5 - sw); ctx.lineTo(s * (0.72 + c2 * 0.05), -s * (0.62 - c2 * 0.06) - sw); ctx.stroke();
      }
      ctx.fillStyle = G;
      ctx.fillRect(-s * 0.14, -s * 0.94, s * 0.28, s * 0.06);
      const cp = 0.5 + 0.5 * Math.sin(t * 4 + i);
      ctx.fillStyle = hexA(G, cp);
      ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.09, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "wraith": {
      const fl = Math.sin(t * 3 + i);
      ctx.fillStyle = hexA(C, 0.32);
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.15);
      ctx.quadraticCurveTo(s * 0.55, -s * 0.8, s * 0.4 + fl * s * 0.06, -s * 0.2);
      ctx.quadraticCurveTo(s * 0.3, -s * 0.02, s * 0.14, -s * 0.16 - fl * 4);
      ctx.quadraticCurveTo(0, s * 0.06, -s * 0.14, -s * 0.16 + fl * 4);
      ctx.quadraticCurveTo(-s * 0.3, -s * 0.02, -s * 0.4 - fl * s * 0.06, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.55, -s * 0.8, 0, -s * 1.15);
      ctx.fill();
      ctx.fillStyle = hexA(C, 0.5);
      ctx.beginPath(); ctx.ellipse(0, -s * 0.68, s * 0.3, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = G;
      ctx.beginPath();
      ctx.ellipse(-s * 0.11, -s * 0.74, s * 0.05, s * 0.09, 0, 0, Math.PI * 2);
      ctx.ellipse(s * 0.11, -s * 0.74, s * 0.05, s * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "acolyte": {
      ctx.fillStyle = C;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.12);
      ctx.lineTo(s * 0.42, -s * 0.1);
      ctx.quadraticCurveTo(0, s * 0.08, -s * 0.42, -s * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#0a0f1c";
      ctx.beginPath(); ctx.ellipse(0, -s * 0.82, s * 0.18, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      const sp = 0.5 + 0.5 * Math.sin(t * 3.4 + i);
      ctx.strokeStyle = hexA(G, 0.4 + 0.6 * sp);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -s * 0.42, s * 0.16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let p2 = 0; p2 <= 6; p2++) {
        const a = (p2 / 6) * Math.PI * 2 + t;
        const px = Math.cos(a) * s * 0.16, py = -s * 0.42 + Math.sin(a) * s * 0.16;
        if (p2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = hexA(G, sp);
      ctx.beginPath(); ctx.arc(0, -s * 0.42, s * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexA(C, 0.9);
      ctx.lineWidth = s * 0.05;
      ctx.beginPath(); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.44, -s * 1.0); ctx.stroke();
      ctx.fillStyle = hexA(G, 0.5 + 0.5 * sp);
      ctx.beginPath(); ctx.arc(s * 0.44, -s * 1.06, s * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = G;
      ctx.beginPath(); ctx.arc(-s * 0.07, -s * 0.84, s * 0.03, 0, Math.PI * 2); ctx.arc(s * 0.07, -s * 0.84, s * 0.03, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "sentinel": {
      const rot = t * 0.5;
      const bp = 0.5 + 0.5 * Math.sin(t * 2.2);
      ctx.fillStyle = hexA(G, 0.14 + 0.1 * bp);
      ctx.beginPath(); ctx.ellipse(0, -s * 0.05, s * 0.62, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.rotate(rot);
      ctx.fillStyle = hexA(C, 0.9);
      ctx.beginPath();
      for (let p3 = 0; p3 < 6; p3++) {
        const a = (p3 / 6) * Math.PI * 2;
        const px = Math.cos(a) * s * 0.52, py = -s * 0.62 + Math.sin(a) * s * 0.52;
        if (p3 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexA(G, 0.9);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.rotate(-rot * 1.6);
      ctx.fillStyle = "#12101f";
      ctx.beginPath();
      for (let p4 = 0; p4 < 4; p4++) {
        const a = (p4 / 4) * Math.PI * 2 + Math.PI / 4;
        const px = Math.cos(a) * s * 0.36, py = -s * 0.62 + Math.sin(a) * s * 0.36;
        if (p4 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      const ep = 0.6 + 0.4 * Math.sin(t * 3.6);
      ctx.fillStyle = hexA(G, ep);
      ctx.beginPath(); ctx.arc(0, -s * 0.62, s * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a060c";
      ctx.beginPath(); ctx.arc(0, -s * 0.62, s * 0.07, 0, Math.PI * 2); ctx.fill();
      for (let sh = 0; sh < 3; sh++) {
        const a = t * 1.3 + (sh * Math.PI * 2) / 3;
        const ox = Math.cos(a) * s * 0.78, oy = -s * 0.62 + Math.sin(a) * s * 0.3;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(a);
        ctx.fillStyle = hexA(G, 0.8);
        ctx.fillRect(-s * 0.07, -s * 0.07, s * 0.14, s * 0.14);
        ctx.restore();
      }
      break;
    }
    default: {
      ctx.fillStyle = C;
      ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }
}
