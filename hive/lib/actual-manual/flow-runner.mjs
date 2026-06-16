/**
 * Vision-cursor PARENT executor — ported from spike Arm D commit 7b0ff06.
 *
 * Story: am-4-flow-runner-bridge (actual-manual-tier)
 *
 * Division of labor:
 *   - Native primitives (fill / tapRole / tapText / goto / wait) → Playwright
 *   - Selectorless clicks (how: "vision") → vision grounds pixels + real pointer
 *   - Per-step VERIFY → vision judge (hybrid: truth-signal authoritative when declared)
 *
 * Locked design decisions (do not re-litigate):
 *   1. LOCATE decoupled from "visible" — grounding asks coords-only; 0,0 = absent.
 *   2. Two-pass grounding: fullPage glance → scroll target to center → viewport re-ground → click.
 *      Retry ≤3. DOM-snap OFF by default (SNAP_R=0).
 *   3. Hybrid V&V: truth-signal (cta_enabled=DOM, posted=network) authoritative; vision recorded
 *      alongside; divergence flagged. Vision unreliable for ephemeral toasts / enabled-state.
 *
 * Exports (library surface):
 *   locate(page, label, fullPage, opts) → { found, ix, iy, W, H, raw }
 *   verify(page, expected, opts)        → { pass, why }
 *   settle(page)                        → Promise<void>
 *   visionTap(page, label, opts)        → { found, clicked, topmost, ... }
 *   native(page, step, opts)            → Promise<void>
 *   runFlow(page, scenario, binding, opts) → RunReport
 *
 * CLI usage (standalone):
 *   SCENARIO=<path-or-id> BINDING=<path-or-id> node flow-runner.mjs
 *
 * Config env vars:
 *   MLX_URL      — MLX completions endpoint (default: http://localhost:8089/v1/chat/completions)
 *   MLX_MODEL    — model id (default: mlx-community/Qwen2.5-VL-7B-Instruct-4bit)
 *   MLX_COORDS   — "abs" (pixel center) | "norm" (0-1000 normalized) (default: abs)
 *   SNAP_R       — DOM-snap search radius in px; 0 = pure vision coords (default: 0)
 *   VIEWPORT_W   — browser viewport width  (default: 1280)
 *   VIEWPORT_H   — browser viewport height (default: 800)
 *   BASE_URL     — app base URL for goto steps using relative paths (default: http://localhost:3100)
 *   SCENARIO     — path or bare id (resolved against scenarios/) for CLI mode
 *   BINDING      — path to overlay JSON; defaults to scenarios/flow-bindings/<id>.json
 *   HEADLESS     — "false" to show browser in CLI mode (default: true)
 */

import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBindings, resolveBindingsPath } from './bindings.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

// ─── Default config (env-driven; overridable per-call via opts) ──────────────

const DEFAULTS = {
  mlx: process.env.MLX_URL || 'http://localhost:8089/v1/chat/completions',
  model: process.env.MLX_MODEL || 'mlx-community/Qwen2.5-VL-7B-Instruct-4bit',
  coords: process.env.MLX_COORDS || 'abs',
  snapR: Number(process.env.SNAP_R ?? 0),
  viewport: {
    width: Number(process.env.VIEWPORT_W ?? 1280),
    height: Number(process.env.VIEWPORT_H ?? 800),
  },
  baseUrl: process.env.BASE_URL || 'http://localhost:3100',
  // Per-MLX-request wall-clock timeout. Without this a wedged sidecar (TCP
  // accepted, response never completes) hangs the whole /test actual run.
  timeoutMs: Number(process.env.MLX_TIMEOUT_MS ?? 30000),
};

// ─── MLX helper ──────────────────────────────────────────────────────────────

