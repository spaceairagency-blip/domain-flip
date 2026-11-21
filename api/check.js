import { verify } from './_auth.js';

let cache = { at: 0, data: null };

// Porkbun publishes TLD pricing without an API key.
async function prices() {
  if (cache.data && Date.now() - cache.at < 36e5) return cache.data;
  const r = await fetch('https://api.porkbun.com/api/json/v3/pricing/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json();
  if (d.status !== 'SUCCESS') throw new Error('Pricing unavailable');
  cache = { at: Date.now(), data: d.pricing };
  return d.pricing;
}

// RDAP is the free, official registration lookup: 404 means not registered.
async function rdap(domain) {
  try {
    const r = await fetch('https://rdap.org/domain/' + encodeURIComponent(domain), {
      headers: { Accept: 'application/rdap+json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });
    if (r.status === 404) return { status: 'available' };
    if (r.ok) {
      const j = await r.json();
      const ev = (j.events || []).find((e) => e.eventAction === 'expiration');
      return { status: 'taken', expires: ev?.eventDate?.slice(0, 10) };
    }
  } catch {}
  return { status: 'unknown' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!verify(req)) return res.status(401).json({ error: 'Unauthorized' });

  let pr = null;
  try { pr = await prices(); } catch {}
  const { names, cheap } = req.body || {};

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
    const tld = domain.split('.').slice(1).join('.');
    const p = pr?.[tld];
    let r = await rdap(domain);
    // A 404 for a TLD we have no pricing for may just mean "no RDAP server", so don't claim it's free.
    if (r.status === 'available' && pr && !p) r = { status: 'unknown' };
    return { domain, ...r, price: p ? +p.registration : null, renew: p ? +p.renewal : null };
  }));
  res.json({ results });
}
