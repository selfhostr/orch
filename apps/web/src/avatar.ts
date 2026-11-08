const HOST = 'avatars.githubusercontent.com';

/**
 * Same-origin URL (served and cached by the orch server) for a GitHub avatar: the browser never
 * contacts GitHub's CDN. Null when the URL is not a GitHub avatar.
 */
export function avatarSrc(avatarUrl: string | null | undefined, size = 96): string | null {
  if (!avatarUrl) return null;
  let u: URL;
  try {
    u = new URL(avatarUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== HOST) return null;
  const m = /^\/(?:(u|in)\/(\d{1,12})|([A-Za-z0-9][A-Za-z0-9-]{0,38}))\/?$/.exec(u.pathname);
  if (!m) return null;
  return m[3] ? `/api/avatars/login/${m[3]}?s=${size}` : `/api/avatars/${m[1]}/${m[2]}?s=${size}`;
}

/** Avatar of a login with no stored URL. */
export function loginAvatarSrc(login: string, size = 96): string | null {
  return avatarSrc(`https://${HOST}/${encodeURIComponent(login)}`, size);
}
