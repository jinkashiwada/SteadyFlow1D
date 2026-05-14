const canvas = document.getElementById("flowCanvas");
const ctx = canvas.getContext("2d");

const ui = {
  inflow: document.getElementById("inflow"),
  tailwater: document.getElementById("tailwater"),
  roughness: document.getElementById("roughness"),
  particles: document.getElementById("particles"),
  contour: document.getElementById("contour"),
  vectors: document.getElementById("vectors"),
  pause: document.getElementById("pause"),
  addGate: document.getElementById("addGate"),
  resetBed: document.getElementById("resetBed"),
  inflowOut: document.getElementById("inflowOut"),
  tailwaterOut: document.getElementById("tailwaterOut"),
  roughnessOut: document.getElementById("roughnessOut"),
  particlesOut: document.getElementById("particlesOut"),
  flowClass: document.getElementById("flowClass"),
  jumpState: document.getElementById("jumpState"),
  readout: document.getElementById("readout")
};

const NX = 50;
const NZ = 15;
const L = 100;
const dx = L / NX;
const g = 9.81;
const rho = 1000;
const kappa = 0.41;
const minDepth = 0.08;
const minGateClearance = 0.18;

const state = {
  z: new Float64Array(NX),
  h: new Float64Array(NX),
  eta: new Float64Array(NX),
  q: new Float64Array(NX),
  u: new Float64Array(NX * NZ),
  w: new Float64Array(NX * NZ),
  nut: new Float64Array(NX * NZ),
  vort: new Float64Array(NX * NZ),
  particles: [],
  gates: [],
  drag: null,
  spawnCarry: 0,
  time: 0
};

const work = {
  u1: new Float64Array(NX * NZ),
  u2: new Float64Array(NX * NZ),
  h1: new Float64Array(NX),
  qFace: new Float64Array(NX + 1),
  lower: new Float64Array(NX),
  diag: new Float64Array(NX),
  upper: new Float64Array(NX),
  rhs: new Float64Array(NX)
};

let view = {
  w: 1,
  h: 1,
  left: 58,
  right: 22,
  top: 28,
  bottom: 56,
  minY: -0.5,
  maxY: 3.4
};

function id(i, k) {
  return i * NZ + k;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function initialBed(x) {
  const slope = 0.0115 * x;
  const bump = 0.42 * Math.exp(-Math.pow((x - 57) / 11, 2));
  const step = x > 70 ? 0.18 : 0;
  return 1.0 - slope + bump + step;
}

function normalDepth(q, slope, n) {
  return clamp(Math.pow(Math.max(0.03, q) * n / Math.sqrt(Math.max(0.0004, slope)), 3 / 5), 0.25, 2.6);
}

function resetBed() {
  const qIn = Number(ui.inflow.value);
  const n = Number(ui.roughness.value);
  for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * dx;
    state.z[i] = initialBed(x);
  }
  const s0 = Math.max(0.0005, (state.z[0] - state.z[NX - 1]) / L);
  const yn = normalDepth(qIn, s0, n);
  const tailEta = Number(ui.tailwater.value);
  for (let i = 0; i < NX; i++) {
    const backwater = Math.max(minDepth, tailEta - state.z[i]) * Math.exp(-(L - (i + 0.5) * dx) / 30);
    state.h[i] = clamp(yn * (1 - Math.exp(-(L - (i + 0.5) * dx) / 30)) + backwater, minDepth, 2.8);
    state.eta[i] = state.z[i] + state.h[i];
    const meanU = qIn / state.h[i];
    for (let k = 0; k < NZ; k++) {
      const s = (k + 0.5) / NZ;
      state.u[id(i, k)] = meanU * (0.45 + 0.75 * Math.pow(s, 1 / 6));
      state.w[id(i, k)] = 0;
    }
  }
  state.particles.length = 0;
  updateDerivedFields();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.w = rect.width;
  view.h = rect.height;
}

