import { HermesMcpClientService } from '../src/shared/services/hermes-mcp-client.service';

describe('HermesMcpClientService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HERMES_MCP_ENDPOINT = 'http://hermes:3001/mcp';
    process.env.HERMES_MCP = '';
    process.env.HERMES_FALLBACK_URL = 'http://hermes:3001/fallback';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('falls back to fallback URL when MCP JSON-RPC call fails', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, via: 'fallback' }),
      } as any);

    const service = new HermesMcpClientService();
    const result = await service.call('memory.sync', { projectId: 'project-1' });

    expect(result).toEqual({ ok: true, via: 'fallback' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe('http://hermes:3001/fallback');
  });

  it('returns false on health check when endpoint is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('unreachable'));
    const service = new HermesMcpClientService();
    await expect(service.health()).resolves.toBe(false);
  });
});
