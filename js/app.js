/*
 * Repo Watcher — view layer, refresh scheduler and chart wiring.
 */
(function (global) {
  'use strict';

  var Store = global.GHW.store;
  var Api = global.GHW.api;
  var Chart = global.GHW.chart;

  var DAY = 86400000;
  var RETRY_MS = 5 * 60000;

  var STAR_SVG =
    '<svg class="icon-sm" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path fill="currentColor" d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .74 4.3L8 11.3l-3.8 2.1.74-4.3-3.1-3 4.3-.6z"/>' +
    '</svg>';

  var FORK_SVG =
    '<svg class="icon-sm" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
    '<circle cx="4" cy="3.5" r="1.6"/><circle cx="12" cy="3.5" r="1.6"/><circle cx="8" cy="12.5" r="1.6"/>' +
    '<path d="M4 5.1v1.4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5.1M8 8.5v2.4"/>' +
    '</svg>';

  var LANG_COLORS = {
    JavaScript: '#f1e05a',
    TypeScript: '#3178c6',
    Python: '#3572A5',
    Java: '#b07219',
    Go: '#00ADD8',
    Rust: '#dea584',
    'C++': '#f34b7d',
    C: '#555555',
    'C#': '#178600',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Swift: '#F05138',
    Kotlin: '#A97BFF',
    Dart: '#00B4AB',
    Shell: '#89e051',
    HTML: '#e34c26',
    CSS: '#563d7c',
    Vue: '#41b883',
    'Jupyter Notebook': '#DA5B0B',
    Zig: '#ec915c',
    Elixir: '#6e4a7e',
    Haskell: '#5e5086',
    Lua: '#000080',
    Scala: '#c22d40',
    'Objective-C': '#438eff',
    Nix: '#7e7eff',
    Solidity: '#AA6746',
    Svelte: '#ff3e00',
    R: '#198CE7',
    Perl: '#0298c3',
    Clojure: '#db5855',
    Assembly: '#6E4C13',
    Dockerfile: '#384d54',
    Makefile: '#427819',
    PowerShell: '#012456',
    CoffeeScript: '#244776',
    Haxe: '#df7900',
    OCaml: '#ef7a08',
    Julia: '#a270ba',
    'Emacs Lisp': '#c065db',
    'Vim Script': '#199f4b',
    Erlang: '#B03A7A',
    Crystal: '#4b4b4b',
    Nim: '#d8a800',
    Elm: '#60B5FF',
    D: '#ba6735',
    Fortran: '#4d41b1',
    GDScript: '#355570',
    Astro: '#ff5a03',
    Blade: '#f7523f',
    MDX: '#fcb32c'
  };

  var state = {
    cache: null,
    history: {},
    tab: 'alltime',
    query: '',
    refreshing: false,
    error: null,
    warnings: [],
    openId: null,
    metric: 's',
    mode: 'level',
    range: 'all',
    settings: { token: '' },
    rate: null,
    lastAttempt: 0,
    scroll: { list: 0, detail: 0 }
  };

  var els = {};
  var chart = null;
  var uiSaveTimer = 0;

  /* ------------------------------ helpers ----------------------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function fmtNum(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e6) return trimZero((n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)) + 'M';
    if (abs >= 1e4) return trimZero((n / 1e3).toFixed(1)) + 'k';
    return n.toLocaleString();
  }

  function trimZero(text) {
    return text.replace(/\.0+$/, '');
  }

  function fmtDelta(value) {
    return (value > 0 ? '+' : '') + fmtNum(value);
  }

  function dateTime(ts) {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function monthYear(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return 'unknown';
    return date.toLocaleDateString([], { year: 'numeric', month: 'short' });
  }

  function timeAgo(when) {
    var t = typeof when === 'number' ? when : new Date(when).getTime();
    if (!t || isNaN(t)) return 'unknown';
    var diff = Math.max(0, Date.now() - t);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    var months = Math.floor(days / 30);
    if (months < 12) return months + 'mo ago';
    return Math.floor(months / 12) + 'y ago';
  }

  function timeUntil(ts) {
    var diff = ts - Date.now();
    if (diff <= 0) return 'due now';
    var hours = Math.floor(diff / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    if (hours >= 1) return hours + 'h ' + String(minutes).padStart(2, '0') + 'm';
    return Math.max(1, minutes) + 'm';
  }

  function yearsSince(iso) {
    if (!iso) return 'unknown age';
    var days = (Date.now() - new Date(iso).getTime()) / 86400000;
    var years = days / 365.25;
    return (years >= 10 ? years.toFixed(0) : years.toFixed(1)) + ' years old';
  }

  function daysSince(iso) {
    if (!iso) return 1;
    return Math.max(1, (Date.now() - new Date(iso).getTime()) / 86400000);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function languageColor(lang) {
    return LANG_COLORS[lang] || '#8b8f98';
  }

  function shortName(fullName) {
    var parts = String(fullName || '').split('/');
    return parts.length > 1 ? parts[parts.length - 1] : String(fullName || '');
  }

  function ownerName(repo) {
    if (repo && repo.owner) return repo.owner;
    var parts = String((repo && repo.name) || '').split('/');
    return parts.length > 1 ? parts[0] : '';
  }

  /* ------------------------------ queries ----------------------------- */

  function currentList() {
    if (!state.cache) return [];
    return state.tab === 'trending' ? state.cache.trending || [] : state.cache.allTime || [];
  }

  function filteredRepos() {
    var repos = currentList();
    var query = state.query.trim().toLowerCase();
    if (!query) return repos;
    return repos.filter(function (repo) {
      var haystack = [repo.name, repo.desc || '', repo.lang || ''].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
  }

  function findRepo(id) {
    var lists = [state.cache && state.cache.allTime, state.cache && state.cache.trending];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i] || [];
      for (var j = 0; j < list.length; j++) {
        if (String(list[j].id) === String(id)) return list[j];
      }
    }
    return null;
  }

  function rangeCutoff(range) {
    if (range === '24h') return Date.now() - DAY;
    if (range === '7d') return Date.now() - 7 * DAY;
    if (range === '30d') return Date.now() - 30 * DAY;
    if (range === '90d') return Date.now() - 90 * DAY;
    return 0;
  }

  /*
   * Change of `field` ('s' stars, 'f' forks) over a window. When the stored
   * history is shorter than the window, the oldest snapshot is used instead
   * and the label says so.
   */
  function computeDelta(repoId, windowMs, field) {
    var entry = state.history[repoId];
    var points = entry && Array.isArray(entry.points) ? entry.points : [];
    if (points.length < 2) return null;

    var key = field || 's';
    var newest = points[points.length - 1];
    var target = newest.t - windowMs;
    var base = null;

    for (var i = points.length - 1; i >= 0; i--) {
      if (points[i].t <= target) {
        base = points[i];
        break;
      }
    }

    // With less history than the window, measure from the oldest snapshot so
    // the label never claims a span the stored data does not cover.
    if (!base) base = points[0];

    var span = newest.t - base.t;
    if (span < 30 * 60000) return null;

    var label =
      span >= 2 * DAY
        ? Math.round(span / DAY) + 'd'
        : Math.max(1, Math.round(span / 3600000)) + 'h';

    return { value: newest[key] - base[key], label: label, from: base.t, to: newest.t };
  }

  /* ----------------------------- rendering ---------------------------- */

  function render() {
    renderChrome();
    renderBanner();
    if (state.openId) renderDetail();
    else renderList();
  }

  function renderChrome() {
    var cache = state.cache;
    var fresh = !!cache && Date.now() - cache.fetchedAt < Store.REFRESH_MS + 3600000;

    els.lastUpdated.textContent = cache
      ? 'Synced ' + timeAgo(cache.fetchedAt)
      : state.refreshing
        ? 'Fetching from GitHub…'
        : 'Waiting for the first sync';

    els.countdown.textContent = state.refreshing
      ? 'Updating from GitHub…'
      : cache
        ? 'Next refresh in ' + timeUntil(cache.fetchedAt + Store.REFRESH_MS)
        : 'No data cached yet';

    els.refreshBtn.disabled = state.refreshing;
    els.refreshBtn.classList.toggle('is-busy', state.refreshing);

    els.liveDot.className =
      'pulse ' + (state.error ? 'is-error' : fresh ? 'is-live' : cache ? 'is-stale' : '');

    var ids = Object.keys(state.history);
    var points = 0;
    ids.forEach(function (id) {
      var entry = state.history[id];
      if (entry && Array.isArray(entry.points)) points += entry.points.length;
    });
    els.trackedCount.textContent =
      ids.length + ' tracked · ' + points + ' snapshots';

    if (state.rate && state.rate.search) {
      els.quota.hidden = false;
      els.quota.textContent =
        'search ' + state.rate.search.remaining + '/' + state.rate.search.limit;
    }
  }

  function renderBanner() {
    var messages = [];
    if (state.error) messages.push(state.error.message || String(state.error));
    messages = messages.concat(state.warnings || []);

    if (!messages.length) {
      els.banner.hidden = true;
      els.banner.textContent = '';
      return;
    }
    els.banner.hidden = false;
    els.banner.textContent = messages.join(' ');
  }

  function renderList() {
    els.listView.hidden = false;
    els.detailView.hidden = true;

    if (!state.cache) {
      els.listCount.textContent = '—';
      els.listNote.textContent = state.refreshing ? 'Fetching from GitHub…' : 'Not synced yet';
      els.repoList.innerHTML = state.refreshing
        ? skeletonHtml()
        : '<li class="empty">No data yet. Tap Refresh to load the lists from GitHub.</li>';
      return;
    }

    var repos = filteredRepos();
    els.listCount.textContent = repos.length + (repos.length === 1 ? ' repo' : ' repos');
    els.listNote.textContent =
      state.tab === 'trending'
        ? 'Created since ' + (state.cache.trendingSince || 'last week')
        : '100k+ stars · all time';
    els.search.placeholder =
      state.tab === 'trending'
        ? 'Filter these 20 repositories'
        : 'Search all ' + (state.cache.allTime || []).length + ' repositories';

    if (!repos.length) {
      els.repoList.innerHTML = '<li class="empty">No repositories match your filter.</li>';
      return;
    }

    els.repoList.innerHTML = repos.map(repoRowHtml).join('');
  }

  function renderDetail() {
    var repo = findRepo(state.openId);
    if (!repo) {
      state.openId = null;
      renderList();
      return;
    }

    els.listView.hidden = true;
    els.detailView.hidden = false;

    els.dAvatar.src = repo.avatar || '';
    els.dAvatar.alt = ownerName(repo) + ' avatar';
    els.dName.textContent = repo.name;
    els.dName.href = repo.url;
    els.dDesc.textContent = repo.desc || 'No description provided.';
    els.dMeta.innerHTML = metaHtml(repo);

    var starDelta = computeDelta(repo.id, 7 * DAY, 's');
    var forkDelta = computeDelta(repo.id, 7 * DAY, 'f');

    els.dStats.innerHTML =
      statCard('Stars', fmtNum(repo.stars), deltaText(starDelta), 'gold') +
      statCard('Forks', fmtNum(repo.forks), deltaText(forkDelta), 'blue') +
      statCard('Open issues', fmtNum(repo.issues), 'issues + pull requests', '') +
      statCard('Age', monthYear(repo.created), yearsSince(repo.created), '');

    renderChart();
    renderHistory();
  }

  function deltaText(delta) {
    if (!delta) return 'tracking new';
    return fmtDelta(delta.value) + ' · ' + delta.label;
  }

  function renderChart() {
    var repo = findRepo(state.openId);
    if (!repo || !chart) return;

    var entry = state.history[repo.id];
    var all = entry && Array.isArray(entry.points) ? entry.points : [];
    var cutoff = rangeCutoff(state.range);
    var points = all.filter(function (p) {
      return p.t >= cutoff;
    });

    var field = state.metric;
    var deltaMode = state.mode === 'delta';
    var label = field === 's' ? 'Stars' : 'Forks';
    var color = field === 's' ? '#f2b45b' : '#78e5b7';

    var values = points.map(function (p) {
      return { t: p.t, v: p[field] };
    });

    if (deltaMode && values.length > 1) {
      var base = values[0].v;
      values = values.map(function (p) {
        return { t: p.t, v: p.v - base };
      });
    }

    chart.setData({
      series: values.length
        ? [{ label: label + (deltaMode ? ' gained' : ''), color: color, points: values }]
        : [],
      empty: !all.length
        ? 'A snapshot is saved at every refresh (every 12 hours), so growth appears after the second one.'
        : 'No snapshots in this range yet — switch to “All tracked”.',
      formatValue: function (v) {
        return (deltaMode && v > 0 ? '+' : '') + fmtNum(v);
      },
      formatTime: function (t, span) {
        var date = new Date(t);
        if (span <= 2 * DAY) {
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      },
      ariaLabel: label + ' of ' + repo.name + ' over time'
    });

    var historyText;
    if (!all.length) {
      historyText = 'No history yet — the first snapshot is stored with the next sync.';
    } else if (all.length === 1) {
      historyText =
        'Recording since ' +
        dateTime(all[0].t) +
        ' · one snapshot saved on this device; growth appears after the next refresh.';
    } else if (!points.length) {
      historyText = 'No snapshots in this range — switch to “All tracked”.';
    } else {
      var change = points[points.length - 1][field] - points[0][field];
      historyText =
        points.length +
        ' snapshots · ' +
        dateTime(points[0].t) +
        ' → ' +
        dateTime(points[points.length - 1].t) +
        ' · ' +
        fmtDelta(change) +
        (field === 's' ? ' stars' : ' forks');
    }
    els.chartNote.textContent = historyText;
  }

  function renderHistory() {
    var repo = findRepo(state.openId);
    if (!repo) return;

    var entry = state.history[repo.id];
    var points = entry && Array.isArray(entry.points) ? entry.points.slice(-12).reverse() : [];

    if (!points.length) {
      els.historyList.innerHTML = '<li class="history-empty">Nothing recorded yet.</li>';
      return;
    }

    els.historyList.innerHTML = points
      .map(function (point, index) {
        var previous = points[index + 1];
        var starDiff = previous ? point.s - previous.s : 0;
        var forkDiff = previous ? point.f - previous.f : 0;
        return (
          '<li class="history-row">' +
          '<span class="history-time">' +
          escapeHtml(dateTime(point.t)) +
          '</span>' +
          '<span class="history-stars">' +
          fmtNum(point.s) +
          ' stars' +
          (starDiff ? ' <em>' + fmtDelta(starDiff) + '</em>' : '') +
          '</span>' +
          '<span class="history-forks">' +
          fmtNum(point.f) +
          ' forks' +
          (forkDiff ? ' <em>' + fmtDelta(forkDiff) + '</em>' : '') +
          '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  /* -------------------------- html builders --------------------------- */

  function repoRowHtml(repo, index) {
    var language = repo.lang
      ? '<span class="meta-item"><i class="lang-dot" style="background:' +
        languageColor(repo.lang) +
        '"></i>' +
        escapeHtml(repo.lang) +
        '</span>'
      : '';

    return (
      '<li class="repo" data-id="' +
      escapeHtml(repo.id) +
      '">' +
      '<span class="rank">' +
      (index + 1) +
      '</span>' +
      '<div class="repo-main">' +
      '<div class="repo-head">' +
      '<a class="repo-name" href="' +
      escapeHtml(repo.url) +
      '" target="_blank" rel="noopener noreferrer">' +
      '<span class="repo-owner">' +
      escapeHtml(repo.owner) +
      '/</span>' +
      escapeHtml(shortName(repo.name)) +
      '</a>' +
      (repo.archived ? '<span class="tag">archived</span>' : '') +
      '</div>' +
      '<p class="repo-desc">' +
      escapeHtml(repo.desc || 'No description provided.') +
      '</p>' +
      '<div class="repo-meta">' +
      language +
      '<span class="meta-item">updated ' +
      escapeHtml(timeAgo(repo.pushed)) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="repo-stats">' +
      '<div class="stat stat-stars">' +
      STAR_SVG +
      '<span>' +
      fmtNum(repo.stars) +
      '</span></div>' +
      '<div class="stat stat-forks">' +
      FORK_SVG +
      '<span>' +
      fmtNum(repo.forks) +
      '</span></div>' +
      growthChip(repo) +
      '</div>' +
      '</li>'
    );
  }

  function growthChip(repo) {
    if (state.tab === 'trending') {
      var perDay = Math.round(repo.stars / daysSince(repo.created));
      return '<span class="chip chip-up">+' + fmtNum(perDay) + '/day</span>';
    }

    var delta = computeDelta(repo.id, 7 * DAY, 's');
    if (!delta) return '<span class="chip chip-idle">new</span>';
    if (!delta.value) return '<span class="chip">0 · ' + escapeHtml(delta.label) + '</span>';
    return (
      '<span class="chip ' +
      (delta.value > 0 ? 'chip-up' : 'chip-down') +
      '">' +
      fmtDelta(delta.value) +
      ' <em>' +
      escapeHtml(delta.label) +
      '</em></span>'
    );
  }

  function statCard(label, value, sub, tone) {
    return (
      '<div class="stat-card' +
      (tone ? ' tone-' + tone : '') +
      '">' +
      '<span class="stat-label">' +
      escapeHtml(label) +
      '</span>' +
      '<strong class="stat-value">' +
      escapeHtml(value) +
      '</strong>' +
      '<span class="stat-sub">' +
      escapeHtml(sub) +
      '</span>' +
      '</div>'
    );
  }

  function metaHtml(repo) {
    var parts = [];
    if (repo.lang) {
      parts.push(
        '<span class="meta-item"><i class="lang-dot" style="background:' +
          languageColor(repo.lang) +
          '"></i>' +
          escapeHtml(repo.lang) +
          '</span>'
      );
    }
    if (repo.license) {
      parts.push('<span class="meta-item">' + escapeHtml(repo.license) + '</span>');
    }
    parts.push('<span class="meta-item">created ' + escapeHtml(monthYear(repo.created)) + '</span>');
    if (repo.pushed) {
      parts.push('<span class="meta-item">pushed ' + escapeHtml(timeAgo(repo.pushed)) + '</span>');
    }
    return parts.join('');
  }

  function skeletonHtml() {
    var row =
      '<li class="repo skeleton">' +
      '<span class="rank">·</span>' +
      '<div class="repo-main">' +
      '<div class="sk-line sk-title"></div>' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line sk-short"></div>' +
      '</div>' +
      '<div class="repo-stats"><div class="sk-line sk-stat"></div></div>' +
      '</li>';
    var out = '';
    for (var i = 0; i < 8; i++) out += row;
    return out;
  }

  /* ----------------------------- actions ------------------------------ */

  function syncSegmented(selector, attr, value) {
    Array.prototype.forEach.call(document.querySelectorAll(selector + ' button'), function (btn) {
      var active = btn.getAttribute(attr) === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var active = tab.getAttribute('data-tab') === state.tab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  // Brings back the tab, filter text, open repository, chart controls and
  // scroll offsets saved by the previous visit.
  function restoreUi() {
    var ui = Store.getUi() || {};

    if (ui.tab === 'trending' || ui.tab === 'alltime') state.tab = ui.tab;
    if (typeof ui.query === 'string') state.query = ui.query;
    if (ui.metric === 's' || ui.metric === 'f') state.metric = ui.metric;
    if (ui.mode === 'level' || ui.mode === 'delta') state.mode = ui.mode;
    if (['all', '24h', '7d', '30d', '90d'].indexOf(ui.range) !== -1) state.range = ui.range;
    if (ui.openId) state.openId = String(ui.openId);
    if (ui.scroll && typeof ui.scroll === 'object') {
      state.scroll = {
        list: Number(ui.scroll.list) || 0,
        detail: Number(ui.scroll.detail) || 0
      };
    }

    els.search.value = state.query;
    els.rangeSelect.value = state.range;
    syncSegmented('#metric-toggle', 'data-metric', state.metric);
    syncSegmented('#mode-toggle', 'data-mode', state.mode);
    syncTabs();
  }

  function persistUi() {
    Store.saveUi({
      tab: state.tab,
      query: state.query,
      openId: state.openId,
      metric: state.metric,
      mode: state.mode,
      range: state.range,
      scroll: state.scroll
    });
  }

  function schedulePersist() {
    if (uiSaveTimer) return;
    uiSaveTimer = global.setTimeout(function () {
      uiSaveTimer = 0;
      persistUi();
    }, 250);
  }

  function currentScrollY() {
    return global.scrollY || (document.documentElement && document.documentElement.scrollTop) || 0;
  }

  function viewKey() {
    return state.openId ? 'detail' : 'list';
  }

  function scrollToView(which) {
    var y = (state.scroll && state.scroll[which]) || 0;
    if (global.scrollTo) global.scrollTo({ top: y, behavior: 'smooth' });
  }

  function restoreScroll() {
    var y = (state.scroll && state.scroll[viewKey()]) || 0;
    if (y && global.scrollTo) global.scrollTo(0, y);
  }

  function openDetail(id) {
    state.openId = String(id);
    render();
    persistUi();
    scrollToView('detail');
  }

  function closeDetail() {
    state.openId = null;
    render();
    persistUi();
    scrollToView('list');
  }

  function openSettings() {
    els.tokenInput.value = state.settings.token || '';
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
  }

  function closeSettings() {
    if (typeof els.dialog.close === 'function') els.dialog.close();
    else els.dialog.removeAttribute('open');
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    state.lastAttempt = Date.now();
    state.error = null;
    render();

    try {
      var payload = await Api.fetchDashboard();
      var previous = state.cache;

      state.warnings = payload.errors || [];
      state.cache = {
        fetchedAt: payload.fetchedAt,
        starThreshold: Api.STAR_THRESHOLD,
        allTime: payload.allTime || (previous && previous.allTime) || [],
        trending: payload.trending || (previous && previous.trending) || [],
        trendingSince: payload.trendingSince || (previous && previous.trendingSince) || null
      };

      Store.saveCache(state.cache);
      state.history = Store.record(state.cache);

      try {
        state.rate = await Api.getRateLimit();
      } catch (rateError) {
        state.rate = null;
      }
    } catch (err) {
      state.error = err;
      state.warnings = [];
    }

    state.refreshing = false;
    render();
  }

  /*
   * A refresh is due when the cache is older than the refresh interval, or
   * when it was written before the current star threshold, so an older cache
   * cannot hide repositories that now belong in the list.
   */
  function isDue() {
    if (!state.cache) return true;
    if (state.cache.starThreshold !== Api.STAR_THRESHOLD) return true;
    return Date.now() - state.cache.fetchedAt >= Store.REFRESH_MS;
  }

  function tick() {
    renderChrome();
    if (isDue() && !state.refreshing && Date.now() - state.lastAttempt > RETRY_MS) {
      refresh();
    }
  }

  /* ------------------------------- boot ------------------------------- */

  function init() {
    els.lastUpdated = $('last-updated');
    els.countdown = $('countdown');
    els.quota = $('quota');
    els.refreshBtn = $('refresh-btn');
    els.liveDot = $('live-dot');
    els.trackedCount = $('tracked-count');
    els.banner = $('banner');
    els.search = $('search');
    els.listCount = $('list-count');
    els.listNote = $('list-note');
    els.listView = $('list-view');
    els.repoList = $('repo-list');
    els.detailView = $('detail');
    els.dAvatar = $('d-avatar');
    els.dName = $('d-name');
    els.dDesc = $('d-desc');
    els.dMeta = $('d-meta');
    els.dStats = $('detail-stats');
    els.chartNote = $('chart-note');
    els.historyList = $('history-list');
    els.rangeSelect = $('range-select');
    els.dialog = $('settings-dialog');
    els.tokenInput = $('token-input');

    chart = Chart.create($('chart'));

    els.refreshBtn.addEventListener('click', function () {
      refresh();
    });

    $('settings').addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', closeSettings);
    $('detail-back').addEventListener('click', closeDetail);

    $('settings-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      state.settings = { token: els.tokenInput.value.trim() };
      Store.saveSettings(state.settings);
      Api.setToken(state.settings.token);
      closeSettings();
      refresh();
    });

    $('clear-history').addEventListener('click', function () {
      if (!global.confirm('Delete the snapshot history stored on this device?')) return;
      Store.clearSeries();
      state.history = {};
      render();
    });

    els.search.addEventListener('input', function () {
      state.query = els.search.value;
      if (!state.openId) renderList();
      schedulePersist();
    });

    var tabs = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        state.tab = tab.getAttribute('data-tab');
        state.openId = null;
        syncTabs();
        render();
        persistUi();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('#metric-toggle button'), function (btn) {
      btn.addEventListener('click', function () {
        state.metric = btn.getAttribute('data-metric');
        syncSegmented('#metric-toggle', 'data-metric', state.metric);
        renderChart();
        persistUi();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('#mode-toggle button'), function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.getAttribute('data-mode');
        syncSegmented('#mode-toggle', 'data-mode', state.mode);
        renderChart();
        persistUi();
      });
    });

    els.rangeSelect.addEventListener('change', function () {
      state.range = els.rangeSelect.value;
      renderChart();
      persistUi();
    });

    global.addEventListener(
      'scroll',
      function () {
        state.scroll[viewKey()] = currentScrollY();
        schedulePersist();
      },
      { passive: true }
    );

    els.repoList.addEventListener('click', function (ev) {
      var target = ev.target;
      if (!target || !target.closest) return;
      if (target.closest('a')) return;
      var row = target.closest('.repo');
      if (!row) return;
      openDetail(row.getAttribute('data-id'));
    });
  }

  function boot() {
    init();

    state.settings = Store.getSettings();
    Api.setToken(state.settings.token);
    restoreUi();
    state.cache = Store.getCache();
    state.history = Store.getSeries();

    render();
    restoreScroll();

    if (isDue()) refresh();

    global.setInterval(tick, 30000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });

    global.addEventListener('online', tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
