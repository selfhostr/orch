import { describe, expect, it } from 'vitest';
import { avatarSrc, loginAvatarSrc } from './avatar';

describe('avatarSrc', () => {
  it('points GitHub avatars at the orch server', () => {
    expect(avatarSrc('https://avatars.githubusercontent.com/u/12?v=4')).toBe(
      '/api/avatars/u/12?s=96',
    );
    expect(avatarSrc('https://avatars.githubusercontent.com/in/5', 64)).toBe(
      '/api/avatars/in/5?s=64',
    );
    expect(loginAvatarSrc('octo-cat')).toBe('/api/avatars/login/octo-cat?s=96');
  });
  it('never returns a third-party URL', () => {
    expect(avatarSrc(null)).toBeNull();
    expect(avatarSrc('https://evil.example/u/12')).toBeNull();
    expect(avatarSrc('https://a/x.png')).toBeNull();
  });
});
