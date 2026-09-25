export const CSS = `
:host {
  all: initial !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  display: block !important;
  --bg: #121316;
  --bg-2: #1a1b20;
  --bg-3: #24252c;
  --line: rgba(255,255,255,.08);
  --line-2: rgba(255,255,255,.14);
  --fg: #e8e8ec;
  --muted: #9c9ca8;
  --dim: #6d6d78;
  --blue: #3b82f6;
  --blue-2: #2563eb;
  --yellow: #facc15;
  --amber: #f59e0b;
  --red: #f87171;
  --green: #4ade80;
}
*, *::before, *::after { box-sizing: border-box; }
.panel, .tip, .parent-chip, .badge, .toast {
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  letter-spacing: normal; text-transform: none; text-align: left; -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
svg { display: block; }

/* ---------- On-page layer ---------- */
.box { position: fixed; pointer-events: none; border-radius: 4px; }
.box.hover { outline: 1.5px solid rgba(59,130,246,.55); background: rgba(59,130,246,.06); }
.box.hover.comment { outline-color: rgba(245,158,11,.6); background: rgba(245,158,11,.06); }
.box.edit { outline: 2px solid var(--blue); box-shadow: 0 0 0 5px rgba(59,130,246,.22); }
.box.select { outline: 2px solid var(--amber); box-shadow: 0 0 0 5px rgba(245,158,11,.2); }
.box.nested { outline: 1.5px dashed var(--yellow); outline-offset: 3px; }
.box.flash { outline: 2px solid var(--yellow); background: rgba(250,204,21,.14); animation: flash 1.2s ease-out forwards; }
.box.queued { outline: 1px dashed rgba(59,130,246,.7); background: rgba(59,130,246,.05); }
.box.queued.comment { outline-color: rgba(245,158,11,.75); background: rgba(245,158,11,.05); }
@keyframes flash { 0%, 60% { opacity: 1; } 100% { opacity: 0; } }

.tip {
  position: fixed; pointer-events: none; white-space: nowrap;
  padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 500; line-height: 18px;
  background: var(--blue); color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.25);
}
.tip.comment { background: var(--amber); color: #1c1305; }

.parent-chip {
  position: fixed; pointer-events: auto; display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 18px;
  background: var(--yellow); color: #1f1a02; box-shadow: 0 2px 8px rgba(0,0,0,.3);
}
.parent-chip:hover { background: #fde047; }
.parent-chip .tag { opacity: .7; font-weight: 500; }

.badge {
  position: fixed; pointer-events: auto; min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; display: flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 700; line-height: 1; color: #fff; background: var(--blue);
  border: 1.5px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35);
}
.badge.comment { background: var(--amber); color: #1c1305; }
.badge:hover { transform: scale(1.12); }

/* ---------- Panel ---------- */
.panel {
  position: fixed; right: 16px; bottom: 16px; width: 352px; max-width: calc(100vw - 32px);
  max-height: min(560px, calc(100vh - 32px)); display: flex; flex-direction: column;
  pointer-events: auto; background: var(--bg); color: var(--fg);
  border: 1px solid var(--line-2); border-radius: 14px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.3);
}
.head { display: flex; align-items: center; gap: 2px; padding: 8px 8px 8px 8px; border-bottom: 1px solid var(--line); }
.tabs { display: flex; gap: 2px; flex: 1; }
.tab { padding: 5px 10px; border-radius: 8px; color: var(--muted); font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
.tab:hover { color: var(--fg); background: var(--bg-2); }
.tab.on { color: var(--fg); background: var(--bg-3); }
.count { min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; background: var(--blue); color: #fff; }
.icon-btn { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }
.icon-btn:hover { color: var(--fg); background: var(--bg-2); }

.bar { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.bar .spacer { flex: 1; }
.switch { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
.switch .track { width: 28px; height: 16px; border-radius: 8px; background: var(--bg-3); position: relative; transition: background .15s; }
.switch .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s; }
.switch.on .track { background: var(--blue); }
.switch.on .track::after { transform: translateX(12px); }
.switch.on { color: var(--fg); }
.link-btn { color: var(--muted); padding: 2px 6px; border-radius: 6px; }
.link-btn:hover:not(:disabled) { color: var(--fg); background: var(--bg-2); }
.link-btn.on { color: var(--fg); background: var(--bg-3); }
.link-btn:disabled { opacity: .4; cursor: default; }

.body { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
.helper { color: var(--muted); font-size: 12.5px; }
.helper kbd, .kbd { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 5px; border-radius: 4px; background: var(--bg-3); border: 1px solid var(--line-2); color: var(--fg); }
.status { padding: 8px 10px; border-radius: 9px; background: rgba(59,130,246,.1); border: 1px solid rgba(59,130,246,.3); font-size: 12px; }
.status b { font-weight: 600; }
.status.comment { background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.3); }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--dim); display: flex; justify-content: space-between; align-items: center; }
.empty { color: var(--dim); font-size: 12px; text-align: center; padding: 14px 0; }

.quote { padding: 7px 9px; border-radius: 8px; background: var(--bg-2); border: 1px solid var(--line); color: var(--muted); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 96px; overflow: auto; }
textarea {
  width: 100%; min-height: 76px; resize: vertical; padding: 8px 10px; border-radius: 9px;
  font: inherit; color: var(--fg); background: var(--bg-2); border: 1px solid var(--line-2);
}
textarea::placeholder { color: var(--dim); }
.row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.check { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; cursor: pointer; }
.check input { accent-color: var(--blue); margin: 0; }

.list { display: flex; flex-direction: column; gap: 6px; }
.item { position: relative; padding: 9px 10px 9px 36px; border-radius: 10px; background: var(--bg-2); border: 1px solid var(--line); cursor: pointer; }
.item:hover { border-color: var(--line-2); background: #1d1e24; }
.item.selected { border-color: rgba(250,204,21,.6); }
.item .num { position: absolute; left: 9px; top: 9px; width: 19px; height: 19px; border-radius: 50%; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; background: var(--blue); color: #fff; }
.item.comment .num { background: var(--amber); color: #1c1305; }
.item .meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); margin-bottom: 4px; padding-right: 22px; min-width: 0; }
.item .type { font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #93b4fb; }
.item.comment .type { color: #fbbf5c; }
.item .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.item .from { color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(248,113,113,.55); white-space: pre-wrap; word-break: break-word; }
.item .visible { color: var(--muted); white-space: pre-wrap; word-break: break-word; }
.item .to { color: var(--fg); white-space: pre-wrap; word-break: break-word; margin-top: 3px; }
.item .note { color: var(--fg); white-space: pre-wrap; word-break: break-word; margin-top: 3px; padding-left: 8px; border-left: 2px solid var(--amber); }
.item .ctx { margin-top: 5px; font-size: 11px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .flag { font-size: 10px; font-weight: 600; padding: 0 5px; border-radius: 4px; background: rgba(248,113,113,.14); color: var(--red); white-space: nowrap; }
.item .flag.other { background: var(--bg-3); color: var(--muted); }
.item .del { position: absolute; right: 6px; top: 6px; width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--dim); }
.item .del:hover { color: var(--red); background: rgba(248,113,113,.1); }

.foot { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); }
.foot .spacer { flex: 1; }
.btn { height: 32px; padding: 0 12px; border-radius: 9px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.btn.ghost { color: var(--muted); border: 1px solid var(--line-2); }
.btn.ghost:hover:not(:disabled) { color: var(--fg); background: var(--bg-2); }
.btn.primary { background: var(--blue); color: #fff; font-weight: 600; }
.btn.primary:hover:not(:disabled) { background: var(--blue-2); }
.btn.amber { background: var(--amber); color: #1c1305; font-weight: 600; }
.btn:disabled { opacity: .45; cursor: default; }
.flavor { color: var(--dim); font-size: 11px; }

.toast {
  position: fixed; right: 16px; bottom: 16px; transform: translateY(-100%) translateY(-12px);
  pointer-events: none; padding: 8px 12px; border-radius: 10px; font-weight: 500;
  background: #f4f4f5; color: #111; box-shadow: 0 8px 24px rgba(0,0,0,.35);
  opacity: 0; transition: opacity .15s;
}
.toast.show { opacity: 1; }
`;
