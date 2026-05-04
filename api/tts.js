// api/tts.js — Vercel Serverless Function
// Proxy Google Translate TTS để tránh CORS từ trình duyệt
// App gọi: /api/tts?text=xin+chào → server fetch Google TTS → trả về audio

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const text = req.query.text || '';
  if (!text) return res.status(400).json({ error: 'Thiếu text' });

  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, {
      headers: {
        // Giả lập browser để Google không chặn
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Google TTS không phản hồi' });
    }

    // Stream audio về trình duyệt
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 1 ngày
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
