# SolarKal portal API Worker

[`worker.js`](worker.js) is the code downloaded from the live Cloudflare Worker
`solarkal-client-portal-api` on September 21, 2026. It includes the client URL
aliases, document and ZIP downloads, note actions, and all three history routes.

## Production verification

- Active Worker version: `1ffc09ff-01ec-4189-9546-43cfc93a8e37` (100% of traffic)
- Deployed: August 25, 2026
- Verified against Cloudflare: September 21, 2026
- SHA-256 of the downloaded JavaScript: `a1282485fb72d8939f3d8b88db4a665a76b7f20e71bae0684fe1246093444902`

This is the deployed JavaScript bundle, so it includes generated function-name
helpers. The source-map comment refers to the original build; the map is not
included here. The code is preserved exactly as downloaded.

## Two separate Worker files

- `cloudflare/worker.js`: the dedicated backend API Worker. It verifies the
  Cloudflare Access identity and forwards authorized requests to Apps Script.
- [`portal/_worker.js`](../portal/_worker.js): the Cloudflare Pages router. It
  serves portal assets and forwards API requests through the `API` service
  binding to `solarkal-client-portal-api`.

Keep the backend Worker outside the `portal` static publishing directory.
Do not replace `portal/_worker.js` with this file.

## Deployment and settings

This commit records the existing production code. It does not configure
automatic deployment of the backend Worker. The existing GitHub-connected
Pages deployment and the backend Worker are managed separately.

For a future backend change, update `solarkal-client-portal-api` in Cloudflare,
preserve its existing settings, and record the resulting source/version here.
Keep the existing Pages `API` service binding pointed at that Worker.

Runtime settings remain configured in Cloudflare:

- `APPS_SCRIPT_URL`
- `ACCESS_TEAM`
- `ACCESS_AUD`
- `WORKER_SECRET` (encrypted secret)

No runtime values or credentials are included in this folder. Apps Script
continues to control staff/client permissions and document authorization.
