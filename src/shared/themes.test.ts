import { describe, expect, it } from 'vitest';
import { darkTheme, resolveTheme, SYSTEM_THEME, THEMES, themeTokens } from './themes';

describe('themes', () => {
  it('resolves System and an unknown preference', () => {
    expect(resolveTheme(SYSTEM_THEME, false).id).toBe('light');
    expect(resolveTheme(SYSTEM_THEME, true).id).toBe('dark');
    expect(resolveTheme('invalid', false).id).toBe('dark');
  });

  it('provides the same token contract across all ten palettes', () => {
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(10);
    const keys = Object.keys(themeTokens(resolveTheme(SYSTEM_THEME, true)));
    for (const theme of THEMES) {
      expect(Object.keys(themeTokens(theme))).toEqual(keys);
      expect(themeTokens(theme)['--color-background']).toBe(theme.palette.background);
      expect(darkTheme(theme).scheme).toBe('dark');
    }
  });
});
