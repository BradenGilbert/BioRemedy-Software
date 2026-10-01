// BioRemedy CRM — permanent workers.dev address in front of the office PC's Cloudflare quick tunnel.
//
// The CRM runs on the office PC and reaches the internet through a quick tunnel whose
// trycloudflare.com address changes every time the tunnel restarts. This Worker has a fixed address;
// it forwards every request to whatever the current tunnel address is. scripts/live-tunnel.mjs on the
// PC starts the tunnel and registers its new address here (POST /__tunnel with the shared secret).
//
// Bindings (wrangler.toml): KV namespace `CRM` (holds the current tunnel address under ORIGIN_KEY),
// secret `TUNNEL_SECRET`, var `LABEL` (shown on the offline page).
//
// The server builds its sign-on and share links from X-Forwarded-Host and marks its session cookie
// Secure from X-Forwarded-Proto, so both are set to this Worker's address.

const TUNNEL_PATTERN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const originKey = env.ORIGIN_KEY || "origin";

    if (url.pathname === "/__tunnel") {
      if (request.method !== "POST") return new Response("Not found", { status: 404 });
      const auth = request.headers.get("authorization") || "";
      if (!env.TUNNEL_SECRET || auth !== `Bearer ${env.TUNNEL_SECRET}`) return new Response("Forbidden", { status: 403 });
      let body = {};
      try {
        body = await request.json();
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      const origin = String(body.origin || "").replace(/\/+$/, "");
      if (!TUNNEL_PATTERN.test(origin)) return new Response("Only a trycloudflare.com address is accepted", { status: 400 });
      await env.CRM.put(originKey, origin);
      await env.CRM.put(`${originKey}:updatedAt`, new Date().toISOString());
      return Response.json({ ok: true, origin });
    }

    const origin = await env.CRM.get(originKey, { cacheTtl: 30 });
    if (!origin) return offlinePage(env, "not started yet");

    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", "https");
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) headers.set("X-Forwarded-For", clientIp);

    let response;
    try {
      response = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });
    } catch {
      return offlinePage(env, "unreachable");
    }
    // Cloudflare answers 530 (error 1033) when the tunnel behind the address is gone; the CRM server
    // itself never sends 530.
    if (response.status === 530) return offlinePage(env, "tunnel down");

    const location = response.headers.get("location");
    if (location && location.startsWith(origin)) {
      const rewritten = new Headers(response.headers);
      rewritten.set("location", `https://${url.host}${location.slice(origin.length)}`);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: rewritten });
    }
    return response;
  },
};

function offlinePage(env, reason) {
  const label = env.LABEL || "BioRemedy CRM";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label} is offline</title>
<style>body{font:16px/1.5 system-ui,"Segoe UI",sans-serif;color:#13241b;background:#f4f7f5;margin:0;display:grid;place-items:center;min-height:100vh}
main{max-width:30rem;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:1.3rem;margin:0 0 .5rem}p{margin:.4rem 0;color:#3d5246}</style></head>
<body><main><h1>${label} is offline right now</h1><p>The office computer that runs it is off or restarting. Try again in a few minutes.</p>
<p>Field app users: work you capture offline is kept on your phone and sends when the CRM is back.</p><p style="font-size:.8rem;color:#7a8a80">(${reason})</p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "60", "cache-control": "no-store" } });
}
