// TrendRadar — منطق الـ API المشترك بين Vercel (api/*.js) والتشغيل المحلي/Electron (server.js)
import { CFG, collect, fetchCountryTrends, searchYouTube } from './youtube.js';

const JSON_H = { 'Content-Type': 'application/json; charset=utf-8' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const msg = e => (e && e.message) ? e.message : String(e);

const NO_KEY = 'مفتاح YOUTUBE_API_KEY غير موجود. أضفه في Vercel: Settings ← Environment Variables ثم أعد النشر (Redeploy). محلياً: ضع المفتاح في ملف .env';

export function createHandlers(deps = {}){
  let cache = null, inflight = null;

  const hasKey = () => deps.apiKey !== undefined ? !!deps.apiKey : !!CFG.key;

  async function getTrends(force){
    const now = Date.now();
    if(cache){
      const age = now - cache.at;
      if(age < CFG.minRefreshMs || (!force && age < CFG.ttlMs)) return cache.data;
    }
    if(!inflight){
      inflight = collect(deps)
        .then(d => { cache = { at: Date.now(), data: d }; return d; })
        .catch(e => { if(cache) return cache.data; throw e; })   // بيانات قديمة أفضل من لا شيء
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  // GET /api/trends?country=XX|ALL&refresh=1
  async function trends(params){
    const noStore = { ...CORS, ...JSON_H, 'Cache-Control': 'no-store' };
    if(!hasKey()) return { status: 400, headers: noStore, body: { error: NO_KEY } };
    try {
      const force = params.get('refresh') === '1';
      const cc = (params.get('country') || '').trim().toUpperCase();
      const data = (cc && cc !== 'ALL') ? await fetchCountryTrends(cc, deps) : await getTrends(force);
      return {
        status: 200,
        headers: { ...CORS, ...JSON_H, 'Cache-Control': force ? 'no-store' : 's-maxage=1800, stale-while-revalidate=3600' },
        body: data
      };
    } catch(e){
      return { status: 500, headers: noStore, body: { error: msg(e) } };
    }
  }

  // GET /api/search?q=...&target=video|channel&country=XX&hours=N
  async function searchH(params){
    const head = { ...CORS, ...JSON_H, 'Cache-Control': 'no-store' };
    if(!hasKey()) return { status: 400, headers: head, body: { error: NO_KEY } };
    const q = (params.get('q') || '').trim().slice(0, 100);
    const target = (params.get('target') || 'video').trim().toLowerCase();
    const country = (params.get('country') || '').trim().toUpperCase();
    const hours = Number(params.get('hours')) || 0;
    if(!q) return { status: 400, headers: head, body: { error: 'Search query is required' } };
    try {
      const raw = await searchYouTube(q, target, country, hours, deps);
      // نسخة جديدة حتى لا نعدّل الكاش الداخلي عند إضافة بيانات الترند
      const data = { ...raw, items: raw.items.map(it => ({ ...it })) };
      if(cache && cache.data && cache.data.charts){
        const allTrending = new Map();
        Object.values(cache.data.charts).forEach(ch => (ch.items || []).forEach(v => allTrending.set(v.id, v)));
        data.items.forEach(it => {
          const tr = allTrending.get(it.id);
          if(tr && tr.countries){ it.countries = tr.countries; it.bestRank = tr.bestRank; }
        });
      }
      return { status: 200, headers: head, body: data };
    } catch(e){
      return { status: 500, headers: head, body: { error: msg(e) } };
    }
  }

  return { trends, search: searchH };
}

// يحوّل دالة معالج إلى دالة (req, res) صالحة لـ Node و Vercel
export function nodeHandler(fn){
  return async function handler(req, res){
    if(req.method === 'OPTIONS'){ res.writeHead(204, CORS); return res.end(); }
    try {
      const url = new URL(req.url, 'http://localhost');
      const r = await fn(url.searchParams);
      res.writeHead(r.status, r.headers);
      res.end(JSON.stringify(r.body));
    } catch(e){
      console.error('Request error:', e);
      res.writeHead(500, { ...CORS, ...JSON_H });
      res.end(JSON.stringify({ error: msg(e) }));
    }
  };
}
