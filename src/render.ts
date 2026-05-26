import { homedir } from "node:os";
import { RGBA, StyledText, bold, fg, type TextChunk } from "@opentui/core";
import {
  sessionStatusSummary,
  statusCircle,
  statusColor,
  statusElapsedLabel,
  statusLabel,
} from "./integration-status";
import { paneContextTitle } from "./pane-display";
import type { TmuxPane, TmuxPaneIntegrationStatus, TmuxSession } from "./tmux";

const palette = {
  magenta: 5,
  cyan: 6,
  gitDirty: 5,
  brightCyan: 14,
  gray: 8,
  selectedBg: 235,
} as const;
const rowLeftGutterWidth = 2;
const rowRightGutterWidth = 2;

export type RenderTheme = {
  highlightSelected?: boolean;
  now?: Date;
  selectedBg?: RGBA;
  selectedPaneId?: string;
  textMutedFg?: RGBA;
  width?: number;
};

export type SessionLineRange = {
  start: number;
  end: number;
};

export function renderLoading(): string {
  return renderMessage("Loading tmux sessions...");
}

export function renderMessage(message: string): string {
  return message;
}

export function renderNoSessions(): string {
  return renderMessage("No tmux sessions running.");
}

export function renderSessions(
  sessions: TmuxSession[],
  selectedSessionId?: string,
  theme: RenderTheme = {},
): StyledText {
  const selectedBg = theme.selectedBg ?? RGBA.fromIndex(palette.selectedBg);
  const textMutedFg = theme.textMutedFg ?? RGBA.fromIndex(palette.gray);

  return new StyledText(
    sessions.flatMap((session, index) => [
      textChunk(index === 0 ? "" : "\n\n"),
      ...renderSession(
        session,
        selectedSessionId,
        theme.highlightSelected === true,
        theme.selectedPaneId,
        selectedBg,
        textMutedFg,
        theme.now,
        theme.width,
      ),
    ]),
  );
}

export function sessionLineRange(
  sessions: TmuxSession[],
  sessionId: string | undefined,
): SessionLineRange | undefined {
  let start = 0;

  for (const session of sessions) {
    const end = start + sessionLineCount(session);

    if (session.id === sessionId) {
      return { start, end };
    }

    start = end + 1;
  }

  return undefined;
}

export function paneLineRange(
  sessions: TmuxSession[],
  sessionId: string | undefined,
  paneId: string | undefined,
): SessionLineRange | undefined {
  if (paneId === undefined) {
    return undefined;
  }

  let sessionStart = 0;

  for (const session of sessions) {
    const sessionEnd = sessionStart + sessionLineCount(session);

    if (session.id === sessionId) {
      let start = sessionStart + 1 + (formatSessionMetadata(session) ? 1 : 0);
      const hasWindowLabels = session.windows.length > 1;

      for (const window of session.windows) {
        if (hasWindowLabels) {
          start += 1;
        }

        for (const pane of window.panes) {
          const end = start + 1 + (paneContextTitle(pane) ? 1 : 0);

          if (pane.id === paneId) {
            return { start, end };
          }

          start = end;
        }
      }

      return undefined;
    }

    sessionStart = sessionEnd + 1;
  }

  return undefined;
}

export function sessionsLineCount(sessions: TmuxSession[]): number {
  if (sessions.length === 0) {
    return 0;
  }

  return sessions.reduce(
    (lines, session, index) => lines + sessionLineCount(session) + (index === 0 ? 0 : 1),
    0,
  );
}

export function scrollLineRangeIntoView(
  scrollY: number,
  viewportHeight: number,
  totalLines: number,
  range: SessionLineRange | undefined,
): number {
  const maxScrollY = Math.max(0, totalLines - Math.max(1, viewportHeight));
  let nextScrollY = Math.min(Math.max(0, scrollY), maxScrollY);

  if (!range || viewportHeight <= 0) {
    return nextScrollY;
  }

  if (range.start < nextScrollY) {
    nextScrollY = range.start;
  } else if (range.end - range.start > viewportHeight) {
    nextScrollY = range.start;
  } else if (range.end > nextScrollY + viewportHeight) {
    nextScrollY = range.end - viewportHeight;
  }

  return Math.min(Math.max(0, nextScrollY), maxScrollY);
}

