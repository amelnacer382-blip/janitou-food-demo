import test from 'node:test';
import assert from 'node:assert/strict';
import { MealServiceTime } from '@janitou/common';
import { JanitouStore } from '../src/services/store.js';

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

test('Phase 1 — work orders, workshop capacity and production variance', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const date = today();
  const created = store.generateWorkOrders(date);
  assert.ok(created.length > 0, 'work orders must be generated from the production plan');
  assert.ok(created.every((order) => order.steps.length === 4));
  assert.ok(created.some((order) => order.workshopId));

  const first = created[0];
  const updated = store.updateWorkOrder(first.id, {
    producedPortions: first.plannedPortions,
    steps: first.steps.map((step) => ({ ...step, done: true })),
  });
  assert.ok(updated);
  assert.equal(updated.producedPortions, first.plannedPortions);
  assert.equal(updated.status, 'COMPLETED');

  const variance = store.getProductionVariance(date);
  assert.ok(variance.totalPlanned > 0);
  assert.ok(variance.totalProduced > 0);
  const line = variance.lines.find((entry) => entry.recipeId === first.recipeId);
  assert.ok(line);
  assert.equal(line.shortage, 0);

  const tinyWorkshop = store.createWorkshop({
    name: 'Atelier test 1 portion',
    station: 'CHAUD',
    capacityPortions: 1,
  });
  const chaudOrder = created.find((order) => order.station === 'CHAUD');
  assert.ok(chaudOrder);
  assert.throws(
    () =>
      store.updateWorkOrder(chaudOrder.id, {
        workshopId: tinyWorkshop.id,
        plannedPortions: 10,
      }),
    /WORKSHOP_CAPACITY_EXCEEDED/
  );
});

test('Phase 1 — vehicle capacity, load and assignment', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const run = store.createDeliveryRun({
    runDate: today(),
    serviceTime: MealServiceTime.LUNCH,
    driverName: 'Chauffeur Test',
    driverPhone: '0555 00 11 22',
  });
  assert.ok(run.stops.length > 0);
  assert.equal(run.loadPortions, store.calculateRunLoad(run.id));
  assert.ok((run.loadPortions ?? 0) > 0);
  assert.ok(run.vehicleId, 'the smallest fitting vehicle is auto-assigned');

  const tooSmall = store.createVehicle({
    label: 'Test 1 portion',
    type: 'MOTO',
    capacityMaxPortions: 1,
  });
  assert.throws(
    () => store.assignVehicleToRun(run.id, tooSmall.id),
    /VEHICLE_CAPACITY_EXCEEDED/
  );

  const truck = store.getVehicles().find((vehicle) => vehicle.type === 'TRUCK');
  assert.ok(truck);
  const assigned = store.assignVehicleToRun(run.id, truck.id);
  assert.ok(assigned);
  assert.equal(assigned.vehicleId, truck.id);
  assert.equal(assigned.loadPortions, store.calculateRunLoad(run.id));
});

test('Phase 1 — recipe versioning keeps the previous snapshot', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const before = store.getRecipeById('rec-1');
  assert.ok(before);
  const beforePrice = before.price;
  const updated = store.updateRecipe('rec-1', { price: 777 });
  assert.ok(updated);
  assert.equal(updated.version, 2);
  assert.equal(updated.price, 777);
  const versions = store.getRecipeVersions('rec-1');
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].snapshot.price, beforePrice);
});

test('Phase 1 — limited alternatives price the order and block when exhausted', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const date = today();
  store.settings.deadlineOverrides[date] = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const customer = store.createClientAccount({
    contactName: 'Client Alternative',
    phone: '0777 55 44 33',
    deliveryAddress: '3 Rue des Alternatives, Alger',
    pinSalt: '',
    pinHash: '',
    active: true,
  });
  const alternative = store.createAlternative({
    recipeId: 'rec-3',
    customerId: customer.id,
    type: 'LIMITED',
    price: 111,
    maxPortions: 2,
  });
  assert.equal(alternative.remainingPortions, 2);

  const order = store.placeClientCatalogueOrder({
    customer,
    date,
    serviceTime: MealServiceTime.LUNCH,
    items: [{ dishId: 'rec-3', portions: 2 }],
    packaging: 'INDIVIDUAL',
    extras: [],
  });
  const item = order.items.find((entry) => entry.recipeId === 'rec-3');
  assert.ok(item);
  assert.equal(item.unitPrice, 111);
  assert.equal(store.getAlternatives()[0].remainingPortions, 0);

  assert.throws(
    () =>
      store.placeClientCatalogueOrder({
        customer,
        date,
        serviceTime: MealServiceTime.LUNCH,
        items: [{ dishId: 'rec-3', portions: 1 }],
        packaging: 'INDIVIDUAL',
        extras: [],
      }),
    /ALTERNATIVE_EXHAUSTED/
  );
});

test('Phase 1 — menu proposal follows rules without writing to the calendar', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const before = store.getMealPlans().length;
  const proposal = store.proposeWeeklyMenu(today());
  assert.equal(proposal.days.length, 7);
  assert.ok(proposal.days.every((day) => day.lunch && day.dinner));
  assert.equal(store.getMealPlans().length, before, 'proposal must stay human-validated');
});

test('Phase 1 — invoice and customer discounts plus reference price', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const invoice = store.getInvoices()[0];
  assert.ok(invoice);
  const discounted = store.applyInvoiceDiscount(invoice.id, 'PERCENT', 10);
  assert.ok(discounted);
  assert.ok(discounted.subtotal);
  assert.equal(
    discounted.totalAmount,
    Math.round((discounted.subtotal * 0.9) * 100) / 100
  );

  const customer = store.setCustomerDiscount('cust-1', 5);
  assert.ok(customer);
  assert.equal(customer.discountPercent, 5);

  const recipe = store.updateRecipe('rec-1', { price: 640 });
  assert.ok(recipe);
  assert.equal(recipe.price, 640);
  assert.equal(store.getRecipeVersions('rec-1').length, 1);
});

test('Phase 1 — collective packaging is derived from the production plan', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const plan = store.calculateProductionNeeds(today());
  assert.ok(plan.totalMealPortions > 0);
  const collective = plan.packagingRequirements.find((entry) =>
    entry.type.startsWith('Bacs Collectifs')
  );
  assert.ok(collective);
  assert.equal(
    collective.quantity,
    Math.ceil(plan.totalMealPortions / store.getSimpleSettings().collectivePackagingSize)
  );
});

test('Phase 1 — backups include the new operational collections', () => {
  const store = new JanitouStore(undefined, { ephemeral: true });
  const backup = store.createDatabaseBackup();
  for (const key of ['vehicles', 'workshops', 'workOrders', 'recipeVersions', 'alternatives']) {
    assert.ok(Array.isArray(backup.data[key]), `${key} must be backed up`);
  }
});
