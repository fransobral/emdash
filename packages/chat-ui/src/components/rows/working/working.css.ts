import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';

const pulse = keyframes({
  '0%, 100%': { boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 18%, transparent)' },
  '50%': { boxShadow: '0 0 0 5px color-mix(in srgb, currentColor 8%, transparent)' },
});

export const workingRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: vars.fgMuted,
  fontSize: '13px',
});

export const workingDot = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'currentColor',
  color: vars.link,
  animation: `${pulse} 1.6s ease-in-out infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

export const workingElapsed = style({
  fontFamily: vars.fontMono,
  color: vars.fgPassive,
});
