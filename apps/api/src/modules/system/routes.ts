import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, sendError, checkRoleAccess } from '../common/http.js';
import { janitouStore } from '../../services/store.js';
import { authenticatedStaff, reauthenticate } from '../auth/session.js';
import { openApiSpec, renderSwaggerHtml } from './openapi.js';

export async function handleSystemRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  // Health checks
  if (pathname === '/health' || pathname === '/api/health') {
    const dbHealth = janitouStore.getDatabaseHealth();
    sendJson(res, 200, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'JANITOU FOOD API',
      version: '1.0.0',
      database: dbHealth,
    });
    return true;
  }

  if (pathname === '/api/docs' && (method === 'GET' || method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(renderSwaggerHtml());
    return true;
  }
  if ((pathname === '/api/v1/openapi.json' || pathname === '/api/openapi.json') && method === 'GET') {
    sendJson(res, 200, openApiSpec);
    return true;
  }

  // API Discovery
  if ((pathname === '/api' || pathname === '/api/v1') && method === 'GET') {
    sendJson(res, 200, {
      name: 'JANITOU FOOD Management API',
      version: 'v1',
      description: 'Meal Management, Production and Distribution Platform',
      documentation: '/api/docs',
      openapi: '/api/v1/openapi.json',
      endpoints: {
        customers: '/api/v1/customers',
        ingredients: '/api/v1/ingredients',
        recipes: '/api/v1/recipes',
        mealPlans: '/api/v1/meal-plans',
        orders: '/api/v1/orders',
        productionPlan: '/api/v1/production/plan?date=YYYY-MM-DD',
        productionAutoPurchase: '/api/v1/production/auto-purchase-orders',
        purchasingOrders: '/api/v1/purchasing/orders',
        purchasingSuppliers: '/api/v1/purchasing/suppliers',
        deliveryRuns: '/api/v1/delivery/runs',
        reports: '/api/v1/reports',
        financials: '/api/v1/analytics/financials',
      },
    });
    return true;
  }

  // Audit Logs
  if (pathname === '/api/v1/audit/logs' && method === 'GET') {
    const entityType = searchParams.get('entityType') || undefined;
    const action = searchParams.get('action') || undefined;
    const logs = janitouStore.getAuditLogs({ entityType, action });
    sendJson(res, 200, { logs, count: logs.length });
    return true;
  }

  // Emergency Workshop Package
  if (pathname === '/api/v1/emergency/workshop-package' && method === 'GET') {
    const date = searchParams.get('date') || undefined;
    const emergencyPkg = janitouStore.generateEmergencyWorkshopPackage(date);
    sendJson(res, 200, { emergencyPackage: emergencyPkg });
    return true;
  }

  // Decision 012 & DOC-31: Human-controlled emergency activation & post-recovery reconciliation
  if (pathname === '/api/v1/emergency/incidents' && method === 'GET') {
    sendJson(res, 200, { incidents: janitouStore.listEmergencyIncidents() });
    return true;
  }

  if (pathname === '/api/v1/emergency/activate' && method === 'POST') {
    const staff = authenticatedStaff(req);
    if (!staff) {
      sendError(res, 401, 'Unauthorized', 'Session staff requise.');
      return true;
    }
    const body = await readJsonBody<{
      severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      suggestedSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      title?: string;
      description?: string;
      escalationChain?: { primary?: string; backup1?: string; backup2?: string };
    }>(req);
    const valid = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    if (
      !body.severity ||
      !valid.has(body.severity) ||
      !body.title ||
      !body.escalationChain?.primary ||
      !body.escalationChain?.backup1 ||
      !body.escalationChain?.backup2
    ) {
      sendError(
        res,
        400,
        'Validation Error',
        'severity, title et escalationChain (primary, backup1, backup2) requis.'
      );
      return true;
    }
    const incident = janitouStore.activateEmergencyIncident(
      {
        severity: body.severity,
        suggestedSeverity: body.suggestedSeverity,
        title: body.title.trim(),
        description: (body.description || '').trim(),
        escalationChain: {
          primary: body.escalationChain.primary,
          backup1: body.escalationChain.backup1,
          backup2: body.escalationChain.backup2,
        },
      },
      { id: staff.id, name: staff.fullName }
    );
    sendJson(res, 201, { incident });
    return true;
  }

  const emgConflictMatch = pathname.match(/^\/api\/v1\/emergency\/incidents\/([^/]+)\/conflicts$/);
  if (emgConflictMatch && method === 'POST') {
    const staff = authenticatedStaff(req);
    if (!staff) {
      sendError(res, 401, 'Unauthorized', 'Session staff requise.');
      return true;
    }
    const body = await readJsonBody<{ description?: string }>(req);
    if (!body.description || !body.description.trim()) {
      sendError(res, 400, 'Validation Error', 'description requise.');
      return true;
    }
    const incident = janitouStore.addEmergencyConflict(emgConflictMatch[1], body.description.trim(), {
      id: staff.id,
      name: staff.fullName,
    });
    if (!incident) {
      sendError(res, 404, 'Not Found', 'Incident introuvable.');
      return true;
    }
    sendJson(res, 200, { incident });
    return true;
  }

  const emgResolveMatch = pathname.match(/^\/api\/v1\/emergency\/incidents\/([^/]+)\/resolve$/);
  if (emgResolveMatch && method === 'PATCH') {
    const staff = authenticatedStaff(req);
    if (!staff) {
      sendError(res, 401, 'Unauthorized', 'Session staff requise.');
      return true;
    }
    const body = await readJsonBody<{
      resolutions?: { conflictId: string; resolution: string }[];
      reconciliationNotes?: string;
      close?: boolean;
    }>(req);
    try {
      const incident = janitouStore.resolveEmergencyIncident(emgResolveMatch[1], body, {
        id: staff.id,
        name: staff.fullName,
      });
      if (!incident) {
        sendError(res, 404, 'Not Found', 'Incident introuvable.');
        return true;
      }
      sendJson(res, 200, { incident });
    } catch (error) {
      sendError(res, 409, 'Conflict', error instanceof Error ? error.message : 'Conflits non résolus.');
    }
    return true;
  }

  // System Backup — ADMIN + password re-authentication, fully audited.
  if (pathname === '/api/v1/system/backup' && method === 'GET') {
    const staff = authenticatedStaff(req);
    if (!staff || !checkRoleAccess(req, ['ADMIN'])) {
      sendError(res, 403, 'Forbidden', 'Opération réservée aux administrateurs.');
      return true;
    }
    if (!reauthenticate(req, staff)) {
      sendError(res, 401, 'REAUTH_REQUIRED', 'Confirmez votre mot de passe pour exporter la sauvegarde.');
      return true;
    }
    const backup = janitouStore.createDatabaseBackup();
    janitouStore.recordAuditEntry(
      { id: staff.id, name: staff.fullName },
      'EXPORT_BACKUP',
      'DATABASE',
      'main',
      undefined,
      { timestamp: backup.timestamp, collections: Object.keys(backup.data) }
    );
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="janitou-backup-${new Date().toLocaleDateString('en-CA')}.json"`,
    });
    res.end(JSON.stringify(backup, null, 2));
    return true;
  }

  // System Restore — ADMIN + password re-authentication, validated, audited.
  if (pathname === '/api/v1/system/restore' && method === 'POST') {
    const staff = authenticatedStaff(req);
    if (!staff || !checkRoleAccess(req, ['ADMIN'])) {
      sendError(res, 403, 'Forbidden', 'Opération réservée aux administrateurs.');
      return true;
    }
    if (!reauthenticate(req, staff)) {
      sendError(res, 401, 'REAUTH_REQUIRED', 'Confirmez votre mot de passe pour restaurer la base.');
      return true;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendError(res, 400, 'Restore Error', 'Corps JSON invalide.');
      return true;
    }
    const ok = await janitouStore.restoreDatabaseFromBackup(body, {
      id: staff.id,
      name: staff.fullName,
    });
    if (!ok) {
      sendError(
        res,
        400,
        'Restore Error',
        'Format de sauvegarde invalide ou compte administrateur actif manquant.'
      );
      return true;
    }
    sendJson(res, 200, { message: 'Restauration complète de la base effectuée avec succès.' });
    return true;
  }

  return false;
}
