// api/webhook.js — Vercel Serverless Function
// Lưu theo từng ngày: bank_msgs:YYYY-MM-DD
// Hỗ trợ: nhận tin, poll timestamp, lấy tin theo ngày, xóa theo ngày, liệt kê ngày

import webpush from 'web-push';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
const PUSH_SUBS_KEY = 'push_subscriptions';
const MAX_PER_DAY   = 500; // tối đa 500 giao dịch/ngày
const TS_KEY        = 'bank_last_ts';
const DAYS_SET_KEY  = 'bank_days'; // Set lưu danh sách các ngày đã có dữ liệu

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

// Gửi Web Push đến tất cả subscriptions (fire-and-forget, không block response)
async function sendPushToAll(payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:admin@bank-loa-vn.app',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    const subsResult = await redisCmd('SMEMBERS', PUSH_SUBS_KEY);
    const subs = subsResult.result || [];
    await Promise.allSettled(subs.map(async subStr => {
      try {
        await webpush.sendNotification(JSON.parse(subStr), JSON.stringify(payload));
      } catch(e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await redisCmd('SREM', PUSH_SUBS_KEY, subStr);
        }
      }
    }));
  } catch(e) { /* không được làm hỏng webhook nếu push lỗi */ }
}

// Key theo ngày: bank_msgs:2026-05-04
function dayKey(dateStr) {
  return `bank_msgs:${dateStr}`;
}

// Lấy ngày hôm nay dạng YYYY-MM-DD theo timezone +7
function todayStr() {
  return new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Ngăn Vercel CDN cache response — bắt buộc để poll realtime hoạt động đúng
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: Telegram webhook → lưu tin vào key ngày hôm nay ──
  if (req.method === 'POST') {
    try {
      const update = req.body;
      const text = update?.message?.text || update?.channel_post?.text || '';
      if (!text) return res.status(200).json({ ok: true });

      const now  = Date.now();
      const date = todayStr();
      const key  = dayKey(date);
      const msg  = JSON.stringify({ text, id: update?.update_id, time: now });

      // Lưu tin vào list của ngày hôm nay
      await redisCmd('LPUSH', key, msg);
      await redisCmd('LTRIM', key, '0', String(MAX_PER_DAY - 1));
      // Đặt TTL 30 ngày cho key này (tự dọn sau 30 ngày)
      await redisCmd('EXPIRE', key, String(30 * 24 * 60 * 60));
      // Thêm ngày vào tập hợp danh sách ngày
      await redisCmd('SADD', DAYS_SET_KEY, date);
      // Cập nhật timestamp để client biết có tin mới
      await redisCmd('SET', TS_KEY, String(now));

      // Gửi Web Push (không await — không block response về Telegram)
      sendPushToAll({ text, time: now });

      return res.status(200).json({ ok: true });
    } catch(e) {
      // Trả 500 để Telegram tự retry — không được trả 200 khi Redis lỗi
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET ?type=ts — Poll timestamp (nhẹ, mỗi 3s) ──
  if (req.method === 'GET' && req.query.type === 'ts') {
    try {
      const result = await redisCmd('GET', TS_KEY);
      return res.status(200).json({ ok: true, ts: result.result || '0' });
    } catch(e) {
      return res.status(200).json({ ok: true, ts: '0' });
    }
  }

  // ── GET ?type=days — Lấy danh sách các ngày có dữ liệu ──
  if (req.method === 'GET' && req.query.type === 'days') {
    try {
      const result = await redisCmd('SMEMBERS', DAYS_SET_KEY);
      const days = (result.result || []).sort().reverse(); // mới nhất lên đầu
      return res.status(200).json({ ok: true, days });
    } catch(e) {
      return res.status(200).json({ ok: true, days: [] });
    }
  }

  // ── GET ?date=YYYY-MM-DD — Lấy tất cả tin của 1 ngày cụ thể ──
  // ── GET ?since=timestamp — Lấy tin mới hôm nay (realtime poll) ──
  if (req.method === 'GET') {
    try {
      // Lấy tin của ngày cụ thể
      if (req.query.date) {
        const date   = req.query.date;
        const key    = dayKey(date);
        const result = await redisCmd('LRANGE', key, '0', String(MAX_PER_DAY - 1));
        const msgs   = (result.result || []).map(m => {
          try { return JSON.parse(m); } catch(e) { return null; }
        }).filter(Boolean).sort((a,b) => a.time - b.time); // sắp xếp cũ → mới
        return res.status(200).json({ ok: true, messages: msgs });
      }

      // Lấy tin mới hôm nay (since=timestamp)
      const since  = parseInt(req.query.since || '0');
      const date   = todayStr();
      const key    = dayKey(date);
      const result = await redisCmd('LRANGE', key, '0', String(MAX_PER_DAY - 1));
      const allMsgs = (result.result || []).map(m => {
        try { return JSON.parse(m); } catch(e) { return null; }
      }).filter(Boolean);

      const newMsgs = allMsgs
        .filter(m => m.time > since)
        .sort((a,b) => a.time - b.time);

      return res.status(200).json({ ok: true, messages: newMsgs });
    } catch(e) {
      return res.status(200).json({ ok: true, messages: [] });
    }
  }

  // ── DELETE ?date=YYYY-MM-DD — Xóa dữ liệu 1 ngày cụ thể ──
  // ── DELETE ?date=all — Xóa toàn bộ ──
  if (req.method === 'DELETE') {
    try {
      // Xóa 1 giao dịch cụ thể theo timestamp
      if (req.query.msgtime) {
        const ts = req.query.msgtime;
        const daysResult = await redisCmd('SMEMBERS', DAYS_SET_KEY);
        const days = daysResult.result || [];
        for (const d of days) {
          const listResult = await redisCmd('LRANGE', dayKey(d), '0', '-1');
          const entries = listResult.result || [];
          const match = entries.find(e => { try { return JSON.parse(e).time == ts; } catch { return false; } });
          if (match) {
            await redisCmd('LREM', dayKey(d), '1', match);
            return res.status(200).json({ ok: true });
          }
        }
        return res.status(404).json({ ok: false, error: 'Not found' });
      }

      const date = req.query.date;
      if (!date) return res.status(400).json({ ok: false, error: 'Missing date param' });

      if (date === 'all') {
        // Xóa tất cả các ngày
        const daysResult = await redisCmd('SMEMBERS', DAYS_SET_KEY);
        const days = daysResult.result || [];
        for (const d of days) {
          await redisCmd('DEL', dayKey(d));
        }
        await redisCmd('DEL', DAYS_SET_KEY);
        await redisCmd('DEL', TS_KEY);
        return res.status(200).json({ ok: true, deleted: days.length });
      } else {
        // Xóa 1 ngày cụ thể
        await redisCmd('DEL', dayKey(date));
        await redisCmd('SREM', DAYS_SET_KEY, date);
        return res.status(200).json({ ok: true, deleted: 1 });
      }
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).end();
}
