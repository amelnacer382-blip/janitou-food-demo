import type { IncomingMessage, ServerResponse } from 'node:http';
import { ComponentCategory, UnitOfMeasure } from '@janitou/common';
import { readJsonBody, sendJson, sendError } from '../common/http.js';
import { authenticatedStaff } from '../auth/session.js';
import { janitouStore } from '../../services/store.js';
import type { AlternativeType, WorkshopStation } from '../../data/mock-db.js';

export async function handleRecipeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  // Ingredients list
  if (pathname === '/api/v1/ingredients' && method === 'GET') {
    const ingredientsWithStatus = janitouStore.getIngredients().map((ing) => ({
      ...ing,
      isLowStock: ing.currentStock <= ing.minimumThreshold,
      stockDeficit: ing.currentStock <= ing.minimumThreshold ? Math.max(0, ing.minimumThreshold - ing.currentStock) : 0,
    }));
    sendJson(res, 200, { ingredients: ingredientsWithStatus });
    return true;
  }

  // Stock update
  const ingredientStockMatch = pathname.match(/^\/api\/v1\/ingredients\/([^/]+)\/stock$/);
  if (ingredientStockMatch && method === 'PATCH') {
    const ingredientId = ingredientStockMatch[1];
    const body = await readJsonBody<{ currentStock: number }>(req);
    if (typeof body.currentStock !== 'number' || body.currentStock < 0 || isNaN(body.currentStock)) {
      sendError(res, 400, 'Validation Error', 'currentStock must be a valid positive number.');
      return true;
    }
    const updated = janitouStore.updateIngredientStock(ingredientId, body.currentStock);
    if (!updated) {
      sendError(res, 404, 'Not Found', `Ingrédient '${ingredientId}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { ingredient: updated });
    return true;
  }

  // Recipes list & creation
  if (pathname === '/api/v1/recipes') {
    if (method === 'GET') {
      const recipesWithCosts = janitouStore.getRecipes().map((rec) => {
        const costInfo = janitouStore.calculateRecipeCost(rec.id);
        return {
          ...rec,
          costPerPortion: costInfo.costPerPortion,
          ingredientsCostBreakdown: costInfo.breakdown,
        };
      });
      sendJson(res, 200, { recipes: recipesWithCosts });
      return true;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{
        name: string;
        category: ComponentCategory;
        description?: string;
        yieldPortions?: number;
        preparationTimeMinutes?: number;
        allergens?: string[];
        ingredients: { ingredientId: string; quantityPerPortion: number; unit: UnitOfMeasure }[];
      }>(req);

      if (!body.name || !body.category || !Array.isArray(body.ingredients)) {
        sendError(res, 400, 'Validation Error', 'name, category, and ingredients array are required.');
        return true;
      }

      if (body.ingredients.some((i) => typeof i.quantityPerPortion !== 'number' || i.quantityPerPortion <= 0)) {
        sendError(res, 400, 'Validation Error', 'Each ingredient quantityPerPortion must be a positive number.');
        return true;
      }

      const newRecipe = janitouStore.createRecipe({
        name: body.name.trim(),
        category: body.category,
        description: body.description?.trim() || '',
        yieldPortions: body.yieldPortions && body.yieldPortions > 0 ? body.yieldPortions : 1,
        preparationTimeMinutes: body.preparationTimeMinutes && body.preparationTimeMinutes > 0 ? body.preparationTimeMinutes : 30,
        allergens: body.allergens || [],
        ingredients: body.ingredients,
      });

      sendJson(res, 201, { recipe: newRecipe });
      return true;
    }
  }

  // Recipe detail
  const recipeDetailMatch = pathname.match(/^\/api\/v1\/recipes\/([^/]+)$/);
  if (recipeDetailMatch && method === 'GET') {
    const recipeId = recipeDetailMatch[1];
    const recipe = janitouStore.getRecipeById(recipeId);
    if (!recipe) {
      sendError(res, 404, 'Not Found', `Recette '${recipeId}' introuvable.`);
      return true;
    }
    const costInfo = janitouStore.calculateRecipeCost(recipeId);
    sendJson(res, 200, {
      recipe: {
        ...recipe,
        costPerPortion: costInfo.costPerPortion,
        ingredientsCostBreakdown: costInfo.breakdown,
      },
    });
    return true;
  }

  // Pricing simulation
  const recipeSimMatch = pathname.match(/^\/api\/v1\/recipes\/([^/]+)\/pricing-simulation$/);
  if (recipeSimMatch && method === 'GET') {
    const recipeId = recipeSimMatch[1];
    const targetParam = searchParams.get('targetFoodCost');
    const targetPct = targetParam ? parseFloat(targetParam) : 30;

    if (isNaN(targetPct) || targetPct <= 0 || targetPct >= 100) {
      sendError(res, 400, 'Validation Error', 'targetFoodCost must be a percentage between 1 and 99.');
      return true;
    }

    const sim = janitouStore.simulateRecipePricing(recipeId, targetPct);
    if (!sim) {
      sendError(res, 404, 'Not Found', `Recette '${recipeId}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { simulation: sim });
    return true;
  }

  const actor = authenticatedStaff(req);
  const actorRef = actor ? { id: actor.id, name: actor.fullName } : undefined;

  // Full recipe edit — every change snapshots the previous version.
  if (recipeDetailMatch && method === 'PUT') {
    const body = await readJsonBody<{
      name?: string;
      nameAr?: string;
      photoUrl?: string;
      category?: ComponentCategory;
      description?: string;
      yieldPortions?: number;
      preparationTimeMinutes?: number;
      allergens?: string[];
      ingredients?: { ingredientId: string; quantityPerPortion: number; unit: UnitOfMeasure }[];
      price?: number;
      isActive?: boolean;
      family?: string;
      flags?: ('FRIES' | 'MINCED' | 'PASTA')[];
      mainIngredient?: string;
    }>(req);
    if (body.name !== undefined && (body.name.trim().length < 2 || body.name.trim().length > 120)) {
      sendError(res, 400, 'Validation Error', 'Le nom doit contenir entre 2 et 120 caractères.');
      return true;
    }
    if (
      body.category !== undefined &&
      !Object.values(ComponentCategory).includes(body.category)
    ) {
      sendError(res, 400, 'Validation Error', 'Catégorie de plat invalide.');
      return true;
    }
    if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
      sendError(res, 400, 'Validation Error', 'Le prix doit être un nombre positif.');
      return true;
    }
    if (
      body.preparationTimeMinutes !== undefined &&
      (!Number.isInteger(body.preparationTimeMinutes) || body.preparationTimeMinutes <= 0)
    ) {
      sendError(res, 400, 'Validation Error', 'preparationTimeMinutes doit être un entier positif.');
      return true;
    }
    if (body.ingredients !== undefined) {
      if (
        !Array.isArray(body.ingredients) ||
        body.ingredients.some(
          (entry) =>
            !janitouStore.getIngredientById(entry.ingredientId) ||
            typeof entry.quantityPerPortion !== 'number' ||
            entry.quantityPerPortion <= 0
        )
      ) {
        sendError(res, 400, 'Validation Error', 'Ingrédients ou quantités invalides.');
        return true;
      }
    }
    const allowedFlags = ['FRIES', 'MINCED', 'PASTA'] as const;
    const recipe = janitouStore.updateRecipe(
      recipeDetailMatch[1],
      {
        name: body.name,
        nameAr: body.nameAr,
        photoUrl: body.photoUrl,
        category: body.category,
        description: body.description,
        yieldPortions: body.yieldPortions,
        preparationTimeMinutes: body.preparationTimeMinutes,
        allergens: body.allergens,
        ingredients: body.ingredients,
        price: body.price,
        isActive: body.isActive,
        family: body.family,
        flags: Array.isArray(body.flags)
          ? allowedFlags.filter((flag) => body.flags?.includes(flag))
          : undefined,
        mainIngredient: body.mainIngredient,
      },
      actorRef
    );
    if (!recipe) {
      sendError(res, 404, 'Not Found', `Recette '${recipeDetailMatch[1]}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { recipe });
    return true;
  }

  const recipeVersionsMatch = pathname.match(/^\/api\/v1\/recipes\/([^/]+)\/versions$/);
  if (recipeVersionsMatch && method === 'GET') {
    const recipe = janitouStore.getRecipeById(recipeVersionsMatch[1]);
    if (!recipe) {
      sendError(res, 404, 'Not Found', `Recette '${recipeVersionsMatch[1]}' introuvable.`);
      return true;
    }
    sendJson(res, 200, {
      recipeId: recipe.id,
      currentVersion: recipe.version ?? 1,
      versions: janitouStore.getRecipeVersions(recipe.id),
    });
    return true;
  }

  const referencePriceMatch = pathname.match(/^\/api\/v1\/recipes\/([^/]+)\/reference-price$/);
  if (referencePriceMatch && method === 'PATCH') {
    const body = await readJsonBody<{ price?: number }>(req);
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) {
      sendError(res, 400, 'Validation Error', 'price doit être un nombre positif.');
      return true;
    }
    const recipe = janitouStore.updateRecipe(referencePriceMatch[1], { price: body.price }, actorRef);
    if (!recipe) {
      sendError(res, 404, 'Not Found', `Recette '${referencePriceMatch[1]}' introuvable.`);
      return true;
    }
    sendJson(res, 200, { recipe });
    return true;
  }

  // Alternatives — permanent, limited or reservation-based, with a specific price.
  if (pathname === '/api/v1/alternatives') {
    if (method === 'GET') {
      sendJson(res, 200, { alternatives: janitouStore.getAlternatives() });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{
        recipeId?: string;
        customerId?: string;
        type?: AlternativeType;
        price?: number;
        maxPortions?: number;
        station?: WorkshopStation;
        validFrom?: string;
        validTo?: string;
      }>(req);
      if (!body.recipeId || !body.type) {
        sendError(res, 400, 'Validation Error', 'recipeId et type sont requis.');
        return true;
      }
      if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
        sendError(res, 400, 'Validation Error', 'price doit être un nombre positif.');
        return true;
      }
      try {
        const alternative = janitouStore.createAlternative(
          {
            recipeId: body.recipeId,
            customerId: body.customerId,
            type: body.type,
            price: body.price,
            maxPortions: body.maxPortions,
            station: body.station,
            validFrom: body.validFrom,
            validTo: body.validTo,
          },
          actorRef
        );
        sendJson(res, 201, { alternative });
      } catch (error) {
        sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Alternative invalide.');
      }
      return true;
    }
  }

  const alternativeMatch = pathname.match(/^\/api\/v1\/alternatives\/([^/]+)$/);
  if (alternativeMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      price?: number;
      maxPortions?: number;
      isActive?: boolean;
      validFrom?: string;
      validTo?: string;
      station?: WorkshopStation;
    }>(req);
    try {
      const alternative = janitouStore.updateAlternative(
        alternativeMatch[1],
        {
          price: body.price,
          maxPortions: body.maxPortions,
          isActive: body.isActive,
          validFrom: body.validFrom,
          validTo: body.validTo,
          station: body.station,
        },
        actorRef
      );
      if (!alternative) {
        sendError(res, 404, 'Not Found', `Alternative '${alternativeMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, { alternative });
    } catch (error) {
      sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Alternative invalide.');
    }
    return true;
  }

  const alternativeReserveMatch = pathname.match(/^\/api\/v1\/alternatives\/([^/]+)\/reserve$/);
  if (alternativeReserveMatch && method === 'POST') {
    const body = await readJsonBody<{ portions?: number }>(req);
    try {
      const alternative = janitouStore.reserveAlternative(
        alternativeReserveMatch[1],
        body.portions ?? 0,
        actorRef
      );
      if (!alternative) {
        sendError(res, 404, 'Not Found', `Alternative '${alternativeReserveMatch[1]}' introuvable.`);
        return true;
      }
      sendJson(res, 200, { alternative });
    } catch (error) {
      sendError(res, 400, 'Validation Error', error instanceof Error ? error.message : 'Réservation invalide.');
    }
    return true;
  }

  return false;
}
