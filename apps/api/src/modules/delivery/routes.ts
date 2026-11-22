import type { IncomingMessage, ServerResponse } from 'node:http';
import { MealServiceTime } from '@janitou/common';
import { readJsonBody, sendJson, sendError } from '../common/http.js';
import { authenticatedStaff } from '../auth/session.js';
import { janitouStore } from '../../services/store.js';
import type { DbVehicle } from '../../data/mock-db.js';

export async function handleDeliveryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  // Advanced Delivery Run Optimization (Phase 2 - 05)
  if (pathname === '/api/v1/delivery/optimize-runs' && method === 'POST') {
    const body = await readJsonBody<{
      date: string;
      serviceTime: MealServiceTime;
      persist?: boolean;
    }>(req);

    if (!body.date || !body.serviceTime) {
      sendError(res, 400, 'Validation Error', 'date and serviceTime are required.');
      return true;
    }

    const optimization = janitouStore.optimizeDeliveryRuns(
      body.date,
      body.serviceTime,
      Boolean(body.persist)
    );
    sendJson(res, 200, { optimization });
    return true;
  }
  // Delivery runs collection
  if (pathname === '/api/v1/delivery/runs') {
    if (method === 'GET') {
      const date = searchParams.get('date') || undefined;
      sendJson(res, 200, { deliveryRuns: janitouStore.getDeliveryRuns(date) });
      return true;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{
        runDate: string;
        serviceTime: MealServiceTime;
        driverName: string;
        driverPhone: string;
      }>(req);

      if (!body.runDate || !body.serviceTime || !body.driverName || !body.driverPhone) {
        sendError(
          res,
          400,
          'Validation Error',
          'runDate, serviceTime, driverName, and driverPhone are required.'
        );
        return true;
      }

      const run = janitouStore.createDeliveryRun({
        runDate: body.runDate,
        serviceTime: body.serviceTime,
        driverName: body.driverName.trim(),
        driverPhone: body.driverPhone.trim(),
      });
      sendJson(res, 201, { deliveryRun: run });
      return true;
    }
  }

  // Mark stop completed
  const deliveryStopMatch = pathname.match(/^\/api\/v1\/delivery\/runs\/([^/]+)\/stops\/([^/]+)$/);
  if (deliveryStopMatch && method === 'PATCH') {
    const [, runId, stopId] = deliveryStopMatch;
    const body = await readJsonBody<{ comment?: string }>(req);
    const updatedRun = janitouStore.markDeliveryStopCompleted(runId, stopId, body.comment);
    if (!updatedRun) {
      sendError(res, 404, 'Not Found', 'Delivery run or stop not found.');
      return true;
    }
    sendJson(res, 200, { deliveryRun: updatedRun });
    return true;
  }

  // Driver compensation calculation
  const driverCompensationMatch = pathname.match(/^\/api\/v1\/delivery\/runs\/([^/]+)\/compensation$/);
  if (driverCompensationMatch && method === 'GET') {
    const runId = driverCompensationMatch[1];
    const comp = janitouStore.calculateDriverCompensation(runId);
    sendJson(res, 200, { compensation: comp });
    return true;
  }

  // Transfer delivery run to another driver
  const transferRunMatch = pathname.match(/^\/api\/v1\/delivery\/runs\/([^/]+)\/transfer$/);
  if (transferRunMatch && method === 'POST') {
    const runId = transferRunMatch[1];
    const body = await readJsonBody<{ newDriverName: string; newDriverPhone: string; reason?: string }>(req);
    if (!body.newDriverName || !body.newDriverPhone) {
      sendError(res, 400, 'Validation Error', 'newDriverName and newDriverPhone are required.');
      return true;
    }
    const transferred = janitouStore.transferDeliveryRun(
      runId,
      body.newDriverName.trim(),
      body.newDriverPhone.trim(),
      body.reason?.trim() || 'Indisponibilité chauffeur'
    );
    if (!transferred) {
      sendError(res, 404, 'Not Found', `Tournée '${runId}' introuvable.`);
      return true;
    }
    sendJson(res, 200, {
      run: transferred,
      message: `Tournée transférée avec succès à ${body.newDriverName}.`,
    });
    return true;
  }

  const actor = authenticatedStaff(req);
  const actorRef = actor ? { id: actor.id, name: actor.fullName } : undefined;

  // Vehicles and capacity
  if (pathname === '/api/v1/delivery/vehicles') {
    if (method === 'GET') {
      sendJson(res, 200, { vehicles: janitouStore.getVehicles() });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        label?: string;
        type?: DbVehicle['type'];
        capacityMaxPortions?: number;
        plate?: string;
      }>(req);
      if (!body.label || !body.type || !body.capacityMaxPortions) {
        sendError(res, 400, 'Validation Error', 'label, type et capacityMaxPortions sont requis.');
        return true;
      }
      try {
        const vehicle = janitouStore.createVehicle(
          {
            label: body.label,
            type: body.type,
            capacityMaxPortions: body.capacityMaxPortions,
            plate: body.plate,
          },
          actorRef
        );
        sendJson(res, 201, { vehicle });
      } catch (error) {
        sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Véhicule invalide.');
      }
      return true;
    }
  }

  const vehicleMatch = pathname.match(/^\/api\/v1\/delivery\/vehicles\/([^/]+)$/);
  if (vehicleMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      label?: string;
      type?: DbVehicle['type'];
      capacityMaxPortions?: number;
      isActive?: boolean;
      plate?: string;
    }>(req);
    try {
      const vehicle = janitouStore.updateVehicle(
        vehicleMatch[1],
        {
          label: body.label,
          type: body.type,
          capacityMaxPortions: body.capacityMaxPortions,
          isActive: body.isActive,
          plate: body.plate,
        },
        actorRef
      );
      if (!vehicle) {
        sendError(res, 404, 'Not Found', `Véhicule '${vehicleMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, { vehicle });
    } catch (error) {
      sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Véhicule invalide.');
    }
    return true;
  }

  const runLoadMatch = pathname.match(/^\/api\/v1\/delivery\/runs\/([^/]+)\/load$/);
  if (runLoadMatch && method === 'GET') {
    const run = janitouStore.getDeliveryRuns().find((entry) => entry.id === runLoadMatch[1]);
    if (!run) {
      sendError(res, 404, 'Not Found', `Tournée '${runLoadMatch[1]}' introuvable.`);
      return true;
    }
    sendJson(res, 200, {
      runId: run.id,
      loadPortions: janitouStore.calculateRunLoad(run.id),
      capacityMaxPortions: run.capacityMaxPortions,
      vehicle: run.vehicleLabel,
    });
    return true;
  }

  const assignVehicleMatch = pathname.match(/^\/api\/v1\/delivery\/runs\/([^/]+)\/assign-vehicle$/);
  if (assignVehicleMatch && method === 'POST') {
    const body = await readJsonBody<{ vehicleId?: string }>(req);
    if (!body.vehicleId) {
      sendError(res, 400, 'Validation Error', 'vehicleId est requis.');
      return true;
    }
    try {
      const run = janitouStore.assignVehicleToRun(assignVehicleMatch[1], body.vehicleId, actorRef);
      if (!run) {
        sendError(res, 404, 'Not Found', `Tournée '${assignVehicleMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, {
        run,
        loadPortions: janitouStore.calculateRunLoad(run.id),
      });
    } catch (error) {
      sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Affectation invalide.');
    }
    return true;
  }

  return false;
}
