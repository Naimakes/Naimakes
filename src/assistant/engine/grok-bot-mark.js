/*!
 * grok-bot-mark.js  v1.0.0  - embeddable, dependency-free "Grok Bot" mascot (SVG)
 *
 * ADAPTED from the motion engine of the Grok Bot desktop app (v0.68.1, platform chunk).
 * The engine part below keeps the original structure, constants, face geometry, spring/easing
 * values, clip data and gaze/poke logic; the Electron / React / app-business layers were removed
 * and replaced by a small DOM wrapper + public API. Identifier names inside the engine section are
 * the app's own (minified) names - see the legend right below. Only the sphere body and its
 * eyes/clips/states/morph overlays are included (the 24 other body shapes were dropped).
 *
 * Engine name legend (original minified -> meaning):
 *  hs/fs spring state/step   Ca cubic-bezier easing   Z1 spring substeps   Fs/Ge/io/rk easing fns
 *  _a/J1 eye capsule frames on the unit sphere        ln face geometry table (9 faces)
 *  Gk face engine (morph/blink/lid)     Qk poke offsets   Ou/rw gaze -> pose, pointer -> [-1,1]
 *  dw morph (overlay) controller        oh motion controller (clips, gaze, pokes)
 *  _w clip table      zu state table    zw state machine     Wh frame -> SVG string   AM DOM differ
 *  Hk inspecting eye-size swap          $u/Cu lid (blink) transforms
 */
/* ES module build */

/* ---- Palette tables (original: ek / Y1) ---- */
const ek = {
    black: {
      lightFrom: "#585858",
      lightTo: "#000000",
      darkFrom: "#FFFFFF",
      darkTo: "#C2C2C2",
    },
    brown: {
      lightFrom: "#AE8968",
      lightTo: "#855C36",
      darkFrom: "#A27952",
      darkTo: "#604227",
    },
    red: {
      lightFrom: "#FF5667",
      lightTo: "#E02135",
      darkFrom: "#FF3E51",
      darkTo: "#A21826",
    },
    orange: {
      lightFrom: "#FF8838",
      lightTo: "#E05B00",
      darkFrom: "#FF781C",
      darkTo: "#C24E00",
    },
    yellow: {
      lightFrom: "#FFAF38",
      lightTo: "#E08600",
      darkFrom: "#FFA31C",
      darkTo: "#C27400",
    },
    green: {
      lightFrom: "#1CCF82",
      lightTo: "#009957",
      darkFrom: "#00C972",
      darkTo: "#008048",
    },
    cyan: {
      lightFrom: "#58D3C5",
      lightTo: "#00A592",
      darkFrom: "#1CC3B0",
      darkTo: "#007769",
    },
    blue: {
      lightFrom: "#459FFE",
      lightTo: "#0E74E0",
      darkFrom: "#2A92FE",
      darkTo: "#0C64C1",
    },
    violet: {
      lightFrom: "#B792FE",
      lightTo: "#804EE0",
      darkFrom: "#9159FE",
      darkTo: "#5C39A1",
    },
    magenta: {
      lightFrom: "#FF77BE",
      lightTo: "#E02A88",
      darkFrom: "#FF47A6",
      darkTo: "#A21E62",
    },
    gray: {
      lightFrom: "#A6A6A6",
      lightTo: "#696969",
      darkFrom: "#B7B7B7",
      darkTo: "#777777",
    },
  },
  tk = 135;
function L_(e) {
  const t = ek[e];
  return {
    from: `light-dark(${t.lightFrom}, ${t.darkFrom})`,
    to: `light-dark(${t.lightTo}, ${t.darkTo})`,
    angle: tk,
  };
}
const Y1 = {
  black: { light: "#000000", dark: "#FFFFFF" },
  brown: { light: "#A27952", dark: "#855C36" },
  red: { light: "#FF3E51", dark: "#E02135" },
  orange: { light: "#FF781C", dark: "#FF6700" },
  yellow: { light: "#FFAF38", dark: "#FF9800" },
  green: { light: "#00C972", dark: "#009957" },
  cyan: { light: "#1CC3B0", dark: "#00A592" },
  blue: { light: "#2A92FE", dark: "#0E74E0" },
  violet: { light: "#A97EFE", dark: "#804EE0" },
  magenta: { light: "#FF5EB1", dark: "#E02A88" },
  gray: { light: "#959595", dark: "#777777" },
};
function N_(e) {
  const t = Y1[e];
  return `light-dark(${t.light}, ${t.dark})`;
}
function F_(e, t) {
  return Y1[e][t];
}

/* ---- Core: springs/easing/bezier (hs,fs,Ca), quaternions, eye frames J1, FACE geometry `ln`, face engine `Gk`, poke `Qk`, gaze `Ou/rw`, morph controller `dw`, motion controller `oh` (original lines 136-1794) ---- */
const hs = (e) => ({ x: e, v: 0, t: e }),
  fs = (e, t, n, r) => {
    ((e.v += (-2 * n * t * e.v - t * t * (e.x - e.t)) * r),
      (e.x += e.v * r),
      (!Number.isFinite(e.x) || !Number.isFinite(e.v)) &&
        ((e.x = e.t), (e.v = 0)));
  },
  nk = 1 / 120,
  Z1 = (e) => Math.max(1, Math.ceil(e / nk)),
  de = (e, t, n) => Math.min(n, Math.max(t, e)),
  Fs = (e) => (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2),
  Ge = (e) => 1 - Math.pow(1 - e, 3),
  io = (e) => 1 + 2.70158 * Math.pow(e - 1, 3) + 1.70158 * Math.pow(e - 1, 2),
  rk = (e) => e * e * (3 - 2 * e),
  Gn = [0.42, 0, 0.58, 1],
  sk = [0.4, 0.06, 0.18, 1],
  ok = 0.28,
  Li = 0.35,
  Ni = 0.26,
  ik = 4.25 / 60,
  ak = 2 / 60,
  Bo = 1.06;
function Pu(e, t, n) {
  const r = 1 - e;
  return 3 * r * r * e * t + 3 * r * e * e * n + e * e * e;
}
function ck(e, t, n) {
  const r = 1 - e;
  return 3 * r * r * t + 6 * r * e * (n - t) + 3 * e * e * (1 - n);
}
function Ca(e, t) {
  const [n, r, s, o] = t;
  let i = e;
  for (let a = 0; a < 8; a++) {
    const c = Pu(i, n, s) - e,
      u = ck(i, n, s);
    if (Math.abs(c) < 1e-6 || Math.abs(u) < 1e-6) break;
    i = Math.min(1, Math.max(0, i - c / u));
  }
  return Pu(i, r, o);
}
function js(e) {
  const t = Math.min(1, Math.max(0, e));
  return t * t * (3 - 2 * t);
}
function Ho(e, t) {
  const r = Math.min(0.28, (e ? ak : ik) / Math.max(t, 0.05)),
    s = (1 - r) * 0.42;
  return { u1: s, u2: s + r };
}
function uk(e) {
  const t = Math.min(1, Math.max(0, e));
  if (t < 0.7) {
    const n = t / 0.7;
    return (1 - (1 - n) * (1 - n)) * Bo;
  }
  return Bo + (1 - Bo) * js((t - 0.7) / 0.3);
}
function lk(e, { u1: t, u2: n }) {
  return e < t
    ? js(e / t)
    : e <= n
      ? 1
      : 1 - js((e - n) / Math.max(1e-6, 1 - n));
}
const hn = Math.PI / 180;
function Fi(e, t) {
  return [
    e[0] * t[0] - e[1] * t[1] - e[2] * t[2] - e[3] * t[3],
    e[0] * t[1] + e[1] * t[0] + e[2] * t[3] - e[3] * t[2],
    e[0] * t[2] - e[1] * t[3] + e[2] * t[0] + e[3] * t[1],
    e[0] * t[3] + e[1] * t[2] - e[2] * t[1] + e[3] * t[0],
  ];
}
function ps(e, t) {
  const n = Math.sin(t / 2);
  return [Math.cos(t / 2), e[0] * n, e[1] * n, e[2] * n];
}
function dk(e) {
  const t = Math.hypot(e[0], e[1], e[2], e[3]) || 1;
  return [e[0] / t, e[1] / t, e[2] / t, e[3] / t];
}
function hk(e, t) {
  const n = 1 + (e[0] * t[0] + e[1] * t[1] + e[2] * t[2]);
  return dk([
    n,
    e[1] * t[2] - e[2] * t[1],
    e[2] * t[0] - e[0] * t[2],
    e[0] * t[1] - e[1] * t[0],
  ]);
}
function Xn(e) {
  const [t, n, r, s] = e;
  return [
    1 - 2 * (r * r + s * s),
    2 * (n * r - t * s),
    2 * (n * s + t * r),
    2 * (n * r + t * s),
    1 - 2 * (n * n + s * s),
    2 * (r * s - t * n),
    2 * (n * s - t * r),
    2 * (r * s + t * n),
    1 - 2 * (n * n + r * r),
  ];
}
function fk(e, t, n) {
  return Fi(ps([0, 0, 1], n), Fi(ps([0, 1, 0], t), ps([1, 0, 0], e)));
}
function Q1(e) {
  const t = e[0],
    n = e[3],
    r = e[5],
    s = e[4],
    o = e[6],
    i = e[7],
    a = e[8],
    c = Math.max(-1, Math.min(1, -o)),
    u = Math.asin(c);
  return Math.abs(c) > 0.999999
    ? [Math.atan2(-r, s), u, 0]
    : [Math.atan2(i, a), u, Math.atan2(n, t)];
}
function pk(e) {
  return Q1(Xn(e));
}
function wt(e, t) {
  return [
    e[0] * t[0] + e[1] * t[1] + e[2] * t[2],
    e[3] * t[0] + e[4] * t[1] + e[5] * t[2],
    e[6] * t[0] + e[7] * t[1] + e[8] * t[2],
  ];
}
const Iu = 0.1305,
  _a = [
    {
      A: [0.01722, 0.45638, 0.88962],
      B: [0.186, 0.20949, 0.95996],
      N: [0.82924, 0.4906, -0.26773],
    },
    {
      A: [0.48863, 0.67924, 0.54762],
      B: [0.65674, 0.43195, 0.61815],
      N: [0.60389, 0.18972, -0.77416],
    },
  ];
function zs(e) {
  const t = Math.hypot(e[0], e[1], e[2]) || 1;
  return [e[0] / t, e[1] / t, e[2] / t];
}
const mk = (() => {
    let e = [0, 0, 0];
    for (const { A: t, B: n } of _a) {
      const r = zs([t[0] + n[0], t[1] + n[1], t[2] + n[2]]);
      e = [e[0] + r[0], e[1] + r[1], e[2] + r[2]];
    }
    return zs(e);
  })(),
  cr = (() => {
    const e = hk(mk, [0, 0, 1]),
      t = Xn(e);
    let n = 0,
      r = 0;
    for (const { A: i, B: a } of _a) {
      const c = wt(t, [a[0] - i[0], a[1] - i[1], a[2] - i[2]]);
      ((n += c[0]), (r += c[1]));
    }
    const s = Math.atan2(r, n),
      o =
        ((((Math.PI / 2 - s + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) -
        Math.PI / 2;
    return Fi(ps([0, 0, 1], o), e);
  })(),
  gk = (() => {
    const e = Xn(cr);
    return _a.map(({ A: t, B: n, N: r }) => ({
      A: wt(e, t),
      B: wt(e, n),
      N: wt(e, r),
    }));
  })(),
  yk = [cr[0], -cr[1], -cr[2], -cr[3]],
  J1 = (() => {
    const e = ({ A: r, B: s }) => {
        const o = zs([r[0] + s[0], r[1] + s[1], r[2] + s[2]]),
          i = s[0] * o[0] + s[1] * o[1] + s[2] * o[2];
        let a = zs([s[0] - i * o[0], s[1] - i * o[1], s[2] - i * o[2]]);
        a[1] < 0 && (a = [-a[0], -a[1], -a[2]]);
        let c = [
          o[1] * a[2] - o[2] * a[1],
          o[2] * a[0] - o[0] * a[2],
          o[0] * a[1] - o[1] * a[0],
        ];
        return (
          c[0] * o[0] < 0 && (c = [-c[0], -c[1], -c[2]]),
          { M: o, T: a, C: c }
        );
      },
      [t, n] = gk;
    if (t == null || n == null)
      throw new Error("Motion Lab defines exactly two eye capsules");
    return [e(t), e(n)];
  })(),
  kk = [
    "sphere",
    "cloud",
    "square",
    "sparkle",
    "clover",
    "heartChubby",
    "starFlower",
    "teardrop",
    "tablet",
    "wedge",
    "house",
    "star6",
    "pebble",
    "bean",
    "egg",
    "squircle",
    "capsule",
    "cylinder",
    "hex",
    "gem",
    "crystal",
    "shield",
    "dome",
    "arch",
    "leaf",
  ],
  wk = [
    "neutral",
    "happy",
    "surprised",
    "sad",
    "sleepy",
    "squinted",
    "calm",
    "inspecting",
    "confused",
  ],
  ur = 0.26,
  bk = 21,
  xk = 18,
  vk = new Map([
    ["thinking", "sad"],
    ["strange", "inspecting"],
    ["angry", "neutral"],
    ["inspect", "inspecting"],
    ["squint", "squinted"],
    ["idle", "neutral"],
    ["smile", "happy"],
    ["sleep", "sleepy"],
  ]),
  Sk = new Set(["sad", "happy", "confused", "squinted", "sleepy"]);
function Ur(e, t) {
  return [e[t * 6], e[t * 6 + 1]];
}
function Kr(e, t, n) {
  const r = n ? 4 : 2;
  return [e[t * 6] + e[t * 6 + r], e[t * 6 + 1] + e[t * 6 + r + 1]];
}
function eh(e) {
  const t = (bk + 1) >> 1,
    n = [],
    r = (s, o, i, a, c) => {
      for (let u = c; u < t; u++) {
        const l = u / (t - 1),
          d = 1 - l,
          h = d * d * d,
          f = 3 * d * d * l,
          p = 3 * d * l * l,
          m = l * l * l;
        n.push([
          h * s[0] + f * o[0] + p * i[0] + m * a[0],
          h * s[1] + f * o[1] + p * i[1] + m * a[1],
        ]);
      }
    };
  return (
    r(Ur(e, 0), Kr(e, 0, !0), Kr(e, 1, !1), Ur(e, 1), 0),
    r(Ur(e, 1), Kr(e, 1, !0), Kr(e, 2, !1), Ur(e, 2), 1),
    n
  );
}
function Mk({ p0: e, p1: t, p2: n, isArc: r }) {
  const [s, o] = e,
    [i, a] = t,
    [c, u] = n,
    l = new Array(xk).fill(0),
    d = (y, w) => {
      ((l[y * 6] = w[0]), (l[y * 6 + 1] = w[1]));
    },
    h = (y, w) => {
      ((l[y * 6 + 2] = w[0] - l[y * 6]), (l[y * 6 + 3] = w[1] - l[y * 6 + 1]));
    },
    f = (y, w) => {
      ((l[y * 6 + 4] = w[0] - l[y * 6]), (l[y * 6 + 5] = w[1] - l[y * 6 + 1]));
    };
  if (r) {
    const y = 2 * (s * (a - u) + i * (u - o) + c * (o - a));
    if (Math.abs(y) > 1e-9) {
      const S = s * s + o * o,
        v = i * i + a * a,
        x = c * c + u * u,
        E = (S * (a - u) + v * (u - o) + x * (o - a)) / y,
        A = (S * (c - i) + v * (s - c) + x * (i - s)) / y,
        j = Math.hypot(s - E, o - A),
        F = Math.atan2(o - A, s - E),
        O = Math.atan2(u - A, c - E),
        L = Math.atan2(a - A, i - E),
        T = Math.PI * 2,
        I = (O - F + T) % T,
        R = (L - F + T) % T <= I ? I : I - T,
        U = (K) => [E + j * Math.cos(K), A + j * Math.sin(K)],
        W = (K) => [-Math.sin(K), Math.cos(K)],
        G = R / 2,
        J = (4 / 3) * Math.tan(G / 4) * j,
        ye = [F, F + G, F + R];
      for (let K = 0; K < 3; K++) {
        const ae = U(ye[K]),
          ee = W(ye[K]);
        (d(K, ae),
          K > 0 && h(K, [ae[0] - J * ee[0], ae[1] - J * ee[1]]),
          K < 2 && f(K, [ae[0] + J * ee[0], ae[1] + J * ee[1]]));
      }
      return l;
    }
    const w = [(s + c) / 2, (o + u) / 2];
    return (
      d(0, [s, o]),
      d(1, w),
      d(2, [c, u]),
      f(0, [s + (w[0] - s) / 3, o + (w[1] - o) / 3]),
      h(1, [w[0] - (w[0] - s) / 3, w[1] - (w[1] - o) / 3]),
      f(1, [w[0] + (c - w[0]) / 3, w[1] + (u - w[1]) / 3]),
      h(2, [c - (c - w[0]) / 3, u - (u - w[1]) / 3]),
      l
    );
  }
  const p = [(s + i) / 2, (o + a) / 2],
    m = [(i + c) / 2, (a + u) / 2],
    g = [(p[0] + m[0]) / 2, (p[1] + m[1]) / 2];
  return (
    d(0, [s, o]),
    d(1, g),
    d(2, [c, u]),
    f(0, [s + (2 / 3) * (p[0] - s), o + (2 / 3) * (p[1] - o)]),
    h(1, [g[0] + (2 / 3) * (p[0] - g[0]), g[1] + (2 / 3) * (p[1] - g[1])]),
    f(1, [g[0] + (2 / 3) * (m[0] - g[0]), g[1] + (2 / 3) * (m[1] - g[1])]),
    h(2, [c + (2 / 3) * (m[0] - c), u + (2 / 3) * (m[1] - u)]),
    l
  );
}
function pr(e, t, n, r, s) {
  const o = Mk(r);
  return {
    off: e,
    tilt: t,
    wid: n,
    lidY: 1,
    oval: s,
    ovalMix: 0,
    pts: eh(o),
    path: o,
    fillRing: null,
  };
}
function Ra(e, t, n, r, s) {
  const o = Math.max(0, (t - e) / 2),
    i = (n * Math.PI) / 180,
    a = Math.sin(i) * o,
    c = Math.cos(i) * o;
  return pr(
    r,
    s,
    e / 2,
    { p0: [-a, -c], p1: [0, 0], p2: [a, c], isArc: !1 },
    [0, 0],
  );
}
function En(e, t, n, r) {
  return Ra(e, t, n, [r, 0], 0);
}
function Tk(e, t, n) {
  const r = { p0: [-e, 0], p1: [0, 0], p2: [e, 0], isArc: !1 };
  return pr([n, 0], 0, t, r, [e, t]);
}
function zt(e) {
  return [e, e];
}
const ln = {
  neutral: zt(En(ur, 0.57, 0, 0)),
  happy: zt(
    pr(
      [0.03, 0.03],
      0,
      Iu,
      { p0: [0.16, -0.04], p1: [0, 0.12], p2: [-0.16, -0.04], isArc: !0 },
      [0, 0],
    ),
  ),
  surprised: zt(En(0.42, 0.86, 0, 0.03)),
  inspecting: [En(0.54, 0.54, 0, 0.04), En(0.27, 0.27, 0, 0.04)],
  sad: zt(En(ur, 0.5, -28, -0.05)),
  sleepy: zt(
    pr(
      [0.01, 0],
      0,
      ur / 2,
      { p0: [-0.11, 0.025], p1: [0, -0.05], p2: [0.11, 0.025], isArc: !1 },
      [0, 0],
    ),
  ),
  squinted: zt(En(ur, 0.5, 90, 0.01)),
  calm: zt(Tk(0.296, 0.247, 0.05)),
  confused: zt(
    pr(
      [-0.1, 0],
      0,
      Iu,
      { p0: [0.01, 0.16], p1: [-0.17, 0], p2: [0.01, -0.16], isArc: !1 },
      [0, 0],
    ),
  ),
};
function Ek(e) {
  return wk.some((t) => t === e);
}
function Pk(e) {
  const t = e.trim().toLowerCase(),
    n = vk.get(t) ?? t;
  return Ek(n) ? n : "neutral";
}
function vr(e) {
  return Sk.has(e);
}
function Ik(e) {
  return !vr(e) && !ln[e].some($t);
}
function Qe(e, t) {
  return [t(e[0], 0), t(e[1], 1)];
}
function ft(e) {
  return { ...e, ovalMix: 0 };
}
function $t(e) {
  return e.oval[0] > 1e-4 && e.oval[1] > 1e-4;
}
function Ds(e) {
  if ($t(e) || e.pts.length < 3) return !1;
  const t = e.pts[0],
    n = e.pts[e.pts.length - 1],
    r = n[0] - t[0],
    s = n[1] - t[1],
    o = r * r + s * s;
  if (o < 1e-8) return !1;
  let i = 0;
  for (const a of e.pts) {
    const c = ((a[0] - t[0]) * r + (a[1] - t[1]) * s) / o,
      u = t[0] + c * r,
      l = t[1] + c * s,
      d = Math.hypot(a[0] - u, a[1] - l);
    d > i && (i = d);
  }
  return i > Math.max(0.012, e.wid * 0.2);
}
const Ak = 0.03,
  $k = 0.6,
  Ck = 0.42,
  _k = 20;
function zn(e, t, n) {
  return e + (t - e) * n;
}
function ms(e, t, n) {
  return [zn(e[0], t[0], n), zn(e[1], t[1], n)];
}
function Au(e, t, n) {
  if (e.length === 0) return [0, 0];
  if (e.length === 1 || n <= 1) return e[0];
  const r = (t / (n - 1)) * (e.length - 1),
    s = Math.min(Math.floor(r), e.length - 2);
  return ms(e[s], e[s + 1], r - s);
}
function Rk(e, t, n) {
  const r = {
    off: ms(e.off, t.off, n),
    tilt: zn(e.tilt, t.tilt, n),
    wid: zn(e.wid, t.wid, n),
    lidY: zn(e.lidY, t.lidY, n),
    oval: ms(e.oval, t.oval, n),
    ovalMix: 0,
    fillRing: null,
  };
  if (e.path && t.path && e.path.length === t.path.length) {
    const i = t.path,
      a = e.path.map((c, u) => zn(c, i[u], n));
    return { ...r, path: a, pts: eh(a) };
  }
  const s = Math.max(e.pts.length, t.pts.length, 2),
    o = [];
  for (let i = 0; i < s; i++) o.push(ms(Au(e.pts, i, s), Au(t.pts, i, s), n));
  return { ...r, path: null, pts: o };
}
function qs(e) {
  if ($t(e)) {
    const [s, o] = e.oval;
    return {
      cx: e.off[0],
      cy: e.off[1],
      ang: s >= o ? Math.PI / 2 : 0,
      halfLen: Math.max(s, o),
      halfW: Math.min(s, o),
    };
  }
  const t = e.wid;
  if (e.pts.length < 2)
    return { cx: e.off[0], cy: e.off[1], ang: e.tilt, halfLen: t, halfW: t };
  const n = e.pts[0],
    r = e.pts[e.pts.length - 1];
  return {
    cx: e.off[0] + (n[0] + r[0]) / 2,
    cy: e.off[1] + (n[1] + r[1]) / 2,
    ang: Math.atan2(r[0] - n[0], r[1] - n[1]) + e.tilt,
    halfLen: Math.hypot(r[0] - n[0], r[1] - n[1]) / 2 + t,
    halfW: t,
  };
}
function th(e, t) {
  let n = t.ang - e.ang;
  for (; n > Math.PI / 2;) n -= Math.PI;
  for (; n < -Math.PI / 2;) n += Math.PI;
  return n;
}
function Ok(e, t, n) {
  const s = Math.max(0, e - t),
    o = Math.max(0, Math.min(1, n)),
    i = [];
  for (let a = 0; a < 48; a++) {
    const c = (a / 48) * Math.PI * 2,
      u = Math.cos(c),
      l = Math.sin(c),
      d = t * u,
      h = e * l,
      f = t / Math.max(Math.abs(u), 1e-6);
    let p;
    if (f * Math.abs(l) <= s + 1e-6 && Number.isFinite(f)) p = f;
    else {
      const w = (l >= 0 ? 1 : -1) * s * l,
        S = Math.max(0, w * w - s * s + t * t);
      p = w + Math.sqrt(S);
    }
    const m = p * u,
      g = p * l;
    i.push([m + (d - m) * o, g + (h - g) * o]);
  }
  return i;
}
function ji(e, t, n, r) {
  return Ra(Math.max(e, 1e-4), Math.max(t, e), 0, r, n);
}
function Lk(e, t, n) {
  if (n <= 1e-4) return ft(e);
  if (n >= 0.995) return ft(t);
  const r = qs(e),
    s = qs(t),
    o = th(r, s),
    i = $t(t),
    a = i ? 1 - (1 - n) ** 3 : n * n * n,
    c = r.ang + o * n,
    u = Math.max(r.halfLen + (s.halfLen - r.halfLen) * n, 1e-4),
    l = Math.max(r.halfW + (s.halfW - r.halfW) * n, 1e-4),
    d = $t(e) ? 1 : 0,
    h = d + ((i ? 1 : 0) - d) * a,
    f = ji(2 * l, 2 * u, c, [
      r.cx + (s.cx - r.cx) * n,
      r.cy + (s.cy - r.cy) * n,
    ]),
    p = h > 1e-4;
  return {
    ...f,
    oval: p ? [l, u] : f.oval,
    ovalMix: p ? h : 0,
    fillRing: Ok(u, l, h),
  };
}
function Nk(e, t, n) {
  if (n >= 1 - 1e-4) return ft(t);
  const r = qs(e),
    s = qs(t),
    o = r.ang + th(r, s) * n,
    i = Math.max(1e-4, r.halfW + (s.halfW - r.halfW) * n),
    a =
      Math.max(0, r.halfLen - r.halfW) * (1 - n) +
      Math.max(0, s.halfLen - s.halfW) * n,
    c = [r.cx + (s.cx - r.cx) * n, r.cy + (s.cy - r.cy) * n];
  return Ra(2 * i, 2 * (a + i), (o * 180) / Math.PI, c, 0);
}
function Fk(e) {
  const t = $t(e);
  if (!(e.wid > 0) && !t) return null;
  const n = e.lidY,
    r = e.tilt * (180 / Math.PI);
  if (t)
    return {
      width: 2 * e.oval[0],
      height: 2 * e.oval[1] * n,
      tilt: r,
      cx: e.off[0],
      cy: e.off[1],
    };
  if (e.pts.length < 2) return null;
  const s = e.pts[0],
    o = e.pts[e.pts.length - 1],
    i = o[0] - s[0],
    a = o[1] - s[1],
    c = Math.hypot(i, a),
    u = 2 * e.wid;
  return {
    width: u,
    height: (c + u) * n,
    tilt: Math.atan2(i, a) * (180 / Math.PI) + r,
    cx: e.off[0] + (s[0] + o[0]) / 2,
    cy: e.off[1] + ((s[1] + o[1]) / 2) * n,
  };
}
function jk(e) {
  const t = Fk(e);
  if (t == null) return { w: ur, h: 0.57, cx: e.off[0], cy: e.off[1] };
  const n = (t.tilt * Math.PI) / 180,
    r = Math.abs(Math.cos(n)),
    s = Math.abs(Math.sin(n));
  return {
    w: t.width * r + t.height * s,
    h: t.width * s + t.height * r,
    cx: t.cx,
    cy: t.cy,
  };
}
function zk(e, t, n, r) {
  return t >= e ? ji(e, t, 0, [n, r]) : ji(t, e, Math.PI / 2, [n, r]);
}
function $u(e, t) {
  if (e.fillRing && t > 0) {
    const ys=e.fillRing.map(p=>p[1]), cy=(Math.min(...ys)+Math.max(...ys))/2;
    const scale=1-Math.min(1,t)*0.92;
    const ring=e.fillRing.map(([x,y])=>[x,cy+(y-cy)*scale]);
    return {...e,fillRing:ring,pts:ring};
  }
  if (t <= 0) return e;
  const n = Math.min(1, t),
    r = jk(e),
    s = Math.max(r.w, 1e-4),
    o = Math.max(r.h, s),
    i = s * Ck;
  return zk(s, o + (i - o) * n, r.cx, r.cy);
}
function Dk(e) {
  return { ...e, wid: 0, oval: [0, 0] };
}
function qk(e) {
  let t, n;
  if ($t(e)) ((t = -e.oval[1]), (n = e.oval[1]));
  else {
    let r = 1e9,
      s = -1e9;
    for (const o of e.pts) (o[1] < r && (r = o[1]), o[1] > s && (s = o[1]));
    ((t = r - e.wid), (n = s + e.wid));
  }
  return t + (1 - $k) * (n - t);
}
function Bk(e) {
  if (e.pts.length < 2) return e;
  const t = e.pts[0],
    n = e.pts[e.pts.length - 1],
    r = n[0] - t[0],
    s = n[1] - t[1];
  if (Math.abs(s) < Math.abs(r)) return e;
  const o = Math.atan2(r, s);
  if (Math.abs(o) < 1e-5) return e;
  const i = Math.cos(o),
    a = Math.sin(o);
  return {
    ...e,
    tilt: e.tilt + o,
    pts: e.pts.map((c) => [c[0] * i - c[1] * a, c[0] * a + c[1] * i]),
  };
}
function Cu(e, t) {
  if (t === 0) return e;
  const n = Bk(e),
    r = Math.max(Ak, 1 - t),
    s = qk(n) * (1 - r),
    o = Math.cos(-n.tilt),
    i = Math.sin(-n.tilt);
  return { ...n, off: [n.off[0] - i * s, n.off[1] + o * s], lidY: n.lidY * r };
}
function Hk(e, t, n, r) {
  if (t < 0.001) return e;
  const s = n.isFollowingTurn ? Math.min(1, Math.max(-1, r / _k)) : n.bias,
    [o, i] = ln.inspecting,
    a = Math.max(1e-4, o.wid),
    c = Math.max(1e-4, i.wid),
    u = (1 + s) / 2,
    l = (d, h) => {
      const f = 1 + (h - 1) * t;
      if (d.fillRing) {
        const cx=d.fillRing.reduce((sum,p)=>sum+p[0],0)/d.fillRing.length;
        const cy=d.fillRing.reduce((sum,p)=>sum+p[1],0)/d.fillRing.length;
        const ring=d.fillRing.map(([x,y])=>[cx+(x-cx)*f,cy+(y-cy)*f]);
        return {...d,fillRing:ring,pts:ring};
      }
      return {
        ...ft(d),
        wid: d.wid * f,
        pts: d.pts.map((p) => [p[0] * f, p[1] * f]),
      };
    };
  return [l(e[0], Math.pow(c / a, u)), l(e[1], Math.pow(a / c, u))];
}
function _u(e) {
  return e === "inspecting" ? 1 : 0;
}
function Vk(e, t, n) {
  return !(e.some(Ds) || t.some(Ds)) && (e.some($t) || t.some($t))
    ? "oval"
    : n
      ? "spine"
      : "stadium";
}
function Ru(e) {
  return Ca(Math.min(Math.max(e.t / e.dur, 0), 1), sk);
}
// Use one contour topology for every expression, with continuous position and
// velocity. Target changes retarget the muscles instead of restarting a clip.
const faceContourCache = new Map();
function faceContours(name) {
  if (faceContourCache.has(name)) return faceContourCache.get(name);
  const eyes = ln[name].map(eye => {
    const loop = sS(eye, 96)[0];
    const lengths = [0];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      lengths.push(lengths.at(-1) + Math.hypot(b[0]-a[0], b[1]-a[1]));
    }
    const ring = []; let edge = 0;
    for (let i = 0; i < 64; i++) {
      const distance = lengths.at(-1) * i / 64;
      while (edge < loop.length-1 && lengths[edge+1] < distance) edge++;
      const a = loop[edge], b = loop[(edge+1)%loop.length];
      const f = (distance-lengths[edge]) / Math.max(1e-9,lengths[edge+1]-lengths[edge]);
      const x = zn(a[0],b[0],f), y = zn(a[1],b[1],f);
      ring.push([eye.off[0]+Math.cos(eye.tilt)*x+Math.sin(eye.tilt)*y,
                 eye.off[1]-Math.sin(eye.tilt)*x+Math.cos(eye.tilt)*y]);
    }
    // Canonical winding; cyclic alignment below handles the contour start.
    const area = ring.reduce((sum,a,i) => { const b=ring[(i+1)%64]; return sum+a[0]*b[1]-b[0]*a[1]; },0);
    if (area < 0) ring.reverse();
    return ring;
  });
  faceContourCache.set(name, eyes);
  return eyes;
}
function alignFaceContour(current, target) {
  let best = 0, cost = Infinity;
  for (let shift = 0; shift < 64; shift++) {
    let d = 0;
    for (let i=0;i<64;i++) {
      const a=current[i], b=target[(i+shift)%64];
      d+=(a[0]-b[0])**2+(a[1]-b[1])**2;
    }
    if (d<cost) {cost=d;best=shift;}
  }
  return target.map((_,i)=>target[(i+best)%64].slice());
}
function Gk() {
  let name='neutral', active=false, held=false, blinkTime=null;
  let rings=faceContours(name).map(r=>r.map(p=>p.slice()));
  let targets=rings.map(r=>r.map(p=>p.slice()));
  const velocity=rings.map(r=>r.map(()=>[0,0]));
  let inspect=0, inspectVelocity=0;
  const morph=(next)=> {
    if (!ln[next] || next===name) return;
    targets=faceContours(next).map((r,i)=>alignFaceContour(rings[i],r));
    name=next;active=true;held=false;
  };
  // Exact critically damped spring, stable at 30/60/120 Hz and on retargeting.
  const spring=(x,v,target,dt)=> {
    const omega=22, delta=x-target, c=v+omega*delta, decay=Math.exp(-omega*dt);
    return [target+(delta+c*dt)*decay,(v-omega*c*dt)*decay];
  };
  const step=(dt)=> {
    if (held) return;
    if (blinkTime!=null) { blinkTime+=dt; if(blinkTime>=Ni) blinkTime=null; }
    if (!active) return;
    let error=0;
    rings.forEach((ring,e)=>ring.forEach((point,i)=>point.forEach((x,k)=> {
      const result=spring(x,velocity[e][i][k],targets[e][i][k],dt);
      point[k]=result[0];velocity[e][i][k]=result[1];
      error=Math.max(error,Math.abs(point[k]-targets[e][i][k]),Math.abs(result[1])/22);
    })));
    [inspect,inspectVelocity]=spring(inspect,inspectVelocity,_u(name),dt);
    error=Math.max(error,Math.abs(inspect-_u(name)),Math.abs(inspectVelocity)/22);
    if (error<0.00005) {
      rings=targets.map(r=>r.map(p=>p.slice()));
      velocity.forEach(r=>r.forEach(p=>p.fill(0)));
      inspect=_u(name);inspectVelocity=0;active=false;
    }
  };
  const play=(event)=>morph(event.name);
  return {
    get name(){return name;},
    get isMorphing(){return active&&!held;},
    eyes:()=>rings.map(ring=>({ ...ln[name][0], off:[0,0],tilt:0,lidY:1,
      oval:[0,0],ovalMix:0,path:null,fillRing:ring,pts:ring,wid:0.01 })),
    inspectWeight:()=>inspect,
    blinkAmount:()=>blinkTime==null||held?null:Math.min(1,Math.max(0,lk(blinkTime/Ni,Ho(true,Ni)))),
    morph,lidMorph:morph,play,step,
    blink(){if(blinkTime==null&&!held)blinkTime=0;},
    release(){held=false;},
    seek(events,time){
      name='neutral'; rings=faceContours(name).map(r=>r.map(p=>p.slice()));
      targets=rings.map(r=>r.map(p=>p.slice()));
      velocity.forEach(r=>r.forEach(p=>p.fill(0)));
      inspect=0;inspectVelocity=0;active=false;blinkTime=null;held=false;
      let previous=0;
      for(const event of events){if(event.t>time+1e-9)break;step(Math.max(0,event.t-previous));play(event);previous=event.t;}
      step(Math.max(0,time-previous));
      if (time===0) {
        rings=targets.map(r=>r.map(p=>p.slice()));
        velocity.forEach(r=>r.forEach(p=>p.fill(0)));
        inspect=_u(name);inspectVelocity=0;active=false;
      }
      held=true;
    },
  };
}
const j_ = ["spin", "bounce", "nod"],
  Wk = 0.9,
  Uk = 0.4,
  Kk = 0.62,
  Xk = 0.3,
  Yk = 0.5,
  Zk = 16;
function nh({ poke: e, turns: t }) {
  switch (e) {
    case "spin":
      return Wk + Uk * (t - 1);
    case "bounce":
      return Kk;
    case "nod":
      return Yk;
  }
}
function Qk(e) {
  let t = 0,
    n = 0,
    r = 0,
    s = 1,
    o = 1;
  for (const i of e) {
    const a = Math.min(1, i.t / nh(i));
    switch (i.poke) {
      case "spin":
        n += 180 * i.turns * (1 - Math.cos(Math.PI * a));
        break;
      case "nod":
        t += Zk * Xr(a, 0, 1);
        break;
      case "bounce": {
        const c = Xr(a, 0, 0.18) + Xr(a, 0.82, 1),
          u = Xr(a, 0.18, 0.82);
        ((r += Xk * Math.sin(Math.PI * de((a - 0.14) / 0.72, 0, 1))),
          (s *= 1 + 0.08 * c - 0.04 * u),
          (o *= 1 - 0.1 * c + 0.06 * u));
        break;
      }
    }
  }
  return { pitch: t, yaw: n, lift: r, squash: [s, o] };
}
function Xr(e, t, n) {
  return e <= t || e >= n ? 0 : Math.sin((Math.PI * (e - t)) / (n - t)) ** 2;
}
const Jk = 0.14,
  ew = 0.95,
  tw = { heartChubby: 0.6, wedge: 0.55 },
  nw = 2;
function Ou(e, t, n) {
  const r = e !== "sphere",
    s = tw[e] ?? 1;
  return {
    rx: -(r ? 27 : 26) * s * n,
    ry: (r ? 36 : 34) * s * t,
    px: (r ? 0.10 : 0.085) * t,
    py: (r ? 0.08 : 0.065) * n,
  };
}
function rw(e, t, n = nw) {
  const r = Math.max(e.width, 1) * n,
    s = (o) => Math.max(-1, Math.min(1, o));
  return [
    s((t.x - (e.left + e.width / 2)) / r),
    s(-(t.y - (e.top + e.height / 2)) / r),
  ];
}
const sw = {
    thinking: "dots",
    orbit: "orbit",
    radar: "radar",
    progress: "progress",
    spawning: "gather",
    dictating: "wave",
    sending: "send",
    receiving: "receive",
    uploading: "dock",
    bouncing: "ball",
    writing: "pencil",
    alerting: "bang",
    "powering-down": "standby",
  },
  ow = Math.PI,
  iw = 0.1,
  aw = 2654435769,
  cw = new Set(["progress", "spawning"]),
  uw = { progress: 2.5, spawning: 2 },
  lw = 1.5;
function Oa(e) {
  let t = e | 0;
  return () => {
    t = (t + 1831565813) | 0;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    return (
      (n ^= n + Math.imul(n ^ (n >>> 7), n | 61)),
      ((n ^ (n >>> 14)) >>> 0) / 4294967296
    );
  };
}
function La(e) {
  return uw[e] ?? 2.5;
}
function dw(e = {}) {
  const t = e.isReducedMotion ?? !1,
    n = Oa(e.seed ?? aw),
    r = hs(0),
    s = hs(1),
    o = hs(0);
  let i = null,
    a = null,
    c = null,
    u = null,
    l = !1,
    d = 0,
    h = 0,
    f = 1,
    p = !1,
    m = 0,
    g = 0,
    y = 0,
    w = 0,
    S = 0;
  const v = () => {
    const x = i == null ? null : sw[i],
      E = y;
    i !== a && ((a = i), i != null && ((y = m), (l = !1)));
    let A = x != null;
    (i != null &&
      cw.has(i) &&
      (!l && m - y > La(i)
        ? ((l = !0), (d = m))
        : l && m - d > lw && ((l = !1), (y = m)),
      (A = !l)),
      (r.t = A ? 1 : 0),
      x != null &&
        x !== c &&
        (c != null && r.x > 0.02
          ? ((u = c), (w = g), (S = E), (s.x = t ? 1 : 0))
          : ((u = null), (s.x = 1)),
        (s.v = 0),
        (s.t = 1),
        (c = x),
        (g = m)),
      x == null && r.x < 0.004 && ((c = null), (u = null)),
      s.x > 0.996 && (u = null),
      A !== p &&
        (A && !t && (f = n() < 0.5 ? 1 : -1),
        t || ((h += ow * f), (o.t = h)),
        (p = A)));
  };
  return {
    get target() {
      return i;
    },
    set(x) {
      i = x;
    },
    advance(x) {
      const E = x > 0 ? Math.min(x, iw) : 0;
      ((m += E), v());
      const A = Z1(E),
        j = E / A;
      for (let F = 0; F < A; F++)
        (fs(r, 14, 1, j), fs(s, 11, 1, j), fs(o, 14, 1, j));
      t && ((s.x = 1), (o.x = o.t), (r.x = r.t));
    },
    settle() {
      v();
      for (const x of [r, s, o]) ((x.x = x.t), (x.v = 0));
      v();
    },
    snapshot() {
      return {
        amount: de(r.x, 0, 1),
        spin: o.x,
        kind: c,
        outgoing: u,
        swap: de(s.x, 0, 1),
        clock: { stateTime: m - g, shotTime: m - y },
        outgoingClock: { stateTime: m - w, shotTime: m - S },
        isReducedMotion: t,
        isSettled:
          Math.abs(r.x - r.t) < 0.001 &&
          Math.abs(o.t - o.x) < 0.01 &&
          s.x > 0.996,
      };
    },
  };
}
const hw = new Map([
    ["position", "position"],
    ["rotation", "rotation"],
    ["squash", "squash"],
    ["scale", "zoom"],
    ["lids", "lids"],
    ["expression", "expression"],
    ["pos", "position"],
    ["rot", "rotation"],
    ["scl", "squash"],
    ["zoom", "zoom"],
    ["expr", "expression"],
  ]),
  fw = new Map([
    ["blob", "sphere"],
    ["sphereWide", "sphere"],
    ["arch", "horseshoe"],
    ["spark", "sparkle"],
    ["star", "star6"],
    ["heart", "heartChubby"],
    ["hexagon", "hex"],
  ]),
  pw = [0.4, 0, 0.2, 1],
  vn = 0.6,
  rh = (() => {
    const [e, t, n] = pk(yk);
    return [e / hn, t / hn, n / hn];
  })(),
  sh = {
    duration: 10,
    body: null,
    squashAnchor: 0,
    restTime: 0,
    inspect: {},
    position: [],
    rotation: [],
    squash: [],
    zoom: [],
    lids: [],
    expression: [],
  },
  Lu = { ...sh, rotation: [{ t: 0, v: rh, ease: Gn }] };
function mw(e) {
  return kk.some((t) => t === e);
}
function gw(e) {
  const t = fw.get(e) ?? e;
  return mw(t) ? t : "sphere";
}
function yw(e) {
  return e != null && e.length === 4;
}
function kw({ t: e, v: t, ease: n }) {
  return { t: e, v: typeof t == "string" ? [] : t, ease: yw(n) ? n : Gn };
}
function ww(e) {
  return [
    { t: e, v: [0], ease: Gn },
    { t: e + Ni * 0.45, v: [1], ease: Gn },
    { t: e + Ni, v: [0], ease: Gn },
  ];
}
function bw({ inspect: e }) {
  const t = e?.bias;
  return {
    bias:
      t !== void 0 && Number.isFinite(t)
        ? Math.min(1, Math.max(-1, t))
        : void 0,
    isFollowingTurn: e?.follow,
  };
}
function xw(e) {
  const t = new Map();
  for (const [i, a] of Object.entries(e.tracks)) {
    const c = hw.get(i);
    c !== void 0 && t.set(c, a);
  }
  const n = (i) => (t.get(i) ?? []).map(kw),
    r = n("lids"),
    s = [];
  let o = !1;
  for (const i of t.get("expression") ?? []) {
    if (i.v === "blink") {
      ((o = !0), r.push(...ww(i.t)));
      continue;
    }
    s.push({
      t: i.t,
      name: typeof i.v == "string" ? Pk(i.v) : "neutral",
      isThroughBlink: i.cut === !1,
    });
  }
  return (
    o && r.sort((i, a) => i.t - a.t),
    {
      duration: e.duration,
      body: gw(e.body ?? "sphere"),
      squashAnchor: e.squashAnchor ?? 0,
      restTime: e.workArea ? e.workArea.start : 0,
      inspect: bw(e),
      position: n("position"),
      rotation: n("rotation"),
      squash: n("squash"),
      zoom: n("zoom"),
      lids: r,
      expression: s,
    }
  );
}
function mt(e, t) {
  if (e.length === 0) return null;
  if (t <= e[0].t) return e[0].v;
  const n = e[e.length - 1];
  if (t >= n.t) return n.v;
  let r = 0;
  for (; r < e.length - 2 && e[r + 1].t <= t;) r++;
  const s = e[r],
    o = e[r + 1],
    i = (t - s.t) / Math.max(o.t - s.t, 1e-9),
    a = Ca(i, s.ease);
  return s.v.map((c, u) => c + (o.v[u] - c) * a);
}
function Nu(e) {
  const t = e.restTime,
    n = mt(e.rotation, t),
    r = mt(e.position, t),
    s = mt(e.squash, t),
    o = mt(e.zoom, t),
    i = mt(e.lids, t);
  let a = "neutral",
    c = !1;
  for (const u of e.expression)
    (c || ((a = u.name), (c = !0)), u.t <= t + 1e-9 && (a = u.name));
  return {
    rot: n ? [n[0], n[1], n[2]] : [0, 0, 0],
    pos: r ? [r[0], r[1]] : [0, 0],
    scl: s ? [s[0], s[1]] : [1, 1],
    zoom: o ? o[0] : vn,
    lids: i ? Math.min(1, Math.max(0, i[0])) : 0,
    expr: a,
    squashAnchor: e.squashAnchor,
  };
}
function Vo(e, t) {
  return e + 360 * Math.round((t - e) / 360);
}
function Go(e, t) {
  return Math.abs(((((e - t) % 360) + 540) % 360) - 180);
}
function vw(e, t) {
  return (
    Go(e.rot[0], t.rot[0]) < 4 &&
    Go(e.rot[1], t.rot[1]) < 4 &&
    Go(e.rot[2], t.rot[2]) < 4 &&
    Math.abs(e.pos[0] - t.pos[0]) < 0.015 &&
    Math.abs(e.pos[1] - t.pos[1]) < 0.015 &&
    Math.abs(e.scl[0] - t.scl[0]) < 0.02 &&
    Math.abs(e.scl[1] - t.scl[1]) < 0.02 &&
    Math.abs(e.zoom - t.zoom) < 0.02 &&
    Math.abs(e.lids - t.lids) < 0.05
  );
}
function Sw(e, t) {
  const n = (s, o) => [
      { t: 0, v: s, ease: pw },
      { t: Li, v: o, ease: Gn },
    ],
    r = [
      Vo(t.rot[0], e.rot[0]),
      Vo(t.rot[1], e.rot[1]),
      Vo(t.rot[2], e.rot[2]),
    ];
  return {
    ...sh,
    duration: Li,
    squashAnchor: e.squashAnchor,
    position: n(e.pos, t.pos),
    rotation: n(e.rot, r),
    squash: n(e.scl, t.scl),
    zoom: n([e.zoom], [t.zoom]),
    lids: e.lids === 0 && t.lids === 0 ? [] : n([e.lids], [t.lids]),
  };
}
const Mw = {
    left: { rot: [0, -20, 0], pos: [-0.1, 0] },
    right: { rot: [0, 20, 0], pos: [0.1, 0] },
    up: { rot: [-20, 0, 0], pos: [0, 0.1] },
    down: { rot: [20, 0, 0], pos: [0, -0.1] },
    center: { rot: [0, 0, 0], pos: [0, 0] },
  },
  Tw = [0.42, 0, 0.58, 1],
  Ew = 0.5,
  Pw = 0.1,
  Iw = 10,
  Aw = 1e-4,
  $w = 0.5,
  Cw = 0.001,
  Fu = "rest";
function Wo(e) {
  return 360 * Math.round(e / 360);
}
function ju(e, t) {
  let n = "neutral";
  for (const r of e) {
    if (r.t > t + 1e-9) break;
    n = r.name;
  }
  return n;
}
function oh(e = {}) {
  const t = Math.min(3, Math.max(0.2, e.zoomMul || 1)),
    n = Gk();
  let r = e.body ?? "sphere",
    s = e.body !== void 0,
    o = [];
  const i = hs(1),
    a = dw();
  let c = null,
    u = rh,
    l = [0, 0],
    d = [1, 1],
    h = 0,
    f = vn * t,
    p = { bias: -1, isFollowingTurn: !0 },
    m = null,
    g = {
      isHeld: !1,
      isAlways: e.isGazeAlways ?? !1,
      x: 0,
      y: 0,
      cx: 0,
      cy: 0,
      hold: 0,
    },
    y = Lu,
    w = 0,
    S = !1,
    v = !0,
    x = !1,
    E = null,
    A = null,
    j = null,
    F = 0,
    O = 0,
    L = null,
    T = null,
    I = !1,
    $ = [];
  const R = () => {
      const _ = mt(y.position, w);
      l = _ ? [_[0], _[1]] : [0, 0];
      const q = mt(y.rotation, w);
      u = q ? [q[0], q[1], q[2]] : [0, 0, 0];
      const B = mt(y.squash, w);
      d = B ? [B[0], B[1]] : [1, 1];
      const P = mt(y.zoom, w);
      P && (f = Math.min(2.5, Math.max(0.25, P[0])) * t);
    },
    U = (_) => { (_(), K()); },
    W = (_, q) => {
      if (L == null)
        for (const B of y.expression) B.t <= _ || B.t > q || U(() => n.play(B));
    },
    G = (_) => {
      ((w = _),
        (m = null),
        (T = null),
        R(),
        n.seek(y.expression, _),
        L != null && n.seek([{ t: 0, name: L, isThroughBlink: !1 }], 0));
    },
    J = () => {
      const _ = mt(y.lids, w);
      return _ ? Math.min(1, Math.max(0, _[0])) : 0;
    },
    ye = () => (I ? 0 : J()),
    K = () => {
      !Ik(n.name) || n.isMorphing ? (I = !0) : I && J() === 0 && (I = !1);
    },
    ae = () => ({
      rot: u,
      pos: l,
      scl: d,
      zoom: f / t,
      lids: ye(),
      expr: n.name,
      squashAnchor: h,
    }),
    ee = (_) => {
      ((S = !1),
        (y = _),
        (w = 0),
        (h = _.squashAnchor),
        _.body != null && !s && (r = _.body),
        (p = {
          bias: _.inspect.bias ?? p.bias,
          isFollowingTurn: _.inspect.isFollowingTurn ?? p.isFollowingTurn,
        }));
    },
    te = (_) => {
      if (
        ((A = null),
        ee(_.clip),
        (E = { clip: _.clip, name: _.name }),
        (v = !0),
        !_.isPlaying)
      ) {
        (G(0), _.isRest && (g = { ...g, hold: 0 }));
        return;
      }
      ((S = !0),
        _.phase > 0 && G(_.phase * _.clip.duration),
        n.release(),
        _.phase <= 0 && W(-1e-9, 0));
    },
    he = (_) => {
      const q = ae(),
        B = Nu(_.clip);
      ((A = _),
        ee(Sw(q, B)),
        (v = !1),
        (S = !0),
        L == null && q.expr !== B.expr && U(() => n.morph(B.expr)));
    },
    D = () =>
      A != null || E == null || vw(ae(), Nu(E.clip))
        ? !1
        : (he({ ...E, isPlaying: !0, phase: 0, isRest: !1 }), !0),
    V = (_) => {
      const q = w;
      let B = q + _;
      if (B >= y.duration)
        if ((W(q, y.duration), v)) {
          if (((O += 1), D())) return;
          ((B = B - y.duration),
            B >= y.duration && (B = 0),
            W(-1e-9, B),
            (w = B));
        } else ((w = y.duration), (S = !1), A != null && te(A));
      else (W(q, B), (w = B));
      ((m = null), R());
    },
    Y = (_, q, dt) => {
      const B = _ + (q - _) * (1-Math.exp(-14*Math.min(dt,0.1)));
      return Math.abs(q - B) < Cw ? q : B;
    },
    Z = (dt) => {
      if (
        x ||
        (!g.isHeld && g.hold === 0) ||
        ((g = {
          ...g,
          cx: Y(g.cx, g.x, dt),
          cy: Y(g.cy, g.y, dt),
          hold: Y(g.hold, g.isHeld ? 1 : 0, dt),
        }),
        S)
      )
        return;
      R();
      const _ = Ou(r, g.cx, g.cy),
        { hold: q } = g;
      ((u = [
        u[0] + (_.rx - u[0]) * q,
        u[1] + (_.ry - u[1]) * q,
        u[2] * (1 - q),
      ]),
        (l = [l[0] + (_.px - l[0]) * q, l[1] + (_.py - l[1]) * q]));
    },
    Q = (_) => {
      if (m == null) return;
      const q = m.t + _,
        B = Math.min(q / Ew, 1),
        P = Ca(B, Tw),
        { fromRot: C, toRot: N, fromPos: H, toPos: z } = m;
      ((u = [
        C[0] + (N[0] - C[0]) * P,
        C[1] + (N[1] - C[1]) * P,
        C[2] + (N[2] - C[2]) * P,
      ]),
        (l = [H[0] + (z[0] - H[0]) * P, H[1] + (z[1] - H[1]) * P]),
        B >= 1 ? ((u = N), (l = z), (m = null)) : (m = { ...m, t: q }));
    },
    ie = () => {
      if (o.length === 0) return [{ body: r, weight: 1 }];
      const _ = Fs(de(i.x, 0, 1)),
        q = new Map();
      for (const C of o)
        q.set(C.body, (q.get(C.body) ?? 0) + C.weight * (1 - _));
      q.set(r, (q.get(r) ?? 0) + _);
      const B = [...q].filter(([, C]) => C > Aw),
        P = B.reduce((C, [, N]) => C + N, 0);
      return B.map(([C, N]) => ({ body: C, weight: N / P }));
    },
    re = (_) => {
      _ !== r && ((o = ie()), (r = _), (i.x = 0), (i.v = 0), (i.t = 1));
    },
    ke = (_) => {
      if (o.length === 0) return;
      const q = Z1(_);
      for (let B = 0; B < q; B++) fs(i, Iw, 1, _ / q);
      Math.abs(i.x - 1) < 0.001 &&
        Math.abs(i.v) < 0.01 &&
        ((i.x = 1), (i.v = 0), (o = []));
    },
    we = () => n.blinkAmount() ?? ye(),
    Ee = (_, q) => {
      const B = Hk(n.eyes(), q, p, _),
        P = we();
      return P <= 1e-4 ? B : [$u(B[0], P), $u(B[1], P)];
    };
  return {
    get isPlaying() {
      return S;
    },
    get time() {
      return w;
    },
    get duration() {
      return y.duration;
    },
    get loopCount() {
      return O;
    },
    get face() {
      return n.name;
    },
    get isSettled() {
      const _ =
        x ||
        (g.hold === (g.isHeld ? 1 : 0) &&
          (!g.isHeld || (g.cx === g.x && g.cy === g.y)));
      return (
        !S &&
        $.length === 0 &&
        o.length === 0 &&
        m == null &&
        T == null &&
        !n.isMorphing &&
        n.blinkAmount() == null &&
        a.snapshot().isSettled &&
        _
      );
    },
    load(
      _,
      { isPlaying: q = !0, transition: B = "bridge", phase: P = 0 } = {},
    ) {
      const C = _.name || E?.name || "recipe",
        N = {
          clip: xw(_),
          name: C,
          isPlaying: q,
          phase: de(P, 0, 1) % 1,
          isRest: !1,
        };
      B === "bridge" && E != null && (A != null || E.name !== C)
        ? he(N)
        : te(N);
    },
    play() {
      ((x = !1), (S = !0));
    },
    pause() {
      ((x = !0), (S = !1));
    },
    stop() {
      ((S = !1), G(0));
    },
    rest() {
      x = !1;
      const _ = { clip: Lu, name: Fu, isPlaying: !1, phase: 0, isRest: !0 };
      if (A == null && (E == null || E.name === Fu)) {
        E == null && te(_);
        return;
      }
      he(_);
    },
    seek: G,
    setBody(_, { isInstant: q = !1 } = {}) {
      if (((s = !0), !q)) {
        re(_);
        return;
      }
      ((r = _), (o = []), (i.x = 1), (i.v = 0));
    },
    setMorph(_, { isInstant: q = !1 } = {}) {
      (a.set(_), q && a.settle());
    },
    setExpression(_, { isThroughBlink: q = !1 } = {}) {
      U(() => {
        q && !vr(_) && !vr(n.name) ? n.lidMorph(_) : n.morph(_);
      });
    },
    holdFace(_) {
      if (_ !== L) {
        L = _; T = null;
        const q = L ?? (A == null ? ju(y.expression,w) : ju(A.clip.expression,0));
        if (q !== n.name) n.morph(q);
        K();
      }
    },
    poke(_, { turns: q = 1 } = {}) {
      $ = [...$, { poke: _, t: 0, turns: Math.max(1, Math.round(q)) }];
    },
    blink() {
      n.blink();
    },
    setInspect({ bias: _, isFollowingTurn: q }) {
      p = {
        bias: _ === void 0 ? p.bias : Math.min(1, Math.max(-1, _)),
        isFollowingTurn: q ?? p.isFollowingTurn,
      };
    },
    setGaze(_) {
      if (_ == null) {
        g = { ...g, isHeld: !1 };
        return;
      }
      const q = de(_[0] || 0, -1, 1),
        B = de(_[1] || 0, -1, 1);
      g =
        g.hold === 0
          ? { ...g, isHeld: !0, x: q, y: B, cx: q, cy: B }
          : { ...g, isHeld: !0, x: q, y: B };
    },
    setGazeAlways(_) {
      g = { ...g, isAlways: _ };
    },
    look(_) {
      const q = Mw[_];
      m = { t: 0, fromRot: u, toRot: q.rot, fromPos: l, toPos: q.pos };
    },
    setGlow(_) {
      j = _;
    },
    advance(_) {
      Z(_);
      const q = Math.min(_, Pw),
        B = 1 - a.snapshot().amount;
      if (
        (S && V(q * B),
        Q(q),
        n.step(q),
        T != null && (n.blinkAmount() ?? ye()) === 0)
      ) {
        const C = T;
        ((T = null), C());
      }
      (K(),
        ke(q),
        ($ = $.map((C) => ({ ...C, t: C.t + q })).filter((C) => C.t < nh(C))),
        a.advance(q));
      const P = a.snapshot();
      (P.amount > 0 || !P.isSettled
        ? (c ??= [Wo(u[0]), Wo(u[1]), Wo(u[2])])
        : (c = null),
        (F += _));
    },
    frame() {
      const _ = g.isAlways && S && !x ? Ou(r, g.cx, g.cy) : null,
        q = ew * g.hold,
        B = Qk($),
        P = [
          u[0] + (_ ? _.rx * q : 0) + B.pitch,
          u[1] + (_ ? _.ry * q : 0) + B.yaw,
          u[2],
        ],
        C = [l[0] + (_ ? _.px * q : 0), l[1] + (_ ? _.py * q : 0) + B.lift],
        N = [d[0] * B.squash[0], d[1] * B.squash[1]],
        H = n.inspectWeight(),
        z = a.snapshot(),
        X = 1 - z.amount,
        ce = (z.spin % (2 * Math.PI)) / hn,
        ne = c ?? [0, 0, 0],
        se = (ue) => ne[ue] + (P[ue] - ne[ue]) * X,
        pe = se(1);
      return {
        body: r,
        quat: fk(se(0) * hn, (pe + ce) * hn, se(2) * hn),
        zoom: f,
        offset: X === 1 ? C : [C[0] * X, C[1] * X],
        squash: X === 1 ? N : [1 + (N[0] - 1) * X, 1 + (N[1] - 1) * X],
        squashAnchor: h,
        eyes: z.amount >= $w ? null : Ee(pe, H),
        glow: j && { ...j, midT: 0.5 + 0.5 * Math.sin((F * 1e3) / 860) },
        inspectWeight: H,
        bodies: ie(),
        morph: z.kind === null && z.isSettled ? null : z,
      };
    },
  };
}
const ao = 0.92;
function _r(e) {
  return e / vn;
}
function Sr(e) {
  const t = (n) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${t(e[0])}${t(e[1])}${t(e[2])}`;
}
function Na(e) {
  return e.inkPaint ?? Sr(e.ink);
}
function Fa(e) {
  return e.spotPaint ?? Sr(e.spot);
}
function ja(e, t, n = e) {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="${t}" width="${n}" height="${n}" viewBox="0 0 ${e} ${e}">`;
}

/* ---- Motion clips (28 clips; original `_w`, exported from the app's Motion Lab) ---- */
const _w = [{"name":"Blocked_A","duration":2.12,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":2.1},"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0,"v":[0,0],"ease":[0.796898,0.023359,0.258052,0.939947]},{"t":0.386399,"v":[0.020363,0.032172],"ease":[0.796898,0.023359,0.258052,0.939947]},{"t":0.746062,"v":[-0.132006,0.049285],"ease":[0.162066,0.657372,0.477658,0.989094]},{"t":0.866099,"v":[-0.002722,0.050839],"ease":[0.347207,-0.008777,0.269501,1.025217]},{"t":1.049357,"v":[-0.120389,0.042352],"ease":[0.277381,0.292814,0.353411,1.073767]},{"t":1.298666,"v":[-0.002722,0.050839],"ease":[0.347207,-0.008777,0.269501,1.025217]},{"t":1.756921,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[0,0,0],"ease":[0.819996,-0.175344,0.354905,0.958838]},{"t":0.386399,"v":[6.596422,26.266589,6.122578],"ease":[0.819996,-0.175344,0.354905,0.958838]},{"t":0.746062,"v":[4.030723,-14.070822,-8.088521],"ease":[0.162066,0.657372,0.477658,0.989094]},{"t":0.866099,"v":[10.306252,13.969026,7.524804],"ease":[0.347207,-0.008777,0.269501,1.025217]},{"t":1.049357,"v":[8.006914,-9.270764,-8.50531],"ease":[0.277381,0.292814,0.353411,1.073767]},{"t":1.298666,"v":[10.306252,13.969026,7.524804],"ease":[0.347207,-0.008777,0.269501,1.025217]},{"t":1.756921,"v":[0,0,0],"ease":[0.42,0,0.58,1]}],"scale":[{"t":0,"v":[0.6],"ease":[0.42,0,0.069443,0.967974]},{"t":0.386399,"v":[0.6],"ease":[0.42,0,0.069443,0.967974]},{"t":1.149496,"v":[0.5],"ease":[0.791027,-0.02655,0.197328,1]},{"t":1.900276,"v":[0.6],"ease":[0.42,0,0.069443,0.967974]}],"expression":[{"t":0.469261,"v":"confused","ease":[0.42,0,0.58,1]},{"t":1.606009,"v":"neutral","ease":[0.42,0,0.58,1]}]}},{"name":"Blocked_B","duration":3,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":3},"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":1.259357,"v":[0.004259,-0.223205],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":1.259357,"v":[22.380408,-0.113749,-1.325454],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0,"v":"sad","ease":[0.845822,0.404878,0.137699,0.915435]}]}},{"name":"Blocked_C","duration":1.4,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":1.392988},"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0,"v":[-0.1016,0.000577],"ease":[0.42,0,0.58,1]},{"t":0.681623,"v":[0.068295,0.000577],"ease":[0.42,0,0.58,1]},{"t":1.392988,"v":[-0.1016,0.000577],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[22.10063,-15.657631,-4.681428],"ease":[0.42,0,0.58,1]},{"t":0.681623,"v":[21.919069,11.388653,0.738224],"ease":[0.42,0,0.58,1]},{"t":1.392988,"v":[22.10063,-15.657631,-4.681428],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0,"v":"sleepy","ease":[0.845822,0.404878,0.137699,0.915435]}]}},{"name":"Bodymoves_A","duration":5,"body":"clover","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0,"v":[0,0],"ease":[0.42,0,0.58,1]},{"t":0.331687,"v":[-0.1,0],"ease":[0.42,0,0.58,1]},{"t":0.667316,"v":[-0.1,0],"ease":[0.42,0,0.58,1]},{"t":1,"v":[0.1,0],"ease":[0.42,0,0.58,1]},{"t":1.335676,"v":[0.1,0],"ease":[0.42,0,0.58,1]},{"t":1.654303,"v":[0,0.1],"ease":[0.42,0,0.58,1]},{"t":2,"v":[0,0.1],"ease":[0.42,0,0.58,1]},{"t":2.32955,"v":[0,-0.1],"ease":[0.42,0,0.58,1]},{"t":2.667602,"v":[0,-0.1],"ease":[0.42,0,0.58,1]},{"t":2.998597,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[0,0,0],"ease":[0.42,0,0.58,1]},{"t":0.331687,"v":[0,-20,0],"ease":[0.42,0,0.58,1]},{"t":0.667316,"v":[0,-20,0],"ease":[0.42,0,0.58,1]},{"t":1,"v":[0,20,0],"ease":[0.42,0,0.58,1]},{"t":1.335676,"v":[0,20,0],"ease":[0.42,0,0.58,1]},{"t":1.654303,"v":[-20,0,0],"ease":[0.42,0,0.58,1]},{"t":2,"v":[-20,0,0],"ease":[0.42,0,0.58,1]},{"t":2.32955,"v":[20,0,0],"ease":[0.42,0,0.58,1]},{"t":2.667602,"v":[20,0,0],"ease":[0.42,0,0.58,1]},{"t":2.998597,"v":[0,0,0],"ease":[0.734052,0,0.024582,1]},{"t":4.546162,"v":[0,360,0],"ease":[0.42,0,0.58,1]}]}},{"name":"Done_A","duration":3.7,"body":"sphere","squashAnchor":-1,"workArea":{"start":0.072285,"end":2.441508},"inspect":{"bias":-1,"follow":true},"tracks":{"expression":[{"t":0.540443,"v":"happy","ease":[0.960194,-0.05247,0.208043,0.913535]},{"t":1.100964,"v":"neutral","ease":[0.960194,-0.05247,0.208043,0.913535]}],"squash":[{"t":0.02617,"v":[1,1],"ease":[0.42,0,0.58,1]},{"t":0.171233,"v":[1.095,0.95],"ease":[0.42,0,0.58,1]},{"t":0.251948,"v":[1,1.1],"ease":[0.42,0,0.58,1]},{"t":0.58908,"v":[1,1],"ease":[0.42,0,0.58,1]},{"t":0.712817,"v":[1,1],"ease":[0.42,0,0.58,1]},{"t":0.766956,"v":[1.095,0.95],"ease":[0.42,0,0.58,1]},{"t":0.989776,"v":[1,1.05],"ease":[0.42,0,0.895143,0.340757]},{"t":1.201785,"v":[1,1],"ease":[0.311599,0.388697,0.58,1]},{"t":1.24426,"v":[1.02,0.95],"ease":[0.42,0,0,0.963626]},{"t":1.370786,"v":[1,1.05],"ease":[0.42,-0.062062,0.58,1]},{"t":1.565979,"v":[1,1.05],"ease":[0.42,-0.062062,0.58,1]},{"t":1.722524,"v":[1,1],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0.078941,"v":[0,0,0],"ease":[0.42,0,0.58,1]},{"t":0.58908,"v":[-30.114679,-0.348152,14.221022],"ease":[0.730033,-0.124054,0.336584,0.801789]},{"t":1.142186,"v":[-22.577941,6.412921,-21.655639],"ease":[0.583299,-0.337607,0.320455,1.096354]},{"t":1.967254,"v":[-2.078104,2.770117,-1.109725],"ease":[0.42,0,0.58,1]},{"t":2.265132,"v":[0,0,0],"ease":[0.42,0,0.58,1]}],"position":[{"t":0.215231,"v":[0,0],"ease":[0.262235,0.694725,0.194806,0.903866]},{"t":0.411439,"v":[0.000043,0.265889],"ease":[0.617472,-0.128554,0.955806,1.455834]},{"t":0.773355,"v":[0,0.002763],"ease":[0.095382,0.587872,0.079936,0.942469]},{"t":0.989776,"v":[0.000043,0.272462],"ease":[0.836373,-0.062305,0.998254,1.5]},{"t":1.24633,"v":[0,0.004099],"ease":[0.002785,0.747585,0.290285,1.075894]},{"t":1.427755,"v":[0.000043,0.209275],"ease":[0.641819,0.069197,0.999115,1.005168]},{"t":1.615457,"v":[0,-0.001272],"ease":[0.143932,0.556946,0.406758,0.898665]},{"t":1.691991,"v":[0.000043,0.128267],"ease":[0.735713,-0.236083,0.998983,1.024191]},{"t":1.838861,"v":[0,-0.00406],"ease":[0.167787,0.598298,0.26046,0.884497]},{"t":1.866711,"v":[0.000043,0.079034],"ease":[0.468503,-0.429536,0.920273,0.852506]},{"t":1.947287,"v":[0,-0.006228],"ease":[0.002785,1.5,0.488655,0.955126]}]}},{"name":"Done_B","duration":1.8,"body":"sphere","squashAnchor":-1,"workArea":null,"inspect":{"bias":-1,"follow":false},"tracks":{"expression":[{"t":0.1,"v":"happy","ease":[0.4,0.22,0.28,1.34]}],"squash":[{"t":0,"v":[1,1],"ease":[0.42,0,0.58,1]},{"t":0.24,"v":[1.12,0.88],"ease":[0.42,0,0.58,1]},{"t":0.46,"v":[0.93,1.09],"ease":[0.42,0,0.58,1]},{"t":0.68,"v":[1.04,0.97],"ease":[0.42,0,0.58,1]},{"t":0.92,"v":[1,1],"ease":[0.42,0,0.58,1]}]}},{"name":"Done_C","duration":2,"body":"sphere","squashAnchor":-1,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"expression":[{"t":0,"v":"happy","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":1.190233,"v":"neutral","ease":[0.845822,0.404878,0.137699,0.915435]}],"position":[{"t":0,"v":[0,0],"ease":[0.42,0,0.407334,1.01819]},{"t":0.37981,"v":[-0.105475,0.12478],"ease":[0.644643,0.013555,0.262737,1.046444]},{"t":0.942672,"v":[0.106178,0.155063],"ease":[0.899266,0.062265,0.689743,1.06068]},{"t":1.382287,"v":[0.01114,-0.172501],"ease":[0.536977,0.096395,0.424284,0.86558]},{"t":1.576818,"v":[0.009658,0.024189],"ease":[0.102857,0.442981,0.58,1]},{"t":1.754576,"v":[0.00557,-0.0865],"ease":[0.113932,0.208429,0.58,1]},{"t":1.955755,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[0,0,0],"ease":[0.75219,0,0.296804,1.228413]},{"t":0.37981,"v":[-31.253651,-5.533499,13.746824],"ease":[0.665096,0.081879,0.027404,1.175375]},{"t":0.942672,"v":[-30.61624,14.144576,-12.739742],"ease":[0.899266,0.062265,0.689743,1.06068]},{"t":1.397258,"v":[19.356473,0.12303,-1.669787],"ease":[0.536977,0.096395,0.424284,0.86558]},{"t":1.587336,"v":[-4.965246,-1.410803,-0.08557],"ease":[0.102857,0.442981,0.58,1]},{"t":1.757489,"v":[12.94522,-0.95493,-1.354176],"ease":[0.113932,0.208429,0.58,1]},{"t":1.955755,"v":[0,0,0],"ease":[0.75219,0,0.296804,1.228413]}]}},{"name":"Idle_A","duration":6,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.487447,"v":[0,0],"ease":[0.399197,-0.138091,0.15951,1]},{"t":1.3832,"v":[-0.146479,0.027266],"ease":[0.582526,0.310171,0.046179,1.361061]},{"t":1.779653,"v":[-0.146479,0.027266],"ease":[0.22006,0.310171,0.046179,0.965231]},{"t":2.75,"v":[-0.07459,-0.165966],"ease":[0.792438,0.082033,0.202577,0.570877]},{"t":2.926148,"v":[-0.07459,-0.165966],"ease":[0.902412,0.095284,0.311872,0.928612]},{"t":4.079567,"v":[0,0],"ease":[0.877284,0.093965,0,0.937849]},{"t":5.754212,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0.487447,"v":[0,0,0],"ease":[0.399197,-0.138091,0.15951,1]},{"t":1.3832,"v":[-16.083597,-32.693169,-11.038561],"ease":[0.582526,0.310171,0.046179,1.361061]},{"t":1.779653,"v":[-13.471262,-31.664037,-11.622988],"ease":[0.22006,0.310171,0.046179,0.965231]},{"t":2.75,"v":[10.373818,13.583423,10.666197],"ease":[0.792438,0.082033,0.202577,0.570877]},{"t":2.926148,"v":[22.819836,5.292312,5.163005],"ease":[1,-0.5,0.405166,0.887227]},{"t":4.079567,"v":[-24.875245,31.812787,15.074443],"ease":[0.877284,0.093965,0,0.937849]},{"t":5.754212,"v":[0,360,0],"ease":[0.912292,0.038551,0.425161,0.817202]}],"expression":[{"t":1.162897,"v":"blink","ease":[0.42,0,0.58,1]},{"t":4.004398,"v":"blink","ease":[0.42,0,0.58,1]},{"t":5.643315,"v":"neutral","ease":[0.42,0,0.58,1]}]}},{"name":"Idle_B","duration":4,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":1.605482,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0.901037,"v":[0,0,0],"ease":[0.42,0,0.289277,0.962424]},{"t":1.616369,"v":[0.120321,-8.658513,-2.542642],"ease":[0.874781,-0.036259,0.25467,0.898023]},{"t":2.490205,"v":[0.965955,5.6589,1.712924],"ease":[0.602721,-0.23085,0.29025,0.981547]},{"t":3.45705,"v":[0,0,0],"ease":[0.42,0,0.58,1]}],"scale":[{"t":0,"v":[0.6],"ease":[0.618045,0.001243,0.183913,0.93587]},{"t":1.605482,"v":[0.64],"ease":[0.865871,-0.079955,0.299791,1.019512]},{"t":3.841942,"v":[0.6],"ease":[0.618045,0.001243,0.183913,0.940553]}],"expression":[{"t":1.481103,"v":"blink","ease":[0.4,0.22,0.28,1.34]},{"t":3.45705,"v":"blink","ease":[0.4,0.22,0.28,1.34]}]}},{"name":"Idle_D","duration":6,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.651107,0,0.326839,1]},{"t":0.586736,"v":[-34.323396,16.861967,15.137355],"ease":[0.599672,0,0.246711,1]},{"t":1.078331,"v":[-34.323396,16.861967,15.137355],"ease":[0.599672,0,0.106574,1]},{"t":1.962639,"v":[-6.168254,3.098853,14.34942],"ease":[0.42,0,0.58,1]},{"t":2.671749,"v":[-6.168254,3.098853,14.34942],"ease":[0.42,0,0.202906,1]},{"t":3.914378,"v":[7.572939,40.386943,25.47389],"ease":[0.42,0,0.58,1]},{"t":4.785706,"v":[7.572939,40.386943,25.47389],"ease":[0.631555,0,0.216413,1]},{"t":5.632733,"v":[-15.896271,33.293156,25.384801],"ease":[0.651107,0,0.326839,1]}],"expression":[{"t":0.59291,"v":"blink","ease":[0.4,0.22,0.28,1.34]},{"t":2.069138,"v":"blink","ease":[0.4,0.22,0.28,1.34]},{"t":2.372291,"v":"blink","ease":[0.4,0.22,0.28,1.34]},{"t":4.24748,"v":"blink","ease":[0.4,0.22,0.28,1.34]}]}},{"name":"Logo_A","duration":4,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":2.000258},"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.940309,0,0.832218,0.428413]},{"t":0.932543,"v":[-15.896271,290.361296,25.384801],"ease":[0.083703,0.782186,0.176235,1]},{"t":1.956794,"v":[-15.896271,393.293156,25.384801],"ease":[0.42,0,0.58,1]}]}},{"name":"Logo_B","duration":4,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":3.12207},"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.773238,0,0.198183,0.947681]},{"t":0.71851,"v":[-11.287779,-33.002315,-21.062449],"ease":[0.271775,-0.263699,0.60052,0.023492]},{"t":1.141528,"v":[-11.399397,-31.396635,-19.937494],"ease":[0.913767,0.040169,0.832218,0.428413]},{"t":2.074071,"v":[-15.896271,290.361296,25.384801],"ease":[0.083703,0.782186,0.176235,1]},{"t":3.098321,"v":[-15.896271,393.293156,25.384801],"ease":[0.42,0,0.58,1]}]}},{"name":"Marketing_A","duration":4,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.616706,"v":[0,0],"ease":[0.577139,0,0.416541,1]},{"t":1.419077,"v":[-0.163875,0],"ease":[0.42,0,0.58,1]},{"t":2.268423,"v":[-0.163875,0.059044],"ease":[0.58072,0,0,1]},{"t":3.161028,"v":[0,0],"ease":[0.577139,0,0.416541,1]}],"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.42,0,0.58,1]},{"t":0.616706,"v":[-15.896271,33.293156,25.384801],"ease":[0.862591,-0.041614,0.259523,1.049784]},{"t":1.419077,"v":[-2.975899,-26.234479,-3.25445],"ease":[0.781813,0.153463,0.326877,1.117362]},{"t":2.268423,"v":[-31.584762,-3.710798,24.071416],"ease":[0.362298,-0.17418,0.287566,1.245284]},{"t":2.796245,"v":[-27.874087,0.739249,5.007074],"ease":[0.42,0.044882,0.58,1]},{"t":3.272589,"v":[-19.255584,-17.41412,-7.023063],"ease":[0.494154,-0.031041,0.290757,1]},{"t":3.843576,"v":[-19.353875,20.030445,19.013275],"ease":[0.42,0,0.58,1]},{"t":3.980573,"v":[-15.896271,33.293156,25.384801],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0.059605,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":2.243432,"v":"surprised","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Marketing_B","duration":4,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.42,0,0.58,1]},{"t":0.616706,"v":[-15.896271,33.293156,25.384801],"ease":[0.862591,-0.041614,0.259523,1.049784]},{"t":1.419077,"v":[-2.975899,-26.234479,-3.25445],"ease":[0.781813,0.153463,0.326877,1.117362]},{"t":2.268423,"v":[20.165652,-20.644447,22.472734],"ease":[0.362298,-0.17418,0.287566,1.245284]},{"t":3.272589,"v":[-20.988693,-21.248461,-6.205736],"ease":[0.494154,-0.031041,0.290757,1]},{"t":4,"v":[-23.757982,24.836274,18.82084],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":1.447187,"v":"calm","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Marketing_C","duration":4,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.42,0,0.58,1]},{"t":0.616706,"v":[-15.896271,33.293156,25.384801],"ease":[0.862591,-0.041614,0.259523,1.049784]},{"t":1.419077,"v":[-2.975899,-26.234479,-3.25445],"ease":[0.781813,0.153463,0.326877,1.117362]},{"t":2.268423,"v":[20.165652,-20.644447,22.472734],"ease":[0.362298,-0.17418,0.287566,1.245284]},{"t":3.272589,"v":[-20.988693,-21.248461,-6.205736],"ease":[0.494154,-0.031041,0.290757,1]},{"t":4,"v":[-23.757982,24.836274,18.82084],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":1.447187,"v":"calm","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Marketing_D","duration":4,"body":"sphere","squashAnchor":-1,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"expression":[{"t":0.054981,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":0.752225,"v":"happy","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":3.188381,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]}],"squash":[{"t":0.68,"v":[1,1],"ease":[0.42,0,0.58,1]},{"t":0.92,"v":[1.12,0.88],"ease":[0.42,0,0.58,1]},{"t":1.14,"v":[0.93,1.09],"ease":[0.42,0,0.58,1]},{"t":1.36,"v":[1.04,0.97],"ease":[0.42,0,0.58,1]},{"t":1.6,"v":[1,1],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[-6.345525,19.726305,7.225894],"ease":[0.42,0,0.58,1]},{"t":0.68,"v":[-6.345525,19.726305,7.225894],"ease":[0.628772,0,0.165287,1]},{"t":1.808862,"v":[7.946317,-27.372379,-13.611633],"ease":[0.588822,0,0,1]},{"t":3.406449,"v":[0,0,0],"ease":[0.42,0,0.58,1]},{"t":3.887429,"v":[-6.345525,19.726305,7.225894],"ease":[0.42,0,0.58,1]}]}},{"name":"Rotation_A","duration":6,"body":"cloud","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[2.312095,-34.698072,6.287221],"ease":[0.001,0.001,0.999,0.999]},{"t":3.042058,"v":[-15.896271,393.293156,25.384801],"ease":[0.001,0.001,0.999,0.999]},{"t":5.685519,"v":[-26.2,719.4,25.384801],"ease":[0.42,0,0.58,1]}]}},{"name":"Rotation_B","duration":10,"body":"cloud","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-5.861702,-66.485796,11.013855],"ease":[0.001,0.001,0.999,0.999]},{"t":10,"v":[-5.861702,293.514204,11.013855],"ease":[0.42,0,0.58,1]}]}},{"name":"Rotation_C","duration":4,"body":"cloud","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[-35,-28.5,8.9],"ease":[0.001,0.001,0.999,0.999]},{"t":3.954889,"v":[30.3,-25.030324,25.838583],"ease":[0.42,0,0.58,1]}],"expression":[{"t":2.021379,"v":"blink","ease":[0.4,0.22,0.28,1.34]}]}},{"name":"Streaming_A","duration":2.6,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":2.593141},"inspect":{"bias":-1,"follow":true},"tracks":{"rotation":[{"t":0,"v":[-17.330878,2.26328,15.443629],"ease":[0.730033,-0.124054,0.405859,1.005038]},{"t":0.345818,"v":[9.638629,2.025895,-1.252765],"ease":[0.422471,0.002297,0.58,0.992735]},{"t":0.581369,"v":[-15.366004,-2.619837,-2.165499],"ease":[0.73225,-0.011667,0,0.914148]},{"t":0.834382,"v":[4.338039,0.493488,-3.708741],"ease":[0.158032,-0.076113,0.320455,1.096354]},{"t":1.218366,"v":[-0.279344,0,0],"ease":[0.720264,0,0.414581,0.9498]},{"t":1.618592,"v":[-5.399116,14.530503,3.128579],"ease":[0.603731,-0.030489,0.270096,0.930519]},{"t":2.060204,"v":[-2.088336,-10.814209,-20.009405],"ease":[0.483735,-0.095423,0.265487,1]},{"t":2.593141,"v":[-17.330878,2.26328,15.443629],"ease":[0.730033,-0.124054,0.405859,1.005038]}],"position":[{"t":0.008051,"v":[0,0],"ease":[0.42,0,0.58,1]},{"t":0.348008,"v":[0,-0.098935],"ease":[0.42,0,0.58,1]},{"t":0.587355,"v":[0,0.046548],"ease":[0.42,0,0.58,1]},{"t":0.834382,"v":[0,0.004684],"ease":[0.42,0,0.58,1]},{"t":1.218366,"v":[0,0],"ease":[0.42,0,0.27744,0.936798]},{"t":1.618592,"v":[0.12655,0],"ease":[0.603731,-0.030489,0.270096,0.928255]},{"t":2.060204,"v":[-0.136209,0],"ease":[0.483735,-0.095423,0.265487,1]},{"t":2.593141,"v":[0,0],"ease":[0.42,0,0.58,1]}]}},{"name":"Streaming_B","duration":2.6,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":2.593141},"inspect":{"bias":-1,"follow":true},"tracks":{"expression":[{"t":0.834382,"v":"surprised","ease":[0.845822,0.404878,0.137699,0.915435],"cut":true},{"t":2.167916,"v":"neutral","ease":[0.845822,0.404878,0.137699,0.915435],"cut":true}],"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.730033,-0.124054,0.405859,1.005038]},{"t":0.345818,"v":[9.638629,2.025895,-1.252765],"ease":[0.422471,0.002297,0.58,0.992735]},{"t":0.834382,"v":[-13.158705,-16.907977,-2.914418],"ease":[0.158032,-0.076113,0.320455,1.096354]},{"t":1.218366,"v":[3.33371,21.543228,4.461699],"ease":[0.720264,0,0.414581,0.9498]},{"t":1.618592,"v":[-5.399116,14.530503,3.128579],"ease":[0.603731,-0.030489,0.270096,0.930519]},{"t":2.060204,"v":[-2.088336,-10.814209,-20.009405],"ease":[0.483735,-0.095423,0.265487,1]},{"t":2.593141,"v":[-15.896271,33.293156,25.384801],"ease":[0.730033,-0.124054,0.405859,1.005038]}],"position":[{"t":0.008051,"v":[0,0],"ease":[0.42,0,0.58,1]},{"t":0.348008,"v":[0,-0.098935],"ease":[0.42,0,0.58,1]},{"t":0.834382,"v":[0,0.004684],"ease":[0.42,0,0.58,1]},{"t":1.365684,"v":[0.12655,0],"ease":[0.603731,-0.030489,0.270096,0.928255]},{"t":2.060204,"v":[-0.136209,0],"ease":[0.483735,-0.095423,0.265487,1]},{"t":2.593141,"v":[0,0],"ease":[0.42,0,0.58,1]}]}},{"name":"Streaming_C","duration":2.4,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"expression":[{"t":0.093043,"v":"squinted","ease":[0.960194,-0.05247,0.208043,0.913535]}],"rotation":[{"t":0.007537,"v":[-30.114679,-0.348152,10.657734],"ease":[0.80697,0.060684,0.22177,1.052957]},{"t":0.696701,"v":[-25.983934,7.767555,-17.97884],"ease":[0.633744,0.039159,0.240606,0.955201]},{"t":1.3,"v":[-27.316298,-1.390701,11.301626],"ease":[0.80697,0.060684,0.059679,0.997618]},{"t":2.383058,"v":[-30.114679,359.651848,10.657734],"ease":[0.545887,-0.164882,0.58,1]}],"position":[{"t":0.007537,"v":[0,0],"ease":[0.80697,0.060684,0.22177,1.052957]},{"t":0.696701,"v":[0.16304,0.106083],"ease":[0.633744,0.039159,0.240606,0.955201]},{"t":1.3,"v":[-0.161093,0.111277],"ease":[0.80697,0.060684,0.059679,0.997618]},{"t":2.383058,"v":[0,0],"ease":[0.762298,-0.392744,0.22177,1.052957]}]}},{"name":"Working_A","duration":8,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.487447,"v":[0,0],"ease":[0.399197,-0.138091,0.15951,1]},{"t":1.3832,"v":[-0.146479,0.027266],"ease":[0.582526,0.310171,0.046179,1.361061]},{"t":1.779653,"v":[-0.146479,0.027266],"ease":[0.22006,0.310171,0.046179,0.965231]},{"t":2.596133,"v":[0.062094,0.036364],"ease":[0.682301,0.039751,0.58,0.746299]},{"t":3.066378,"v":[-0.016487,0.080421],"ease":[0.803408,-0.082763,0.651011,0.812826]},{"t":3.426086,"v":[-0.008916,-0.213582],"ease":[0.174402,-0.5,0.886552,-0.221417]},{"t":4.004398,"v":[-0.005225,-0.125156],"ease":[0.023813,0.313414,0.044895,1.065831]},{"t":5.00503,"v":[0,0],"ease":[0.42,0,0.58,1]},{"t":6.298779,"v":[0.038139,-0.019258],"ease":[0.576933,0.007828,0.126102,0.959886]},{"t":6.952427,"v":[-0.25,-0.004138],"ease":[0.832609,-0.063921,0.365446,1.03529]},{"t":7.900964,"v":[0,0],"ease":[0.399197,-0.138091,0.15951,1]}],"rotation":[{"t":0.487447,"v":[0,0,0],"ease":[0.399197,-0.138091,0.15951,1]},{"t":1.3832,"v":[-11.013174,-20.059834,-12.896783],"ease":[0.582526,0.310171,0.046179,1.361061]},{"t":1.779653,"v":[-17.489755,-18.703977,-12.678205],"ease":[0.22006,0.310171,0.046179,0.965231]},{"t":2.596133,"v":[-14.554913,17.164836,9.376529],"ease":[0.682301,0.039751,0.58,0.924034]},{"t":3.179602,"v":[-24.586252,0.141339,-0.747722],"ease":[0.803408,-0.082763,0.914331,0.485103]},{"t":3.467914,"v":[-1.094328,-1.134622,-0.711695],"ease":[0.120409,-0.188725,0.948178,-0.209179]},{"t":4.001861,"v":[-147.110695,-0.675781,-0.423886],"ease":[0.031319,0.864491,0.044895,1.065831]},{"t":5.00503,"v":[-360,0,0],"ease":[0.797093,-0.5,0.241181,0.736155]},{"t":6.298779,"v":[-364.893235,18.62618,-0.259823],"ease":[0.576933,0.007828,0.126102,0.974274]},{"t":6.952427,"v":[-366.804239,-23.365336,-3.339162],"ease":[0.832609,-0.063921,0.365446,1.03529]},{"t":7.900964,"v":[-360,0,0],"ease":[0.42,0,0.58,1]}],"expression":[{"t":1.1672,"v":"blink","ease":[0.42,0,0.58,1]},{"t":1.779653,"v":"surprised","ease":[0.739467,0.104096,0.667668,1.5]},{"t":5.643315,"v":"neutral","ease":[0.42,0,0.58,1]},{"t":6.298779,"v":"strange","ease":[0.960194,-0.05247,0.208043,0.913535]},{"t":7.311534,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Working_B","duration":4.8,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":4.8},"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.177467,"v":[0,0],"ease":[0.807067,0.026673,0.053973,1.051967]},{"t":1.414107,"v":[-0.1,-0.000015],"ease":[0.705469,0.152908,0,0.901118]},{"t":2.75,"v":[0.1,-0.001953],"ease":[0.82402,-0.247927,0.299393,1]},{"t":4.782402,"v":[0,0],"ease":[0.42,0,0.070717,1.303216]}],"rotation":[{"t":0.177467,"v":[0,0,0],"ease":[0.807067,0.026673,0.053973,1.051967]},{"t":1.414107,"v":[1.431495,-16.14032,-36.051754],"ease":[0.705469,0.152908,0,0.95078]},{"t":2.75,"v":[-3.793664,16.145027,23.111556],"ease":[0.814518,0.058684,0.718739,0.822074]},{"t":3.30037,"v":[-0.658471,32.094525,23.002842],"ease":[0.952938,-0.034122,0.714317,0.525402]},{"t":3.89633,"v":[-0.030182,-273.02901,5.757593],"ease":[0.112703,0.66903,0.231666,0.973837]},{"t":4.782402,"v":[-0.02728,-360,0],"ease":[0.42,0,0.58,1]}],"scale":[{"t":0.177792,"v":[0.6],"ease":[0.807067,0.026673,0.053973,0.901002]},{"t":1.414107,"v":[0.421584],"ease":[0.758518,-0.08985,0.30745,0.907065]},{"t":2.25,"v":[0.528152],"ease":[1,0.125291,0.385163,0.842635]},{"t":2.988336,"v":[0.615339],"ease":[0.618593,-0.268751,0.341687,1]},{"t":4.608224,"v":[0.6],"ease":[0.807067,0.026673,0.053973,1.051967]}],"expression":[{"t":0.746649,"v":"inspect","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":2.556109,"v":"surprised","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":3.759215,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Working_C","duration":5,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.174918,"v":[-0.068352,-0.000015],"ease":[0.48051,0.061362,0.999,1.5]},{"t":1.510811,"v":[0.032133,-0.001953],"ease":[0.001,0.240902,0.58,1]},{"t":1.797152,"v":[-0.068352,-0.000015],"ease":[0.48051,0.061362,0.999,1.5]},{"t":3.133045,"v":[0.032133,-0.001953],"ease":[0.001,0.240902,0.58,1]},{"t":3.408329,"v":[-0.068352,-0.000015],"ease":[0.48051,0.061362,0.999,1.5]},{"t":4.777368,"v":[0.032133,-0.001953],"ease":[0.001,0.240902,0.58,1]},{"t":5,"v":[-0.068352,-0.000015],"ease":[0.48051,0.061362,0.999,1.5]}],"rotation":[{"t":0.174918,"v":[22.808321,-5.474402,-34.854653],"ease":[0.48051,0.061362,0.999433,1.5]},{"t":1.510811,"v":[25.822364,8.163456,36.349269],"ease":[0,0.240902,0.58,1]},{"t":1.797152,"v":[22.808321,-5.474402,-34.854653],"ease":[0.48051,0.061362,0.999433,1.5]},{"t":3.133045,"v":[25.822364,8.163456,36.349269],"ease":[0,0.240902,0.58,1]},{"t":3.408329,"v":[22.808321,-5.474402,-34.854653],"ease":[0.48051,0.061362,0.999433,1.5]},{"t":4.777368,"v":[25.822364,8.163456,36.349269],"ease":[0,0.240902,0.58,1]},{"t":5,"v":[22.808321,-5.474402,-34.854653],"ease":[0.48051,0.061362,0.999433,1.5]}],"expression":[{"t":0,"v":"surprised","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Working_D","duration":5,"body":"sphere","squashAnchor":0,"workArea":{"start":0,"end":5},"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":1.52641,"v":[0,0],"ease":[0.818379,0,0.42063,0.891619]},{"t":2.253821,"v":[0.133026,0.085997],"ease":[0.716482,-0.070598,0.158562,1]},{"t":2.636972,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0,"v":[-2.975899,-26.234479,-3.25445],"ease":[0.781813,0.153463,0.326877,1.117362]},{"t":0.003821,"v":[2.46156,-24.921016,2.790543],"ease":[0.42,0,0.58,1]},{"t":0.522244,"v":[20.165652,-20.644447,22.472734],"ease":[0.362298,-0.17418,0.287566,1.245284]},{"t":1.52641,"v":[-20.988693,-21.248461,-6.205736],"ease":[0.494154,-0.031041,0.290757,1]},{"t":2.253821,"v":[-23.757982,24.836274,18.82084],"ease":[0.42,0,0.58,1]},{"t":2.636972,"v":[8.316133,-27.390741,-9.531736],"ease":[0.122476,-0.002558,0.704301,0.577304]},{"t":3.494457,"v":[6.333528,-0.176297,0.656567],"ease":[0.42,0.503839,0.58,1]},{"t":4.253821,"v":[8.170368,24.729658,10.395084],"ease":[0.42,0,0.58,1]},{"t":4.971121,"v":[2.46156,-24.921016,2.790543],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0.003821,"v":"calm","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Working_E","duration":4,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.616706,"v":[0,0],"ease":[0.577139,0,0.416541,1]},{"t":1.419077,"v":[-0.163875,0],"ease":[0.42,0,0.58,1]},{"t":2.268423,"v":[-0.163875,0.059044],"ease":[0.58072,0,0,1]},{"t":3.161028,"v":[0,0],"ease":[0.577139,0,0.416541,1]}],"rotation":[{"t":0,"v":[-15.896271,33.293156,25.384801],"ease":[0.42,0,0.58,1]},{"t":0.616706,"v":[-15.896271,33.293156,25.384801],"ease":[0.862591,-0.041614,0.259523,1.049784]},{"t":1.419077,"v":[-2.975899,-26.234479,-3.25445],"ease":[0.781813,0.153463,0.326877,1.117362]},{"t":2.268423,"v":[-31.584762,-3.710798,24.071416],"ease":[0.362298,-0.17418,0.287566,1.245284]},{"t":2.796245,"v":[-27.874087,0.739249,5.007074],"ease":[0.42,0.044882,0.58,1]},{"t":3.272589,"v":[-19.255584,-17.41412,-7.023063],"ease":[0.494154,-0.031041,0.290757,1]},{"t":3.843576,"v":[-10.064416,12.982763,19.192265],"ease":[0.42,0,0.58,1]},{"t":3.980573,"v":[-15.896271,33.293156,25.384801],"ease":[0.42,0,0.58,1]}],"expression":[{"t":0.059605,"v":"neutral","ease":[0.741681,0.0322,0.264597,1.021643]},{"t":2.243432,"v":"surprised","ease":[0.741681,0.0322,0.264597,1.021643]}]}},{"name":"Working_F","duration":5,"body":"sphere","squashAnchor":0,"workArea":null,"inspect":{"bias":-1,"follow":true},"tracks":{"position":[{"t":0.487447,"v":[0,0],"ease":[0.677836,-0.224397,0.15951,1]},{"t":1.3832,"v":[-0.146479,0.027266],"ease":[0.582526,0.310171,0.046179,1.361061]},{"t":1.779653,"v":[-0.146479,0.027266],"ease":[0.22006,0.310171,0.046179,0.965231]},{"t":2.596133,"v":[0.062094,0.036364],"ease":[0.682301,0.039751,0.58,0.746299]},{"t":3.066378,"v":[-0.016487,0.080421],"ease":[0.803408,-0.082763,0.651011,0.812826]},{"t":3.426086,"v":[-0.008916,-0.213582],"ease":[0.174402,-0.5,0.886552,-0.221417]},{"t":4.004398,"v":[-0.005225,-0.125156],"ease":[0.023813,0.313414,0.044895,1.065831]},{"t":4.893927,"v":[0,0],"ease":[0.42,0,0.58,1]}],"rotation":[{"t":0.487447,"v":[0,0,0],"ease":[0.677836,-0.224397,0.15951,1]},{"t":1.3832,"v":[-11.013174,-20.059834,-12.896783],"ease":[0.582526,0.310171,0.046179,1.361061]},{"t":1.779653,"v":[-17.489755,-18.703977,-12.678205],"ease":[0.22006,0.310171,0.046179,0.965231]},{"t":2.596133,"v":[-14.554913,17.164836,9.376529],"ease":[0.682301,0.039751,0.58,0.924034]},{"t":3.179602,"v":[-24.586252,0.141339,-0.747722],"ease":[0.803408,-0.082763,0.914331,0.485103]},{"t":3.467914,"v":[-1.094328,-1.134622,-0.711695],"ease":[0.120409,-0.188725,0.948178,-0.209179]},{"t":4.001861,"v":[-147.110695,-0.675781,-0.423886],"ease":[0.031319,0.864491,0.044895,1.065831]},{"t":4.893927,"v":[-360,0,0],"ease":[0.797093,-0.5,0.241181,0.736155]}],"expression":[{"t":1.85083,"v":"surprised","ease":[0.739467,0.104096,0.667668,1.5]},{"t":4.893927,"v":"neutral","ease":[0.845822,0.404878,0.137699,0.915435],"cut":true}],"lids":[{"t":1.1672,"v":[0],"ease":[0.42,0,0.58,1]},{"t":1.2797,"v":[1],"ease":[0.42,0,0.58,1]},{"t":1.4172,"v":[0],"ease":[0.42,0,0.58,1]}]}}];

/* ---- State groups `Rw` (Lifecycle / Reactions / Morphs / Product / Brand) ---- */
const Rw = [
    {
      label: "Lifecycle",
      states: [
        "idle",
        "listening",
        "thinking",
        "streaming",
        "searching",
        "reading",
        "working",
        "coding",
        "running",
        "computing",
        "controlling",
        "waiting",
        "blocked",
        "finished",
        "failed",
        "sleeping",
        "waking",
      ],
    },
    {
      label: "Reactions",
      states: [
        "happy",
        "excited",
        "laughing",
        "proud",
        "curious",
        "playful",
        "shy",
        "surprised",
        "suspicious",
        "angry",
        "confused",
        "sad",
        "drowsy",
        "bored",
        "scared",
        "celebrate",
        "approving",
      ],
    },
    {
      label: "Morphs",
      states: [
        "orbit",
        "radar",
        "progress",
        "spawning",
        "loading",
        "dictating",
        "sending",
        "receiving",
        "uploading",
        "writing",
        "alerting",
        "bouncing",
        "powering-down",
      ],
    },
    { label: "Product", states: ["humming", "notifying", "dragging"] },
    { label: "Brand", states: ["logo", "showcase", "turntable"] },
  ];

/* ---- State table `zu`, state machine `zw`, per-body eye layout (Hw/Vw), path builder `sn`, all 25 body definitions (`Pb`/`_b`), silhouettes, 3D extrusion/hull/projection code, proof renderer `Xx`, sprite renderer `ov/iv/av` (original lines 4258-7706) ---- */
const Ow = 120,
  Pn = {
    clips: [
      "Working_A",
      "Working_B",
      "Working_C",
      "Working_D",
      "Working_E",
      "Working_F",
    ],
  },
  zu = {
    idle: {
      clips: ["Idle_B", "Idle_B", "Idle_D", "Idle_B", "Idle_A"],
      compactClips: ["Idle_B"],
    },
    listening: { clips: ["Idle_D"], face: "calm" },
    thinking: { clips: ["Idle_B"], morph: "thinking" },
    streaming: { clips: ["Streaming_A", "Streaming_B", "Streaming_C"] },
    searching: { clips: ["Idle_B"], morph: "radar" },
    reading: Pn,
    working: Pn,
    coding: Pn,
    running: Pn,
    computing: Pn,
    controlling: Pn,
    waiting: { clips: ["Idle_B"], morph: "orbit" },
    blocked: { clips: ["Blocked_A"], next: "drowsy", holdSeconds: Ow },
    finished: { clips: ["Done_B", "Done_A"], face: "happy", next: "idle" },
    failed: { clips: ["Blocked_B"], next: "idle" },
    sleeping: { clips: ["Idle_B"], face: "sleepy" },
    waking: {
      clips: ["Idle_B"],
      face: "surprised",
      next: "idle",
      holdSeconds: 1.6,
    },
    happy: { clips: ["Done_A"] },
    excited: { clips: ["Done_C"] },
    laughing: { clips: ["Done_B"] },
    proud: { clips: ["Marketing_B"] },
    curious: { clips: ["Working_B"], face: "inspecting" },
    playful: { clips: ["Bodymoves_A"] },
    shy: { clips: ["Idle_D"], face: "calm" },
    surprised: { clips: ["Idle_B"], face: "surprised" },
    suspicious: { clips: ["Idle_D"], face: "squinted" },
    angry: { clips: ["Blocked_A"], face: "squinted" },
    confused: { clips: ["Blocked_A"] },
    sad: { clips: ["Blocked_B"] },
    drowsy: { clips: ["Blocked_C"] },
    bored: { clips: ["Idle_B"], face: "sleepy" },
    scared: { clips: ["Idle_D"], face: "surprised" },
    celebrate: { clips: ["Rotation_A"], face: "happy" },
    approving: { clips: ["Rotation_C"], next: "idle" },
    orbit: { clips: ["Idle_B"], morph: "orbit" },
    radar: { clips: ["Idle_B"], morph: "radar" },
    progress: { clips: ["Idle_B"], morph: "progress" },
    spawning: { clips: ["Idle_B"], morph: "spawning" },
    loading: { clips: ["Idle_B"], morph: "progress" },
    dictating: { clips: ["Idle_B"], morph: "dictating" },
    sending: { clips: ["Idle_B"], morph: "sending" },
    receiving: { clips: ["Idle_B"], morph: "receiving" },
    uploading: { clips: ["Idle_B"], morph: "uploading" },
    writing: { clips: ["Idle_B"], morph: "writing" },
    alerting: { clips: ["Idle_B"], morph: "alerting" },
    bouncing: { clips: ["Idle_B"], morph: "bouncing" },
    "powering-down": { clips: ["Idle_B"], morph: "powering-down" },
    humming: { clips: ["Idle_B"], face: "calm" },
    notifying: { clips: ["Done_B"], face: "surprised" },
    dragging: { clips: ["Idle_B"], face: "surprised" },
    logo: { clips: ["Logo_A", "Logo_B"] },
    showcase: {
      clips: ["Marketing_A", "Marketing_B", "Marketing_C", "Marketing_D"],
    },
    turntable: { clips: ["Rotation_B"] },
  },
  Lw = new Map(_w.map((e) => [e.name, e]));
function Nw(e) {
  const t = Lw.get(e);
  if (t == null) throw new Error(`No motion recipe named ${e}`);
  return t;
}
const Fw = "surprised";
function jw(e, t, n) {
  const r = [...e];
  for (let o = r.length - 1; o > 0; o -= 1) Du(r, o, Math.floor(t() * (o + 1)));
  const s = r.findIndex((o) => o !== n);
  return (s > 0 && Du(r, 0, s), r);
}
function Du(e, t, n) {
  const r = e[t],
    s = e[n];
  r === void 0 || s === void 0 || ((e[t] = s), (e[n] = r));
}
function zw(e, t, n = {}) {
  const r = Oa(n.seed ?? 1),
    s = new Map();
  let o = n.isCompact ?? !1,
    i = n.isResting ?? !1,
    a = !1,
    c = i,
    u = t,
    l = zu[t],
    d = 0,
    h = 0,
    f = e.loopCount,
    p = null;
  const m = () => (o && l.compactClips != null ? l.compactClips : l.clips),
    g = () => l.next != null && l.holdSeconds == null,
    y = () => {
      const x = m(),
        E = s.get(x) ?? [];
      return (E.length === 0 && E.push(...jw(x, r, p)), s.set(x, E), E.shift());
    },
    w = () => {
      const x = g() ? m()[h] : y();
      if (((f = e.loopCount), x === void 0 || x === p)) return;
      const E = c || g();
      (e.load(Nw(x), { phase: E ? 0 : (n.firstPhase ?? r()) }),
        (c = !0),
        (p = x),
        (f = e.loopCount));
    },
    S = () => {
      e.holdFace(l.face ?? (a ? Fw : null));
    },
    v = (x) => {
      ((u = x),
        (l = zu[x]),
        (d = 0),
        (h = 0),
        e.setMorph(l.morph ?? null),
        S(),
        i || w());
    };
  return (
    i && e.rest(),
    v(t),
    {
      get state() {
        return u;
      },
      get clip() {
        return p;
      },
      setState(x) {
        x !== u && v(x);
      },
      setCompact(x) {
        o = x;
      },
      setEmphasis(x) {
        x !== a && ((a = x), S());
      },
      setResting(x) {
        if (x !== i) {
          if (((i = x), !i)) {
            w();
            return;
          }
          (e.rest(), (p = null));
        }
      },
      advance(x) {
        if (i) return;
        d += x;
        const E = l.next;
        if (E != null && l.holdSeconds != null && d >= l.holdSeconds) {
          v(E);
          return;
        }
        if (e.loopCount !== f) {
          if (
            E != null &&
            l.holdSeconds == null &&
            ((h += 1), h >= m().length)
          ) {
            v(E);
            return;
          }
          w();
        }
      },
    }
  );
}
const Dw = 0.26,
  qw = 0.57,
  mn = 0.64,
  qu = 11,
  Bw = 18,
  Bs = 48,
  Bu = 10,
  Hu = 64,
  Vu = { on: !1, oval: !1, width: 0, height: 0, tilt: 0, cx: 0, cy: 0 },
  Hw = {
    cloud: {
      width: 0.21294,
      height: 0.4668299999999999,
      gap: 0.47001600000000004,
      shiftY: 0.06999999999999999,
    },
    square: {
      width: 0.2553258426966292,
      height: 0.559752808988764,
      gap: 0.529408,
      shiftY: 0.12,
    },
    sparkle: {
      width: 0.18381999999999998,
      height: 0.40298999999999996,
      gap: 0.41215999999999997,
      shiftY: 0,
    },
    clover: {
      width: 0.23296,
      height: 0.51072,
      gap: 0.559104,
      shiftY: -0.020000000000000018,
    },
    heartChubby: {
      width: 0.18657600000000002,
      height: 0.409032,
      gap: 0.44620799999999994,
      shiftY: 0.051999999999999935,
    },
    starFlower: {
      width: 0.19292,
      height: 0.42294,
      gap: 0.38297600000000004,
      shiftY: 0.12,
    },
    teardrop: {
      width: 0.20779200000000003,
      height: 0.455544,
      gap: 0.45260800000000007,
      shiftY: 0.18,
    },
    tablet: {
      width: 0.2132,
      height: 0.4673999999999999,
      gap: 0.587776,
      shiftY: 0.01999999999999999,
    },
    wedge: {
      width: 0.2132,
      height: 0.4673999999999999,
      gap: 0.46771199999999996,
      shiftY: 0.18,
    },
    house: {
      width: 0.2295124,
      height: 0.5031617999999999,
      gap: 0.5125120000000001,
      shiftY: 0.18499534000463813,
    },
    star6: {
      width: 0.184782,
      height: 0.44965988999999995,
      gap: 0.41913343999999997,
      shiftY: 0.12,
    },
    pebble: {
      width: 0.23920000000000002,
      height: 0.5244,
      gap: 0.546304,
      shiftY: 0.12,
    },
    bean: { width: 0.2028, height: 0.4446, gap: 0.4608, shiftY: 0.12 },
    egg: {
      width: 0.23920000000000002,
      height: 0.5244,
      gap: 0.433664,
      shiftY: 0.11299906800092761,
    },
    squircle: {
      width: 0.23920000000000002,
      height: 0.5244,
      gap: 0.5632,
      shiftY: 0.12,
    },
    capsule: {
      width: 0.2106,
      height: 0.4617,
      gap: 0.36044800000000005,
      shiftY: 0.12,
    },
    cylinder: {
      width: 0.23920000000000002,
      height: 0.5244,
      gap: 0.47872000000000003,
      shiftY: 0.12,
    },
    hex: { width: 0.26, height: 0.57, gap: 0.64, shiftY: 0.12 },
    gem: {
      width: 0.23920000000000002,
      height: 0.5244,
      gap: 0.501248,
      shiftY: 0.12,
    },
    crystal: { width: 0.1612, height: 0.3534, gap: 0.3712, shiftY: 0.12 },
    shield: {
      width: 0.26790400000000003,
      height: 0.5873280000000001,
      gap: 0.44492800000000005,
      shiftY: 0.12,
    },
    dome: {
      width: 0.2132,
      height: 0.4673999999999999,
      gap: 0.47872000000000003,
      shiftY: 0.10599813600185524,
    },
    arch: {
      width: 0.19240000000000002,
      height: 0.42179999999999995,
      gap: 0.44799999999999995,
      shiftY: 0.16,
    },
    leaf: {
      width: 0.1872,
      height: 0.41039999999999993,
      gap: 0.44799999999999995,
      shiftY: 0.039999999999999994,
    },
  };
function Vw(e, t, n, r) {
  const s = Hw[e],
    o = s.width / Dw,
    i = s.height / qw,
    a = s.gap / mn;
  if (t.every((h) => za(h) && !(h.fillRing != null && h.fillRing.length > 0)))
    return Gw(Uu(t[0]), Uu(t[1]), s, o, i, a, n, r);
  let u = Ww(t, o, a, i, s.shiftY),
    l = 1;
  if (r >= 0.001) {
    const [h, f] = ih(Math.max(0, Ce(mn * a, mn)), n, r);
    ((l *= h), u.length >= 2 && (u = [Wu(u[0], h), Wu(u[1], f)]));
  }
  const d = Math.max(0.08, Math.min(1.25, l));
  return {
    loops: u.map((h) => h.map((f) => ({ x: f.x * d, y: f.y * d }))),
    shiftY: 0,
  };
}
function Gw(e, t, n, r, s, o, i, a) {
  const c = Ce(e.width * r),
    u = Ce(e.height * r),
    l = Ce(t.width * r),
    d = Ce(t.height * r);
  let h = Math.max(0, Ce(Math.min(c, u))),
    f = Math.max(0, Ce(Math.max(c, u))),
    p = Math.max(0, Ce(Math.min(l, d))),
    m = Math.max(0, Ce(Math.max(l, d)));
  const g = Math.max(
    0,
    Ce((mn + (e.on ? Ce(e.cx) : 0) + (t.on ? Ce(t.cx) : 0)) * o, mn * o),
  );
  if (a >= 0.001) {
    const [w, S] = ih(g, i, a);
    ((h *= w), (f *= w), (p *= S), (m *= S));
  }
  const y = Math.max(0.05, Math.min(1.8, g));
  return {
    loops: [
      Gu(-1, h, f, -Ce(Ce(e.tilt) + (c >= u ? 0 : 90)), y),
      Gu(1, p, m, Ce(Ce(t.tilt) + (l >= d ? 0 : 90)), y),
    ],
    shiftY: Ce(n.shiftY + ((Ce(e.cy) + Ce(t.cy)) / 2) * s, n.shiftY),
  };
}
function Gu(e, t, n, r, s) {
  const o = Math.max(0.01, Math.min(1, t)) / 2,
    i = Math.max(0.02, Math.min(1.8, Math.max(n, t))) / 2,
    a = (-r * Math.PI) / 180,
    c = Math.cos(a),
    u = Math.sin(a);
  return Array.from({ length: Hu }, (l, d) => {
    const h = (2 * Math.PI * d) / Hu,
      f = e * i * Math.cos(h),
      p = o * Math.sin(h);
    return { x: f * c - p * u + (e * s) / 2, y: f * u + p * c };
  });
}
function ih(e, t, n) {
  const r = Math.max(0.05, (e || mn) / 2),
    s = (t * Math.PI) / 180,
    o = Math.cos(r) || 1;
  return [
    1 + (Math.max(0.18, Math.cos(-r - s)) / o - 1) * n,
    1 + (Math.max(0.18, Math.cos(r - s)) / o - 1) * n,
  ];
}
function Wu(e, t) {
  if (e.length === 0 || Math.abs(t - 1) < 1e-4) return e;
  let n = 0,
    r = 0;
  for (const s of e) ((n += s.x), (r += s.y));
  return (
    (n /= e.length),
    (r /= e.length),
    e.map((s) => ({ x: n + (s.x - n) * t, y: r + (s.y - r) * t }))
  );
}
function Uu(e) {
  const t = za(e);
  if (!(e.wid > 0) && !t) return Vu;
  const n = e.lidY || 1,
    r = (e.tilt || 0) * (180 / Math.PI);
  if (t)
    return {
      on: !0,
      oval: !0,
      width: 2 * e.oval[0],
      height: 2 * e.oval[1] * n,
      tilt: r,
      cx: e.off[0],
      cy: e.off[1],
    };
  const s = e.pts;
  if (s.length < 2) return { ...Vu, cx: e.off[0], cy: e.off[1] };
  const o = s[0],
    i = s[s.length - 1],
    a = i[0] - o[0],
    c = i[1] - o[1],
    u = Math.hypot(a, c),
    l = 2 * e.wid;
  return {
    on: !0,
    oval: !1,
    width: l,
    height: (u + l) * n,
    tilt: Math.atan2(a, c) * (180 / Math.PI) + r,
    cx: e.off[0] + (o[0] + i[0]) / 2,
    cy: e.off[1] + ((o[1] + i[1]) / 2) * n,
  };
}
function Ww(e, t, n, r, s) {
  const o = [],
    i = -Math.sin(s);
  return (
    e.forEach((a, c) => {
      const u = za(a);
      if ((!(a.wid > 0) && !u) || (!u && a.pts.length < 2)) return;
      const l = c === 0 ? -1 : 1,
        d = a.lidY || 1,
        h = Math.cos(a.tilt || 0),
        f = Math.sin(a.tilt || 0),
        p = l * ((mn / 2 + Ce(a.off[0])) * n),
        m = i + Ce(a.off[1]) * r,
        g = (S, v) => {
          const x = S * h - v * f,
            E = S * f + v * h;
          return { x: p + l * x * t, y: m + E * t * d };
        };
      if (a.fillRing != null && a.fillRing.length >= 3) {
        const S = Ce(a.off[0]),
          v = Ce(a.off[1]);
        o.push(a.fillRing.map(([x, E]) => g(x - S, (E - v) * d)));
        return;
      }
      if (u) {
        const S = [];
        for (let v = 0; v < Bs; v++) {
          const x = (2 * Math.PI * v) / Bs;
          S.push(g(a.oval[0] * Math.cos(x), a.oval[1] * d * Math.sin(x)));
        }
        o.push(S);
        return;
      }
      const y = a.wid * t,
        w =
          a.path != null && a.path.length === Bw
            ? Kw(a.path, g, y)
            : Uw(
                a.pts.map((S) => g(S[0], S[1])),
                y,
              );
      w.length > 0 && o.push(w);
    }),
    o
  );
}
function Uw(e, t) {
  const n = [];
  for (const u of e) {
    const l = n.at(-1);
    (l == null || Math.hypot(u.x - l.x, u.y - l.y) > 1e-6) && n.push(u);
  }
  if (n.length === 0 || t <= 0) return [];
  const r = ch(n, t);
  if (r != null) return r;
  const s = n.length;
  if (s < 2) return [];
  const o = [],
    i = [];
  for (let u = 0; u < s; u++) {
    const l = n[Math.max(0, u - 1)],
      d = n[Math.min(s - 1, u + 1)],
      h = Math.hypot(d.x - l.x, d.y - l.y) || 1;
    let f = -(d.y - l.y) / h,
      p = (d.x - l.x) / h;
    (u > 0 && f * o[u - 1] + p * i[u - 1] < 0 && ((f = -f), (p = -p)),
      o.push(f),
      i.push(p));
  }
  const a = Zu(n[1].x - n[0].x, n[1].y - n[0].y),
    c = Zu(n[s - 1].x - n[s - 2].x, n[s - 1].y - n[s - 2].y);
  return ah(n, o, i, t, a, c);
}
function Kw(e, t, n) {
  if (n <= 0) return [];
  const r = [];
  for (let h = 0; h < 2; h++) {
    const f = Xu(e, h),
      p = Yu(e, h, 4),
      m = Yu(e, h + 1, 2),
      g = Xu(e, h + 1);
    for (let y = h === 0 ? 0 : 1; y < qu; y++) {
      const w = y / (qu - 1),
        S = Xw(f, p, m, g, w),
        v = Yw(f, p, m, g, w),
        x = t(S[0], S[1]),
        E = t(S[0] + v[0], S[1] + v[1]);
      r.push({ x: x.x, y: x.y, tx: E.x - x.x, ty: E.y - x.y });
    }
  }
  const s = ch(r, n);
  if (s != null) return s;
  const o = r.length,
    i = [],
    a = [];
  for (let h = 0; h < o; h++) {
    const f = Math.hypot(r[h].tx, r[h].ty) || 1;
    let p = -r[h].ty / f,
      m = r[h].tx / f;
    (h > 0 && p * i[h - 1] + m * a[h - 1] < 0 && ((p = -p), (m = -m)),
      i.push(p),
      a.push(m));
  }
  const c = r[0],
    u = r[o - 1],
    l = Math.hypot(c.tx, c.ty) || 1,
    d = Math.hypot(u.tx, u.ty) || 1;
  return ah(
    r,
    i,
    a,
    n,
    { x: c.tx / l, y: c.ty / l },
    { x: u.tx / d, y: u.ty / d },
  );
}
function ah(e, t, n, r, s, o) {
  const i = e.length,
    a = e.map((d, h) => ({ x: d.x + t[h] * r, y: d.y + n[h] * r })),
    c = e.map((d, h) => ({ x: d.x - t[h] * r, y: d.y - n[h] * r })),
    u = { x: e[0].x - s.x * r, y: e[0].y - s.y * r },
    l = { x: e[i - 1].x + o.x * r, y: e[i - 1].y + o.y * r };
  return [
    ...a,
    ...Ku(e[i - 1], a[i - 1], l, r),
    ...[...c].reverse(),
    ...Ku(e[0], c[0], u, r),
  ];
}
function Ku(e, t, n, r) {
  const s = [],
    o = Math.atan2(t.y - e.y, t.x - e.x);
  let a = Math.atan2(n.y - e.y, n.x - e.x) - o;
  for (; a > Math.PI;) a -= 2 * Math.PI;
  for (; a < -Math.PI;) a += 2 * Math.PI;
  const c = a >= 0 ? 1 : -1;
  for (let u = 1; u < Bu; u++) {
    const l = o + c * (u / Bu) * Math.PI;
    s.push({ x: e.x + r * Math.cos(l), y: e.y + r * Math.sin(l) });
  }
  return s;
}
function ch(e, t) {
  let n = 0,
    r = 0;
  for (const i of e) ((n += i.x), (r += i.y));
  ((n /= e.length), (r /= e.length));
  let s = 0;
  for (const i of e) s = Math.max(s, Math.hypot(i.x - n, i.y - r));
  if (t <= s * 1.05) return null;
  const o = [];
  for (let i = 0; i < Bs; i++) {
    const a = (2 * Math.PI * i) / Bs,
      c = Math.cos(a),
      u = Math.sin(a);
    let l = -1 / 0,
      d = 0,
      h = 0;
    for (const f of e) {
      const p = f.x * c + f.y * u;
      p > l && ((l = p), (d = f.x), (h = f.y));
    }
    o.push({ x: d + c * t, y: h + u * t });
  }
  return o;
}
function Xu(e, t) {
  return [e[t * 6], e[t * 6 + 1]];
}
function Yu(e, t, n) {
  return [e[t * 6] + e[t * 6 + n], e[t * 6 + 1] + e[t * 6 + n + 1]];
}
function Xw(e, t, n, r, s) {
  const o = 1 - s;
  return [
    o * o * o * e[0] +
      3 * o * o * s * t[0] +
      3 * o * s * s * n[0] +
      s * s * s * r[0],
    o * o * o * e[1] +
      3 * o * o * s * t[1] +
      3 * o * s * s * n[1] +
      s * s * s * r[1],
  ];
}
function Yw(e, t, n, r, s) {
  const o = 1 - s;
  return [
    3 * o * o * (t[0] - e[0]) +
      6 * o * s * (n[0] - t[0]) +
      3 * s * s * (r[0] - n[0]),
    3 * o * o * (t[1] - e[1]) +
      6 * o * s * (n[1] - t[1]) +
      3 * s * s * (r[1] - n[1]),
  ];
}
function Zu(e, t) {
  const n = Math.hypot(e, t) || 1;
  return { x: e / n, y: t / n };
}
function za(e) {
  return e.oval[0] > 1e-4 && e.oval[1] > 1e-4;
}
function Ce(e, t = 0) {
  return Number.isFinite(e) ? e : t;
}
const b = 114.2705;
(() => {
  const e = [];
  for (let t = 0; t < 10; t++) {
    const n = -Math.PI / 2 + (t * Math.PI) / 5,
      r = t % 2 === 0 ? 1 : 0.42;
    e.push(`${(Math.cos(n) * r).toFixed(3)} ${(Math.sin(n) * r).toFixed(3)}`);
  }
  return "M" + e.join("L") + "Z";
})();
const Zw = (e, t, n) =>
    e.map(([r, s], o) => [r + (t[o][0] - r) * n, s + (t[o][1] - s) * n]),
  uh = 1e-10,
  Qw = 2 ** 26;
function Jw(e) {
  const t = eb(e);
  if (t == null) return [];
  const n = tb(t.map((c) => e[c])),
    [r, s, o, i] = t;
  let a = [
    [r, s, o],
    [r, s, i],
    [r, o, i],
    [s, o, i],
  ].map(([c, u, l]) => {
    const d = Uo(e, [c, u, l]);
    return Qu(d, n) > 0 ? Uo(e, [c, l, u]) : d;
  });
  return (
    e.forEach((c, u) => {
      if (t.includes(u)) return;
      const l = a.map((f) => Qu(f, c) > uh);
      if (!l.includes(!0)) return;
      const d = new Set();
      a.forEach((f, p) => {
        if (!l[p])
          for (let m = 0; m < 3; m++)
            d.add(Ju(f.corners[m], f.corners[(m + 1) % 3]));
      });
      const h = [];
      (a.forEach((f, p) => {
        if (!l[p]) {
          h.push(f);
          return;
        }
        for (let m = 0; m < 3; m++) {
          const g = f.corners[m],
            y = f.corners[(m + 1) % 3];
          d.has(Ju(y, g)) && h.push(Uo(e, [g, y, u]));
        }
      }),
        (a = h));
    }),
    a.map((c) => c.corners)
  );
}
function eb(e) {
  if (e.length < 4) return null;
  let t = 0;
  e.forEach((i, a) => {
    i[0] < e[t][0] && (t = a);
  });
  const n = Ko(e, (i) => Di(Mt(i, e[t]))),
    r = Ko(e, (i) => Di(zi(Mt(e[n], e[t]), Mt(i, e[t])))),
    s = zi(Mt(e[n], e[t]), Mt(e[r], e[t])),
    o = Ko(e, (i) => Math.abs(Hs(s, Mt(i, e[t]))));
  return Math.abs(Hs(s, Mt(e[o], e[t]))) < uh ? null : [t, n, r, o];
}
function Uo(e, t) {
  const n = e[t[0]],
    r = zi(Mt(e[t[1]], n), Mt(e[t[2]], n)),
    s = Di(r) || 1,
    o = [r[0] / s, r[1] / s, r[2] / s];
  return { corners: t, normal: o, offset: Hs(o, n) };
}
function Qu(e, t) {
  return Hs(e.normal, t) - e.offset;
}
function Ju(e, t) {
  return e * Qw + t;
}
function Ko(e, t) {
  let n = 0,
    r = -1 / 0;
  return (
    e.forEach((s, o) => {
      const i = t(s);
      i > r && ((r = i), (n = o));
    }),
    n
  );
}
function tb(e) {
  const t = e.length;
  return [
    e.reduce((n, r) => n + r[0], 0) / t,
    e.reduce((n, r) => n + r[1], 0) / t,
    e.reduce((n, r) => n + r[2], 0) / t,
  ];
}
function Mt(e, t) {
  return [e[0] - t[0], e[1] - t[1], e[2] - t[2]];
}
function zi(e, t) {
  return [
    e[1] * t[2] - e[2] * t[1],
    e[2] * t[0] - e[0] * t[2],
    e[0] * t[1] - e[1] * t[0],
  ];
}
function Hs(e, t) {
  return e[0] * t[0] + e[1] * t[1] + e[2] * t[2];
}
function Di(e) {
  return Math.hypot(e[0], e[1], e[2]);
}
const nb = [
    { x: 0.934475052698969, y: 0.004363180216799212 },
    { x: 0.948891570423846, y: 0.039714756021395174 },
    { x: 0.9608728659762679, y: 0.07607039935952659 },
    { x: 0.9703302557200477, y: 0.11326502451357987 },
    { x: 0.977189539605176, y: 0.15112675873557632 },
    { x: 0.9813908922405818, y: 0.18947802927479046 },
    { x: 0.9828887074578869, y: 0.2281365499571005 },
    { x: 0.9816519990958227, y: 0.2669163757988432 },
    { x: 0.9776625497902636, y: 0.30562830330137525 },
    { x: 0.9709166586711733, y: 0.3440810419322467 },
    { x: 0.9614266573440594, y: 0.3820827122339433 },
    { x: 0.949221424670692, y: 0.41944230284893746 },
    { x: 0.9343467338379507, y: 0.45597122804302315 },
    { x: 0.9168643128164508, y: 0.49148439126889626 },
    { x: 0.8968538338085426, y: 0.5258027955519334 },
    { x: 0.8744135590875667, y: 0.5587560766363049 },
    { x: 0.8496605481016927, y: 0.5901852347689388 },
    { x: 0.8227287687893752, y: 0.6199442885313702 },
    { x: 0.7937617531488526, y: 0.6478973166280976 },
    { x: 0.762905919754175, y: 0.6739136951531549 },
    { x: 0.7303134746505421, y: 0.6978700569784003 },
    { x: 0.6961411032024281, y: 0.7196491755310737 },
    { x: 0.6605596057818293, y: 0.7391502303914683 },
    { x: 0.6237513457393834, y: 0.7562897143525837 },
    { x: 0.5859073404691287, y: 0.7710015652906158 },
    { x: 0.5472248974285161, y: 0.7832374824769789 },
    { x: 0.507904865265839, y: 0.7929662862613107 },
    { x: 0.4681494646643414, y: 0.8001734773422571 },
    { x: 0.4281602030115182, y: 0.8048604074486263 },
    { x: 0.38813613170852307, y: 0.8070434681543606 },
    { x: 0.34827256966973696, y: 0.8067537475134688 },
    { x: 0.3087597745583025, y: 0.8040363403785654 },
    { x: 0.26978201344672026, y: 0.7989504065912386 },
    { x: 0.23151662960878241, y: 0.7915694823366872 },
    { x: 0.19413194481287305, y: 0.7819778247879767 },
    { x: 0.1577852845947917, y: 0.7702630818507747 },
    { x: 0.12262733079593371, y: 0.7565354795442158 },
    { x: 0.08880015313138229, y: 0.7409422361214794 },
    { x: 0.05642586889159421, y: 0.7236017950683938 },
    { x: 0.02561647598492663, y: 0.704659966051552 },
    { x: -0.0036037810305528913, y: 0.6895105233164277 },
    { x: -0.03317542334906984, y: 0.7095400285365243 },
    { x: -0.06438496917371282, y: 0.7280864309789705 },
    { x: -0.0971349646590295, y: 0.7450166000084965 },
    { x: -0.13130575647382275, y: 0.7601465770772312 },
    { x: -0.16677330012669841, y: 0.7733777436363767 },
    { x: -0.20339569964825052, y: 0.7845796245158417 },
    { x: -0.24101725346433553, y: 0.7936313321637897 },
    { x: -0.27947704857143557, y: 0.8004456020397803 },
    { x: -0.3186049196302664, y: 0.8049436403918587 },
    { x: -0.35822225014656567, y: 0.8070572252942809 },
    { x: -0.398143514039767, y: 0.8067313311007664 },
    { x: -0.438177182680152, y: 0.8039242993502419 },
    { x: -0.478126841210925, y: 0.7986084072202804 },
    { x: -0.5177925726656645, y: 0.7907706714017452 },
    { x: -0.5569723963185897, y: 0.7804134068929688 },
    { x: -0.5954640748960385, y: 0.7675550146764192 },
    { x: -0.6330671972405764, y: 0.7522306880298593 },
    { x: -0.6695855487964426, y: 0.734492987733704 },
    { x: -0.7048299443180804, y: 0.714412410733904 },
    { x: -0.7386209319309059, y: 0.6920772477931056 },
    { x: -0.7707921245520308, y: 0.6675935661866239 },
    { x: -0.8011924150225685, y: 0.641083697347949 },
    { x: -0.8296683466506882, y: 0.612669941116809 },
    { x: -0.8560711521836232, y: 0.5824818706921402 },
    { x: -0.8802586099360401, y: 0.550657644865542 },
    { x: -0.9021016261853626, y: 0.5173474030319016 },
    { x: -0.921488351217944, y: 0.48271361643050537 },
    { x: -0.9383250626073236, y: 0.44692900756649523 },
    { x: -0.9525363976829352, y: 0.4101742582574272 },
    { x: -0.9640652637601566, y: 0.37263580242597466 },
    { x: -0.9728702117174652, y: 0.3345029815392968 },
    { x: -0.9789264673905609, y: 0.2959671170672982 },
    { x: -0.9822255348467005, y: 0.25722000690078245 },
    { x: -0.982774894246464, y: 0.21845258628445002 },
    { x: -0.9805967489497907, y: 0.17985349925722946 },
    { x: -0.9757258679433654, y: 0.1416078138454962 },
    { x: -0.9682107746348935, y: 0.1038965717106635 },
    { x: -0.9581143826889033, y: 0.06689596974801386 },
    { x: -0.9455146116784895, y: 0.03077634172969411 },
    { x: -0.9305051553319804, y: -0.004299067407576291 },
    { x: -0.9131952327192244, y: -0.038175545674491246 },
    { x: -0.8937019647378253, y: -0.07070785611844921 },
    { x: -0.8721591451869681, y: -0.10176130887451734 },
    { x: -0.8487362913086253, y: -0.1312168064224554 },
    { x: -0.8236207468105732, y: -0.15897343836917888 },
    { x: -0.7970979502287641, y: -0.18497038865757742 },
    { x: -0.7710541733734617, y: -0.2096139557882936 },
    { x: -0.7461193861529073, y: -0.23320814197562353 },
    { x: -0.7221519248227056, y: -0.2558870618710858 },
    { x: -0.6990265515010246, y: -0.27776911859221876 },
    { x: -0.6766318459161248, y: -0.29895980890191903 },
    { x: -0.6548676461286994, y: -0.31955389248594185 },
    { x: -0.6336431338424889, y: -0.3396372581810514 },
    { x: -0.6128753135059731, y: -0.359288557412959 },
    { x: -0.5924873537443393, y: -0.3785803988633805 },
    { x: -0.5724075923763201, y: -0.3975806113171165 },
    { x: -0.5525683653066091, y: -0.4163531831687479 },
    { x: -0.5329051623123328, y: -0.43495923867716463 },
    { x: -0.5133556323648999, y: -0.45345775659418885 },
    { x: -0.49385881021048816, y: -0.47190633957419137 },
    { x: -0.4743544952965227, y: -0.4903620705111528 },
    { x: -0.4547822689301765, y: -0.5088820023697915 },
    { x: -0.43508096787875605, y: -0.5275240823754965 },
    { x: -0.41518776564532156, y: -0.5463477370262614 },
    { x: -0.39503744073179237, y: -0.565414738403984 },
    { x: -0.37456138068841166, y: -0.584789881188713 },
    { x: -0.3536868090571391, y: -0.6045421927475639 },
    { x: -0.33233545822868515, y: -0.6247456276706727 },
    { x: -0.31042247776931897, y: -0.6454805113116225 },
    { x: -0.28785488995869934, y: -0.6668347728530055 },
    { x: -0.26452992996104363, y: -0.6889057008744045 },
    { x: -0.24032737271767535, y: -0.7117848186103969 },
    { x: -0.21465925160321186, y: -0.7340046463187382 },
    { x: -0.18703495679704094, y: -0.7534714425430167 },
    { x: -0.15772553428835867, y: -0.7700652053068575 },
    { x: -0.1270070450444056, y: -0.7836711911119708 },
    { x: -0.0951684130469074, y: -0.7942311382405959 },
    { x: -0.062495032850901626, y: -0.8016579582061256 },
    { x: -0.02928242470209217, y: -0.8059763869703366 },
    { x: 0.00418250025635626, y: -0.8071603933705995 },
    { x: 0.03761179305139532, y: -0.8051997052887491 },
    { x: 0.07071763099568142, y: -0.8001090083866196 },
    { x: 0.10320959245128111, y: -0.7918885098432591 },
    { x: 0.134798677354145, y: -0.7805799374564395 },
    { x: 0.16519657722647352, y: -0.7662371932046725 },
    { x: 0.1941137081486192, y: -0.748919054724023 },
    { x: 0.22126182274327255, y: -0.7287044591356419 },
    { x: 0.24646172395988103, y: -0.705992917688509 },
    { x: 0.27042811605651085, y: -0.6833113574191189 },
    { x: 0.2935522498121435, y: -0.6614269249128338 },
    { x: 0.31594558408750634, y: -0.6402340573221494 },
    { x: 0.33770831010282365, y: -0.6196380408622824 },
    { x: 0.3589311734375708, y: -0.5995528607013482 },
    { x: 0.3796973337781967, y: -0.579900027393222 },
    { x: 0.40008347985475634, y: -0.5606067493570983 },
    { x: 0.4201613352275292, y: -0.5416052696177914 },
    { x: 0.4399985323371352, y: -0.5228315569692281 },
    { x: 0.4596595725296922, y: -0.504224454308306 },
    { x: 0.47920690986264164, y: -0.4857251046289992 },
    { x: 0.4987013585100146, y: -0.46727574968264535 },
    { x: 0.5182031792984406, y: -0.44881937116377135 },
    { x: 0.5377727619439542, y: -0.4302988919363394 },
    { x: 0.5574712942997964, y: -0.41165639717445024 },
    { x: 0.5773615598171413, y: -0.39283243400856016 },
    { x: 0.5975088031531646, y: -0.3737652763272414 },
    { x: 0.6179815681468954, y: -0.3543900575947271 },
    { x: 0.6388526754619042, y: -0.3346378544777047 },
    { x: 0.6602003073706015, y: -0.3144346462096216 },
    { x: 0.6821093031111911, y: -0.2937001458611249 },
    { x: 0.7046726622334125, y: -0.2723464324690267 },
    { x: 0.7279930725720649, y: -0.25027624068777876 },
    { x: 0.752199978996238, y: -0.22738555814564856 },
    { x: 0.7774207173704459, y: -0.20355017023582161 },
    { x: 0.8037647094696927, y: -0.17862206250636986 },
    { x: 0.8300422031017065, y: -0.15219910918500412 },
    { x: 0.8547554784773178, y: -0.1240094996536292 },
    { x: 0.8777124848745345, y: -0.09414272665900433 },
    { x: 0.8987592287763329, y: -0.06270816362882596 },
    { x: 0.9177264967761565, y: -0.029827205842901418 },
  ],
  bt = Math.PI * 2,
  ve = (e) => Math.round(e * 100) / 100,
  Da = (e, t, n) => (e < t ? t : e > n ? n : e);
class sn {
  d = "";
  move(t, n) {
    return ((this.d += `M${ve(t)} ${ve(n)}`), this);
  }
  line(t, n) {
    return ((this.d += `L${ve(t)} ${ve(n)}`), this);
  }
  curve(t, n, r, s, o, i) {
    return (
      (this.d += `C${ve(t)} ${ve(n)} ${ve(r)} ${ve(s)} ${ve(o)} ${ve(i)}`),
      this
    );
  }
  corner(t, n, r, s) {
    const o = (l, d) => {
        const h = l[0] - d[0],
          f = l[1] - d[1],
          p = Math.hypot(h, f) || 1;
        return [h / p, f / p];
      },
      i = o(t, n),
      a = o(r, n),
      c = [n[0] + i[0] * s, n[1] + i[1] * s],
      u = [n[0] + a[0] * s, n[1] + a[1] * s];
    return (
      this.d ? this.line(c[0], c[1]) : this.move(c[0], c[1]),
      (this.d += `Q${ve(n[0])} ${ve(n[1])} ${ve(u[0])} ${ve(u[1])}`),
      this
    );
  }
  arc(t, n, r, s, o, i) {
    const a = Math.max(1, Math.ceil(Math.abs(i - o) / (Math.PI / 2))),
      c = (i - o) / a,
      u = (4 / 3) * Math.tan(c / 4);
    let l = o;
    for (let d = 0; d < a; d++) {
      const h = l + c,
        f = [t + r * Math.cos(l), n + s * Math.sin(l)],
        p = [t + r * Math.cos(h), n + s * Math.sin(h)];
      (this.curve(
        f[0] - u * r * Math.sin(l),
        f[1] + u * s * Math.cos(l),
        p[0] + u * r * Math.sin(h),
        p[1] - u * s * Math.cos(h),
        p[0],
        p[1],
      ),
        (l = h));
    }
    return this;
  }
  close() {
    return this.d + "Z";
  }
}
const rb = (e) => {
    const t = e.length;
    let n = `M${ve(e[0][0])} ${ve(e[0][1])}`;
    for (let r = 0; r < t; r++) {
      const s = e[(r - 1 + t) % t],
        o = e[r],
        i = e[(r + 1) % t],
        a = e[(r + 2) % t];
      n += `C${ve(o[0] + (i[0] - s[0]) / 6)} ${ve(o[1] + (i[1] - s[1]) / 6)} ${ve(i[0] - (a[0] - o[0]) / 6)} ${ve(i[1] - (a[1] - o[1]) / 6)} ${ve(i[0])} ${ve(i[1])}`;
    }
    return n + "Z";
  },
  Yn = (e, t = 128) => {
    const n = [];
    for (let r = 0; r < t; r++) n.push(e((r / t) * bt));
    return rb(n);
  },
  qa = (e, t) => {
    const n = new sn(),
      r = e.length;
    for (let s = 0; s < r; s++) {
      const o = typeof t == "number" ? t : t[s % t.length];
      n.corner(e[(s - 1 + r) % r], e[s], e[(s + 1) % r], o);
    }
    return n.close();
  },
  lh = (e, t, n, r = 0) =>
    qa(
      Array.from({ length: t }, (s, o) => {
        const i = r + (o / t) * bt;
        return [b + Math.cos(i) * e, b + Math.sin(i) * e];
      }),
      n,
    ),
  dh = (e, t = 160) =>
    Yn((n) => {
      const r = Math.cos(n),
        s = Math.sin(n);
      let o = 0;
      for (const [i, a, c] of e) {
        const u = i - b,
          l = a - b,
          d = r * u + s * l,
          h = d * d - (u * u + l * l) + c * c;
        if (h <= 0) continue;
        const f = d + Math.sqrt(h);
        f > o && (o = f);
      }
      return [b + r * o, b + s * o];
    }, t),
  el = (e, t, n) =>
    Yn((r) => {
      const s = Math.cos(r),
        o = Math.sin(r);
      return [
        b + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * e,
        b + Math.sign(o) * Math.pow(Math.abs(o), 2 / n) * t,
      ];
    }),
  sb = (e, t) =>
    new sn()
      .move(b - e + t, b - t)
      .line(b + e - t, b - t)
      .arc(b + e - t, b, t, t, -Math.PI / 2, Math.PI / 2)
      .line(b - e + t, b + t)
      .arc(b - e + t, b, t, t, Math.PI / 2, (Math.PI * 3) / 2)
      .close(),
  ob = (e, t) =>
    new sn()
      .move(b - e, b + t - e)
      .line(b - e, b - t + e)
      .arc(b, b - t + e, e, e, Math.PI, bt)
      .line(b + e, b + t - e)
      .arc(b, b + t - e, e, e, 0, Math.PI)
      .close(),
  ib = (e, t, n) =>
    new sn()
      .move(b - e, b - t + n)
      .arc(b, b - t + n, e, n, Math.PI, bt)
      .line(b + e, b + t - n)
      .arc(b, b + t - n, e, n, 0, Math.PI)
      .close(),
  ab = (e, t, n) => {
    const r = b + t;
    return new sn()
      .move(b - e, r - n)
      .arc(b, r - n, e, 2 * t - n, Math.PI, bt)
      .line(b + e, r - n)
      .curve(b + e, r, b + e, r, b + e - n, r)
      .line(b - e + n, r)
      .curve(b - e, r, b - e, r, b - e, r - n)
      .close();
  },
  cb = (e, t, n) => {
    const r = b + t,
      s = b - t + e;
    return new sn()
      .move(b - e, s)
      .arc(b, s, e, e, Math.PI, bt)
      .line(b + e, r - n)
      .curve(b + e, r, b + e, r, b + e - n, r)
      .line(b - e + n, r)
      .curve(b - e, r, b - e, r, b - e, r - n)
      .close();
  },
  ub = (e, t, n) => {
    const r = b - t,
      s = b + t;
    return new sn()
      .move(b - e, r + n)
      .curve(b - e, r - 2, b - e * 0.5, r - 10, b, r - 10)
      .curve(b + e * 0.5, r - 10, b + e, r - 2, b + e, r + n)
      .curve(b + e, b + t * 0.42, b + e * 0.62, s, b, s)
      .curve(b - e * 0.62, s, b - e, b + t * 0.42, b - e, r + n)
      .close();
  },
  lb = (e, t, n) =>
    Yn((r) => {
      const s = Math.cos(r),
        o = Math.sin(r),
        i = (1 - o) / 2;
      return [b + s * e * (1 - n * i * i), b + o * t];
    }),
  db = (e, t, n, r) => {
    const s = Da(e / (n - t), -1, 1),
      o = Math.sqrt(1 - s * s),
      i = [b + e * o, n - e * s],
      a = [b - e * o, n - e * s],
      c = Math.atan2(i[1] - n, i[0] - b);
    return new sn()
      .corner(i, [b, t], a, r)
      .line(a[0], a[1])
      .arc(b, n, e, e, Math.PI - c, c)
      .close();
  },
  hb = (e, t) =>
    qa(
      [
        [b - e, b - e],
        [b + e, b - e],
        [b + e, b + e],
        [b - e, b + e],
      ],
      t,
    ),
  fb = (e, t, n, r) =>
    qa(
      [
        [b - e, b + t],
        [b + e, b + t],
        [b + e, b - t + n],
        [b, b - t],
        [b - e, b - t + n],
      ],
      r,
    ),
  pb =
    "M79.4511 11.5693C94.8767 -3.85636 119.887 -3.85622 135.312 11.5693C150.738 26.995 150.738 52.0049 135.312 67.4306L129.302 73.4404L129.303 73.4414L83.7724 118.972C81.8111 120.933 79.4309 122.22 76.9199 122.833C76.463 122.944 76.0018 123.034 75.538 123.101C74.1477 123.301 72.734 123.301 71.3437 123.101C70.8802 123.034 70.4194 122.944 69.9628 122.833C69.8486 122.805 69.7347 122.776 69.621 122.745C69.3938 122.684 69.1679 122.616 68.9433 122.544C67.4837 122.073 66.0831 121.367 64.8017 120.426C64.6047 120.281 64.4108 120.13 64.2197 119.975C63.837 119.662 63.466 119.328 63.1093 118.972L11.5693 67.4306C-3.85643 52.0049 -3.85642 26.995 11.5693 11.5693C26.995 -3.85643 52.0049 -3.85643 67.4306 11.5693L73.4404 17.579L79.4511 11.5693Z",
  mb =
    "M58.9438 9.25323C63.2492 -3.08441 80.6974 -3.08441 85.0027 9.25322L91.7612 28.6207C94.0136 35.0751 100.652 38.9078 107.368 37.6311L127.52 33.8004C140.357 31.3602 149.081 46.4708 140.549 56.3681L127.156 71.9049C122.692 77.0827 122.692 84.748 127.156 89.9258L140.549 105.463C149.081 115.36 140.357 130.471 127.52 128.03L107.368 124.2C100.652 122.923 94.0136 126.756 91.7612 133.21L85.0027 152.577C80.6974 164.915 63.2492 164.915 58.9438 152.577L52.1853 133.21C49.933 126.756 43.2946 122.923 36.5788 124.2L16.4268 128.03C3.58942 130.471 -5.1347 115.36 3.39733 105.463L16.7908 89.9258C21.2543 84.748 21.2543 77.0827 16.7908 71.9049L3.39734 56.3681C-5.13469 46.4708 3.58941 31.3602 16.4268 33.8004L36.5787 37.6311C43.2946 38.9078 49.933 35.0751 52.1853 28.6207L58.9438 9.25323Z",
  gb =
    "M93.9365 0.100586C98.4439 -0.387322 102.691 0.897134 106.341 4.03418C111.502 8.47087 114.842 16.0545 116.636 25.2725C118.36 34.1341 118.716 44.8177 117.701 56.4346L117.707 56.4375L117.706 56.4443C122.25 58.5638 126.519 60.8171 130.449 63.168C130.485 63.1891 130.52 63.2103 130.556 63.2314C131.25 63.6478 131.934 64.067 132.607 64.4893C132.68 64.5349 132.753 64.5813 132.825 64.627C133.074 64.7838 133.322 64.941 133.567 65.0986C133.692 65.1787 133.816 65.2596 133.94 65.3398C134.138 65.4676 134.335 65.5954 134.53 65.7236C134.653 65.8039 134.775 65.8844 134.896 65.9648C135.112 66.1073 135.325 66.2506 135.538 66.3936C135.625 66.4522 135.713 66.5106 135.8 66.5693C138.866 68.645 141.667 70.7792 144.163 72.9502C149.754 77.8126 153.981 83.0002 156.136 88.2578C156.159 88.3133 156.181 88.3693 156.203 88.4248C156.268 88.5868 156.332 88.749 156.393 88.9111C156.435 89.0226 156.475 89.1346 156.516 89.2461C156.541 89.3175 156.566 89.3895 156.591 89.4609C157.443 91.8917 157.839 94.3199 157.696 96.7109C157.522 99.7997 156.469 102.655 154.613 105.192C154.236 105.709 153.826 106.208 153.388 106.692C153.365 106.717 153.343 106.742 153.32 106.767C153.171 106.93 153.019 107.091 152.863 107.25C152.844 107.27 152.824 107.29 152.804 107.311C152.3 107.822 151.762 108.316 151.191 108.79C151.168 108.81 151.144 108.83 151.12 108.85C150.952 108.988 150.781 109.125 150.607 109.261C150.558 109.299 150.509 109.337 150.46 109.375C150.282 109.512 150.101 109.648 149.917 109.781C149.903 109.792 149.888 109.801 149.874 109.812C149.255 110.26 148.605 110.689 147.926 111.1C147.795 111.179 147.662 111.256 147.528 111.334C147.41 111.403 147.292 111.473 147.173 111.541C146.915 111.687 146.653 111.832 146.388 111.974C146.316 112.012 146.243 112.047 146.171 112.085C145.978 112.186 145.783 112.287 145.586 112.386C145.459 112.449 145.331 112.511 145.203 112.573C145.048 112.649 144.891 112.723 144.733 112.797C144.614 112.853 144.494 112.909 144.373 112.964C144.198 113.044 144.021 113.122 143.843 113.2C143.722 113.253 143.6 113.306 143.478 113.358C143.288 113.439 143.096 113.519 142.903 113.598C142.836 113.625 142.769 113.655 142.701 113.683C142.662 113.698 142.622 113.712 142.583 113.728C142.371 113.812 142.156 113.895 141.94 113.978C141.847 114.013 141.753 114.051 141.658 114.086C140.71 114.441 139.731 114.771 138.725 115.078C138.613 115.112 138.502 115.145 138.39 115.179C138.257 115.218 138.123 115.26 137.989 115.299C137.911 115.322 137.831 115.343 137.752 115.365C137.61 115.406 137.467 115.446 137.324 115.485C137.095 115.549 136.863 115.611 136.63 115.672C136.52 115.701 136.41 115.73 136.3 115.759C136.064 115.819 135.827 115.879 135.588 115.938C135.451 115.971 135.314 116.004 135.177 116.037C134.975 116.085 134.772 116.131 134.568 116.178C134.312 116.236 134.054 116.294 133.795 116.35C133.535 116.406 133.274 116.461 133.011 116.515C132.85 116.547 132.688 116.578 132.525 116.61C132.333 116.648 132.14 116.686 131.946 116.723C131.689 116.771 131.43 116.818 131.17 116.864C131.075 116.881 130.979 116.898 130.884 116.914C130.595 116.964 130.304 117.012 130.012 117.06C129.932 117.073 129.851 117.085 129.771 117.098C129.484 117.143 129.196 117.188 128.906 117.23C128.818 117.243 128.729 117.256 128.641 117.269C127.33 117.457 125.983 117.62 124.601 117.755C124.468 117.768 124.336 117.782 124.203 117.794C123.92 117.82 123.636 117.845 123.351 117.869C123.24 117.878 123.13 117.888 123.02 117.897C122.701 117.923 122.381 117.948 122.059 117.971C121.967 117.977 121.874 117.984 121.782 117.99C121.463 118.012 121.143 118.033 120.82 118.053C120.73 118.058 120.639 118.063 120.549 118.068C119.546 118.126 118.527 118.171 117.492 118.202C117.322 118.207 117.151 118.213 116.979 118.218C116.785 118.223 116.59 118.225 116.395 118.229C116.147 118.235 115.899 118.24 115.65 118.244C115.415 118.248 115.178 118.25 114.94 118.252C114.688 118.254 114.435 118.256 114.181 118.257C114.008 118.257 113.835 118.257 113.662 118.257C113.32 118.256 112.976 118.255 112.631 118.252C112.503 118.251 112.375 118.25 112.247 118.248C111.858 118.243 111.466 118.237 111.073 118.229C110.984 118.227 110.894 118.226 110.804 118.224C107.734 118.154 104.558 117.977 101.289 117.69C96.3593 128.261 90.7082 137.338 84.7832 144.151C78.6204 151.238 71.9357 156.137 65.2471 157.399C60.5179 158.292 56.1975 157.281 52.5381 154.604C48.9431 151.975 46.1246 147.845 44.0479 142.691C40.0321 132.725 38.5457 118.333 40.043 101.281C40.0382 101.279 40.0331 101.277 40.0283 101.274C39.6986 101.121 39.3711 100.965 39.0449 100.811C38.8351 100.711 38.6254 100.612 38.417 100.512C38.0794 100.35 37.7438 100.186 37.4102 100.023C37.2392 99.9399 37.0684 99.8563 36.8984 99.7725C36.5886 99.6196 36.2801 99.4663 35.9736 99.3125C35.7564 99.2034 35.5398 99.0939 35.3242 98.9844C34.9817 98.8104 34.6409 98.636 34.3027 98.4609C34.2424 98.4297 34.1823 98.3975 34.1221 98.3662C19.2858 90.6566 8.70839 81.8767 3.56055 73.3232C3.50461 73.2303 3.44926 73.137 3.39453 73.0439C3.37308 73.0075 3.35134 72.971 3.33008 72.9346C3.19352 72.7003 3.06142 72.4652 2.93262 72.2305C2.19429 70.8865 1.58552 69.5375 1.11816 68.1895C1.10444 68.1499 1.09161 68.1099 1.07813 68.0703C1.04009 67.9586 1.00191 67.847 0.96582 67.7354C0.954674 67.7009 0.943578 67.6663 0.932617 67.6318C0.823298 67.2877 0.723275 66.9435 0.632813 66.5996C-0.103732 63.8123 -0.218301 61.0433 0.402344 58.3643C1.34437 54.2986 3.89972 50.7745 7.875 47.9023C7.90661 47.8794 7.93796 47.8559 7.96973 47.833C8.12646 47.7208 8.2852 47.6092 8.44629 47.499C8.57825 47.4084 8.71216 47.3194 8.84668 47.2305C8.87052 47.2148 8.89404 47.1983 8.91797 47.1826C10.608 46.0723 12.497 45.0908 14.5547 44.2324C14.6355 44.1986 14.7165 44.1643 14.7979 44.1309C14.8508 44.1092 14.9038 44.087 14.957 44.0654L15.25 43.9482C15.3501 43.9084 15.4509 43.8694 15.5518 43.8301C15.6093 43.8078 15.6668 43.7848 15.7246 43.7627C23.7646 40.6682 34.1765 39.3165 45.6846 39.4756C45.8574 39.4779 46.0307 39.4814 46.2041 39.4844C46.4305 39.4884 46.6576 39.4909 46.8848 39.4961C47.3568 39.5065 47.8313 39.5207 48.3076 39.5361C48.4142 39.5397 48.5212 39.5441 48.6279 39.5479C51.1795 39.6366 53.791 39.7967 56.4512 40.0293C63.6811 24.5137 72.1655 12.7934 80.627 6.1709C85.0025 2.74635 89.5085 0.57999 93.9365 0.100586Z",
  yb = (e, t) =>
    dh([
      [b - e, b - e, t],
      [b + e, b - e, t],
      [b + e, b + e, t],
      [b - e, b + e, t],
    ]),
  kb = (e, t, n) =>
    Yn((r) => {
      const s = Math.cos(r),
        o = Math.sin(r);
      return [
        b + s * e * Math.pow(Math.max(1 - o * o, 0), n / 2 - 0.5) * 1,
        b + o * t,
      ];
    }),
  wb = (e, t, n, r) =>
    Yn((s) => {
      const o = (a) => {
          const c = Math.abs(((((s - a + Math.PI) % bt) + bt) % bt) - Math.PI);
          return Math.exp(-(c * c) / 0.4232);
        },
        i = 1 - n * o(r) + n * 0.34 * o(r + Math.PI);
      return [b + Math.cos(s) * e * i, b + Math.sin(s) * t * i];
    }),
  bb = (e, t, n) =>
    Yn((r) => {
      const s =
        e * (1 + t * (Math.sin(r * 2 + n) * 0.6 + Math.sin(r * 3 - n) * 0.4));
      return [b + Math.cos(r) * s, b + Math.sin(r) * s * 0.98];
    }),
  Vs = (e, t = 4) => {
    const n = e.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [],
      r = [];
    let s = 0,
      o = "",
      i = 0,
      a = 0,
      c = 0,
      u = 0;
    const l = () => parseFloat(n[s++]),
      d = (h, f) => {
        const p = Math.max(2, Math.ceil(f / t));
        for (let m = 1; m <= p; m++) r.push(h(m / p));
      };
    for (; s < n.length;) {
      if ((/[a-z]/i.test(n[s]) && (o = n[s++].toUpperCase()), o === "Z")) {
        (Math.hypot(c - i, u - a) > 0.01 &&
          d(
            (h) => [i + (c - i) * h, a + (u - a) * h],
            Math.hypot(c - i, u - a),
          ),
          (i = c),
          (a = u));
        continue;
      }
      if (s >= n.length) break;
      if (o === "M")
        ((i = l()), (a = l()), (c = i), (u = a), r.push([i, a]), (o = "L"));
      else if (o === "L") {
        const h = l(),
          f = l();
        (d((p) => [i + (h - i) * p, a + (f - a) * p], Math.hypot(h - i, f - a)),
          (i = h),
          (a = f));
      } else if (o === "Q") {
        const h = l(),
          f = l(),
          p = l(),
          m = l(),
          g = i,
          y = a;
        (d(
          (w) => {
            const S = 1 - w;
            return [
              S * S * g + 2 * S * w * h + w * w * p,
              S * S * y + 2 * S * w * f + w * w * m,
            ];
          },
          Math.hypot(h - i, f - a) + Math.hypot(p - h, m - f),
        ),
          (i = p),
          (a = m));
      } else {
        const h = l(),
          f = l(),
          p = l(),
          m = l(),
          g = l(),
          y = l(),
          w = i,
          S = a;
        (d(
          (v) => {
            const x = 1 - v;
            return [
              x * x * x * w +
                3 * x * x * v * h +
                3 * x * v * v * p +
                v * v * v * g,
              x * x * x * S +
                3 * x * x * v * f +
                3 * x * v * v * m +
                v * v * v * y,
            ];
          },
          Math.hypot(h - i, f - a) +
            Math.hypot(p - h, m - f) +
            Math.hypot(g - p, y - m),
        ),
          (i = g),
          (a = y));
      }
    }
    return r;
  },
  xb = (e, t = 160) => {
    let n = 1 / 0,
      r = -1 / 0;
    for (const d of e) (d[1] < n && (n = d[1]), d[1] > r && (r = d[1]));
    const s = r - n,
      o = (d) => n + (s * (d + 0.5)) / t,
      i = new Float64Array(t),
      a = new Float64Array(t),
      c = new Float64Array(t),
      u = new Float64Array(t);
    for (let d = 0; d < t; d++) {
      const h = o(d);
      let f = -1 / 0,
        p = 1 / 0,
        m = 1 / 0,
        g = -1 / 0;
      for (let y = 0; y < e.length; y++) {
        const w = e[y],
          S = e[(y + 1) % e.length];
        if (w[1] <= h == S[1] <= h) continue;
        const v = w[0] + ((S[0] - w[0]) * (h - w[1])) / (S[1] - w[1]);
        (v <= b ? v > f && (f = v) : v < p && (p = v),
          v < m && (m = v),
          v > g && (g = v));
      }
      ((i[d] = Number.isFinite(f) ? f : b),
        (a[d] = Number.isFinite(p) ? p : b),
        (c[d] = Number.isFinite(m) ? m : b),
        (u[d] = Number.isFinite(g) ? g : b));
    }
    const l = (d, h) => (f) => {
      const p = Da(((f - n) / s) * t - 0.5, 0, t - 1),
        m = Math.floor(p),
        g = p - m,
        y = Math.min(m + 1, t - 1);
      return [d[m] + (d[y] - d[m]) * g, h[m] + (h[y] - h[m]) * g];
    };
    return { top: n, bottom: r, spanAt: l(i, a), outerAt: l(c, u) };
  },
  tl = 96,
  vb = (e) =>
    Array.from({ length: tl }, (t, n) => {
      const r = (n / tl) * bt,
        s = Math.cos(r),
        o = Math.sin(r);
      let i = 0;
      for (let a = 0; a < e.length; a++) {
        const c = e[a],
          u = e[(a + 1) % e.length],
          l = c[0] - b,
          d = c[1] - b,
          h = u[0] - b,
          f = u[1] - b,
          p = (h - l) * o - (f - d) * s;
        if (Math.abs(p) < 1e-9) continue;
        const m = (l * o - d * s) / -p;
        if (m < 0 || m > 1) continue;
        const g = (l + (h - l) * m) * s + (d + (f - d) * m) * o;
        g > i && (i = g);
      }
      return [b + s * i, b + o * i];
    }),
  Sb = (e, t, n, r) => {
    let s = 0;
    return e.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (o) => {
      s ^= 1;
      const i = parseFloat(o) + (s ? n : r);
      return String(ve(b + (i - b) * t));
    });
  },
  Mb = 228.44,
  Tb = (e) => {
    let t = 1 / 0,
      n = -1 / 0,
      r = 1 / 0,
      s = -1 / 0;
    for (const c of e)
      (c[0] < t && (t = c[0]),
        c[0] > n && (n = c[0]),
        c[1] < r && (r = c[1]),
        c[1] > s && (s = c[1]));
    const o = b - (t + n) / 2,
      i = b - (r + s) / 2;
    return { k: Da(Mb / Math.max(n - t, s - r), 0.9, 1.35), dx: o, dy: i };
  },
  Eb = (e, t) => {
    const { k: n, dx: r, dy: s } = Tb(t);
    return Math.abs(n - 1) < 0.005 && Math.abs(r) < 0.5 && Math.abs(s) < 0.5
      ? e
      : Sb(e, n, r, s);
  },
  Ba = (e) => {
    const t = Eb(e, Vs(e)),
      n = Vs(t),
      { top: r, bottom: s, spanAt: o, outerAt: i } = xb(n);
    let a = 0;
    for (let c = r; c <= s; c += 2) {
      const [u, l] = i(c);
      a = Math.max(a, (l - u) / 2);
    }
    return {
      path: t,
      ring: vb(n),
      top: ve(r),
      bottom: ve(s),
      spanAt: o,
      beltRadius: ve(a),
    };
  },
  Pb = {
    pebble: () => bb(108, 0.075, 1.1),
    bean: () => wb(94, 112, 0.34, Math.PI),
    egg: () => lb(98, 113, 0.22),
    squircle: () => el(107, 107, 3.2),
    square: () => hb(107, 28),
    tablet: () => sb(114, 74),
    capsule: () => ob(72, 113),
    cylinder: () => ib(94, 110, 48),
    hex: () => lh(114, 6, 20, Math.PI / 6),
    gem: () => el(112, 113, 1.5),
    shield: () => ub(98, 108, 30),
    dome: () => ab(114, 82, 26),
    arch: () => cb(76, 113, 42),
    cloud: () =>
      dh([
        [b - 62, b + 26, 56],
        [b + 62, b + 26, 54],
        [b, b + 34, 62],
        [b - 24, b - 30, 62],
        [b + 38, b - 26, 54],
      ]),
    leaf: () => kb(88, 113, 1.5),
    clover: () => yb(38, 58),
    house: () => fb(100, 110, 78, 29),
    heart: () => pb,
    sparkle: () => gb,
    star6: () => mb,
  },
  nl = new Map();
function Rr(e) {
  const t = nl.get(e);
  if (t != null) return t;
  const n = Ba(Pb[e]());
  return (nl.set(e, n), n);
}
const ut = (e, t = 4) => Vs(Rr(e).path, t),
  rl = (e) => Vs(e),
  hh = (e, t) => Ba(db(e, b - 114, b + 26, t)),
  Ib = (e, t) => Ba(lh(130, 3, [t, e, e], -Math.PI / 2)),
  Mr = Math.PI * 2,
  Ab = 0.36,
  $b = 0.22,
  mr = 4,
  sl = 96,
  ol = 64,
  il = 33,
  Cb = 40,
  fh = 0.72,
  al = 16,
  cl = 160,
  In = 180,
  Xo = 64,
  Yr = 1e-5,
  _b = {
    pebble: () => An(1.2167999999999999, "pebble"),
    bean: () => {
      const e = jb("bean");
      return {
        size: 1.17,
        silhouette: { kind: "solid", samples: [], balls: e, isLoop: !1 },
        seat: mh("bean", e),
      };
    },
    egg: () => An(1.17, "egg"),
    squircle: () => ({
      size: 1.17,
      silhouette: Dn(Lb("squircle", 0.28, 0.11)),
      seat: { kind: "front", faceZ: 0.28 },
    }),
    tablet: () => {
      const { x0: e, x1: t, y0: n, y1: r } = qi("tablet"),
        s = (t - e) / 2 / b,
        o = (r - n) / 2 / b,
        i = Math.max(0, s - o);
      return {
        size: 1.3922999999999999,
        silhouette: {
          kind: "solid",
          samples: [],
          balls: pl("tablet", "x"),
          isLoop: !1,
        },
        seat: {
          kind: "wrapX",
          wrapR: o,
          wrapX0: -s + 0.02,
          wrapX1: s - 0.02,
          radiusAtX: (a) => {
            const c = Math.abs(a) - i;
            return c <= 0 ? o : Math.sqrt(Math.max(0, o * o - c * c));
          },
        },
      };
    },
    capsule: () => {
      const e = pl("capsule", "y"),
        { y0: t, y1: n } = qi("capsule"),
        r = -(n - b) / b,
        s = -(t - b) / b,
        { hx: o, hz: i } = Fb(e);
      return {
        size: 1.17,
        silhouette: { kind: "solid", samples: [], balls: e, isLoop: !1 },
        seat: {
          kind: "wrap",
          wrapR: Math.max(0.35, (o + i) * 0.5),
          wrapY0: r,
          wrapY1: s,
          eyeY: (r + s) * 0.5,
        },
      };
    },
    cylinder: () => dl("cylinder", (e, t) => (t + e) * 0.5),
    hex: () => $n(1.2519, Bt(ut("hex"))),
    gem: () => An(1.17, "gem"),
    crystal: () => ({
      size: 1.3805999999999998,
      silhouette: Dn(Nb()),
      seat: { kind: "front", faceZ: 0.64 * (Math.sqrt(3) / 2) },
    }),
    wedge: () => {
      const e = Ib(60, 80),
        t = rl(e.path),
        [n, r] = e.spanAt(e.top + (e.bottom - e.top) * 0.5),
        s = -(e.top - b) / b,
        o = -(e.bottom - b) / b;
      return {
        size: 1.3590719999999998,
        silhouette: Dn(Bi(t)),
        seat: {
          kind: "wrap",
          wrapR: Math.max(0.2, (r - n) / 2 / b),
          wrapY0: o,
          wrapY1: s,
          eyeY: s + (o - s) * 0.5,
          radiusAt: Hi(t),
        },
      };
    },
    shield: () => An(1.17, "shield"),
    dome: () => An(1.17, "dome"),
    arch: () => dl("arch", (e, t) => e + (t - e) * 0.42),
    cloud: () => hl(1.3455, Bt(ut("cloud", 1)), 0.72),
    teardrop: () => {
      const e = hh(88, 48),
        t = rl(e.path),
        [n, r] = e.spanAt(e.top + (e.bottom - e.top) * 0.62),
        s = -(e.bottom - b) / b,
        o = -(e.top - b) / b;
      return {
        size: 1.318122,
        silhouette: Dn(Bi(t)),
        seat: {
          kind: "wrap",
          wrapR: Math.max(0.2, (r - n) / 2 / b),
          wrapY0: s,
          wrapY1: o,
          eyeY: (s + o) * 0.5,
          radiusAt: Hi(t),
        },
      };
    },
    leaf: () => An(1.17, "leaf"),
    square: () => $n(1.0413, Bt(ut("square"))),
    starFlower: () => $n(1.3922999999999999, Db()),
    sparkle: () => $n(1.521, Bt(ut("sparkle"))),
    clover: () => $n(1.0881, Bt(ut("clover"))),
    heartChubby: () => hl(1.3571999999999997, nb, 0.62),
    house: () => $n(1.17, Bt(ut("house"))),
    star6: () => ph(1.4976, Bt(ut("star6")), 0.3, 0.18),
  },
  ul = new Map();
let ll = null;
function co(e) {
  const t = ul.get(e);
  if (t != null) return t;
  const n = _b[e]();
  return (ul.set(e, n), n);
}
function Rb() {
  return (
    (ll ??= {
      size: 1.17,
      silhouette: {
        kind: "solid",
        samples: Bt(ut("bean")),
        balls: [],
        isLoop: !0,
      },
      seat: null,
    }),
    ll
  );
}
function Dn(e) {
  return { kind: "solid", samples: e, balls: [], isLoop: !1 };
}
function An(e, t) {
  return { size: e, silhouette: Dn(yh(t)), seat: mh(t, []) };
}
function dl(e, t) {
  const n = Rr(e),
    r = -(n.top - b) / b,
    s = -(n.bottom - b) / b;
  return {
    size: 1.17,
    silhouette: Dn(yh(e)),
    seat: {
      kind: "wrap",
      wrapR: n.beltRadius / b,
      wrapY0: s,
      wrapY1: r,
      eyeY: t(r, s),
      radiusAt: kh(e),
    },
  };
}
function $n(e, t) {
  return ph(e, t, Ab, $b);
}
function ph(e, t, n, r) {
  return {
    size: e,
    silhouette: { kind: "extrusion", rings: zb(t, n, r) },
    seat: { kind: "front", faceZ: n },
  };
}
function hl(e, t, n) {
  const r = qb(t, n);
  return {
    size: e,
    silhouette: { kind: "loft", rings: r.rings },
    seat: { kind: "loft", surfaceZ: Bb(r) },
  };
}
function mh(e, t) {
  const n = Rr(e),
    r = -(n.bottom - b) / b,
    s = -(n.top - b) / b,
    o = kh(e),
    i = Math.min(s - 0.02, Math.max(r + 0.02, 0));
  return {
    kind: "wrap",
    wrapR: o(i),
    wrapY0: r,
    wrapY1: s,
    eyeY: i,
    radiusAt: o,
    puffAt: t.length > 0 ? (a, c) => Ob(t, a, c) : void 0,
  };
}
function Ob(e, t, n) {
  let r = e[0],
    s = -1 / 0,
    o = 1 / 0,
    i = !1;
  for (const a of e) {
    const c = Math.hypot(t - a[0], n - a[1]);
    if (c < a[3]) {
      const u = a[2] + Math.sqrt(a[3] * a[3] - c * c);
      (!i || u > s) && ((i = !0), (s = u), (r = a));
    } else !i && c - a[3] < o && ((o = c - a[3]), (r = a));
  }
  return { x: r[0], y: r[1], z: r[2], r: r[3] };
}
function Bt(e) {
  return e.map(([t, n]) => ({ x: (t - b) / b, y: -(n - b) / b, z: 0 }));
}
function qi(e) {
  let t = 1 / 0,
    n = -1 / 0,
    r = 1 / 0,
    s = -1 / 0;
  for (const [o, i] of Rr(e).ring)
    (o < t && (t = o), o > n && (n = o), i < r && (r = i), i > s && (s = i));
  return { x0: t, x1: n, y0: r, y1: s };
}
function Lb(e, t, n) {
  const r = Rr(e).ring.map(([i, a]) => ({ x: (i - b) / b, y: -(a - b) / b })),
    s = r.length,
    o = [];
  for (let i = 0; i < s; i++) {
    const a = r[i],
      c = r[(i - 1 + s) % s],
      u = r[(i + 1) % s];
    let l = u.y - c.y,
      d = -(u.x - c.x);
    const h = Math.hypot(l, d) || 1;
    ((l /= h), (d /= h), l * a.x + d * a.y < 0 && ((l = -l), (d = -d)));
    for (let f = 0; f <= mr; f++) {
      const p = (f / mr) * (Math.PI / 2),
        m = n * (1 - Math.cos(p)),
        g = t - n + n * Math.sin(p);
      (o.push({ x: a.x - l * m, y: a.y - d * m, z: g }),
        o.push({ x: a.x - l * m, y: a.y - d * m, z: -g }));
    }
  }
  return o;
}
function Nb() {
  const s = 1.1600000000000001,
    o = [
      { x: 0, y: s - 0.12, z: 0 },
      { x: 0, y: -s + 0.12, z: 0 },
    ],
    i = 0.54 - 0.12 * 0.25,
    a = 0.64 - 0.12;
  for (const d of [-1, 1])
    for (let h = 0; h < 6; h++) {
      const f = (h / 6) * Mr;
      o.push({ x: a * Math.cos(f), y: d * i, z: a * Math.sin(f) });
    }
  const c = [],
    u = 8,
    l = 14;
  for (const d of o)
    for (let h = 0; h <= u; h++) {
      const f = (h / u) * Math.PI,
        p = Math.sin(f),
        m = h === 0 || h === u ? 1 : l;
      for (let g = 0; g < m; g++) {
        const y = (g / m) * Mr;
        c.push({
          x: d.x + 0.12 * p * Math.sin(y),
          y: d.y + 0.12 * Math.cos(f),
          z: d.z + 0.12 * p * Math.cos(y),
        });
      }
    }
  return c;
}
function gh(e) {
  const t = e.length;
  let n = 1 / 0,
    r = -1 / 0;
  for (const [, i] of e) (i < n && (n = i), i > r && (r = i));
  ((n -= Yr), (r += Yr));
  const s = (i) => Math.min(Xo - 1, Math.floor(((i - n) / (r - n)) * Xo)),
    o = Array.from({ length: Xo }, () => []);
  for (let i = 0; i < t; i++) {
    const a = e[i][1],
      c = e[(i + 1) % t][1],
      u = s(Math.max(a, c) + Yr);
    for (let l = s(Math.min(a, c) - Yr); l <= u; l++) o[l].push(i);
  }
  return (i) => {
    let a = 1 / 0,
      c = -1 / 0;
    if (!(i >= n && i <= r)) return c - a;
    for (const u of o[s(i)]) {
      const [l, d] = e[u],
        [h, f] = e[(u + 1) % t];
      if (Math.abs(f - d) < 1e-9) {
        Math.abs(d - i) < 1e-6 &&
          ((a = Math.min(a, l, h)), (c = Math.max(c, l, h)));
        continue;
      }
      if ((d <= i && f >= i) || (f <= i && d >= i)) {
        const p = l + ((h - l) * (i - d)) / (f - d);
        (p < a && (a = p), p > c && (c = p));
      }
    }
    return c - a;
  };
}
function yh(e) {
  return Bi(ut(e));
}
function Bi(e) {
  let t = 1 / 0,
    n = -1 / 0;
  for (const [, f] of e) (f < t && (t = f), f > n && (n = f));
  const r = [],
    s = -(t - b) / b,
    o = -(n - b) / b,
    i = gh(e),
    a = (f) => {
      const p = i(f);
      return p < 0 ? 0 : p / 2 / b;
    },
    c = n - t,
    u = (f, p) => {
      if (a(f) >= 0.06) return null;
      const m = a(f);
      let g = c * 0.02;
      for (let y = c / 512; y <= c * 0.05; y += c / 512)
        if (Math.abs(a(f + p * y) - m) > 1e-4) {
          g = y;
          break;
        }
      return { yEdge: f, sign: p, dJoin: g, rJoin: a(f + p * g) };
    },
    l = [u(t, 1), u(n, -1)].filter((f) => f !== null),
    d = (f) => {
      let p = a(f);
      for (const m of l) {
        const g = (f - m.yEdge) * m.sign;
        g >= 0 &&
          g < m.dJoin &&
          (p = Math.min(p, m.rJoin * Math.sqrt(g / m.dJoin)));
      }
      return p;
    },
    h = (f, p) => {
      const m = d(p);
      m < 0.06 ? r.push({ x: 0, y: f, z: 0 }) : r.push(...fl(f, m));
    };
  h(s, t);
  for (let f = 1; f < sl - 1; f++) {
    const p = (1 - Math.cos(Math.PI * (f / (sl - 1)))) / 2,
      m = t + (n - t) * p,
      g = d(m),
      y = -(m - b) / b;
    if (g < 1e-4) {
      r.push({ x: 0, y, z: 0 });
      continue;
    }
    r.push(...fl(y, g));
  }
  return (h(o, n), r);
}
function fl(e, t) {
  const n = [];
  for (let r = 0; r < ol; r++) {
    const s = (r / ol) * Mr;
    n.push({ x: t * Math.sin(s), y: e, z: t * Math.cos(s) });
  }
  return n;
}
function kh(e) {
  return Hi(ut(e));
}
function Hi(e) {
  const t = gh(e);
  let n = 1 / 0,
    r = -1 / 0;
  for (const [, s] of e) (s < n && (n = s), s > r && (r = s));
  return (s) => {
    const o = Math.max(n, Math.min(r, b - s * b));
    return Math.max(0.02, t(o) / 2 / b);
  };
}
function pl(e, t) {
  const { x0: n, x1: r, y0: s, y1: o } = qi(e),
    i = (r - n) / 2 / b,
    a = (o - s) / 2 / b,
    c = t === "x" ? a : i,
    u = Math.max(0, (t === "x" ? i : a) - c),
    l = -u,
    d = [];
  for (let h = 0; h < il; h++) {
    const f = l + (u - l) * (h / (il - 1));
    d.push(t === "x" ? [f, 0, 0, c] : [0, f, 0, c]);
  }
  return d;
}
function Fb(e) {
  let t = 0.55,
    n = 0.35;
  for (const [r, , s, o] of e)
    ((t = Math.max(t, Math.abs(r) + o)), (n = Math.max(n, Math.abs(s) + o)));
  return { hx: t, hz: n };
}
function jb(e) {
  const t = ut(e);
  let n = 1 / 0,
    r = -1 / 0,
    s = 1 / 0,
    o = -1 / 0;
  for (const [l, d] of t)
    ((n = Math.min(n, l)),
      (r = Math.max(r, l)),
      (s = Math.min(s, d)),
      (o = Math.max(o, d)));
  const i = (l, d) => {
      let h = !1;
      const f = t.length;
      for (let p = 0, m = f - 1; p < f; m = p++) {
        const [g, y] = t[p],
          [w, S] = t[m];
        y > d != S > d && l < g + ((w - g) * (d - y)) / (S - y) && (h = !h);
      }
      return h;
    },
    a = Math.max(r - n, o - s) / Cb,
    c = [];
  for (let l = s + a / 2; l < o; l += a)
    for (let d = n + a / 2; d < r; d += a) {
      if (!i(d, l)) continue;
      let h = 1 / 0;
      for (const [p, m] of t) h = Math.min(h, (p - d) ** 2 + (m - l) ** 2);
      const f = Math.sqrt(h);
      f > a && c.push({ x: d, y: l, r: f });
    }
  c.sort((l, d) => d.r - l.r);
  const u = [];
  for (const l of c)
    u.some((d) => Math.hypot(l.x - d.x, l.y - d.y) + l.r <= d.r + a * 0.25) ||
      u.push(l);
  return u.map((l) => [(l.x - b) / b, -(l.y - b) / b, 0, l.r / b]);
}
function zb(e, t, n) {
  let r = 1 / 0,
    s = -1 / 0,
    o = 1 / 0,
    i = -1 / 0;
  for (const h of e)
    ((r = Math.min(r, h.x)),
      (s = Math.max(s, h.x)),
      (o = Math.min(o, h.y)),
      (i = Math.max(i, h.y)));
  const a = (r + s) / 2,
    c = (o + i) / 2,
    u = Math.max(1e-4, Math.min((s - r) / 2, (i - o) / 2)),
    l = (h, f) => {
      const p = (h / mr) * (Math.PI / 2),
        m = t - n + n * Math.sin(p);
      return { z: f < 0 ? -m : m, scale: 1 - (n / u) * (1 - Math.cos(p)) };
    },
    d = [];
  for (let h = mr; h >= 0; h--) d.push(l(h, -1));
  for (let h = 0; h <= mr; h++) d.push(l(h, 1));
  return d.map(({ z: h, scale: f }) =>
    e.map((p) => ({ x: a + (p.x - a) * f, y: c + (p.y - c) * f, z: h })),
  );
}
function Db() {
  const r = [{ x: 0, y: 0, r: 0.36 }];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Mr) / 6;
    r.push({ x: 0.58 * Math.cos(a), y: 0.58 * Math.sin(a), r: 0.33 });
  }
  const s = 240,
    o = [];
  for (let i = 0; i < s; i++) {
    const a = (i / s) * Mr,
      c = Math.cos(a),
      u = Math.sin(a);
    let l = 0,
      d = 0.58 + 0.33;
    for (let h = 0; h < 22; h++) {
      const f = (l + d) / 2,
        p = f * c,
        m = f * u;
      r.some((g) => (p - g.x) * (p - g.x) + (m - g.y) * (m - g.y) <= g.r * g.r)
        ? (l = f)
        : (d = f);
    }
    o.push({ x: l * c, y: l * u, z: 0 });
  }
  return o;
}
function qb(e, t) {
  const n = e.length / cl,
    r = n > 1 ? Array.from({ length: cl }, (l, d) => e[Math.floor(d * n)]) : e;
  let s = 1 / 0,
    o = -1 / 0,
    i = 1 / 0,
    a = -1 / 0;
  for (const l of r)
    ((s = Math.min(s, l.x)),
      (o = Math.max(o, l.x)),
      (i = Math.min(i, l.y)),
      (a = Math.max(a, l.y)));
  const c = { x: (s + o) / 2, y: (i + a) / 2 },
    u = [];
  for (let l = 0; l <= al; l++) {
    const d = -Math.PI / 2 + (Math.PI * l) / al,
      h = Math.pow(Math.max(0, Math.cos(d)), fh),
      f = t * Math.sin(d);
    u.push(
      r.map((p) => ({
        x: c.x + (p.x - c.x) * h,
        y: c.y + (p.y - c.y) * h,
        z: f,
      })),
    );
  }
  return { rings: u, center: c, depth: t };
}
function Bb({ rings: e, center: t, depth: n }) {
  const r = e[Math.floor(e.length / 2)],
    s = new Float64Array(In);
  for (let i = 0; i < In; i++) {
    const a = ((i + 0.5) / In) * Math.PI * 2,
      c = Math.cos(a),
      u = Math.sin(a);
    let l = 0;
    for (let d = 0; d < r.length; d++) {
      const h = r[d],
        f = r[(d + 1) % r.length],
        p = f.x - h.x,
        m = f.y - h.y,
        g = c * m - u * p;
      if (Math.abs(g) < 1e-9) continue;
      const y = h.x - t.x,
        w = h.y - t.y,
        S = (y * m - w * p) / g,
        v = (y * u - w * c) / g;
      S > l && v >= 0 && v <= 1 && (l = S);
    }
    s[i] = l;
  }
  const o = (i, a) => {
    const c = i - t.x,
      u = a - t.y,
      l = Math.hypot(c, u);
    if (l < 1e-8) return 0;
    const h =
        (((Math.atan2(u, c) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) *
        In,
      f = Math.floor(h) % In,
      p = h - Math.floor(h),
      m = s[f],
      g = s[(f + 1) % In];
    return Math.min(1, l / Math.max(1e-8, m * (1 - p) + g * p));
  };
  return (i, a) => n * Math.sqrt(Math.max(0, 1 - Math.pow(o(i, a), 2 / fh)));
}
const gr = Math.PI * 2,
  Hb = 0.2,
  Vb = 0.36,
  Gb = 1.18,
  Wb = 160,
  Je = 480,
  Ub = wh(Wb),
  ml = wh(Je),
  Kb = 1.01,
  Xb = 1e-5,
  Yb = 0.01,
  Zb = 8;
function wh(e) {
  return Array.from({ length: e }, (t, n) => {
    const r = (n / e) * gr;
    return { x: Math.cos(r), y: Math.sin(r) };
  });
}
function Ha(e, t) {
  return Math.max(Hb, e.size) * ((Vb * t) / Gb);
}
function bh(e, t, n) {
  return ex(e.silhouette, xh(e, t, n)).flatMap(vh);
}
function Qb(e, t, n, r) {
  return e.seat == null ? [] : sx(e.seat, r, xh(e, t, n)).flatMap(vh);
}
function xh(e, t, n) {
  const r = n / 2,
    s = Ha(e, n),
    o = Jb(
      (t.yaw * Math.PI) / 180,
      (t.pitch * Math.PI) / 180,
      (t.roll * Math.PI) / 180,
    );
  return {
    rotate: o,
    project: (i) => {
      const a = o(i);
      return { x: r + s * a.x, y: r - s * a.y };
    },
    origin: { x: r, y: r },
    radius: s,
  };
}
function Jb(e, t, n) {
  const [r, s, o] = Yo(e),
    [i, a, c] = Yo(t),
    [u, l, d] = Yo(n);
  return ({ x: h, y: f, z: p }) => {
    const m = h * r + p * s,
      g = f * r + f * o,
      y = p * r - h * s,
      w = m * i + m * c,
      S = g * i - y * a,
      v = y * i + g * a;
    return { x: w * u - S * l, y: S * u + w * l, z: v * u + v * d };
  };
}
function Yo(e) {
  const t = Math.cos(e);
  return [t, Math.sin(e), 1 - t];
}
function vh(e) {
  const [t] = e;
  if (e.length < 2 || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return [];
  const n = [];
  for (const r of e)
    Number.isFinite(r.x) && Number.isFinite(r.y) && n.push(r.x, r.y);
  return n.length >= 6 ? [n] : [];
}
function ex(e, t) {
  if (e.kind === "loft") return [rx(e.rings, t)];
  if (e.kind === "solid") return [tx(e, t)];
  const n = e.rings.map((i) => i.map(t.project)),
    r = n[0],
    s = n[n.length - 1],
    o = [s, r];
  for (let i = 1; i < n.length; i++) {
    const a = n[i - 1],
      c = n[i];
    for (let u = 0; u < c.length; u++) {
      const l = (u + 1) % s.length;
      o.push([a[u], a[l], c[l], c[u]]);
    }
  }
  return o;
}
function tx(e, { project: t, origin: n, radius: r }) {
  const s = [];
  for (const c of e.samples) {
    const u = t(c);
    Number.isFinite(u.x) && Number.isFinite(u.y) && s.push(u);
  }
  if (e.isLoop) return s;
  if (e.balls.length === 0) return Zo(s);
  const o = e.balls
    .map(([c, u, l, d]) => ({ ...t({ x: c, y: u, z: l }), r: d * r }))
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.r > 1e-6);
  let i = n.x,
    a = n.y;
  if (o.length > 0) {
    ((i = 0), (a = 0));
    for (const c of o) ((i += c.x), (a += c.y));
    ((i /= o.length), (a /= o.length));
  }
  for (const { x: c, y: u } of Ub) {
    let l = 0;
    for (const d of o) {
      const h = d.x - i,
        f = d.y - a,
        p = c * h + u * f,
        m = p * p - (h * h + f * f) + d.r * d.r;
      if (m <= 0) continue;
      const g = p + Math.sqrt(m);
      g > l && (l = g);
    }
    l > 0 && s.push({ x: i + c * l, y: a + u * l });
  }
  if (e.samples.length > 0) return Zo(s);
  if (s.length >= 3) return s;
  for (const c of o)
    for (let u = 0; u < 48; u++) {
      const l = (u / 48) * gr;
      s.push({ x: c.x + c.r * Math.cos(l), y: c.y + c.r * Math.sin(l) });
    }
  return s.length >= 3 ? Zo(s) : s;
}
function Zo(e) {
  const t = nx(e.filter((o) => Number.isFinite(o.x) && Number.isFinite(o.y)));
  if (t.length < 3) return t;
  const n = (o, i, a) => (i.x - o.x) * (a.y - o.y) - (i.y - o.y) * (a.x - o.x),
    r = [];
  for (const o of t) {
    for (; r.length >= 2 && n(r[r.length - 2], r[r.length - 1], o) <= 0;)
      r.pop();
    r.push(o);
  }
  const s = [];
  for (let o = t.length - 1; o >= 0; o--) {
    const i = t[o];
    for (; s.length >= 2 && n(s[s.length - 2], s[s.length - 1], i) <= 0;)
      s.pop();
    s.push(i);
  }
  return (r.pop(), s.pop(), [...r, ...s]);
}
function nx(e) {
  let t = 1 / 0,
    n = -1 / 0;
  for (const { x: u } of e) (u < t && (t = u), u > n && (n = u));
  const r = Math.ceil(e.length / Zb),
    s = n > t ? r / (n - t) : 0,
    o = (u) => Math.min(r - 1, Math.floor((u - t) * s)),
    i = new Int32Array(r + 1);
  for (const { x: u } of e) i[o(u) + 1]++;
  for (let u = 0; u < r; u++) i[u + 1] += i[u];
  const a = i.slice(0, r),
    c = new Array(e.length);
  for (const u of e) c[a[o(u.x)]++] = u;
  for (let u = 0; u < r; u++)
    for (let l = i[u] + 1; l < i[u + 1]; l++) {
      const d = c[l];
      let h = l - 1;
      for (
        ;
        h >= i[u] && (c[h].x > d.x || (c[h].x === d.x && c[h].y > d.y));
        h--
      )
        c[h + 1] = c[h];
      c[h + 1] = d;
    }
  return c;
}
function rx(e, { project: t, origin: n }) {
  const r = e.map((g) => g.map(t)),
    s = (g) => {
      let y = 0,
        w = 0;
      for (const S of g) ((y += S.x), (w += S.y));
      return { x: y / g.length, y: w / g.length };
    },
    o = s(r[0]),
    i = s(r[r.length - 1]);
  if (Math.hypot(i.x - o.x, i.y - o.y) < 1e-4) {
    let g = r[0],
      y = 0;
    for (const w of r) {
      let S = 0;
      for (let v = 0; v < w.length; v++) {
        const x = w[v],
          E = w[(v + 1) % w.length];
        S += x.x * E.y - E.x * x.y;
      }
      Math.abs(S) > y && ((g = w), (y = Math.abs(S)));
    }
    return g;
  }
  const a = r.map((g) =>
      g.map(({ x: y, y: w }) => (y - n.x) * (y - n.x) + (w - n.y) * (w - n.y)),
    ),
    c = a.map((g) => Math.max(...g)),
    u = Xb * Math.max(...c) + Yb,
    l = (g, y) => {
      const w = (y - u) / Kb;
      return w > 0 && g < w * w;
    },
    d = r.map((g) =>
      g.map((y) => {
        const w = (Math.atan2(y.y - n.y, y.x - n.x) + gr) % gr;
        return Math.floor((w / gr) * Je) % Je;
      }),
    ),
    h = new Float64Array(Je);
  let f = 0;
  const p = (g, y, w, S, v) => {
      if (l(v, f)) return;
      let x = S - w;
      x > Je / 2 ? (x -= Je) : x < -Je / 2 && (x += Je);
      const E = x < 0 ? -1 : 1,
        A = Math.abs(x);
      let j = 1 / 0;
      for (let I = -1; I <= A + 1; I++) {
        const $ = (w + E * I + Je) % Je;
        h[$] < j && (j = h[$]);
      }
      if (l(v, j)) return;
      const F = y.x - g.x,
        O = y.y - g.y,
        L = g.x - n.x,
        T = g.y - n.y;
      for (let I = -1; I <= A + 1; I++) {
        const $ = (w + E * I + Je) % Je,
          { x: R, y: U } = ml[$],
          W = R * O - U * F;
        if (Math.abs(W) < 1e-9) continue;
        const G = (L * O - T * F) / W,
          J = (L * U - T * R) / W;
        G > h[$] && J >= 0 && J <= 1 && (h[$] = G);
      }
    },
    m = c.map((g, y) => y).sort((g, y) => c[y] - c[g]);
  for (const g of m) {
    const y = r[g];
    for (let w = 0; w < y.length; w++) {
      const S = (w + 1) % y.length;
      p(y[w], y[S], d[g][w], d[g][S], Math.max(a[g][w], a[g][S]));
    }
    f = Math.min(...h);
  }
  for (let g = 0; g < r.length - 1; g++) {
    const y = r[g],
      w = r[g + 1];
    for (let S = 0; S < Math.min(y.length, w.length); S++)
      p(y[S], w[S], d[g][S], d[g + 1][S], Math.max(a[g][S], a[g + 1][S]));
  }
  return ml.flatMap(({ x: g, y }, w) =>
    h[w] > 0 ? [{ x: n.x + g * h[w], y: n.y + y * h[w] }] : [],
  );
}
function sx(e, t, n) {
  switch (e.kind) {
    case "front":
      return ox(e.faceZ, t, n);
    case "loft":
      return ix(e.surfaceZ, t, n);
    case "wrap":
      return ax(e, t, n);
    case "wrapX":
      return cx(e, t, n);
  }
}
function ox(e, { loops: t, shiftY: n }, r) {
  if (!(r.rotate({ x: 0, y: 0, z: 1 }).z > 0.03)) return [];
  const o = Math.sin(n);
  return t
    .filter((i) => i.length >= 3)
    .map((i) => i.map((a) => r.project({ x: a.x, y: a.y - o, z: e })));
}
function ix(e, { loops: t, shiftY: n }, { rotate: r, project: s }) {
  if (!(r({ x: 0, y: 0, z: 1 }).z >= 0.05)) return [];
  const i = Math.sin(n),
    a = [];
  for (const c of t) {
    if (c.length < 3) continue;
    const u = c.map((y) => ({ x: y.x, y: y.y - i }));
    let l = 0,
      d = 0;
    for (const y of u) ((l += y.x), (d += y.y));
    ((l /= u.length), (d /= u.length));
    const h = 0.004,
      f = (e(l + h, d) - e(l - h, d)) / (2 * h),
      p = (e(l, d + h) - e(l, d - h)) / (2 * h),
      m = Math.hypot(f, p, 1);
    if (r({ x: -f / m, y: -p / m, z: 1 / m }).z < 0.12) continue;
    const g = e(l, d);
    a.push(
      u.map((y) => s({ x: y.x, y: y.y, z: g + (y.x - l) * f + (y.y - d) * p })),
    );
  }
  return a;
}
function ax(e, { loops: t, shiftY: n }, { rotate: r, project: s }) {
  const { wrapR: o, wrapY0: i, wrapY1: a, radiusAt: c, puffAt: u } = e,
    l = c ? 0.02 : 0.06,
    d = Math.min(a - l, Math.max(i + l, e.eyeY - n)),
    h = (v) => Math.min(a, Math.max(i, v)),
    f = (v) => {
      const x = [];
      for (const E of v) {
        const A = h(d + E.y),
          j = c ? c(A) : o,
          F = Math.max(-2.6, Math.min(2.6, E.x / Math.max(0.12, j)));
        let O = 0;
        (c &&
          (O =
            -(c(Math.min(a, A + 0.012)) - c(Math.max(i, A - 0.012))) /
            (2 * 0.012)),
          r({ x: Math.sin(F), y: O, z: Math.cos(F) }).z >= 0.05 &&
            x.push(s({ x: j * Math.sin(F), y: A, z: j * Math.cos(F) })));
      }
      return x;
    },
    p = (v) => {
      if (!u || v.length === 0) return [];
      let x = 0,
        E = 0;
      for (const O of v) ((x += O.x), (E += O.y));
      const A = u(x / v.length, h(d + E / v.length)),
        j = r({ x: 0, y: 0, z: 1 }).z,
        F = [];
      for (const O of v) {
        const L = O.x - A.x,
          T = h(d + O.y) - A.y,
          I = Math.hypot(L, T);
        let $ = Math.min(I / A.r, Math.PI - 0.02);
        const R = I > 1e-9 ? L / I : 1,
          U = I > 1e-9 ? T / I : 0,
          W = r({ x: R, y: U, z: 0 }).z,
          G = (K) => W * Math.sin(K) + j * Math.cos(K);
        if (G($) < 0.06 && j > 0.06) {
          let K = 0,
            ae = $;
          for (let ee = 0; ee < 20; ee++) {
            const te = (K + ae) / 2;
            G(te) >= 0.06 ? (K = te) : (ae = te);
          }
          $ = K;
        }
        const J = A.r * Math.sin($),
          ye = { x: R * Math.sin($), y: U * Math.sin($), z: Math.cos($) };
        r(ye).z >= 0.05 &&
          F.push(
            s({ x: A.x + R * J, y: A.y + U * J, z: A.z + A.r * Math.cos($) }),
          );
      }
      return F;
    };
  let m = 1 / 0,
    g = -1 / 0;
  for (const v of t)
    for (const x of v) (x.y < m && (m = x.y), x.y > g && (g = x.y));
  let y = 0;
  g - m <= a - i &&
    (d + m < i ? (y = i - (d + m)) : d + g > a && (y = a - (d + g)));
  const w = y === 0 ? t : t.map((v) => v.map((x) => ({ x: x.x, y: x.y + y }))),
    S = u ? p : f;
  return w.map(S).filter((v) => v.length > 2);
}
function cx(e, { loops: t, shiftY: n }, { rotate: r, project: s }) {
  const { wrapR: o, wrapX0: i, wrapX1: a, radiusAtX: c } = e,
    u = Math.max(-2.4, Math.min(2.4, -n / o));
  let l = 1 / 0,
    d = -1 / 0;
  for (const p of t)
    for (const m of p) (m.x < l && (l = m.x), m.x > d && (d = m.x));
  let h = 0;
  return (
    d - l <= a - i && (l < i ? (h = i - l) : d > a && (h = a - d)),
    (h === 0 ? t : t.map((p) => p.map((m) => ({ x: m.x + h, y: m.y }))))
      .map((p) => {
        const m = [];
        for (const g of p) {
          const y = Math.min(a, Math.max(i, g.x)),
            w = c(y),
            S = u + Math.max(-2.6, Math.min(2.6, g.y / Math.max(0.12, o))),
            v = 0.012,
            x = -(c(Math.min(a, y + v)) - c(Math.max(i, y - v))) / (2 * v);
          r({ x, y: Math.sin(S), z: Math.cos(S) }).z >= 0.05 &&
            m.push(s({ x: y, y: w * Math.sin(S), z: w * Math.cos(S) }));
        }
        return m;
      })
      .filter((p) => p.length > 2)
  );
}
const Cn = { kind: "extrusion", halfDepth: 0.36, bevel: 0.22 },
  ux = {
    cloud: { kind: "loft", depth: 0.72 },
    square: Cn,
    sparkle: Cn,
    clover: Cn,
    heartChubby: { kind: "loft", depth: 0.62 },
    starFlower: Cn,
    teardrop: { kind: "revolve" },
    tablet: { kind: "pill", axis: 0 },
    wedge: { kind: "revolve" },
    house: Cn,
    star6: { kind: "extrusion", halfDepth: 0.3, bevel: 0.18 },
    pebble: { kind: "revolve" },
    bean: { kind: "inscribedBalls" },
    egg: { kind: "revolve" },
    squircle: { kind: "roundedSlab", halfDepth: 0.28, edge: 0.11 },
    capsule: { kind: "pill", axis: 1 },
    cylinder: { kind: "revolve" },
    hex: Cn,
    gem: { kind: "revolve" },
    crystal: { kind: "crystal" },
    shield: { kind: "revolve" },
    dome: { kind: "revolve" },
    arch: { kind: "revolve" },
    leaf: { kind: "revolve" },
  },
  Gs = Math.PI * 2,
  Qo = 1024,
  lx = { yaw: 0, pitch: 0, roll: 0 },
  Jo = 4,
  gl = 64,
  yl = 96,
  kl = 4,
  dx = 0.72,
  wl = 16,
  bl = 33,
  hx = 40,
  xl = 1e-9,
  vl = 1e-9,
  fx = 1e-15,
  Sl = new Map();
function px(e) {
  const t = Sl.get(e);
  if (t != null) return t;
  const n = mx(e, ux[e]);
  return (Sl.set(e, n), n);
}
function mx(e, t) {
  if (t.kind === "inscribedBalls")
    return { kind: "balls", balls: vx(Ml(Rb())[0]) };
  const n = Ml(co(e));
  switch (t.kind) {
    case "extrusion":
      return gx(n, t.halfDepth, t.bevel);
    case "revolve":
      return yx(lr(n[0]));
    case "roundedSlab":
      return kx(Sx(lr(n[0])), t.halfDepth, t.edge);
    case "pill":
      return { kind: "balls", balls: wx(lr(n[0]), t.axis) };
    case "crystal":
      return bx();
    case "loft":
      return xx(lr(n[0]), t.depth);
  }
}
function Ml(e) {
  const t = Ha(e, Qo),
    n = Qo / 2;
  return bh(e, lx, Qo).map((r) =>
    r.map((s, o) => (o % 2 === 0 ? (s - n) / t : (n - s) / t)),
  );
}
function gx(e, t, n) {
  const r = e[0].length / 2,
    s = Array.from({ length: r }, (x, E) => {
      const A = e[2 + Jo * r + E];
      return [A[0], A[1]];
    }),
    o = Eh(s),
    { x0: i, x1: a, y0: c, y1: u } = Va(o),
    l = (i + a) / 2,
    d = (c + u) / 2,
    h = Math.max(1e-4, Math.min((a - i) / 2, (u - c) / 2)),
    f = Math.min(t * 0.8, n),
    p = (x) => {
      const E = (x / Jo) * (Math.PI / 2);
      return {
        z: t - f + f * Math.sin(E),
        scale: 1 - (f / h) * (1 - Math.cos(E)),
      };
    },
    m = Array.from({ length: Jo + 1 }, (x, E) => p(E)),
    y = [
      ...m.map(({ z: x, scale: E }) => ({ z: -x, scale: E })).reverse(),
      ...m,
    ].map(({ z: x, scale: E }) =>
      o.map(([A, j]) => [l + (A - l) * E, d + (j - d) * E, x]),
    ),
    { vertices: w, faces: S } = Sh(y, !0),
    v = S.length - 1;
  return {
    kind: "mesh",
    vertices: w,
    faces: S.map((x, E) => ({ corners: x, isBounding: E === 0 || E === v })),
  };
}
function yx(e) {
  const t = new Map();
  for (const [a, c] of e) a > -xl && t.set(c, Math.max(t.get(c) ?? 0, a));
  const n = [],
    r = (a) => n.push(a) - 1,
    s = [...t]
      .sort((a, c) => c[0] - a[0])
      .map(([a, c]) =>
        c <= xl
          ? [r([0, a, 0])]
          : Array.from({ length: gl }, (u, l) => {
              const d = (l / gl) * Gs;
              return r([c * Math.sin(d), a, c * Math.cos(d)]);
            }),
      ),
    o = [s[0], s[s.length - 1]].filter((a) => a.length > 1),
    i = s.slice(1).flatMap((a, c) => Mx(s[c], a));
  return Tx(n, [...o, ...i]);
}
function kx(e, t, n) {
  const r = e.length,
    s = e.map((i, a) => {
      const c = e[(a - 1 + r) % r],
        u = e[(a + 1) % r];
      let l = u[1] - c[1],
        d = -(u[0] - c[0]);
      const h = Math.hypot(l, d) || 1;
      return ((l /= h), (d /= h), l * i[0] + d * i[1] < 0 ? [-l, -d] : [l, d]);
    }),
    o = [];
  return (
    e.forEach(([i, a], c) => {
      for (let u = 0; u <= kl; u++) {
        const l = (u / kl) * (Math.PI / 2),
          d = n * (1 - Math.cos(l)),
          h = t - n + n * Math.sin(l),
          f = i - s[c][0] * d,
          p = a - s[c][1] * d;
        o.push([f, p, h], [f, p, -h]);
      }
    }),
    Mh(o)
  );
}
function wx(e, t) {
  const n = Math.max(...e.map((s) => Math.abs(s[1 - t]))),
    r = Math.max(...e.map((s) => Math.abs(s[t]))) - n;
  return Array.from({ length: bl }, (s, o) => {
    const i = -r + 2 * r * (o / (bl - 1));
    return { center: t === 0 ? [i, 0, 0] : [0, i, 0], radius: n };
  });
}
function bx() {
  const e = 1.1600000000000001,
    t = 0.12,
    n = [
      [0, e - t, 0],
      [0, -e + t, 0],
    ],
    r = 0.54 - t * 0.25,
    s = 0.64 - t;
  for (const i of [-1, 1])
    for (let a = 0; a < 6; a++) {
      const c = (a / 6) * Gs;
      n.push([s * Math.cos(c), i * r, s * Math.sin(c)]);
    }
  const o = [];
  for (const [i, a, c] of n)
    for (let u = 0; u <= 8; u++) {
      const l = (u / 8) * Math.PI,
        d = Math.sin(l),
        h = u === 0 || u === 8 ? 1 : 14;
      for (let f = 0; f < h; f++) {
        const p = (f / h) * Gs;
        o.push([
          i + t * d * Math.sin(p),
          a + t * Math.cos(l),
          c + t * d * Math.cos(p),
        ]);
      }
    }
  return Mh(o);
}
function xx(e, t) {
  const n = Eh(e),
    { x0: r, x1: s, y0: o, y1: i } = Va(n),
    a = (r + s) / 2,
    c = (o + i) / 2,
    u = Array.from({ length: wl + 1 }, (h, f) => {
      const p = -Math.PI / 2 + (Math.PI * f) / wl,
        m = Math.pow(Math.max(0, Math.cos(p)), dx),
        g = t * Math.sin(p);
      return n.map(([y, w]) => [a + (y - a) * m, c + (w - c) * m, g]);
    }),
    { vertices: l, faces: d } = Sh(u, !1);
  return {
    kind: "mesh",
    vertices: l,
    faces: d.map((h) => ({ corners: h, isBounding: !1 })),
  };
}
function vx(e) {
  const t = lr(e).map(([l, d]) => [b + b * l, b - b * d]),
    { x0: n, x1: r, y0: s, y1: o } = Va(t),
    i = (l, d) => {
      let h = !1;
      for (let f = 0, p = t.length - 1; f < t.length; p = f++) {
        const [m, g] = t[f],
          [y, w] = t[p];
        g > d != w > d && l < m + ((y - m) * (d - g)) / (w - g) && (h = !h);
      }
      return h;
    },
    a = Math.max(r - n, o - s) / hx,
    c = [];
  for (let l = s + a / 2; l < o; l += a)
    for (let d = n + a / 2; d < r; d += a) {
      if (!i(d, l)) continue;
      let h = 1 / 0;
      for (const [p, m] of t) h = Math.min(h, (p - d) ** 2 + (m - l) ** 2);
      const f = Math.sqrt(h);
      f > a && c.push({ x: d, y: l, r: f });
    }
  c.sort((l, d) => d.r - l.r);
  const u = [];
  for (const l of c)
    u.some((d) => Math.hypot(l.x - d.x, l.y - d.y) + l.r <= d.r + a * 0.25) ||
      u.push(l);
  return u.map((l) => ({
    center: [(l.x - b) / b, -(l.y - b) / b, 0],
    radius: l.r / b,
  }));
}
function Sx(e) {
  return Array.from({ length: yl }, (t, n) => {
    const r = (n / yl) * Gs,
      s = Math.cos(r),
      o = -Math.sin(r);
    let i = 0;
    return (
      e.forEach((a, c) => {
        const u = e[(c + 1) % e.length],
          l = u[0] - a[0],
          d = u[1] - a[1],
          h = s * d - o * l;
        if (Math.abs(h) < fx) return;
        const f = (a[0] * d - a[1] * l) / h,
          p = (a[0] * o - a[1] * s) / h;
        f > i && p >= -vl && p <= 1 + vl && (i = f);
      }),
      [s * i, o * i]
    );
  });
}
function Sh(e, t) {
  const n = e[0].length,
    r = e.flat(),
    s = [],
    o = (i, a) => i * n + (a % n);
  t && s.push(Array.from({ length: n }, (i, a) => o(0, n - 1 - a)));
  for (let i = 1; i < e.length; i++)
    for (let a = 0; a < n; a++)
      s.push([o(i - 1, a), o(i - 1, a + 1), o(i, a + 1), o(i, a)]);
  return (
    t && s.push(Array.from({ length: n }, (i, a) => o(e.length - 1, a))),
    { vertices: r, faces: s }
  );
}
function Mh(e) {
  return {
    kind: "mesh",
    vertices: e,
    faces: Jw(e).map((t) => ({ corners: t, isBounding: !0 })),
  };
}
function Mx(e, t) {
  return e.length === 1 && t.length === 1
    ? []
    : e.length === 1
      ? t.map((n, r) => [e[0], n, t[(r + 1) % t.length]])
      : t.length === 1
        ? e.map((n, r) => [n, t[0], e[(r + 1) % e.length]])
        : e.map((n, r) => [
            n,
            t[r],
            t[(r + 1) % t.length],
            e[(r + 1) % e.length],
          ]);
}
function Tx(e, t) {
  const n = e.length,
    r = [
      e.reduce((o, i) => o + i[0], 0) / n,
      e.reduce((o, i) => o + i[1], 0) / n,
      e.reduce((o, i) => o + i[2], 0) / n,
    ],
    s = t.map((o) => {
      const [i, a, c] = Th(e, o),
        u = o.reduce(
          (h, f) => [h[0] + e[f][0], h[1] + e[f][1], h[2] + e[f][2]],
          [0, 0, 0],
        ),
        l = o.length;
      return {
        corners:
          i * (u[0] / l - r[0]) +
            a * (u[1] / l - r[1]) +
            c * (u[2] / l - r[2]) <
          0
            ? [...o].reverse()
            : o,
        isBounding: !0,
      };
    });
  return { kind: "mesh", vertices: e, faces: s };
}
function Th(e, t) {
  let n = 0,
    r = 0,
    s = 0;
  for (let o = 0; o < t.length; o++) {
    const i = e[t[o]],
      a = e[t[(o + 1) % t.length]];
    ((n += (i[1] - a[1]) * (i[2] + a[2])),
      (r += (i[2] - a[2]) * (i[0] + a[0])),
      (s += (i[0] - a[0]) * (i[1] + a[1])));
  }
  return [n, r, s];
}
function Eh(e) {
  let t = 0;
  return (
    e.forEach((n, r) => {
      const s = e[(r + 1) % e.length];
      t += n[0] * s[1] - s[0] * n[1];
    }),
    t < 0 ? [...e].reverse() : e
  );
}
function Va(e) {
  let t = 1 / 0,
    n = -1 / 0,
    r = 1 / 0,
    s = -1 / 0;
  for (const [o, i] of e)
    ((t = Math.min(t, o)),
      (n = Math.max(n, o)),
      (r = Math.min(r, i)),
      (s = Math.max(s, i)));
  return { x0: t, x1: n, y0: r, y1: s };
}
function lr(e) {
  return Array.from({ length: e.length / 2 }, (t, n) => [
    e[2 * n],
    e[2 * n + 1],
  ]);
}
const dr = 1024,
  Tl = 2 ** 23,
  Ex = 2 ** 25,
  Ut = 2 ** 26;
class uo {
  xs = [];
  ys = [];
  #e = new Map();
  id(t, n) {
    const r = (t + Tl) * Ex + (n + Tl);
    let s = this.#e.get(r);
    return (
      s == null &&
        ((s = this.xs.length),
        this.xs.push(t),
        this.ys.push(n),
        this.#e.set(r, s)),
      s
    );
  }
}
function Ga(e) {
  let t = "";
  for (const n of e) {
    t += `M${Yt(n[0])} ${Yt(n[1])}`;
    for (let r = 2; r < n.length; r += 2) t += ` ${Yt(n[r])} ${Yt(n[r + 1])}`;
    t += "Z";
  }
  return t;
}
function Px(e) {
  const t = Ix(e),
    n = Ax(t);
  return Ox(Rx(_x(t.flatMap((r) => $x(r, n)))));
}
function Ix(e) {
  const t = new uo(),
    n = new Map(),
    r = [],
    s = [],
    o = (c) => {
      const u = Nx(c);
      if (u === 0) return;
      const l = c.length / 2;
      s.length = 0;
      for (let d = 0; d < l; d++) {
        const h = u > 0 ? d : l - 1 - d;
        s.push(t.id(c[2 * h], c[2 * h + 1]));
      }
      for (let d = 0; d < l; d++) {
        const h = s[d],
          f = s[(d + 1) % l];
        if (h === f) continue;
        const p = f * Ut + h,
          m = n.get(p) ?? 0;
        m > 1
          ? n.set(p, m - 1)
          : m === 1
            ? n.delete(p)
            : n.set(h * Ut + f, (n.get(h * Ut + f) ?? 0) + 1);
      }
    };
  for (const c of e) {
    r.length = c.length;
    for (let l = 0; l < c.length; l++) r[l] = Math.round(c[l] * dr);
    const u = r.length === 8 ? Lx(r) : null;
    if (u == null) o(r);
    else for (const l of u) o(l);
  }
  const { xs: i, ys: a } = t;
  return [...n].map(([c, u]) => {
    const l = Math.floor(c / Ut),
      d = c - l * Ut;
    return { ax: i[l], ay: a[l], bx: i[d], by: a[d], count: u };
  });
}
function Ax(e) {
  const t = new uo();
  for (const o of e) (t.id(o.ax, o.ay), t.id(o.bx, o.by));
  const n = e.map((o, i) => i).sort((o, i) => ei(e[o]) - ei(e[i]));
  n.forEach((o, i) => {
    const a = e[o],
      c = Math.max(a.ax, a.bx);
    for (let u = i + 1; u < n.length; u++) {
      const l = e[n[u]];
      if (ei(l) > c) break;
      if (
        Math.min(l.ay, l.by) > Math.max(a.ay, a.by) ||
        Math.max(l.ay, l.by) < Math.min(a.ay, a.by)
      )
        continue;
      const d = Math.sign(lt(a.ax, a.ay, a.bx, a.by, l.ax, l.ay)),
        h = Math.sign(lt(a.ax, a.ay, a.bx, a.by, l.bx, l.by)),
        f = lt(l.ax, l.ay, l.bx, l.by, a.ax, a.ay),
        p = lt(l.ax, l.ay, l.bx, l.by, a.bx, a.by);
      if (d * h >= 0 || Math.sign(f) * Math.sign(p) >= 0) continue;
      const m = f / (f - p);
      t.id(
        Math.round(a.ax + (a.bx - a.ax) * m),
        Math.round(a.ay + (a.by - a.ay) * m),
      );
    }
  });
  const { xs: r, ys: s } = t;
  return r.map((o, i) => ({ x: o, y: s[i] })).sort((o, i) => o.x - i.x);
}
function $x(e, t) {
  const n = e.bx - e.ax,
    r = e.by - e.ay,
    s = Math.abs(n) + Math.abs(r),
    o = Math.min(e.ay, e.by) - 0.5,
    i = Math.max(e.ay, e.by) + 0.5,
    a = Math.max(e.ax, e.bx) + 0.5,
    c = [];
  for (
    let l = Cx(t, Math.min(e.ax, e.bx) - 0.5);
    l < t.length && t[l].x <= a;
    l++
  ) {
    const { x: d, y: h } = t[l];
    h < o ||
      h > i ||
      2 * Math.abs(lt(e.ax, e.ay, e.bx, e.by, d, h)) > s ||
      c.push({
        t: ((d - e.ax) * n + (h - e.ay) * r) / (n * n + r * r),
        x: d,
        y: h,
      });
  }
  c.sort((l, d) => l.t - d.t);
  const u = [];
  for (let l = 1; l < c.length; l++) {
    const d = c[l - 1],
      h = c[l];
    (d.x !== h.x || d.y !== h.y) &&
      u.push({ ax: d.x, ay: d.y, bx: h.x, by: h.y, count: e.count });
  }
  return u;
}
function Cx(e, t) {
  let n = 0,
    r = e.length;
  for (; n < r;) {
    const s = (n + r) >> 1;
    e[s].x < t ? (n = s + 1) : (r = s);
  }
  return n;
}
function _x(e) {
  const t = new uo(),
    n = new Map();
  for (const i of e) {
    const a = t.id(i.ax, i.ay),
      c = t.id(i.bx, i.by),
      u = Math.min(a, c) * Ut + Math.max(a, c);
    n.set(u, (n.get(u) ?? 0) + (a < c ? i.count : -i.count));
  }
  const { xs: r, ys: s } = t,
    o = [];
  for (const [i, a] of n) {
    if (a === 0) continue;
    const c = Math.floor(i / Ut),
      u = i - c * Ut;
    o.push({ ax: r[c], ay: s[c], bx: r[u], by: s[u], count: a });
  }
  return o;
}
function Rx(e) {
  const t = [];
  for (const n of e) {
    const r = n.ax + n.bx,
      s = n.ay + n.by;
    let o = 0;
    for (const u of e) {
      if (u === n) continue;
      const l = 2 * u.ay,
        d = 2 * u.by;
      l <= s
        ? d > s && lt(2 * u.ax, l, 2 * u.bx, d, r, s) > 0 && (o += u.count)
        : d <= s && lt(2 * u.ax, l, 2 * u.bx, d, r, s) < 0 && (o -= u.count);
    }
    const a = n.ay < n.by || (n.ay === n.by && n.ax > n.bx) ? o + n.count : o,
      c = a - n.count;
    (a !== 0) != (c !== 0) &&
      t.push(
        a !== 0
          ? { ...n, count: 1 }
          : { ax: n.bx, ay: n.by, bx: n.ax, by: n.ay, count: 1 },
      );
  }
  return t;
}
function Ox(e) {
  const t = new uo(),
    n = [];
  for (const i of e) {
    const a = t.id(i.ax, i.ay),
      c = t.id(i.bx, i.by);
    for (; n.length <= Math.max(a, c);) n.push([]);
    for (let u = 0; u < Math.abs(i.count); u++)
      i.count > 0 ? n[a].push(c) : n[c].push(a);
  }
  const { xs: r, ys: s } = t;
  let o = "";
  return (
    n.forEach((i, a) => {
      for (; i.length > 0;) {
        o += `M${Yt(r[a] / dr)} ${Yt(s[a] / dr)}`;
        let c = i.pop();
        for (; c != null && c !== a;)
          ((o += ` ${Yt(r[c] / dr)} ${Yt(s[c] / dr)}`), (c = n[c].pop()));
        o += "Z";
      }
    }),
    o
  );
}
function Lx(e) {
  const [t, n, r, s, o, i, a, c] = e,
    u = El(t, n, r, s, o, i, a, c);
  if (u != null)
    return [
      [t, n, u[0], u[1], a, c],
      [u[0], u[1], r, s, o, i],
    ];
  const l = El(r, s, o, i, a, c, t, n);
  return l != null
    ? [
        [r, s, l[0], l[1], t, n],
        [l[0], l[1], o, i, a, c],
      ]
    : null;
}
function El(e, t, n, r, s, o, i, a) {
  const c = Math.sign(lt(e, t, n, r, s, o)),
    u = Math.sign(lt(e, t, n, r, i, a)),
    l = lt(s, o, i, a, e, t),
    d = lt(s, o, i, a, n, r);
  if (!(c * u < 0 && Math.sign(l) * Math.sign(d) < 0)) return null;
  const h = l / (l - d);
  return [Math.round(e + (n - e) * h), Math.round(t + (r - t) * h)];
}
function lt(e, t, n, r, s, o) {
  return (n - e) * (o - t) - (r - t) * (s - e);
}
function Nx(e) {
  let t = 0;
  for (let n = 0; n < e.length; n += 2) {
    const r = (n + 2) % e.length;
    t += e[n] * e[r + 1] - e[r] * e[n + 1];
  }
  return t;
}
function ei(e) {
  return Math.min(e.ax, e.bx);
}
function Yt(e) {
  return String(Math.round(e * 100) / 100);
}
const Pl = Math.PI / 6,
  Fx = 1.17,
  ti = -1.24,
  ni = 0.79,
  rr = 3.24,
  sr = 48,
  Zr = 160,
  jx = 0.001,
  Ws = 0.18,
  nt = Wx([-0.5, 0.6, 0.62]),
  zx = [
    ...[0, 1, 2, 3, 4, 5].map((e) => {
      const t = e * Pl;
      return {
        center: [0, 0, 0],
        a: [Math.sin(t), 0, Math.cos(t)],
        b: [0, 1, 0],
        isEquator: !1,
      };
    }),
    ...[-2, -1, 0, 1, 2].map((e) => {
      const t = e * Pl,
        n = Math.cos(t);
      return {
        center: [0, Math.sin(t), 0],
        a: [0, 0, n],
        b: [n, 0, 0],
        isEquator: e === 0,
      };
    }),
  ];
let Qr = null;
function Dx(e, t) {
  const n = wt(t, e.center),
    r = wt(t, e.a),
    s = wt(t, e.b),
    o = Math.hypot(r[2], s[2]);
  let i = 0,
    a = 2 * Math.PI;
  if (o > Math.abs(n[2])) {
    const c = Math.atan2(s[2], r[2]),
      u = Math.acos(-n[2] / o);
    ((i = c - u), (a = c + u));
  } else if (n[2] <= 0) return null;
  return {
    center: [n[0], n[1]],
    a: [r[0], r[1]],
    b: [s[0], s[1]],
    from: i,
    to: a,
  };
}
function qx(e, t) {
  const n = Math.sqrt(Math.max(0, 1 - e * e - t * t)),
    r = nt[0] * e + nt[1] * t + nt[2] * n;
  return Ws + (1 - Ws) * Math.max(0, r);
}
function Bx() {
  if (Qr !== null) return Qr;
  const e = Math.hypot(nt[0], nt[1]),
    t = [nt[0] / e, nt[1] / e],
    n = {
      origin: [ti * nt[0], ti * nt[1]],
      axisX: [ni * rr * t[0], ni * rr * t[1]],
      axisY: [-rr * t[1], rr * t[0]],
      focus: ((Fx - ti) * e) / (ni * rr),
    };
  return ((Qr = { ...n, stops: Vx(n) }), Qr);
}
function Hx(e, t, n) {
  const r = t - e.origin[0],
    s = n - e.origin[1],
    o = (r * e.axisX[0] + s * e.axisX[1]) / (e.axisX[0] ** 2 + e.axisX[1] ** 2),
    i = (r * e.axisY[0] + s * e.axisY[1]) / (e.axisY[0] ** 2 + e.axisY[1] ** 2),
    a = e.focus,
    c = a * a - 1,
    u = 2 * a * (o - a),
    l = (o - a) ** 2 + i * i;
  return (-u - Math.sqrt(u * u - 4 * c * l)) / (2 * c);
}
function Vx(e) {
  const t = sr + 1,
    n = new Float64Array(t),
    r = new Float64Array(t),
    s = new Float64Array(t);
  let o = 0;
  for (let c = 0; c < Zr; c++)
    for (let u = 0; u < Zr; u++) {
      const l = ((c + 0.5) / Zr) * 2 - 1,
        d = ((u + 0.5) / Zr) * 2 - 1;
      if (l * l + d * d >= 1) continue;
      const h = Math.min(1, Hx(e, l, d)) * sr,
        f = Math.min(sr - 1, Math.floor(h)),
        p = h - f,
        m = qx(l, d);
      ((n[f] += (1 - p) ** 2),
        (n[f + 1] += p * p),
        (r[f] += (1 - p) * p),
        (s[f] += (1 - p) * m),
        (s[f + 1] += p * m),
        o++);
    }
  const i = (jx * o) / t;
  for (let c = 0; c < sr; c++) ((n[c] += i), (n[c + 1] += i), (r[c] -= i));
  const a = Gx(n, r, s);
  return Array.from(a, (c, u) => ({ offset: u / sr, shade: c }));
}
function Gx(e, t, n) {
  const r = e.length,
    s = new Float64Array(r),
    o = new Float64Array(r);
  ((s[0] = t[0] / e[0]), (o[0] = n[0] / e[0]));
  for (let a = 1; a < r; a++) {
    const c = e[a] - t[a - 1] * s[a - 1];
    ((s[a] = t[a] / c), (o[a] = (n[a] - t[a - 1] * o[a - 1]) / c));
  }
  const i = new Float64Array(r);
  i[r - 1] = o[r - 1];
  for (let a = r - 2; a >= 0; a--) i[a] = o[a] - s[a] * i[a + 1];
  return i;
}
function Wx(e) {
  const t = Math.hypot(e[0], e[1], e[2]);
  return [e[0] / t, e[1] / t, e[2] / t];
}
const Ux = 0.4,
  Kx = 1e-9,
  Jr = 6,
  gs = 24,
  Vi = 0.004,
  _n = Math.PI / 180;
function Xx(e, t, n, r) {
  const s = px(e),
    o = Yx(t),
    i = Ha(co(e), n),
    a = n / 2,
    c = r.map((h) => h + (1 - h) * Ux),
    u = (h) => {
      const f = h[0] * nt[0] + h[1] * nt[1] + h[2] * nt[2],
        p = Ws + (1 - Ws) * Math.max(0, f);
      return nv(c.map((m) => m * p));
    },
    l = (h) => [a + i * h[0], a - i * h[1]],
    d = s.kind === "mesh" ? Zx(s, o, l, u) : Qx(s.balls, o, l, i, u);
  return { baseFill: u([0, 0, 1]), faces: d };
}
function Yx(e) {
  const [t, n] = [Math.cos(e.yaw * _n), Math.sin(e.yaw * _n)],
    [r, s] = [Math.cos(e.pitch * _n), Math.sin(e.pitch * _n)],
    [o, i] = [Math.cos(e.roll * _n), Math.sin(e.roll * _n)];
  return ([a, c, u]) => {
    const l = a * t + u * n,
      d = u * t - a * n,
      h = c * r - d * s,
      f = c * s + d * r;
    return [l * o - h * i, l * i + h * o, f];
  };
}
function Zx(e, t, n, r) {
  const s = e.vertices.map(t),
    o = [],
    i = new Map();
  for (const a of e.faces) {
    const [c, u, l] = Th(s, a.corners),
      d = Math.hypot(c, u, l);
    if (d === 0 || l <= Kx * d) continue;
    const h = r([c / d, u / d, l / d]),
      f = a.corners.flatMap((m) => n(s[m]));
    if (a.isBounding) {
      Ph(i, h, f);
      continue;
    }
    const p = a.corners.reduce((m, g) => m + s[g][2], 0) / a.corners.length;
    o.push({ polygon: f, fill: h, depth: p });
  }
  return (
    o.sort((a, c) => a.depth - c.depth),
    [...Jx(o), ...[...i].map(([a, c]) => Wa(c, a))]
  );
}
function Qx(e, t, n, r, s) {
  const o = e.map((c) => ({ center: t(c.center), radius: c.radius })),
    i = o
      .map((c, u) => u)
      .sort(
        (c, u) => o[c].center[2] + o[c].radius - (o[u].center[2] + o[u].radius),
      ),
    a = Vi / r;
  return i.flatMap((c) => {
    const { center: u, radius: l } = o[c],
      d = o.filter((g, y) => y !== c && o[y].radius > a),
      h = (g) =>
        d.some((y) => g.every((w) => tv(w, y.center) < (y.radius - a) ** 2)),
      f = (g, y) => [
        u[0] + l * Math.sin(g) * Math.cos(y),
        u[1] + l * Math.sin(g) * Math.sin(y),
        u[2] + l * Math.cos(g),
      ],
      p = ev(l * r),
      m = new Map();
    for (let g = 0; g < Jr; g++) {
      const y = (g / Jr) * (Math.PI / 2),
        w = ((g + 1) / Jr) * (Math.PI / 2),
        S = g === Jr - 1 ? p : 1;
      for (let v = 0; v < gs; v++) {
        const x = (v / gs) * 2 * Math.PI,
          E = ((v + 1) / gs) * 2 * Math.PI,
          A = [
            ...(g === 0 ? [f(0, 0)] : [f(y, x)]),
            ...Array.from({ length: S + 1 }, (L, T) =>
              f(w, x + ((E - x) * T) / S),
            ),
            ...(g === 0 ? [] : [f(y, E)]),
          ];
        if (h(A)) continue;
        const j = (y + w) / 2,
          F = (x + E) / 2,
          O = s([
            Math.sin(j) * Math.cos(F),
            Math.sin(j) * Math.sin(F),
            Math.cos(j),
          ]);
        Ph(m, O, A.flatMap(n));
      }
    }
    return [...m].map(([g, y]) => Wa(y, g));
  });
}
function Jx(e) {
  const t = [];
  let n = 0;
  for (let r = 1; r <= e.length; r++)
    (r < e.length && e[r].fill === e[n].fill) ||
      (t.push(
        Wa(
          e.slice(n, r).map((s) => s.polygon),
          e[n].fill,
        ),
      ),
      (n = r));
  return t;
}
function Ph(e, t, n) {
  const r = e.get(t);
  r == null ? e.set(t, [n]) : r.push(n);
}
function Wa(e, t) {
  return { d: Ga(e), fill: t };
}
function ev(e) {
  if (e <= Vi) return 1;
  const t = 2 * Math.acos(1 - Vi / e);
  return Math.max(1, Math.ceil((2 * Math.PI) / gs / t));
}
function tv(e, t) {
  return (e[0] - t[0]) ** 2 + (e[1] - t[1]) ** 2 + (e[2] - t[2]) ** 2;
}
function nv(e) {
  const t = (n) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${e.map(t).join("")}`;
}
const Ih = 144,
  Ah = 184 / 256,
  ys = 180 / Math.PI,
  rv = 16e6,
  sv = 0.6,
  Rn = new Map();
let ri = 0;
function ov(e, t, n, r = {}) {
  const s = Math.max(8, Math.round((n * e.zoom) / Ah)),
    o = Math.max(s, Ih),
    i = $h(e.quat, Ch(n, e.zoom)),
    { body: a, eyes: c } = _h(e.body, i, o, e.eyes, e.inspect),
    [u, l, d, h] = Rh(e, n, s, o),
    f = `matrix(${ts(u)} 0 0 ${ts(l)} ${ts(d)} ${ts(h)})`,
    p = r.isProof === !0 ? Xx(e.body, i, o, t.ink) : null;
  if (e.glow != null) {
    const y = lv(e.glow, o);
    return {
      size: n,
      sprite: o,
      transform: f,
      body: a,
      bodyFill: y,
      eyes: [],
      eyeFill: null,
      proof: p,
    };
  }
  const m = t.cutout ? null : Fa(t),
    g = e.eyes == null ? [] : c;
  return {
    size: n,
    sprite: o,
    transform: f,
    body: a,
    bodyFill: Na(t),
    eyes: g,
    eyeFill: m,
    proof: p,
  };
}
function iv(e, t) {
  const n = Math.max(8, Math.round((t * e.zoom) / Ah)),
    r = Math.max(n, Ih),
    s = $h(e.quat, Ch(t, e.zoom)),
    { body: o, eyes: i } = _h(e.body, s, r, e.eyes, e.inspect),
    [a, c, u, l] = Rh(e, t, n, r),
    d = ([h, f]) => [a * h + u, c * f + l];
  return {
    center: [(a * r) / 2 + u, (c * r) / 2 + l],
    radius: (e.zoom * t) / 2,
    body: o.flatMap($l).map((h) => h.map(d)),
    eyes: e.eyes == null ? [] : i.flatMap($l).map((h) => h.map(d)),
  };
}
function av(e, t, n = e.size) {
  const r = e.sprite,
    s = `${t}-body`,
    o = `maskUnits="userSpaceOnUse" x="0" y="0" width="${r}" height="${r}"`,
    i = (h) => e.eyes.map((f) => `<path d="${f}" fill="${h}"/>`).join(""),
    a = e.body.map((h) => `<path d="${h}"/>`).join("");
  let c = `<g id="${s}">${a}</g>`,
    u = "",
    l = "";
  e.eyes.length > 0 && e.eyeFill == null
    ? ((c += `<mask id="${t}-holes" ${o}><rect width="${r}" height="${r}" fill="#fff"/>${i("#000")}</mask>`),
      (u = ` mask="url(#${t}-holes)"`))
    : e.eyes.length > 0 &&
      e.eyeFill != null &&
      ((c += `<mask id="${t}-inside" ${o}><use href="#${s}" fill="#fff"/></mask>`),
      (l = `<g mask="url(#${t}-inside)">${i(e.eyeFill)}</g>`));
  let d = "";
  if (e.proof != null) {
    c += `<clipPath id="${t}-solid">${a}</clipPath>`;
    const h = e.proof.faces
      .map((f) => `<path d="${f.d}" fill="${f.fill}"/>`)
      .join("");
    d = `<g clip-path="url(#${t}-solid)"${u}><use href="#${s}" fill="${e.proof.baseFill}"/>${h}</g>`;
  } else if (typeof e.bodyFill == "string")
    d = `<use href="#${s}" fill="${e.bodyFill}"${u}/>`;
  else {
    const { cx: h, cy: f, r: p, stops: m } = e.bodyFill,
      g = m
        .map((y) => `<stop offset="${y.offset}" stop-color="${y.color}"/>`)
        .join("");
    ((c += `<radialGradient id="${t}-glow" gradientUnits="userSpaceOnUse" cx="${h}" cy="${f}" r="${p}">${g}</radialGradient>`),
      (d = `<use href="#${s}" fill="url(#${t}-glow)"${u}/>`));
  }
  return `${ja(e.size, t, n)}<defs>${c}</defs><g transform="${e.transform}">${d}${l}</g></svg>`;
}
function $h(e, t = 0) {
  const n = Xn(e),
    [r, s, o] = Q1(
      n[8] >= 0
        ? n
        : [-n[0], n[1], -n[2], -n[3], n[4], -n[5], -n[6], n[7], -n[8]],
    ),
    i = (a) => (t > 0 ? Math.round(a / t) * t : a);
  return { yaw: Il(i(s * ys)), pitch: Il(i(r * ys)), roll: i(o * ys) };
}
function Ch(e, t) {
  const n = (sv / Math.max((e * t) / 2, 1)) * ys;
  return 2 ** Math.floor(Math.log2(n));
}
function Il(e) {
  const t = ((e % 180) + 180) % 180;
  return Math.abs(t - 90) >= 0.5 ? e : e + (t <= 90 ? 89.5 - t : 90.5 - t);
}
function _h(e, t, n, r, s) {
  const o = r == null ? [] : Qb(co(e), t, n, Vw(e, r, t.yaw, s));
  return { body: cv(e, t, n), eyes: o.map((i) => Ga([i])) };
}
function cv(e, t, n) {
  const r = `${e} ${n} ${t.yaw} ${t.pitch} ${t.roll}`,
    s = Rn.get(r);
  if (s != null) return (Rn.delete(r), Rn.set(r, s), s);
  const o = uv(bh(co(e), t, n));
  (Rn.set(r, o), (ri += Al(o)));
  for (const [i, a] of Rn) {
    if (ri <= rv) break;
    (Rn.delete(i), (ri -= Al(a)));
  }
  return o;
}
function Al(e) {
  return e.reduce((t, n) => t + n.length, 0);
}
function uv(e) {
  if (e.length === 1) return [Ga(e)];
  const t = Px(e);
  return t === "" ? [] : [t];
}
function Rh(e, t, n, r) {
  const s = t / 2,
    o = s + e.offset[0] * e.zoom * s,
    i = s - e.offset[1] * e.zoom * s,
    a = i - e.squashAnchor * e.zoom * s,
    [c, u] = e.squash,
    l = n / r;
  return [c * l, u * l, o - (c * n) / 2, a + u * (i - n / 2 - a)];
}
function $l(e) {
  const t = [];
  for (const n of e.split("Z")) {
    const r = n
      .replace("M", " ")
      .trim()
      .split(/\s+/)
      .filter((o) => o !== "")
      .map(Number);
    if (r.length < 6) continue;
    const s = [];
    for (let o = 0; o + 1 < r.length; o += 2) s.push([r[o], r[o + 1]]);
    t.push(s);
  }
  return t;
}
function lv(e, t) {
  const n = t / 2;
  return {
    cx: n,
    cy: n,
    r: n,
    stops: [
      { offset: 0, color: es(e.inner) },
      { offset: 0.42 + e.midT * 0.16, color: es(e.mid) },
      { offset: 0.93, color: es(e.rim) },
      { offset: 1, color: es(e.rim) },
    ],
  };
}
function es(e) {
  return `rgb(${Math.round(e[0] * 255)}, ${Math.round(e[1] * 255)}, ${Math.round(e[2] * 255)})`;
}
function ts(e) {
  return Math.round(e * 1e6) / 1e6;
}

/* ---- Geometry: outline utils, arc/line clipping, cutout (original lines 7707-8156) ---- */
const rt = Math.PI * 2,
  Cl = 1e-9,
  dv = 1e-7,
  hv = 1e-7,
  Vt = 720;
function fv(e) {
  return Array.from({ length: e }, (t, n) => (n / e) * rt);
}
function pv(e, t) {
  return e.flatMap((n) => n.map(([r, s]) => Us(t, r, s)));
}
function mv(e) {
  const t = e.flat().sort((n, r) => n - r);
  return t.filter((n, r) => r === 0 || n - t[r - 1] > dv);
}
function gv(e, t, n) {
  const r = Ev(e, t),
    s = Iv(n.map((o) => Pv(r, t, o)));
  return n.map((o, i) => [
    t[0] + Math.cos(o) * s[i],
    t[1] + Math.sin(o) * s[i],
  ]);
}
function yv(e, t, n) {
  const [r, s] = t;
  return Array.from({ length: n }, (o, i) => {
    const a = (i / n) * rt,
      c = Math.cos(a),
      u = Math.sin(a),
      l = r === 0 || s === 0 ? 0 : 1 / Math.hypot(c / r, u / s);
    return [e[0] + c * l, e[1] + u * l];
  });
}
function kv(e, t, n) {
  const r = e
    .map(([s, o]) => ({
      angle: Us(t, s, o),
      reach: Math.hypot(s - t[0], o - t[1]),
    }))
    .sort((s, o) => s.angle - o.angle);
  return n.map((s) => {
    const o = Av(r, s);
    return [t[0] + Math.cos(s) * o, t[1] + Math.sin(s) * o];
  });
}
function wv(e) {
  const t = Tv(e) < 0 ? [...e].reverse() : e,
    n = $v(t, Lh(t)),
    r =
      n == null
        ? t
        : [n.point, ...t.slice(n.edge + 1), ...t.slice(0, n.edge + 1)],
    s = [0];
  for (let i = 0; i < r.length; i++) {
    const [a, c] = r[i],
      [u, l] = r[(i + 1) % r.length];
    s.push(s[i] + Math.hypot(u - a, l - c));
  }
  const o = s[r.length] ?? 0;
  return { points: r, stations: s.map((i) => (o === 0 ? 0 : i / o)) };
}
function bv({ points: e, stations: t }, n) {
  if (e.length === 0) return [];
  let r = 0;
  return n.map((s) => {
    for (; r < e.length - 1 && t[r + 1] < s;) r++;
    const [o, i] = e[r],
      [a, c] = e[(r + 1) % e.length],
      u = t[r + 1] - t[r],
      l = u === 0 ? 0 : (s - t[r]) / u;
    return [o + (a - o) * l, i + (c - i) * l];
  });
}
function xv(e) {
  return Array.from({ length: e }, (t, n) => n / e);
}
function vv(e) {
  const t = e
    .flat()
    .filter((n) => n < 1)
    .sort((n, r) => n - r);
  return t.filter((n, r) => r === 0 || n - t[r - 1] > hv);
}
function Oh(e) {
  const t = e.reduce((r, s) => r + s.weight, 0),
    [n] = e;
  return n == null || t === 0
    ? []
    : n.outline.map((r, s) => {
        let o = 0,
          i = 0;
        for (const { outline: a, weight: c } of e)
          ((o += a[s][0] * c), (i += a[s][1] * c));
        return [o / t, i / t];
      });
}
function Sv(e, t, n) {
  return e.map(([r, s], o) => [r + (t[o][0] - r) * n, s + (t[o][1] - s) * n]);
}
function Mv(e, t) {
  return Array.from({ length: t }, () => [e[0], e[1]]);
}
function Lh(e) {
  if (e.length === 0) return [0, 0];
  let t = 0,
    n = 0;
  for (const [r, s] of e) ((t += r), (n += s));
  return [t / e.length, n / e.length];
}
function Gi(e) {
  return e.length === 0
    ? ""
    : `M${e.map(([t, n]) => `${_l(t)} ${_l(n)}`).join("L")}Z`;
}
function Tv(e) {
  let t = 0;
  for (let n = 0; n < e.length; n++) {
    const [r, s] = e[n],
      [o, i] = e[(n + 1) % e.length];
    t += r * i - o * s;
  }
  return t / 2;
}
function Ev(e, t) {
  const n = Array.from({ length: Vt }, () => []);
  for (const r of e)
    for (let s = 0; s < r.length; s++) {
      const o = r[s],
        i = r[(s + 1) % r.length],
        a = Us(t, o[0], o[1]);
      let c = Us(t, i[0], i[1]) - a;
      (c > Math.PI && (c -= rt), c < -Math.PI && (c += rt));
      const u = Math.floor(((c < 0 ? a + c : a) / rt) * Vt) - 1,
        l = Math.floor(((c < 0 ? a : a + c) / rt) * Vt) + 1;
      for (let d = u; d <= l; d++) n[((d % Vt) + Vt) % Vt].push([o, i]);
    }
  return n;
}
function Pv(e, [t, n], r) {
  const s = Math.cos(r),
    o = Math.sin(r);
  let i = Number.NaN;
  for (const [[a, c], [u, l]] of e[Math.floor((r / rt) * Vt) % Vt]) {
    const d = u - a,
      h = l - c,
      f = s * h - o * d;
    if (Math.abs(f) < 1e-12) continue;
    const p = a - t,
      m = c - n,
      g = (p * h - m * d) / f,
      y = (p * o - m * s) / f;
    g >= 0 && y >= -Cl && y <= 1 + Cl && !(g <= i) && (i = g);
  }
  return i;
}
function Us(e, t, n) {
  const r = Math.atan2(n - e[1], t - e[0]);
  return r < 0 ? r + rt : r;
}
function Iv(e) {
  const t = e.length,
    n = e.flatMap((r, s) => (Number.isNaN(r) ? [] : [s]));
  return n.length === 0
    ? e.map(() => 0)
    : e.map((r, s) => {
        if (!Number.isNaN(r)) return r;
        const o = n.find((c) => c > s) ?? n[0] + t,
          i = [...n].reverse().find((c) => c < s) ?? (n.at(-1) ?? 0) - t,
          a = (s - i) / (o - i);
        return e[(i + t) % t] * (1 - a) + e[o % t] * a;
      });
}
function Av(e, t) {
  const n = e.length;
  if (n === 0) return 0;
  let r = e.findIndex((c) => c.angle >= t);
  r < 0 && (r = 0);
  const s = e[r],
    o = e[(r - 1 + n) % n],
    i = (s.angle - o.angle + rt) % rt;
  if (i === 0) return s.reach;
  const a = ((t - o.angle + rt) % rt) / i;
  return o.reach + (s.reach - o.reach) * a;
}
function $v(e, [t, n]) {
  let r = null;
  for (let s = 0; s < e.length; s++) {
    const [o, i] = e[s],
      [a, c] = e[(s + 1) % e.length];
    if (i === c || (i - n) * (c - n) > 0) continue;
    const u = o + ((n - i) / (c - i)) * (a - o);
    u >= t && (r == null || u > r.point[0]) && (r = { edge: s, point: [u, n] });
  }
  return r;
}
function _l(e) {
  return String(Math.round(e * 100) / 100);
}
const Cv = [1, 1];
function _v(e, t) {
  const n = e.length;
  let r = -1;
  for (let a = 0; a < n && r < 0; a++)
    e[a][2] <= 0 && e[(a + 1) % n][2] > 0 && (r = a);
  if (r < 0)
    return n === 0 || e[0][2] <= 0
      ? null
      : e.map(([a, c]) => ({ kind: "line", to: [a, c] }));
  const s = [];
  let o = [1, 0],
    i = null;
  for (let a = 0; a < n; a++) {
    const c = e[(r + a) % n],
      u = e[(r + a + 1) % n],
      l = c[2] > 0,
      d = u[2] > 0;
    if (l && d) s.push({ kind: "line", to: [u[0], u[1]] });
    else if (l) ((i = Rl(c, u)), s.push({ kind: "line", to: i }));
    else if (d) {
      const h = Rl(c, u);
      (i === null ? (o = h) : s.push(Ol(i, h, t)),
        s.push({ kind: "line", to: [u[0], u[1]] }));
    }
  }
  return (i !== null && s.push(Ol(i, o, t)), s);
}
function Rv(e, t) {
  const n = Lv(e, t),
    r = n.length;
  if (n.every((c) => c.isInside)) return e;
  let s = -1;
  for (let c = 0; c < r && s < 0; c++)
    n[c].isInside && !n[(c + r - 1) % r].isInside && (s = c);
  if (s < 0) {
    const c = n.reduce((u, l) => u + l.sweep, 0);
    return Math.abs(c) > Math.PI ? Tr(t, Math.sign(c)) : null;
  }
  const o = [];
  let i = null,
    a = 0;
  for (let c = 0; c < r; c++) {
    const u = n[(s + c) % r];
    u.isInside
      ? (i !== null && o.push({ kind: "arc", to: u.from, radii: t, sweep: a }),
        (i = null),
        o.push(u.segment))
      : (i === null && ((i = u.from), (a = 0)), (a += u.sweep));
  }
  return (
    i !== null && o.push({ kind: "arc", to: n[s].from, radii: t, sweep: a }),
    o
  );
}
function Ov(e, t) {
  const n = (a) =>
      a.kind === "arc" && a.radii[0] === e[0] && a.radii[1] === e[1],
    r = [],
    s = [],
    o = [],
    i = [];
  for (const a of t) {
    const c = a.findIndex(n);
    if (c < 0) {
      r.push(a);
      continue;
    }
    let u = a[c].to,
      l = [],
      d = u;
    for (let h = 1; h <= a.length; h++) {
      const f = a[(c + h) % a.length];
      (n(f)
        ? (o.push({ from: d, sweep: f.sweep }),
          i.push(d, f.to),
          l.length > 0 && s.push(jv(u, l)),
          (l = []),
          (u = f.to))
        : l.push(f),
        (d = f.to));
    }
  }
  return o.length === 0
    ? [Tr(e, 1), ...r]
    : [...qv([...s, ...zv(e, o, i)]), ...r];
}
function Tr(e, t) {
  return [
    { kind: "arc", to: [-e[0], 0], radii: e, sweep: t * Math.PI },
    { kind: "arc", to: [e[0], 0], radii: e, sweep: t * Math.PI },
  ];
}
function Nh(e, t) {
  const n = Math.cos(t),
    r = Math.sin(t),
    s = 1 / Math.sqrt((n * n) / (e[0] * e[0]) + (r * r) / (e[1] * e[1]));
  return [s * n, s * r];
}
function Rl(e, t) {
  const n = e[2] / (e[2] - t[2]),
    r = e[0] + (t[0] - e[0]) * n,
    s = e[1] + (t[1] - e[1]) * n,
    o = Math.sqrt(r * r + s * s);
  return [r / o, s / o];
}
function Ol(e, t, n) {
  const r = Nl(Math.atan2(t[1], t[0]) - n) - Nl(Math.atan2(e[1], e[0]) - n);
  return { kind: "arc", to: t, radii: Cv, sweep: r };
}
function Lv(e, t) {
  const n = 1 / (t[0] * t[0]),
    r = 1 / (t[1] * t[1]),
    s = (a) => n * a[0] * a[0] + r * a[1] * a[1] - 1,
    o = [];
  let i = e[e.length - 1].to;
  for (const a of e) {
    if (a.kind === "line") {
      const c = Nv(i, a.to, n, r);
      let u = i;
      for (let l = 0; l <= c.length; l++) {
        const d = l === 0 ? 0 : c[l - 1],
          h = l === c.length ? 1 : c[l],
          f = l === c.length ? a.to : Ll(i, a.to, h);
        (o.push({
          from: u,
          segment: { kind: "line", to: f },
          sweep: Math.atan2(
            u[0] * f[1] - u[1] * f[0],
            u[0] * f[0] + u[1] * f[1],
          ),
          isInside: s(Ll(i, a.to, (d + h) / 2)) < 0,
        }),
          (u = f));
      }
    } else {
      const c = a.radii[0],
        u = Math.atan2(i[1], i[0]),
        l = Fv(c, u, a.sweep, n, r);
      let d = i;
      for (let h = 0; h <= l.length; h++) {
        const f = h === 0 ? 0 : l[h - 1],
          p = h === l.length ? 1 : l[h],
          m = u + a.sweep * p,
          g = h === l.length ? a.to : [c * Math.cos(m), c * Math.sin(m)],
          y = u + (a.sweep * (f + p)) / 2,
          w = a.sweep * (p - f);
        (o.push({
          from: d,
          segment: { kind: "arc", to: g, radii: a.radii, sweep: w },
          sweep: w,
          isInside: s([c * Math.cos(y), c * Math.sin(y)]) < 0,
        }),
          (d = g));
      }
    }
    i = a.to;
  }
  return o;
}
function Nv(e, t, n, r) {
  const s = t[0] - e[0],
    o = t[1] - e[1],
    i = n * s * s + r * o * o,
    a = n * e[0] * s + r * e[1] * o,
    c = n * e[0] * e[0] + r * e[1] * e[1] - 1,
    u = a * a - i * c;
  if (i === 0 || u <= 0) return [];
  const l = Math.sqrt(u),
    d = -(a + (a < 0 ? -l : l));
  return [d / i, c / d].filter((h) => h > 0 && h < 1).sort((h, f) => h - f);
}
function Fv(e, t, n, r, s) {
  if (r === s || n === 0) return [];
  const o = (1 / (e * e) - s) / (r - s);
  if (!(o > 0 && o < 1)) return [];
  const i = Math.acos(Math.sqrt(o)),
    a = [];
  for (const c of [i, -i, Math.PI - i, Math.PI + i]) {
    const l = (n > 0 ? Er(c - t) : Er(t - c)) / Math.abs(n);
    l > 0 && l < 1 && a.push(l);
  }
  return a.sort((c, u) => c - u);
}
function jv(e, t) {
  const n = [e, ...t.map((s) => s.to)],
    r = t
      .map((s, o) =>
        s.kind === "line"
          ? { kind: "line", to: n[o] }
          : { ...s, to: n[o], sweep: -s.sweep },
      )
      .reverse();
  return { from: n[n.length - 1], to: e, segments: r };
}
function zv(e, t, n) {
  const r = n
      .map((o) => ({ point: o, angle: Er(Math.atan2(o[1], o[0])) }))
      .sort((o, i) => o.angle - i.angle),
    s = [];
  for (let o = 0; o < r.length; o++) {
    const i = r[o],
      a = r[(o + 1) % r.length],
      c =
        o + 1 < r.length ? a.angle - i.angle : a.angle + 2 * Math.PI - i.angle;
    if (c <= 0) continue;
    const u = i.angle + c / 2;
    t.reduce((l, d) => l + Dv(d, u), 0) === 0 &&
      s.push({
        from: i.point,
        to: a.point,
        segments: [{ kind: "arc", to: a.point, radii: e, sweep: c }],
      });
  }
  return s;
}
function Dv(e, t) {
  const n = Math.atan2(e.from[1], e.from[0]);
  return (e.sweep > 0 ? Er(t - n) : Er(n - t)) < Math.abs(e.sweep)
    ? Math.sign(e.sweep)
    : 0;
}
function qv(e) {
  const t = (o) => `${o[0]} ${o[1]}`,
    n = new Map();
  for (const o of e) {
    const i = n.get(t(o.from));
    i === void 0 ? n.set(t(o.from), [o]) : i.push(o);
  }
  const r = new Set(),
    s = [];
  for (const o of e) {
    const i = [];
    let a = o;
    for (; a !== void 0 && !r.has(a);)
      (r.add(a),
        i.push(...a.segments),
        (a = n.get(t(a.to))?.find((c) => !r.has(c))));
    i.length > 0 && s.push(i);
  }
  return s;
}
function Ll(e, t, n) {
  return [e[0] + (t[0] - e[0]) * n, e[1] + (t[1] - e[1]) * n];
}
function Nl(e) {
  return e - 2 * Math.PI * Math.round(e / (2 * Math.PI));
}
function Er(e) {
  const t = e % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/* ---- Eye contour sampler (SDF -> marching squares -> simplification), sphere projection & SVG writers, morph overlays, morph renderer, DOM differ (original lines 8157-9519) ---- */
const Bv = 60,
  Hv = 256,
  Vv = 24,
  Gv = 2e4,
  Wv = 0.2;
function Uv(e, t, n) {
  const r = {
      field: e,
      tolerance: n,
      root: n.deviation * 0.001,
      reach: t.step * Math.hypot(t.nx, t.ny),
    },
    s = [];
  for (const o of Kv(r, t)) {
    const i = Zv(Xv(r, o), n);
    i.length >= 3 && s.push(i);
  }
  return s;
}
function Kv(e, t) {
  const { field: n } = e,
    { x0: r, y0: s, step: o, nx: i, ny: a } = t,
    c = i + 1,
    u = new Float64Array(c * (a + 1));
  for (let v = 0; v <= a; v++)
    for (let x = 0; x <= i; x++) u[v * c + x] = n(r + x * o, s + v * o);
  const l = 2 * c * (a + 1),
    d = new Int32Array(l).fill(-1),
    h = new Map(),
    f = (v) => {
      const x = h.get(v);
      if (x !== void 0) return x;
      const E = v >> 1,
        A = v & 1 ? E + c : E + 1,
        j = r + (E % c) * o,
        F = s + Math.floor(E / c) * o,
        O = r + (A % c) * o,
        L = s + Math.floor(A / c) * o,
        T = Fh(e, j, F, u[E], O, L, u[A]),
        I = [j + (O - j) * T, F + (L - F) * T];
      return (h.set(v, I), I);
    },
    p = [0, 0, 0, 0],
    m = [0, 0, 0, 0],
    g = [],
    y = [];
  for (let v = 0; v < a; v++)
    for (let x = 0; x < i; x++) {
      const E = v * c + x;
      ((p[0] = E),
        (p[1] = E + 1),
        (p[2] = E + 1 + c),
        (p[3] = E + c),
        (m[0] = 2 * E),
        (m[1] = 2 * (E + 1) + 1),
        (m[2] = 2 * (E + c)),
        (m[3] = 2 * E + 1),
        (g.length = 0),
        (y.length = 0));
      for (let A = 0; A < 4; A++) {
        const j = u[p[A]] < 0,
          F = u[p[(A + 1) & 3]] < 0;
        j !== F && (g.push(m[A]), y.push(j));
      }
      if (g.length === 2) {
        const A = y[0] ? 0 : 1;
        d[g[A]] = g[1 - A];
      } else if (g.length === 4) {
        const A = n(r + (x + 0.5) * o, s + (v + 0.5) * o) < 0;
        for (let j = 0; j < 4; j++)
          y[j] && (d[g[j]] = g[(j + (A ? 1 : 3)) & 3]);
      }
    }
  const w = [],
    S = new Uint8Array(l);
  for (let v = 0; v < l; v++) {
    if (d[v] < 0 || S[v]) continue;
    const x = [];
    let E = v;
    for (; E >= 0 && !S[E];) ((S[E] = 1), x.push(f(E)), (E = d[E]));
    E === v && w.push(x);
  }
  return w;
}
function Fh(e, t, n, r, s, o, i) {
  let a = 0,
    c = r,
    u = 1,
    l = i,
    d = 0,
    h = 0;
  for (let f = 0; f < Bv; f++) {
    h = (a * l - u * c) / (l - c);
    const p = e.field(t + (s - t) * h, n + (o - n) * h);
    if (Math.abs(p) <= e.root || u - a <= 1e-15) break;
    p < 0 == l < 0
      ? ((u = h), (l = p), d === -1 && (c /= 2), (d = -1))
      : ((a = h), (c = p), d === 1 && (l /= 2), (d = 1));
  }
  return h;
}
function Xv(e, t) {
  const n = [];
  for (let r = 0; r < t.length; r++) {
    const s = t[r],
      o = t[(r + 1) % t.length];
    (s[0] === o[0] && s[1] === o[1]) || (n.push(s), Wi(e, s, o, 0, n));
  }
  return n;
}
function Wi(e, t, n, r, s) {
  const o = n[0] - t[0],
    i = n[1] - t[1],
    a = Math.sqrt(o * o + i * i);
  if (a === 0 || r >= Vv || s.length >= Gv) return;
  const c = (t[0] + n[0]) / 2,
    u = (t[1] + n[1]) / 2,
    l = e.field(c, u);
  if (!Number.isFinite(l)) return;
  const d = l > 0 ? 1 : -1,
    h = (-i / a) * d,
    f = (o / a) * d,
    p = jh(e, c, u, l, h, f);
  if (p === null || (p <= e.tolerance.deviation / 2 && a <= e.tolerance.edge))
    return;
  const m = l > 0 ? Yv(e, c, u, l, h, f, p) : [c + h * p, u + f * p];
  (Wi(e, t, m, r + 1, s), s.push(m), Wi(e, m, n, r + 1, s));
}
function Yv(e, t, n, r, s, o, i) {
  const a = [t + s * i, n + o * i],
    c = i * 0.001,
    u = e.field(t + c, n) - e.field(t - c, n),
    l = e.field(t, n + c) - e.field(t, n - c),
    d = Math.sqrt(u * u + l * l);
  if (d === 0) return a;
  const h = u * o - l * s < 0 ? -1 : 1,
    f = (-l / d) * h,
    p = (u / d) * h;
  if (f * s + p * o < Wv) return a;
  const m = jh(e, t, n, r, f, p);
  return m === null || m * (f * s + p * o) <= i ? a : [t + f * m, n + p * m];
}
function jh(e, t, n, r, s, o) {
  if (r === 0) return 0;
  let i = 0,
    a = r;
  for (let c = 0; c < Hv; c++) {
    const u = i + Math.max(Math.abs(a), e.root);
    if (u > e.reach) return null;
    const l = t + s * u,
      d = n + o * u,
      h = e.field(l, d);
    if (h < 0 != r < 0)
      return i + (u - i) * Fh(e, t + s * i, n + o * i, a, l, d, h);
    ((i = u), (a = h));
  }
  return null;
}
function Zv(e, t) {
  const n = e.length;
  if (n < 4) return e;
  const r = new Uint8Array(n);
  let s = 0,
    o = -1;
  for (let a = 1; a < n; a++) {
    const c = Fl(e[0], e[a]);
    c > o && ((o = c), (s = a));
  }
  ((r[0] = 1), (r[s] = 1));
  const i = (a, c) => {
    if (c - a < 2) return;
    const u = e[a],
      l = e[c % n];
    let d = -1,
      h = a;
    for (let p = a + 1; p < c; p++) {
      const m = Qv(e[p], u, l);
      m > d && ((d = m), (h = p));
    }
    const f = d > t.deviation / 2;
    (!f && Math.sqrt(Fl(u, l)) <= t.edge) ||
      (f || (h = (a + c) >> 1), (r[h] = 1), i(a, h), i(h, c));
  };
  return (i(0, s), i(s, n), e.filter((a, c) => r[c] === 1));
}
function Fl(e, t) {
  const n = t[0] - e[0],
    r = t[1] - e[1];
  return n * n + r * r;
}
function Qv(e, t, n) {
  const r = n[0] - t[0],
    s = n[1] - t[1],
    o = e[0] - t[0],
    i = e[1] - t[1],
    a = r * r + s * s,
    c = a > 0 ? Math.min(1, Math.max(0, (o * r + i * s) / a)) : 0,
    u = o - r * c,
    l = i - s * c;
  return Math.sqrt(u * u + l * l);
}
const Jv = 0.02,
  eS = 16,
  tS = 0.015,
  nS = 400,
  rS = 512,
  Ks = 5,
  cn = new Map();
function sS(e, t) {
  if (e.fillRing) return [e.fillRing];
  const n = Math.min(eS, Math.max(0, Math.ceil(Math.log2(Math.max(t, 1))))),
    r = `${n}|${e.wid}|${e.oval.join()}|${e.ovalMix}|${e.pts.join()}`,
    s = cn.get(r);
  if (s !== void 0) return (cn.delete(r), cn.set(r, s), s);
  const o = cS(oS(e), Jv / 2 ** n);
  if ((cn.set(r, o), cn.size > rS)) {
    const i = cn.keys().next();
    i.done !== !0 && cn.delete(i.value);
  }
  return o;
}
function oS(e) {
  const [t, n] = e.oval,
    s =
      t > 1e-5 && n > 1e-5
        ? e.ovalMix > 1e-4
          ? Math.min(1, e.ovalMix)
          : uS(0, 0.08, Math.min(t, n))
        : 0,
    o = Math.max(0, e.pts.length - 1),
    i = new Float64Array(o * Ks);
  for (let a = 0; a < o; a++) {
    const [c, u] = e.pts[a],
      l = e.pts[a + 1][0] - c,
      d = e.pts[a + 1][1] - u,
      h = l * l + d * d;
    i.set([c, u, l, d, h > 0 ? 1 / h : 0], a * Ks);
  }
  return {
    segments: i,
    halfWidth: e.wid > 0 ? e.wid : -1,
    rx: t,
    ry: n,
    ellipseMix: s,
  };
}
function iS(e, t, n) {
  const r = aS(e.segments, t, n) - e.halfWidth;
  if (e.ellipseMix === 0) return r;
  const s = t / e.rx,
    o = n / e.ry,
    i = (Math.sqrt(s * s + o * o) - 1) * Math.min(e.rx, e.ry);
  return r * (1 - e.ellipseMix) + i * e.ellipseMix;
}
function aS(e, t, n) {
  let r = 1e6;
  for (let s = 0; s < e.length; s += Ks) {
    const o = t - e[s],
      i = n - e[s + 1],
      a = e[s + 2],
      c = e[s + 3],
      u = (o * a + i * c) * e[s + 4],
      l = u < 0 ? 0 : u > 1 ? 1 : u,
      d = o - a * l,
      h = i - c * l,
      f = d * d + h * h;
    f < r && (r = f);
  }
  return Math.sqrt(r);
}
function cS(e, t) {
  let n = 1 / 0,
    r = 1 / 0,
    s = -1 / 0,
    o = -1 / 0,
    i = 1 / 0;
  const { segments: a, halfWidth: c } = e;
  if (c > 0 && e.ellipseMix < 1 && a.length > 0) {
    for (let d = 0; d < a.length; d += Ks)
      for (const [h, f] of [
        [a[d], a[d + 1]],
        [a[d] + a[d + 2], a[d + 1] + a[d + 3]],
      ])
        ((n = Math.min(n, h - c)),
          (r = Math.min(r, f - c)),
          (s = Math.max(s, h + c)),
          (o = Math.max(o, f + c)));
    i = c;
  }
  if (
    (e.ellipseMix > 0 &&
      ((n = Math.min(n, -e.rx)),
      (r = Math.min(r, -e.ry)),
      (s = Math.max(s, e.rx)),
      (o = Math.max(o, e.ry)),
      (i = Math.min(i, e.rx, e.ry))),
    !(s > n && o > r))
  )
    return [];
  const u = Math.max(Math.min(tS, i / 3), Math.max(s - n, o - r) / nS),
    l = {
      x0: n - 2 * u,
      y0: r - 2 * u,
      step: u,
      nx: Math.ceil((s - n) / u) + 4,
      ny: Math.ceil((o - r) / u) + 4,
    };
  return Uv((d, h) => iS(e, d, h), l, { deviation: t, edge: Math.sqrt(4 * t) });
}
function uS(e, t, n) {
  const r = Math.min(1, Math.max(0, (n - e) / (t - e)));
  return r * r * (3 - 2 * r);
}
const jl = 48,
  zl = 11,
  or = 0.055,
  zh = Math.PI * 0.999,
  lS = 0.4,
  dS = 0.0035,
  hS = 0.75,
  fS = 0.45,
  pS = 1.8,
  mS = 0.8,
  gS = J1.map(MS),
  yS = 192,
  kS = Math.PI / 48;
function wS(e, t, n, r = {}) {
  const s = (e.zoom * n) / 2,
    [o, i] = e.squash;
  if (s === 0 || o === 0 || i === 0)
    return { size: n, body: "", eyes: "", glow: null, proof: null };
  const a = [Math.abs(o), Math.abs(i)],
    c = n / 2 + s * e.offset[0],
    u = n / 2 - s * (e.squashAnchor * (1 - i) + e.offset[1]),
    l = (f) => `${Ct(c + f[0] * s)} ${Ct(u - f[1] * s)}`,
    d = (f) => f.map((p) => Ui(p, l, Math.abs(s))).join(""),
    h = Dh(e, Math.abs(s));
  return {
    size: n,
    body: d(t.cutout ? Ov(a, h) : [Tr(a, 1)]),
    eyes: t.cutout ? "" : d(h),
    glow: e.glow === null ? null : TS(e.glow, a, l, Math.abs(s)),
    proof: r.isProof === !0 ? ES(e, t, a, l, s, n) : null,
  };
}
function Dh(e, t) {
  if (e.eyes === null) return [];
  const n = Xn(e.quat),
    r = [Math.abs(e.squash[0]), Math.abs(e.squash[1])],
    s = r[0] < 1 || r[1] < 1,
    o = [];
  return (
    e.eyes.forEach((i, a) => {
      for (const c of SS(i, J1[a], gS[a], n, t)) {
        const u = s ? Rv(c, r) : c;
        u !== null && o.push(u);
      }
    }),
    o
  );
}
function bS(e, t) {
  const n = (e.zoom * t) / 2,
    [r, s] = e.squash,
    o = [
      t / 2 + n * e.offset[0],
      t / 2 - n * (e.squashAnchor * (1 - s) + e.offset[1]),
    ],
    i = Math.abs(n),
    a = ([c, u]) => [o[0] + c * n, o[1] - u * n];
  return {
    center: o,
    radius: i,
    body: [yv(o, [Math.abs(r) * i, Math.abs(s) * i], yS)],
    eyes: Dh(e, i).map((c) => xS(c).map(a)),
  };
}
function xS(e) {
  const t = [];
  let n = e[e.length - 1]?.to ?? [0, 0];
  for (const r of e) {
    if (r.kind === "arc") {
      const s = Math.atan2(n[1], n[0]),
        o = Math.max(1, Math.ceil(Math.abs(r.sweep) / kS));
      for (let i = 1; i < o; i++) t.push(Nh(r.radii, s + (r.sweep * i) / o));
    }
    (t.push(r.to), (n = r.to));
  }
  return t;
}
function vS(e, t, n = "grok-sphere", r = e.size) {
  const s = [],
    o = [];
  let i = Na(t);
  if (
    (e.glow?.halo != null &&
      (s.push(oi(`${n}-halo`, e.glow.halo.gradient)),
      o.push(
        `<path d="${e.glow.halo.d}" fill="url(#${n}-halo)" fill-rule="evenodd"/>`,
      )),
    e.proof !== null
      ? ((i = `url(#${n}-light)`),
        s.push(
          oi(`${n}-light`, e.proof.light),
          `<clipPath id="${n}-proof"><path d="${e.body}" clip-rule="evenodd"/></clipPath>`,
        ))
      : e.glow !== null &&
        ((i = `url(#${n}-body)`), s.push(oi(`${n}-body`, e.glow.body))),
    o.push(`<path d="${e.body}" fill="${i}" fill-rule="evenodd"/>`),
    e.eyes !== "" && o.push(`<path d="${e.eyes}" fill="${Fa(t)}"/>`),
    e.proof !== null)
  ) {
    const a = e.proof.lines
      .filter((c) => c.d !== "")
      .map(
        (c) =>
          `<path d="${c.d}" fill="none" stroke="${c.color}" stroke-width="${Ct(c.width)}" stroke-opacity="${c.opacity}"/>`,
      );
    o.push(`<g clip-path="url(#${n}-proof)">${a.join("")}</g>`);
  }
  return `${ja(e.size, n, r)}${s.length > 0 ? `<defs>${s.join("")}</defs>` : ""}${o.join("")}</svg>`;
}
function SS(e, t, n, r, s) {
  const o = sS(e, s * Math.max(1, e.lidY));
  if (o.length === 0) return [];
  const i = wt(r, t.M),
    a = wt(r, t.C),
    c = wt(r, t.T),
    u = Math.atan2(i[1], i[0]),
    l = Math.cos(e.tilt),
    d = Math.sin(e.tilt),
    [h, f] = e.off,
    p = ([g, y]) => {
      const w = y * e.lidY,
        S = h + l * g + d * w,
        v = f - d * g + l * w,
        x = Math.sqrt(S * S + v * v),
        E = x > 1e-12 ? Math.sin(x) / x : 1,
        A = Math.cos(x);
      return [
        A * i[0] + E * (S * a[0] + v * c[0]),
        A * i[1] + E * (S * a[1] + v * c[1]),
        A * i[2] + E * (S * a[2] + v * c[2]),
      ];
    },
    m = [];
  for (const g of o) {
    const y = g.map(p);
    n && y.reverse();
    const w = _v(y, u);
    w !== null && m.push(w);
  }
  return m;
}
function MS({ M: e, T: t, C: n }) {
  const r = [
    n[1] * t[2] - n[2] * t[1],
    n[2] * t[0] - n[0] * t[2],
    n[0] * t[1] - n[1] * t[0],
  ];
  return r[0] * e[0] + r[1] * e[1] + r[2] * e[2] < 0;
}
function Ui(e, t, n) {
  let r = e[e.length - 1].to,
    s = `M${t(r)}`;
  for (const o of e)
    ((s += o.kind === "line" ? `L${t(o.to)}` : Ki(r, o, t, n)), (r = o.to));
  return `${s}Z`;
}
function Ki(e, t, n, r) {
  if (t.sweep === 0) return "";
  if (Math.abs(t.sweep) > zh) {
    const o = t.sweep / 2,
      i = Nh(t.radii, Math.atan2(e[1], e[0]) + o);
    return (
      Ki(e, { ...t, to: i, sweep: o }, n, r) + Ki(i, { ...t, sweep: o }, n, r)
    );
  }
  return `A${`${Ct(t.radii[0] * r)} ${Ct(t.radii[1] * r)}`} 0 0 ${t.sweep > 0 ? 0 : 1} ${n(t.to)}`;
}
function TS(e, t, n, r) {
  const s = 0.42 + 0.16 * e.midT,
    o = [];
  for (let u = 0; u <= jl; u++) {
    const l = 1 - (1 - u / jl) ** 2;
    o.push({ offset: l, color: Sr(IS(e, s, l)), opacity: 1 });
  }
  const i = { transform: Bl(t, n, r), focus: 0, stops: o };
  if (!(e.halo > 0)) return { body: i, halo: null };
  const a = [];
  for (let u = 0; u <= zl; u++) {
    const l = (or * u) / zl,
      d = Math.min(1, e.halo * (1 - Xi(0, or, l)));
    a.push({ offset: (1 + l) / (1 + or), color: Sr(e.rim), opacity: d });
  }
  const c = [t[0] * (1 + or), t[1] * (1 + or)];
  return {
    body: i,
    halo: {
      d: Ui(Tr(c, 1), n, r) + Ui(Tr(t, 1), n, r),
      gradient: { transform: Bl(c, n, r), focus: 0, stops: a },
    },
  };
}
function ES(e, t, n, r, s, o) {
  const i = Xn(e.quat);
  let a = "",
    c = "";
  for (const f of zx) {
    const p = Dx(f, i);
    p !== null && (f.isEquator ? (c += Dl(p, r, s)) : (a += Dl(p, r, s)));
  }
  const u = ql(t.ink, [1, 1, 1], lS),
    l = Bx(),
    d =
      0.2126 * u[0] + 0.7152 * u[1] + 0.0722 * u[2] > 0.6
        ? "#000000"
        : "#ffffff",
    h = Math.max(hS, o * dS);
  return {
    light: {
      transform: PS(l, n, r, s),
      focus: l.focus,
      stops: l.stops.map((f) => ({
        offset: f.offset,
        color: Sr(ql([0, 0, 0], u, f.shade)),
        opacity: 1,
      })),
    },
    lines: [
      { d: a, color: d, width: h, opacity: fS },
      { d: c, color: d, width: h * pS, opacity: mS },
    ],
  };
}
function Dl(e, t, n) {
  const r = (p) => [
      e.center[0] + e.a[0] * Math.cos(p) + e.b[0] * Math.sin(p),
      e.center[1] + e.a[1] * Math.cos(p) + e.b[1] * Math.sin(p),
    ],
    s = 0.5 * Math.atan2(2 * si(e.a, e.b), si(e.a, e.a) - si(e.b, e.b)),
    [o, i] = [Math.cos(s), Math.sin(s)],
    a = [e.a[0] * o + e.b[0] * i, e.a[1] * o + e.b[1] * i],
    c = [e.b[0] * o - e.a[0] * i, e.b[1] * o - e.a[1] * i],
    u = `${Ct(Math.hypot(a[0], a[1]) * Math.abs(n))} ${Ct(Math.hypot(c[0], c[1]) * Math.abs(n))}`,
    l =
      Math.round(Math.atan2(-a[1] * n, a[0] * n) * (180 / Math.PI) * 1e3) / 1e3,
    d = e.a[0] * e.b[1] - e.a[1] * e.b[0] > 0 ? 0 : 1,
    h = Math.ceil((e.to - e.from) / zh);
  let f = `M${t(r(e.from))}`;
  for (let p = 1; p <= h; p++)
    f += `A${u} ${l} 0 ${d} ${t(r(e.from + ((e.to - e.from) * p) / h))}`;
  return f;
}
function PS(e, t, n, r) {
  const [s, o] = e.axisX,
    [i, a] = e.axisY,
    c = [s * t[0] * r, -o * t[1] * r, i * t[0] * r, -a * t[1] * r],
    u = n([e.origin[0] * t[0], e.origin[1] * t[1]]);
  return `matrix(${c.map((l) => Math.round(l * 1e4) / 1e4).join(" ")} ${u})`;
}
function ql(e, t, n) {
  return [
    e[0] + (t[0] - e[0]) * n,
    e[1] + (t[1] - e[1]) * n,
    e[2] + (t[2] - e[2]) * n,
  ];
}
function si(e, t) {
  return e[0] * t[0] + e[1] * t[1];
}
function IS(e, t, n) {
  const r = Xi(0.12, t, n),
    s = Xi(t, 0.93, n),
    o = 0.9 + 0.1 * Math.max(0, 1 - n * n) ** 0.225,
    i = (a) => {
      const c = e.inner[a] + (e.mid[a] - e.inner[a]) * r;
      return (c + (e.rim[a] - c) * s) * o;
    };
  return [i(0), i(1), i(2)];
}
function Bl(e, t, n) {
  return `matrix(${Ct(e[0] * n)} 0 0 ${Ct(e[1] * n)} ${t([0, 0])})`;
}
function oi(e, t) {
  const n = t.stops
    .map(
      (r) =>
        `<stop offset="${r.offset}" stop-color="${r.color}" stop-opacity="${r.opacity}"/>`,
    )
    .join("");
  return `<radialGradient id="${e}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" fx="${t.focus}" fy="0" gradientTransform="${t.transform}">${n}</radialGradient>`;
}
function Xi(e, t, n) {
  const r = Math.min(1, Math.max(0, (n - e) / (t - e)));
  return r * r * (3 - 2 * r);
}
function Ct(e) {
  return String(Math.round(e * 100) / 100);
}
const AS = -15 + 259 / 2,
  $S = 0.62,
  Hl = 96,
  CS = Math.PI * 2,
  ii = {
    dots: 22,
    orbit: 19,
    radar: 19,
    progress: 19,
    gather: 19,
    wave: 16,
    send: 20,
    receive: 20,
    dock: 20,
    ball: 18,
    pencil: 17,
    bang: 13,
    standby: 13,
  },
  Vl = {
    dots: 1.5,
    orbit: 1.14,
    radar: 1.14,
    progress: 1.32,
    gather: 1.15,
    wave: 1.42,
    send: 1.12,
    receive: 1.12,
    dock: 1.3,
    ball: 1.22,
    pencil: 1.18,
    bang: 1.28,
    standby: 1.75,
  },
  _S = 22,
  Gl = 62,
  RS = 0.84,
  OS = 0.22,
  LS = 1.02,
  NS = 9,
  FS = 1400,
  qh = 1500,
  Yi = 1700,
  Xs = 2500,
  hr = 0.68,
  ks = Xs * hr,
  jS = 2.4,
  zS = 120,
  DS = La("progress") * 1e3,
  qS = La("spawning") * 1e3,
  BS = [-2, -1, 1, 2],
  _t = (e) => ((e % 1) + 1) % 1,
  HS = (e, t) => {
    const n = e.length,
      r = (t / n) * Math.PI * 2,
      s = Math.cos(r),
      o = Math.sin(r);
    return Array.from({ length: n }, (i, a) => {
      const [c, u] = e[(((a - t) % n) + n) % n],
        l = c - b,
        d = u - b;
      return [b + l * s - d * o, b + l * o + d * s];
    });
  },
  Bh = Array.from({ length: Hl }, (e, t) => {
    const n = (t / Hl) * CS;
    return [b + Math.cos(n) * b, b + Math.sin(n) * b];
  }),
  Wl = hh(88, 18).ring,
  VS = HS(Wl, Wl.length / 2),
  ai = (e) => (e === "pencil" ? VS : Bh),
  GS = (e, t) => {
    const n = e / 2,
      r = b - t / 2 + n,
      s = b + t / 2 - n;
    return `M${b - n} ${r}A${n} ${n} 0 0 1 ${b + n} ${r}L${b + n} ${s}A${n} ${n} 0 0 1 ${b - n} ${s}Z`;
  },
  WS = (e, t, n) => {
    const r = e / 2,
      s = t / 2,
      o = b - n / 2,
      i = b + n / 2;
    return `M${b - r} ${o + r}A${r} ${r} 0 0 1 ${b + r} ${o + r}L${b + s} ${i - s}A${s} ${s} 0 0 1 ${b - s} ${i - s}Z`;
  },
  US = GS(30, 88),
  KS = WS(30, 17, 96),
  Rt = (e, t, n, r, s) => ({
    type: "disc",
    key: e,
    cx: t,
    cy: n,
    r,
    opacity: s,
  }),
  lo = (e, t, n, r) => ({
    type: "ring",
    key: e,
    cx: b,
    cy: b,
    r: t,
    width: n,
    opacity: r,
  }),
  Hh = (e, t, n, r) => ({
    type: "shape",
    key: e,
    d: t,
    transform: n,
    opacity: r,
  }),
  XS = (e, t, n, r) => ({ type: "stroke", key: e, d: t, width: n, opacity: r }),
  YS = { lift: 0, pop: 1, tone: 1 },
  Vh = (e, t, n, r) => {
    const s = _t((e.stateTime * 1e3) / FS + 0.119),
      o = Math.abs(s - t / 3),
      i = Math.min(o, 1 - o),
      a = r ? 1 : Math.exp(-(i * i) / (2 * 0.15 * 0.15)),
      c = r ? 0 : 1;
    return {
      lift: a * NS * n * c,
      pop: 1 + c * (RS + OS * a - 1),
      tone: 1 - c * 0.5 * (1 - a),
    };
  },
  ZS = (e) =>
    0.42 +
    0.29 * Math.sin(e * 0.0021) * Math.sin(e * 0.0034) +
    0.29 * Math.sin(e * 0.0013 + 1.7),
  QS = (e, t) =>
    ZS(e) * (0.55 + 0.45 * Math.sin(e * 0.012 - Math.abs(t) * 1.05)),
  JS = (e) => -Math.PI * 1.25 + Oa(e)() * Math.PI * 1.5,
  eM = (e) => {
    const r = 1082.2060353798126,
      s = 40,
      o = Math.sqrt((2 * s) / r);
    if (e < o) return 0.5 * r * e * e;
    const i = _t((e - o) / 0.62);
    return s - 208 * i * (1 - i);
  },
  Ua = (e) => {
    const t = _t(e / Xs);
    if (t < hr) {
      const r = t / hr,
        s = r * r * (3 - 2 * r),
        o = de(r / 0.08, 0, 1) * de((1 - r) / 0.08, 0, 1);
      return {
        x: -54 + 118 * s,
        y: 26,
        wig: Math.sin(r * 24) * 3.2 * o,
        rot: 17 + Math.sin(e * 6e-4) * 1,
      };
    }
    const n = Fs((t - hr) / (1 - hr));
    return {
      x: 64 - 118 * n,
      y: 26 - 20 * Math.sin(n * Math.PI),
      wig: 0,
      rot: 17 - 2 * Math.sin(n * Math.PI) + Math.sin(e * 6e-4) * 1,
    };
  },
  Gh = (e) => {
    const t = Ua(e);
    return [b + t.x, b + t.y + t.wig + 19];
  },
  tM = (() => {
    const e = [];
    for (let t = 0; t < ks; t++) {
      const n = Gh(t),
        r = e[e.length - 1];
      (r === void 0 || Math.hypot(n[0] - r.point[0], n[1] - r.point[1]) > jS) &&
        e.push({ at: t, point: n });
    }
    return e;
  })(),
  nM = (e) => {
    const t = _t(e / Xs) * Xs,
      n = Math.min(t, ks),
      r = tM.filter((a) => a.at <= n),
      s = r.length > 0 ? r[r.length - 1].at : n,
      o = n > s ? [Gh(n)] : [],
      i = [...r.map((a) => a.point), ...o].slice(-64);
    return t < ks ? i : i.slice(Math.floor(((t - ks) / 1e3) * zS));
  },
  rM = (e) => {
    const t = e.length;
    let n = `M${e[0][0].toFixed(1)} ${e[0][1].toFixed(1)}`;
    if (t === 2) return n + `L${e[1][0].toFixed(1)} ${e[1][1].toFixed(1)}`;
    for (let r = 0; r < t - 1; r++) {
      const s = e[Math.max(r - 1, 0)],
        o = e[r],
        i = e[r + 1],
        a = e[Math.min(r + 2, t - 1)],
        c = o[0] + (i[0] - s[0]) / 6,
        u = o[1] + (i[1] - s[1]) / 6,
        l = i[0] - (a[0] - o[0]) / 6,
        d = i[1] - (a[1] - o[1]) / 6;
      n += `C${c.toFixed(1)} ${u.toFixed(1)} ${l.toFixed(1)} ${d.toFixed(1)} ${i[0].toFixed(1)} ${i[1].toFixed(1)}`;
    }
    return n;
  },
  sM = (e, t, n) => {
    const r = [b - Gl, b + Gl],
      s = [];
    for (let o = 0; o < 2; o++) {
      const i = de((e - o * 0.12) / (1 - o * 0.12), 0, 1);
      if (i <= 0.004) continue;
      const a = Ge(i),
        c = io(i),
        u = Vh(t, o === 0 ? 0 : 2, e, n);
      s.push(
        Rt(
          `dots.${o}`,
          b + (r[o] - b) * c,
          b - u.lift,
          _S * a * u.pop * LS,
          a * u.tone,
        ),
      );
    }
    return s;
  },
  oM = (e, t) => {
    const n = Ge(e),
      r = 52 * io(e),
      s = 12,
      o = t.stateTime * 1e3 * 0.0017;
    return Array.from({ length: 5 }, (i, a) => {
      const c = o + (a * Math.PI * 2) / 5,
        u = Math.cos(c),
        l = 0.5 + 0.5 * de(u, 0, 1);
      return Rt(
        `orbit.${a}`,
        b + r * Math.sin(c),
        b - r * 0.42 * Math.cos(c),
        Math.max(s * l * n, 0.3),
        de((u + 0.4) / 0.6, 0.18, 1) * n,
      );
    });
  },
  iM = (e, t, n) => {
    const r = Ge(e),
      s = 1300,
      o = 104;
    return Array.from({ length: 3 }, (i, a) => {
      const c = _t((t.stateTime * 1e3) / s + a / 3);
      return lo(
        `radar.${a}`,
        n + (o - n) * c,
        3.4 * (1 - c * 0.55),
        r * (1 - c) * 0.9,
      );
    });
  },
  aM = (e, t) => {
    const n = Ge(e),
      r = 62 * io(e),
      s = de((t.shotTime * 1e3) / DS, 0, 1),
      o = de(s / 0.85, 0, 1),
      i = lo("progress.track", r, 5, n * 0.16);
    return o <= 0
      ? [i]
      : [
          i,
          {
            type: "ring",
            key: "progress.arc",
            cx: b,
            cy: b,
            r,
            width: 5,
            opacity: n,
            arc: { fraction: o, startDeg: -90 },
          },
        ];
  },
  cM = (e, t) => {
    const n = Ge(e),
      r = [];
    for (let s = 0; s < 5; s++) {
      const o = de(((t.shotTime * 1e3) / qS - s * 0.09) / 0.62, 0, 1);
      if (o >= 1) continue;
      const i = 1 - Math.pow(1 - o, 3),
        a = s * 2.4 + o * 2.2,
        c = 96 * (1 - i);
      r.push(
        Rt(
          `gather.${s}`,
          b + c * Math.cos(a),
          b + c * Math.sin(a) * 0.8,
          9 * (0.5 + 0.5 * i) * n,
          n * de(o * 5, 0, 1) * (1 - i * 0.25),
        ),
      );
    }
    return r;
  },
  uM = (e, t) => {
    const n = t.stateTime * 1e3,
      r = 44,
      s = [];
    for (const o of BS) {
      const i = de((e - Math.abs(o) * 0.1) / (1 - Math.abs(o) * 0.1), 0, 1);
      if (i <= 0.004) continue;
      const a = io(i),
        c = QS(n, o),
        u = (7 + 9 * de(c, 0.08, 1)) * Ge(i),
        l = 6 * de(c, 0, 1) * i;
      s.push(Rt(`wave.${o}`, b + o * r * a, b - l, u, i));
    }
    return s;
  },
  lM = (e, t) => {
    const n = Ge(e),
      r = _t((t.stateTime * 1e3) / qh),
      s = de((r - 0.18) / 0.55, 0, 1),
      o = s * s * (0.4 + 0.6 * s),
      i = 0.74,
      a = -0.62,
      c = [];
    if (s > 0 && s < 1) {
      const h = 108 * o;
      c.push(
        Rt(
          "send.packet",
          b + i * h,
          b + a * h,
          10 * (1 - o * 0.55) * n,
          n * (1 - o * o),
        ),
      );
    }
    const u = de((r - 0.26) / 0.55, 0, 1),
      l = u * u * (0.4 + 0.6 * u);
    if (s > 0 && u > 0 && u < 1) {
      const h = 108 * l;
      c.push(
        Rt(
          "send.streak",
          b + i * h,
          b + a * h,
          5 * (1 - l * 0.6) * n,
          n * 0.3 * (1 - l),
        ),
      );
    }
    const d = de((r - 0.18) / 0.3, 0, 1);
    return (
      d > 0 &&
        d < 1 &&
        c.push(
          lo("send.launch", 20 + 34 * Ge(d), 2.8 * (1 - d), n * (1 - d) * 0.8),
        ),
      c
    );
  },
  dM = (e, t) => {
    const n = Ge(e),
      r = t.stateTime * 1e3,
      s = JS(Math.floor(r / Yi)),
      o = _t(r / Yi),
      i = de(o / 0.6, 0, 1),
      a = 1 - Math.pow(1 - i, 3),
      c = Math.cos(s),
      u = Math.sin(s),
      l = 108 * (1 - a),
      d = [];
    if (i < 1) {
      const f = 18 * Math.sin(i * Math.PI) * (1 - a * 0.7);
      d.push(
        Rt(
          "receive.packet",
          b + c * l - u * f,
          b + u * l + c * f,
          3.5 + 6.5 * a,
          n * de(i * 3.5, 0, 1) * (0.3 + 0.7 * a),
        ),
      );
    }
    const h = de((o - 0.58) / 0.32, 0, 1);
    return (
      h > 0 &&
        h < 1 &&
        d.push(
          lo(
            "receive.absorb",
            20 + 26 * Ge(h),
            2.8 * (1 - h),
            n * (1 - h) * 0.8,
          ),
        ),
      d
    );
  },
  hM = (e, t) => {
    const n = Ge(e),
      r = t.stateTime * 1e3,
      s = 42,
      o = 1.1,
      i = [];
    for (let a = 0; a < 2; a++) {
      const c = de((t.stateTime - (0.2 + a * 1.3)) / 0.9, 0, 1);
      if (c <= 0) continue;
      const u = 1 - Math.pow(1 - c, 3),
        l = r * 0.001 * o + a * Math.PI,
        d = b + s * Math.sin(l),
        h = b + s * 0.5 * Math.cos(l) + Math.sin(r * 0.003 + a) * 2,
        f = b - 120 + a * 30,
        p = b + 95;
      i.push(
        Rt(
          `dock.${a}`,
          f + (d - f) * u,
          p + (h - p) * u,
          (7 + 3 * u) * n,
          n * de(c * 4, 0, 1),
        ),
      );
    }
    return i;
  },
  fM = (e, t) => {
    const n = t.stateTime * 1e3,
      r = Ua(n),
      s = ((r.rot - 90) * Math.PI) / 180,
      o = 68,
      i = Math.cos(s) * o,
      a = Math.sin(s) * o,
      c = b + (r.x + i) * e,
      u = b + (r.y + r.wig * 0.15 + a) * e,
      l = [
        Hh(
          "pencil.shaft",
          US,
          `translate(${c.toFixed(1)} ${u.toFixed(1)}) rotate(${(r.rot * e).toFixed(1)}) scale(${Ge(e).toFixed(3)}) translate(${-b} ${-b})`,
          de(e * 1.6 - 0.3, 0, 1),
        ),
      ],
      d = nM(n);
    return (
      d.length >= 2 && l.push(XS("pencil.ink", rM(d), 6, de(e * 1.2, 0, 1))),
      l
    );
  },
  pM = (e, t) => {
    const n = t.stateTime,
      r = Ge(de(e * 1.1, 0, 1)),
      s = Math.exp(-(n % 2.2) * 5.5),
      o = Math.sin(n * 42) * 2.2 * s;
    return [
      Hh(
        "bang.bar",
        KS,
        `translate(0 ${(-26 - (1 - r) * 70).toFixed(1)}) rotate(${o.toFixed(2)} ${b} ${(b - 74).toFixed(1)}) translate(${b} ${b}) scale(${de(e * 1.2, 0, 1).toFixed(3)}) translate(${-b} ${-b})`,
        de(e * 1.5 - 0.2, 0, 1),
      ),
    ];
  },
  mM = (e, t) => {
    const n = 0.5 + 0.5 * Math.sin(t.stateTime * 1e3 * 0.0016);
    return [Rt("standby.halo", b, b, 26 + 7 * n, Ge(e) * (0.06 + 0.1 * n))];
  },
  gM = (e, t, n, r, s) => {
    switch (e) {
      case "dots":
        return sM(t, n, s);
      case "orbit":
        return oM(t, n);
      case "radar":
        return iM(t, n, r);
      case "progress":
        return aM(t, n);
      case "gather":
        return cM(t, n);
      case "wave":
        return uM(t, n);
      case "send":
        return lM(t, n);
      case "receive":
        return dM(t, n);
      case "dock":
        return hM(t, n);
      case "ball":
        return [];
      case "pencil":
        return fM(t, n);
      case "bang":
        return pM(t, n);
      case "standby":
        return mM(t, n);
    }
  };
function yM(e, t) {
  const { kind: n, isReducedMotion: r } = e,
    s = de(e.amount, 0, 1),
    o = de(e.swap, 0, 1),
    i = o < 0.999 ? e.outgoing : null,
    a = (G) => (G === n ? s * o : G === i ? s * (1 - o) : 0),
    c = (G) => (G === n ? e.clock : e.outgoingClock),
    u = de(s / $S, 0, 1),
    d =
      n === "pencil" || i === "pencil"
        ? o >= 0.999
          ? ai(n)
          : Zw(ai(i), ai(n), Fs(o))
        : Bh,
    h = n ? ii[n] * o + (i ? ii[i] : ii[n]) * (1 - o) : 19,
    f = a("dots"),
    p = n === "dots" || i === "dots",
    m = p ? Vh(c("dots"), 1, s, r) : YS;
  let g = p ? 1 + (m.pop - 1) * (f / Math.max(s, 0.001)) : 1;
  const y = a("receive");
  if (y > 0.004) {
    const G = _t((c("receive").stateTime * 1e3) / Yi),
      J = de((G - 0.58) / 0.34, 0, 1);
    g *= 1 + 0.11 * Math.sin(J * Math.PI) * y;
  }
  const w = a("send");
  if (w > 0.004) {
    const G = _t((c("send").stateTime * 1e3) / qh),
      J = G < 0.18 ? -0.06 * Math.sin((G / 0.18) * Math.PI) : 0,
      ye =
        G >= 0.18 && G < 0.42
          ? 0.05 * Math.sin(((G - 0.18) / 0.24) * Math.PI)
          : 0;
    g *= 1 + (J + ye) * w;
  }
  const S = a("bang");
  S > 0.004 &&
    (g *= 1 + 0.04 * Math.exp(-(c("bang").stateTime % 2.2) * 5.5) * S);
  let v = 0,
    x = 0,
    E = 0;
  const A = a("pencil");
  if (A > 0.004) {
    const G = Ua(c("pencil").stateTime * 1e3);
    ((v += G.x * A), (x += (G.y + G.wig * 0.5) * A), (E += G.rot * A));
  }
  S > 0.004 && (x += 58 * S);
  const j = a("ball");
  j > 0.004 && (x += eM(c("ball").stateTime) * j);
  const F = (h / b) * g,
    O = a("standby"),
    L =
      O > 0
        ? (0.28 + 0.2 * Math.sin(c("standby").stateTime * 1e3 * 0.0016)) * O
        : 0,
    T = {
      scale: 1 - s + F * s,
      dx: v * s,
      dy: -m.lift * f + x * s,
      rotation: E * s,
      opacity: (1 - (1 - m.tone) * f) * (1 - L),
      round: Fs(u),
      ring: d,
    },
    I = 1 - rk(de((t - 44) / 90, 0, 1)),
    $ = n == null ? 1 : Vl[n],
    R = i ? Vl[i] : $,
    U = 1 + ($ * o + R * (1 - o) - 1) * s * I,
    W = [];
  for (const G of [i, n]) {
    if (G == null) continue;
    const J = a(G);
    J > 0.004 && W.push(...gM(G, J, c(G), h, r));
  }
  return {
    core: T,
    isFaceVisible: s < 0.5,
    zoom: U,
    parts: W.filter((G) => G.opacity > 0),
  };
}
const kM = fv(192),
  wM = xv(96),
  bM = 0.6;
function Ka(e, t, n) {
  return t === "sphere"
    ? bS({ ...e }, n)
    : iv({ ...e, body: t, inspect: e.inspectWeight }, n);
}
function xM(e, t, n = t) {
  const r = e.bodies
      .map(({ body: l, weight: d }) => ({ shape: Ka(e, l, t), weight: d }))
      .sort((l, d) => d.weight - l.weight),
    s = r[0]?.shape.center ?? [t / 2, t / 2],
    o = r[0]?.shape.radius ?? 0,
    i = mv([kM, ...r.map(({ shape: l }) => pv(l.body, l.center))]),
    a = Oh(
      r.map(({ shape: l, weight: d }) => ({
        outline: gv(l.body, l.center, i),
        weight: d,
      })),
    ),
    c = e.morph == null ? null : yM(e.morph, n),
    u = (vn * t) / 2 / b;
  return {
    size: t,
    center: s,
    body:
      c == null || c.core.round === 0 ? a : Sv(a, MM(c, s, o, i), c.core.round),
    eyes: r.length === 1 ? (r[0]?.shape.eyes ?? []) : PM(r),
    head:
      c == null || e.morph == null ? null : TM(c, e.morph.amount, e.zoom, u),
    parts: c?.parts ?? [],
    markScale: u,
    zoom: c?.zoom ?? 1,
  };
}
function vM(e, t, n, r, s = n, o = n) {
  return SM(xM(e, n, s), t, r, o);
}
function SM(e, t, n, r = e.size) {
  const { size: s, center: o } = e,
    i = Na(t),
    a = Gi(e.body),
    c = e.eyes.map(Gi).join("");
  let u = "",
    l = `<path d="${a}" fill="${i}"/>`;
  c !== "" && t.cutout
    ? ((u += `<mask id="${n}-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="${s}" height="${s}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${c}" fill="#000"/></mask>`),
      (l = `<path d="${a}" fill="${i}" mask="url(#${n}-holes)"/>`))
    : c !== "" &&
      ((u += `<clipPath id="${n}-body"><path d="${a}"/></clipPath>`),
      (l += `<path d="${c}" fill="${Fa(t)}" clip-path="url(#${n}-body)"/>`));
  const d = e.head,
    h =
      d == null
        ? l
        : `<g transform="translate(${be(o[0] + d.translate[0])} ${be(o[1] + d.translate[1])}) rotate(${be(d.rotation)}) scale(${be(d.scale, 5)}) translate(${be(-o[0])} ${be(-o[1])})"${d.opacity < 1 ? ` opacity="${be(d.opacity, 3)}"` : ""}>${l}</g>`,
    f =
      e.parts.length === 0
        ? ""
        : `<g transform="translate(${s / 2} ${s / 2}) scale(${be(e.markScale, 5)}) translate(${-b} ${-b})">${e.parts.map((g) => EM(g, i)).join("")}</g>`,
    p = s / 2 + (AS - b) * e.markScale,
    m =
      e.zoom === 1
        ? `${f}${h}`
        : `<g transform="translate(${be(p)} ${be(p)}) scale(${be(e.zoom, 5)}) translate(${be(-p)} ${be(-p)})">${f}${h}</g>`;
  return `${ja(s, n, r)}${u === "" ? "" : `<defs>${u}</defs>`}${m}</svg>`;
}
function MM(e, t, n, r) {
  const s = n / b,
    o = e.core.ring.map(([i, a]) => [t[0] + (i - b) * s, t[1] + (a - b) * s]);
  return kv(o, t, r);
}
function TM(e, t, n, r) {
  const { core: s } = e,
    o = 1 - t,
    i = t > 0 ? (s.scale - o) / t : 0;
  return {
    translate: [s.dx * r, s.dy * r],
    rotation: s.rotation,
    scale: o + i * (vn / n) * t,
    opacity: s.opacity,
  };
}
function EM(e, t) {
  const n = e.opacity < 1 ? ` opacity="${be(e.opacity, 3)}"` : "";
  switch (e.type) {
    case "disc":
      return `<circle cx="${be(e.cx)}" cy="${be(e.cy)}" r="${be(e.r)}" fill="${t}"${n}/>`;
    case "ring": {
      const r = 2 * Math.PI * e.r,
        s =
          e.arc == null
            ? ""
            : ` stroke-dasharray="${be(r * e.arc.fraction)} ${be(r)}" transform="rotate(${be(e.arc.startDeg)} ${be(e.cx)} ${be(e.cy)})"`;
      return `<circle cx="${be(e.cx)}" cy="${be(e.cy)}" r="${be(e.r)}" fill="none" stroke="${t}" stroke-width="${be(e.width)}"${s}${n}/>`;
    }
    case "shape":
      return `<path d="${e.d}" transform="${e.transform}" fill="${t}"${n}/>`;
    case "stroke":
      return `<path d="${e.d}" fill="none" stroke="${t}" stroke-width="${be(e.width)}" stroke-linecap="round" stroke-linejoin="round"${n}/>`;
  }
}
function PM(e) {
  const t = (e[0]?.shape.radius ?? 0) * bM,
    n = [];
  return (
    e.forEach(({ shape: r }, s) => {
      for (const o of r.eyes) {
        const i = Lh(o),
          a = IM(n, s, i, t);
        if (a != null) {
          a.loops[s] = o;
          continue;
        }
        const c = e.map(() => null);
        ((c[s] = o), n.push({ anchor: i, loops: c }));
      }
    }),
    n.map((r) => {
      const s = r.loops.map((i) => (i == null ? null : wv(i))),
        o = vv([wM, ...s.map((i) => i?.stations ?? [])]);
      return Oh(
        e.map(({ weight: i }, a) => {
          const c = s[a];
          return {
            outline: c == null ? Mv(r.anchor, o.length) : bv(c, o),
            weight: i,
          };
        }),
      );
    })
  );
}
function IM(e, t, n, r) {
  let s = null,
    o = r;
  for (const i of e) {
    if (i.loops[t] != null) continue;
    const a = Math.hypot(i.anchor[0] - n[0], i.anchor[1] - n[1]);
    a < o && ((s = i), (o = a));
  }
  return s;
}
function be(e, t = 2) {
  const n = 10 ** t;
  return String(Math.round(e * n) / n);
}
function Wh(e, t, n, r, s = {}) {
  const [o, ...i] = e.bodies;
  if (o == null || i.length > 0 || e.morph != null)
    return vM(e, t, n, r, s.displaySize ?? n, s.extent);
  if (o.body === "sphere")
    return vS(wS({ ...e, body: o.body }, t, n, s), t, r, s.extent);
  const a = { ...e, body: o.body, inspect: e.inspectWeight };
  return av(ov(a, t, n, s), r, s.extent);
}
const ci = new WeakMap();
function AM(e, t) {
  const n = t.split('"'),
    r = ci.get(e),
    s = r != null && e.firstChild === r.root ? $M(r.parts, n) : null;
  if (r != null && s != null) {
    for (const i of s) r.slots[(i - 1) / 2].value = n[i];
    r.parts = n;
    return;
  }
  e.innerHTML = t;
  const o = [...e.querySelectorAll("*")].flatMap((i) => [...i.attributes]);
  CM(o, n)
    ? ci.set(e, { root: e.firstChild, slots: o, parts: n })
    : ci.delete(e);
}
function $M(e, t) {
  if (e.length !== t.length) return null;
  const n = [];
  for (let r = 0; r < t.length; r++)
    if (t[r] !== e[r]) {
      if (r % 2 === 0 || t[r].includes("&")) return null;
      n.push(r);
    }
  return n;
}
function CM(e, t) {
  return (
    t.length === e.length * 2 + 1 &&
    e.every(
      (n, r) => t[2 * r].endsWith(` ${n.name}=`) && n.value === t[2 * r + 1],
    )
  );
}

/* ==========================================================================
 *  Embeddable wrapper layer (written for this web build)
 *  - replaces the Electron/React shell (component `z_`, `GrokBotMark` wrapper,
 *    `attachMarkHoverGaze`) with plain DOM + requestAnimationFrame
 *  - keeps the same flow: engine `oh()` + state machine `zw()` -> `Wh()` SVG string
 *    -> differential DOM update `AM()`
 * ========================================================================== */

const FIT_TARGET_FILL = ao;      // original default `fill` (0.92): the diameter fraction a fitted body is aimed at (target, not a fixed size)
const AVATAR_FILL = ao;          // image avatars: the original applies no shape fit to them (circle at the default fill)
const COMPACT_PX = 48;           // < 48px uses the compact idle clip list (`ui`)
const HOVER_GAZE_RADIUS = 0.5;   // hover gaze saturates at 0.5 x width (`fH`)
const FOLLOW_GAZE_RADIUS = 0.85;   // global follow saturates at 2 x width
const FACES = wk.slice();
const POKES = j_.slice();
const STATES = Object.keys(zu);
const BODIES = kk.slice();       // the 25 internal bodies
// The 25 user-selectable shape names of the app's character picker (original `Wy`, defined outside the readable excerpt)
const SHAPES = ["blob","pebble","bean","egg","squircle","tablet","capsule","cylinder","hex","gem","crystal","wedge","shield","dome","arch","cloud","teardrop","leaf","square","sparkle","clover","flower","heart","house","star"];
const SHAPE_TO_BODY = { blob: "sphere", flower: "starFlower", heart: "heartChubby", star: "star6" };  // original `q_`
// Picker swatches (original `Ns`) and per-theme ink (original `Y1`) / 135deg gradient stops (original `ek`)
const SWATCHES = { black:"#000", brown:"#936439", red:"#FF263C", orange:"#FF6700", yellow:"#FF9800", green:"#00C972", cyan:"#00BCA6", blue:"#1084FE", violet:"#9159FE", magenta:"#FF309B", gray:"#777777" };
const COLORS = Object.keys(SWATCHES);
const PALETTE = {};                                   // name -> { light, dark } ink
for (const k in Y1) PALETTE[k] = { light: Y1[k].light, dark: Y1[k].dark };
const EYE_BY_THEME = { light: "#fcfcfc", dark: "#070707" };   // original `Wn` (eye colour when a theme is given)
const GRADIENT_ANGLE = tk;                            // 135deg
const STATE_GROUPS = {};
for (const g of Rw) STATE_GROUPS[g.label.toLowerCase()] = g.states.slice();
const EMOTIONS = STATE_GROUPS.reactions.slice();      // the 17 reactions
const SCENES = { notification: "notifying", dragged: "dragging", humming: "humming", logo: "logo", showcase: "showcase", turntable: "turntable" };
const FACE_ALIASES = {};
vk.forEach((v, k) => { FACE_ALIASES[k] = v; });

function gradientFor(color, theme) {
  const t = theme === "dark" ? "dark" : "light";
  const g = ek[color];
  if (!g) return null;
  const from = g[t + "From"], to = g[t + "To"];
  const mix = (c, p) => `color-mix(in oklab, ${c} ${p}%, transparent)`;
  return {
    from, to, angle: GRADIENT_ANGLE,
    css: `linear-gradient(${GRADIENT_ANGLE}deg, ${from}, ${to})`,
    // the app's soft card tint built from the same stops (original `NDe`)
    tint: [`radial-gradient(115% 90% at 15% 8%, ${mix(from, 26)}, transparent 68%)`,
           `radial-gradient(95% 75% at 90% 82%, ${mix(to, 20)}, transparent 70%)`,
           `linear-gradient(140deg, ${mix(from, 14)}, ${mix(to, 7)})`].join(", "),
  };
}

let uidCounter = 0;
const hashString = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
const prefersDark = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
const cleanPaint = (c) => String(c).replace(/["<>&]/g, "");
function canonShape(name) {
  if (name == null) return "sphere";
  const n = SHAPE_TO_BODY[name] ?? name;
  if (BODIES.includes(n)) return n;
  console.warn(`GrokBotMark: unknown shape "${name}", using sphere`);
  return "sphere";
}
function resolveInk(color, theme) {
  if (color == null || color === "") return PALETTE.black[theme];
  return PALETTE[color] ? PALETTE[color][theme] : cleanPaint(color);
}
let _rgbCtx = null;
function toRGB(css) {                       // css colour -> [r,g,b] in 0..1 (needed by the shaded/glow looks)
  try {
    _rgbCtx = _rgbCtx || document.createElement("canvas").getContext("2d");
    _rgbCtx.fillStyle = "#000"; _rgbCtx.fillStyle = css;
    let v = _rgbCtx.fillStyle;
    if (v[0] === "#") return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
    const m = v.match(/[\d.]+/g); return [m[0] / 255, m[1] / 255, m[2] / 255];
  } catch (e) { return [0, 0, 0]; }
}
const mixRGB = (a, b2, t) => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, a[2] + (b2[2] - a[2]) * t];
function makeAppearance(color, eyeColor, theme) {
  const inkCss = resolveInk(color, theme);
  const ink = toRGB(inkCss);
  if (eyeColor == null || eyeColor === "" || eyeColor === "cutout")
    return { ink, spot: ns, cutout: true, inkPaint: inkCss, inkRGB: ink };
  const eyeCss = eyeColor === "theme" ? EYE_BY_THEME[theme] : resolveInk(eyeColor, theme);
  return { ink, spot: toRGB(eyeCss), cutout: false, inkPaint: inkCss, spotPaint: eyeCss, inkRGB: ink };
}
function makeGlow(inkRGB, opts) {           // radial body gradient consumed by the engine's glow renderer
  const o = opts || {};
  return {
    inner: o.inner || mixRGB(inkRGB, [1, 1, 1], 0.78),
    mid: o.mid || mixRGB(inkRGB, [1, 1, 1], 0.38),
    rim: o.rim || inkRGB,
    halo: o.halo ?? 0,
    midT: 0,
  };
}
const ns = [0, 0, 0];

/* ==========================================================================
 *  Per-shape fit scaling ("自适应缩放") — ported from the original `Xh` / `zM` / `H_` / `jM` / `B_` / `Xa` / `Yh`
 *  (minified platform chunk, just after the readable excerpt ends).
 *  Xh(body, fill): builds the body's REST-pose silhouette in a 1000-unit box (Ul = 1000) at `fill`,
 *  finds its largest Chebyshev distance `i` from the box centre, and returns
 *      i <= 500 ? fill : fill * 500 / i
 *  i.e. the fill is shrunk just enough for the silhouette to fit inside the box. Cached per body:fill.
 *  In the original the live mark itself is mounted with a constant fill (`gb` = `ao` = 0.92); Xh is used for static
 *  renderings (picker icons `tG`, still images `jM`/`B_`, ring/mask outlines `H_`).
 * ========================================================================== */
const FIT_BOX = 1000;                        // original `Ul`
const _fitCache = new Map();
const Yh = (e) => Math.round(e * 1e3) / 1e3;
const Xa = (e) => oh({ body: e }).frame();   // rest frame of a body (original `Xa`)
function fitFill(body, fill) {               // original `Xh`
  const t = fill == null ? FIT_TARGET_FILL : fill;
  const b = canonShape(body);
  const key = `${b}:${t}`;
  const hit = _fitCache.get(key);
  if (hit !== undefined) return hit;
  const sz = FIT_BOX * _r(t), o = sz / 2;
  let i = 0;
  for (const poly of Ka(Xa(b), b, sz).body)
    for (const [x, y] of poly) i = Math.max(i, Math.abs(x - o), Math.abs(y - o));
  const half = FIT_BOX / 2;
  const c = i <= half ? t : (t * half) / i;
  _fitCache.set(key, c);
  return c;
}
function shapeOutline(e, t, n, r) {          // original `zM`: silhouette path(s) of the rest pose, `n` px box, fitted fill `r`
  const rr = r == null ? FIT_TARGET_FILL : r;
  const s = n * _r(rr), o = (s - n) / 2;
  const sh = Ka(Xa(e), e, s);
  const tr = (c) => Gi(c.map(([x, y]) => [x - o, y - o]));
  return { body: sh.body.map(tr).join(""), eyes: sh.eyes.map(tr) };
}
function shapePath(opts) {                   // original `H_`: <path> of the fitted silhouette (rings / masks)
  const o = opts || {};
  const body = canonShape(o.shape), size = o.size || 64, paint = o.paint || "#000", inflate = o.inflate || 0;
  const d = shapeOutline(Xa(body), body, size, fitFill(body, o.fill)).body;
  const stroke = inflate > 0 ? ` stroke="${paint}" stroke-width="${Yh(2 * inflate)}" stroke-linejoin="round"` : "";
  return `<path d="${d}" fill="${paint}"${stroke}/>`;
}
function stillSVG(opts) {                    // original `jM`: standalone SVG still of a shape, fitted
  const o = opts || {};
  const body = canonShape(o.shape), n = o.size || 64, f = fitFill(body, o.fill);
  const i = n * _r(f), a = Yh((i - n) / 2);
  const ink = typeof o.ink === "string" ? cleanPaint(o.ink) : "var(--grok-bot-still-ink)";
  const app = { ink: ns, spot: ns, cutout: true, inkPaint: ink };
  const svg = Wh(Xa(body), app, i, o.id || "grok-bot-still", { displaySize: n });
  const style = typeof o.ink === "string" ? "" : `<style>svg{--grok-bot-still-ink:${(o.ink && o.ink.light) || "#000"}}@media (prefers-color-scheme:dark){svg{--grok-bot-still-ink:${(o.ink && o.ink.dark) || "#fff"}}}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="${a} ${a} ${n} ${n}">${style}${svg}</svg>`;
}
const stillDataURI = (opts) => `data:image/svg+xml,${encodeURIComponent(stillSVG(opts))}`;   // original `B_`

function toBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
    return true;
  }
  return !!v;
}


/* ==========================================================================
 *  Custom image avatar (adapted from the app's avatar editor + avatar-source preload)
 *  - EXIF orientation reader (preload `A`/`z`/`b`): used to report orientation and as a fallback
 *    when createImageBitmap({imageOrientation:'from-image'}) is unavailable
 *  - crop model of the editor: { zoom, centerX, centerY } in source pixels, viewport = min(w,h)/zoom,
 *    default = centred zoom 1 (`ha`), clamped to stay inside the image (`ga`)
 *  - decode cap 4096 px (`T`), output downscaled to <= 1024 px (`U`), max file 25 MiB (`_`)
 *  NOT ported: Electron nativeImage / VideoFrame path, AI "generated" avatars, the editor UI itself.
 * ========================================================================== */
const AVATAR_MAX_BYTES = 25 * 1024 * 1024, AVATAR_DECODE_CAP = 4096, AVATAR_OUT_CAP = 1024;
const AVATAR_ZOOM_MIN = 1, AVATAR_ZOOM_MAX = 4;   // editor slider range (app constants live outside the excerpt; assumed)
function exifOrientation(u8) {                      // preload `A` + `z`
  if (u8.length < 2 || u8[0] !== 255 || u8[1] !== 216) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const four = (n) => String.fromCharCode(dv.getUint8(n), dv.getUint8(n + 1), dv.getUint8(n + 2), dv.getUint8(n + 3));
  const standalone = new Set([1, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217]);
  let t = 2;
  while (t + 3 < u8.length) {
    if (dv.getUint8(t) !== 255) { t += 1; continue; }
    const r = dv.getUint8(t + 1);
    if (r === 255) { t += 1; continue; }
    if (standalone.has(r)) { t += 2; continue; }
    if (r === 218) return null;
    const len = dv.getUint16(t + 2);
    if (len < 2) return null;
    const end = Math.min(t + 2 + len, u8.length);
    if (r === 225 && end - t >= 10 && four(t + 4) === "Exif") return tiffOrientation(dv, t + 10, end);
    t += 2 + len;
  }
  return null;
}
function tiffOrientation(dv, n, end) {
  if (n + 8 > end) return null;
  const bom = dv.getUint16(n);
  if (bom !== 18761 && bom !== 19789) return null;
  const le = bom === 18761, o = n + dv.getUint32(n + 4, le);
  if (o + 2 > end) return null;
  const count = dv.getUint16(o, le);
  for (let a = 0; a < count; a++) {
    const c = o + 2 + a * 12;
    if (c + 12 > end) return null;
    if (dv.getUint16(c, le) !== 274) continue;
    if (dv.getUint16(c + 2, le) !== 3) return null;
    const v = dv.getUint16(c + 8, le);
    return v >= 1 && v <= 8 ? v : null;
  }
  return null;
}
// orientation -> canvas transform [a,b,c,d,e,f] for a (w x h) source; returns also output size
function orientationTransform(o, w, h) {
  const swap = o >= 5;
  const T = { 1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
              5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[o] || [1, 0, 0, 1, 0, 0];
  return { m: T, width: swap ? h : w, height: swap ? w : h };
}
function defaultCrop(w, h) { return { zoom: 1, centerX: w / 2, centerY: h / 2 }; }   // editor `ha`
function clampCrop(c, w, h) {                                                          // editor `ga`
  const zoom = Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, c.zoom || 1));
  const half = Math.min(w, h) / zoom / 2;
  return { zoom, centerX: Math.min(w - half, Math.max(half, c.centerX ?? w / 2)), centerY: Math.min(h - half, Math.max(half, c.centerY ?? h / 2)) };
}
async function decodeImageSource(src) {
  let blob;
  if (typeof Blob !== "undefined" && src instanceof Blob) blob = src;
  else blob = await (await fetch(String(src))).blob();
  if (blob.size === 0 || blob.size > AVATAR_MAX_BYTES) throw new Error("GrokBotMark: image empty or larger than 25 MiB");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const orientation = exifOrientation(bytes);
  let bitmap, usedNative = true;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });   // browser applies EXIF
  } catch (e) {
    usedNative = false;                                                            // fallback: decode raw, rotate with the ported EXIF reader
    const raw = await createImageBitmap(blob);
    const tr = orientationTransform(orientation || 1, raw.width, raw.height);
    const cv = document.createElement("canvas"); cv.width = tr.width; cv.height = tr.height;
    cv.getContext("2d").setTransform(...tr.m); cv.getContext("2d").drawImage(raw, 0, 0);
    bitmap = cv;
  }
  const cap = Math.min(1, AVATAR_DECODE_CAP / Math.max(bitmap.width, bitmap.height));
  return { bitmap, width: bitmap.width, height: bitmap.height, orientation, usedNative, scale: cap };
}
function renderCrop(decoded, crop, outPx) {                // editor `ja`: crop square -> canvas
  const { width: w, height: h } = decoded;
  const c = clampCrop(crop || defaultCrop(w, h), w, h);
  const side = Math.min(w, h) / c.zoom;
  const out = Math.max(16, Math.min(AVATAR_OUT_CAP, Math.round(outPx)));
  const cv = document.createElement("canvas"); cv.width = out; cv.height = out;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(decoded.bitmap, c.centerX - side / 2, c.centerY - side / 2, side, side, 0, 0, out, out);
  return { canvas: cv, crop: c };
}
async function prepareImage(src, opts) {
  const o = opts || {};
  const decoded = await decodeImageSource(src);
  const { canvas, crop } = renderCrop(decoded, o.crop, o.resolution || 256);
  return { dataUrl: canvas.toDataURL("image/png"), width: decoded.width, height: decoded.height, orientation: decoded.orientation, crop, decoded };
}

function mountMark(target, options) {
  const host = typeof target === "string" ? document.querySelector(target) : target;
  if (!host) throw new Error("GrokBotMark.mount: target element not found");
  const opts = Object.assign(
    {
      size: 96,
      color: "black",
      eyeColor: undefined,
      face: null,
      state: "idle",
      follow: true,
      hover: true,
      clickPoke: true,
      autoBlink: true,
      maxFrameRate: 120,
      paused: false,
      reducedMotion: "auto",
      shape: "blob",          // any of GrokBotMark.SHAPES or GrokBotMark.BODIES
      theme: "light",         // 'light' | 'dark' | 'auto' (follows prefers-color-scheme)
      look: "flat",           // 'flat' | 'shaded' (3D lit extrusion/graticule "proof" render) | 'glow' (radial body gradient)
      glow: undefined,        // optional { inner, mid, rim, halo } as [r,g,b] 0..1
      image: null,            // custom image avatar (URL / File / Blob / dataURL)
      imageCrop: null,        // { zoom, centerX, centerY } in source pixels
      fit: "auto",            // 'auto' per-shape fit scaling (original Xh) | 'none' constant 0.92 | number = constant fill
      emphasis: false,        // emphasis mode: pins the face to 'surprised' when the state has no face
    },
    options || {},
  );

  const uid = `grok-bot-${++uidCounter}`;
  const root = document.createElement("span");
  root.className = "grok-bot-mark";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Grok Bot");
  const inner = document.createElement("span");
  const sizeCss = (v) => (typeof v === "number" ? `${v}px` : String(v));
  const applySize = () => {
    root.style.cssText =
      `display:inline-block;position:relative;flex-shrink:0;line-height:0;` +
      `width:${sizeCss(opts.size)};height:${sizeCss(opts.size)};` +
      (opts.clickPoke ? "cursor:pointer;" : "") +
      "-webkit-tap-highlight-color:transparent;touch-action:manipulation;";
  };
  applySize();
  inner.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;";
  let curFill = 0;
  const setInnerFill = (fill) => {
    if (fill === curFill) return;
    curFill = fill;
    const pct = `${_r(fill) * 100}%`;
    inner.style.width = pct; inner.style.height = pct;
  };
  root.appendChild(inner);
  host.appendChild(root);

  // ---- engine objects -------------------------------------------------------
  const mark = oh({ body: canonShape(opts.shape) });
  let reduced = opts.reducedMotion === "auto" ? prefersReducedMotion() : !!opts.reducedMotion;
  let userPaused = !!opts.paused;
  let destroyed = false;
  let width = typeof opts.size === "number" ? opts.size : root.getBoundingClientRect().width;
  const isPlaying = () => !userPaused && !reduced;
  const startState = zu[opts.state] ? opts.state : "idle";
  const ctrl = zw(mark, startState, {
    seed: hashString(uid),
    isCompact: width < COMPACT_PX,
    isResting: !isPlaying(),
  });
  let themeMode = opts.theme;
  const curTheme = () => (themeMode === "auto" ? (prefersDark() ? "dark" : "light") : themeMode === "dark" ? "dark" : "light");
  let appearance = makeAppearance(opts.color, opts.eyeColor, curTheme());
  let userFace = null;
  let look = opts.look;
  const applyLook = () => { mark.setGlow(look === "glow" ? makeGlow(appearance.inkRGB, opts.glow) : null); };
  const rebuildAppearance = () => { appearance = makeAppearance(opts.color, opts.eyeColor, curTheme()); applyLook(); lastSvg = ""; };
  applyLook();
  if (opts.emphasis) ctrl.setEmphasis(true);

  // ---- fit scaling ------------------------------------------------------------
  // fit 'auto' (default): each body is drawn at its fitted fill (`Xh`). While morphing the fills of the blended bodies
  // are mixed by morph weight (extension: the original has no live fit, it mounts the mark at a constant fill).
  // fit 'none': constant fill 0.92 exactly like the original live component. fit <number>: that constant fill.
  let fitMode = opts.fit;
  const fillFor = (frame) => {
    if (typeof fitMode === "number") return fitMode;
    if (fitMode === "none") return FIT_TARGET_FILL;
    let sw = 0, sf = 0;
    for (const { body, weight } of frame.bodies) { sw += weight; sf += weight * fitFill(body); }
    return sw > 0 ? sf / sw : FIT_TARGET_FILL;
  };

  // ---- rendering ------------------------------------------------------------
  let lastSvg = "";
  function render() {
    if (destroyed) return;
    const size = width;
    const frame = mark.frame();
    const fill = fillFor(frame);
    setInnerFill(fill);
    const D = Math.round(size * _r(fill) * 100) / 100;
    if (D <= 0) return;
    const svg = Wh(frame, appearance, D, uid, {
      isProof: look === "shaded",
      displaySize: size > 0 ? size : D,
      extent: "100%",
    });
    if (svg !== lastSvg) {
      lastSvg = svg;
      AM(inner, svg);
    }
  }
  function settleStatic() {
    // static pose (reduced motion): rest clip, no gaze, let face/morph transitions finish, render once
    mark.setGaze(null);
    mark.seek(0);
    for (let i = 0; i < 60; i++) mark.advance(0.1);
    render();
  }

  // ---- frame loop (same structure as the original component) ---------------
  let raf = 0, last = 0, running = false, visible = true, io = null;
  const frameMs = () => 1000 / Math.max(1, opts.maxFrameRate);
  function tick(now) {
    raf = 0;
    if (destroyed) return;
    if (now - last < frameMs() - 1) { raf = requestAnimationFrame(tick); return; }
    const dt = (now - last) / 1000;
    last = now;
    if (!document.hidden) {
      if (isPlaying()) ctrl.advance(dt);
      mark.advance(dt);
    }
    render();
    if (!isPlaying() && mark.isSettled) { running = false; return; }
    raf = requestAnimationFrame(tick);
  }
  function wake() {
    if (destroyed || running || !visible || reduced) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function refresh() {
    if (destroyed) return;
    if (reduced) { settleStatic(); return; }
    render();
    wake();
  }
  function applyMotionMode() {
    ctrl.setResting(!isPlaying());     // same as the original: paused == resting pose (hover/follow gaze still works)
    if (reduced) settleStatic(); else refresh();
  }
  if (!isPlaying()) { reduced ? settleStatic() : render(); } else render();
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1]?.isIntersecting ?? true;
      if (visible) wake();
      else { cancelAnimationFrame(raf); raf = 0; running = false; }
    });
    io.observe(root);
  }
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (w !== width) { width = w; ctrl.setCompact(w < COMPACT_PX); refresh(); }
    });
    ro.observe(root);
  }
  let mq = null;
  const onMq = () => {
    if (opts.reducedMotion !== "auto") return;
    reduced = prefersReducedMotion();
    applyMotionMode();
  };
  if (opts.reducedMotion === "auto" && typeof window.matchMedia === "function") {
    mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener && mq.addListener(onMq);
  }

  let mqDark = null;
  const onMqDark = () => { if (themeMode === "auto") { rebuildAppearance(); refresh(); } };
  if (typeof window.matchMedia === "function") {
    mqDark = window.matchMedia("(prefers-color-scheme: dark)");
    mqDark.addEventListener ? mqDark.addEventListener("change", onMqDark) : mqDark.addListener && mqDark.addListener(onMqDark);
  }

  // ---- pointer: global follow + hover gaze ---------------------------------
  const onWindowMove = (ev) => {
    if (reduced) return;
    mark.setGaze(rw(root.getBoundingClientRect(), { x: ev.clientX, y: ev.clientY }, FOLLOW_GAZE_RADIUS));
    wake();
  };
  let hovering = false;
  const onHoverMove = (ev) => {
    if (reduced || opts.follow || !opts.hover) return;
    const r = root.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) { onHoverLeave(); return; }
    hovering = true;
    mark.setGaze(rw(r, { x: ev.clientX, y: ev.clientY }, HOVER_GAZE_RADIUS));
    wake();
  };
  const onHoverLeave = () => {
    if (hovering && !opts.follow) { mark.setGaze(null); wake(); }
    hovering = false;
  };
  const onClick = () => { if (opts.clickPoke) api.poke(); };
  root.addEventListener("pointermove", onHoverMove, { passive: true });
  root.addEventListener("pointerleave", onHoverLeave);
  root.addEventListener("click", onClick);
  let followOn = false;
  function setFollowInternal(v) {
    opts.follow = !!v;
    mark.setGazeAlways(opts.follow);
    if (opts.follow && !followOn) { window.addEventListener("pointermove", onWindowMove, { passive: true }); followOn = true; }
    if (!opts.follow && followOn) { window.removeEventListener("pointermove", onWindowMove); followOn = false; mark.setGaze(null); }
    wake();
  }

  // ---- auto blink (random interval) ----------------------------------------
  let api_setCrop = null;
  let blinkTimer = 0;
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    if (!opts.autoBlink || destroyed) return;
    blinkTimer = setTimeout(() => {
      if (!destroyed && isPlaying() && !document.hidden && visible) { mark.blink(); wake(); }
      scheduleBlink();
    }, 2500 + Math.random() * 4500);
  }

  // ---- custom image avatar ---------------------------------------------------
  let avatarEl = null, avatarDecoded = null, avatarCrop = null, avatarSeq = 0;
  function showAvatar(dataUrl) {
    if (!avatarEl) {
      avatarEl = document.createElement("img");
      avatarEl.alt = "";
      avatarEl.draggable = false;
      avatarEl.style.cssText = `position:absolute;left:${(1 - AVATAR_FILL) * 50}%;top:${(1 - AVATAR_FILL) * 50}%;width:${AVATAR_FILL * 100}%;height:${AVATAR_FILL * 100}%;border-radius:50%;object-fit:cover;pointer-events:none;`;
      root.appendChild(avatarEl);
    }
    avatarEl.src = dataUrl;
    inner.style.display = "none";
  }
  async function setImageInternal(src, crop) {
    const seq = ++avatarSeq;
    if (src == null) {
      if (avatarEl) { avatarEl.remove(); avatarEl = null; }
      avatarDecoded = null; inner.style.display = ""; lastSvg = ""; refresh(); return api;
    }
    const decoded = await decodeImageSource(src);
    if (seq !== avatarSeq || destroyed) return api;
    avatarDecoded = decoded;
    avatarCrop = clampCrop(crop || defaultCrop(decoded.width, decoded.height), decoded.width, decoded.height);
    const px = Math.ceil((width || 96) * (window.devicePixelRatio || 1) * 1.5);
    showAvatar(renderCrop(decoded, avatarCrop, px).canvas.toDataURL("image/png"));
    return api;
  }
  api_setCrop = (crop) => {                                  // re-crop the loaded image (zoom / pan)
    if (!avatarDecoded) return;
    avatarCrop = clampCrop({ ...avatarCrop, ...crop }, avatarDecoded.width, avatarDecoded.height);
    const px = Math.ceil((width || 96) * (window.devicePixelRatio || 1) * 1.5);
    showAvatar(renderCrop(avatarDecoded, avatarCrop, px).canvas.toDataURL("image/png"));
  };
  // ---- public instance API -------------------------------------------------
  const api = {
    element: root,
    get face() { return mark.face; },
    get state() { return ctrl.state; },
    get reducedMotion() { return reduced; },
    setFace(name, o) {
      if (name == null || name === "auto") {
        userFace = null;
        mark.holdFace(zu[ctrl.state].face ?? null);
      } else {
        userFace = Pk(String(name));
        mark.holdFace(userFace);
      }
      refresh();
      return api;
    },
    setState(name) {
      const s = zu[name] ? name : (FACE_ALIASES[name] && zu[FACE_ALIASES[name]] ? FACE_ALIASES[name] : null);
      if (s == null) { console.warn(`GrokBotMark: unknown state "${name}"`); return api; }
      ctrl.setState(s);
      if (userFace != null) mark.holdFace(userFace);
      refresh();
      return api;
    },
    blink() { mark.blink(); refresh(); return api; },
    poke(kind, o) {
      if (reduced) return api;
      const k = POKES.includes(kind) ? kind : POKES[Math.floor(Math.random() * POKES.length)];
      const turns = Math.max(1, Math.round((o && o.turns) || 1));
      if (avatarEl && avatarEl.animate) {           // image avatars: same poke durations as the engine (nh)
        const dur = nh({ poke: k, turns }) * 1000;
        const kf = k === "spin" ? [{ transform: "rotate(0)" }, { transform: `rotate(${360 * turns}deg)` }]
          : k === "bounce" ? [{ transform: "translateY(0) scale(1,1)" }, { transform: "translateY(-14%) scale(.94,1.06)", offset: 0.4 }, { transform: "translateY(0) scale(1.08,.9)", offset: 0.82 }, { transform: "translateY(0) scale(1,1)" }]
          : [{ transform: "rotateX(0)" }, { transform: "rotateX(16deg) translateY(4%)", offset: 0.5 }, { transform: "rotateX(0)" }];
        avatarEl.animate(kf, { duration: dur, easing: "ease-in-out" });
        return api;
      }
      mark.poke(k, { turns });
      refresh();
      return api;
    },
    look(dir) { mark.look(dir); refresh(); return api; },
    gaze(xy) { if (!reduced) { mark.setGaze(xy); refresh(); } return api; },
    setFollow(v) { setFollowInternal(v); return api; },
    setColor(c) { opts.color = c; rebuildAppearance(); refresh(); return api; },
    setEyeColor(c) { opts.eyeColor = c; rebuildAppearance(); refresh(); return api; },
    setTheme(t) { themeMode = t; opts.theme = t; rebuildAppearance(); refresh(); return api; },
    get theme() { return curTheme(); },
    setLook(l, glowOpts) { look = l; if (glowOpts) opts.glow = glowOpts; rebuildAppearance(); refresh(); return api; },
    setShape(name) {
      const body = canonShape(name);
      mark.setBody(body, { isInstant: reduced });   // spring-blended morph (engine `re()` / `ke()`)
      refresh(); return api;
    },
    get shape() { return mark.frame().bodies.slice().sort((a, b2) => b2.weight - a.weight)[0].body; },
    get morphing() { return mark.frame().bodies.length > 1; },
    setEmotion(name) {
      if (!EMOTIONS.includes(name)) { console.warn(`GrokBotMark: unknown emotion "${name}"`); return api; }
      return api.setState(name);
    },
    setScene(name) {
      const st = SCENES[name] || (zu[name] ? name : null);
      if (!st) { console.warn(`GrokBotMark: unknown scene "${name}"`); return api; }
      return api.setState(st);
    },
    setFit(f) { fitMode = f; opts.fit = f; lastSvg = ""; refresh(); return api; },
    get fill() { return curFill; },
    setEmphasis(v) { opts.emphasis = !!v; ctrl.setEmphasis(!!v); refresh(); return api; },
    get compact() { return width < COMPACT_PX; },
    get clip() { return ctrl.clip; },
    setImage(src, crop) { return setImageInternal(src, crop); },
    setImageCrop(crop) { api_setCrop && api_setCrop(crop); return api; },
    get imageCrop() { return avatarCrop; },
    clearImage() { return setImageInternal(null); },
    get hasImage() { return !!avatarEl; },
    setSize(s) {
      opts.size = s; applySize();
      width = typeof s === "number" ? s : root.getBoundingClientRect().width;
      ctrl.setCompact(width < COMPACT_PX); refresh(); return api;
    },
    setAutoBlink(v) { opts.autoBlink = !!v; scheduleBlink(); return api; },
    setClickPoke(v) { opts.clickPoke = !!v; applySize(); return api; },
    pause() { userPaused = true; applyMotionMode(); return api; },
    play() { userPaused = false; applyMotionMode(); return api; },
    destroy() {
      if (destroyed) return;
      if (mqDark) { mqDark.removeEventListener ? mqDark.removeEventListener("change", onMqDark) : mqDark.removeListener && mqDark.removeListener(onMqDark); }
      destroyed = true;
      cancelAnimationFrame(raf); clearTimeout(blinkTimer);
      window.removeEventListener("pointermove", onWindowMove);
      root.removeEventListener("pointermove", onHoverMove);
      root.removeEventListener("pointerleave", onHoverLeave);
      root.removeEventListener("click", onClick);
      io && io.disconnect(); ro && ro.disconnect();
      if (mq) { mq.removeEventListener ? mq.removeEventListener("change", onMq) : mq.removeListener && mq.removeListener(onMq); }
      root.remove();
    },
    // test hook: advance the simulation deterministically by `seconds`
    _step(seconds, dt = 1 / 60) {
      for (let t = 0; t < seconds; t += dt) { if (isPlaying()) ctrl.advance(dt); mark.advance(dt); }
      render(); return api;
    },
  };

  if (opts.face) { userFace = Pk(String(opts.face)); mark.holdFace(userFace); }
  setFollowInternal(toBool(opts.follow, true));
  if (reduced) settleStatic(); else { render(); wake(); }
  scheduleBlink();
  if (opts.image) setImageInternal(opts.image, opts.imageCrop).catch((e) => console.warn(e));
  return api;
}

/* ---- <grok-bot-mark> custom element ------------------------------------- */
function defineElement(tag) {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") return null;
  const name = tag || "grok-bot-mark";
  if (customElements.get(name)) return customElements.get(name);
  class GrokBotMarkElement extends HTMLElement {
    static get observedAttributes() {
      return ["size", "color", "eye-color", "face", "state", "follow", "autoblink", "click-poke", "paused", "shape", "theme", "look", "image", "emphasis", "fit"];
    }
    constructor() {
      super();
      this._mark = null;
      this._shadow = this.attachShadow({ mode: "open" });
      this._shadow.innerHTML = `<style>:host{display:inline-block;line-height:0;vertical-align:middle}</style><span part="stage"></span>`;
    }
    _opts() {
      const g = (n) => this.getAttribute(n);
      const size = g("size");
      return {
        size: size == null || size === "" ? 96 : (/^\d+(\.\d+)?$/.test(size) ? parseFloat(size) : size),
        color: g("color") || "black",
        eyeColor: g("eye-color") || undefined,
        face: g("face") || null,
        state: g("state") || "idle",
        follow: this.hasAttribute("follow") ? toBool(g("follow"), true) : true,
        autoBlink: this.hasAttribute("autoblink") ? toBool(g("autoblink"), true) : true,
        clickPoke: this.hasAttribute("click-poke") ? toBool(g("click-poke"), true) : true,
        paused: this.hasAttribute("paused") && toBool(g("paused"), true),
        shape: g("shape") || "blob",
        theme: g("theme") || "light",
        look: g("look") || "flat",
        image: g("image") || null,
        emphasis: this.hasAttribute("emphasis") && toBool(g("emphasis"), true),
        fit: (() => { const v = g("fit"); return v == null || v === "auto" ? "auto" : v === "none" ? "none" : (isFinite(+v) ? +v : "auto"); })(),
      };
    }
    connectedCallback() {
      if (this._mark) return;
      this._mark = mountMark(this._shadow.querySelector("[part=stage]"), this._opts());
    }
    disconnectedCallback() {
      if (this._mark) { this._mark.destroy(); this._mark = null; }
    }
    attributeChangedCallback(name, oldV, newV) {
      const m = this._mark;
      if (!m || oldV === newV) return;
      switch (name) {
        case "size": m.setSize(/^\d+(\.\d+)?$/.test(newV || "") ? parseFloat(newV) : (newV || 96)); break;
        case "color": m.setColor(newV || "black"); break;
        case "eye-color": m.setEyeColor(newV || undefined); break;
        case "face": m.setFace(newV || null); break;
        case "state": m.setState(newV || "idle"); break;
        case "follow": m.setFollow(this.hasAttribute("follow") ? toBool(newV, true) : true); break;
        case "autoblink": m.setAutoBlink(this.hasAttribute("autoblink") ? toBool(newV, true) : true); break;
        case "click-poke": m.setClickPoke(this.hasAttribute("click-poke") ? toBool(newV, true) : true); break;
        case "shape": m.setShape(newV || "blob"); break;
        case "theme": m.setTheme(newV || "light"); break;
        case "look": m.setLook(newV || "flat"); break;
        case "image": m.setImage(newV || null).catch((e) => console.warn(e)); break;
        case "fit": m.setFit(newV == null || newV === "auto" ? "auto" : newV === "none" ? "none" : (isFinite(+newV) ? +newV : "auto")); break;
        case "emphasis": m.setEmphasis(this.hasAttribute("emphasis") && toBool(newV, true)); break;
        case "paused": (this.hasAttribute("paused") && toBool(newV, true)) ? m.pause() : m.play(); break;
      }
    }
    get mark() { return this._mark; }
    setFace(n) { this._mark && this._mark.setFace(n); return this; }
    setState(n) { this._mark && this._mark.setState(n); return this; }
    blink() { this._mark && this._mark.blink(); return this; }
    poke(k, o) { this._mark && this._mark.poke(k, o); return this; }
    look(d) { this._mark && this._mark.look(d); return this; }
    get mark() { return this._mark; }
    setTheme(t) { this._mark && this._mark.setTheme(t); return this; }
    setShape(n) { this._mark && this._mark.setShape(n); return this; }
    setEmotion(n) { this._mark && this._mark.setEmotion(n); return this; }
    setScene(n) { this._mark && this._mark.setScene(n); return this; }
    setImage(src, crop) { return this._mark ? this._mark.setImage(src, crop) : Promise.resolve(this); }
  }
  customElements.define(name, GrokBotMarkElement);
  return GrokBotMarkElement;
}

const GrokBotMark = {
  version: "1.1.0",
  mount: mountMark,
  defineElement,
  FACES,
  STATES,
  POKES,
  SHAPES,            // 25 user-selectable shape names (blob ... star)
  BODIES,            // 25 internal body names (sphere ... leaf)
  COLORS,            // 11 colour ids
  PALETTE,           // { id: { light, dark } } ink per theme
  SWATCHES,          // picker swatch hex per colour id
  EMOTIONS,          // the 17 reaction states
  SCENES,            // scene alias -> state
  STATE_GROUPS,      // lifecycle / reactions / morphs / product / brand
  EYE_BY_THEME,
  gradient: gradientFor,       // 135deg gradient (+ soft tint) for a colour id and theme
  prepareImage,                // File/Blob/URL -> circle-crop-ready square PNG data URL (EXIF aware)
  exifOrientation,
  fitFill,                     // per-shape fit fill (original Xh)
  shapePath,                   // fitted silhouette <path> (original H_)
  stillSVG, stillDataURI,      // fitted standalone still (original jM / B_)
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try { GrokBotMark.defineElement('grok-bot-mark'); } catch (e) {}
}
export { GrokBotMark, mountMark as mount, defineElement };
export default GrokBotMark;