function updateOutputs() {
  ui.inflowOut.value = `${Number(ui.inflow.value).toFixed(2)} m3/s`;
  ui.tailwaterOut.value = `${Number(ui.tailwater.value).toFixed(2)} m`;
  ui.roughnessOut.value = Number(ui.roughness.value).toFixed(3);
  const p = Number(ui.particles.value);
  ui.particlesOut.value = p === 0 ? "Off" : `${p}`;
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

function sampleArray(arr, x) {
  const f = clamp(x / dx - 0.5, 0, NX - 1);
  const i = Math.floor(f);
  const t = f - i;
  if (i >= NX - 1) return arr[NX - 1];
  return arr[i] * (1 - t) + arr[i + 1] * t;
}

function bedAt(x) {
  return sampleArray(state.z, x);
}

function depthAt(x) {
  return Math.max(minDepth, sampleArray(state.h, x));
}

function surfaceAt(x) {
  return sampleArray(state.eta, x);
}

function qAt(x) {
  return sampleArray(state.q, x);
}

function wetAt(i, k) {
  for (const gate of state.gates) {
    const gi = Math.round(gate.x / dx - 0.5);
    if (Math.abs(i - gi) <= 0) {
      const s = (k + 0.5) / NZ;
      const y = state.z[i] + state.h[i] * s;
      if (y > state.z[i] + gate.clearance) return false;
    }
  }
  return true;
}

function applyBoundaryConditions() {
  const qIn = Number(ui.inflow.value);
  const tailEta = Number(ui.tailwater.value);
  state.h[NX - 1] = clamp(state.h[NX - 1] + 0.36 * (Math.max(minDepth, tailEta - state.z[NX - 1]) - state.h[NX - 1]), minDepth, 3.0);
  state.eta[NX - 1] = state.z[NX - 1] + state.h[NX - 1];

  const area = state.h[0];
  const meanU = qIn / Math.max(area, minDepth);
  for (let k = 0; k < NZ; k++) {
    const s = (k + 0.5) / NZ;
    state.u[id(0, k)] = 0.7 * state.u[id(0, k)] + 0.3 * meanU * (0.48 + 0.72 * Math.pow(s, 1 / 7));
    state.u[id(NX - 1, k)] = 0.85 * state.u[id(NX - 1, k)] + 0.15 * state.u[id(NX - 2, k)];
  }
}

function computeDischarge() {
  for (let i = 0; i < NX; i++) {
    let sum = 0;
    let wetCount = 0;
    for (let k = 0; k < NZ; k++) {
      if (!wetAt(i, k)) continue;
      sum += state.u[id(i, k)];
      wetCount++;
    }
    state.q[i] = state.h[i] * sum / Math.max(1, wetCount);
  }
}

function updateEddyViscosity() {
  const n = Number(ui.roughness.value);
  for (let i = 0; i < NX; i++) {
    const h = Math.max(state.h[i], minDepth);
    const ub = Math.abs(state.u[id(i, 0)]);
    const ustar = Math.max(0.015, Math.sqrt(g) * n * ub / Math.pow(h, 1 / 6));
    for (let k = 0; k < NZ; k++) {
      const s = (k + 0.5) / NZ;
      const lm = kappa * h * Math.min(s, 1 - s + 0.15);
      const shear = Math.abs(state.u[id(i, Math.min(NZ - 1, k + 1))] - state.u[id(i, Math.max(0, k - 1))]) / (2 * h / NZ);
      state.nut[id(i, k)] = clamp(0.004 + lm * lm * shear + 0.08 * ustar * h * s * (1 - s), 0.002, 0.18);
    }
  }
}

function computeVerticalVelocity() {
  for (let i = 0; i < NX; i++) {
    const im = Math.max(0, i - 1);
    const ip = Math.min(NX - 1, i + 1);
    const ddx = (ip - im || 1) * dx;
    const bedDx = (state.z[ip] - state.z[im]) / ddx;
    const dz = state.h[i] / NZ;
    let wFace = 0;
    for (let k = 0; k < NZ; k++) {
      const duDx = (state.u[id(ip, k)] - state.u[id(im, k)]) / ddx;
      const bedNoPenetration = state.u[id(i, 0)] * bedDx;
      const wLower = k === 0 ? bedNoPenetration : wFace;
      wFace = wLower - duDx * dz;
      state.w[id(i, k)] = 0.5 * (wLower + wFace);
    }
  }
}

function updateVorticity() {
  for (let i = 0; i < NX; i++) {
    const im = Math.max(0, i - 1);
    const ip = Math.min(NX - 1, i + 1);
    const ddx = (ip - im || 1) * dx;
    const dz = state.h[i] / NZ;
    for (let k = 0; k < NZ; k++) {
      const km = Math.max(0, k - 1);
      const kp = Math.min(NZ - 1, k + 1);
      const dwdx = (state.w[id(ip, k)] - state.w[id(im, k)]) / ddx;
      const dudz = (state.u[id(i, kp)] - state.u[id(i, km)]) / ((kp - km || 1) * dz);
      state.vort[id(i, k)] = dwdx - dudz;
    }
  }
}

function updateDerivedFields() {
  for (let i = 0; i < NX; i++) {
    state.eta[i] = clamp(state.eta[i], state.z[i] + minDepth, state.z[i] + 3.0);
    state.h[i] = state.eta[i] - state.z[i];
  }
  computeDischarge();
  updateEddyViscosity();
  computeVerticalVelocity();
  updateVorticity();
}

function specificEnergy(z, h, q) {
  return z + h + q * q / (2 * g * h * h);
}

function frictionSlope(q, h, n) {
  return n * n * q * Math.abs(q) / Math.pow(Math.max(h, minDepth), 10 / 3);
}

function depthFromEnergy(z, energy, q, preferSubcritical) {
  const yc = Math.pow(q * q / g, 1 / 3);
  const lo = preferSubcritical ? Math.max(yc * 1.001, minDepth) : minDepth;
  let a = lo;
  let b = 3.0;
  const f = h => specificEnergy(z, h, q) - energy;
  if (f(a) > 0) return a;
  while (f(b) < 0 && b < 3.0) b *= 1.15;
  for (let it = 0; it < 32; it++) {
    const m = 0.5 * (a + b);
    if (f(m) > 0) b = m;
    else a = m;
  }
  return clamp(0.5 * (a + b), minDepth, 3.0);
}

function solveFreeSurface(dt) {
  const qIn = Number(ui.inflow.value);
  const tailEta = Number(ui.tailwater.value);
  const n = Number(ui.roughness.value);
  const q = Math.max(0.01, Math.abs(qIn));
  work.h1[NX - 1] = clamp(tailEta, state.z[NX - 1] + minDepth, state.z[NX - 1] + 3.0);
  for (let i = NX - 2; i >= 0; i--) {
    const hd = Math.max(minDepth, work.h1[i + 1] - state.z[i + 1]);
    const ed = specificEnergy(state.z[i + 1], hd, q);
    const sf = frictionSlope(q, hd, n);
    const hu = depthFromEnergy(state.z[i], ed + sf * dx, q, true);
    work.h1[i] = clamp(state.z[i] + hu, state.z[i] + minDepth, state.z[i] + 3.0);
  }
  const relax = clamp(dt * 7.5, 0, 0.38);
  for (let i = 0; i < NX; i++) {
    state.eta[i] = clamp(state.eta[i] + relax * (work.h1[i] - state.eta[i]), state.z[i] + minDepth, state.z[i] + 3.0);
    state.h[i] = state.eta[i] - state.z[i];
    const qCurrent = state.q[i];
    const du = (qIn - qCurrent) / Math.max(state.h[i], minDepth);
    for (let k = 0; k < NZ; k++) {
      if (wetAt(i, k)) state.u[id(i, k)] = clamp(state.u[id(i, k)] + relax * du, -4.5, 5.5);
    }
  }
}

function stepMomentum(dt, includePressure = true) {
  const n = Number(ui.roughness.value);
  const qIn = Number(ui.inflow.value);
  for (let i = 0; i < NX; i++) {
    const im = Math.max(0, i - 1);
    const ip = Math.min(NX - 1, i + 1);
    let etaX = 0;
    if (includePressure) {
      if (i === 0) etaX = (state.eta[1] - state.eta[0]) / dx;
      else if (i === NX - 1) etaX = (Number(ui.tailwater.value) - state.eta[NX - 2]) / (2 * dx);
      else etaX = (state.eta[i + 1] - state.eta[i - 1]) / (2 * dx);
    }
    const h = Math.max(state.h[i], minDepth);
    const dz = h / NZ;
    for (let k = 0; k < NZ; k++) {
      const p = id(i, k);
      if (!wetAt(i, k)) {
        work.u1[p] = 0;
        continue;
      }
      const km = Math.max(0, k - 1);
      const kp = Math.min(NZ - 1, k + 1);
      const u = state.u[p];
      const w = state.w[p];
      const upwindX = u >= 0 ? (state.u[p] - state.u[id(im, k)]) / ((i - im || 1) * dx) : (state.u[id(ip, k)] - state.u[p]) / ((ip - i || 1) * dx);
      const upwindZ = w >= 0 ? (state.u[p] - state.u[id(i, km)]) / ((k - km || 1) * dz) : (state.u[id(i, kp)] - state.u[p]) / ((kp - k || 1) * dz);
      const d2x = (state.u[id(ip, k)] - 2 * u + state.u[id(im, k)]) / (dx * dx);
      const d2z = (state.u[id(i, kp)] - 2 * u + state.u[id(i, km)]) / (dz * dz);
      const nu = state.nut[p];
      const bedDrag = k === 0 ? g * n * n * u * Math.abs(u) / Math.pow(h, 4 / 3) : 0;
      let gateDrag = 0;
      for (const gate of state.gates) {
        const gi = Math.round(gate.x / dx - 0.5);
        const dist = Math.abs(i - gi);
        if (dist <= 1) {
          const y = state.z[i] + h * (k + 0.5) / NZ;
          if (y > state.z[i] + gate.clearance) gateDrag += 7.5 * (2 - dist) * u;
          else gateDrag += 0.16 * (2 - dist) * u * Math.abs(u);
        }
      }
      work.u1[p] = clamp(u + dt * (-u * upwindX - w * upwindZ - g * etaX + 0.035 * d2x + nu * d2z - bedDrag - gateDrag), -4.5, 5.5);
    }
  }

  for (let i = 0; i < NX; i++) {
    for (let k = 0; k < NZ; k++) {
      const im = Math.max(0, i - 1);
      const ip = Math.min(NX - 1, i + 1);
      const km = Math.max(0, k - 1);
      const kp = Math.min(NZ - 1, k + 1);
      const p = id(i, k);
      const filtered = 0.52 * work.u1[p] + 0.12 * (work.u1[id(im, k)] + work.u1[id(ip, k)]) + 0.12 * (work.u1[id(i, km)] + work.u1[id(i, kp)]);
      work.u2[p] = wetAt(i, k) ? filtered : 0;
    }
  }
  state.u.set(work.u2);

  const inletArea = Math.max(minDepth, state.h[0]);
  const inletMean = qIn / inletArea;
  for (let k = 0; k < NZ; k++) {
    const s = (k + 0.5) / NZ;
    state.u[id(0, k)] = 0.82 * state.u[id(0, k)] + 0.18 * inletMean * (0.48 + 0.72 * Math.pow(s, 1 / 7));
  }
}

function applyVerticalWallLaw(dt) {
  const relax = clamp(dt * 5.0, 0, 0.22);
  for (let i = 0; i < NX; i++) {
    const mean = state.q[i] / Math.max(state.h[i], minDepth);
    let shapeMean = 0;
    let wetCount = 0;
    for (let k = 0; k < NZ; k++) {
      if (!wetAt(i, k)) continue;
      const s = (k + 0.5) / NZ;
      shapeMean += 0.34 + 0.92 * Math.pow(s, 1 / 7);
      wetCount++;
    }
    shapeMean /= Math.max(1, wetCount);
    for (let k = 0; k < NZ; k++) {
      if (!wetAt(i, k)) continue;
      const s = (k + 0.5) / NZ;
      const target = mean * (0.34 + 0.92 * Math.pow(s, 1 / 7)) / shapeMean;
      state.u[id(i, k)] += relax * (target - state.u[id(i, k)]);
    }
  }
}

function stepHydraulics(dt) {
  applyBoundaryConditions();
  updateDerivedFields();
  const maxU = Math.max(0.25, state.u.reduce((a, b) => Math.max(a, Math.abs(b)), 0));
  const cflDt = Math.min(dt, 0.35 * dx / (maxU + Math.sqrt(g * 3.0)));
  stepMomentum(cflDt, false);
  updateDerivedFields();
  solveFreeSurface(cflDt);
  updateDerivedFields();
  applyVerticalWallLaw(cflDt);
  updateDerivedFields();
}

function froudeAt(i) {
  const h = Math.max(state.h[i], minDepth);
  return Math.abs(state.q[i] / h) / Math.sqrt(g * h);
}

function jumpCells() {
  const cells = [];
  for (let i = 1; i < NX - 1; i++) {
    const up = froudeAt(i - 1);
    const dn = froudeAt(i + 1);
    const rise = state.eta[i + 1] - state.eta[i - 1];
    if (up > 1.0 && dn < 0.95 && rise > 0.05) cells.push(i);
  }
  return cells;
}

function classifyFlow() {
  const qMean = Math.max(0.03, state.q.reduce((a, b) => a + b, 0) / NX);
  const slope = Math.max(0.0005, (state.z[0] - state.z[NX - 1]) / L);
  const n = Number(ui.roughness.value);
  const yn = normalDepth(qMean, slope, n);
  const yc = Math.pow(qMean * qMean / g, 1 / 3);
  const mild = yn > yc;
  const hMid = state.h[Math.floor(NX * 0.55)];
  let zone = "3";
  if (hMid > Math.max(yn, yc)) zone = "1";
  else if (hMid > Math.min(yn, yc)) zone = "2";
  return { label: `${mild ? "緩勾配" : "急勾配"} ${mild ? "M" : "S"}${zone}`, yn, yc };
}

function velocityAt(x, y) {
  const zb = bedAt(x);
  const h = depthAt(x);
  const eta = zb + h;
  if (y < zb || y > eta) return { u: 0, v: 0, vort: 0, inside: false };
  const fx = clamp(x / dx - 0.5, 0, NX - 1);
  const i0 = Math.floor(fx);
  const i1 = Math.min(NX - 1, i0 + 1);
  const tx = fx - i0;
  const s = clamp((y - zb) / h, 0, 0.999);
  const fz = s * NZ - 0.5;
  const k0 = clamp(Math.floor(fz), 0, NZ - 1);
  const k1 = Math.min(NZ - 1, k0 + 1);
  const tz = clamp(fz - k0, 0, 1);
  const interp = arr => {
    const a = arr[id(i0, k0)] * (1 - tx) + arr[id(i1, k0)] * tx;
    const b = arr[id(i0, k1)] * (1 - tx) + arr[id(i1, k1)] * tx;
    return a * (1 - tz) + b * tz;
  };
  return { u: interp(state.u), v: interp(state.w), vort: interp(state.vort), inside: true };
}

function updateParticles(dt) {
  const mode = Number(ui.particles.value);
  if (mode === 0) {
    state.particles.length = 0;
    return;
  }
  state.spawnCarry += dt * (7 + 2 * mode);
  while (state.spawnCarry > 1 && state.particles.length < 420) {
    state.spawnCarry -= 1;
    const h0 = depthAt(0.6);
    state.particles.push({ x: 0.4, y: bedAt(0.4) + h0 * (0.14 + Math.random() * 0.72), age: 0, trail: [] });
  }
  const maxTrail = mode * 16;
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    const vel = velocityAt(p.x, p.y);
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > maxTrail) p.trail.splice(0, p.trail.length - maxTrail);
    p.x += vel.u * dt * 4.0;
    p.y += vel.v * dt * 4.0;
    p.age += dt;
    const x = clamp(p.x, 0, L);
    p.y = clamp(p.y, bedAt(x) + 0.035, surfaceAt(x) - 0.035);
    if (p.x > L + 1 || p.x < -2 || p.age > 100) state.particles.splice(i, 1);
  }
}

