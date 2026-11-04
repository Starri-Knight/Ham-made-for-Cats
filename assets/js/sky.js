/*!
 * StarriKnight — the painted sky
 * ---------------------------------------------------------------------------
 * Paints a Van Gogh–style sky (swirls, haloed stars, tonight's real moon,
 * rolling hills, a little village and a flame-like cypress) stroke by stroke
 * onto <canvas>, then keeps it alive:
 *   - brushwork that drifts along the swirls (stirred by your cursor)
 *   - stars that twinkle, and light up when you tap them
 *   - tap empty sky to paint a new star; tap star → star to draw constellations
 *   - shooting stars you can catch (and make a wish on)
 *   - the visitor's own time of day and weather, plus seasons and holidays
 *     (skystate.js works those out; this file paints them)
 *   - optional soft chimes per star (sound toggle in the top bar)
 *
 * Plain JavaScript, no build step, no libraries — GitHub Pages serves it as-is.
 * Public API: window.SK.sky  (see the bottom of this file)
 */
(function () {
  'use strict';

  var SK = (window.SK = window.SK || {});

  var TAU = Math.PI * 2;
  var REC = 11; // floats per stroke record: 4 points, width, colour, alpha
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smoothstep = function (e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  var now = function () { return performance.now(); };
  var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var STILL = /[?&]still\b/.test(location.search); // a motionless painting (used for the social preview image)
  var REDUCED = STILL || mq('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------------
   * Palettes, one per time of day. Every palette has the same layout:
   *    0–14 the sky, dark → light     15–19 pinks     20–23 periwinkles
   *   24–27 starlight                 28–35 clouds, dark → light
   * --------------------------------------------------------------------- */
  var PALS = {
    night: ['#140a2e', '#1b0e3d', '#22114e', '#2a1560', '#331a72', '#3d2084', '#482694', '#552ea3', '#6337b1', '#7242bd',
            '#8450c7', '#9a64d3', '#b07fe0', '#c79deb', '#dcbcf3', '#b23f88', '#cd4f9c', '#e262ac', '#f17fbe', '#f9a6d3',
            '#5f63c9', '#7a83e0', '#9aa4ef', '#bcc4f8', '#ffe3ef', '#fff1d6', '#ffe0a0', '#ffc86e'],
    dusk:  ['#170b38', '#1f0f47', '#281356', '#331866', '#3f1e74', '#4c2480', '#5a2a8b', '#6a3194', '#7b389b', '#8d40a0',
            '#a04aa2', '#b456a2', '#c8649f', '#da779b', '#ea8f9a', '#c2477f', '#d85a86', '#ea718a', '#f58f8e', '#fbb19a',
            '#5a5cc0', '#7676d6', '#9592e6', '#b6b0f2', '#fff0dc', '#ffe1b8', '#ffc98a', '#ffad5e'],
    dawn:  ['#1a1442', '#221a52', '#2b2162', '#352971', '#40317f', '#4c3a8b', '#5a4497', '#6950a1', '#7a5daa', '#8c6cb2',
            '#a07cb9', '#b48ebf', '#c8a1c4', '#dab5c9', '#ebcbd1', '#c0628f', '#d47a9f', '#e595b0', '#f1b2c3', '#f9cfd6',
            '#6a72c8', '#8790da', '#a7b0e8', '#c7cdf4', '#fff6ea', '#ffead2', '#ffd9a8', '#ffc282'],
    day:   ['#3a3d98', '#4145a2', '#4a4fad', '#5359b7', '#5d63c0', '#676dc8', '#7378cf', '#7f84d6', '#8c90dc', '#999de2',
            '#a7aae8', '#b5b8ee', '#c4c6f3', '#d4d5f7', '#e5e5fb', '#c45a9c', '#d872b0', '#e88fc2', '#f3acd4', '#fbcbe4',
            '#5f86d8', '#7c9de6', '#9db7f0', '#c1d2f8', '#ffffff', '#fffaf0', '#fff1cf', '#ffe3a6']
  };
  var CLOUDS = {
    night: ['#251c45', '#2f2554', '#3a2f64', '#473a74', '#584985', '#6e5f9c', '#8d7db6', '#b3a5d4'],
    dusk:  ['#3a1f5c', '#4f2a6c', '#68357c', '#82428a', '#a05596', '#c06e9c', '#e08f9e', '#fbb8a6'],
    dawn:  ['#3f3670', '#52487f', '#675b8f', '#7e709f', '#9887b0', '#b4a1c2', '#d2bed4', '#f0dde6'],
    day:   ['#7f7fb8', '#9191c5', '#a4a3d2', '#b7b5de', '#c9c8e9', '#dbd9f2', '#ecebf9', '#ffffff']
  };
  var PAL = PALS.night.concat(CLOUDS.night);
  function lighter(i) {
    if (i <= 14) return Math.min(14, i + 2);
    if (i <= 19) return Math.min(19, i + 1);
    if (i <= 23) return Math.min(23, i + 1);
    if (i <= 27) return 25;
    return Math.min(35, i + 1);
  }
  function isLight(i) { return (i >= 11 && i <= 14) || (i >= 18 && i <= 19) || (i >= 22 && i <= 27) || i >= 33; }

  function rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    if (!t) return a;
    var A = rgb(a), B = rgb(b), o = '#';
    for (var i = 0; i < 3; i++) { var v = Math.round(A[i] + (B[i] - A[i]) * t); o += (v < 16 ? '0' : '') + v.toString(16); }
    return o;
  }
  function rgba(h, a) { var c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* ------------------------------------------------------------------------
   * The look: time of day, weather, moon, season and holiday (from skystate.js)
   * --------------------------------------------------------------------- */
  var WX = {
    clear:   { cover: 0 },
    partly:  { cover: 0.3, mute: 0.05 },
    cloudy:  { cover: 0.72, mute: 0.3 },
    fog:     { cover: 0.3, mute: 0.4, fog: 1 },
    drizzle: { cover: 0.62, mute: 0.3, rain: 0.45 },
    rain:    { cover: 0.78, mute: 0.38, rain: 1 },
    snow:    { cover: 0.64, mute: 0.26, snow: 1 },
    storm:   { cover: 0.86, mute: 0.46, rain: 1.3, storm: 1 }
  };
  var MUTE = { night: '#2b2541', dawn: '#5f5878', dusk: '#4a3b5e', day: '#9c9aba' }; // grey skies lean this way
  var FIXED_MOON = { phase: 0.16, illum: 0.23, waxing: true, name: 'Waxing crescent' };
  var TONE = { // how each time of day mixes its colours
    night: { pink: 0.7, blue: 0.10, lift: 0, halo: 1, glow: 1 },
    dusk:  { pink: 1.15, blue: 0.06, lift: 0.02, halo: 0.75, glow: 0.75 },
    dawn:  { pink: 0.95, blue: 0.16, lift: 0.04, halo: 0.75, glow: 0.75 },
    day:   { pink: 0.4, blue: 0.3, lift: 0.04, halo: 1, glow: 1 }
  };

  function readLook() {
    var s = (!STILL && SK.skyState) || {};
    var time = /^(night|dawn|day|dusk)$/.test(s.time) ? s.time : 'night';
    var weather = WX[s.weather] ? s.weather : 'clear';
    return {
      time: time, weather: weather, wx: WX[weather],
      wind: typeof s.wind === 'number' ? s.wind : 8,
      moon: s.moon || FIXED_MOON, south: !!s.south,
      season: s.season || '', holiday: s.holiday || ''
    };
  }
  function lookKey(L) { return [L.time, L.weather, L.season, L.holiday, L.south ? 's' : 'n', Math.round(L.moon.phase * 40)].join('|'); }
  function paletteFor(L) {
    var base = PALS[L.time].concat(CLOUDS[L.time]), m = L.wx.mute || 0;
    if (!m) return base;
    var to = MUTE[L.time];
    if (L.wx.snow) to = mix(to, '#ffffff', 0.25);
    if (L.wx.storm) to = mix(to, '#000000', 0.35);
    var heavy = L.wx.storm || L.wx.rain; // rain clouds come out greyer than the sky around them
    return base.map(function (h, i) { return mix(h, to, i >= 24 && i <= 27 ? m * 0.3 : i >= 28 && heavy ? Math.min(0.85, m * 1.5) : m); });
  }

  /* ------------------------------------------------------------------------
   * Seeded randomness + smooth value noise
   * --------------------------------------------------------------------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed) {
    var r = mulberry32(seed), perm = new Uint8Array(512), vals = new Float32Array(256), p = [], i;
    for (i = 0; i < 256; i++) { vals[i] = r(); p.push(i); }
    for (i = 255; i > 0; i--) { var j = (r() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var X = xi & 255, Y = yi & 255;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = vals[perm[X + perm[Y]]], b = vals[perm[X + 1 + perm[Y]]];
      var c = vals[perm[X + perm[Y + 1]]], d = vals[perm[X + 1 + perm[Y + 1]]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  function pick(arr, r) { return arr[(r() * arr.length) | 0]; }

  /* ------------------------------------------------------------------------
   * Composition — where the swirls, stars, moon, sun, hills, village and
   * cypress sit. Landscape screens follow the painting; portrait screens
   * mirror it so the cypress and the text don't fight for the same corner.
   * --------------------------------------------------------------------- */
  function compose(W, H, L) {
    var portrait = H > W * 1.05;
    var D = Math.sqrt(W * H);
    var c = { W: W, H: H, portrait: portrait, D: D, tone: TONE[L.time] };
    c.brush = clamp(D * 0.0052, 2.7, 5.2);
    var hz = H * (portrait ? 0.80 : 0.75);
    c.horizon = hz;
    c.farTop = function (x) {
      var u = x / W;
      return hz - H * (0.028 + 0.026 * Math.sin(Math.PI * (u * 1.1 + (portrait ? 0.55 : 0.15))))
                - H * 0.009 * Math.sin(TAU * u * 1.9 + 1.3);
    };
    c.valleyTop = function (x) { var u = x / W; return hz + H * 0.040 + H * 0.007 * Math.sin(TAU * u * 1.3 + 0.5); };
    c.nearTop = function (x) { var u = x / W; return H * (portrait ? 0.935 : 0.93) + H * 0.016 * Math.sin(TAU * u * 0.8 + 2.4); };

    var S = function (nx, ny, r, spin, inward, phase) {
      return { x: nx * W, y: ny * H, r: r * D, spin: spin, inward: inward, phase: phase };
    };
    if (!portrait) {
      c.swirls = [
        S(0.43, 0.30, 0.165, 1, 0.22, 0.0),
        S(0.61, 0.25, 0.100, -1, 0.18, 1.3),
        S(0.23, 0.16, 0.070, 1, 0.20, 2.1),
        S(0.72, 0.07, 0.055, -1, 0.20, 0.6),
        S(0.29, 0.52, 0.060, -1, 0.20, 2.7)
      ];
      c.moon = { x: 0.86 * W, y: 0.15 * H, r: 0.030 * D };
      c.starSpots = [[0.07, 0.11, 1.0], [0.16, 0.37, 0.8], [0.31, 0.07, 0.9], [0.37, 0.50, 0.65], [0.53, 0.12, 0.85],
                     [0.66, 0.45, 0.7], [0.75, 0.21, 0.7], [0.95, 0.33, 0.8], [0.84, 0.45, 0.6], [0.11, 0.62, 0.55], [0.48, 0.60, 0.5]];
      c.cypress = { x: 0.11 * W, base: H * 1.01, top: 0.09 * H, width: Math.min(0.09 * W, 0.15 * H), lean: 1 };
      c.village = { x0: 0.27 * W, x1: 0.93 * W };
      c.lit = 1; // moonlight comes from the right
    } else {
      c.swirls = [
        S(0.57, 0.24, 0.175, 1, 0.22, 0.0),
        S(0.23, 0.36, 0.100, -1, 0.18, 1.3),
        S(0.88, 0.09, 0.070, -1, 0.20, 2.1),
        S(0.80, 0.47, 0.070, 1, 0.20, 0.6)
      ];
      c.moon = { x: 0.19 * W, y: 0.11 * H, r: 0.046 * D };
      c.starSpots = [[0.46, 0.06, 0.9], [0.72, 0.07, 0.8], [0.93, 0.27, 0.8], [0.08, 0.25, 0.7], [0.41, 0.42, 0.7],
                     [0.92, 0.39, 0.65], [0.07, 0.50, 0.6], [0.62, 0.55, 0.55], [0.33, 0.15, 0.6]];
      c.cypress = { x: 0.88 * W, base: H * 1.01, top: 0.47 * H, width: 0.21 * W, lean: -1 };
      c.village = { x0: 0.05 * W, x1: 0.74 * W };
      c.lit = -1; // moonlight comes from the left
    }
    if (L.holiday === 'midautumn') c.moon.r *= 1.3; // the big harvest moon

    // the stars come out with the dark: none by day, the brightest at twilight
    var spots = L.time === 'day' ? [] : L.time === 'night' ? c.starSpots : c.starSpots.filter(function (s) { return s[2] >= 0.7; });
    var shrink = L.time === 'night' ? 1 : 0.85;
    c.stars = spots.map(function (s, i) {
      var rc = c.brush * 1.55 * s[2] * shrink;
      return { x: s[0] * W, y: s[1] * H, size: s[2], rc: rc, h: rc * 4.4, spin: i % 2 ? -1 : 1 };
    });
    c.halos = c.stars.map(function (s) { return { x: s.x, y: s.y, h: s.h, spin: s.spin, w: c.tone.halo }; });
    c.moonUp = L.time !== 'day';
    if (c.moonUp) c.halos.push({ x: c.moon.x, y: c.moon.y, h: c.moon.r * 1.7, spin: 1, w: (0.45 + 0.55 * L.moon.illum) * c.tone.halo });
    if (L.time === 'day') c.sun = { x: c.moon.x, y: c.moon.y + c.moon.r * 0.3, r: c.moon.r * 1.3, low: false };
    else if (L.time !== 'night') {
      var sx = W * (L.time === 'dusk' ? 0.66 : 0.3);
      c.sun = { x: sx, y: c.farTop(sx) + c.moon.r * 0.15, r: c.moon.r * 1.5, low: true };
    }
    if (c.sun) c.halos.push({ x: c.sun.x, y: c.sun.y, h: c.sun.r * 2.1, spin: -1, w: 1.15, sun: true });
    c.clouds = makeClouds(c, L);
    return c;
  }

  /* ------------------------------------------------------------------------
   * Clouds — soft banks shaped by noise, with gaps around the stars, the moon
   * and the sun so they always peek through
   * --------------------------------------------------------------------- */
  function makeClouds(c, L) {
    var cover = L.wx.cover || 0;
    if (!cover) return null;
    var r = mulberry32(4242 + Math.round(cover * 100)), blobs = [];
    var n = Math.round((c.portrait ? 2 : 3) + cover * (c.portrait ? 6 : 9));
    for (var i = 0; i < n; i++) {
      var w = c.W * (c.portrait ? 0.5 : 0.24) * (0.65 + r() * 0.7) * (0.75 + cover * 0.5);
      blobs.push({ x: r() * c.W, y: c.horizon * (0.08 + r() * 0.62), rx: w * 0.5, ry: w * (0.13 + r() * 0.09) });
    }
    return { blobs: blobs, cover: cover, scale: c.D * 0.16 };
  }
  function cloudAt(c, nz, x, y) {
    var cl = c.clouds;
    if (!cl) return 0;
    var d = 0, i, b, dx, dy, q;
    for (i = 0; i < cl.blobs.length; i++) {
      b = cl.blobs[i]; dx = (x - b.x) / b.rx; dy = (y - b.y) / b.ry; q = dx * dx + dy * dy;
      if (q < 1.8) d = Math.max(d, 1 - q / 1.8);
    }
    var s = cl.scale, n1 = nz(x / s + 13.7, y / s + 5.3);
    d = d * 1.15 + (n1 - 0.5) * 0.6;
    if (cl.cover > 0.5) d = Math.max(d, (nz(x / (s * 2.6) + 31.1, y / (s * 2.6) + 17.9) - (1.05 - cl.cover)) * 2.4 + (n1 - 0.5) * 0.4);
    d *= 1 - 0.45 * smoothstep(c.horizon * 0.78, c.horizon, y);
    for (i = 0; i < c.halos.length; i++) {
      var h = c.halos[i], hx = x - h.x, hy = y - h.y, dd = Math.sqrt(hx * hx + hy * hy);
      if (dd < h.h * 1.5) d *= smoothstep(h.h * 0.45, h.h * 1.5, dd);
    }
    return clamp(d, 0, 1);
  }

  /* ------------------------------------------------------------------------
   * Flow field — a gentle current plus vortices (the swirls) and concentric
   * rings around each star. Precomputed into a grid, sampled bilinearly.
   * --------------------------------------------------------------------- */
  function flowAt(c, nz, x, y) {
    var u = x / c.W, v = y / c.H;
    var a = 0.30 * Math.sin(TAU * (u * 1.05 + v * 0.55) + 0.7)
          + 0.16 * Math.sin(TAU * (u * 2.4 - v * 1.3) + 2.1)
          + (nz(u * 2.6, v * 2.6) - 0.5) * 0.9;
    a *= 1 - 0.6 * smoothstep(c.horizon * 0.72, c.horizon, y);
    var vx = Math.cos(a), vy = Math.sin(a) * 0.85, tx = 0, ty = 0, wsum = 0, i, s, dx, dy, d2, d, w;
    for (i = 0; i < c.swirls.length; i++) {
      s = c.swirls[i]; dx = x - s.x; dy = y - s.y; d2 = dx * dx + dy * dy;
      w = Math.exp(-d2 / (s.r * s.r));
      if (w < 0.003) continue;
      d = Math.sqrt(d2) + 0.001;
      tx += w * ((-dy / d) * s.spin - (dx / d) * s.inward);
      ty += w * ((dx / d) * s.spin - (dy / d) * s.inward);
      wsum += w;
    }
    for (i = 0; i < c.halos.length; i++) {
      s = c.halos[i]; dx = x - s.x; dy = y - s.y; d2 = dx * dx + dy * dy;
      var R = s.h * 1.35;
      w = Math.exp(-d2 / (R * R)) * 1.3;
      if (w < 0.003) continue;
      d = Math.sqrt(d2) + 0.001;
      tx += w * (-dy / d) * s.spin;
      ty += w * (dx / d) * s.spin;
      wsum += w;
    }
    var keep = Math.max(0, 1 - Math.min(1, wsum));
    vx = vx * keep + tx; vy = vy * keep + ty;
    var m = Math.sqrt(vx * vx + vy * vy) || 1;
    return [vx / m, vy / m];
  }

  function buildField(c, nz) {
    var cell = Math.max(4, Math.round(c.brush * 1.25));
    var gw = Math.ceil(c.W / cell) + 2, gh = Math.ceil(c.H / cell) + 2;
    var fx = new Float32Array(gw * gh), fy = new Float32Array(gw * gh);
    for (var j = 0; j < gh; j++) {
      for (var i = 0; i < gw; i++) {
        var f = flowAt(c, nz, i * cell, j * cell);
        fx[j * gw + i] = f[0]; fy[j * gw + i] = f[1];
      }
    }
    return {
      sample: function (x, y, out) {
        var gx = x / cell, gy = y / cell;
        if (gx < 0) gx = 0; else if (gx > gw - 1.001) gx = gw - 1.001;
        if (gy < 0) gy = 0; else if (gy > gh - 1.001) gy = gh - 1.001;
        var i = gx | 0, j = gy | 0, u = gx - i, v = gy - j, k = j * gw + i;
        var ax = fx[k] + (fx[k + 1] - fx[k]) * u, bx = fx[k + gw] + (fx[k + gw + 1] - fx[k + gw]) * u;
        var ay = fy[k] + (fy[k + 1] - fy[k]) * u, by = fy[k + gw] + (fy[k + gw + 1] - fy[k + gw]) * u;
        var vx = ax + (bx - ax) * v, vy = ay + (by - ay) * v;
        var m = Math.sqrt(vx * vx + vy * vy) || 1;
        out[0] = vx / m; out[1] = vy / m;
      },
      /* recompute part of the grid (after a new star joins the flow) */
      refresh: function (x0, y0, x1, y1) {
        var i0 = Math.max(0, Math.floor(x0 / cell)), i1 = Math.min(gw - 1, Math.ceil(x1 / cell));
        var j0 = Math.max(0, Math.floor(y0 / cell)), j1 = Math.min(gh - 1, Math.ceil(y1 / cell));
        for (var j = j0; j <= j1; j++) {
          for (var i = i0; i <= i1; i++) { var f = flowAt(c, nz, i * cell, j * cell); fx[j * gw + i] = f[0]; fy[j * gw + i] = f[1]; }
        }
      }
    };
  }

  /* ------------------------------------------------------------------------
   * Colour model — lightness rises toward the horizon, swirls get spiral
   * bands of lilac and pink, stars (and the sun) get concentric halo rings.
   * --------------------------------------------------------------------- */
  function toneAt(c, nz, x, y, r, lift) {
    var K = c.tone, t = clamp(y / c.horizon, 0, 1);
    var L = 0.12 + 0.46 * Math.pow(t, 1.7) + (lift || 0) + K.lift;
    var pink = smoothstep(0.55, 1.0, t) * K.pink;
    var blue = K.blue;
    var u = x / c.W, v = y / c.H, i, s, dx, dy, d2, d, w;
    L += (nz(u * 3.1 + 7, v * 3.1 + 3) - 0.5) * 0.24;
    pink += (nz(u * 2.2 + 40, v * 2.2 + 9) - 0.45) * 0.55;
    blue += (nz(u * 2.7 + 80, v * 2.7 + 21) - 0.55) * 0.55;
    for (i = 0; i < c.swirls.length; i++) {
      s = c.swirls[i]; dx = x - s.x; dy = y - s.y; d2 = dx * dx + dy * dy;
      w = Math.exp(-d2 / (s.r * s.r * 1.1));
      if (w < 0.01) continue;
      d = Math.sqrt(d2);
      var band = Math.sin(d / (s.r * 0.15) - Math.atan2(dy, dx) * s.spin + s.phase);
      var eye = 1 - smoothstep(0, s.r * 0.42, d); // the heart of a swirl glows instead of going dark
      L += w * (band > 0.2 ? 0.46 * band : band < -0.6 ? -0.08 * (1 - eye) : 0.04) + eye * 0.34;
      if (band > 0.55 || eye > 0.5) pink += w * 0.3;
      if (band < -0.2 && eye < 0.3) blue += w * 0.25;
    }
    for (i = 0; i < c.halos.length; i++) {
      s = c.halos[i]; dx = x - s.x; dy = y - s.y; d = Math.sqrt(dx * dx + dy * dy);
      if (d > s.h * 2.6) continue;
      w = Math.exp(-Math.pow(d / (s.h * 1.3), 2));
      var ring = Math.floor(d / (s.h * 0.36));
      L += w * (0.62 - 0.07 * ring) * s.w;
      if (ring % 2 === 1) pink += w * 0.35;
      if (ring % 3 === 2) blue += w * 0.35;
    }
    L = clamp(L + (r() - 0.5) * 0.16, 0, 1);
    if (L > 0.86) return r() < 0.45 ? 25 : r() < 0.5 ? 24 : 14;
    if (L > 0.3 && r() < blue * 0.6) return 20 + Math.min(3, Math.floor(((L - 0.3) / 0.56) * 4));
    if (L > 0.32 && r() < pink) return 15 + Math.min(4, Math.floor(((L - 0.32) / 0.54) * 5));
    return Math.min(14, Math.floor(L * 15.5));
  }

  /* ------------------------------------------------------------------------
   * Stroke generation — each stroke follows the flow for a short distance
   * --------------------------------------------------------------------- */
  function genSkyPass(c, field, nz, r, p) {
    var b = c.brush, sp = b * p.spacing, out = [], tmp = [0, 0];
    for (var gy = -sp; gy < c.H; gy += sp) {
      for (var gx = -sp; gx < c.W + sp; gx += sp) {
        var x = gx + r() * sp, y = gy + r() * sp;
        if (y > c.farTop(x) + b * 2) continue;
        var col = toneAt(c, nz, x, y, r, p.lift);
        if (p.onlyLight && !isLight(col)) continue;
        var len = b * lerp(p.len[0], p.len[1], r()), w = b * lerp(p.width[0], p.width[1], r());
        traceInto(out, field, tmp, x, y, len);
        out.push(w, col, p.alpha);
      }
    }
    return new Float32Array(out);
  }
  /* Clouds: strokes only where a cloud is, lighter on top, darker underneath. */
  function genCloudPass(c, field, nz, r) {
    var b = c.brush, sp = b * 1.2, out = [], tmp = [0, 0], below = b * 7;
    for (var gy = -sp; gy < c.horizon; gy += sp) {
      for (var gx = -sp; gx < c.W + sp; gx += sp) {
        var x = gx + r() * sp, y = gy + r() * sp;
        if (y > c.farTop(x) + b * 2) continue;
        var d = cloudAt(c, nz, x, y);
        if (d < 0.3 || r() > (d - 0.2) * 2.2) continue;
        var lit = clamp((cloudAt(c, nz, x, y + below) - d) * 2.4, -0.3, 0.35);
        var shade = clamp(0.25 + d * 0.4 + lit + (nz(x * 0.011 + 3, y * 0.011 + 9) - 0.5) * 0.5 + (r() - 0.5) * 0.25, 0, 0.999);
        var len = b * lerp(3.2, 6.0, r()), w = b * lerp(0.95, 1.45, r());
        traceInto(out, field, tmp, x, y, len);
        out.push(w, 28 + Math.floor(shade * 8), 0.94);
      }
    }
    return new Float32Array(out);
  }
  function traceInto(out, field, tmp, x, y, len) {
    var ds = len / 3, px = x, py = y;
    field.sample(px, py, tmp); px -= tmp[0] * len * 0.5; py -= tmp[1] * len * 0.5;
    out.push(px, py);
    for (var k = 0; k < 3; k++) { field.sample(px, py, tmp); px += tmp[0] * ds; py += tmp[1] * ds; out.push(px, py); }
  }
  /* Thin, lighter "ridges" laid on top of some strokes, like the raised edge of thick paint. */
  function genRidges(data, r, share) {
    var out = [], n = data.length / REC;
    for (var k = 0; k < n; k++) {
      if (r() > share) continue;
      var o = k * REC, w = data[o + 8];
      var nx = -(data[o + 7] - data[o + 1]), ny = data[o + 6] - data[o];
      var m = Math.sqrt(nx * nx + ny * ny) || 1, off = w * 0.22;
      nx = (nx / m) * off; ny = (ny / m) * off;
      for (var q = 0; q < 8; q += 2) out.push(data[o + q] + nx, data[o + q + 1] + ny);
      out.push(w * 0.34, lighter(data[o + 9]), 0.55);
    }
    return new Float32Array(out);
  }
  function shuffledOrder(n, r) {
    var o = new Uint32Array(n), i;
    for (i = 0; i < n; i++) o[i] = i;
    for (i = n - 1; i > 0; i--) { var j = (r() * (i + 1)) | 0, t = o[i]; o[i] = o[j]; o[j] = t; }
    return o;
  }
  function drawRec(ctx, d, k) {
    var o = k * REC;
    ctx.globalAlpha = d[o + 10];
    ctx.strokeStyle = PAL[d[o + 9]];
    ctx.lineWidth = d[o + 8];
    ctx.beginPath();
    ctx.moveTo(d[o], d[o + 1]);
    ctx.quadraticCurveTo(d[o + 2], d[o + 3], (d[o + 2] + d[o + 4]) * 0.5, (d[o + 3] + d[o + 5]) * 0.5);
    ctx.quadraticCurveTo(d[o + 4], d[o + 5], d[o + 6], d[o + 7]);
    ctx.stroke();
  }
  /* A job paints part of the picture and returns true once it's finished. */
  function strokeJob(ctx, data, r) {
    var n = data.length / REC, order = shuffledOrder(n, r), i = 0;
    return function (deadline) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      while (i < n) {
        var end = Math.min(n, i + 40);
        for (; i < end; i++) drawRec(ctx, data, order[i]);
        if (now() > deadline) break;
      }
      ctx.globalAlpha = 1;
      return i >= n;
    };
  }

  /* ------------------------------------------------------------------------
   * The sky
   * --------------------------------------------------------------------- */
  var UNDER = {
    night: { g: ['#170b36', '#2a1560', '#482694', '#8a3f9e'], swirl: '#be96f0', halo: '#ffd6eb' },
    dusk:  { g: ['#1d0d44', '#46207a', '#9a4590', '#f08a7a'], swirl: '#f0a0c8', halo: '#ffd6c8' },
    dawn:  { g: ['#211a52', '#4b3a8a', '#a87fb6', '#f2c1c0'], swirl: '#dcc8f5', halo: '#ffe6e6' },
    day:   { g: ['#3a3d98', '#5a60bf', '#8f97dc', '#dcd6f4'], swirl: '#ffffff', halo: '#fff8e1' }
  };
  function underpaint(ctx, c, L) {
    var U = UNDER[L.time], m = L.wx.mute || 0, to = MUTE[L.time];
    var g = ctx.createLinearGradient(0, 0, 0, c.horizon);
    [0, 0.45, 0.8, 1].forEach(function (at, i) { g.addColorStop(at, mix(U.g[i], to, m)); });
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.W, c.H);
    c.swirls.forEach(function (s) {
      var rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.5);
      rg.addColorStop(0, rgba(U.swirl, L.time === 'day' ? 0.22 : 0.30)); rg.addColorStop(1, rgba(U.swirl, 0));
      ctx.fillStyle = rg; ctx.fillRect(s.x - s.r * 1.5, s.y - s.r * 1.5, s.r * 3, s.r * 3);
    });
    c.halos.forEach(function (h) {
      var R = h.h * 2.3, rg = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, R), col = h.sun ? '#fff1c8' : U.halo;
      rg.addColorStop(0, rgba(col, (h.sun ? 0.6 : 0.45) * h.w)); rg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = rg; ctx.fillRect(h.x - R, h.y - R, R * 2, R * 2);
    });
  }

  var CORE_COLS = ['#fffaf0', '#fff1d6', '#ffe0a0', '#ffd6ea', '#fff6e8'];
  function paintStarCore(ctx, x, y, rc, r, warm) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, rc * 3.4);
    g.addColorStop(0, warm ? 'rgba(255,236,190,0.95)' : 'rgba(255,241,230,0.95)');
    g.addColorStop(0.32, 'rgba(255,190,222,0.55)');
    g.addColorStop(1, 'rgba(255,190,222,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rc * 3.4, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    var n = 12 + Math.round(rc * 1.6);
    for (var i = 0; i < n; i++) {
      var rad = rc * Math.sqrt(r()) * 0.95, a = r() * TAU, len = rc * (0.5 + r() * 0.7);
      ctx.strokeStyle = warm && r() < 0.5 ? '#ffe0a0' : pick(CORE_COLS, r);
      ctx.lineWidth = rc * (0.32 + r() * 0.26);
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, rad), a, a + len / Math.max(rad, rc * 0.3)); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#fffdf6';
    ctx.beginPath(); ctx.arc(x, y, rc * 0.42, 0, TAU); ctx.fill();
  }

  /* Tonight's real moon: the lit part follows the actual phase (flipped for
     the southern hemisphere), and the dark part glows faintly with earthshine. */
  function moonLitPath(ctx, m, R, mp, south) {
    var side = mp.phase < 0.5 ? 1 : -1, flip = south ? -1 : 1, k = Math.cos(TAU * mp.phase), i, v, w;
    ctx.beginPath();
    for (i = 0; i <= 36; i++) { // the bright limb
      v = -1 + (2 * i) / 36; w = Math.sqrt(Math.max(0, 1 - v * v));
      if (i) ctx.lineTo(m.x + R * flip * side * w, m.y + R * v); else ctx.moveTo(m.x + R * flip * side * w, m.y + R * v);
    }
    for (i = 36; i >= 0; i--) { // the terminator, where day meets night on the moon
      v = -1 + (2 * i) / 36; w = Math.sqrt(Math.max(0, 1 - v * v));
      ctx.lineTo(m.x + R * flip * side * w * k, m.y + R * v);
    }
    ctx.closePath();
  }
  function veil(c) { return c.clouds ? clamp((c.clouds.cover - 0.4) * 1.6, 0, 0.7) : 0; } // heavy cloud dims the moon and sun
  function paintMoon(ctx, c, r, L) {
    var m = c.moon, R = m.r, mp = L.moon, dim = (L.time === 'night' ? 1 : 0.72) * (1 - veil(c) * 0.35);
    var ga = (0.2 + 0.42 * mp.illum) * dim;
    var g = ctx.createRadialGradient(m.x, m.y, R * 0.6, m.x, m.y, R * 3.2);
    g.addColorStop(0, 'rgba(255,214,150,' + ga.toFixed(3) + ')'); g.addColorStop(0.45, 'rgba(255,170,205,' + (ga * 0.4).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,170,205,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, R * 3.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.86 * dim; ctx.fillStyle = L.time === 'night' ? '#2b1d5a' : '#4a3c7a';
    ctx.beginPath(); ctx.arc(m.x, m.y, R, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.4 * dim; ctx.strokeStyle = '#9a86d0'; ctx.lineWidth = Math.max(1, R * 0.05); ctx.stroke();
    if (mp.illum > 0.012) {
      ctx.save();
      moonLitPath(ctx, m, R, mp, L.south); ctx.clip();
      ctx.globalAlpha = dim; ctx.fillStyle = '#ffe9c2'; ctx.fill();
      ctx.lineCap = 'round';
      var n = Math.round(R * 7);
      for (var i = 0; i < n; i++) {
        var rad = R * Math.sqrt(r()), a = r() * TAU, len = R * (0.25 + r() * 0.35);
        ctx.strokeStyle = pick(['#fff1d6', '#ffe0a0', '#ffc86e', '#ffd6ea', '#fff6e5', '#ffe0a0'], r);
        ctx.lineWidth = R * (0.10 + r() * 0.08);
        ctx.globalAlpha = 0.95 * dim;
        ctx.beginPath(); ctx.arc(m.x, m.y, Math.max(1, rad), a, a + len / Math.max(rad, R * 0.3)); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* The sun, Van Gogh style: a bright disc inside rings of short strokes. */
  function paintSun(ctx, c, r) {
    var s = c.sun, R = s.r, b = c.brush, low = s.low, i, k, dim = 1 - veil(c) * 0.6;
    var G = R * (low ? 7 : 5), g = ctx.createRadialGradient(s.x, s.y, R * 0.4, s.x, s.y, G);
    ctx.save(); ctx.globalAlpha = dim;
    if (low) { g.addColorStop(0, 'rgba(255,214,150,0.85)'); g.addColorStop(0.3, 'rgba(255,160,140,0.35)'); g.addColorStop(1, 'rgba(255,150,170,0)'); }
    else { g.addColorStop(0, 'rgba(255,248,220,0.9)'); g.addColorStop(0.35, 'rgba(255,236,200,0.35)'); g.addColorStop(1, 'rgba(255,236,220,0)'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, G, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    var rings = low ? [['#ffd58a', '#ffb070', '#ff9a7a'], ['#ffc27a', '#f9a07e', '#f58fa0'], ['#f7a68e', '#f08fae']]
                    : [['#fff4c8', '#ffe8a0', '#fff9e6'], ['#ffe9b0', '#fff2d0', '#ffd98a'], ['#fff6e0', '#f9e8ff']];
    for (k = 0; k < rings.length; k++) {
      var rad = R * (1.25 + k * 0.5), n = Math.round((TAU * rad) / (b * 1.4));
      for (i = 0; i < n; i++) {
        var a = (i / n) * TAU + r() * 0.25, len = (b * (2 + r() * 1.6)) / rad, rr = rad + (r() - 0.5) * b;
        ctx.strokeStyle = pick(rings[k], r); ctx.lineWidth = b * (0.75 + r() * 0.35); ctx.globalAlpha = (0.85 - k * 0.18) * dim;
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, a, a + len); ctx.stroke();
      }
    }
    ctx.globalAlpha = dim; ctx.fillStyle = low ? '#ffd890' : '#fffbea';
    ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, TAU); ctx.fill();
    var disc = low ? ['#ffe6a8', '#ffd27a', '#ffc070', '#fff0c8'] : ['#fffdf2', '#fff4cc', '#ffeaa8', '#ffffff'], nd = Math.round(R * 6);
    for (i = 0; i < nd; i++) {
      var rad2 = R * Math.sqrt(r()), a2 = r() * TAU, len2 = R * (0.3 + r() * 0.4);
      ctx.strokeStyle = pick(disc, r); ctx.lineWidth = R * (0.12 + r() * 0.08); ctx.globalAlpha = 0.96 * dim;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, rad2), a2, a2 + len2 / Math.max(rad2, R * 0.3)); ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------------
   * The land: far hills, valley with the village, near ground
   * --------------------------------------------------------------------- */
  var LAND = {
    night: {
      far: { base: '#2a1662', cols: ['#22114e', '#2a1662', '#331a72', '#3d2084', '#4a2a8f', '#5a35a0'], rim: ['#7b5ad0', '#9a7fe8', '#c48fd8', '#e79ac8', '#8f9cf0'] },
      valley: { base: '#1c0e44', cols: ['#160a36', '#1c0e44', '#231152', '#2b1660', '#341c6e'], rim: ['#4a2a8f', '#5a35a0'] },
      near: { base: '#120827', cols: ['#0e0620', '#120827', '#180b33', '#1f0f40'], rim: ['#2e1a5e', '#3d2084'] },
      walls: ['#24124f', '#2b1660', '#1f1046', '#33196a'], roofs: ['#3a1446', '#1a0c3a', '#4a1a52', '#2a0f40'],
      tree: '#100828', line: '#0a0518', steeple: '#20114a',
      cypress: { fill: '#0e0722', dark: ['#0b051b', '#0e0722', '#140a2e', '#1b0f3a', '#221145', '#2a1654'], lit: ['#3a1f66', '#4b2a80', '#5d3596', '#7445ad'] }
    },
    dusk: {
      far: { base: '#3a1b66', cols: ['#311660', '#391b6a', '#432174', '#4f287e', '#5c3088', '#6b3992'], rim: ['#c06aa8', '#e087a8', '#f2a08f', '#f7b58a', '#d07bc0'] },
      valley: { base: '#24104a', cols: ['#1d0c3e', '#230f48', '#2a1354', '#321760', '#3a1c6a'], rim: ['#5a2a84', '#6e3592'] },
      near: { base: '#160a2c', cols: ['#110724', '#160a2c', '#1c0d36', '#231140'], rim: ['#3a1a5e', '#4a2270'] },
      walls: ['#2c1656', '#351b62', '#27124c', '#3e206c'], roofs: ['#4a1a50', '#24103e', '#5a2258', '#341348'],
      tree: '#120a2c', line: '#0a0518', steeple: '#24124e',
      cypress: { fill: '#0f0724', dark: ['#0b051b', '#0e0722', '#140a2e', '#1b0f3a', '#221145', '#2a1654'], lit: ['#6a2f6e', '#863c78', '#a24c80', '#bd6288'] }
    },
    dawn: {
      far: { base: '#433a7c', cols: ['#383070', '#40377a', '#4a4084', '#554a8e', '#625698', '#7063a2'], rim: ['#b894c8', '#d6a8c8', '#efc0c4', '#f6d0bc', '#a8b0e8'] },
      valley: { base: '#2a2358', cols: ['#221c4c', '#282156', '#2f2760', '#372e6a', '#403674'], rim: ['#5a4e90', '#6b5f9e'] },
      near: { base: '#1a1538', cols: ['#151130', '#1a1538', '#201a42', '#271f4c'], rim: ['#3c3268', '#4a3f78'] },
      walls: ['#352c68', '#3e3474', '#2f275e', '#463c7e'], roofs: ['#5e3a6c', '#33295e', '#6c4474', '#423266'],
      tree: '#16123a', line: '#0c0a22', steeple: '#2c2560',
      cypress: { fill: '#120e2c', dark: ['#0e0b22', '#120e2c', '#171236', '#1d1740', '#241c4a', '#2b2254'], lit: ['#5a4a8a', '#6e5c9c', '#8470ae', '#9a86c0'] }
    },
    day: {
      far: { base: '#5b5fb4', cols: ['#4b4fa3', '#5459ae', '#5e64b8', '#6a71c2', '#7780cb', '#8790d4'], rim: ['#a4adec', '#c0c6f5', '#e3b6dc', '#f2c4dc', '#b9c8f2'] },
      valley: { base: '#3a3486', cols: ['#2f2a74', '#352f80', '#3c368c', '#443e97', '#4d47a2'], rim: ['#6a66be', '#7d7acb'] },
      near: { base: '#261f5e', cols: ['#1f194f', '#241e5a', '#2a2365', '#312a70'], rim: ['#4a4296', '#5650a6'] },
      walls: ['#5a4f9e', '#665aa8', '#4f468f', '#7266b2'], roofs: ['#8a4a7e', '#5a3a8a', '#9a5a8a', '#6a3f80'],
      tree: '#231d5a', line: '#1a1446', steeple: '#4a4290',
      cypress: { fill: '#1a1442', dark: ['#15103a', '#1a1442', '#1f184b', '#251d55', '#2c2360', '#33296b'], lit: ['#5a4f9e', '#6a5fae', '#7b70bd', '#8c82cb'] }
    }
  };
  var DABS = { // little touches of the season on the hills
    spring: ['#f9a6d3', '#ffe3ef', '#fbcbe4', '#f17fbe'],
    summer: ['#ffd98a', '#f2c46e', '#c9e08a'],
    autumn: ['#d8743c', '#e8a046', '#b8483a', '#c8643c']
  };

  function paintBand(ctx, c, nz, r, topFn, botFn, o) {
    var W = c.W, x;
    ctx.beginPath(); ctx.moveTo(-12, topFn(-12));
    for (x = -12; x <= W + 12; x += 6) ctx.lineTo(x, topFn(x));
    for (x = W + 12; x >= -12; x -= 6) ctx.lineTo(x, botFn(x));
    ctx.closePath(); ctx.globalAlpha = 1; ctx.fillStyle = o.base; ctx.fill();

    var b = c.brush, sp = b * o.spacing, recs = [];
    for (var gx = -sp; gx < W + sp; gx += sp) {
      var top0 = topFn(gx), bot0 = botFn(gx);
      for (var gy = top0 - sp * 0.4; gy < bot0; gy += sp) {
        var px = gx + (r() - 0.5) * sp, py = gy + (r() - 0.5) * sp;
        var top = topFn(px), bot = botFn(px);
        if (py < top - b * 0.4 || py > bot + b) continue;
        var depth = clamp((py - top) / Math.max(1, bot - top), 0, 1);
        var slope = (topFn(px + 4) - topFn(px - 4)) / 8;
        var ang = Math.atan(slope) * (1 - depth * 0.6) + (nz(px * 0.012, py * 0.012) - 0.5) * 0.7;
        var len = b * lerp(o.len[0], o.len[1], r()), bend = (r() - 0.5) * 0.5, roll = r(), col;
        if (o.snow && (depth < 0.2 || roll < 0.42 - depth * 0.5)) col = pick(o.snow, r);
        else if (depth < 0.10 && roll < o.rim) col = pick(o.rimCols, r);
        else if (o.dabs && roll > 1 - o.dabs.p && depth < 0.75) col = pick(o.dabs.cols, r);
        else col = o.cols[Math.min(o.cols.length - 1, ((r() * 0.6 + (1 - depth) * 0.6) * o.cols.length) | 0)];
        var dx = Math.cos(ang) * len / 3, dy = Math.sin(ang) * len / 3;
        var sx = px - dx * 1.5, sy = py - dy * 1.5;
        recs.push({ x: sx, y: sy, dx: dx, dy: dy, bend: bend, w: b * lerp(o.width[0], o.width[1], r()), col: col });
      }
    }
    ctx.lineCap = 'round';
    recs.forEach(function (s) {
      ctx.strokeStyle = s.col; ctx.lineWidth = s.w; ctx.globalAlpha = 0.92;
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(s.x + s.dx * 1.5 - s.dy * s.bend * 2, s.y + s.dy * 1.5 + s.dx * s.bend * 2, s.x + s.dx * 3, s.y + s.dy * 3);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function paintVillage(ctx, c, r, L, T, tone, snow) {
    var u = c.brush * (c.portrait ? 1.25 : 1.05);
    var houses = [], x = c.village.x0, churchAt = lerp(c.village.x0, c.village.x1, 0.58), churchDone = false;
    while (x < c.village.x1) {
      var church = !churchDone && x > churchAt;
      var w = church ? u * 5.6 : u * (3.6 + r() * 4.2);
      var h = church ? u * 6.2 : u * (2.4 + r() * 2.6);
      var yb = c.valleyTop(x + w / 2) + u * (0.8 + r() * 2.4);
      houses.push({ x: x, w: w, h: h, yb: yb, roof: church ? u * 2.2 : u * (1.3 + r() * 1.4), church: church, lit: r() < 0.78, tree: r() < 0.3, pumpkin: r() < 0.32 });
      if (church) churchDone = true;
      x += w * (0.72 + r() * 0.5) + (r() < 0.2 ? u * (2 + r() * 4) : 0);
    }
    houses.sort(function (a, b) { return a.yb - b.yb; });
    houses.forEach(function (hs) { drawHouse(ctx, hs, u, r, L, T, tone, snow); });
  }
  function drawHouse(ctx, hs, u, r, L, T, tone, snow) {
    var j = function () { return (r() - 0.5) * u * 0.35; };
    var x0 = hs.x, x1 = hs.x + hs.w, yb = hs.yb, yt = yb - hs.h, peakX = (x0 + x1) / 2 + j(), peakY = yt - hs.roof;
    if (hs.tree) {
      ctx.fillStyle = L.season === 'autumn' && r() < 0.6 ? tone(mix('#7a2a3a', T.tree, L.time === 'day' ? 0.2 : 0.55)) : tone(T.tree);
      for (var t = 0; t < 4; t++) { ctx.beginPath(); ctx.arc(x0 - u * (0.6 + r()), yb - u * (1 + r() * 2.4), u * (0.9 + r() * 0.9), 0, TAU); ctx.fill(); }
    }
    if (hs.church) { // steeple
      var sx = x0 + hs.w * 0.30, sw = u * 1.5;
      ctx.beginPath(); ctx.moveTo(sx, yt + u); ctx.lineTo(sx, yt - hs.roof * 1.4); ctx.lineTo(sx + sw / 2 + j(), yt - hs.roof - u * 9.5);
      ctx.lineTo(sx + sw, yt - hs.roof * 1.4); ctx.lineTo(sx + sw, yt + u); ctx.closePath();
      ctx.fillStyle = tone(T.steeple); ctx.fill(); ctx.lineWidth = u * 0.3; ctx.strokeStyle = T.line; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x0 + j(), yb); ctx.lineTo(x0 + j(), yt + j()); ctx.lineTo(peakX, peakY);
    ctx.lineTo(x1 + j(), yt + j()); ctx.lineTo(x1 + j(), yb); ctx.closePath();
    ctx.fillStyle = tone(pick(T.walls, r)); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x0 - u * 0.4, yt + u * 0.3); ctx.lineTo(peakX, peakY - u * 0.2); ctx.lineTo(x1 + u * 0.4, yt + u * 0.3); ctx.closePath();
    ctx.fillStyle = tone(pick(T.roofs, r)); ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = u * 0.32; ctx.strokeStyle = T.line; ctx.stroke();
    st.roofs.push([x0 - u * 0.4, yt + u * 0.3, peakX, peakY - u * 0.2, x1 + u * 0.4, yt + u * 0.3, u]);
    if (snow) {
      ctx.beginPath(); ctx.moveTo(x0 - u * 0.5, yt + u * 0.12); ctx.lineTo(peakX, peakY - u * 0.45); ctx.lineTo(x1 + u * 0.5, yt + u * 0.12);
      ctx.lineWidth = u * 0.75; ctx.strokeStyle = snow[0]; ctx.stroke();
    }
    var nW = hs.w > u * 5 ? 2 : 1;
    for (var k = 0; k < nW; k++) {
      var wx = x0 + hs.w * (nW === 1 ? 0.42 : 0.24 + k * 0.38) + j() * 0.5, wy = yt + hs.h * 0.30, ww = u * 0.9, wh = u * 1.1;
      if (L.time === 'day') { // daylight: plain dark panes
        if (hs.lit) { ctx.globalAlpha = 0.75; ctx.fillStyle = tone('#2a2366'); ctx.fillRect(wx, wy, ww, wh); ctx.globalAlpha = 1; }
        continue;
      }
      if (!hs.lit) continue;
      var col = L.holiday === 'halloween' ? (r() < 0.6 ? '#ff9a3c' : '#ffb347') : (r() < 0.7 ? '#ffc86e' : '#ffb3d9');
      var g = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 0, wx + ww / 2, wy + wh / 2, u * 3);
      g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(wx - u * 3, wy - u * 3, u * 6 + ww, u * 6 + wh);
      ctx.fillStyle = col; ctx.fillRect(wx, wy, ww, wh);
    }
    if (L.holiday === 'halloween' && hs.pumpkin && !hs.church) drawPumpkin(ctx, x1 + u * 1.2, yb, u, L.time !== 'day');
  }
  function drawPumpkin(ctx, x, y, u, glow) {
    var w = u * 2.1, h = u * 1.55, cy = y - h / 2;
    if (glow) {
      var g = ctx.createRadialGradient(x, cy, 0, x, cy, u * 4.5);
      g.addColorStop(0, 'rgba(255,150,60,0.55)'); g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g; ctx.fillRect(x - u * 4.5, cy - u * 4.5, u * 9, u * 9);
    }
    ctx.fillStyle = '#e8762c'; ctx.beginPath(); ctx.ellipse(x, cy, w / 2, h / 2, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#a84a1c'; ctx.lineWidth = Math.max(0.6, u * 0.14);
    ctx.beginPath(); ctx.ellipse(x, cy, w * 0.2, h / 2, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#3d6b2e'; ctx.fillRect(x - u * 0.12, cy - h / 2 - u * 0.45, u * 0.24, u * 0.5);
    if (glow) {
      ctx.fillStyle = '#ffe08a';
      [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.moveTo(x + s * w * 0.12, cy - h * 0.02); ctx.lineTo(x + s * w * 0.3, cy - h * 0.02); ctx.lineTo(x + s * w * 0.21, cy - h * 0.24); ctx.closePath(); ctx.fill(); });
      ctx.beginPath(); ctx.moveTo(x - w * 0.26, cy + h * 0.1); ctx.quadraticCurveTo(x, cy + h * 0.38, x + w * 0.26, cy + h * 0.1); ctx.quadraticCurveTo(x, cy + h * 0.22, x - w * 0.26, cy + h * 0.1); ctx.fill();
    }
  }

  function paintLand(ctx, c, nz, r, L) {
    var T = LAND[L.time], m = L.wx.mute || 0, to = MUTE[L.time], night = L.time === 'night';
    var tone = function (h) { return m ? mix(h, to, m * 0.5) : h; };
    var tones = function (a) { return a.map(tone); };
    var snow = L.wx.snow ? tones(night ? ['#c9c2ee', '#b8b0e4', '#d8d2f6', '#aaa2da'] : L.time === 'day' ? ['#ffffff', '#f4f2ff', '#e8e4fb', '#dcd8f6'] : ['#efe2f2', '#e2d2ee', '#f6eaf4', '#d4c4e6']) : null;
    var dab = DABS[L.season] && !snow ? DABS[L.season].map(function (h) { return mix(h, T.near.base, night ? 0.5 : L.time === 'day' ? 0.1 : 0.3); }) : null;
    paintBand(ctx, c, nz, r, c.farTop, c.valleyTop, {
      base: tone(T.far.base), spacing: 1.35, len: [4.5, 8.5], width: [0.8, 1.15], rim: 0.55,
      cols: tones(T.far.cols), rimCols: tones(T.far.rim), snow: snow
    });
    paintBand(ctx, c, nz, r, function (x) { return c.valleyTop(x) - c.brush; }, c.nearTop, {
      base: tone(T.valley.base), spacing: 1.4, len: [5, 9], width: [0.8, 1.2], rim: 0.2,
      cols: tones(T.valley.cols), rimCols: tones(T.valley.rim), snow: snow, dabs: dab && { p: 0.025, cols: dab }
    });
    paintVillage(ctx, c, mulberry32(17), L, T, tone, snow);
    paintBand(ctx, c, nz, r, c.nearTop, function () { return c.H + 12; }, {
      base: tone(T.near.base), spacing: 1.5, len: [5, 10], width: [0.9, 1.3], rim: 0.25,
      cols: tones(T.near.cols), rimCols: tones(T.near.rim), snow: snow, dabs: dab && { p: 0.038, cols: dab }
    });
  }

  /* ------------------------------------------------------------------------
   * The cypress — a dark flame of curling vertical strokes
   * --------------------------------------------------------------------- */
  function cypressGeom(c) {
    var cy = c.cypress, height = cy.base - cy.top;
    var spine = function (t) { return cy.x + cy.lean * cy.width * 0.10 * t + Math.sin(t * 5.2 + 0.6) * cy.width * 0.07 * t; };
    var half = function (t) { return cy.width * 0.5 * Math.pow(1 - t, 0.55) * (0.72 + 0.28 * Math.sin(Math.PI * clamp(t * 1.6 + 0.25, 0, 1))); };
    var left = [], right = [];
    for (var i = 0; i <= 72; i++) {
      var t = i / 72, y = cy.base - t * height, sx = spine(t), w = half(t);
      var fl = 0.30 * Math.pow(Math.max(0, Math.sin(t * 17 + 0.9)), 3) * (1 - t * 0.6);
      var fr = 0.30 * Math.pow(Math.max(0, Math.sin(t * 15 + 2.4)), 3) * (1 - t * 0.6);
      left.push([sx - w * (1 + fl), y]); right.push([sx + w * (1 + fr), y]);
    }
    return { spine: spine, half: half, height: height, poly: left.concat(right.reverse()) };
  }
  function paintCypress(ctx, c, r, L) {
    var T = LAND[L.time].cypress, m = L.wx.mute || 0, to = MUTE[L.time];
    var tone = function (h) { return m ? mix(h, to, m * 0.35) : h; };
    var cy = c.cypress, g = cypressGeom(c), b = c.brush, i;
    ctx.beginPath(); ctx.moveTo(g.poly[0][0], g.poly[0][1]);
    for (i = 1; i < g.poly.length; i++) ctx.lineTo(g.poly[i][0], g.poly[i][1]);
    ctx.closePath(); ctx.fillStyle = tone(T.fill); ctx.fill();

    var dark = T.dark.map(tone), lit = T.lit.map(tone), snowy = !!L.wx.snow;
    var n = Math.round((g.height * cy.width) / (b * b * 1.15)), tmp = [];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (i = 0; i < n; i++) {
      var t = Math.pow(r(), 1.15), s = r() * 2 - 1;
      var y = cy.base - t * g.height, x = g.spine(t) + s * g.half(t) * 1.04;
      var curl = Math.sin(t * 26 + s * 2.2) * 0.42;
      var ang = -Math.PI / 2 + s * 0.38 + curl;
      var len = b * (3.5 + r() * 5.5) * (1 - t * 0.45), w = b * (0.75 + r() * 0.55);
      var isLit = s * c.lit > 0.3 && r() < 0.13 + 0.12 * t;
      ctx.strokeStyle = isLit ? (snowy && r() < 0.5 ? '#e8e2fa' : pick(lit, r)) : pick(dark, r);
      ctx.globalAlpha = 0.95; ctx.lineWidth = w;
      tmp.length = 0;
      var px = x, py = y, a = ang;
      for (var k = 0; k < 4; k++) { tmp.push(px, py); px += Math.cos(a) * len / 3; py += Math.sin(a) * len / 3; a += curl * 0.35 + s * 0.08; }
      ctx.beginPath(); ctx.moveTo(tmp[0], tmp[1]);
      ctx.quadraticCurveTo(tmp[2], tmp[3], (tmp[2] + tmp[4]) / 2, (tmp[3] + tmp[5]) / 2);
      ctx.quadraticCurveTo(tmp[4], tmp[5], tmp[6], tmp[7]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return g.poly;
  }
  function inPoly(poly, x, y) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* ------------------------------------------------------------------------
   * Sprites for glows
   * --------------------------------------------------------------------- */
  function sprite(stops, size) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var g = cv.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return cv;
  }
  var SPR = null, TINTS = {};
  function sprites() {
    if (SPR) return SPR;
    SPR = {
      star: sprite([[0, 'rgba(255,250,240,1)'], [0.12, 'rgba(255,240,226,0.9)'], [0.35, 'rgba(255,170,215,0.35)'], [1, 'rgba(240,107,180,0)']], 128),
      soft: sprite([[0, 'rgba(255,214,235,0.55)'], [0.5, 'rgba(240,107,180,0.16)'], [1, 'rgba(240,107,180,0)']], 128),
      dot: sprite([[0, 'rgba(255,248,236,1)'], [0.25, 'rgba(255,235,245,0.7)'], [1, 'rgba(255,200,230,0)']], 32),
      flake: sprite([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(250,248,255,0.8)'], [1, 'rgba(240,236,255,0)']], 32)
    };
    return SPR;
  }
  /* a soft glow in any colour (cached) */
  function tint(hex, size) {
    var key = hex + (size || 64);
    if (!TINTS[key]) TINTS[key] = sprite([[0, 'rgba(255,255,255,0.95)'], [0.18, rgba(hex, 0.85)], [0.5, rgba(hex, 0.25)], [1, rgba(hex, 0)]], size || 64);
    return TINTS[key];
  }

  /* ------------------------------------------------------------------------
   * Sound — a soft bell per star, pitch follows the star's height
   * --------------------------------------------------------------------- */
  var Sound = {
    ac: null, out: null, on: false,
    ensure: function () {
      if (!this.ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        var ac = (this.ac = new AC());
        var master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
        var verb = ac.createConvolver(), len = Math.round(ac.sampleRate * 2.4), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (var ch = 0; ch < 2; ch++) {
          var data = ir.getChannelData(ch);
          for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
        }
        verb.buffer = ir;
        var wet = ac.createGain(); wet.gain.value = 0.42;
        verb.connect(wet); wet.connect(master);
        this.out = { dry: master, verb: verb };
      }
      if (this.ac.state === 'suspended') this.ac.resume();
      return true;
    },
    chime: function (y01, strength) {
      if (!this.on || !this.ensure()) return;
      var ac = this.ac, t = ac.currentTime;
      var scale = [0, 2, 4, 7, 9], step = Math.round(clamp(1 - y01, 0, 1) * 11);
      var midi = 62 + scale[step % 5] + 12 * Math.floor(step / 5);
      var f = 440 * Math.pow(2, (midi - 69) / 12), amp = 0.16 * (strength || 1);
      [[1, 1], [2.76, 0.28], [5.4, 0.08]].forEach(function (p) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f * p[0]; o.detune.value = (Math.random() - 0.5) * 6;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(amp * p[1], t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 / p[0] + 0.4);
        o.connect(g); g.connect(Sound.out.dry); g.connect(Sound.out.verb);
        o.start(t); o.stop(t + 2.8);
      });
    },
    /* a rising little run of bells, for a caught shooting star */
    sparkle: function () {
      if (!this.on) return;
      var self = this;
      [0.25, 0.42, 0.6, 0.82].forEach(function (y, i) { setTimeout(function () { self.chime(1 - y, 0.75); }, i * 95); });
    },
    /* a soft purr: a low buzz that flutters about 24 times a second */
    purr: function () {
      if (!this.on || !this.ensure()) return;
      var ac = this.ac, t = ac.currentTime;
      var o = ac.createOscillator(), lp = ac.createBiquadFilter(), am = ac.createGain(), env = ac.createGain(), lfo = ac.createOscillator(), depth = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = 46;
      lp.type = 'lowpass'; lp.frequency.value = 300;
      am.gain.value = 0.5; lfo.frequency.value = 24; depth.gain.value = 0.5;
      lfo.connect(depth); depth.connect(am.gain);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.22, t + 0.18);
      env.gain.setValueAtTime(0.22, t + 0.6);
      env.gain.exponentialRampToValueAtTime(0.08, t + 0.8);
      env.gain.exponentialRampToValueAtTime(0.2, t + 1.0);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(lp); lp.connect(am); am.connect(env); env.connect(this.out.dry);
      o.start(t); lfo.start(t); o.stop(t + 1.7); lfo.stop(t + 1.7);
    },
    /* a tiny synthesized "mew" */
    mew: function () {
      if (!this.on || !this.ensure()) return;
      var ac = this.ac, t = ac.currentTime;
      var o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(600, t); o.frequency.exponentialRampToValueAtTime(980, t + 0.12); o.frequency.exponentialRampToValueAtTime(540, t + 0.48);
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 0.8;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(f); f.connect(g); g.connect(this.out.dry); g.connect(this.out.verb);
      o.start(t); o.stop(t + 0.6);
    }
  };

  /* ------------------------------------------------------------------------
   * State
   * --------------------------------------------------------------------- */
  var st = {
    root: null, cv: {}, ctx: {}, dpr: 1, liveDpr: 1,
    c: null, nz: null, field: null, rnd: null, look: null, lookKey: '',
    jobs: [], painted: false, onPainted: null,
    stars: [], parts: null, nParts: 0, dust: [],
    ripples: [], sparks: [], links: [], meteors: [], nextMeteor: 0, caught: null,
    fx: null, roofs: [], cats: [], windX: 0, frontOn: false, frontDirty: false, fxShown: false,
    lastTap: null, hover: null, poly: null,
    pointer: { x: -1e4, y: -1e4, energy: 0, mouse: false, seen: false },
    t: 0, last: 0, raf: 0, w: 0, h: 0, perf: { acc: 0, n: 0, level: 0 }, started: false,
    active: true, frameNo: 0
  };
  var paintedResolve;
  var paintedPromise = new Promise(function (res) { paintedResolve = res; });

  function sizeCanvas(cv, w, h, dpr) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  function perfScale() { return st.perf.level === 0 ? 1 : st.perf.level === 1 ? 0.65 : 0.4; }

  function makeStar(x, y, rc, opts) {
    var s = {
      x: x, y: y, rc: rc, h: rc * 4.4, spin: opts.spin || 1, phase: st.rnd() * TAU,
      glow: 0, energy: 0, user: !!opts.user, born: st.t, warm: !!opts.warm, wish: !!opts.wish, rings: []
    };
    [[0.62, 9, 0], [0.98, 13, 1], [1.36, 17, 2]].forEach(function (spec) {
      var dashes = [];
      for (var i = 0; i < spec[1]; i++) {
        dashes.push({ a: (i / spec[1]) * TAU + st.rnd() * 0.3, len: (TAU / spec[1]) * (0.42 + st.rnd() * 0.25), j: (st.rnd() - 0.5) * 0.12 });
      }
      s.rings.push({ f: spec[0], dashes: dashes, col: spec[2], dir: spec[2] % 2 ? -1 : 1, speed: 0.10 + st.rnd() * 0.08 });
    });
    return s;
  }

  function applyWind(L) {
    var w = clamp((L.wind || 0) / 30, 0, 1.3);
    st.windX = w;
    if (st.cv.cypress) st.cv.cypress.style.animationDuration = (10 - Math.min(1, w) * 5.5).toFixed(1) + 's';
  }

  /* ------------------------------------------------------------------------
   * Build (and rebuild on real resizes, or when the sky changes)
   * --------------------------------------------------------------------- */
  function build() {
    var root = st.root, W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    st.w = W; st.h = H;
    st.dpr = Math.min(window.devicePixelRatio || 1, 2);
    st.liveDpr = Math.min(window.devicePixelRatio || 1, st.perf.level > 1 ? 1 : 1.75);
    st.rnd = mulberry32(20260611);
    st.nz = makeNoise(7);
    var L = (st.look = readLook());
    st.lookKey = lookKey(L);
    PAL = paletteFor(L);
    var c = (st.c = compose(W, H, L));
    st.field = buildField(c, st.nz);
    st.ctx.paint = sizeCanvas(st.cv.paint, W, H, st.dpr);
    st.ctx.land = sizeCanvas(st.cv.land, W, H, st.dpr);
    st.ctx.cypress = sizeCanvas(st.cv.cypress, W, H, st.dpr);
    st.ctx.live = sizeCanvas(st.cv.live, W, H, st.liveDpr);
    st.ctx.front = sizeCanvas(st.cv.front, W, H, st.liveDpr);
    st.frontDirty = false;
    st.cv.cypress.style.transformOrigin = (c.cypress.x / W) * 100 + '% 100%';
    applyWind(L);

    // stars (fixed ones; painted user stars are lost on a real resize)
    st.stars = c.stars.map(function (s, i) { return makeStar(s.x, s.y, s.rc, { spin: s.spin, warm: i % 4 === 1 }); });
    st.links = []; st.lastTap = null; st.ripples = []; st.sparks = []; st.meteors = [];

    // drifting dust stars, away from the big ones (fewer at twilight, none by day, dimmed by cloud)
    st.dust = [];
    var nd = L.time === 'day' ? 0 : Math.round(clamp(Math.round((W * H) / 9000), 40, 170) * (L.time === 'night' ? 1 : 0.4));
    for (var i = 0; i < nd; i++) {
      var x = st.rnd() * W, y = st.rnd() * c.farTop(x) * 0.96, ok = true;
      for (var k = 0; k < c.stars.length; k++) { if (Math.hypot(x - c.stars[k].x, y - c.stars[k].y) < c.stars[k].h * 1.6) { ok = false; break; } }
      if (ok) st.dust.push({ x: x, y: y, r: 0.6 + st.rnd() * 1.3, a: (0.35 + st.rnd() * 0.55) * (1 - 0.92 * cloudAt(c, st.nz, x, y)), s: 0.6 + st.rnd() * 2.2, p: st.rnd() * TAU });
    }

    // living brushwork
    var base = REDUCED ? 0 : clamp(Math.round((W * H) / 2600), 140, 700);
    var factor = st.perf.level === 0 ? 1 : st.perf.level === 1 ? 0.6 : 0.35;
    st.nParts = Math.round(base * factor);
    st.parts = {
      x: new Float32Array(st.nParts), y: new Float32Array(st.nParts), age: new Float32Array(st.nParts),
      life: new Float32Array(st.nParts), col: new Uint8Array(st.nParts), w: new Float32Array(st.nParts), spd: new Float32Array(st.nParts)
    };
    for (i = 0; i < st.nParts; i++) { spawn(i); st.parts.age[i] = st.rnd() * st.parts.life[i]; }

    setupFx(c, L);

    // painting jobs — land first (quick), then the sky in passes, clouds, then lights
    var r = mulberry32(99), nz = st.nz, field = st.field, P = {};
    var strokes = function (key) {
      var job = null;
      return function (dl) {
        if (!job) { if (!P[key] || !P[key].length) return true; job = strokeJob(st.ctx.paint, P[key], r); }
        return job(dl);
      };
    };
    st.painted = false;
    st.jobs = [
      function () { st.ctx.paint.clearRect(0, 0, W, H); underpaint(st.ctx.paint, c, L); return true; },
      function () { st.roofs = []; st.ctx.land.clearRect(0, 0, W, H); paintLand(st.ctx.land, c, nz, mulberry32(3), L); return true; },
      function () { st.ctx.cypress.clearRect(0, 0, W, H); st.poly = paintCypress(st.ctx.cypress, c, mulberry32(5), L); return true; },
      function () { P.a = genSkyPass(c, field, nz, r, { spacing: 2.3, width: [1.5, 2.1], len: [4.5, 6.5], alpha: 0.9, lift: -0.06 }); return true; },
      strokes('a'),
      function () { P.a = null; P.b = genSkyPass(c, field, nz, r, { spacing: 1.22, width: [0.8, 1.15], len: [3.0, 5.2], alpha: 0.93, lift: 0 }); return true; },
      strokes('b'),
      function () { P.c = genRidges(P.b, r, 0.32); P.b = null; return true; },
      strokes('c'),
      function () { P.d = genSkyPass(c, field, nz, r, { spacing: 1.9, width: [0.55, 0.8], len: [2.6, 4.2], alpha: 0.95, lift: 0.08, onlyLight: true }); P.c = null; return true; },
      strokes('d'),
      function () { P.d = null; P.e = c.clouds ? genCloudPass(c, field, nz, r) : null; return true; },
      strokes('e'),
      function () { P.f = P.e ? genRidges(P.e, r, 0.3) : null; P.e = null; return true; },
      strokes('f'),
      function () {
        P.f = null;
        var rr = mulberry32(11), ctx = st.ctx.paint;
        // fill the eye of each swirl with a little knot of light strokes
        ctx.lineCap = 'round';
        c.swirls.forEach(function (s) {
          var R = s.r * 0.17, n = 12 + Math.round(R / 2);
          for (var i = 0; i < n; i++) {
            var rad = Math.max(1, R * Math.sqrt(rr())), a = rr() * TAU, len = R * (0.6 + rr() * 0.8);
            ctx.strokeStyle = PAL[pick([12, 13, 14, 18, 22, 19], rr)];
            ctx.lineWidth = c.brush * (0.75 + rr() * 0.4); ctx.globalAlpha = 0.92;
            ctx.beginPath(); ctx.arc(s.x, s.y, rad, a, a + len / Math.max(rad, R * 0.35)); ctx.stroke();
          }
        });
        ctx.globalAlpha = 1;
        st.stars.forEach(function (s) { paintStarCore(ctx, s.x, s.y, s.rc, rr, s.warm); });
        if (c.moonUp) paintMoon(ctx, c, rr, L);
        if (c.sun) paintSun(ctx, c, rr);
        return true;
      }
    ];
  }

  function spawn(i) {
    var c = st.c, p = st.parts, x, y, tries = 0;
    do {
      x = st.rnd() * c.W; y = st.rnd() * (c.farTop(x) - 6); tries++;
    } while (tries < 8 && (nearStarCore(x, y) || inSwirlEye(x, y)));
    p.x[i] = x; p.y[i] = y; p.age[i] = 0;
    p.life[i] = 3 + st.rnd() * 4.5;
    var cl = c.clouds ? cloudAt(c, st.nz, x, y) : 0;
    p.col[i] = cl > 0.45 ? 30 + Math.min(5, Math.floor(cl * 5 + st.rnd() * 2)) : lighter(toneAt(c, st.nz, x, y, st.rnd, 0.1));
    p.w[i] = c.brush * (0.62 + st.rnd() * 0.3);
    p.spd[i] = c.brush * (5 + st.rnd() * 6) * (1 + st.windX * 0.5);
  }
  /* The swirls spiral inward, so drifting strokes would pile up in their centres. */
  function inSwirlEye(x, y) {
    var sw = st.c.swirls;
    for (var k = 0; k < sw.length; k++) {
      var dx = x - sw[k].x, dy = y - sw[k].y, R = sw[k].r * 0.2;
      if (dx * dx + dy * dy < R * R) return true;
    }
    return false;
  }
  function nearStarCore(x, y) {
    for (var k = 0; k < st.stars.length; k++) {
      var s = st.stars[k];
      if (Math.abs(x - s.x) < s.rc * 2.2 && Math.abs(y - s.y) < s.rc * 2.2) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------------
   * Weather, seasons and holidays: everything that moves in front of the land
   * --------------------------------------------------------------------- */
  var LEAVES = ['#d8743c', '#e8a046', '#c8483a', '#e0b04a', '#b8584a'];
  var PETALS = ['#ffd3e6', '#f9b8d6', '#ffe9f2', '#f5a3c8'];
  function setupFx(c, L) {
    var r = st.rnd, area = c.W * c.H, k = perfScale(), i, n, night = L.time === 'night';
    var F = (st.fx = { rain: [], snow: [], fog: [], deco: [], flash: null, nextFlash: 0, fireworks: null, lights: L.holiday === 'winterlights' });
    if (L.wx.rain && !REDUCED) {
      n = Math.round(clamp(area / 5200, 50, 300) * L.wx.rain * k);
      for (i = 0; i < n; i++) F.rain.push(newDrop(c, r, true));
    }
    if (L.wx.snow) {
      n = Math.round(clamp(area / 7000, 40, 220) * k);
      for (i = 0; i < n; i++) F.snow.push(newFlake(c, r, true));
    }
    if (L.wx.fog) {
      F.fogCol = night ? '#a99cd0' : L.time === 'day' ? '#f2f0ff' : '#e8cfe0';
      F.fogSprite = sprite([[0, rgba(F.fogCol, 0.9)], [0.45, rgba(F.fogCol, 0.45)], [1, rgba(F.fogCol, 0)]], 64);
      n = c.portrait ? 9 : 13;
      for (i = 0; i < n; i++) {
        F.fog.push({ x: (i / n) * c.W * 1.3 - c.W * 0.15 + (r() - 0.5) * c.W * 0.1, y: lerp(c.horizon - c.H * 0.06, c.H * 0.98, Math.pow(r(), 1.3)),
                     w: c.W * (0.35 + r() * 0.35) * (c.portrait ? 1.6 : 1), h: c.H * (0.05 + r() * 0.07), a: 0.2 + r() * 0.18, v: 4 + r() * 6 });
      }
    }
    if (L.wx.storm) F.nextFlash = st.t + 4 + r() * 6;
    var add = function (count, make) { for (var q = 0; q < count; q++) F.deco.push(make(true)); };
    // the season
    if (L.season === 'spring') add(Math.round(clamp(area / 50000, 8, 26) * k), function (s) { return newPetal(c, r, s); });
    if (L.season === 'summer' && L.time !== 'day') add(Math.round(clamp(area / 60000, 8, 22) * k), function () { return newFirefly(c, r); });
    if (L.season === 'autumn') add(Math.round(clamp(area / 70000, 6, 18) * k), function (s) { return newLeaf(c, r, s, night); });
    if (L.season === 'winter' && !L.wx.snow) add(Math.round(clamp(area / 50000, 10, 26)), function () { return newGlint(c, r); });
    // the holiday
    var hol = L.holiday;
    if (hol === 'newyear' || hol === 'canada') F.fireworks = { next: 0, rockets: [], sparks: [], cols: hol === 'canada' ? ['#ff4d5e', '#ffffff', '#ff8a95', '#ffe3ef'] : ['#ffd36e', '#ff9ad5', '#c9b4ff', '#9ae6ff', '#fff1d6'] };
    if (hol === 'lunar' || hol === 'midautumn') add(Math.round(clamp(area / 110000, 5, 12)), function (s) { return newLantern(c, r, s, hol); });
    if (hol === 'valentine') add(Math.round(clamp(area / 80000, 6, 14)), function (s) { return newHeart(c, r, s); });
    if (hol === 'halloween' && c.moonUp) add(c.portrait ? 4 : 6, function () { return newBat(c, r); });
    st.frontOn = !!(F.rain.length || F.snow.length || F.fog.length || F.deco.length || F.lights);
  }
  function newDrop(c, r, scatter) {
    return { x: r() * (c.W + 120) - 60, y: scatter ? r() * c.H : -r() * c.H * 0.3, v: 820 + r() * 520, len: c.brush * (2.4 + r() * 2.2) };
  }
  function newFlake(c, r, scatter) {
    return { x: r() * c.W, y: scatter ? r() * c.H : -10 - r() * 40, s: (0.8 + r() * 1.8) * c.brush * 0.38, v: 22 + r() * 46, ph: r() * TAU, sw: 0.5 + r() * 1.1 };
  }
  function newLeaf(c, r, scatter, night) {
    var col = pick(LEAVES, r);
    return { kind: 'leaf', x: r() * c.W * 1.1 - c.W * 0.1, y: scatter ? r() * c.H : -20 - r() * 60, s: c.brush * (1.5 + r() * 1.3), rot: r() * TAU, vr: (r() - 0.5) * 2.4,
             vx: 8 + r() * 14, vy: 26 + r() * 30, ph: r() * TAU, col: night ? mix(col, '#2a1560', 0.4) : col };
  }
  function newPetal(c, r, scatter) {
    return { kind: 'petal', x: r() * c.W * 1.1 - c.W * 0.1, y: scatter ? r() * c.H : -20 - r() * 60, s: c.brush * (1.2 + r() * 0.8), rot: r() * TAU, vr: (r() - 0.5) * 3,
             vx: 14 + r() * 16, vy: 22 + r() * 22, ph: r() * TAU, col: pick(PETALS, r) };
  }
  function newFirefly(c, r) {
    var x = r() * c.W;
    return { kind: 'fly', x: x, y: lerp(c.farTop(x) - c.H * 0.04, c.H * 0.97, r()), ang: r() * TAU, sp: 8 + r() * 10, ph: r() * TAU, bl: 0.6 + r() * 0.9 };
  }
  function newGlint(c, r) {
    var x = r() * c.W;
    return { kind: 'glint', x: x, y: lerp(c.farTop(x) + c.brush * 2, c.H * 0.98, r()), ph: r() * TAU, sp: 0.4 + r() * 0.9 };
  }
  function newLantern(c, r, scatter, hol) {
    var u = c.brush * (c.portrait ? 1.25 : 1.05), x = lerp(c.village.x0, c.village.x1, r());
    return { kind: 'lantern', x: x, y: scatter ? lerp(c.H * 0.08, c.horizon + c.H * 0.08, r()) : c.horizon + r() * c.H * 0.1, s: u * (2.3 + r() * 1.1),
             vy: -(10 + r() * 9), ph: r() * TAU, round: hol === 'midautumn', col: hol === 'lunar' ? (r() < 0.8 ? '#e8443a' : '#f2b33d') : pick(['#f39a3c', '#f06bb4', '#ffc86e', '#ff8a5c'], r) };
  }
  function newHeart(c, r, scatter) {
    return { kind: 'heart', x: r() * c.W, y: scatter ? lerp(c.H * 0.2, c.H, r()) : c.H + 20 + r() * 60, s: c.brush * (2.0 + r() * 1.5), vy: -(16 + r() * 16), ph: r() * TAU, col: pick(['#f06bb4', '#ff8ac4', '#ff5a8a', '#ffc4e1'], r) };
  }
  function newBat(c, r) {
    return { kind: 'bat', rx: c.moon.r * (2.4 + r() * 2.8), ry: c.moon.r * (0.9 + r() * 1.5), w: (0.35 + r() * 0.35) * (r() < 0.5 ? -1 : 1), ph: r() * TAU, s: c.brush * (1.3 + r() * 0.8), flap: 9 + r() * 5 };
  }

  function leafPath(ctx, s) {
    ctx.beginPath(); ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.85, -s * 0.2, 0, s); ctx.quadraticCurveTo(-s * 0.85, -s * 0.2, 0, -s); ctx.closePath();
  }
  function heartPath(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y + s * 0.1, x - s * 0.9, y - s * 1.0, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.0, x + s * 1.4, y + s * 0.1, x, y + s * 0.9);
    ctx.closePath();
  }
  function batPath(ctx, x, y, s, k) {
    var up = k * s * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y - s * 0.3);
    ctx.quadraticCurveTo(x - s * 1.1, y - s * 0.9 - up, x - s * 2.2, y - s * 0.25 - up);
    ctx.quadraticCurveTo(x - s * 1.85, y + s * 0.05 - up * 0.5, x - s * 1.5, y + s * 0.35 - up * 0.3);
    ctx.quadraticCurveTo(x - s * 1.15, y + s * 0.05, x - s * 0.8, y + s * 0.42 - up * 0.15);
    ctx.quadraticCurveTo(x - s * 0.45, y + s * 0.15, x, y + s * 0.5);
    ctx.quadraticCurveTo(x + s * 0.45, y + s * 0.15, x + s * 0.8, y + s * 0.42 - up * 0.15);
    ctx.quadraticCurveTo(x + s * 1.15, y + s * 0.05, x + s * 1.5, y + s * 0.35 - up * 0.3);
    ctx.quadraticCurveTo(x + s * 1.85, y + s * 0.05 - up * 0.5, x + s * 2.2, y - s * 0.25 - up);
    ctx.quadraticCurveTo(x + s * 1.1, y - s * 0.9 - up, x, y - s * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); // head and ears
    ctx.moveTo(x - s * 0.32, y - s * 0.2); ctx.lineTo(x - s * 0.26, y - s * 0.72); ctx.lineTo(x - s * 0.08, y - s * 0.42);
    ctx.lineTo(x + s * 0.08, y - s * 0.42); ctx.lineTo(x + s * 0.26, y - s * 0.72); ctx.lineTo(x + s * 0.32, y - s * 0.2);
    ctx.closePath(); ctx.fill();
  }

  function drawFront(dt) {
    var ctx = st.ctx.front, c = st.c, t = st.t, F = st.fx, L = st.look, move = !REDUCED, spr = sprites(), i, p, q;
    if (!st.frontOn || !F) { if (st.frontDirty) { ctx.clearRect(0, 0, c.W, c.H); st.frontDirty = false; } return; }
    ctx.clearRect(0, 0, c.W, c.H); st.frontDirty = true;
    var night = L.time !== 'day', wind = st.windX;

    // fog: a soft haze along the hills, with banks drifting over the village
    if (F.fog.length) {
      var hz = ctx.createLinearGradient(0, c.horizon - c.H * 0.2, 0, c.H);
      hz.addColorStop(0, rgba(F.fogCol, 0)); hz.addColorStop(0.35, rgba(F.fogCol, 0.26)); hz.addColorStop(0.7, rgba(F.fogCol, 0.14)); hz.addColorStop(1, rgba(F.fogCol, 0.05));
      ctx.globalAlpha = 1; ctx.fillStyle = hz; ctx.fillRect(0, c.horizon - c.H * 0.2, c.W, c.H);
    }
    for (i = 0; i < F.fog.length; i++) {
      p = F.fog[i];
      if (move) { p.x += (p.v + wind * 12) * dt; if (p.x - p.w / 2 > c.W) p.x = -p.w / 2; }
      ctx.globalAlpha = p.a; ctx.drawImage(F.fogSprite, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    }

    // string lights along the roofs (winter holidays)
    if (F.lights && st.roofs.length) {
      var bulbs = ['#ff5a6e', '#ffd36e', '#7be0a0', '#7fb8ff', '#ff9ad5'], bi = 0;
      for (i = 0; i < st.roofs.length; i++) {
        var R = st.roofs[i], u = R[6], segs = [[R[0], R[1], R[2], R[3]], [R[2], R[3], R[4], R[5]]];
        for (var sgi = 0; sgi < 2; sgi++) {
          var s0 = segs[sgi], len = Math.hypot(s0[2] - s0[0], s0[3] - s0[1]), nb = Math.max(2, Math.round(len / (u * 1.6)));
          for (q = 0; q <= nb; q++) {
            var f = q / nb, bx = lerp(s0[0], s0[2], f), by = lerp(s0[1], s0[3], f) + u * 0.25, col = bulbs[bi++ % bulbs.length];
            var a = REDUCED ? 0.9 : 0.55 + 0.45 * Math.sin(t * 2.2 + bi * 1.7);
            var gs = u * 3.4;
            ctx.globalAlpha = a * (night ? 0.8 : 0.45); ctx.drawImage(tint(col, 32), bx - gs / 2, by - gs / 2, gs, gs);
            ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx, by, Math.max(0.9, u * 0.3), 0, TAU); ctx.fill();
          }
        }
      }
    }

    // seasonal and holiday things
    for (i = 0; i < F.deco.length; i++) {
      p = F.deco[i];
      switch (p.kind) {
        case 'leaf':
        case 'petal':
          if (move) {
            p.y += p.vy * dt; p.x += (p.vx + Math.sin(t * 1.6 + p.ph) * 26 + wind * 45) * dt; p.rot += p.vr * dt;
            if (p.y > c.H + 24 || p.x > c.W + 40) F.deco[i] = p = p.kind === 'leaf' ? newLeaf(c, st.rnd, false, L.time === 'night') : newPetal(c, st.rnd, false);
          }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(t * 2.1 + p.ph)));
          ctx.globalAlpha = p.kind === 'leaf' ? 0.92 : 0.88; ctx.fillStyle = p.col;
          if (p.kind === 'leaf') { leafPath(ctx, p.s); ctx.fill(); ctx.strokeStyle = 'rgba(60,20,30,0.45)'; ctx.lineWidth = Math.max(0.6, p.s * 0.12); ctx.beginPath(); ctx.moveTo(0, -p.s * 0.8); ctx.lineTo(0, p.s * 0.9); ctx.stroke(); }
          else { ctx.beginPath(); ctx.ellipse(0, 0, p.s * 0.62, p.s, 0, 0, TAU); ctx.fill(); }
          ctx.restore();
          break;
        case 'fly':
          if (move) {
            p.ang += (st.rnd() - 0.5) * 2.6 * dt * 4;
            p.x += Math.cos(p.ang) * p.sp * dt; p.y += Math.sin(p.ang) * p.sp * 0.6 * dt;
            var top = c.farTop(p.x) - c.H * 0.05;
            if (p.y < top || p.y > c.H * 0.98) p.ang = -p.ang;
            if (p.x < -10) p.x = c.W + 10; else if (p.x > c.W + 10) p.x = -10;
          }
          var bl = Math.pow(Math.max(0, Math.sin(t * p.bl + p.ph)), 2);
          if (bl < 0.03) break;
          var fs = c.brush * 8;
          ctx.globalAlpha = bl * 0.9; ctx.drawImage(tint('#e9ff8a', 32), p.x - fs / 2, p.y - fs / 2, fs, fs);
          break;
        case 'glint':
          var ga = Math.pow(Math.max(0, Math.sin(t * p.sp + p.ph)), 10);
          if (ga < 0.03) break;
          var gl = c.brush * (0.9 + ga * 1.4);
          ctx.globalAlpha = ga; ctx.strokeStyle = '#f4f0ff'; ctx.lineWidth = Math.max(0.8, c.brush * 0.22); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x - gl, p.y); ctx.lineTo(p.x + gl, p.y); ctx.moveTo(p.x, p.y - gl); ctx.lineTo(p.x, p.y + gl); ctx.stroke();
          break;
        case 'lantern':
          if (move) {
            p.y += p.vy * dt; p.x += (Math.sin(t * 0.7 + p.ph) * 6 + wind * 6) * dt;
            if (p.y < -p.s * 4) F.deco[i] = p = newLantern(c, st.rnd, false, L.holiday);
          }
          var la = smoothstep(-p.s * 4, c.H * 0.2, p.y), lg = p.s * 8;
          ctx.globalAlpha = la * (night ? 0.6 : 0.35); ctx.drawImage(tint(p.col, 64), p.x - lg / 2, p.y - lg / 2, lg, lg);
          ctx.globalAlpha = la; ctx.fillStyle = p.col;
          if (p.round) { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill(); }
          else { ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.85, p.s * 1.05, 0, 0, TAU); ctx.fill(); }
          ctx.fillStyle = 'rgba(255,240,200,0.55)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.3, p.s * 0.55, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#3a1020'; ctx.fillRect(p.x - p.s * 0.5, p.y - p.s * 1.15, p.s, p.s * 0.22); ctx.fillRect(p.x - p.s * 0.45, p.y + p.s * 0.95, p.s * 0.9, p.s * 0.2);
          ctx.strokeStyle = '#f2b33d'; ctx.lineWidth = Math.max(0.7, p.s * 0.1); ctx.beginPath(); ctx.moveTo(p.x, p.y + p.s * 1.15); ctx.lineTo(p.x, p.y + p.s * 1.7); ctx.stroke();
          break;
        case 'heart':
          if (move) {
            p.y += p.vy * dt; p.x += Math.sin(t * 1.2 + p.ph) * 14 * dt;
            if (p.y < c.H * 0.06) F.deco[i] = p = newHeart(c, st.rnd, false);
          }
          ctx.globalAlpha = 0.85 * smoothstep(c.H + 20, c.H * 0.85, p.y) * smoothstep(c.H * 0.06, c.H * 0.3, p.y);
          ctx.fillStyle = p.col; heartPath(ctx, p.x, p.y, p.s); ctx.fill();
          break;
        case 'bat':
          var bt = REDUCED ? p.ph * 3 : t, mx = c.moon.x + Math.cos(bt * p.w + p.ph) * p.rx, my = c.moon.y + Math.sin(bt * p.w * 1.3 + p.ph) * p.ry;
          ctx.globalAlpha = 0.95; ctx.fillStyle = '#0c0520';
          batPath(ctx, mx, my, p.s, REDUCED ? 0.3 : Math.sin(t * p.flap + p.ph));
          break;
      }
    }

    // snow
    for (i = 0; i < F.snow.length; i++) {
      p = F.snow[i];
      if (move) {
        p.y += p.v * dt; p.x += (Math.sin(t * p.sw + p.ph) * 12 + wind * 40) * dt;
        if (p.y > c.H + 8) F.snow[i] = p = newFlake(c, st.rnd, false);
        if (p.x > c.W + 8) p.x -= c.W + 16;
      }
      var fz = p.s * 4;
      ctx.globalAlpha = 0.85; ctx.drawImage(spr.flake, p.x - fz / 2, p.y - fz / 2, fz, fz);
    }

    // rain
    if (F.rain.length) {
      var sl = 0.07 + wind * 0.24;
      ctx.beginPath();
      for (i = 0; i < F.rain.length; i++) {
        p = F.rain[i];
        p.y += p.v * dt; p.x += p.v * sl * dt;
        if (p.y > c.H + 20) { F.rain[i] = p = newDrop(c, st.rnd, false); p.x -= sl * c.H * 0.4; }
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - sl * p.len, p.y - p.len);
      }
      ctx.globalAlpha = 1; ctx.lineCap = 'round';
      ctx.strokeStyle = night ? 'rgba(206,198,255,0.4)' : 'rgba(245,244,255,0.55)';
      ctx.lineWidth = Math.max(1, c.brush * 0.26); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* gentle lightning: the sky brightens softly once every several seconds */
  function drawLightning(ctx) {
    var F = st.fx, c = st.c, t = st.t;
    if (!F || !st.look.wx.storm || REDUCED) return;
    if (!F.flash && t > F.nextFlash && !SK.gateOpen && st.active) {
      var x = c.W * (0.15 + st.rnd() * 0.7), y = c.H * (0.08 + st.rnd() * 0.15), pts = [[x, y]];
      while (y < c.farTop(x)) { x += (st.rnd() - 0.5) * c.brush * 9; y += c.brush * (4 + st.rnd() * 5); pts.push([x, y]); }
      F.flash = { t0: t, bolt: pts };
      F.nextFlash = t + 7 + st.rnd() * 9;
    }
    if (!F.flash) return;
    var age = t - F.flash.t0;
    if (age > 0.9) { F.flash = null; return; }
    var a = 0.2 * Math.exp(-age * 6) + (age > 0.12 ? 0.12 * Math.exp(-(age - 0.12) * 8) : 0);
    ctx.globalAlpha = a; ctx.fillStyle = st.look.time === 'day' ? '#ffffff' : '#d9d0ff'; ctx.fillRect(0, 0, c.W, c.H);
    if (age < 0.32) {
      var b = F.flash.bolt;
      ctx.beginPath(); ctx.moveTo(b[0][0], b[0][1]);
      for (var i = 1; i < b.length; i++) ctx.lineTo(b[i][0], b[i][1]);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.3; ctx.strokeStyle = '#c9b4ff'; ctx.lineWidth = c.brush * 2.2; ctx.stroke();
      ctx.globalAlpha = 0.85 * (age < 0.08 || age > 0.14 ? 1 : 0.4); ctx.strokeStyle = '#fff8ff'; ctx.lineWidth = Math.max(1.2, c.brush * 0.45); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* fireworks for New Year's and Canada Day, rising from behind the village */
  function drawFireworks(ctx, dt) {
    var F = st.fx && st.fx.fireworks, c = st.c, t = st.t, i, p;
    if (!F || REDUCED) return;
    if (!F.next) F.next = t + 1.2;
    if (t > F.next && st.active && !SK.gateOpen && F.rockets.length < 3) {
      var x = c.W * (0.15 + st.rnd() * 0.7);
      F.rockets.push({ x: x, y: c.farTop(x) + 6, vx: (st.rnd() - 0.5) * 30, vy: -c.H * (0.62 + st.rnd() * 0.25), age: 0, life: 0.9 + st.rnd() * 0.45, col: pick(F.cols, st.rnd), col2: pick(F.cols, st.rnd) });
      F.next = t + 0.9 + st.rnd() * 1.8;
    }
    ctx.globalCompositeOperation = 'lighter'; // light adds up, like real fireworks
    ctx.lineCap = 'round';
    for (i = F.rockets.length - 1; i >= 0; i--) {
      p = F.rockets[i]; p.age += dt;
      p.vy *= Math.exp(-dt * 1.3); p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = 0.5; ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, c.brush * 0.35);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06); ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.drawImage(tint(p.col, 32), p.x - 6, p.y - 6, 12, 12);
      if (p.age > p.life) {
        var n = 54 + ((st.rnd() * 26) | 0), sp = c.D * (0.22 + st.rnd() * 0.12);
        for (var k = 0; k < n; k++) {
          var a = (k / n) * TAU + st.rnd() * 0.15, v = sp * (0.75 + st.rnd() * 0.35);
          F.sparks.push({ x: p.x, y: p.y, px: p.x, py: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 1.4 + st.rnd() * 0.9, col: k % 3 ? p.col : p.col2 });
        }
        if (F.sparks.length > 480) F.sparks.splice(0, F.sparks.length - 480);
        F.rockets.splice(i, 1);
      }
    }
    for (i = F.sparks.length - 1; i >= 0; i--) {
      p = F.sparks[i]; p.age += dt;
      if (p.age > p.life) { F.sparks.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y;
      p.vx *= Math.exp(-dt * 1.6); p.vy = p.vy * Math.exp(-dt * 1.6) + 62 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      var fa = Math.pow(1 - p.age / p.life, 1.3), sz = c.brush * 3.8;
      ctx.globalAlpha = fa * 0.7; ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, c.brush * 0.4);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.07, p.y - p.vy * 0.07); ctx.stroke();
      ctx.globalAlpha = fa; ctx.drawImage(tint(p.col, 32), p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------------
   * Dynamic flow: static field + cursor stir + tap ripples + new stars
   * --------------------------------------------------------------------- */
  var DYN = [0, 0, 1];
  function flowDyn(x, y) {
    st.field.sample(x, y, DYN);
    var vx = DYN[0], vy = DYN[1], speed = 1, dx, dy, d, w, i;
    var p = st.pointer;
    if (p.energy > 0.01) {
      dx = x - p.x; dy = y - p.y;
      var R = st.c.brush * 32, d2 = dx * dx + dy * dy;
      w = Math.exp(-d2 / (R * R)) * p.energy;
      if (w > 0.003) { d = Math.sqrt(d2) + 0.01; vx += (-dy / d) * w * 2.4; vy += (dx / d) * w * 2.4; speed += w * 3.2; }
    }
    for (i = 0; i < st.ripples.length; i++) {
      var rp = st.ripples[i];
      dx = x - rp.x; dy = y - rp.y; d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      w = Math.exp(-Math.pow((d - rp.rad) / rp.width, 2)) * rp.str;
      if (w > 0.003) { vx += (dx / d) * w * 2.6; vy += (dy / d) * w * 2.6; speed += w * 2.4; }
    }
    var m = Math.sqrt(vx * vx + vy * vy) || 1; // (stars you paint join the flow field itself, see paintUserStar)
    DYN[0] = vx / m; DYN[1] = vy / m; DYN[2] = speed;
    return DYN;
  }

  /* ------------------------------------------------------------------------
   * Interaction
   * --------------------------------------------------------------------- */
  function starAt(x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < st.stars.length; i++) {
      var s = st.stars[i], d = Math.hypot(x - s.x, y - s.y), hit = Math.max(24, s.rc * 3.2);
      if (d < hit && d < bd) { best = s; bd = d; }
    }
    return best;
  }
  function addRipple(x, y, str) {
    st.ripples.push({ x: x, y: y, rad: 0, width: st.c.brush * 9, str: str || 1, age: 0, life: 1.5 });
    if (st.ripples.length > 6) st.ripples.shift();
  }
  function addSparks(x, y, n, spread, warm) {
    for (var i = 0; i < n; i++) {
      var a = st.rnd() * TAU, v = (60 + st.rnd() * 170) * (spread || 1);
      st.sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, age: 0, life: 0.6 + st.rnd() * 0.8, size: 2 + st.rnd() * 3.5, warm: !!warm && st.rnd() < 0.7 });
    }
    if (st.sparks.length > 160) st.sparks.splice(0, st.sparks.length - 160);
  }
  function ignite(s) {
    s.energy = 1;
    addRipple(s.x, s.y, 1);
    addSparks(s.x, s.y, REDUCED ? 6 : 18);
    Sound.chime(s.y / st.c.horizon, 1);
  }
  function linkTo(s) {
    var t = st.t, last = st.lastTap;
    if (last && last.star !== s && t - last.t < 7) {
      st.links.push({ a: last.star, b: s, born: t, seed: (st.rnd() * 1e6) | 0 });
      if (st.links.length > 14) st.links.shift();
    }
    st.lastTap = { star: s, t: t };
  }
  var MAX_USER = 24;
  /* A new star pulls the paint around it into rings, just like the painted ones:
     its halo joins the flow field, then the sky around it is repainted stroke by
     stroke, from the middle outward, so you can watch the swirl spread. */
  function genPatch(c, field, nz, r, cx, cy, R, p) {
    var b = c.brush, sp = b * p.spacing, out = [], tmp = [0, 0];
    for (var gy = cy - R; gy < cy + R; gy += sp) {
      for (var gx = cx - R; gx < cx + R; gx += sp) {
        var x = gx + r() * sp, y = gy + r() * sp, d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d > R || r() < smoothstep(R * 0.62, R, d)) continue; // a feathered edge melts into the old paint
        if (y > c.farTop(x) + b * 2) continue;
        var cl = c.clouds ? cloudAt(c, nz, x, y) : 0, col;
        if (cl > 0.3 && r() < (cl - 0.2) * 2.2) col = 28 + Math.floor(clamp(0.25 + cl * 0.45 + (r() - 0.5) * 0.3, 0, 0.999) * 8);
        else col = toneAt(c, nz, x, y, r, p.lift);
        if (p.onlyLight && !isLight(col)) continue;
        var len = b * lerp(p.len[0], p.len[1], r()), w = b * lerp(p.width[0], p.width[1], r());
        traceInto(out, field, tmp, x, y, len);
        out.push(w, col, p.alpha);
      }
    }
    return new Float32Array(out);
  }
  function rippleJob(ctx, data, cx, cy, r, perFrame) {
    var n = data.length / REC, order = [], i = 0;
    for (var k = 0; k < n; k++) { var o = k * REC; order.push([k, Math.hypot(data[o + 2] - cx, data[o + 3] - cy) + r() * 9]); }
    order.sort(function (a, b) { return a[1] - b[1]; });
    return function () {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var end = Math.min(n, i + perFrame);
      for (; i < end; i++) drawRec(ctx, data, order[i][0]);
      ctx.globalAlpha = 1;
      return i >= n;
    };
  }
  function goldRings(ctx, s, r) {
    var b = st.c.brush;
    ctx.lineCap = 'round';
    for (var ring = 0; ring < 2; ring++) {
      var rad = s.rc * 1.6 + ring * s.h * 0.34, n = Math.round((TAU * rad) / (b * 1.7));
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU + r() * 0.2, len = (b * (2 + r() * 1.2)) / rad;
        ctx.strokeStyle = PAL[pick([27, 26, 25], r)]; ctx.lineWidth = b * (0.6 + r() * 0.25); ctx.globalAlpha = 0.85 - ring * 0.2;
        ctx.beginPath(); ctx.arc(s.x, s.y, rad + (r() - 0.5) * b * 0.6, a, a + len); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function paintUserStar(s) {
    var c = st.c, ctx = st.ctx.paint, r = mulberry32((s.x * 13 + s.y * 7) | 0), nz = st.nz, field = st.field, R = s.h * 2.4;
    c.halos.push({ x: s.x, y: s.y, h: s.h, spin: s.spin, w: s.wish ? 1.1 : 0.95 });
    field.refresh(s.x - s.h * 4, s.y - s.h * 4, s.x + s.h * 4, s.y + s.h * 4);
    var base = genPatch(c, field, nz, r, s.x, s.y, R, { spacing: 1.3, width: [0.85, 1.2], len: [3.0, 5.0], alpha: 0.94, lift: 0 });
    var ridges = genRidges(base, r, 0.3);
    var light = genPatch(c, field, nz, r, s.x, s.y, R * 0.92, { spacing: 1.9, width: [0.55, 0.8], len: [2.6, 4.0], alpha: 0.95, lift: 0.08, onlyLight: true });
    var per = Math.max(8, Math.round(base.length / REC / 36)), halo = s.wish ? '#ffe2a8' : UNDER[st.look.time].halo;
    st.jobs.push(function () {
      var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
      g.addColorStop(0, rgba(halo, 0.36)); g.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = g; ctx.fillRect(s.x - R, s.y - R, R * 2, R * 2);
      return true;
    });
    st.jobs.push(rippleJob(ctx, base, s.x, s.y, r, per));
    st.jobs.push(rippleJob(ctx, ridges, s.x, s.y, r, per));
    st.jobs.push(rippleJob(ctx, light, s.x, s.y, r, per));
    st.jobs.push(function () {
      if (s.wish) goldRings(ctx, s, r);
      paintStarCore(ctx, s.x, s.y, s.rc, r, s.wish);
      s.painted = true;
      return true;
    });
    // run these jobs even if the main painting is finished
    if (st.painted) st.painted = false;
  }
  function addUserStar(x, y, opts) {
    opts = opts || {};
    var rc = st.c.brush * (opts.wish ? 1.7 : 1.05 + st.rnd() * 0.35);
    var s = makeStar(x, y, rc, { user: true, spin: st.rnd() < 0.5 ? 1 : -1, warm: opts.wish, wish: opts.wish });
    st.stars.push(s);
    paintUserStar(s);
    s.energy = 1;
    addRipple(x, y, 0.9);
    addSparks(x, y, REDUCED ? 5 : opts.wish ? 30 : 14, opts.wish ? 1.2 : 0.8, opts.wish);
    if (!opts.quiet) Sound.chime(y / st.c.horizon, 0.85);
    return s;
  }
  function onTap(x, y) {
    if (!st.c) return;
    var c = st.c;
    if (y > c.farTop(x) || (st.poly && inPoly(st.poly, x, y))) { addRipple(x, y, 0.6); return; }
    var s = starAt(x, y), userCount = 0;
    if (s) { ignite(s); linkTo(s); emit('sk:star', { kind: 'lit' }); return; }
    for (var i = 0; i < st.stars.length; i++) if (st.stars[i].user) userCount++;
    if (userCount >= MAX_USER) { addRipple(x, y, 0.8); addSparks(x, y, 8, 0.6); return; }
    var ns = addUserStar(x, y);
    linkTo(ns);
    emit('sk:star', { kind: 'new' });
  }
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }
  function isUI(target) {
    return !!(target && target.closest && target.closest('[data-ui], a, button, input, textarea, select, label, .gate'));
  }
  function bindInput() {
    window.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || !st.active || isUI(e.target) || SK.gateOpen || SK.wishOpen) return;
      var m = meteorAt(e.clientX, e.clientY);
      if (m) { catchMeteor(m); return; }
      onTap(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('pointermove', function (e) {
      var p = st.pointer, mouse = e.pointerType === 'mouse';
      p.mouse = mouse;
      if (p.seen) {
        var v = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        p.energy = clamp(p.energy + v * 0.012, 0, 1.4);
      }
      p.x = e.clientX; p.y = e.clientY; p.seen = true;
      if (mouse && st.c) {
        var h = !st.active || isUI(e.target) || SK.gateOpen ? null : starAt(p.x, p.y) || meteorAt(p.x, p.y);
        if (h !== st.hover) { st.hover = h; document.documentElement.classList.toggle('on-star', !!h); }
      }
    }, { passive: true });
    document.addEventListener('pointerleave', function () { st.pointer.seen = false; st.pointer.x = st.pointer.y = -1e4; });
    window.addEventListener('blur', function () { st.pointer.seen = false; });
  }

  /* ------------------------------------------------------------------------
   * Shooting stars: they come by every so often, slow enough to catch
   * --------------------------------------------------------------------- */
  function spawnMeteor() {
    var c = st.c, dir = st.rnd() < 0.5 ? -1 : 1, ang = 0.24 + st.rnd() * 0.26;
    var sp = REDUCED ? 0 : clamp(c.D * 0.19, 140, 240) * (0.9 + st.rnd() * 0.2);
    var x0 = dir > 0 ? c.W * (0.04 + st.rnd() * 0.4) : c.W * (0.56 + st.rnd() * 0.4);
    st.meteors.push({ x: x0, y: c.H * (0.04 + st.rnd() * 0.2), vx: Math.cos(ang) * dir, vy: Math.sin(ang), sp: sp, age: 0, k: 1,
                      life: REDUCED ? 4.5 : 3.0 + st.rnd() * 0.6, tail: c.brush * (28 + st.rnd() * 14) });
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function meteorAt(x, y) {
    if (!st.c) return null;
    var R = Math.max(40, st.c.brush * 10);
    for (var i = st.meteors.length - 1; i >= 0; i--) {
      var m = st.meteors[i];
      if (m.age / m.life > 0.96) continue;
      var lead = m.sp ? R * 0.6 : 0; // fingers land a moment late, so reach ahead of the head a little
      if (distToSeg(x, y, m.x + m.vx * lead, m.y + m.vy * lead, m.x - m.vx * m.tail * 0.6, m.y - m.vy * m.tail * 0.6) < R) return m;
    }
    return null;
  }
  function catchMeteor(m) {
    st.meteors.splice(st.meteors.indexOf(m), 1);
    addRipple(m.x, m.y, 1.1);
    addSparks(m.x, m.y, REDUCED ? 10 : 34, 1.15, true);
    Sound.sparkle();
    st.caught = { x: m.x, y: m.y };
    st.nextMeteor = st.t + 12 + st.rnd() * 8;
    emit('sk:meteor', { x: m.x, y: m.y });
  }
  function drawMeteors(ctx, dt) {
    if (STILL) return;
    var c = st.c, t = st.t, spr = sprites();
    if (!st.nextMeteor) st.nextMeteor = t + 6 + st.rnd() * 5;
    if (t > st.nextMeteor) {
      if (st.active && !SK.gateOpen && !SK.wishOpen && !document.hidden) spawnMeteor();
      st.nextMeteor = t + 9 + st.rnd() * 9;
    }
    var p = st.pointer;
    for (var i = st.meteors.length - 1; i >= 0; i--) {
      var m = st.meteors[i];
      // time slows down when the cursor gets close, so it can actually be caught
      var near = p.mouse && p.seen ? 1 - smoothstep(50, 190, Math.hypot(p.x - m.x, p.y - m.y)) : 0;
      m.k += (1 - near * 0.72 - m.k) * Math.min(1, dt * 7);
      m.age += dt * (0.4 + 0.6 * m.k);
      if (m.age > m.life) { st.meteors.splice(i, 1); continue; }
      m.x += m.vx * m.sp * m.k * dt; m.y += m.vy * m.sp * m.k * dt;
      var q = m.age / m.life, f = Math.sin(Math.PI * q), tl = m.tail * (m.sp ? 0.55 + 0.45 * smoothstep(0, 0.3, q) : 1);
      var tx = m.x - m.vx * tl, ty = m.y - m.vy * tl;
      var g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, 'rgba(255,246,232,0.95)'); g.addColorStop(0.3, 'rgba(255,190,225,0.5)'); g.addColorStop(1, 'rgba(255,190,225,0)');
      ctx.globalAlpha = f; ctx.strokeStyle = g; ctx.lineWidth = c.brush * 0.7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
      var hs = c.brush * (9 + Math.sin(t * 18) * 1.2);
      ctx.drawImage(spr.star, m.x - hs / 2, m.y - hs / 2, hs, hs);
    }
  }

  /* ------------------------------------------------------------------------
   * Felis easter egg: cat-shaped shooting stars, drawn on a layer above
   * everything so they show up wherever you are on the page
   * --------------------------------------------------------------------- */
  function ensureFx() {
    var W = window.innerWidth, H = window.innerHeight;
    if (!st.cv.fx) {
      var cv = document.createElement('canvas');
      cv.className = 'fx'; cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
      st.cv.fx = cv;
    }
    if (st.fxW !== W || st.fxH !== H) { st.ctx.fx = sizeCanvas(st.cv.fx, W, H, Math.min(window.devicePixelRatio || 1, 1.75)); st.fxW = W; st.fxH = H; }
    st.cv.fx.style.display = 'block'; st.fxShown = true;
  }
  function meowShower() {
    if (!st.started) return;
    ensureFx();
    var W = st.fxW, H = st.fxH, n = REDUCED ? 7 : 13, D = Math.sqrt(W * H);
    for (var i = 0; i < n; i++) {
      var dir = Math.random() < 0.5 ? -1 : 1, ang = 0.35 + Math.random() * 0.35;
      st.cats.push({
        x: REDUCED ? W * (0.1 + Math.random() * 0.8) : dir > 0 ? W * (Math.random() * 0.55) : W * (0.45 + Math.random() * 0.55),
        y: REDUCED ? H * (0.1 + Math.random() * 0.6) : H * (-0.05 + Math.random() * 0.35),
        vx: Math.cos(ang) * dir, vy: Math.sin(ang), sp: REDUCED ? 0 : clamp(D * 0.42, 280, 520) * (0.85 + Math.random() * 0.3),
        delay: i * (REDUCED ? 0.3 : 0.2) + Math.random() * 0.15, age: 0, life: REDUCED ? 2.6 : 1.6 + Math.random() * 0.7,
        s: clamp(D * 0.014, 9, 16) * (0.85 + Math.random() * 0.4), tail: clamp(D * 0.12, 80, 160)
      });
    }
    Sound.mew();
    setTimeout(function () { Sound.mew(); }, 650);
  }
  function catFace(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.92, y - s * 0.2); ctx.lineTo(x - s * 0.78, y - s * 1.12); ctx.lineTo(x - s * 0.24, y - s * 0.7);
    ctx.lineTo(x + s * 0.24, y - s * 0.7); ctx.lineTo(x + s * 0.78, y - s * 1.12); ctx.lineTo(x + s * 0.92, y - s * 0.2);
    ctx.quadraticCurveTo(x + s * 1.05, y + s * 0.78, x, y + s * 0.82);
    ctx.quadraticCurveTo(x - s * 1.05, y + s * 0.78, x - s * 0.92, y - s * 0.2);
    ctx.closePath(); ctx.fillStyle = '#fff3e0'; ctx.fill();
    ctx.fillStyle = '#3b1f7a';
    ctx.beginPath(); ctx.ellipse(x - s * 0.38, y + s * 0.02, s * 0.11, s * 0.16, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s * 0.38, y + s * 0.02, s * 0.11, s * 0.16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f06bb4';
    ctx.beginPath(); ctx.moveTo(x - s * 0.12, y + s * 0.26); ctx.lineTo(x + s * 0.12, y + s * 0.26); ctx.lineTo(x, y + s * 0.4); ctx.closePath(); ctx.fill();
  }
  function drawFx(dt) {
    if (!st.fxShown) return;
    var ctx = st.ctx.fx, W = st.fxW, H = st.fxH, spr = sprites();
    ctx.clearRect(0, 0, W, H);
    if (!st.cats.length) { st.cv.fx.style.display = 'none'; st.fxShown = false; return; }
    for (var i = st.cats.length - 1; i >= 0; i--) {
      var k = st.cats[i];
      k.age += dt;
      var a = k.age - k.delay;
      if (a < 0) continue;
      if (a > k.life) { st.cats.splice(i, 1); continue; }
      var f = Math.sin(Math.PI * (a / k.life)), x = k.x + k.vx * k.sp * a, y = k.y + k.vy * k.sp * a;
      if (k.sp) {
        var tx = x - k.vx * k.tail, ty = y - k.vy * k.tail, g = ctx.createLinearGradient(x, y, tx, ty);
        g.addColorStop(0, 'rgba(255,230,240,0.9)'); g.addColorStop(0.35, 'rgba(240,107,180,0.45)'); g.addColorStop(1, 'rgba(240,107,180,0)');
        ctx.globalAlpha = f; ctx.strokeStyle = g; ctx.lineWidth = k.s * 0.45; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      }
      ctx.globalAlpha = f * 0.8; ctx.drawImage(spr.star, x - k.s * 3, y - k.s * 3, k.s * 6, k.s * 6);
      ctx.globalAlpha = f; catFace(ctx, x, y, k.s);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------------
   * Hyperspace: a quick rush of pink and lilac starlight when the page jumps
   * from one constellation to the next. It sits above the dimmed sky and
   * below the words, so it never covers what you're reading.
   * --------------------------------------------------------------------- */
  var WARP_COLS = ['#ffe3ef', '#f9a6d3', '#c9b4ff', '#9aa4ef', '#ffffff', '#f06bb4', '#ffc4e1', '#fff1d6'];
  var warpRun = null;
  function warp(dir) {
    if (REDUCED || !st.started) return;
    var W = window.innerWidth, H = window.innerHeight;
    if (!st.cv.warp) {
      var cv = document.createElement('canvas'), scrim = document.querySelector('.scrim');
      cv.className = 'warp'; cv.setAttribute('aria-hidden', 'true');
      if (scrim && scrim.parentNode) scrim.parentNode.insertBefore(cv, scrim.nextSibling); else document.body.appendChild(cv);
      st.cv.warp = cv;
    }
    if (st.warpW !== W || st.warpH !== H) { st.ctx.warp = sizeCanvas(st.cv.warp, W, H, Math.min(window.devicePixelRatio || 1, 1.5)); st.warpW = W; st.warpH = H; }
    var n = Math.round(clamp((W * H) / 9500, 60, 150)), streaks = [];
    for (var i = 0; i < n; i++) {
      streaks.push({ a: Math.random() * TAU, r: 0.03 + Math.pow(Math.random(), 0.7) * 0.55, sp: 0.6 + Math.random() * 1.5, w: 0.6 + Math.random() * 1.6, col: WARP_COLS[(Math.random() * WARP_COLS.length) | 0] });
    }
    warpRun = { t0: now(), dur: 850, dir: dir < 0 ? -1 : 1, streaks: streaks };
    st.cv.warp.style.display = 'block';
  }
  function drawWarp() {
    if (!warpRun) return;
    var w = warpRun, t = (now() - w.t0) / w.dur, ctx = st.ctx.warp, W = st.warpW, H = st.warpH;
    ctx.clearRect(0, 0, W, H);
    if (t >= 1) { warpRun = null; st.cv.warp.style.display = 'none'; return; }
    var env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.8), cx = W / 2, cy = H * 0.46, R = Math.hypot(W, H) * 0.58;
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
    g.addColorStop(0, 'rgba(255,196,230,' + (0.2 * env).toFixed(3) + ')'); g.addColorStop(0.5, 'rgba(170,120,240,' + (0.1 * env).toFixed(3) + ')'); g.addColorStop(1, 'rgba(120,90,220,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (var i = 0; i < w.streaks.length; i++) {
      var s = w.streaks[i], q = w.dir > 0 ? t : 1 - t;
      var d = s.r + q * q * s.sp * 0.95, len = (0.03 + 0.32 * env) * s.sp * (0.4 + d);
      var d0 = w.dir > 0 ? d - len : d + len, ca = Math.cos(s.a), sa = Math.sin(s.a);
      ctx.globalAlpha = env * 0.8 * (0.25 + 0.75 * smoothstep(0.02, 0.3, d));
      ctx.strokeStyle = s.col; ctx.lineWidth = s.w * (0.5 + d * 1.9);
      ctx.beginPath(); ctx.moveTo(cx + ca * Math.max(0, d0) * R, cy + sa * Math.max(0, d0) * R); ctx.lineTo(cx + ca * d * R, cy + sa * d * R); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------------
   * The live layer, redrawn every frame
   * --------------------------------------------------------------------- */
  var RING_COLS = ['#ffe3ef', '#c9b4ff', '#9aa4ef'];
  var TAIL = [0, 0];
  function drawLive(dt) {
    var ctx = st.ctx.live, c = st.c, t = st.t, spr = sprites(), i, k, s, glowK = c.tone.glow;
    ctx.clearRect(0, 0, c.W, c.H);

    // 1. drifting brushwork (rests while the visitor is reading further down)
    var P = st.parts, n = st.active ? st.nParts : 0;
    if (n) {
      for (i = 0; i < n; i++) {
        var v = flowDyn(P.x[i], P.y[i]);
        P.x[i] += v[0] * P.spd[i] * v[2] * dt;
        P.y[i] += v[1] * P.spd[i] * v[2] * dt;
        P.age[i] += dt;
        if (P.age[i] > P.life[i] || P.x[i] < -20 || P.x[i] > c.W + 20 || P.y[i] < -20 || P.y[i] > c.farTop(P.x[i]) - 2 || inSwirlEye(P.x[i], P.y[i])) spawn(i);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.82;
      for (var col = 0; col < PAL.length; col++) {
        var any = false;
        for (var wc = 0; wc < 2; wc++) {
          ctx.beginPath(); any = false;
          for (i = 0; i < n; i++) {
            if (P.col[i] !== col || (P.w[i] > c.brush * 0.77 ? 1 : 0) !== wc) continue;
            var life = P.life[i], age = P.age[i];
            var f = smoothstep(0, 0.7, age) * (1 - smoothstep(life - 0.9, life, age));
            if (f < 0.05) continue;
            var seg = c.brush * 1.6 * f, px = P.x[i], py = P.y[i];
            ctx.moveTo(px, py);
            for (k = 0; k < 3; k++) { st.field.sample(px, py, TAIL); px -= TAIL[0] * seg; py -= TAIL[1] * seg; ctx.lineTo(px, py); }
            any = true;
          }
          if (any) { ctx.strokeStyle = PAL[col]; ctx.lineWidth = c.brush * (wc ? 0.85 : 0.66); ctx.stroke(); }
        }
      }
    }

    // 2. dust stars twinkling
    for (i = 0; i < st.dust.length; i++) {
      var d = st.dust[i], a = d.a * (0.55 + 0.45 * Math.sin(t * d.s + d.p));
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      var sz = d.r * 6;
      ctx.drawImage(spr.dot, d.x - sz / 2, d.y - sz / 2, sz, sz);
    }

    // 3. star glows (twinkle + hover + energy) and growing new stars
    for (i = 0; i < st.stars.length; i++) {
      s = st.stars[i];
      var target = s === st.hover ? 1 : 0;
      s.glow += (target - s.glow) * Math.min(1, dt * 8);
      s.energy *= Math.exp(-dt * 1.5);
      var grow = s.user ? smoothstep(0, 1.1, t - s.born) : 1;
      var tw = 0.55 + 0.25 * Math.sin(t * 1.7 + s.phase) + 0.15 * Math.sin(t * 4.3 + s.phase * 2);
      ctx.globalAlpha = clamp(((0.30 + 0.22 * tw) * (s.user ? 1 : glowK) + s.glow * 0.45 + s.energy * 0.6) * grow, 0, 1);
      var gsz = s.h * (2.0 + s.glow * 0.9 + s.energy * 1.8) * (0.4 + 0.6 * grow);
      ctx.drawImage(spr.star, s.x - gsz / 2, s.y - gsz / 2, gsz, gsz);
      if (s.user && !s.painted) { // core appears before the paint job lands
        ctx.globalAlpha = grow;
        var csz = s.rc * 3.2 * grow;
        ctx.drawImage(spr.star, s.x - csz / 2, s.y - csz / 2, csz, csz);
      }
    }

    // 4. halo rings — little dashes circling each star
    var lw = Math.max(1.1, c.brush * 0.42);
    ctx.lineCap = 'round'; ctx.lineWidth = lw;
    for (var rc = 0; rc < 3; rc++) {
      ctx.beginPath();
      for (i = 0; i < st.stars.length; i++) {
        s = st.stars[i];
        var g2 = s.user ? smoothstep(0.2, 1.4, t - s.born) : 1;
        if (g2 <= 0.01) continue;
        traceRing(ctx, s, s.rings[rc], t, g2, 0);
      }
      ctx.globalAlpha = 0.34 * glowK; ctx.strokeStyle = RING_COLS[rc]; ctx.stroke();
    }
    for (i = 0; i < st.stars.length; i++) { // brighter rings on lit-up stars
      s = st.stars[i];
      var e = Math.max(s.glow, s.energy);
      if (e < 0.03) continue;
      for (rc = 0; rc < 3; rc++) {
        ctx.beginPath(); traceRing(ctx, s, s.rings[rc], t, 1, e);
        ctx.globalAlpha = clamp(e * 0.85, 0, 0.9); ctx.strokeStyle = s.wish && rc !== 1 ? '#ffe0a0' : RING_COLS[rc]; ctx.lineWidth = lw * (1 + e * 0.6); ctx.stroke();
      }
      ctx.lineWidth = lw;
    }

    // 5. constellation lines
    drawLinks(ctx, t);

    // 6. tap ripples
    for (i = st.ripples.length - 1; i >= 0; i--) {
      var rp = st.ripples[i];
      rp.age += dt;
      var q = rp.age / rp.life;
      if (q >= 1) { st.ripples.splice(i, 1); continue; }
      rp.rad = c.brush * 48 * (1 - Math.pow(1 - q, 2.2));
      rp.str = (1 - q) * (rp.str0 || (rp.str0 = rp.str));
      ctx.beginPath();
      for (k = 0; k <= 48; k++) {
        var th = (k / 48) * TAU, rr = rp.rad * (1 + 0.035 * Math.sin(th * 5 + t * 3) + 0.02 * Math.sin(th * 9 - t * 2));
        var xx = rp.x + Math.cos(th) * rr, yy = rp.y + Math.sin(th) * rr;
        if (k) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
      }
      ctx.globalAlpha = (1 - q) * 0.55; ctx.strokeStyle = '#f9a6d3'; ctx.lineWidth = lw * 1.3; ctx.stroke();
    }

    // 7. sparks
    for (i = st.sparks.length - 1; i >= 0; i--) {
      var sp = st.sparks[i];
      sp.age += dt;
      if (sp.age > sp.life) { st.sparks.splice(i, 1); continue; }
      sp.vx *= Math.exp(-dt * 2.4); sp.vy = sp.vy * Math.exp(-dt * 2.4) + 40 * dt;
      sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      var fa = 1 - sp.age / sp.life, ss = sp.size * (0.6 + fa) * 2.4;
      ctx.globalAlpha = fa; ctx.drawImage(sp.warm ? tint('#ffc86e', 32) : spr.dot, sp.x - ss / 2, sp.y - ss / 2, ss, ss);
    }

    // 8. storms, fireworks and shooting stars
    drawLightning(ctx);
    drawFireworks(ctx, dt);
    drawMeteors(ctx, dt);

    // 9. a soft lantern glow following the mouse
    var p = st.pointer;
    p.energy *= Math.exp(-dt * 2.2);
    if (st.active && p.mouse && p.seen && !SK.gateOpen) {
      ctx.globalAlpha = 0.20 + (st.hover ? 0.12 : 0);
      var ps = c.brush * 44;
      ctx.drawImage(spr.soft, p.x - ps / 2, p.y - ps / 2, ps, ps);
    }
    ctx.globalAlpha = 1;
  }

  function traceRing(ctx, s, ring, t, grow, boost) {
    var base = s.h * ring.f * (0.35 + 0.65 * grow) * (1 + boost * 0.14);
    var rot = t * ring.speed * ring.dir * (1 + boost * 1.5);
    for (var i = 0; i < ring.dashes.length; i++) {
      var dsh = ring.dashes[i], a = dsh.a + rot;
      var r = base * (1 + dsh.j + 0.035 * Math.sin(t * 1.3 + dsh.a * 3 + s.phase));
      ctx.moveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      ctx.arc(s.x, s.y, r, a, a + dsh.len);
    }
  }

  function drawLinks(ctx, t) {
    if (!st.links.length) return;
    var boil = Math.floor(t * 8);
    for (var i = st.links.length - 1; i >= 0; i--) {
      var L = st.links[i], age = t - L.born, fade = 1 - smoothstep(9, 12, age);
      if (fade <= 0) { st.links.splice(i, 1); continue; }
      var grow = smoothstep(0, 0.45, age);
      var ax = L.a.x, ay = L.a.y, bx = L.b.x, by = L.b.y;
      var dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len;
      var r = mulberry32(L.seed + boil * 977), segs = Math.max(6, Math.round(len / 18));
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (var k = 1; k <= segs; k++) {
        var q = (k / segs) * grow, wob = k === segs && grow >= 1 ? 0 : (r() - 0.5) * 2.4 + Math.sin(q * 9 + t) * 1.2;
        ctx.lineTo(ax + dx * q + nx * wob, ay + dy * q + ny * wob);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.20 * fade; ctx.strokeStyle = '#f06bb4'; ctx.lineWidth = st.c.brush * 1.6; ctx.stroke();
      ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = '#ffe3ef'; ctx.lineWidth = Math.max(1.2, st.c.brush * 0.36); ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------------
   * When the sky changes (the weather arrives, the sun sets, the visitor
   * picks "always night"), repaint underneath and fade the old picture out
   * --------------------------------------------------------------------- */
  function snapshotFade() {
    var cv = st.cv.fade;
    if (!cv) { cv = st.cv.fade = document.createElement('canvas'); cv.className = 'sky__fade'; st.root.appendChild(cv); }
    var W = st.w, H = st.h, ctx = sizeCanvas(cv, W, H, Math.min(st.dpr, 1.5));
    ['paint', 'live', 'land', 'cypress', 'front'].forEach(function (k) { if (st.cv[k]) ctx.drawImage(st.cv[k], 0, 0, W, H); });
    cv.style.transition = 'none'; cv.style.opacity = '1'; cv.style.display = 'block';
  }
  function fadeOut() {
    var cv = st.cv.fade;
    if (!cv) return;
    void cv.offsetWidth;
    cv.style.transition = 'opacity 1.4s ease'; cv.style.opacity = '0';
    setTimeout(function () { if (cv.style.opacity === '0') cv.style.display = 'none'; }, 1500);
  }
  function relook() {
    if (!st.c) return;
    var L = readLook();
    if (lookKey(L) === st.lookKey) { st.look = L; applyWind(L); return; }
    var fade = st.painted && !REDUCED;
    if (fade) snapshotFade();
    var keep = st.stars.filter(function (s) { return s.user; }).map(function (s) { return { x: s.x, y: s.y, wish: s.wish }; });
    build();
    keep.forEach(function (k) { var s = addUserStar(k.x, k.y, { wish: k.wish, quiet: true }); s.energy = 0; s.born -= 2; });
    st.ripples = []; st.sparks = [];
    if (fade) st.onPainted = fadeOut;
  }

  /* ------------------------------------------------------------------------
   * Main loop
   * --------------------------------------------------------------------- */
  function frame(ts) {
    st.raf = requestAnimationFrame(frame);
    var dt = st.last ? Math.min(0.05, (ts - st.last) / 1000) : 0.016;
    st.last = ts; st.t += dt;
    if (!st.c) return;
    if (st.jobs.length) {
      var deadline = now() + (SK.gateOpen ? 14 : 8);
      while (st.jobs.length && now() < deadline) {
        if (st.jobs[0](deadline) !== false) st.jobs.shift(); else break;
      }
    }
    if (!st.jobs.length && !st.painted) {
      st.painted = true; paintedResolve();
      if (st.onPainted) { var cb = st.onPainted; st.onPainted = null; cb(); }
    }
    st.frameNo++;
    drawFx(dt); // the cat shower shows wherever you are on the page
    drawWarp();
    if (!st.active) { // dimmed behind the text: twinkle at half rate to save battery
      st.skipped = (st.skipped || 0) + dt;
      if (st.frameNo % 2) return;
      dt = st.skipped; st.skipped = 0;
    }
    drawLive(dt);
    drawFront(dt);
    adapt(dt);
  }
  function adapt(dt) {
    if (SK.gateOpen || !st.painted || st.perf.level >= 2) return;
    var p = st.perf;
    p.acc += dt; p.n++;
    if (p.n >= 120) {
      var avg = p.acc / p.n;
      p.acc = 0; p.n = 0;
      if (avg > 0.027) {
        p.level++;
        var keep = Math.round(st.nParts * (p.level === 1 ? 0.6 : 0.55));
        st.nParts = Math.max(60, keep);
        if (st.fx) { // lighten the weather too
          st.fx.rain.length = Math.round(st.fx.rain.length * 0.6);
          st.fx.snow.length = Math.round(st.fx.snow.length * 0.6);
        }
        if (p.level >= 2) {
          st.liveDpr = 1;
          st.ctx.live = sizeCanvas(st.cv.live, st.w, st.h, 1);
          st.ctx.front = sizeCanvas(st.cv.front, st.w, st.h, 1);
        }
      }
    }
  }

  var resizeTimer = 0;
  function onResize() {
    var W = st.root.clientWidth, H = st.root.clientHeight;
    // ignore the mobile address bar sliding in/out; rebuild on real changes
    if (Math.abs(W - st.w) < 2 && Math.abs(H - st.h) / (st.h || 1) < 0.22) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 220);
  }

  function start() {
    if (st.started) return;
    st.root = document.getElementById('sky');
    if (!st.root) return;
    var cvs = st.root.querySelectorAll('canvas');
    st.cv = { paint: cvs[0], live: cvs[1], land: cvs[2], cypress: cvs[3] };
    if (!st.cv.paint.getContext) return;
    var front = document.createElement('canvas'); // weather and seasons fall in front of the hills
    front.className = 'sky__front';
    st.root.appendChild(front);
    st.cv.front = front;
    st.started = true;
    build();
    bindInput();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 300); });
    window.addEventListener('sk:skystate', relook);
    window.addEventListener('sk:entered', function () { st.nextMeteor = st.t + 5 + st.rnd() * 3; }); // the first one comes soon
    st.raf = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
   * Public API
   * --------------------------------------------------------------------- */
  SK.sky = {
    start: start,
    painted: paintedPromise,
    /** a celebratory burst at a screen point (used when the entrance opens) */
    burst: function (x, y) {
      if (!st.c) return;
      addRipple(x, y, 1.2); addSparks(x, y, REDUCED ? 8 : 34, 1.3);
      var s = starAt(x, y); if (s) s.energy = 1;
    },
    setSound: function (on) { Sound.on = !!on; if (on && Sound.ensure()) Sound.chime(0.35, 0.8); },
    /** false while the visitor reads further down: brushwork rests, taps don't paint */
    setActive: function (on) {
      st.active = !!on;
      if (!on && st.hover) { st.hover = null; document.documentElement.classList.remove('on-star'); }
    },
    soundOn: function () { return Sound.on; },
    /** send a shooting star across the sky right now (try it from the console!) */
    meteor: function () { if (st.c) spawnMeteor(); },
    /** where the newest shooting star's head is (used by the automated tests) */
    _m: function () { var m = st.meteors[st.meteors.length - 1]; return m ? [m.x + m.vx * m.sp * 0.05, m.y + m.vy * m.sp * 0.05] : null; },
    /** a golden star where the last shooting star was caught (or at x, y) */
    addWishStar: function (x, y) {
      if (!st.c) return;
      var c = st.c, at = st.caught || { x: c.W * 0.5, y: c.H * 0.22 };
      x = clamp(x == null ? at.x : x, 30, c.W - 30);
      y = clamp(y == null ? at.y : y, 30, c.farTop(x) - c.brush * 14);
      if (st.poly && inPoly(st.poly, x, y)) x = c.cypress.x + (c.portrait ? -1 : 1) * c.cypress.width * 1.4;
      addUserStar(x, y, { wish: true });
      emit('sk:star', { kind: 'wish' });
    },
    /** the Felis easter eggs */
    purr: function () { Sound.purr(); },
    meowShower: meowShower,
    /** hyperspace between constellations: dir 1 = onward (down the page), -1 = back */
    warp: warp,
    /** a picture of part of the sky as painted right now (sx, sy, sw, sh in screen pixels), drawn w × h */
    snapshot: function (w, h, sx, sy, sw, sh) {
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
      if (!st.c) return cv;
      var ctx = cv.getContext('2d');
      ['paint', 'live', 'land', 'cypress', 'front'].forEach(function (k) {
        var src = st.cv[k];
        if (!src || !src.width) return;
        var kx = src.width / st.w, ky = src.height / st.h;
        ctx.drawImage(src, sx * kx, sy * ky, sw * kx, sh * ky, 0, 0, cv.width, cv.height);
      });
      return cv;
    },
    /** the sky as painted right now: time, weather, moon, season, holiday */
    look: function () { return st.look; },
    /** small texture of light brush strokes, used to fill the title lettering */
    paintTexture: function (w, h) {
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d'), r = mulberry32(42), nz = makeNoise(9);
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#fff1d6'); g.addColorStop(0.5, '#ffd9ec'); g.addColorStop(1, '#e6d6ff');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      var cols = ['#fff8ea', '#ffe3ef', '#ffd0e6', '#f9b8da', '#e9dcff', '#d8c6ff', '#ffe6b8', '#fff1d6', '#ffc4e1', '#f5a3cf'];
      var n = Math.round((w * h) / 70), bw = Math.max(3, h / 40);
      ctx.lineCap = 'round';
      for (var i = 0; i < n; i++) {
        var x = r() * w, y = r() * h, a = (nz(x / 90, y / 90) - 0.5) * 2.2 + Math.sin(y / 40) * 0.3;
        var len = bw * (2.5 + r() * 3), c2 = Math.cos(a), s2 = Math.sin(a);
        ctx.strokeStyle = pick(cols, r); ctx.globalAlpha = 0.85; ctx.lineWidth = bw * (0.6 + r() * 0.6);
        ctx.beginPath(); ctx.moveTo(x - c2 * len / 2, y - s2 * len / 2);
        ctx.quadraticCurveTo(x - s2 * bw * 0.4, y + c2 * bw * 0.4, x + c2 * len / 2, y + s2 * len / 2);
        ctx.stroke();
      }
      return cv;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
