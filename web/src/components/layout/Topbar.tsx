'use client';

import React from 'react';
import { Menu, LogOut, Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Badge } from '@/components/ui/Badge';

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { business, user, memberRole, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="hidden rounded-lg bg-emerald-50 p-1.5 text-emerald-700 sm:block">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              {business?.name || 'Business Workspace'}
            </h1>
            <p className="text-xs text-slate-500">
              {business?.currency || 'INR'} &bull; {business?.timezone || 'Asia/Kolkata'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {memberRole && <Badge variant="info">{memberRole}</Badge>}
        <span className="hidden text-xs font-medium text-slate-600 sm:inline">
          {user?.name} ({user?.whatsappNumber})
        </span>
        <button
          onClick={logout}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}

