import crypto from 'crypto';

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const mac = (v) => crypto.createHmac('sha256', secret()).update(v).digest('hex');

export function sign(hours = 24 * 7) {
  const exp = String(Date.now() + hours * 3600e3);
  return exp + '.' + mac(exp);
}

export function verify(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const [exp, sig] = t.split('.');
  if (!exp || !sig || !secret() || Number(exp) < Date.now()) return false;
  const good = mac(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
