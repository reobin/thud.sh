#!/usr/bin/env bun
import { access, readFile } from "node:fs/promises";

type CodexHookEvent = {
  hook_event_name?: string;
  transcript_path?: string | null;
  turn_id?: string;
};

type ProcessIdentity = {
  pid: string;
  startTime: string;
};
type ProcessStat = ProcessIdentity & {
  ppid: string;
  name: string;
};
type CodexStatusContext = {
  $: typeof Bun.$;
  now?: () => number;
  readEvent?: () => Promise<CodexHookEvent>;
  startPermissionRequestWatcher?: (request: PermissionRequestWatchRequest) => void;
};
type PermissionRequestWatchRequest = {
  pane: string;
  owner: ProcessIdentity;
  statusUpdatedAt: string;
  transcriptPath: string;
  turnId: string;
};

const tool = "codex";
const thudRefreshChannel = "thud-sh-sessions";
const runningStartedAtOption = "@thud_sh_running_started_at";
const permissionRequestWatchArg = "--watch-permission-request";
const permissionRequestWatchPollMs = 500;
const permissionRequestWatchTimeoutMs = 24 * 60 * 60 * 1000;

const statusByHookEvent = new Map([
  ["SessionStart", "idle"],
  ["UserPromptSubmit", "running"],
  ["PreToolUse", "running"],
  ["PermissionRequest", "waiting"],
  ["PostToolUse", "running"],
  ["Stop", "idle"],
]);

export async function runThudCodexStatus({
  $,
  now = Date.now,
  readEvent = readHookEvent,
  startPermissionRequestWatcher = startDetachedPermissionRequestWatcher,
}: CodexStatusContext): Promise<void> {
  const pane = process.env.TMUX_PANE;
  const event = await readEvent();
  const hookEventName = event.hook_event_name ?? "";
  const status = statusByHookEvent.get(hookEventName);

  if (!pane || !status) {
    return;
  }

  const owner = (await codexOwnerIdentity(process.pid.toString())) ?? {
    pid: process.ppid.toString(),
    startTime: (await processStartTime(process.ppid.toString())) ?? "",
  };
  const nowSeconds = Math.floor(now() / 1000).toString();
  const runningStartedAt =
    status === "running"
      ? event.hook_event_name === "UserPromptSubmit"
        ? nowSeconds
        : (parseTimestamp(await paneOption($, pane, runningStartedAtOption)) ?? nowSeconds)
      : undefined;
  const updatedAt = runningStartedAt ?? nowSeconds;

  if (runningStartedAt) {
    await writePaneStatus($, {
      owner,
      pane,
      runningStartedAt,
      status,
      updatedAt,
    });
    return;
  }

  if (status === "idle") {
    await writePaneStatus($, {
      clearRunningStartedAt: true,
      owner,
      pane,
      status,
      updatedAt,
    });
    return;
  }

  await writePaneStatus($, {
    owner,
    pane,
    status,
    turnId: event.turn_id,
    updatedAt,
  });

  if (hookEventName === "PermissionRequest" && event.transcript_path && event.turn_id) {
    startPermissionRequestWatcher({
      owner,
      pane,
      statusUpdatedAt: updatedAt,
      transcriptPath: event.transcript_path,
      turnId: event.turn_id,
    });
  }
}

if (import.meta.main) {
  if (Bun.argv[2] === permissionRequestWatchArg) {
    await watchCodexPermissionRequest({
      $: Bun.$,
      owner: {
        pid: Bun.argv[5] ?? "",
        startTime: Bun.argv[6] ?? "",
      },
      pane: Bun.argv[3] ?? "",
      statusUpdatedAt: Bun.argv[4] ?? "",
      transcriptPath: Bun.argv[7] ?? "",
      turnId: Bun.argv[8] ?? "",
    });
  } else {
    await runThudCodexStatus({ $: Bun.$ });
  }
}

