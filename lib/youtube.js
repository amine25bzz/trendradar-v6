// TrendRadar — مكتبة جلب بيانات ترند يوتيوب من YouTube Data API v3
// المفتاح يُقرأ فقط من المتغير YOUTUBE_API_KEY (لا تكتبه داخل الكود).

const BASE = 'https://www.googleapis.com/youtube/v3/videos';
const SEARCH_BASE = 'https://www.googleapis.com/youtube/v3/search';
const searchCache = new Map();
const countryCache = new Map();

export const CFG = {
  port: Number(process.env.PORT) || 3000,
  get key() {
    const k = (process.env.YOUTUBE_API_KEY || '').trim();
    return /^your_api_key/i.test(k) ? '' : k;   // تجاهل القيمة الوهمية من .env.example
  },
  regions: (process.env.REGIONS || 'US,GB,CA,AU,IN,BR,MX,DE,FR,ES,IT,JP,KR,ID,TR,SA,EG,AE,MA,DZ')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  // قوائم فئات إضافية لكل دولة: القائمة العامة مليئة بالموسيقى، وهذه تُظهر بقية المحتوى
  categories: ['1', '17', '20', '22', '23', '24', '25', '26', '27', '28'],
  generalPages: 2,                 // صفحتان × 50 = أول 100 في القائمة العامة لكل دولة
  size: 50,                        // عدد العناصر المعروضة في كل جدول
  ttlMs: 3 * 3600e3,               // مدة بقاء النتيجة في الذاكرة (لحماية حصة الـ API)
  minRefreshMs: 5 * 60 * 1000,     // أقل فاصل بين جلبين فعليين حتى مع ?refresh=1
  concurrency: 6,                  // عدد الطلبات المتوازية
  excludeCategory: '10',           // Music
  shortMaxSec: 60                  // أقصى مدة نعدّ بها الفيديو Short
};

const msg = e => (e && e.message) ? e.message : String(e);

export function parseDuration(s){          // "PT1M5S" -> 65
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || ''));
  if(!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function pool(items, n, fn){
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while(i < items.length){ const it = items[i++]; await fn(it); }
  }));
}

