import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.ts';
import { enableBrowserPush } from './browser.ts';

/** A fake push registration: each subscribe() hands out a new endpoint. */
function fakeBrowser() {
  let n = 0;
  let current: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null = null;
  const subscribe = vi.fn(async () => {
    const endpoint = `https://push.example.com/ep-${++n}`;
    const sub = {
      endpoint,
      unsubscribe: vi.fn(async () => {
        if (current?.endpoint === endpoint) current = null;
        return true;
      }),
      toJSON: () => ({ endpoint, keys: { p256dh: 'p256', auth: 'auth' } }),
    };
    current = sub;
    return sub;
  });
  const reg = {
    active: {},
    pushManager: { subscribe, getSubscription: vi.fn(async () => current) },
  };
  vi.stubGlobal('navigator', {
    serviceWorker: { register: vi.fn(async () => reg), getRegistration: vi.fn(async () => reg) },
  });
  return { subscribe, current: () => current };
}

afterEach(() => vi.unstubAllGlobals());

describe('enableBrowserPush', () => {
  it('registers the endpoint of this browser', async () => {
    const b = fakeBrowser();
    const register = vi.fn(async () => ({ subscriptions: 1 }));
    await enableBrowserPush('AAAA', register);
    expect(register).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/ep-1',
      keys: { p256dh: 'p256', auth: 'auth' },
    });
    expect(b.subscribe).toHaveBeenCalledTimes(1);
  });

  it('on 409 push_endpoint_taken: drops the subscription, subscribes again and retries once', async () => {
    const b = fakeBrowser();
    const register = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'push_endpoint_taken', 'taken'))
      .mockResolvedValueOnce({ subscriptions: 1 });
    await enableBrowserPush('AAAA', register);
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[1]![0]).toMatchObject({ endpoint: 'https://push.example.com/ep-2' });
    expect(b.current()?.endpoint).toBe('https://push.example.com/ep-2');
  });

  it('gives up after one retry and does not retry other errors', async () => {
    fakeBrowser();
    const taken = new ApiError(409, 'push_endpoint_taken', 'taken');
    const always = vi.fn().mockRejectedValue(taken);
    await expect(enableBrowserPush('AAAA', always)).rejects.toBe(taken);
    expect(always).toHaveBeenCalledTimes(2);
    const other = new ApiError(400, 'invalid_push_endpoint', 'bad');
    const once = vi.fn().mockRejectedValue(other);
    await expect(enableBrowserPush('AAAA', once)).rejects.toBe(other);
    expect(once).toHaveBeenCalledTimes(1);
  });
});
