/*!
 * StarriKnight — what the sky looks like right now
 * ---------------------------------------------------------------------------
 * Works out, for each visitor:
 *   - time of day (night, dawn, day, dusk) from their local sunrise/sunset
 *   - tonight's real moon phase
 *   - the season (flipped for the southern hemisphere) and any holiday
 *   - the local weather and a short forecast, from a rough location
 *
 * The rough location comes from the visitor's IP address (GeoJS, with
 * ipapi.co as a backup); the weather from Open-Meteo. Nothing is stored
 * anywhere except a short-lived copy in that browser tab, so a reload
 * doesn't ask again.
 *
 * Preview any combination by adding these to the address (e.g. ?time=dusk&weather=snow):
 *   time=night|dawn|day|dusk
 *   weather=clear|partly|cloudy|fog|drizzle|rain|snow|storm
 *   date=2026-10-31        (moon phase, season and holiday for that day)
 *   holiday=newyear|lunar|valentine|canada|midautumn|halloween|winterlights|none
 *   season=spring|summer|autumn|winter
 *   moon=0.5               (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter)
 *   sky=night              (always the starry night)
 * The secret settings menu (tap the © line at the very bottom) does the same live.
 *
 * Exposes window.SK.where and window.SK.skyState, and fires 'sk:skystate'.
 */
