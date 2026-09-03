/* DERELICT PROTOCOL — procedural WebAudio SFX engine (no assets) */

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem("dp.muted") === "1"; } catch { /* ignore */ }

export function initAudio() {
  if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.42;
    master.connect(ac.destination);
  } catch { ac = null; }
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("dp.muted", muted ? "1" : "0"); } catch { /* ignore */ }
  return muted;
}

interface ToneOpts { f0: number; f1?: number; dur: number; type?: OscillatorType; vol?: number; delay?: number; }
function tone({ f0, f1, dur, type = "square", vol = 0.16, delay = 0 }: ToneOpts) {
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, f0), t0);
  if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise({ dur, vol = 0.14, freq = 1200, delay = 0, q = 0.8 }: { dur: number; vol?: number; freq?: number; delay?: number; q?: number }) {
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

export const sfx = {
  ui()        { tone({ f0: 680, f1: 920, dur: 0.06, type: "square", vol: 0.08 }); },
  uiBack()    { tone({ f0: 420, f1: 260, dur: 0.07, type: "square", vol: 0.07 }); },
  move()      { noise({ dur: 0.05, vol: 0.05, freq: 500 }); tone({ f0: 96, f1: 70, dur: 0.06, type: "triangle", vol: 0.08 }); },
  turn()      { tone({ f0: 320, f1: 210, dur: 0.05, type: "triangle", vol: 0.06 }); },
  bump()      { tone({ f0: 74, f1: 52, dur: 0.09, type: "square", vol: 0.12 }); noise({ dur: 0.06, vol: 0.06, freq: 300 }); },
  hit()       { noise({ dur: 0.09, vol: 0.16, freq: 2400 }); tone({ f0: 230, f1: 70, dur: 0.1, type: "sawtooth", vol: 0.12 }); },
  crit()      { noise({ dur: 0.12, vol: 0.2, freq: 3200 }); tone({ f0: 320, f1: 60, dur: 0.14, type: "sawtooth", vol: 0.16 }); tone({ f0: 1320, f1: 1760, dur: 0.09, type: "square", vol: 0.07, delay: 0.03 }); },
  hurt()      { tone({ f0: 170, f1: 55, dur: 0.2, type: "sawtooth", vol: 0.18 }); noise({ dur: 0.14, vol: 0.12, freq: 800 }); },
  guard()     { tone({ f0: 300, f1: 420, dur: 0.1, type: "triangle", vol: 0.1 }); },
  heal()      { tone({ f0: 520, f1: 660, dur: 0.12, type: "sine", vol: 0.12 }); tone({ f0: 780, f1: 990, dur: 0.16, type: "sine", vol: 0.1, delay: 0.09 }); },
  psion()     { tone({ f0: 980, f1: 240, dur: 0.3, type: "sine", vol: 0.14 }); tone({ f0: 1470, f1: 360, dur: 0.3, type: "sine", vol: 0.08, delay: 0.02 }); },
  tesla()     { tone({ f0: 90, f1: 1100, dur: 0.16, type: "sawtooth", vol: 0.12 }); noise({ dur: 0.18, vol: 0.1, freq: 4000 }); },
  railgun()   { tone({ f0: 1400, f1: 120, dur: 0.18, type: "sawtooth", vol: 0.16 }); noise({ dur: 0.1, vol: 0.18, freq: 5000 }); },
  stairs()    { tone({ f0: 62, f1: 130, dur: 0.7, type: "triangle", vol: 0.16 }); tone({ f0: 124, f1: 260, dur: 0.7, type: "sine", vol: 0.08, delay: 0.1 }); },
  core()      { tone({ f0: 880, dur: 0.1, type: "sine", vol: 0.12 }); tone({ f0: 1318, dur: 0.16, type: "sine", vol: 0.1, delay: 0.08 }); },
  shrine()    { tone({ f0: 392, dur: 0.14, type: "sine", vol: 0.11 }); tone({ f0: 494, dur: 0.14, type: "sine", vol: 0.11, delay: 0.11 }); tone({ f0: 587, dur: 0.22, type: "sine", vol: 0.11, delay: 0.22 }); },
  trap()      { tone({ f0: 700, f1: 500, dur: 0.09, type: "square", vol: 0.13 }); tone({ f0: 500, f1: 340, dur: 0.12, type: "square", vol: 0.13, delay: 0.1 }); },
  alarm()     { tone({ f0: 620, dur: 0.12, type: "square", vol: 0.11 }); tone({ f0: 470, dur: 0.12, type: "square", vol: 0.11, delay: 0.13 }); tone({ f0: 620, dur: 0.12, type: "square", vol: 0.11, delay: 0.26 }); },
  level()     { [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: 0.14, type: "square", vol: 0.1, delay: i * 0.09 })); },
  enemyDie()  { tone({ f0: 300, f1: 40, dur: 0.3, type: "sawtooth", vol: 0.14 }); noise({ dur: 0.25, vol: 0.12, freq: 1000 }); },
  memberDown(){ tone({ f0: 220, f1: 44, dur: 0.7, type: "sawtooth", vol: 0.2 }); noise({ dur: 0.4, vol: 0.1, freq: 500, delay: 0.05 }); },
  death()     { [220, 174, 138, 92, 58].forEach((f, i) => tone({ f0: f, f1: f * 0.8, dur: 0.34, type: "sawtooth", vol: 0.14, delay: i * 0.22 })); },
  win()       { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone({ f0: f, dur: 0.22, type: "square", vol: 0.1, delay: i * 0.12 })); tone({ f0: 1568, dur: 0.6, type: "sine", vol: 0.09, delay: 0.74 }); },
  flee()      { noise({ dur: 0.25, vol: 0.1, freq: 2600 }); tone({ f0: 300, f1: 900, dur: 0.2, type: "triangle", vol: 0.08 }); },
  boss()      { tone({ f0: 46, f1: 40, dur: 1.1, type: "sawtooth", vol: 0.22 }); tone({ f0: 49, f1: 43, dur: 1.1, type: "sawtooth", vol: 0.16 }); noise({ dur: 0.8, vol: 0.08, freq: 240 }); },
  encounter() { tone({ f0: 180, f1: 320, dur: 0.1, type: "square", vol: 0.11 }); tone({ f0: 240, f1: 420, dur: 0.12, type: "square", vol: 0.11, delay: 0.1 }); },
  select()    { tone({ f0: 900, f1: 1200, dur: 0.05, type: "square", vol: 0.06 }); },
  denied()    { tone({ f0: 220, f1: 160, dur: 0.1, type: "square", vol: 0.09 }); },
};
