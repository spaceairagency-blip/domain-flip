import { verify } from './_auth.js';

// Tried in order. Override with GEMINI_MODELS="model-a,model-b" in Vercel.
const DEFAULT_MODELS = [
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite',
  'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
  'gemini-flash-latest', 'gemini-flash-lite-latest',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!verify(req)) return res.status(401).json({ error: 'Unauthorized' });

  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean);
  if (!keys.length) return res.status(500).json({ error: 'GEMINI_API_KEY is not set in Vercel' });

  const models = (process.env.GEMINI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = models.length ? models : DEFAULT_MODELS;
  const { prompt, json } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const body = {
    systemInstruction: { parts: [{ text: 'You are an expert domain flipping advisor. Be concrete, honest about risk, and concise.' }] },
    contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 30000) }] }],
    generationConfig: json ? { responseMimeType: 'application/json' } : {},
  };

  const errors = [];
  for (const model of list) {
    for (const key of keys) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        const text = d?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
        if (r.ok && text) return res.json({ text, model });
        errors.push(`${model}: ${d?.error?.message || 'empty response'}`.slice(0, 120));
      } catch (e) {
        errors.push(`${model}: ${e.message}`.slice(0, 120));
      }
    }
  }
  res.status(502).json({ error: 'All Gemini models failed', details: errors });
}
