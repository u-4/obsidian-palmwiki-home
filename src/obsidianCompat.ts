import type { App, Command, UserEvent, Workspace } from "obsidian";

export type RuntimeCommandInfo = Pick<Command, "id" | "name">;

export type CommandExecutionResult =
  | "executed"
  | "failed"
  | "unavailable"
  | "unsupported";

type RuntimeCommandManager = {
  commands?: unknown;
  executeCommandById?: (commandId: string, event?: UserEvent) => boolean;
  findCommand?: (commandId: string) => unknown;
  listCommands?: () => unknown;
};

type RuntimeCommandApp = App & {
  commands?: RuntimeCommandManager;
};

type RuntimeHoverWorkspace = Workspace & {
  unregisterHoverLinkSource?: (sourceId: string) => void;
};

export function unregisterHoverLinkSourceCompat(
  workspace: Workspace,
  sourceId: string
): boolean {
  try {
    const unregister = (workspace as RuntimeHoverWorkspace).unregisterHoverLinkSource;
    if (typeof unregister !== "function") {
      return false;
    }
    unregister.call(workspace, sourceId);
    return true;
  } catch {
    return false;
  }
}

export function listCommandsCompat(app: App): RuntimeCommandInfo[] {
  try {
    return listCommandsUnchecked(app);
  } catch {
    return [];
  }
}

function listCommandsUnchecked(app: App): RuntimeCommandInfo[] {
  const manager = getRuntimeCommandManager(app);
  if (!manager) {
    return [];
  }

  const values = [...getRegisteredCommandValues(manager)];
  if (typeof manager.listCommands === "function") {
    try {
      const listedCommands: unknown = manager.listCommands();
      if (Array.isArray(listedCommands)) {
        for (const value of listedCommands as unknown[]) {
          values.push(value);
        }
      }
    } catch {
      // The private command manager is optional. Its failure must not break settings.
    }
  }

  const commandsById = new Map<string, RuntimeCommandInfo>();
  for (const value of values) {
    const command = toRuntimeCommandInfo(value);
    if (command && !commandsById.has(command.id)) {
      commandsById.set(command.id, command);
    }
  }

  return Array.from(commandsById.values()).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  );
}

export function executeCommandByIdCompat(
  app: App,
  commandId: string,
  event?: UserEvent
): CommandExecutionResult {
  try {
    return executeCommandByIdUnchecked(app, commandId, event);
  } catch {
    return "failed";
  }
}

function executeCommandByIdUnchecked(
  app: App,
  commandId: string,
  event?: UserEvent
): CommandExecutionResult {
  const normalizedId = commandId.trim();
  if (!normalizedId) {
    return "unavailable";
  }

  const manager = getRuntimeCommandManager(app);
  if (!manager || typeof manager.executeCommandById !== "function") {
    return "unsupported";
  }

  try {
    if (typeof manager.findCommand === "function") {
      if (!manager.findCommand(normalizedId)) {
        return "unavailable";
      }
    } else {
      const registeredValues = getRegisteredCommandValues(manager);
      if (
        registeredValues.length > 0 &&
        !registeredValues.some(
          (value) => toRuntimeCommandInfo(value)?.id === normalizedId
        )
      ) {
        return "unavailable";
      }
    }

    if (typeof manager.listCommands === "function") {
      const listedCommands: unknown = manager.listCommands();
      if (
        Array.isArray(listedCommands) &&
        !listedCommands.some(
          (value) => toRuntimeCommandInfo(value)?.id === normalizedId
        )
      ) {
        return "unavailable";
      }
    }

    return manager.executeCommandById(normalizedId, event) === true
      ? "executed"
      : "unavailable";
  } catch {
    return "failed";
  }
}

function getRuntimeCommandManager(app: App): RuntimeCommandManager | null {
  const manager = (app as RuntimeCommandApp).commands;
  return manager && typeof manager === "object" ? manager : null;
}

function getRegisteredCommandValues(manager: RuntimeCommandManager): unknown[] {
  const registry = manager.commands;
  if (registry instanceof Map) {
    return Array.from(registry.values());
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return [];
  }
  return Object.values(registry as Record<string, unknown>);
}

function toRuntimeCommandInfo(value: unknown): RuntimeCommandInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const command = value as { id?: unknown; name?: unknown };
  if (typeof command.id !== "string" || typeof command.name !== "string") {
    return null;
  }

  const id = command.id.trim();
  const name = command.name.trim();
  return id && name ? { id, name } : null;
}
