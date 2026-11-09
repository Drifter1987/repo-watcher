/*
 * Repo Watcher — GitHub REST API client.
 * Three or four search requests per refresh carry everything the lists need
 * (stars, forks, language, created/pushed dates): the paginated 100k+ star
 * set and the trending query. A full update therefore costs little against
 * the free, unauthenticated rate limit.
 */
(function (global) {
  'use strict';

  var API_ROOT = 'https://api.github.com';
  var TRENDING_DAYS = 7;
  var TRENDING_LIMIT = 20;
  var STAR_THRESHOLD = 100000;
  var PAGE_SIZE = 100; // GitHub's maximum page size for search
  var MAX_PAGES = 5;
  var TOP_QUERY = 'stars:>=' + STAR_THRESHOLD + ' archived:false';
  var MIN_TRENDING_STARS = 5;

  var token = '';

  function setToken(value) {
    token = String(value || '').trim();
  }

  function makeError(message, name, resetAt) {
    var err = new Error(message);
    err.name = name || 'GitHubError';
    if (resetAt) err.resetAt = resetAt;
    return err;
  }

  async function request(path, params) {
    var url = API_ROOT + path;
    if (params) {
      var qs = new URLSearchParams();
      Object.keys(params).forEach(function (key) {
        if (params[key] !== null && params[key] !== undefined) {
          qs.set(key, params[key]);
        }
      });
      var qsText = qs.toString();
      if (qsText) url += '?' + qsText;
    }

    var headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = 'Bearer ' + token;

    var response;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, 15000)
      : 0;

    try {
      response = await fetch(url, {
        headers: headers,
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      throw makeError(
        err && err.name === 'AbortError'
          ? 'GitHub did not answer in time. Check the connection, then refresh.'
          : 'Could not reach api.github.com. Check the connection, then refresh.',
        'NetworkError'
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      var payload = null;
      try {
        payload = await response.json();
      } catch (err) {
        payload = null;
      }
      var message = (payload && payload.message) || response.statusText || 'Request failed';
      var remaining = response.headers.get('x-ratelimit-remaining');
      var resetHeader = response.headers.get('x-ratelimit-reset');
      var resetAt = resetHeader ? Number(resetHeader) * 1000 : 0;
      var limited =
        (response.status === 403 || response.status === 429) &&
        (remaining === '0' || /rate limit/i.test(message));

      if (limited) {
        var when = resetAt
          ? ' it resets at ' +
            new Date(resetAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })
          : '';
        throw makeError(
          'GitHub API rate limit reached —' +
            when +
            '. Unauthenticated calls allow 10 searches a minute; add a token in settings for a much higher limit.',
          'RateLimitError',
          resetAt
        );
      }

      throw makeError('GitHub API error ' + response.status + ': ' + message, 'GitHubError');
    }

    return response.json();
  }

  function normalize(item) {
    return {
      id: item.id,
      name: item.full_name,
      owner: item.owner ? item.owner.login : '',
      avatar: item.owner ? item.owner.avatar_url : '',
      desc: item.description || '',
      stars: item.stargazers_count || 0,
      forks: item.forks_count || 0,
      issues: item.open_issues_count || 0,
      lang: item.language || '',
      license: item.license ? item.license.spdx_id : '',
      created: item.created_at,
      pushed: item.pushed_at,
      url: item.html_url,
      archived: !!item.archived
    };
  }

  async function searchRepositories(query, perPage, page) {
    var data = await request('/search/repositories', {
      q: query,
      sort: 'stars',
      order: 'desc',
      per_page: perPage,
      page: page || 1
    });
    return (data.items || []).map(normalize);
  }

  /*
   * Every repository at or above STAR_THRESHOLD, ranked by stars. GitHub
   * returns at most 1000 search results, so the page loop is bounded; a
   * failure after the first page keeps whatever has been collected already.
   */
  async function fetchAllStarred() {
    var all = [];
    for (var page = 1; page <= MAX_PAGES; page++) {
      var batch;
      try {
        batch = await searchRepositories(TOP_QUERY, PAGE_SIZE, page);
      } catch (err) {
        if (page === 1) throw err;
        break;
      }
      all = all.concat(batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return all;
  }

  function trendingSince() {
    return new Date(Date.now() - TRENDING_DAYS * 86400000).toISOString().slice(0, 10);
  }

  async function fetchDashboard() {
    var since = trendingSince();
    var trendingQuery =
      'created:>=' + since + ' stars:>=' + MIN_TRENDING_STARS + ' archived:false';

    var settled = await Promise.allSettled([
      fetchAllStarred(),
      searchRepositories(trendingQuery, TRENDING_LIMIT)
    ]);

    var allTime = settled[0].status === 'fulfilled' ? settled[0].value : null;
    var trending = settled[1].status === 'fulfilled' ? settled[1].value : null;
    var errors = settled
      .filter(function (result) {
        return result.status === 'rejected';
      })
      .map(function (result) {
        return result.reason && result.reason.message
          ? result.reason.message
          : 'Could not load one of the lists.';
      });

    if (!allTime && !trending) {
      var reason = settled[0].reason || settled[1].reason;
      throw reason || makeError('GitHub did not return any repositories.', 'GitHubError');
    }

    return {
      fetchedAt: Date.now(),
      allTime: allTime,
      trending: trending,
      trendingSince: since,
      errors: errors
    };
  }

  // /rate_limit does not count against the quota itself.
  async function getRateLimit() {
    var data = await request('/rate_limit');
    return data && data.resources ? data.resources : null;
  }

  global.GHW = global.GHW || {};
  global.GHW.api = {
    STAR_THRESHOLD: STAR_THRESHOLD,
    TRENDING_DAYS: TRENDING_DAYS,
    TRENDING_LIMIT: TRENDING_LIMIT,
    setToken: setToken,
    fetchDashboard: fetchDashboard,
    getRateLimit: getRateLimit
  };
})(window);
