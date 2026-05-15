// api/sync.js — Phục hồi tin bị miss khi webhook tạm thời không hoạt động
// POST { token, webhookUrl } → { synced: N }
// Flow: deleteWebhook → getUpdates (pending) → lưu tin chưa có → setWebhook lại

const UPSTASH_URL   = process.env.UPSTASH_REDIS_KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
const MAX_PER_DAY   = 500;
const TS_KEY        = 'bank_last_ts';
const DAYS_SET_KEY  = 'bank_days';

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

function dayKey(dateStr) { return `bank_msgs:${dateStr}`; }
function todayStr() { return new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10); }

async function tgApi(token, method, params = {}) {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { token, webhookUrl } = req.body || {};
  if (!token || !webhookUrl) {
    return res.status(400).json({ ok: false, error: 'Missing token or webhookUrl' });
  }

  try {
    // Lấy danh sách update_id đã lưu trong Redis hôm nay (tránh duplicate)
    const date = todayStr();
    const key = dayKey(date);
    const storedResult = await redisCmd('LRANGE', key, '0', String(MAX_PER_DAY - 1));
    const storedIds = new Set(
      (storedResult.result || []).map(s => {
        try { return JSON.parse(s).id; } catch { return null; }
      }).filter(Boolean)
    );

    // Bước 1: Xóa webhook để có thể dùng getUpdates
    await tgApi(token, 'deleteWebhook', { drop_pending_updates: false });

    // Bước 2: Lấy updates đang pending (chưa được acknowledge)
    const updatesRes = await tgApi(token, 'getUpdates', { limit: 100, timeout: 0 });
    const updates = updatesRes.result || [];

    // Bước 3: Lưu tin chưa có vào Redis
    const now = Date.now();
    let synced = 0;

    for (const update of updates) {
      const text = update?.message?.text || update?.channel_post?.text || '';
      if (!text) continue;
      if (storedIds.has(update.update_id)) continue; // đã có rồi

      const msgDate = todayStr(); // theo timezone +7
      const msgKey = dayKey(msgDate);
      const msg = JSON.stringify({ text, id: update.update_id, time: now - (updates.length - synced) * 1000 });

      await redisCmd('LPUSH', msgKey, msg);
      await redisCmd('LTRIM', msgKey, '0', String(MAX_PER_DAY - 1));
      await redisCmd('EXPIRE', msgKey, String(30 * 24 * 60 * 60));
      await redisCmd('SADD', DAYS_SET_KEY, msgDate);
      synced++;
    }

    if (synced > 0) {
      await redisCmd('SET', TS_KEY, String(now));
    }

    // Bước 4: Đăng ký lại webhook
    await tgApi(token, 'setWebhook', { url: webhookUrl });

    return res.status(200).json({ ok: true, synced, total: updates.length });
  } catch(e) {
    // Cố gắng set lại webhook dù sync lỗi
    try { await tgApi(token, 'setWebhook', { url: webhookUrl }); } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  }
}
