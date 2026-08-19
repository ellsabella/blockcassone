// Load the wallet-widget bundle inside a VM context whose global is a happy-dom window,
// to catch load-time crashes (missing polyfills, bad imports) before a human tests in a
// real browser. Not a full render test — but it reliably surfaces the "throws during
// init()" failure that leaves an empty, dead connect button.
import { Window } from 'happy-dom';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const win = new Window({ url: 'http://localhost:3000/viewer/' });
win.document.body.innerHTML = '<div data-wallet-widget></div>';

win.fetch = async (u) => {
  if (String(u).includes('/dev-config')) return { ok: true, json: async () => ({ walletConnectProjectId: '8695d0f6c323eb1b7b4a49876f680a85' }) };
  return { ok: true, json: async () => ({}), text: async () => '' };
};
win.matchMedia = win.matchMedia || (() => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
win.global = win;
win.process = { env: {}, browser: true, version: 'v18.0.0', nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) };
if (!win.window) win.window = win;

let asyncErr = null;
process.on('unhandledRejection', (e) => { asyncErr = asyncErr || e; });

const ctx = vm.createContext(win);
const bundlePath = process.argv[2] || new URL('../viewer/vendor/wallet-widget.js', import.meta.url);
const code = readFileSync(bundlePath, 'utf8');
try {
  vm.runInContext(code, ctx, { filename: 'wallet-widget.js' });
  console.log('[smoke] bundle evaluated without a synchronous throw');
} catch (e) {
  console.error('[smoke] SYNC CRASH at load:\n', (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e));
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 3000));
const mount = win.document.querySelector('[data-wallet-widget]');
console.log('[smoke] window.TheBLOCKWallet present:', !!win.TheBLOCKWallet);
console.log('[smoke] mount innerHTML length:', mount ? mount.innerHTML.length : '(no mount)');
console.log('[smoke] mount preview:', mount ? mount.innerHTML.slice(0, 220).replace(/\s+/g, ' ') : '');
if (asyncErr) console.error('[smoke] ASYNC ERROR during init:', asyncErr.stack ? asyncErr.stack.split('\n').slice(0, 5).join('\n') : asyncErr);
process.exit(0);
