// Proposed shapes inferred from the design's sample data. Replace with real API types.
import type { RoleKey } from './permissions';

export type MemberStatus = 'active' | 'pending' | 'suspended';

export interface Member {
  id: string;            // e.g. "BUA-00118"
  name: string;
  email: string;
  role: RoleKey | 'member';
  status: MemberStatus;
  joinedAt: string;      // ISO date
}

export interface AuditEvent {
  id: string;            // e.g. "EVT-20261023-001"
  at: string;            // ISO timestamp
  actor: { id: string; name: string; role: RoleKey };
  category: 'permissions' | 'members' | 'loans' | 'savings' | 'auth' | 'reports';
  action: string;
  target?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface OverviewKpis {
  members: number; totalSavings: number; loansOutstanding: number;
  activeLoans: number; pendingApprovals: number;
}
