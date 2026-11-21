import { sign } from './_auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set in Vercel' });
  const given = (req.body && req.body.password) || '';
  if (given !== pw) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: sign() });
}
