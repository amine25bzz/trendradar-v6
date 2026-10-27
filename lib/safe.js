// يغلّف دوال Vercel: أي خطأ أثناء التحميل أو التشغيل يُرجَع كـ JSON واضح بدل 500 صامت.
export function safeApi(pick){
  let ready = null;
  return async function handler(req, res){
    try {
      if(!ready){
        const { createHandlers, nodeHandler } = await import('./handlers.js');
        ready = nodeHandler(pick(createHandlers()));
      }
      return await ready(req, res);
    } catch(e){
      console.error('API crash:', e);
      if(!res.headersSent){
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      }
      res.end(JSON.stringify({ error: 'Server error: ' + ((e && e.message) || String(e)) }));
    }
  };
}
