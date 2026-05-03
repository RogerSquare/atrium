import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Mint an agent JWT signed with the backend's persistent JWT_SECRET
// (backend/.jwt-secret). Agent-token branch in authMiddleware.js only
// requires { agent: true, jti, name } — no user file needs to exist.
function mintAgentJwt() {
  const secretPath = path.resolve(here, '../../../backend/.jwt-secret');
  const secret = fs.readFileSync(secretPath, 'utf-8').trim();
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const payload = enc({
    agent: true,
    jti: `e2e-sidebar-count-${Date.now()}`,
    name: 'e2e-sidebar-count',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

test('sidebar shows total task count matching GET /api/tasks', async ({ page, request }) => {
  const token = mintAgentJwt();
  const userData = { username: 'agent:e2e-sidebar-count', token, role: 'agent' };

  await page.goto('/');
  await page.evaluate((u) => localStorage.setItem('taskBoardUser', JSON.stringify(u)), userData);
  await page.reload();

  const countEl = page.getByTestId('sidebar-task-count');
  await expect(countEl).toBeVisible({ timeout: 20_000 });

  const apiRes = await request.get('/api/tasks', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(apiRes.ok()).toBe(true);
  const tasks = await apiRes.json();

  const text = (await countEl.textContent()) || '';
  const rendered = parseInt(text.match(/\d+/)?.[0] ?? '', 10);
  expect(rendered).toBe(tasks.length);
});