function updateViewRange() {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < NX; i++) {
    lo = Math.min(lo, state.z[i] - 0.25);
    hi = Math.max(hi, state.eta[i] + 0.55);
  }
  for (const gate of state.gates) hi = Math.max(hi, bedAt(gate.x) + gate.clearance + 1.2);
  view.minY += (lo - view.minY) * 0.08;
  view.maxY += (hi - view.maxY) * 0.08;
}

function colorJet(t) {
  t = clamp(t, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * t - 3), 0, 1);
  const gg = clamp(1.5 - Math.abs(4 * t - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * t - 1), 0, 1);
  return `rgb(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(b * 255)})`;
}

function colorBwr(v) {
  const t = clamp(v, -1, 1);
  if (t >= 0) {
    const c = Math.round(255 * (1 - t));
    return `rgb(255,${c},${c})`;
  }
  const c = Math.round(255 * (1 + t));
  return `rgb(${c},${c},255)`;
}

function pathLine(values) {
  ctx.beginPath();
  for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * dx;
    const y = values(i);
    if (i === 0) ctx.moveTo(xToPx(x), yToPx(y));
    else ctx.lineTo(xToPx(x), yToPx(y));
  }
}

function fillWater() {
  ctx.beginPath();
  for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * dx;
    if (i === 0) ctx.moveTo(xToPx(x), yToPx(state.eta[i]));
    else ctx.lineTo(xToPx(x), yToPx(state.eta[i]));
  }
  for (let i = NX - 1; i >= 0; i--) ctx.lineTo(xToPx((i + 0.5) * dx), yToPx(state.z[i]));
  ctx.closePath();
  ctx.fillStyle = "rgba(82, 166, 197, 0.27)";
  ctx.fill();
}

