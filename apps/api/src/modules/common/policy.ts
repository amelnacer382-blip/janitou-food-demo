import type { StaffRole } from '../../data/mock-db.js';

export type Permission =
  | 'customers.read'
  | 'customers.write'
  | 'recipes.read'
  | 'recipes.write'
  | 'menus.read'
  | 'menus.write'
  | 'orders.read'
  | 'orders.write'
  | 'production.read'
  | 'production.write'
  | 'purchasing.read'
  | 'purchasing.write'
  | 'delivery.read'
  | 'delivery.write'
  | 'accounting.read'
  | 'accounting.write'
  | 'analytics.read'
  | 'audit.read'
  | 'admin.system';

/**
 * Role → module permissions. This is the single matrix used by the legacy ERP
 * routes; the manager app applies the same intent through `managerOnly` /
 * `adminOnly` guards in `modules/simple/routes.ts`.
 */
const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  ADMIN: [
    'customers.read', 'customers.write',
    'recipes.read', 'recipes.write',
    'menus.read', 'menus.write',
    'orders.read', 'orders.write',
    'production.read', 'production.write',
    'purchasing.read', 'purchasing.write',
    'delivery.read', 'delivery.write',
    'accounting.read', 'accounting.write',
    'analytics.read', 'audit.read', 'admin.system',
  ],
  OPERATIONS_MANAGER: [
    'customers.read', 'customers.write',
    'recipes.read', 'recipes.write',
    'menus.read', 'menus.write',
    'orders.read', 'orders.write',
    'production.read', 'production.write',
    'purchasing.read', 'purchasing.write',
    'delivery.read', 'delivery.write',
    'accounting.read', 'accounting.write',
    'analytics.read', 'audit.read',
  ],
  CHEF_KITCHEN: [
    'recipes.read', 'recipes.write',
    'menus.read', 'menus.write',
    'orders.read', 'orders.write',
    'production.read', 'production.write',
  ],
  PURCHASING_MANAGER: [
    'recipes.read',
    'production.read',
    'purchasing.read', 'purchasing.write',
  ],
  PACKING_LOGISTICS: [
    'orders.read',
    'production.read',
    'delivery.read', 'delivery.write',
  ],
  DELIVERY_DRIVER: [
    'delivery.read', 'delivery.write',
  ],
};

interface LegacyPolicy {
  prefix: string;
  permission: Permission;
}

// Longest prefix wins; every legacy module must be listed explicitly.
const LEGACY_POLICIES: LegacyPolicy[] = [
  { prefix: '/api/v1/customers', permission: 'customers.read' },
  { prefix: '/api/v1/recipes', permission: 'recipes.read' },
  { prefix: '/api/v1/alternatives', permission: 'recipes.read' },
  { prefix: '/api/v1/ingredients', permission: 'recipes.read' },
  { prefix: '/api/v1/meal-plans', permission: 'menus.read' },
  { prefix: '/api/v1/orders', permission: 'orders.read' },
  { prefix: '/api/v1/subscriptions', permission: 'orders.read' },
  { prefix: '/api/v1/production', permission: 'production.read' },
  { prefix: '/api/v1/packaging', permission: 'production.read' },
  { prefix: '/api/v1/kds', permission: 'production.read' },
  { prefix: '/api/v1/purchasing', permission: 'purchasing.read' },
  { prefix: '/api/v1/delivery', permission: 'delivery.read' },
  { prefix: '/api/v1/analytics', permission: 'analytics.read' },
  { prefix: '/api/v1/export', permission: 'analytics.read' },
  { prefix: '/api/v1/accounting', permission: 'accounting.read' },
  { prefix: '/api/v1/reports', permission: 'analytics.read' },
  { prefix: '/api/v1/audit', permission: 'audit.read' },
  { prefix: '/api/v1/rules', permission: 'menus.write' },
  { prefix: '/api/v1/emergency', permission: 'production.read' },
  { prefix: '/api/v1/system', permission: 'admin.system' },
];

const WRITE_METHODS: Record<string, true> = {
  POST: true,
  PUT: true,
  PATCH: true,
  DELETE: true,
};

export function permissionsForRole(role: StaffRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Resolves the permission required by a legacy route and, for mutating
 * methods, upgrades the read permission to its write counterpart.
 */
export function requiredLegacyPermission(pathname: string, method: string): Permission | null {
  let match: LegacyPolicy | undefined;
  for (const policy of LEGACY_POLICIES) {
    if (pathname === policy.prefix || pathname.startsWith(`${policy.prefix}/`)) {
      if (!match || policy.prefix.length > match.prefix.length) match = policy;
    }
  }
  if (!match) return null;
  if (!WRITE_METHODS[method.toUpperCase()]) return match.permission;
  if (match.permission === 'analytics.read' || match.permission === 'audit.read') return match.permission;
  const write = match.permission.replace('.read', '.write') as Permission;
  return write;
}

export function canAccessLegacy(role: StaffRole, pathname: string, method: string): boolean {
  const permission = requiredLegacyPermission(pathname, method);
  // Unknown legacy routes fall through to the router's 404, but only ADMINs
  // may probe them; a new module without a policy must not be implicitly open.
  if (!permission) return role === 'ADMIN';
  return hasPermission(role, permission);
}
