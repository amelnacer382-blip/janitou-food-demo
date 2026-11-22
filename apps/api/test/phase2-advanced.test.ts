import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest } from '../src/router.js';
import { janitouStore } from '../src/services/store.js';
import { MealServiceTime } from '@janitou/common';

async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => onListening());
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

test('Phase 2 — Advanced Modules & Automation Suite', async (t) => {
  const { base, close } = await startServer();
  t.after(close);
  t.after(() => {
    janitouStore.updateAdvancedRules({
      maxPastaPerWeek: 1,
      allowSameDayFries: false,
      allowSameDayMincedMeat: false,
    });
  });

  const adminToken = await login(base, 'admin@janitou.dz', 'Admin@2026');
  const chefToken = await login(base, 'chef@janitou.dz', 'Chef@2026');

  const authHeaders = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  // 1. Advanced Rules Engine & Dynamic Configuration (02)
  {
    const getRes = await fetch(`${base}/api/v1/rules/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getRes.status, 200);
    const { config } = (await getRes.json()) as { config: { maxPastaPerWeek: number; allowSameDayFries: boolean } };
    assert.equal(config.maxPastaPerWeek, 1);
    assert.equal(config.allowSameDayFries, false);

    // Chef cannot modify rules
    const forbiddenRes = await fetch(`${base}/api/v1/rules/config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${chefToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPastaPerWeek: 3 }),
    });
    assert.equal(forbiddenRes.status, 403);

    // Admin updates rules dynamically
    const putRes = await fetch(`${base}/api/v1/rules/config`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        maxPastaPerWeek: 3,
        allowSameDayFries: true,
      }),
    });
    assert.equal(putRes.status, 200);
    const updated = (await putRes.json()) as { config: { maxPastaPerWeek: number; allowSameDayFries: boolean } };
    assert.equal(updated.config.maxPastaPerWeek, 3);
    assert.equal(updated.config.allowSameDayFries, true);

    // Verify rules are applied in store
    assert.equal(janitouStore.getAdvancedRules().maxPastaPerWeek, 3);
  }

  // 2. Shareable iCalendar Export (01)
  {
    const icsRes = await fetch(`${base}/api/v1/meal-plans/calendar.ics`);
    assert.equal(icsRes.status, 200);
    assert.ok(icsRes.headers.get('content-type')?.includes('text/calendar'));
    const icsContent = await icsRes.text();
    assert.ok(icsContent.includes('BEGIN:VCALENDAR'));
    assert.ok(icsContent.includes('PRODID:-//JANITOU FOOD//Menu Planning Platform//FR'));
    assert.ok(icsContent.includes('END:VCALENDAR'));
  }

  // 3. Advanced Shortage Simulation & Smart Suggestions (04)
  {
    const today = new Date().toISOString().split('T')[0];
    const simRes = await fetch(`${base}/api/v1/production/shortages/simulate?date=${today}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(simRes.status, 200);
    const { simulation } = (await simRes.json()) as {
      simulation: {
        date: string;
        hasShortage: boolean;
        shortages: Array<{ ingredientName: string; suggestedSubstitution?: { name: string } }>;
        impactedOrdersSummary: { totalImpactedOrders: number };
        recommendations: string[];
      };
    };
    assert.equal(simulation.date, today);
    assert.ok(Array.isArray(simulation.shortages));
    assert.ok(Array.isArray(simulation.recommendations));
    assert.ok(simulation.recommendations.length > 0);
  }

  // 4. Advanced Delivery Run Optimization & Multi-Vehicle Clustering (05)
  {
    const today = new Date().toISOString().split('T')[0];
    const optRes = await fetch(`${base}/api/v1/delivery/optimize-runs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        date: today,
        serviceTime: 'LUNCH',
        persist: false,
      }),
    });
    assert.equal(optRes.status, 200);
    const { optimization } = (await optRes.json()) as {
      optimization: {
        date: string;
        totalOrders: number;
        totalMealBoxes: number;
        optimizedRuns: Array<{
          runId: string;
          zoneName: string;
          totalMealBoxes: number;
          stops: unknown[];
          driverCompensationDZD: number;
        }>;
      };
    };
    assert.equal(optimization.date, today);
    assert.ok(Array.isArray(optimization.optimizedRuns));
  }

  // 5. Custom Dynamic Report Builder & CSV Export (08)
  {
    // JSON Report
    const repRes = await fetch(`${base}/api/v1/reports/custom-builder`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Rapport Test Trimestriel',
      }),
    });
    assert.equal(repRes.status, 200);
    const { report } = (await repRes.json()) as {
      report: {
        title: string;
        summary: { ordersCount: number; totalRevenue: number; grossMargin: number };
        records: unknown[];
      };
    };
    assert.equal(report.title, 'Rapport Test Trimestriel');
    assert.ok(report.summary.ordersCount >= 0);

    // CSV Download
    const csvRes = await fetch(`${base}/api/v1/reports/custom-builder/csv`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Export Test CSV',
      }),
    });
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers.get('content-type')?.includes('text/csv'));
    const csv = await csvRes.text();
    assert.ok(csv.includes('RAPPORT'));
    assert.ok(csv.includes('Date'));
  }

  // 6. Immutable Financial Ledger & Proof Chain (06)
  {
    // Record transactions
    janitouStore.recordLedgerEntry({
      type: 'INVOICE_ISSUED',
      referenceId: 'INV-TEST-001',
      customerId: 'cust-1',
      customerName: 'Entreprise Sonatrach',
      debit: 0,
      credit: 55000,
      notes: 'Facture mensuelle catering',
    });

    janitouStore.recordLedgerEntry({
      type: 'PAYMENT_RECEIVED',
      referenceId: 'REC-TEST-001',
      customerId: 'cust-1',
      customerName: 'Entreprise Sonatrach',
      debit: 55000,
      credit: 0,
      notes: 'Règlement par virement bancaire BNA',
    });

    // Check ledger entries
    const ledgerRes = await fetch(`${base}/api/v1/accounting/ledger?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(ledgerRes.status, 200);
    const { entries, count } = (await ledgerRes.json()) as {
      entries: Array<{ previousHash: string; currentHash: string; referenceId: string }>;
      count: number;
    };
    assert.ok(count >= 2);
    assert.ok(entries[0].currentHash);
    assert.ok(entries[0].previousHash);

    // Verify cryptographic integrity
    const verifyRes = await fetch(`${base}/api/v1/accounting/ledger/verify`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(verifyRes.status, 200);
    const { verification } = (await verifyRes.json()) as {
      verification: { isValid: boolean; chainIntact: boolean; totalEntries: number };
    };
    assert.equal(verification.isValid, true);
    assert.equal(verification.chainIntact, true);
    assert.ok(verification.totalEntries >= 2);
  }

  // Cleanup store state
  janitouStore.updateAdvancedRules({
    maxPastaPerWeek: 1,
    allowSameDayFries: false,
    allowSameDayMincedMeat: false,
  });
});