async function ask(b64, text, { mlx, model, timeoutMs } = {}) {
  const endpoint = mlx || DEFAULTS.mlx;
  const mdl = model || DEFAULTS.model;
  const to = timeoutMs ?? DEFAULTS.timeoutMs;
  const body = {
    model: mdl,
    temperature: 0,
    max_tokens: 200,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      { type: 'text', text },
    ]}],
  };
  let r;
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // AbortSignal.timeout throws a TimeoutError; callers (locate/verify) run
      // inside runFlow's per-step try/catch, surfacing it via rec.actError /
      // rec.verify.why like any other MLX failure.
      signal: AbortSignal.timeout(to),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`MLX timeout after ${to}ms (${endpoint})`);
    }
    throw e;
  }
  if (!r.ok) throw new Error(`MLX ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).choices?.[0]?.message?.content ?? '';
}

// ─── PNG dimension reader (no dep) ───────────────────────────────────────────

function pngSize(buf) {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// ─── Coordinate mapper ────────────────────────────────────────────────────────

function mapPx(ix, iy, W, H, { coords, viewport } = {}) {
  const vp = viewport || DEFAULTS.viewport;
  if ((coords || DEFAULTS.coords) === 'norm') {
    return [Math.round((ix / 1000) * vp.width), Math.round((iy / 1000) * vp.height)];
  }
  return [Math.round((ix / W) * vp.width), Math.round((iy / H) * vp.height)];
}

// ─── DOM settle ──────────────────────────────────────────────────────────────

export async function settle(page) {
  await page.evaluate(async () => {
    const t0 = performance.now(); let last = -1, since = performance.now();
    while (performance.now() - t0 < 7000) {
      const h = document.body.scrollHeight;
      if (h !== last) { last = h; since = performance.now(); }
      else if (performance.now() - since >= 1200) return;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 80)));
    }
  }).catch(() => {});
}

// ─── Vision LOCATE ────────────────────────────────────────────────────────────
//
// Coords-only grounding — no visibility judgment. The model self-reports visibility
// unreliably (grounded Post Now to ~6px yet flagged it "not visible"). Absent element
// → model returns 0,0 → click hits empty space → verify() catches the failure by
// outcome. This is more manual-faithful than trusting the self-reported flag.

export async function locate(page, label, fullPage, opts = {}) {
  const buf = await page.screenshot({ fullPage: !!fullPage });
  const [W, H] = pngSize(buf);
  const coordHint = (opts.coords || DEFAULTS.coords) === 'norm'
    ? 'x,y = normalized 0-1000 center.'
    : 'x,y = PIXEL center.';
  const raw = await ask(
    buf.toString('base64'),
    `Where is the element described as: "${label}" in this image? Output ONLY JSON {"x":<int>,"y":<int>}. ${coordHint} Output {"x":0,"y":0} only if it is genuinely not present anywhere in the image.`,
    opts,
  );
  const ints = (String(raw).match(/-?\d+/g) || []).map(Number);
  const ix = ints[0] ?? 0;
  const iy = ints[1] ?? 0;
  return { found: ix > 0 && iy > 0, ix, iy, W, H, raw: String(raw).trim().slice(0, 140) };
}

// ─── Vision VERIFY ────────────────────────────────────────────────────────────
//
// Did the expected result happen? Settle + fullPage screenshot (verdict must not
// depend on scroll position — a human scans the whole visible render).
// Fail-closed: any negative signal → fail. Verify must not pass on ambiguity.

export async function verify(page, expected, opts = {}) {
  await settle(page);
  const buf = await page.screenshot({ fullPage: true });
  const raw = await ask(
    buf.toString('base64'),
    `A tester just performed an action. The EXPECTED result is: "${expected}". ` +
    'Look at the screenshot. Did that expected result actually happen / is it shown now? ' +
    'Reply ONLY JSON {"pass":true|false,"why":"<short reason>"}.',
    opts,
  );
  const s = String(raw);
  const passFalse =
    /"?pass"?\s*[:=]\s*false/i.test(s) ||
    /^\s*```?\s*(json)?\s*false/i.test(s) ||
    /\bnot (shown|visible|present|happen|posted|confirmed|enabled|completed)\b/i.test(s) ||
    /\bno confirmation\b/i.test(s);
  const passTrue =
    /"?pass"?\s*[:=]\s*true/i.test(s) ||
    /\b(confirmed|success|is shown|does appear|did happen|now shows)\b/i.test(s);
  const pass = passFalse ? false : passTrue;
  const why =
    s.match(/"why"\s*:\s*"([^"]+)"/i)?.[1] ||
    s.replace(/```[a-z]*|[{}"]/gi, ' ').trim().slice(0, 140);
  return { pass, why };
}

// ─── Vision TAP ───────────────────────────────────────────────────────────────
//
// Two-pass grounding: viewport-first → if missing, fullPage glance → scroll to center
// → precise viewport re-ground → real pointer click. Retry ≤3 for reflow-happy SPAs.
// DOM-snap OFF by default (SNAP_R=0) — pure manual coords; overlays/z-index apply.

export async function visionTap(page, label, opts = {}) {
  const vp = opts.viewport || DEFAULTS.viewport;
  const snapR = opts.snapR ?? DEFAULTS.snapR;

  let g = null;
  const maxAttempts = opts.retryLimit ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await settle(page);
    let loc = await locate(page, label, false, opts);
    if (!loc.found) {
      const full = await locate(page, label, true, opts);
      if (full.found) {
        const scrollH = await page.evaluate(
          () => (document.scrollingElement || document.documentElement).scrollHeight,
        );
        // In normalized mode the model returns 0-1000 coords, NOT pixels —
        // divide by 1000, not the full-page PNG height.
        const coordsMode = opts.coords || DEFAULTS.coords;
        const fracY = coordsMode === 'norm' ? (full.iy / 1000) : (full.iy / full.H);
        const docY = Math.round(fracY * scrollH);
        await page.evaluate(
          (y) => { (document.scrollingElement || document.documentElement).scrollTo({ top: Math.max(0, y), behavior: 'instant' }); },
          docY - Math.round(vp.height / 2),
        );
        await page.waitForTimeout(400);
        loc = await locate(page, label, false, opts);
      }
    }
    if (loc.found) { g = loc; break; }
  }

  if (!g) return { found: false, clicked: null, topmost: null };

  let [cx, cy] = mapPx(g.ix, g.iy, g.W, g.H, opts);

  if (snapR > 0) {
    const snap = await page.evaluate(([x, y, r]) => {
      let best = null, bd = Infinity;
      for (const el of document.querySelectorAll('button,[role="button"],a[href]')) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const dx = Math.max(b.left - x, 0, x - b.right);
        const dy = Math.max(b.top - y, 0, y - b.bottom);
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2), d: Math.round(d) }; }
      }
      return best && best.d <= r ? best : null;
    }, [cx, cy, snapR]).catch(() => null);
    if (snap) [cx, cy] = [snap.cx, snap.cy];
  }

  const topmost = await page.evaluate(
    ([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${(e.className || '').toString().slice(0, 20)}` : null; },
    [cx, cy],
  ).catch(() => null);

  await page.mouse.click(cx, cy);
  await page.waitForTimeout(1500);
  return { ...g, clicked: [cx, cy], topmost };
}

