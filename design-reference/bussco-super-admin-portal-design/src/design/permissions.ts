// Proposal derived from the Draft A design. Align with the real backend model.
export type PermissionKey =
  | 'm.view' | 'm.edit' | 'm.suspend'
  | 's.view' | 's.record' | 's.withdraw'
  | 'l.view' | 'l.review' | 'l.approve' | 'l.disburse'
  | 'r.view' | 'r.export' | 'rates'
  | 'audit' | 'roles';

export type RoleKey = 'super_admin' | 'president' | 'vice_president' | 'treasurer';

export const PERMISSION_GROUPS: { group: string; items: { key: PermissionKey; label: string }[] }[] = [
  { group: 'Members', items: [
    { key: 'm.view', label: 'View member directory' },
    { key: 'm.edit', label: 'Add & edit members' },
    { key: 'm.suspend', label: 'Suspend or reactivate members' } ] },
  { group: 'Savings', items: [
    { key: 's.view', label: 'View savings ledgers' },
    { key: 's.record', label: 'Record contributions' },
    { key: 's.withdraw', label: 'Approve withdrawals' } ] },
  { group: 'Loans', items: [
    { key: 'l.view', label: 'View loan applications' },
    { key: 'l.review', label: 'Review & recommend loans' },
    { key: 'l.approve', label: 'Final loan approval' },
    { key: 'l.disburse', label: 'Disburse approved loans' } ] },
  { group: 'Finance & reports', items: [
    { key: 'r.view', label: 'View financial reports' },
    { key: 'r.export', label: 'Export reports' },
    { key: 'rates', label: 'Manage interest & dividend rates' } ] },
  { group: 'Governance', items: [
    { key: 'audit', label: 'View audit log' },
    { key: 'roles', label: 'Manage roles & permissions (Super Admin only)' } ] },
];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap(g => g.items.map(i => i.key));

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  super_admin: ALL_PERMISSIONS,
  president: ['m.view','m.edit','m.suspend','s.view','l.view','l.approve','r.view','r.export','rates','audit'],
  vice_president: ['m.view','s.view','l.view','l.review','r.view','r.export','audit'],
  treasurer: ['m.view','s.view','s.record','s.withdraw','l.view','l.disburse','r.view','r.export','audit'],
};

/** 'roles' is locked to Super Admin: never grantable to other roles. */
export const LOCKED_PERMISSIONS: PermissionKey[] = ['roles'];
