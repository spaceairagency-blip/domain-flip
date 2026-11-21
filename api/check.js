import { verify } from './_auth.js';

const mem = { price: { at: 0, d: null }, boot: { at: 0, d: null } };
const T = (ms) => AbortSignal.timeout(ms);
const settle = (p) => p.catch(() => null);

// Porkbun publishes TLD pricing without an API key.
async function prices() {
  if (mem.price.d && Date.now() - mem.price.at < 36e5) return mem.price.d;
  const r = await fetch('https://api.porkbun.com/api/json/v3/pricing/get', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: T(3500),
  });
  const d = await r.json();
  if (d.status !== 'SUCCESS') throw new Error('Pricing unavailable');
  mem.price = { at: Date.now(), d: d.pricing };
  return d.pricing;
}

// IANA lists the official RDAP server for each extension (more reliable than rdap.org).
async function bootstrap() {
  if (mem.boot.d && Date.now() - mem.boot.at < 864e5) return mem.boot.d;
  const j = await (await fetch('https://data.iana.org/rdap/dns.json', { signal: T(3500) })).json();
  const map = {};
  for (const [tlds, urls] of j.services) for (const t of tlds) map[t] = urls.find((u) => u.startsWith('https')) || urls[0];
  mem.boot = { at: Date.now(), d: map };
  return map;
}

async function rdap(domain, base) {
  if (!base) return null;
  try {
    const r = await fetch(base.replace(/\/?$/, '/') + 'domain/' + domain, {
      headers: { Accept: 'application/rdap+json' }, redirect: 'follow', signal: T(3500),
    });
    if (r.status === 404) return { status: 'available' };
    if (r.ok) {
      const j = await r.json();
      const ev = (j.events || []).find((e) => e.eventAction === 'expiration');
      return { status: 'taken', expires: ev?.eventDate?.slice(0, 10) };
    }
  } catch {}
  return null;
}

// Fallback: NXDOMAIN with no NS records usually means the name is unregistered.
async function dns(domain) {
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?type=NS&name=' + domain, {
      headers: { Accept: 'application/dns-json' }, signal: T(2500),
    });
    const j = await r.json();
    if (j.Status === 3) return { status: 'available', likely: true };
    if (j.Status === 0) return { status: 'taken' };
  } catch {}
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!verify(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { names, cheap } = req.body || {};
  const [pr, boot] = await Promise.all([settle(prices()), settle(bootstrap())]);

  if (cheap) {
    if (!pr) return res.status(502).json({ error: 'Could not load pricing right now' });
    const list = Object.entries(pr)
      .map(([tld, v]) => ({ tld, reg: +v.registration, renew: +v.renewal }))
      .filter((x) => Number.isFinite(x.reg) && x.reg > 0)
      .sort((a, b) => a.reg - b.reg)
      .slice(0, 25);
    return res.json({ cheapest: list });
  }

  const ok = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{2,24})+$/;
  const list = (Array.isArray(names) ? names : []).map((n) => String(n).toLowerCase()).filter((n) => ok.test(n)).slice(0, 30);
  if (!list.length) return res.status(400).json({ error: 'No valid domains' });

  const results = await Promise.all(list.map(async (domain) => {
    const parts = domain.split('.');
    const [a, b] = await Promise.all([rdap(domain, boot?.[parts[parts.length - 1]]), dns(domain)]);
    const r = a || b || { status: 'unknown' };
    const p = pr?.[parts.slice(1).join('.')];
    return { domain, ...r, price: p ? +p.registration : null, renew: p ? +p.renewal : null };
  }));
  res.json({ results });
}