async function writePaneStatus(
  $: typeof Bun.$,
  {
    clearRunningStartedAt,
    owner,
    pane,
    runningStartedAt,
    status,
    turnId,
    updatedAt,
  }: {
    clearRunningStartedAt?: boolean;
    owner: ProcessIdentity;
    pane: string;
    runningStartedAt?: string;
    status: string;
    turnId?: string;
    updatedAt: string;
  },
): Promise<void> {
  if (runningStartedAt) {
    await $`tmux set-option -p -t ${pane} @thud_sh_tool ${tool} \; set-option -p -t ${pane} @thud_sh_status ${status} \; set-option -p -t ${pane} @thud_sh_status_updated_at ${updatedAt} \; set-option -p -t ${pane} ${runningStartedAtOption} ${runningStartedAt} \; set-option -p -t ${pane} @thud_sh_owner_pid ${owner.pid} \; set-option -p -t ${pane} @thud_sh_owner_start_time ${owner.startTime} \; set-option -pu -t ${pane} @thud_sh_status_label \; wait-for -S ${thudRefreshChannel}`.quiet();
  } else if (clearRunningStartedAt) {
    await $`tmux set-option -p -t ${pane} @thud_sh_tool ${tool} \; set-option -p -t ${pane} @thud_sh_status ${status} \; set-option -p -t ${pane} @thud_sh_status_updated_at ${updatedAt} \; set-option -pu -t ${pane} ${runningStartedAtOption} \; set-option -p -t ${pane} @thud_sh_owner_pid ${owner.pid} \; set-option -p -t ${pane} @thud_sh_owner_start_time ${owner.startTime} \; set-option -pu -t ${pane} @thud_sh_status_label \; wait-for -S ${thudRefreshChannel}`.quiet();
  } else {
    await $`tmux set-option -p -t ${pane} @thud_sh_tool ${tool} \; set-option -p -t ${pane} @thud_sh_status ${status} \; set-option -p -t ${pane} @thud_sh_status_updated_at ${updatedAt} \; set-option -p -t ${pane} @thud_sh_owner_pid ${owner.pid} \; set-option -p -t ${pane} @thud_sh_owner_start_time ${owner.startTime} \; set-option -pu -t ${pane} @thud_sh_status_label \; wait-for -S ${thudRefreshChannel}`.quiet();
  }

  if (turnId) {
    await $`tmux set-option -p -t ${pane} @thud_sh_turn_id ${turnId}`.quiet();
    return;
  }

  await $`tmux set-option -pu -t ${pane} @thud_sh_turn_id`.quiet();
}

function startDetachedPermissionRequestWatcher(request: PermissionRequestWatchRequest): void {
  const runtime = Bun.argv[0] || process.execPath;
  const script = Bun.argv[1];

  if (!runtime || !script) {
    return;
  }

  try {
    const process = Bun.spawn(
      [
        runtime,
        script,
        permissionRequestWatchArg,
        request.pane,
        request.statusUpdatedAt,
        request.owner.pid,
        request.owner.startTime,
        request.transcriptPath,
        request.turnId,
      ],
      {
        detached: true,
        stderr: "ignore",
        stdin: "ignore",
        stdout: "ignore",
      },
    );

    process.unref();
  } catch {
    return;
  }
}

export async function watchCodexPermissionRequest({
  $,
  owner,
  pane,
  statusUpdatedAt,
  transcriptPath,
  turnId,
}: PermissionRequestWatchRequest & { $: typeof Bun.$ }): Promise<void> {
  if (!pane || !statusUpdatedAt || !transcriptPath || !turnId) {
    return;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < permissionRequestWatchTimeoutMs) {
    if (!(await paneStillWaitingForPermissionRequest(pane, turnId, statusUpdatedAt))) {
      return;
    }

    if (await transcriptHasTurnAborted(transcriptPath, turnId)) {
      await writePaneStatus($, {
        clearRunningStartedAt: true,
        owner,
        pane,
        status: "idle",
        updatedAt: Math.floor(Date.now() / 1000).toString(),
      });
      return;
    }

    await sleep(permissionRequestWatchPollMs);
  }
}

async function paneStillWaitingForPermissionRequest(
  pane: string,
  turnId: string,
  statusUpdatedAt: string,
): Promise<boolean> {
  const [currentStatus, currentStatusUpdatedAt, currentTurnId] = await Promise.all([
    tmuxPaneOption(pane, "@thud_sh_status"),
    tmuxPaneOption(pane, "@thud_sh_status_updated_at"),
    tmuxPaneOption(pane, "@thud_sh_turn_id"),
  ]);

  return (
    currentStatus === "waiting" &&
    currentStatusUpdatedAt === statusUpdatedAt &&
    currentTurnId === turnId
  );
}

