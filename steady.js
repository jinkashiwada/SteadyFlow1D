const canvas = document.getElementById("steadyCanvas");
const ctx = canvas.getContext("2d");
const lang = document.documentElement.lang && document.documentElement.lang.startsWith("en") ? "en" : "ja";
const text = {
  ja: {
    particleNone: "なし",
    particleNoTrail: "あり（黒）",
    particleTrail: "あり（白）",
    submergedJump: "下流水位支配の接続",
    freeJump: "跳水接続",
    noJump: "跳水なし",
    mild: "緩勾配",
    steep: "急勾配",
    weirCrest: "堰頂",
    downstreamEnd: "下流端",
    upstreamControl: "上流支配",
    gateSuffix: count => ` + ゲート${count}基`,
    tailwaterLabel: "下流端水位",
    depthRatio: "h下/h2",
    showInfo: "情報を表示",
    hideInfo: "情報を隠す",
    showSettings: "設定",
    hideSettings: "設定を隠す",
    axisAuto: "縦軸　変動 ●　固定",
    axisFixed: "縦軸　変動　固定 ●"
  },
  en: {
    particleNone: "None",
    particleNoTrail: "On (black)",
    particleTrail: "On (white)",
    submergedJump: "Tailwater-controlled transition",
    freeJump: "Jump connection",
    noJump: "No jump",
    mild: "Mild slope",
    steep: "Steep slope",
    weirCrest: "Crest control",
    downstreamEnd: "Tailwater control",
    upstreamControl: "Upstream control",
    gateSuffix: count => ` + ${count} gate${count === 1 ? "" : "s"}`,
    tailwaterLabel: "Tailwater",
    depthRatio: "h_tail/h2",
    showInfo: "Show info",
    hideInfo: "Hide info",
    showSettings: "Settings",
    hideSettings: "Hide settings",
    axisAuto: "Axis  Auto ●  Fixed",
    axisFixed: "Axis  Auto  Fixed ●"
  }
}[lang];

