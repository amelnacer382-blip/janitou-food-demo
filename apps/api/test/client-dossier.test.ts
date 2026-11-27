import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest } from '../src/router.js';
import { janitouStore } from '../src/services/store.js';

function isoToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test('Client Dossier Requirements — Partners, Operational Day, Tasks, Emergency, Security & BR Rules', async (t) => {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => onListening());
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    server.close();
    janitouStore.resetToDefaults();
  });

  const loginStaff = async (email: string, password: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...extra }),
    });
    return { res, body: (await res.json()) as Record<string, unknown> };
  };

  // 1. Decision 011 — ADMIN single active session & trusted devices
  const firstAdmin = await loginStaff('admin@janitou.dz', 'Admin@2026', { trustDevice: 'PC Bureau' });
  assert.equal(firstAdmin.res.status, 200);
  assert.equal(typeof firstAdmin.body.deviceToken, 'string');
  const firstAdminToken = firstAdmin.body.token as string;

  const secondAdmin = await loginStaff('admin@janitou.dz', 'Admin@2026');
  assert.equal(secondAdmin.res.status, 200);
  const adminToken = secondAdmin.body.token as string;

  const oldAdminCheck = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${firstAdminToken}` },
  });
  assert.equal(oldAdminCheck.status, 401, 'Second ADMIN login must invalidate previous ADMIN session');

  const devicesRes = await fetch(`${base}/api/v1/simple/devices`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(devicesRes.status, 200);
  const devicesBody = (await devicesRes.json()) as { devices: { id: string; deviceName: string }[] };
  assert.ok(devicesBody.devices.some((d) => d.deviceName === 'PC Bureau'));

  // 2. Decision 011 — Password reset request & confirmation via WhatsApp outbox
  const opsLogin = await loginStaff('ops@janitou.dz', 'Ops@2026');
  assert.equal(opsLogin.res.status, 200);
  const opsToken = opsLogin.body.token as string;

  const resetReq = await fetch(`${base}/api/v1/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ops@janitou.dz', channel: 'WHATSAPP' }),
  });
  assert.equal(resetReq.status, 200);
  const queuedResetMsg = janitouStore.outboundMessages.find(
    (m) => m.to === '0550 00 00 02' && m.body.includes('Code de réinitialisation')
  );
  assert.ok(queuedResetMsg);
  const codeMatch = queuedResetMsg.body.match(/(\d{6})/);
  assert.ok(codeMatch);

  // Staff without a phone number must not queue an invalid email as WhatsApp recipient
  const noPhoneUser = janitouStore.createStaffUser({
    email: 'nophone@janitou.dz',
    fullName: 'Sans Téléphone',
    role: 'CHEF_KITCHEN',
    password: 'NoPhone@2026',
  });
  const msgCountBefore = janitouStore.outboundMessages.length;
  janitouStore.requestStaffPasswordReset(noPhoneUser.email, 'WHATSAPP');
  assert.equal(janitouStore.outboundMessages.length, msgCountBefore);

  const resetConfirm = await fetch(`${base}/api/v1/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ops@janitou.dz', code: codeMatch[1], newPassword: 'OpsNew@2026' }),
  });
  assert.equal(resetConfirm.status, 200);
  const revokedOps = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${opsToken}` },
  });
  assert.equal(revokedOps.status, 401);
  // Restore original ops password so other tests remain consistent
  const opsRelogin = await loginStaff('ops@janitou.dz', 'OpsNew@2026');
  assert.equal(opsRelogin.res.status, 200);
  janitouStore.updateStaffUser('staff-ops', { password: 'Ops@2026' });

  // 3. DOC-18 bis — Partner producers, quality reception, auto-scoring & alternative holds
  const partnerRes = await fetch(`${base}/api/v1/partners`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: 'Atelier Pâtisserie Casbah',
      contactName: 'Karim',
      phone: '0550 11 22 33',
      specialties: ['Pâtisserie'],
      isExceptional: true,
    }),
  });
  assert.equal(partnerRes.status, 201);
  const { partner } = (await partnerRes.json()) as { partner: { id: string } };

  const missingReason = await fetch(`${base}/api/v1/partners/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      partnerId: partner.id,
      productName: 'Baklawa',
      date: isoToday(),
      quantity: 30,
    }),
  });
  assert.equal(missingReason.status, 400);

  const pOrderRes = await fetch(`${base}/api/v1/partners/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      partnerId: partner.id,
      productName: 'Baklawa',
      date: isoToday(),
      quantity: 30,
      exceptionalReason: 'Surcharge atelier principal',
    }),
  });
  assert.equal(pOrderRes.status, 201);
  const { order: pOrder } = (await pOrderRes.json()) as { order: { id: string } };

  const receiveRes = await fetch(`${base}/api/v1/partners/orders/${pOrder.id}/receive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      status: 'PARTIAL',
      qualityFlags: ['LATE', 'SHORTAGE'],
      failureReason: 'PRODUCTION_LOAD',
      notes: '25 reçues sur 30',
    }),
  });
  assert.equal(receiveRes.status, 200);
  const received = (await receiveRes.json()) as { partner: { metrics: { score: number } } };
  assert.ok(received.partner.metrics.score < 100);

  // Temporary alternative hold
  const altRes = await fetch(`${base}/api/v1/alternatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ recipeId: 'rec-4', type: 'LIMITED', price: 320, maxPortions: 5 }),
  });
  assert.equal(altRes.status, 201);
  const { alternative } = (await altRes.json()) as { alternative: { id: string } };

  const holdCustomerRes = await fetch(`${base}/api/v1/simple/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      contactName: 'Client Hold Test',
      phone: '0559 11 22 33',
      pin: '1234',
      deliveryAddress: '10 Rue Hold, Alger',
    }),
  });
  assert.equal(holdCustomerRes.status, 201);

  const clientLoginRes = await fetch(`${base}/api/v1/client/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0559 11 22 33', pin: '1234' }),
  });
  assert.equal(clientLoginRes.status, 200);
  const clientToken = ((await clientLoginRes.json()) as { token: string }).token;

  const holdRes = await fetch(`${base}/api/v1/client/alternatives/${alternative.id}/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clientToken}` },
    body: JSON.stringify({ portions: 2, ttlMinutes: 10 }),
  });
  assert.equal(holdRes.status, 201);
  const { hold } = (await holdRes.json()) as { hold: { id: string } };
  assert.equal(janitouStore.getAlternatives().find((a) => a.id === alternative.id)?.remainingPortions, 3);

  const releaseRes = await fetch(`${base}/api/v1/client/alternatives/holds/${hold.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert.equal(releaseRes.status, 200);
  assert.equal(janitouStore.getAlternatives().find((a) => a.id === alternative.id)?.remainingPortions, 5);

  // 4. DOC-30 — Operational Day Prep (J-1 prep linked to tomorrow)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const prepRes = await fetch(`${base}/api/v1/production/operational-day/prep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      operationalDate: tomorrow,
      executedDate: isoToday(),
      taskName: 'Coupe légumes couscous',
      quantityNotes: '25 kg',
    }),
  });
  assert.equal(prepRes.status, 201);
  const opDayRes = await fetch(`${base}/api/v1/production/operational-day?date=${tomorrow}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(opDayRes.status, 200);
  const opDay = (await opDayRes.json()) as { prepTasks: { taskName: string }[] };
  assert.ok(opDay.prepTasks.some((p) => p.taskName === 'Coupe légumes couscous'));

  // 5. DOC-36 & Decision 011 §4 — Periodic Tasks & Printable Sheet
  const weekday = new Date(`${isoToday()}T12:00:00`).getDay();
  const taskRes = await fetch(`${base}/api/v1/tasks/periodic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'Désinfection chambre froide',
      department: 'Hygiène',
      weekday,
      priority: 'HIGH',
      estimatedMinutes: 45,
    }),
  });
  assert.equal(taskRes.status, 201);
  const sheetRes = await fetch(`${base}/api/v1/tasks/printable?date=${isoToday()}&format=html`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(sheetRes.status, 200);
  const sheetHtml = await sheetRes.text();
  assert.ok(sheetHtml.includes('Désinfection chambre froide'));

  // 6. Decision 012 & DOC-31 — Human-controlled Emergency & Reconciliation
  const emgRes = await fetch(`${base}/api/v1/emergency/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      severity: 'HIGH',
      suggestedSeverity: 'MEDIUM',
      title: 'Coupure réseau atelier',
      description: 'Bascule procédure papier',
      escalationChain: { primary: 'Ops', backup1: 'Chef', backup2: 'Admin' },
    }),
  });
  assert.equal(emgRes.status, 201);
  const { incident } = (await emgRes.json()) as { incident: { id: string } };

  const conflictRes = await fetch(`${base}/api/v1/emergency/incidents/${incident.id}/conflicts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ description: 'Écart 3 portions client #1' }),
  });
  assert.equal(conflictRes.status, 200);
  const { incident: withConflict } = (await conflictRes.json()) as {
    incident: { conflicts: { id: string }[] };
  };

  const blockedClose = await fetch(`${base}/api/v1/emergency/incidents/${incident.id}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ close: true }),
  });
  assert.equal(blockedClose.status, 409, 'Emergency cannot close while conflicts remain unresolved');

  const resolvedClose = await fetch(`${base}/api/v1/emergency/incidents/${incident.id}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      resolutions: [{ conflictId: withConflict.conflicts[0].id, resolution: 'Ajusté manuellement' }],
      reconciliationNotes: 'Réconciliation complète',
      close: true,
    }),
  });
  assert.equal(resolvedClose.status, 200);
  const closedBody = (await resolvedClose.json()) as { incident: { status: string } };
  assert.equal(closedBody.incident.status, 'CLOSED');

  // 7. BR-019 (extra overrides) & DOC-19 bis (offline config) & configurable self-registration
  const custRes = await fetch(`${base}/api/v1/customers/cust-1/extra-overrides`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ overrides: { حلويات: 10 } }),
  });
  assert.equal(custRes.status, 200);
  assert.equal(janitouStore.getCustomerById('cust-1')?.extraOverrides?.['حلويات'], 10);

  const settingsPut = await fetch(`${base}/api/v1/simple/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      offlineSessionTtlMinutes: 90,
      offlineMaxRetries: 3,
      allowClientSelfRegistration: true,
    }),
  });
  assert.equal(settingsPut.status, 200);

  const cfgRes = await fetch(`${base}/api/v1/client/config`);
  const cfg = (await cfgRes.json()) as {
    settings: { offlineSessionTtlMinutes: number; offlineMaxRetries: number; allowClientSelfRegistration: boolean };
  };
  assert.equal(cfg.settings.offlineSessionTtlMinutes, 90);
  assert.equal(cfg.settings.offlineMaxRetries, 3);
  assert.equal(cfg.settings.allowClientSelfRegistration, true);

  const regRes = await fetch(`${base}/api/v1/client/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactName: 'Nouveau Inscrit',
      phone: '0551 77 88 99',
      pin: '5678',
      deliveryAddress: '15 Rue Liberté, Alger',
    }),
  });
  assert.equal(regRes.status, 201);
  const regBody = (await regRes.json()) as { account: { accountStatus: string } };
  assert.equal(regBody.account.accountStatus, 'PENDING');

  // Reset allowClientSelfRegistration back to false so default expectation stays strict
  await fetch(`${base}/api/v1/simple/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ allowClientSelfRegistration: false }),
  });
});
