import { RGBA, bold, fg, type TextChunk } from "@opentui/core";
import type { TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const statusPalette = {
  red: 1,
  green: 2,
  brightGreen: 10,
  magenta: 5,
  cyan: 6,
} as const;

const sessionStatusPriority = [
  "waiting",
  "idle",
  "error",
  "unknown",
] as const satisfies readonly TmuxPaneIntegrationStatus[];

export type IntegrationStatusSummary = {
  status: TmuxPaneIntegrationStatus;
  count: number;
};

export function sessionStatusSummary(session: TmuxSession): IntegrationStatusSummary | undefined {
  const counts = new Map<TmuxPaneIntegrationStatus, number>();

  for (const window of session.windows) {
    for (const pane of window.panes) {
      const status = pane.integration?.status;

      if (status) {
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
    }
  }

  for (const status of sessionStatusPriority) {
    const count = counts.get(status);

    if (count) {
      return { status, count };
    }
  }

  return undefined;
}

export function statusCircle(status: TmuxPaneIntegrationStatus, textMutedFg: RGBA): TextChunk {
  switch (status) {
    case "idle":
    case "running":
    case "waiting":
    case "error":
      return bold(fg(statusColor(status, textMutedFg))("●"));
    case "unknown":
      return fg(textMutedFg)("●");
  }
}

export function statusLabel(status: TmuxPaneIntegrationStatus): string {
  switch (status) {
    case "idle":
      return "idle";
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "error":
      return "error";
    case "unknown":
      return "unknown";
  }
}

export function statusElapsedLabel(
  status: TmuxPaneIntegrationStatus,
  updatedAt: Date | undefined,
  now = new Date(),
): string | undefined {
  if (status === "unknown" || !updatedAt) {
    return undefined;
  }

  const elapsedSeconds = Math.floor((now.getTime() - updatedAt.getTime()) / 1000);

  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return undefined;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 1) {
    return undefined;
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  return `${Math.floor(elapsedHours / 24)}d`;
}

export function statusColor(status: TmuxPaneIntegrationStatus, textMutedFg: RGBA): RGBA {
  switch (status) {
    case "idle":
      return RGBA.fromIndex(statusPalette.brightGreen);
    case "running":
      return RGBA.fromIndex(statusPalette.cyan);
    case "waiting":
      return RGBA.fromIndex(statusPalette.magenta);
    case "error":
      return RGBA.fromIndex(statusPalette.red);
    case "unknown":
      return textMutedFg;
  }
}