const ui = {
  app: document.querySelector(".app"),
  flow: document.getElementById("flow"),
  tail: document.getElementById("tail"),
  mann: document.getElementById("mann"),
  particles: document.getElementById("particles"),
  viewMode: document.getElementById("viewMode"),
  addGate: document.getElementById("addSteadyGate"),
  deleteGate: document.getElementById("deleteSteadyGate"),
  toggleHud: document.getElementById("toggleHud"),
  togglePanel: document.getElementById("togglePanel"),
  toggleAxis: document.getElementById("toggleAxis"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
  flowOut: document.getElementById("flowOut"),
  tailOut: document.getElementById("tailOut"),
  mannOut: document.getElementById("mannOut"),
  particlesOut: document.getElementById("particlesOut"),
  profileClass: document.getElementById("profileClass"),
  controlState: document.getElementById("controlState"),
  readout: document.getElementById("steadyReadout")
};

const N = 50;
const L = 100;
const dx = L / N;
const g = 9.81;
const minDepth = 0.04;
const minGateClearance = 0.16;
const CdGate = 0.62;
const CcGate = 0.61;

const model = {
  z: new Float64Array(N),
  eta: new Float64Array(N),
  targetEta: new Float64Array(N),
  source: Array.from({ length: N }, () => "tailwater"),
  froude: new Float64Array(N),
  gates: [],
  selectedGate: -1,
  activePreset: "",
  jumps: [],
  particles: [],
  spawnCarry: 0,
  bedAnimation: null,
  axisLocked: true,
  drag: null
};

let view = {
  w: 1,
  h: 1,
  left: 58,
  right: 22,
  top: 28,
  bottom: 56,
  minY: 0,
  maxY: 5,
  yTick: 1.0
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function idX(i) {
  return (i + 0.5) * dx;
}

function initialBed(x) {
  const slope = 0.0105 * x;
  const sill = 0.48 * Math.exp(-Math.pow((x - 56) / 10.5, 2));
  const step = x > 68 ? 0.16 : 0;
  return 1.0 - slope + sill + step;
}

function uniformBedValue(x, upstream, slope) {
  return upstream - slope * x;
}

function setUniformBed(upstream, slope) {
  for (let i = 0; i < N; i++) model.z[i] = uniformBedValue(idX(i), upstream, slope);
}

function setSillBed(upstream, slope, sillHeight, sillX, sillWidth) {
  for (let i = 0; i < N; i++) {
    const x = idX(i);
    model.z[i] = uniformBedValue(x, upstream, slope) + sillHeight * Math.exp(-Math.pow((x - sillX) / sillWidth, 2));
  }
}

const presets = {
  "mild-gate-low": {
    flow: 2.00,
    tail: 1.80,
    mann: 0.029,
    bed: () => setUniformBed(1.10, 0.0032),
    gates: [{ x: 42, clearance: 0.42 }]
  },
  "mild-gate-high": {
    flow: 2.00,
    tail: 2.80,
    mann: 0.029,
    bed: () => setUniformBed(1.10, 0.0032),
    gates: [{ x: 42, clearance: 0.42 }]
  },
  "mild-weir-free": {
    flow: 1.00,
    tail: 1.50,
    mann: 0.015,
    bed: () => setSillBed(1.05, 0.0030, 0.62, 50, 8.5),
    gates: []
  },
  "mild-weir-submerged": {
    flow: 1.35,
    tail: 2.40,
    mann: 0.027,
    bed: () => setSillBed(1.05, 0.0030, 0.62, 50, 8.5),
    gates: []
  },
  "steep-uniform-low": {
    flow: 1.45,
    tail: 1.08,
    mann: 0.023,
    bed: () => setUniformBed(2.10, 0.018),
    gates: []
  },
  "steep-uniform-high": {
    flow: 0.15,
    tail: 1.50,
    mann: 0.023,
    bed: () => setUniformBed(2.10, 0.018),
    gates: []
  }
};

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.w = rect.width;
  view.h = rect.height;
}

function xToPx(x) {
  return view.left + x / L * (view.w - view.left - view.right);
}

function yToPx(y) {
  return view.top + (view.maxY - y) / (view.maxY - view.minY) * (view.h - view.top - view.bottom);
}

function pxToX(px) {
  return clamp((px - view.left) / (view.w - view.left - view.right) * L, 0, L);
}

function pxToY(py) {
  return view.maxY - (py - view.top) / (view.h - view.top - view.bottom) * (view.maxY - view.minY);
}

function sample(arr, x) {
  const f = clamp(x / dx - 0.5, 0, N - 1);
  const i = Math.floor(f);
  const t = f - i;
  if (i >= N - 1) return arr[N - 1];
  return arr[i] * (1 - t) + arr[i + 1] * t;
}

function bedAt(x) {
  return sample(model.z, x);
}

function waterAt(x) {
  return sample(model.eta, x);
}

function updateOutputs() {
  ui.flowOut.value = `${Number(ui.flow.value).toFixed(2)} m3/s`;
  ui.tailOut.value = `${Number(ui.tail.value).toFixed(2)} m`;
  ui.mannOut.value = Number(ui.mann.value).toFixed(3);
  const mode = Number(ui.particles.value);
  ui.particlesOut.value = mode === 0 ? text.particleNone : mode === 1 ? text.particleNoTrail : text.particleTrail;
  ui.deleteGate.disabled = model.gates.length === 0;
}

function updatePresetButtons() {
  for (const button of ui.presetButtons) {
    button.classList.toggle("active", button.dataset.preset === model.activePreset);
  }
}

function resetBed() {
  model.bedAnimation = null;
  for (let i = 0; i < N; i++) {
    model.z[i] = initialBed(idX(i));
    model.eta[i] = model.z[i] + 0.9;
    model.targetEta[i] = model.eta[i];
  }
  model.jumps.length = 0;
  model.selectedGate = model.gates.length ? 0 : -1;
  solveProfile(true);
  updateOutputs();
  updatePresetButtons();
}

function capturePresetBed(preset) {
  const current = Float64Array.from(model.z);
  preset.bed();
  const target = Float64Array.from(model.z);
  model.z.set(current);
  return target;
}

function animateBedTo(targetZ, duration = 720) {
  model.bedAnimation = {
    from: Float64Array.from(model.z),
    to: Float64Array.from(targetZ),
    start: performance.now(),
    duration
  };
}

function updateBedAnimation(now) {
  if (!model.bedAnimation) return false;
  const anim = model.bedAnimation;
  const raw = clamp((now - anim.start) / anim.duration, 0, 1);
  const t = raw * raw * (3 - 2 * raw);
  for (let i = 0; i < N; i++) {
    model.z[i] = anim.from[i] * (1 - t) + anim.to[i] * t;
    if (model.eta[i] < model.z[i] + minDepth) model.eta[i] = model.z[i] + minDepth;
  }
  solveProfile(false);
  if (raw >= 1) model.bedAnimation = null;
  return true;
}

function yc(q) {
  return Math.pow(q * q / g, 1 / 3);
}

function normalDepth(q, slope, n) {
  return clamp(Math.pow(q * n / Math.sqrt(Math.max(0.0004, slope)), 3 / 5), minDepth, 3.5);
}

function specificEnergy(z, h, q) {
  return z + h + q * q / (2 * g * h * h);
}

function frictionSlope(q, h, n) {
  return n * n * q * Math.abs(q) / Math.pow(Math.max(h, minDepth), 10 / 3);
}

function depthFromEnergy(z, total, q, branch) {
  const critical = yc(q);
  const emin = specificEnergy(z, critical, q);
  if (total <= emin) return critical;

  if (branch === "super") {
    let a = minDepth;
    let b = Math.max(minDepth * 1.5, critical * 0.999);
    const f = h => specificEnergy(z, h, q) - total;
    for (let it = 0; it < 44; it++) {
      const m = 0.5 * (a + b);
      if (f(m) > 0) a = m;
      else b = m;
    }
    return clamp(0.5 * (a + b), minDepth, Math.max(minDepth, critical));
  }

  let a = Math.max(critical * 1.001, minDepth);
  let b = Math.max(a * 1.2, 0.3);
  const f = h => specificEnergy(z, h, q) - total;
  while (f(b) < 0 && b < 3.5) b *= 1.35;
  for (let it = 0; it < 44; it++) {
    const m = 0.5 * (a + b);
    if (f(m) > 0) b = m;
    else a = m;
  }
  return clamp(0.5 * (a + b), minDepth, 3.5);
}

function stepSubcriticalUpstream(etaKnown, knownIndex, startIndex, q, n, label) {
  const eta = new Float64Array(N);
  eta[knownIndex] = clamp(etaKnown, model.z[knownIndex] + minDepth, model.z[knownIndex] + 3.5);
  for (let i = knownIndex - 1; i >= startIndex; i--) {
    const hd = Math.max(minDepth, eta[i + 1] - model.z[i + 1]);
    const sf = frictionSlope(q, hd, n);
    const total = specificEnergy(model.z[i + 1], hd, q) + sf * dx;
    const h = depthFromEnergy(model.z[i], total, q, "sub");
    eta[i] = clamp(model.z[i] + h, model.z[i] + minDepth, model.z[i] + 3.5);
  }
  return { eta, label };
}

function stepSupercriticalDownstream(etaKnown, knownIndex, endIndex, q, n) {
  const eta = new Float64Array(N);
  eta[knownIndex] = clamp(etaKnown, model.z[knownIndex] + minDepth, model.z[knownIndex] + 3.5);
  for (let i = knownIndex + 1; i <= endIndex; i++) {
    const hu = Math.max(minDepth, eta[i - 1] - model.z[i - 1]);
    const sf = frictionSlope(q, hu, n);
    const total = specificEnergy(model.z[i - 1], hu, q) - sf * dx;
    const h = depthFromEnergy(model.z[i], total, q, "super");
    eta[i] = clamp(model.z[i] + h, model.z[i] + minDepth, model.z[i] + 3.5);
  }
  return eta;
}

function conjugateDepth(h1, q) {
  const fr1 = q / (h1 * Math.sqrt(g * h1));
  return 0.5 * h1 * (Math.sqrt(1 + 8 * fr1 * fr1) - 1);
}

function specificForce(h, q) {
  return 0.5 * h * h + q * q / (g * h);
}

function jumpLabel(type) {
  if (type === "submerged") return text.submergedJump;
  if (type === "free") return text.freeJump;
  return text.noJump;
}

function gateControl(gate, q) {
  const z = bedAt(gate.x);
  const a = Math.max(minGateClearance, gate.clearance);
  const hUp = a + q * q / (2 * g * CdGate * CdGate * a * a);
  const hJet = Math.max(minDepth, CcGate * a);
  return {
    upstreamEta: z + Math.max(hUp, yc(q)),
    jetEta: z + hJet,
    openingEta: z + a
  };
}

function findBedControls(q) {
  const controls = [];
  const critical = yc(q);
  for (let i = 2; i < N - 2; i++) {
    if (model.z[i] < model.z[i - 1] || model.z[i] < model.z[i + 1]) continue;
    const left = Math.min(model.z[Math.max(0, i - 4)], model.z[Math.max(0, i - 2)]);
    const right = Math.min(model.z[Math.min(N - 1, i + 2)], model.z[Math.min(N - 1, i + 4)]);
    const prominence = model.z[i] - Math.max(left, right);
    const hTail = Math.max(minDepth, model.targetEta[i] - model.z[i]);
    if (prominence > 0.08 && hTail <= 1.35 * critical) controls.push(i);
  }
  return controls;
}

function classifyHydraulicJump(superEta, controlIndex, q) {
  let previous = null;
  let lastState = null;
  const first = Math.min(N - 1, controlIndex + 1);

  for (let i = first; i < N; i++) {
    const hSuper = Math.max(minDepth, superEta[i] - model.z[i]);
    const hTail = Math.max(minDepth, model.targetEta[i] - model.z[i]);
    const h2 = conjugateDepth(hSuper, q);
    const state = {
      i,
      x: idX(i),
      hSuper,
      hTail,
      h2,
      depthRatio: hTail / h2,
      momentumRatio: specificForce(hTail, q) / specificForce(hSuper, q)
    };
    lastState = state;

    if (state.depthRatio >= 1) {
      if (!previous) return { ...state, type: state.depthRatio === 1 ? "free" : "submerged" };
      const span = state.depthRatio - previous.depthRatio;
      const t = span === 0 ? 0 : clamp((1 - previous.depthRatio) / span, 0, 1);
      return {
        ...state,
        type: "free",
        x: previous.x + (state.x - previous.x) * t,
        depthRatio: 1,
        momentumRatio: 1
      };
    }

    previous = state;
  }

  return {
    ...(lastState || { i: N - 1, x: idX(N - 1), hSuper: minDepth, hTail: minDepth, h2: minDepth, depthRatio: 0, momentumRatio: 0 }),
    type: "none"
  };
}

function applySupercriticalPatch(controlIndex, controlEta, q, n, upstreamSource, jetSource) {
  const up = stepSubcriticalUpstream(controlEta, controlIndex, 0, q, n, upstreamSource);
  for (let i = 0; i <= controlIndex; i++) {
    if (up.eta[i] > model.targetEta[i]) {
      model.targetEta[i] = up.eta[i];
      model.source[i] = upstreamSource;
    }
  }

  const superEta = stepSupercriticalDownstream(controlEta, controlIndex, N - 1, q, n);
  const jump = classifyHydraulicJump(superEta, controlIndex, q);
  const superEnd = jump.type === "none" ? N - 1 : Math.max(controlIndex, jump.i - 1);
  for (let i = controlIndex; i <= superEnd; i++) {
    model.targetEta[i] = superEta[i];
    model.source[i] = jetSource;
  }
  if (jump.type === "submerged") {
    model.source[jump.i] = "submerged-jump";
  }
  model.jumps.push({ ...jump, source: jetSource });
  return jump;
}

function applySteepUpstreamProfile(q, n, yn) {
  const upstreamEta = model.z[0] + clamp(yn, minDepth, Math.max(minDepth, yc(q) * 0.995));
  const superEta = stepSupercriticalDownstream(upstreamEta, 0, N - 1, q, n);
  const transition = classifyHydraulicJump(superEta, 0, q);
  const superEnd = transition.type === "none" ? N - 1 : Math.max(0, transition.i - 1);
  for (let i = 0; i <= superEnd; i++) {
    model.targetEta[i] = superEta[i];
    model.source[i] = "upstream-super";
  }
  if (transition.type === "submerged") model.source[transition.i] = "submerged-jump";
  model.jumps.push({ ...transition, source: "upstream-super" });
}

function solveProfile(immediate = false) {
  const q = Math.max(0.01, Number(ui.flow.value));
  const n = Number(ui.mann.value);
  const tail = Number(ui.tail.value);
  const slope = Math.max(0.0004, (model.z[0] - model.z[N - 1]) / L);
  const yn = normalDepth(q, slope, n);
  const critical = yc(q);
  const base = stepSubcriticalUpstream(tail, N - 1, 0, q, n, text.tailwaterLabel);

  for (let i = 0; i < N; i++) {
    model.targetEta[i] = clamp(base.eta[i], model.z[i] + minDepth, model.z[i] + 3.5);
    model.source[i] = "tailwater";
  }
  model.jumps.length = 0;

  if (yn < critical) {
    applySteepUpstreamProfile(q, n, yn);
  }

  for (const ci of findBedControls(q)) {
    applySupercriticalPatch(ci, model.z[ci] + yc(q), q, n, "weir-upstream", "weir-jet");
  }

  const sortedGates = [...model.gates].sort((a, b) => a.x - b.x);
  for (const gate of sortedGates) {
    const gi = clamp(Math.round(gate.x / dx - 0.5), 1, N - 2);
    const gc = gateControl(gate, q);
    const jump = applySupercriticalPatch(gi, gc.jetEta, q, n, "gate-upstream", "gate-jet");
    gate.jumpType = jump.type;
    gate.jumpX = jump.x;
    const up = stepSubcriticalUpstream(gc.upstreamEta, gi, 0, q, n, "gate-upstream");
    for (let i = 0; i <= gi; i++) {
      if (up.eta[i] > model.targetEta[i]) model.targetEta[i] = up.eta[i];
      if (up.eta[i] >= model.targetEta[i] - 0.001) model.source[i] = "gate-upstream";
    }
  }

  for (let i = 0; i < N; i++) {
    const h = Math.max(minDepth, model.targetEta[i] - model.z[i]);
    model.froude[i] = q / (h * Math.sqrt(g * h));
    if (immediate) model.eta[i] = model.targetEta[i];
  }

  const mild = yn > critical;
  ui.profileClass.textContent = `${mild ? text.mild : text.steep}  yc=${critical.toFixed(2)}m  yn=${yn.toFixed(2)}m`;
  const weirs = model.source.some(s => s === "weir-upstream" || s === "weir-jet");
  const upstreamControlled = model.source.some(s => s === "upstream-super");
  const controls = `${weirs ? text.weirCrest : upstreamControlled ? text.upstreamControl : text.downstreamEnd}${sortedGates.length ? text.gateSuffix(sortedGates.length) : ""}`;
  const jumps = model.jumps.map(j => `${jumpLabel(j.type)} ${Math.round(j.x)}m ${text.depthRatio}=${j.depthRatio.toFixed(2)}`).join(", ");
  ui.controlState.textContent = jumps ? `${controls} / ${jumps}` : controls;
}

function updateAnimation() {
  let changed = false;
  for (let i = 0; i < N; i++) {
    const d = model.targetEta[i] - model.eta[i];
    if (Math.abs(d) > 0.0005) changed = true;
    model.eta[i] += d * 0.18;
  }
  return changed;
}

function velocityShape(s) {
  return 0.34 + 0.92 * Math.pow(clamp(s, 0.02, 1), 1 / 7);
}

function meanShape() {
  let sum = 0;
  for (let k = 0; k < 15; k++) sum += velocityShape((k + 0.5) / 15);
  return sum / 15;
}

function velocityAt(i, s) {
  const q = Math.max(0.01, Number(ui.flow.value));
  const h = Math.max(minDepth, model.eta[i] - model.z[i]);
  const mean = q / h;
  if (model.source[i] === "gate-jet" || model.source[i] === "weir-jet") return mean * (0.86 + 0.22 * Math.cos((s - 0.5) * Math.PI));
  return mean * velocityShape(s) / meanShape();
}

function gateOpeningFraction(gate) {
  const h = Math.max(minDepth, waterAt(gate.x) - bedAt(gate.x));
  return clamp(gate.clearance / h, 0.06, 0.94);
}

function enforceGatePassage(particle, previousX) {
  for (const gate of model.gates) {
    if (previousX > gate.x || particle.x < gate.x) continue;
    const opening = gateOpeningFraction(gate);
    if (particle.s <= opening) continue;

    const layers = 15;
    const originalLayer = clamp(Math.floor(particle.s * layers), 0, layers - 1);
    if (gate.jumpType === "free") {
      particle.s = (originalLayer + 0.5) / layers;
      particle.x = Math.max(particle.x, gate.x + dx);
      continue;
    }

    const gateLowerLayer = clamp(Math.ceil(opening * layers) - 1, 0, layers - 1);
    particle.s = clamp((gateLowerLayer + 0.5) / layers, 0.04, Math.max(0.04, opening - 0.01));
    particle.x = Math.max(particle.x, gate.x + 0.12);
  }
}

function updateParticles(dt) {
  const mode = Number(ui.particles.value);
  if (mode === 0) {
    model.particles.length = 0;
    return;
  }
  model.spawnCarry += dt * 9;
  while (model.spawnCarry >= 1 && model.particles.length < 260) {
    model.spawnCarry -= 1;
    model.particles.push({ x: 0.4, s: 0.06 + Math.random() * 0.88, drift: (Math.random() - 0.5) * 0.018, trail: [] });
  }
  for (let p = model.particles.length - 1; p >= 0; p--) {
    const particle = model.particles[p];
    const i = clamp(Math.round(particle.x / dx - 0.5), 0, N - 1);
    const u = velocityAt(i, particle.s);
    particle.trail.length = 0;
    particle.s += particle.drift * dt;
    if (particle.s < 0.08 || particle.s > 0.92) particle.drift *= -1;
    particle.s = clamp(particle.s, 0.06, 0.94);
    const previousX = particle.x;
    particle.x += Math.max(0.02, u) * dt * 6.4;
    enforceGatePassage(particle, previousX);
    if (particle.x > L + 2) model.particles.splice(p, 1);
  }
}

function colorJet(t) {
  t = clamp(t, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * t - 3), 0, 1);
  const gg = clamp(1.5 - Math.abs(4 * t - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * t - 1), 0, 1);
  return `rgb(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(b * 255)})`;
}

