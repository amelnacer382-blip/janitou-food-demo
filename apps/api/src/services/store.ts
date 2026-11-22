import {
  MealServiceTime,
  OrderStatus,
  ComponentCategory,
  UnitOfMeasure,
  type AdvancedRulesConfig,
  type ShortageSimulationResult,
  type ShortageItem,
  type DeliveryOptimizationResult,
  type OptimizedRunAssignment,
  type CustomReportQuery,
  type CustomReportResult,
  type ImmutableLedgerEntry,
  type LedgerVerificationResult,
} from '@janitou/common';
import {
  createStateBackend,
  type DatabaseHealth,
  type DatabaseState,
  type StateBackend,
} from '@janitou/database';
import { createHash, randomUUID } from 'node:crypto';
import {
  DbSupplier,
  DbIngredient,
  DbRecipe,
  DbCustomer,
  DbMealPlan,
  DbOrder,
  DbOrderItem,
  DbProductionBatch,
  DbPurchaseOrder,
  DbDeliveryRun,
  DbDeliveryStop,
  DbInvoice,
  DbPayment,
  DbStaffUser,
  DbNotification,
  DbOutboundMessage,
  DbVehicle,
  DbWorkshop,
  DbWorkOrder,
  DbWorkOrderStep,
  DbRecipeVersion,
  DbAlternative,
  WorkshopStation,
  AlternativeType,
  StaffRole,
  initialSuppliers,
  initialIngredients,
  initialRecipes,
  initialCustomers,
  initialMealPlans,
  initialOrders,
  initialInvoices,
  initialPayments,
  initialWorkshops,
  initialVehicles,
} from '../data/mock-db.js';
import { hashPin, normalizePhone } from './pin.js';
import {
  DEFAULT_SIMPLE_SETTINGS,
  SIMPLE_DISH_CATALOG,
  SIMPLE_DISH_PRICES,
  addDaysIso,
  toIsoDate,
  type ClientDishView,
  type ClientMenuDayView,
  type ClientOrderView,
  type ClientProgramEntry,
  type PackagingType,
  type SimpleDishView,
  type SimpleExtraSetting,
  type SimpleHomeView,
  type SimpleMenuDayView,
  type SimpleOrderView,
  type SimpleSettings,
} from '../data/simple-demo.js';

const RESTORABLE_COLLECTIONS = [
  'suppliers',
  'ingredients',
  'recipes',
  'customers',
  'mealPlans',
  'orders',
  'pendingOrders',
  'productionBatches',
  'purchaseOrders',
  'deliveryRuns',
  'subscriptions',
  'kdsBatches',
  'invoices',
  'payments',
  'auditLogs',
  'staffUsers',
  'notifications',
  'outboundMessages',
  'vehicles',
  'workshops',
  'workOrders',
  'recipeVersions',
  'alternatives',
] as const;

