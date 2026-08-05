# Deploying the secured client portal

Target end state: `platform.solarkal.com/faropoint` asks the visitor to sign in,
then shows Faropoint's projects. SolarKal staff can change the slug to any
client. A Faropoint contact who changes the slug is refused.

Four files:

| File | Where it goes | Who does it |
|---|---|---|
| `portalWebApp.gs` | Apps Script project | David |
| `client.html` | GitHub repo, `portal/client.html` | David |
| `_redirects` | GitHub repo, `portal/_redirects` | David |
| `worker.js` | Cloudflare Worker | Developer |

Do the steps in this order. Step 3 produces a value that step 4 needs.

---

## Step 0 — generate the shared secret (2 minutes, do this first)

The Worker proves it is the Worker by presenting a secret to Apps Script.
While that secret is still the placeholder string, the endpoint is effectively
open to anyone who has seen the file. **Set it before you deploy, not after.**

In the Apps Script editor, paste this as a temporary function and run it:

```javascript
function makeSecret() {
  Logger.log(Utilities.getUuid().replace(/-/g, '') +
             Utilities.getUuid().replace(/-/g, ''));
}
```

Copy the 64-character result from the execution log. Put it somewhere you can
paste it twice (once in Apps Script, once in Cloudflare), then delete the
function. Do not paste it into email or chat.

---

## Step 1 — Apps Script

Nothing here breaks the existing token links. The `?t=...` portals your clients
may already have keep working exactly as they do today. This step is safe to do
on its own, before any Cloudflare work exists.

1. Open the portal Apps Script project.
2. Replace the entire contents of the script file with the new `portalWebApp.gs`.
3. In the `PORTAL` block at the top, set:

   ```javascript
   WORKER_SECRET: 'paste-the-64-character-secret-here'
   ```

4. Also in the `PORTAL` block, change `HTML_URL` to point at the new location
   (see step 2 for why it moves):

   ```javascript
   HTML_URL: 'https://raw.githubusercontent.com/dlwei17/intelligenceplatform/main/portal/client.html',
   ```

5. Save.
6. Run `setupAccessSheet` once. This adds the **Domain** column (J) to the
   Access tab without disturbing existing rows. Approve the permissions prompt
   if it appears.
7. Run `flushPortalCache` so the old HTML is not served from cache.
8. **Deploy > Manage deployments > edit the existing deployment > Version: New
   version > Deploy.** Editing the file alone changes nothing on the live URL.
   This has caught us three times.

### Add the staff row

In the Access tab, add one row:

| Account | Contact | Email | Active | Domain |
|---|---|---|---|---|
| `*` | SolarKal team | *(leave blank)* | `TRUE` | `solarkal.com` |

That single row is what gives the whole team access to every portal. Leave
Token blank; run `fillMissingTokens` if you want one generated.

### A note on the Domain column

Leave Domain blank for a client and only the exact emails you list get in.
Fill it in and anyone at that domain gets in, including future hires you never
listed. Use it where one domain maps cleanly to one Account.

Do **not** use Domain for Bain Capital, Oliver Street Capital, Premier Storage
Investors, Staley Point Capital or Bungalow Projects. They share a corporate
domain, so a domain rule cannot tell them apart. Exact emails only.

---

## Step 2 — GitHub

`client.html` moves into a `portal/` subfolder so that Cloudflare Pages can
publish that folder and nothing else. If you publish the repo root instead, the
internal Intelligence Platform (`index.html`) ends up served from the client's
domain, which is confusing even though it is not a data leak.

One copy of the file, two consumers: Apps Script reads it over raw.githubusercontent,
Pages publishes it. That avoids the drift that has bitten this project before.

In the `dlwei17/intelligenceplatform` repo:

1. Create a folder `portal/`.
2. Put the new `client.html` in it (move it out of the root).
3. Put `_redirects` in it, alongside `client.html`.
4. Leave `index.html` in the repo root, untouched.

`_redirects` contains one live rule, `/* /client.html 200`. That is what makes
`/faropoint` work when no such file exists. It is a rewrite, not a redirect, so
the pretty URL stays in the address bar. Real files still win over the rule, so
this does not shadow anything.

---

## Step 3 — Cloudflare Pages and Access (developer)

### 3a. Pages project