function sessionLineCount(session: TmuxSession): number {
  const hasWindowLabels = session.windows.length > 1;

  return session.windows.reduce(
    (count, window) =>
      count +
      (hasWindowLabels ? 1 : 0) +
      window.panes.reduce((paneCount, pane) => paneCount + 1 + (paneContextTitle(pane) ? 1 : 0), 0),
    1 + (formatSessionMetadata(session) ? 1 : 0),
  );
}

function renderSession(
  session: TmuxSession,
  selectedSessionId: string | undefined,
  highlightSelected: boolean,
  selectedPaneId: string | undefined,
  selectedBg: RGBA,
  textMutedFg: RGBA,
  now: Date | undefined,
  width: number | undefined,
): TextChunk[] {
  const headerText = session.path
    ? formatPathHeader(session, sessionHeaderContentWidth(width))
    : formatSessionLabel(session);
  const header = session.path
    ? headerText
    : fitMiddle(headerText, sessionHeaderContentWidth(width));
  const sessionStatus = sessionStatusSummary(session);
  const isSelectedSession = session.id === selectedSessionId;
  const isHighlightedSession = highlightSelected && isSelectedSession;
  const sessionAccentFg = sessionStatus
    ? statusColor(sessionStatus.status, textMutedFg)
    : RGBA.fromIndex(palette.cyan);
  const chunks: TextChunk[] = [
    renderSessionHeader(
      header,
      session,
      isHighlightedSession,
      sessionStatus?.status,
      sessionAccentFg,
    ),
    ...renderSessionMetadata(session, textMutedFg, width),
  ];

  const showWindowLabels = session.windows.length > 1;

  session.windows.forEach((window) => {
    const selectedPaneFg = sessionStatus ? sessionAccentFg : RGBA.fromIndex(palette.brightCyan);
    const hasSelectedPane =
      isSelectedSession && window.panes.some((pane) => pane.id === selectedPaneId);
    const activePane = window.active ? window.panes.find((pane) => pane.active) : undefined;
    const activePaneFg =
      session.attached && activePane
        ? activePaneWindowLabelFg(session, activePane, sessionAccentFg)
        : undefined;
    const windowLabelFg = hasSelectedPane ? selectedPaneFg : activePaneFg;

    if (showWindowLabels) {
      const label = fitMiddle(`${window.index}:${window.name}`, windowLabelContentWidth(width));

      chunks.push(
        windowLabelFg ? bold(fg(windowLabelFg)(`\n${label}`)) : muted(`\n${label}`, textMutedFg),
      );
    }

    window.panes.forEach((pane, paneIndex) => {
      const isSelectedPane = isSelectedSession && pane.id === selectedPaneId;
      const branch = windowPaneBranch(window.panes.length, paneIndex);
      const rowChunks = [
        muted("\n", textMutedFg),
        isSelectedPane ? fg(selectedPaneFg)("▶─") : muted(branch, textMutedFg),
        ...renderPaneName(
          pane,
          session.attached && window.active && pane.active,
          isSelectedPane && sessionStatus ? sessionAccentFg : undefined,
          session.attached && window.active && pane.active && !session.sshAttached && !pane.ssh
            ? sessionAccentFg
            : undefined,
          session.sshAttached,
          textMutedFg,
          paneIndex < window.panes.length - 1,
          now,
          width,
        ),
      ];

      chunks.push(...rowChunks);
    });
  });

  return sessionBlock(
    chunks,
    isHighlightedSession,
    session.attached,
    session.attached ? sessionAccentFg : undefined,
    selectedBg,
    textMutedFg,
    width,
  );
}

