// api/webhook.js — Vercel Serverless Function
// Telegram → lưu Upstash → client poll timestamp 3s → chỉ lấy tin khi có mới

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const MSG_KEY = 'bank_messages';
const TS_KEY  = 'bank_last_ts';
const MAX_MSGS = 100;

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: Telegram webhook gọi vào khi có tin mới ──
  if (req.method === 'POST') {
    try {
      const update = req.body;
      const text = update?.message?.text || update?.channel_post?.text || '';
      if (!text) return res.status(200).json({ ok: true });

      const now = Date.now();
      const msg = JSON.stringify({ text, id: update?.update_id, time: now });

      // Lưu tin + cập nhật timestamp — chỉ 3 lệnh Redis
      await redisCmd('LPUSH', MSG_KEY, msg);
      await redisCmd('LTRIM', MSG_KEY, '0', String(MAX_MSGS - 1));
      await redisCmd('SET', TS_KEY, String(now));

      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(200).json({ ok: true });
    }
  }

  // ── GET /api/webhook?type=ts — Chỉ lấy timestamp (nhẹ, poll mỗi 3s) ──
  if (req.method === 'GET' && req.query.type === 'ts') {
    try {
      const result = await redisCmd('GET', TS_KEY);
      return res.status(200).json({ ok: true, ts: result.result || '0' });
    } catch(e) {
      return res.status(200).json({ ok: true, ts: '0' });
    }
  }

  // ── GET /api/webhook?since=... — Lấy tin mới (chỉ gọi khi timestamp đổi) ──
  if (req.method === 'GET') {
    try {
      const since = parseInt(req.query.since || '0');
      const today = new Date().toDateString();
      const result = await redisCmd('LRANGE', MSG_KEY, '0', String(MAX_MSGS - 1));
      const allMsgs = (result.result || []).map(m => {
        try { return JSON.parse(m); } catch(e) { return null; }
      }).filter(Boolean);

      const newMsgs = allMsgs.filter(m =>
        m.time > since &&
        new Date(m.time).toDateString() === today
      );
      return res.status(200).json({ ok: true, messages: newMsgs });
    } catch(e) {
      return res.status(200).json({ ok: true, messages: [] });
    }
  }

  return res.status(405).end();
}
