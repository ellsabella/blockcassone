// Node-builtin shims that Vite provides automatically but esbuild does not. wagmi /
// @walletconnect / @metamask-sdk reference these globals at load time; without them the
// bundle throws before React can mount (symptom: an empty, dead connect button). Injected
// into the widget bundle via esbuild --inject.
import { Buffer as _Buffer } from 'buffer';

if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = _Buffer;
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {},
    version: 'v18.0.0',
    browser: true,
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  };
}
