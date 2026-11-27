import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, sendError, sanitizeString } from '../common/http.js';
import { authenticatedStaff } from '../auth/session.js';
import { janitouStore } from '../../services/store.js';
import type { DbPeriodicTask } from '../../data/mock-db.js';

export async function handleTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  if (!pathname.startsWith('/api/v1/tasks')) return false;
  const actor = authenticatedStaff(req);
  const actorRef = actor ? { id: actor.id, name: actor.fullName } : undefined;

  if (pathname === '/api/v1/tasks/periodic') {
    if (method === 'GET') {
      const weekdayParam = searchParams.get('weekday');
      const weekday = weekdayParam !== null ? Number(weekdayParam) : undefined;
      const assigneeId = searchParams.get('assigneeId') || undefined;
      sendJson(res, 200, {
        tasks: janitouStore.listPeriodicTasks({
          weekday: weekday !== undefined && Number.isInteger(weekday) ? weekday : undefined,
          assigneeId,
        }),
      });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        title?: string;
        description?: string;
        department?: string;
        assigneeId?: string;
        assigneeName?: string;
        weekday?: number;
        priority?: DbPeriodicTask['priority'];
        estimatedMinutes?: number;
      }>(req);
      const title = sanitizeString(body.title || '');
      const department = sanitizeString(body.department || '');
      if (
        title.length < 2 ||
        department.length < 2 ||
        typeof body.weekday !== 'number' ||
        !Number.isInteger(body.weekday) ||
        body.weekday < 0 ||
        body.weekday > 6
      ) {
        sendError(res, 400, 'Validation Error', 'title, department et weekday (0-6) requis.');
        return true;
      }
      const task = janitouStore.createPeriodicTask(
        {
          title,
          description: body.description ? sanitizeString(body.description) : undefined,
          department,
          assigneeId: body.assigneeId || actor?.id || 'staff-admin',
          assigneeName: sanitizeString(body.assigneeName || actor?.fullName || 'Équipe'),
          weekday: body.weekday,
          priority: body.priority || 'MEDIUM',
          estimatedMinutes:
            typeof body.estimatedMinutes === 'number' && body.estimatedMinutes > 0
              ? body.estimatedMinutes
              : 30,
        },
        actorRef
      );
      sendJson(res, 201, { task });
      return true;
    }
  }

  const periodicMatch = pathname.match(/^\/api\/v1\/tasks\/periodic\/([^/]+)$/);
  if (periodicMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      status?: DbPeriodicTask['status'];
      assigneeId?: string;
      assigneeName?: string;
      notes?: string;
      weekday?: number;
      priority?: DbPeriodicTask['priority'];
    }>(req);
    const updated = janitouStore.updatePeriodicTask(periodicMatch[1], body, actorRef);
    if (!updated) {
      sendError(res, 404, 'Not Found', `Tâche '${periodicMatch[1]}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { task: updated });
    return true;
  }

  if (pathname === '/api/v1/tasks/printable' && method === 'GET') {
    const date = searchParams.get('date') || new Date().toLocaleDateString('en-CA');
    const assigneeId = searchParams.get('assigneeId') || undefined;
    const sheet = janitouStore.getPrintableTaskSheet(date, assigneeId);
    if (searchParams.get('format') === 'html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(sheet.html);
      return true;
    }
    sendJson(res, 200, sheet);
    return true;
  }

  return false;
}
