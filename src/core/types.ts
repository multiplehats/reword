import type { Change } from "./changes";

/** Where a flavour keeps the change list (extension: storage.session per origin; others: sessionStorage). */
export interface ChangeStore {
  load(): Promise<unknown[]>;
  save(changes: Record<string, unknown>[]): Promise<void>;
}

/** Small key-value store for UI preferences such as the panel position. */
export interface PrefStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface RewordOptions {
  store: ChangeStore;
  prefs?: PrefStore;
  /** Called when the user closes the editor (not when it's destroyed). */
  onClose?: () => void;
  /** Extension-only per-site "E key" toggle. Hidden when omitted. */
  siteToggle?: {
    get(): Promise<boolean>;
    set(enabled: boolean): Promise<void>;
  };
}

export type { Change };
