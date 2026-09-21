var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker-2026-08-24.js
var JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
var GET_ROUTES = /* @__PURE__ */ new Set([
  "/api/data",
  "/api/docs",
  "/api/file",
  "/api/zip",
  "/api/snapdates",
  "/api/diff",
  "/api/asof"
]);
var ALL_ROUTES = /* @__PURE__ */ new Set([...GET_ROUTES, "/api/note"]);
var CLIENT_ROUTE_ALIASES = /* @__PURE__ */ new Map([
  ["oliverstreet", "oliverstreetcapital"],
  ["plymouth", "plymouthreit"],
  ["turnbridge", "turnbridgeequities"],
  ["highstreet", "highstreetlogisticsproperties"]
]);
var DATA_CACHE_VERSION = "v1";
var DATA_CACHE_TTL_SECONDS = 60;
var worker_2026_08_24_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!ALL_ROUTES.has(url.pathname)) {
      return json({ error: "Not found" }, 404);
    }
    const expectedMethod = url.pathname === "/api/note" ? "POST" : "GET";
    if (request.method !== expectedMethod) {
      return json({ error: "Method not allowed" }, 405);
    }
    let email;
    try {
      email = await verifiedEmail(request, env);
    } catch (error) {
      return json({ error: "Not authenticated: " + error.message }, 401);
    }
    const want = canonicalWant(url.searchParams.get("want") || "");
    if (url.pathname === "/api/note") {
      return handleNote(request, env, ctx, email, want);
    }
    return handleGet(url, env, ctx, email, want);
  }
};
function canonicalWant(value) {
  const trimmed = String(value || "").trim();
  return CLIENT_ROUTE_ALIASES.get(trimmed.toLowerCase()) || trimmed;
}
__name(canonicalWant, "canonicalWant");
async function handleGet(url, env, ctx, email, want) {
  const routeConfig = {
    "/api/data": { api: "clientdata" },
    "/api/docs": { api: "doclist" },
    "/api/file": { api: "docfile", input: "id" },
    "/api/zip": { api: "doczip", input: "ids" },
    "/api/snapdates": { api: "snapdates" },
    "/api/diff": { api: "diff", input: "from" },
    "/api/asof": { api: "asof", input: "from" }
  }[url.pathname];
  const target = new URL(env.APPS_SCRIPT_URL);
  target.searchParams.set("api", routeConfig.api);
  target.searchParams.set("s", env.WORKER_SECRET);
  target.searchParams.set("email", email);
  if (want) target.searchParams.set("want", want);
  if (routeConfig.input === "id") {
    const id = (url.searchParams.get("id") || "").trim();
    if (!isDriveId(id)) {
      return json({ error: id ? "Invalid document id" : "No document requested" }, 400);
    }
    target.searchParams.set("id", id);
  }
  if (routeConfig.input === "ids") {
    const rawIds = (url.searchParams.get("ids") || "").trim();
    const ids = rawIds.split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) {
      return json({ error: "No documents selected" }, 400);
    }
    if (ids.length > 100 || ids.some((id) => !isDriveId(id))) {
      return json({ error: "Invalid document selection" }, 400);
    }
    target.searchParams.set("ids", ids.join(","));
  }
  if (routeConfig.input === "from") {
    const from = (url.searchParams.get("from") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return json({ error: from ? "Invalid date" : "No date requested" }, 400);
    }
    target.searchParams.set("from", from);
  }
  let cacheKey;
  const startedAt = Date.now();
  if (url.pathname === "/api/data") {
    cacheKey = await dashboardCacheKey(email, want);
    const cachedResponse = await caches.default.match(cacheKey);
    if (cachedResponse) {
      const cachedPayload = await cachedResponse.json();
      return json(cachedPayload, 200, {
        "X-Portal-Cache": "hit",
        "Server-Timing": `portal;dur=${Date.now() - startedAt}`
      });
    }
  }
  let payload;
  try {
    const response = await fetch(target, { redirect: "follow" });
    if (url.pathname === "/api/snapdates" || routeConfig.input === "from") {
      console.log("Portal history upstream response", {
        route: url.pathname,
        status: response.status,
        contentType: response.headers.get("content-type") || ""
      });
    }
    if (!response.ok) throw new Error("upstream " + response.status);
    payload = await response.json();
  } catch (error) {
    console.error("Portal upstream failure", {
      route: url.pathname,
      type: error && error.name ? error.name : "Error"
    });
    return json({ error: "Data service unavailable" }, 502);
  }
  if (payload && payload.error) {
    return json({ error: String(payload.error), email }, 403);
  }
  if (cacheKey) {
    const cacheResponse = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${DATA_CACHE_TTL_SECONDS}`
      }
    });
    ctx.waitUntil(caches.default.put(cacheKey, cacheResponse));
  }
  return json(payload, 200, cacheKey ? {
    "X-Portal-Cache": "miss",
    "Server-Timing": `portal;dur=${Date.now() - startedAt}`
  } : void 0);
}
__name(handleGet, "handleGet");
async function handleNote(request, env, ctx, email, want) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const projectId = String(body.projectId || "").trim();
  const projectName = String(body.projectName || "").trim();
  const state = String(body.state || body.action || "post").trim().toLowerCase();
  const note = String(body.note || "").trim();
  const index = Number.isInteger(body.index) && body.index >= 0 ? body.index : null;
  if (!projectId) return json({ error: "No project requested" }, 400);
  const actions = /* @__PURE__ */ new Set(["post", "resolve", "delete"]);
  if (!actions.has(state)) {
    return json({ error: "Invalid note action" }, 400);
  }
  if (state === "post" && !note) {
    return json({ error: "Write something first" }, 400);
  }
  if (state === "delete" && index === null) {
    return json({ error: "No comment specified" }, 400);
  }
  if (note.length > 1e3) {
    return json({ error: "Note is too long" }, 400);
  }
  let payload;
  try {
    const response = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        s: env.WORKER_SECRET,
        email,
        want,
        projectId,
        projectName,
        state,
        note,
        index
      })
    });
    if (!response.ok) throw new Error("upstream " + response.status);
    payload = await response.json();
  } catch (error) {
    return json({ error: "Data service unavailable" }, 502);
  }
  if (!payload || !payload.error) {
    ctx.waitUntil(
      dashboardCacheKey(email, want).then((key) => caches.default.delete(key))
    );
  }
  return json(payload, payload && payload.error ? 403 : 200);
}
__name(handleNote, "handleNote");
async function dashboardCacheKey(email, want) {
  const scope = email.toLowerCase() + "\n" + want.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope)
  );
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(
    `https://portal-data-cache.invalid/${DATA_CACHE_VERSION}/${hash}`
  );
}
__name(dashboardCacheKey, "dashboardCacheKey");
function isDriveId(value) {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
__name(isDriveId, "isDriveId");
function json(body, status, extraHeaders) {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}
__name(json, "json");
var cachedKeys = null;
var cachedAt = 0;
var KEY_TTL_MS = 60 * 60 * 1e3;
async function getKeys(env) {
  const now = Date.now();
  if (cachedKeys && now - cachedAt < KEY_TTL_MS) return cachedKeys;
  const response = await fetch(
    "https://" + env.ACCESS_TEAM + ".cloudflareaccess.com/cdn-cgi/access/certs"
  );
  if (!response.ok) throw new Error("could not fetch Access keys");
  const body = await response.json();
  cachedKeys = body.keys || [];
  cachedAt = now;
  return cachedKeys;
}
__name(getKeys, "getKeys");
async function verifiedEmail(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookieValue(request.headers.get("Cookie") || "", "CF_Authorization");
  if (!token) throw new Error("no Access assertion present");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed assertion");
  const header = JSON.parse(b64urlToText(parts[0]));
  const claims = JSON.parse(b64urlToText(parts[1]));
  const keys = await getKeys(env);
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("signing key not recognised");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!valid) throw new Error("signature invalid");
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (claims.exp && nowSeconds >= claims.exp) throw new Error("assertion expired");
  if (claims.nbf && nowSeconds < claims.nbf) {
    throw new Error("assertion not yet valid");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (env.ACCESS_AUD && !audiences.includes(env.ACCESS_AUD)) {
    throw new Error("assertion is for a different application");
  }
  const email = String(claims.email || "").trim().toLowerCase();
  if (!email) throw new Error("assertion carries no email");
  return email;
}
__name(verifiedEmail, "verifiedEmail");
function cookieValue(cookieHeader, name) {
  const match = cookieHeader.split(";").map((value) => value.trim()).find((value) => value.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : "";
}
__name(cookieValue, "cookieValue");
function b64urlToBytes(value) {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}
__name(b64urlToBytes, "b64urlToBytes");
function b64urlToText(value) {
  return new TextDecoder().decode(b64urlToBytes(value));
}
__name(b64urlToText, "b64urlToText");
export {
  worker_2026_08_24_default as default
};
//# sourceMappingURL=worker-2026-08-24.js.map
