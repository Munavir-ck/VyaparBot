'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Package,
  Boxes,
  History,
  Users,
  Truck,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard }],
  },
  {
    title: 'Money Management',
    items: [
      { label: 'Money Management', href: '/money', icon: Wallet, permission: 'RECORD_TRANSACTIONS' },
      { label: 'Transactions', href: '/transactions', icon: ArrowLeftRight, permission: 'VIEW_REPORTS' },
      { label: 'Receivables', href: '/receivables', icon: ArrowDownLeft, permission: 'MANAGE_CUSTOMERS' },
      { label: 'Payables', href: '/payables', icon: ArrowUpRight, permission: 'MANAGE_SUPPLIERS' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Inventory Ops', href: '/inventory', icon: Boxes, permission: 'VIEW_INVENTORY' },
      { label: 'Products', href: '/products', icon: Package, permission: 'VIEW_INVENTORY' },
      { label: 'Stock Movements', href: '/stock-movements', icon: History, permission: 'VIEW_INVENTORY' },
    ],
  },
  {
    title: 'Contacts',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, permission: 'MANAGE_CUSTOMERS' },
      { label: 'Suppliers', href: '/suppliers', icon: Truck, permission: 'MANAGE_SUPPLIERS' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Financial Reports', href: '/reports/financial', icon: BarChart3, permission: 'VIEW_REPORTS' },
      { label: 'Inventory Reports', href: '/reports/inventory', icon: ClipboardList, permission: 'VIEW_INVENTORY' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Business Settings', href: '/settings/business', icon: Settings },
      { label: 'Team & Permissions', href: '/settings/team', icon: ShieldCheck, permission: 'MANAGE_MEMBERS' },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { hasPermission, business, user } = useAuth();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <div>
            <span className="text-base font-bold tracking-tight text-slate-900">
              VyaparBot
            </span>
            <p className="text-[11px] font-medium text-slate-500">
              {business?.businessType || 'BUSINESS'} SAAS
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {user?.role === 'PLATFORM_ADMIN' && (
            <div>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Platform Admin
              </p>
              <div className="mt-1.5 space-y-1">
                {[
                  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
                  { label: 'Businesses', href: '/admin/businesses', icon: Users },
                  { label: 'Pilot Slots (3)', href: '/admin/pilot', icon: ShieldCheck },
                  { label: 'Subscriptions & Plans', href: '/admin/subscriptions', icon: Package },
                  { label: 'Usage Monitoring', href: '/admin/usage', icon: BarChart3 },
                  { label: 'SaaS Billing', href: '/admin/billing', icon: Wallet },
                ].map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${active ? 'text-emerald-600' : 'text-slate-400'}`}
                      />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.permission || hasPermission(item.permission),
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.title}>
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.title}
                </p>
                <div className="mt-1.5 space-y-1">
                  {visibleItems.map((item) => {
                    const active = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${active ? 'text-emerald-600' : 'text-slate-400'}`} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

