import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, sendError, sanitizeString } from '../common/http.js';
import { authenticatedStaff } from '../auth/session.js';
import { janitouStore } from '../../services/store.js';
import type { PartnerFailureReason, PartnerQualityFlag } from '../../data/mock-db.js';

const QUALITY_FLAGS = new Set<PartnerQualityFlag>([
  'MATCH',
  'SHORTAGE',
  'LATE',
  'QUALITY_ISSUE',
  'PACKAGING_ISSUE',
  'WRONG_PRODUCT',
  'REFUSED',
]);

const FAILURE_REASONS = new Set<PartnerFailureReason>([
  'RAW_MATERIAL_SHORTAGE',
  'PRODUCTION_LOAD',
  'STAFF_SHORTAGE',
  'EQUIPMENT_FAILURE',
  'SUPPLIER_DELAY',
  'TRANSPORT_ISSUE',
  'OTHER',
]);

export async function handlePartnerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  if (!pathname.startsWith('/api/v1/partners')) return false;
  const actor = authenticatedStaff(req);
  const actorRef = actor ? { id: actor.id, name: actor.fullName } : undefined;

  if (pathname === '/api/v1/partners') {
    if (method === 'GET') {
      sendJson(res, 200, { partners: janitouStore.listPartnerProducers() });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        name?: string;
        contactName?: string;
        phone?: string;
        specialties?: string[];
        isExceptional?: boolean;
      }>(req);
      const name = sanitizeString(body.name || '');
      const contactName = sanitizeString(body.contactName || '');
      const phone = sanitizeString(body.phone || '');
      if (name.length < 2 || contactName.length < 2 || phone.length < 6) {
        sendError(res, 400, 'Validation Error', 'name, contactName et phone sont requis.');
        return true;
      }
      const partner = janitouStore.createPartnerProducer(
        {
          name,
          contactName,
          phone,
          specialties: Array.isArray(body.specialties)
            ? body.specialties.map((s) => sanitizeString(String(s))).filter(Boolean)
            : [],
          isExceptional: Boolean(body.isExceptional),
        },
        actorRef
      );
      sendJson(res, 201, { partner });
      return true;
    }
  }

  const partnerMatch = pathname.match(/^\/api\/v1\/partners\/([^/]+)$/);
  if (partnerMatch && partnerMatch[1] !== 'orders' && method === 'PATCH') {
    const body = await readJsonBody<{ isActive?: boolean; specialties?: string[] }>(req);
    const updated = janitouStore.updatePartnerProducer(partnerMatch[1], body, actorRef);
    if (!updated) {
      sendError(res, 404, 'Not Found', `Partenaire '${partnerMatch[1]}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { partner: updated });
    return true;
  }

  if (pathname === '/api/v1/partners/orders') {
    if (method === 'GET') {
      const date = searchParams.get('date') || undefined;
      sendJson(res, 200, { orders: janitouStore.listPartnerSupplyOrders(date) });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        partnerId?: string;
        productName?: string;
        recipeId?: string;
        date?: string;
        quantity?: number;
        exceptionalReason?: string;
        notes?: string;
      }>(req);
      if (
        !body.partnerId ||
        !body.productName ||
        !body.date ||
        typeof body.quantity !== 'number' ||
        !Number.isInteger(body.quantity) ||
        body.quantity < 1
      ) {
        sendError(res, 400, 'Validation Error', 'partnerId, productName, date et quantity >= 1 requis.');
        return true;
      }
      try {
        const order = janitouStore.createPartnerSupplyOrder(
          {
            partnerId: body.partnerId,
            productName: sanitizeString(body.productName),
            recipeId: body.recipeId,
            date: body.date,
            quantity: body.quantity,
            exceptionalReason: body.exceptionalReason ? sanitizeString(body.exceptionalReason) : undefined,
            notes: body.notes ? sanitizeString(body.notes) : undefined,
          },
          actorRef
        );
        sendJson(res, 201, { order });
      } catch (error) {
        sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Commande partenaire invalide.');
      }
      return true;
    }
  }

  const receiveMatch = pathname.match(/^\/api\/v1\/partners\/orders\/([^/]+)\/receive$/);
  if (receiveMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      status?: 'RECEIVED' | 'PARTIAL' | 'REFUSED' | 'FAILED';
      qualityFlags?: PartnerQualityFlag[];
      failureReason?: PartnerFailureReason;
      notes?: string;
    }>(req);
    const validStatuses = new Set(['RECEIVED', 'PARTIAL', 'REFUSED', 'FAILED']);
    if (!body.status || !validStatuses.has(body.status)) {
      sendError(res, 400, 'Validation Error', 'status invalide.');
      return true;
    }
    const flags = Array.isArray(body.qualityFlags)
      ? body.qualityFlags.filter((flag): flag is PartnerQualityFlag => QUALITY_FLAGS.has(flag))
      : ['MATCH' as PartnerQualityFlag];
    if (body.failureReason && !FAILURE_REASONS.has(body.failureReason)) {
      sendError(res, 400, 'Validation Error', 'failureReason invalide.');
      return true;
    }
    try {
      const updated = janitouStore.receivePartnerSupplyOrder(
        receiveMatch[1],
        {
          status: body.status,
          qualityFlags: flags,
          failureReason: body.failureReason,
          notes: body.notes ? sanitizeString(body.notes) : undefined,
        },
        actorRef
      );
      if (!updated) {
        sendError(res, 404, 'Not Found', `Commande partenaire '${receiveMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, updated);
    } catch (error) {
      sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Réception invalide.');
    }
    return true;
  }

  return false;
}
