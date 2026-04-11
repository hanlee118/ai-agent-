const ENV_API_BASE = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE;
export const API_BASE = String(ENV_API_BASE || '/api').trim().replace(/\/$/, '') || '/api';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    [key: string]: unknown;
  };
}

export function isApiEnvelope<T>(value: unknown): value is ApiResponse<T> {
  return Boolean(value) && typeof value === 'object' && 'success' in (value as Record<string, unknown>);
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const urls = resolveApiUrlCandidates(normalizedEndpoint);

  let lastError: unknown;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const hasNextCandidate = index < urls.length - 1;
    const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = new Headers(options.headers || {});
    if (!isFormDataBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const config: RequestInit = {
      ...options,
      headers,
      credentials: resolveRequestCredentials(url, options.credentials),
    };
    try {
      const response = await fetch(url, config);
      const rawText = await response.text();
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
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
          throw new ApiRequestError(payload.error?.message || 'Request failed', {
            status: response.status,
            code: payload.error?.code,
            details: (payload.error || undefined) as Record<string, unknown> | undefined,
          });
        }
        return payload.data as T;
      }

      if (!response.ok) {
        const payloadObject = typeof payload === 'object' && payload ? (payload as Record<string, unknown>) : undefined;
        const payloadCode = typeof payloadObject?.code === 'string'
          ? payloadObject.code
          : typeof payloadObject?.error === 'object' && payloadObject.error && typeof (payloadObject.error as Record<string, unknown>).code === 'string'
            ? String((payloadObject.error as Record<string, unknown>).code)
            : undefined;
        const message =
          typeof payload === 'object' && payload && 'message' in payload
            ? String((payload as { message?: string }).message || 'Request failed')
            : typeof payloadObject?.error === 'object' && payloadObject.error && 'message' in (payloadObject.error as Record<string, unknown>)
              ? String((payloadObject.error as { message?: string }).message || 'Request failed')
              : `Request failed (${response.status})`;

        const error = new ApiRequestError(message, {
          status: response.status,
          code: payloadCode,
          details: payloadObject,
        });

        if (hasNextCandidate && shouldFallbackToNextApiBase({
          status: response.status,
          contentType,
          rawText,
          message,
        })) {
          lastError = error;
          continue;
        }

        throw error;
      }

      return payload as T;
    } catch (error) {
      if (!hasNextCandidate) {
        throw error;
      }
      if (error instanceof ApiRequestError) {
        throw error;
      }
      lastError = error;
      continue;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

function resolveRequestCredentials(url: string, explicit?: RequestCredentials): RequestCredentials {
  if (explicit) {
    return explicit;
  }
  if (typeof window === 'undefined') {
    return 'include';
  }
  try {
    const target = new URL(url, window.location.origin);
    if (target.origin === window.location.origin) {
      return 'include';
    }
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    const currentHost = String(window.location.hostname || '').toLowerCase();
    const targetHost = String(target.hostname || '').toLowerCase();
    if (localHosts.has(currentHost) && localHosts.has(targetHost)) {
      return 'include';
    }
    return 'omit';
  } catch {
    return 'same-origin';
  }
}

function resolveApiUrlCandidates(endpoint: string) {
  const candidates = [`${API_BASE}${endpoint}`];
  const fallbackBases = resolveLocalApiFallbackBases();
  for (const base of fallbackBases) {
    candidates.push(`${base}${endpoint}`);
  }
  return Array.from(new Set(candidates));
}

function resolveLocalApiFallbackBases() {
  if (typeof window === 'undefined') {
    return [] as string[];
  }
  const host = String(window.location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocal) {
    return [] as string[];
  }

  const currentOrigin = String(window.location.origin || '');
  const bases = ['http://127.0.0.1:8787/api', 'http://localhost:8787/api'];
  return bases.filter((base) => !currentOrigin.startsWith(base.replace(/\/api$/, '')));
}

function shouldFallbackToNextApiBase(input: {
  status: number;
  contentType: string;
  rawText: string;
  message: string;
}) {
  if (input.status !== 404 && input.status !== 405) {
    return false;
  }

  const text = (input.rawText || '').trim().toLowerCase();
  const isHtml = input.contentType.includes('text/html')
    || text.startsWith('<!doctype html')
    || text.startsWith('<html');
  if (isHtml) {
    return true;
  }

  if (/cannot\s+(get|post|put|patch|delete)\s+\/api\//i.test(input.rawText)) {
    return true;
  }

  return input.message === `Request failed (${input.status})`;
}
