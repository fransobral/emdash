import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';
// Colocated chip-class styles — global selectors for TipTap-serialized HTML.
import './chip-classes.css';

export const editorWrapper = style({
  position: 'relative',
  width: '100%',
});

export const editorContent = style({
  width: '100%',
  outline: 'none',
});

export const editorPlaceholder = style({
  pointerEvents: 'none',
  position: 'absolute',
  top: 0,
  left: 0,
  fontSize: tokenVars.textSm,
  lineHeight: 1.4,
  userSelect: 'none',
  color: vars.foregroundPassive,
  // 16px on phones: iOS Safari zooms the page when focusing smaller text.
  '@media': {
    'screen and (max-width: 47.9375rem)': {
      fontSize: '1rem',
      lineHeight: 1.5,
      // One line with an ellipsis: the editor is one line tall until typed into,
      // so a wrapped placeholder showed a second line sliced in half.
      right: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
});

// These classes are assigned via TipTap editorProps.attributes.class
export const promptEditorContentClass = style({
  outline: 'none',
  fontSize: tokenVars.textSm,
  lineHeight: 1.4,
  color: vars.foreground,
  minHeight: '1.25rem',
  // 16px on phones: iOS Safari zooms the page when focusing smaller text.
  '@media': {
    'screen and (max-width: 47.9375rem)': { fontSize: '1rem', lineHeight: 1.5 },
  },
});
