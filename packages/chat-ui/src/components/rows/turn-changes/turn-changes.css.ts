import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

export const turnChangesVars = createVariableThemeContract<{ height: number }>({ height: null });

export const turnChangesRoot = style({
  height: turnChangesVars.height,
  boxSizing: 'border-box',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 14,
  borderRadius: vars.radiusXl,
  border: `1px solid ${vars.border}`,
  background: vars.bg1,
  color: 'inherit',
  textAlign: 'left',
  font: 'inherit',
  width: '100%',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${vars.link}`, outlineOffset: 2 },
  },
});

export const turnChangesHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: '20px',
  color: vars.fg,
});

export const turnChangesStat = style({
  fontFamily: vars.fontMono,
  fontSize: '13px',
  fontWeight: 400,
});
export const turnChangesAdded = style({ color: vars.diffAdded });
export const turnChangesRemoved = style({ color: vars.diffDeleted });

export const turnChangesFiles = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: vars.fontMono,
  fontSize: '12px',
  lineHeight: '16px',
  color: vars.fgMuted,
});

export const turnChangesFile = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const turnChangesLink = style({
  fontSize: '13px',
  fontWeight: 500,
  lineHeight: '18px',
  color: vars.link,
});
