/*
 * Juguete con física para la vista humana.
 *
 * - Los iconos se pueden arrastrar y lanzar: rebotan contra los bordes y entre ellos.
 * - Si sueltas un icono (o se para) encima de la firma, se abre su proyecto.
 * - Un clic sin arrastrar sigue abriendo el popup como siempre.
 * - Objetivo: llevar los cuatro iconos a la firma. Un contador lo va marcando y,
 *   al completar los cuatro, la firma lo celebra.
 * - Los choques sueltan chispas y los iconos se aplastan un poco contra los bordes.
 * - Si nadie toca nada, un icono se menea una vez para avisar de que se puede jugar.
 * - Ranking: se mide el recorrido del icono lanzado (100 px = 1 m) y las mejores
 *   marcas se guardan con iniciales de 3 letras en el servidor del buzón (/scores).
 * - "↺ recolocar" devuelve cada icono a su sitio.
 * - Con "reducir movimiento" activado en el sistema, se arrastra pero no hay inercia.
 *
 * Sin librerías: círculos con rebote, rozamiento y colisiones simples.
 */
(function () {
  'use strict';

  var icons = Array.prototype.slice.call(document.querySelectorAll('.easter-egg'));
  if (!icons.length || !window.requestAnimationFrame) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SCORES_API = 'https://libro-visitas.luisgonlocot.workers.dev';
  var PX_PER_METER = 100;
  var MIN_THROW_SPEED = 300; // px/s: por debajo no cuenta como lanzamiento
  var BOARD_SIZE = 10;

  var FRICTION = 2.2;      // frenado por segundo (más alto = se paran antes)
  var BOUNCE = 0.78;       // energía que conservan al rebotar
  var MAX_SPEED = 2600;    // px/s
  var REST_SPEED = 18;     // px/s: por debajo se considera parado
  var DRAG_THRESHOLD = 6;  // px: más que esto ya no es un clic

  var bodies = [];
  var activated = false;
  var running = false;
  var drag = null;
  var suppressClick = false;
  var lastTime = 0;
  var resetButton = null;
  var hud = null;
  var scoreEl = null;
  var found = {};          // iconos que ya han llegado a la firma
  var completed = false;
  var thrownOnce = false;
  var touched = false;
  var bestEl = null;
  var boardButton = null;
  var board = null;
  var scores = null;          // ranking cargado del servidor (null = sin cargar)
  var pendingScore = 0;       // marca esperando iniciales
  var best = Number(store('get', 'lglc_best')) || 0;

  function store(op, key, val) {
    try { return op === 'get' ? localStorage.getItem(key) : localStorage.setItem(key, val); } catch (e) { return null; }
  }

  function meters(px) { return (px / PX_PER_METER).toFixed(1) + ' m'; }

  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

  function popupFor(el) { return document.getElementById(el.getAttribute('data-popup')); }

  function signatureRect() {
    var sig = document.querySelector('.nombre-firma');
    return sig ? sig.getBoundingClientRect() : null;
  }

  // La primera vez que se toca un icono, todos pasan de posiciones en % a coordenadas en px.
  function activate() {
    if (activated) return;
    activated = true;
    bodies = icons.map(function (el) {
      var r = el.getBoundingClientRect();
      var home = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom };
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.classList.add('toy-active');
      return {
        el: el, x: r.left, y: r.top, w: r.width, h: r.height,
        r: Math.max(r.width, r.height) / 2, vx: 0, vy: 0, spin: 0, sx: 1, sy: 1, throwing: false, throwDist: 0,
        homeX: r.left, homeY: r.top, homeStyle: home, moved: false, settled: true
      };
    });
  }

  function bodyOf(el) {
    for (var i = 0; i < bodies.length; i++) if (bodies[i].el === el) return bodies[i];
    return null;
  }

  function render(b) {
    b.el.style.left = b.x + 'px';
    b.el.style.top = b.y + 'px';
    var t = '';
    if (b.sx !== 1 || b.sy !== 1) t += 'scale(' + b.sx.toFixed(3) + ',' + b.sy.toFixed(3) + ') ';
    if (b.spin) t += 'rotate(' + b.spin.toFixed(1) + 'deg)';
    b.el.style.transform = t;
  }

  // Chispas del color de la firma en el punto de impacto.
  function sparks(x, y, n) {
    if (reduceMotion) return;
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      var ang = Math.random() * Math.PI * 2, d = 16 + Math.random() * 34;
      s.className = 'toy-spark';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', (Math.cos(ang) * d).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * d).toFixed(1) + 'px');
      s.addEventListener('animationend', function () { this.remove(); });
      document.body.appendChild(s);
    }
  }

  function updateScore() {
    if (!scoreEl) return;
    var n = Object.keys(found).length;
    scoreEl.textContent = n === icons.length ? ' · ' + n + '/' + n + ' ✓' : ' · ' + n + '/' + icons.length + ' en la firma';
  }

  function showReset() {
    if (hud) return;
    hud = document.createElement('div');
    hud.className = 'toy-hud';
    resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'toy-reset';
    resetButton.textContent = '↺ recolocar';
    resetButton.addEventListener('click', resetAll);
    scoreEl = document.createElement('span');
    scoreEl.className = 'toy-score';
    scoreEl.setAttribute('aria-live', 'polite');
    bestEl = document.createElement('span');
    bestEl.className = 'toy-best';
    boardButton = document.createElement('button');
    boardButton.type = 'button';
    boardButton.className = 'toy-reset toy-board-toggle';
    boardButton.textContent = '🏆 ranking';
    boardButton.setAttribute('aria-expanded', 'false');
    boardButton.addEventListener('click', function () { toggleBoard(); });
    hud.appendChild(resetButton);
    hud.appendChild(scoreEl);
    hud.appendChild(bestEl);
    hud.appendChild(document.createTextNode(' · '));
    hud.appendChild(boardButton);
    document.body.appendChild(hud);
    updateScore();
    updateBest();
  }

  function updateBest() {
    if (bestEl) bestEl.textContent = best ? ' · tu mejor tiro: ' + meters(best) : '';
  }

  // --- Ranking -------------------------------------------------------------------

  function loadScores() {
    return fetch(SCORES_API + '/scores', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { scores = d.scores || []; return scores; });
  }

  function qualifies(px) {
    if (!scores) return true; // sin datos, que lo decida el servidor
    if (scores.length < BOARD_SIZE) return true;
    return px > scores[scores.length - 1].distance;
  }

  function buildBoard() {
    board = document.createElement('section');
    board.className = 'toy-board';
    board.setAttribute('aria-label', 'Ranking del tiro más largo');
    document.body.appendChild(board);
  }

  function toggleBoard(forceOpen) {
    if (!board) buildBoard();
    var open = forceOpen === true || !board.classList.contains('visible');
    board.classList.toggle('visible', open);
    if (boardButton) boardButton.setAttribute('aria-expanded', String(open));
    if (open) {
      renderBoard();
      loadScores().then(renderBoard).catch(function () { renderBoard(true); });
      track('toy_board_open');
    }
  }

  function renderBoard(failed, highlight) {
    if (!board) return;
    board.textContent = '';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'easter-egg-close';
    close.textContent = '×';
    close.addEventListener('click', function () { toggleBoard(); });
    var title = document.createElement('h3');
    title.textContent = 'Tiro más largo';
    var hint = document.createElement('p');
    hint.className = 'toy-board-hint';
    hint.textContent = 'Lanza un icono: cuenta todo lo que recorre, rebotes incluidos.';
    board.appendChild(close);
    board.appendChild(title);
    board.appendChild(hint);

    if (pendingScore) board.appendChild(entryForm());

    if (failed === true && !scores) {
      board.appendChild(note('El ranking no está disponible ahora mismo.'));
      return;
    }
    if (!scores) { board.appendChild(note('Cargando…')); return; }
    if (!scores.length) { board.appendChild(note('Aún no hay marcas. ¡Estrénalo!')); return; }

    var mine = store('get', 'lglc_initials');
    var list = document.createElement('ol');
    list.className = 'toy-board-list';
    scores.forEach(function (row) {
      var li = document.createElement('li');
      if (row.initials === (highlight || mine)) li.className = 'mine';
      var who = document.createElement('span');
      who.textContent = row.initials;
      var dist = document.createElement('span');
      dist.textContent = meters(row.distance);
      li.appendChild(who);
      li.appendChild(dist);
      list.appendChild(li);
    });
    board.appendChild(list);
  }

  function note(text) {
    var p = document.createElement('p');
    p.className = 'toy-board-note';
    p.textContent = text;
    return p;
  }

  function entryForm() {
    var form = document.createElement('form');
    form.className = 'toy-board-entry';
    var label = document.createElement('label');
    label.textContent = '¡' + meters(pendingScore) + '! Tus iniciales:';
    var input = document.createElement('input');
    input.name = 'initials';
    input.maxLength = 3;
    input.required = true;
    input.autocomplete = 'off';
    input.pattern = '[A-Za-z0-9]{3}';
    input.placeholder = 'AAA';
    input.value = store('get', 'lglc_initials') || '';
    input.addEventListener('input', function () { input.value = input.value.replace(/[^a-z0-9]/gi, '').toUpperCase(); });
    var save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Guardar';
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(save);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!/^[A-Z0-9]{3}$/.test(input.value)) { input.focus(); return; }
      store('set', 'lglc_initials', input.value);
      var px = pendingScore;
      pendingScore = 0;
      submitScore(input.value, px);
    });
    setTimeout(function () { input.focus({ preventScroll: true }); }, 30);
    return form;
  }

  function submitScore(initials, px) {
    fetch(SCORES_API + '/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initials: initials, distance: px, device: window.innerWidth < 600 ? 'mobile' : 'desktop' })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'error');
        track('toy_score_saved', { rank: d.rank });
        return loadScores();
      })
      .then(function () { toggleBoard(true); renderBoard(false, initials); })
      .catch(function () { renderBoard(true); });
  }

  // Cuando un icono lanzado se para: etiqueta con la distancia y, si toca, al ranking.
  function finishThrow(b) {
    var px = Math.round(b.throwDist);
    b.throwing = false;
    b.throwDist = 0;
    if (px < PX_PER_METER) return;
    var record = px > best;
    floatLabel(b, meters(px) + (record && best ? ' · ¡récord!' : ''));
    track('toy_distance', { meters: Math.round(px / PX_PER_METER * 10) / 10 });
    if (!record) return;
    best = px;
    store('set', 'lglc_best', String(px));
    updateBest();
    var check = scores ? Promise.resolve(scores) : loadScores();
    check.then(function () {
      if (!qualifies(px)) return;
      var initials = store('get', 'lglc_initials');
      if (initials) submitScore(initials, px);
      else { pendingScore = px; toggleBoard(true); }
    }).catch(function () { /* sin ranking: la marca queda solo en este navegador */ });
  }

  function floatLabel(b, text) {
    var label = document.createElement('span');
    label.className = 'toy-distance';
    label.textContent = text;
    label.style.left = (b.x + b.w / 2) + 'px';
    label.style.top = b.y + 'px';
    label.addEventListener('animationend', function () { label.remove(); });
    document.body.appendChild(label);
  }

  function resetAll() {
    bodies.forEach(function (b) {
      b.vx = b.vy = 0; b.spin = 0; b.sx = b.sy = 1; b.moved = false; b.settled = true; b.throwing = false;
      b.el.classList.remove('toy-active');
      b.el.style.transform = '';
      b.el.style.left = b.homeStyle.left;
      b.el.style.top = b.homeStyle.top;
      b.el.style.right = b.homeStyle.right;
      b.el.style.bottom = b.homeStyle.bottom;
      var popup = popupFor(b.el);
      if (popup) {
        popup.classList.remove('visible');
        popup.style.left = popup.style.top = popup.style.right = popup.style.bottom = '';
      }
    });
    activated = false;
    bodies = [];
    if (hud) { hud.remove(); hud = null; resetButton = null; scoreEl = null; bestEl = null; boardButton = null; }
    if (board) board.classList.remove('visible');
  }

  // Abre el proyecto del icono y coloca su popup al lado de donde está ahora.
  function openProject(b, how) {
    var popup = popupFor(b.el);
    if (!popup) return;
    Array.prototype.forEach.call(document.querySelectorAll('.easter-egg-popup.visible'), function (p) {
      if (p !== popup) p.classList.remove('visible');
    });
    placePopup(b, popup);
    popup.classList.add('visible');
    sparks(b.x + b.w / 2, b.y + b.h / 2, 10);

    var egg = b.el.getAttribute('data-egg');
    if (!found[egg]) {
      found[egg] = true;
      showReset();
      updateScore();
      if (!completed && Object.keys(found).length === icons.length) {
        completed = true;
        var s = signatureRect();
        if (s) for (var k = 0; k < 6; k++) sparks(s.left + Math.random() * s.width, s.top + Math.random() * s.height, 8);
        track('toy_complete');
      }
    }
    var sig = document.querySelector('.nombre-firma');
    if (sig) {
      sig.classList.remove('toy-hit');
      void sig.offsetWidth; // reinicia la animación
      sig.classList.add('toy-hit');
    }
    track('toy_open_project', { egg: b.el.getAttribute('data-egg'), how: how });
  }

  function placePopup(b, popup) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = Math.min(popup.offsetWidth || 280, vw - 16);
    var ph = popup.offsetHeight || 160;
    var left = b.x + b.w / 2 - pw / 2;
    var top = b.y + b.h + 12;
    if (top + ph > vh - 8) top = b.y - ph - 12;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    top = Math.max(8, Math.min(top, vh - ph - 8));
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.right = 'auto';
    popup.style.bottom = 'auto';
  }

  function onSignature(b) {
    var s = signatureRect();
    if (!s) return false;
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return cx > s.left && cx < s.right && cy > s.top && cy < s.bottom;
  }

  // --- Arrastrar y lanzar ------------------------------------------------------

  icons.forEach(function (el) {
    el.setAttribute('draggable', 'false');
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || document.body.classList.contains('mode-agent')) return;
      touched = true;
      activate();
      var b = bodyOf(el);
      if (!b) return;
      drag = {
        b: b, id: e.pointerId, startX: e.clientX, startY: e.clientY,
        offX: e.clientX - b.x, offY: e.clientY - b.y, moved: false,
        samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }]
      };
      b.vx = b.vy = 0;
      b.throwing = false; // agarrarlo en el aire anula el tiro
      document.body.classList.add('toy-grabbing');
      // Al jugar se cierra el ranking, salvo que esté esperando unas iniciales.
      if (board && board.classList.contains('visible') && !pendingScore) toggleBoard();
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        el.classList.add('toy-dragging');
        var popup = popupFor(el);
        if (popup) popup.classList.remove('visible');
      }
      var b = drag.b;
      b.x = clampX(e.clientX - drag.offX, b);
      b.y = clampY(e.clientY - drag.offY, b);
      b.moved = true;
      var now = performance.now();
      drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
      while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
      render(b);
      collideAll(b);
      wake();
    });

    function release(e) {
      if (!drag || drag.id !== e.pointerId) return;
      var b = drag.b;
      el.classList.remove('toy-dragging');
      document.body.classList.remove('toy-grabbing');
      if (drag.moved) {
        suppressClick = true; // el clic que llega después no debe abrir el popup
        var s = drag.samples, first = s[0], last = s[s.length - 1];
        var dt = Math.max((last.t - first.t) / 1000, 0.016);
        // Si se sostiene quieto antes de soltar, no hay lanzamiento: se deja caer donde está.
        var held = performance.now() - last.t > 80;
        if (!reduceMotion && !held) {
          b.vx = limit((last.x - first.x) / dt);
          b.vy = limit((last.y - first.y) / dt);
        }
        b.settled = false;
        if (Math.hypot(b.vx, b.vy) >= MIN_THROW_SPEED) { b.throwing = true; b.throwDist = 0; }
        showReset();
        if (!thrownOnce) { thrownOnce = true; track('toy_throw'); }
        if (onSignature(b) && Math.hypot(b.vx, b.vy) < 400) { b.vx = b.vy = 0; openProject(b, 'drop'); }
        wake();
      }
      drag = null;
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  });

  // Fase de captura: un arrastre no debe contar como clic (ni abrir popups ni medir analítica).
  document.addEventListener('click', function (e) {
    if (!suppressClick) return;
    if (e.target instanceof Element && e.target.closest('.easter-egg')) {
      e.stopPropagation();
      e.preventDefault();
    }
    suppressClick = false;
  }, true);

  // Clic normal: el popup se abre al lado del icono, esté donde esté.
  document.addEventListener('click', function (e) {
    if (!activated || !(e.target instanceof Element)) return;
    var el = e.target.closest('.easter-egg');
    if (!el) return;
    var b = bodyOf(el), popup = popupFor(el);
    if (b && b.moved && popup && popup.classList.contains('visible')) placePopup(b, popup);
  });

  function limit(v) { return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v)); }
  function clampX(x, b) { return Math.max(0, Math.min(x, window.innerWidth - b.w)); }
  function clampY(y, b) { return Math.max(0, Math.min(y, window.innerHeight - b.h)); }

  // --- Simulación ----------------------------------------------------------------

  function wake() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(step);
  }

  function step(now) {
    var dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    var anyMoving = false;
    var decay = Math.exp(-FRICTION * dt);

    bodies.forEach(function (b) {
      if (drag && drag.b === b) { anyMoving = true; return; }
      var speed = Math.hypot(b.vx, b.vy);
      if (speed < REST_SPEED) {
        if (!b.settled) {
          b.settled = true;
          b.vx = b.vy = 0;
          b.spin = 0;
          b.sx = b.sy = 1;
          render(b);
          if (b.throwing) finishThrow(b);
          if (b.moved && onSignature(b)) openProject(b, 'settle');
        }
        return;
      }
      anyMoving = true;
      if (b.throwing) b.throwDist += speed * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= decay;
      b.vy *= decay;
      b.spin += b.vx * dt * 0.6;

      var maxX = window.innerWidth - b.w, maxY = window.innerHeight - b.h;
      var hitX = b.x < 0 || b.x > maxX, hitY = b.y < 0 || b.y > maxY;
      if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx) * BOUNCE; }
      if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * BOUNCE; }
      if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy) * BOUNCE; }
      if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * BOUNCE; }
      // Se aplastan contra el borde y recuperan la forma.
      if (!reduceMotion && speed > 300) {
        if (hitX) { b.sx = 0.72; b.sy = 1.18; }
        if (hitY) { b.sy = 0.72; b.sx = 1.18; }
      }
      var relax = Math.min(1, dt * 11);
      b.sx += (1 - b.sx) * relax;
      b.sy += (1 - b.sy) * relax;
      render(b);
    });

    for (var i = 0; i < bodies.length; i++) collideAll(bodies[i]);

    if (anyMoving) requestAnimationFrame(step);
    else running = false;
  }

  // Choque entre círculos de la misma masa, con corrección para que no se solapen.
  function collideAll(a) {
    for (var j = 0; j < bodies.length; j++) {
      var b = bodies[j];
      if (a === b) continue;
      var ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
      var dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy), min = a.r + b.r;
      if (dist === 0 || dist >= min) continue;
      var nx = dx / dist, ny = dy / dist, overlap = min - dist;
      var aHeld = drag && drag.b === a, bHeld = drag && drag.b === b;
      if (aHeld) { b.x += nx * overlap; b.y += ny * overlap; }
      else if (bHeld) { a.x -= nx * overlap; a.y -= ny * overlap; }
      else { a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; b.x += nx * overlap / 2; b.y += ny * overlap / 2; }

      var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        if (rel < -260) sparks(ax + nx * a.r, ay + ny * a.r, 6);
        var impulse = -(1 + BOUNCE) * rel / 2;
        if (!aHeld) { a.vx -= impulse * nx; a.vy -= impulse * ny; }
        if (!bHeld) { b.vx += impulse * nx; b.vy += impulse * ny; }
      }
      if (aHeld) { // empujar con un icono agarrado transmite algo de su movimiento
        b.vx += nx * 120; b.vy += ny * 120;
      }
      a.settled = b.settled = false;
      a.moved = b.moved = true;
      b.x = clampX(b.x, b); b.y = clampY(b.y, b);
      if (!aHeld) { a.x = clampX(a.x, a); a.y = clampY(a.y, a); }
      render(a); render(b);
      showReset();
    }
  }

  // Pista: si nadie ha tocado nada, un icono se menea una vez.
  if (!reduceMotion) {
    setTimeout(function () {
      if (touched || document.body.classList.contains('mode-agent')) return;
      var el = icons[Math.floor(Math.random() * icons.length)];
      el.classList.add('toy-hint');
      el.addEventListener('animationend', function () { el.classList.remove('toy-hint'); }, { once: true });
    }, 3500);
  }

  // Si cambia el tamaño de la ventana, que ningún icono se quede fuera.
  window.addEventListener('resize', function () {
    bodies.forEach(function (b) { b.x = clampX(b.x, b); b.y = clampY(b.y, b); render(b); });
  });
})();
