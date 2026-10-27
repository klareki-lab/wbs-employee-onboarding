# Local HR and employee authentication

## Confirmed diagnosis

The username reported in the failed login did not match the username actually created at activation. The activated record has an independent `employee` account linked to the correct employee ID; there is no account under the reported shorter username. A diagnostic request through the real Vite `/api` proxy returned **401 `INVALID_CREDENTIALS`**, with no session cookie issued. Before the fix, the frontend translated every 401 into an expired-session message, hiding the distinction.

There was no evidence that the backend changed an employee account into HR. The frontend did, however, automatically send an already authenticated HR browser from `/login` to `/hr`, including after activating an employee in that same browser profile. It also accepted late `/auth/me` responses and their CSRF tokens without checking whether a newer login/logout had completed. These are now covered by regression tests and corrected. We cannot reconstruct the original Incognito window/profile history from aggregate server metadata alone.

## Current behavior

- `/login` is an explicit login/account-switch page. A current identity is named with a deliberate “continue” link; it never automatically redirects an old HR session over an employee login attempt.
- Activation retains the exact username returned by the backend in navigation state and shows/prefills it on the login page. Activation does not log in or assume a role.
- Accepted login and follow-up `/auth/me` must agree on account ID, username, role and employee linkage before the frontend commits the identity or routes anywhere.
- A session revision prevents late initialization, refresh, login or logout responses from restoring old users or replacing a newer CSRF token. Request helpers no longer mutate auth state for arbitrary stale 401 responses.
- HR login goes to `/hr`; employee login goes to `/dashboard`. Requested return targets cannot cross those areas. Frontend guards deny the wrong role; backend role checks remain authoritative.
- Same-origin tabs receive only a non-secret `session-changed` notification and revalidate the server session. Focus/visibility changes also revalidate. No cookie, password or CSRF value is broadcast or placed in browser storage.
- One browser profile has one active onboarding cookie. Switching accounts intentionally replaces that profile's current session. To keep HR and employee active independently, use the normal profile for HR and a separate Incognito profile for the employee. All open Incognito windows in Chrome share that private profile; close existing private windows yourself if you need a fresh private session.

## Cookie and logout boundary

Development uses **`wbs_onboarding_session`**; production uses **`__Host-wbs_onboarding_session`**. Both are HttpOnly, SameSite=Lax, host-only and path `/`; production is Secure. Generic `session` cookies are ignored and never cleared, so this local app does not interfere with another service using localhost on a different port. Cookies are scoped by host/path, not by port.

The cookie-name change requires one fresh login in each browser profile. Existing accounts, invitation records, AI results and SMTP configuration are preserved; legacy session rows expire normally. Only the app-specific cookie is issued/cleared.

Logout is idempotent for an expired or missing session and clears the app cookie. For a valid session, CSRF remains mandatory; every logout still requires the allowed Origin. A successful logout invalidates the corresponding database session. The frontend only claims logout when the backend confirms it.

## Rotate an exposed employee password without deleting the account

Use the real username created at activation, not the employee's first name. Run in your own Mac Terminal:

```sh
bash backend/scripts/rotate-local-password.sh <existing-employee-username>
```

Run it from the repository root, or use its absolute path. The operator script asks twice for a new 12–128-character password with hidden input. The password goes only through a process environment variable to the local container; it is not written to a file, command history or logs. Never send it in chat or a screenshot.

The local-only service requires an existing active employee account and refuses HR accounts/production mode. In one transaction it changes only that account's Argon2id password hash and revokes its sessions. Employee/onboarding/invitation records and the username remain intact. Login serializes against password rotation so an old password verified just before rotation cannot create a fresh session afterward. No invitation or reset email is sent; no unauthenticated reset endpoint exists.

The assistant provides this path but does not choose or set the real employee password. After rotating, sign in with the exact existing username and new password in a fresh private window. Sign in as the existing HR user in the normal profile separately. Do not reuse the password exposed in the screenshot.

## Verification

Passed:

- 28 frontend tests, including late HR/401 races, identity mismatch rejection, role return targets, account switching after activation, logout/refresh races, and distinct credential/session error messages.
- Real HTTP/PostgreSQL auth regression in **`onboarding_auth_test`**, SMTP disabled and no mail sent: activation then login, independent cookie jars, correct HR/employee roles, employee rejection from own/other HR detail routes, own-profile binding, forged-role rejection, CSRF/Origin checks, explicit account switching, session rotation, logout invalidation, stale-cookie cleanup and password-rotation isolation.
- Frontend and backend TypeScript builds.
- Normal Chrome direct `/hr` and `/dashboard` navigation without the new app cookie redirected to `/login`, rather than restoring an old HR identity.

A separate auth test database was used; the real employee was not recreated or reset by these tests. Backend tests run sequentially to avoid fixture truncation races when suites share a dedicated test database.

Example focused test invocation (after creating a dedicated `_test` database and applying migrations there):

```sh
DATABASE_URL=postgresql://onboarding:onboarding_local_only@localhost:54329/onboarding_auth_test \
INTERNAL_API_SECRET=local-test-internal-secret-at-least-32-characters \
SMTP_MODE=disabled backend/node_modules/.bin/tsx --test backend/test/auth.test.ts
npm test --prefix frontend
npm run build --prefix frontend
```

Remaining owner interaction: hidden-entry rotation of the exposed real password and authenticated Incognito login with that newly chosen password. Native Computer Use permission is unavailable, and the browser connector only creates normal windows, so authenticated Incognito automation was not claimed. No actual employee password was read, printed or guessed. No new real invitation was sent.

References: [React effect response races](https://react.dev/reference/react/useEffect), [cookie scope](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies), [BroadcastChannel partitioning](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).