function bwr(t) {
  t = clamp(t, -1, 1);
  if (t >= 0) {
    const c = Math.round(255 * (1 - t));
    return `rgb(255,${c},${c})`;
  }
  const c = Math.round(255 * (1 + t));
  return `rgb(${c},${c},255)`;
}

function requiredViewRange() {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < N; i++) {
    lo = Math.min(lo, model.z[i] - 0.25);
    hi = Math.max(hi, model.eta[i] + 0.5);
  }
  for (const gate of model.gates) hi = Math.max(hi, bedAt(gate.x) + gate.clearance + 1.1);
  return { lo, hi };
}

function snappedAxisRange(lo, hi) {
  const rawSpan = Math.max(1.0, hi - lo);
  const pitch = rawSpan <= 3.0 ? 0.5 : 1.0;
  let minY = Math.floor(lo / pitch) * pitch;
  let maxY = Math.ceil(hi / pitch) * pitch;
  if (maxY - minY < pitch * 4) {
    const center = 0.5 * (minY + maxY);
    minY = Math.floor((center - pitch * 2) / pitch) * pitch;
    maxY = Math.ceil((center + pitch * 2) / pitch) * pitch;
  }
  return { minY, maxY, pitch };
}

function updateViewRange() {
  if (model.axisLocked) return;
  const bounds = requiredViewRange();
  const snapped = snappedAxisRange(bounds.lo, bounds.hi);
  view.minY = snapped.minY;
  view.maxY = snapped.maxY;
  view.yTick = snapped.pitch;
}

