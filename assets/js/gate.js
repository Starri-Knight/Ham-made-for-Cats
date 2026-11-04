/*!
 * StarriKnight — the entrance ("gate")
 * ---------------------------------------------------------------------------
 * Two playful, fake log-in sequences. Nobody actually logs in: the page reads
 * what any website can see (device, browser, screen, time, and a rough
 * location from the visitor's IP address), shows it back to them, declares
 * "GUEST DETECTED", then "ACCESS AUTHORIZED", and opens onto the sky.
 *
 *   full    — "secure gateway": a star scanner + console          (default)
 *   nfc     — "tap access via NFC": an island drops from the top  (/nfc/ or ?nfc)
 *   airdrop — the site arrives like a shared photo, then opens up (/airdrop/ or ?airdrop)
 *   brief   — a quick "welcome back" when you've already entered in this tab
 *
 * Nothing is stored or sent anywhere by this site. The only outside request is
 * the approximate-location lookup (GeoJS, with ipapi.co as a backup), which
 * skystate.js makes once and shares with this file. Changing `geoLookup` to
 * false below hides the location here; set it to false in skystate.js too to
 * skip the lookup (and the local weather) entirely.
 */
(function () {
  'use strict';

  var SK = (window.SK = window.SK || {});
  var CONFIG = { geoLookup: true, skipKeys: ['Escape', 'Enter', ' '] };

  var root = document.documentElement;
  var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ua = navigator.userAgent || '';
  var ABORT = { aborted: true };

  /* ======================================================================
   * 1. Reading the visitor (everything here stays in the browser)
   * ==================================================================== */
  function deviceInfo() {
    var m, iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (/iPhone|iPod/.test(ua)) { m = ua.match(/OS (\d+)[_.](\d+)/); return { name: 'iPhone', os: m ? 'iOS ' + m[1] + '.' + m[2] : 'iOS', kind: 'phone' }; }
    if (iPad) { m = ua.match(/OS (\d+)[_.](\d+)/); return { name: 'iPad', os: m ? 'iPadOS ' + m[1] + '.' + m[2] : 'iPadOS', kind: 'tablet' }; }
    if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) {
      var mobile = /Mobile/.test(ua), model = (ua.match(/Android [^;)]*; ([^;)]+?)(?: Build[^;)]*)?\)/) || [])[1];
      var good = model && !/^(K|wv|Linux|U)$/.test(model.trim());
      return { name: good ? model.trim() : mobile ? 'Android phone' : 'Android tablet', os: 'Android ' + m[1], kind: mobile ? 'phone' : 'tablet' };
    }
    if (/CrOS/.test(ua)) return { name: 'Chromebook', os: 'ChromeOS', kind: 'computer' };
    if (/Windows NT/.test(ua)) return { name: 'Windows PC', os: 'Windows', kind: 'computer' };
    if (/Macintosh|Mac OS X/.test(ua)) return { name: 'Mac', os: 'macOS', kind: 'computer' };
    if (/Linux/.test(ua)) return { name: 'Linux computer', os: '', kind: 'computer' };
    return { name: 'Mystery device', os: '', kind: 'device' };
  }

  function browserInfo() {
    var tests = [
      [/Instagram/, 'Instagram in-app browser'], [/FBAN|FBAV|FB_IAB/, 'Facebook in-app browser'],
      [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok in-app browser'], [/Snapchat/, 'Snapchat in-app browser'],
      [/Discord\//, 'Discord in-app browser'], [/LinkedInApp/, 'LinkedIn in-app browser'], [/; wv\)/, 'Android in-app browser'],
      [/EdgA?\/(\d+)|EdgiOS\/(\d+)|Edg\/(\d+)/, 'Edge'], [/OPR\/(\d+)|OPX\/(\d+)/, 'Opera'],
      [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
      [/DuckDuckGo\/(\d+)/, 'DuckDuckGo'], [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
      [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari']
    ];
    for (var i = 0; i < tests.length; i++) {
      var m = ua.match(tests[i][0]);
      if (m) {
        var v = m[1] || m[2] || m[3];
        var name = tests[i][1] === 'Chrome' && navigator.brave ? 'Brave' : tests[i][1];
        return v && !/in-app/.test(name) ? name + ' ' + v : name;
      }
    }
    return 'Unknown browser';
  }

  function displayInfo() {
    var s = window.screen || {}, dpr = window.devicePixelRatio || 1;
    var out = (s.width || innerWidth) + ' × ' + (s.height || innerHeight) + ' @' + (Math.round(dpr * 100) / 100) + 'x';
    try { if (matchMedia('(color-gamut: p3)').matches) out += ', P3 colour'; } catch (e) {}
    return out;
  }

  function timeInfo() {
    var d = new Date(), tz = '', abbr = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    try {
      var parts = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(d);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') abbr = parts[i].value;
    } catch (e) {}
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return { time: abbr ? time + ' ' + abbr : time, tz: tz, tzCity: tz && tz.indexOf('/') > -1 ? tz.split('/').pop().replace(/_/g, ' ') : '' };
  }

  function enrich(info) {
    var jobs = [];
    var uad = navigator.userAgentData;
    if (uad && uad.getHighEntropyValues) {
      jobs.push(uad.getHighEntropyValues(['model', 'platformVersion']).then(function (h) {
        var major = parseInt(h.platformVersion, 10);
        if (h.platform === 'Windows' && major) info.os = major >= 13 ? 'Windows 11' : 'Windows 10';
        if (h.platform === 'macOS' && h.platformVersion) info.os = 'macOS ' + h.platformVersion.split('.').slice(0, 2).join('.');
        if (h.platform === 'Android' && h.model) { info.device = h.model; if (major) info.os = 'Android ' + major; }
      }).catch(function () {}));
    }
    if (navigator.getBattery) {
      jobs.push(navigator.getBattery().then(function (b) {
        info.battery = Math.round(b.level * 100) + '%' + (b.charging ? ', charging' : '');
      }).catch(function () {}));
    }
    return Promise.all(jobs).then(function () { return info; });
  }

  function fetchJSON(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }
  var geoPromise = null;
  function geoLookup() {
    if (geoPromise) return geoPromise;
    try {
      var cached = sessionStorage.getItem('sk-geo');
      if (cached) return (geoPromise = Promise.resolve(JSON.parse(cached)));
    } catch (e) {}
    if (!CONFIG.geoLookup || !window.fetch) return (geoPromise = Promise.resolve(null));
    // skystate.js already looks this up for the weather, so share its answer
    if (SK.where && SK.where.geo) return (geoPromise = SK.where.geo());
    var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null; };
    geoPromise = fetchJSON('https://get.geojs.io/v1/ip/geo.json', 3500)
      .then(function (j) { return { city: j.city, region: j.region, country: j.country, cc: j.country_code, lat: num(j.latitude), lon: num(j.longitude), org: j.organization_name, ip: j.ip }; })
      .catch(function () {
        return fetchJSON('https://ipapi.co/json/', 3500).then(function (j) {
          if (j.error) throw new Error('ipapi');
          return { city: j.city, region: j.region, country: j.country_name, cc: j.country_code, lat: num(j.latitude), lon: num(j.longitude), org: j.org, ip: j.ip };
        });
      })
      .then(function (g) { try { sessionStorage.setItem('sk-geo', JSON.stringify(g)); } catch (e) {} return g; })
      .catch(function () { return null; });
    return geoPromise;
  }

  var scanCache = null;
  function scan() {
    if (scanCache) return scanCache;
    var dev = deviceInfo(), t = timeInfo(), conn = navigator.connection || {};
    var info = {
      device: dev.name, os: dev.os, kind: dev.kind, browser: browserInfo(), display: displayInfo(),
      lang: navigator.language || '', time: t.time, tz: t.tz, tzCity: t.tzCity,
      cores: navigator.hardwareConcurrency || null, memory: navigator.deviceMemory || null,
      net: conn.effectiveType ? String(conn.effectiveType).toUpperCase() : '', battery: ''
    };
    info.ready = enrich(info);
    info.geo = geoLookup();
    return (scanCache = info);
  }

  /* formatting helpers */
  function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60); }
  function place(g, info) {
    if (g && (g.city || g.country)) {
      var bits = [clean(g.city)];
      if (g.region && g.region !== g.city) bits.push(clean(g.region));
      bits.push(clean(g.cc || g.country));
      return bits.filter(Boolean).join(', ');
    }
    return info.tzCity ? info.tzCity + ' region' : 'Somewhere under the stars';
  }
  function coords(g) {
    if (!g || g.lat == null || g.lon == null) return 'Signal shielded';
    return Math.abs(g.lat).toFixed(2) + '° ' + (g.lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(g.lon).toFixed(2) + '° ' + (g.lon >= 0 ? 'E' : 'W');
  }
  function maskIP(g) {
    var ip = g && g.ip ? clean(g.ip) : '';
    if (!ip) return 'Masked';
    if (ip.indexOf(':') > -1) return ip.split(':').slice(0, 2).join(':') + ':••••:••••';
    return ip.split('.').slice(0, 2).join('.') + '.•••.•••';
  }
  function network(g, info) {
    var org = g && g.org && g.org !== 'Unknown' ? clean(g.org).replace(/\s+(Inc\.?|LLC|Ltd\.?|Corporation|Corp\.?)$/i, '') : '';
    if (org && info.net) return org + ' / ' + info.net;
    return org || (info.net ? info.net + ' connection' : 'Encrypted');
  }
  function deviceLine(info) { return info.os ? info.device + ', ' + info.os : info.device; }

  /* ======================================================================
   * 2. Little animation helpers
   * ==================================================================== */
  function Run() { this.aborted = false; this.timers = []; }
  Run.prototype.wait = function (ms) {
    var self = this;
    return new Promise(function (res, rej) {
      if (self.aborted) return rej(ABORT);
      self.timers.push(setTimeout(function () { if (self.aborted) rej(ABORT); else res(); }, REDUCED ? ms * 0.45 : ms));
    });
  };
  Run.prototype.abort = function () { this.aborted = true; this.timers.forEach(clearTimeout); };
  Run.prototype.check = function () { if (this.aborted) throw ABORT; };

  var GLYPHS = '▓▒░<>/\\|=+*#%0123456789ABCDEF';
  function decode(run, el, text, dur) {
    return new Promise(function (res) {
      if (REDUCED || !dur) { el.textContent = text; return res(); }
      var t0 = performance.now();
      (function frame(now) {
        if (run.aborted) { el.textContent = text; return res(); }
        var p = Math.min(1, (now - t0) / dur), n = Math.floor(text.length * p), out = text.slice(0, n);
        for (var i = n; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        el.textContent = out;
        if (p < 1) requestAnimationFrame(frame); else res();
      })(t0);
    });
  }
  function typeOut(run, el, text, perChar) {
    return new Promise(function (res) {
      if (REDUCED) { el.textContent = text; return res(); }
      var i = 0;
      (function tick() {
        if (run.aborted) { el.textContent = text; return res(); }
        i = Math.min(text.length, i + 2);
        el.textContent = text.slice(0, i);
        if (i < text.length) run.timers.push(setTimeout(tick, perChar || 22));
        else res();
      })();
    });
  }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function wobblyCircle(r, seed, amp) {
    var pts = [], n = 40, rnd = seed;
    var rand = function () { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2, rr = r * (1 + (rand() - 0.5) * amp);
      pts.push([100 + Math.cos(a) * rr, 100 + Math.sin(a) * rr]);
    }
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (i = 0; i < n; i++) { // Catmull-Rom through the points
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
           (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' +
           p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d + 'Z';
  }

  /* ======================================================================
   * 3. The gate element, skipping, and the reveal
   * ==================================================================== */
  var current = null;

  function openGate(mode) {
    var g = document.getElementById('gate');
    if (!g) { g = h('div', 'gate'); g.id = 'gate'; document.body.insertBefore(g, document.body.firstChild); }
    g.className = 'gate gate--' + mode;
    g.removeAttribute('style');
    g.innerHTML = '<div class="gate__veil"></div>';
    root.setAttribute('data-gate', mode);
    root.classList.add('gate-open');
    SK.gateOpen = true;
    return g;
  }

  function addSkip(g, run, label) {
    var b = h('button', 'gate__skip', label || 'Skip intro');
    b.type = 'button';
    b.addEventListener('click', function () { run.skip(); });
    g.appendChild(b);
    return b;
  }

  function onKey(e) { if (current && CONFIG.skipKeys.indexOf(e.key) > -1) { e.preventDefault(); current.skip(); } }
  document.addEventListener('keydown', onKey);

  /* The overlay opens from (cx, cy) like a portal onto the sky. */
  function portal(g, cx, cy, dur) {
    return new Promise(function (res) {
      var maskOK = window.CSS && CSS.supports && (CSS.supports('mask-image', 'radial-gradient(black, transparent)') || CSS.supports('-webkit-mask-image', 'radial-gradient(black, transparent)'));
      if (!maskOK || REDUCED) {
        g.style.transition = 'opacity .45s ease'; g.style.opacity = '0';
        return setTimeout(res, 470);
      }
      var maxR = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 140, t0 = performance.now();
      (function step(now) {
        var t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3), r = e * maxR, f = 50 + 110 * e;
        var m = 'radial-gradient(circle at ' + cx + 'px ' + cy + 'px, transparent ' + r.toFixed(1) + 'px, #000 ' + (r + f).toFixed(1) + 'px)';
        g.style.webkitMaskImage = m; g.style.maskImage = m;
        if (t < 1) requestAnimationFrame(step); else res();
      })(t0);
    });
  }

  function emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }

  /* Close the gate right away; fill in the location on the pass whenever it arrives. */
  function finish(g, info, via, tag, at, keep) {
    var pass = keep || { via: via, tag: tag || '', at: Date.now(), device: deviceLine(info), place: place(null, info) };
    var save = function () { SK.pass = pass; try { sessionStorage.setItem('sk-pass', JSON.stringify(pass)); } catch (e) {} };
    save();
    if (g && g.parentNode) g.parentNode.removeChild(g);
    root.classList.remove('gate-open');
    root.setAttribute('data-gate', 'done');
    SK.gateOpen = false;
    current = null;
    if (at && SK.sky) SK.sky.burst(at[0], at[1]);
    if (/[?&](nfc|tag|airdrop|from)\b/.test(location.search) && history.replaceState) { // tidy the address
      var keep = location.search.replace(/^\?/, '').split('&').filter(function (kv) { return kv && !/^(nfc|tag|airdrop|from|intro)(=|$)/.test(kv); });
      history.replaceState(null, '', location.pathname + (keep.length ? '?' + keep.join('&') : '') + location.hash);
    }
    emit('sk:entered', pass);
    Promise.resolve(info.geo).then(function (geo) {
      if (!geo) return;
      pass.place = place(geo, info);
      save();
      emit('sk:pass', pass);
    });
    return Promise.resolve(pass);
  }

  /* ======================================================================
   * 4. "Secure gateway" — the standard entrance
   * ==================================================================== */
  function runFull() {
    var info = scan(), run = new Run(), g = openGate('full');
    current = run;

    var stage = h('div', 'gate__stage');
    var scope = h('div', 'scope');
    scope.innerHTML =
      '<div class="scope__sweep"></div>' +
      '<svg viewBox="0 0 200 200" aria-hidden="true">' +
        '<g class="scope__ticks">' + ticks() + '</g>' +
        '<path class="scope__ring scope__ring--a"/>' +
        '<path class="scope__ring scope__ring--b"/>' +
        '<path class="scope__ring scope__ring--c"/>' +
        '<path class="scope__cross" d="M100 16v24M100 160v24M16 100h24M160 100h24"/>' +
        '<path class="scope__star" d="M100 76C101.6 91.4 108.6 98.4 124 100 108.6 101.6 101.6 108.6 100 124 98.4 108.6 91.4 101.6 76 100 91.4 98.4 98.4 91.4 100 76Z"/>' +
      '</svg>';
    var stamp = h('div', 'stamp'); var stampText = h('span', 'stamp__text'); stamp.appendChild(stampText); scope.appendChild(stamp);

    var con = h('section', 'console');
    var head = h('header', 'console__head');
    head.appendChild(h('span', 'console__led'));
    head.appendChild(h('span', 'console__name', 'StarriKnight gateway'));
    head.appendChild(h('span', 'console__ver', 'v2.6'));
    var log = h('ol', 'console__log'), grid = log, meter = h('div', 'console__meter'), bar = h('i');
    meter.appendChild(bar);
    con.appendChild(head); con.appendChild(log); con.appendChild(meter);
    stage.appendChild(scope); stage.appendChild(con);
    g.appendChild(stage);
    var skipBtn = addSkip(g, run, 'Skip intro');

    // boil the hand-drawn rings a few times a second
    var rings = scope.querySelectorAll('.scope__ring'), radii = [92, 72, 50], boil = 0;
    var variants = [0, 1, 2].map(function (v) { return radii.map(function (r, i) { return wobblyCircle(r, 7 + v * 31 + i * 101, 0.035); }); });
    var paintRings = function () { rings.forEach(function (el, i) { el.setAttribute('d', variants[boil % 3][i]); }); boil++; };
    paintRings();
    var boilTimer = REDUCED ? 0 : setInterval(paintRings, 150);

    function cmd(text, status) {
      var li = h('li', 'cmd'), t = h('span', 'cmd__text'), s = h('span', 'cmd__status');
      li.appendChild(h('span', 'cmd__prompt', '›')); li.appendChild(t); li.appendChild(s);
      log.appendChild(li);
      return typeOut(run, t, text).then(function () { return { done: function (txt, cls) { s.textContent = txt || 'done'; if (cls) li.classList.add(cls); } }; });
    }
    function row(k, v, cls) {
      var li = h('li', 'row' + (cls ? ' row--' + cls : '')), key = h('span', 'row__k', k), val = h('span', 'row__v');
      li.appendChild(key); li.appendChild(val); grid.appendChild(li);
      requestAnimationFrame(function () { li.classList.add('is-in'); });
      return decode(run, val, v, 260);
    }
    function slam(text, cls) {
      stamp.className = 'stamp stamp--' + cls;
      stampText.textContent = text;
      void stamp.offsetWidth;
      stamp.classList.add('is-on');
    }

    var aimed = null;
    var seq = run.wait(80).then(function () {
      g.classList.add('is-live');
      return run.wait(260);
    }).then(function () {
      return cmd('Opening stellar gateway');
    }).then(function (c) {
      return run.wait(320).then(function () { c.done('ok'); return cmd('Scanning visitor'); });
    }).then(function (c) {
      g.classList.add('is-scan');
      return Promise.race([info.ready, run.wait(400)]).then(function () {
        var steps = [
          ['Device', function () { return deviceLine(info); }],
          ['Browser', function () { return info.browser; }],
          ['Display', function () { return info.display; }],
          ['Local time', function () { return info.time; }],
          ['Language', function () { return info.lang || 'Unspoken'; }]
        ];
        if (info.battery) steps.push(['Battery', function () { return info.battery; }]);
        var p = Promise.resolve();
        steps.forEach(function (s) { p = p.then(function () { run.check(); row(s[0], s[1]()); return run.wait(170); }); });
        return p.then(function () {
          var geoRow = h('li', 'row row--wait'), key = h('span', 'row__k', 'Location'), val = h('span', 'row__v', 'Triangulating…');
          geoRow.appendChild(key); geoRow.appendChild(val); grid.appendChild(geoRow);
          requestAnimationFrame(function () { geoRow.classList.add('is-in'); });
          return Promise.race([info.geo, run.wait(2600).then(function () { return null; })]).then(function (geo) {
            run.check();
            geoRow.classList.remove('row--wait');
            decode(run, val, place(geo, info), 300);
            return run.wait(170).then(function () { row('Coordinates', coords(geo)); return run.wait(170); })
              .then(function () { row('Network', network(geo, info)); return run.wait(170); })
              .then(function () { row('IP address', maskIP(geo)); return run.wait(220); })
              .then(function () { c.done('done'); });
          });
        });
      });
    }).then(function () {
      return cmd('Matching against known constellations');
    }).then(function (c) {
      meter.classList.add('is-running');
      return run.wait(950).then(function () { c.done('no match', 'cmd--warn'); });
    }).then(function () {
      row('Identity', 'Unknown', 'warn');
      g.classList.remove('is-scan'); g.classList.add('is-guest');
      slam('Guest detected', 'guest');
      return run.wait(1150);
    }).then(function () {
      return cmd('Issuing a guest pass');
    }).then(function (c) {
      return run.wait(420).then(function () { c.done('granted', 'cmd--ok'); });
    }).then(function () {
      g.classList.remove('is-guest'); g.classList.add('is-ok');
      slam('Access authorized', 'ok');
      return run.wait(1050);
    }).then(function () {
      var r = scope.getBoundingClientRect();
      aimed = [r.left + r.width / 2, r.top + r.height / 2];
      skipBtn.disabled = true;
      g.classList.add('is-opening');
      return portal(g, aimed[0], aimed[1], 1000);
    }).then(function () {
      clearInterval(boilTimer);
      return finish(g, info, 'web', '', aimed);
    }).catch(function (e) { if (e !== ABORT) console.error(e); });

    run.skip = function () {
      if (run.aborted) return;
      run.abort(); clearInterval(boilTimer);
      g.classList.add('is-skipping');
      portal(g, innerWidth / 2, innerHeight * 0.4, 520).then(function () { finish(g, info, 'web', '', null); });
    };
    return seq;
  }

  function ticks() {
    var out = '';
    for (var i = 0; i < 72; i++) {
      var a = (i / 72) * Math.PI * 2, r1 = i % 6 === 0 ? 80 : 84, r2 = 88;
      out += '<line x1="' + (100 + Math.cos(a) * r1).toFixed(1) + '" y1="' + (100 + Math.sin(a) * r1).toFixed(1) +
             '" x2="' + (100 + Math.cos(a) * r2).toFixed(1) + '" y2="' + (100 + Math.sin(a) * r2).toFixed(1) + '"/>';
    }
    return out;
  }

  /* ======================================================================
   * 5. "Tap access via NFC" — an island drops from the top of the screen
   * ==================================================================== */
  function tagName() {
    var m = location.search.match(/[?&]tag=([a-z0-9-]{1,16})/i);
    return m ? m[1].toUpperCase() : 'SK-01';
  }
  function tagUID(tag) { // a stable, made-up NFC chip ID (NTAG chips start with 04)
    var hsh = 2166136261;
    for (var i = 0; i < tag.length; i++) { hsh ^= tag.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    var out = ['04'];
    for (i = 0; i < 6; i++) { hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177); out.push(('0' + ((hsh >>> 8) & 255).toString(16).toUpperCase()).slice(-2)); }
    return out.join(':');
  }

  function runNfc() {
    var info = scan(), run = new Run(), g = openGate('nfc'), tag = tagName();
    current = run;

    var field = h('div', 'field'); field.innerHTML = '<i></i><i></i><i></i>';
    var island = h('div', 'island');
    var inner = h('div', 'island__inner');
    var top = h('div', 'island__top');
    var icon = h('span', 'island__icon');
    icon.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 11.5a6.5 6.5 0 0 1 0 9"/><path d="M13.5 8a11.5 11.5 0 0 1 0 16"/><path d="M18 4.8a16 16 0 0 1 0 22.4"/><circle cx="5.5" cy="16" r="2.2"/></svg>';
    var titles = h('div', 'island__titles');
    var kicker = h('p', 'island__kicker', 'NFC tag detected');
    var title = h('p', 'island__title', '');
    titles.appendChild(kicker); titles.appendChild(title);
    var ring = h('span', 'island__ring');
    ring.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring__track" cx="18" cy="18" r="15"/><circle class="ring__bar" cx="18" cy="18" r="15"/><path class="ring__check" d="M11.5 18.5l4.2 4.2 8.6-9.2"/></svg>';
    top.appendChild(icon); top.appendChild(titles); top.appendChild(ring);
    var rows = h('ol', 'island__rows');
    var verdict = h('div', 'island__verdict');
    var pill = h('p', 'island__pill', '');
    inner.appendChild(top); inner.appendChild(rows); inner.appendChild(verdict);
    island.appendChild(inner); island.appendChild(pill);
    g.appendChild(field); g.appendChild(island);
    var skipBtn = addSkip(g, run, 'Skip');

    var fit = function () { island.style.height = Math.ceil(inner.scrollHeight) + 'px'; };
    function row(k, v) {
      var li = h('li', 'irow'), key = h('span', 'irow__k', k), val = h('span', 'irow__v');
      li.appendChild(key); li.appendChild(val); rows.appendChild(li);
      fit();
      requestAnimationFrame(function () { li.classList.add('is-in'); });
      return decode(run, val, v, 240);
    }
    function progress(p) { island.style.setProperty('--p', p); }

    var aimed = null;
    var seq = run.wait(140).then(function () {
      island.classList.add('is-in');                       // the pill drops in
      return run.wait(520);
    }).then(function () {
      field.classList.add('is-on');                        // the NFC field ripples down the screen
      island.classList.add('is-wide');                     // the pill widens
      progress(0.08);
      return run.wait(360);
    }).then(function () {
      return decode(run, title, 'Tap access via NFC', 380);
    }).then(function () {
      island.classList.add('is-open'); fit();
      progress(0.2);
      return run.wait(260);
    }).then(function () {
      return row('Tag', tag);
    }).then(function () {
      return run.wait(150).then(function () { progress(0.32); return row('Chip ID', tagUID(tag)); });
    }).then(function () {
      return run.wait(170).then(function () { progress(0.44); return row('Handshake', 'Secure ✓'); });
    }).then(function () {
      return Promise.race([info.ready, run.wait(300)]).then(function () {
        progress(0.56); return row('Device', deviceLine(info));
      });
    }).then(function () {
      return run.wait(150).then(function () { progress(0.66); return row('Browser', info.browser); });
    }).then(function () {
      return Promise.race([info.geo, run.wait(2400).then(function () { return null; })]).then(function (geo) {
        run.check();
        progress(0.8);
        return row('Location', place(geo, info));
      });
    }).then(function () {
      return run.wait(150).then(function () { progress(0.9); return row('Local time', info.time); });
    }).then(function () {
      verdict.className = 'island__verdict is-guest'; verdict.textContent = 'Guest detected'; fit();
      g.classList.add('is-guest');
      return run.wait(1050);
    }).then(function () {
      progress(1);
      island.classList.add('is-ok'); g.classList.remove('is-guest'); g.classList.add('is-ok');
      verdict.className = 'island__verdict is-ok'; verdict.textContent = 'Access granted';
      field.classList.remove('is-on'); void field.offsetWidth; field.classList.add('is-on', 'is-ok');
      return run.wait(1000);
    }).then(function () {
      pill.textContent = 'Unlocked';
      island.style.height = '';
      island.classList.add('is-closing');                  // shrink back into a pill
      return run.wait(720);
    }).then(function () {
      skipBtn.disabled = true;
      island.classList.add('is-out');                      // and slide away upward
      var r = island.getBoundingClientRect();
      aimed = [r.left + r.width / 2, Math.max(24, r.top + r.height / 2)];
      return run.wait(260);
    }).then(function () {
      return portal(g, aimed[0], aimed[1], 950);
    }).then(function () {
      return finish(g, info, 'nfc', tag, [aimed[0], Math.min(innerHeight * 0.3, aimed[1] + 120)]);
    }).catch(function (e) { if (e !== ABORT) console.error(e); });

    run.skip = function () {
      if (run.aborted) return;
      run.abort();
      island.classList.add('is-out');
      portal(g, innerWidth / 2, 0, 520).then(function () { finish(g, info, 'nfc', tag, null); });
    };
    return seq;
  }

  /* ======================================================================
   * 6. "AirDrop" — the site arrives like a photo someone shared with you,
   *    then the picture opens up into the real sky
   * ==================================================================== */
  function senderName() {
    var m = location.search.match(/[?&]from=([^&#]{1,40})/);
    var name = '';
    try { name = m ? clean(decodeURIComponent(m[1].replace(/\+/g, ' '))).slice(0, 20) : ''; } catch (e) {}
    return name || 'Emi';
  }
  var AD_ICONS = {
    star: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5c.9 6.6 3.9 9.6 10.5 10.5-6.6.9-9.6 3.9-10.5 10.5-.9-6.6-3.9-9.6-10.5-10.5C12.1 12.1 15.1 9.1 16 2.5z"/><circle cx="25.5" cy="25" r="2.2"/></svg>',
    moon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20.5 5.5a11 11 0 1 0 6 19.6A9 9 0 0 1 20.5 5.5z"/></svg>',
    cat: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6.5 13.5 7.4 5l6 4.8h5.2l6-4.8.9 8.5c1.3 1.8 1.9 3.7 1.9 5.6 0 5.6-5.2 8.4-11.4 8.4S4.6 24.7 4.6 19.1c0-1.9.6-3.8 1.9-5.6z"/><circle class="ad__eye" cx="12" cy="18" r="1.5"/><circle class="ad__eye" cx="20" cy="18" r="1.5"/></svg>',
    phone: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9.5" y="3.5" width="13" height="25" rx="3.2"/><path d="M14 7h4"/></svg>',
    computer: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4.5" y="7" width="23" height="15" rx="2.2"/><path d="M2.5 26h27"/></svg>'
  };
  function runAirdrop() {
    var info = scan(), run = new Run(), g = openGate('airdrop'), from = senderName();
    current = run;
    var dev = deviceInfo(), short = { 'Windows PC': 'PC', 'Linux computer': 'computer', 'Mystery device': 'device', 'Android phone': 'phone', 'Android tablet': 'tablet' };
    var devName = short[dev.name] || dev.name;

    var stage = h('div', 'ad');
    var head = h('header', 'ad__head');
    head.appendChild(h('p', 'ad__brand', 'AirDrop'));
    var status = h('p', 'ad__status', '');
    head.appendChild(status);
    var radar = h('div', 'ad__radar');
    radar.innerHTML = '<i class="ad__wave"></i><i class="ad__wave"></i><i class="ad__wave"></i>' +
      '<svg class="ad__beam" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 50 Q 66 58 66 79"/></svg>';
    var bubble = function (cls, icon, name) {
      var b = h('div', 'ad__bubble ' + cls), av = h('span', 'ad__avatar');
      av.innerHTML = AD_ICONS[icon];
      b.appendChild(av); b.appendChild(h('span', 'ad__name', name));
      radar.appendChild(b);
      return b;
    };
    var me = bubble('ad__bubble--me is-shown', 'star', 'StarriKnight');
    var moon = bubble('ad__bubble--moon', 'moon', 'The Moon');
    var felis = bubble('ad__bubble--felis', 'cat', 'Felis');
    var you = bubble('ad__bubble--you', dev.kind === 'computer' ? 'computer' : 'phone', 'This ' + devName);

    var card = h('section', 'ad__card');
    var thumb = h('div', 'ad__thumb'), tcv = h('canvas');
    thumb.appendChild(tcv);
    thumb.insertAdjacentHTML('beforeend', '<svg class="ad__ring" viewBox="0 0 120 120" aria-hidden="true"><rect class="ad__ring-bar" x="4" y="4" width="112" height="112" rx="24" pathLength="100"/></svg><span class="ad__check" aria-hidden="true">✓</span>');
    var kicker = h('p', 'ad__kicker', 'AirDrop');
    var msg = h('p', 'ad__msg', '“' + from + '” would like to share “A Starry Night.”');
    var rows = h('ol', 'ad__rows');
    var verdict = h('p', 'ad__verdict');
    var btns = h('div', 'ad__btns'), no = h('button', 'ad__no', 'Decline'), yes = h('button', 'ad__yes', 'Accept');
    no.type = yes.type = 'button';
    btns.appendChild(no); btns.appendChild(yes);
    [thumb, kicker, msg, rows, verdict, btns].forEach(function (el) { card.appendChild(el); });
    stage.appendChild(head); stage.appendChild(radar); stage.appendChild(card);
    g.appendChild(stage);
    var skipBtn = addSkip(g, run, 'Skip');

    // the "photo" is the middle of the real sky behind this screen
    var sq = function () { var vw = innerWidth, vh = innerHeight, S = Math.min(vw, vh); return { x: (vw - S) / 2, y: (vh - S) / 2, S: S }; };
    var drawThumb = function () {
      if (!SK.sky || !SK.sky.snapshot) return;
      var d = Math.min(2, window.devicePixelRatio || 1), size = Math.round(thumb.clientWidth * d) || 224, q = sq();
      tcv.width = tcv.height = size;
      tcv.getContext('2d').drawImage(SK.sky.snapshot(size, size, q.x, q.y, q.S, q.S), 0, 0);
    };
    function row(k, v) {
      var li = h('li', 'adrow'), key = h('span', 'adrow__k', k), val = h('span', 'adrow__v');
      li.appendChild(key); li.appendChild(val); rows.appendChild(li);
      requestAnimationFrame(function () { li.classList.add('is-in'); });
      return decode(run, val, v, 240);
    }
    // the visitor can press Accept (or Decline…) themselves; otherwise it accepts on its own
    function choose(ms) {
      return new Promise(function (res) {
        var done = false, pickIt = function (v) { if (done || run.aborted) return; done = true; res(v); };
        run.timers.push(setTimeout(function () { pickIt('auto'); }, REDUCED ? ms * 0.45 : ms));
        yes.addEventListener('click', function () { pickIt('yes'); });
        no.addEventListener('click', function () { pickIt('no'); });
      });
    }
    function zoomOpen() {
      var r = thumb.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, q = sq(), d = Math.min(1.5, window.devicePixelRatio || 1);
      var big = SK.sky && SK.sky.snapshot ? SK.sky.snapshot(vw * d, vh * d, 0, 0, vw, vh) : h('canvas');
      big.className = 'ad__zoom';
      big.style.width = vw + 'px'; big.style.height = vh + 'px';
      var k = r.width / q.S, rad = (r.width * 0.2) / k;
      big.style.transform = 'translate(' + (r.left - k * q.x).toFixed(1) + 'px,' + (r.top - k * q.y).toFixed(1) + 'px) scale(' + k.toFixed(4) + ')';
      big.style.clipPath = 'inset(' + q.y + 'px ' + (vw - q.x - q.S) + 'px ' + (vh - q.y - q.S) + 'px ' + q.x + 'px round ' + rad.toFixed(1) + 'px)';
      g.appendChild(big);
      void big.offsetWidth;
      g.classList.add('is-opening');
      big.style.transform = 'none';
      big.style.clipPath = 'inset(0px 0px 0px 0px round 0px)';
      return run.wait(REDUCED ? 380 : 860).then(function () { // then the words fade in over the opened photo
        g.style.transition = 'opacity .4s ease'; g.style.opacity = '0';
        return run.wait(REDUCED ? 120 : 400);
      });
    }

    var seq = run.wait(80).then(function () {
      g.classList.add('is-live');
      return typeOut(run, status, 'Looking for nearby guests…', 26);
    }).then(function () {
      moon.classList.add('is-shown');
      return run.wait(380);
    }).then(function () {
      felis.classList.add('is-shown');
      return run.wait(420);
    }).then(function () {
      you.classList.add('is-shown', 'is-found');
      return decode(run, status, 'Guest nearby: ' + 'This ' + devName, 320);
    }).then(function () {
      return run.wait(420);
    }).then(function () {
      radar.classList.add('is-sending');                   // a beam of starlight to the guest
      return run.wait(700);
    }).then(function () {
      drawThumb();
      g.classList.add('is-asking');                        // the share sheet slides up
      card.classList.add('is-in');
      return run.wait(520);
    }).then(function () {
      return Promise.race([info.ready, run.wait(300)]).then(function () { return row('Device', deviceLine(info)); });
    }).then(function () {
      return run.wait(140).then(function () { return row('Browser', info.browser); });
    }).then(function () {
      return Promise.race([info.geo, run.wait(2400).then(function () { return null; })]).then(function (geo) {
        run.check();
        return row('Location', place(geo, info));
      });
    }).then(function () {
      return run.wait(140).then(function () { return row('Local time', info.time); });
    }).then(function () {
      verdict.className = 'ad__verdict is-guest'; verdict.textContent = 'Guest detected';
      g.classList.add('is-guest');
      return choose(1300);
    }).then(function (how) {
      if (how === 'no') {
        msg.textContent = 'Declined? The stars insist~';
        no.classList.add('is-pressed');
        return run.wait(900);
      }
    }).then(function () {
      yes.classList.add('is-pressed');
      drawThumb();
      card.classList.add('is-receiving');                  // the progress ring fills around the photo
      msg.textContent = 'Receiving “A Starry Night”…';
      return run.wait(1150);
    }).then(function () {
      card.classList.add('is-received');
      g.classList.remove('is-guest'); g.classList.add('is-ok');
      verdict.className = 'ad__verdict is-ok'; verdict.textContent = 'Access authorized';
      msg.textContent = 'Received. Opening…';
      return run.wait(950);
    }).then(function () {
      skipBtn.disabled = true;
      return zoomOpen();
    }).then(function () {
      return finish(g, info, 'airdrop', '', [innerWidth / 2, innerHeight * 0.42]);
    }).catch(function (e) { if (e !== ABORT) console.error(e); });

    run.skip = function () {
      if (run.aborted) return;
      run.abort();
      portal(g, innerWidth / 2, innerHeight * 0.55, 520).then(function () { finish(g, info, 'airdrop', '', null); });
    };
    return seq;
  }

  /* ======================================================================
   * 7. "Welcome back" — already entered in this tab
   * ==================================================================== */
  function runBrief() {
    var info = scan(), g = openGate('brief'), run = new Run();
    current = run;
    var toast = h('div', 'toast');
    toast.setAttribute('role', 'status');
    toast.appendChild(h('span', 'toast__dot'));
    toast.appendChild(h('span', 'toast__text', 'Welcome back, guest. Your pass is still valid.'));
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('is-in'); });
    setTimeout(function () { toast.classList.remove('is-in'); setTimeout(function () { toast.remove(); }, 600); }, 2600);
    run.skip = function () {};
    g.style.transition = 'opacity .7s ease';
    requestAnimationFrame(function () { requestAnimationFrame(function () { g.style.opacity = '0'; }); });
    return new Promise(function (res) { setTimeout(res, 720); }).then(function () {
      var prev = null;
      try { prev = JSON.parse(sessionStorage.getItem('sk-pass') || 'null'); } catch (e) {}
      return finish(g, info, prev && prev.via ? prev.via : 'web', prev && prev.tag, null, prev && prev.at ? prev : null);
    });
  }

  /* ======================================================================
   * 8. Start
   * ==================================================================== */
  function play(mode) {
    if (current) return;
    if (mode === 'nfc') return runNfc();
    if (mode === 'airdrop') return runAirdrop();
    if (mode === 'brief') return runBrief();
    return runFull();
  }

  SK.gate = { play: play, scan: scan };

  function boot() {
    var mode = root.getAttribute('data-gate') || 'full';
    if (mode === 'done') return;
    play(mode);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
