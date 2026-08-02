// Sign in with Connections.
//
// A confidential OAuth client against AEGIS (accounts.connections.icu), which is
// the canonical identity plane. The Worker holds the client secret and does the
// code exchange, so nothing sensitive reaches the browser: the SPA only ever
// sees a session cookie.
//
// The account exists for one reason: an owned feed is re-synced on the schedule,
// an unowned one is fetched once and then left alone.

const SESSION_COOKIE = "iw_session";
const STATE_COOKIE = "iw_oauth_state";

// Long enough that Radarr users are not signing in constantly, short enough that
// a leaked cookie is not forever.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const STATE_TTL_SECONDS = 60 * 10;

// The opaque subject is all a third-party app gets, and all this app needs: it
// is a stable per-user key to hang feed ownership on. No email, no profile.
const SCOPES = ["openid", "profile"];

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload, secret) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${base64UrlEncode(signature)}`;
}

async function unsign(token, secret) {
  const [body, signature] = String(token ?? "").split(".");
  if (!body || !signature) {
    return null;
  }

  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    base64UrlDecodeToBytes(signature),
    new TextEncoder().encode(body),
  );
  if (!ok) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(body)));
    // An expiry the holder cannot edit is the point of signing it.
    return payload?.exp && payload.exp * 1000 > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

function cookie(name, value, maxAge) {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    // Lax rather than Strict: the OAuth callback is a top-level cross-site
    // redirect back from AEGIS, and Strict would drop the cookie on arrival.
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  return attributes.join("; ");
}

export function isAuthConfigured(env) {
  return Boolean(env.CONNECTIONS_CLIENT_ID && env.CONNECTIONS_CLIENT_SECRET && env.SESSION_SECRET);
}

function issuer(env) {
  return (env.CONNECTIONS_ISSUER ?? "https://accounts.connections.icu").replace(/\/+$/, "");
}

function callbackUrl(env, request) {
  const origin = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  return `${origin.replace(/\/+$/, "")}/auth/callback`;
}

/**
 * Read the signed-in subject, or null. Never throws: a bad or expired cookie is
 * simply a signed-out visitor.
 */
export async function getSession(request, env) {
  if (!env.SESSION_SECRET) {
    return null;
  }

  const payload = await unsign(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  return payload?.sub ? { sub: payload.sub, name: payload.name ?? null } : null;
}

export async function startLogin(request, env) {
  if (!isAuthConfigured(env)) {
    return new Response("Sign in is not configured.", { status: 503 });
  }

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/";
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  // The state lives in a signed cookie rather than server storage: it has to
  // survive a round trip through AEGIS and nothing else needs to read it.
  const stateToken = await sign(
    { state, returnTo: returnTo.startsWith("/") ? returnTo : "/", exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS },
    env.SESSION_SECRET,
  );

  const authorize = new URL(`${issuer(env)}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.CONNECTIONS_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", callbackUrl(env, request));
  authorize.searchParams.set("scope", SCOPES.join(" "));
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      "set-cookie": cookie(STATE_COOKIE, stateToken, STATE_TTL_SECONDS),
    },
  });
}

export async function completeLogin(request, env) {
  if (!isAuthConfigured(env)) {
    return new Response("Sign in is not configured.", { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = await unsign(readCookie(request, STATE_COOKIE), env.SESSION_SECRET);

  // A mismatched state is the CSRF check doing its job, so say so plainly rather
  // than redirecting into a confusing half-signed-in page.
  if (!code || !state || !stored || stored.state !== state) {
    return new Response("Sign-in could not be verified. Start again from the site.", { status: 400 });
  }

  const tokenResponse = await fetch(`${issuer(env)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(env, request),
      client_id: env.CONNECTIONS_CLIENT_ID,
      client_secret: env.CONNECTIONS_CLIENT_SECRET,
    }),
  });

  if (!tokenResponse.ok) {
    return new Response(`Sign-in failed at the token step (${tokenResponse.status}).`, { status: 502 });
  }

  const tokens = await tokenResponse.json();
  const sub = await readSubject(tokens, env);
  if (!sub) {
    return new Response("Sign-in succeeded but returned no account id.", { status: 502 });
  }

  const session = await sign(
    { sub: sub.sub, name: sub.name, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    env.SESSION_SECRET,
  );

  const headers = new Headers({ location: stored.returnTo || "/" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS));
  headers.append("set-cookie", cookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

// Prefer userinfo over decoding the access token: the token's shape is the
// server's business, while userinfo is the documented contract.
async function readSubject(tokens, env) {
  if (!tokens?.access_token) {
    return null;
  }

  try {
    const response = await fetch(`${issuer(env)}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
    });
    if (response.ok) {
      const info = await response.json();
      if (info?.sub) {
        return { sub: String(info.sub), name: info.name ?? info.preferred_username ?? null };
      }
    }
  } catch {}

  // Fall back to the id_token's subject claim if userinfo is unavailable.
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(String(tokens.id_token).split(".")[1])));
    return claims?.sub ? { sub: String(claims.sub), name: claims.name ?? null } : null;
  } catch {
    return null;
  }
}

export function logout() {
  const headers = new Headers({ location: "/" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
