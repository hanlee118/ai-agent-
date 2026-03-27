import { request } from './core';

export const authApi = {
  async getStatus() {
    return request<{
      setupComplete: boolean;
      authenticated: boolean;
      user?: { id: string; name: string; email: string };
    }>('/auth/status');
  },

  async setup(password: string) {
    return request<{
      setupComplete: boolean;
      authenticated: boolean;
    }>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async login(password: string) {
    return request<{
      setupComplete: boolean;
      authenticated: boolean;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async logout() {
    return request('/auth/logout', { method: 'POST' });
  },
};
