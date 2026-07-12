import assert from "node:assert/strict";
import test from "node:test";
import type { App } from "obsidian";
import {
  executeCommandByIdCompat,
  listCommandsCompat,
  unregisterHoverLinkSourceCompat
} from "../src/obsidianCompat";
import type { Workspace } from "obsidian";

test("command discovery fails safely when the private manager is unavailable", () => {
  const app = {} as App;
  assert.deepEqual(listCommandsCompat(app), []);
  assert.equal(executeCommandByIdCompat(app, "app:test"), "unsupported");
});

test("throwing private command properties never escape the compatibility boundary", () => {
  const app = Object.defineProperty({}, "commands", {
    get: () => {
      throw new Error("private API changed");
    }
  }) as App;

  assert.deepEqual(listCommandsCompat(app), []);
  assert.equal(executeCommandByIdCompat(app, "app:test"), "failed");
});

test("command discovery validates, deduplicates, and sorts registry and list entries", () => {
  const app = makeApp({
    commands: new Map<string, unknown>([
      ["b", { id: "b", name: "Zulu" }],
      ["bad", { id: "", name: "Broken" }],
      ["a", { id: "a", name: "Alpha" }]
    ]),
    listCommands: () => [
      { id: "b", name: "Duplicate" },
      { id: "c", name: "Alpha" },
      null
    ]
  });

  assert.deepEqual(listCommandsCompat(app), [
    { id: "a", name: "Alpha" },
    { id: "c", name: "Alpha" },
    { id: "b", name: "Zulu" }
  ]);
});

test("a failing command list does not hide valid guarded registry entries", () => {
  const app = makeApp({
    commands: { test: { id: "test", name: "Test" } },
    listCommands: () => {
      throw new Error("unsupported");
    }
  });

  assert.deepEqual(listCommandsCompat(app), [{ id: "test", name: "Test" }]);
});

test("command execution preserves the manager receiver and reports success", () => {
  let receiverWasManager = false;
  const manager = {
    commands: { test: { id: "test", name: "Test" } },
    executeCommandById(this: unknown, commandId: string): boolean {
      receiverWasManager = this === manager;
      return commandId === "test";
    },
    findCommand: () => ({ id: "test", name: "Test" }),
    listCommands: () => [{ id: "test", name: "Test" }]
  };

  assert.equal(executeCommandByIdCompat(makeApp(manager), "test"), "executed");
  assert.equal(receiverWasManager, true);
});

test("missing, disabled, false, and throwing commands fail without escaping", () => {
  let executeCalls = 0;
  const disabledManager = {
    commands: { test: { id: "test", name: "Test" } },
    executeCommandById: () => {
      executeCalls += 1;
      return true;
    },
    findCommand: () => ({ id: "test", name: "Test" }),
    listCommands: () => []
  };

  assert.equal(executeCommandByIdCompat(makeApp(disabledManager), "test"), "unavailable");
  assert.equal(executeCalls, 0);
  assert.equal(executeCommandByIdCompat(makeApp(disabledManager), "  "), "unavailable");
  assert.equal(executeCalls, 0);

  const falseManager = {
    commands: { test: { id: "test", name: "Test" } },
    executeCommandById: () => false,
    listCommands: () => [{ id: "test", name: "Test" }]
  };
  assert.equal(executeCommandByIdCompat(makeApp(falseManager), "test"), "unavailable");

  const throwingManager = {
    executeCommandById: () => {
      throw new Error("failed");
    },
    listCommands: () => [{ id: "test", name: "Test" }]
  };
  assert.equal(executeCommandByIdCompat(makeApp(throwingManager), "test"), "failed");
});

test("Hover source cleanup preserves its workspace receiver and fails safely", () => {
  let removedId = "";
  let receiverMatches = false;
  const workspace = {
    unregisterHoverLinkSource(this: unknown, sourceId: string) {
      receiverMatches = this === workspace;
      removedId = sourceId;
    }
  } as unknown as Workspace;

  assert.equal(
    unregisterHoverLinkSourceCompat(workspace, "palmwiki-home-card-preview"),
    true
  );
  assert.equal(receiverMatches, true);
  assert.equal(removedId, "palmwiki-home-card-preview");
  assert.equal(unregisterHoverLinkSourceCompat({} as Workspace, "missing"), false);

  const throwingWorkspace = Object.defineProperty({}, "unregisterHoverLinkSource", {
    get: () => {
      throw new Error("unsupported");
    }
  }) as Workspace;
  assert.equal(unregisterHoverLinkSourceCompat(throwingWorkspace, "test"), false);
});

function makeApp(commands: unknown): App {
  return { commands } as unknown as App;
}
