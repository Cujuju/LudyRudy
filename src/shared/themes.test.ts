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

  it.each(THEMES)('keeps placeholders and field hints readable in $id', ({ palette }) => {
    const WCAG_NORMAL_TEXT_CONTRAST = 4.5;
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/../g)!.map((value) => Number.parseInt(value, 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      const [red, green, blue] = channels;
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    for (const [foreground, background] of [[palette.text, palette.input], [palette.soft, palette.raised]] as const) {
      const brighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      expect((brighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(WCAG_NORMAL_TEXT_CONTRAST);
    }
  });
});
