/*
 * Analítica de luisglopezcotelo.com
 *
 * - Google Analytics 4 con Consent Mode v2: sin cookies hasta que el visitante acepta.
 * - Banner de consentimiento ligero (ES/EN según el navegador) y enlace "Cookies" en el pie
 *   para cambiar de opinión.
 * - Eventos propios: easter_egg_open, all_eggs_found, project_click.
 * - Tráfico interno: visita una vez https://luisglopezcotelo.com/?interno=1 desde cada
 *   navegador/dispositivo tuyo para marcarte (?interno=0 para desmarcarte).
 * - En local (Live Server, localhost) no se envía nada a GA: los eventos salen por consola.
 * - ?debug=1 activa el modo depuración (aparece en GA > Administrar > DebugView).
 */
(function () {
  'use strict';

  var GA_ID = 'G-VP2GKXQM5L';

  // false = modo avanzado de Consent Mode: sin consentimiento, GA solo recibe pings anónimos
  //         sin cookies (Google los usa para modelar las visitas que faltan).
  // true  = modo estricto: GA no se carga en absoluto hasta que el visitante acepta.
  var STRICT = false;

  var CONSENT_KEY = 'lglc_consent';   // 'granted' | 'denied'
  var INTERNAL_KEY = 'lglc_internal'; // '1' si es tráfico propio
  var EGGS_KEY = 'lglc_eggs';         // huevos encontrados en la sesión

  var host = location.hostname;
  var isLocal = host === '' || host === 'localhost' || host === '127.0.0.1' ||
    host === '[::1]' || /\.local$/.test(host);

  function read(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function write(store, key, val) { try { window[store].setItem(key, val); } catch (e) { /* sin almacenamiento */ } }
  function remove(store, key) { try { window[store].removeItem(key); } catch (e) { /* sin almacenamiento */ } }

  var params = new URLSearchParams(location.search);
  if (params.has('interno')) {
    if (params.get('interno') === '0') remove('localStorage', INTERNAL_KEY);
    else write('localStorage', INTERNAL_KEY, '1');
  }
  var isInternal = read('localStorage', INTERNAL_KEY) === '1';
  var isDebug = params.get('debug') === '1';

  // --- gtag -----------------------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  window.gtag = isLocal
    ? function () { console.log('[analytics]', Array.prototype.slice.call(arguments)); }
    : function () { window.dataLayer.push(arguments); };

  var consent = read('localStorage', CONSENT_KEY);

  gtag('consent', 'default', {
    analytics_storage: consent === 'granted' ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });

  var configParams = {};
  if (isInternal) configParams.traffic_type = 'internal';
  if (isDebug) configParams.debug_mode = true;

  gtag('js', new Date());
  gtag('config', GA_ID, configParams);

  var gtagLoaded = false;
  function loadGtag() {
    if (gtagLoaded || isLocal) return;
    gtagLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  if (!STRICT || consent === 'granted') loadGtag();

  function track(name, eventParams) { gtag('event', name, eventParams || {}); }

  // --- Eventos --------------------------------------------------------------
  var TOTAL_EGGS = document.querySelectorAll('[data-egg]').length;

  document.addEventListener('click', function (e) {
    var target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    // El onclick del icono ya ha abierto/cerrado el popup cuando llega aquí (fase de burbuja).
    var egg = target.closest('[data-egg]');
    if (egg) {
      var popup = document.getElementById(egg.getAttribute('data-popup'));
      if (!popup || !popup.classList.contains('visible')) return;

      var name = egg.getAttribute('data-egg');
      var found = (read('sessionStorage', EGGS_KEY) || '').split(',').filter(Boolean);
      var isNew = found.indexOf(name) === -1;
      if (isNew) {
        found.push(name);
        write('sessionStorage', EGGS_KEY, found.join(','));
      }

      track('easter_egg_open', { egg: name, eggs_found: found.length, first_time: isNew });
      if (isNew && TOTAL_EGGS > 0 && found.length === TOTAL_EGGS) track('all_eggs_found', { eggs_found: found.length });
      return;
    }

    var link = target.closest('a[data-project]');
    if (link) {
      track('project_click', { project: link.getAttribute('data-project'), link_url: link.href });
      return;
    }

    var reset = target.closest('[data-consent-reset]');
    if (reset) {
      e.preventDefault();
      showBanner();
    }
  });

  // --- Banner de consentimiento ---------------------------------------------
  var es = (navigator.language || 'es').toLowerCase().indexOf('es') === 0;
  var TEXT = es
    ? { msg: 'Uso Google Analytics para saber cuánta gente pasa por aquí. ¿Te parece bien?', yes: 'Vale', no: 'No' }
    : { msg: 'I use Google Analytics to see how many people stop by. OK with you?', yes: 'Sure', no: 'No thanks' };

  var banner = null;

  function decide(granted) {
    write('localStorage', CONSENT_KEY, granted ? 'granted' : 'denied');
    gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
    if (granted) loadGtag();
    track('consent_choice', { choice: granted ? 'granted' : 'denied' });
    hideBanner();
  }

  function hideBanner() {
    if (banner) { banner.remove(); banner = null; }
  }

  function showBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', es ? 'Consentimiento de cookies' : 'Cookie consent');

    var p = document.createElement('p');
    p.textContent = TEXT.msg;

    var no = document.createElement('button');
    no.type = 'button';
    no.textContent = TEXT.no;
    no.addEventListener('click', function () { decide(false); });

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'primary';
    yes.textContent = TEXT.yes;
    yes.addEventListener('click', function () { decide(true); });

    var actions = document.createElement('div');
    actions.className = 'consent-actions';
    actions.appendChild(no);
    actions.appendChild(yes);

    banner.appendChild(p);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  if (consent !== 'granted' && consent !== 'denied') {
    if (document.body) showBanner();
    else document.addEventListener('DOMContentLoaded', showBanner);
  }
})();
