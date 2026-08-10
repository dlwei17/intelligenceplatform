/**
 * Cloudflare Pages entry point.
 *
 * Keep the portal and its API on the same protected hostname. API requests
 * are passed to the dedicated Worker through the `API` service binding; all
 * other requests are served from this Pages project's static assets.
 */

const API_PATHS = new Set(["/api/data", "/api/file"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (API_PATHS.has(url.pathname)) {
      return env.API.fetch(request);
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    // Client slugs such as /faropoint are virtual routes. Serve the portal
    // shell without changing the visible URL so client.html can read the slug.
    const portalUrl = new URL(request.url);
    portalUrl.pathname = "/client";
    portalUrl.search = "";
    return env.ASSETS.fetch(new Request(portalUrl, request));
  },
};
