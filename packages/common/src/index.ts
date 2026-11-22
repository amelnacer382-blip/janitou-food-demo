/**
 * JANITOU FOOD — Core Domain Types & Enumerations
 */

// User and Roles
export enum UserRole {
  ADMIN = 'ADMIN',
  OPERATIONS_MANAGER = 'OPERATIONS_MANAGER',
  CHEF_KITCHEN = 'CHEF_KITCHEN',
  PURCHASING_MANAGER = 'PURCHASING_MANAGER',
  PACKING_LOGISTICS = 'PACKING_LOGISTICS',
  DELIVERY_DRIVER = 'DELIVERY_DRIVER',
  CLIENT = 'CLIENT',
}

// Service Timing
export enum MealServiceTime {
  LUNCH = 'LUNCH',
  DINNER = 'DINNER',
}

// Order Status Workflow
export enum OrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PLANNED = 'PLANNED',
  IN_PRODUCTION = 'IN_PRODUCTION',
  PORTIONED_PACKAGED = 'PORTIONED_PACKAGED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Meal and Recipe Components
export enum ComponentCategory {
  STARTER = 'STARTER',
  MAIN_COURSE = 'MAIN_COURSE',
  SIDE_DISH = 'SIDE_DISH',
  DESSERT = 'DESSERT',
  BEVERAGE = 'BEVERAGE',
  BREAD = 'BREAD',
}

export interface DietaryPreference {
  id: string;
  name: string; // e.g., 'Vegetarian', 'Gluten-Free', 'Low-Sodium', 'Halal'
  code: string;
}

// Customer Definition
export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone: string;
  address: string;
  wilaya?: string;
  commune?: string;
  deliveryNotes?: string;
  dietaryPreferences: DietaryPreference[];
  createdAt: Date;
  updatedAt: Date;
}

// Ingredient & Purchasing
export enum UnitOfMeasure {
  KILOGRAM = 'KG',
  GRAM = 'G',
  LITER = 'L',
  MILLILITER = 'ML',
  PIECE = 'PCS',
  PACK = 'PACK',
}

export interface Ingredient {
  id: string;
  name: string;
  unit: UnitOfMeasure;
  currentStock: number;
  minimumThreshold: number;
  unitCost: number;
  supplierId?: string;
}

// Recipe & Recipe Component
export interface RecipeIngredient {
  ingredientId: string;
  quantityPerPortion: number;
  unit: UnitOfMeasure;
}

export interface Recipe {
  id: string;
  name: string;
  category: ComponentCategory;
  description?: string;
  yieldPortions: number;
  ingredients: RecipeIngredient[];
  preparationTimeMinutes?: number;
  allergens: string[];
}

// Meal Planning Schedule
export interface MealPlanDay {
  id: string;
  date: string; // ISO date 'YYYY-MM-DD'
  serviceTime: MealServiceTime;
  starterRecipeId?: string;
  mainCourseRecipeId: string;
  sideDishRecipeId?: string;
  dessertRecipeId?: string;
  alternativeRecipes: string[];
}

// Production Batch Requirement
export interface ProductionBatchRequirement {
  date: string;
  serviceTime: MealServiceTime;
  recipeId: string;
  plannedPortions: number;
  actualProducedPortions?: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

// Distribution & Delivery Stop
export interface DeliveryStop {
  orderId: string;
  customerId: string;
  deliveryAddress: string;
  phone: string;
  serviceTime: MealServiceTime;
  portions: number;
  status: 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
  deliveryProof?: string;
}

// ========================================================
// Phase 2 — Advanced Modules & Automation
// ========================================================

export interface AdvancedRulesConfig {
  maxPastaPerWeek: number;
  allowSameDayFries: boolean;
  allowSameDayMincedMeat: boolean;
  saturdayMaxPrepMinutes: number;
  minIngredientSpacingDays: number;
  defaultOrderCutoffHour: number;
  enableDietarySafetyWarnings: boolean;
  shortageAutoSubstitution: boolean;
  maxDeliveryRunRadiusKm: number;
}

export interface ShortageItem {
  ingredientId: string;
  ingredientName: string;
  unit: UnitOfMeasure;
  currentStock: number;
  requiredQuantity: number;
  deficitQuantity: number;
  suggestedSubstitution?: {
    ingredientId?: string;
    name: string;
    ratio: number;
    notes: string;
  };
  impactedRecipeNames: string[];
}

export interface ShortageSimulationResult {
  date: string;
  serviceTime?: MealServiceTime;
  hasShortage: boolean;
  shortagesCount: number;
  totalDeficitCost: number;
  shortages: ShortageItem[];
  impactedOrdersSummary: {
    totalImpactedOrders: number;
    corporatePriorityOrders: number;
    standardOrders: number;
  };
  recommendations: string[];
}

export interface OptimizedDeliveryStop {
  stopOrder: number;
  orderId: string;
  customerName: string;
  deliveryAddress: string;
  wilayaOrCommune: string;
  portions: number;
  phone: string;
  estimatedDeliveryWindow: string;
}

export interface OptimizedRunAssignment {
  runId: string;
  runDate: string;
  serviceTime: MealServiceTime;
  vehicleId: string;
  vehicleLabel: string;
  driverName: string;
  zoneName: string;
  totalMealBoxes: number;
  vehicleCapacity: number;
  loadPercentage: number;
  driverCompensationDZD: number;
  stops: OptimizedDeliveryStop[];
}

export interface DeliveryOptimizationResult {
  date: string;
  serviceTime: MealServiceTime;
  totalOrders: number;
  totalMealBoxes: number;
  assignedVehiclesCount: number;
  optimizedRuns: OptimizedRunAssignment[];
  unassignedOrders: { orderId: string; reason: string }[];
}

export interface CustomReportQuery {
  title?: string;
  startDate?: string;
  endDate?: string;
  customerId?: string;
  category?: ComponentCategory;
  recipeId?: string;
  status?: OrderStatus;
}

export interface CustomReportResult {
  title: string;
  generatedAt: string;
  period: { startDate?: string; endDate?: string };
  summary: {
    ordersCount: number;
    totalPortions: number;
    totalRevenue: number;
    totalFoodCost: number;
    grossMargin: number;
    grossMarginPct: number;
  };
  records: Array<{
    date: string;
    orderId: string;
    customerName: string;
    portions: number;
    revenue: number;
    foodCost: number;
    margin: number;
    status: string;
  }>;
}

export interface ImmutableLedgerEntry {
  id: string;
  entryNumber: number;
  timestamp: string;
  type: 'INVOICE_ISSUED' | 'PAYMENT_RECEIVED' | 'REFUND_PROCESSED' | 'DISCOUNT_APPLIED';
  referenceId: string;
  customerId: string;
  customerName: string;
  debit: number;
  credit: number;
  balanceAfter: number;
  notes: string;
  previousHash: string;
  currentHash: string;
}

export interface LedgerVerificationResult {
  isValid: boolean;
  totalEntries: number;
  chainIntact: boolean;
  lastHash: string;
  tamperedEntryId?: string;
}
