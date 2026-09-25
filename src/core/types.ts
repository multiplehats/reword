export type ChangeType = 'edit' | 'comment';

export interface Change {
  id: string;
  type: ChangeType;
  url: string;
  pathname: string;
  pageTitle: string;
  selector: string;
  fallbackSelector: string;
  tag: string;
  role: string;
  /** Human label, e.g. "Headline (H1) — hero" */
  label: string;
  /** e.g. "section#pricing › “Simple pricing” › Button label" */
  context: string;
  originalText: string;
  /** Empty for comments. */
  newText: string;
  /** Empty for edits. */
  comment: string;
  /** Individual text-node segments when the copy is split across elements. */
  segments: string[];
  /** Framework/tooling data attributes found on the element or its ancestors. */
  sourceHints: string[];
  createdAt: number;
}

export interface ChangeStore {
  load(): Promise<Change[]>;
  save(changes: Change[]): Promise<void>;
}

export interface OverlayOptions {
  store?: ChangeStore;
  /** Label shown in the panel footer, e.g. "extension" or "bookmarklet". */
  flavor?: string;
  /** Called when the user closes the panel. */
  onClose?: () => void;
  /** Extension-only per-site toggle. Hidden when omitted. */
  siteToggle?: {
    get(): Promise<boolean>;
    set(enabled: boolean): Promise<void>;
  };
}