function drawContour() {
  const mode = ui.contour.value;
  if (mode === "off") return;
  for (let i = 0; i < NX; i++) {
    const x0 = xToPx(i * dx);
    const x1 = xToPx((i + 1) * dx);
    for (let k = 0; k < NZ; k++) {
      if (!wetAt(i, k)) continue;
      const y0 = state.z[i] + state.h[i] * k / NZ;
      const y1 = state.z[i] + state.h[i] * (k + 1) / NZ;
      const p = id(i, k);
      const speed = Math.hypot(state.u[p], state.w[p]);
      ctx.fillStyle = mode === "speed" ? colorJet(speed / 3.5) : colorBwr(state.vort[p] / 3.5);
      ctx.globalAlpha = 0.62;
      ctx.fillRect(x0, yToPx(y1), x1 - x0 + 1, yToPx(y0) - yToPx(y1) + 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawVectors() {
  if (!ui.vectors.checked) return;
  ctx.save();
  ctx.strokeStyle = "rgba(19, 53, 68, 0.72)";
  ctx.fillStyle = "rgba(19, 53, 68, 0.72)";
  ctx.lineWidth = 1;
  for (let i = 2; i < NX; i += 4) {
    for (let k = 2; k < NZ; k += 4) {
      if (!wetAt(i, k)) continue;
      const x = (i + 0.5) * dx;
      const y = state.z[i] + state.h[i] * (k + 0.5) / NZ;
      const p = id(i, k);
      const px = xToPx(x);
      const py = yToPx(y);
      const len = clamp(Math.hypot(state.u[p], state.w[p]) * 8, 3, 21);
      const ang = Math.atan2(-state.w[p], state.u[p]);
      const ex = px + Math.cos(ang) * len;
      const ey = py + Math.sin(ang) * len;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.55) * 5, ey - Math.sin(ang - 0.55) * 5);
      ctx.lineTo(ex - Math.cos(ang + 0.55) * 5, ey - Math.sin(ang + 0.55) * 5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawParticles() {
  if (Number(ui.particles.value) === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  for (const p of state.particles) {
    for (let i = 1; i < p.trail.length; i++) {
      const a = i / p.trail.length;
      ctx.strokeStyle = `rgba(12, 71, 88, ${0.05 + 0.48 * a})`;
      ctx.lineWidth = 1 + 1.8 * a;
      ctx.beginPath();
      ctx.moveTo(xToPx(p.trail[i - 1].x), yToPx(p.trail[i - 1].y));
      ctx.lineTo(xToPx(p.trail[i].x), yToPx(p.trail[i].y));
      ctx.stroke();
    }
    ctx.fillStyle = "#102f3f";
    ctx.beginPath();
    ctx.arc(xToPx(p.x), yToPx(p.y), 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBedHandles() {
  ctx.save();
  ctx.fillStyle = "rgba(121, 99, 74, 0.85)";
  for (let i = 0; i < NX; i += 2) {
    ctx.beginPath();
    ctx.arc(xToPx((i + 0.5) * dx), yToPx(state.z[i]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGates() {
  ctx.save();
  for (let idx = 0; idx < state.gates.length; idx++) {
    const gate = state.gates[idx];
    const x = gate.x;
    const lower = bedAt(x) + gate.clearance;
    const px = xToPx(x);
    const yTop = yToPx(view.maxY - 0.18);
    const yLow = yToPx(lower);
    ctx.strokeStyle = "#222831";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px, yTop);
    ctx.lineTo(px, yLow);
    ctx.stroke();
    ctx.fillStyle = "#d24b55";
    ctx.fillRect(px - 13, yLow - 5, 26, 10);
    ctx.fillStyle = "#222831";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`G${idx + 1}`, px, yLow - 12);
  }
  ctx.restore();
}

function drawAxes() {
  ctx.save();
  ctx.strokeStyle = "#cad3dd";
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#6a7686";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 6; i++) {
    const y = view.minY + (view.maxY - view.minY) * i / 6;
    const py = yToPx(y);
    ctx.beginPath();
    ctx.moveTo(view.left, py);
    ctx.lineTo(view.w - view.right, py);
    ctx.stroke();
    ctx.fillText(y.toFixed(1), view.left - 8, py);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 5; i++) ctx.fillText(String(Math.round(L * i / 5)), xToPx(L * i / 5), view.h - view.bottom + 10);
  ctx.restore();
}

function render() {
  updateViewRange();
  ctx.clearRect(0, 0, view.w, view.h);
  drawAxes();
  fillWater();
  drawContour();

  pathLine(i => state.eta[i]);
  ctx.strokeStyle = "#126c87";
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(xToPx(0), yToPx(view.minY));
  for (let i = 0; i < NX; i++) ctx.lineTo(xToPx((i + 0.5) * dx), yToPx(state.z[i]));
  ctx.lineTo(xToPx(L), yToPx(view.minY));
  ctx.closePath();
  ctx.fillStyle = "rgba(121, 99, 74, 0.55)";
  ctx.fill();

  pathLine(i => state.z[i]);
  ctx.strokeStyle = "#5f4d3a";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawVectors();
  drawParticles();
  drawGates();
  drawBedHandles();

  const cls = classifyFlow();
  const jumps = jumpCells();
  const mid = Math.floor(NX / 2);
  ui.flowClass.textContent = `${cls.label}  yn=${cls.yn.toFixed(2)}m  yc=${cls.yc.toFixed(2)}m`;
  ui.jumpState.textContent = jumps.length ? `跳水候補: ${jumps.map(i => Math.round((i + 0.5) * dx)).join(", ")} m` : "跳水候補なし";
  ui.readout.textContent = `2DV静水圧 sigma15  Fr=${froudeAt(mid).toFixed(2)}  h=${state.h[mid].toFixed(2)}m  q=${state.q[mid].toFixed(2)}m3/s`;
}

function animate() {
  const dt = 1 / 60;
  if (!ui.pause.checked) {
    for (let k = 0; k < 4; k++) stepHydraulics(dt / 4);
    updateParticles(dt);
    state.time += dt;
  }
  render();
  requestAnimationFrame(animate);
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const p = event.touches ? event.touches[0] : event;
  return { px: p.clientX - rect.left, py: p.clientY - rect.top };
}

function nearestGate(px, py) {
  for (let i = state.gates.length - 1; i >= 0; i--) {
    const gate = state.gates[i];
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
    state.drag = { type: "gate", index: gi };
    return;
  }
  const x = pxToX(px);
  const i = clamp(Math.round(x / dx - 0.5), 0, NX - 1);
  const bedPy = yToPx(state.z[i]);
  if (Math.abs(py - bedPy) < 30 || py > bedPy - 60) {
    state.drag = { type: "bed", index: i };
    dragMove(event);
  }
}

function dragMove(event) {
  if (!state.drag) return;
  event.preventDefault();
  const { px, py } = pointerPosition(event);
  const y = pxToY(py);
  if (state.drag.type === "bed") {
    const i = state.drag.index;
    const old = state.z[i];
    const etaBefore = state.eta[i];
    const next = clamp(y, -0.25, 2.35);
    state.z[i] = next;
    state.eta[i] = Math.max(etaBefore, state.z[i] + minDepth);
    state.h[i] = state.eta[i] - state.z[i];
    for (const gate of state.gates) {
      const gi = clamp(Math.round(gate.x / dx - 0.5), 0, NX - 1);
      if (Math.abs(gi - i) < 2) gate.clearance = Math.max(gate.clearance + old - next, minGateClearance);
    }
  } else if (state.drag.type === "gate") {
    const gate = state.gates[state.drag.index];
    gate.x = clamp(pxToX(px), dx, L - dx);
    gate.clearance = clamp(y - bedAt(gate.x), minGateClearance, 2.2);
  }
  updateDerivedFields();
}

function endDrag() {
  state.drag = null;
}

ui.addGate.addEventListener("click", () => {
  const x = L * (0.42 + 0.16 * (state.gates.length % 3));
  state.gates.push({ x, clearance: 0.72 });
});

ui.resetBed.addEventListener("click", () => {
  resetBed();
  state.gates.length = 0;
});

for (const el of [ui.inflow, ui.tailwater, ui.roughness, ui.particles]) {
  el.addEventListener("input", updateOutputs);
}

canvas.addEventListener("pointerdown", beginDrag);
canvas.addEventListener("pointermove", dragMove);
window.addEventListener("pointerup", endDrag);
canvas.addEventListener("touchstart", beginDrag, { passive: false });
canvas.addEventListener("touchmove", dragMove, { passive: false });
window.addEventListener("touchend", endDrag);
window.addEventListener("resize", resize);

resize();
resetBed();
updateOutputs();
requestAnimationFrame(animate);
