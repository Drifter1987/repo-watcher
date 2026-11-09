/*
 * Repo Watcher — dependency-free SVG line chart with a crosshair.
 * One instance per host element; call setData() whenever the series change.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  function compact(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function localTime(t) {
    return new Date(t).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function create(host) {
    var frame = document.createElement('div');
    frame.className = 'chart-frame';

    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;

    host.appendChild(frame);
    host.appendChild(tip);

    var cfg = {
      height: 250,
      series: [],
      empty: 'No data yet',
      formatValue: compact,
      formatTime: function (t) {
        return new Date(t).toLocaleDateString();
      },
      ariaLabel: 'Growth chart'
    };

    var measuredWidth = 0;
    var frameRequest = 0;

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    function scheduleDraw() {
      if (frameRequest) return;
      frameRequest = global.requestAnimationFrame(function () {
        frameRequest = 0;
        draw();
      });
    }

    function setData(next) {
      if (next) {
        Object.keys(next).forEach(function (key) {
          cfg[key] = next[key];
        });
      }
      draw();
    }

    function draw() {
      clear(frame);
      tip.hidden = true;

      var series = (cfg.series || []).filter(function (s) {
        return s && s.points && s.points.length;
      });

      measuredWidth = host.clientWidth || 320;
      var width = Math.max(260, measuredWidth);
      var height = cfg.height;

      if (!series.length) {
        var message = document.createElement('p');
        message.className = 'chart-empty';
        message.style.height = height + 'px';
        message.textContent = cfg.empty || 'No data yet';
        frame.appendChild(message);
        return;
      }

      var pad = { top: 18, right: 14, bottom: 26, left: 46 };
      var innerW = width - pad.left - pad.right;
      var innerH = height - pad.top - pad.bottom;

      var xs = [];
      var ys = [];
      series.forEach(function (s) {
        s.points.forEach(function (p) {
          xs.push(p.t);
          ys.push(p.v);
        });
      });

      var xMin = Math.min.apply(null, xs);
      var xMax = Math.max.apply(null, xs);
      var rawMin = Math.min.apply(null, ys);
      var yMin = rawMin;
      var yMax = Math.max.apply(null, ys);

      if (xMax - xMin < 1000) {
        xMin -= 12 * 3600000;
        xMax += 12 * 3600000;
      }

      var span = yMax - yMin;
      if (span <= 0) span = Math.max(1, Math.abs(yMax) * 0.02);
      yMin -= span * 0.18;
      yMax += span * 0.14;
      if (rawMin >= 0 && yMin < 0) yMin = 0;

      function sx(t) {
        return pad.left + ((t - xMin) / (xMax - xMin)) * innerW;
      }

      function sy(v) {
        return pad.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;
      }

      var svg = svgEl('svg', {
        width: width,
        height: height,
        viewBox: '0 0 ' + width + ' ' + height,
        role: 'img',
        'aria-label': cfg.ariaLabel
      });
      svg.style.touchAction = 'pan-y';

      // horizontal grid and value labels
      var rows = 4;
      for (var i = 0; i <= rows; i++) {
        var value = yMin + ((yMax - yMin) * i) / rows;
        var gy = sy(value);
        svg.appendChild(
          svgEl('line', {
            x1: pad.left,
            x2: width - pad.right,
            y1: gy,
            y2: gy,
            stroke: 'rgba(255,255,255,0.07)',
            'stroke-width': 1
          })
        );
        var tickLabel = svgEl('text', {
          x: pad.left - 8,
          y: gy + 3.5,
          'text-anchor': 'end',
          fill: 'rgba(147,161,177,0.85)',
          'font-size': 10
        });
        tickLabel.textContent = cfg.formatValue(value);
        svg.appendChild(tickLabel);
      }

      // time labels
      var cols = 3;
      for (var j = 0; j <= cols; j++) {
        var t = xMin + ((xMax - xMin) * j) / cols;
        var tx = sx(t);
        var anchor = j === 0 ? 'start' : j === cols ? 'end' : 'middle';
        var timeLabel = svgEl('text', {
          x: tx,
          y: height - 8,
          'text-anchor': anchor,
          fill: 'rgba(147,161,177,0.85)',
          'font-size': 10
        });
        timeLabel.textContent = cfg.formatTime(t, xMax - xMin);
        svg.appendChild(timeLabel);
      }

      // series
      series.forEach(function (s, index) {
        var points = s.points;
        var color = s.color || '#78e5b7';
        var line = '';
        points.forEach(function (p, k) {
          line += (k === 0 ? 'M' : 'L') + sx(p.t).toFixed(1) + ' ' + sy(p.v).toFixed(1) + ' ';
        });

        if (index === 0 && points.length > 1) {
          var area =
            line +
            'L' +
            sx(points[points.length - 1].t).toFixed(1) +
            ' ' +
            (pad.top + innerH) +
            ' L' +
            sx(points[0].t).toFixed(1) +
            ' ' +
            (pad.top + innerH) +
            ' Z';
          svg.appendChild(
            svgEl('path', { d: area, fill: color, 'fill-opacity': 0.12, stroke: 'none' })
          );
        }

        svg.appendChild(
          svgEl('path', {
            d: line.trim(),
            fill: 'none',
            stroke: color,
            'stroke-width': 2,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round'
          })
        );

        var lastPoint = points[points.length - 1];
        svg.appendChild(
          svgEl('circle', { cx: sx(lastPoint.t), cy: sy(lastPoint.v), r: 2.6, fill: color })
        );
      });

      // A single observation has no line to draw, so mark its level instead of
      // leaving a lone dot floating in the frame.
      var pointCount = 0;
      series.forEach(function (s) {
        pointCount += s.points.length;
      });
      if (pointCount === 1) {
        var onlyPoint = series[0].points[0];
        svg.appendChild(
          svgEl('line', {
            x1: pad.left,
            x2: width - pad.right,
            y1: sy(onlyPoint.v),
            y2: sy(onlyPoint.v),
            stroke: series[0].color || '#78e5b7',
            'stroke-width': 1,
            'stroke-dasharray': '4 4',
            opacity: 0.45
          })
        );
      }

      // crosshair, markers and hit area
      var crosshair = svgEl('line', {
        x1: 0,
        x2: 0,
        y1: pad.top,
        y2: pad.top + innerH,
        stroke: 'rgba(255,255,255,0.3)',
        'stroke-width': 1,
        'stroke-dasharray': '3 3',
        opacity: 0
      });
      svg.appendChild(crosshair);

      var markers = series.map(function (s) {
        var dot = svgEl('circle', {
          cx: 0,
          cy: 0,
          r: 4,
          fill: s.color || '#78e5b7',
          stroke: '#0b0f14',
          'stroke-width': 2,
          opacity: 0
        });
        svg.appendChild(dot);
        return dot;
      });

      var hit = svgEl('rect', {
        x: pad.left,
        y: pad.top,
        width: innerW,
        height: innerH,
        fill: 'transparent',
        style: 'cursor: crosshair'
      });
      svg.appendChild(hit);

      function hideTip() {
        crosshair.setAttribute('opacity', '0');
        markers.forEach(function (dot) {
          dot.setAttribute('opacity', '0');
        });
        tip.hidden = true;
      }

      function positionTip(clientX) {
        var rect = svg.getBoundingClientRect();
        var scale = rect.width ? width / rect.width : 1;
        var px = (clientX - rect.left) * scale;

        var base = series[0].points;
        var best = 0;
        var bestDist = Infinity;
        for (var k = 0; k < base.length; k++) {
          var distance = Math.abs(sx(base[k].t) - px);
          if (distance < bestDist) {
            bestDist = distance;
            best = k;
          }
        }

        var anchorPoint = base[best];
        var cx = sx(anchorPoint.t);
        crosshair.setAttribute('x1', cx);
        crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('opacity', 1);

        series.forEach(function (s, index) {
          var p = s.points[Math.min(best, s.points.length - 1)];
          markers[index].setAttribute('cx', sx(p.t));
          markers[index].setAttribute('cy', sy(p.v));
          markers[index].setAttribute('opacity', 1);
        });

        var html = '<div class="chart-tip-time">' + escapeHtml(localTime(anchorPoint.t)) + '</div>';
        series.forEach(function (s) {
          var p = s.points[Math.min(best, s.points.length - 1)];
          html +=
            '<div class="chart-tip-row">' +
            '<i style="background:' +
            (s.color || '#78e5b7') +
            '"></i>' +
            '<span>' +
            escapeHtml(s.label || '') +
            '</span>' +
            '<b>' +
            escapeHtml(cfg.formatValue(p.v)) +
            '</b>' +
            '</div>';
        });

        tip.innerHTML = html;
        tip.hidden = false;

        var hostWidth = host.clientWidth;
        var left = cx - tip.offsetWidth / 2;
        left = Math.max(4, Math.min(left, Math.max(4, hostWidth - tip.offsetWidth - 4)));
        tip.style.left = left + 'px';

        var top = sy(anchorPoint.v) - tip.offsetHeight - 12;
        if (top < 4) top = sy(anchorPoint.v) + 14;
        tip.style.top = top + 'px';
      }

      hit.addEventListener('pointerdown', function (ev) {
        positionTip(ev.clientX);
      });
      hit.addEventListener('pointermove', function (ev) {
        positionTip(ev.clientX);
      });
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('pointercancel', hideTip);

      frame.appendChild(svg);
    }

    if (typeof global.ResizeObserver === 'function') {
      var observer = new global.ResizeObserver(function () {
        var w = host.clientWidth;
        if (Math.abs(w - measuredWidth) > 1) scheduleDraw();
      });
      observer.observe(host);
    } else {
      global.addEventListener('resize', scheduleDraw);
    }

    return { setData: setData, redraw: scheduleDraw };
  }

  global.GHW = global.GHW || {};
  global.GHW.chart = { create: create };
})(window);
