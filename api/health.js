// فحص سريع: افتح /api/health بعد النشر (لا يكشف المفتاح، فقط هل هو موجود)
export default function handler(req, res){
  const k = (process.env.YOUTUBE_API_KEY || '').trim();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    ok: true,
    node: process.version,
    hasKey: k.length > 0,
    keyLooksPlaceholder: /^your_api_key/i.test(k),
    keyLength: k.length
  }));
}
