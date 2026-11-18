'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  UserPlus,
  Pencil,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatLabel } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PermissionGate } from '@/components/layout/PermissionGate';
import type { BusinessMemberItem, MemberRole } from '@/types/api';

const ASSIGNABLE_ROLES: Exclude<MemberRole, 'OWNER'>[] = [
  'MANAGER',
  'ACCOUNTANT',
  'CASHIER',
  'STAFF',
];

const ALL_PERMISSIONS = [
  'RECORD_TRANSACTIONS',
  'EDIT_TRANSACTIONS',
  'VOID_TRANSACTIONS',
  'VIEW_REPORTS',
  'MANAGE_SUPPLIERS',
  'MANAGE_CUSTOMERS',
  'MANAGE_INVENTORY',
  'ADJUST_STOCK',
  'VIEW_INVENTORY',
  'MANAGE_MEMBERS',
];

const ROLE_DEFAULTS: Record<Exclude<MemberRole, 'OWNER'>, string[]> = {
  MANAGER: [
    'RECORD_TRANSACTIONS',
    'EDIT_TRANSACTIONS',
    'VOID_TRANSACTIONS',
    'VIEW_REPORTS',
    'MANAGE_SUPPLIERS',
    'MANAGE_CUSTOMERS',
    'MANAGE_INVENTORY',
    'ADJUST_STOCK',
    'VIEW_INVENTORY',
  ],
  ACCOUNTANT: [
    'RECORD_TRANSACTIONS',
    'EDIT_TRANSACTIONS',
    'VIEW_REPORTS',
    'MANAGE_SUPPLIERS',
    'MANAGE_CUSTOMERS',
    'VIEW_INVENTORY',
  ],
  CASHIER: ['RECORD_TRANSACTIONS', 'VIEW_INVENTORY'],
  STAFF: ['VIEW_INVENTORY'],
};

export default function TeamManagementPage() {
  const { user } = useAuth();

  const [members, setMembers] = useState<BusinessMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Add / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessMemberItem | null>(null);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Exclude<MemberRole, 'OWNER'>>('CASHIER');
  const [permissions, setPermissions] = useState<string[]>(ROLE_DEFAULTS.CASHIER);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Remove confirmation
  const [revokeTarget, setRevokeTarget] = useState<BusinessMemberItem | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<BusinessMemberItem[]>('/api/business/members');
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const openInviteModal = () => {
    setEditing(null);
    setWhatsappNumber('');
    setName('');
    setRole('CASHIER');
    setPermissions([...ROLE_DEFAULTS.CASHIER]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (m: BusinessMemberItem) => {
    setEditing(m);
    setWhatsappNumber(m.userId?.whatsappNumber || '');
    setName(m.userId?.name || '');
    const safeRole = (m.role === 'OWNER' ? 'MANAGER' : m.role) as Exclude<MemberRole, 'OWNER'>;
    setRole(safeRole);
    setPermissions([...(m.permissions || [])]);
    setFormError(null);
    setModalOpen(true);
  };

  const togglePermission = (perm: string) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  const handleRoleChange = (nextRole: Exclude<MemberRole, 'OWNER'>) => {
    setRole(nextRole);
    setPermissions([...ROLE_DEFAULTS[nextRole]]);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await apiRequest(`/api/business/members/${editing._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role, permissions }),
        });
        setBanner('Team member role and permissions updated.');
      } else {
        await apiRequest('/api/business/members', {
          method: 'POST',
          body: JSON.stringify({
            whatsappNumber: whatsappNumber.trim(),
            name: name.trim() || 'Team Member',
            role,
            permissions,
          }),
        });
        setBanner('Team member added.');
      }
      setModalOpen(false);
      await loadMembers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setError(null);
    try {
      await apiRequest(`/api/business/members/${revokeTarget._id}`, {
        method: 'DELETE',
      });
      setBanner(`Access revoked for ${revokeTarget.userId?.name || 'member'}.`);
      setRevokeTarget(null);
      await loadMembers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke member');
      setRevokeTarget(null);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <PermissionGate
      permission="MANAGE_MEMBERS"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to manage team members.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Team &amp; Permissions</h1>
              <p className="text-sm text-slate-500">
                Invite staff by WhatsApp number, assign roles, and control module permissions.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openInviteModal}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <UserPlus className="h-4 w-4" />
            Add Team Member
          </button>
        </div>

        {banner && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {banner}
            </span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <DataTable<BusinessMemberItem>
          loading={loading}
          data={members}
          keyExtractor={(m) => m._id}
          emptyMessage="No team members found."
          columns={[
            {
              key: 'member',
              header: 'Member',
              render: (m) => {
                const isSelf = m.userId?._id === user?._id;
                return (
                  <div>
                    <p className="font-medium text-slate-900">
                      {m.userId?.name || 'Team Member'}{' '}
                      {isSelf && <span className="text-xs text-emerald-600">(You)</span>}
                    </p>
                    <p className="text-xs text-slate-500">{m.userId?.whatsappNumber}</p>
                  </div>
                );
              },
            },
            {
              key: 'role',
              header: 'Role',
              render: (m) => (
                <Badge variant={m.role === 'OWNER' ? 'info' : 'default'}>{m.role}</Badge>
              ),
            },
            {
              key: 'permissions',
              header: 'Permissions',
              render: (m) => (
                <span className="text-xs text-slate-600">
                  {m.permissions?.length || 0} enabled
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (m) => (
                <Badge variant={m.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {m.status}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'text-right',
              render: (m) => {
                const isOwner = m.role === 'OWNER';
                const isSelf = m.userId?._id === user?._id;
                const locked = isOwner || isSelf;
                return (
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => openEditModal(m)}
                      title={
                        isOwner
                          ? 'Owner role cannot be modified'
                          : isSelf
                            ? 'Cannot modify your own role'
                            : 'Edit role & permissions'
                      }
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setRevokeTarget(m)}
                      title={
                        isOwner
                          ? 'Cannot remove business owner'
                          : isSelf
                            ? 'Cannot remove yourself'
                            : 'Revoke access'
                      }
                      className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              },
            },
          ]}
        />

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-900">
                  {editing ? `Edit ${editing.userId?.name || 'Member'}` : 'Add Team Member'}
                </h3>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSaveMember} className="space-y-4 p-5">
                {formError && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {!editing && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        WhatsApp Number
                      </label>
                      <input
                        type="text"
                        value={whatsappNumber}
                        onChange={(e) => setWhatsappNumber(e.target.value)}
                        placeholder="919876543210"
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Staff name"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Role</label>
                  <select
                    value={role}
                    onChange={(e) => handleRoleChange(e.target.value as Exclude<MemberRole, 'OWNER'>)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-700">
                    Permissions
                  </label>
                  <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                    {ALL_PERMISSIONS.map((perm) => (
                      <label
                        key={perm}
                        className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={permissions.includes(perm)}
                          onChange={() => togglePermission(perm)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        {formatLabel(perm)}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Member'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={Boolean(revokeTarget)}
          title="Revoke Team Access"
          description={`Are you sure you want to remove ${revokeTarget?.userId?.name || 'this member'} from the business workspace?`}
          confirmLabel="Revoke Access"
          loading={revoking}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={handleRevoke}
        />
      </div>
    </PermissionGate>
  );
}
