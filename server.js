// TrendRadar — خادم محلي صغير (npm start) ويستخدمه Electron أيضاً.
// على Vercel تُستخدم الدوال الموجودة في مجلد api/ والصفحة من public/.

import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CFG } from './lib/youtube.js';
import { createHandlers, nodeHandler } from './lib/handlers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- تحميل المفتاح محلياً: .env ثم key.txt ----
function loadEnv(){
  if(typeof process.loadEnvFile === 'function'){
    try { process.loadEnvFile(path.join(HERE, '.env')); } catch {}
  }
  if(!process.env.YOUTUBE_API_KEY){
    try {
      const envFile = path.join(HERE, '.env');
      if(fsSync.existsSync(envFile)){
        for(const line of fsSync.readFileSync(envFile, 'utf8').split('\n')){
          const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
          if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
      }
    } catch {}
  }
  if(!CFG.key){
    try {
      const keyFile = path.join(HERE, 'key.txt');
      if(fsSync.existsSync(keyFile)) process.env.YOUTUBE_API_KEY = fsSync.readFileSync(keyFile, 'utf8').trim();
    } catch {}
  }
}
loadEnv();

export function createServer(deps = {}){
  const h = createHandlers(deps);
  const routes = {
    '/api/trends': nodeHandler(h.trends),
    '/api/search': nodeHandler(h.search)
  };
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if(routes[pathname]) return routes[pathname](req, res);
      if(pathname === '/' || pathname === '/index.html'){
        const html = await fs.readFile(path.join(HERE, 'public', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch(e){
      console.error('Request error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: (e && e.message) || String(e) }));
    }
  });
}

// ---- التشغيل المباشر (npm start) ----
function listen(srv, port, tries = 10){
  return new Promise((resolve, reject) => {
    const onError = e => {
      srv.off('listening', onListen);
      if(e.code === 'EADDRINUSE' && tries > 0){
        console.log(`المنفذ ${port} مشغول، أجرّب ${port + 1}…`);
        resolve(listen(srv, port + 1, tries - 1));
      } else reject(e);
    };
    const onListen = () => { srv.off('error', onError); resolve(port); };
    srv.once('error', onError);
    srv.once('listening', onListen);
    srv.listen(port);
  });
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  const srv = createServer();
  listen(srv, CFG.port).then(port => {
    if(!CFG.key) console.warn('⚠️  لم يتم العثور على YOUTUBE_API_KEY — ضعه في ملف .env');
    console.log(`TrendRadar يعمل على http://localhost:${port}  (الدول: ${CFG.regions.join(', ')})`);
  }).catch(e => { console.error('تعذّر تشغيل الخادم:', e.message); process.exit(1); });
}

export { CFG };