// ─── Native primitive executor ────────────────────────────────────────────────
//
// Mechanical hands — deterministic Playwright primitives. Goto supports both
// absolute URLs (args.url) and relative paths (args.path, prepended with BASE_URL).

export async function native(page, step, opts = {}) {
  const base = opts.baseUrl || DEFAULTS.baseUrl;
  const args = step.args || {};
  switch (step.act) {
    case 'goto': {
      const url = args.url || (base + (args.path || '/'));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      break;
    }
    case 'fill': {
      // Overlay schema/tests accept `value`; runner historically read `text`.
      // Accept both so a valid overlay never silently fills ''.
      const text = args.text ?? args.value ?? '';
      await page.locator(args.selector).first().fill(text);
      break;
    }
    case 'tapRole':
      await page.getByRole(args.role, { name: new RegExp(args.name, 'i') }).first().click();
      break;
    case 'tapText': {
      // Tests/overlays use `text`; legacy callers used `name`. Accept both so
      // we never build /undefined/i and click an unintended element.
      const name = args.name ?? args.text;
      if (name == null) throw new Error('tapText requires args.text or args.name');
      await page.getByText(new RegExp(name, 'i')).first().click();
      break;
    }
    case 'wait':
      await page.waitForTimeout(args.ms || 300);
      break;
    default:
      throw new Error(`unknown native act: ${step.act}`);
  }
}

// ─── Truth-signal evaluators ──────────────────────────────────────────────────

async function evalTruthSignal(page, signal, networkState) {
  if (signal === 'posted') {
    return !!networkState.posted;
  }
  if (signal === 'cta_enabled') {
    return page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find(
        (x) => /post now/i.test(x.textContent || ''),
      );
      if (!el) return false;
      const cs = getComputedStyle(el);
      return (
        !el.disabled &&
        el.getAttribute('aria-disabled') !== 'true' &&
        parseFloat(cs.opacity) > 0.1 &&
        el.getBoundingClientRect().width > 0
      );
    }).catch(() => false);
  }
  throw new Error(`unknown truth signal: ${signal}`);
}

