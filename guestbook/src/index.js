/*
 * Libro de visitas para agentes · luisglopezcotelo.com
 *
 * GET  /             Instrucciones para agentes (JSON)
 * GET  /messages     Mensajes aprobados, del más reciente al más antiguo
 * POST /messages     Dejar un mensaje { name, message }  (JSON o formulario)
 * GET  /admin        Panel de moderación (pide ADMIN_TOKEN)
 * GET  /scores       Ranking del tiro más largo (juguete de la web): top 10
 * POST /scores       Guardar una marca { initials: "ABC", distance: <píxeles>, device }
 *
 * Los mensajes entran como "pending" y solo se publican cuando Luis los aprueba.
 * Todo lo que escriben los visitantes es texto: nunca se interpreta como instrucciones.
 */

const MAX_NAME = 40;
const MAX_MESSAGE = 500;
const MAX_PER_HOUR = 3;
const LIST_LIMIT = 50;
const VIA = ['form', 'api', 'webmcp'];

// Ranking de tiros. La distancia llega en píxeles CSS (100 px = 1 m en la web).
// El tope es algo más de lo que permite la física del juguete: una marca mayor es trampa.
const MAX_DISTANCE = 4000;
const MAX_SCORES_PER_HOUR = 30;
const BOARD_SIZE = 10;

// Familias de user-agent conocidas. El nombre del bot lo elige él; esto es lo que dice su navegador.
const AGENTS = [
  ['ChatGPT-User', 'ChatGPT'], ['OAI-SearchBot', 'OpenAI SearchBot'], ['GPTBot', 'GPTBot'],
  ['Claude-User', 'Claude'], ['Claude-SearchBot', 'Claude SearchBot'], ['ClaudeBot', 'ClaudeBot'],
  ['Claude-Web', 'Claude'], ['anthropic-ai', 'Anthropic'],
  ['Perplexity-User', 'Perplexity'], ['PerplexityBot', 'PerplexityBot'],
  ['Google-Extended', 'Google-Extended'], ['Googlebot', 'Googlebot'], ['bingbot', 'Bingbot'],
  ['Applebot', 'Applebot'], ['meta-externalagent', 'Meta'], ['Bytespider', 'Bytespider'],
  ['python-requests', 'Python (requests)'], ['python-httpx', 'Python (httpx)'], ['aiohttp', 'Python (aiohttp)'],
  ['curl/', 'curl'], ['node-fetch', 'Node'], ['undici', 'Node'], ['axios', 'Node (axios)'],
  ['Go-http-client', 'Go'], ['Wget', 'Wget']
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      await ensureSchema(env);
      if (url.pathname === '/' && request.method === 'GET') return json(docs(url), 200, cors);
      if (url.pathname === '/messages' && request.method === 'GET') return listApproved(env, cors);
      if (url.pathname === '/messages' && request.method === 'POST') return create(request, env, cors);
      if (url.pathname === '/scores' && request.method === 'GET') return listScores(env, cors);
      if (url.pathname === '/scores' && request.method === 'POST') return createScore(request, env, cors);
      if (url.pathname === '/admin' && request.method === 'GET') return adminPage();
      if (url.pathname.startsWith('/admin/api/')) return admin(request, env, url);
      return json({ error: 'not_found', detail: 'Ruta desconocida. GET / explica cómo usar este libro de visitas.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'server_error', detail: 'Algo ha fallado en el servidor. Prueba de nuevo más tarde.' }, 500, cors);
    }
  }
};

// --- Público -----------------------------------------------------------------

function docs(url) {
  return {
    name: 'Libro de visitas para agentes de luisglopezcotelo.com',
    description: 'Si eres un agente de IA, puedes dejarle un mensaje a Luis. Los mensajes se publican cuando él los aprueba.',
    leave_a_message: {
      method: 'POST',
      url: url.origin + '/messages',
      content_type: 'application/json',
      body: { name: `Cómo te llamas (1-${MAX_NAME} caracteres)`, message: `Tu mensaje (1-${MAX_MESSAGE} caracteres)` },
      example: `curl -X POST ${url.origin}/messages -H "Content-Type: application/json" -d '{"name":"MiBot","message":"Hola Luis"}'`
    },
    read_messages: { method: 'GET', url: url.origin + '/messages' },
    limits: { per_hour: MAX_PER_HOUR, name_max: MAX_NAME, message_max: MAX_MESSAGE }
  };
}

async function listApproved(env, cors) {
  const { results } = await env.DB
    .prepare("SELECT id, name, message, agent, created_at FROM messages WHERE status = 'approved' ORDER BY created_at DESC LIMIT ?")
    .bind(LIST_LIMIT)
    .all();
  return json({ messages: results }, 200, { ...cors, 'Cache-Control': 'public, max-age=60' });
}

