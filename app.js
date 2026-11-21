/**
 * app.js
 * Interactive D3 SVG complex plane for exploring the Riemann Hypothesis:
 *   - Dirichlet partial sums:  sum_{k=1}^n k^{-s}
 *   - Euler product of primes: prod_{j=1}^n (1 - p_j^{-s})^{-1}
 *   - Analytic continuation:   zeta(s)
 *   - Drag-to-trace input s(t) and output zeta(s(t)) simultaneously
 */
(function () {
  'use strict';

  const ZM = window.ZetaMath;

  // DOM references
  const svgEl = document.getElementById('plane');
  const svg = d3.select(svgEl);

  const elValS = document.getElementById('val-s');
  const elValZeta = document.getElementById('val-zeta');
  const elLandmarkRow = document.getElementById('landmark-row');
  const elValLandmark = document.getElementById('val-landmark');
  const elPinBadge = document.getElementById('pin-badge');

  const btnToggleDirichlet = document.getElementById('toggle-dirichlet');
  const btnToggleEuler = document.getElementById('toggle-euler');
  const elStatusDirichlet = document.getElementById('status-dirichlet');
  const elStatusEuler = document.getElementById('status-euler');

  const sliderSteps = document.getElementById('steps-slider');
  const elStepsValue = document.getElementById('steps-value');

  const elTraceActions = document.getElementById('trace-actions');
  const btnClearTrace = document.getElementById('btn-clear-trace');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnReset = document.getElementById('btn-reset');

  // Application state
  const DEFAULT_VIEW = {
    centerRe: 0,
    centerIm: 0,
    halfHeight: 16.5 // Shows origin centered plus first pair of non-trivial zeros (+/- 14.135i)
  };

  const state = {
    width: window.innerWidth,
    height: window.innerHeight,
    view: { ...DEFAULT_VIEW },
    currentS: { re: 1.05, im: 0.45 },
    currentLandmark: null,
    pinned: false,
    maxSteps: 250,
    showDirichlet: true,
    showEuler: true,
    // Trace state (drag input -> output curve)
    inputTrace: [],
    outputTrace: [], // Array of {re, im} | null (null breaks path across poles/overflow)
    // Pointer interaction state
    pointerDown: false,
    pointerStartPx: null,
    isDraggingTrace: false,
    isPanning: false,
    panStartView: null
  };

  // D3 Scales (always 1:1 aspect ratio)
  let xScale = d3.scaleLinear();
  let yScale = d3.scaleLinear();
  let pixelsPerUnit = 24;

  // SVG Layer hierarchy (bottom to top)
  const gGrid = svg.append('g').attr('class', 'layer-grid');
  const gGridMinor = gGrid.append('g').attr('class', 'grid-minor');
  const gGridMajor = gGrid.append('g').attr('class', 'grid-major');
  const gStrip = svg.append('g').attr('class', 'layer-strip');
  const gAxes = svg.append('g').attr('class', 'layer-axes');
  const gLandmarks = svg.append('g').attr('class', 'layer-landmarks');
  const gTraces = svg.append('g').attr('class', 'layer-traces');
  const gSpirals = svg.append('g').attr('class', 'layer-spirals');
  const gMarkers = svg.append('g').attr('class', 'layer-markers');

  // Persistent dynamic SVG elements
  const pathTraceInput = gTraces.append('path').attr('class', 'trace-input');
  const pathTraceOutput = gTraces.append('path').attr('class', 'trace-output');

  const pathLeaderDirichlet = gSpirals.append('path').attr('class', 'spiral-leader dirichlet');
  const pathLeaderEuler = gSpirals.append('path').attr('class', 'spiral-leader euler');
  const pathDirichlet = gSpirals.append('path').attr('class', 'spiral-dirichlet');
  const pathEuler = gSpirals.append('path').attr('class', 'spiral-euler');
  const gDotsDirichlet = gSpirals.append('g').attr('class', 'dots-dirichlet');
  const gDotsEuler = gSpirals.append('g').attr('class', 'dots-euler');

  // Zeta target reticle
  const gZetaMarker = gMarkers.append('g').attr('class', 'zeta-marker');
  gZetaMarker.append('circle').attr('class', 'zeta-ring').attr('r', 5.5);
  gZetaMarker.append('circle').attr('class', 'zeta-core').attr('r', 2.1);
  const labelZeta = gZetaMarker
    .append('text')
    .attr('class', 'zeta-label')
    .attr('dx', 9)
    .attr('dy', -7)
    .text('ζ(s)');

  // Input cursor marker
  const gCursorMarker = gMarkers.append('g').attr('class', 'cursor-marker');
  gCursorMarker.append('circle').attr('class', 'cursor-halo').attr('r', 9);
  gCursorMarker.append('circle').attr('class', 'cursor-dot').attr('r', 3.4);
  const labelCursor = gCursorMarker
    .append('text')
    .attr('class', 'cursor-label')
    .attr('dx', 9)
    .attr('dy', -7)
    .text('s');

  // Line generators
  const spiralLine = d3
    .line()
    .x((d) => xScale(d.re))
    .y((d) => yScale(d.im));

  const traceLine = d3
    .line()
    .defined((d) => d !== null && isFinite(d.re) && isFinite(d.im))
    .x((d) => xScale(d.re))
    .y((d) => yScale(d.im));

  // ---------- Coordinate & Formatting Helpers ----------

  function updateScales() {
    state.width = svgEl.clientWidth || window.innerWidth;
    state.height = svgEl.clientHeight || window.innerHeight;
    svg.attr('viewBox', `0 0 ${state.width} ${state.height}`);

    pixelsPerUnit = state.height / (2 * state.view.halfHeight);
    const halfWidth = state.width / (2 * pixelsPerUnit);

    xScale
      .domain([state.view.centerRe - halfWidth, state.view.centerRe + halfWidth])
      .range([0, state.width]);
    yScale
      .domain([state.view.centerIm - state.view.halfHeight, state.view.centerIm + state.view.halfHeight])
      .range([state.height, 0]);
  }

  function screenToComplex(px, py) {
    return {
      re: xScale.invert(px),
      im: yScale.invert(py)
    };
  }

  function formatComplex(c, digits) {
    const d = digits !== undefined ? digits : 3;
    const reVal = Math.abs(c.re) < 5e-7 ? 0 : c.re;
    const imVal = Math.abs(c.im) < 5e-7 ? 0 : c.im;
    const sign = imVal < 0 ? ' − ' : ' + ';
    const reStr = reVal < 0 ? '−' + Math.abs(reVal).toFixed(d) : reVal.toFixed(d);
    const imStr = Math.abs(imVal).toFixed(d) + 'i';
    return reStr + sign + imStr;
  }

  function formatTick(v, isImag) {
    if (Math.abs(v) < 1e-9) return '0';
    const abs = Math.abs(v);
    let numStr;
    if (abs >= 10 || Number.isInteger(v)) {
      numStr = String(Math.round(v * 1e6) / 1e6);
    } else {
      numStr = String(Number(v.toFixed(2)));
    }
    const clean = v < 0 ? '−' + numStr.replace('-', '') : numStr;
    if (!isImag) return clean;
    if (clean === '1') return 'i';
    if (clean === '−1') return '−i';
    return clean + 'i';
  }

  // ---------- Static / Viewport Layer Rendering ----------

  function renderStaticPlane() {
    const [xMin, xMax] = xScale.domain();
    const [yMin, yMax] = yScale.domain();

    // Target ~80px between major grid lines
    const approxXTicks = Math.max(4, Math.round(state.width / 85));
    const approxYTicks = Math.max(4, Math.round(state.height / 85));
    const majorX = xScale.ticks(approxXTicks);
    const majorY = yScale.ticks(approxYTicks);

    // Derive minor grid lines (subdivide each major step)
    const stepX = majorX.length >= 2 ? majorX[1] - majorX[0] : 1;
    const stepY = majorY.length >= 2 ? majorY[1] - majorY[0] : 1;
    const minorStepX = stepX / (Math.round(stepX * 1000) % 5 === 0 ? 5 : 2);
    const minorStepY = stepY / (Math.round(stepY * 1000) % 5 === 0 ? 5 : 2);

    const minorX = [];
    if (minorStepX * pixelsPerUnit >= 12) {
      const startX = Math.floor(xMin / minorStepX) * minorStepX;
      for (let x = startX; x <= xMax + minorStepX * 0.5; x += minorStepX) {
        minorX.push(x);
      }
    }
    const minorY = [];
    if (minorStepY * pixelsPerUnit >= 12) {
      const startY = Math.floor(yMin / minorStepY) * minorStepY;
      for (let y = startY; y <= yMax + minorStepY * 0.5; y += minorStepY) {
        minorY.push(y);
      }
    }

    // Minor grid
    gGridMinor
      .selectAll('line.vx')
      .data(minorX)
      .join('line')
      .attr('class', 'vx')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', state.height);

    gGridMinor
      .selectAll('line.vy')
      .data(minorY)
      .join('line')
      .attr('class', 'vy')
      .attr('x1', 0)
      .attr('x2', state.width)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    // Major grid
    gGridMajor
      .selectAll('line.mx')
      .data(majorX)
      .join('line')
      .attr('class', 'mx')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', state.height);

    gGridMajor
      .selectAll('line.my')
      .data(majorY)
      .join('line')
      .attr('class', 'my')
      .attr('x1', 0)
      .attr('x2', state.width)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    // Critical strip (0 <= Re(s) <= 1) & critical line (Re(s) = 1/2)
    gStrip.selectAll('*').remove();

    const stripX0 = xScale(0);
    const stripX1 = xScale(1);
    if (stripX1 >= 0 && stripX0 <= state.width) {
      gStrip
        .append('rect')
        .attr('class', 'critical-strip')
        .attr('x', Math.max(0, stripX0))
        .attr('y', 0)
        .attr('width', Math.max(0, Math.min(state.width, stripX1) - Math.max(0, stripX0)))
        .attr('height', state.height);
    }

    // Convergence boundary Re(s) = 1
    if (stripX1 >= -2 && stripX1 <= state.width + 2) {
      gStrip
        .append('line')
        .attr('class', 'convergence-line')
        .attr('x1', stripX1)
        .attr('x2', stripX1)
        .attr('y1', 0)
        .attr('y2', state.height);

      if (stripX1 - stripX0 >= 32) {
        gStrip
          .append('text')
          .attr('class', 'landmark-label')
          .attr('x', stripX1 + 6)
          .attr('y', state.height - 16)
          .text('Re(s) = 1');
      }
    }

    // Critical line Re(s) = 1/2
    const critX = xScale(0.5);
    if (critX >= -2 && critX <= state.width + 2) {
      gStrip
        .append('line')
        .attr('class', 'critical-line')
        .attr('x1', critX)
        .attr('x2', critX)
        .attr('y1', 0)
        .attr('y2', state.height);

      gStrip
        .append('text')
        .attr('class', 'landmark-label-title')
        .attr('x', critX + 7)
        .attr('y', 22)
        .text('Critical line  Re(s) = ½');
    }

    // Axes & tick labels
    gAxes.selectAll('*').remove();

    const originX = xScale(0);
    const originY = yScale(0);

    // Real axis
    if (originY >= -2 && originY <= state.height + 2) {
      gAxes
        .append('line')
        .attr('class', 'axis-line')
        .attr('x1', 0)
        .attr('x2', state.width)
        .attr('y1', originY)
        .attr('y2', originY);

      gAxes
        .append('text')
        .attr('class', 'axis-name')
        .attr('x', state.width - 26)
        .attr('y', Math.max(16, Math.min(state.height - 10, originY - 7)))
        .text('Re');
    }

    // Imaginary axis
    if (originX >= -2 && originX <= state.width + 2) {
      gAxes
        .append('line')
        .attr('class', 'axis-line')
        .attr('x1', originX)
        .attr('x2', originX)
        .attr('y1', 0)
        .attr('y2', state.height);

      gAxes
        .append('text')
        .attr('class', 'axis-name')
        .attr('x', Math.max(10, Math.min(state.width - 26, originX - 22)))
        .attr('y', 22)
        .text('Im');
    }

    // Real axis tick labels (pinned cleanly inside viewport if real axis is scrolled off)
    const tickYPos = Math.max(18, Math.min(state.height - 10, originY + 14));
    for (const x of majorX) {
      if (Math.abs(x) < 1e-9) continue;
      const px = xScale(x);
      if (px < 24 || px > state.width - 36) continue;
      gAxes
        .append('text')
        .attr('class', 'axis-tick-label')
        .attr('x', px)
        .attr('y', tickYPos)
        .attr('text-anchor', 'middle')
        .text(formatTick(x, false));
    }

    // Imaginary axis tick labels
    const tickXPos = Math.max(36, Math.min(state.width - 10, originX - 7));
    for (const y of majorY) {
      if (Math.abs(y) < 1e-9) continue;
      const py = yScale(y);
      if (py < 24 || py > state.height - 20) continue;
      gAxes
        .append('text')
        .attr('class', 'axis-tick-label')
        .attr('x', tickXPos)
        .attr('y', py + 3.5)
        .attr('text-anchor', 'end')
        .text(formatTick(y, true));
    }

    // Origin label
    if (originX > 16 && originX < state.width - 16 && originY > 16 && originY < state.height - 16) {
      gAxes
        .append('text')
        .attr('class', 'axis-tick-label')
        .attr('x', originX - 7)
        .attr('y', originY + 14)
        .attr('text-anchor', 'end')
        .text('0');
    }

    // Landmarks: pole at s = 1, trivial zeros, non-trivial zeros on critical line
    renderLandmarks(xMin, xMax, yMin, yMax);
  }

  function renderLandmarks(xMin, xMax, yMin, yMax) {
    gLandmarks.selectAll('*').remove();

    // 1. Simple pole at s = 1
    if (1 >= xMin && 1 <= xMax && 0 >= yMin && 0 <= yMax) {
      const px = xScale(1);
      const py = yScale(0);
      const r = 4;
      const gPole = gLandmarks.append('g').attr('class', 'pole-group');
      gPole
        .append('path')
        .attr('class', 'pole-marker')
        .attr('d', `M${px - r},${py - r} L${px + r},${py + r} M${px + r},${py - r} L${px - r},${py + r}`);

      if (pixelsPerUnit >= 14) {
        gPole
          .append('text')
          .attr('class', 'landmark-label')
          .attr('x', px + 7)
          .attr('y', py + 15)
          .text('pole (1)');
      }
    }

    // 2. Trivial zeros at s = -2, -4, -6, ...
    if (0 >= yMin && 0 <= yMax && xMin < -1.5) {
      const firstEven = Math.max(2, Math.ceil(-xMax / 2) * 2);
      const lastEven = Math.min(200, Math.floor(-xMin / 2) * 2);
      const spacingPx = 2 * pixelsPerUnit;
      const stepEven = spacingPx < 10 ? Math.ceil(10 / spacingPx) * 2 : 2;
      const py = yScale(0);

      let labeledTrivial = false;
      const labelTarget = pixelsPerUnit < 32 ? 6 : 2;
      for (let m = firstEven; m <= lastEven; m += stepEven) {
        const re = -m;
        const px = xScale(re);
        if (px < 10 || px > state.width - 10) continue;
        gLandmarks
          .append('circle')
          .attr('class', 'trivial-zero-marker')
          .attr('cx', px)
          .attr('cy', py)
          .attr('r', 2.7);

        if (!labeledTrivial && m >= labelTarget && pixelsPerUnit >= 12) {
          gLandmarks
            .append('text')
            .attr('class', 'landmark-label')
            .attr('x', px)
            .attr('y', py - 9)
            .attr('text-anchor', 'middle')
            .text('trivial zeros (−2n)');
          labeledTrivial = true;
        }
      }
    }

    // 3. Non-trivial zeros on the critical line Re(s) = 1/2
    if (0.5 >= xMin - 0.5 && 0.5 <= xMax + 0.5) {
      const cx = xScale(0.5);
      const zeros = ZM.NONTRIVIAL_ZERO_IMAG;

      // Positive imaginary zeros (upward)
      let lastPosLabelY = Infinity;
      for (let i = 0; i < zeros.length; i++) {
        const gamma = zeros[i];
        if (gamma < yMin || gamma > yMax) continue;
        const cy = yScale(gamma);
        const idx = i + 1;
        const labelText = pixelsPerUnit >= 14 ? `ρ${toSubscript(idx)}  ½ + ${gamma.toFixed(2)}i` : `ρ${toSubscript(idx)}`;

        const gZero = gLandmarks.append('g');
        gZero
          .append('circle')
          .attr('class', 'zero-marker')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', 3.5);

        // Avoid overlapping labels (and avoid colliding with top critical line title)
        if (cy > 36 && Math.abs(lastPosLabelY - cy) >= 15) {
          gZero
            .append('text')
            .attr('class', 'landmark-label')
            .attr('x', cx + 8)
            .attr('y', cy + 3.5)
            .text(labelText);
          lastPosLabelY = cy;
        }
      }

      // Conjugate negative imaginary zeros (downward)
      let lastNegLabelY = -Infinity;
      for (let i = 0; i < zeros.length; i++) {
        const gamma = -zeros[i];
        if (gamma < yMin || gamma > yMax) continue;
        const cy = yScale(gamma);
        const idx = i + 1;
        const labelText =
          pixelsPerUnit >= 14 ? `ρ̄${toSubscript(idx)}  ½ − ${Math.abs(gamma).toFixed(2)}i` : `ρ̄${toSubscript(idx)}`;

        const gZero = gLandmarks.append('g');
        gZero
          .append('circle')
          .attr('class', 'zero-marker')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', 3.5);

        if (cy < state.height - 22 && Math.abs(cy - lastNegLabelY) >= 15) {
          gZero
            .append('text')
            .attr('class', 'landmark-label')
            .attr('x', cx + 8)
            .attr('y', cy + 3.5)
            .text(labelText);
          lastNegLabelY = cy;
        }
      }
    }
  }

  function toSubscript(n) {
    const map = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
    return String(n)
      .split('')
      .map((ch) => map[ch] || ch)
      .join('');
  }

  // ---------- Magnetic Snapping ----------

  function applySnapping(rawS, disableSnap) {
    if (disableSnap) {
      return { s: rawS, landmark: detectLandmark(rawS) };
    }

    const px = xScale(rawS.re);
    const py = yScale(rawS.im);

    // 1. Snap to non-trivial zeros on critical line (highest priority, 9px radius)
    const critPx = xScale(0.5);
    if (Math.abs(px - critPx) <= 10) {
      const zeros = ZM.NONTRIVIAL_ZERO_IMAG;
      for (let i = 0; i < zeros.length; i++) {
        const g = zeros[i];
        if (Math.hypot(px - critPx, py - yScale(g)) <= 9) {
          return {
            s: { re: 0.5, im: g },
            landmark: `ρ${toSubscript(i + 1)} · critical zero`
          };
        }
        if (Math.hypot(px - critPx, py - yScale(-g)) <= 9) {
          return {
            s: { re: 0.5, im: -g },
            landmark: `ρ̄${toSubscript(i + 1)} · critical zero`
          };
        }
      }
    }

    // 2. Snap to simple pole s = 1
    if (Math.hypot(px - xScale(1), py - yScale(0)) <= 8) {
      return { s: { re: 1, im: 0 }, landmark: 'pole · s = 1' };
    }

    // 3. Snap to origin s = 0
    if (Math.hypot(px - xScale(0), py - yScale(0)) <= 8) {
      return { s: { re: 0, im: 0 }, landmark: 'origin · ζ(0) = −½' };
    }

    // 4. Snap to trivial zeros s = -2, -4, ...
    if (Math.abs(py - yScale(0)) <= 8 && rawS.re < -1.2) {
      const nearestEven = Math.round(rawS.re / 2) * 2;
      if (nearestEven <= -2 && Math.hypot(px - xScale(nearestEven), py - yScale(0)) <= 8) {
        return {
          s: { re: nearestEven, im: 0 },
          landmark: `trivial zero · s = −${Math.abs(nearestEven)}`
        };
      }
    }

    // 5. Snap to vertical lines: critical line Re = 1/2, imaginary axis Re = 0, Re = 1
    let re = rawS.re;
    let im = rawS.im;
    let landmark = null;

    if (Math.abs(px - critPx) <= 6) {
      re = 0.5;
      landmark = 'critical line · Re(s) = ½';
    } else if (Math.abs(px - xScale(0)) <= 5) {
      re = 0;
    } else if (Math.abs(px - xScale(1)) <= 5) {
      re = 1;
      landmark = 'convergence boundary · Re(s) = 1';
    }

    // 6. Snap to real axis Im = 0
    if (Math.abs(py - yScale(0)) <= 5) {
      im = 0;
    }

    return { s: { re, im }, landmark: landmark || detectLandmark({ re, im }) };
  }

  function detectLandmark(s) {
    if (Math.hypot(s.re - 1, s.im) < 1e-4) return 'pole · s = 1';
    if (Math.hypot(s.re, s.im) < 1e-4) return 'origin · ζ(0) = −½';
    if (Math.abs(s.re - 0.5) < 1e-4) {
      const zeros = ZM.NONTRIVIAL_ZERO_IMAG;
      for (let i = 0; i < zeros.length; i++) {
        if (Math.abs(Math.abs(s.im) - zeros[i]) < 1e-3) {
          const sym = s.im >= 0 ? `ρ${toSubscript(i + 1)}` : `ρ̄${toSubscript(i + 1)}`;
          return `${sym} · critical zero`;
        }
      }
      return 'critical line · Re(s) = ½';
    }
    if (Math.abs(s.im) < 1e-4 && s.re < -1.5 && Math.abs(s.re / 2 - Math.round(s.re / 2)) < 1e-3) {
      return `trivial zero · s = −${Math.abs(Math.round(s.re))}`;
    }
    return null;
  }

  // ---------- Dynamic Rendering (Spirals, Analytic Zeta, Traces, HUD) ----------

  function renderTraces() {
    const hasTrace = state.inputTrace.length > 1;
    elTraceActions.hidden = !hasTrace;

    if (!hasTrace) {
      pathTraceInput.attr('d', null);
      pathTraceOutput.attr('d', null);
      return;
    }

    pathTraceInput.attr('d', traceLine(state.inputTrace));
    pathTraceOutput.attr('d', traceLine(state.outputTrace));
  }

  function renderDynamic() {
    const s = state.currentS;
    const viewDiag = Math.hypot(
      xScale.domain()[1] - xScale.domain()[0],
      yScale.domain()[1] - yScale.domain()[0]
    );
    // Adaptive convergence epsilon & safe escape boundary
    const eps = Math.max(1e-4, Math.min(0.0025, 0.22 / pixelsPerUnit));
    const escapeRadius = Math.min(1e4, Math.max(35, viewDiag * 2.5));

    // 1. Analytic continuation zeta(s)
    const analytic = ZM.zetaAnalytic(s);

    // 2. Dirichlet partial sum spiral
    const dirichlet = ZM.computeZetaSpiral(s, {
      maxSteps: state.maxSteps,
      eps: eps,
      escapeRadius: escapeRadius
    });

    // 3. Euler product spiral over primes
    const euler = ZM.computeEulerSpiral(s, {
      maxSteps: state.maxSteps,
      eps: eps,
      escapeRadius: escapeRadius
    });

    // Render Dirichlet spiral
    if (state.showDirichlet) {
      pathDirichlet.attr('d', spiralLine(dirichlet.points));

      // Tapering step dots for early steps + final point
      const dotData = dirichlet.points.slice(0, 22);
      const lastPt = dirichlet.points[dirichlet.points.length - 1];
      if (dirichlet.points.length > 22 && !lastPt.clipped) {
        dotData.push(lastPt);
      }

      gDotsDirichlet
        .selectAll('circle')
        .data(dotData)
        .join('circle')
        .attr('class', 'spiral-dot-dirichlet')
        .attr('cx', (d) => xScale(d.re))
        .attr('cy', (d) => yScale(d.im))
        .attr('r', (d, idx) => (idx === dotData.length - 1 && dirichlet.points.length > 22 ? 2.4 : Math.max(1.1, 2.5 - idx * 0.07)))
        .attr('opacity', (d, idx) => (idx === dotData.length - 1 ? 0.95 : Math.max(0.25, 0.85 - idx * 0.03)));

      // Subtle dashed leader to analytic target when slowly converging
      if (analytic.value && dirichlet.status === 'slow convergence') {
        pathLeaderDirichlet.attr('d', spiralLine([lastPt, analytic.value]));
      } else {
        pathLeaderDirichlet.attr('d', null);
      }
    } else {
      pathDirichlet.attr('d', null);
      pathLeaderDirichlet.attr('d', null);
      gDotsDirichlet.selectAll('circle').remove();
    }

    // Render Euler product spiral
    if (state.showEuler) {
      pathEuler.attr('d', euler.points.length > 1 ? spiralLine(euler.points) : null);

      const dotData = euler.points.slice(0, 18);
      const lastPt = euler.points[euler.points.length - 1];
      if (euler.points.length > 18 && !lastPt.clipped) {
        dotData.push(lastPt);
      }

      gDotsEuler
        .selectAll('circle')
        .data(dotData)
        .join('circle')
        .attr('class', 'spiral-dot-euler')
        .attr('cx', (d) => xScale(d.re))
        .attr('cy', (d) => yScale(d.im))
        .attr('r', (d, idx) => (idx === dotData.length - 1 && euler.points.length > 18 ? 2.4 : Math.max(1.1, 2.5 - idx * 0.08)))
        .attr('opacity', (d, idx) => (idx === dotData.length - 1 ? 0.95 : Math.max(0.25, 0.85 - idx * 0.035)));

      if (analytic.value && (euler.status === 'slow convergence' || euler.status === 'slow (RH strip)')) {
        pathLeaderEuler.attr('d', spiralLine([lastPt, analytic.value]));
      } else {
        pathLeaderEuler.attr('d', null);
      }
    } else {
      pathEuler.attr('d', null);
      pathLeaderEuler.attr('d', null);
      gDotsEuler.selectAll('circle').remove();
    }

    // Render analytic zeta(s) marker
    if (analytic.value) {
      const zx = xScale(analytic.value.re);
      const zy = yScale(analytic.value.im);
      const margin = 40;
      const onScreen = zx >= -margin && zx <= state.width + margin && zy >= -margin && zy <= state.height + margin;
      gZetaMarker
        .style('display', onScreen ? null : 'none')
        .attr('transform', `translate(${zx},${zy})`);

      // Keep label readable if near top/right edges
      labelZeta
        .attr('dx', zx > state.width - 55 ? -34 : 9)
        .attr('dy', zy < 28 ? 16 : -7);
    } else {
      gZetaMarker.style('display', 'none');
    }

    // Render cursor input marker
    const sx = xScale(s.re);
    const sy = yScale(s.im);
    gCursorMarker.attr('transform', `translate(${sx},${sy})`);
    labelCursor
      .attr('dx', sx > state.width - 36 ? -18 : 9)
      .attr('dy', sy < 28 ? 16 : -7);

    // Update HUD readouts
    elValS.textContent = formatComplex(s, 3);
    if (state.currentLandmark) {
      elLandmarkRow.hidden = false;
      elValLandmark.textContent = state.currentLandmark;
    } else {
      elLandmarkRow.hidden = true;
    }

    if (analytic.status === 'pole') {
      elValZeta.textContent = '∞ (simple pole)';
    } else if (analytic.status === 'overflow') {
      elValZeta.textContent = '|ζ(s)| > 10¹²';
    } else {
      elValZeta.textContent = formatComplex(analytic.value, 4);
    }

    elStatusDirichlet.textContent = `${dirichlet.steps} · ${dirichlet.status}`;
    elStatusEuler.textContent = `${euler.steps} · ${euler.status}`;
    elPinBadge.hidden = !state.pinned;
  }

  function renderAll() {
    updateScales();
    renderStaticPlane();
    renderTraces();
    renderDynamic();
  }

  // ---------- Drag Trace Helpers (with Smooth Output Subdivision) ----------

  function appendTracePoint(nextS) {
    const viewSpan = Math.max(
      xScale.domain()[1] - xScale.domain()[0],
      yScale.domain()[1] - yScale.domain()[0]
    );
    const jumpLimit = Math.max(12, viewSpan * 2.5);

    if (state.inputTrace.length === 0) {
      state.inputTrace.push({ re: nextS.re, im: nextS.im });
      const res = ZM.zetaAnalytic(nextS);
      state.outputTrace.push(res.value ? { re: res.value.re, im: res.value.im } : null);
      return;
    }

    const prevS = state.inputTrace[state.inputTrace.length - 1];
    const distPx = Math.hypot(xScale(nextS.re) - xScale(prevS.re), yScale(nextS.im) - yScale(prevS.im));
    if (distPx < 2.2) return;

    // Subdivide longer pointer jumps so the output curve zeta(s(t)) stays smooth
    const subSteps = Math.max(1, Math.min(8, Math.ceil(distPx / 8)));
    for (let k = 1; k <= subSteps; k++) {
      const t = k / subSteps;
      const interpS = {
        re: prevS.re + (nextS.re - prevS.re) * t,
        im: prevS.im + (nextS.im - prevS.im) * t
      };
      if (k === subSteps) {
        state.inputTrace.push({ re: nextS.re, im: nextS.im });
      }
      const res = ZM.zetaAnalytic(interpS);
      if (!res.value) {
        state.outputTrace.push(null);
      } else {
        const pt = { re: res.value.re, im: res.value.im };
        const prevOut = state.outputTrace[state.outputTrace.length - 1];
        if (prevOut && Math.hypot(pt.re - prevOut.re, pt.im - prevOut.im) > jumpLimit) {
          // Discontinuity across pole or rapid blowup: break the output path cleanly
          state.outputTrace.push(null);
        }
        state.outputTrace.push(pt);
      }
    }

    // Cap trace buffer for sustained responsiveness
    if (state.inputTrace.length > 2500) {
      state.inputTrace.shift();
    }
    if (state.outputTrace.length > 6000) {
      state.outputTrace.splice(0, 100);
    }
  }

  function clearTrace() {
    state.inputTrace = [];
    state.outputTrace = [];
    renderTraces();
  }

  // ---------- Interaction Handlers ----------

  function getPointerCoords(event) {
    const rect = svgEl.getBoundingClientRect();
    return {
      px: event.clientX - rect.left,
      py: event.clientY - rect.top
    };
  }

  svgEl.addEventListener('pointerdown', (event) => {
    // Middle/right button or Shift+click pans the complex plane
    if (event.button === 1 || event.button === 2 || event.shiftKey) {
      event.preventDefault();
      state.isPanning = true;
      state.pointerStartPx = getPointerCoords(event);
      state.panStartView = { ...state.view };
      svgEl.classList.add('panning');
      svgEl.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0) return;

    const pt = getPointerCoords(event);
    state.pointerDown = true;
    state.pointerStartPx = pt;
    state.isDraggingTrace = false;
    svgEl.setPointerCapture(event.pointerId);
  });

  svgEl.addEventListener('pointermove', (event) => {
    const pt = getPointerCoords(event);

    // Handle panning
    if (state.isPanning && state.pointerStartPx && state.panStartView) {
      const dx = pt.px - state.pointerStartPx.px;
      const dy = pt.py - state.pointerStartPx.py;
      state.view.centerRe = state.panStartView.centerRe - dx / pixelsPerUnit;
      state.view.centerIm = state.panStartView.centerIm + dy / pixelsPerUnit;
      renderAll();
      return;
    }

    const rawS = screenToComplex(pt.px, pt.py);
    const snapped = applySnapping(rawS, event.altKey);

    // Handle drag tracing
    if (state.pointerDown && state.pointerStartPx) {
      const moved = Math.hypot(pt.px - state.pointerStartPx.px, pt.py - state.pointerStartPx.py);
      if (!state.isDraggingTrace && moved >= 3.5) {
        state.isDraggingTrace = true;
        state.pinned = false;
        state.inputTrace = [];
        state.outputTrace = [];
        const startRaw = screenToComplex(state.pointerStartPx.px, state.pointerStartPx.py);
        const startSnapped = applySnapping(startRaw, event.altKey);
        appendTracePoint(startSnapped.s);
      }

      if (state.isDraggingTrace) {
        state.currentS = snapped.s;
        state.currentLandmark = snapped.landmark;
        appendTracePoint(snapped.s);
        renderTraces();
        renderDynamic();
        return;
      }
    }

    // Standard hover inspection (when not pinned)
    if (!state.pinned) {
      state.currentS = snapped.s;
      state.currentLandmark = snapped.landmark;
      renderDynamic();
    }
  });

  svgEl.addEventListener('pointerup', (event) => {
    if (state.isPanning) {
      state.isPanning = false;
      state.panStartView = null;
      svgEl.classList.remove('panning');
      if (svgEl.hasPointerCapture(event.pointerId)) {
        svgEl.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (!state.pointerDown) return;

    const wasDrag = state.isDraggingTrace;
    state.pointerDown = false;
    state.isDraggingTrace = false;
    state.pointerStartPx = null;
    if (svgEl.hasPointerCapture(event.pointerId)) {
      svgEl.releasePointerCapture(event.pointerId);
    }

    // Simple click without dragging pins/unpins (or jumps pin to another landmark)
    if (!wasDrag) {
      const pt = getPointerCoords(event);
      const snapped = applySnapping(screenToComplex(pt.px, pt.py), event.altKey);
      const clickedNewLandmark =
        snapped.landmark &&
        Math.hypot(snapped.s.re - state.currentS.re, snapped.s.im - state.currentS.im) > 1e-3;

      if (state.pinned && !clickedNewLandmark) {
        state.pinned = false;
      } else {
        state.pinned = true;
      }
      state.currentS = snapped.s;
      state.currentLandmark = snapped.landmark;
      renderDynamic();
    }
  });

  svgEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  // Smooth wheel zoom around cursor
  svgEl.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const pt = getPointerCoords(event);
      const before = screenToComplex(pt.px, pt.py);

      const zoomFactor = Math.exp(event.deltaY * 0.0014);
      const nextHalfHeight = Math.max(0.15, Math.min(120, state.view.halfHeight * zoomFactor));
      const actualRatio = nextHalfHeight / state.view.halfHeight;

      state.view.halfHeight = nextHalfHeight;
      state.view.centerRe = before.re + (state.view.centerRe - before.re) * actualRatio;
      state.view.centerIm = before.im + (state.view.centerIm - before.im) * actualRatio;

      renderAll();
    },
    { passive: false }
  );

  // HUD controls
  btnToggleDirichlet.addEventListener('click', () => {
    state.showDirichlet = !state.showDirichlet;
    btnToggleDirichlet.setAttribute('aria-pressed', String(state.showDirichlet));
    renderDynamic();
  });

  btnToggleEuler.addEventListener('click', () => {
    state.showEuler = !state.showEuler;
    btnToggleEuler.setAttribute('aria-pressed', String(state.showEuler));
    renderDynamic();
  });

  sliderSteps.addEventListener('input', () => {
    state.maxSteps = Number(sliderSteps.value);
    elStepsValue.textContent = String(state.maxSteps);
    renderDynamic();
  });

  btnClearTrace.addEventListener('click', clearTrace);

  function zoomBy(factor) {
    state.view.halfHeight = Math.max(0.15, Math.min(120, state.view.halfHeight * factor));
    renderAll();
  }

  btnZoomIn.addEventListener('click', () => zoomBy(0.72));
  btnZoomOut.addEventListener('click', () => zoomBy(1 / 0.72));
  btnReset.addEventListener('click', () => {
    state.view = { ...DEFAULT_VIEW };
    renderAll();
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (event) => {
    if (event.target && event.target.tagName === 'INPUT') return;
    if (event.key === 'Escape') {
      state.pinned = false;
      clearTrace();
      renderDynamic();
    } else if (event.key === 'r' || event.key === 'R') {
      state.view = { ...DEFAULT_VIEW };
      renderAll();
    } else if (event.key === '=' || event.key === '+') {
      zoomBy(0.75);
    } else if (event.key === '-' || event.key === '_') {
      zoomBy(1 / 0.75);
    }
  });

  window.addEventListener('resize', renderAll);

  // Initial render
  state.currentLandmark = detectLandmark(state.currentS);
  renderAll();
})();
