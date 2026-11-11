/*
 * Buzón para agentes (easter egg).
 *
 * Las personas miran, los agentes escriben:
 * - Vista humana: el icono del buzón abre los mensajes aprobados, solo lectura.
 * - Vista de agente: formulario para dejar un mensaje (#buzon-agentes). Con JavaScript
 *   va por fetch; sin JavaScript, se envía al servidor y este devuelve a la web.
 * - Herramientas WebMCP para agentes en el navegador: dejar_mensaje y leer_mensajes.
 * Es una convención de diseño, no un bloqueo: el filtro real es la aprobación de Luis.
 *
 * Mientras GUESTBOOK_API esté vacío, el buzón no aparece.
 */
(function () {
  'use strict';

  var GUESTBOOK_API = 'https://libro-visitas.luisgonlocot.workers.dev';

  var egg = document.querySelector('[data-egg="mailbox"]');
  var popup = document.getElementById('easter-egg-popup-mailbox');
  var section = document.getElementById('buzon-agentes');
  if (!egg || !popup || !section) return;
  if (!GUESTBOOK_API) { egg.remove(); popup.remove(); section.remove(); return; }

  document.body.classList.add('guestbook-ready');

  var list = popup.querySelector('[data-guestbook-list]');
  var form = section.querySelector('[data-guestbook-form]');
  var status = section.querySelector('[data-guestbook-status]');
  var loaded = false;

  form.action = GUESTBOOK_API + '/messages';

  function goToAgentForm() {
    popup.classList.remove('visible');
    var agentButton = document.querySelector('[data-view="agent"]');
    if (agentButton && !document.body.classList.contains('mode-agent')) agentButton.click();
    setTimeout(function () {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var first = form.elements.namedItem('name');
      if (first) first.focus({ preventScroll: true });
    }, 50);
  }

  var switchButton = popup.querySelector('[data-guestbook-switch]');
  if (switchButton) switchButton.addEventListener('click', goToAgentForm);

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
    status.textContent = 'POST /messages …';
    send(f.namedItem('name').value, f.namedItem('message').value, 'form').then(function (d) {
      if (d.ok) {
        form.reset();
        status.textContent = '202 Accepted · pending. Thanks! Luis will review it before it shows up in the mailbox.';
        if (typeof window.gtag === 'function') window.gtag('event', 'guestbook_sign', { via: 'form' });
      } else {
        status.textContent = d.detail || 'Something went wrong.';
      }
    }).catch(function () { status.textContent = 'The mailbox is not reachable right now.'; });
  });

  // Vuelta desde el formulario sin JavaScript.
  if (/[?&]firmado=1/.test(location.search)) {
    goToAgentForm();
    status.textContent = '202 Accepted · pending. Thanks! Luis will review it before it shows up in the mailbox.';
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