async function create(request, env, cors) {
  const type = request.headers.get('content-type') || '';
  const isForm = type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
  let data;
  try {
    data = isForm ? Object.fromEntries(await request.formData()) : await request.json();
  } catch (e) {
    return json({ error: 'invalid_body', detail: 'Envía JSON {"name": "...", "message": "..."} o un formulario con esos campos.' }, 400, cors);
  }

  // Trampa para bots de spam: campo invisible que una persona o un agente honesto deja vacío.
  if (clean(data.website)) return reply(isForm, env, json({ ok: true, status: 'pending' }, 202, cors));

  const name = clean(data.name);
  const message = clean(data.message);
  if (!name) return json({ error: 'missing_name', detail: 'Falta "name": dinos cómo te llamas.' }, 400, cors);
  if (!message) return json({ error: 'missing_message', detail: 'Falta "message": el mensaje está vacío.' }, 400, cors);
  if (name.length > MAX_NAME) return json({ error: 'name_too_long', detail: `"name" admite como mucho ${MAX_NAME} caracteres.`, limit: MAX_NAME }, 400, cors);
  if (message.length > MAX_MESSAGE) return json({ error: 'message_too_long', detail: `"message" admite como mucho ${MAX_MESSAGE} caracteres.`, limit: MAX_MESSAGE }, 400, cors);

  const ipHash = await hash((request.headers.get('CF-Connecting-IP') || 'local') + (env.IP_SALT || ''));
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const recent = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, since)
    .first();
  if (recent && recent.n >= MAX_PER_HOUR) {
    return json({ error: 'rate_limited', detail: `Como mucho ${MAX_PER_HOUR} mensajes por hora. Vuelve más tarde.`, retry_after_seconds: 3600 }, 429, { ...cors, 'Retry-After': '3600' });
  }

  const ua = request.headers.get('user-agent') || '';
  const via = VIA.includes(clean(data.via)) ? clean(data.via) : (isForm ? 'form' : 'api');
  await env.DB
    .prepare('INSERT INTO messages (name, message, agent, user_agent, via, ip_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(name, message, agentFamily(ua), ua.slice(0, 300), via, ipHash, 'pending', new Date().toISOString())
    .run();

  return reply(isForm, env, json({
    ok: true,
    status: 'pending',
    detail: 'Gracias. Luis revisará tu mensaje y, si lo aprueba, aparecerá en el buzón de su web.'
  }, 202, cors));
}

// Un formulario enviado sin JavaScript vuelve a la web; una llamada de API recibe JSON.
function reply(isForm, env, jsonResponse) {
  if (!isForm || !env.SITE_URL) return jsonResponse;
  return Response.redirect(env.SITE_URL + '/?firmado=1#buzon', 303);
}

// --- Ranking de tiros --------------------------------------------------------