function renderSessionMetadata(
  session: TmuxSession,
  textMutedFg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const metadata = fitOptional(formatSessionMetadata(session), metadataContentWidth(width));

  return metadata ? renderGitStatus(metadata, session.gitDirty, textMutedFg) : [];
}

function sessionHeaderContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 0);
}

function metadataContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 0);
}

function windowLabelContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 0);
}

function rowContentWidth(
  width: number | undefined,
  leftContentPrefixWidth: number,
): number | undefined {
  if (width === undefined) {
    return undefined;
  }

  return Math.max(0, width - rowLeftGutterWidth - leftContentPrefixWidth - rowRightGutterWidth);
}

function formatPath(path: string): string {
  const home = homedir();

  if (path === home) {
    return "~";
  }

  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }

  return path;
}

function formatSessionMetadata(session: TmuxSession): string | undefined {
  const branch = formatBranch(session);

  if (!session.path) {
    return branch;
  }

  return branch;
}

function formatSessionLabel(session: TmuxSession): string {
  return `${session.name}${session.sshAttached ? " <ssh>" : ""}`;
}

function formatPathHeader(session: TmuxSession, width: number | undefined): string {
  const path = formatPath(session.path ?? "");
  const label = formatSessionLabel(session);

  if (width === undefined) {
    return `${path}  ${label}`;
  }

  const gap = "  ";
  const labelReserve = Math.min(label.length, Math.max(0, Math.floor(width / 2)));
  const leftWidth = Math.max(0, width - gap.length - labelReserve);

  if (leftWidth <= 0) {
    return fitPath(path, width);
  }

  const left = fitPath(path, leftWidth);
  const right = fitMiddle(label, Math.max(0, width - gap.length - left.length));
  const padding = " ".repeat(Math.max(gap.length, width - left.length - right.length));

  return `${left}${padding}${right}`;
}

function fitOptional(text: string | undefined, width: number | undefined): string | undefined {
  return text === undefined ? undefined : fitMiddle(text, width);
}

function fitMiddle(text: string, width: number | undefined): string {
  if (width === undefined || text.length <= width) {
    return text;
  }

  const marker = "...";

  if (width <= marker.length) {
    return marker.slice(0, width);
  }

  const prefixLength = Math.ceil((width - marker.length) / 2);
  const suffixLength = width - marker.length - prefixLength;

  return `${text.slice(0, prefixLength)}${marker}${text.slice(text.length - suffixLength)}`;
}

function fitEnd(text: string, width: number | undefined): string {
  if (width === undefined || text.length <= width) {
    return text;
  }

  const marker = "...";

  if (width <= marker.length) {
    return marker.slice(0, width);
  }

  return `${text.slice(0, width - marker.length)}${marker}`;
}

function fitLineEnd(chunks: TextChunk[], width: number | undefined): TextChunk[] {
  if (width === undefined || lineLengthOf(chunks) <= width) {
    return chunks;
  }

  const marker = "...";
  const markerSource = chunks.find((chunk) => chunk.text.length > 0) ?? textChunk(marker);

  if (width <= marker.length) {
    return [{ ...markerSource, text: marker.slice(0, width) }];
  }

  const result: TextChunk[] = [];
  let remaining = width - marker.length;
  let markerChunk = markerSource;

  for (const chunk of chunks) {
    if (chunk.text.length === 0) {
      continue;
    }

    if (remaining <= 0) {
      markerChunk = chunk;
      break;
    }

    if (chunk.text.length <= remaining) {
      result.push(chunk);
      remaining -= chunk.text.length;
      markerChunk = chunk;
      continue;
    }

    result.push({ ...chunk, text: chunk.text.slice(0, remaining) });
    markerChunk = chunk;
    break;
  }

  result.push({ ...markerChunk, text: marker });

  return result;
}

