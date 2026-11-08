import type { FastifyInstance } from 'fastify';

/**
 * Avatars, served by the server so the browser never contacts GitHub's CDN (it would leak the
 * visitor's IP address) and the CSP can stay at `img-src 'self'`.
 *
 * Not an open proxy: the upstream host is a constant, the path is rebuilt from a numeric id or
 * a GitHub login (never taken from the client), redirects stay on that host, the response must
 * be a raster image under a size cap, and results are cached in memory.
 */
export const AVATAR_HOST = 'avatars.githubusercontent.com';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 60 * 60 * 1000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ID = /^[0-9]{1,12}$/;

export type AvatarFetch = (url: string, init: RequestInit) => Promise<Response>;

interface Entry {
  type: string;
  body: Buffer;
  expires: number;
}

/** Upstream URL for a request, or null when the parameters are not acceptable. */
export function upstreamUrl(kind: string, ref: string, size: number): string | null {
  let path: string;
  if ((kind === 'u' || kind === 'in') && ID.test(ref)) path = `/${kind}/${ref}`;
  else if (kind === 'login' && LOGIN.test(ref)) path = `/${ref}`;
  else return null;
  return `https://${AVATAR_HOST}${path}?s=${size}`;
}

async function readCapped(res: Response): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES || !res.body) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > MAX_BYTES) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function registerAvatars(app: FastifyInstance, opts: { fetch?: AvatarFetch } = {}): void {
  const doFetch: AvatarFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const cache = new Map<string, Entry>();

  async function load(url: string): Promise<Entry | 'missing' | null> {
    let current = url;
    for (let hop = 0; hop < 3; hop++) {
      const res = await doFetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        const next = location ? new URL(location, current) : null;
        if (!next || next.protocol !== 'https:' || next.hostname !== AVATAR_HOST || next.port) {
          return null;
        }
        current = next.toString();
        continue;
      }
      if (res.status === 404) return 'missing';
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!IMAGE_TYPES.has(type)) return null;
      const body = await readCapped(res);
      return body ? { type, body, expires: Date.now() + CACHE_TTL_MS } : null;
    }
    return null;
  }

  app.get<{ Params: { kind: string; ref: string }; Querystring: { s?: string } }>(
    '/api/avatars/:kind/:ref',
    async (req, reply) => {
      const size = Math.min(256, Math.max(16, Math.round(Number(req.query.s) / 16) * 16 || 64));
      const url = upstreamUrl(req.params.kind, req.params.ref, size);
      if (!url)
        return reply.code(400).send({ error: { code: 'bad_request', message: 'Bad avatar' } });
      let entry = cache.get(url);
      if (!entry || entry.expires < Date.now()) {
        cache.delete(url);
        let loaded: Awaited<ReturnType<typeof load>>;
        try {
          loaded = await load(url);
        } catch (err) {
          req.log.warn({ err }, 'avatar fetch failed');
          loaded = null;
        }
        if (loaded === 'missing') {
          return reply.code(404).send({ error: { code: 'not_found', message: 'No such avatar' } });
        }
        if (!loaded) {
          return reply
            .code(502)
            .send({ error: { code: 'bad_gateway', message: 'Avatar unavailable' } });
        }
        entry = loaded;
        cache.set(url, entry);
        if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      }
      return reply
        .header('content-type', entry.type)
        .header('cache-control', 'public, max-age=86400, stale-while-revalidate=604800')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(entry.body);
    },
  );
}
