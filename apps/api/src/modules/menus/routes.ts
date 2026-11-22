import type { IncomingMessage, ServerResponse } from 'node:http';
import { MealServiceTime, type AdvancedRulesConfig } from '@janitou/common';
import { readJsonBody, sendJson, sendError, checkRoleAccess } from '../common/http.js';
import { janitouStore } from '../../services/store.js';

export async function handleMenuRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  // Advanced Rules Configuration (Phase 2 - 02)
  if (pathname === '/api/v1/rules/config') {
    if (method === 'GET') {
      sendJson(res, 200, { config: janitouStore.getAdvancedRules() });
      return true;
    }
    if (method === 'PUT') {
      if (!checkRoleAccess(req, ['ADMIN', 'OPERATIONS_MANAGER'])) {
        sendError(res, 403, 'Forbidden', 'Modification des règles réservée aux administrateurs.');
        return true;
      }
      const body = await readJsonBody<Partial<AdvancedRulesConfig>>(req);
      const updated = janitouStore.updateAdvancedRules(body);
      sendJson(res, 200, {
        message: 'Configuration des règles opérationnelles mise à jour avec succès.',
        config: updated,
      });
      return true;
    }
  }

  // Shareable iCalendar Export (Phase 2 - 01)
  if (pathname === '/api/v1/meal-plans/calendar.ics' && method === 'GET') {
    const startDate = searchParams.get('startDate') || undefined;
    const days = parseInt(searchParams.get('days') || '7', 10);
    const icsContent = janitouStore.exportMenuIcal(startDate, days);
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="janitou-menu.ics"',
    });
    res.end(icsContent);
    return true;
  }
  // Weekly Calendar
  if (pathname === '/api/v1/meal-plans/weekly' && method === 'GET') {
    const startDate = searchParams.get('startDate') || undefined;
    const weekly = janitouStore.getWeeklyMenuPlan(startDate);
    sendJson(res, 200, { weekly });
    return true;
  }

  // Validate Menu Rules
  if (pathname === '/api/v1/meal-plans/validate-rules' && method === 'GET') {
    const validation = janitouStore.validateMenuCalendarRules();
    sendJson(res, 200, validation);
    return true;
  }

  // Menu proposal engine — never persisted, the manager validates and saves it.
  if (pathname === '/api/v1/meal-plans/propose' && method === 'POST') {
    const body = await readJsonBody<{ startDate?: string }>(req);
    if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
      sendError(res, 400, 'Validation Error', 'startDate doit être au format YYYY-MM-DD.');
      return true;
    }
    try {
      const proposal = janitouStore.proposeWeeklyMenu(body.startDate);
      sendJson(res, 200, { proposal });
    } catch (error) {
      sendError(
        res,
        400,
        'Validation Error',
        error instanceof Error ? error.message : 'Proposition de menu impossible.'
      );
    }
    return true;
  }

  // Meal Plans list & creation
  if (pathname === '/api/v1/meal-plans') {
    if (method === 'GET') {
      const date = searchParams.get('date') || undefined;
      sendJson(res, 200, { mealPlans: janitouStore.getMealPlans(date) });
      return true;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{
        date: string;
        serviceTime: MealServiceTime;
        starterRecipeId?: string;
        mainCourseRecipeId: string;
        sideDishRecipeId?: string;
        dessertRecipeId?: string;
        notes?: string;
      }>(req);

      if (!body.date || !body.serviceTime || !body.mainCourseRecipeId) {
        sendError(
          res,
          400,
          'Validation Error',
          'date, serviceTime, and mainCourseRecipeId are required.'
        );
        return true;
      }

      const mealPlan = janitouStore.createMealPlan({
        date: body.date,
        serviceTime: body.serviceTime,
        starterRecipeId: body.starterRecipeId,
        mainCourseRecipeId: body.mainCourseRecipeId,
        sideDishRecipeId: body.sideDishRecipeId,
        dessertRecipeId: body.dessertRecipeId,
        notes: body.notes?.trim(),
      });

      sendJson(res, 201, { mealPlan });
      return true;
    }
  }

  return false;
}
