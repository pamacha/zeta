/**
 * zeta-math.js
 * Numerical routines for the Riemann zeta function (analytic continuation),
 * Dirichlet partial sums, and Euler product sequence over primes.
 * Uses math.js for complex arithmetic.
 */
(function (global) {
  'use strict';

  const math = global.math;

  // First 35 non-trivial zeros of zeta(s) on the critical line Re(s) = 1/2 (imaginary parts)
  const NONTRIVIAL_ZERO_IMAG = [
    14.134725141734693,
    21.022039638771555,
    25.010857580145689,
    30.424876125859513,
    32.935061587739190,
    37.586178158825671,
    40.918719012147495,
    43.327073280914999,
    48.005150881167160,
    49.773832477672302,
    52.970321477714461,
    56.446247697063395,
    59.347044002602353,
    60.831778524609810,
    65.112544048081607,
    67.079810529494174,
    69.546401711173980,
    72.067157674481908,
    75.704690699083933,
    77.144840068874805,
    79.337375020249368,
    82.910380854086030,
    84.735492980517050,
    87.425274613125229,
    88.809111207634465,
    92.491899270558484,
    94.651344040519887,
    95.870634228245310,
    98.831194218193692,
    101.31785100573139,
    103.72553804047834,
    105.44662305232609,
    107.16861118427641,
    111.02953554316967,
    111.87465917699263
  ];

  // Generate the first `count` prime numbers via Sieve of Eratosthenes
  function generatePrimes(count) {
    const limit = Math.max(30, Math.ceil(count * (Math.log(count) + Math.log(Math.log(count)) + 2)));
    const isComposite = new Uint8Array(limit + 1);
    const primes = [];
    for (let i = 2; i <= limit && primes.length < count; i++) {
      if (!isComposite[i]) {
        primes.push(i);
        if (i * i <= limit) {
          for (let j = i * i; j <= limit; j += i) {
            isComposite[j] = 1;
          }
        }
      }
    }
    return primes;
  }

  const PRIMES = generatePrimes(1000);
  const LOG_PRIMES = PRIMES.map(Math.log);

  // Precomputed Bernoulli coefficients B_{2j} / (2j)! for Euler-Maclaurin (j = 1..8)
  const EM_COEFFS = [
    1 / 12,
    -1 / 720,
    1 / 30240,
    -1 / 1209600,
    1 / 47900160,
    -691 / 1307674368000,
    1 / 74724249600,
    -3617 / 10670622842880000
  ];

  // High-precision Lanczos coefficients (g = 7, n = 9) for complex Gamma(z), Re(z) > 0.5
  const LANCZOS_G = 7;
  const LANCZOS_P = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  /**
   * Complex Gamma(z) via Lanczos approximation (valid for Re(z) >= 0.5) using math.js.
   */
  function complexGamma(z) {
    const zm1 = math.subtract(z, 1);
    let x = math.complex(LANCZOS_P[0], 0);
    for (let i = 1; i < LANCZOS_P.length; i++) {
      x = math.add(x, math.divide(LANCZOS_P[i], math.add(zm1, i)));
    }
    const t = math.add(zm1, LANCZOS_G + 0.5);
    const sqrt2Pi = Math.sqrt(2 * Math.PI);
    const tPow = math.pow(t, math.add(zm1, 0.5));
    const expNegT = math.exp(math.unaryMinus(t));
    return math.multiply(math.multiply(math.multiply(sqrt2Pi, tPow), expNegT), x);
  }

  /**
   * Euler-Maclaurin summation for zeta(s), accurate across Re(s) >= -0.5.
   * Uses math.js complex arithmetic throughout.
   */
  function zetaEulerMaclaurin(s) {
    const absIm = Math.abs(s.im);
    const N = Math.max(14, Math.min(72, Math.ceil(12 + 0.65 * absIm + Math.max(0, -s.re))));
    const negS = math.unaryMinus(s);

    let sum = math.complex(0, 0);
    for (let k = 1; k < N; k++) {
      sum = math.add(sum, math.pow(k, negS));
    }

    const nPowNegS = math.pow(N, negS);
    // Integral remainder: N^(1-s) / (s - 1) + 0.5 * N^(-s)
    const integralTerm = math.divide(math.multiply(N, nPowNegS), math.subtract(s, 1));
    sum = math.add(sum, integralTerm);
    sum = math.add(sum, math.multiply(0.5, nPowNegS));

    // Bernoulli asymptotic correction terms
    const invN2 = 1 / (N * N);
    let termFactor = math.divide(math.multiply(s, nPowNegS), N);
    for (let j = 0; j < EM_COEFFS.length; j++) {
      if (j > 0) {
        const m1 = math.add(s, 2 * j - 1);
        const m2 = math.add(s, 2 * j);
        termFactor = math.multiply(math.multiply(math.multiply(termFactor, m1), m2), invN2);
      }
      const contrib = math.multiply(EM_COEFFS[j], termFactor);
      sum = math.add(sum, contrib);
      const contribMag = math.abs(contrib);
      if (!isFinite(contribMag) || contribMag < 1e-14 * (math.abs(sum) + 1)) {
        break;
      }
    }
    return sum;
  }

  /**
   * Analytic continuation of the Riemann zeta function zeta(s) across the complex plane.
   * - Pole at s = 1 is reported explicitly.
   * - Re(s) >= -0.5: Euler-Maclaurin summation (fast, ~15 digits, no spurious poles on Re(s) = 1).
   * - Re(s) < -0.5: Riemann functional equation:
   *     zeta(s) = 2^s * pi^(s-1) * sin(pi*s/2) * Gamma(1 - s) * zeta(1 - s)
   *
   * @param {{re: number, im: number}} sInput
   * @returns {{ value: Complex | null, status: 'ok' | 'pole' | 'overflow' }}
   */
  function zetaAnalytic(sInput) {
    const s = math.complex(sInput.re, sInput.im);

    // Simple pole at s = 1
    if (Math.hypot(s.re - 1, s.im) < 1e-7) {
      return { value: null, status: 'pole' };
    }

    // Exact trivial zeros at negative even integers s = -2, -4, -6, ...
    if (
      Math.abs(s.im) < 1e-11 &&
      s.re < -0.5 &&
      Math.abs(s.re / 2 - Math.round(s.re / 2)) < 1e-11
    ) {
      return { value: math.complex(0, 0), status: 'ok' };
    }

    try {
      let result;
      if (s.re >= -0.5) {
        result = zetaEulerMaclaurin(s);
      } else {
        const oneMinusS = math.subtract(1, s);
        const z1ms = zetaEulerMaclaurin(oneMinusS);
        const g1ms = complexGamma(oneMinusS);
        const sinTerm = math.sin(math.multiply(Math.PI / 2, s));
        const twoPowS = math.pow(2, s);
        const piPowSm1 = math.pow(Math.PI, math.subtract(s, 1));
        result = math.multiply(
          math.multiply(math.multiply(math.multiply(twoPowS, piPowSm1), sinTerm), g1ms),
          z1ms
        );
      }

      if (!result || !isFinite(result.re) || !isFinite(result.im) || math.abs(result) > 1e12) {
        return { value: null, status: 'overflow' };
      }

      // Clean tiny floating-point noise near exact zeros
      const re = Math.abs(result.re) < 1e-13 ? 0 : result.re;
      const im = Math.abs(result.im) < 1e-13 ? 0 : result.im;
      return { value: math.complex(re, im), status: 'ok' };
    } catch (_) {
      return { value: null, status: 'overflow' };
    }
  }

  /**
   * Helper: clip an escaping segment (prev -> next) to a circle of radius `limit`.
   */
  function clipToRadius(prev, next, limit) {
    const dx = next.re - prev.re;
    const dy = next.im - prev.im;
    const mag = Math.hypot(dx, dy);
    if (!isFinite(mag) || mag === 0) {
      return { re: prev.re, im: prev.im };
    }
    // Solve |prev + t*(next - prev)|^2 = limit^2 for t in [0, 1]
    const a = dx * dx + dy * dy;
    const b = 2 * (prev.re * dx + prev.im * dy);
    const c = prev.re * prev.re + prev.im * prev.im - limit * limit;
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      const scale = limit / Math.hypot(next.re, next.im);
      return { re: next.re * scale, im: next.im * scale };
    }
    const t = Math.max(0, Math.min(1, (-b + Math.sqrt(disc)) / (2 * a)));
    return { re: prev.re + t * dx, im: prev.im + t * dy };
  }

  /**
   * Compute partial sums of the Dirichlet series:
   *   Z_0 = 0, Z_k(s) = sum_{m=1}^k m^{-s}
   * Handles fast convergence, slow progression, critical-strip oscillation, and divergence.
   */
  function computeZetaSpiral(sInput, options) {
    const maxSteps = Math.max(1, Math.min(1000, (options && options.maxSteps) || 250));
    const eps = (options && options.eps) || 1e-4;
    const escapeRadius = Math.min(1e4, Math.max(25, (options && options.escapeRadius) || 60));

    const s = math.complex(sInput.re, sInput.im);
    const negS = math.unaryMinus(s);

    const points = [{ re: 0, im: 0, k: 0 }];
    let current = math.complex(0, 0);
    let consecutiveSmall = 0;
    let status = 'ok';
    let converged = false;
    let escaped = false;
    let steps = 0;

    for (let k = 1; k <= maxSteps; k++) {
      // term = k^(-s) using math.js
      const term = math.pow(k, negS);
      if (!isFinite(term.re) || !isFinite(term.im)) {
        escaped = true;
        status = 'diverges';
        break;
      }

      const next = math.add(current, term);
      const nextMag = math.abs(next);
      const stepMag = math.abs(term);

      if (!isFinite(nextMag) || nextMag > escapeRadius) {
        const clipped = clipToRadius(current, next, escapeRadius);
        points.push({ re: clipped.re, im: clipped.im, k: k, clipped: true });
        steps = k;
        escaped = true;
        status = 'diverges';
        break;
      }

      current = next;
      steps = k;
      points.push({ re: current.re, im: current.im, k: k });

      // Check rapid/finished convergence (only true convergence for Re(s) > 1)
      if (s.re > 1 && k >= 6 && stepMag < eps) {
        consecutiveSmall++;
        if (consecutiveSmall >= 3) {
          converged = true;
          status = 'converged';
          break;
        }
      } else {
        consecutiveSmall = 0;
      }
    }

    if (!converged && !escaped) {
      if (s.re > 1) {
        status = 'slow convergence';
      } else if (s.re > 0 && Math.abs(s.im) >= 1e-5) {
        status = 'diverges (oscillates)';
      } else {
        status = 'diverges';
      }
    }

    return {
      points: points,
      steps: steps,
      status: status,
      converged: converged,
      escaped: escaped,
      finalValue: current
    };
  }

  /**
   * Compute partial products of the Euler product over primes:
   *   P_0 = 1, P_k(s) = prod_{j=1}^k 1 / (1 - p_j^{-s})
   * Handles convergence (Re > 1), conditional oscillation (0 < Re <= 1),
   * pole factors (p^{-s} = 1), divergence, and collapse to 0 (Re < 0).
   */
  function computeEulerSpiral(sInput, options) {
    const maxSteps = Math.max(1, Math.min(PRIMES.length, (options && options.maxSteps) || 250));
    const eps = (options && options.eps) || 1e-4;
    const escapeRadius = Math.min(1e4, Math.max(25, (options && options.escapeRadius) || 60));

    const s = math.complex(sInput.re, sInput.im);
    const negS = math.unaryMinus(s);

    const points = [{ re: 1, im: 0, k: 0, p: 1 }];
    let current = math.complex(1, 0);
    let consecutiveSmall = 0;
    let status = 'ok';
    let converged = false;
    let escaped = false;
    let collapsed = false;
    let polePrime = null;
    let steps = 0;

    for (let j = 0; j < maxSteps; j++) {
      const p = PRIMES[j];
      const pPowNegS = math.pow(p, negS);
      const denom = math.subtract(1, pPowNegS);
      const denomMag = math.abs(denom);

      // Guard against division by zero when p^{-s} == 1 (e.g. s = 0 or s = 2*pi*i*m / ln(p))
      if (!isFinite(denomMag) || denomMag < 1e-8) {
        escaped = true;
        polePrime = p;
        status = 'pole (p = ' + p + ')';
        break;
      }

      const factor = math.divide(1, denom);
      const next = math.multiply(current, factor);
      const nextMag = math.abs(next);
      const stepMag = math.abs(math.subtract(next, current));

      if (!isFinite(nextMag) || nextMag > escapeRadius) {
        const clipped = clipToRadius(current, next, escapeRadius);
        points.push({ re: clipped.re, im: clipped.im, k: j + 1, p: p, clipped: true });
        steps = j + 1;
        escaped = true;
        status = 'diverges';
        break;
      }

      current = next;
      steps = j + 1;
      points.push({ re: current.re, im: current.im, k: j + 1, p: p });

      // Edge case: Re(s) < 0 causes |1/(1 - p^{-s})| ~ p^{Re(s)} -> 0, collapsing product to 0
      if (s.re < 0 && j >= 3 && nextMag < eps && stepMag < eps) {
        consecutiveSmall++;
        if (consecutiveSmall >= 2) {
          collapsed = true;
          status = 'decays → 0';
          break;
        }
      } else if (s.re > 1 && j >= 5 && stepMag < eps) {
        consecutiveSmall++;
        if (consecutiveSmall >= 3) {
          converged = true;
          status = 'converged';
          break;
        }
      } else {
        consecutiveSmall = 0;
      }
    }

    if (!converged && !escaped && !collapsed && polePrime === null) {
      if (s.re > 1) {
        status = 'slow convergence';
      } else if (s.re > 0 && Math.abs(s.im) < 1e-5) {
        status = 'diverges';
      } else if (s.re > 0.5) {
        status = 'slow (RH strip)';
      } else if (s.re > 0) {
        status = 'oscillates';
      } else if (s.re === 0) {
        status = 'diverges';
      } else {
        status = 'decays → 0';
      }
    }

    return {
      points: points,
      steps: steps,
      status: status,
      converged: converged,
      escaped: escaped,
      collapsed: collapsed,
      polePrime: polePrime,
      finalValue: current
    };
  }

  global.ZetaMath = {
    NONTRIVIAL_ZERO_IMAG: NONTRIVIAL_ZERO_IMAG,
    PRIMES: PRIMES,
    LOG_PRIMES: LOG_PRIMES,
    zetaAnalytic: zetaAnalytic,
    computeZetaSpiral: computeZetaSpiral,
    computeEulerSpiral: computeEulerSpiral
  };
})(typeof window !== 'undefined' ? window : globalThis);
