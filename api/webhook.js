// api/webhook.js — Vercel Serverless Function
// Nhận tin từ Telegram → lưu cache → client lấy tức thì

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: Telegram gọi vào khi có tin mới
  if (req.method === 'POST') {
    try {
      const update = req.body;
      const text = update?.message?.text || update?.channel_post?.text || '';
      if (!text) return res.status(200).json({ ok: true });
      global._msgs = global._msgs || [];
      global._msgs.unshift({ text, id: update?.update_id, time: Date.now() });
      if (global._msgs.length > 50) global._msgs = global._msgs.slice(0, 50);
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(200).json({ ok: true });
    }
  }

  // GET: Tool poll lấy tin mới nhất
  if (req.method === 'GET') {
    const since = parseInt(req.query.since || '0');
    global._msgs = global._msgs || [];
    const newMsgs = global._msgs.filter(m => m.time > since);
    return res.status(200).json({ ok: true, messages: newMsgs });
  }

  return res.status(405).end();
}