type RestorableCollection = (typeof RESTORABLE_COLLECTIONS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const WORKSHOP_STATIONS: Record<string, true> = {
  CHAUD: true,
  FROID: true,
  PATISSERIE: true,
  CONDITIONNEMENT: true,
};

const ALTERNATIVE_TYPES: Record<string, true> = {
  PERMANENT: true,
  LIMITED: true,
  RESERVATION: true,
};

function isWorkshopStation(value: unknown): value is WorkshopStation {
  return typeof value === 'string' && WORKSHOP_STATIONS[value] === true;
}

function isAlternativeType(value: unknown): value is AlternativeType {
  return typeof value === 'string' && ALTERNATIVE_TYPES[value] === true;
}

function isValidStaffSnapshot(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const users = value.filter(isPlainObject);
  if (users.length !== value.length) return false;
  const complete = users.every(
    (user) =>
      typeof user.id === 'string' &&
      typeof user.email === 'string' &&
      typeof user.role === 'string' &&
      typeof user.passwordSalt === 'string' &&
      typeof user.passwordHash === 'string'
  );
  if (!complete) return false;
  return users.some((user) => user.role === 'ADMIN' && user.isActive !== false);
}

export interface ProductionRequirement {
  recipeId: string;
  recipeName: string;
  category: ComponentCategory;
  totalPortions: number;
  ordersCount: number;
}

export interface IngredientRequirement {
  ingredientId: string;
  ingredientName: string;
  unit: UnitOfMeasure;
  currentStock: number;
  quantityRequired: number;
  stockAfterProduction: number;
  deficit: number;
  unitCost: number;
  totalDeficitCost: number;
  supplierId: string;
  supplierName: string;
}

export interface ProductionPlanSummary {
  date: string;
  serviceTime?: MealServiceTime;
  totalOrders: number;
  totalMealPortions: number;
  recipes: ProductionRequirement[];
  ingredientRequirements: IngredientRequirement[];
  totalEstimatedCost: number;
  deficitCost: number;
  hasDeficit: boolean;
  packagingRequirements: { type: string; quantity: number }[];
}

export interface ProductionVarianceLine {
  recipeId: string;
  recipeName: string;
  station: WorkshopStation;
  plannedPortions: number;
  producedPortions: number;
  surplus: number;
  shortage: number;
  proposal: string;
}

export interface ProductionVariance {
  date: string;
  serviceTime?: MealServiceTime;
  totalPlanned: number;
  totalProduced: number;
  totalSurplus: number;
  totalShortage: number;
  lines: ProductionVarianceLine[];
}

export interface MenuProposalDay {
  date: string;
  dayName: string;
  lunch?: DbMealPlan;
  dinner?: DbMealPlan;
}

export interface MenuProposal {
  startDate: string;
  generatedAt: string;
  days: MenuProposalDay[];
  violations: MenuRuleViolation[];
  isValid: boolean;
}

export interface MealBoxLabel {
  labelId: string;
  orderNumber: string;
  customerName: string;
  companyName?: string;
  deliveryAddress: string;
  recipeName: string;
  category: ComponentCategory;
  serviceTime: MealServiceTime;
  deliveryDate: string;
  portionIndex: string;
  allergens: string[];
  heatingInstructions: string;
  storageInstructions: string;
  barcode: string;
}

export interface FinancialAnalytics {
  date?: string;
  totalRevenue: number;
  totalFoodCost: number;
  grossMargin: number;
  foodCostPercentage: number;
  grossMarginPercentage: number;
  totalPortions: number;
  averageMealPrice: number;
  topRecipes: { name: string; portions: number; foodCost: number; revenue: number }[];
}

export interface PricingSimulation {
  recipeId: string;
  recipeName: string;
  foodCostPerPortion: number;
  targetFoodCostPercentage: number;
  recommendedSellingPrice: number;
  projectedGrossMargin: number;
  projectedMarginPercentage: number;
}

export interface WeeklyDayPlan {
  date: string;
  dayName: string;
  lunch?: DbMealPlan;
  dinner?: DbMealPlan;
  starterName?: string;
  mainName?: string;
  dessertName?: string;
  dinnerMainName?: string;
}

export interface CustomerSubscription {
  id: string;
  customerId: string;
  planName: string;
  serviceTimes: MealServiceTime[];
  dailyPortions: number;
  activeDays: string[]; // e.g. ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']
  dietaryTags: string[];
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  preferredRecipeId?: string;
}

export interface KdsBatch {
  id: string;
  recipeId: string;
  recipeName: string;
  category: ComponentCategory;
  portions: number;
  serviceTime: MealServiceTime;
  date: string;
  station: 'CHAUD' | 'FROID' | 'PATISSERIE' | 'CONDITIONNEMENT';
  stage: 'TO_PREPARE' | 'COOKING' | 'PACKAGING' | 'READY';
  updatedAt: string;
}

export interface MenuRuleViolation {
  date: string;
  ruleName: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
}

export interface EmergencyWorkshopPackage {
  date: string;
  generatedAt: string;
  totalMealPortions: number;
  recipes: { recipeName: string; category: string; portions: number }[];
  packagingRequirements: { type: string; quantity: number }[];
  alternatives: { customerName: string; address: string; requestedAlternative: string }[];
  allergensSummary: { allergen: string; portionCount: number }[];
}

export interface OfficialReportResult {
  reportNumber: number;
  title: string;
  generatedAt: string;
  summaryText: string;
  data: unknown;
}

export interface StaffSessionRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface ClientSessionRecord {
  tokenHash: string;
  customerId: string;
  expiresAt: string;
}

const STAFF_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CLIENT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_YEARS = 2;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const DEFAULT_ADVANCED_RULES: AdvancedRulesConfig = {
  maxPastaPerWeek: 1,
  allowSameDayFries: false,
  allowSameDayMincedMeat: false,
  saturdayMaxPrepMinutes: 45,
  minIngredientSpacingDays: 2,
  defaultOrderCutoffHour: 18,
  enableDietarySafetyWarnings: true,
  shortageAutoSubstitution: true,
  maxDeliveryRunRadiusKm: 25,
};

export class JanitouStore {
  public suppliers: DbSupplier[] = [];
  public ingredients: DbIngredient[] = [];
  public recipes: DbRecipe[] = [];
  public customers: DbCustomer[] = [];
  public mealPlans: DbMealPlan[] = [];
  public orders: DbOrder[] = [];
  public pendingOrders: DbOrder[] = [];
  public productionBatches: DbProductionBatch[] = [];
  public purchaseOrders: DbPurchaseOrder[] = [];
  public deliveryRuns: DbDeliveryRun[] = [];
  public subscriptions: CustomerSubscription[] = [];
  public kdsBatches: KdsBatch[] = [];
  public vehicles: DbVehicle[] = [];
  public workshops: DbWorkshop[] = [];
  public workOrders: DbWorkOrder[] = [];
  public recipeVersions: DbRecipeVersion[] = [];
  public alternatives: DbAlternative[] = [];
  public invoices: DbInvoice[] = [];
  public payments: DbPayment[] = [];
  public auditLogs: AuditLogEntry[] = [];
  public staffUsers: DbStaffUser[] = [];
  public staffSessions: StaffSessionRecord[] = [];
  public clientSessions: ClientSessionRecord[] = [];
  public notifications: DbNotification[] = [];
  public outboundMessages: DbOutboundMessage[] = [];
  public advancedRules: AdvancedRulesConfig = { ...DEFAULT_ADVANCED_RULES };
  public ledgerEntries: ImmutableLedgerEntry[] = [];
  public settings: SimpleSettings = this.cloneSettings(DEFAULT_SIMPLE_SETTINGS);
  private db: StateBackend;
  private isEphemeral: boolean;
  private readonly initPromise: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(customDb?: StateBackend, options?: { ephemeral?: boolean }) {
    this.db = customDb || createStateBackend();
    this.isEphemeral = options?.ephemeral ?? (process.env.NODE_ENV === 'test' && !customDb);
    // Keep the store usable synchronously (tests, in-process tools); durable
    // state replaces these defaults once `ready()` resolves.
    this.resetToDefaults();
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    if (!this.isEphemeral) {
      const savedState = await this.db.loadState();
      if (savedState) {
        this.suppliers = (savedState.suppliers as DbSupplier[]) || [];
        this.ingredients = (savedState.ingredients as DbIngredient[]) || [];
        this.recipes = (savedState.recipes as DbRecipe[]) || [];
        this.customers = (savedState.customers as DbCustomer[]) || [];
        this.mealPlans = (savedState.mealPlans as DbMealPlan[]) || [];
        this.orders = (savedState.orders as DbOrder[]) || [];
        this.pendingOrders = (savedState.pendingOrders as DbOrder[]) || [];
        this.productionBatches = (savedState.productionBatches as DbProductionBatch[]) || [];
        this.purchaseOrders = (savedState.purchaseOrders as DbPurchaseOrder[]) || [];
        this.deliveryRuns = (savedState.deliveryRuns as DbDeliveryRun[]) || [];
        this.subscriptions = (savedState.subscriptions as CustomerSubscription[]) || [];
        this.kdsBatches = (savedState.kdsBatches as KdsBatch[]) || [];
        this.vehicles = (savedState.vehicles as DbVehicle[]) || [];
        this.workshops = (savedState.workshops as DbWorkshop[]) || [];
        this.workOrders = (savedState.workOrders as DbWorkOrder[]) || [];
        this.recipeVersions = (savedState.recipeVersions as DbRecipeVersion[]) || [];
        this.alternatives = (savedState.alternatives as DbAlternative[]) || [];
        this.invoices = (savedState.invoices as DbInvoice[]) || [];
        this.payments = (savedState.payments as DbPayment[]) || [];
        this.auditLogs = (savedState.auditLogs as AuditLogEntry[]) || [];
        this.staffUsers = (savedState.staffUsers as DbStaffUser[]) || [];
        this.staffSessions = (savedState.staffSessions as StaffSessionRecord[]) || [];
        this.clientSessions = (savedState.clientSessions as ClientSessionRecord[]) || [];
        this.notifications = (savedState.notifications as DbNotification[]) || [];
        this.outboundMessages = (savedState.outboundMessages as DbOutboundMessage[]) || [];
        this.settings = this.normalizeSettings(savedState.settings);
        this.pruneSessions();
        this.pruneAuditLogs();
        if (this.ensureSimpleDemo()) await this.enqueuePersist();
        return;
      }
    }

    this.ensureSimpleDemo();
    if (!this.isEphemeral) await this.enqueuePersist();
  }

  /** Resolves once the initial state has been loaded from the backend. */
  public async ready(): Promise<void> {
    await this.initPromise;
    await this.writeChain;
  }

  /** Waits for all queued writes to be committed. */
  public async flush(): Promise<void> {
    await this.writeChain;
  }

  private cloneSnapshot<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private pruneSessions(): void {
    const now = Date.now();
    this.staffSessions = this.staffSessions.filter(
      (session) => Date.parse(session.expiresAt) > now
    );
    this.clientSessions = this.clientSessions.filter(
      (session) => Date.parse(session.expiresAt) > now
    );
  }

  private snapshotState(): Omit<DatabaseState, 'metadata'> {
    return {
      suppliers: this.suppliers,
      ingredients: this.ingredients,
      recipes: this.recipes,
      customers: this.customers,
      mealPlans: this.mealPlans,
      orders: this.orders,
      pendingOrders: this.pendingOrders,
      productionBatches: this.productionBatches,
      purchaseOrders: this.purchaseOrders,
      deliveryRuns: this.deliveryRuns,
      subscriptions: this.subscriptions,
      kdsBatches: this.kdsBatches,
      vehicles: this.vehicles,
      workshops: this.workshops,
      workOrders: this.workOrders,
      recipeVersions: this.recipeVersions,
      alternatives: this.alternatives,
      invoices: this.invoices,
      payments: this.payments,
      auditLogs: this.auditLogs,
      staffUsers: this.staffUsers,
      staffSessions: this.staffSessions,
      clientSessions: this.clientSessions,
      notifications: this.notifications,
      outboundMessages: this.outboundMessages,
      settings: this.settings,
    };
  }

  /**
   * Every durable write goes through one chain. Snapshots are taken when the
   * write executes, so a session created by `persistNow()` can never be
   * overwritten by an older snapshot queued before it.
   */
  private enqueuePersist(): Promise<void> {
    if (this.isEphemeral) return Promise.resolve();
    const run = this.writeChain.then(() => this.db.persistState(this.snapshotState()));
    this.writeChain = run.catch((error) => {
      console.error('[STORE] Persist failed:', error);
    });
    return run;
  }

  public persist(): void {
    void this.enqueuePersist().catch(() => {
      // The chain has already logged the failure; callers stay non-blocking.
    });
  }



  public getDatabaseHealth(): DatabaseHealth {
    return this.db.getHealth(this.snapshotState());
  }
  public resetToDefaults(): void {
    this.suppliers = JSON.parse(JSON.stringify(initialSuppliers));
    this.ingredients = JSON.parse(JSON.stringify(initialIngredients));
    this.recipes = JSON.parse(JSON.stringify(initialRecipes));
    this.customers = JSON.parse(JSON.stringify(initialCustomers));
    this.mealPlans = JSON.parse(JSON.stringify(initialMealPlans));
    this.orders = JSON.parse(JSON.stringify(initialOrders));
    this.pendingOrders = [];
    this.productionBatches = [];
    this.purchaseOrders = [];
    this.deliveryRuns = [];
    this.subscriptions = [
      {
        id: 'sub-1',
        customerId: 'cust-1',
        planName: 'Formule Déjeuner Santé Entreprise (5J/Semaine)',
        serviceTimes: [MealServiceTime.LUNCH],
        dailyPortions: 6,
        activeDays: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'],
        dietaryTags: ['Équilibré', 'Sans Porc'],
        status: 'ACTIVE',
      },
      {
        id: 'sub-2',
        customerId: 'cust-2',
        planName: 'Pack Repas Équipe Tech (Midi)',
        serviceTimes: [MealServiceTime.LUNCH],
        dailyPortions: 14,
        activeDays: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi'],
        dietaryTags: ['Standard'],
        status: 'ACTIVE',
      },
    ];
    this.kdsBatches = [];
    this.vehicles = JSON.parse(JSON.stringify(initialVehicles));
    this.workshops = JSON.parse(JSON.stringify(initialWorkshops));
    this.workOrders = [];
    this.recipeVersions = [];
    this.alternatives = [];
    this.invoices = JSON.parse(JSON.stringify(initialInvoices));
    this.payments = JSON.parse(JSON.stringify(initialPayments));
    this.auditLogs = [];
    this.advancedRules = { ...DEFAULT_ADVANCED_RULES };
    this.ledgerEntries = [];
    this.settings = this.cloneSettings(DEFAULT_SIMPLE_SETTINGS);
    this.staffSessions = [];
    this.clientSessions = [];
    this.notifications = [];
    this.outboundMessages = [];
    this.seedStaffUsers();
  }

  private seedStaffUsers(): void {
    const seeds: { id: string; email: string; fullName: string; role: StaffRole; password: string }[] = [
      { id: 'staff-admin', email: 'admin@janitou.dz', fullName: 'المدير العام', role: 'ADMIN', password: 'Admin@2026' },
      { id: 'staff-ops', email: 'ops@janitou.dz', fullName: 'مسؤول العمليات', role: 'OPERATIONS_MANAGER', password: 'Ops@2026' },
      { id: 'staff-chef', email: 'chef@janitou.dz', fullName: 'رئيس الورشة', role: 'CHEF_KITCHEN', password: 'Chef@2026' },
    ];
    const createdAt = new Date().toISOString();
    this.staffUsers = seeds.map((seed) => {
      const { salt, hash } = hashPin(seed.password);
      return {
        id: seed.id,
        email: seed.email,
        fullName: seed.fullName,
        role: seed.role,
        passwordSalt: salt,
        passwordHash: hash,
        isActive: true,
        createdAt,
      };
    });
  }

  // ==========================================
  // Customers
  // ==========================================
  public getCustomers(): DbCustomer[] {
    return this.customers;
  }

  public getCustomerById(id: string): DbCustomer | undefined {
    return this.customers.find((c) => c.id === id);
  }

  public createCustomer(data: Partial<Omit<DbCustomer, 'id'>> & Pick<DbCustomer, 'contactName' | 'phone' | 'deliveryAddress'>): DbCustomer {
    const customer: DbCustomer = {
      companyName: data.companyName,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email || '',
      deliveryAddress: data.deliveryAddress,
      wilaya: data.wilaya || 'Alger',
      commune: data.commune || 'Centre',
      deliveryNotes: data.deliveryNotes,
      dietaryPreferences: data.dietaryPreferences || ['Standard'],
      parentCompanyId: data.parentCompanyId,
      isSubsidiary: data.isSubsidiary || false,
      status: data.status || 'ACTIVE',
      accountBalance: data.accountBalance ?? 0,
      whatsAppLink: data.whatsAppLink || `https://wa.me/213${(data.phone || '').replace(/\D/g, '')}`,
      subscriptionType: data.subscriptionType || 'CORPORATE',
      preferredDistributionType: data.preferredDistributionType || 'STANDARD_DELIVERY',
      id: `cust-${Date.now()}`,
    };
    this.customers.push(customer);
    this.persist();
    return customer;
  }

  // ==========================================
  // Suppliers & Ingredients
  // ==========================================
  public getSuppliers(): DbSupplier[] {
    return this.suppliers;
  }

  public getIngredients(): DbIngredient[] {
    return this.ingredients;
  }

  public getIngredientById(id: string): DbIngredient | undefined {
    return this.ingredients.find((i) => i.id === id);
  }

  public updateIngredientStock(id: string, newStock: number): DbIngredient | undefined {
    const ingredient = this.getIngredientById(id);
    if (ingredient) {
      ingredient.currentStock = Math.max(0, newStock);
      this.persist();
    }
    return ingredient;
  }

  // ==========================================
  // Recipes
  // ==========================================
  public getRecipes(): DbRecipe[] {
    return this.recipes;
  }

  public getRecipeById(id: string): DbRecipe | undefined {
    return this.recipes.find((r) => r.id === id);
  }

  public calculateRecipeCost(recipeId: string): { costPerPortion: number; breakdown: { ingredientName: string; cost: number }[] } {
    const recipe = this.getRecipeById(recipeId);
    if (!recipe) return { costPerPortion: 0, breakdown: [] };

    let totalCost = 0;
    const breakdown = recipe.ingredients.map((item) => {
      const ing = this.getIngredientById(item.ingredientId);
      const unitCost = ing ? ing.unitCost : 0;
      const itemCost = item.quantityPerPortion * unitCost;
      totalCost += itemCost;
      return {
        ingredientName: ing ? ing.name : 'Inconnu',
        cost: Math.round(itemCost * 100) / 100,
      };
    });

    return {
      costPerPortion: Math.round(totalCost * 100) / 100,
      breakdown,
    };
  }

  public createRecipe(
    data: Partial<Omit<DbRecipe, 'id'>> & Pick<DbRecipe, 'name' | 'category' | 'yieldPortions' | 'ingredients' | 'allergens'>
  ): DbRecipe {
    const recipe: DbRecipe = {
      name: data.name,
      category: data.category,
      description: data.description || '',
      yieldPortions: data.yieldPortions,
      preparationTimeMinutes: data.preparationTimeMinutes ?? 30,
      ingredients: data.ingredients,
      allergens: data.allergens,
      nameAr: data.nameAr?.trim() || undefined,
      photoUrl: data.photoUrl?.trim() || undefined,
      family: data.family?.trim() || undefined,
      flags: data.flags,
      mainIngredient: data.mainIngredient?.trim() || undefined,
      price: data.price,
      isActive: data.isActive ?? true,
      version: 1,
      id: `rec-${Date.now()}`,
    };
    this.recipes.push(recipe);
    this.persist();
    return recipe;
  }

  public simulateRecipePricing(recipeId: string, targetFoodCostPercentage: number): PricingSimulation | undefined {
    const recipe = this.getRecipeById(recipeId);
    if (!recipe) return undefined;

    const costInfo = this.calculateRecipeCost(recipeId);
    const foodCost = costInfo.costPerPortion;
    const validTargetPct = Math.max(10, Math.min(90, targetFoodCostPercentage || 30));
    const recommendedPrice = Math.round(foodCost / (validTargetPct / 100));
    const grossMargin = recommendedPrice - foodCost;

    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      foodCostPerPortion: foodCost,
      targetFoodCostPercentage: validTargetPct,
      recommendedSellingPrice: recommendedPrice,
      projectedGrossMargin: grossMargin,
      projectedMarginPercentage: Math.round((grossMargin / recommendedPrice) * 1000) / 10,
    };
  }

  // ==========================================
  // Simple Mode (mobile menu, dishes & daily orders)
  // ==========================================
  private cloneSettings(settings: SimpleSettings): SimpleSettings {
    return { ...settings, extras: settings.extras.map((extra) => ({ ...extra })) };
  }

  private normalizeSettings(raw: unknown): SimpleSettings {
    const base = this.cloneSettings(DEFAULT_SIMPLE_SETTINGS);
    if (!raw || typeof raw !== 'object') return base;
    const input = raw as Partial<SimpleSettings>;
    const finiteAmount = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
    return {
      lunchPrice: finiteAmount(input.lunchPrice, base.lunchPrice),
      dinnerPrice: finiteAmount(input.dinnerPrice, base.dinnerPrice),
      packagingPrice: finiteAmount(input.packagingPrice, base.packagingPrice),
      deliveryPrice: finiteAmount(input.deliveryPrice, base.deliveryPrice),
      lunchHours:
        typeof input.lunchHours === 'string' && input.lunchHours.trim()
          ? input.lunchHours.trim().slice(0, 40)
          : base.lunchHours,
      dinnerHours:
        typeof input.dinnerHours === 'string' && input.dinnerHours.trim()
          ? input.dinnerHours.trim().slice(0, 40)
          : base.dinnerHours,
      cutoffTime:
        typeof input.cutoffTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoffTime)
          ? input.cutoffTime
          : base.cutoffTime,
      cutoffDaysBefore:
        typeof input.cutoffDaysBefore === 'number' &&
        Number.isInteger(input.cutoffDaysBefore) &&
        input.cutoffDaysBefore >= 0 &&
        input.cutoffDaysBefore <= 7
          ? input.cutoffDaysBefore
          : base.cutoffDaysBefore,
      closedDates: Array.isArray(input.closedDates)
        ? input.closedDates.filter(
            (date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
          )
        : base.closedDates,
      collectivePackagingSize:
        typeof input.collectivePackagingSize === 'number' &&
        Number.isInteger(input.collectivePackagingSize) &&
        input.collectivePackagingSize >= 1 &&
        input.collectivePackagingSize <= 100
          ? input.collectivePackagingSize
          : base.collectivePackagingSize,
      deadlineOverrides:
        input.deadlineOverrides && typeof input.deadlineOverrides === 'object'
          ? Object.fromEntries(
              Object.entries(input.deadlineOverrides).filter(
                ([date, until]) =>
                  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                  typeof until === 'string' &&
                  !Number.isNaN(Date.parse(until))
              )
            )
          : base.deadlineOverrides,
      extras: Array.isArray(input.extras)
        ? input.extras
            .filter(
              (extra): extra is SimpleExtraSetting =>
                Boolean(extra) &&
                typeof extra.name === 'string' &&
                extra.name.trim().length > 0 &&
                typeof extra.price === 'number' &&
                Number.isFinite(extra.price) &&
                extra.price >= 0
            )
            .slice(0, 20)
            .map((extra) => ({
              name: extra.name.trim().slice(0, 40),
              price: extra.price,
              perMeals:
                typeof extra.perMeals === 'number' &&
                Number.isInteger(extra.perMeals) &&
                extra.perMeals >= 1 &&
                extra.perMeals <= 30
                  ? extra.perMeals
                  : DEFAULT_SIMPLE_SETTINGS.extras.find(
                      (defaultExtra) => defaultExtra.name === extra.name.trim()
                    )?.perMeals || 1,
              families: Array.isArray(extra.families)
                ? extra.families
                    .filter((family): family is string => typeof family === 'string' && family.length > 0)
                    .slice(0, 12)
                : undefined,
            }))
        : base.extras,
    };
  }

  /** Enriches the Phase 1 seed with photos/Arabic labels and keeps a 7-day menu available. */
  private ensureSimpleDemo(): boolean {
    if (this.isEphemeral || process.env.JANITOU_AUTOSEED === '0') return false;
    let changed = false;

    if (this.staffUsers.length === 0) {
      this.seedStaffUsers();
      changed = true;
    }

    if (this.workshops.length === 0) {
      this.workshops = this.cloneSnapshot(initialWorkshops);
      changed = true;
    }
    if (this.vehicles.length === 0) {
      this.vehicles = this.cloneSnapshot(initialVehicles);
      changed = true;
    }

    for (const seed of SIMPLE_DISH_CATALOG) {
      const recipe = this.recipes.find((entry) => entry.name === seed.name);
      if (!recipe) {
        this.recipes.push({
          id: seed.id,
          name: seed.name,
          nameAr: seed.nameAr,
          photoUrl: seed.photoUrl,
          category: seed.category,
          description: 'Plat du menu quotidien',
          yieldPortions: 1,
          preparationTimeMinutes: 30,
          allergens: [],
          ingredients: [],
          price: SIMPLE_DISH_PRICES[seed.id],
          isActive: true,
          family: seed.family,
          flags: seed.flags ? [...seed.flags] : undefined,
          mainIngredient: seed.mainIngredient,
        });
        changed = true;
      } else {
        if (recipe.nameAr !== seed.nameAr || recipe.photoUrl !== seed.photoUrl) {
          recipe.nameAr = seed.nameAr;
          recipe.photoUrl = seed.photoUrl;
          changed = true;
        }
        if (recipe.price === undefined && SIMPLE_DISH_PRICES[seed.id] !== undefined) {
          recipe.price = SIMPLE_DISH_PRICES[seed.id];
          changed = true;
        }
        if (recipe.isActive === undefined) {
          recipe.isActive = true;
          changed = true;
        }
        if (recipe.family !== seed.family || recipe.mainIngredient !== seed.mainIngredient) {
          recipe.family = seed.family;
          recipe.mainIngredient = seed.mainIngredient;
          changed = true;
        }
        if (seed.flags && JSON.stringify(recipe.flags || []) !== JSON.stringify(seed.flags)) {
          recipe.flags = [...seed.flags];
          changed = true;
        }
      }
    }

    // Demo case for BR-003: inactive account awaiting administrative review.
    if (!this.customers.some((customer) => customer.id === 'cust-review-demo')) {
      const { salt, hash } = hashPin('1234');
      this.customers.push({
        id: 'cust-review-demo',
        contactName: 'Nadia Saidi',
        companyName: 'Atelier Saidi',
        phone: '0770 44 55 66',
        email: '',
        deliveryAddress: '24 Rue des Oliviers, Alger',
        wilaya: 'Alger',
        commune: 'Alger Centre',
        dietaryPreferences: [],
        status: 'ACTIVE',
        accountStatus: 'ACTIVE',
        pinSalt: salt,
        pinHash: hash,
        registeredAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
        accountBalance: 2500,
        whatsAppLink: 'https://wa.me/213770445566',
        subscriptionType: 'INDIVIDUAL',
        preferredDistributionType: 'STANDARD_DELIVERY',
      });
      changed = true;
    }

    // Demo customer accounts: active, with the provisional PIN 1234.
    for (const customer of this.customers) {
      if (!customer.accountStatus) {
        customer.accountStatus = 'ACTIVE';
        changed = true;
      }
      if (!customer.pinHash || !customer.pinSalt) {
        const { salt, hash } = hashPin('1234');
        customer.pinSalt = salt;
        customer.pinHash = hash;
        changed = true;
      }
    }

    const rotation = SIMPLE_DISH_CATALOG.filter((seed) => seed.family !== 'DESSERT')
      .map((seed) => this.recipes.find((recipe) => recipe.name === seed.name))
      .filter((recipe): recipe is DbRecipe => Boolean(recipe));
    if (rotation.length < 2) return changed;

    const today = toIsoDate(new Date());
    for (let offset = 0; offset < 7; offset++) {
      const date = addDaysIso(today, offset);
      const plans = this.mealPlans.filter((plan) => plan.date === date);
      const lunch = rotation[offset % rotation.length];
      let dinner = rotation[(offset + 1) % rotation.length];
      for (let attempt = 0; attempt < rotation.length; attempt++) {
        const candidate = rotation[(offset + 1 + attempt) % rotation.length];
        if (candidate.mainIngredient !== lunch.mainIngredient) {
          dinner = candidate;
          break;
        }
      }
      const services: { serviceTime: MealServiceTime; dishId: string }[] = [
        { serviceTime: MealServiceTime.LUNCH, dishId: lunch.id },
        { serviceTime: MealServiceTime.DINNER, dishId: dinner.id },
      ];
      for (const { serviceTime, dishId } of services) {
        if (plans.some((plan) => plan.serviceTime === serviceTime)) continue;
        this.mealPlans.push({
          id: `mp-auto-${date}-${serviceTime.toLowerCase()}`,
          date,
          serviceTime,
          mainCourseRecipeId: dishId,
          notes: 'Menu du jour (mode simple)',
          isArchived: false,
        });
        changed = true;
      }
    }

    return changed;
  }

  private toSimpleDishView(recipe: DbRecipe): SimpleDishView {
    return {
      id: recipe.id,
      name: recipe.name,
      nameAr: recipe.nameAr,
      displayName: recipe.nameAr?.trim() || recipe.name,
      photoUrl: recipe.photoUrl,
      category: recipe.category,
      family: recipe.family,
    };
  }

  private buildSimpleMenuDay(date: string, plans: DbMealPlan[]): SimpleMenuDayView {
    const lunchPlan = plans.find((plan) => plan.serviceTime === MealServiceTime.LUNCH);
    const dinnerPlan = plans.find((plan) => plan.serviceTime === MealServiceTime.DINNER);
    const lunchRecipe = lunchPlan ? this.getRecipeById(lunchPlan.mainCourseRecipeId) : undefined;
    const dinnerRecipe = dinnerPlan ? this.getRecipeById(dinnerPlan.mainCourseRecipeId) : undefined;
    return {
      date,
      archived: plans.length > 0 && plans.every((plan) => Boolean(plan.isArchived)),
      lunch: lunchRecipe ? this.toSimpleDishView(lunchRecipe) : null,
      dinner: dinnerRecipe ? this.toSimpleDishView(dinnerRecipe) : null,
    };
  }

  public getSimpleDishes(): SimpleDishView[] {
    return this.recipes.map((recipe) => this.toSimpleDishView(recipe));
  }

  public getSimpleMenuDay(date: string): SimpleMenuDayView {
    return this.buildSimpleMenuDay(
      date,
      this.mealPlans.filter((plan) => plan.date === date)
    );
  }

  public getSimpleMenuRange(
    from: string,
    to: string,
    scope: 'current' | 'archived'
  ): SimpleMenuDayView[] {
    if (scope === 'archived') {
      const dates = [
        ...new Set(
          this.mealPlans
            .filter((plan) => plan.isArchived && plan.date >= from && plan.date <= to)
            .map((plan) => plan.date)
        ),
      ].sort((left, right) => right.localeCompare(left));
      return dates.map((date) => this.getSimpleMenuDay(date));
    }

    const days: SimpleMenuDayView[] = [];
    let cursor = from;
    for (let guard = 0; guard < 62 && cursor <= to; guard++) {
      const day = this.getSimpleMenuDay(cursor);
      if (!day.archived) days.push(day);
      cursor = addDaysIso(cursor, 1);
    }
    return days;
  }

  private upsertMenuPlan(date: string, serviceTime: MealServiceTime, dishId?: string): void {
    if (!dishId) return;
    const existing = this.mealPlans.find(
      (plan) => plan.date === date && plan.serviceTime === serviceTime
    );
    if (existing) {
      existing.mainCourseRecipeId = dishId;
      existing.isArchived = false;
      return;
    }
    this.mealPlans.push({
      id: `mp-${date}-${serviceTime.toLowerCase()}`,
      date,
      serviceTime,
      mainCourseRecipeId: dishId,
      isArchived: false,
    });
  }

  public upsertSimpleMenuDay(input: {
    date: string;
    lunchDishId?: string;
    dinnerDishId?: string;
  }): SimpleMenuDayView {
    this.upsertMenuPlan(input.date, MealServiceTime.LUNCH, input.lunchDishId);
    this.upsertMenuPlan(input.date, MealServiceTime.DINNER, input.dinnerDishId);
    this.persist();
    return this.getSimpleMenuDay(input.date);
  }

  public changeSimpleMenuDish(
    date: string,
    serviceTime: MealServiceTime,
    dishId: string
  ): SimpleMenuDayView {
    this.upsertMenuPlan(date, serviceTime, dishId);
    this.persist();
    return this.getSimpleMenuDay(date);
  }

  public setSimpleMenuArchived(date: string, archived: boolean): SimpleMenuDayView | undefined {
    const plans = this.mealPlans.filter((plan) => plan.date === date);
    if (plans.length === 0) return undefined;
    for (const plan of plans) plan.isArchived = archived;
    this.persist();
    return this.getSimpleMenuDay(date);
  }

  public getSimpleHome(date: string): SimpleHomeView {
    const menu = this.getSimpleMenuDay(date);
    const orders = this.getOrders({ date });
    const activeOrders = orders.filter((order) => order.status !== OrderStatus.CANCELLED);
    const lunchPortions = activeOrders
      .filter((order) => order.serviceTime === MealServiceTime.LUNCH)
      .reduce((sum, order) => sum + order.totalPortions, 0);
    const dinnerPortions = activeOrders
      .filter((order) => order.serviceTime === MealServiceTime.DINNER)
      .reduce((sum, order) => sum + order.totalPortions, 0);
    const dishIds = [menu.lunch?.id, menu.dinner?.id].filter(
      (dishId): dishId is string => Boolean(dishId)
    );

    return {
      date,
      menu,
      stats: {
        dishesCount: new Set(dishIds).size,
        ordersCount: activeOrders.length,
        lunchPortions,
        dinnerPortions,
        totalPortions: lunchPortions + dinnerPortions,
      },
      orders: orders.map((order) => {
        const customer = this.getCustomerById(order.customerId);
        const view: SimpleOrderView = {
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: customer?.companyName || customer?.contactName || 'Client',
          customerPhone: customer?.phone || '',
          serviceTime: order.serviceTime,
          status: order.status,
          totalPortions: order.totalPortions,
          deliveryAddress: order.deliveryAddress,
          notes: order.notes,
        };
        return view;
      }),
    };
  }

  public getSimpleSettings(): SimpleSettings {
    return this.cloneSettings(this.settings);
  }

  public updateSimpleSettings(settings: SimpleSettings): SimpleSettings {
    this.settings = this.normalizeSettings(settings);
    this.persist();
    return this.getSimpleSettings();
  }

  // ==========================================
  // Customer accounts (client app)
  // ==========================================
  public getCustomerByPhone(phone: string): DbCustomer | undefined {
    const normalized = normalizePhone(phone);
    return this.customers.find((customer) => normalizePhone(customer.phone) === normalized);
  }

  public createClientAccount(data: {
    contactName: string;
    phone: string;
    deliveryAddress: string;
    wilaya?: string;
    commune?: string;
    pinSalt?: string;
    pinHash?: string;
    companyName?: string;
    email?: string;
    active?: boolean;
    subscriptionType?: DbCustomer['subscriptionType'];
  }): DbCustomer {
    if (this.getCustomerByPhone(data.phone)) {
      throw new Error('PHONE_EXISTS');
    }
    const customer: DbCustomer = {
      id: `cust-${Date.now()}`,
      contactName: data.contactName,
      companyName: data.companyName,
      phone: data.phone,
      email: data.email || '',
      deliveryAddress: data.deliveryAddress,
      wilaya: data.wilaya || '',
      commune: data.commune || '',
      dietaryPreferences: [],
      status: 'ACTIVE',
      accountStatus: data.active ? 'ACTIVE' : 'PENDING',
      pinSalt: data.pinSalt || '',
      pinHash: data.pinHash || '',
      registeredAt: new Date().toISOString(),
      accountBalance: 0,
      whatsAppLink: `https://wa.me/${normalizePhone(data.phone)}`,
      subscriptionType: data.subscriptionType || 'INDIVIDUAL',
      preferredDistributionType: 'STANDARD_DELIVERY',
    };
    this.customers.push(customer);
    this.notify(
      'STAFF',
      'NEW_CLIENT',
      { customerId: customer.id, name: customer.contactName, phone: customer.phone },
      customer.id
    );
    this.persist();
    return customer;
  }

  private confirmPendingOrders(customer: DbCustomer): number {
    const pending = this.pendingOrders.filter((order) => order.customerId === customer.id);
    if (pending.length === 0) return 0;
    this.pendingOrders = this.pendingOrders.filter((order) => order.customerId !== customer.id);
    for (const order of pending) {
      order.status = OrderStatus.CONFIRMED;
      this.orders.push(order);
      this.issueOrderInvoice(customer, order);
      this.notify(
        'CLIENT',
        'ORDER_CREATED',
        { orderNumber: order.orderNumber, total: order.totalPrice, date: order.deliveryDate },
        customer.id
      );
      this.auditLogs.unshift({
        id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        userId: customer.id,
        userName: customer.contactName,
        action: 'APPROVE_ORDER',
        entityType: 'ORDER',
        entityId: order.id,
        beforeSnapshot: { orderNumber: order.orderNumber, status: OrderStatus.DRAFT },
        afterSnapshot: { orderNumber: order.orderNumber, status: order.status },
      });
    }
    return pending.length;
  }

  public setCustomerAccountStatus(
    customerId: string,
    accountStatus: NonNullable<DbCustomer['accountStatus']>
  ): DbCustomer | undefined {
    const customer = this.getCustomerById(customerId);
    if (!customer) return undefined;
    const before = this.cloneSnapshot(customer);
    customer.accountStatus = accountStatus;
    if (accountStatus === 'CANCELLED') customer.status = 'CANCELLED';
    if (accountStatus === 'SUSPENDED' || accountStatus === 'FROZEN') customer.status = 'SUSPENDED';
    if (accountStatus === 'ACTIVE') customer.status = 'ACTIVE';
    if (accountStatus === 'ACTIVE') this.confirmPendingOrders(customer);
    if (accountStatus === 'CANCELLED') {
      this.pendingOrders = this.pendingOrders.filter((order) => order.customerId !== customer.id);
    }
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customer.id,
      userName: customer.contactName,
      action: 'UPDATE_CUSTOMER_STATUS',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      beforeSnapshot: { accountStatus: before.accountStatus, status: before.status },
      afterSnapshot: { accountStatus: customer.accountStatus, status: customer.status },
    });
    this.persist();
    return customer;
  }

  public getStaffUsers(): DbStaffUser[] {
    return this.staffUsers;
  }

  public getStaffUserByEmail(email: string): DbStaffUser | undefined {
    const normalized = email.trim().toLowerCase();
    return this.staffUsers.find((user) => user.email.toLowerCase() === normalized);
  }

  public getStaffUserById(id: string): DbStaffUser | undefined {
    return this.staffUsers.find((user) => user.id === id);
  }

  private activeAdminCount(): number {
    return this.staffUsers.filter((user) => user.role === 'ADMIN' && user.isActive).length;
  }

  public createStaffUser(
    data: { email: string; fullName: string; role: StaffRole; password: string },
    actor?: DbStaffUser
  ): DbStaffUser {
    const email = data.email.trim().toLowerCase();
    if (this.staffUsers.some((user) => user.email.toLowerCase() === email)) {
      throw new Error('EMAIL_EXISTS');
    }
    const { salt, hash } = hashPin(data.password);
    const user: DbStaffUser = {
      id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email,
      fullName: data.fullName.trim(),
      role: data.role,
      passwordSalt: salt,
      passwordHash: hash,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    this.staffUsers.push(user);
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.fullName || 'System',
      action: 'CREATE_USER',
      entityType: 'STAFF_USER',
      entityId: user.id,
      afterSnapshot: { email: user.email, fullName: user.fullName, role: user.role },
    });
    this.persist();
    return user;
  }

  public updateStaffUser(
    userId: string,
    patch: { fullName?: string; role?: StaffRole; isActive?: boolean; password?: string },
    actor?: DbStaffUser
  ): DbStaffUser {
    const user = this.getStaffUserById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    const before = {
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
    };
    const demotingAdmin = user.role === 'ADMIN' && patch.role && patch.role !== 'ADMIN';
    const deactivatingAdmin = user.role === 'ADMIN' && patch.isActive === false;
    if ((demotingAdmin || deactivatingAdmin) && this.activeAdminCount() <= 1) {
      throw new Error('LAST_ADMIN');
    }
    if (patch.isActive === false && actor?.id === user.id) {
      throw new Error('CANNOT_DISABLE_SELF');
    }
    if (patch.fullName) user.fullName = patch.fullName.trim();
    if (patch.role) user.role = patch.role;
    if (patch.isActive !== undefined) user.isActive = patch.isActive;
    let revokedSessions = 0;
    if (patch.password) {
      const { salt, hash } = hashPin(patch.password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
    }
    if (patch.password || patch.role || patch.isActive === false) {
      const beforeCount = this.staffSessions.length;
      this.staffSessions = this.staffSessions.filter((session) => session.userId !== user.id);
      revokedSessions = beforeCount - this.staffSessions.length;
    }
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.fullName || 'System',
      action: 'UPDATE_USER',
      entityType: 'STAFF_USER',
      entityId: user.id,
      beforeSnapshot: before,
      afterSnapshot: {
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        passwordChanged: Boolean(patch.password),
        revokedSessions,
      },
    });
    this.persist();
    return user;
  }

  public setStaffMfaSecret(userId: string, secret: string): void {
    const user = this.getStaffUserById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    user.mfaSecret = secret;
    user.mfaEnabled = false;
    this.persist();
  }

  public enableStaffMfa(userId: string, recoveryCodes: string[], actor?: DbStaffUser): void {
    const user = this.getStaffUserById(userId);
    if (!user || !user.mfaSecret) throw new Error('MFA_NOT_READY');
    user.mfaEnabled = true;
    user.recoveryCodeHashes = recoveryCodes.map((code) =>
      sha256(code.replace(/[^A-Z0-9]/gi, '').toUpperCase())
    );
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || user.id,
      userName: actor?.fullName || user.fullName,
      action: 'ENABLE_MFA',
      entityType: 'STAFF_USER',
      entityId: user.id,
      afterSnapshot: { recoveryCodes: user.recoveryCodeHashes.length },
    });
    this.persist();
  }

  public disableStaffMfa(userId: string, actor?: DbStaffUser): void {
    const user = this.getStaffUserById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    user.mfaEnabled = false;
    user.mfaSecret = undefined;
    user.recoveryCodeHashes = undefined;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || user.id,
      userName: actor?.fullName || user.fullName,
      action: 'DISABLE_MFA',
      entityType: 'STAFF_USER',
      entityId: user.id,
    });
    this.persist();
  }

  public consumeStaffRecoveryCode(userId: string, code: string): boolean {
    const user = this.getStaffUserById(userId);
    if (!user?.recoveryCodeHashes?.length) return false;
    const hash = sha256(code.replace(/[^A-Z0-9]/gi, '').toUpperCase());
    const index = user.recoveryCodeHashes.indexOf(hash);
    if (index === -1) return false;
    user.recoveryCodeHashes.splice(index, 1);
    this.persist();
    return true;
  }

  public listStaffSessions(): {
    tokenHash: string;
    userId: string;
    fullName: string;
    email: string;
    role: string;
    expiresAt: string;
  }[] {
    this.pruneSessions();
    return this.staffSessions.map((session) => {
      const user = this.getStaffUserById(session.userId);
      return {
        tokenHash: session.tokenHash,
        userId: session.userId,
        fullName: user?.fullName || '—',
        email: user?.email || '—',
        role: user?.role || '—',
        expiresAt: session.expiresAt,
      };
    });
  }

  public listClientSessions(): {
    tokenHash: string;
    customerId: string;
    contactName: string;
    phone: string;
    expiresAt: string;
  }[] {
    this.pruneSessions();
    return this.clientSessions.map((session) => {
      const customer = this.getCustomerById(session.customerId);
      return {
        tokenHash: session.tokenHash,
        customerId: session.customerId,
        contactName: customer?.contactName || '—',
        phone: customer?.phone || '—',
        expiresAt: session.expiresAt,
      };
    });
  }

  public revokeStaffSessionHash(tokenHash: string): boolean {
    const before = this.staffSessions.length;
    this.staffSessions = this.staffSessions.filter((session) => session.tokenHash !== tokenHash);
    if (this.staffSessions.length === before) return false;
    this.persist();
    return true;
  }

  public revokeClientSessionHash(tokenHash: string): boolean {
    const before = this.clientSessions.length;
    this.clientSessions = this.clientSessions.filter((session) => session.tokenHash !== tokenHash);
    if (this.clientSessions.length === before) return false;
    this.persist();
    return true;
  }

  public revokeAllSessionsForUser(userId: string): number {
    const before = this.staffSessions.length;
    this.staffSessions = this.staffSessions.filter((session) => session.userId !== userId);
    const removed = before - this.staffSessions.length;
    if (removed > 0) this.persist();
    return removed;
  }

  public async createStaffSession(userId: string): Promise<string> {
    const token = randomUUID();
    this.pruneSessions();
    this.staffSessions.push({
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS).toISOString(),
    });
    await this.enqueuePersist();
    return token;
  }

  public getStaffSessionUserId(token: string): string | undefined {
    this.pruneSessions();
    return this.staffSessions.find((session) => session.tokenHash === sha256(token))?.userId;
  }

  public async deleteStaffSession(token: string): Promise<void> {
    const tokenHash = sha256(token);
    this.staffSessions = this.staffSessions.filter((session) => session.tokenHash !== tokenHash);
    await this.enqueuePersist();
  }

  public async createClientSession(customerId: string): Promise<string> {
    const token = randomUUID();
    this.pruneSessions();
    this.clientSessions.push({
      tokenHash: sha256(token),
      customerId,
      expiresAt: new Date(Date.now() + CLIENT_SESSION_TTL_MS).toISOString(),
    });
    await this.enqueuePersist();
    return token;
  }

  public getClientSessionCustomerId(token: string): string | undefined {
    this.pruneSessions();
    return this.clientSessions.find((session) => session.tokenHash === sha256(token))?.customerId;
  }

  public async deleteClientSession(token: string): Promise<void> {
    const tokenHash = sha256(token);
    this.clientSessions = this.clientSessions.filter((session) => session.tokenHash !== tokenHash);
    await this.enqueuePersist();
  }

  public getClientAccounts(): DbCustomer[] {
    return [...this.customers].sort((left, right) =>
      (left.registeredAt || '').localeCompare(right.registeredAt || '')
    );
  }

  private lastOrderDate(customerId: string): string | undefined {
    return this.orders
      .filter((order) => order.customerId === customerId && order.status !== OrderStatus.CANCELLED)
      .map((order) => order.deliveryDate)
      .sort()
      .at(-1);
  }

  public isClientReviewRequired(customer: DbCustomer): boolean {
    const reference =
      this.lastOrderDate(customer.id) ||
      customer.registeredAt?.slice(0, 10) ||
      new Date().toISOString().slice(0, 10);
    const referenceTime = new Date(`${reference}T00:00:00`).getTime();
    const inactiveDays = Math.floor((Date.now() - referenceTime) / (24 * 60 * 60 * 1000));
    if (inactiveDays <= 10) return false;
    return !customer.reviewClearedAt || customer.reviewClearedAt.slice(0, 10) < reference;
  }

  public markClientReviewed(customerId: string): DbCustomer | undefined {
    const customer = this.getCustomerById(customerId);
    if (!customer) return undefined;
    const beforeReview = customer.reviewClearedAt;
    customer.reviewClearedAt = new Date().toISOString();
    this.notify('CLIENT', 'ACCOUNT_REVIEWED', { customerId: customer.id }, customer.id);
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customer.id,
      userName: customer.contactName,
      action: 'REVIEW_CLIENT',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      beforeSnapshot: { reviewClearedAt: beforeReview || null },
      afterSnapshot: { reviewClearedAt: customer.reviewClearedAt },
    });
    this.persist();
    return customer;
  }

  public updateClientProfile(
    customerId: string,
    patch: {
      contactName?: string;
      phone?: string;
      deliveryAddress?: string;
      distribution?: DbCustomer['distribution'];
    }
  ): DbCustomer | undefined {
    const customer = this.getCustomerById(customerId);
    if (!customer) return undefined;
    const before = this.cloneSnapshot(customer);
    if (patch.phone) {
      const duplicate = this.getCustomerByPhone(patch.phone);
      if (duplicate && duplicate.id !== customer.id) throw new Error('PHONE_EXISTS');
      customer.phone = patch.phone;
      customer.whatsAppLink = `https://wa.me/${normalizePhone(patch.phone)}`;
    }
    if (patch.contactName) customer.contactName = patch.contactName;
    if (patch.deliveryAddress) customer.deliveryAddress = patch.deliveryAddress;
    if (patch.distribution) customer.distribution = patch.distribution;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customer.id,
      userName: customer.contactName,
      action: 'UPDATE_CLIENT',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(customer),
    });
    this.persist();
    return customer;
  }

  public creditClientAccount(customerId: string, amount: number): DbCustomer | undefined {
    const customer = this.getCustomerById(customerId);
    if (!customer) return undefined;
    const beforeBalance = customer.accountBalance;
    customer.accountBalance = Math.round((customer.accountBalance + amount) * 100) / 100;
    this.notify(
      'CLIENT',
      'ACCOUNT_CREDITED',
      { amount, balance: customer.accountBalance },
      customer.id
    );
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customer.id,
      userName: customer.contactName,
      action: 'CREDIT_ACCOUNT',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      beforeSnapshot: { balance: beforeBalance },
      afterSnapshot: { amount, balance: customer.accountBalance },
    });
    this.persist();
    return customer;
  }

  private notify(
    audience: DbNotification['audience'],
    type: string,
    data: DbNotification['data'],
    customerId?: string
  ): void {
    this.notifications.unshift({
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      audience,
      customerId,
      type,
      data,
      createdAt: new Date().toISOString(),
    });
    this.notifications = this.notifications.slice(0, 500);
    if (audience === 'CLIENT' && customerId) {
      this.enqueueOutboundForCustomer(customerId, type, data);
    }
  }

  private enqueueOutboundForCustomer(
    customerId: string,
    type: string,
    data: DbNotification['data']
  ): void {
    const customer = this.getCustomerById(customerId);
    if (!customer?.phone) return;
    const orderNumber = data.orderNumber ? String(data.orderNumber) : '';
    const total = data.total !== undefined ? `${Number(data.total).toLocaleString('en-US')} DA` : '';
    const date = data.date ? String(data.date) : '';
    const messages: Record<string, string> = {
      ORDER_CREATED: `جانيتو فود: تم تسجيل طلبكم ${orderNumber}${date ? ` ليوم ${date}` : ''}${total ? ` — ${total}` : ''}.`,
      ORDER_UPDATED: `جانيتو فود: تم تحديث طلبكم ${orderNumber}${total ? ` — ${total}` : ''}.`,
      ORDER_CANCELLED: `جانيتو فود: تم إلغاء طلبكم ${orderNumber}.`,
      ACCOUNT_CREDITED: `جانيتو فود: تمت تعبئة رصيدكم${data.amount !== undefined ? ` بمبلغ ${Number(data.amount).toLocaleString('en-US')} DA` : ''}.`,
      ACCOUNT_REVIEWED: 'جانيتو فود: تمت مراجعة حسابكم، يمكنكم استئناف الطلبات.',
    };
    const body = messages[type];
    if (!body) return;
    const channel: DbOutboundMessage['channel'] =
      process.env.MESSAGING_CHANNEL === 'SMS' ? 'SMS' : 'WHATSAPP';
    this.outboundMessages.unshift({
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      channel,
      to: customer.phone,
      body,
      status: 'QUEUED',
      attempts: 0,
      createdAt: new Date().toISOString(),
      orderNumber: orderNumber || undefined,
    });
    this.outboundMessages = this.outboundMessages.slice(0, 500);
  }

  public getQueuedOutboundMessages(limit = 10): DbOutboundMessage[] {
    return this.outboundMessages
      .filter((message) => message.status === 'QUEUED' && message.attempts < 5)
      .slice(0, limit);
  }

  public markOutboundMessage(
    messageId: string,
    status: DbOutboundMessage['status'],
    error?: string
  ): void {
    const message = this.outboundMessages.find((entry) => entry.id === messageId);
    if (!message) return;
    message.status = status;
    message.attempts += 1;
    message.lastError = error;
    if (status === 'SENT') message.sentAt = new Date().toISOString();
    this.persist();
  }

  public getClientNotifications(customerId: string): DbNotification[] {
    return this.notifications.filter(
      (notification) => notification.audience === 'CLIENT' && notification.customerId === customerId
    );
  }

  public markClientNotificationsRead(customerId: string): void {
    const now = new Date().toISOString();
    for (const notification of this.notifications) {
      if (notification.audience === 'CLIENT' && notification.customerId === customerId && !notification.readAt) {
        notification.readAt = now;
      }
    }
    this.persist();
  }

  public getStaffNotifications(): DbNotification[] {
    return this.notifications.filter((notification) => notification.audience === 'STAFF');
  }

  public markStaffNotificationsRead(): void {
    const now = new Date().toISOString();
    for (const notification of this.notifications) {
      if (notification.audience === 'STAFF' && !notification.readAt) notification.readAt = now;
    }
    this.persist();
  }

  private nextDocumentNumber(prefix: string, date: string): string {
    return `${prefix}-${date.replace(/-/g, '')}-${String(this.invoices.length + this.payments.length + 1).padStart(3, '0')}`;
  }

  private issueOrderInvoice(customer: DbCustomer, order: DbOrder): void {
    if (order.totalPrice <= 0) return;
    const date = new Date().toISOString().slice(0, 10);
    const priced = this.applyCustomerDiscount(customer, order.totalPrice);
    order.totalPrice = priced.total;
    const invoice: DbInvoice = {
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invoiceNumber: this.nextDocumentNumber('INV', date),
      customerId: customer.id,
      orderIds: [order.id],
      issueDate: date,
      dueDate: order.deliveryDate,
      subtotal: priced.subtotal,
      discountType: priced.discountAmount > 0 ? 'PERCENT' : undefined,
      discountValue: priced.discountAmount > 0 ? customer.discountPercent : undefined,
      discountAmount: priced.discountAmount,
      totalAmount: priced.total,
      paidAmount: 0,
      status: 'ISSUED',
    };

    if (customer.accountBalance >= order.totalPrice) {
      customer.accountBalance = Math.round((customer.accountBalance - order.totalPrice) * 100) / 100;
      invoice.paidAmount = order.totalPrice;
      invoice.status = 'PAID';
      order.isPaid = true;
      this.payments.push({
        id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receiptNumber: this.nextDocumentNumber('REC', date),
        customerId: customer.id,
        invoiceId: invoice.id,
        paymentDate: date,
        amount: order.totalPrice,
        paymentMethod: 'PREPAID_CREDIT',
        notes: `Commande ${order.orderNumber}`,
      });
    } else {
      order.isPaid = false;
    }

    order.invoiceId = invoice.id;
    this.invoices.push(invoice);
  }

  private adjustOrderInvoice(customer: DbCustomer, order: DbOrder, newTotal: number): void {
    const invoice = this.invoices.find(
      (entry) => entry.id === order.invoiceId || entry.orderIds.includes(order.id)
    );
    if (!invoice) return;
    const priced = this.applyCustomerDiscount(customer, newTotal);
    const previousTotal = invoice.totalAmount;
    if (previousTotal === priced.total) return;

    invoice.subtotal = priced.subtotal;
    invoice.discountType = priced.discountAmount > 0 ? 'PERCENT' : undefined;
    invoice.discountValue = priced.discountAmount > 0 ? customer.discountPercent : undefined;
    invoice.discountAmount = priced.discountAmount;

    if (invoice.status === 'PAID' || order.isPaid) {
      const delta = priced.total - previousTotal;
      if (delta > 0 && customer.accountBalance < delta) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
      customer.accountBalance = Math.round((customer.accountBalance - delta) * 100) / 100;
      invoice.totalAmount = priced.total;
      invoice.paidAmount = priced.total;
      order.isPaid = true;
      this.payments.push({
        id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receiptNumber: this.nextDocumentNumber('REC', new Date().toISOString().slice(0, 10)),
        customerId: customer.id,
        invoiceId: invoice.id,
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: delta,
        paymentMethod: 'PREPAID_CREDIT',
        notes: `Ajustement ${order.orderNumber}`,
      });
    } else {
      invoice.totalAmount = priced.total;
    }
  }

  private cancelOrderInvoice(customer: DbCustomer, order: DbOrder): void {
    const invoice = this.invoices.find(
      (entry) => entry.id === order.invoiceId || entry.orderIds.includes(order.id)
    );
    if (!invoice || invoice.status === 'CANCELLED') return;
    if (invoice.status === 'PAID' && invoice.paidAmount > 0) {
      customer.accountBalance = Math.round((customer.accountBalance + invoice.paidAmount) * 100) / 100;
      this.payments.push({
        id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receiptNumber: this.nextDocumentNumber('REC', new Date().toISOString().slice(0, 10)),
        customerId: customer.id,
        invoiceId: invoice.id,
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: -invoice.paidAmount,
        paymentMethod: 'PREPAID_CREDIT',
        notes: `Remboursement ${order.orderNumber}`,
      });
      order.isPaid = false;
    }
    invoice.status = 'CANCELLED';
    invoice.paidAmount = 0;
  }

  private toClientDishView(recipe: DbRecipe): ClientDishView {
    return {
      ...this.toSimpleDishView(recipe),
      price: recipe.price ?? this.settings.lunchPrice,
    };
  }

  public getClientDishes(): ClientDishView[] {
    return this.recipes
      .filter((recipe) => recipe.isActive !== false)
      .map((recipe) => this.toClientDishView(recipe));
  }

  private orderDeadline(date: string): Date {
    const override = this.settings.deadlineOverrides?.[date];
    if (override) {
      const parsed = new Date(override);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const [hours, minutes] = this.settings.cutoffTime.split(':').map(Number);
    const deadline = new Date(`${date}T00:00:00`);
    deadline.setDate(deadline.getDate() - this.settings.cutoffDaysBefore);
    deadline.setHours(hours, minutes, 0, 0);
    return deadline;
  }

  public getClientMenuRange(from: string, to: string): ClientMenuDayView[] {
    return this.getSimpleMenuRange(from, to, 'current').map((day) => {
      const lunchRecipe = day.lunch ? this.getRecipeById(day.lunch.id) : undefined;
      const dinnerRecipe = day.dinner ? this.getRecipeById(day.dinner.id) : undefined;
      const alternatives = this.recipes
        .filter(
          (recipe) =>
            recipe.isActive !== false &&
            recipe.id !== day.lunch?.id &&
            recipe.id !== day.dinner?.id
        )
        .map((recipe) => this.toClientDishView(recipe));
      const deadline = this.orderDeadline(day.date);
      return {
        date: day.date,
        archived: day.archived,
        lunch: lunchRecipe ? this.toClientDishView(lunchRecipe) : null,
        dinner: dinnerRecipe ? this.toClientDishView(dinnerRecipe) : null,
        alternatives,
        orderDeadline: deadline.toISOString(),
        closed:
          Date.now() > deadline.getTime() ||
          (this.settings.closedDates || []).includes(day.date),
      };
    });
  }

  private priceClientOrder(
    day: ClientMenuDayView,
    input: {
      lunchPortions: number;
      dinnerPortions: number;
      lunchPackaging?: PackagingType;
      dinnerPackaging?: PackagingType;
      alternatives: { dishId: string; portions: number }[];
      extras: { name: string; quantity: number }[];
    },
    customerId = '',
    allowEmpty = false
  ): {
    items: DbOrderItem[];
    extras: NonNullable<DbOrder['extras']>;
    lunchPortions: number;
    dinnerPortions: number;
    mealsCount: number;
    totalPrice: number;
  } {
    const portionValue = (value: unknown): number | null => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) return null;
      return value;
    };
    const lunchPortions = portionValue(input.lunchPortions);
    const dinnerPortions = portionValue(input.dinnerPortions);
    if (lunchPortions === null || dinnerPortions === null) throw new Error('QUANTITY_INVALID');
    if (lunchPortions + dinnerPortions === 0) {
      const hasAlternatives = input.alternatives.some((entry) => Number(entry.portions) > 0);
      const hasExtras = input.extras.some((entry) => Number(entry.quantity) > 0);
      if (allowEmpty && !hasAlternatives && !hasExtras) {
        return {
          items: [],
          extras: [],
          lunchPortions: 0,
          dinnerPortions: 0,
          mealsCount: 0,
          totalPrice: 0,
        };
      }
      throw new Error('QUANTITY_EMPTY');
    }
    if (lunchPortions > 0 && !day.lunch) throw new Error('NO_LUNCH_DISH');
    if (dinnerPortions > 0 && !day.dinner) throw new Error('NO_DINNER_DISH');
    if (lunchPortions > 0 && !input.lunchPackaging) throw new Error('PACKAGING_REQUIRED');
    if (dinnerPortions > 0 && !input.dinnerPackaging) throw new Error('PACKAGING_REQUIRED');

    const items: DbOrderItem[] = [];
    let totalPrice = 0;
    if (lunchPortions > 0 && day.lunch) {
      items.push({
        id: `item-${Date.now()}-lunch`,
        recipeId: day.lunch.id,
        portions: lunchPortions,
        unitPrice: this.settings.lunchPrice,
      });
      totalPrice += lunchPortions * this.settings.lunchPrice;
    }
    if (dinnerPortions > 0 && day.dinner) {
      items.push({
        id: `item-${Date.now()}-dinner`,
        recipeId: day.dinner.id,
        portions: dinnerPortions,
        unitPrice: this.settings.dinnerPrice,
      });
      totalPrice += dinnerPortions * this.settings.dinnerPrice;
    }

    const familyCounts = new Map<string, number>();
    const addFamily = (family: string | undefined, portions: number): void => {
      if (!family) return;
      familyCounts.set(family, (familyCounts.get(family) || 0) + portions);
    };
    addFamily(day.lunch?.family, lunchPortions);
    addFamily(day.dinner?.family, dinnerPortions);

    const mainDishIds = new Set([day.lunch?.id, day.dinner?.id].filter(Boolean));
    let alternativePortions = 0;
    for (const alternative of input.alternatives) {
      const portions = portionValue(alternative.portions);
      if (portions === null) throw new Error('QUANTITY_INVALID');
      if (portions === 0) continue;
      const recipe = this.getRecipeById(alternative.dishId);
      if (!recipe || recipe.isActive === false || mainDishIds.has(recipe.id)) {
        throw new Error('ALTERNATIVE_UNAVAILABLE');
      }
      const alternativePrice = this.resolveAlternativePrice(recipe.id, customerId, portions);
      const unitPrice = alternativePrice ?? recipe.price ?? this.settings.lunchPrice;
      items.push({
        id: `item-${Date.now()}-${items.length}`,
        recipeId: recipe.id,
        portions,
        unitPrice,
      });
      alternativePortions += portions;
      addFamily(recipe.family, portions);
      totalPrice += portions * unitPrice;
    }

    const mealsCount = lunchPortions + dinnerPortions;
    const totalMeals = mealsCount + alternativePortions;
    const extras: NonNullable<DbOrder['extras']> = [];
    for (const requested of input.extras) {
      const configured = this.settings.extras.find((extra) => extra.name === requested.name);
      if (!configured) throw new Error('EXTRA_UNAVAILABLE');
      const quantity = portionValue(requested.quantity);
      const perMeals = configured.perMeals && configured.perMeals > 0 ? configured.perMeals : 1;
      const eligibleMeals = configured.families?.length
        ? configured.families.reduce((sum, family) => sum + (familyCounts.get(family) || 0), 0)
        : totalMeals;
      const suggested = Math.ceil(eligibleMeals / perMeals);
      if (quantity === null || quantity > suggested) throw new Error('EXTRA_QUANTITY_INVALID');
      if (quantity === 0) continue;
      extras.push({ name: configured.name, quantity, unitPrice: configured.price });
      totalPrice += quantity * configured.price;
    }
    totalPrice += this.settings.deliveryPrice + this.settings.packagingPrice * mealsCount;

    return { items, extras, lunchPortions, dinnerPortions, mealsCount, totalPrice };
  }

  public placeClientOrder(input: {
    customer: DbCustomer;
    date: string;
    lunchPortions: number;
    dinnerPortions: number;
    lunchPackaging?: PackagingType;
    dinnerPackaging?: PackagingType;
    alternatives: { dishId: string; portions: number }[];
    extras: { name: string; quantity: number }[];
    notes?: string;
    source?: 'CLIENT' | 'AUTOMATIC';
    bypassCutoff?: boolean;
    allowEmpty?: boolean;
  }): DbOrder {
    const customer = this.getCustomerById(input.customer.id);
    if (!customer) throw new Error('ACCOUNT_NOT_FOUND');
    if (customer.accountStatus !== 'ACTIVE') throw new Error('ACCOUNT_NOT_ACTIVE');
    if (this.isClientReviewRequired(customer)) throw new Error('REVIEW_REQUIRED');

    const day = this.getClientMenuRange(input.date, input.date)[0];
    if (!day || (!day.lunch && !day.dinner)) throw new Error('NO_MENU');
    if (day.closed && !input.bypassCutoff) throw new Error('ORDER_CLOSED');

    const priced = this.priceClientOrder(day, input, input.customer.id, input.allowEmpty);
    const zeroOrder = priced.mealsCount === 0 && priced.items.length === 0;
    const order: DbOrder = {
      id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderNumber: `JNT-${input.date.replace(/-/g, '')}-${String(this.orders.length + 1).padStart(3, '0')}`,
      customerId: customer.id,
      deliveryDate: input.date,
      serviceTime: priced.lunchPortions > 0 ? MealServiceTime.LUNCH : MealServiceTime.DINNER,
      status: zeroOrder ? OrderStatus.CANCELLED : OrderStatus.CONFIRMED,
      cancellationReason: zeroOrder ? 'ZERO_QUANTITY' : undefined,
      totalPortions: priced.mealsCount,
      lunchPortions: priced.lunchPortions,
      dinnerPortions: priced.dinnerPortions,
      deliveryAddress: customer.deliveryAddress,
      notes: input.notes?.trim() || undefined,
      items: priced.items,
      packaging: {
        lunch: priced.lunchPortions > 0 ? input.lunchPackaging : undefined,
        dinner: priced.dinnerPortions > 0 ? input.dinnerPackaging : undefined,
      },
      extras: priced.extras,
      source: input.source || 'CLIENT',
      orderMode: 'MENU',
      createdAt: new Date().toISOString(),
      orderType:
        input.source === 'AUTOMATIC'
          ? 'WEEKLY'
          : customer.isSubsidiary
            ? 'SUBSIDIARY'
            : customer.subscriptionType === 'CORPORATE' || Boolean(customer.companyName)
              ? 'CORPORATE'
              : 'INDIVIDUAL',
      supplementsCost: priced.extras.reduce(
        (sum, extra) => sum + extra.quantity * extra.unitPrice,
        0
      ),
      totalPrice: priced.totalPrice,
      isPaid: false,
    };
    this.orders.push(order);
    if (!zeroOrder) {
      this.consumeAlternatives(priced.items, customer.id);
      this.issueOrderInvoice(customer, order);
      this.notify(
        'CLIENT',
        'ORDER_CREATED',
        { orderNumber: order.orderNumber, total: order.totalPrice, date: order.deliveryDate },
        customer.id
      );
      this.notify(
        'STAFF',
        'ORDER_CREATED',
        {
          orderNumber: order.orderNumber,
          customer: customer.contactName,
          total: order.totalPrice,
          date: order.deliveryDate,
        },
        customer.id
      );
    }
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customer.id,
      userName: customer.contactName,
      action: 'CREATE_ORDER',
      entityType: 'ORDER',
      entityId: order.id,
      afterSnapshot: {
        orderNumber: order.orderNumber,
        totalPrice: order.totalPrice,
        source: order.source,
      },
    });
    this.persist();
    return order;
  }

  public getOrCreateGuestCustomer(data: {
    contactName: string;
    phone: string;
    deliveryAddress: string;
  }): DbCustomer {
    const existing = this.getCustomerByPhone(data.phone);
    if (existing) {
      if (!existing.deliveryAddress && data.deliveryAddress) {
        existing.deliveryAddress = data.deliveryAddress;
      }
      return existing;
    }
    return this.createClientAccount({
      contactName: data.contactName,
      phone: data.phone,
      deliveryAddress: data.deliveryAddress,
      pinSalt: '',
      pinHash: '',
      active: false,
    });
  }

  public placeClientCatalogueOrder(input: {
    customer: DbCustomer;
    date: string;
    serviceTime: MealServiceTime;
    items: { dishId: string; portions: number }[];
    packaging: PackagingType;
    extras: { name: string; quantity: number }[];
    notes?: string;
    pending?: boolean;
  }): DbOrder {
    const customer = this.getCustomerById(input.customer.id);
    if (!customer) throw new Error('ACCOUNT_NOT_FOUND');
    if (input.pending) {
      if (['SUSPENDED', 'FROZEN', 'CANCELLED'].includes(customer.accountStatus || 'ACTIVE')) {
        throw new Error('ACCOUNT_NOT_ACTIVE');
      }
    } else {
      if (customer.accountStatus !== 'ACTIVE') throw new Error('ACCOUNT_NOT_ACTIVE');
      if (this.isClientReviewRequired(customer)) throw new Error('REVIEW_REQUIRED');
    }
    if (input.serviceTime !== MealServiceTime.LUNCH && input.serviceTime !== MealServiceTime.DINNER) {
      throw new Error('SERVICE_INVALID');
    }
    if ((this.settings.closedDates || []).includes(input.date)) throw new Error('ORDER_CLOSED');
    if (Date.now() > this.orderDeadline(input.date).getTime()) throw new Error('ORDER_CLOSED');
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 30) {
      throw new Error('CATALOGUE_EMPTY');
    }

    const merged = new Map<string, number>();
    for (const entry of input.items) {
      const recipe = this.getRecipeById(String(entry.dishId));
      if (!recipe || recipe.isActive === false) throw new Error('DISH_UNAVAILABLE');
      const portions = Number(entry.portions);
      if (!Number.isInteger(portions) || portions < 1 || portions > 100) throw new Error('QUANTITY_INVALID');
      merged.set(recipe.id, (merged.get(recipe.id) || 0) + portions);
    }

    const familyCounts = new Map<string, number>();
    const items: DbOrderItem[] = [];
    let totalPortions = 0;
    let itemsTotal = 0;
    for (const [dishId, portions] of merged) {
      const recipe = this.getRecipeById(dishId)!;
      const alternativePrice = this.resolveAlternativePrice(recipe.id, customer.id, portions);
      const unitPrice = alternativePrice ?? recipe.price ?? this.settings.lunchPrice;
      items.push({
        id: `item-${Date.now()}-${items.length}`,
        recipeId: recipe.id,
        portions,
        unitPrice,
      });
      totalPortions += portions;
      itemsTotal += portions * unitPrice;
      if (recipe.family) {
        familyCounts.set(recipe.family, (familyCounts.get(recipe.family) || 0) + portions);
      }
    }

    const extras: NonNullable<DbOrder['extras']> = [];
    let extrasTotal = 0;
    for (const requested of input.extras) {
      const configured = this.settings.extras.find((extra) => extra.name === requested.name);
      if (!configured) throw new Error('EXTRA_UNAVAILABLE');
      const quantity = Number(requested.quantity);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) throw new Error('QUANTITY_INVALID');
      if (quantity === 0) continue;
      const perMeals = configured.perMeals && configured.perMeals > 0 ? configured.perMeals : 1;
      const eligible = configured.families?.length
        ? configured.families.reduce((sum, family) => sum + (familyCounts.get(family) || 0), 0)
        : totalPortions;
      if (quantity > Math.ceil(eligible / perMeals)) throw new Error('EXTRA_QUANTITY_INVALID');
      extras.push({ name: configured.name, quantity, unitPrice: configured.price });
      extrasTotal += quantity * configured.price;
    }

    const totalPrice =
      itemsTotal +
      extrasTotal +
      this.settings.deliveryPrice +
      this.settings.packagingPrice * totalPortions;

    const order: DbOrder = {
      id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderNumber: `JNT-${input.date.replace(/-/g, '')}-${String(this.orders.length + this.pendingOrders.length + 1).padStart(3, '0')}`,
      customerId: customer.id,
      deliveryDate: input.date,
      serviceTime: input.serviceTime,
      status: input.pending ? OrderStatus.DRAFT : OrderStatus.CONFIRMED,
      totalPortions,
      lunchPortions: 0,
      dinnerPortions: 0,
      deliveryAddress: customer.deliveryAddress,
      notes: input.notes?.trim() || undefined,
      items,
      packaging:
        input.serviceTime === MealServiceTime.LUNCH
          ? { lunch: input.packaging }
          : { dinner: input.packaging },
      extras,
      source: 'CLIENT',
      orderMode: 'CATALOGUE',
      createdAt: new Date().toISOString(),
      orderType: customer.isSubsidiary
        ? 'SUBSIDIARY'
        : customer.subscriptionType === 'CORPORATE' || Boolean(customer.companyName)
          ? 'CORPORATE'
          : 'INDIVIDUAL',
      supplementsCost: extrasTotal,
      totalPrice,
      isPaid: false,
    };
    this.consumeAlternatives(items, customer.id);
    if (input.pending) {
      this.pendingOrders.push(order);
    } else {
      this.orders.push(order);
      this.issueOrderInvoice(customer, order);
      this.notify(
        'CLIENT',
        'ORDER_CREATED',
        { orderNumber: order.orderNumber, total: order.totalPrice, date: order.deliveryDate },
        customer.id
      );
    }
    this.notify(
      'STAFF',
      input.pending ? 'ORDER_PENDING' : 'ORDER_CREATED',
      {
        orderNumber: order.orderNumber,
        customer: customer.contactName,
        total: order.totalPrice,
        date: order.deliveryDate,
      },
      customer.id
    );
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customer.id,
      userName: customer.contactName,
      action: input.pending ? 'CREATE_PENDING_ORDER' : 'CREATE_ORDER',
      entityType: 'ORDER',
      entityId: order.id,
      afterSnapshot: {
        orderNumber: order.orderNumber,
        totalPrice: order.totalPrice,
        totalPortions: order.totalPortions,
        orderMode: 'CATALOGUE',
        status: order.status,
        items: items.map((item) => ({ dishId: item.recipeId, portions: item.portions })),
      },
    });
    this.persist();
    return order;
  }

  public getClientOrders(customerId: string): ClientOrderView[] {
    return this.orders
      .filter((order) => order.customerId === customerId)
      .sort((left, right) => right.deliveryDate.localeCompare(left.deliveryDate) || right.createdAt.localeCompare(left.createdAt))
      .map((order) => {
        const day = this.getSimpleMenuDay(order.deliveryDate);
        const lunchItem = order.items.find((item) => item.recipeId === day.lunch?.id);
        const dinnerItem = order.items.find((item) => item.recipeId === day.dinner?.id);
        const lunchPortions = order.lunchPortions ?? lunchItem?.portions ?? 0;
        const dinnerPortions = order.dinnerPortions ?? dinnerItem?.portions ?? 0;
        const alternatives = order.orderMode === 'CATALOGUE'
          ? []
          : order.items
              .filter((item) => item.recipeId !== day.lunch?.id && item.recipeId !== day.dinner?.id)
              .map((item) => ({ dishId: item.recipeId, portions: item.portions }));
        const deadline = this.orderDeadline(order.deliveryDate);
        const invoice = this.invoices.find(
          (entry) => entry.id === order.invoiceId || entry.orderIds.includes(order.id)
        );
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          deliveryDate: order.deliveryDate,
          serviceTime: order.serviceTime,
          status: order.status,
          totalPortions: order.totalPortions,
          totalPrice: order.totalPrice,
          lunchPortions,
          dinnerPortions,
          alternatives,
          packaging: order.packaging,
          extras: order.extras || [],
          notes: order.notes,
          source: order.source,
          orderMode: order.orderMode || 'MENU',
          items:
            order.orderMode === 'CATALOGUE'
              ? order.items.map((item) => ({
                  dishId: item.recipeId,
                  name: this.getRecipeById(item.recipeId)?.nameAr || this.getRecipeById(item.recipeId)?.name || '—',
                  portions: item.portions,
                  unitPrice: item.unitPrice ?? 0,
                }))
              : undefined,
          editable:
            order.orderMode !== 'CATALOGUE' &&
            order.status === OrderStatus.CONFIRMED &&
            (order.source || 'CLIENT') !== 'ADMIN' &&
            Date.now() <= deadline.getTime(),
          invoiceNumber: invoice?.invoiceNumber,
          isPaid: Boolean(order.isPaid),
        };
      });
  }

  public getPendingClientOrders(customerId: string): ClientOrderView[] {
    return this.pendingOrders
      .filter((order) => order.customerId === customerId)
      .map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        deliveryDate: order.deliveryDate,
        serviceTime: order.serviceTime,
        status: 'PENDING_APPROVAL',
        totalPortions: order.totalPortions,
        totalPrice: order.totalPrice,
        lunchPortions: 0,
        dinnerPortions: 0,
        alternatives: [],
        packaging: order.packaging,
        extras: order.extras || [],
        notes: order.notes,
        source: order.source,
        orderMode: order.orderMode || 'CATALOGUE',
        items: order.items.map((item) => ({
          dishId: item.recipeId,
          name: this.getRecipeById(item.recipeId)?.nameAr || this.getRecipeById(item.recipeId)?.name || '—',
          portions: item.portions,
          unitPrice: item.unitPrice ?? 0,
        })),
        editable: false,
        isPaid: false,
      }));
  }

  public updateClientOrder(
    customerId: string,
    orderId: string,
    input: {
      lunchPortions: number;
      dinnerPortions: number;
      lunchPackaging?: PackagingType;
      dinnerPackaging?: PackagingType;
      alternatives: { dishId: string; portions: number }[];
      extras: { name: string; quantity: number }[];
      notes?: string;
    }
  ): DbOrder {
    const order = this.orders.find((entry) => entry.id === orderId && entry.customerId === customerId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.orderMode === 'CATALOGUE') throw new Error('ORDER_NOT_EDITABLE');
    if (order.status !== OrderStatus.CONFIRMED) throw new Error('ORDER_NOT_EDITABLE');
    const before = this.cloneSnapshot(order);
    const day = this.getClientMenuRange(order.deliveryDate, order.deliveryDate)[0];
    if (!day || (!day.lunch && !day.dinner)) throw new Error('NO_MENU');
    if (day.closed) throw new Error('ORDER_CLOSED');

    const customer = this.getCustomerById(customerId);
    if (!customer) throw new Error('ACCOUNT_NOT_FOUND');
    const priced = this.priceClientOrder(day, input, customerId);
    this.adjustOrderInvoice(customer, order, priced.totalPrice);
    order.items = priced.items;
    order.extras = priced.extras;
    order.lunchPortions = priced.lunchPortions;
    order.dinnerPortions = priced.dinnerPortions;
    order.totalPortions = priced.mealsCount;
    order.totalPrice = priced.totalPrice;
    order.supplementsCost = priced.extras.reduce(
      (sum, extra) => sum + extra.quantity * extra.unitPrice,
      0
    );
    order.packaging = {
      lunch: priced.lunchPortions > 0 ? input.lunchPackaging : undefined,
      dinner: priced.dinnerPortions > 0 ? input.dinnerPackaging : undefined,
    };
    order.serviceTime = priced.lunchPortions > 0 ? MealServiceTime.LUNCH : MealServiceTime.DINNER;
    order.notes = input.notes?.trim() || undefined;
    this.notify(
      'CLIENT',
      'ORDER_UPDATED',
      { orderNumber: order.orderNumber, total: order.totalPrice, date: order.deliveryDate },
      customerId
    );
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customerId,
      userName: this.getCustomerById(customerId)?.contactName || 'Client',
      action: 'UPDATE_ORDER',
      entityType: 'ORDER',
      entityId: order.id,
      beforeSnapshot: { orderNumber: before.orderNumber, totalPrice: before.totalPrice, items: before.items, extras: before.extras },
      afterSnapshot: { orderNumber: order.orderNumber, totalPrice: order.totalPrice, items: order.items, extras: order.extras },
    });
    this.persist();
    return order;
  }

  public cancelClientOrder(customerId: string, orderId: string): DbOrder {
    const order = this.orders.find((entry) => entry.id === orderId && entry.customerId === customerId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status !== OrderStatus.CONFIRMED) throw new Error('ORDER_NOT_EDITABLE');
    const before = this.cloneSnapshot(order);
    const deadline = this.orderDeadline(order.deliveryDate);
    if (Date.now() > deadline.getTime()) throw new Error('ORDER_CLOSED');
    const customer = this.getCustomerById(customerId);
    if (!customer) throw new Error('ACCOUNT_NOT_FOUND');
    this.cancelOrderInvoice(customer, order);
    order.status = OrderStatus.CANCELLED;
    order.cancelledAt = new Date().toISOString();
    order.cancellationReason = 'CLIENT_CANCELLED';
    this.notify(
      'CLIENT',
      'ORDER_CANCELLED',
      { orderNumber: order.orderNumber, date: order.deliveryDate },
      customerId
    );
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: customerId,
      userName: this.getCustomerById(customerId)?.contactName || 'Client',
      action: 'CANCEL_ORDER',
      entityType: 'ORDER',
      entityId: order.id,
      beforeSnapshot: { orderNumber: before.orderNumber, status: before.status, totalPrice: before.totalPrice },
      afterSnapshot: { orderNumber: order.orderNumber, status: order.status, cancellationReason: order.cancellationReason },
    });
    this.persist();
    return order;
  }

  public getClientProgram(customerId: string): ClientProgramEntry[] {
    const customer = this.getCustomerById(customerId);
    return Array.from({ length: 7 }, (_, weekday) => {
      const entry = customer?.weeklyProgram?.find((item) => item.weekday === weekday);
      return {
        weekday,
        lunchPortions: entry?.lunchPortions || 0,
        dinnerPortions: entry?.dinnerPortions || 0,
        lunchPackaging: entry?.lunchPackaging || 'INDIVIDUAL',
        dinnerPackaging: entry?.dinnerPackaging || 'INDIVIDUAL',
      };
    });
  }

  public updateClientProgram(
    customerId: string,
    entries: ClientProgramEntry[]
  ): ClientProgramEntry[] {
    const customer = this.getCustomerById(customerId);
    if (!customer) throw new Error('ACCOUNT_NOT_FOUND');
    customer.weeklyProgram = entries
      .filter((entry) => entry.lunchPortions + entry.dinnerPortions > 0)
      .map((entry) => ({
        weekday: entry.weekday,
        lunchPortions: entry.lunchPortions,
        dinnerPortions: entry.dinnerPortions,
        lunchPackaging: entry.lunchPortions > 0 ? entry.lunchPackaging || 'INDIVIDUAL' : undefined,
        dinnerPackaging: entry.dinnerPortions > 0 ? entry.dinnerPackaging || 'INDIVIDUAL' : undefined,
      }));
    this.persist();
    return this.getClientProgram(customerId);
  }

  public generateProgramOrders(from: string, to: string, customerId?: string): DbOrder[] {
    const created: DbOrder[] = [];
    const customers = customerId
      ? [this.getCustomerById(customerId)].filter(
          (customer): customer is DbCustomer => Boolean(customer)
        )
      : this.customers;
    let cursor = from;
    for (let guard = 0; guard < 31 && cursor <= to; guard++) {
      if ((this.settings.closedDates || []).includes(cursor)) {
        cursor = addDaysIso(cursor, 1);
        continue;
      }
      const weekday = new Date(`${cursor}T12:00:00`).getDay();
      for (const customer of customers) {
        if (customer.accountStatus !== 'ACTIVE') continue;
        const entry = customer.weeklyProgram?.find((item) => item.weekday === weekday);
        if (!entry || entry.lunchPortions + entry.dinnerPortions === 0) continue;
        // A cancelled order still blocks regeneration: cancellation is the
        // customer's decision for that specific day.
        const duplicate = this.orders.some(
          (order) => order.customerId === customer.id && order.deliveryDate === cursor
        );
        if (duplicate) continue;
        try {
          created.push(
            this.placeClientOrder({
              customer,
              date: cursor,
              lunchPortions: entry.lunchPortions,
              dinnerPortions: entry.dinnerPortions,
              lunchPackaging: entry.lunchPackaging || 'INDIVIDUAL',
              dinnerPackaging: entry.dinnerPackaging || 'INDIVIDUAL',
              alternatives: [],
              extras: [],
              notes: 'طلب تلقائي — البرنامج الأسبوعي',
              source: 'AUTOMATIC',
              bypassCutoff: true,
            })
          );
        } catch {
          // No published menu or missing dish for that date: skip.
        }
      }
      cursor = addDaysIso(cursor, 1);
    }
    return created;
  }

  // ==========================================
  // Meal Plans
  // ==========================================
  public getMealPlans(date?: string): DbMealPlan[] {
    if (date) {
      return this.mealPlans.filter((mp) => mp.date === date);
    }
    return this.mealPlans;
  }

  public createMealPlan(data: Omit<DbMealPlan, 'id'>): DbMealPlan {
    const existingIndex = this.mealPlans.findIndex(
      (mp) => mp.date === data.date && mp.serviceTime === data.serviceTime
    );
    const newPlan: DbMealPlan = {
      ...data,
      id: `mp-${Date.now()}`,
    };
    if (existingIndex >= 0) {
      this.mealPlans[existingIndex] = newPlan;
    } else {
      this.mealPlans.push(newPlan);
    }
    this.persist();
    return newPlan;
  }

  public getWeeklyMenuPlan(startDateStr?: string): WeeklyDayPlan[] {
    const baseDate = startDateStr ? new Date(startDateStr) : new Date();
    const days: WeeklyDayPlan[] = [];
    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

    for (let i = 0; i < 7; i++) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() + i);
      const dateStr = d.toLocaleDateString('en-CA');
      const dayName = dayNames[d.getDay()];

      const lunch = this.mealPlans.find((m) => m.date === dateStr && m.serviceTime === MealServiceTime.LUNCH);
      const dinner = this.mealPlans.find((m) => m.date === dateStr && m.serviceTime === MealServiceTime.DINNER);

      const starter = lunch?.starterRecipeId ? this.getRecipeById(lunch.starterRecipeId) : undefined;
      const main = lunch?.mainCourseRecipeId ? this.getRecipeById(lunch.mainCourseRecipeId) : undefined;
      const dessert = lunch?.dessertRecipeId ? this.getRecipeById(lunch.dessertRecipeId) : undefined;
      const dinnerMain = dinner?.mainCourseRecipeId ? this.getRecipeById(dinner.mainCourseRecipeId) : undefined;

      days.push({
        date: dateStr,
        dayName,
        lunch,
        dinner,
        starterName: starter?.name,
        mainName: main?.name,
        dessertName: dessert?.name,
        dinnerMainName: dinnerMain?.name,
      });
    }

    return days;
  }

  // ==========================================
  // Orders
  // ==========================================
  public getOrders(filters?: { date?: string; serviceTime?: MealServiceTime; status?: OrderStatus }): DbOrder[] {
    let result = [...this.orders];
    if (filters?.date) {
      result = result.filter((o) => o.deliveryDate === filters.date);
    }
    if (filters?.serviceTime) {
      result = result.filter((o) => o.serviceTime === filters.serviceTime);
    }
    if (filters?.status) {
      result = result.filter((o) => o.status === filters.status);
    }
    return result;
  }

  public getOrderById(id: string): DbOrder | undefined {
    return this.orders.find((o) => o.id === id);
  }

  public createOrder(data: {
    customerId: string;
    deliveryDate: string;
    serviceTime: MealServiceTime;
    items: { recipeId: string; portions: number; specialNotes?: string }[];
    deliveryAddress?: string;
    notes?: string;
  }): DbOrder {
    const customer = this.getCustomerById(data.customerId);
    const totalPortions = data.items.reduce((sum, item) => sum + item.portions, 0);
    const orderNumber = `JNT-${data.deliveryDate.replace(/-/g, '')}-${String(this.orders.length + 1).padStart(3, '0')}`;

    const newOrder: DbOrder = {
      id: `ord-${Date.now()}`,
      orderNumber,
      customerId: data.customerId,
      deliveryDate: data.deliveryDate,
      serviceTime: data.serviceTime,
      status: OrderStatus.CONFIRMED,
      totalPortions,
      deliveryAddress: data.deliveryAddress || (customer ? customer.deliveryAddress : ''),
      notes: data.notes,
      items: data.items.map((it, idx) => ({
        id: `item-${Date.now()}-${idx}`,
        recipeId: it.recipeId,
        portions: it.portions,
        specialNotes: it.specialNotes,
      })),
      createdAt: new Date().toISOString(),
      orderType: 'EXCEPTIONAL',
      supplementsCost: 0,
      totalPrice: 0,
      isPaid: false,
    };

    this.orders.unshift(newOrder);
    this.persist();
    return newOrder;
  }

  public updateOrderStatus(id: string, status: OrderStatus): DbOrder | undefined {
    const order = this.getOrderById(id);
    if (order) {
      const beforeStatus = order.status;
      order.status = status;
      this.auditLogs.unshift({
        id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        userId: 'system',
        userName: 'Workflow',
        action: 'UPDATE_ORDER_STATUS',
        entityType: 'ORDER',
        entityId: order.id,
        beforeSnapshot: { orderNumber: order.orderNumber, status: beforeStatus },
        afterSnapshot: { orderNumber: order.orderNumber, status: order.status },
      });
      this.persist();
    }
    return order;
  }

  // ==========================================
  // CORE ENGINE: Production & Ingredient Explosion
  // ==========================================
  public calculateProductionNeeds(date?: string, serviceTime?: MealServiceTime): ProductionPlanSummary {
    const targetDate = date || new Date().toLocaleDateString('en-CA');
    let relevantOrders = this.orders.filter(
      (o) =>
        o.deliveryDate === targetDate &&
        (serviceTime ? o.serviceTime === serviceTime : true) &&
        o.status !== OrderStatus.CANCELLED
    );
    if (relevantOrders.length === 0 && !date) {
      relevantOrders = this.orders.filter((o) => o.status !== OrderStatus.CANCELLED);
    }

    const recipeMap = new Map<string, { portions: number; ordersCount: number }>();

    for (const order of relevantOrders) {
      for (const item of order.items) {
        const current = recipeMap.get(item.recipeId) || { portions: 0, ordersCount: 0 };
        current.portions += item.portions;
        current.ordersCount += 1;
        recipeMap.set(item.recipeId, current);
      }
    }

    const recipes: ProductionRequirement[] = [];
    const ingredientNeedsMap = new Map<string, number>();

    for (const [recipeId, stats] of recipeMap.entries()) {
      const recipe = this.getRecipeById(recipeId);
      if (!recipe) continue;

      recipes.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        category: recipe.category,
        totalPortions: stats.portions,
        ordersCount: stats.ordersCount,
      });

      // Explode recipe into raw ingredients
      for (const item of recipe.ingredients) {
        const needed = item.quantityPerPortion * stats.portions;
        const currentTotal = ingredientNeedsMap.get(item.ingredientId) || 0;
        ingredientNeedsMap.set(item.ingredientId, currentTotal + needed);
      }
    }

    let totalEstimatedCost = 0;
    let deficitCost = 0;
    const ingredientRequirements: IngredientRequirement[] = [];

    for (const [ingredientId, neededQty] of ingredientNeedsMap.entries()) {
      const ing = this.getIngredientById(ingredientId);
      if (!ing) continue;

      const roundedNeeded = Math.round(neededQty * 1000) / 1000;
      const stockAfter = Math.round((ing.currentStock - roundedNeeded) * 1000) / 1000;
      const deficit = stockAfter < 0 ? Math.abs(stockAfter) : 0;
      const lineCost = Math.round(roundedNeeded * ing.unitCost);
      const lineDeficitCost = Math.round(deficit * ing.unitCost);

      totalEstimatedCost += lineCost;
      deficitCost += lineDeficitCost;

      const supplier = this.suppliers.find((s) => s.id === ing.supplierId);

      ingredientRequirements.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        unit: ing.unit,
        currentStock: ing.currentStock,
        quantityRequired: roundedNeeded,
        stockAfterProduction: stockAfter,
        deficit,
        unitCost: ing.unitCost,
        totalDeficitCost: lineDeficitCost,
        supplierId: ing.supplierId || '',
        supplierName: supplier ? supplier.name : 'Fournisseur non assigné',
      });
    }

    const totalMealPortions = recipes.reduce((sum, r) => sum + r.totalPortions, 0);
    const collectiveSize = this.settings.collectivePackagingSize || 10;
    const packagingRequirements = [
      { type: 'Barquettes Kraft 750ml Individuelles', quantity: totalMealPortions },
      { type: 'Couvercles Transparents Écologiques', quantity: totalMealPortions },
      { type: 'Bacs Collectifs de Transport', quantity: Math.ceil(totalMealPortions / collectiveSize) },
    ];

    return {
      date: targetDate,
      serviceTime,
      totalOrders: relevantOrders.length,
      totalMealPortions,
      recipes,
      ingredientRequirements,
      totalEstimatedCost,
      deficitCost,
      hasDeficit: deficitCost > 0,
      packagingRequirements,
    };
  }

  // ==========================================
  // Purchasing & Inventory Automation
  // ==========================================
  public generatePurchaseOrdersFromDeficits(date: string, serviceTime?: MealServiceTime): DbPurchaseOrder[] {
    const plan = this.calculateProductionNeeds(date, serviceTime);
    const deficitsBySupplier = new Map<string, { ingredientId: string; quantity: number; unitCost: number }[]>();

    for (const req of plan.ingredientRequirements) {
      if (req.deficit > 0) {
        const list = deficitsBySupplier.get(req.supplierId) || [];
        list.push({
          ingredientId: req.ingredientId,
          quantity: req.deficit,
          unitCost: req.unitCost,
        });
        deficitsBySupplier.set(req.supplierId, list);
      }
    }

    const createdPOs: DbPurchaseOrder[] = [];

    for (const [supplierId, items] of deficitsBySupplier.entries()) {
      const totalCost = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      const poNumber = `PO-${date.replace(/-/g, '')}-${String(this.purchaseOrders.length + 1).padStart(3, '0')}`;

      const po: DbPurchaseOrder = {
        id: `po-${Date.now()}-${supplierId}`,
        poNumber,
        supplierId,
        orderDate: new Date().toISOString().split('T')[0],
        status: 'SENT',
        totalCost: Math.round(totalCost),
        items,
        notes: `Commande automatique de réapprovisionnement pour la production du ${date}`,
      };

      this.purchaseOrders.push(po);
      createdPOs.push(po);
    }

    return createdPOs;
  }

  public getPurchaseOrders(): DbPurchaseOrder[] {
    return this.purchaseOrders;
  }

  public receivePurchaseOrder(poId: string): DbPurchaseOrder | undefined {
    const po = this.purchaseOrders.find((p) => p.id === poId);
    if (!po || po.status === 'RECEIVED') return po;

    // Increment inventory stock
    for (const item of po.items) {
      const ing = this.getIngredientById(item.ingredientId);
      if (ing) {
        ing.currentStock = Math.round((ing.currentStock + item.quantity) * 1000) / 1000;
      }
    }

    po.status = 'RECEIVED';
    this.persist();
    return po;
  }

  // ==========================================
  // Workshops, Work Orders & Production Variance
  // ==========================================
  public getWorkshops(): DbWorkshop[] {
    return this.workshops;
  }

  private stationForRecipe(recipe: DbRecipe): WorkshopStation {
    if (recipe.category === ComponentCategory.DESSERT) return 'PATISSERIE';
    if (
      recipe.category === ComponentCategory.STARTER ||
      recipe.category === ComponentCategory.SIDE_DISH ||
      recipe.category === ComponentCategory.BEVERAGE ||
      recipe.category === ComponentCategory.BREAD
    ) {
      return 'FROID';
    }
    return 'CHAUD';
  }

  private workshopLoad(
    workshopId: string,
    date: string,
    serviceTime: MealServiceTime,
    excludeWorkOrderId?: string
  ): number {
    return this.workOrders
      .filter(
        (order) =>
          order.workshopId === workshopId &&
          order.date === date &&
          order.serviceTime === serviceTime &&
          order.id !== excludeWorkOrderId
      )
      .reduce((sum, order) => sum + order.plannedPortions, 0);
  }

  private pickWorkshop(
    station: WorkshopStation,
    date: string,
    serviceTime: MealServiceTime,
    plannedPortions: number
  ): DbWorkshop | undefined {
    const candidates = this.workshops
      .filter((workshop) => workshop.isActive && workshop.station === station)
      .sort((left, right) => left.capacityPortions - right.capacityPortions);
    return candidates.find(
      (workshop) =>
        this.workshopLoad(workshop.id, date, serviceTime) + plannedPortions <=
        workshop.capacityPortions
    );
  }

  private assertWorkshopCapacity(workOrder: DbWorkOrder): void {
    if (!workOrder.workshopId) return;
    const workshop = this.workshops.find((entry) => entry.id === workOrder.workshopId);
    if (!workshop) throw new Error('WORKSHOP_NOT_FOUND');
    if (workshop.station !== workOrder.station) throw new Error('WORKSHOP_STATION_MISMATCH');
    const load =
      this.workshopLoad(workOrder.workshopId, workOrder.date, workOrder.serviceTime, workOrder.id) +
      workOrder.plannedPortions;
    if (load > workshop.capacityPortions) throw new Error('WORKSHOP_CAPACITY_EXCEEDED');
  }

  public createWorkshop(
    data: { name: string; station: WorkshopStation; capacityPortions: number; notes?: string },
    actor?: { id: string; name: string }
  ): DbWorkshop {
    if (!isWorkshopStation(data.station)) throw new Error('INVALID_WORKSHOP_STATION');
    if (!Number.isInteger(data.capacityPortions) || data.capacityPortions <= 0) {
      throw new Error('INVALID_WORKSHOP_CAPACITY');
    }
    const workshop: DbWorkshop = {
      id: `workshop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: data.name.trim(),
      station: data.station,
      capacityPortions: data.capacityPortions,
      isActive: true,
      notes: data.notes?.trim(),
    };
    this.workshops.push(workshop);
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'CREATE_WORKSHOP',
      entityType: 'WORKSHOP',
      entityId: workshop.id,
      afterSnapshot: workshop,
    });
    this.persist();
    return workshop;
  }

  public updateWorkshop(
    workshopId: string,
    patch: {
      name?: string;
      station?: WorkshopStation;
      capacityPortions?: number;
      isActive?: boolean;
      notes?: string;
    },
    actor?: { id: string; name: string }
  ): DbWorkshop | undefined {
    const workshop = this.workshops.find((entry) => entry.id === workshopId);
    if (!workshop) return undefined;
    const before = this.cloneSnapshot(workshop);
    if (patch.station !== undefined) {
      if (!isWorkshopStation(patch.station)) throw new Error('INVALID_WORKSHOP_STATION');
      workshop.station = patch.station;
    }
    if (patch.capacityPortions !== undefined) {
      if (!Number.isInteger(patch.capacityPortions) || patch.capacityPortions <= 0) {
        throw new Error('INVALID_WORKSHOP_CAPACITY');
      }
      workshop.capacityPortions = patch.capacityPortions;
    }
    if (patch.name !== undefined) workshop.name = patch.name.trim();
    if (patch.isActive !== undefined) workshop.isActive = patch.isActive;
    if (patch.notes !== undefined) workshop.notes = patch.notes.trim();
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'UPDATE_WORKSHOP',
      entityType: 'WORKSHOP',
      entityId: workshop.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(workshop),
    });
    this.persist();
    return workshop;
  }

  public getWorkOrders(date?: string, serviceTime?: MealServiceTime): DbWorkOrder[] {
    return this.workOrders.filter(
      (order) =>
        (date ? order.date === date : true) &&
        (serviceTime ? order.serviceTime === serviceTime : true)
    );
  }

  /**
   * Creates (or refreshes) one work order per recipe and service from the
   * validated production plan. The workshop is chosen by station and remaining
   * capacity; when no workshop fits, the order stays unassigned and carries a
   * warning instead of silently overbooking the atelier.
   */
  public generateWorkOrders(date: string, serviceTime?: MealServiceTime): DbWorkOrder[] {
    const services = serviceTime ? [serviceTime] : [MealServiceTime.LUNCH, MealServiceTime.DINNER];
    const created: DbWorkOrder[] = [];
    let changed = false;

    for (const service of services) {
      const plan = this.calculateProductionNeeds(date, service);
      for (const requirement of plan.recipes) {
        const recipe = this.getRecipeById(requirement.recipeId);
        if (!recipe) continue;
        const existing = this.workOrders.find(
          (order) =>
            order.date === date &&
            order.serviceTime === service &&
            order.recipeId === requirement.recipeId
        );
        if (existing) {
          if (existing.plannedPortions !== requirement.totalPortions) {
            existing.plannedPortions = requirement.totalPortions;
            existing.updatedAt = new Date().toISOString();
            changed = true;
          }
          continue;
        }
        const alternativeStation = this.alternatives.find(
          (alternative) => alternative.recipeId === requirement.recipeId && alternative.station
        )?.station;
        const station = alternativeStation ?? this.stationForRecipe(recipe);
        const workshop = this.pickWorkshop(station, date, service, requirement.totalPortions);
        const now = new Date().toISOString();
        const steps: DbWorkOrderStep[] = [
          { name: 'Préparation', done: false },
          { name: 'Production / cuisson', done: false },
          { name: 'Conditionnement', done: false },
          { name: 'Contrôle qualité', done: false },
        ];
        const workOrder: DbWorkOrder = {
          id: `wo-${date.replace(/-/g, '')}-${service}-${requirement.recipeId}`,
          date,
          serviceTime: service,
          recipeId: requirement.recipeId,
          recipeName: requirement.recipeName,
          station,
          workshopId: workshop?.id,
          plannedPortions: requirement.totalPortions,
          producedPortions: 0,
          status: 'PLANNED',
          steps,
          notes: workshop
            ? undefined
            : `Capacité atelier insuffisante pour ${requirement.totalPortions} portions (${station}).`,
          createdAt: now,
          updatedAt: now,
        };
        this.workOrders.push(workOrder);
        created.push(workOrder);
      }
    }

    if (created.length > 0 || changed) {
      this.auditLogs.unshift({
        id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        userId: 'system',
        userName: 'Planification',
        action: 'GENERATE_WORK_ORDERS',
        entityType: 'WORK_ORDER',
        entityId: date,
        afterSnapshot: { date, serviceTime, created: created.length },
      });
      this.persist();
    }
    return created;
  }

  public updateWorkOrder(
    workOrderId: string,
    patch: {
      plannedPortions?: number;
      producedPortions?: number;
      status?: DbWorkOrder['status'];
      steps?: DbWorkOrderStep[];
      notes?: string;
      workshopId?: string | null;
    },
    actor?: { id: string; name: string }
  ): DbWorkOrder | undefined {
    const workOrder = this.workOrders.find((entry) => entry.id === workOrderId);
    if (!workOrder) return undefined;
    const before = this.cloneSnapshot(workOrder);
    // Mutate a clone so a rejected capacity check leaves no partial update.
    const next = this.cloneSnapshot(workOrder);

    if (patch.workshopId !== undefined) {
      if (patch.workshopId === null) {
        next.workshopId = undefined;
      } else {
        const workshop = this.workshops.find((entry) => entry.id === patch.workshopId);
        if (!workshop) throw new Error('WORKSHOP_NOT_FOUND');
        next.workshopId = workshop.id;
      }
    }
    if (patch.plannedPortions !== undefined) {
      if (!Number.isInteger(patch.plannedPortions) || patch.plannedPortions < 0) {
        throw new Error('INVALID_PLANNED_PORTIONS');
      }
      next.plannedPortions = patch.plannedPortions;
    }
    if (patch.producedPortions !== undefined) {
      if (!Number.isInteger(patch.producedPortions) || patch.producedPortions < 0) {
        throw new Error('INVALID_PRODUCED_PORTIONS');
      }
      next.producedPortions = patch.producedPortions;
    }
    if (next.workshopId) this.assertWorkshopCapacity(next);
    if (patch.steps !== undefined) {
      if (!Array.isArray(patch.steps) || patch.steps.length === 0) {
        throw new Error('INVALID_WORK_ORDER_STEPS');
      }
      next.steps = patch.steps.map((step) => ({
        name: String(step.name || '').slice(0, 80),
        done: Boolean(step.done),
        doneAt: step.done ? step.doneAt || new Date().toISOString() : undefined,
      }));
    }
    if (patch.notes !== undefined) next.notes = patch.notes.trim();
    if (patch.status !== undefined) {
      if (!['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(patch.status)) {
        throw new Error('INVALID_WORK_ORDER_STATUS');
      }
      next.status = patch.status;
    } else {
      const allStepsDone = next.steps.every((step) => step.done);
      if (allStepsDone && next.producedPortions >= next.plannedPortions) {
        next.status = 'COMPLETED';
      } else if (next.producedPortions > 0 || next.steps.some((step) => step.done)) {
        next.status = 'IN_PROGRESS';
      }
    }
    next.updatedAt = new Date().toISOString();
    Object.assign(workOrder, next);
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'UPDATE_WORK_ORDER',
      entityType: 'WORK_ORDER',
      entityId: workOrder.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(workOrder),
    });
    this.persist();
    return workOrder;
  }

  public getProductionVariance(date: string, serviceTime?: MealServiceTime): ProductionVariance {
    const services = serviceTime ? [serviceTime] : [MealServiceTime.LUNCH, MealServiceTime.DINNER];
    const lines: ProductionVarianceLine[] = [];

    for (const service of services) {
      const plan = this.calculateProductionNeeds(date, service);
      for (const requirement of plan.recipes) {
        const recipe = this.getRecipeById(requirement.recipeId);
        const station = recipe ? this.stationForRecipe(recipe) : 'CONDITIONNEMENT';
        const orders = this.workOrders.filter(
          (order) =>
            order.date === date &&
            order.serviceTime === service &&
            order.recipeId === requirement.recipeId
        );
        const plannedPortions =
          orders.length > 0
            ? orders.reduce((sum, order) => sum + order.plannedPortions, 0)
            : requirement.totalPortions;
        const producedPortions = orders.reduce((sum, order) => sum + order.producedPortions, 0);
        const surplus = Math.max(0, producedPortions - plannedPortions);
        const shortage = Math.max(0, plannedPortions - producedPortions);
        lines.push({
          recipeId: requirement.recipeId,
          recipeName: requirement.recipeName,
          station,
          plannedPortions,
          producedPortions,
          surplus,
          shortage,
          proposal:
            shortage > 0
              ? `Produire ${shortage} portion(s) supplémentaire(s) ou réaffecter un atelier.`
              : surplus > 0
                ? `Surplus de ${surplus} portion(s) : proposer au personnel ou réduire la prochaine production.`
                : 'Production conforme au prévu.',
        });
      }
    }

    return {
      date,
      serviceTime,
      totalPlanned: lines.reduce((sum, line) => sum + line.plannedPortions, 0),
      totalProduced: lines.reduce((sum, line) => sum + line.producedPortions, 0),
      totalSurplus: lines.reduce((sum, line) => sum + line.surplus, 0),
      totalShortage: lines.reduce((sum, line) => sum + line.shortage, 0),
      lines,
    };
  }

  // ==========================================
  // Vehicles & Delivery Load
  // ==========================================
  public getVehicles(): DbVehicle[] {
    return this.vehicles;
  }

  public createVehicle(
    data: { label: string; type: DbVehicle['type']; capacityMaxPortions: number; plate?: string },
    actor?: { id: string; name: string }
  ): DbVehicle {
    if (!Number.isInteger(data.capacityMaxPortions) || data.capacityMaxPortions <= 0) {
      throw new Error('INVALID_VEHICLE_CAPACITY');
    }
    if (!['MOTO', 'VAN', 'TRUCK'].includes(data.type)) throw new Error('INVALID_VEHICLE_TYPE');
    const vehicle: DbVehicle = {
      id: `vehicle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: data.label.trim(),
      type: data.type,
      capacityMaxPortions: data.capacityMaxPortions,
      isActive: true,
      plate: data.plate?.trim(),
    };
    this.vehicles.push(vehicle);
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'CREATE_VEHICLE',
      entityType: 'VEHICLE',
      entityId: vehicle.id,
      afterSnapshot: vehicle,
    });
    this.persist();
    return vehicle;
  }

  public updateVehicle(
    vehicleId: string,
    patch: {
      label?: string;
      type?: DbVehicle['type'];
      capacityMaxPortions?: number;
      isActive?: boolean;
      plate?: string;
    },
    actor?: { id: string; name: string }
  ): DbVehicle | undefined {
    const vehicle = this.vehicles.find((entry) => entry.id === vehicleId);
    if (!vehicle) return undefined;
    const before = this.cloneSnapshot(vehicle);
    if (patch.label !== undefined) vehicle.label = patch.label.trim();
    if (patch.type !== undefined) {
      if (!['MOTO', 'VAN', 'TRUCK'].includes(patch.type)) throw new Error('INVALID_VEHICLE_TYPE');
      vehicle.type = patch.type;
    }
    if (patch.capacityMaxPortions !== undefined) {
      if (!Number.isInteger(patch.capacityMaxPortions) || patch.capacityMaxPortions <= 0) {
        throw new Error('INVALID_VEHICLE_CAPACITY');
      }
      vehicle.capacityMaxPortions = patch.capacityMaxPortions;
    }
    if (patch.isActive !== undefined) vehicle.isActive = patch.isActive;
    if (patch.plate !== undefined) vehicle.plate = patch.plate.trim();
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'UPDATE_VEHICLE',
      entityType: 'VEHICLE',
      entityId: vehicle.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(vehicle),
    });
    this.persist();
    return vehicle;
  }

  public calculateRunLoad(runId: string): number {
    const run = this.deliveryRuns.find((entry) => entry.id === runId);
    if (!run) return 0;
    return run.stops.reduce((sum, stop) => {
      const order = this.orders.find((entry) => entry.id === stop.orderId);
      if (!order || order.status === OrderStatus.CANCELLED) return sum;
      return sum + order.totalPortions;
    }, 0);
  }

  public assignVehicleToRun(
    runId: string,
    vehicleId: string,
    actor?: { id: string; name: string }
  ): DbDeliveryRun | undefined {
    const run = this.deliveryRuns.find((entry) => entry.id === runId);
    if (!run) return undefined;
    const vehicle = this.vehicles.find((entry) => entry.id === vehicleId && entry.isActive);
    if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');
    const load = this.calculateRunLoad(runId);
    if (load > vehicle.capacityMaxPortions) throw new Error('VEHICLE_CAPACITY_EXCEEDED');
    const before = { vehicleId: run.vehicleId, loadPortions: run.loadPortions };
    run.vehicleId = vehicle.id;
    run.vehicleLabel = vehicle.label;
    run.vehicleType = vehicle.type;
    run.capacityMaxPortions = vehicle.capacityMaxPortions;
    run.loadPortions = load;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'ASSIGN_VEHICLE',
      entityType: 'DELIVERY_RUN',
      entityId: run.id,
      beforeSnapshot: before,
      afterSnapshot: { vehicleId: vehicle.id, loadPortions: load },
    });
    this.persist();
    return run;
  }

  // ==========================================
  // Recipe Versioning
  // ==========================================
  public getRecipeVersions(recipeId: string): DbRecipeVersion[] {
    return this.recipeVersions
      .filter((version) => version.recipeId === recipeId)
      .sort((left, right) => right.version - left.version);
  }

  public updateRecipe(
    recipeId: string,
    patch: {
      name?: string;
      nameAr?: string;
      photoUrl?: string;
      category?: ComponentCategory;
      description?: string;
      yieldPortions?: number;
      preparationTimeMinutes?: number;
      allergens?: string[];
      ingredients?: DbRecipe['ingredients'];
      price?: number;
      isActive?: boolean;
      family?: string;
      flags?: DbRecipe['flags'];
      mainIngredient?: string;
    },
    actor?: { id: string; name: string }
  ): DbRecipe | undefined {
    const recipe = this.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) return undefined;
    const before = this.cloneSnapshot(recipe);
    const currentVersion = recipe.version ?? 1;
    this.recipeVersions.push({
      id: `rv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      recipeId,
      version: currentVersion,
      snapshot: before,
      createdAt: new Date().toISOString(),
      createdBy: actor?.name,
    });
    recipe.version = currentVersion + 1;
    if (patch.name !== undefined) recipe.name = patch.name.trim();
    if (patch.nameAr !== undefined) recipe.nameAr = patch.nameAr.trim();
    if (patch.photoUrl !== undefined) recipe.photoUrl = patch.photoUrl.trim();
    if (patch.category !== undefined) recipe.category = patch.category;
    if (patch.description !== undefined) recipe.description = patch.description.trim();
    if (patch.yieldPortions !== undefined) recipe.yieldPortions = patch.yieldPortions;
    if (patch.preparationTimeMinutes !== undefined) {
      recipe.preparationTimeMinutes = patch.preparationTimeMinutes;
    }
    if (patch.allergens !== undefined) recipe.allergens = patch.allergens;
    if (patch.ingredients !== undefined) recipe.ingredients = patch.ingredients;
    if (patch.price !== undefined) recipe.price = patch.price;
    if (patch.isActive !== undefined) recipe.isActive = patch.isActive;
    if (patch.family !== undefined) recipe.family = patch.family;
    if (patch.flags !== undefined) recipe.flags = patch.flags;
    if (patch.mainIngredient !== undefined) recipe.mainIngredient = patch.mainIngredient;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'UPDATE_RECIPE',
      entityType: 'RECIPE',
      entityId: recipe.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(recipe),
    });
    this.persist();
    return recipe;
  }

  // ==========================================
  // Alternatives (permanent / limited / reservation)
  // ==========================================
  public getAlternatives(): DbAlternative[] {
    return this.alternatives;
  }

  private alternativeAvailable(
    alternative: DbAlternative,
    customerId: string,
    portions: number
  ): boolean {
    const today = new Date().toLocaleDateString('en-CA');
    if (!alternative.isActive) return false;
    if (alternative.customerId && alternative.customerId !== customerId) return false;
    if (alternative.validFrom && alternative.validFrom > today) return false;
    if (alternative.validTo && alternative.validTo < today) return false;
    if (alternative.type === 'PERMANENT') return true;
    return (alternative.remainingPortions ?? 0) >= portions;
  }

  private findApplicableAlternative(
    recipeId: string,
    customerId: string,
    portions: number
  ): DbAlternative | undefined {
    return this.alternatives
      .filter(
        (alternative) =>
          alternative.recipeId === recipeId &&
          this.alternativeAvailable(alternative, customerId, portions)
      )
      .sort((left, right) => {
        const customerPriority = (left.customerId ? 0 : 1) - (right.customerId ? 0 : 1);
        if (customerPriority !== 0) return customerPriority;
        return (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER);
      })[0];
  }

  /**
   * Returns the price of the applicable alternative, or undefined when the
   * dish has no alternative pricing. A limited/reservation alternative that is
   * exhausted blocks the order instead of silently falling back to list price.
   */
  private resolveAlternativePrice(
    recipeId: string,
    customerId: string,
    portions: number
  ): number | undefined {
    const today = new Date().toLocaleDateString('en-CA');
    const candidates = this.alternatives.filter(
      (alternative) =>
        alternative.recipeId === recipeId &&
        alternative.isActive &&
        (!alternative.customerId || alternative.customerId === customerId) &&
        (!alternative.validFrom || alternative.validFrom <= today) &&
        (!alternative.validTo || alternative.validTo >= today)
    );
    if (candidates.length === 0) return undefined;
    const usable = candidates.filter((alternative) =>
      this.alternativeAvailable(alternative, customerId, portions)
    );
    if (usable.length === 0) throw new Error('ALTERNATIVE_EXHAUSTED');
    usable.sort((left, right) => {
      const customerPriority = (left.customerId ? 0 : 1) - (right.customerId ? 0 : 1);
      if (customerPriority !== 0) return customerPriority;
      return (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER);
    });
    return usable[0].price;
  }

  public createAlternative(
    data: {
      recipeId: string;
      customerId?: string;
      type: AlternativeType;
      price?: number;
      maxPortions?: number;
      station?: WorkshopStation;
      validFrom?: string;
      validTo?: string;
    },
    actor?: { id: string; name: string }
  ): DbAlternative {
    const recipe = this.getRecipeById(data.recipeId);
    if (!recipe) throw new Error('RECIPE_NOT_FOUND');
    if (!isAlternativeType(data.type)) throw new Error('INVALID_ALTERNATIVE_TYPE');
    if (data.customerId && !this.getCustomerById(data.customerId)) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }
    if (data.type !== 'PERMANENT') {
      if (!Number.isInteger(data.maxPortions) || (data.maxPortions ?? 0) < 1) {
        throw new Error('INVALID_ALTERNATIVE_CAPACITY');
      }
    }
    const alternative: DbAlternative = {
      id: `alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      recipeId: data.recipeId,
      customerId: data.customerId,
      type: data.type,
      price: data.price,
      maxPortions: data.maxPortions,
      remainingPortions: data.type === 'PERMANENT' ? undefined : data.maxPortions,
      station: data.station,
      isActive: true,
      validFrom: data.validFrom,
      validTo: data.validTo,
      createdAt: new Date().toISOString(),
    };
    this.alternatives.push(alternative);
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'CREATE_ALTERNATIVE',
      entityType: 'ALTERNATIVE',
      entityId: alternative.id,
      afterSnapshot: alternative,
    });
    this.persist();
    return alternative;
  }

  public updateAlternative(
    alternativeId: string,
    patch: {
      price?: number;
      maxPortions?: number;
      isActive?: boolean;
      validFrom?: string;
      validTo?: string;
      station?: WorkshopStation;
    },
    actor?: { id: string; name: string }
  ): DbAlternative | undefined {
    const alternative = this.alternatives.find((entry) => entry.id === alternativeId);
    if (!alternative) return undefined;
    const before = this.cloneSnapshot(alternative);
    if (patch.price !== undefined) alternative.price = patch.price;
    if (patch.maxPortions !== undefined) {
      if (!Number.isInteger(patch.maxPortions) || patch.maxPortions < 1) {
        throw new Error('INVALID_ALTERNATIVE_CAPACITY');
      }
      alternative.maxPortions = patch.maxPortions;
      if (alternative.type !== 'PERMANENT') {
        alternative.remainingPortions = Math.min(
          alternative.remainingPortions ?? patch.maxPortions,
          patch.maxPortions
        );
      }
    }
    if (patch.isActive !== undefined) alternative.isActive = patch.isActive;
    if (patch.validFrom !== undefined) alternative.validFrom = patch.validFrom;
    if (patch.validTo !== undefined) alternative.validTo = patch.validTo;
    if (patch.station !== undefined) alternative.station = patch.station;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'UPDATE_ALTERNATIVE',
      entityType: 'ALTERNATIVE',
      entityId: alternative.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(alternative),
    });
    this.persist();
    return alternative;
  }

  public reserveAlternative(
    alternativeId: string,
    portions: number,
    actor?: { id: string; name: string }
  ): DbAlternative | undefined {
    const alternative = this.alternatives.find((entry) => entry.id === alternativeId);
    if (!alternative) return undefined;
    if (!Number.isInteger(portions) || portions < 1) throw new Error('QUANTITY_INVALID');
    if (alternative.type === 'PERMANENT') return alternative;
    if ((alternative.remainingPortions ?? 0) < portions) throw new Error('ALTERNATIVE_EXHAUSTED');
    alternative.remainingPortions = (alternative.remainingPortions ?? 0) - portions;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'RESERVE_ALTERNATIVE',
      entityType: 'ALTERNATIVE',
      entityId: alternative.id,
      beforeSnapshot: { remainingPortions: (alternative.remainingPortions ?? 0) + portions },
      afterSnapshot: { remainingPortions: alternative.remainingPortions },
    });
    this.persist();
    return alternative;
  }

  private consumeAlternatives(items: DbOrderItem[], customerId: string): void {
    for (const item of items) {
      const alternative = this.findApplicableAlternative(item.recipeId, customerId, item.portions);
      if (!alternative || alternative.type === 'PERMANENT') continue;
      alternative.remainingPortions = Math.max(
        0,
        (alternative.remainingPortions ?? 0) - item.portions
      );
    }
  }

  // ==========================================
  // Menu Proposal Engine (human validation kept)
  // ==========================================
  public proposeWeeklyMenu(startDateStr?: string): MenuProposal {
    const start = startDateStr ? new Date(`${startDateStr}T00:00:00`) : new Date();
    const mains = this.recipes.filter(
      (recipe) =>
        recipe.isActive !== false &&
        recipe.category === ComponentCategory.MAIN_COURSE
    );
    if (mains.length === 0) throw new Error('NO_MAIN_RECIPES');
    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const used: string[] = [];
    const proposedPlans: DbMealPlan[] = [];
    const days: MenuProposalDay[] = [];
    let pastaLunches = 0;

    for (let index = 0; index < 7; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = date.toLocaleDateString('en-CA');
      const dayOfWeek = date.getDay();
      const isSaturday = dayOfWeek === 6;
      const unused = mains.filter((recipe) => !used.includes(recipe.id));
      const lunchPool = (unused.length > 0 ? unused : mains).filter((recipe) => {
        if (isSaturday && (recipe.preparationTimeMinutes ?? 30) > 45) return false;
        const isPasta = recipe.family === 'PASTA' || recipe.flags?.includes('PASTA');
        return !(isPasta && pastaLunches >= 1);
      });
      const lunch = lunchPool[index % Math.max(1, lunchPool.length)] ?? mains[index % mains.length];
      used.push(lunch.id);
      if (lunch.family === 'PASTA' || lunch.flags?.includes('PASTA')) pastaLunches += 1;

      const dinnerPool = mains.filter((recipe) => {
        if (recipe.id === lunch.id) return false;
        if (isSaturday && (recipe.preparationTimeMinutes ?? 30) > 45) return false;
        if (recipe.mainIngredient && recipe.mainIngredient === lunch.mainIngredient) return false;
        if (lunch.flags?.includes('FRIES') && recipe.flags?.includes('FRIES')) return false;
        if (lunch.flags?.includes('MINCED') && recipe.flags?.includes('MINCED')) return false;
        return true;
      });
      const dinner =
        dinnerPool[index % Math.max(1, dinnerPool.length)] ??
        mains.find((recipe) => recipe.id !== lunch.id) ??
        lunch;

      const lunchPlan: DbMealPlan = {
        id: `proposal-lunch-${iso}`,
        date: iso,
        serviceTime: MealServiceTime.LUNCH,
        mainCourseRecipeId: lunch.id,
      };
      const dinnerPlan: DbMealPlan = {
        id: `proposal-dinner-${iso}`,
        date: iso,
        serviceTime: MealServiceTime.DINNER,
        mainCourseRecipeId: dinner.id,
      };
      proposedPlans.push(lunchPlan, dinnerPlan);
      days.push({ date: iso, dayName: dayNames[dayOfWeek], lunch: lunchPlan, dinner: dinnerPlan });
    }

    const validation = this.validateMenuCalendarRules(proposedPlans);
    return {
      startDate: start.toLocaleDateString('en-CA'),
      generatedAt: new Date().toISOString(),
      days,
      violations: validation.violations,
      isValid: validation.isValid,
    };
  }

  // ==========================================
  // Accounting: discounts and reference prices
  // ==========================================
  private applyCustomerDiscount(
    customer: DbCustomer,
    grossAmount: number
  ): { subtotal: number; discountAmount: number; total: number } {
    const percent = customer.discountPercent ?? 0;
    const discountAmount =
      percent > 0 ? Math.round(grossAmount * percent) / 100 : 0;
    return {
      subtotal: grossAmount,
      discountAmount,
      total: Math.max(0, Math.round((grossAmount - discountAmount) * 100) / 100),
    };
  }

  public setCustomerDiscount(
    customerId: string,
    percent: number,
    actor?: { id: string; name: string }
  ): DbCustomer | undefined {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error('INVALID_DISCOUNT');
    }
    const customer = this.getCustomerById(customerId);
    if (!customer) return undefined;
    const before = customer.discountPercent ?? 0;
    customer.discountPercent = percent;
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'SET_CUSTOMER_DISCOUNT',
      entityType: 'CUSTOMER',
      entityId: customer.id,
      beforeSnapshot: { discountPercent: before },
      afterSnapshot: { discountPercent: percent },
    });
    this.persist();
    return customer;
  }

  public applyInvoiceDiscount(
    invoiceId: string,
    type: 'PERCENT' | 'FIXED',
    value: number,
    actor?: { id: string; name: string }
  ): DbInvoice | undefined {
    const invoice = this.invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) return undefined;
    if (type !== 'PERCENT' && type !== 'FIXED') throw new Error('INVALID_DISCOUNT_TYPE');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('INVALID_DISCOUNT');
    }
    if (type === 'PERCENT' && value > 100) throw new Error('INVALID_DISCOUNT');
    const subtotal =
      invoice.subtotal ??
      Math.round((invoice.totalAmount + (invoice.discountAmount ?? 0)) * 100) / 100;
    const discountAmount =
      type === 'PERCENT'
        ? Math.round((subtotal * value) / 100 * 100) / 100
        : Math.min(value, subtotal);
    const total = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
    const before = this.cloneSnapshot(invoice);
    invoice.subtotal = subtotal;
    invoice.discountType = type;
    invoice.discountValue = value;
    invoice.discountAmount = discountAmount;
    invoice.totalAmount = total;
    if (invoice.paidAmount >= total) {
      invoice.paidAmount = total;
      invoice.status = 'PAID';
    } else if (invoice.paidAmount > 0) {
      invoice.status = 'PARTIALLY_PAID';
    } else {
      invoice.status = 'ISSUED';
    }
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'Système',
      action: 'APPLY_INVOICE_DISCOUNT',
      entityType: 'INVOICE',
      entityId: invoice.id,
      beforeSnapshot: before,
      afterSnapshot: this.cloneSnapshot(invoice),
    });
    this.persist();
    return invoice;
  }

  // ==========================================
  // Logistics & Delivery Runs
  // ==========================================
  public getDeliveryRuns(date?: string): DbDeliveryRun[] {
    if (date) {
      return this.deliveryRuns.filter((r) => r.runDate === date);
    }
    return this.deliveryRuns;
  }

  public createDeliveryRun(data: {
    runDate: string;
    serviceTime: MealServiceTime;
    driverName: string;
    driverPhone: string;
  }): DbDeliveryRun {
    const relevantOrders = this.orders.filter(
      (o) =>
        o.deliveryDate === data.runDate &&
        o.serviceTime === data.serviceTime &&
        o.status !== OrderStatus.CANCELLED
    );

    const stops: DbDeliveryStop[] = relevantOrders.map((ord, idx) => ({
      id: `stop-${Date.now()}-${idx}`,
      orderId: ord.id,
      sequence: idx + 1,
      deliveryStatus: 'PENDING',
    }));

    const loadPortions = relevantOrders.reduce((sum, order) => sum + order.totalPortions, 0);
    const vehicle = this.vehicles
      .filter((entry) => entry.isActive && entry.capacityMaxPortions >= loadPortions)
      .sort((left, right) => left.capacityMaxPortions - right.capacityMaxPortions)[0];
    const run: DbDeliveryRun = {
      id: `run-${Date.now()}`,
      runDate: data.runDate,
      serviceTime: data.serviceTime,
      driverName: data.driverName,
      driverPhone: data.driverPhone,
      status: 'PLANNED',
      stops,
      vehicleId: vehicle?.id,
      vehicleLabel: vehicle?.label,
      vehicleType: vehicle?.type,
      capacityMaxPortions: vehicle?.capacityMaxPortions,
      loadPortions,
    };

    this.deliveryRuns.push(run);
    this.persist();
    return run;
  }

  public markDeliveryStopCompleted(runId: string, stopId: string, comment?: string): DbDeliveryRun | undefined {
    const run = this.deliveryRuns.find((r) => r.id === runId);
    if (!run) return undefined;

    const stop = run.stops.find((s) => s.id === stopId);
    if (stop) {
      stop.deliveryStatus = 'DELIVERED';
      stop.deliveredAt = new Date().toISOString();
      if (comment) stop.driverComment = comment;

      // Update associated order status
      this.updateOrderStatus(stop.orderId, OrderStatus.DELIVERED);
    }

    const allDelivered = run.stops.every((s) => s.deliveryStatus === 'DELIVERED');
    if (allDelivered) {
      run.status = 'COMPLETED';
    }
    this.persist();
    return run;
  }

  // ==========================================
  // Packaging & Meal Box Label Generator
  // ==========================================
  public generatePackagingLabels(target?: string, isOrderId = false): MealBoxLabel[] {
    const effectiveTarget = target || new Date().toLocaleDateString('en-CA');
    let ordersToProcess = isOrderId
      ? this.orders.filter((o) => o.id === effectiveTarget)
      : this.orders.filter((o) => o.deliveryDate === effectiveTarget && o.status !== OrderStatus.CANCELLED);

    if (ordersToProcess.length === 0 && !isOrderId) {
      ordersToProcess = this.orders.filter((o) => o.status !== OrderStatus.CANCELLED);
    }
    const labels: MealBoxLabel[] = [];

    for (const order of ordersToProcess) {
      const customer = this.getCustomerById(order.customerId);
      const customerName = customer ? customer.contactName : 'Client';
      const companyName = customer?.companyName;
      const address = order.deliveryAddress;

      let totalBoxCount = 0;
      for (const item of order.items) {
        totalBoxCount += item.portions;
      }

      let currentBox = 1;
      for (const item of order.items) {
        const recipe = this.getRecipeById(item.recipeId);
        if (!recipe) continue;

        const heatingInstructions =
          recipe.category === ComponentCategory.MAIN_COURSE
            ? 'Réchauffer 2 min 30 au micro-ondes à 750W (retirer le couvercle transparent).'
            : recipe.category === ComponentCategory.STARTER
            ? 'Prêt à consommer frais. Conserver entre 2°C et 4°C.'
            : 'Dessert artisanal prêt à déguster.';

        for (let p = 1; p <= item.portions; p++) {
          labels.push({
            labelId: `LBL-${order.orderNumber.replace(/[^0-9]/g, '')}-${currentBox}`,
            orderNumber: order.orderNumber,
            customerName,
            companyName,
            deliveryAddress: address,
            recipeName: recipe.name,
            category: recipe.category,
            serviceTime: order.serviceTime,
            deliveryDate: order.deliveryDate,
            portionIndex: `Colis ${currentBox} / ${totalBoxCount}`,
            allergens: recipe.allergens.length > 0 ? recipe.allergens : ['Aucun allergène majeur'],
            heatingInstructions,
            storageInstructions: 'Conserver entre 0°C et +3°C. À consommer dans les 24h.',
            barcode: `*${order.orderNumber}-${currentBox}*`,
          });
          currentBox++;
        }
      }
    }

    return labels;
  }

  // ==========================================
  // Financial & Food Cost Analytics
  // ==========================================
  public getFinancialAnalytics(date?: string): FinancialAnalytics {
    const ordersToAnalyze = date
      ? this.orders.filter((o) => o.deliveryDate === date && o.status !== OrderStatus.CANCELLED)
      : this.orders.filter((o) => o.status !== OrderStatus.CANCELLED);

    let totalRevenue = 0;
    let totalFoodCost = 0;
    let totalPortions = 0;
    const recipeStats = new Map<string, { portions: number; foodCost: number; revenue: number }>();

    for (const order of ordersToAnalyze) {
      const unitPrice = order.serviceTime === MealServiceTime.LUNCH ? 650 : 850;
      for (const item of order.items) {
        const recipe = this.getRecipeById(item.recipeId);
        if (!recipe) continue;

        const costInfo = this.calculateRecipeCost(recipe.id);
        const itemFoodCost = Math.round(costInfo.costPerPortion * item.portions);
        const itemRevenue = item.portions * unitPrice;

        totalFoodCost += itemFoodCost;
        totalRevenue += itemRevenue;
        totalPortions += item.portions;

        const current = recipeStats.get(recipe.name) || { portions: 0, foodCost: 0, revenue: 0 };
        current.portions += item.portions;
        current.foodCost += itemFoodCost;
        current.revenue += itemRevenue;
        recipeStats.set(recipe.name, current);
      }
    }

    const grossMargin = totalRevenue - totalFoodCost;
    const foodCostPercentage = totalRevenue > 0 ? Math.round((totalFoodCost / totalRevenue) * 1000) / 10 : 0;
    const grossMarginPercentage = totalRevenue > 0 ? Math.round((grossMargin / totalRevenue) * 1000) / 10 : 0;
    const averageMealPrice = totalPortions > 0 ? Math.round(totalRevenue / totalPortions) : 0;

    const topRecipes = Array.from(recipeStats.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.portions - a.portions);

    return {
      date,
      totalRevenue,
      totalFoodCost,
      grossMargin,
      foodCostPercentage,
      grossMarginPercentage,
      totalPortions,
      averageMealPrice,
      topRecipes,
    };
  }

  // ==========================================
  // CSV Data Exports (Kitchen & Delivery)
  // ==========================================
  public exportProductionSheetCsv(date: string, serviceTime?: MealServiceTime): string {
    const plan = this.calculateProductionNeeds(date, serviceTime);
    const lines: string[] = [];
    lines.push('SECTION: RECETTES À PRODUIRE');
    lines.push('Recette,Categorie,Portions,Nombre de Commandes');
    for (const r of plan.recipes) {
      lines.push(`"${r.recipeName}","${r.category}",${r.totalPortions},${r.ordersCount}`);
    }
    lines.push('');
    lines.push('SECTION: INGRÉDIENTS NÉCESSAIRES');
    lines.push('Ingrédient,Unité,Quantité Requise,Stock Actuel,Stock Après Prod,Déficit,Fournisseur');
    for (const ing of plan.ingredientRequirements) {
      lines.push(`"${ing.ingredientName}","${ing.unit}",${ing.quantityRequired},${ing.currentStock},${ing.stockAfterProduction},${ing.deficit},"${ing.supplierName}"`);
    }
    return lines.join('\n');
  }

  public exportDeliveryManifestCsv(date: string, serviceTime?: MealServiceTime): string {
    const runs = this.getDeliveryRuns(date);
    const lines: string[] = [];
    lines.push('Date,Service,Livreur,Téléphone Livreur,Arrêt,N° Commande,Client,Adresse,Statut Livraison');

    for (const run of runs) {
      if (serviceTime && run.serviceTime !== serviceTime) continue;
      for (const stop of run.stops) {
        const order = this.getOrderById(stop.orderId);
        const customer = order ? this.getCustomerById(order.customerId) : undefined;
        const clientName = customer ? (customer.companyName || customer.contactName) : 'Inconnu';
        const address = order ? order.deliveryAddress : '';
        lines.push(`"${run.runDate}","${run.serviceTime}","${run.driverName}","${run.driverPhone}",${stop.sequence},"${order?.orderNumber || stop.orderId}","${clientName}","${address}","${stop.deliveryStatus}"`);
      }
    }
    return lines.join('\n');
  }

  // ==========================================
  // Customer Subscriptions Engine
  // ==========================================
  public getSubscriptions(): CustomerSubscription[] {
    return this.subscriptions;
  }

  public createSubscription(data: Omit<CustomerSubscription, 'id'>): CustomerSubscription {
    const sub: CustomerSubscription = {
      ...data,
      id: `sub-${Date.now()}`,
    };
    this.subscriptions.push(sub);
    this.persist();
    return sub;
  }

  public generateOrdersFromSubscriptions(date: string): DbOrder[] {
    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const targetDay = dayNames[new Date(date).getDay()];
    const generatedOrders: DbOrder[] = [];

    const activeSubs = this.subscriptions.filter(
      (s) => s.status === 'ACTIVE' && s.activeDays.includes(targetDay)
    );

    for (const sub of activeSubs) {
      const customer = this.getCustomerById(sub.customerId);
      if (!customer) continue;

      for (const service of sub.serviceTimes) {
        const mealPlan = this.mealPlans.find((m) => m.date === date && m.serviceTime === service);
        const mainRecipeId = sub.preferredRecipeId || mealPlan?.mainCourseRecipeId || this.recipes[0].id;

        const items: { recipeId: string; portions: number }[] = [
          { recipeId: mainRecipeId, portions: sub.dailyPortions },
        ];
        if (mealPlan?.starterRecipeId) {
          items.push({ recipeId: mealPlan.starterRecipeId, portions: sub.dailyPortions });
        }
        if (mealPlan?.dessertRecipeId) {
          items.push({ recipeId: mealPlan.dessertRecipeId, portions: sub.dailyPortions });
        }

        const order = this.createOrder({
          customerId: sub.customerId,
          deliveryDate: date,
          serviceTime: service,
          items,
          notes: `Généré depuis abonnement: ${sub.planName}`,
        });

        generatedOrders.push(order);
      }
    }

    return generatedOrders;
  }

  // ==========================================
  // Kitchen Display System (KDS) Active Batches
  // ==========================================
  public getKdsBatches(date?: string): KdsBatch[] {
    const targetDate = date || new Date().toLocaleDateString('en-CA');
    const existing = this.kdsBatches.filter((b) => b.date === targetDate);

    if (existing.length > 0) {
      return existing;
    }

    // Auto-generate KDS batches from production needs if empty
    const plan = this.calculateProductionNeeds(targetDate);
    for (const rec of plan.recipes) {
      const r = this.getRecipeById(rec.recipeId);
      const station =
        rec.category === ComponentCategory.MAIN_COURSE
          ? 'CHAUD'
          : rec.category === ComponentCategory.STARTER
          ? 'FROID'
          : rec.category === ComponentCategory.DESSERT
          ? 'PATISSERIE'
          : 'CONDITIONNEMENT';

      this.kdsBatches.push({
        id: `kds-${targetDate}-${rec.recipeId}`,
        recipeId: rec.recipeId,
        recipeName: rec.recipeName,
        category: rec.category,
        portions: rec.totalPortions,
        serviceTime: plan.serviceTime || MealServiceTime.LUNCH,
        date: targetDate,
        station,
        stage: 'TO_PREPARE',
        updatedAt: new Date().toISOString(),
      });
    }

    return this.kdsBatches.filter((b) => b.date === targetDate);
  }

  public updateKdsBatchStage(batchId: string, stage: KdsBatch['stage']): KdsBatch | undefined {
    const batch = this.kdsBatches.find((b) => b.id === batchId);
    if (batch) {
      batch.stage = stage;
      batch.updatedAt = new Date().toISOString();
      this.persist();
    }
    return batch;
  }

  // ==========================================
  // Phase 1: Audit Trail Logging
  // ==========================================
  private pruneAuditLogs(): void {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - AUDIT_RETENTION_YEARS);
    const cutoffIso = cutoff.toISOString();
    this.auditLogs = this.auditLogs.filter((entry) => entry.timestamp >= cutoffIso);
  }

  public logAuditEvent(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const log: AuditLogEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    this.pruneAuditLogs();
    this.persist();
    return log;
  }

  public getAuditLogs(filters?: { entityType?: string; action?: string; limit?: number }): AuditLogEntry[] {
    this.pruneAuditLogs();
    let res = [...this.auditLogs];
    if (filters?.entityType) res = res.filter((l) => l.entityType === filters.entityType);
    if (filters?.action) res = res.filter((l) => l.action === filters.action);
    return res.slice(0, filters?.limit || 50);
  }

  // ==========================================
  // Phase 1: Menu Calendar Operational Rules Engine
  // ==========================================
  public validateMenuCalendarRules(plansToValidate?: DbMealPlan[]): { isValid: boolean; violations: MenuRuleViolation[] } {
    const plans = plansToValidate || this.mealPlans;
    const violations: MenuRuleViolation[] = [];

    // Group plans by date
    const byDate = new Map<string, { lunch?: DbMealPlan; dinner?: DbMealPlan }>();
    for (const p of plans) {
      const current = byDate.get(p.date) || {};
      if (p.serviceTime === MealServiceTime.LUNCH) current.lunch = p;
      if (p.serviceTime === MealServiceTime.DINNER) current.dinner = p;
      byDate.set(p.date, current);
    }

    let lunchPastaCount = 0;

    for (const [date, slots] of byDate.entries()) {
      const lunchMain = slots.lunch?.mainCourseRecipeId ? this.getRecipeById(slots.lunch.mainCourseRecipeId) : undefined;
      const dinnerMain = slots.dinner?.mainCourseRecipeId ? this.getRecipeById(slots.dinner.mainCourseRecipeId) : undefined;

      const lunchName = (lunchMain?.name || '').toLowerCase();
      const dinnerName = (dinnerMain?.name || '').toLowerCase();

      // Rule 4: Interdiction frites midi + soir le même jour
      const lunchHasFries =
        Boolean(lunchMain?.flags?.includes('FRIES')) ||
        lunchName.includes('frite') ||
        lunchName.includes('pommes de terre');
      const dinnerHasFries =
        Boolean(dinnerMain?.flags?.includes('FRIES')) ||
        dinnerName.includes('frite') ||
        dinnerName.includes('pommes de terre');
      if (lunchHasFries && dinnerHasFries && !this.advancedRules.allowSameDayFries) {
        violations.push({
          date,
          ruleName: 'INTERDICTION_FRITES_MIDI_SOIR',
          severity: 'ERROR',
          message: `Règle enfreinte le ${date} : Interdiction de servir des frites/pommes de terre à la fois au déjeuner (${lunchMain?.name}) et au dîner (${dinnerMain?.name}).`,
        });
      }

      // Rule 6: Interdiction viande hachée midi + soir le même jour
      const lunchHasMinced =
        Boolean(lunchMain?.flags?.includes('MINCED')) ||
        lunchName.includes('haché') ||
        lunchName.includes('boulette');
      const dinnerHasMinced =
        Boolean(dinnerMain?.flags?.includes('MINCED')) ||
        dinnerName.includes('haché') ||
        dinnerName.includes('boulette');
      if (lunchHasMinced && dinnerHasMinced && !this.advancedRules.allowSameDayMincedMeat) {
        violations.push({
          date,
          ruleName: 'INTERDICTION_VIANDE_HACHEE_MIDI_SOIR',
          severity: 'ERROR',
          message: `Règle enfreinte le ${date} : Interdiction de servir de la viande hachée au déjeuner et au dîner le même jour.`,
        });
      }

      // Rule 2: Pâtes/Spaghetti 1x/semaine max au déjeuner
      if (
        lunchMain?.family === 'PASTA' ||
        lunchMain?.flags?.includes('PASTA') ||
        lunchName.includes('pâte') ||
        lunchName.includes('spaghetti') ||
        lunchName.includes('macaroni')
      ) {
        lunchPastaCount++;
        if (lunchPastaCount > this.advancedRules.maxPastaPerWeek) {
          violations.push({
            date,
            ruleName: 'MAX_PATES_DEJEUNER_HEBDO',
            severity: 'WARNING',
            message: `Alerte le ${date} : Les pâtes/spaghetti sont programmées plus d'une fois au déjeuner cette semaine (${lunchMain?.name}).`,
          });
        }
      }

      // BR-025: éviter le même composant principal midi + soir.
      if (
        lunchMain?.mainIngredient &&
        lunchMain.mainIngredient === dinnerMain?.mainIngredient
      ) {
        violations.push({
          date,
          ruleName: 'MEME_COMPOSANT_PRINCIPAL',
          severity: 'WARNING',
          message: `Alerte le ${date} : le même composant principal (${lunchMain.mainIngredient}) est programmé au déjeuner et au dîner.`,
        });
      }

      // Rule 3: Repas du samedi faciles d'atelier
      const dayOfWeek = new Date(date).getDay();
      if (dayOfWeek === 6) { // Samedi
        if (lunchMain && lunchMain.preparationTimeMinutes > 45) {
          violations.push({
            date,
            ruleName: 'SAMEDI_REPAS_FACILE',
            severity: 'WARNING',
            message: `Alerte le ${date} (Samedi) : Le plat prévu (${lunchMain.name}) dépasse 45 min de préparation. Privilégier une recette facile pour la brigade allégée du samedi.`,
          });
        }
      }
    }

    const hasErrors = violations.some((v) => v.severity === 'ERROR');
    return { isValid: !hasErrors, violations };
  }

  public validateMenuRange(from: string, to: string): { isValid: boolean; violations: MenuRuleViolation[] } {
    return this.validateMenuCalendarRules(
      this.mealPlans.filter((plan) => plan.date >= from && plan.date <= to)
    );
  }

  // ==========================================
  // Phase 1: Accounting & Pre-paid Invoicing
  // ==========================================
  public getInvoices(customerId?: string): DbInvoice[] {
    if (customerId) return this.invoices.filter((i) => i.customerId === customerId);
    return this.invoices;
  }

  public getPayments(customerId?: string): DbPayment[] {
    if (customerId) return this.payments.filter((p) => p.customerId === customerId);
    return this.payments;
  }

  public recordPayment(data: {
    customerId: string;
    amount: number;
    paymentMethod: DbPayment['paymentMethod'];
    invoiceId?: string;
    notes?: string;
  }): DbPayment {
    const receiptNumber = `REC-${new Date().toLocaleDateString('en-CA').replace(/-/g, '')}-${String(this.payments.length + 1).padStart(3, '0')}`;
    const payment: DbPayment = {
      id: `pay-${Date.now()}`,
      receiptNumber,
      customerId: data.customerId,
      invoiceId: data.invoiceId,
      paymentDate: new Date().toLocaleDateString('en-CA'),
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      notes: data.notes,
    };

    this.payments.unshift(payment);

    // Update customer balance
    const customer = this.getCustomerById(data.customerId);
    if (customer) {
      customer.accountBalance += data.amount;
    }

    // If tied to an invoice, mark invoice paid or partially paid
    if (data.invoiceId) {
      const inv = this.invoices.find((i) => i.id === data.invoiceId);
      if (inv) {
        inv.paidAmount += data.amount;
        inv.status = inv.paidAmount >= inv.totalAmount ? 'PAID' : 'PARTIALLY_PAID';
      }
    }

    this.logAuditEvent({
      userId: 'usr-admin',
      userName: 'Directeur Financier',
      action: 'PAYMENT_RECORDED',
      entityType: 'PAYMENT',
      entityId: payment.id,
      afterSnapshot: payment,
    });
    this.persist();
    return payment;
  }

  public getCustomerStatement(customerId: string): {
    customer: DbCustomer | undefined;
    balance: number;
    orders: DbOrder[];
    invoices: DbInvoice[];
    payments: DbPayment[];
  } {
    const customer = this.getCustomerById(customerId);
    const orders = this.orders.filter((o) => o.customerId === customerId);
    const invoices = this.getInvoices(customerId);
    const payments = this.getPayments(customerId);

    return {
      customer,
      balance: customer?.accountBalance || 0,
      orders,
      invoices,
      payments,
    };
  }

  // ==========================================
  // Phase 1: Driver Compensation & Run Transfer
  // ==========================================
  public calculateDriverCompensation(runId: string): {
    driverName: string;
    stopCount: number;
    compensation: number;
    breakdown: { baseFare: number; perStopRate: number; total: number };
  } {
    const run = this.deliveryRuns.find((r) => r.id === runId);
    if (!run) return { driverName: 'Inconnu', stopCount: 0, compensation: 0, breakdown: { baseFare: 0, perStopRate: 0, total: 0 } };

    const baseFare = 800; // 800 DZD forfait fixe tournée
    const perStopRate = 150; // 150 DZD par point de livraison
    const stopCount = run.stops.length;
    const total = baseFare + (stopCount * perStopRate);

    return {
      driverName: run.driverName,
      stopCount,
      compensation: total,
      breakdown: { baseFare, perStopRate: stopCount * perStopRate, total },
    };
  }

  public transferDeliveryRun(runId: string, newDriverName: string, newDriverPhone: string, reason: string): DbDeliveryRun | undefined {
    const run = this.deliveryRuns.find((r) => r.id === runId);
    if (!run) return undefined;

    const before = { ...run };
    run.driverName = newDriverName;
    run.driverPhone = newDriverPhone;

    this.logAuditEvent({
      userId: 'usr-logistics',
      userName: 'Responsable Logistique',
      action: 'DELIVERY_RUN_TRANSFERRED',
      entityType: 'DELIVERY_RUN',
      entityId: runId,
      beforeSnapshot: before,
      afterSnapshot: { newDriverName, newDriverPhone, reason },
    });
    this.persist();
    return run;
  }

  // ==========================================
  // Phase 1: Emergency Workshop Package & Backup/Restore
  // ==========================================
  public generateEmergencyWorkshopPackage(date?: string): EmergencyWorkshopPackage {
    const targetDate = date || new Date().toLocaleDateString('en-CA');
    const plan = this.calculateProductionNeeds(targetDate);

    const packagingMap = new Map<string, number>();
    for (const r of plan.recipes) {
      const current = packagingMap.get('Barquettes Kraft 750ml Individuelles') || 0;
      packagingMap.set('Barquettes Kraft 750ml Individuelles', current + r.totalPortions);
    }
    packagingMap.set('Couvercles Transparents Écologiques', plan.totalMealPortions);
    packagingMap.set('Sacs Kraft Transport & Livraison', plan.totalOrders);

    const packagingRequirements = Array.from(packagingMap.entries()).map(([type, quantity]) => ({ type, quantity }));

    const relevantOrders = this.orders.filter((o) => o.deliveryDate === targetDate && o.status !== OrderStatus.CANCELLED);
    const alternatives: { customerName: string; address: string; requestedAlternative: string }[] = [];
    for (const ord of relevantOrders) {
      const cust = this.getCustomerById(ord.customerId);
      if (cust && cust.dietaryPreferences.length > 0 && !cust.dietaryPreferences.includes('Standard')) {
        alternatives.push({
          customerName: cust.companyName ? `${cust.companyName} (${cust.contactName})` : cust.contactName,
          address: ord.deliveryAddress,
          requestedAlternative: cust.dietaryPreferences.join(', '),
        });
      }
    }

    const allergensMap = new Map<string, number>();
    for (const rec of plan.recipes) {
      const r = this.getRecipeById(rec.recipeId);
      if (r && r.allergens.length > 0) {
        for (const al of r.allergens) {
          const current = allergensMap.get(al) || 0;
          allergensMap.set(al, current + rec.totalPortions);
        }
      }
    }
    const allergensSummary = Array.from(allergensMap.entries()).map(([allergen, portionCount]) => ({ allergen, portionCount }));

    return {
      date: targetDate,
      generatedAt: new Date().toISOString(),
      totalMealPortions: plan.totalMealPortions,
      recipes: plan.recipes.map((r) => ({ recipeName: r.recipeName, category: r.category, portions: r.totalPortions })),
      packagingRequirements,
      alternatives,
      allergensSummary,
    };
  }

  public createDatabaseBackup(): { timestamp: string; version: string; data: Record<string, unknown> } {
    return {
      timestamp: new Date().toISOString(),
      version: '1.0.0-phase1',
      data: {
        suppliers: this.suppliers,
        ingredients: this.ingredients,
        recipes: this.recipes,
        customers: this.customers,
        mealPlans: this.mealPlans,
        orders: this.orders,
        pendingOrders: this.pendingOrders,
        productionBatches: this.productionBatches,
        purchaseOrders: this.purchaseOrders,
        deliveryRuns: this.deliveryRuns,
        subscriptions: this.subscriptions,
        kdsBatches: this.kdsBatches,
        vehicles: this.vehicles,
        workshops: this.workshops,
        workOrders: this.workOrders,
        recipeVersions: this.recipeVersions,
        alternatives: this.alternatives,
        invoices: this.invoices,
        payments: this.payments,
        auditLogs: this.auditLogs,
        staffUsers: this.staffUsers,
        notifications: this.notifications,
        outboundMessages: this.outboundMessages,
        settings: this.settings,
      },
    };
  }

  private collectionCounts(): Record<string, number> {
    return {
      suppliers: this.suppliers.length,
      ingredients: this.ingredients.length,
      recipes: this.recipes.length,
      customers: this.customers.length,
      mealPlans: this.mealPlans.length,
      orders: this.orders.length,
      pendingOrders: this.pendingOrders.length,
      productionBatches: this.productionBatches.length,
      purchaseOrders: this.purchaseOrders.length,
      deliveryRuns: this.deliveryRuns.length,
      subscriptions: this.subscriptions.length,
      kdsBatches: this.kdsBatches.length,
      invoices: this.invoices.length,
      payments: this.payments.length,
      auditLogs: this.auditLogs.length,
      staffUsers: this.staffUsers.length,
      notifications: this.notifications.length,
      outboundMessages: this.outboundMessages.length,
      vehicles: this.vehicles.length,
      workshops: this.workshops.length,
      workOrders: this.workOrders.length,
      recipeVersions: this.recipeVersions.length,
      alternatives: this.alternatives.length,
    };
  }

  public recordAuditEntry(
    actor: { id: string; name: string } | undefined,
    action: string,
    entityType: string,
    entityId: string,
    beforeSnapshot?: unknown,
    afterSnapshot?: unknown
  ): void {
    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'System',
      action,
      entityType,
      entityId,
      beforeSnapshot,
      afterSnapshot,
    });
    this.persist();
  }

  /**
   * Restores a full domain snapshot. Validation is deliberately strict because
   * the payload can replace staff accounts: unknown shapes are rejected, and a
   * non-empty staff list must contain an active administrator so a restore can
   * never lock the platform out.
   */
  public async restoreDatabaseFromBackup(
    backup: unknown,
    actor?: { id: string; name: string }
  ): Promise<boolean> {
    if (!isPlainObject(backup) || !isPlainObject(backup.data)) return false;
    const data = backup.data;
    for (const key of RESTORABLE_COLLECTIONS) {
      if (data[key] !== undefined && !Array.isArray(data[key])) return false;
    }
    if (data.settings !== undefined && !isPlainObject(data.settings)) return false;
    if (data.staffUsers !== undefined && !isValidStaffSnapshot(data.staffUsers)) return false;

    const restoreList = <T>(key: RestorableCollection, current: T[]): T[] =>
      Array.isArray(data[key]) ? (data[key] as T[]) : current;
    const before = this.collectionCounts();

    this.suppliers = restoreList('suppliers', this.suppliers);
    this.ingredients = restoreList('ingredients', this.ingredients);
    this.recipes = restoreList('recipes', this.recipes);
    this.customers = restoreList('customers', this.customers);
    this.mealPlans = restoreList('mealPlans', this.mealPlans);
    this.orders = restoreList('orders', this.orders);
    this.pendingOrders = restoreList('pendingOrders', this.pendingOrders);
    this.productionBatches = restoreList('productionBatches', this.productionBatches);
    this.purchaseOrders = restoreList('purchaseOrders', this.purchaseOrders);
    this.deliveryRuns = restoreList('deliveryRuns', this.deliveryRuns);
    this.subscriptions = restoreList('subscriptions', this.subscriptions);
    this.kdsBatches = restoreList('kdsBatches', this.kdsBatches);
    this.vehicles = restoreList('vehicles', this.vehicles);
    this.workshops = restoreList('workshops', this.workshops);
    this.workOrders = restoreList('workOrders', this.workOrders);
    this.recipeVersions = restoreList('recipeVersions', this.recipeVersions);
    this.alternatives = restoreList('alternatives', this.alternatives);
    this.invoices = restoreList('invoices', this.invoices);
    this.payments = restoreList('payments', this.payments);
    this.auditLogs = restoreList('auditLogs', this.auditLogs);
    this.staffUsers = restoreList('staffUsers', this.staffUsers);
    this.notifications = restoreList('notifications', this.notifications);
    this.outboundMessages = restoreList('outboundMessages', this.outboundMessages);
    if (data.settings !== undefined) this.settings = this.normalizeSettings(data.settings);

    // Sessions are never restored: drop those whose principal no longer exists
    // or was disabled by the restored snapshot.
    const staffIds = new Set(this.staffUsers.filter((user) => user.isActive).map((user) => user.id));
    this.staffSessions = this.staffSessions.filter((session) => staffIds.has(session.userId));
    const customerIds = new Set(this.customers.map((customer) => customer.id));
    this.clientSessions = this.clientSessions.filter((session) => customerIds.has(session.customerId));

    this.auditLogs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: actor?.id || 'system',
      userName: actor?.name || 'System',
      action: 'RESTORE_DATABASE',
      entityType: 'DATABASE',
      entityId: 'main',
      beforeSnapshot: before,
      afterSnapshot: this.collectionCounts(),
    });
    await this.enqueuePersist();
    return true;
  }

  // ==========================================
  // Phase 1: Les 14 Rapports Essentiels Officiels
  // ==========================================
  public generateReport(reportNumber: number, date?: string): OfficialReportResult {
    const targetDate = date || new Date().toLocaleDateString('en-CA');
    const timestamp = new Date().toISOString();

    switch (reportNumber) {
      case 1: {
        const orders = this.orders.filter((o) => !date || o.deliveryDate === targetDate);
        return {
          reportNumber: 1,
          title: 'Rapport Nominatif des Commandes',
          generatedAt: timestamp,
          summaryText: `${orders.length} commande(s) répertoriée(s) pour un total de ${orders.reduce((s, o) => s + o.totalPortions, 0)} portions.`,
          data: orders,
        };
      }
      case 2: {
        const plan = this.calculateProductionNeeds(targetDate);
        return {
          reportNumber: 2,
          title: 'Rapport Production : Prévu vs Réel, Surplus & Pénuries',
          generatedAt: timestamp,
          summaryText: `${plan.recipes.length} plat(s) en production. Déficit matière estimé : ${plan.deficitCost} DZD.`,
          data: plan,
        };
      }
      case 3: {
        const pos = this.purchaseOrders;
        return {
          reportNumber: 3,
          title: 'Rapport des Achats & Réceptions Fournisseurs',
          generatedAt: timestamp,
          summaryText: `${pos.length} bon(s) d'achat émis pour une valorisation de ${pos.reduce((s, p) => s + p.totalCost, 0)} DZD.`,
          data: pos,
        };
      }
      case 4: {
        const supplements = this.orders.map((o) => ({ orderNumber: o.orderNumber, supplementsCost: o.supplementsCost }));
        return {
          reportNumber: 4,
          title: 'Rapport des Suppléments Facturés',
          generatedAt: timestamp,
          summaryText: `Total suppléments : ${supplements.reduce((s, i) => s + i.supplementsCost, 0)} DZD.`,
          data: supplements,
        };
      }
      case 5: {
        const pack = this.generateEmergencyWorkshopPackage(targetDate);
        return {
          reportNumber: 5,
          title: 'Rapport des Emballages (Individuel & Collectif)',
          generatedAt: timestamp,
          summaryText: `Quantités nécessaires calculées pour ${pack.totalMealPortions} repas.`,
          data: pack.packagingRequirements,
        };
      }
      case 6: {
        const runs = this.getDeliveryRuns(targetDate);
        return {
          reportNumber: 6,
          title: 'Rapport de Distribution & Tournées',
          generatedAt: timestamp,
          summaryText: `${runs.length} tournée(s) programmée(s) pour le service.`,
          data: runs,
        };
      }
      case 7: {
        const accounts = this.customers.map((c) => ({
          clientId: c.id,
          nom: c.companyName || c.contactName,
          soldePrepayeDZD: c.accountBalance,
          statut: c.status,
        }));
        return {
          reportNumber: 7,
          title: 'Rapport des Comptes Clients & Soldes Prépayés',
          generatedAt: timestamp,
          summaryText: `Encours total des soldes prépayés : ${accounts.reduce((s, a) => s + a.soldePrepayeDZD, 0)} DZD.`,
          data: accounts,
        };
      }
      case 8: {
        const clients = this.customers.map((c) => ({
          id: c.id,
          nom: c.companyName || c.contactName,
          type: c.subscriptionType,
          isSubsidiary: !!c.isSubsidiary,
          parentCompanyId: c.parentCompanyId || 'N/A',
          phone: c.phone,
          status: c.status,
        }));
        return {
          reportNumber: 8,
          title: 'Rapport Annuaire des Clients & Hiérarchie Sociétés/Filiales',
          generatedAt: timestamp,
          summaryText: `${clients.length} comptes clients répertoriés (dont ${clients.filter((c) => c.isSubsidiary).length} filiales).`,
          data: clients,
        };
      }
      case 9: {
        const fin = this.getFinancialAnalytics(targetDate);
        return {
          reportNumber: 9,
          title: 'Rapport Statistique de Consommation & Plats',
          generatedAt: timestamp,
          summaryText: `Plat le plus commandé : ${fin.topRecipes[0]?.name || 'N/A'}.`,
          data: fin.topRecipes,
        };
      }
      case 10: {
        const fin = this.getFinancialAnalytics(targetDate);
        return {
          reportNumber: 10,
          title: 'Rapport de Performance Globale & Rentabilité',
          generatedAt: timestamp,
          summaryText: `Taux de Food Cost : ${fin.foodCostPercentage}% • Marge brute : ${fin.grossMarginPercentage}%.`,
          data: fin,
        };
      }
      case 11: {
        const logs = this.getAuditLogs({ limit: 50 });
        return {
          reportNumber: 11,
          title: 'Rapport du Journal d’Audit & Sécurité',
          generatedAt: timestamp,
          summaryText: `${logs.length} opération(s) critique(s) tracée(s) dans le journal d'audit.`,
          data: logs,
        };
      }
      case 12: {
        const pays = this.payments;
        return {
          reportNumber: 12,
          title: 'Rapport des Paiements & Règlements Encaissés',
          generatedAt: timestamp,
          summaryText: `${pays.length} encaissement(s) pour un total de ${pays.reduce((s, p) => s + p.amount, 0)} DZD.`,
          data: pays,
        };
      }
      case 13: {
        const pack = this.generateEmergencyWorkshopPackage(targetDate);
        return {
          reportNumber: 13,
          title: 'Rapport des Alternatives & Régimes Spéciaux',
          generatedAt: timestamp,
          summaryText: `${pack.alternatives.length} demande(s) de repas alternatifs / sans allergènes.`,
          data: pack.alternatives,
        };
      }
      case 14:
      default: {
        const weekly = this.getWeeklyMenuPlan(targetDate);
        const fin = this.getFinancialAnalytics();
        return {
          reportNumber: 14,
          title: 'Rapport de Synthèse Hebdomadaire 360°',
          generatedAt: timestamp,
          summaryText: `Synthèse d'activité 360° sur 7 jours. CA cumulé estimé : ${fin.totalRevenue} DZD.`,
          data: { weekly, financialOverview: fin },
        };
      }
    }
  }

  // ========================================================
  // Phase 2 — Moteur de Configuration Avancé (02)
  // ========================================================
  public getAdvancedRules(): AdvancedRulesConfig {
    return { ...this.advancedRules };
  }

  public updateAdvancedRules(patch: Partial<AdvancedRulesConfig>): AdvancedRulesConfig {
    this.advancedRules = { ...this.advancedRules, ...patch };
    this.persist();
    return { ...this.advancedRules };
  }

  // ========================================================
  // Phase 2 — Gestion Avancée des Pénuries & Suggestions (04)
  // ========================================================
  public simulateShortages(date: string, serviceTime?: MealServiceTime): ShortageSimulationResult {
    const plan = this.calculateProductionNeeds(date, serviceTime);
    const shortages: ShortageItem[] = [];
    let totalDeficitCost = 0;

    const SUBSTITUTION_MAP: Record<string, { name: string; ratio: number; notes: string }> = {
      'ing-1': { name: 'Escalope de Dinde Fraîche', ratio: 1.0, notes: 'Remplacement volaille équivalente' },
      'ing-2': { name: 'Huile Végétale / Tournesol', ratio: 1.0, notes: 'Substitut direct cuisson' },
      'ing-3': { name: 'Semoule Moyenne Extra', ratio: 1.0, notes: 'Mouture alternative compatible' },
      'ing-4': { name: 'Pommes de terre fraîches', ratio: 1.0, notes: 'Substitution légume féculent' },
      'ing-5': { name: 'Coulis de tomates fraîches', ratio: 1.2, notes: 'Alternative sauce traditionnelle' },
    };

    for (const req of plan.ingredientRequirements) {
      if (req.currentStock < req.quantityRequired) {
        const deficit = req.quantityRequired - req.currentStock;
        const ing = this.getIngredientById(req.ingredientId);
        const unitCost = ing?.unitCost || 200;
        totalDeficitCost += deficit * unitCost;

        const impactedRecipeNames: string[] = [];
        for (const r of plan.recipes) {
          const recipe = this.getRecipeById(r.recipeId);
          if (recipe?.ingredients.some((i) => i.ingredientId === req.ingredientId)) {
            impactedRecipeNames.push(recipe.name);
          }
        }

        const sub = SUBSTITUTION_MAP[req.ingredientId] || {
          name: `Alternative générique ${req.ingredientName}`,
          ratio: 1.0,
          notes: 'Suggestion basée sur la famille d’ingrédient',
        };

        shortages.push({
          ingredientId: req.ingredientId,
          ingredientName: req.ingredientName,
          unit: req.unit,
          currentStock: req.currentStock,
          requiredQuantity: req.quantityRequired,
          deficitQuantity: Math.round(deficit * 100) / 100,
          suggestedSubstitution: sub,
          impactedRecipeNames,
        });
      }
    }

    const relevantOrders = this.orders.filter(
      (o) => o.deliveryDate === date && (!serviceTime || o.serviceTime === serviceTime) && o.status !== OrderStatus.CANCELLED
    );

    let corporatePriorityCount = 0;
    let standardCount = 0;
    for (const ord of relevantOrders) {
      const cust = this.getCustomerById(ord.customerId);
      if (cust?.subscriptionType === 'CORPORATE' || cust?.subscriptionType === 'SUBSIDIARY') {
        corporatePriorityCount++;
      } else {
        standardCount++;
      }
    }

    const recommendations: string[] = [];
    if (shortages.length === 0) {
      recommendations.push('Stock suffisant pour la production prévue : aucun déficit détecté.');
    } else {
      recommendations.push(
        `Alerte : ${shortages.length} ingrédient(s) en déficit critique pour une valeur estimée de ${Math.round(totalDeficitCost)} DZD.`
      );
      recommendations.push(
        `Priorisation automatique : Réserver les stocks restants en priorité aux ${corporatePriorityCount} commandes entreprises (Corporate/Filiales).`
      );
      recommendations.push(
        `Action recommandée : Activer les ${shortages.length} substitutions suggérées ou déclencher un bon de commande express.`
      );
    }

    return {
      date,
      serviceTime,
      hasShortage: shortages.length > 0,
      shortagesCount: shortages.length,
      totalDeficitCost: Math.round(totalDeficitCost),
      shortages,
      impactedOrdersSummary: {
        totalImpactedOrders: relevantOrders.length,
        corporatePriorityOrders: corporatePriorityCount,
        standardOrders: standardCount,
      },
      recommendations,
    };
  }

  // ========================================================
  // Phase 2 — Distribution Avancée & Optimisation des Tournées (05)
  // ========================================================
  public optimizeDeliveryRuns(
    date: string,
    serviceTime: MealServiceTime,
    autoPersistRuns = false
  ): DeliveryOptimizationResult {
    const orders = this.orders.filter(
      (o) => o.deliveryDate === date && o.serviceTime === serviceTime && o.status !== OrderStatus.CANCELLED
    );

    const availableVehicles: DbVehicle[] = this.vehicles.filter((v) => v.isActive).length > 0
      ? this.vehicles.filter((v) => v.isActive)
      : [
          {
            id: 'veh-default-1',
            type: 'VAN',
            label: 'Renault Kangoo Express (01234-116-16)',
            capacityMaxPortions: 80,
            isActive: true,
          },
        ];

    const ZONE_KEYWORDS: Record<string, string[]> = {
      'Zone 1 — Alger Centre & Didouche': ['alger', 'didouche', 'audin', 'belouizdad', 'telemly', 'mohamed v'],
      'Zone 2 — Hydra, Ben Aknoun & El Biar': ['hydra', 'ben aknoun', 'el biar', 'dely ibrahim'],
      'Zone 3 — Bab Ezzouar & Aéroport': ['bab ezzouar', 'dar el beida', 'aeroport', 'mohammadia'],
      'Zone 4 — Kouba & Banlieue Sud': ['kouba', 'bir khadem', 'hussein dey', 'saoula'],
    };

    const zoneBuckets: Record<string, typeof orders> = {};
    for (const ord of orders) {
      const addr = (ord.deliveryAddress || '').toLowerCase();
      let matchedZone = 'Zone 5 — Autres Communes & Périphérie';
      for (const [zoneName, keywords] of Object.entries(ZONE_KEYWORDS)) {
        if (keywords.some((k) => addr.includes(k))) {
          matchedZone = zoneName;
          break;
        }
      }
      if (!zoneBuckets[matchedZone]) zoneBuckets[matchedZone] = [];
      zoneBuckets[matchedZone].push(ord);
    }

    const optimizedRuns: OptimizedRunAssignment[] = [];
    let vehicleIdx = 0;

    for (const [zoneName, zoneOrders] of Object.entries(zoneBuckets)) {
      if (zoneOrders.length === 0) continue;
      const vehicle = availableVehicles[vehicleIdx % availableVehicles.length];
      vehicleIdx++;

      const stops = zoneOrders.map((ord, idx) => {
        const cust = this.getCustomerById(ord.customerId);
        const windowHour = 11 + Math.floor(idx / 3);
        const windowMin = (idx % 3) * 20;
        const timeWindow = `${windowHour}h${windowMin.toString().padStart(2, '0')} - ${windowHour}h${(windowMin + 15).toString().padStart(2, '0')}`;
        return {
          stopOrder: idx + 1,
          orderId: ord.id,
          customerName: cust?.companyName || cust?.contactName || 'Client',
          deliveryAddress: cust?.deliveryAddress || 'Alger Centre',
          wilayaOrCommune: cust?.commune || 'Alger',
          portions: ord.totalPortions,
          phone: cust?.phone || '0555 00 00 00',
          estimatedDeliveryWindow: timeWindow,
        };
      });

      const totalBoxes = stops.reduce((s, st) => s + st.portions, 0);
      const cap = vehicle.capacityMaxPortions || 60;
      const loadPct = Math.round((totalBoxes / cap) * 100);
      const compensation = 1500 + stops.length * 150;

      const runId = `opt-run-${date}-${serviceTime.toLowerCase()}-${optimizedRuns.length + 1}`;
      const assignment: OptimizedRunAssignment = {
        runId,
        runDate: date,
        serviceTime,
        vehicleId: vehicle.id,
        vehicleLabel: vehicle.label || 'Véhicule de livraison',
        driverName: 'Chauffeur Assigné',
        zoneName,
        totalMealBoxes: totalBoxes,
        vehicleCapacity: cap,
        loadPercentage: loadPct,
        driverCompensationDZD: compensation,
        stops,
      };

      optimizedRuns.push(assignment);

      if (autoPersistRuns) {
        this.deliveryRuns.push({
          id: runId,
          runDate: date,
          serviceTime,
          vehicleId: vehicle.id,
          driverName: assignment.driverName,
          driverPhone: '0555 12 34 56',
          status: 'PLANNED',
          stops: stops.map((st, sIdx) => ({
            id: `stop-${st.orderId}`,
            orderId: st.orderId,
            sequence: sIdx + 1,
            deliveryStatus: 'PENDING',
          })),
        });
      }
    }

    const totalOrdersCount = orders.length;
    const totalBoxesCount = orders.reduce((s, o) => s + o.totalPortions, 0);

    return {
      date,
      serviceTime,
      totalOrders: totalOrdersCount,
      totalMealBoxes: totalBoxesCount,
      assignedVehiclesCount: optimizedRuns.length,
      optimizedRuns,
      unassignedOrders: [],
    };
  }

  // ========================================================
  // Phase 2 — Constructeur de Rapports Dynamiques (08)
  // ========================================================
  public buildCustomReport(query: CustomReportQuery): CustomReportResult {
    const title = query.title || 'Rapport Personnalisé d’Exploitation';
    let filteredOrders = this.orders.slice();

    if (query.startDate) {
      filteredOrders = filteredOrders.filter((o) => o.deliveryDate >= query.startDate!);
    }
    if (query.endDate) {
      filteredOrders = filteredOrders.filter((o) => o.deliveryDate <= query.endDate!);
    }
    if (query.customerId) {
      filteredOrders = filteredOrders.filter((o) => o.customerId === query.customerId);
    }
    if (query.status) {
      filteredOrders = filteredOrders.filter((o) => o.status === query.status);
    }
    if (query.recipeId) {
      filteredOrders = filteredOrders.filter((o) => o.items.some((i) => i.recipeId === query.recipeId));
    }

    let totalPortions = 0;
    let totalRevenue = 0;
    let totalFoodCost = 0;

    const records = filteredOrders.map((ord) => {
      let ordCost = 0;
      for (const item of ord.items) {
        const recipe = this.getRecipeById(item.recipeId);
        const unitCost = recipe?.ingredients.reduce((sum, ing) => {
          const itemIng = this.getIngredientById(ing.ingredientId);
          return sum + ing.quantityPerPortion * (itemIng?.unitCost || 100);
        }, 0) || 150;
        ordCost += unitCost * item.portions;
      }

      const rev = ord.totalPrice || ord.totalPortions * 500;
      const margin = rev - ordCost;

      totalPortions += ord.totalPortions;
      totalRevenue += rev;
      totalFoodCost += ordCost;

      const customer = this.getCustomerById(ord.customerId);
      const customerName = customer?.companyName || customer?.contactName || 'Client Inconnu';

      return {
        date: ord.deliveryDate,
        orderId: ord.id,
        customerName,
        portions: ord.totalPortions,
        revenue: Math.round(rev),
        foodCost: Math.round(ordCost),
        margin: Math.round(margin),
        status: ord.status,
      };
    });

    const grossMargin = totalRevenue - totalFoodCost;
    const grossMarginPct = totalRevenue > 0 ? Math.round((grossMargin / totalRevenue) * 1000) / 10 : 0;

    return {
      title,
      generatedAt: new Date().toISOString(),
      period: { startDate: query.startDate, endDate: query.endDate },
      summary: {
        ordersCount: filteredOrders.length,
        totalPortions,
        totalRevenue: Math.round(totalRevenue),
        totalFoodCost: Math.round(totalFoodCost),
        grossMargin: Math.round(grossMargin),
        grossMarginPct,
      },
      records,
    };
  }

  public exportCustomReportCsv(query: CustomReportQuery): string {
    const report = this.buildCustomReport(query);
    const lines = [
      `"RAPPORT";"${report.title}"`,
      `"DATE GENERATION";"${report.generatedAt}"`,
      `"TOTAL COMMANDES";${report.summary.ordersCount}`,
      `"TOTAL PORTIONS";${report.summary.totalPortions}`,
      `"CHIFFRE AFFAIRES DZD";${report.summary.totalRevenue}`,
      `"COUT MATIERE DZD";${report.summary.totalFoodCost}`,
      `"MARGE BRUTE DZD";${report.summary.grossMargin}`,
      `"TAUX MARGE %";${report.summary.grossMarginPct}%`,
      '',
      '"Date";"N° Commande";"Client";"Portions";"Chiffre Affaires (DZD)";"Coût Matière (DZD)";"Marge (DZD)";"Statut"',
    ];

    for (const r of report.records) {
      const nameEscaped = (r.customerName || 'Client Inconnu').replace(/"/g, '""');
      lines.push(
        `"${r.date}";"${r.orderId}";"${nameEscaped}";${r.portions};${r.revenue};${r.foodCost};${r.margin};"${r.status}"`
      );
    }
    return lines.join('\n');
  }

  // ========================================================
  // Phase 2 — Calendrier Partageable iCal / ICS (01)
  // ========================================================
  public exportMenuIcal(startDate?: string, daysCount = 7): string {
    const start = startDate ? new Date(startDate) : new Date();
    const icalLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//JANITOU FOOD//Menu Planning Platform//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:JANITOU FOOD — Menus de la Semaine',
      'X-WR-TIMEZONE:Africa/Algiers',
    ];

    for (let i = 0; i < daysCount; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const ymd = iso.replace(/-/g, '');

      const plans = this.getMealPlans(iso);
      const lunch = plans.find((p) => p.serviceTime === MealServiceTime.LUNCH);
      const dinner = plans.find((p) => p.serviceTime === MealServiceTime.DINNER);

      if (lunch) {
        const recipe = this.getRecipeById(lunch.mainCourseRecipeId);
        const name = recipe?.name || 'Déjeuner Janitou';
        const desc = `Déjeuner du jour: ${name}. Allergènes: ${recipe?.allergens.join(', ') || 'Aucun'}.`;
        icalLines.push(
          'BEGIN:VEVENT',
          `UID:janitou-lunch-${iso}@janitou.dz`,
          `DTSTAMP:${ymd}T000000Z`,
          `DTSTART:${ymd}T120000Z`,
          `DTEND:${ymd}T140000Z`,
          `SUMMARY:Janitou Déjeuner — ${name}`,
          `DESCRIPTION:${desc.replace(/\n/g, ' ')}`,
          'STATUS:CONFIRMED',
          'END:VEVENT'
        );
      }

      if (dinner) {
        const recipe = this.getRecipeById(dinner.mainCourseRecipeId);
        const name = recipe?.name || 'Dîner Janitou';
        const desc = `Dîner du jour: ${name}. Allergènes: ${recipe?.allergens.join(', ') || 'Aucun'}.`;
        icalLines.push(
          'BEGIN:VEVENT',
          `UID:janitou-dinner-${iso}@janitou.dz`,
          `DTSTAMP:${ymd}T000000Z`,
          `DTSTART:${ymd}T190000Z`,
          `DTEND:${ymd}T210000Z`,
          `SUMMARY:Janitou Dîner — ${name}`,
          `DESCRIPTION:${desc.replace(/\n/g, ' ')}`,
          'STATUS:CONFIRMED',
          'END:VEVENT'
        );
      }
    }

    icalLines.push('END:VCALENDAR');
    return icalLines.join('\r\n');
  }

  // ========================================================
  // Phase 2 — Comptabilité Avancée & Registre Immuable (06)
  // ========================================================
  public recordLedgerEntry(entry: {
    type: ImmutableLedgerEntry['type'];
    referenceId: string;
    customerId: string;
    customerName: string;
    debit: number;
    credit: number;
    notes?: string;
  }): ImmutableLedgerEntry {
    const lastEntry = this.ledgerEntries[this.ledgerEntries.length - 1];
    const previousHash = lastEntry ? lastEntry.currentHash : 'GENESIS_HASH_JANITOU_0000000000000000';
    const entryNumber = this.ledgerEntries.length + 1;
    const timestamp = new Date().toISOString();
    const previousBalance = lastEntry ? lastEntry.balanceAfter : 0;
    const balanceAfter = previousBalance + entry.credit - entry.debit;

    const dataToHash = `${entryNumber}|${timestamp}|${entry.type}|${entry.referenceId}|${entry.customerId}|${entry.debit}|${entry.credit}|${balanceAfter}|${previousHash}`;
    const currentHash = sha256(dataToHash);

    const record: ImmutableLedgerEntry = {
      id: `ledg-${Date.now()}-${entryNumber}`,
      entryNumber,
      timestamp,
      type: entry.type,
      referenceId: entry.referenceId,
      customerId: entry.customerId,
      customerName: entry.customerName,
      debit: entry.debit,
      credit: entry.credit,
      balanceAfter,
      notes: entry.notes || '',
      previousHash,
      currentHash,
    };

    this.ledgerEntries.push(record);
    this.persist();
    return record;
  }

  public getLedgerEntries(limit = 100): ImmutableLedgerEntry[] {
    return this.ledgerEntries.slice(-limit).reverse();
  }

  public verifyLedgerIntegrity(): LedgerVerificationResult {
    let prevHash = 'GENESIS_HASH_JANITOU_0000000000000000';
    for (const entry of this.ledgerEntries) {
      if (entry.previousHash !== prevHash) {
        return {
          isValid: false,
          totalEntries: this.ledgerEntries.length,
          chainIntact: false,
          lastHash: entry.currentHash,
          tamperedEntryId: entry.id,
        };
      }
      const expectedData = `${entry.entryNumber}|${entry.timestamp}|${entry.type}|${entry.referenceId}|${entry.customerId}|${entry.debit}|${entry.credit}|${entry.balanceAfter}|${entry.previousHash}`;
      const computed = sha256(expectedData);
      if (computed !== entry.currentHash) {
        return {
          isValid: false,
          totalEntries: this.ledgerEntries.length,
          chainIntact: false,
          lastHash: entry.currentHash,
          tamperedEntryId: entry.id,
        };
      }
      prevHash = entry.currentHash;
    }
    return {
      isValid: true,
      totalEntries: this.ledgerEntries.length,
      chainIntact: true,
      lastHash: prevHash,
    };
  }
}

export const janitouStore = new JanitouStore();
