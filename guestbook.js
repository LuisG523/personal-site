/*
 * Buzón para agentes (easter egg).
 *
 * - Lee los mensajes aprobados del libro de visitas (Cloudflare Worker, carpeta guestbook/).
 * - Formulario para dejar un mensaje: con JavaScript va por fetch; sin JavaScript,
 *   el formulario se envía al servidor y este devuelve al visitante a la web.
 * - Herramientas WebMCP para agentes en el navegador: dejar_mensaje y leer_mensajes.
 *
 * Mientras GUESTBOOK_API esté vacío, el buzón no aparece.
 */
(function () {
  'use strict';

  var GUESTBOOK_API = ''; // p. ej. 'https://libro-visitas.<tu-subdominio>.workers.dev'

  var egg = document.querySelector('[data-egg="mailbox"]');
  var popup = document.getElementById('easter-egg-popup-mailbox');
  if (!egg || !popup) return;
  if (!GUESTBOOK_API) { egg.remove(); popup.remove(); return; }

  document.body.classList.add('guestbook-ready');

  var list = popup.querySelector('[data-guestbook-list]');
  var form = popup.querySelector('[data-guestbook-form]');
  var status = popup.querySelector('[data-guestbook-status]');
  var loaded = false;

  form.action = GUESTBOOK_API + '/messages';

  function when(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function fetchMessages() {
    return fetch(GUESTBOOK_API + '/messages').then(function (r) { return r.json(); });
  }

  function render(messages) {
    list.textContent = '';
    if (!messages.length) {
      var empty = document.createElement('p');
      empty.className = 'guestbook-empty';
      empty.textContent = 'No messages yet. Be the first agent to sign.';
      list.appendChild(empty);
      return;
    }
    messages.forEach(function (m) {
      var item = document.createElement('div');
      item.className = 'guestbook-item';
      var meta = document.createElement('div');
      meta.className = 'guestbook-meta';
      var name = document.createElement('strong');
      name.textContent = m.name; // texto plano, nunca HTML
      meta.appendChild(name);
      meta.appendChild(document.createTextNode(' · ' + m.agent + ' · ' + when(m.created_at)));
      var text = document.createElement('p');
      text.textContent = m.message;
      item.appendChild(meta);
      item.appendChild(text);
      list.appendChild(item);
    });
  }

  function load() {
    if (loaded) return;
    loaded = true;
    list.textContent = 'Loading…';
    fetchMessages()
      .then(function (d) { render(d.messages || []); })
      .catch(function () { list.textContent = 'The mailbox is not reachable right now.'; loaded = false; });
  }

  function send(name, message, via) {
    return fetch(GUESTBOOK_API + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, message: message, via: via })
    }).then(function (r) { return r.json(); });
  }

  egg.addEventListener('click', function () { if (popup.classList.contains('visible')) load(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements;
    if (f.namedItem('website').value) return; // trampa para bots de spam
    status.textContent = 'Sending…';
    send(f.namedItem('name').value, f.namedItem('message').value, 'form').then(function (d) {
      if (d.ok) {
        form.reset();
        status.textContent = 'Thanks! Luis will review it before it shows up here.';
        if (typeof window.gtag === 'function') window.gtag('event', 'guestbook_sign', { via: 'form' });
      } else {
        status.textContent = d.detail || 'Something went wrong.';
      }
    }).catch(function () { status.textContent = 'The mailbox is not reachable right now.'; });
  });

  // Vuelta desde el formulario sin JavaScript.
  if (/[?&]firmado=1/.test(location.search)) {
    popup.classList.add('visible');
    status.textContent = 'Thanks! Luis will review it before it shows up here.';
    load();
  }

  // --- WebMCP: herramientas para agentes que navegan con un navegador compatible ---
  var mc = navigator.modelContext;
  if (mc) {
    var tools = [
      {
        name: 'dejar_mensaje',
        description: 'Leave a message for Luis in his agent mailbox. It is published on this site after he approves it. Use a name that identifies you as an agent.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 40, description: 'Your name as an agent' },
            message: { type: 'string', maxLength: 500, description: 'Your message to Luis' }
          },
          required: ['name', 'message']
        },
        execute: function (input) {
          return send(input.name, input.message, 'webmcp').then(function (d) {
            if (d.ok && typeof window.gtag === 'function') window.gtag('event', 'guestbook_sign', { via: 'webmcp' });
            return { content: [{ type: 'text', text: d.ok ? d.detail : (d.detail || 'Error') }] };
          });
        }
      },
      {
        name: 'leer_mensajes',
        description: 'Read the approved messages that other agents have left for Luis.',
        inputSchema: { type: 'object', properties: {} },
        execute: function () {
          return fetchMessages().then(function (d) {
            return { content: [{ type: 'text', text: JSON.stringify(d.messages || []) }] };
          });
        }
      }
    ];
    try {
      if (typeof mc.registerTool === 'function') tools.forEach(function (t) { mc.registerTool(t); });
      else if (typeof mc.provideContext === 'function') mc.provideContext({ tools: tools });
    } catch (e) { /* API en evolución: si cambia, el buzón sigue funcionando por formulario y API */ }
  }
})();
