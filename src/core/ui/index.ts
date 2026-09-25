// Mounts the UI while Reword is enabled and keeps it in sync with the store.
import { store } from "../store";
import type { RewordOptions } from "../types";
import { cancel } from "./inlineEdit";
import { createInterceptor } from "./interceptor";
import { createOverlay } from "./overlay";
import { createPanel } from "./panel";
import { ensureRoot, mountHost, unmountHost } from "./root";

export function createUI(opts: Pick<RewordOptions, "prefs" | "siteToggle">) {
  const root = ensureRoot();
  const overlay = createOverlay();
  const panel = createPanel(opts);
  overlay.el.append(panel.el);
  root.append(overlay.el);
  const interceptor = createInterceptor(overlay);
  void panel.loadPosition();

  let raf = 0;
  const loop = () => {
    overlay.frame();
    raf = requestAnimationFrame(loop);
  };

  // Pages that re-render <html> children (or wipe body) would drop the host.
  const keepMounted = new MutationObserver(() => {
    if (store.get().enabled) mountHost();
  });

  function mount() {
    mountHost();
    interceptor.attach();
    panel.render(store.get());
    keepMounted.observe(document.documentElement, { childList: true });
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancel();
    overlay.cancelDrag();
    interceptor.detach();
    keepMounted.disconnect();
    cancelAnimationFrame(raf);
    unmountHost();
  }

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.enabled !== prev.enabled) (s.enabled ? mount : unmount)();
    if (s.enabled) panel.render(s);
  });

  return {
    destroy() {
      unsubscribe();
      unmount();
    },
  };
}
