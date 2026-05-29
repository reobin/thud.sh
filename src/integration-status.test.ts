import { describe, expect, test } from "bun:test";
import { sessionStatusSummary, statusElapsedLabel } from "./integration-status";
import type { TmuxSession } from "./tmux";

describe("integration status", () => {
  test("summarizes the highest priority session status", () => {
    const summary = sessionStatusSummary(
      session({
        windows: [
          window({
            panes: [
              pane({ integration: { tool: "opencode", status: "running" } }),
              pane({ integration: { tool: "opencode", status: "error" } }),
            ],
          }),
          window({
            panes: [
              pane({ integration: { tool: "opencode", status: "idle" } }),
              pane({ integration: { tool: "opencode", status: "waiting" } }),
              pane({ integration: { tool: "opencode", status: "waiting" } }),
            ],
          }),
        ],
      }),
    );

    expect(summary).toEqual({ status: "waiting", count: 2 });
  });

  test("does not summarize running-only sessions", () => {
    const summary = sessionStatusSummary(
      session({
        windows: [
          window({ panes: [pane({ integration: { tool: "opencode", status: "running" } })] }),
        ],
      }),
    );

    expect(summary).toBeUndefined();
  });

  test("formats status elapsed time compactly", () => {
    const now = new Date("2026-05-07T12:00:00.000Z");

    expect(
      statusElapsedLabel("running", new Date("2026-05-07T11:59:18.000Z"), now),
    ).toBeUndefined();
    expect(statusElapsedLabel("running", new Date("2026-05-07T11:58:18.000Z"), now)).toBe("1m");
    expect(statusElapsedLabel("waiting", new Date("2026-05-07T11:56:30.000Z"), now)).toBe("3m");
    expect(statusElapsedLabel("idle", new Date("2026-05-07T09:40:00.000Z"), now)).toBe("2h");
    expect(statusElapsedLabel("error", new Date("2026-05-03T12:00:00.000Z"), now)).toBe("4d");
  });

  test("omits elapsed time for unknown, missing, and future timestamps", () => {
    const now = new Date("2026-05-07T12:00:00.000Z");

    expect(
      statusElapsedLabel("unknown", new Date("2026-05-07T11:59:18.000Z"), now),
    ).toBeUndefined();
    expect(statusElapsedLabel("running", undefined, now)).toBeUndefined();
    expect(
      statusElapsedLabel("running", new Date("2026-05-07T12:00:01.000Z"), now),
    ).toBeUndefined();
  });
});

function session(overrides: Partial<TmuxSession> = {}): TmuxSession {
  return {
    id: "$1",
    name: "default",
    windows: [],
    attached: false,
    sshAttached: false,
    createdAt: new Date(0),
    activityAt: new Date(0),
    ...overrides,
  };
}

function window(overrides: Partial<TmuxSession["windows"][number]> = {}) {
  return {
    id: "@1",
    index: 1,
    name: "default",
    active: true,
    panes: [],
    ...overrides,
  };
}

function pane(overrides: Partial<TmuxSession["windows"][number]["panes"][number]> = {}) {
  return {
    id: "%1",
    index: 1,
    active: true,
    command: "bash",
    title: "bash",
    processName: "bash",
    ssh: false,
    ...overrides,
  };
}
