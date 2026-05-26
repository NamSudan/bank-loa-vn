// api/account-labels.js — Lưu/đọc tên tài khoản STK vào Redis Hash
// Đồng bộ nhãn STK giữa các thiết bị

const UPSTASH_URL   = process.env.UPSTASH_REDIS_KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
const LABELS_KEY    = 'bank_account_labels';

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const r = await redisCmd('HGETALL', LABELS_KEY);
    // HGETALL trả về mảng phẳng [field1, val1, field2, val2, ...]
    const raw = r.result || [];
    const labels = {};
    for (let i = 0; i < raw.length; i += 2) labels[raw[i]] = raw[i + 1];
    return res.json({ ok: true, labels });
  }

  if (req.method === 'POST') {
    const { stk, label } = req.body || {};
    if (!stk) return res.status(400).json({ ok: false, error: 'missing stk' });
    if (label) {
      await redisCmd('HSET', LABELS_KEY, stk, label);
    } else {
      await redisCmd('HDEL', LABELS_KEY, stk);
    }
    return res.json({ ok: true });
  }

  return res.status(405).json({ ok: false });
}