async function tmuxPaneOption(pane: string, option: string): Promise<string | undefined> {
  let tmuxProcess: ReturnType<typeof Bun.spawn>;

  try {
    tmuxProcess = Bun.spawn(["tmux", "show-option", "-p", "-v", "-t", pane, option], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch {
    return undefined;
  }

  const [exitCode, stdout] = await Promise.all([
    tmuxProcess.exited,
    new Response(tmuxProcess.stdout as ReadableStream<Uint8Array>).text(),
  ]);

  if (exitCode !== 0) {
    return undefined;
  }

  return stdout.trim() || undefined;
}

export async function transcriptHasTurnAborted(
  transcriptPath: string,
  turnId: string,
): Promise<boolean> {
  let transcript: string;

  try {
    transcript = await readFile(transcriptPath, "utf8");
  } catch {
    return false;
  }

  return transcript.split(/\r?\n/).some((line) => transcriptLineAbortedTurn(line, turnId));
}

function transcriptLineAbortedTurn(line: string, turnId: string): boolean {
  if (!line.trim()) {
    return false;
  }

  try {
    const event = JSON.parse(line) as {
      type?: string;
      payload?: {
        type?: string;
        turn_id?: string;
      };
    };

    return (
      event.type === "event_msg" &&
      event.payload?.type === "turn_aborted" &&
      event.payload.turn_id === turnId
    );
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readHookEvent(): Promise<CodexHookEvent> {
  try {
    return (await Bun.stdin.json()) as CodexHookEvent;
  } catch {
    return {};
  }
}

async function paneOption(
  $: typeof Bun.$,
  pane: string,
  option: string,
): Promise<string | undefined> {
  const value = await $`tmux show-option -pv -t ${pane} ${option}`.nothrow().quiet().text();

  return value.trim() || undefined;
}

function parseTimestamp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return undefined;
  }

  return Number(trimmed) > 0 ? trimmed : undefined;
}

async function codexOwnerIdentity(pid: string): Promise<ProcessIdentity | undefined> {
  return (await procCodexOwnerIdentity(pid)) ?? (await portableCodexOwnerIdentity(pid));
}

async function procCodexOwnerIdentity(pid: string): Promise<ProcessIdentity | undefined> {
  let current = await processStat(pid);
  const seen = new Set<string>();

  while (current && !seen.has(current.pid)) {
    if (isCodexProcess(current.name)) {
      return { pid: current.pid, startTime: current.startTime };
    }

    seen.add(current.pid);
    current = await processStat(current.ppid);
  }

  return undefined;
}

async function processStat(pid: string): Promise<ProcessStat | undefined> {
  try {
    return parseProcessStat(pid, await readFile(`${procStatPath(pid)}`, "utf8"));
  } catch {
    return undefined;
  }
}

function parseProcessStat(pid: string, stat: string): ProcessStat | undefined {
  const openParenIndex = stat.indexOf("(");
  const closeParenIndex = stat.lastIndexOf(")");

  if (openParenIndex < 0 || closeParenIndex < openParenIndex) {
    return undefined;
  }

  const fields = stat
    .slice(closeParenIndex + 1)
    .trim()
    .split(/\s+/);

  return {
    pid,
    ppid: fields[1] ?? "",
    name: stat.slice(openParenIndex + 1, closeParenIndex),
    startTime: fields[19] ?? "",
  };
}

function isCodexProcess(name: string): boolean {
  return name === "codex" || name === "codex-linux-x64" || name === "codex-aarch64";
}

async function portableCodexOwnerIdentity(pid: string): Promise<ProcessIdentity | undefined> {
  if (await isProcRootAvailable()) {
    return undefined;
  }

  const processes = await portableProcessTable();
  let current = processes.get(pid);
  const seen = new Set<string>();

  while (current && !seen.has(current.pid)) {
    if (isCodexProcess(current.name)) {
      return { pid: current.pid, startTime: current.startTime };
    }

    seen.add(current.pid);
    current = processes.get(current.ppid);
  }

  return undefined;
}

async function portableProcessTable(): Promise<Map<string, ProcessStat>> {
  let psProcess: ReturnType<typeof Bun.spawn>;

  try {
    psProcess = Bun.spawn(["ps", "-eo", "pid=,ppid=,comm=,lstart="], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch {
    return new Map();
  }

  const [exitCode, stdout] = await Promise.all([
    psProcess.exited,
    new Response(psProcess.stdout as ReadableStream<Uint8Array>).text(),
  ]);

  if (exitCode !== 0) {
    return new Map();
  }

  return new Map(stdout.trim().split(/\r?\n/).filter(Boolean).flatMap(parsePortableProcess));
}

function parsePortableProcess(line: string): Array<[string, ProcessStat]> {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
  const pid = match?.[1];

  if (!pid) {
    return [];
  }

  return [
    [
      pid,
      {
        pid,
        ppid: match[2] ?? "",
        name: basename(match[3] ?? ""),
        startTime: parsePortableStartTime(match[4]?.trim() ?? "") ?? "",
      },
    ],
  ];
}

async function processStartTime(pid: string): Promise<string | undefined> {
  try {
    const stat = await readFile(`${procStatPath(pid)}`, "utf8");

    return parseProcessStartTime(stat);
  } catch {
    if (await isProcRootAvailable()) {
      return undefined;
    }

    return portableProcessStartTime(pid);
  }
}

async function isProcRootAvailable(): Promise<boolean> {
  return access(procRootPath()).then(
    () => true,
    () => false,
  );
}

async function portableProcessStartTime(pid: string): Promise<string | undefined> {
  let psProcess: ReturnType<typeof Bun.spawn>;

  try {
    psProcess = Bun.spawn(["ps", "-p", pid, "-o", "lstart="], {
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch {
    return undefined;
  }

  const [exitCode, stdout] = await Promise.all([
    psProcess.exited,
    new Response(psProcess.stdout as ReadableStream<Uint8Array>).text(),
  ]);

  if (exitCode !== 0) {
    return undefined;
  }

  return parsePortableStartTime(stdout.trim());
}

function procStatPath(pid: string): string {
  return `${procRootPath()}/${pid}/stat`;
}

function procRootPath(): string {
  return process.env.THUD_PROC_ROOT ?? "/proc";
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function parseProcessStartTime(stat: string): string | undefined {
  const closeParenIndex = stat.lastIndexOf(")");

  if (closeParenIndex < 0) {
    return undefined;
  }

  const fields = stat
    .slice(closeParenIndex + 1)
    .trim()
    .split(/\s+/);

  return fields[19] || undefined;
}

function parsePortableStartTime(startTime: string): string | undefined {
  const parsed = Date.parse(startTime);

  return Number.isFinite(parsed) ? parsed.toString() : undefined;
}
