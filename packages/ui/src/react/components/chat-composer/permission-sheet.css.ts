import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const sheet = style({
  borderTopLeftRadius: '1.75rem',
  borderTopRightRadius: '1.75rem',
  borderTop: `1px solid ${vars.border}`,
  padding: '0.625rem 1.25rem',
  paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))',
  maxHeight: '90dvh',
  overflowY: 'auto',
  gap: '1.125rem',
});

export const grabber = style({
  alignSelf: 'center',
  width: '2.5rem',
  height: '0.25rem',
  borderRadius: '0.125rem',
  backgroundColor: `color-mix(in srgb, ${vars.foreground} 22%, transparent)`,
  flexShrink: 0,
});

export const header = style({ display: 'flex', alignItems: 'center', gap: '0.75rem' });

export const shield = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '2.5rem',
  height: '2.5rem',
  borderRadius: '0.75rem',
  backgroundColor: vars.surfaceWarning,
  color: vars.surfaceWarningForeground,
});

export const titles = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.125rem',
  minWidth: 0,
});

export const title = style({
  margin: 0,
  fontSize: '1.0625rem',
  fontWeight: 600,
  lineHeight: 1.25,
  color: vars.foreground,
});

export const subtitle = style({
  fontSize: '0.8125rem',
  color: vars.foregroundMuted,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const counter = style({ opacity: 0.7 });

export const command = style({
  margin: 0,
  maxHeight: '30dvh',
  overflow: 'auto',
  padding: '0.875rem',
  borderRadius: '0.875rem',
  border: `1px solid ${vars.border}`,
  backgroundColor: `color-mix(in srgb, ${vars.foreground} 5%, transparent)`,
  color: vars.surfaceWarningForeground,
  fontFamily: tokenVars.fontMono,
  fontSize: '0.8125rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const reason = style({ display: 'flex', flexDirection: 'column', gap: '0.375rem' });

export const reasonLabel = style({
  fontSize: '0.75rem',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: vars.foregroundMuted,
});

export const reasonText = style({
  margin: 0,
  fontSize: '0.875rem',
  lineHeight: 1.5,
  color: vars.foreground,
});

export const actions = style({ display: 'flex', flexDirection: 'column', gap: '0.625rem' });

export const approveButton = style({
  height: '3.25rem',
  width: '100%',
  borderRadius: '1rem',
  fontSize: '1rem',
  fontWeight: 600,
});

export const secondaryButton = style({
  height: '3.25rem',
  width: '100%',
  borderRadius: '1rem',
  fontSize: '0.9375rem',
});

export const rejectButton = style({
  height: '3rem',
  width: '100%',
  borderRadius: '1rem',
  fontSize: '0.9375rem',
  fontWeight: 500,
});

export const optionNote = style({
  marginLeft: '0.375rem',
  fontFamily: tokenVars.fontMono,
  fontSize: '0.8125rem',
  opacity: 0.8,
});
