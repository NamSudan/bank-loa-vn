// api/push-subscribe.js — Lưu/xóa Web Push subscription vào Redis
// POST { subscription } → lưu
// DELETE { endpoint } → xóa
// GET → trả VAPID public key

const UPSTASH_URL   = process.env.UPSTASH_REDIS_KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
const PUSH_SUBS_KEY = 'push_subscriptions';

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — trả VAPID public key cho frontend
  if (req.method === 'GET') {
    const key = process.env.VAPID_PUBLIC_KEY || '';
    return res.status(200).json({ ok: true, vapidPublicKey: key });
  }

  // POST — đăng ký subscription mới
  if (req.method === 'POST') {
    const { subscription } = req.body || {};
    if (!subscription?.endpoint) {
      return res.status(400).json({ ok: false, error: 'Missing subscription' });
    }
    try {
      await redisCmd('SADD', PUSH_SUBS_KEY, JSON.stringify(subscription));
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // DELETE — hủy subscription
  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ ok: false, error: 'Missing endpoint' });
    try {
      const allResult = await redisCmd('SMEMBERS', PUSH_SUBS_KEY);
      const all = allResult.result || [];
      const toRemove = all.find(s => {
        try { return JSON.parse(s).endpoint === endpoint; } catch { return false; }
      });
      if (toRemove) await redisCmd('SREM', PUSH_SUBS_KEY, toRemove);
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).end();
}