(function () {
  'use strict';

  var SK = (window.SK = window.SK || {});
  var CONFIG = { geoLookup: true, weather: true };
  var params = new URLSearchParams(location.search);
  var TAU = Math.PI * 2;

  function emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
  function store(kind, key, value) { try { window[kind].setItem(key, JSON.stringify(value)); } catch (e) {} }
  function load(kind, key) { try { return JSON.parse(window[kind].getItem(key) || 'null'); } catch (e) { return null; } }

  function fetchJSON(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ======================================================================
   * 1. Where: a rough, city-level location from the IP address
   * ==================================================================== */
  var geoPromise = null;
  function geo() {
    if (geoPromise) return geoPromise;
    var cached = load('sessionStorage', 'sk-geo');
    if (cached) return (geoPromise = Promise.resolve(cached));
    if (!CONFIG.geoLookup || !window.fetch) return (geoPromise = Promise.resolve(null));
    var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null; };
    geoPromise = fetchJSON('https://get.geojs.io/v1/ip/geo.json', 3500)
      .then(function (j) { return { city: j.city, region: j.region, country: j.country, cc: j.country_code, lat: num(j.latitude), lon: num(j.longitude), org: j.organization_name, ip: j.ip }; })
      .catch(function () {
        return fetchJSON('https://ipapi.co/json/', 3500).then(function (j) {
          if (j.error) throw new Error('ipapi');
          return { city: j.city, region: j.region, country: j.country_name, cc: j.country_code, lat: num(j.latitude), lon: num(j.longitude), org: j.org, ip: j.ip };
        });
      })
      .then(function (g) { store('sessionStorage', 'sk-geo', g); return g; })
      .catch(function () { return null; });
    return geoPromise;
  }

  /* ======================================================================
   * 2. Weather: Open-Meteo (free, no key), cached for 30 minutes in the tab
   * ==================================================================== */
  var wxPromise = null, lastWx = null;
  function cachedWeather() {
    var w = load('sessionStorage', 'sk-wx');
    return w && Date.now() - w.at < 30 * 60 * 1000 ? w : null;
  }
  function weather() {
    if (wxPromise) return wxPromise;
    var cached = cachedWeather();
    if (cached) return (wxPromise = Promise.resolve(cached));
    if (!CONFIG.weather || !window.fetch) return (wxPromise = Promise.resolve(null));
    wxPromise = geo().then(function (g) {
      if (!g || g.lat == null || g.lon == null) return null;
      // rounded to about 10 km: plenty for weather, and kinder to privacy
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + g.lat.toFixed(1) + '&longitude=' + g.lon.toFixed(1) +
        '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=4';
      return fetchJSON(url, 6000).then(function (j) {
        var d = j.daily || {}, c = j.current || {};
        var w = {
          place: g.city || g.region || g.country || '', lat: g.lat,
          offset: j.utc_offset_seconds || 0,
          temp: c.temperature_2m, code: c.weather_code, cloud: c.cloud_cover, wind: c.wind_speed_10m, isDay: c.is_day,
          days: (d.time || []).map(function (t, i) {
            return { date: t, code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], sunrise: d.sunrise[i], sunset: d.sunset[i] };
          }),
          at: Date.now()
        };
        store('sessionStorage', 'sk-wx', w);
        return w;
      });
    }).catch(function () { return null; });
    return wxPromise;
  }

  /* ======================================================================
   * 3. Weather codes (WMO, as used by Open-Meteo)
   * ==================================================================== */
  function kindOf(code) {
    if (code == null || code <= 1) return 'clear';
    if (code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'clear';
  }
  var WORDS = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail'
  };
  function describe(code) { return WORDS[code] || 'Clear sky'; }

  /* ======================================================================
   * 4. Time of day, from today's sunrise and sunset where the visitor is
   * ==================================================================== */
  function minutesOf(iso) { var m = /T(\d\d):(\d\d)/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function timeOfDay(w, now) {
    if (w && w.days && w.days[0]) {
      var local = new Date(now.getTime() + w.offset * 1000), mins = local.getUTCHours() * 60 + local.getUTCMinutes();
      var rise = minutesOf(w.days[0].sunrise), set = minutesOf(w.days[0].sunset);
      if (rise != null && set != null && set > rise) {
        if (mins < rise - 40 || mins > set + 40) return 'night';
        if (mins < rise + 35) return 'dawn';
        if (mins > set - 35) return 'dusk';
        return 'day';
      }
    }
    var h = now.getHours() + now.getMinutes() / 60; // a rough guess from the visitor's own clock
    if (h < 5.5 || h >= 19.5) return 'night';
    if (h < 7) return 'dawn';
    if (h >= 18) return 'dusk';
    return 'day';
  }

  /* ======================================================================
   * 5. The real moon phase (0 = new, 0.5 = full)
   * ==================================================================== */
  var PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  function moonAt(p) { return { phase: p, illum: (1 - Math.cos(TAU * p)) / 2, waxing: p < 0.5, name: PHASES[Math.round(p * 8) % 8] }; }
  function moonPhase(date) {
    var synodic = 29.530588853, knownNew = Date.UTC(2000, 0, 6, 18, 14);
    var days = (date.getTime() - knownNew) / 86400000;
    return moonAt((((days % synodic) + synodic) % synodic) / synodic);
  }

  /* ======================================================================
   * 6. Seasons and holidays (dates for the moving ones are listed here)
   * ==================================================================== */
  var LUNAR_NEW_YEAR = ['2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23', '2032-02-11', '2033-01-31', '2034-02-19', '2035-02-08'];
  var MID_AUTUMN = ['2026-09-25', '2027-09-15', '2028-10-03', '2029-09-22', '2030-09-12', '2031-10-01', '2032-09-19', '2033-09-08', '2034-09-27', '2035-09-16'];
  function dayNumber(date) { return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000); }
  function near(list, date, before, after) {
    var today = dayNumber(date);
    return list.some(function (s) {
      var p = s.split('-'), d = Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
      return today >= d + before && today <= d + after;
    });
  }
  function season(date, lat) {
    var m = date.getMonth();
    var s = m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
    if (lat != null && lat < 0) s = { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[s];
    return s;
  }
  function holiday(date) {
    var md = (date.getMonth() + 1) * 100 + date.getDate();
    if (md === 1231 || md === 101) return 'newyear';
    if (near(LUNAR_NEW_YEAR, date, -1, 6)) return 'lunar';
    if (near(MID_AUTUMN, date, -2, 1)) return 'midautumn';
    if (md >= 212 && md <= 214) return 'valentine';
    if (md === 701) return 'canada';
    if (md >= 1024 && md <= 1031) return 'halloween';
    if (md >= 1215 && md <= 1226) return 'winterlights';
    return '';
  }

  /* ======================================================================
   * 7. Putting it together
   * ==================================================================== */
  var pick = function (name, re) { var v = params.get(name); return v && re.test(v) ? v : null; };
  var over = {
    time: pick('time', /^(night|dawn|day|dusk)$/),
    weather: pick('weather', /^(clear|partly|cloudy|fog|drizzle|rain|snow|storm)$/),
    date: pick('date', /^\d{4}-\d{2}-\d{2}$/),
    holiday: pick('holiday', /^(newyear|lunar|valentine|canada|midautumn|halloween|winterlights|none)$/),
    season: pick('season', /^(spring|summer|autumn|winter)$/),
    moon: pick('moon', /^(0(\.\d+)?|1)$/)
  };
  var pref = load('localStorage', 'sk-sky') || 'live';
  if (params.get('sky') === 'night') pref = 'night';

  function compute(w) {
    var now = over.date ? new Date(over.date + 'T21:30:00') : new Date();
    var live = pref !== 'night';
    var g = load('sessionStorage', 'sk-geo');
    var lat = w && w.lat != null ? w.lat : g && g.lat != null ? g.lat : null;
    var actual = timeOfDay(w, now);
    return {
      pref: pref,
      actual: over.time || actual,        // the real time of day, even when "always night" is on
      // a preview (from the address or the secret settings) wins over "always night"
      time: over.time || (live ? actual : 'night'),
      weather: over.weather || (live && w ? kindOf(w.code) : 'clear'),
      wind: w && w.wind != null ? w.wind : 8,
      moon: over.moon != null ? moonAt(+over.moon % 1) : moonPhase(now),
      south: lat != null && lat < 0,
      season: over.season || season(now, lat),
      holiday: over.holiday === 'none' ? '' : over.holiday || holiday(now),
      wx: w,
      previewing: !!(over.time || over.weather || over.date || over.holiday || over.season || over.moon != null)
    };
  }

  function sameLook(a, b) { return a && b && a.time === b.time && a.weather === b.weather && a.holiday === b.holiday && a.season === b.season; }
  function update(w) {
    if (w !== undefined) lastWx = w;
    var prev = SK.skyState, next = compute(lastWx);
    SK.skyState = next;
    document.documentElement.setAttribute('data-sky', next.time);
    emit('sk:skystate', { state: next, repaint: !sameLook(prev, next) });
  }

  // a first guess straight away (so the painting starts right), then the real thing
  lastWx = cachedWeather();
  SK.skyState = compute(lastWx);
  document.documentElement.setAttribute('data-sky', SK.skyState.time);

  SK.where = { geo: geo, weather: weather, describe: describe, kindOf: kindOf };
  SK.setSkyPref = function (p) {
    pref = p === 'night' ? 'night' : 'live';
    store('localStorage', 'sk-sky', pref);
    update();
  };
  /* For the secret settings menu: preview any sky until the page is reloaded.
     Pass { time, weather, holiday, season, moon } (moon = 0…1, 0 new, 0.5 full); null = back to live. */
  var KEYS = ['time', 'weather', 'holiday', 'season', 'moon'];
  SK.setSkyOverride = function (o) {
    KEYS.forEach(function (k) { if (o && k in o) over[k] = o[k] == null || o[k] === '' ? null : String(o[k]); });
    if (!o) KEYS.forEach(function (k) { over[k] = null; });
    update();
  };
  SK.getSkyOverride = function () { var out = {}; KEYS.forEach(function (k) { out[k] = over[k]; }); return out; };

  function start() { weather().then(function (w) { update(w); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // the sky keeps up if the tab stays open across sunset
  setInterval(function () { if (!document.hidden) update(); }, 5 * 60 * 1000);
})();