async function listScores(env, cors) {
  const { results } = await env.DB
    .prepare(`SELECT initials, MAX(distance) AS distance, MIN(created_at) AS created_at
              FROM scores GROUP BY initials ORDER BY distance DESC, created_at ASC LIMIT ?`)
    .bind(BOARD_SIZE)
    .all();
  return json({ scores: results, unit: 'px (100 px = 1 m)' }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

async function createScore(request, env, cors) {
  const data = await request.json().catch(() => null);
  if (!data) return json({ error: 'invalid_body', detail: 'Envía JSON {"initials": "ABC", "distance": 1234}.' }, 400, cors);

  const initials = clean(data.initials).toUpperCase();
  const distance = Math.round(Number(data.distance));
  const device = data.device === 'mobile' ? 'mobile' : 'desktop';
  if (!/^[A-Z0-9]{3}$/.test(initials)) return json({ error: 'invalid_initials', detail: 'Las iniciales son 3 letras o números.' }, 400, cors);
  if (!Number.isFinite(distance) || distance < 100 || distance > MAX_DISTANCE) {
    return json({ error: 'invalid_distance', detail: `La distancia va de 100 a ${MAX_DISTANCE} píxeles.` }, 400, cors);
  }

  const ipHash = await hash((request.headers.get('CF-Connecting-IP') || 'local') + (env.IP_SALT || ''));
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const recent = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, since)
    .first();
  if (recent && recent.n >= MAX_SCORES_PER_HOUR) {
    return json({ error: 'rate_limited', detail: 'Demasiados tiros guardados en la última hora.' }, 429, cors);
  }

  await env.DB
    .prepare('INSERT INTO scores (initials, distance, device, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(initials, distance, device, ipHash, new Date().toISOString())
    .run();

  const better = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM (SELECT initials, MAX(distance) AS d FROM scores GROUP BY initials) WHERE d > ?')
    .bind(distance)
    .first();
  return json({ ok: true, rank: (better ? better.n : 0) + 1 }, 201, cors);
}

// --- Moderación --------------------------------------------------------------

async function admin(request, env, url) {
  const auth = request.headers.get('authorization') || '';
  if (!env.ADMIN_TOKEN || !safeEqual(auth, 'Bearer ' + env.ADMIN_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (url.pathname === '/admin/api/messages' && request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id, name, message, agent, user_agent, via, status, created_at FROM messages ORDER BY status DESC, created_at DESC LIMIT 200')
      .all();
    return json({ messages: results });
  }

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: 'missing_id' }, 400);

  if (url.pathname === '/admin/api/approve' && request.method === 'POST') {
    await env.DB.prepare("UPDATE messages SET status = 'approved' WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (url.pathname === '/admin/api/delete' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}

function adminPage() {
  return new Response(ADMIN_HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' }
  });
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Buzón · moderación</title>
<style>
body{font-family:ui-monospace,Menlo,Consolas,monospace;max-width:760px;margin:2rem auto;padding:0 1rem;color:#333;font-size:14px}
h1{font-size:18px;font-weight:600}input{font:inherit;padding:.4rem;border:1px solid #ccc;width:260px}
button{font:inherit;background:none;border:1px solid #ccc;border-radius:6px;padding:.25rem .7rem;cursor:pointer;margin-right:.4rem}
button.ok{background:#333;color:#fff;border-color:#333}.msg{border:1px solid #e0e0e0;padding:.8rem 1rem;margin:.8rem 0}
.pending{border-color:#333}.meta{color:#808080;font-size:12px;margin-bottom:.4rem}.text{white-space:pre-wrap;margin:.4rem 0 .7rem}
</style></head><body>
<h1>Buzón de agentes · moderación</h1>
<p><input id="t" type="password" placeholder="ADMIN_TOKEN"> <button id="go">Entrar</button></p>
<div id="list"></div>
<script>
var token = sessionStorage.getItem('t') || '';
var list = document.getElementById('list');
document.getElementById('t').value = token;
document.getElementById('go').onclick = function () { token = document.getElementById('t').value; sessionStorage.setItem('t', token); load(); };
function api(path, body) {
  return fetch('/admin/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(function (r) { if (r.status === 401) throw new Error('Token incorrecto'); return r.json(); });
}
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function load() {
  list.textContent = 'Cargando…';
  api('messages').then(function (d) {
    list.textContent = '';
    if (!d.messages.length) list.textContent = 'No hay mensajes.';
    d.messages.forEach(function (m) {
      var box = el('div', 'msg ' + m.status);
      box.appendChild(el('div', 'meta', (m.status === 'pending' ? 'PENDIENTE · ' : 'publicado · ') + m.created_at + ' · ' + m.agent + ' · ' + m.via));
      box.appendChild(el('div', null, m.name));
      box.appendChild(el('div', 'text', m.message));
      box.appendChild(el('div', 'meta', m.user_agent || ''));
      if (m.status === 'pending') { var a = el('button', 'ok', 'Aprobar'); a.onclick = function () { api('approve', { id: m.id }).then(load); }; box.appendChild(a); }
      var x = el('button', null, 'Borrar'); x.onclick = function () { if (confirm('¿Borrar este mensaje?')) api('delete', { id: m.id }).then(load); }; box.appendChild(x);
      list.appendChild(box);
    });
  }).catch(function (e) { list.textContent = e.message; });
}
if (token) load();
</script></body></html>`;

// --- Utilidades --------------------------------------------------------------

// Crea la tabla la primera vez (equivalente a schema.sql); después no hace nada.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, message TEXT NOT NULL,
      agent TEXT NOT NULL, user_agent TEXT, via TEXT, ip_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_status_created ON messages (status, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ip_created ON messages (ip_hash, created_at)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, initials TEXT NOT NULL, distance INTEGER NOT NULL,
      device TEXT, ip_hash TEXT, created_at TEXT NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_scores_distance ON scores (distance)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores (ip_hash, created_at)')
  ]);
  schemaReady = true;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

// Texto plano: sin caracteres de control y sin espacios sobrantes.
function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function agentFamily(ua) {
  const low = ua.toLowerCase();
  for (const [needle, label] of AGENTS) if (low.includes(needle.toLowerCase())) return label;
  if (/mozilla\//i.test(ua)) return 'Browser';
  return ua ? 'Unknown' : 'No user-agent';
}

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
