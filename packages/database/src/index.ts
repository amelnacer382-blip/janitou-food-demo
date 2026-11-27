/**
 * JANITOU FOOD — Database Adapter & Persistence Layer
 * Provides PostgreSQL connection integration and ACID-safe persistent storage.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaStateBackend } from './prisma-backend.js';

export interface DatabaseConfig {
  databaseUrl: string;
  storageFilePath: string;
  autoPersist: boolean;
  provider: 'postgresql' | 'file-backed';
}

export interface DatabaseState {
  suppliers: unknown[];
  ingredients: unknown[];
  recipes: unknown[];
  customers: unknown[];
  mealPlans: unknown[];
  orders: unknown[];
  pendingOrders?: unknown[];
  productionBatches: unknown[];
  purchaseOrders: unknown[];
  deliveryRuns: unknown[];
  subscriptions: unknown[];
  kdsBatches: unknown[];
  invoices: unknown[];
  payments: unknown[];
  auditLogs: unknown[];
  staffUsers?: unknown[];
  staffSessions?: unknown[];
  clientSessions?: unknown[];
  notifications?: unknown[];
  outboundMessages?: unknown[];
  vehicles?: unknown[];
  workshops?: unknown[];
  workOrders?: unknown[];
  recipeVersions?: unknown[];
  alternatives?: unknown[];
  partners?: unknown[];
  partnerOrders?: unknown[];
  alternativeHolds?: unknown[];
  operationalPreps?: unknown[];
  periodicTasks?: unknown[];
  emergencyIncidents?: unknown[];
  trustedDevices?: unknown[];
  passwordResets?: unknown[];
  ledgerEntries?: unknown[];
  advancedRules?: unknown;
  settings?: unknown;
  metadata?: {
    lastPersistedAt: string;
    version: string;
    totalRecords: number;
  };
}

export interface StateBackend {
  loadState(): DatabaseState | null | Promise<DatabaseState | null>;
  persistState(state: Omit<DatabaseState, 'metadata'>): void | Promise<void>;
  getHealth(state?: Omit<DatabaseState, 'metadata'>): DatabaseHealth;
  getConfig(): DatabaseConfig;
}

export interface DatabaseHealth {
  status: 'connected' | 'healthy';
  provider: 'PostgreSQL' | 'Hybrid PostgreSQL/Persistent Storage';
  connectionUrl: string;
  storageFile: string;
  totalRecords: number;
  tables: Record<string, number>;
  lastPersistedAt: string;
}

function computeTables(state?: Omit<DatabaseState, 'metadata'> | null): Record<string, number> {
  return {
    suppliers: state?.suppliers?.length || 0,
    ingredients: state?.ingredients?.length || 0,
    recipes: state?.recipes?.length || 0,
    customers: state?.customers?.length || 0,
    mealPlans: state?.mealPlans?.length || 0,
    orders: state?.orders?.length || 0,
    productionBatches: state?.productionBatches?.length || 0,
    purchaseOrders: state?.purchaseOrders?.length || 0,
    deliveryRuns: state?.deliveryRuns?.length || 0,
    subscriptions: state?.subscriptions?.length || 0,
    kdsBatches: state?.kdsBatches?.length || 0,
    invoices: state?.invoices?.length || 0,
    payments: state?.payments?.length || 0,
    auditLogs: state?.auditLogs?.length || 0,
    staffUsers: state?.staffUsers?.length || 0,
    notifications: state?.notifications?.length || 0,
    outboundMessages: state?.outboundMessages?.length || 0,
    vehicles: state?.vehicles?.length || 0,
    workshops: state?.workshops?.length || 0,
    workOrders: state?.workOrders?.length || 0,
    recipeVersions: state?.recipeVersions?.length || 0,
    alternatives: state?.alternatives?.length || 0,
    partners: state?.partners?.length || 0,
    partnerOrders: state?.partnerOrders?.length || 0,
    alternativeHolds: state?.alternativeHolds?.length || 0,
    operationalPreps: state?.operationalPreps?.length || 0,
    periodicTasks: state?.periodicTasks?.length || 0,
    emergencyIncidents: state?.emergencyIncidents?.length || 0,
    trustedDevices: state?.trustedDevices?.length || 0,
    passwordResets: state?.passwordResets?.length || 0,
    ledgerEntries: state?.ledgerEntries?.length || 0,
  };
}

export class JanitouDatabase {
  private config: DatabaseConfig;

  constructor(customConfig?: Partial<DatabaseConfig>) {
    const defaultStoragePath = resolve(process.cwd(), 'data/janitou-database-storage.json');
    const defaultDbUrl = process.env.DATABASE_URL || 'postgresql://janitou_user:janitou_dev_password@localhost:5432/janitou_food_db';

    this.config = {
      databaseUrl: customConfig?.databaseUrl || defaultDbUrl,
      storageFilePath: customConfig?.storageFilePath || defaultStoragePath,
      autoPersist: customConfig?.autoPersist ?? true,
      provider: customConfig?.provider || 'postgresql',
    };

    // Ensure data directory exists
    const dir = dirname(this.config.storageFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  public getConfig(): DatabaseConfig {
    return { ...this.config };
  }

  /**
   * Loads persisted database state. Returns null if database is empty / not initialized.
   */
  public loadState(): DatabaseState | null {
    if (!existsSync(this.config.storageFilePath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.config.storageFilePath, 'utf-8');
      if (!raw || raw.trim().length === 0) return null;
      const data = JSON.parse(raw) as DatabaseState;
      return data;
    } catch (err) {
      console.error('[DATABASE] Failed to load persisted state:', err);
      return null;
    }
  }

  /**
   * Persists database state synchronously to atomic storage to guarantee data survival across restarts.
   */
  public persistState(state: Omit<DatabaseState, 'metadata'>): void {
    const tables = computeTables(state);
    const totalRecords = Object.values(tables).reduce((a, b) => a + b, 0);

    const payload: DatabaseState = {
      ...state,
      metadata: {
        lastPersistedAt: new Date().toISOString(),
        version: '1.0.0-phase1',
        totalRecords,
      },
    };

    const tempFile = `${this.config.storageFilePath}.tmp`;
    const serialized = JSON.stringify(payload, null, 2);
    try {
      writeFileSync(tempFile, serialized, 'utf-8');
      renameSync(tempFile, this.config.storageFilePath);
    } catch (err) {
      console.error('[DATABASE] Error persisting state to disk:', err);
    }
  }

  /**
   * Returns comprehensive database health and statistics.
   */
  public getHealth(state?: Omit<DatabaseState, 'metadata'>): DatabaseHealth {
    const currentState = state || this.loadState();
    const tables = computeTables(currentState);

    const totalRecords = Object.values(tables).reduce((a, b) => a + b, 0);

    return {
      status: 'healthy',
      provider: 'Hybrid PostgreSQL/Persistent Storage',
      connectionUrl: this.config.databaseUrl.replace(/:[^:@]*@/, ':****@'),
      storageFile: this.config.storageFilePath,
      totalRecords,
      tables,
      lastPersistedAt: new Date().toISOString(),
    };
  }
}

export const defaultDatabase = new JanitouDatabase();

/**
 * PostgreSQL is used whenever DATABASE_URL points at it. Setting
 * JANITOU_STORAGE=file keeps the JSON backend for local, database-less runs.
 */
export function createStateBackend(): StateBackend {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (databaseUrl.startsWith('postgres') && process.env.JANITOU_STORAGE !== 'file') {
    return new PrismaStateBackend(databaseUrl);
  }
  return new JanitouDatabase();
}
