// Cloudflare Turnstile — low-friction, privacy-respecting bot check.
//
// Returns a fresh single-use token to send with a protected request, or `undefined` when no
// site key is configured (so the app works exactly as before until you set VITE_TURNSTILE_SITE_KEY
// at build + TURNSTILE_SECRET on the server). Renders a throwaway INVISIBLE widget per call — fine
// for the infrequent "submit"/"register interest" actions; usually silent for real users.
//
// The site key is read here (a client-only module) rather than config.js, which is also imported
// server-side where import.meta.env is undefined.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

let _scriptPromise = null;
function loadTurnstile() {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

export async function turnstileToken() {
  const sitekey = SITE_KEY;
  if (!sitekey) return undefined; // gate disabled → the server no-ops the check

  await loadTurnstile();
  for (let i = 0; i < 150 && !window.turnstile; i++) await new Promise(r => setTimeout(r, 30));
  if (!window.turnstile) throw new Error('Turnstile unavailable');

  return new Promise((resolve, reject) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0';
    document.body.appendChild(holder);
    let id;
    const done = fn => { try { window.turnstile.remove(id); } catch {} holder.remove(); fn(); };
    id = window.turnstile.render(holder, {
      sitekey,
      size: 'invisible',
      callback: token => done(() => resolve(token)),
      'error-callback': () => done(() => reject(new Error('captcha error'))),
      'timeout-callback': () => done(() => reject(new Error('captcha timeout'))),
    });
    try { window.turnstile.execute(id); } catch (e) { done(() => reject(e)); }
  });
}
