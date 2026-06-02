import { test, expect } from '@playwright/test';

// feat-task-modal-resize-001 — the facelift task DetailPane (the right-docked
// pane that opens when you click a task in the kanban/list) can be dragged
// WIDER from its left edge, its default width is the MINIMUM (you can't drag it
// narrower), and the chosen width persists across a reload (localStorage, so it
// also survives a backend restart / re-login since logout only clears the user).
//
// Auth: the board's /api/tasks fetch is requireAuth, so we need real tasks to
// click. Mirror demos.spec.js — seed taskBoardUser with a token from
// process.env.ATRIUM_API_TOKEN (the env var the run-e2e wrapper injects).
// Without it, every spec here is skipped with a clear reason.

const TOKEN = process.env.ATRIUM_API_TOKEN || '';
const SKIP_REASON = 'ATRIUM_API_TOKEN env var not set; cannot exercise auth-required atrium board.';

function decodeUsername(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return json.username || 'agent';
  } catch {
    return 'agent';
  }
}

test.describe('Detail pane resize', () => {
  test.skip(!TOKEN, SKIP_REASON);

  // Runs on EVERY navigation (including reload), so it MUST be idempotent — it
  // must NOT touch taskBoardDetailWidth, or it would wipe the very state under
  // test on reload. The fresh per-test context guarantees we start at the
  // default width. List view: plain <tr> rows, no drag-and-drop, so a synthetic
  // click reliably opens the pane (Board cards are @hello-pangea/dnd Draggables).
  test.beforeEach(async ({ page }) => {
    const username = decodeUsername(TOKEN);
    await page.addInitScript(([token, name]) => {
      localStorage.setItem('taskBoardUser', JSON.stringify({ username: name, token }));
      localStorage.setItem('taskBoardView', 'list');
      localStorage.setItem('taskBoardThemeMigratedToOled', '1');
    }, [TOKEN, username]);
  });

  // Click a row's title (its <td> doesn't stopPropagation) to open the pane.
  const openPane = async (page) => {
    const title = page.getByTestId('task-row-title').first();
    await expect(title).toBeVisible({ timeout: 20_000 });
    await title.click();
    const pane = page.getByTestId('detail-pane');
    await expect(pane).toBeVisible({ timeout: 10_000 });
    return pane;
  };

  // Drag the left-edge handle by dx px (negative = left = grow). Re-reads the
  // handle box each call since it moves with the pane's left edge.
  const dragHandle = async (page, dx) => {
    const handle = page.getByTestId('detail-resize-handle');
    const box = await handle.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy, { steps: 8 });
    await page.mouse.up();
  };

  test('drags wider, enforces the default as the minimum, and persists', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    const pane = await openPane(page);
    const def = (await pane.boundingBox()).width; // default == minimum

    // Drag the edge left → the pane grows.
    await dragHandle(page, -120);
    const grown = (await pane.boundingBox()).width;
    expect(grown).toBeGreaterThan(def + 50);

    // Drag hard the other way → clamps at the default; can't go narrower.
    await dragHandle(page, 400);
    const shrunk = (await pane.boundingBox()).width;
    expect(Math.abs(shrunk - def)).toBeLessThan(8);

    // Grow again, then reload → the width persists (reopen any task; the width
    // is a single global preference, not per-task).
    await dragHandle(page, -120);
    const regrown = (await pane.boundingBox()).width;
    expect(regrown).toBeGreaterThan(def + 50);

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    const pane2 = await openPane(page);
    const persisted = (await pane2.boundingBox()).width;
    expect(persisted).toBeGreaterThan(def + 50);

    // Double-click the handle resets to the default (= minimum) width.
    await page.getByTestId('detail-resize-handle').dblclick();
    const reset = (await pane2.boundingBox()).width;
    expect(Math.abs(reset - def)).toBeLessThan(8);
  });
});
