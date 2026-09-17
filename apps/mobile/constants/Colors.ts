/**
 * Ported from apps/web/src/app/globals.css's oklch token set (converted to sRGB hex
 * since RN style objects don't accept oklch()). Same decisions, not re-authored —
 * see docs/product/mobile-app-ux-plan-2026-09.md §9 ("a second design system").
 *
 * One deliberate divergence from web: dark is the DEFAULT here (web defaults light).
 * Judging colour/exposure on generated images and video wants a dark surround —
 * see the plan's §5.6. Light still ships as a real, equal option.
 */

const light = {
  background: '#ffffff',
  foreground: '#0a0a0a',
  card: '#ffffff',
  cardForeground: '#0a0a0a',
  primary: '#171717',
  primaryForeground: '#fafafa',
  secondary: '#f5f5f5',
  secondaryForeground: '#171717',
  muted: '#f5f5f5',
  mutedForeground: '#737373',
  accent: '#f5f5f5',
  accentForeground: '#171717',
  destructive: '#e7000b',
  border: '#e5e5e5',
  input: '#e5e5e5',
  ring: '#a1a1a1',
  tint: '#171717',
  tabIconDefault: '#737373',
  tabIconSelected: '#171717',
  text: '#0a0a0a',
};

const dark = {
  background: '#0a0a0a',
  foreground: '#fafafa',
  card: '#171717',
  cardForeground: '#fafafa',
  primary: '#e5e5e5',
  primaryForeground: '#171717',
  secondary: '#262626',
  secondaryForeground: '#fafafa',
  muted: '#262626',
  mutedForeground: '#a1a1a1',
  accent: '#262626',
  accentForeground: '#fafafa',
  destructive: '#ff6467',
  border: 'rgba(255,255,255,0.10)',
  input: 'rgba(255,255,255,0.15)',
  ring: '#737373',
  tint: '#e5e5e5',
  tabIconDefault: '#a1a1a1',
  tabIconSelected: '#e5e5e5',
  text: '#fafafa',
};

export type ColorTokens = typeof light;

export default { light, dark };
