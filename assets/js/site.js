/*!
 * StarriKnight — page glue
 * ---------------------------------------------------------------------------
 * Painted title lettering, the wobbly swash under it, the Felis constellation
 * that navigates the page, little constellations beside each chapter, contact
 * buttons, the sound toggle, the guest pass, and the "night deepens" scroll.
 */
(function () {
  'use strict';

  var SK = (window.SK = window.SK || {});
  var root = document.documentElement;
  var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- hand-drawn line helpers ---------- */
  function seeded(seed) {
    var s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function smoothPath(pts, closed) {
    var n = pts.length, d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1), last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var p0 = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
           (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' +
           p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return closed ? d + 'Z' : d;
  }
  /* A slightly wobbly line from a to b, like it was drawn by hand. */
  function wobbleLine(a, b, seed, amp) {
    var r = seeded(seed), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len, segs = Math.max(2, Math.round(len / 16)), pts = [a];
    for (var i = 1; i < segs; i++) {
      var t = i / segs, o = (r() - 0.5) * 2 * amp;
      pts.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
    }
    pts.push(b);
    return smoothPath(pts, false);
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* A tiny scheduler that redraws "boiling" lines a few times a second,
     only while they're on screen. */
  var boilers = [];
  var boilFrame = 0;
  if (!REDUCED) {
    setInterval(function () {
      if (document.hidden) return;
      boilFrame++;
      for (var i = 0; i < boilers.length; i++) if (boilers[i].visible) boilers[i].tick(boilFrame);
    }, 160);
  }
  function watch(target, onEnter, threshold) {
    var b = { visible: false, tick: function () {} };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          b.visible = e.isIntersecting;
          if (e.isIntersecting && onEnter) { onEnter(); onEnter = null; }
        });
      }, { threshold: threshold || 0.25 }).observe(target);
    } else { b.visible = true; if (onEnter) onEnter(); }
    boilers.push(b);
    return b;
  }

  /* ======================================================================
   * Hero: painted lettering + swash
   * ==================================================================== */
  var title = $('#title');
  function paintTitle() {
    if (!title || !SK.sky || !SK.sky.paintTexture) return;
    var r = title.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.min(1800, Math.round(r.width * dpr)), hgt = Math.min(900, Math.round(r.height * dpr));
    if (w < 20 || hgt < 20) return;
    var cv = SK.sky.paintTexture(w, hgt);
    var apply = function (url) {
      if (paintTitle.url && paintTitle.url.indexOf('blob:') === 0) URL.revokeObjectURL(paintTitle.url);
      paintTitle.url = url;
      title.style.setProperty('--paint', 'url("' + url + '")');
      title.classList.add('is-painted');
    };
    if (cv.toBlob) cv.toBlob(function (blob) { if (blob) apply(URL.createObjectURL(blob)); }, 'image/png');
    else apply(cv.toDataURL());
  }

  var swash = $('.hero__swash');
  function swashVariants() {
    var base = [[6, 44], [70, 31], [150, 41], [240, 27], [330, 37], [420, 24], [500, 31], [556, 19], [594, 9]];
    return [0, 1, 2].map(function (v) {
      var r = seeded(31 + v * 97);
      return base.map(function (p, i) { return [p[0] + (r() - 0.5) * 6, p[1] + (r() - 0.5) * (i ? 5 : 2)]; });
    });
  }
  function setupSwash() {
    if (!swash) return;
    var vars = swashVariants(), paths = $$('path', swash);
    var draw = function (k) {
      var d = smoothPath(vars[k % 3], false);
      paths.forEach(function (p) { p.setAttribute('d', d); });
    };
    draw(0);
    paths.forEach(function (p) { p.setAttribute('pathLength', '1'); });
    var b = watch(swash, null, 0.1);
    b.tick = function (f) { draw(f); };
  }

  /* ======================================================================
   * The Felis constellation (page navigation)
   * ==================================================================== */
  /* Felis from its real stars: positions come from their right ascension and
     declination (north up, east left, like a sky chart), 25 units per degree.
     Old atlases drew a cat over these stars; this dot-to-dot is an arched-back
     cat facing right with its tail up. [x, y, magnitude] */
  var FELIS = {
    stars: {
      nose: [450.1, 170.6, 4.72],   // HD 81799
      eye: [416.1, 139.9, 5.02],    // 160 G. Hydrae
      brow: [439.1, 130.7, 5.66],   // 148 G. Hydrae
      ear: [421.1, 97.0, 5.74],     // 156 G. Hydrae
      chin: [414.8, 183.6, 5.92],   // 162 G. Hydrae
      back: [291.5, 87.2, 4.94],    // HD 85951, officially named "Felis"
      rump: [134.2, 108.7, 6.12],   // 217 G. Hydrae
      tail1: [220.8, 40.6, 5.59],   // 195 G. Hydrae
      tip: [308.1, 25.4, 6.08],     // 179 G. Hydrae
      hip: [66.3, 205.6, 5.08],     // 44 Hydrae
      hpaw: [47.8, 297.3, 4.87],    // HD 92036
      belly: [237.0, 219.2, 5.7],   // 193 G. Hydrae
      navel: [267.1, 210.8, 6.11],  // OY Hydrae
      chest: [364.1, 209.9, 4.93],  // HD 84117
      heart: [369.7, 201.8, 4.76],  // HD 83953
      fpaw: [352.9, 306.2, 4.78],   // theta Antliae
      arm: [394.3, 244.4, 5.68],    // HD 83332
      raised: [435.1, 276.8, 5.49], // upsilon Antliae
      hpaw2: [157.7, 336.8, 5.52],  // phi Antliae
      gem: [295.3, 260.3, 4.87],    // HD 85859, one of the brightest, just under the belly
      x1: [79.0, 317.9, 6.04], x2: [60.9, 191.4, 6.1], x3: [92.4, 353.6, 5.58] // the rest of its stars
    },
    body: [['chin', 'nose'], ['nose', 'brow'], ['brow', 'ear'], ['ear', 'back'], ['back', 'rump'],
           ['rump', 'hip'], ['hip', 'hpaw'], ['hip', 'belly'], ['belly', 'hpaw2'], ['belly', 'navel'], ['navel', 'chest'],
           ['chest', 'heart'], ['heart', 'chin'], ['chest', 'fpaw'], ['heart', 'arm'], ['arm', 'raised']],
    tail: [['rump', 'tail1'], ['tail1', 'tip']]
  };

  function setupFelis() {
    var fig = $('.felis');
    if (!fig) return;
    var svg = $('svg', fig), gl = $('.felis__lines', svg), gt = $('.felis__tail-lines', svg), gd = $('.felis__dots', svg), S = FELIS.stars;
    var all = FELIS.body.concat(FELIS.tail);
    var variants = [0, 1, 2].map(function (v) {
      return all.map(function (ln, i) { return wobbleLine(S[ln[0]], S[ln[1]], 11 + i * 37 + v * 1013, 1.6); });
    });
    var paths = all.map(function (ln, i) {
      var p = el('path', { d: variants[0][i], pathLength: '1' }, i < FELIS.body.length ? gl : gt);
      p.style.transitionDelay = (i * 0.06).toFixed(2) + 's';
      return p;
    });

    // plain stars, sized by how bright they really are
    var navStars = {};
    $$('[data-star]', svg).forEach(function (n) { navStars[n.getAttribute('data-star')] = n; });
    Object.keys(S).forEach(function (k, i) {
      if (navStars[k]) return;
      var r = 2.2 + Math.max(0, 6.3 - S[k][2]) * 1.3;
      var c = el('circle', { cx: S[k][0], cy: S[k][1], r: r.toFixed(2) }, gd);
      if (/^x/.test(k)) c.setAttribute('class', 'is-faint');
      if (k === 'eye') c.setAttribute('class', 'is-eye'); // it blinks now and then
      else c.style.animationDelay = (-(i * 0.37) % 3).toFixed(2) + 's';
    });

    // bright stars (chapters) and the star named Felis
    Object.keys(navStars).forEach(function (k) {
      navStars[k].setAttribute('transform', 'translate(' + S[k][0] + ' ' + S[k][1] + ')');
    });
    var tail = $('.felis__tail', svg);
    if (tail) tail.style.transformOrigin = S.rump[0] + 'px ' + S.rump[1] + 'px';

    // easter eggs: the star named Felis, purring, and a meow shower
    var fact = $('.felis__fact', fig), named = $('.felis__named', svg);
    if (named && fact) {
      var toggleFact = function () { fact.hidden = !fact.hidden; };
      named.addEventListener('click', toggleFact);
      named.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFact(); } });
    }
    var head = $('.felis__head', svg), purr = $('.felis__purr', fig), taps = [];
    var pet = function () {
      var t = Date.now();
      taps = taps.filter(function (x) { return t - x < 900; }); taps.push(t);
      if (taps.length >= 3) { taps = []; if (SK.sky && SK.sky.meowShower) SK.sky.meowShower(); }
      if (SK.sky && SK.sky.purr) SK.sky.purr();
      if (purr) { // the "prrr~" floats up from just above the cat's face, clear of the labels
        var fb = fig.getBoundingClientRect(), pt = svg.createSVGPoint(), m = svg.getScreenCTM();
        pt.x = 488; pt.y = 66;
        if (m) { pt = pt.matrixTransform(m); purr.style.left = (pt.x - fb.left).toFixed(1) + 'px'; purr.style.top = (pt.y - fb.top).toFixed(1) + 'px'; }
        purr.classList.remove('is-on'); void purr.offsetWidth; purr.classList.add('is-on');
      }
      fig.classList.add('is-purring'); clearTimeout(fig._purr);
      fig._purr = setTimeout(function () { fig.classList.remove('is-purring'); }, 1600);
    };
    if (head) {
      head.addEventListener('click', pet);
      head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet(); } });
    }

    var b = watch(fig, function () { fig.classList.add('is-drawn'); }, 0.3);
    b.tick = function (f) { var v = variants[f % 3]; for (var i = 0; i < paths.length; i++) paths[i].setAttribute('d', v[i]); };
  }

  /* Typing "meow" anywhere sends cat-shaped shooting stars across the sky. */
  function setupMeow() {
    var buf = '';
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (!e.key || e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-4);
      if (buf === 'meow' && SK.sky && SK.sky.meowShower) { buf = ''; window.scrollTo(0, 0); SK.sky.meowShower(); }
    });
  }

  /* ======================================================================
   * Little constellations beside each chapter title
   * ==================================================================== */
  var GLYPHS = {
    education: { // a graduation cap
      pts: { a: [40, 15], b: [71, 29], c: [40, 43], d: [9, 29], j: [24, 35.6], k: [56, 35.6], f: [24, 52], g: [56, 52], h: [40, 58], i: [71, 49] },
      lines: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['j', 'f'], ['k', 'g'], ['f', 'h'], ['h', 'g'], ['b', 'i']],
      dots: { a: 2.6, b: 2.4, c: 2.6, d: 2.4, f: 2, g: 2, h: 2.2, i: 3.2 }
    },
    research: { // a magnifying glass
      pts: (function () {
        var o = {};
        for (var k = 0; k < 8; k++) { var a = (k / 8) * Math.PI * 2 - Math.PI / 2; o['p' + k] = [33 + Math.cos(a) * 18, 33 + Math.sin(a) * 18]; }
        o.h1 = [46, 46]; o.h2 = [68, 68]; o.glint = [26, 26];
        return o;
      })(),
      lines: [['p0', 'p1'], ['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p5'], ['p5', 'p6'], ['p6', 'p7'], ['p7', 'p0'], ['h1', 'h2']],
      dots: { p0: 2.4, p2: 2.2, p3: 2, p4: 2.6, p6: 2.2, p7: 2, h2: 3.2, glint: 1.8 }
    },
    art: { // a painter's palette with paint dabs
      pts: { o1: [13, 42], o2: [18, 24], o3: [34, 13], o4: [54, 15], o5: [67, 29], o6: [64, 46], o7: [52, 50], o8: [47, 59], o9: [38, 67], o10: [22, 63] },
      lines: [['o1', 'o2'], ['o2', 'o3'], ['o3', 'o4'], ['o4', 'o5'], ['o5', 'o6'], ['o6', 'o7'], ['o7', 'o8'], ['o8', 'o9'], ['o9', 'o10'], ['o10', 'o1']],
      dots: { o2: 2, o4: 2.2, o6: 2, o9: 2.2 },
      paint: [[29, 27, '#f06bb4'], [45, 24, '#ffc86e'], [56, 33, '#9aa4ef'], [27, 46, '#c9b4ff']]
    },
    now: { // a paper plane, off on an adventure
      pts: { n: [71, 15], t: [9, 34], f: [33, 44], b: [37, 63] },
      lines: [['n', 't'], ['t', 'f'], ['f', 'n'], ['n', 'b'], ['b', 'f']],
      dots: { n: 3.2, t: 2.4, f: 2, b: 2.4 },
      trail: [[22, 58, 1.7], [15, 65, 1.4], [9, 72, 1.1]]
    },
    hobbies: { // a game controller
      pts: { a: [16, 60], b: [11, 38], c: [22, 25], d: [40, 30], e: [58, 25], f: [69, 38], g: [64, 60], h: [53, 51], i: [40, 49], j: [27, 51],
             dl: [19, 38], dr: [29, 38], du: [24, 33], dd: [24, 43] },
      lines: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f'], ['f', 'g'], ['g', 'h'], ['h', 'i'], ['i', 'j'], ['j', 'a'], ['dl', 'dr'], ['du', 'dd']],
      dots: { a: 2.2, c: 2.2, e: 2.2, g: 2.2, i: 1.8 },
      paint: [[52, 35, '#f06bb4'], [58, 41, '#ffc86e']]
    },
    interests: { // a camera, for the one I'm saving up for
      pts: (function () {
        var o = { b1: [11, 31], b2: [24, 31], t1: [28, 22], t2: [44, 22], b3: [48, 31], b4: [69, 31], b5: [69, 63], b6: [11, 63] };
        for (var k = 0; k < 8; k++) { var a = (k / 8) * Math.PI * 2; o['l' + k] = [40 + Math.cos(a) * 11, 47 + Math.sin(a) * 11]; }
        return o;
      })(),
      lines: [['b1', 'b2'], ['b2', 't1'], ['t1', 't2'], ['t2', 'b3'], ['b3', 'b4'], ['b4', 'b5'], ['b5', 'b6'], ['b6', 'b1'],
              ['l0', 'l1'], ['l1', 'l2'], ['l2', 'l3'], ['l3', 'l4'], ['l4', 'l5'], ['l5', 'l6'], ['l6', 'l7'], ['l7', 'l0']],
      dots: { b1: 2, b4: 2.2, b5: 2, b6: 2.2, t1: 1.8, t2: 1.8 },
      paint: [[61, 38, '#ffc86e'], [40, 47, '#c9b4ff']]
    },
    outside: { // a paw print, for the foster kitties
      pts: { p1: [27, 56], p2: [30, 45], p3: [40, 41], p4: [50, 45], p5: [53, 56], p6: [46, 63], p7: [40, 61], p8: [34, 63] },
      lines: [['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p5'], ['p5', 'p6'], ['p6', 'p7'], ['p7', 'p8'], ['p8', 'p1']],
      dots: { p2: 1.8, p4: 1.8, p7: 1.8 },
      paint: [[21, 36, '#ffe3ef'], [32, 25, '#ffe3ef'], [48, 25, '#ffe3ef'], [59, 36, '#ffe3ef']]
    },
    future: { // a telescope, pointed at a bright star
      pts: { a: [13, 42], b: [17, 51], c: [62, 31], d: [58, 21], m: [37, 41], l1: [24, 71], l2: [38, 71], l3: [52, 71], s: [72, 10] },
      lines: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['m', 'l1'], ['m', 'l2'], ['m', 'l3']],
      dots: { a: 2, b: 2, c: 2, d: 2, l1: 1.8, l2: 1.8, l3: 1.8 },
      paint: [[72, 10, '#ffc86e']]
    }
  };
  function setupGlyphs() {
    $$('svg[data-glyph]').forEach(function (svg, gi) {
      var g = GLYPHS[svg.getAttribute('data-glyph')];
      if (!g) return;
      var lines = el('g', { 'class': 'glyph__lines' }, svg), dots = el('g', { 'class': 'glyph__dots' }, svg);
      var variants = [0, 1, 2].map(function (v) {
        return g.lines.map(function (ln, i) { return wobbleLine(g.pts[ln[0]], g.pts[ln[1]], 5 + gi * 211 + i * 29 + v * 577, 0.9); });
      });
      var paths = g.lines.map(function (ln, i) {
        var p = el('path', { d: variants[0][i], pathLength: '1' }, lines);
        p.style.transitionDelay = (i * 0.06).toFixed(2) + 's';
        return p;
      });
      Object.keys(g.dots).forEach(function (k) { el('circle', { cx: g.pts[k][0], cy: g.pts[k][1], r: g.dots[k] }, dots); });
      (g.paint || []).forEach(function (p) { el('circle', { cx: p[0], cy: p[1], r: 4, style: 'fill:' + p[2], 'class': 'glyph__paint' }, dots); });
      (g.trail || []).forEach(function (p) { el('circle', { cx: p[0], cy: p[1], r: p[2], 'class': 'glyph__trail' }, dots); });
      var b = watch(svg, function () { svg.classList.add('is-drawn'); }, 0.6);
      b.tick = function (f) { var v = variants[f % 3]; for (var i = 0; i < paths.length; i++) paths[i].setAttribute('d', v[i]); };
    });
  }

  /* ======================================================================
   * Contact: copy button for Discord (the email stays a riddle, on purpose)
   * ==================================================================== */
  function setupContact() {
    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () { copyText(btn.getAttribute('data-copy'), btn); });
    });
  }
  function copyText(text, btn) {
    var label = btn.textContent;
    var done = function () {
      btn.textContent = 'Copied'; btn.classList.add('is-done');
      setTimeout(function () { btn.textContent = label; btn.classList.remove('is-done'); }, 1600);
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) done(); } catch (e) {}
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ======================================================================
   * Sound toggle
   * ==================================================================== */
  function setupSound() {
    var btn = $('.sound');
    if (!btn) return;
    var on = false;
    try { on = localStorage.getItem('sk-sound') === 'on'; } catch (e) {}
    var set = function (v, user) {
      on = v;
      btn.setAttribute('aria-pressed', String(v));
      btn.title = v ? 'Star sounds on' : 'Star sounds off';
      if (SK.sky) { if (user) SK.sky.setSound(v); else if (!v) SK.sky.setSound(false); }
      try { localStorage.setItem('sk-sound', v ? 'on' : 'off'); } catch (e) {}
    };
    set(false, false); // audio always starts muted until the visitor taps the button on this visit
    btn.addEventListener('click', function () { set(!on, true); });
  }

  /* ======================================================================
   * Pop-out panels in the top bar (only one open at a time)
   * ==================================================================== */
  var popovers = [];
  function popover(chip, panel) {
    var api = {
      open: function (v) {
        if (v) popovers.forEach(function (p) { if (p !== api) p.open(false); });
        panel.hidden = !v; chip.setAttribute('aria-expanded', String(v));
      },
      isOpen: function () { return !panel.hidden; }
    };
    chip.addEventListener('click', function (e) { e.stopPropagation(); api.open(panel.hidden); });
    document.addEventListener('click', function (e) { if (!panel.hidden && !panel.contains(e.target) && !chip.contains(e.target)) api.open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { api.open(false); chip.focus(); } });
    popovers.push(api);
    return api;
  }
  function caughtCount() { try { return parseInt(localStorage.getItem('sk-caught'), 10) || 0; } catch (e) { return 0; } }

  /* ======================================================================
   * Guest pass chip + panel
   * ==================================================================== */
  function setupPass() {
    var chip = $('.pass'), panel = $('#pass-panel'), rows = $('.pass-panel__rows');
    if (!chip || !panel) return;
    var last = null;
    var render = function (pass) {
      if (!pass) return;
      last = pass;
      rows.textContent = '';
      var add = function (k, v) {
        if (!v) return;
        var dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = k; dd.textContent = v; rows.appendChild(dt); rows.appendChild(dd);
      };
      var when = '', caught = caughtCount();
      try { when = new Date(pass.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) {}
      add('Entered', when);
      add('Via', pass.via === 'nfc' ? 'NFC tap' + (pass.tag ? ', tag ' + pass.tag : '') : pass.via === 'airdrop' ? 'AirDrop' : 'Web gateway');
      add('From', pass.place);
      add('On', pass.device);
      if (caught) add('Wishes', caught + (caught === 1 ? ' shooting star caught' : ' shooting stars caught'));
      chip.hidden = false;
      requestAnimationFrame(function () { chip.classList.add('is-in'); });
    };
    popover(chip, panel);
    buildPassMap(panel);
    window.addEventListener('sk:entered', function (e) { render(e.detail); });
    window.addEventListener('sk:pass', function (e) { render(e.detail); });
    window.addEventListener('sk:caught', function () { render(last); });
    if (SK.pass) render(SK.pass);
  }

  /* The pocket star map in the guest pass: Felis again, small. Its stars and the
     list under it both jump to their part of the page. */
  function buildPassMap(panel) {
    var svg = $('.pass-map__sky', panel), links = $$('.pass-map__links a', panel), S = FELIS.stars;
    if (!svg) return;
    var mapped = {};
    links.forEach(function (a) { if (a.getAttribute('data-map')) mapped[a.getAttribute('data-map')] = a; });
    FELIS.body.concat(FELIS.tail).forEach(function (ln, i) { el('path', { d: wobbleLine(S[ln[0]], S[ln[1]], 700 + i * 13, 1.2), 'class': 'pm__line' }, svg); });
    Object.keys(S).forEach(function (k) {
      if (mapped[k]) return;
      el('circle', { cx: S[k][0], cy: S[k][1], r: (2.4 + Math.max(0, 6.3 - S[k][2]) * 1.8).toFixed(1), 'class': 'pm__dot' + (/^x/.test(k) ? ' is-faint' : '') }, svg);
    });
    Object.keys(mapped).forEach(function (k) {
      var a = mapped[k], p = S[k];
      var star = el('a', { href: a.getAttribute('href'), 'class': 'pm__star', 'aria-label': a.textContent }, svg);
      el('circle', { cx: p[0], cy: p[1], r: 30, 'class': 'pm__hit' }, star);
      el('circle', { cx: p[0], cy: p[1], r: 17, 'class': 'pm__halo' }, star);
      el('circle', { cx: p[0], cy: p[1], r: 8.5, 'class': 'pm__core' }, star);
      var hot = function (v) { star.classList.toggle('is-hot', v); a.classList.toggle('is-hot', v); };
      [star, a].forEach(function (n) {
        n.addEventListener('mouseenter', function () { hot(true); }); n.addEventListener('mouseleave', function () { hot(false); });
        n.addEventListener('focus', function () { hot(true); }); n.addEventListener('blur', function () { hot(false); });
      });
    });
  }

  /* ======================================================================
   * Getting around: hyperspace jumps between constellations, a gentle snap
   * when you've clearly scrolled on to the next part, and "you are here"
   * ==================================================================== */
  function scrollNow(y) { // jump without the page's smooth scrolling
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto'; window.scrollTo(0, y); root.style.scrollBehavior = prev;
  }
  var nav = { busyUntil: 0 };
  function jump(to, dir, target, withWarp) {
    var maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    to = clamp(Math.round(to), 0, maxY);
    if (Math.abs(to - (window.scrollY || 0)) < 4) return;
    nav.busyUntil = Date.now() + (REDUCED ? 300 : 1100);
    if (withWarp && SK.sky && SK.sky.warp) SK.sky.warp(dir);
    if (REDUCED) scrollNow(to); else window.scrollTo({ top: to, behavior: 'smooth' });
    if (target && target.classList.contains('chapter')) {
      setTimeout(function () { target.classList.add('is-arrived'); setTimeout(function () { target.classList.remove('is-arrived'); }, 1600); }, REDUCED ? 0 : 520);
    }
  }
  function sectionTop(target) { return target.id === 'top' ? 0 : (window.scrollY || 0) + target.getBoundingClientRect().top; }

  function setupNav() {
    var sections = $$('main > section[id]');
    // 1. in-page links (Felis, "back to the constellation", the star map…) travel by hyperspace
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var id = a.getAttribute('href').slice(1), target = id && document.getElementById(id);
      if (!target || root.classList.contains('gate-open')) return;
      e.preventDefault();
      popovers.forEach(function (p) { p.open(false); });
      var to = sectionTop(target);
      jump(to, to > (window.scrollY || 0) ? 1 : -1, target, true);
      if (history.replaceState) history.replaceState(null, '', id === 'top' ? location.pathname + location.search : '#' + id);
      var heading = target.querySelector('h1, h2');
      if (heading && a.closest('main, .pass-map')) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    });

    // 2. a gentle snap: only once the next part has clearly taken over the screen
    var lastY = window.scrollY || 0, dir = 0, idle = 0, touching = false, lastTab = 0;
    var settle = function () {
      if (touching || Date.now() < nav.busyUntil || Date.now() - lastTab < 1500) return;
      if (root.classList.contains('gate-open') || SK.wishOpen || popovers.some(function (p) { return p.isOpen(); })) return;
      var ae = document.activeElement;
      if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
      if (window.getSelection && String(window.getSelection())) return;
      var vh = innerHeight, best = null, bd = 1e9;
      sections.forEach(function (s) {
        var t = s.getBoundingClientRect().top;
        var near = dir > 0 ? t > 14 && t < vh * 0.34 : dir < 0 ? t < -14 && t > -vh * 0.3 : false;
        if (near && Math.abs(t) < bd) { bd = Math.abs(t); best = s; }
      });
      if (!best) return;
      jump(sectionTop(best), dir, best, false); // a quiet snap: hyperspace is only for jumps from the maps and links
    };
    window.addEventListener('scroll', function () {
      var y = window.scrollY || 0;
      if (y !== lastY) { dir = y > lastY ? 1 : -1; lastY = y; }
      clearTimeout(idle); idle = setTimeout(settle, 180);
    }, { passive: true });
    window.addEventListener('touchstart', function () { touching = true; }, { passive: true });
    window.addEventListener('touchend', function () { touching = false; clearTimeout(idle); idle = setTimeout(settle, 260); }, { passive: true });
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') lastTab = Date.now(); });

    // 3. "you are here" in the star map
    var mapLinks = $$('.pass-map a');
    if ('IntersectionObserver' in window && mapLinks.length) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (!en.isIntersecting) return;
          mapLinks.forEach(function (a) { a.classList.toggle('is-here', a.getAttribute('href') === '#' + en.target.id); });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(function (s) { io.observe(s); });
    }
  }

  /* ======================================================================
   * The thread: a glowing line that links one chapter's constellation to the
   * next, lighting up behind you as you read on
   * ==================================================================== */
  function setupThread() {
    var main = $('main'), chapters = $$('main > .chapter').filter(function (s) { return $('.glyph', s); });
    if (!main || chapters.length < 2) return;
    var svg = el('svg', { 'class': 'thread', 'aria-hidden': 'true', focusable: 'false' });
    main.insertBefore(svg, main.firstChild);
    svg.innerHTML = '<defs><clipPath id="threadLit"><rect x="0" y="0" width="100%" height="0"/></clipPath></defs>';
    var dim = el('g', { 'class': 'thread__dim' }, svg), lit = el('g', { 'class': 'thread__lit', 'clip-path': 'url(#threadLit)' }, svg);
    var clip = svg.querySelector('#threadLit rect'), mainTop = 0;
    var layout = function () {
      var mb = main.getBoundingClientRect(), W = main.offsetWidth, H = main.offsetHeight, narrow = innerWidth <= 860;
      mainTop = mb.top + (window.scrollY || 0);
      svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      dim.textContent = ''; lit.textContent = '';
      var pts = chapters.map(function (s) {
        var g = $('.glyph', s), gr = g.getBoundingClientRect(), cs = getComputedStyle(s);
        return { x: gr.left - mb.left + gr.width / 2, left: gr.left - mb.left, y: s.offsetTop + parseFloat(cs.paddingTop) + gr.height / 2, r: gr.height / 2,
                 end: s.offsetTop + s.offsetHeight - parseFloat(cs.paddingBottom) };
      });
      var draw = function (d) {
        el('path', { d: d, 'class': 'thread__line' }, dim);
        el('path', { d: d, 'class': 'thread__glow' }, lit);
        el('path', { d: d, 'class': 'thread__line' }, lit);
      };
      var star = function (x, y) {
        el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 1.8, 'class': 'thread__dot' }, dim);
        el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.2, 'class': 'thread__dot' }, lit);
      };
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1], r = seeded(300 + i * 41), y;
        if (narrow) { // phones: just across the gap between one chapter and the next
          var from = [a.x, a.end + 18], to = [b.x, b.y - b.r - 8];
          if (to[1] - from[1] < 20) continue;
          draw(wobbleLine(from, to, 300 + i * 41, 2.2));
          for (y = from[1] + 50; y < to[1] - 30; y += 110) star(a.x, y);
          continue;
        }
        // wide screens: out of the left side of one constellation, down the edge of the
        // column (clear of the chapter title), and into the top of the next one
        var xl = Math.max(6, Math.min(a.left, b.left) - 18), top = a.y + a.r + 34, bottom = b.y - b.r - 64, route = [[a.left - 2, a.y], [xl, top]];
        for (y = top + 150; y < bottom - 60; y += 150) route.push([xl + (r() - 0.5) * 5, y]);
        route.push([xl, bottom], [b.x, b.y - b.r - 4]);
        if (bottom - top < 40) route = [[a.left - 2, a.y], [xl, (a.y + b.y) / 2], [b.x, b.y - b.r - 4]];
        draw(smoothPath(route, false));
        for (y = top + 70; y < bottom - 30; y += 140) star(xl, y);
      }
      light();
    };
    var light = function () { clip.setAttribute('height', Math.max(0, (window.scrollY || 0) + innerHeight * 0.55 - mainTop).toFixed(0)); };
    var ticking = false;
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; light(); }); } }, { passive: true });
    var rt = 0, relayout = function () { clearTimeout(rt); rt = setTimeout(layout, 120); };
    window.addEventListener('resize', relayout);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(main);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    layout();
  }

  /* ======================================================================
   * Foster kitties: a card pops up under each paw print
   * ==================================================================== */
  function setupKitties() {
    var fig = $('.pawtrail');
    if (!fig) return;
    watch(fig, function () { fig.classList.add('is-drawn'); }, 0.35);
    var open = null;
    var close = function (refocus) {
      if (!open) return;
      open.card.classList.remove('is-open'); open.paw.setAttribute('aria-expanded', 'false');
      if (refocus) open.paw.focus();
      open = null;
    };
    var show = function (paw) {
      var card = document.getElementById((paw.getAttribute('href') || '').slice(1));
      if (!card) return;
      if (open && open.card === card) return close();
      close();
      card.classList.add('is-open'); paw.setAttribute('aria-expanded', 'true');
      open = { card: card, paw: paw };
      var fb = fig.getBoundingClientRect(), pb = ($('use', paw) || paw).getBoundingClientRect(), cw = card.offsetWidth;
      var cx = pb.left + pb.width / 2 - fb.left, left = clamp(cx - cw / 2, 0, Math.max(0, fb.width - cw));
      card.style.left = left.toFixed(0) + 'px';
      card.style.top = (pb.bottom - fb.top + 12).toFixed(0) + 'px';
      card.style.setProperty('--arrow', (cx - left).toFixed(0) + 'px');
      var x = $('.cat__close', card);
      if (x) x.focus({ preventScroll: true });
    };
    $$('.paw', fig).forEach(function (paw) {
      paw.setAttribute('aria-expanded', 'false');
      paw.addEventListener('click', function (e) { e.preventDefault(); show(paw); });
    });
    $$('.cat__close', fig).forEach(function (x) { x.addEventListener('click', function () { close(true); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) close(true); });
    document.addEventListener('pointerdown', function (e) { if (open && !open.card.contains(e.target) && !(e.target.closest && e.target.closest('.paw'))) close(); });
    window.addEventListener('resize', function () { close(); });
  }

  /* ======================================================================
   * The secret settings (tap the © line at the very bottom)
   * ==================================================================== */
  function setupSecret() {
    var btn = $('.foot__secret'), panel = $('#secret');
    if (!btn || !panel) return;
    var pop = popover(btn, panel);
    var sync = function () {
      var o = SK.getSkyOverride ? SK.getSkyOverride() : {};
      $$('[data-over]', panel).forEach(function (s) { var v = o[s.getAttribute('data-over')]; s.value = v == null ? '' : v; });
    };
    btn.addEventListener('click', sync);
    var x = $('.secret__close', panel);
    if (x) x.addEventListener('click', function () { pop.open(false); btn.focus(); });
    $$('[data-over]', panel).forEach(function (s) {
      s.addEventListener('change', function () {
        var o = {}; o[s.getAttribute('data-over')] = s.value || null;
        if (SK.setSkyOverride) SK.setSkyOverride(o);
      });
    });
    $$('[data-replay]', panel).forEach(function (b) {
      b.addEventListener('click', function () {
        pop.open(false);
        scrollNow(0);
        if (SK.gate) SK.gate.play(b.getAttribute('data-replay'));
      });
    });
    $$('[data-fx]', panel).forEach(function (b) {
      b.addEventListener('click', function () {
        var fx = b.getAttribute('data-fx');
        if (fx === 'meow' && SK.sky) SK.sky.meowShower();
        else if (fx === 'warp' && SK.sky) SK.sky.warp(1);
        else if (fx === 'meteor' && SK.sky) {
          pop.open(false);
          jump(0, -1, null, true);
          setTimeout(function () { SK.sky.meteor(); }, REDUCED ? 200 : 1200);
        } else if (fx === 'reset') {
          if (SK.setSkyOverride) SK.setSkyOverride(null);
          sync();
        } else if (fx === 'forget') {
          try { localStorage.removeItem('sk-caught'); } catch (e) {}
          try { window.dispatchEvent(new CustomEvent('sk:caught', { detail: { count: 0 } })); } catch (e) {}
          var label = b.textContent; b.textContent = 'Forgotten!';
          setTimeout(function () { b.textContent = label; }, 1600);
        }
      });
    });
  }

  /* ======================================================================
   * Weather chip + panel: the visitor's sky, tonight's moon, a little forecast
   * ==================================================================== */
  var ICONS = {
    sun: '<g class="sun"><circle cx="12" cy="12" r="4.3"/><path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M5.4 18.6L7 17M17 7l1.6-1.6"/></g>',
    cloud: '<path class="cloud" d="M7.4 18.4h9.4a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4 1.5 3.2 3.2 0 0 0 .5 6.3z"/>',
    fog: '<path class="fogl" d="M4 9.5h16M6 13.5h13M4.5 17.5h12"/>',
    rain: '<path class="drops" d="M8.5 19.4l-1 2.2M12.5 19.4l-1 2.2M16.5 19.4l-1 2.2"/>',
    drizzle: '<path class="drops" d="M9.5 19.8l-.6 1.4M14.5 19.8l-.6 1.4"/>',
    snow: '<g class="flakes"><circle cx="8.4" cy="20.3" r="1"/><circle cx="12.3" cy="21.5" r="1"/><circle cx="16.2" cy="20.3" r="1"/></g>',
    bolt: '<path class="bolt" d="M13.4 13.6l-3.5 5h2.6l-1.3 4 4.3-5.6h-2.7l1.6-3.4z"/>'
  };
  function moonIcon(mp, south, cx, cy, R) {
    var side = mp.phase < 0.5 ? 1 : -1, flip = south ? -1 : 1, k = Math.cos(2 * Math.PI * mp.phase), d = '', i, v, w;
    for (i = 0; i <= 24; i++) { v = -1 + i / 12; w = Math.sqrt(Math.max(0, 1 - v * v)); d += (i ? 'L' : 'M') + (cx + R * flip * side * w).toFixed(2) + ' ' + (cy + R * v).toFixed(2); }
    for (i = 24; i >= 0; i--) { v = -1 + i / 12; w = Math.sqrt(Math.max(0, 1 - v * v)); d += 'L' + (cx + R * flip * side * w * k).toFixed(2) + ' ' + (cy + R * v).toFixed(2); }
    return '<circle class="moon-dark" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/>' + (mp.illum > 0.012 ? '<path class="moon-lit" d="' + d + 'Z"/>' : '');
  }
  function weatherIcon(kind, time, s) {
    var day = time !== 'night', orb = day ? '<g transform="translate(-3.2 -3.4) scale(.72)">' + ICONS.sun + '</g>' : '<g transform="translate(-2.4 -3.4)">' + moonIcon(s.moon, s.south, 9, 9, 4.6) + '</g>';
    var low = '<g transform="translate(0 -2.6)">' + ICONS.cloud + '</g>';
    switch (kind) {
      case 'clear': return day ? ICONS.sun : moonIcon(s.moon, s.south, 12, 12, 7.2);
      case 'partly': return orb + '<g transform="translate(1.6 0)">' + ICONS.cloud + '</g>';
      case 'cloudy': return ICONS.cloud;
      case 'fog': return ICONS.fog;
      case 'drizzle': return low + ICONS.drizzle;
      case 'rain': return low + ICONS.rain;
      case 'snow': return low + ICONS.snow;
      case 'storm': return low + ICONS.bolt;
    }
    return ICONS.cloud;
  }
  var HOLIDAYS = {
    newyear: 'Happy New Year!', lunar: 'Happy Lunar New Year!', valentine: 'Happy Valentine’s Day!', canada: 'Happy Canada Day!',
    midautumn: 'Happy Mid-Autumn Festival!', halloween: 'Happy Halloween!', winterlights: 'Happy holidays!'
  };
  var SEASONS = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
  var THEME = { night: '#140a2e', dawn: '#221a52', dusk: '#1d0d44', day: '#3a3d98' };
  var F_COUNTRIES = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'LR', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];

  function setupWeather() {
    var chip = $('.wx'), panel = $('#wx-panel');
    if (!chip || !panel || !SK.where) return;
    var icon = $('.wx__icon', chip), temp = $('.wx__temp', chip), label = $('.sr-only', chip);
    var place = $('.wx-panel__place', panel), nowEl = $('.wx-panel__now', panel), days = $('.wx-panel__days', panel), credit = $('.wx-panel__credit', panel);
    var hintHover = $('.hint-hover'), hintTouch = $('.hint-touch'), lede = $('.hero__lede'), theme = $('meta[name="theme-color"]');
    var hintText = { hover: hintHover && hintHover.textContent, touch: hintTouch && hintTouch.textContent, lede: lede && lede.textContent };
    popover(chip, panel);

    var fahrenheit = function () {
      var g = null;
      try { g = JSON.parse(sessionStorage.getItem('sk-geo') || 'null'); } catch (e) {}
      if (g && g.cc) return F_COUNTRIES.indexOf(String(g.cc).toUpperCase()) > -1;
      return /-US$/i.test(navigator.language || '');
    };
    var deg = function (c, F) { return c == null || !isFinite(c) ? '' : Math.round(F ? c * 9 / 5 + 32 : c) + '°'; };
    var line = function (cls, text) { var p = document.createElement('p'); p.className = cls; p.textContent = text; return p; };

    var render = function (s) {
      if (!s) return;
      var w = s.wx, F = fahrenheit(), kind = s.weather;
      root.setAttribute('data-sky', s.time);
      if (theme) theme.setAttribute('content', THEME[s.time] || THEME.night);
      // there are no stars to tap in the daytime, so the hint changes
      if (hintHover) hintHover.textContent = s.time === 'day' ? 'Click the sky to paint a star, even in broad daylight.' : hintText.hover;
      if (hintTouch) hintTouch.textContent = s.time === 'day' ? 'Tap the sky to paint a star, even in broad daylight.' : hintText.touch;
      if (lede) lede.textContent = s.time === 'day' ? hintText.lede.replace(' night sky', ' sky') : hintText.lede;

      icon.innerHTML = weatherIcon(w ? SK.where.kindOf(w.code) : 'clear', w ? s.actual || s.time : 'night', s);
      temp.textContent = w ? deg(w.temp, F) : '';
      label.textContent = w ? 'Weather and sky: ' + SK.where.describe(w.code) + ', ' + deg(w.temp, F) + (F ? 'F' : 'C') : 'Tonight’s moon and the sky';
      chip.hidden = false;
      requestAnimationFrame(function () { chip.classList.add('is-in'); });

      place.textContent = w && w.place ? w.place : 'Your sky';
      nowEl.textContent = '';
      if (w) {
        nowEl.appendChild(line('wx-panel__big', SK.where.describe(w.code) + ', ' + deg(w.temp, F) + (F ? 'F' : 'C')));
        if (w.wind != null) nowEl.appendChild(line('wx-panel__small', 'Wind ' + Math.round(F ? w.wind * 0.621 : w.wind) + (F ? ' mph' : ' km/h')));
      } else {
        nowEl.appendChild(line('wx-panel__small', 'The weather didn’t come through, so the sky is going by your clock.'));
      }
      var moon = line('wx-panel__moon', ''), mi = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mi.setAttribute('viewBox', '0 0 24 24'); mi.setAttribute('aria-hidden', 'true'); mi.setAttribute('class', 'wxi'); mi.innerHTML = moonIcon(s.moon, s.south, 12, 12, 8);
      moon.appendChild(mi);
      moon.appendChild(document.createTextNode('Tonight’s moon: ' + s.moon.name.toLowerCase() + ', ' + Math.round(s.moon.illum * 100) + '% lit'));
      nowEl.appendChild(moon);
      nowEl.appendChild(line('wx-panel__small', s.holiday ? HOLIDAYS[s.holiday] : (SEASONS[s.season] || '') + (s.season ? ' sky' : '')));

      days.textContent = '';
      days.hidden = !(w && w.days && w.days.length);
      if (!days.hidden) {
        w.days.slice(0, 4).forEach(function (d, i) {
          var li = document.createElement('li'), name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : '';
          if (!name) { try { name = new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'long' }); } catch (e) { name = d.date; } }
          var di = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          di.setAttribute('viewBox', '0 0 24 24'); di.setAttribute('aria-hidden', 'true'); di.setAttribute('class', 'wxi');
          di.innerHTML = weatherIcon(SK.where.kindOf(d.code), 'day', s);
          li.appendChild(line('wx-day__name', name));
          li.appendChild(di);
          li.appendChild(line('wx-day__desc', SK.where.describe(d.code)));
          li.appendChild(line('wx-day__temp', deg(d.hi, F) + ' / ' + deg(d.lo, F)));
          days.appendChild(li);
        });
      }
      if (credit) credit.hidden = !w;
      $$('[data-sky-mode]', panel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-sky-mode') === s.pref)); });
    };
    $$('[data-sky-mode]', panel).forEach(function (b) {
      b.addEventListener('click', function () { if (SK.setSkyPref) SK.setSkyPref(b.getAttribute('data-sky-mode')); });
    });
    window.addEventListener('sk:skystate', function (e) { render(e.detail && e.detail.state); });
    render(SK.skyState);
  }

  /* ======================================================================
   * Catching a shooting star: make a wish
   * ==================================================================== */
  function setupWish() {
    var card = $('#wish');
    if (!card) return;
    var form = $('form', card), input = $('.wish__input', card), later = $('.wish__later', card), hint = $('.hero__hint--meteor'), lastFocus = null;
    var close = function () {
      if (card.hidden) return;
      card.classList.remove('is-in');
      SK.wishOpen = false;
      setTimeout(function () { if (!card.classList.contains('is-in')) card.hidden = true; }, REDUCED ? 0 : 260);
      if (lastFocus && lastFocus.focus && document.activeElement && card.contains(document.activeElement)) lastFocus.focus();
    };
    var open = function () {
      lastFocus = document.activeElement;
      card.hidden = false; SK.wishOpen = true;
      input.value = '';
      requestAnimationFrame(function () { card.classList.add('is-in'); });
      // jump straight to typing on computers; on phones, don't throw a keyboard in their face
      if (window.matchMedia && matchMedia('(pointer: fine)').matches) setTimeout(function () { input.focus(); }, 60);
      else { card.setAttribute('tabindex', '-1'); card.focus({ preventScroll: true }); }
    };
    var floatWish = function (text) {
      var r = input.getBoundingClientRect(), p = document.createElement('p');
      p.className = 'wish-float'; p.textContent = text; p.setAttribute('aria-hidden', 'true');
      p.style.left = (r.left + r.width / 2) + 'px'; p.style.top = (r.top + r.height / 2) + 'px';
      document.body.appendChild(p);
      setTimeout(function () { p.remove(); }, 3200);
    };
    window.addEventListener('sk:meteor', function () {
      var n = caughtCount() + 1;
      try { localStorage.setItem('sk-caught', String(n)); } catch (e) {}
      if (hint) hint.classList.add('is-done');
      try { window.dispatchEvent(new CustomEvent('sk:caught', { detail: { count: n } })); } catch (e) {}
      open();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text) floatWish(text);
      input.value = '';
      close();
      if (SK.sky && SK.sky.addWishStar) setTimeout(function () { SK.sky.addWishStar(); }, text ? 650 : 120);
    });
    later.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !card.hidden) close(); });
    document.addEventListener('pointerdown', function (e) { if (!card.hidden && !card.contains(e.target)) close(); });
  }

  /* ======================================================================
   * Entering: draw the swash, fade the hint once someone plays with stars
   * ==================================================================== */
  function setupEnter() {
    var entered = function () { root.classList.add('is-entered'); };
    window.addEventListener('sk:entered', entered);
    if (root.getAttribute('data-gate') === 'done') entered();
    var hint = $('.hero__hint'), count = 0;
    window.addEventListener('sk:star', function () {
      count++;
      if (hint && count >= 3) hint.classList.add('is-done');
    });
  }

  /* ======================================================================
   * Scrolling: the night deepens behind the text, the sky rests
   * ==================================================================== */
  function setupScroll() {
    var bar = $('.bar'), ticking = false, active = true;
    var update = function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0, vh = window.innerHeight || 1;
      root.style.setProperty('--scrim', clamp((y - vh * 0.1) / (vh * 0.55), 0, 1).toFixed(3));
      if (bar) bar.classList.toggle('is-scrolled', y > vh * 0.55);
      var a = y < vh * 0.45;
      if (a !== active) { active = a; if (SK.sky && SK.sky.setActive) SK.sky.setActive(a); }
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ======================================================================
   * Start
   * ==================================================================== */
  function start() {
    setupSwash(); setupFelis(); setupMeow(); setupGlyphs(); setupContact(); setupSound(); setupPass(); setupWeather(); setupWish();
    setupKitties(); setupSecret(); setupNav(); setupThread(); setupEnter(); setupScroll();
    var paint = function () { requestAnimationFrame(paintTitle); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint); else paint();
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(paintTitle, 300); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
