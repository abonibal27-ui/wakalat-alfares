(function () {
  'use strict';

  const EMAIL_KEY = 'abn_firebase_auth_email';
  let appLoaded = false;

  function byId(id) { return document.getElementById(id); }
  function txt(value) {
    const box = document.createElement('textarea');
    box.innerHTML = value;
    return box.value;
  }
  const MSG = {
    firebaseNotReady: txt('Firebase Auth &#x063A;&#x064A;&#x0631; &#x062C;&#x0627;&#x0647;&#x0632;. &#x0627;&#x0641;&#x062A;&#x062D; &#x0627;&#x0644;&#x0646;&#x0638;&#x0627;&#x0645; &#x0645;&#x0646; &#x0631;&#x0627;&#x0628;&#x0637; HTTPS &#x0627;&#x0644;&#x0631;&#x0633;&#x0645;&#x064A;.'),
    invalid: txt('&#x0627;&#x0644;&#x0628;&#x0631;&#x064A;&#x062F; &#x0623;&#x0648; &#x0643;&#x0644;&#x0645;&#x0629; &#x0645;&#x0631;&#x0648;&#x0631; Firebase &#x063A;&#x064A;&#x0631; &#x0635;&#x062D;&#x064A;&#x062D;&#x0629;.'),
    disabled: txt('&#x0647;&#x0630;&#x0627; &#x0627;&#x0644;&#x0645;&#x0633;&#x062A;&#x062E;&#x062F;&#x0645; &#x0645;&#x0639;&#x0637;&#x0644; &#x0641;&#x064A; Firebase.'),
    network: txt('&#x0641;&#x0634;&#x0644; &#x0627;&#x0644;&#x0627;&#x062A;&#x0635;&#x0627;&#x0644; &#x0628;&#x0627;&#x0644;&#x0625;&#x0646;&#x062A;&#x0631;&#x0646;&#x062A;.'),
    required: txt('&#x0623;&#x062F;&#x062E;&#x0644; &#x0627;&#x0644;&#x0628;&#x0631;&#x064A;&#x062F; &#x0627;&#x0644;&#x0625;&#x0644;&#x0643;&#x062A;&#x0631;&#x0648;&#x0646;&#x064A; &#x0648;&#x0643;&#x0644;&#x0645;&#x0629; &#x0645;&#x0631;&#x0648;&#x0631; Firebase.'),
    generic: txt('&#x0641;&#x0634;&#x0644; &#x062A;&#x0633;&#x062C;&#x064A;&#x0644; &#x0627;&#x0644;&#x062F;&#x062E;&#x0648;&#x0644; &#x0639;&#x0628;&#x0631; Firebase.'),
    authFirst: txt('&#x064A;&#x062C;&#x0628; &#x062A;&#x0633;&#x062C;&#x064A;&#x0644; &#x0627;&#x0644;&#x062F;&#x062E;&#x0648;&#x0644; &#x0639;&#x0628;&#x0631; Firebase &#x0623;&#x0648;&#x0644;&#x0627;.'),
    loadFailed: txt('&#x062A;&#x0645; &#x062A;&#x0633;&#x062C;&#x064A;&#x0644; &#x0627;&#x0644;&#x062F;&#x062E;&#x0648;&#x0644;&#x060C; &#x0644;&#x0643;&#x0646; &#x0641;&#x0634;&#x0644; &#x062A;&#x062D;&#x0645;&#x064A;&#x0644; &#x0628;&#x064A;&#x0627;&#x0646;&#x0627;&#x062A; &#x0627;&#x0644;&#x062A;&#x0637;&#x0628;&#x064A;&#x0642;. &#x0623;&#x0639;&#x062F; &#x062A;&#x062D;&#x062F;&#x064A;&#x062B; &#x0627;&#x0644;&#x0635;&#x0641;&#x062D;&#x0629;.')
  };

  function getAuth() {
    if (!window.firebase || !firebase.auth) throw new Error(MSG.firebaseNotReady);
    return firebase.auth();
  }
  function setError(message) {
    const el = byId('auth-error');
    if (!el) return;
    el.textContent = message || MSG.generic;
    el.style.display = 'block';
  }
  function clearError() {
    const el = byId('auth-error');
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }
  function mapAuthError(error) {
    const code = String(error && error.code || '');
    if (code === 'auth/invalid-login-credentials' || code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return MSG.invalid;
    if (code === 'auth/user-disabled') return MSG.disabled;
    if (code === 'auth/network-request-failed') return MSG.network;
    return error && error.message ? error.message : MSG.generic;
  }
  function rememberEmail(email) { try { if (email) localStorage.setItem(EMAIL_KEY, email); } catch (_) {} }
  function restoreEmail() {
    const emailEl = byId('firebase-auth-email');
    if (!emailEl || emailEl.value) return;
    try { emailEl.value = localStorage.getItem(EMAIL_KEY) || ''; } catch (_) {}
  }
  function showLogin() {
    const overlay = byId('auth-overlay'), main = byId('main-container'), header = byId('app-header');
    if (overlay) overlay.style.display = 'flex';
    if (main) main.style.display = 'none';
    if (header) header.style.display = 'none';
    const passEl = byId('firebase-auth-password');
    if (passEl) passEl.value = '';
    restoreEmail();
  }
  function showApp() {
    const overlay = byId('auth-overlay'), main = byId('main-container'), header = byId('app-header');
    if (overlay) overlay.style.display = 'none';
    if (main) main.style.display = 'block';
    if (header) header.style.display = 'flex';
    const passEl = byId('firebase-auth-password');
    if (passEl) passEl.value = '';
  }
  async function loadAppDataAfterAuth(user) {
    showApp();
    if (!appLoaded) {
      appLoaded = true;
      if (typeof window.initApp === 'function') await window.initApp(user);
      else if (typeof initApp === 'function') await initApp(user);
    } else if (typeof window.updateAllUI === 'function') {
      window.updateAllUI();
    }
  }
  async function login(event) {
    if (event && event.preventDefault) event.preventDefault();
    clearError();
    const email = String((byId('firebase-auth-email') && byId('firebase-auth-email').value) || '').trim().toLowerCase();
    const password = String((byId('firebase-auth-password') && byId('firebase-auth-password').value) || '');
    if (!email || !password) { setError(MSG.required); return false; }
    try {
      const auth = getAuth();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await auth.signInWithEmailAndPassword(email, password);
      rememberEmail(email);
      clearError();
      return true;
    } catch (error) {
      console.error('[ABONIBAL Auth] Login failed:', error);
      setError(mapAuthError(error));
      return false;
    }
  }
  async function logout(event) {
    if (event && event.preventDefault) event.preventDefault();
    try { await getAuth().signOut(); } catch (error) { console.warn('[ABONIBAL Auth] Sign-out warning:', error); }
    appLoaded = false;
    showLogin();
  }
  async function ensureFirebaseAccess() {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user || !user.uid) throw new Error(MSG.authFirst);
    return { ok: true, uid: user.uid, accountId: user.uid, email: user.email || '' };
  }
  async function boot() {
    restoreEmail();
    const loginBtn = byId('firebase-login-btn');
    const passwordEl = byId('firebase-auth-password');
    if (loginBtn) loginBtn.addEventListener('click', login);
    if (passwordEl) passwordEl.addEventListener('keydown', event => { if (event.key === 'Enter') login(event); });
    try {
      const auth = getAuth();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      auth.onAuthStateChanged(user => {
        if (user) {
          rememberEmail(user.email || '');
          clearError();
          loadAppDataAfterAuth(user).catch(error => { console.error('[ABONIBAL Auth] App load failed:', error); setError(MSG.loadFailed); });
        } else {
          appLoaded = false;
          showLogin();
        }
      });
    } catch (error) {
      console.error('[ABONIBAL Auth] Boot failed:', error);
      setError(mapAuthError(error));
      showLogin();
    }
  }
  window.ABNAuth = { login, logout, showLogin, showApp, ensureFirebaseAccess };
  window.lockApplication = logout;
  window.ensureFirebaseAccess = ensureFirebaseAccess;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