// ─── Flow runner (core) ───────────────────────────────────────────────────────
//
// Drives a full scenario flow: for each step, run setup primitives → act → verify.
// Returns a RunReport: { flowPassed, stepsPassed, posted, steps, scenario, model }.
//
// @param {import('playwright').Page} page — authenticated, pre-navigated page
// @param {object} scenario — parsed scenario YAML ({ id, steps: [{ action, expected }] })
// @param {object} binding  — validated overlay ({ scenario, steps: [StepEntry] })
// @param {object} [opts]   — { mlx, model, coords, snapR, viewport, baseUrl, onStep }
//   opts.onStep(rec) — optional callback after each step (for streaming progress)

export async function runFlow(page, scenario, binding, opts = {}) {
  const networkState = { posted: false };

  // Named handler so we can detach it — callers may reuse an authenticated
  // page/context across runs; an anonymous listener would accumulate.
  const onRequest = (req) => {
    if (req.url().includes('/api/social/post') && req.method() === 'POST') {
      networkState.posted = true;
    }
  };
  page.on('request', onRequest);

  const report = [];

  try {
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const b = (binding.steps && binding.steps[i]) || {};
      const rec = { i, action: step.action, expected: step.expected, how: b.how };

      // Setup primitives (pre-action, native only)
      for (const s of (b.setup || [])) {
        await native(page, s, opts);
      }

      // ACT
      try {
        if (b.how === 'vision') {
          rec.vision = await visionTap(page, b.target, opts);
          rec.acted = rec.vision.found;
        } else {
          await native(page, b, opts);
          rec.acted = true;
        }
      } catch (e) {
        rec.acted = false;
        rec.actError = String(e.message || e).split('\n')[0];
      }

      // VERIFY
      await page.waitForTimeout(500);
      try {
        rec.verify = await verify(page, step.expected, opts);
      } catch (e) {
        rec.verify = { pass: false, why: 'verify-error: ' + String(e.message || e).slice(0, 80) };
      }

      rec.posted = networkState.posted;

      // Hybrid V&V: truth-signal is authoritative when declared
      if (b.truth) {
        const tp = await evalTruthSignal(page, b.truth, networkState).catch(() => false);
        rec.truth = { signal: b.truth, pass: !!tp };
      }

      rec.pass = rec.truth ? rec.truth.pass : !!rec.verify?.pass;
      report.push(rec);

      if (opts.onStep) opts.onStep(rec);
    }
  } catch (e) {
    report.push({ fatal: String(e.message || e).split('\n')[0] });
  } finally {
    page.off('request', onRequest);
  }

  const steps = report.filter((r) => !r.fatal);
  const passed = steps.filter((r) => r.pass).length;
  const total = scenario.steps.length;

  return {
    scenario: scenario.id,
    model: (opts.model || DEFAULTS.model).split('/').pop(),
    snap: opts.snapR ?? DEFAULTS.snapR,
    flowPassed: passed === total,
    stepsPassed: `${passed}/${total}`,
    posted: networkState.posted,
    steps: report.map((r) => r.fatal ? r : {
      i: r.i,
      how: r.how,
      acted: r.acted,
      actError: r.actError,
      visionFound: r.vision ? r.vision.found : undefined,
      clicked: r.vision?.clicked,
      topmost: r.vision?.topmost,
      visionVerify: r.verify?.pass,
      truth: r.truth?.pass,
      pass: r.pass,
      why: r.verify?.why,
      action: r.action,
      expected: r.expected,
    }),
  };
}