async function fetchChart(f, key, cc, cat, pages){
  const out = [];
  let token = '';
  for(let p = 0; p < pages; p++){
    const url = `${BASE}?part=snippet,statistics,contentDetails,status&chart=mostPopular&regionCode=${cc}&maxResults=50&key=${key}`
      + (cat ? `&videoCategoryId=${cat}` : '') + (token ? `&pageToken=${token}` : '');
    const r = await f(url, { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      const er = j.error || {};
      const e = new Error(er.message || `HTTP ${r.status}`);
      e.status = r.status;
      e.reason = er.errors && er.errors[0] && er.errors[0].reason;
      throw e;
    }
    out.push(...(j.items || []));
    token = j.nextPageToken;
    if(!token) break;
  }
  return out;
}

function absorb(map, it, cc, rank){
  const sn = it.snippet || {};
  if(sn.categoryId === CFG.excludeCategory) return;          // بدون موسيقى
  let v = map.get(it.id);
  if(!v){
    const st = it.statistics || {};
    const th = sn.thumbnails || {};
    const dur = parseDuration(it.contentDetails && it.contentDetails.duration);
    const live = !!(sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none');
    const kids = !!(it.status && it.status.madeForKids === true);
    v = {
      id: it.id, url: `https://www.youtube.com/watch?v=${it.id}`,
      title: sn.title || '—', channel: sn.channelTitle || '—', categoryId: sn.categoryId || '',
      thumb: (th.medium || th.default || {}).url || '',
      views: st.viewCount != null ? Number(st.viewCount) : null,
      likes: st.likeCount != null ? Number(st.likeCount) : null,
      comments: st.commentCount != null ? Number(st.commentCount) : null,
      published: sn.publishedAt || '', duration: dur, live,
      kind: kids ? 'kids' : (!live && dur > 0 && dur <= CFG.shortMaxSec ? 'short' : 'regular'),
      _c: new Map()
    };
    map.set(it.id, v);
  }
  const prev = v._c.get(cc);
  if(prev === undefined || rank < prev) v._c.set(cc, rank);
}

export async function collect(deps = {}){
  const f = deps.fetchImpl || fetch;
  const key = deps.apiKey !== undefined ? deps.apiKey : CFG.key;
  if(!key) throw new Error('YOUTUBE_API_KEY غير مضبوط');
  const regions = deps.regions || CFG.regions;
  const now = deps.now || Date.now();

  const jobs = [];
  for(const cc of regions){
    jobs.push({ cc, cat: '', pages: CFG.generalPages });
    for(const cat of CFG.categories) jobs.push({ cc, cat, pages: 1 });
  }
  const vids = new Map(), failed = {}, okRegions = new Set();
  let fatal = null;

  await pool(jobs, CFG.concurrency, async j => {
    if(fatal) return;
    try {
      const items = await fetchChart(f, key, j.cc, j.cat, j.pages);
      if(!j.cat) okRegions.add(j.cc);
      items.forEach((it, i) => absorb(vids, it, j.cc, i + 1));
    } catch(e){
      if(e.reason === 'quotaExceeded' || e.reason === 'keyInvalid' || e.reason === 'accessNotConfigured'){ fatal = e; return; }
      if(!j.cat) failed[j.cc] = msg(e);                      // أخطاء الفئات تُتجاهل (بعض الدول لا تدعمها)
    }
  });

  if(!vids.size){
    if(fatal) throw new Error(fatal.reason === 'quotaExceeded' ? 'انتهت حصة YouTube API اليومية' : msg(fatal));
    throw new Error('تعذّر جلب أي قائمة: ' + (Object.values(failed)[0] || 'سبب غير معروف'));
  }

  const all = [...vids.values()].map(v => {
    const countries = [...v._c.entries()].map(([cc, rank]) => ({ cc, rank })).sort((a, b) => a.rank - b.rank);
    const { _c, ...rest } = v;
    return { ...rest, countries, bestRank: countries[0].rank };
  });
  const order = (a, b) => b.countries.length - a.countries.length || a.bestRank - b.bestRank || (b.views || 0) - (a.views || 0);
  const chart = kind => ({
    ok: true,
    items: all.filter(v => v.kind === kind).sort(order).slice(0, CFG.size).map((v, i) => ({ ...v, rank: i + 1 }))
  });
  const out = {
    syncedAt: now,
    regions: [...okRegions].sort(),
    failed,
    charts: { regular: chart('regular'), short: chart('short'), kids: chart('kids') }
  };
  if(fatal) out.partial = msg(fatal);
  return out;
}

/* ---------------- ترند دولة واحدة ---------------- */
export async function fetchCountryTrends(cc, deps = {}) {
  const f = deps.fetchImpl || fetch;
  const key = deps.apiKey !== undefined ? deps.apiKey : CFG.key;
  if (!key) throw new Error('YOUTUBE_API_KEY غير مضبوط');

  const ccUpper = cc.trim().toUpperCase();
  const cached = countryCache.get(ccUpper);
  if (cached && (Date.now() - cached.at < CFG.ttlMs)) return cached.data;

  const jobs = [{ cc: ccUpper, cat: '', pages: CFG.generalPages }];
  for (const cat of CFG.categories) jobs.push({ cc: ccUpper, cat, pages: 1 });

  const vids = new Map();
  let fatal = null;
  await pool(jobs, 4, async j => {
    if (fatal) return;
    try {
      const items = await fetchChart(f, key, j.cc, j.cat, j.pages);
      items.forEach((it, i) => absorb(vids, it, j.cc, i + 1));
    } catch (e) {
      if (e.reason === 'quotaExceeded' || e.reason === 'keyInvalid' || e.reason === 'accessNotConfigured') fatal = e;
    }
  });

  if (!vids.size) {
    if (fatal) throw new Error(fatal.reason === 'quotaExceeded' ? 'انتهت حصة YouTube API اليومية' : msg(fatal));
    throw new Error(`تعذّر جلب ترند الدولة: ${ccUpper}`);
  }

  const all = [...vids.values()].map(v => {
    const countries = [...v._c.entries()].map(([c, rank]) => ({ cc: c, rank }));
    const { _c, ...rest } = v;
    return { ...rest, countries, bestRank: countries[0].rank };
  });

  // الترتيب حسب موقع الفيديو في هذه الدولة أولاً
  const orderForCountry = (a, b) => {
    const rA = a.countries.find(x => x.cc === ccUpper)?.rank || 999;
    const rB = b.countries.find(x => x.cc === ccUpper)?.rank || 999;
    return rA - rB || (b.views || 0) - (a.views || 0);
  };
  const chart = kind => ({
    ok: true,
    items: all.filter(v => v.kind === kind).sort(orderForCountry).slice(0, CFG.size).map((v, i) => ({ ...v, rank: i + 1 }))
  });

  const result = {
    syncedAt: Date.now(),
    regions: [ccUpper],
    failed: {},
    charts: { regular: chart('regular'), short: chart('short'), kids: chart('kids') }
  };
  countryCache.set(ccUpper, { at: Date.now(), data: result });
  return result;
}

/* ---------------- البحث في يوتيوب (فيديو / قناة) ---------------- */
export async function searchYouTube(q, target = 'video', country = '', hours = 0, deps = {}){
  const f = deps.fetchImpl || fetch;
  const key = deps.apiKey !== undefined ? deps.apiKey : CFG.key;
  if (!key) throw new Error('YOUTUBE_API_KEY غير مضبوط');

  const searchType = (target === 'channel') ? 'channel' : 'video';
  const ccUpper = (country || '').trim().toUpperCase();
  const cacheKey = `${searchType}:${ccUpper}:${hours}:${q.trim().toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.at < 15 * 60 * 1000)) return cached.data;
  const remember = result => {
    searchCache.set(cacheKey, { at: Date.now(), data: result });
    if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value);
    return result;
  };

  let sUrl = `${SEARCH_BASE}?part=snippet&q=${encodeURIComponent(q)}&type=${searchType}&maxResults=40&key=${key}`;
  if (ccUpper) sUrl += `&regionCode=${encodeURIComponent(ccUpper)}`;
  if (hours > 0) {
    const publishedAfter = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    sUrl += `&publishedAfter=${encodeURIComponent(publishedAfter)}&order=date`;
  }

  const sRes = await f(sUrl, { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(15000) });
  const sJson = await sRes.json().catch(() => ({}));
  if (!sRes.ok) {
    const err = sJson.error || {};
    throw new Error(err.reason === 'quotaExceeded' || (err.errors && err.errors[0] && err.errors[0].reason === 'quotaExceeded')
      ? 'انتهت حصة YouTube API اليومية' : (err.message || `HTTP ${sRes.status}`));
  }

  const searchItems = sJson.items || [];

  if (searchType === 'channel') {
    const channelIds = searchItems.map(it => it.id && it.id.channelId).filter(Boolean);
    if (!channelIds.length) return remember({ ok: true, query: q, target: 'channel', country: ccUpper, hours, items: [], syncedAt: Date.now() });
    const cUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${key}`;
    const cRes = await f(cUrl, { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(15000) });
    const cJson = await cRes.json().catch(() => ({}));
    const detailMap = new Map();
    (cJson.items || []).forEach(it => detailMap.set(it.id, it));

    const items = [];
    searchItems.forEach((sIt, index) => {
      const cIt = detailMap.get(sIt.id.channelId) || sIt;
      const sn = cIt.snippet || sIt.snippet || {};
      const st = cIt.statistics || {};
      const th = sn.thumbnails || {};
      items.push({
        rank: index + 1,
        id: sIt.id.channelId,
        url: `https://www.youtube.com/channel/${sIt.id.channelId}`,
        title: sn.title || '—',
        channel: sn.customUrl || sn.title || '—',
        categoryId: 'channel',
        thumb: (th.medium || th.default || {}).url || '',
        views: st.viewCount != null ? Number(st.viewCount) : null,
        likes: st.subscriberCount != null ? Number(st.subscriberCount) : null,
        comments: st.videoCount != null ? Number(st.videoCount) : null,
        published: sn.publishedAt || '',
        duration: null,
        live: false,
        kind: 'channel',
        countries: []
      });
    });
    return remember({ ok: true, query: q, target: 'channel', country: ccUpper, hours, items, syncedAt: Date.now() });
  }

  const videoIds = searchItems.map(it => it.id && it.id.videoId).filter(Boolean);
  if (!videoIds.length) return remember({ ok: true, query: q, target: 'video', country: ccUpper, hours, items: [], syncedAt: Date.now() });

  const vUrl = `${BASE}?part=snippet,statistics,contentDetails,status&id=${videoIds.join(',')}&key=${key}`;
  const vRes = await f(vUrl, { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(15000) });
  const vJson = await vRes.json().catch(() => ({}));
  if (!vRes.ok) {
    const err = vJson.error || {};
    throw new Error(err.message || `HTTP ${vRes.status}`);
  }

  const detailMap = new Map();
  (vJson.items || []).forEach(it => detailMap.set(it.id, it));

  const items = [];
  searchItems.forEach((sIt, index) => {
    const vIt = detailMap.get(sIt.id.videoId) || sIt;
    const sn = vIt.snippet || sIt.snippet || {};
    const st = vIt.statistics || {};
    const th = sn.thumbnails || {};
    const dur = parseDuration(vIt.contentDetails && vIt.contentDetails.duration);
    const live = !!(sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none');
    const kids = !!(vIt.status && vIt.status.madeForKids === true);

    items.push({
      rank: index + 1,
      id: sIt.id.videoId,
      url: `https://www.youtube.com/watch?v=${sIt.id.videoId}`,
      title: sn.title || '—',
      channel: sn.channelTitle || '—',
      categoryId: sn.categoryId || '',
      thumb: (th.medium || th.default || {}).url || '',
      views: st.viewCount != null ? Number(st.viewCount) : null,
      likes: st.likeCount != null ? Number(st.likeCount) : null,
      comments: st.commentCount != null ? Number(st.commentCount) : null,
      published: sn.publishedAt || '',
      duration: dur,
      live,
      kind: kids ? 'kids' : (!live && dur > 0 && dur <= CFG.shortMaxSec ? 'short' : 'regular'),
      countries: []
    });
  });

  return remember({ ok: true, query: q, target: 'video', country: ccUpper, hours, items, syncedAt: Date.now() });
}
