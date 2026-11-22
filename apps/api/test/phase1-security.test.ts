import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest } from '../src/router.js';

async function startServer(): Promise<{ base: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => resolve());
  await promise;
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(body && typeof body === 'object' && 'token' in body);
  assert.equal(typeof (body as { token: unknown }).token, 'string');
  return (body as { token: string }).token;
}

test('Phase 1 — legacy role matrix, re-authentication and restore validation', async (t) => {
  const { base, close } = await startServer();
  t.after(close);

  const admin = await login(base, 'admin@janitou.dz', 'Admin@2026');
  const chef = await login(base, 'chef@janitou.dz', 'Chef@2026');
  const ops = await login(base, 'ops@janitou.dz', 'Ops@2026');

  // chef cannot read customers, purchasing or audit trails
  {
    for (const path of [
      '/api/v1/customers',
      '/api/v1/purchasing/orders',
      '/api/v1/audit/logs',
      '/api/v1/analytics/financials',
      '/api/v1/system/backup',
    ]) {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${chef}` },
      });
      assert.equal(response.status, 403, `${path} must be forbidden for CHEF_KITCHEN`);
    }
  }

  // chef keeps kitchen, menus and production access
  {
    for (const path of [
      '/api/v1/recipes',
      '/api/v1/meal-plans',
      '/api/v1/production/plan',
      '/api/v1/kds/batches',
    ]) {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${chef}` },
      });
      assert.equal(response.status, 200, `${path} must stay available to CHEF_KITCHEN`);
    }
  }

  // operations manager keeps customer and purchasing access
  {
    for (const path of ['/api/v1/customers', '/api/v1/purchasing/orders', '/api/v1/audit/logs']) {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${ops}` },
      });
      assert.equal(response.status, 200, `${path} must stay available to OPERATIONS_MANAGER`);
    }
  }

  // backup requires an ADMIN password re-authentication
  {
    const without = await fetch(`${base}/api/v1/system/backup`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(without.status, 401);
    const withoutBody: unknown = await without.json();
    assert.ok(withoutBody && typeof withoutBody === 'object' && 'error' in withoutBody);
    assert.equal(withoutBody.error, 'REAUTH_REQUIRED');

    const wrong = await fetch(`${base}/api/v1/system/backup`, {
      headers: { Authorization: `Bearer ${admin}`, 'X-Reauth-Password': 'wrong-password' },
    });
    assert.equal(wrong.status, 401);

    const ok = await fetch(`${base}/api/v1/system/backup`, {
      headers: { Authorization: `Bearer ${admin}`, 'X-Reauth-Password': 'Admin@2026' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
  }

  // restore is ADMIN-only, re-authenticated and validated
  {
    const chefAttempt = await fetch(`${base}/api/v1/system/restore`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chef}`,
        'Content-Type': 'application/json',
        'X-Reauth-Password': 'Chef@2026',
      },
      body: JSON.stringify({ data: {} }),
    });
    assert.equal(chefAttempt.status, 403);

    const noReauth = await fetch(`${base}/api/v1/system/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    assert.equal(noReauth.status, 401);

    const invalid = await fetch(`${base}/api/v1/system/restore`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${admin}`,
        'Content-Type': 'application/json',
        'X-Reauth-Password': 'Admin@2026',
      },
      body: JSON.stringify({ data: { orders: 'not-an-array' } }),
    });
    assert.equal(invalid.status, 400);

    const missingAdmin = await fetch(`${base}/api/v1/system/restore`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${admin}`,
        'Content-Type': 'application/json',
        'X-Reauth-Password': 'Admin@2026',
      },
      body: JSON.stringify({
        data: {
          staffUsers: [
            {
              id: 'only-chef',
              email: 'chef@janitou.dz',
              role: 'CHEF_KITCHEN',
              passwordSalt: '00',
              passwordHash: '00',
              isActive: true,
            },
          ],
        },
      }),
    });
    assert.equal(missingAdmin.status, 400);
  }
});
