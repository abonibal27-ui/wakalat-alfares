# ABONIBAL ERP — Codex Project Constitution
**Mission:** Refactor and clean the ABONIBAL ERP GitHub repository into a stable Firebase-Auth-only, installable PWA, while preserving all ERP business features.

---

## 0. Operating Principle

Do not keep patch-stacking inside one huge `index.html`.

The current project contains multiple historical layers and overrides, including local/program password flows, DATA-004 R1/R2/R3 phone-login fixes, and later Firebase-auth-only overrides. The mission is to clean the source, not add another patch.

Work must be done from the GitHub repository source on a new branch, not by manually replacing random Firebase Hosting files.

---

## 1. Required Branch

Create and work only on:

```bash
fix/refactor-auth-pwa-split
```

Do not commit directly to `main`.

---

## 2. Non-Negotiable Safety Rules

1. Preserve all ERP business features:
   - products
   - invoices
   - clients
   - suppliers
   - retail sales
   - expenses
   - partners/capital
   - dashboard
   - import/export
   - printing/PDF flows
   - sync/Firebase Realtime Database logic
   - local offline storage where already used

2. Remove only obsolete auth/PWA/cache patch layers, not operational business logic.

3. Never commit secrets:
   - `serviceAccountKey.json`
   - Firebase Admin private keys
   - `.env`
   - `.env.*`
   - `*.local`
   - `node_modules/`

4. Do not expose Firebase Admin SDK or service account credentials in frontend code.

5. Do not delete the Firebase Auth user. The current production UID must remain usable.

6. Do not change Firebase Realtime Database rules unless explicitly requested.

7. Do not migrate database paths to `accounts/{accountId}` in this mission. That is a separate migration.

8. Do not rewrite the project into React, Vue, Angular, Next.js, or a framework. Keep it as plain HTML/CSS/JS unless the repository already uses a build system.

---

## 3. Primary Goal

Make the production app use only Firebase Auth email/password login.

The login screen must show exactly:

- Email
- Firebase password

It must not show:

- program password
- admin password
- local password
- any field requiring an app password separate from Firebase

It must never show this old error again:

```text
كلمة مرور البرنامج غير صحيحة
```

---

## 4. Remove Obsolete Local Password System

Search the full repository and remove or permanently disable all old local/program password code.

Remove references and logic related to:

```text
admin-password
ADMIN_PASS_HASH
abonibalAdminPassHash
local password hash
program password
كلمة مرور البرنامج
changeAdminPassword
changeProgramPassword
verifyLocalProgramPassword
verifyAdminPassword
system/security password hash
sha256 password fallback for program password
DATA-004
R1-ROOT-FIX-HARDENING
R2-PHONE-LOGIN-SYNC-FIX
R3-PHONE-BOOTSTRAP-LOGIN-FIX
local auth compatibility
pending program password
```

Important:
- If a function is used for business security unrelated to login, inspect before deleting.
- But no login path may depend on a local/program password.

---

## 5. Firebase Auth Requirements

Implement a clean auth layer in a dedicated file, preferably:

```text
public/js/auth.js
```

Required behavior:

1. Firebase Auth persistence must be LOCAL.

```js
await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
```

2. Login must call:

```js
firebase.auth().signInWithEmailAndPassword(email, password)
```

3. Logout must call:

```js
firebase.auth().signOut()
```

4. Use `onAuthStateChanged` as the app gate:

```js
firebase.auth().onAuthStateChanged(user => {
  if (user) {
    showApp();
    loadAppDataAfterAuth(user);
  } else {
    showLogin();
  }
});
```

5. App data/sync must not run before Firebase Auth is ready, unless it is purely local UI initialization.

6. Store remembered email only if desired, but do not store password.

7. Firebase errors should be mapped to Arabic messages:
   - `auth/invalid-login-credentials`: البريد أو كلمة مرور Firebase غير صحيحة.
   - `auth/user-disabled`: هذا المستخدم معطل في Firebase.
   - `auth/network-request-failed`: فشل الاتصال بالإنترنت.
   - default: show original Firebase error safely.

---

## 6. Login UI Requirements

The login card must contain only:

```html
<input id="firebase-auth-email" type="email">
<input id="firebase-auth-password" type="password">
<button id="firebase-login-btn">دخول</button>
<div id="auth-error"></div>
```

Allowed helper text:

```text
الدخول يتم فقط عبر البريد الإلكتروني وكلمة مرور حساب Firebase.
```

Forbidden text:

```text
كلمة مرور البرنامج
كلمة مرور البرنامج غير صحيحة
كلمة مرور الدخول المحلية
```

The login button must bind directly to the clean Firebase login function. It must not call an old global `loginApp()` if that function still points to old program-password logic.

---

## 7. Recommended File Structure

Refactor the monolithic file into this structure:

```text
public/
  index.html
  404.html
  manifest.webmanifest
  sw.js
  icons/
    icon-192.png
    icon-512.png
    maskable-192.png
    maskable-512.png
  css/
    styles.css
    invoice.css
    print.css
  js/
    firebase-config.js
    auth.js
    state.js
    storage.js
    sync.js
    products.js
    invoices.js
    clients.js
    suppliers.js
    retail-sales.js
    expenses.js
    dashboard.js
    export.js
    printing.js
    ui.js
    app.js
firebase.json
.gitignore
```

If full splitting is too large for one pass, do it in safe phases:
1. auth cleanup
2. PWA cleanup
3. CSS extraction
4. JS module extraction by feature

Do not break working ERP functions just to split files quickly.

---

## 8. PWA Requirements

`public/index.html` must include:

```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#064e3b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
```

`public/manifest.webmanifest` must include:

```json
{
  "name": "ABONIBAL ERP",
  "short_name": "ABONIBAL",
  "description": "ABONIBAL ERP business management system",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "dir": "rtl",
  "lang": "ar",
  "background_color": "#ecfdf5",
  "theme_color": "#064e3b",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/maskable-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

The installed app should open from:

```text
https://abonibal-production.web.app/
```

and not from GitHub Pages or local file paths.

---

## 9. Service Worker Requirements

Create or replace:

```text
public/sw.js
```

Requirements:
1. It must not keep stale login HTML.
2. It must clear old ABONIBAL caches on activation.
3. It must use network-first for navigation.
4. It may use conservative caching for static icons only.
5. It must call `skipWaiting()` on install and `clients.claim()` on activate.

Recommended service worker:

```js
const CACHE_VERSION = "ABONIBAL-PWA-FINAL-001";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.includes("ABONIBAL") || key.includes("abonibal"))
        .filter(key => !key.startsWith(CACHE_VERSION))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(req, { cache: "no-store" });
      } catch (_) {
        return await caches.match("/index.html") || Response.error();
      }
    })());
    return;
  }

  const url = new URL(req.url);
  const isIcon = url.pathname.startsWith("/icons/");
  if (isIcon) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone());
      return res;
    })());
  }
});
```

Do not use aggressive app-shell caching for `index.html` until auth cleanup is verified.

---

## 10. Firebase Hosting Configuration

`firebase.json` must be:

```json
{
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "/sw.js",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache"
          }
        ]
      },
      {
        "source": "/index.html",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache"
          }
        ]
      },
      {
        "source": "/manifest.webmanifest",
        "headers": [
          {
            "key": "Content-Type",
            "value": "application/manifest+json; charset=utf-8"
          }
        ]
      }
    ]
  }
}
```

---

## 11. Git Ignore

`.gitignore` must include:

```gitignore
node_modules/
serviceAccountKey.json
.env
.env.*
*.local
.DS_Store
firebase-debug.log
.firebaserc.local
```

If `serviceAccountKey.json` or `node_modules/` were already committed, remove them from git tracking without deleting local files:

```bash
git rm --cached serviceAccountKey.json
git rm -r --cached node_modules
```

---

## 12. Validation Commands

Before final commit, run:

```bash
git status
```

Check for forbidden files:

```bash
git ls-files | grep -E "serviceAccountKey|node_modules|\.env"
```

There must be no output.

Search for obsolete auth text:

```bash
grep -R "كلمة مرور البرنامج غير صحيحة\|admin-password\|abonibalAdminPassHash\|PRODUCTION-DATA-004\|PHONE-BOOTSTRAP\|LOCAL-AUTH" public || true
```

There must be no active login logic from those old paths.

Check required PWA files:

```bash
ls public
ls public/icons
```

Required:

```text
index.html
404.html
manifest.webmanifest
sw.js
icons/icon-192.png
icons/icon-512.png
icons/maskable-192.png
icons/maskable-512.png
```

If Node syntax checks are applicable:

```bash
node --check public/js/auth.js
node --check public/js/app.js
node --check public/sw.js
```

If there is no module system yet, extract scripts carefully or run browser DevTools validation.

---

## 13. Manual QA Checklist

After deployment to Firebase Hosting:

Open:

```text
https://abonibal-production.web.app/
```

Then verify:

1. Login screen shows only:
   - email
   - Firebase password

2. Login succeeds with the existing Firebase Auth user.

3. No message appears:
   - `كلمة مرور البرنامج غير صحيحة`

4. Products page opens.

5. Dashboard opens.

6. Existing data loads.

7. Sync status does not show stale local-file/client-only state.

8. Logout signs out from Firebase and returns to login.

9. On Android Chrome:
   - `/manifest.webmanifest` opens
   - `/sw.js` opens
   - base URL opens app
   - Add to Home Screen or Install works
   - installed icon opens standalone app or at minimum opens the correct HTTPS production URL

10. Browser DevTools Console should not show fatal runtime errors.

---

## 14. Deployment

After validation:

```bash
firebase deploy --only hosting
```

Do not deploy GitHub Pages as the production app unless explicitly requested.

Production URL:

```text
https://abonibal-production.web.app/
```

---

## 15. Commit Requirements

Commit message:

```text
fix: refactor auth to Firebase-only and clean PWA install
```

PR summary must include:

```text
Removed:
- old local/program password login flow
- DATA-004 R1/R2/R3 phone password compatibility layers
- stale login overrides
- aggressive stale PWA cache behavior

Kept:
- ERP business features
- Firebase Realtime Database operational data
- product/invoice/client/supplier/sync/printing/export features

Added:
- clean Firebase Auth-only login
- proper PWA manifest/icons/service worker
- Firebase Hosting public folder setup
- security .gitignore protection
```

---

## 16. Rollback Plan

Before merge, keep a tagged backup or branch:

```bash
git branch backup/pre-auth-pwa-refactor
```

If deployment fails, revert the PR and redeploy the previous working hosting version.

Do not patch production manually after this refactor unless the fix is also committed to GitHub.

---

## 17. Final Definition of Done

The mission is complete only when all are true:

- Repository source is clean and maintainable.
- No old local/program password login remains.
- Login uses Firebase Auth only.
- Android phone and laptop both login using the same Firebase email/password.
- PWA files are present and served from Firebase Hosting.
- The app can be added/installed from `https://abonibal-production.web.app/`.
- No secrets are committed.
- Existing ERP features still work.
