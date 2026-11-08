import { afterAll, describe, expect, it } from 'vitest';
import { avatarPath } from '../src/avatars/path';
import { upstreamUrl, type AvatarFetch } from '../src/avatars';
import { makeApp, prisma } from './harness';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const calls: string[] = [];
let handler: (url: string) => Response = () =>
  new Response(PNG, { headers: { 'content-type': 'image/png' } });
const avatarFetch: AvatarFetch = async (url) => {
  calls.push(url);
  return handler(url);
};
const app = makeApp(undefined, { avatarFetch });
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
}, 60_000);
const get = (url: string) => app.inject({ method: 'GET', url });
const reset = () => {
  calls.length = 0;
  handler = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });
};

describe('GET /api/avatars/:kind/:ref', () => {
  it('serves the image from GitHub avatar host with cache headers, and caches it', async () => {
    reset();
    const res = await get('/api/avatars/u/424242?s=64');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('max-age=86400');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(calls).toEqual(['https://avatars.githubusercontent.com/u/424242?s=64']);
    await get('/api/avatars/u/424242?s=64');
    expect(calls).toHaveLength(1);
  });

  it('works without a session and accepts bot and login avatars', async () => {
    reset();
    expect((await get('/api/avatars/in/777')).statusCode).toBe(200);
    expect((await get('/api/avatars/login/Some-User')).statusCode).toBe(200);
    expect(calls).toEqual([
      'https://avatars.githubusercontent.com/in/777?s=64',
      'https://avatars.githubusercontent.com/Some-User?s=64',
    ]);
  });

  it('is not an open proxy: only an id or a login is accepted, never a URL or a path', async () => {
    reset();
    for (const url of [
      '/api/avatars/u/abc',
      '/api/avatars/u/..%2F..%2Fetc',
      '/api/avatars/login/evil.com',
      '/api/avatars/login/-x',
      '/api/avatars/http/evil.com',
      '/api/avatars/login/' + 'a'.repeat(40),
    ]) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
    expect(calls).toHaveLength(0);
    expect(upstreamUrl('login', 'a/b', 64)).toBeNull();
  });

  it('follows redirects on the avatar host only', async () => {
    reset();
    handler = (url) =>
      url.includes('/redir')
        ? new Response(null, { status: 302, headers: { location: '/u/9?s=64' } })
        : new Response(PNG, { headers: { 'content-type': 'image/png' } });
    expect((await get('/api/avatars/login/redir')).statusCode).toBe(200);
    expect(calls.at(-1)).toBe('https://avatars.githubusercontent.com/u/9?s=64');

    reset();
    handler = () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/x' } });
    expect((await get('/api/avatars/login/ssrf')).statusCode).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it('refuses non-raster content and oversized images', async () => {
    reset();
    handler = () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    expect((await get('/api/avatars/u/11')).statusCode).toBe(502);
    handler = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    expect((await get('/api/avatars/u/12')).statusCode).toBe(502);
    handler = () =>
      new Response(Buffer.alloc(600 * 1024), { headers: { 'content-type': 'image/png' } });
    expect((await get('/api/avatars/u/13')).statusCode).toBe(502);
  });

  it('maps upstream 404 to 404 and failures or timeouts to 502', async () => {
    reset();
    handler = () => new Response('nope', { status: 404 });
    expect((await get('/api/avatars/u/21')).statusCode).toBe(404);
    handler = () => new Response('boom', { status: 500 });
    expect((await get('/api/avatars/u/22')).statusCode).toBe(502);
    handler = () => {
      throw new DOMException('timed out', 'TimeoutError');
    };
    expect((await get('/api/avatars/u/23')).statusCode).toBe(502);
  });
});

describe('avatarPath', () => {
  it('rewrites GitHub avatar URLs and rejects anything else', () => {
    expect(avatarPath('https://avatars.githubusercontent.com/u/12?v=4')).toBe(
      '/api/avatars/u/12?s=96',
    );
    expect(avatarPath('https://avatars.githubusercontent.com/octo')).toBe(
      '/api/avatars/login/octo?s=96',
    );
    expect(avatarPath('http://avatars.githubusercontent.com/u/12')).toBeNull();
    expect(avatarPath('https://evil.example/u/12')).toBeNull();
    expect(avatarPath('https://avatars.githubusercontent.com.evil.example/u/12')).toBeNull();
    expect(avatarPath('not a url')).toBeNull();
  });
});
