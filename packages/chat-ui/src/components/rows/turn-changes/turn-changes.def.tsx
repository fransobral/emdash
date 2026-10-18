/**
 * TurnChanges — compact-only "N archivos cambiados +A −D → Ver cambios" card.
 *
 * Appended by the flattening pass to a settled turn whose tool calls changed
 * files. Fixed geometry (a capped file list) keeps measure === rendered height.
 */

import { useCommands } from '@components/contexts/CommandsContext';
import { defineUnit } from '@core/units';
import { TURN_CHANGES_COPY, visibleChangeFiles } from '@state/turn-changes-view';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { For, Show } from 'solid-js';
import type { TurnChangesItem } from '@/model';
import {
  turnChangesAdded,
  turnChangesFile,
  turnChangesFiles,
  turnChangesHeader,
  turnChangesLink,
  turnChangesRemoved,
  turnChangesRoot,
  turnChangesStat,
  turnChangesVars,
} from './turn-changes.css';

type TurnChangesLayoutVars = {
  /** Vertical padding (px) on each side plus the 1px border on each side. */
  chromeY: number;
  headerH: number;
  fileH: number;
  fileGap: number;
  linkH: number;
  sectionGap: number;
};

const VARS: TurnChangesLayoutVars = {
  chromeY: 30,
  headerH: 20,
  fileH: 16,
  fileGap: 4,
  linkH: 18,
  sectionGap: 10,
};

function filesBlockH(rows: number, vars: TurnChangesLayoutVars): number {
  return rows * vars.fileH + (rows - 1) * vars.fileGap;
}

export function turnChangesHeight(item: TurnChangesItem, vars: TurnChangesLayoutVars): number {
  const rows = visibleChangeFiles(item.files).rowCount;
  return (
    vars.chromeY +
    vars.headerH +
    vars.sectionGap +
    filesBlockH(rows, vars) +
    vars.sectionGap +
    vars.linkH
  );
}

function TurnChangesRender(props: { data: TurnChangesItem; vars: TurnChangesLayoutVars }) {
  const commands = useCommands();
  const view = () => visibleChangeFiles(props.data.files);
  return (
    <button
      type="button"
      class={turnChangesRoot}
      style={assignInlineVars(
        turnChangesVars,
        pxTokens({ height: turnChangesHeight(props.data, props.vars) })
      )}
      onClick={() => commands().onViewChanges?.({ itemId: props.data.id })}
    >
      <span class={turnChangesHeader}>
        <span>{TURN_CHANGES_COPY.title(props.data.files.length)}</span>
        <span class={turnChangesStat}>
          <span class={turnChangesAdded}>+{props.data.added}</span>{' '}
          <span class={turnChangesRemoved}>−{props.data.removed}</span>
        </span>
      </span>
      <span class={turnChangesFiles}>
        <For each={view().files}>{(file) => <span class={turnChangesFile}>{file.path}</span>}</For>
        <Show when={view().hidden > 0}>
          <span class={turnChangesFile}>{TURN_CHANGES_COPY.more(view().hidden)}</span>
        </Show>
      </span>
      <span class={turnChangesLink}>{TURN_CHANGES_COPY.view} →</span>
    </button>
  );
}

export const turnChangesUnitDef = defineUnit<TurnChangesItem, TurnChangesLayoutVars>({
  kind: 'turn-changes',
  margin: { top: 12, bottom: 8 },
  vars: VARS,
  measure: (data, _ctx, vars) => turnChangesHeight(data, vars),
  Render: (props) => <TurnChangesRender data={props.data} vars={props.vars} />,
});
