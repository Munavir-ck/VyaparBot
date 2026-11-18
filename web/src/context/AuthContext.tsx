'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import type {
  AuthSessionData,
  Business,
  BusinessConfig,
  MemberRole,
  SubscriptionInfo,
  UsageSummaryInfo,
  User,
} from '@/types/api';

interface AuthContextValue {
  user: User | null;
  business: Business | null;
  businessConfig: BusinessConfig | null;
  memberRole: MemberRole | null;
  permissions: string[];
  subscription: SubscriptionInfo | null;
  usage: UsageSummaryInfo | null;
  needsOnboarding: boolean;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  requestOtp: (phone: string) => Promise<{ expiresInSeconds: number; testOtp?: string }>;
  verifyOtp: (phone: string, otp: string, name?: string) => Promise<AuthSessionData>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthSessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await apiRequest<AuthSessionData>('/api/auth/me');
      setState(data);
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const requestOtp = async (phone: string) => {
    return apiRequest<{ expiresInSeconds: number; testOtp?: string }>('/api/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  };

  const verifyOtp = async (phone: string, otp: string, name?: string) => {
    const data = await apiRequest<AuthSessionData>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp, name }),
    });
    setState(data);
    return data;
  };

  const logout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setState(null);
  };

  const hasPermission = useCallback(
    (permission: string) => {
      if (!state) return false;
      if (state.memberRole === 'OWNER') return true;
      return state.permissions.includes(permission);
    },
    [state],
  );

  return (
    <AuthContext.Provider
      value={{
        user: state?.user || null,
        business: state?.business || null,
        businessConfig: state?.businessConfig || null,
        memberRole: state?.memberRole || null,
        permissions: state?.permissions || [],
        subscription: state?.subscription || null,
        usage: state?.usage || null,
        needsOnboarding: Boolean(state?.needsOnboarding),
        loading,
        refreshAuth,
        requestOtp,
        verifyOtp,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

