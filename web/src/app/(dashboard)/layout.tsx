'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, needsOnboarding, loading, subscription, usage } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else if (needsOnboarding) {
        router.replace('/onboarding');
      }
    }
  }, [loading, user, needsOnboarding, router]);

  if (loading || !user || needsOnboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading workspace...</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        {subscription?.readOnly && (
          <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800 lg:px-6">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>
              Your subscription is {subscription.status.toLowerCase()}. Historical data and exports remain available in read-only mode — please renew to record new transactions or use WhatsApp.
            </span>
          </div>
        )}
        {!subscription?.readOnly && usage && usage.warnings?.length > 0 && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 lg:px-6">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Approaching plan limits:{' '}
              {usage.warnings.map((w) => `${w.resource} (${w.current}/${w.limit})`).join(', ')}.
            </span>
          </div>
        )}
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

