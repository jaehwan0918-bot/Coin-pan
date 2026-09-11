const APP_VERSION = '15.31.29';
const FIXED_BASE = 'https://api.upbit.com';
const CACHE_TTL_SECONDS = 60;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const RATE = new Map();

const API_SECURITY_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
});

function json(status, body, extraHeaders = {}) {
  const headers = new Headers(API_SECURITY_HEADERS);
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}

function validMarket(value) {
  return /^KRW-[A-Z0-9]{2,10}$/.test(String(value || ''));
}

function validTf(value) {
  return ['1', '3', '5', '10', '15', '30', '60', '240', 'day'].includes(String(value || ''));
}

function clientIp(request) {
  return String(
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for') ||
    'unknown'
  ).split(',')[0].trim();
}

function rateLimit(request, limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const ip = clientIp(request);
  const now = Date.now();
  let entry = RATE.get(ip);
  if (!entry || now - entry.start >= windowMs) entry = { start: now, count: 0 };
  entry.count += 1;
  RATE.set(ip, entry);
  if (RATE.size > 1000) {
    for (const [key, value] of RATE) {
      if (now - value.start > windowMs * 2) RATE.delete(key);
    }
  }
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upbitFetch(path, { timeout = 7000, retries = 2 } = {}) {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${FIXED_BASE}${path}`, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': `CoinNachimpan/${APP_VERSION}`,
        },
      });
      clearTimeout(timer);
      if (!response.ok) {
        const error = new Error(`Upbit HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (i < retries) await sleep(250 * (2 ** i));
    }
  }
  throw lastError;
}

function normalizeCandles(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Invalid Upbit candle payload');
  const candles = rows.map((row) => {
    const utc = String(row.candle_date_time_utc || '');
    const parsed = utc ? Date.parse(utc.endsWith('Z') ? utc : `${utc}Z`) : NaN;
    return {
      t: Number.isFinite(parsed) ? parsed : Number(row.timestamp),
      o: Number(row.opening_price),
      h: Number(row.high_price),
      l: Number(row.low_price),
      c: Number(row.trade_price),
      v: Number(row.candle_acc_trade_volume),
    };
  }).reverse();

  const valid = candles.every((x, i) =>
    [x.t, x.o, x.h, x.l, x.c, x.v].every(Number.isFinite) &&
    x.t > 0 && x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0 && x.v >= 0 &&
    x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.h >= x.l &&
    (i === 0 || x.t > candles[i - 1].t)
  );
  if (!valid) throw new Error('Invalid Upbit candle payload');
  return candles;
}

function cacheRequest(request, market, tf, count) {
  const url = new URL(request.url);
  url.pathname = '/__coin_nachimpan_cache/candles';
  url.search = new URLSearchParams({ market, tf, count: String(count) }).toString();
  return new Request(url.toString(), { method: 'GET' });
}

async function cacheRead(request, market, tf, count, ctx) {
  try {
    const cache = caches.default;
    const key = cacheRequest(request, market, tf, count);
    const hit = await cache.match(key);
    if (!hit) return null;
    const payload = await hit.json();
    if (!payload || !Array.isArray(payload.candles)) {
      if (ctx?.waitUntil) ctx.waitUntil(cache.delete(key).catch(() => false));
      return null;
    }
    // Revalidate cached structure so a corrupted cache can never bypass fail-closed rules.
    const candles = payload.candles;
    const valid = candles.every((x, i) =>
      [x.t, x.o, x.h, x.l, x.c, x.v].every(Number.isFinite) &&
      x.t > 0 && x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0 && x.v >= 0 &&
      x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.h >= x.l &&
      (i === 0 || x.t > candles[i - 1].t)
    );
    if (!valid) {
      if (ctx?.waitUntil) ctx.waitUntil(cache.delete(key).catch(() => false));
      return null;
    }
    return candles;
  } catch {
    return null;
  }
}

function cacheWrite(request, market, tf, count, candles, ctx) {
  if (!ctx?.waitUntil) return;
  try {
    const cache = caches.default;
    const key = cacheRequest(request, market, tf, count);
    const response = new Response(JSON.stringify({ candles }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(key, response).catch(() => undefined));
  } catch {
    // Cache is an optimization only; live analysis must still work if cache operations fail.
  }
}

async function candlesEndpoint(request, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const rl = rateLimit(request);
  if (!rl.ok) return json(429, { error: 'rate_limited', retryAfterSeconds: 60 }, { 'retry-after': '60' });

  const url = new URL(request.url);
  const market = String(url.searchParams.get('market') || 'KRW-BTC').toUpperCase();
  const tf = String(url.searchParams.get('tf') || '240');
  const rawCount = Number(url.searchParams.get('count') || 200);
  const count = Math.max(60, Math.min(200, Number.isFinite(rawCount) ? (rawCount | 0) : 200));
  if (!validMarket(market) || !validTf(tf)) return json(400, { error: 'invalid_parameters' });

  const cached = await cacheRead(request, market, tf, count, ctx);
  if (cached) return json(200, { source: 'UPBIT CACHE', candles: cached });

  try {
    const path = tf === 'day'
      ? `/v1/candles/days?market=${encodeURIComponent(market)}&count=${count}`
      : `/v1/candles/minutes/${tf}?market=${encodeURIComponent(market)}&count=${count}`;
    const rows = await upbitFetch(path);
    const candles = normalizeCandles(rows);
    cacheWrite(request, market, tf, count, candles, ctx);
    return json(200, { source: 'UPBIT PUBLIC API', candles });
  } catch (error) {
    return json(502, {
      error: 'upstream_unavailable',
      message: String(error?.message || error).slice(0, 160),
    });
  }
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/api/candles') return candlesEndpoint(request, ctx);
  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    return json(200, {
      ok: true,
      service: 'coin-nachimpan',
      version: APP_VERSION,
      platform: 'cloudflare-workers',
      paidApiRequired: false,
      orderApiEnabled: false,
    });
  }
  if (url.pathname === '/api/version') {
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    return json(200, {
      version: APP_VERSION,
      release: `V${APP_VERSION}`,
      mode: 'personal-local-first',
      platform: 'cloudflare-workers',
    });
  }
  if (url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
  if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
  return new Response('Not found', { status: 404 });
}

export default { fetch: route };
