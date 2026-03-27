export const API_BASE = '/api';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export function isApiEnvelope<T>(value: unknown): value is ApiResponse<T> {
  return Boolean(value) && typeof value === 'object' && 'success' in (value as Record<string, unknown>);
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  };

  const response = await fetch(url, config);
  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (isApiEnvelope<T>(payload)) {
    if (!payload.success) {
      throw new Error(payload.error?.message || 'Request failed');
    }
    return payload.data as T;
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message?: string }).message || 'Request failed')
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}