function drawAxes() {
  ctx.save();
  ctx.strokeStyle = "#cad3dd";
  ctx.fillStyle = "#6a7686";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = view.minY; y <= view.maxY + view.yTick * 0.25; y += view.yTick) {
    ctx.beginPath();
    ctx.moveTo(view.left, yToPx(y));
    ctx.lineTo(view.w - view.right, yToPx(y));
    ctx.stroke();
    ctx.fillText(y.toFixed(1), view.left - 8, yToPx(y));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 5; i++) ctx.fillText(String(Math.round(L * i / 5)), xToPx(L * i / 5), view.h - view.bottom + 10);
  ctx.restore();
}

function drawWaterFill() {
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = idX(i);
    if (i === 0) ctx.moveTo(xToPx(x), yToPx(model.eta[i]));
    else ctx.lineTo(xToPx(x), yToPx(model.eta[i]));
  }
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(xToPx(idX(i)), yToPx(model.z[i]));
  ctx.closePath();
  ctx.fillStyle = "rgba(82, 166, 197, 0.2)";
  ctx.fill();
}

function drawAdjustmentBands() {
  ctx.save();
  for (let i = 0; i < N; i++) {
    if (model.source[i] === "tailwater") ctx.fillStyle = "rgba(54, 142, 184, 0.08)";
    else if (model.source[i] === "gate-upstream") ctx.fillStyle = "rgba(26, 111, 170, 0.18)";
    else if (model.source[i] === "gate-jet") ctx.fillStyle = "rgba(214, 72, 58, 0.13)";
    else if (model.source[i] === "weir-upstream") ctx.fillStyle = "rgba(22, 122, 165, 0.16)";
    else if (model.source[i] === "weir-jet") ctx.fillStyle = "rgba(230, 138, 39, 0.15)";
    else if (model.source[i] === "submerged-jump") ctx.fillStyle = "rgba(93, 83, 188, 0.16)";
    const x0 = xToPx(i * dx);
    const x1 = xToPx((i + 1) * dx);
    ctx.fillRect(x0, yToPx(model.eta[i]), x1 - x0, yToPx(model.z[i]) - yToPx(model.eta[i]));
  }
  ctx.restore();
}