// ─── High-level actual-mode executor ──────────────────────────────────────────
//
// Documented /test actual entry point. Accepts the single-object shape the
// test-mode-actual skill uses, owns Playwright browser/context/page lifecycle
// (close in finally), maps documented option names onto the low-level runFlow
// opts, and returns the same RunReport. The low-level runFlow(page, scenario,
// binding, opts) stays the CLI / caller-owns-page surface.
//
// @param {object} options
//   scenario       — parsed scenario object ({ id, steps })           [required]
//   overlay        — validated binding object ({ scenario, steps })   [required]
//   mlxEndpoint    — MLX completions URL        → opts.mlx
//   mlxModel       — MLX model id               → opts.model
//   snapDom        — boolean; false → snapR 0 (DOM-snap OFF per §3)
//   retryLimit     — vision-tap attempt cap     → opts.retryLimit
//   stepTimeoutMs  — per-MLX-request timeout    → opts.timeoutMs
//   baseUrl/coords/viewport/headless — optional overrides
//   page           — optional pre-built Playwright Page (caller owns teardown)
//   onStep         — optional per-step callback

export async function runActualFlow(options = {}) {
  const {
    scenario, overlay,
    mlxEndpoint, mlxModel,
    snapDom = false, retryLimit, stepTimeoutMs,
    baseUrl, coords, viewport, headless = true,
    page: providedPage, onStep,
  } = options;

  if (!scenario || typeof scenario !== 'object') {
    throw new Error('runActualFlow: options.scenario (parsed scenario object) is required');
  }
  if (!overlay || typeof overlay !== 'object') {
    throw new Error('runActualFlow: options.overlay (validated binding object) is required');
  }

  const opts = {
    mlx: mlxEndpoint || DEFAULTS.mlx,
    model: mlxModel || DEFAULTS.model,
    coords: coords || DEFAULTS.coords,
    snapR: snapDom ? (DEFAULTS.snapR || 12) : 0,
    viewport: viewport || DEFAULTS.viewport,
    baseUrl: baseUrl || DEFAULTS.baseUrl,
    retryLimit: retryLimit ?? 3,
    timeoutMs: stepTimeoutMs ?? DEFAULTS.timeoutMs,
    onStep,
  };

  // Caller supplied a page → run directly; caller owns navigation + teardown.
  if (providedPage) {
    return runFlow(providedPage, scenario, overlay, opts);
  }

  // Otherwise own the full Playwright lifecycle.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ viewport: opts.viewport });
    const page = await context.newPage();
    await page.goto(opts.baseUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    return await runFlow(page, scenario, overlay, opts);
  } finally {
    await browser.close();
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
//
// SCENARIO= path or bare id (resolved against <cwd>/scenarios/<id>.yaml)
// BINDING=  path to overlay JSON (default: <cwd>/scenarios/flow-bindings/<id>.json)
// HEADLESS= "false" to show browser

async function main() {
  const { chromium } = await import('playwright');
  const jsYaml = await import('js-yaml').catch(() => null);

  const cwd = process.cwd();
  const scenarioArg = process.env.SCENARIO || 'campaign-compose';
  const headless = (process.env.HEADLESS ?? 'true') !== 'false';
  const vp = DEFAULTS.viewport;

  // Load scenario YAML (bypass loadScenario — runner doesn't enforce mode; am-3 adds live-walk)
  const scenarioPath = scenarioArg.includes('/') || scenarioArg.endsWith('.yaml')
    ? resolve(scenarioArg)
    : resolve(join(cwd, 'scenarios', `${scenarioArg}.yaml`));
  const scenarioRaw = readFileSync(scenarioPath, 'utf8');
  const scenario = jsYaml ? jsYaml.default.load(scenarioRaw) : JSON.parse(scenarioRaw);

  // Load overlay binding
  const bindingPath = process.env.BINDING
    ? resolve(process.env.BINDING)
    : resolveBindingsPath(scenario.id, { cwd });
  const binding = loadBindings(bindingPath, scenario.id);

  const browser = await chromium.launch({ headless });
  const page = await (await browser.newContext({ viewport: vp })).newPage();

  try {
    // Navigate to base URL (auth is caller's responsibility in library mode;
    // for standalone invocation configure session storage or cookie state via Playwright)
    await page.goto(DEFAULTS.baseUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const result = await runFlow(page, scenario, binding, {
      mlx: DEFAULTS.mlx,
      model: DEFAULTS.model,
      coords: DEFAULTS.coords,
      snapR: DEFAULTS.snapR,
      viewport: vp,
      baseUrl: DEFAULTS.baseUrl,
    });

    console.log(JSON.stringify({ arm: 'hive-bridge', ...result }, null, 2));
  } finally {
    await browser.close();
  }
}

// Run when invoked directly
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
