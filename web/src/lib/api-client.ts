export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totalReceivables?: number;
  totalPayables?: number;
}

export async function apiRequestWithMeta<T>(
  path: string,
  options: RequestInit = {},
): Promise<PaginatedResponse<T>> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      json.message || `Request failed with status ${res.status}`,
      res.status,
      json.code,
    );
  }
  return {
    data: Array.isArray(json.data) ? json.data : [],
    total: json.total ?? 0,
    page: json.page ?? 1,
    limit: json.limit ?? 50,
    totalPages: json.totalPages ?? 1,
    totalReceivables: json.totalReceivables,
    totalPayables: json.totalPayables,
  };
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach CSRF token on state-changing requests
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = getCookie('csrf_token');
    if (csrf) {
      headers.set('x-csrf-token', csrf);
    }
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      json.message || `Request failed with status ${res.status}`,
      res.status,
      json.code,
    );
  }

  return (json.data !== undefined ? json.data : json) as T;
}

