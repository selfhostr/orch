import { AVATAR_HOST } from './index';

/** Same-origin path for a GitHub avatar URL, or null when it is not one of GitHub's. */
export function avatarPath(avatarUrl: string, size = 96): string | null {
  let u: URL;
  try {
    u = new URL(avatarUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== AVATAR_HOST) return null;
  const m = /^\/(?:(u|in)\/(\d{1,12})|([A-Za-z0-9][A-Za-z0-9-]{0,38}))\/?$/.exec(u.pathname);
  if (!m) return null;
  return m[3] ? `/api/avatars/login/${m[3]}?s=${size}` : `/api/avatars/${m[1]}/${m[2]}?s=${size}`;
}
