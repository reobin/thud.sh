#!/usr/bin/env bun
import { access, readFile } from "node:fs/promises";

type CodexHookEvent = {
  hook_event_name?: string;
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
};

const tool = "codex";
const thudRefreshChannel = "thud-sh-sessions";

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
}: CodexStatusContext): Promise<void> {
  const pane = process.env.TMUX_PANE;
  const event = await readEvent();
  const status = statusByHookEvent.get(event.hook_event_name ?? "");

  if (!pane || !status) {
    return;
  }

  const owner = (await codexOwnerIdentity(process.pid.toString())) ?? {
    pid: process.ppid.toString(),
    startTime: (await processStartTime(process.ppid.toString())) ?? "",
  };
  const updatedAt = Math.floor(now() / 1000).toString();

  await $`tmux set-option -p -t ${pane} @thud_sh_tool ${tool} \; set-option -p -t ${pane} @thud_sh_status ${status} \; set-option -p -t ${pane} @thud_sh_status_updated_at ${updatedAt} \; set-option -p -t ${pane} @thud_sh_owner_pid ${owner.pid} \; set-option -p -t ${pane} @thud_sh_owner_start_time ${owner.startTime} \; set-option -pu -t ${pane} @thud_sh_status_label \; wait-for -S ${thudRefreshChannel}`.quiet();
}

if (import.meta.main) {
  await runThudCodexStatus({ $: Bun.$ });
}

async function readHookEvent(): Promise<CodexHookEvent> {
  try {
    return (await Bun.stdin.json()) as CodexHookEvent;
  } catch {
    return {};
  }
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
