/*
 * Repo Watcher — storage layer.
 * Everything lives in localStorage: the last fetch, the snapshot history
 * used for the growth charts, and the (optional) token.
 */
(function (global) {
  'use strict';

  var KEYS = {
    cache: 'ghw.cache.v1',
    series: 'ghw.series.v1',
    settings: 'ghw.settings.v1'
  };

  var REFRESH_MS = 12 * 60 * 60 * 1000;
  // 240 points is about four months at the 12-hour refresh; every repo above
  // 100k stars is tracked, so each series has to stay lean.
  var MAX_POINTS = 240;
  var MIN_POINT_GAP_MS = 60 * 60 * 1000;

  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function getCache() {
    var cache = read(KEYS.cache, null);
    if (!cache || !cache.fetchedAt || !Array.isArray(cache.allTime)) return null;
    return cache;
  }

  function saveCache(cache) {
    write(KEYS.cache, cache);
  }

  function getSeries() {
    var series = read(KEYS.series, null);
    return series && typeof series === 'object' ? series : {};
  }

  function saveSeries(series) {
    return write(KEYS.series, series);
  }

  // Drops every other point of the older half so long histories stay small
  // while recent points keep their full resolution.
  function thin(points) {
    var half = Math.floor(points.length / 2);
    var head = points.slice(0, half).filter(function (point, index) {
      return index % 2 === 0;
    });
    return head.concat(points.slice(half));
  }

  function prune(points) {
    var out = points;
    while (out.length > MAX_POINTS) out = thin(out);
    return out;
  }

  // localStorage has a few megabytes at most; when the write fails (a lot of
  // tracked repositories), halve the older half of every series and retry.
  function saveSeriesSafe(series) {
    if (saveSeries(series)) return series;

    var slim = {};
    Object.keys(series).forEach(function (id) {
      var entry = series[id] || {};
      slim[id] = { name: entry.name, points: thin(entry.points || []) };
    });

    if (saveSeries(slim)) return slim;
    return series;
  }

  // Records one snapshot per repo for this fetch and returns the whole series.
  function record(cache) {
    var series = getSeries();
    var now = cache && cache.fetchedAt ? cache.fetchedAt : Date.now();
    var repos = ((cache && cache.allTime) || []).concat((cache && cache.trending) || []);
    var seen = {};

    repos.forEach(function (repo) {
      if (!repo || !repo.id || seen[repo.id]) return;
      seen[repo.id] = true;

      var entry = series[repo.id];
      if (!entry || !Array.isArray(entry.points)) {
        entry = { name: repo.name, points: [] };
      }
      entry.name = repo.name;

      var last = entry.points[entry.points.length - 1];
      if (!last) {
        entry.points.push({ t: now, s: repo.stars, f: repo.forks });
      } else if (now - last.t >= MIN_POINT_GAP_MS) {
        entry.points.push({ t: now, s: repo.stars, f: repo.forks });
      } else if (last.s !== repo.stars || last.f !== repo.forks) {
        // Refreshes closer together than an hour update the newest point
        // instead of piling up near-identical ones.
        last.s = repo.stars;
        last.f = repo.forks;
      }

      entry.points = prune(entry.points);
      series[repo.id] = entry;
    });

    return saveSeriesSafe(series);
  }

  function getSettings() {
    var settings = read(KEYS.settings, {});
    return { token: (settings && settings.token) || '' };
  }

  function saveSettings(settings) {
    write(KEYS.settings, { token: (settings && settings.token) || '' });
  }

  function clearSeries() {
    try {
      global.localStorage.removeItem(KEYS.series);
    } catch (err) {
      /* storage unavailable */
    }
  }

  global.GHW = global.GHW || {};
  global.GHW.store = {
    REFRESH_MS: REFRESH_MS,
    getCache: getCache,
    saveCache: saveCache,
    getSeries: getSeries,
    saveSeries: saveSeries,
    record: record,
    getSettings: getSettings,
    saveSettings: saveSettings,
    clearSeries: clearSeries
  };
})(window);
