import type { IncomingMessage, ServerResponse } from 'node:http';
import { MealServiceTime } from '@janitou/common';
import { readJsonBody, sendJson, sendError } from '../common/http.js';
import { authenticatedStaff } from '../auth/session.js';
import { janitouStore, type ProductionVariance } from '../../services/store.js';
import type { DbWorkOrder, DbWorkOrderStep, WorkshopStation } from '../../data/mock-db.js';

export async function handleProductionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  // Production Planning
  if (pathname === '/api/v1/production/plan' && method === 'GET') {
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const serviceTimeParam = searchParams.get('serviceTime');
    const serviceTime = serviceTimeParam ? (serviceTimeParam as MealServiceTime) : undefined;

    const plan = janitouStore.calculateProductionNeeds(date, serviceTime);
    sendJson(res, 200, { plan });
    return true;
  }

  // Advanced Shortage Simulation & Smart Substitutions (Phase 2 - 04)
  if (pathname === '/api/v1/production/shortages/simulate') {
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const serviceTimeParam = searchParams.get('serviceTime');
    const serviceTime = serviceTimeParam ? (serviceTimeParam as MealServiceTime) : undefined;
    const simulation = janitouStore.simulateShortages(date, serviceTime);
    sendJson(res, 200, { simulation });
    return true;
  }

  // Auto PO generation from deficits
  if (pathname === '/api/v1/production/auto-purchase-orders' && method === 'POST') {
    const body = await readJsonBody<{ date: string; serviceTime?: MealServiceTime }>(req);
    if (!body.date) {
      sendError(res, 400, 'Validation Error', 'date is required.');
      return true;
    }
    const createdPOs = janitouStore.generatePurchaseOrdersFromDeficits(body.date, body.serviceTime);
    sendJson(res, 201, {
      message: `${createdPOs.length} purchase orders generated from calculated ingredient deficits.`,
      purchaseOrders: createdPOs,
    });
    return true;
  }

  // Thermal Packaging Labels
  if (pathname === '/api/v1/packaging/labels' && method === 'GET') {
    const date = searchParams.get('date');
    const orderId = searchParams.get('orderId');
    const labels = orderId
      ? janitouStore.generatePackagingLabels(orderId, true)
      : janitouStore.generatePackagingLabels(date || undefined, false);
    sendJson(res, 200, { labels, count: labels.length });
    return true;
  }

  // KDS Batches
  if (pathname === '/api/v1/kds/batches' && method === 'GET') {
    const date = searchParams.get('date') || undefined;
    const batches = janitouStore.getKdsBatches(date);
    sendJson(res, 200, { batches });
    return true;
  }

  const kdsStageMatch = pathname.match(/^\/api\/v1\/kds\/batches\/([^/]+)\/stage$/);
  if (kdsStageMatch && method === 'PATCH') {
    const batchId = kdsStageMatch[1];
    const body = await readJsonBody<{ stage: 'TO_PREPARE' | 'COOKING' | 'PACKAGING' | 'READY' }>(req);
    const validStages = ['TO_PREPARE', 'COOKING', 'PACKAGING', 'READY'];
    if (!body.stage || !validStages.includes(body.stage)) {
      sendError(res, 400, 'Validation Error', `Invalid stage. Valid stages: ${validStages.join(', ')}`);
      return true;
    }
    const updated = janitouStore.updateKdsBatchStage(batchId, body.stage);
    if (!updated) {
      sendError(res, 404, 'Not Found', `Batch '${batchId}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { batch: updated });
    return true;
  }

  const actor = authenticatedStaff(req);
  const actorRef = actor ? { id: actor.id, name: actor.fullName } : undefined;

  // Work orders — generated from the production plan, then adjusted by the workshop lead.
  if (pathname === '/api/v1/production/work-orders' && method === 'GET') {
    const date = searchParams.get('date') || undefined;
    const serviceTime = searchParams.get('serviceTime') as MealServiceTime | null;
    sendJson(res, 200, {
      workOrders: janitouStore.getWorkOrders(date || undefined, serviceTime || undefined),
    });
    return true;
  }

  if (pathname === '/api/v1/production/work-orders/generate' && method === 'POST') {
    const body = await readJsonBody<{ date?: string; serviceTime?: MealServiceTime }>(req);
    const date = body.date || new Date().toLocaleDateString('en-CA');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      sendError(res, 400, 'Validation Error', 'date doit être au format YYYY-MM-DD.');
      return true;
    }
    const created = janitouStore.generateWorkOrders(date, body.serviceTime);
    sendJson(res, 201, {
      date,
      created: created.length,
      workOrders: janitouStore.getWorkOrders(date, body.serviceTime),
    });
    return true;
  }

  const workOrderMatch = pathname.match(/^\/api\/v1\/production\/work-orders\/([^/]+)$/);
  if (workOrderMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      plannedPortions?: number;
      producedPortions?: number;
      status?: DbWorkOrder['status'];
      steps?: DbWorkOrderStep[];
      notes?: string;
      workshopId?: string | null;
    }>(req);
    try {
      const updated = janitouStore.updateWorkOrder(
        workOrderMatch[1],
        {
          plannedPortions: body.plannedPortions,
          producedPortions: body.producedPortions,
          status: body.status,
          steps: body.steps,
          notes: body.notes,
          workshopId: body.workshopId,
        },
        actorRef
      );
      if (!updated) {
        sendError(res, 404, 'Not Found', `Ordre de travail '${workOrderMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, { workOrder: updated });
    } catch (error) {
      sendError(
        res,
        400,
        'Validation Error',
        error instanceof Error ? error.message : 'Ordre de travail invalide.'
      );
    }
    return true;
  }

  if (pathname === '/api/v1/production/variance' && method === 'GET') {
    const date = searchParams.get('date') || new Date().toLocaleDateString('en-CA');
    const serviceTime = (searchParams.get('serviceTime') as MealServiceTime) || undefined;
    const variance: ProductionVariance = janitouStore.getProductionVariance(date, serviceTime);
    sendJson(res, 200, { variance });
    return true;
  }

  // Workshops — capacity, station and assignment.
  if (pathname === '/api/v1/production/workshops') {
    if (method === 'GET') {
      sendJson(res, 200, { workshops: janitouStore.getWorkshops() });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        name?: string;
        station?: WorkshopStation;
        capacityPortions?: number;
        notes?: string;
      }>(req);
      if (!body.name || !body.name.trim() || !body.station || !body.capacityPortions) {
        sendError(res, 400, 'Validation Error', 'name, station et capacityPortions sont requis.');
        return true;
      }
      try {
        const workshop = janitouStore.createWorkshop(
          {
            name: body.name,
            station: body.station,
            capacityPortions: body.capacityPortions,
            notes: body.notes,
          },
          actorRef
        );
        sendJson(res, 201, { workshop });
      } catch (error) {
        sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Atelier invalide.');
      }
      return true;
    }
  }

  const workshopMatch = pathname.match(/^\/api\/v1\/production\/workshops\/([^/]+)$/);
  if (workshopMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      name?: string;
      station?: WorkshopStation;
      capacityPortions?: number;
      isActive?: boolean;
      notes?: string;
    }>(req);
    try {
      const workshop = janitouStore.updateWorkshop(
        workshopMatch[1],
        {
          name: body.name,
          station: body.station,
          capacityPortions: body.capacityPortions,
          isActive: body.isActive,
          notes: body.notes,
        },
        actorRef
      );
      if (!workshop) {
        sendError(res, 404, 'Not Found', `Atelier '${workshopMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, { workshop });
    } catch (error) {
      sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Atelier invalide.');
    }
    return true;
  }

  return false;
}
