/*
 * Ver como humano / ver como agente.
 *
 * La vista de agente enseña lo que recibe una máquina al llegar a esta web:
 *  1. Un informe del HTML real de la página, calculado en vivo (lo que un agente
 *     tendría que descifrar sin ayuda).
 *  2. La versión legible que la web le ofrece (/llms.txt).
 *
 * Se puede compartir con #agente al final de la URL.
 */
(function () {
  'use strict';

  var buttons = document.querySelectorAll('[data-view]');
  if (!buttons.length) return;

  var es = (navigator.language || 'es').toLowerCase().indexOf('es') === 0;
  var T = es ? {
    region: 'Vista de agente',
    report: 'Lo que un agente encuentra en el HTML',
    title: 'Título',
    words: 'Palabras visibles en la página',
    images: 'Imágenes',
    links: 'Enlaces',
    hidden: 'Proyectos escondidos en popups',
    tools: 'Herramientas para agentes (WebMCP)',
    toolsNone: '0 · próximamente',
    offered: 'Lo que esta web le ofrece en su lugar',
    loading: 'Cargando…',
    failed: 'No se ha podido cargar /llms.txt',
    back: '← volver a la vista humana'
  } : {
    region: 'Agent view',
    report: 'What an agent finds in the HTML',
    title: 'Title',
    words: 'Visible words on the page',
    images: 'Images',
    links: 'Links',
    hidden: 'Projects hidden in popups',
    tools: 'Agent tools (WebMCP)',
    toolsNone: '0 · coming soon',
    offered: 'What this site offers instead',
    loading: 'Loading…',
    failed: 'Could not load /llms.txt',
    back: '← back to the human view'
  };

  var panel = null;
  var llms = null;

  function words(el) {
    if (!el) return 0;
    var txt = (el.innerText || '').trim();
    return txt ? txt.split(/\s+/).length : 0;
  }

  function line(label, value) {
    // En pantallas estrechas los puntos de relleno se parten: formato corto.
    if (window.innerWidth < 600) return label + ': ' + value;
    var dots = Math.max(2, 44 - label.length);
    return label + ' ' + new Array(dots).join('.') + ' ' + value;
  }

  // Informe calculado sobre el DOM de la vista humana, no texto escrito a mano.
  function report() {
    var imgs = document.querySelectorAll('.container img');
    var alts = Array.prototype.map.call(imgs, function (i) { return i.getAttribute('alt') || '(sin alt)'; });
    var links = document.querySelectorAll('.container a[href^="http"]');
    var hrefs = Array.prototype.map.call(links, function (a) { return a.href; });
    var popups = document.querySelectorAll('.easter-egg-popup');
    var visibleWords = words(document.querySelector('main')) + words(document.querySelector('footer'));

    var out = [];
    out.push('# ' + T.report);
    out.push('');
    out.push(line(T.title, document.title.trim()));
    out.push(line(T.words, String(visibleWords)));
    out.push(line(T.images, String(imgs.length)));
    alts.forEach(function (a) { out.push('    - alt="' + a + '"'); });
    out.push(line(T.links, String(hrefs.length)));
    hrefs.forEach(function (h) { out.push('    - ' + h); });
    out.push(line(T.hidden, String(popups.length)));
    var ready = document.body.classList.contains('guestbook-ready');
    out.push(line(T.tools, ready ? '2 · dejar_mensaje, leer_mensajes' : T.toolsNone));
    return out.join('\n');
  }

  function loadLlms(target) {
    if (llms !== null) { target.textContent = llms; return; }
    target.textContent = T.loading;
    fetch('/llms.txt', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (txt) { llms = txt; target.textContent = txt; })
      .catch(function () { target.textContent = T.failed; });
  }

  function buildPanel() {
    panel = document.createElement('section');
    panel.className = 'agent-view';
    panel.setAttribute('aria-label', T.region);

    var rep = document.createElement('pre');
    rep.className = 'agent-view__block';
    rep.textContent = report();

    var req = document.createElement('pre');
    req.className = 'agent-view__request';
    req.textContent = '# ' + T.offered + '\n\nGET ' + location.origin + '/llms.txt\n200 OK · text/markdown';

    var body = document.createElement('pre');
    body.className = 'agent-view__block agent-view__llms';
    loadLlms(body);

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'agent-view__back';
    back.textContent = T.back;
    back.addEventListener('click', function () { setMode('human', true); });

    panel.appendChild(rep);
    panel.appendChild(req);
    panel.appendChild(body);
    // El formulario del buzón vive en el HTML; aquí se coloca dentro de la vista de agente.
    var guestbook = document.getElementById('buzon-agentes');
    if (guestbook) panel.appendChild(guestbook);
    panel.appendChild(back);

    var header = document.querySelector('header');
    header.parentNode.insertBefore(panel, header.nextSibling);
  }

  function setMode(mode, userAction) {
    var agent = mode === 'agent';
    // El informe se calcula sobre la vista humana, antes de ocultarla.
    if (agent && !panel) buildPanel();
    document.body.classList.toggle('mode-agent', agent);
    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === mode));
    });

    if (userAction) {
      try {
        history.replaceState(null, '', agent ? '#agente' : location.pathname + location.search);
      } catch (e) { /* sin history */ }
      if (typeof window.gtag === 'function') window.gtag('event', 'view_mode', { mode: mode });
      window.scrollTo(0, 0);
    }
  }

  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-view'), true); });
  });

  if (['#agente', '#agent', '#buzon'].indexOf(location.hash) !== -1) setMode('agent', false);
})();