function drawContours() {
  if (ui.viewMode.value === "plain") return;
  const q = Math.max(0.01, Number(ui.flow.value));
  for (let i = 0; i < N; i++) {
    const h = Math.max(minDepth, model.eta[i] - model.z[i]);
    for (let k = 0; k < 15; k++) {
      const s0 = k / 15;
      const s1 = (k + 1) / 15;
      const s = (k + 0.5) / 15;
      const val = ui.viewMode.value === "froude" ? model.froude[i] / 1.8 : velocityAt(i, s) / Math.max(3.2, q / 0.45);
      ctx.fillStyle = ui.viewMode.value === "froude" ? bwr(val - 0.55) : colorJet(val);
      ctx.globalAlpha = 0.56;
      ctx.fillRect(xToPx(i * dx), yToPx(model.z[i] + h * s1), xToPx((i + 1) * dx) - xToPx(i * dx) + 1, yToPx(model.z[i] + h * s0) - yToPx(model.z[i] + h * s1) + 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawLines() {
  ctx.save();
  ctx.strokeStyle = "#126c87";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = idX(i);
    if (i === 0) ctx.moveTo(xToPx(x), yToPx(model.eta[i]));
    else ctx.lineTo(xToPx(x), yToPx(model.eta[i]));
  }
  ctx.stroke();
  drawProfileDirectionMarkers();

  ctx.beginPath();
  ctx.moveTo(xToPx(0), yToPx(view.minY));
  for (let i = 0; i < N; i++) ctx.lineTo(xToPx(idX(i)), yToPx(model.z[i]));
  ctx.lineTo(xToPx(L), yToPx(view.minY));
  ctx.closePath();
  ctx.fillStyle = "rgba(121, 99, 74, 0.55)";
  ctx.fill();
  ctx.strokeStyle = "#5f4d3a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = idX(i);
    if (i === 0) ctx.moveTo(xToPx(x), yToPx(model.z[i]));
    else ctx.lineTo(xToPx(x), yToPx(model.z[i]));
  }
  ctx.stroke();
  ctx.restore();
}

function profileDirectionAt(i) {
  return model.source[i] === "gate-jet" || model.source[i] === "weir-jet" || model.source[i] === "upstream-super" ? 1 : -1;
}

function drawProfileDirectionMarkers() {
  ctx.save();
  ctx.fillStyle = "rgba(15, 23, 32, 0.72)";
  for (let i = 4; i < N - 2; i += 6) {
    const dir = profileDirectionAt(i);
    const j = clamp(i + dir, 0, N - 1);
    const x0 = xToPx(idX(i));
    const y0 = yToPx(model.eta[i]);
    const x1 = xToPx(idX(j));
    const y1 = yToPx(model.eta[j]);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawWatermark() {
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#102f3f";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const x = view.w - view.right - 18;
  ctx.font = "700 96px system-ui, sans-serif";
  ctx.fillText("HydLab", x, view.top + 58);
  ctx.font = "650 28px system-ui, sans-serif";
  ctx.fillText("Tokyo University of Science", x, view.top + 105);
  ctx.restore();
}

function drawVectors() {
  ctx.save();
  ctx.strokeStyle = "rgba(19, 53, 68, 0.72)";
  ctx.fillStyle = "rgba(19, 53, 68, 0.72)";
  ctx.lineWidth = 1;
  for (let i = 2; i < N; i += 4) {
    const h = Math.max(minDepth, model.eta[i] - model.z[i]);
    for (const s of [0.25, 0.55, 0.82]) {
      const u = velocityAt(i, s);
      const len = clamp(u * 8, 3, 24);
      const px = xToPx(idX(i));
      const py = yToPx(model.z[i] + h * s);
      const ex = px + len;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, py);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, py);
      ctx.lineTo(ex - 5, py - 3);
      ctx.lineTo(ex - 5, py + 3);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawGatesAndJumps() {
  ctx.save();
  for (let i = 0; i < model.gates.length; i++) {
    const gate = model.gates[i];
    const px = xToPx(gate.x);
    const lower = bedAt(gate.x) + gate.clearance;
    const selected = i === model.selectedGate;
    ctx.strokeStyle = selected ? "#0d6273" : "#222831";
    ctx.lineWidth = selected ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(px, yToPx(view.maxY - 0.2));
    ctx.lineTo(px, yToPx(lower));
    ctx.stroke();
    ctx.fillStyle = selected ? "#0d6273" : "#d24b55";
    ctx.fillRect(px - 14, yToPx(lower) - 5, 28, 10);
  }
  for (const jump of model.jumps) {
    const x = jump.x ?? idX(jump.i);
    const z = bedAt(x);
    const eta = waterAt(x);
    ctx.strokeStyle = jump.type === "submerged" ? "rgba(96, 64, 176, 0.85)" : "rgba(13, 98, 115, 0.8)";
    ctx.fillStyle = jump.type === "submerged" ? "#6040b0" : "#0d6273";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = jump.type === "none" ? 1.4 : 2.2;
    if (jump.type !== "none") {
      ctx.beginPath();
      ctx.moveTo(xToPx(x), yToPx(z));
      ctx.lineTo(xToPx(x), yToPx(eta + 0.15));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(jumpLabel(jump.type), xToPx(x) + 8, yToPx(eta + 0.13));
  }
  ctx.restore();
}

function particleToPoint(p) {
  const x = clamp(p.x, 0, L);
  const z = bedAt(x);
  const eta = waterAt(x);
  return { px: xToPx(x), py: yToPx(z + (eta - z) * p.s) };
}

function drawParticles() {
  const mode = Number(ui.particles.value);
  if (mode === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  for (const p of model.particles) {
    const pt = particleToPoint(p);
    ctx.fillStyle = mode === 2 ? "rgba(255, 255, 255, 0.92)" : "#102f3f";
    ctx.beginPath();
    ctx.arc(pt.px, pt.py, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (mode === 2) {
      ctx.strokeStyle = "rgba(15, 47, 63, 0.55)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBedHandles() {
  ctx.save();
  ctx.fillStyle = "rgba(121, 99, 74, 0.9)";
  for (let i = 0; i < N; i += 2) {
    ctx.beginPath();
    ctx.arc(xToPx(idX(i)), yToPx(model.z[i]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function render() {
  updateBedAnimation(performance.now());
  updateParticles(1 / 60);
  updateAnimation();
  updateViewRange();
  ctx.clearRect(0, 0, view.w, view.h);
  drawAxes();
  drawWaterFill();
  drawContours();
  drawWatermark();
  drawLines();
  drawParticles();
  drawGatesAndJumps();
  drawBedHandles();

  const mid = Math.floor(N / 2);
  const hMid = Math.max(minDepth, model.eta[mid] - model.z[mid]);
  ui.readout.textContent = `h=${hMid.toFixed(2)}m  Fr=${model.froude[mid].toFixed(2)}  Q=${Number(ui.flow.value).toFixed(2)}m3/s`;
  requestAnimationFrame(render);
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const p = event.touches ? event.touches[0] : event;
  return { px: p.clientX - rect.left, py: p.clientY - rect.top };
}

function nearestGate(px, py) {
  for (let i = model.gates.length - 1; i >= 0; i--) {
    const gate = model.gates[i];
    const gx = xToPx(gate.x);
    const gy = yToPx(bedAt(gate.x) + gate.clearance);
    if (Math.abs(px - gx) < 24 && Math.abs(py - gy) < 24) return i;
  }
  return -1;
}

function beginDrag(event) {
  event.preventDefault();
  const { px, py } = pointerPosition(event);
  const gi = nearestGate(px, py);
  if (gi >= 0) {
    model.selectedGate = gi;
    updateOutputs();
    model.drag = { type: "gate", index: gi };
    return;
  }
  const x = pxToX(px);
  const i = clamp(Math.round(x / dx - 0.5), 0, N - 1);
  if (Math.abs(py - yToPx(model.z[i])) < 34 || py > yToPx(model.z[i]) - 60) {
    model.drag = { type: "bed", index: i };
    moveDrag(event);
  }
}

function moveDrag(event) {
  if (!model.drag) return;
  event.preventDefault();
  model.bedAnimation = null;
  model.activePreset = "";
  updatePresetButtons();
  const { px, py } = pointerPosition(event);
  const y = pxToY(py);
  if (model.drag.type === "bed") {
    model.z[model.drag.index] = clamp(y, -0.25, 2.35);
  } else {
    const gate = model.gates[model.drag.index];
    gate.x = clamp(pxToX(px), dx, L - dx);
    gate.clearance = clamp(y - bedAt(gate.x), minGateClearance, 2.2);
  }
  solveProfile(false);
}

function endDrag() {
  model.drag = null;
}

function addGate() {
  model.bedAnimation = null;
  model.activePreset = "";
  const x = L * (0.44 + 0.12 * (model.gates.length % 3));
  model.gates.push({ x, clearance: 0.95 });
  model.selectedGate = model.gates.length - 1;
  updateOutputs();
  updatePresetButtons();
  solveProfile(false);
}

function deleteGate() {
  if (!model.gates.length) return;
  model.bedAnimation = null;
  model.activePreset = "";
  const index = model.selectedGate >= 0 ? model.selectedGate : model.gates.length - 1;
  model.gates.splice(index, 1);
  model.selectedGate = Math.min(index, model.gates.length - 1);
  updateOutputs();
  updatePresetButtons();
  solveProfile(false);
}

function applyPreset(key, animate = true) {
  const preset = presets[key];
  if (!preset) return;
  const targetZ = capturePresetBed(preset);
  model.activePreset = key;
  ui.flow.value = preset.flow;
  ui.tail.value = preset.tail;
  ui.mann.value = preset.mann;
  model.gates.length = 0;
  for (const gate of preset.gates) model.gates.push({ ...gate });
  model.selectedGate = model.gates.length ? 0 : -1;
  model.particles.length = 0;
  model.spawnCarry = 0;
  updateOutputs();
  updatePresetButtons();
  if (animate) {
    animateBedTo(targetZ);
    solveProfile(false);
  } else {
    model.bedAnimation = null;
    model.z.set(targetZ);
    solveProfile(true);
  }
}

function toggleHud() {
  const hidden = ui.canvasWrap.classList.toggle("hud-hidden");
  ui.toggleHud.textContent = hidden ? text.showInfo : text.hideInfo;
}

function updatePanelToggleText() {
  ui.togglePanel.textContent = ui.app.classList.contains("panel-hidden") ? text.showSettings : text.hideSettings;
}

function updateAxisToggleText() {
  ui.toggleAxis.textContent = model.axisLocked ? text.axisFixed : text.axisAuto;
  ui.toggleAxis.classList.toggle("active", model.axisLocked);
}

function togglePanel() {
  ui.app.classList.toggle("panel-hidden");
  updatePanelToggleText();
  setTimeout(resize, 0);
}

function toggleAxisLock() {
  if (!model.axisLocked) {
    const snapped = snappedAxisRange(view.minY, view.maxY);
    view.minY = snapped.minY;
    view.maxY = snapped.maxY;
    view.yTick = snapped.pitch;
    model.axisLocked = true;
  } else {
    model.axisLocked = false;
    updateViewRange();
  }
  updateAxisToggleText();
}

if (window.matchMedia("(max-width: 920px)").matches) ui.app.classList.add("panel-hidden");
updatePanelToggleText();
updateAxisToggleText();

for (const el of [ui.flow, ui.tail, ui.mann, ui.particles]) {
  el.addEventListener("input", () => {
    if (el !== ui.particles) {
      model.activePreset = "";
      updatePresetButtons();
    }
    updateOutputs();
    solveProfile(false);
  });
}
ui.viewMode.addEventListener("input", () => solveProfile(false));
ui.addGate.addEventListener("click", addGate);
ui.deleteGate.addEventListener("click", deleteGate);
ui.toggleHud.addEventListener("click", toggleHud);
ui.togglePanel.addEventListener("click", togglePanel);
ui.toggleAxis.addEventListener("click", toggleAxisLock);
for (const button of ui.presetButtons) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}

canvas.addEventListener("pointerdown", beginDrag);
canvas.addEventListener("pointermove", moveDrag);
window.addEventListener("pointerup", endDrag);
canvas.addEventListener("touchstart", beginDrag, { passive: false });
canvas.addEventListener("touchmove", moveDrag, { passive: false });
window.addEventListener("touchend", endDrag);
window.addEventListener("resize", resize);

resize();
updateOutputs();
applyPreset("mild-weir-free", false);
requestAnimationFrame(render);
