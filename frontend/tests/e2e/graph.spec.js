import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// bug-graph-behavior-001 — graph viewport behavior: recenter on first load
// (including the seeded-positions path that used to skip it entirely) and
// resize stability (physics freezes during the burst; a hand-taken camera
// survives). The graph is canvas-rendered, so assertions go through the
// window.__atriumGraphNet test hook the build effect exposes.

const NOW = new Date().toISOString();
const task = (id, extra = {}) => ({
  id, title: id, status: 'todo', priority: 'medium', project: 'Alpha', type: 'backend',
  tags: [], files_affected: [], depends_on: [], activity_log: [{ timestamp: NOW, action: 'x' }],
  content: '### Description\nx\n\n### Comments\n', assignee: null, created_at: NOW, ...extra,
});
const TASKS = [
  task('feat-g-001'), task('feat-g-002', { parent_task: 'feat-g-001' }),
  task('feat-g-003', { depends_on: ['feat-g-001'] }), task('bug-g-004'),
  task('ui-g-005'), task('devops-g-006'),
];

async function netStats(page) {
  return page.evaluate(() => {
    const net = window.__atriumGraphNet;
    if (!net) return null;
    const pos = net.getPositions();
    const ids = Object.keys(pos);
    if (!ids.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = pos[id];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const view = net.getViewPosition();
    return {
      positions: pos,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      view,
      scale: net.getScale(),
      physicsEnabled: net.physics.options.enabled,
    };
  });
}

test.describe('Graph view behavior', () => {
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page);
    await page.route('**/api/tasks', (r) => r.fulfill({ json: TASKS }));
  });

  test('first load recenters even with seeded positions (the skipped-stabilization path)', async ({ page }) => {
    // Any saved position disables stabilization — the path that previously
    // never fit. Seed one far from origin to make an off-center camera obvious.
    await page.addInitScript(seedSession, { storage: {
      taskBoardView: 'graph',
      'atrium-graph-positions-v1': JSON.stringify({ 'feat-g-001': { x: 4000, y: 4000 } }),
    } });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__atriumGraphNet, null, { timeout: 20_000 });
    // Seeded layouts start FROZEN for ~500ms: rendered exactly as saved and
    // centered by the first-draw fit. Measure inside that window — the view
    // should sit on the content center almost exactly.
    await page.waitForTimeout(250);

    const s = await netStats(page);
    expect(s).not.toBeNull();
    expect(s.physicsEnabled).toBe(false); // startup freeze active
    expect(Math.abs(s.view.x - s.center.x)).toBeLessThan(60);
    expect(Math.abs(s.view.y - s.center.y)).toBeLessThan(60);
    expect(s.scale).toBeGreaterThan(0.05);

    // Physics wakes after the freeze — the graph starts breathing.
    await page.waitForTimeout(600);
    expect((await netStats(page)).physicsEnabled).toBe(true);
  });

  test('resize freezes node positions and re-enables physics after settling', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'graph' } });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__atriumGraphNet, null, { timeout: 20_000 });
    await page.waitForTimeout(1200); // let stabilization + fit settle

    const before = await netStats(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(120); // inside the freeze window

    const during = await netStats(page);
    expect(during.physicsEnabled).toBe(false); // frozen mid-burst
    let maxDelta = 0;
    for (const id of Object.keys(before.positions)) {
      const a = before.positions[id];
      const b = during.positions[id];
      if (!b) continue;
      maxDelta = Math.max(maxDelta, Math.hypot(b.x - a.x, b.y - a.y));
    }
    // A frame or two of live motion can land between the capture and the
    // freeze engaging — single-digit px is stillness; thrash was tens+.
    expect(maxDelta).toBeLessThan(10);

    await page.waitForTimeout(500);
    const after = await netStats(page);
    expect(after.physicsEnabled).toBe(true); // motion resumes once settled
  });

  test('a hand-zoomed camera survives a resize (no auto-fit fight)', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'graph' } });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__atriumGraphNet, null, { timeout: 20_000 });
    await page.waitForTimeout(1200);

    // The Zoom-in control is explicit user intent (it sets the user-owns-
    // the-camera flag) — and a deterministic way to take the camera in a
    // test, where synthetic wheel events don't reach vis-network's legacy
    // mousewheel listeners.
    // Late resize-observer ticks (layout settling under suite load) can land
    // an auto-fit seconds after mount — wait for the camera to hold still so
    // the baseline isn't captured mid-churn.
    let pre = await netStats(page);
    await expect.poll(async () => {
      const now = await netStats(page);
      const stable = Math.abs(now.scale - pre.scale) < 0.001;
      pre = now;
      return stable;
    }, { timeout: 10_000, intervals: [400] }).toBe(true);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    // Poll, not a fixed sleep — the 200ms moveTo animation stretches under
    // parallel-suite CPU load.
    await expect.poll(async () => (await netStats(page)).scale, { timeout: 5000 })
      .toBeGreaterThan(pre.scale * 1.1);
    const zoomed = await netStats(page);

    // Count camera commands from here on. vis itself compensates scale on
    // canvas resize to preserve the framed content — the contract under test
    // is that OUR code issues no fit/moveTo against a user-owned camera.
    await page.evaluate(() => {
      const net = window.__atriumGraphNet;
      window.__cameraCalls = 0;
      const of = net.fit.bind(net);
      net.fit = (...a) => { window.__cameraCalls++; return of(...a); };
      const om = net.moveTo.bind(net);
      net.moveTo = (...a) => { window.__cameraCalls++; return om(...a); };
    });

    await page.setViewportSize({ width: 1000, height: 640 });
    await page.waitForTimeout(600); // past debounce — a fit would have landed by now

    expect(await page.evaluate(() => window.__cameraCalls)).toBe(0);
  });
});
