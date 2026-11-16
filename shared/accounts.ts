export const roleLabels = { non_member: '非社员', member: '社员', admin: '管理员' } as const;
export type Role = keyof typeof roleLabels;
export type Account = { id: string; email: string; displayName: string; role: Role; createdAt: number; canManageAdmins: boolean };
export type UserSummary = Account & { attempts: number; latestScore: number | null; editableRoles: Role[] };
