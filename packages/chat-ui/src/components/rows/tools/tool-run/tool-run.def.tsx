/**
 * ToolRun — compact-only summary rows for a run of contiguous tool calls.
 *
 *   ▸ Leyó 4 archivos
 *   ▸ Editó hero.tsx, Hero.module.css
 *   ✓ pnpm build
 *
 * Each line is a tappable disclosure (`data-collapse-id`, handled by ChatRoot's
 * click delegation); expanding it renders the regular detailed rows for that
 * line's tool calls through their native unit defs.
 */

import { useTheme } from '@components/contexts/ThemeContext';
import { IconError, IconShieldAlert } from '@components/primitives/icons';
import { diffUnitDef } from '@components/rows/tools/diff/diff.def';
import { executeUnitDef } from '@components/rows/tools/execute/execute.def';
import { fileOpUnitDef } from '@components/rows/tools/file-op/file-op.def';
import { toolUnitDef } from '@components/rows/tools/tool/tool.def';
import type { MeasureCtx, RenderCtx } from '@core/define';
import type { UnitDef } from '@core/units';
import { defineUnit } from '@core/units';
import type { ToolRunLine } from '@state/tool-run';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import type { JSX } from 'solid-js';
import { For, Show, createMemo } from 'solid-js';
import type { ChatItem } from '@/model';
import {
  toolRunDetails,
  toolRunIcon,
  toolRunIconAttention,
  toolRunIconDone,
  toolRunIconError,
  toolRunIconExpanded,
  toolRunLabel,
  toolRunLine,
  toolRunRoot,
  toolRunVars,
} from './tool-run.css';
import { textShimmer } from '@styles/effects.css';

/** A summary line plus the presentation data of its tool calls, built at segment time. */
export type ToolRunLineData = Omit<ToolRunLine, 'members'> & {
  details: readonly ChatItem[];
};

export type ToolRunData = {
  id: string;
  lines: readonly ToolRunLineData[];
};

export type ToolRunVars = {
  /** Tap-friendly height (px) of one summary line. */
  lineH: number;
  /** Gap (px) between detailed child rows. */
  childGap: number;
  /** Padding (px) around the detail stack of an expanded line. */
  detailsPadY: number;
};

const TOOL_RUN_VARS: ToolRunVars = { lineH: 36, childGap: 4, detailsPadY: 6 };

// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
const DETAIL_DEFS: Record<string, UnitDef<any, any>> = {
  tool: toolUnitDef,
  execute: executeUnitDef,
  diff: diffUnitDef,
  'file-op': fileOpUnitDef,
};

function detailsHeight(line: ToolRunLineData, ctx: MeasureCtx, vars: ToolRunVars): number {
  let h = 2 * vars.detailsPadY;
  line.details.forEach((detail, i) => {
    if (i > 0) h += vars.childGap;
    const def = DETAIL_DEFS[detail.kind];
    h += def ? def.measure(detail, ctx, def.vars ?? {}) : vars.lineH;
  });
  return h;
}

export function toolRunHeight(data: ToolRunData, ctx: MeasureCtx, vars: ToolRunVars): number {
  let h = 0;
  for (const line of data.lines) {
    h += vars.lineH;
    if (ctx.expanded(line.id)) h += detailsHeight(line, ctx, vars);
  }
  return h;
}

function LineIcon(props: { line: ToolRunLineData; expanded: boolean }) {
  return (
    <span
      class={toolRunIcon}
      classList={{
        [toolRunIconExpanded]: props.expanded && !isStatusIcon(props.line),
        [toolRunIconDone]: props.line.kind === 'execute' && props.line.status === 'done',
        [toolRunIconError]: props.line.status === 'error',
        [toolRunIconAttention]: props.line.awaitingPermission,
      }}
      aria-hidden="true"
    >
      <Show
        when={props.line.awaitingPermission}
        fallback={
          <Show
            when={props.line.status === 'error'}
            fallback={
              <Show
                when={props.line.kind === 'execute' && props.line.status === 'done'}
                fallback={<Chevron />}
              >
                <CheckMark />
              </Show>
            }
          >
            <IconError />
          </Show>
        }
      >
        <IconShieldAlert />
      </Show>
    </span>
  );
}

function isStatusIcon(line: ToolRunLineData): boolean {
  return (
    line.awaitingPermission ||
    line.status === 'error' ||
    (line.kind === 'execute' && line.status === 'done')
  );
}

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

function DetailRow(props: { detail: ChatItem; ctx: RenderCtx }) {
  const def = DETAIL_DEFS[props.detail.kind];
  if (!def) return null;
  // oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
  const Renderer = def.Render as (p: { data: ChatItem; ctx: RenderCtx; vars: any }) => JSX.Element;
  return <Renderer data={props.detail} ctx={props.ctx} vars={def.vars ?? {}} />;
}

function ToolRunRender(props: { data: ToolRunData; ctx: RenderCtx; vars: ToolRunVars }) {
  const theme = useTheme();
  const totalH = createMemo(() => {
    const mCtx = props.ctx.measureCtx?.();
    return mCtx
      ? toolRunHeight(props.data, mCtx, props.vars)
      : props.data.lines.length * props.vars.lineH;
  });
  // Reading the theme keeps this reactive to typography/epoch changes like sibling rows.
  const isExpanded = (id: string) => (theme(), props.ctx.viewState.isCollapsed(id));

  return (
    <div class={toolRunRoot} style={assignInlineVars(toolRunVars, pxTokens({ height: totalH() }))}>
      <For each={props.data.lines}>
        {(line) => (
          <>
            <button
              type="button"
              class={toolRunLine}
              style={{ height: `${props.vars.lineH}px` }}
              data-collapse-id={line.id}
              aria-expanded={isExpanded(line.id) ? 'true' : 'false'}
            >
              <LineIcon line={line} expanded={isExpanded(line.id)} />
              <span
                class={toolRunLabel}
                classList={{ [textShimmer]: line.status === 'running' && !line.awaitingPermission }}
              >
                {line.label}
              </span>
            </button>
            <Show when={isExpanded(line.id)}>
              <div class={toolRunDetails}>
                <For each={line.details}>
                  {(detail, i) => (
                    <div style={{ 'margin-top': i() > 0 ? `${props.vars.childGap}px` : undefined }}>
                      <DetailRow detail={detail} ctx={props.ctx} />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

export const toolRunUnitDef = defineUnit<ToolRunData, ToolRunVars>({
  kind: 'tool-run',
  margin: { top: 4, bottom: 4 },
  vars: TOOL_RUN_VARS,
  collapseIds: (data) => data.lines.flatMap((line) => [line.id, ...line.details.map((d) => d.id)]),

  estimate(data, ctx, vars): number {
    return data.lines.reduce(
      (h, line) =>
        h +
        vars.lineH +
        (ctx.expanded(line.id) ? line.details.length * 32 + 2 * vars.detailsPadY : 0),
      0
    );
  },

  measure: toolRunHeight,
  Render: ToolRunRender,
});
