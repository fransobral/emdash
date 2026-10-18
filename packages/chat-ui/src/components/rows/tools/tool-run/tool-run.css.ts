import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

export const toolRunVars = createVariableThemeContract<{ height: number }>({ height: null });

/** Clipped to the measured height so measure/render desync degrades to clipping. */
export const toolRunRoot = style({
  height: toolRunVars.height,
  overflow: 'hidden',
});

export const toolRunLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  border: 0,
  padding: 0,
  background: 'transparent',
  color: vars.fgMuted,
  fontFamily: vars.fontMono,
  fontSize: '13px',
  textAlign: 'left',
  cursor: 'pointer',
  userSelect: 'none',
  minWidth: 0,
  selectors: {
    '&:active': { color: vars.fg },
    '&:focus-visible': { outline: `2px solid ${vars.link}`, outlineOffset: -2, borderRadius: 6 },
  },
});

export const toolRunIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 14,
  height: 14,
  transition: 'transform 150ms ease-out',
});

export const toolRunIconExpanded = style({ transform: 'rotate(90deg)' });
export const toolRunIconDone = style({ color: vars.diffAdded });
export const toolRunIconError = style({ color: vars.fgError });
export const toolRunIconAttention = style({ color: vars.planActive });

export const toolRunLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const toolRunDetails = style({
  display: 'flex',
  flexDirection: 'column',
  paddingTop: 2,
  paddingBottom: 4,
});
