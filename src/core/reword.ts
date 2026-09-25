// Public entry point shared by every flavour (extension, bookmarklet,
// userscript, drop-in). Nothing on the page changes until the editor opens.
import { executeCommand, onCommand, type CommandResult } from "./commands";
import { getToolDefinitions } from "./definitions";
import { buildPrompt } from "./prompt";
import * as session from "./session";
import { store } from "./store";
import type { Change, RewordOptions } from "./types";
import { createUI } from "./ui";

export interface Reword {
  readonly opened: boolean;
  open(): Promise<void>;
  close(): void;
  toggle(): void;
  /** Tear down and put the page back (stored changes are kept). For when this instance is being replaced. */
  destroy(): void;
  getPrompt(): string;
  getChanges(): Change[];
  /** Run any command by name, e.g. executeCommand("find_elements", { query: "headline" }). Never throws. */
  executeCommand(name: string, params?: unknown): Promise<CommandResult>;
  /** Every command as LLM tool definitions ("anthropic" default, or "openai"). */
  getToolDefinitions: typeof getToolDefinitions;
  /** Observe every executed command. Returns an unsubscribe function. */
  onCommand: typeof onCommand;
}

export function createReword(opts: RewordOptions): Reword {
  const ui = createUI(opts);
  let stopWatching: (() => void) | null = null;
  let silent = false;

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.enabled === prev.enabled) return;
    if (s.enabled) stopWatching ??= session.watch();
    else {
      stopWatching?.();
      stopWatching = null;
      if (!silent) opts.onClose?.();
    }
  });

  const open = async () => {
    await session.load(opts.store);
    await executeCommand("set_enabled", { enabled: true });
  };
  const close = () => void executeCommand("set_enabled", { enabled: false });

  return {
    get opened() {
      return store.get().enabled;
    },
    open,
    close,
    toggle: () => (store.get().enabled ? close() : void open()),
    destroy() {
      silent = true;
      unsubscribe();
      stopWatching?.();
      stopWatching = null;
      ui.destroy();
      session.unapplyAll();
      store.set({ enabled: false });
    },
    getPrompt: () => buildPrompt(store.get().changes),
    getChanges: () => store.get().changes.slice(),
    // The stored session has to be loaded first, or a command run before the
    // editor opens would be overwritten by it later.
    executeCommand: async (name, params) => {
      await session.load(opts.store);
      return executeCommand(name, params);
    },
    getToolDefinitions,
    onCommand,
  };
}