function fitPath(path: string, width: number | undefined): string {
  if (width === undefined || path.length <= width) {
    return path;
  }

  const marker = "...";

  if (width <= marker.length) {
    return marker.slice(0, width);
  }

  const lastSeparatorIndex = path.lastIndexOf("/");
  const suffix = lastSeparatorIndex > 0 ? path.slice(lastSeparatorIndex) : "";

  if (suffix.length > 0 && marker.length + suffix.length >= width) {
    return `${marker}${suffix.slice(marker.length + suffix.length - width)}`;
  }

  const prefixLength = width - marker.length - suffix.length;

  return `${path.slice(0, prefixLength)}${marker}${suffix}`;
}

function formatBranch(session: TmuxSession): string | undefined {
  return session.gitBranch ? `${session.gitBranch}${session.gitDirty ? "*" : ""}` : undefined;
}

function renderGitStatus(
  metadata: string,
  dirty: boolean | undefined,
  textMutedFg: RGBA,
): TextChunk[] {
  const dirtyMarker = dirty && metadata.endsWith("*") ? metadata.slice(-1) : "";
  const branch = dirtyMarker ? metadata.slice(0, -1) : metadata;

  return [
    muted(`\n${branch}`, textMutedFg),
    ...(dirtyMarker ? [terminalFg(palette.gitDirty, dirtyMarker)] : []),
  ];
}

function renderSessionHeader(
  header: string,
  session: TmuxSession,
  isSelected: boolean,
  sessionStatus: TmuxPaneIntegrationStatus | undefined,
  sessionAccentFg: RGBA,
): TextChunk {
  if (session.sshAttached) {
    return bold(terminalFg(palette.magenta, header));
  }

  if (isSelected) {
    return session.attached ? bold(fg(sessionAccentFg)(header)) : active(header);
  }

  if (!session.attached && sessionStatus && isAttentionStatus(sessionStatus)) {
    return fg(sessionAccentFg)(header);
  }

  return session.attached ? bold(fg(sessionAccentFg)(header)) : textChunk(header);
}

function renderPaneName(
  pane: TmuxPane,
  isActive: boolean,
  selectedPaneFg: RGBA | undefined,
  activePaneFg: RGBA | undefined,
  isSshAttachedSession: boolean,
  textMutedFg: RGBA,
  hasFollowingPane: boolean,
  now: Date | undefined,
  width: number | undefined,
): TextChunk[] {
  const paneRow = [
    renderPaneProcessName(pane, isActive, selectedPaneFg, activePaneFg, isSshAttachedSession),
    ...renderStatusPill(pane, textMutedFg, now),
  ];

  return [
    ...fitLineEnd(paneRow, paneNameContentWidth(width)),
    ...renderPaneContext(pane, textMutedFg, hasFollowingPane, width),
  ];
}

function paneNameContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 2);
}

function renderPaneContext(
  pane: TmuxPane,
  textMutedFg: RGBA,
  hasFollowingPane: boolean,
  width: number | undefined,
): TextChunk[] {
  const title = paneContextTitle(pane);
  const prefix = hasFollowingPane ? "│  " : "   ";

  return title
    ? [muted(`\n${prefix}${fitEnd(title, paneContextContentWidth(width))}`, textMutedFg)]
    : [];
}

function paneContextContentWidth(width: number | undefined): number | undefined {
  return rowContentWidth(width, 3);
}

function renderPaneProcessName(
  pane: TmuxPane,
  isActive: boolean,
  selectedPaneFg: RGBA | undefined,
  activePaneFg: RGBA | undefined,
  isSshAttachedSession: boolean,
): TextChunk {
  const name = ` ${pane.processName}`;

  if (selectedPaneFg) {
    return fg(selectedPaneFg)(name);
  }

  if (isActive && activePaneFg) {
    return bold(fg(activePaneFg)(name));
  }

  if (isActive && (isSshAttachedSession || pane.ssh)) {
    return bold(terminalFg(palette.magenta, name));
  }

  return isActive ? active(name) : textChunk(name);
}

