/**
 * PermissionSheet — mobile bottom sheet that asks the user to approve an ACP
 * permission request.
 *
 * Buttons map onto the options the agent actually returned (see
 * `mapPermissionOptions`); an action with no matching option is not rendered.
 * It is a modal dialog (focus trap, Escape, labelled by its title). Dismissing
 * it does not answer the request: the composer falls back to the inline
 * PermissionBand so the request is never lost.
 */

import { Button } from '@react/primitives/button';
import { Sheet } from '@react/primitives/sheet';
import { cx } from '@styles/utilities/cx';
import { ShieldAlertIcon } from 'lucide-react';
import * as React from 'react';
import type { ComposerPermissionRequest } from './permission-band';
import { mapPermissionOptions, permissionSheetTitle } from './permission-options';
import { composerThemeScope } from './composer-contract.css';
import * as styles from './permission-sheet.css';

export interface PermissionSheetProps {
  request: ComposerPermissionRequest;
  /** Total pending count including this one. */
  queueCount?: number;
  open: boolean;
  /** Dismissal (swipe, Escape, backdrop). Does not answer the request. */
  onDismiss: () => void;
  /** Called with the chosen optionId. */
  onResolve: (optionId: string) => void;
  /** Called after a reject so the host can focus the composer for an explanation. */
  onRejectAndExplain?: () => void;
}

export function PermissionSheet({
  request,
  queueCount = 1,
  open,
  onDismiss,
  onResolve,
  onRejectAndExplain,
}: PermissionSheetProps) {
  const choices = React.useMemo(() => mapPermissionOptions(request.options), [request.options]);
  const approveRef = React.useRef<HTMLButtonElement>(null);
  const subtitle = [request.projectName, request.branchName].filter(Boolean).join(' · ');

  return (
    <Sheet.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      swipeDirection="down"
    >
      <Sheet.Content
        side="bottom"
        className={cx(composerThemeScope, styles.sheet)}
        initialFocus={approveRef}
        data-testid="permission-sheet"
      >
        <span className={styles.grabber} aria-hidden="true" />

        <div className={styles.header}>
          <span className={styles.shield} aria-hidden="true">
            <ShieldAlertIcon width={20} height={20} />
          </span>
          <div className={styles.titles}>
            <Sheet.Title className={styles.title}>
              {permissionSheetTitle(request.agentName, request.actionKind)}
            </Sheet.Title>
            {(subtitle || queueCount > 1) && (
              <span className={styles.subtitle}>
                {subtitle}
                {queueCount > 1 && (
                  <span className={styles.counter}>
                    {subtitle ? ' · ' : ''}1 de {queueCount}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {request.command ? (
          <pre className={styles.command} tabIndex={0} aria-label="Acción solicitada">
            {request.command}
          </pre>
        ) : null}

        {request.reason ? (
          <div className={styles.reason}>
            <span className={styles.reasonLabel}>Por qué</span>
            <p className={styles.reasonText}>{request.reason}</p>
          </div>
        ) : null}

        <div className={styles.actions}>
          {choices.approve && (
            <Button
              ref={approveRef}
              variant="primary"
              className={styles.approveButton}
              onClick={() => onResolve(choices.approve!.optionId)}
            >
              Aprobar
            </Button>
          )}
          {choices.approveAlways && (
            <Button
              variant="secondary"
              className={styles.secondaryButton}
              onClick={() => onResolve(choices.approveAlways!.optionId)}
            >
              Aprobar siempre
              <span className={styles.optionNote}>{choices.approveAlways.name}</span>
            </Button>
          )}
          {choices.other.map((option) => (
            <Button
              key={option.optionId}
              variant="secondary"
              className={styles.secondaryButton}
              onClick={() => onResolve(option.optionId)}
            >
              {option.name}
            </Button>
          ))}
          {choices.reject && (
            <Button
              variant="ghost"
              tone="destructive"
              className={styles.rejectButton}
              onClick={() => {
                onResolve(choices.reject!.optionId);
                onRejectAndExplain?.();
              }}
            >
              Rechazar y explicar
            </Button>
          )}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  );
}