- Connect the `dlwei17/intelligenceplatform` repo.
- Framework preset: **None**. Build command: **empty**.
- **Build output directory: `portal`.** This is the important one.
- Custom domain: `platform.solarkal.com`. Cloudflare creates the DNS record.

Confirm `https://platform.solarkal.com/faropoint` serves the portal shell
before adding Access. It will show an error about data, which is expected at
this point since `/api/data` does not exist yet.

### 3b. Access application

Zero Trust > Access > Applications > Add > Self-hosted.

- Domain: `platform.solarkal.com`, path: leave blank so **every** path is
  protected, including the HTML itself.
- Session duration: 24 hours is a reasonable starting point.
- Login methods: **One-time PIN**, plus **Google** and **Microsoft** (Entra) if
  configured. OTP means no client ever needs an account created for them.

Policy 1, name it *SolarKal staff*: Action **Allow**, include Emails ending in
`@solarkal.com`.

Policy 2, name it *Clients*: Action **Allow**, include Emails ending in the
client domains you are onboarding, plus an Emails list for the individually
named contacts.

Access decides who may reach the site at all. Apps Script decides what each
person sees once they are in. Both layers matter: a client who somehow passes
Access still cannot read another client's data.

**Copy the Application Audience (AUD) tag** from the application's Overview
tab. Step 4 needs it.

---

## Step 4 — Cloudflare Worker (developer)

Create a Worker, paste `worker.js`, and set four variables under
Settings > Variables:

| Variable | Value |
|---|---|
| `APPS_SCRIPT_URL` | the `/exec` URL of the Apps Script deployment |
| `WORKER_SECRET` | the 64-character secret from step 0 (mark as **encrypted**) |
| `ACCESS_TEAM` | your team name, the part before `.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag copied in step 3b |

Route: `platform.solarkal.com/api/*`, zone `solarkal.com`.

Worker routes are evaluated before Pages, so `/api/data` reaches the Worker and
is not caught by the `_redirects` catch-all.

The Worker verifies Cloudflare's signed JWT rather than trusting the
`Cf-Access-Authenticated-User-Email` header. That header is trivially forged by
anything that can reach the Worker directly, so trusting it would undo the
whole exercise.

---

## Step 5 — test before sending anyone a link

Sign in as yourself (`david.wei@solarkal.com`):

- `platform.solarkal.com` — client picker listing every account
- `platform.solarkal.com/faropoint` — Faropoint's data
- `platform.solarkal.com/plymouthreit` — Plymouth's data

Then, in a private window, ask one friendly client contact to sign in:

- their own slug — their data
- **another client's slug — must show "This portal belongs to another client."**

That last one is the test that matters. If it shows data instead of refusing,
stop and tell me before sending any links out.

Verified in a unit test of the access logic:

```
DATA: Faropoint              | jane@faropoint.com     /faropoint
REFUSED (not your portal)    | jane@faropoint.com     /plymouthreit
REFUSED (not your portal)    | sam@turnbridge.com     /faropoint
DENIED (no access)           | old@plymouth.com       revoked row
DENIED (no access)           | stranger@gmail.com     unknown
PICKER (all clients)         | david.wei@solarkal.com no slug
DATA: Plymouth REIT (staff)  | david.wei@solarkal.com /plymouthreit
```

---

## Step 6 — after it works

- **Rotate the internal token** `a40c3d99d2e842e688e4`. It has appeared in this
  chat and in screenshots. Run `revokeToken` on it, then
  `RUN_createInternalToken` for a fresh one.
- **Retire the `?t=...` client links.** Once a client is on Cloudflare, run
  `revokeToken` for their old capability URL. Anyone who saved that link keeps
  working until you do.
- Remove `Test Sai` records and the blank-Account row from the Salesforce
  report. They are currently visible to clients.

---

## If something fails

| Symptom | Cause |
|---|---|
| `401 Not authenticated` from `/api/data` | `ACCESS_AUD` wrong, or Access is not protecting the path |
| `502 Data service unavailable` | `APPS_SCRIPT_URL` wrong, or the deployment is not "Anyone" access |
| `403` with your email echoed | Access let you in but no Access-tab row matches. Expected for a stranger; if it is you, check the `*` row |
| Portal loads but shows stale HTML | `flushPortalCache`, or you edited the script without deploying a new version |
| `/faropoint` 404s | `_redirects` is not in the published output directory |