function activePaneWindowLabelFg(
  session: TmuxSession,
  pane: TmuxPane,
  sessionAccentFg: RGBA,
): RGBA {
  if (!session.sshAttached && !pane.ssh) {
    return sessionAccentFg;
  }

  return RGBA.fromIndex(palette.magenta);
}

function renderStatusPill(pane: TmuxPane, textMutedFg: RGBA, now: Date | undefined): TextChunk[] {
  const integration = pane.integration;

  if (!integration) {
    return [];
  }

  const label = integration.label ?? statusLabel(integration.status);
  const elapsed = statusElapsedLabel(integration.status, integration.updatedAt, now);
  return [
    textChunk(" "),
    statusCircle(integration.status, textMutedFg),
    muted(` ${elapsed ? `${label} ${elapsed}` : label}`, textMutedFg),
  ];
}

function isAttentionStatus(status: TmuxPaneIntegrationStatus): boolean {
  return status === "idle" || status === "waiting" || status === "error";
}

function active(text: string): TextChunk {
  return bold(terminalFg(palette.cyan, text));
}

function selected(chunk: TextChunk, selectedBg: RGBA): TextChunk {
  return {
    ...chunk,
    bg: selectedBg,
  };
}

function sessionBlock(
  chunks: TextChunk[],
  isSelected: boolean,
  isAttached: boolean,
  sessionAccentFg: RGBA | undefined,
  selectedBg: RGBA,
  textMutedFg: RGBA,
  width: number | undefined,
): TextChunk[] {
  const result: TextChunk[] = [];
  let lineLength = 0;

  startLine();

  chunks.forEach((chunk) => {
    const lines = chunk.text.split("\n");

    lines.forEach((line, index) => {
      if (index > 0) {
        endLine();
        result.push(
          isSelected ? selected({ ...chunk, text: "\n" }, selectedBg) : { ...chunk, text: "\n" },
        );
        startLine();
      }

      if (line) {
        result.push(
          isSelected ? selected({ ...chunk, text: line }, selectedBg) : { ...chunk, text: line },
        );
        lineLength += line.length;
      }
    });
  });

  endLine();

  return result;

  function startLine(): void {
    result.push(sessionBorder(isSelected, isAttached, sessionAccentFg, selectedBg, textMutedFg));
    lineLength = 2;
  }

  function endLine(): void {
    if (!isSelected || width === undefined || lineLength >= width) {
      return;
    }

    result.push(selected(textChunk(" ".repeat(width - lineLength)), selectedBg));
  }
}

function sessionBorder(
  isSelected: boolean,
  isAttached: boolean,
  sessionAccentFg: RGBA | undefined,
  selectedBg: RGBA,
  textMutedFg: RGBA,
): TextChunk {
  const borderFg = isAttached ? (sessionAccentFg ?? RGBA.fromIndex(palette.cyan)) : textMutedFg;
  const chunk = isAttached
    ? bold(fg(borderFg)("▎ "))
    : ({
        __isChunk: true,
        text: "╎ ",
        attributes: 0,
        fg: textMutedFg,
      } satisfies TextChunk);

  return isSelected ? selected(chunk, selectedBg) : chunk;
}

function muted(text: string, textMutedFg: RGBA): TextChunk {
  return fg(textMutedFg)(text);
}

function terminalFg(index: number, text: string): TextChunk {
  return fg(RGBA.fromIndex(index))(text);
}

function lineLengthOf(chunks: TextChunk[]): number {
  return chunks.reduce((length, chunk) => length + chunk.text.length, 0);
}

function windowPaneBranch(paneCount: number, paneIndex: number): string {
  if (paneCount === 1) {
    return "╶─";
  }

  if (paneIndex === 0) {
    return "╭─";
  }

  if (paneIndex === paneCount - 1) {
    return "╰─";
  }

  return "├─";
}

function textChunk(text: string): TextChunk {
  return { __isChunk: true, text, attributes: 0 };
}
