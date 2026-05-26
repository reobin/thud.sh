import { homedir } from "node:os";
import { describe, expect, test } from "bun:test";
import { RGBA, createTextAttributes } from "@opentui/core";
import { renderCommandPanel, renderHelpPanel } from "./command-panel";
import {
  paneLineRange,
  renderLoading,
  renderMessage,
  renderNoSessions,
  renderSessions,
  scrollLineRangeIntoView,
  sessionLineRange,
  sessionsLineCount,
} from "./render";
import { commandPanelBackdropColor, renderShortcutFooter, renderStatusLine } from "./screen";
import type { TmuxSession } from "./tmux";

describe("render", () => {
  test("renders a message", () => {
    expect(renderMessage("Something happened.")).toBe("Something happened.");
  });

  test("renders the loading state", () => {
    expect(renderLoading()).toBe("Loading tmux sessions...");
  });

  test("renders the empty sessions state", () => {
    expect(renderNoSessions()).toBe("No tmux sessions running.");
  });

  test("renders a command panel", () => {
    const output = renderCommandPanel([{ label: "Focus session" }, { label: "Quit" }], 1, {
      width: 36,
    });
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const selectedCommand = output.chunks.find((chunk) => chunk.text === "Quit");
    const selectedBorder = output.chunks.find((chunk) => chunk.text === "▎ ");

    expect(text).toContain("Commands");
    expect(text).toContain("  Focus session");
    expect(text).toContain("▎ Quit");
    expect(text).toContain("j/k select  enter focus  esc close");
    expect(text.split("\n").every((line) => line.length <= 36)).toBe(true);
    expect(selectedCommand?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(selectedCommand?.bg?.slot).toBe(235);
    expect(selectedBorder?.fg?.slot).toBe(14);
  });

  test("fits command panel rows to the content width", () => {
    const output = renderCommandPanel(
      [{ label: "Focus selected session", description: "Switch tmux focus" }, { label: "Quit" }],
      0,
      { width: 12 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("▎ Focus sel");
    expect(text.split("\n").every((line) => line.length <= 12)).toBe(true);
  });

  test("wraps the command panel footer when narrow", () => {
    const output = renderCommandPanel([{ label: "Refresh" }], 0, { width: 12 });
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("j/k select\nenter focus\nesc close");
    expect(text.split("\n").every((line) => line.length <= 12)).toBe(true);
  });

  test("renders a help panel", () => {
    const output = renderHelpPanel({ width: 68, version: "0.15.1" });
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("Keyboard Shortcuts");
    expect(text).toContain("\n\n  j/k, up/down  Select sessions, panes, or commands");
    expect(text).toContain("  click         Focus a session or pane, or run a command");
    expect(text).toContain("  tab           Select panes in the selected session");
    expect(text).toContain("  J             Jump to the next agent pane that needs attention");
    expect(text).toContain("  ctrl+p        Open commands");
    expect(text).toContain("  m             Cycle focus mode");
    expect(text).toContain("  ?             Show this help");
    expect(text).toContain("esc close\n");
    expect(text.split("\n").find((line) => line.endsWith("v0.15.1"))).toHaveLength(68);
    expect(text.split("\n").every((line) => line.length <= 68)).toBe(true);
  });

  test("renders compact help when narrow", () => {
    const output = renderHelpPanel({ width: 30, version: "0.15.1" });
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("Keyboard Shortcuts");
    expect(text).toContain("  j/k    select");
    expect(text).toContain("  click  focus/run");
    expect(text).toContain("  tab    select panes");
    expect(text).toContain("  J      needs attention");
    expect(text).toContain("  ^P     commands");
    expect(text).toContain("  m      mode");
    expect(text).toContain("esc close\n");
    expect(text.split("\n").find((line) => line.endsWith("v0.15.1"))).toHaveLength(30);
    expect(text).not.toContain("Select sessions, panes, or commands");
    expect(text.split("\n").every((line) => line.length <= 30)).toBe(true);
  });

  test("renders the shortcut footer", () => {
    const output = renderShortcutFooter(RGBA.fromIndex(8), 80);
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("ctrl+p commands");
    expect(text).toContain("? help");
    expect(text).not.toContain("click focus");
    expect(text).not.toContain("m mode");
    expect(text.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  test("keeps the command panel backdrop transparent", () => {
    const selectedBg = RGBA.fromInts(245, 245, 245);
    const backdrop = commandPanelBackdropColor({ selectedBg });

    expect(backdrop.equals(selectedBg)).toBe(false);
    expect(backdrop.toInts()).toEqual([0, 0, 0, 0]);
  });

  test("renders the mode status line", () => {
    const output = renderStatusLine(RGBA.fromIndex(8), 80, "popup");
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toBe("mode popup");
    expect(text.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  test("keeps compact help descriptions when very narrow", () => {
    const output = renderHelpPanel({ width: 10, version: "0.15.1" });
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("Help");
    expect(text).toContain("j/k select");
    expect(text).toContain("click focu");
    expect(text).toContain("tab select");
    expect(text).toContain("J needs");
    expect(text).toContain("^P command");
    expect(text).toContain("\n  attentio");
    expect(text).not.toContain("\nJ attentio");
    expect(text.split("\n").every((line) => line.length <= 10)).toBe(true);
  });

  test("derives the help version color from the muted foreground", () => {
    const darkThemeMuted = RGBA.fromInts(188, 188, 188);
    const lightThemeMuted = RGBA.fromInts(85, 85, 85);
    const darkOutput = renderHelpPanel({
      width: 68,
      textMutedFg: darkThemeMuted,
      version: "0.15.1",
    });
    const lightOutput = renderHelpPanel({
      width: 68,
      textMutedFg: lightThemeMuted,
      version: "0.15.1",
    });

    expect(darkOutput.chunks.find((chunk) => chunk.text === "v0.15.1")?.fg?.toInts()).toEqual([
      144, 144, 144, 255,
    ]);
    expect(lightOutput.chunks.find((chunk) => chunk.text === "v0.15.1")?.fg?.toInts()).toEqual([
      121, 121, 121, 255,
    ]);
  });

  test("renders session names", () => {
    const sessions: TmuxSession[] = [
      session({
        name: "work",
        path: "/repo/work",
        gitBranch: "main",
        gitDirty: true,
        attached: true,
        windows: [
          window({
            index: 1,
            name: "node",
            panes: [
              pane({
                processName: "opencode",
                active: true,
                ssh: false,
                integration: { tool: "opencode", status: "running" },
              }),
              pane({ processName: "bash", active: false }),
            ],
          }),
          window({
            index: 2,
            name: "server",
            active: false,
            panes: [pane({ processName: "bun", active: true })],
          }),
        ],
      }),
      session({
        name: "notes",
        attached: true,
        sshAttached: true,
        windows: [window({ name: "vim", panes: [pane({ processName: "vim" })] })],
      }),
    ];
    const output = renderSessions(sessions);

    expect(output.chunks.map((chunk) => chunk.text).join("")).toBe(
      [
        "▎ /repo/work  work",
        "▎ main*",
        "▎ 1:node",
        "▎ ╭─ opencode ● running",
        "▎ ╰─ bash",
        "▎ 2:server",
        "▎ ╶─ bun",
        "",
        "▎ notes <ssh>",
        "▎ ╶─ vim",
      ].join("\n"),
    );
    expect(output.chunks.find((chunk) => chunk.text === "/repo/work  work")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === "notes <ssh>")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === "notes <ssh>")?.fg?.slot).toBe(5);
    expect(output.chunks.find((chunk) => chunk.text === " opencode")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === " opencode")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === "●")?.fg).toBeDefined();
    expect(output.chunks.find((chunk) => chunk.text === "●")?.fg?.intent).toBe("indexed");
    expect(output.chunks.find((chunk) => chunk.text === "●")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === " running")?.attributes).toBe(0);
    expect(output.chunks.find((chunk) => chunk.text === " running")?.fg?.slot).toBe(8);
    expect(output.chunks.find((chunk) => chunk.text === "/repo/work  work")?.fg).toBeDefined();
    expect(output.chunks.find((chunk) => chunk.text === "/repo/work  work")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === "▎ ")?.attributes).toBe(
      createTextAttributes({ bold: true }),
    );
    expect(output.chunks.find((chunk) => chunk.text === "▎ ")?.fg?.slot).toBe(6);
    expect(output.chunks.find((chunk) => chunk.text === "main")?.attributes).toBe(0);
    expect(output.chunks.find((chunk) => chunk.text === "main")?.fg?.slot).toBe(8);
    expect(output.chunks.find((chunk) => chunk.text === "*")?.attributes).toBe(0);
    expect(output.chunks.find((chunk) => chunk.text === "*")?.fg?.slot).toBe(5);
    expect(output.chunks.map((chunk) => chunk.text).join("")).toContain("1:node");
    expect(output.chunks.map((chunk) => chunk.text).join("")).toContain("2:server");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("window");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("pane");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("active");
  });

  test("formats home paths and clean git branches", () => {
    const output = renderSessions([
      session({
        name: "session",
        path: `${homedir()}/dev/thud.sh`,
        gitBranch: "main",
        gitDirty: false,
        windows: [window({ panes: [pane({ processName: "bash" })] })],
      }),
    ]);

    expect(output.chunks.map((chunk) => chunk.text).join("")).toBe(
      ["╎ ~/dev/thud.sh  session", "╎ main", "╎ ╶─ bash"].join("\n"),
    );
  });

  test("shortens long paths to keep session rows within the terminal width", () => {
    const output = renderSessions(
      [
        session({
          path: `${homedir()}/dev/tpg/admin/.wt/feat/feedback`,
          gitBranch: "feat/feedback",
          windows: [window({ panes: [pane({ processName: "opencode" })] })],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 32 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎ ~/dev/t.../feedback  default  ");
    expect(text).toContain("╎ feat/feedback");
    expect(text).toContain("╎ ╶─ opencode");
    expect(text.split("\n").every((line) => line.length <= 32)).toBe(true);
  });

  test("uses short paths to leave room for long session names", () => {
    const output = renderSessions(
      [
        session({
          name: "very-long-session",
          path: homedir(),
          windows: [window({ panes: [pane({ processName: "opencode" })] })],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 25 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎ ~   very-long-session  ");
    expect(text).not.toContain("very...ion");
    expect(text.split("\n").every((line) => line.length <= 25)).toBe(true);
  });

  test("shortens long session names and branches within the terminal width", () => {
    const output = renderSessions(
      [
        session({
          name: "tpg/admin~feat/very-long-feedback-session",
          gitBranch: "feat/very-long-feedback-branch",
          windows: [window({ panes: [pane({ processName: "opencode" })] })],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 28 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎ tpg/admin~f...ck-session  ");
    expect(text).toContain("╎ feat/very-l...ack-branch  ");
    expect(text).toContain("╎ ╶─ opencode");
    expect(text.split("\n").every((line) => line.length <= 28)).toBe(true);
  });

  test("shortens long window labels within the terminal width", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              index: 1,
              name: "very-long-window-name",
              panes: [pane({ processName: "opencode" })],
            }),
            window({
              index: 2,
              name: "server",
              panes: [pane({ processName: "bun" })],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 18 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎ 1:very...-name  ");
    expect(text).not.toContain("very-long-window-name");
    expect(text.split("\n").every((line) => line.length <= 18)).toBe(true);
  });

  test("renders integration status markers", () => {
    const output = renderSessions([
      session({
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "idle" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "running" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "waiting" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "error" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "unknown" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("● idle");
    expect(text).toContain("● running");
    expect(text).toContain("● waiting");
    expect(text).toContain("● error");
    expect(text).toContain("● unknown");
    const markers = output.chunks.filter((chunk) => chunk.text === "●");

    expect(markers).toHaveLength(5);
    expect(markers.map((chunk) => chunk.fg?.intent)).toEqual([
      "indexed",
      "indexed",
      "indexed",
      "indexed",
      "indexed",
    ]);
    expect(markers.map((chunk) => chunk.fg?.slot)).toEqual([10, 6, 5, 1, 8]);
    for (const chunk of markers) {
      expect(chunk.fg).toBeDefined();
    }
  });

  test("renders elapsed time for timestamped integration statuses", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  integration: {
                    tool: "opencode",
                    status: "waiting",
                    updatedAt: new Date("2026-05-07T11:56:30.000Z"),
                  },
                }),
                pane({
                  processName: "opencode",
                  integration: {
                    tool: "opencode",
                    status: "unknown",
                    updatedAt: new Date("2026-05-07T11:59:18.000Z"),
                  },
                }),
              ],
            }),
          ],
        }),
      ],
      undefined,
      { now: new Date("2026-05-07T12:00:00.000Z") },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("● waiting 3m");
    expect(text).toContain("● unknown");
    expect(text).not.toContain("unknown <1m");
  });

  test("does not render elapsed time without integration timestamps", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  integration: { tool: "opencode", status: "running" },
                }),
              ],
            }),
          ],
        }),
      ],
      undefined,
      { now: new Date("2026-05-07T12:00:00.000Z") },
    );

    expect(output.chunks.map((chunk) => chunk.text).join("")).toContain("● running");
    expect(output.chunks.map((chunk) => chunk.text).join("")).not.toContain("running ");
  });

  test("keeps pane status labels muted", () => {
    const output = renderSessions([
      session({
        attached: false,
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "idle" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "waiting" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const idleLabel = output.chunks.find((chunk) => chunk.text === " idle");
    const waitingLabel = output.chunks.find((chunk) => chunk.text === " waiting");

    expect(idleLabel?.attributes).toBe(0);
    expect(idleLabel?.fg?.slot).toBe(8);
    expect(waitingLabel?.attributes).toBe(0);
    expect(waitingLabel?.fg?.slot).toBe(8);
  });

  test("colors unattached session headers when attention is needed", () => {
    const output = renderSessions([
      session({
        attached: false,
        path: "/repo/work",
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "waiting" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const header = output.chunks.find((chunk) => chunk.text === "/repo/work  default");

    expect(header?.attributes).toBe(0);
    expect(header?.fg?.slot).toBe(5);
  });

  test("colors idle session headers like the idle status pill", () => {
    const output = renderSessions([
      session({
        attached: false,
        path: "/repo/work",
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "idle" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const header = output.chunks.find((chunk) => chunk.text === "/repo/work  default");

    expect(header?.attributes).toBe(0);
    expect(header?.fg?.slot).toBe(10);
  });

  test("uses the session status color for attached session chrome", () => {
    const output = renderSessions([
      session({
        attached: true,
        path: "/repo/work",
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "waiting" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const header = output.chunks.find((chunk) => chunk.text === "/repo/work  default");
    const border = output.chunks.find((chunk) => chunk.text === "▎ ");

    expect(header?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(header?.fg?.slot).toBe(5);
    expect(border?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(border?.fg?.slot).toBe(5);
  });

  test("uses the selected color for selected session headers and borders", () => {
    const output = renderSessions(
      [
        session({
          attached: false,
          path: "/repo/work",
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  integration: { tool: "opencode", status: "waiting" },
                }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true },
    );
    const header = output.chunks.find((chunk) => chunk.text === "/repo/work  default");
    const border = output.chunks.find((chunk) => chunk.text === "╎ ");

    expect(header?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(header?.fg?.slot).toBe(6);
    expect(border?.fg?.slot).toBe(8);
    expect(border?.bg?.slot).toBe(235);
  });

  test("keeps attached pane status labels muted", () => {
    const output = renderSessions([
      session({
        attached: true,
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "idle" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "waiting" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const idleLabel = output.chunks.find((chunk) => chunk.text === " idle");
    const waitingLabel = output.chunks.find((chunk) => chunk.text === " waiting");

    expect(idleLabel?.attributes).toBe(0);
    expect(idleLabel?.fg?.slot).toBe(8);
    expect(waitingLabel?.attributes).toBe(0);
    expect(waitingLabel?.fg?.slot).toBe(8);
  });

  test("keeps unattached session borders muted when attention is needed", () => {
    const output = renderSessions([
      session({
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "running" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "idle" },
              }),
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "waiting" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const sessionBorder = output.chunks.find((chunk) => chunk.text === "╎ ");

    expect(text).toContain("╎ default\n╎ ╭─ opencode ● running");
    expect(text).not.toContain("╎ ● waiting");
    expect(text).toContain("╎ ╰─ opencode ● waiting");
    expect(sessionBorder?.fg?.slot).toBe(8);
  });

  test("keeps running-only agent status at the pane level", () => {
    const output = renderSessions([
      session({
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                integration: { tool: "opencode", status: "running" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toBe(["╎ default", "╎ ╶─ opencode ● running"].join("\n"));
  });

  test("renders OpenCode pane titles as pane context", () => {
    const output = renderSessions([
      session({
        windows: [
          window({
            panes: [
              pane({
                processName: "opencode",
                title: "OC | Session data and metadata layout",
                integration: { tool: "opencode", status: "running" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("opencode ● running\n╎    Session data and metadata layout");
    expect(
      output.chunks.find((chunk) => chunk.text === "   Session data and metadata layout")?.fg?.slot,
    ).toBe(8);
  });

  test("continues OpenCode pane context guides only when panes follow", () => {
    const output = renderSessions([
      session({
        windows: [
          window({
            panes: [
              pane({ processName: "bun" }),
              pane({ processName: "bash" }),
              pane({ processName: "bun" }),
              pane({
                processName: "opencode",
                title: "OC | Code review workflow in progress",
                integration: { tool: "opencode", status: "idle" },
              }),
              pane({
                processName: "opencode",
                title: "OC | Light mode terminal color palette",
                integration: { tool: "opencode", status: "idle" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("├─ opencode ● idle\n╎ │  Code review workflow in progress");
    expect(text).toContain("╰─ opencode ● idle\n╎    Light mode terminal color palette");
    expect(text).not.toContain("╰─ opencode ● idle\n╎ │  Light mode terminal color palette");
  });

  test("continues OpenCode pane context guides for selected panes with following panes", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  id: "%1",
                  processName: "opencode",
                  title: "OC | Selected pane context",
                  integration: { tool: "opencode", status: "running" },
                }),
                pane({ id: "%2", processName: "bash" }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedPaneId: "%1" },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const contextChunk = output.chunks.find((chunk) => chunk.text === "│  Selected pane context");

    expect(text).toContain("╎ ▶─ opencode ● running\n╎ │  Selected pane context");
    expect(contextChunk?.bg?.slot).toBe(235);
  });

  test("shortens OpenCode pane titles within the terminal width", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  title: "OC | Helium dotfiles and swipe back deactivation",
                  integration: { tool: "opencode", status: "idle" },
                }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 32 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎    Helium dotfiles and sw...  ");
    expect(text.split("\n").every((line) => line.length <= 32)).toBe(true);
  });

  test("shortens long pane rows within the terminal width", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  processName: "very-long-process-name",
                  integration: {
                    tool: "opencode",
                    status: "waiting",
                    label: "needs a long approval label",
                  },
                }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 24 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎ ╶─ very-long-proc...");
    expect(text).not.toContain("needs a long approval label");
    expect(text.split("\n").every((line) => line.length <= 24)).toBe(true);
  });

  test("shortens long pane status labels with an ellipsis", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  integration: {
                    tool: "opencode",
                    status: "waiting",
                    label: "needs a long approval label",
                  },
                }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 32 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");

    expect(text).toContain("╎ ╶─ opencode ● needs a lon...");
    expect(text).not.toContain("needs a long approval label");
    expect(text.split("\n").every((line) => line.length <= 32)).toBe(true);
  });

  test("renders ssh panes in the ssh color", () => {
    const output = renderSessions([
      session({
        attached: true,
        windows: [
          window({
            panes: [pane({ processName: "ssh", active: true, ssh: true })],
          }),
        ],
      }),
    ]);
    const sshPane = output.chunks.find((chunk) => chunk.text === " ssh");

    expect(sshPane?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(sshPane?.fg?.slot).toBe(5);
  });

  test("renders focused panes under ssh-attached sessions in the ssh color", () => {
    const output = renderSessions([
      session({
        attached: true,
        sshAttached: true,
        windows: [
          window({
            panes: [
              pane({ processName: "bash", active: true, ssh: false }),
              pane({ processName: "zsh", active: false, ssh: false }),
            ],
          }),
        ],
      }),
    ]);
    const paneChunk = output.chunks.find((chunk) => chunk.text === " bash");
    const inactivePaneChunk = output.chunks.find((chunk) => chunk.text === " zsh");

    expect(paneChunk?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(paneChunk?.fg?.slot).toBe(5);
    expect(inactivePaneChunk?.attributes).toBe(0);
    expect(inactivePaneChunk?.fg).toBeUndefined();
  });

  test("uses the attached session status color for the active pane", () => {
    const output = renderSessions([
      session({
        attached: true,
        windows: [
          window({
            active: true,
            panes: [
              pane({
                processName: "opencode",
                active: true,
                integration: { tool: "opencode", status: "idle" },
              }),
            ],
          }),
        ],
      }),
    ]);
    const activePaneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(activePaneChunk?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(activePaneChunk?.fg?.slot).toBe(10);
  });

  test("renders the selected session as a highlighted block", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({ id: "%1", processName: "opencode", active: true }),
                pane({ id: "%2" }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const activePaneChunk = output.chunks.find((chunk) => chunk.text === " opencode");
    const selectedBorderChunk = output.chunks.find((chunk) => chunk.text === "╎ ");
    const selectedSessionPaneChunk = output.chunks.find((chunk) => chunk.text === " bash");
    const selectedBranchChunk = output.chunks.find((chunk) => chunk.text === "╰─");

    expect(text).toContain("╎ ╭─ opencode");
    expect(text).toContain("╎ ╰─ bash");
    expect(text).not.toContain(">");
    expect(selectedBorderChunk?.fg?.slot).toBe(8);
    expect(selectedBorderChunk?.bg?.slot).toBe(235);
    expect(selectedSessionPaneChunk?.fg).toBeUndefined();
    expect(selectedSessionPaneChunk?.bg?.slot).toBe(235);
    expect(selectedBranchChunk?.fg?.slot).toBe(8);
    expect(selectedBranchChunk?.bg?.slot).toBe(235);
    expect(activePaneChunk?.bg?.slot).toBe(235);
    expect(activePaneChunk?.attributes).toBe(0);
  });

  test("does not highlight the selected session unless requested", () => {
    const output = renderSessions(
      [
        session({
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
      ],
      "$1",
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const paneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(text).toContain("╎ ╶─ opencode");
    expect(paneChunk?.bg).toBeUndefined();
  });

  test("uses a custom selected session background", () => {
    const selectedBg = RGBA.fromInts(245, 245, 245);
    const output = renderSessions(
      [
        session({
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedBg },
    );
    const paneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(paneChunk?.bg?.equals(selectedBg)).toBe(true);
  });

  test("uses a custom muted foreground", () => {
    const textMutedFg = RGBA.fromInts(85, 85, 85);
    const output = renderSessions(
      [
        session({
          path: "/repo/work",
          windows: [
            window({
              panes: [
                pane({
                  processName: "opencode",
                  integration: { tool: "opencode", status: "unknown" },
                }),
              ],
            }),
          ],
        }),
      ],
      undefined,
      { textMutedFg },
    );
    const statusLabelChunk = output.chunks.find((chunk) => chunk.text === " unknown");
    const unknownStatusChunk = output.chunks.find((chunk) => chunk.text === "●");

    expect(statusLabelChunk?.fg?.equals(textMutedFg)).toBe(true);
    expect(unknownStatusChunk?.fg?.equals(textMutedFg)).toBe(true);
  });

  test("keeps session text aligned when selection changes", () => {
    const sessions = [
      session({
        windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
      }),
    ];
    const unselectedText = renderSessions(sessions)
      .chunks.map((chunk) => chunk.text)
      .join("");
    const selectedText = renderSessions(sessions, "$1")
      .chunks.map((chunk) => chunk.text)
      .join("");

    expect(selectedText.indexOf("opencode")).toBe(unselectedText.indexOf("opencode"));
  });

  test("pads selected session rows to the terminal width", () => {
    const output = renderSessions(
      [
        session({
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
      ],
      "$1",
      { highlightSelected: true, width: 20 },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const selectedPaddingChunk = output.chunks.find((chunk) => chunk.text === "       ");

    expect(text).toContain("╎ default           ");
    expect(text).toContain("╎ ╶─ opencode       ");
    expect(selectedPaddingChunk?.bg?.slot).toBe(235);
  });

  test("shows selected session highlighting", () => {
    const output = renderSessions(
      [
        session({
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
      ],
      "$1",
      { highlightSelected: true },
    );
    const paneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(paneChunk?.fg).toBeUndefined();
    expect(paneChunk?.bg?.slot).toBe(235);
  });

  test("shows selected pane highlighting inside the selected session", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({ id: "%1", processName: "opencode", active: true }),
                pane({ id: "%2", active: false }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedPaneId: "%2" },
    );
    const text = output.chunks.map((chunk) => chunk.text).join("");
    const selectedPaneMarker = output.chunks.find((chunk) => chunk.text === "▶─");
    const selectedPaneChunk = output.chunks.find((chunk) => chunk.text === " bash");

    expect(text).toContain("╎ ▶─ bash");
    expect(selectedPaneMarker?.fg?.slot).toBe(14);
    expect(selectedPaneMarker?.bg?.slot).toBe(235);
    expect(selectedPaneChunk?.bg?.slot).toBe(235);
  });

  test("matches the selected pane style on its window label", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              index: 1,
              name: "editor",
              panes: [pane({ id: "%1", processName: "opencode" })],
            }),
            window({
              id: "@2",
              index: 2,
              name: "server",
              panes: [pane({ id: "%2", processName: "bash" })],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedPaneId: "%2" },
    );
    const selectedWindowLabel = output.chunks.find((chunk) => chunk.text === "2:server");
    const otherWindowLabel = output.chunks.find((chunk) => chunk.text === "1:editor");

    expect(selectedWindowLabel?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(selectedWindowLabel?.fg?.slot).toBe(14);
    expect(selectedWindowLabel?.bg?.slot).toBe(235);
    expect(otherWindowLabel?.attributes).toBe(0);
    expect(otherWindowLabel?.fg?.slot).toBe(8);
    expect(otherWindowLabel?.bg?.slot).toBe(235);
  });

  test("uses the attached session status color for selected pane window labels", () => {
    const output = renderSessions(
      [
        session({
          attached: true,
          windows: [
            window({
              index: 1,
              name: "editor",
              panes: [
                pane({
                  id: "%1",
                  processName: "opencode",
                  integration: { tool: "opencode", status: "waiting" },
                }),
              ],
            }),
            window({ id: "@2", index: 2, name: "server", panes: [pane({ id: "%2" })] }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedPaneId: "%1" },
    );
    const selectedWindowLabel = output.chunks.find((chunk) => chunk.text === "1:editor");

    expect(selectedWindowLabel?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(selectedWindowLabel?.fg?.slot).toBe(5);
    expect(selectedWindowLabel?.bg?.slot).toBe(235);
  });

  test("matches the active pane style on its window label", () => {
    const output = renderSessions([
      session({
        attached: true,
        windows: [
          window({
            index: 1,
            name: "editor",
            active: false,
            panes: [pane({ id: "%1", processName: "opencode", active: false })],
          }),
          window({
            id: "@2",
            index: 2,
            name: "server",
            active: true,
            panes: [pane({ id: "%2", processName: "bash", active: true })],
          }),
        ],
      }),
    ]);
    const activeWindowLabel = output.chunks.find((chunk) => chunk.text === "2:server");
    const inactiveWindowLabel = output.chunks.find((chunk) => chunk.text === "1:editor");

    expect(activeWindowLabel?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(activeWindowLabel?.fg?.slot).toBe(6);
    expect(inactiveWindowLabel?.attributes).toBe(0);
    expect(inactiveWindowLabel?.fg?.slot).toBe(8);
  });

  test("uses the attached session status color for active pane window labels", () => {
    const output = renderSessions([
      session({
        attached: true,
        windows: [
          window({
            index: 1,
            name: "editor",
            active: true,
            panes: [
              pane({
                id: "%1",
                processName: "opencode",
                active: true,
                integration: { tool: "opencode", status: "idle" },
              }),
            ],
          }),
          window({
            id: "@2",
            index: 2,
            name: "server",
            active: false,
            panes: [pane({ id: "%2", active: false })],
          }),
        ],
      }),
    ]);
    const activeWindowLabel = output.chunks.find((chunk) => chunk.text === "1:editor");

    expect(activeWindowLabel?.attributes).toBe(createTextAttributes({ bold: true }));
    expect(activeWindowLabel?.fg?.slot).toBe(10);
  });

  test("uses the attached session status color for selected pane highlighting", () => {
    const output = renderSessions(
      [
        session({
          attached: true,
          windows: [
            window({
              panes: [
                pane({
                  id: "%1",
                  processName: "opencode",
                  integration: { tool: "opencode", status: "waiting" },
                }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedPaneId: "%1" },
    );
    const selectedPaneMarker = output.chunks.find((chunk) => chunk.text === "▶─");
    const selectedPaneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(selectedPaneMarker?.fg?.slot).toBe(5);
    expect(selectedPaneMarker?.bg?.slot).toBe(235);
    expect(selectedPaneChunk?.fg?.slot).toBe(5);
    expect(selectedPaneChunk?.bg?.slot).toBe(235);
  });

  test("uses the idle session status color for selected pane highlighting", () => {
    const output = renderSessions(
      [
        session({
          windows: [
            window({
              panes: [
                pane({
                  id: "%1",
                  processName: "opencode",
                  integration: { tool: "opencode", status: "idle" },
                }),
              ],
            }),
          ],
        }),
      ],
      "$1",
      { highlightSelected: true, selectedPaneId: "%1" },
    );
    const selectedPaneMarker = output.chunks.find((chunk) => chunk.text === "▶─");
    const selectedPaneChunk = output.chunks.find((chunk) => chunk.text === " opencode");

    expect(selectedPaneMarker?.fg?.slot).toBe(10);
    expect(selectedPaneMarker?.bg?.slot).toBe(235);
    expect(selectedPaneChunk?.fg?.slot).toBe(10);
    expect(selectedPaneChunk?.bg?.slot).toBe(235);
  });

  test("does not show selected pane highlighting outside the selected session", () => {
    const output = renderSessions(
      [
        session({
          id: "$1",
          windows: [window({ panes: [pane({ id: "%1", processName: "opencode" })] })],
        }),
        session({
          id: "$2",
          windows: [window({ panes: [pane({ id: "%2" })] })],
        }),
      ],
      "$1",
      { selectedPaneId: "%2" },
    );

    expect(output.chunks.some((chunk) => chunk.text === "▶─")).toBe(false);
  });

  test("calculates session line ranges in render order", () => {
    const sessions = [
      session({
        id: "$1",
        gitBranch: "main",
        windows: [
          window({
            id: "@1",
            panes: [
              pane({
                id: "%1",
                processName: "opencode",
                title: "OC | Build thing",
              }),
            ],
          }),
          window({
            id: "@2",
            index: 2,
            name: "server",
            panes: [pane({ id: "%2" })],
          }),
        ],
      }),
      session({ id: "$2", windows: [window({ panes: [pane()] })] }),
    ];

    expect(sessionLineRange(sessions, "$1")).toEqual({ start: 0, end: 7 });
    expect(sessionLineRange(sessions, "$2")).toEqual({ start: 8, end: 10 });
    expect(sessionLineRange(sessions, "$3")).toBeUndefined();
    expect(paneLineRange(sessions, "$1", "%1")).toEqual({ start: 3, end: 5 });
    expect(paneLineRange(sessions, "$1", "%2")).toEqual({ start: 6, end: 7 });
    expect(paneLineRange(sessions, "$2", "%1")).toEqual({ start: 9, end: 10 });
    expect(paneLineRange(sessions, "$1", "%3")).toBeUndefined();
    expect(sessionsLineCount(sessions)).toBe(10);
  });

  test("scrolls a selected pane range into view inside a tall session", () => {
    const sessions = [
      session({
        id: "$1",
        windows: [
          window({
            panes: [
              pane({ id: "%1" }),
              pane({ id: "%2" }),
              pane({ id: "%3" }),
              pane({ id: "%4" }),
              pane({ id: "%5" }),
              pane({ id: "%6" }),
            ],
          }),
        ],
      }),
    ];

    expect(
      scrollLineRangeIntoView(0, 4, sessionsLineCount(sessions), sessionLineRange(sessions, "$1")),
    ).toBe(0);
    expect(
      scrollLineRangeIntoView(
        0,
        4,
        sessionsLineCount(sessions),
        paneLineRange(sessions, "$1", "%6"),
      ),
    ).toBe(3);
  });

  test("scrolls a selected line range into view", () => {
    expect(scrollLineRangeIntoView(0, 5, 20, { start: 8, end: 10 })).toBe(5);
    expect(scrollLineRangeIntoView(8, 5, 20, { start: 3, end: 5 })).toBe(3);
    expect(scrollLineRangeIntoView(4, 5, 20, { start: 5, end: 8 })).toBe(4);
    expect(scrollLineRangeIntoView(0, 20, 100, { start: 0, end: 100 })).toBe(0);
    expect(scrollLineRangeIntoView(19, 5, 20, undefined)).toBe(15);
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
