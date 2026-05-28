import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { runThudCodexStatus } from "./thud-sh-status";

const originalPane = process.env.TMUX_PANE;
const originalProcRoot = process.env.THUD_PROC_ROOT;
let procRoot: string | undefined;

describe("runThudCodexStatus", () => {
  afterEach(async () => {
    mock.restore();

    if (originalPane === undefined) {
      delete process.env.TMUX_PANE;
    } else {
      process.env.TMUX_PANE = originalPane;
    }

    if (originalProcRoot === undefined) {
      delete process.env.THUD_PROC_ROOT;
    } else {
      process.env.THUD_PROC_ROOT = originalProcRoot;
    }

    if (procRoot) {
      await rm(procRoot, { force: true, recursive: true });
      procRoot = undefined;
    }
  });

  test("marks Codex permission requests as waiting", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();

    await runStatus("PermissionRequest", shell);

    expect(statuses(shell.calls)).toEqual(["waiting"]);
    expect(shell.calls[0]).toContain("@thud_sh_tool codex");
    expect(shell.calls[0]).toContain("@thud_sh_status_updated_at 1710000000");
    expect(shell.calls[0]).toContain("set-option -pu -t %1 @thud_sh_status_label");
  });

  test("maps Codex lifecycle hooks to running and idle", async () => {
    process.env.TMUX_PANE = "%1";
    const shell = mockShell();

    await runStatus("SessionStart", shell);
    await runStatus("UserPromptSubmit", shell);
    await runStatus("PreToolUse", shell);
    await runStatus("PostToolUse", shell);
    await runStatus("Stop", shell);

    expect(statuses(shell.calls)).toEqual(["idle", "running", "running", "running", "idle"]);
  });

  test("ignores unknown events and missing panes", async () => {
    const shell = mockShell();

    delete process.env.TMUX_PANE;
    await runStatus("PermissionRequest", shell);
    process.env.TMUX_PANE = "%1";
    await runStatus("Unknown", shell);

    expect(shell.calls).toEqual([]);
  });

  test("writes Codex owner identity with status updates", async () => {
    process.env.TMUX_PANE = "%1";
    await mockCodexProcessTree("56789");
    const shell = mockShell();

    await runStatus("PermissionRequest", shell);

    expect(shell.calls[0]).toContain(`@thud_sh_owner_pid ${process.pid}`);
    expect(shell.calls[0]).toContain("@thud_sh_owner_start_time 56789");
  });

  test("falls back to parent owner identity when Codex process is not found", async () => {
    process.env.TMUX_PANE = "%1";
    await mockProcessStartTime(process.ppid.toString(), "12345");
    const shell = mockShell();

    await runStatus("PermissionRequest", shell);

    expect(shell.calls[0]).toContain(`@thud_sh_owner_pid ${process.ppid}`);
    expect(shell.calls[0]).toContain("@thud_sh_owner_start_time 12345");
  });

  test("falls back to ps when proc is unavailable", async () => {
    process.env.TMUX_PANE = "%1";
    mockMissingProcRoot();
    const ownerStartTime = "Fri May  8 12:34:56 2026";
    const shell = mockShell();

    spyOn(Bun, "spawn").mockImplementation((command) => {
      const args = Array.isArray(command) ? command : command.cmd;

      if (args[0] === "ps" && args[1] === "-eo") {
        return {
          exited: Promise.resolve(1),
          stderr: "",
          stdout: "",
        } as unknown as ReturnType<typeof Bun.spawn>;
      }

      expect(args).toEqual(["ps", "-p", process.ppid.toString(), "-o", "lstart="]);

      return {
        exited: Promise.resolve(0),
        stderr: "",
        stdout: `${ownerStartTime}\n`,
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    await runStatus("PermissionRequest", shell);

    expect(shell.calls[0]).toContain(`@thud_sh_owner_start_time ${Date.parse(ownerStartTime)}`);
  });
});

async function runStatus(hookEventName: string, shell: { $: unknown }): Promise<void> {
  await runThudCodexStatus({
    $: shell.$ as typeof Bun.$,
    now: () => 1_710_000_000_000,
    readEvent: async () => ({ hook_event_name: hookEventName }),
  });
}

async function mockCodexProcessTree(startTime: string): Promise<void> {
  procRoot = await mkdtemp(join(tmpdir(), "thud-codex-proc-"));
  process.env.THUD_PROC_ROOT = procRoot;

  await writeProcStat(
    process.pid.toString(),
    "codex-linux-x64",
    process.ppid.toString(),
    startTime,
  );
}

async function mockProcessStartTime(pid: string, startTime: string): Promise<void> {
  procRoot = await mkdtemp(join(tmpdir(), "thud-codex-proc-"));
  process.env.THUD_PROC_ROOT = procRoot;

  await writeProcStat(pid, "bash", "1", startTime);
}

async function writeProcStat(
  pid: string,
  name: string,
  ppid: string,
  startTime: string,
): Promise<void> {
  if (!procRoot) {
    throw new Error("proc root was not initialized");
  }

  const processPath = join(procRoot, pid);

  await mkdir(processPath, { recursive: true });
  await writeFile(join(processPath, "stat"), procStat(pid, name, ppid, startTime), "utf8");
}

function mockMissingProcRoot(): void {
  procRoot = join(tmpdir(), `thud-codex-missing-proc-${process.pid}-${Date.now()}`);
  process.env.THUD_PROC_ROOT = procRoot;
}

function procStat(pid: string, name: string, ppid: string, startTime: string): string {
  const fields = ["S", ppid, ...Array(17).fill("0"), startTime];

  return `${pid} (${name}) ${fields.join(" ")}`;
}

function mockShell(): { calls: string[]; $: unknown } {
  const calls: string[] = [];

  return {
    calls,
    $(strings: TemplateStringsArray, ...values: unknown[]) {
      let command = strings[0] ?? "";

      for (let i = 0; i < values.length; i++) {
        command += String(values[i]) + (strings[i + 1] ?? "");
      }

      calls.push(command);

      return {
        quiet: async () => {},
      };
    },
  };
}

function statuses(calls: string[]): string[] {
  return calls.flatMap((call) => {
    const match = call.match(/@thud_sh_status\s+(\S+)/);

    return match?.[1] ? [match[1]] : [];
  });
}
