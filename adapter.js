/* 3Deep-Widget, Adapter Version 34.
   Liest einen Bookmark-Ordner samt Produktstruktur über die 3DEXPERIENCE-REST-Schnittstellen (3DSpace)
   und übergibt das Ergebnis im 3Deep-JSON-Format an die Darstellung datenraum3d.html (eingebettet als iframe).
   Im 3DDashboard: Anmeldung des Benutzers über DS/WAFData. Direkt im Browser geöffnet: Testmodus mit Beispieldaten
   im Format der echten Schnittstellen-Antworten. */
(function () {
  'use strict';
  var DARSTELLUNG = '84';   // Version von datenraum3d.html; muss zu <meta name="3deep-darstellung"> dort passen (tests/test-gleichstand.js)
  var BKS = '/resources/v1/modeler/dsbks/dsbks:Bookmark';
  var ENG = '/resources/v1/modeler/dseng/dseng:EngItem';
  var DOC = '/resources/v1/modeler/documents';
  var PNO = '/resources/modeler/pno/person';
  var ISS = '/resources/v1/modeler/dsiss/issue';
  var TSK = '/resources/v1/modeler/tasks';
  var XCAD = '/resources/v1/modeler/dsxcad/', DSDO = '/resources/v1/modeler/dsdo/';
  // bevorzugte abgeleitete Formate (Derived Outputs) für den Download von Bauteilen
  var CADFORMATE = ['STEP', 'STP', '3DXML', 'JT', 'IGES', 'IGS', 'STL', 'CGR', 'PDF'];
  var MAXISSUES = 400;
  var SEITE = 50, PARALLEL = 8, MAXTIEFE = 12, EXPANDGRENZE = 10000;   // expand liefert laut DS höchstens 10000 Einträge
  // Dokument-Beziehungen eines Objekts: Name der Beziehung -> Art in der Darstellung
  // Zone Query (laut Doku R2026x: POST /cvservlet/zonequeries): Attribute aller Strukturobjekte mit einer Abfrage. Varianten von viel nach wenig;
  // nur ds6w:label/ds6w:type/physicalid stehen so in der Doku, die übrigen Prädikate sind vermutet.
  var ZQ = '/cvservlet/zonequeries';
  // Unter-Bookmarks (Adapter 25, gesichert per Mitschnitt des Bookmark Editors): POST enorelnav/v2/navigate/i3dx/getecosystem, direction "out";
  // Link-Typ workspaces_bookmarks_to = Unterordner, workspaces_folders_to = Objekt im Ordner. Ordner-Typ Wurzel "Workspace", Unterordner "Workspace Vault".
  var ECO = '/resources/enorelnav/v2/navigate/i3dx/getecosystem';
  // Zahl der Beziehungen je Objekt und Beziehungsname (Relational Explorer, gesichert per Mitschnitt 12.11.2026); hier nur für die Beziehungsübersicht in der Diagnose
  var RCNT = '/resources/enorelnav/v2/navigate/i3dx/getrelationcount';
  var ECOPAKET = 25, ECOPARALLEL = 6;   // Objekte je getecosystem-Aufruf (25 auf der Plattform bestätigt); gleichzeitige Aufrufe über alle Sammelabfragen zusammen
  var ECOTAX = { 'Workspace': 'types/Project Management/Workspace', 'Workspace Vault': 'types/Workspace Vault' };
  var ZQATTR = [
    ['physicalid', 'ds6w:label', 'ds6w:identifier', 'ds6w:type', 'ds6w:status', 'ds6w:responsible', 'ds6w:created', 'ds6w:modified', 'ds6w:description', 'ds6wg:revision', 'ds6wg:EnterpriseExtension.V_PartNumber'],
    ['physicalid', 'ds6w:label', 'ds6w:identifier', 'ds6w:type', 'ds6w:status', 'ds6w:responsible', 'ds6w:created', 'ds6w:modified', 'ds6w:description'],
    ['physicalid', 'ds6w:type', 'ds6w:label']];
  var ZQMETA = { 'ds6w:label': 'Titel', 'ds6w:identifier': 'Name', 'ds6wg:revision': 'Revision', 'ds6w:status': 'Reifegrad', 'ds6w:description': 'Beschreibung',
    'ds6wg:EnterpriseExtension.V_PartNumber': 'Teilenummer', 'ds6w:responsible': 'Besitzer', 'ds6w:created': 'Erstellt', 'ds6w:modified': 'Geändert' };
  var zqVar = 0;
  var DOKREL = [{ rel: 'SpecificationDocument', art: 'spec' }, { rel: 'PLMDocConnection', art: 'praes' }, { rel: 'Reference Document', art: 'praes' }];
  var S = { foto: {}, fotoInfo: null, live: false, WAF: null, space: '', tenant: '', ctx: '', root: null, log: [], roh: {}, bereit: false, wartend: null,
    frame: null, viewerUrl: '', max: 1500, issCache: {}, issCacheZ: { treffer: 0, neu: 0 }, issCacheMs: 30 * 60 * 1000,
    cache: {}, cacheMs: 30 * 60 * 1000, cacheZ: { treffer: 0, neu: 0 }, stufen: [], lauf: 0, abbruch: false, vorn: '', zuletzt: null, nachladen: false, neuVerzug: 500, neuLaden: 0, laeuft: false, treffer: [], dateien: {}, csrf: '', cad: {}, cadTyp: {}, cadInfo: [], vorschau: {}, vorschauZahl: 0, vorschauInfo: null, vorschauTest: null };

  // ---------- kleine Helfer ----------
  function q(sel) { return S.root.querySelector(sel); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function status(t, fehler) { var e = q('.td-st'); if (e) { e.textContent = t; e.style.color = fehler ? '#cc092f' : '#3d3d3d'; } }
  // Fortschritt des Ladens. S.vorn: Vorspann, solange im Hintergrund weitergeladen wird (das Bild steht schon). Ein frischer Download-Link
  // oder eine Download-Meldung bleibt 15 s stehen, damit der Fortschritt sie nicht überschreibt.
  function fortschritt(t) {
    var e = q('.td-st'); if (!e) return;
    if (S.vorn && Date.now() - (S.dlZeit || 0) < 15000) return;
    e.textContent = (S.vorn || '') + t; e.style.color = '#3d3d3d';
  }
  function mitglieder(r) {
    if (Array.isArray(r)) return r; if (!r || typeof r !== 'object') return [];
    if (Array.isArray(r.member)) return r.member; if (Array.isArray(r.data)) return r.data; if (Array.isArray(r.issue)) return r.issue;
    var k = Object.keys(r).filter(function (x) { return Array.isArray(r[x]) && ['masks', 'definitions'].indexOf(x) < 0; });
    return k.length === 1 ? r[k[0]] : [];
  }
  function sauber(k, v) { if (k === 'csrf' || /^(ticket|jobticket|jobTicket)$/.test(k)) return '(entfernt)'; if (k === 'ticketURL') return String(v).slice(0, 70) + '… (gekürzt)'; return v; }
  function datum(t) { if (!t) return ''; var d = new Date(t); return isNaN(d) ? String(t) : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
  function pool(liste, n, fn) {
    var i = 0, erg = [];
    function weiter() { if (i >= liste.length) return Promise.resolve(); var k = i++; return fn(liste[k], k).then(function (r) { erg[k] = r; }, function (e) { erg[k] = { fehler: e }; }).then(weiter); }
    var w = []; for (var j = 0; j < Math.min(n, liste.length); j++) w.push(weiter());
    return Promise.all(w).then(function () { return erg; });
  }

  // ---------- Zugriff auf die Plattform ----------
  function muster(pfad) { return pfad.replace(/\/[0-9A-Fa-f]{16,}(?=\/|$)/g, '/{ID}'); }
  function protokoll(pfad, params, ok, antwort, ms, ausSpeicher) {
    var m = muster(pfad) + (params && params.$mask ? ' [' + params.$mask + ']' : '') + (params && params.$fields ? ' [$fields=' + params.$fields + ']' : '') + (params && params.parentRelName ? ' [' + params.parentRelName + ']' : '');
    S.log.push({ zeit: new Date().toLocaleTimeString('de-DE'), aufruf: m, ok: ok, info: ok ? mitglieder(antwort).length + ' Einträge' + (ausSpeicher ? ' (Zwischenspeicher)' : '') : String(antwort), ms: ms, sp: !!ausSpeicher });
    if (S.log.length > 400) S.log.shift();
    if (ok && !S.roh[m]) { var t = ''; try { t = JSON.stringify(antwort, sauber, 1); } catch (e) { t = String(antwort); } S.roh[m] = t.length > 6000 ? t.slice(0, 6000) + '\n… (gekürzt)' : t; }
    if (!ok && !S.roh['FEHLER ' + m]) S.roh['FEHLER ' + m] = String(antwort);
  }
  function liveGet(pfad, params, ohneKontext, methode, kopfPlus, body) {
    var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var kopf = { Accept: 'application/json' };
    if (!ohneKontext && S.ctx) kopf.SecurityContext = S.ctx;
    Object.keys(kopfPlus || {}).forEach(function (k) { kopf[k] = kopfPlus[k]; });
    return new Promise(function (ja, nein) {
      var fertig = false;
      function fehler(e, d) { if (fertig) return; fertig = true; var t = (d && (d.message || d.error)) || (e && e.message) || String(e); nein(new Error(t)); }
      try {
        S.WAF.authenticatedRequest((/^https?:/.test(pfad) ? pfad : S.space + pfad) + (qs ? '?' + qs : ''), {
          method: methode || 'GET', type: 'json', headers: kopf, timeout: 30000, data: body == null ? undefined : JSON.stringify(body),
          onComplete: function (d) { if (fertig) return; fertig = true; if (typeof d === 'string') { try { d = d ? JSON.parse(d) : {}; } catch (e) { } } ja(d || {}); },
          onFailure: fehler, onPassportError: function (e) { fehler(e || new Error('Anmeldung (3DPassport) fehlgeschlagen')); },
          onTimeout: function () { fehler(new Error('keine Antwort nach 30 s')); }
        });
      } catch (e) { fehler(e); }
    });
  }
  // Zwischenspeicher aller Leseabfragen (Adapter 29, Wunsch des Nutzers): nur im Arbeitsspeicher, gültig S.cacheMs (30 min), S.cacheMs = 0 schaltet ihn ab.
  // Nicht gespeichert: Suchen, CSRF-Token, Download-Tickets und Issue-Details (die haben ihren eigenen Speicher S.issCache). Der Schlüssel lässt das
  // wechselnde Feld „label“ der Abfragen weg. „↻ Neu lesen“ leert alles (cacheLeeren).
  function cacheKey(pfad, p, methode, body) {
    var m = methode || 'GET';
    if (m === 'GET') { if (/\/search$|\/CSRF$|Ticket/i.test(pfad) || pfad.indexOf(ISS + '/') === 0) return ''; }
    else if (!(m === 'POST' && (pfad === ECO || pfad === RCNT || /\/cvservlet\/zonequeries$/.test(pfad) || /\/expand$/.test(pfad)))) return '';
    var b = ''; if (body != null) { var k = {}; Object.keys(body).forEach(function (x) { if (x !== 'label') k[x] = body[x]; }); b = JSON.stringify(k); }
    return m + ' ' + pfad + ' ' + JSON.stringify(Object.keys(p).sort().map(function (x) { return [x, p[x]]; })) + ' ' + b;
  }
  function cacheLeeren() {
    var n = Object.keys(S.cache).length + Object.keys(S.issCache).length;
    S.cache = {}; S.foto = {}; S.cacheZ = { treffer: 0, neu: 0 }; issueCacheLeeren(); return n;
  }
  function cacheAufraeumen() {
    var jetzt = Date.now(), ks = Object.keys(S.cache);
    ks.forEach(function (k) { if (jetzt - S.cache[k].t >= S.cacheMs) delete S.cache[k]; });
    ks = Object.keys(S.cache); if (ks.length > 20000) ks.sort(function (a, b) { return S.cache[a].t - S.cache[b].t; }).slice(0, ks.length - 20000).forEach(function (k) { delete S.cache[k]; });
  }
  function hole(pfad, params, ohneKontext, methode, kopfPlus, body) {
    var p = {}; Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    if (S.tenant) p.tenant = S.tenant;
    if (S.abbruch) return Promise.reject(new Error('abgebrochen'));   // ein neues Laden hat das laufende abgelöst
    var ck = S.cacheMs > 0 ? cacheKey(pfad, p, methode, body) : '', c = ck ? S.cache[ck] : null;
    if (c && Date.now() - c.t < S.cacheMs) { S.cacheZ.treffer++; protokoll(pfad, p, true, c.d, 0, true); return Promise.resolve(c.d); }
    S.aufrufe = (S.aufrufe || 0) + 1;
    var t0 = Date.now(), anfrage = S.live ? liveGet(pfad, p, ohneKontext, methode, kopfPlus, body) : testGet(pfad, p, methode, body);
    return anfrage.then(function (d) { protokoll(pfad, p, true, d, Date.now() - t0); if (ck) { S.cache[ck] = { t: Date.now(), d: d }; S.cacheZ.neu++; } return d; },
      function (e) { protokoll(pfad, p, false, e.message || e, Date.now() - t0); throw new Error(muster(pfad).split('/').slice(-2).join('/') + ': ' + (e.message || e)); });
  }
  function alleSeiten(pfad, params, lies) {
    var alles = [];
    function seite(skip) {
      var p = {}; Object.keys(params).forEach(function (k) { p[k] = params[k]; }); p.$top = SEITE; p.$skip = skip;
      return hole(pfad, p).then(function (r) {
        var m = lies ? lies(r) : mitglieder(r); alles = alles.concat(m);
        return (m.length < SEITE || alles.length > 20000) ? alles : seite(skip + m.length);
      });
    }
    return seite(0);
  }

  // ---------- Datei eines Dokuments herunterladen ----------
  function csrf(neu) {
    if (S.csrf && !neu) return Promise.resolve(S.csrf);
    if (S.csrfP && !neu) return S.csrfP;   // Zone Query, expand und getecosystem starten gleichzeitig: nur eine Token-Abfrage
    var pr = hole('/resources/v1/application/CSRF', {}, true).then(function (r) {
      if (S.csrfP === pr) S.csrfP = null;
      S.csrf = (r && r.csrf && r.csrf.value) || ''; if (!S.csrf) throw new Error('kein CSRF-Token erhalten'); return S.csrf;
    }, function (e) { if (S.csrfP === pr) S.csrfP = null; throw e; });
    S.csrfP = pr; return pr;
  }
  function ticket(docId, mehrere, zipName, zweiter) {
    return csrf(zweiter).then(function (tok) {
      var p = mehrere ? { zipFiles: 'true', zipName: zipName } : {};
      return hole(DOC + '/' + encodeURIComponent(docId) + '/files/DownloadTicket', p, false, 'PUT', { ENO_CSRF_TOKEN: tok, 'Content-Type': 'application/json' });
    }).then(function (r) {
      var d = mitglieder(r)[0] || {}, e = d.dataelements || d;
      if (!e.ticketURL) throw new Error('keine Download-Adresse erhalten');
      return { url: e.ticketURL, name: e.fileName || (mehrere ? zipName : '') };
    }, function (e) { if (!zweiter) return ticket(docId, mehrere, zipName, true); throw e; });
  }
  // Adapter 34 (Wunsch des Nutzers): Attachments mit genau einer png/jpg-Datei als Foto in der Profilkarte (Darstellung: img + imgFoto, Rahmen 250–500 px).
  // Die Bildadresse ist die Download-Adresse mit Ticket (gleicher Aufruf wie „Datei herunterladen“, auf der Plattform bestätigt; als Bildquelle vermutet).
  // Geholt am Ende des Ladens für höchstens 40 Fotos, 4 gleichzeitig; die Darstellung lädt sie sofort vor, ein späterer Ablauf des Tickets stört dann nicht.
  // Kein Laden beim Rechtsklick (wäre eine neue Ausnahme der Grundregel). Gemerkt je Dokument 10 min (S.foto).
  var FOTO_MAX = 40, FOTO_MS = 10 * 60000;
  function istFoto(n) {
    var id = String(n.id || '').replace(/^[oz]:/, ''), inf = S.dateien[id];
    return !!(n.dl && inf && inf.n === 1 && /\.(png|jpe?g)\s*$/i.test(String((n.meta || {}).Dateien || n.name || '')));
  }
  function fotosAnwenden(nodes) {
    nodes.forEach(function (n) { var f = S.foto[String(n.id).replace(/^[oz]:/, '')]; if (f && f.u && istFoto(n)) { n.img = f.u; n.imgFoto = true; } });
  }
  async function fotosHolen(daten) {
    var jetzt = Date.now(), alle = daten.nodes.filter(istFoto), offen = alle.filter(function (n) { var f = S.foto[String(n.id).replace(/^[oz]:/, '')]; return !f || jetzt - f.t >= Math.min(FOTO_MS, S.cacheMs); })   // S.cacheMs=0 (Test) = immer neu.slice(0, FOTO_MAX);
    S.fotoInfo = { gesamt: alle.length, geholt: 0, fehler: 0, letzterFehler: '', bsp: '' };
    if (!alle.length) return;
    if (offen.length) fortschritt('Fotos (' + offen.length + ') …');
    await pool(offen, 4, async function (n) {
      if (S.abbruch) return; var id = String(n.id).replace(/^[oz]:/, '');
      try { var t = await ticket(id, false, ''); S.foto[id] = { u: t.url, t: Date.now() }; S.fotoInfo.geholt++; if (!S.fotoInfo.bsp) S.fotoInfo.bsp = adrKurz(t.url); }
      catch (e) { S.foto[id] = { u: '', t: Date.now() }; S.fotoInfo.fehler++; S.fotoInfo.letzterFehler = e.message; }
    });
    fotosAnwenden(daten.nodes);
  }
  // Ein abgelöstes Laden läuft noch kurz aus (S.abbruch): Downloads und Suchen warten so lange, sonst würden ihre Abfragen mit abgebrochen.
  function ruheWarten() { return S.abbruch && S.laufP ? S.laufP.then(function () { }, function () { }) : Promise.resolve(); }
  async function download(knotenId, name) {
    S.dlZeit = Date.now(); await ruheWarten();
    var docId = String(knotenId || '').replace(/^[oz]:/, ''), info = S.dateien[docId];
    if (docId && !info && S.cad[docId]) { await cadDownload(docId, name); diagnose(); return; }
    if (!docId || !info) { status('Zu diesem Objekt ist keine Datei bekannt.', true); return; }
    if (!info.n) { status('„' + (name || docId) + '“ enthält keine Datei.', true); return; }
    try {
      S.dlZeit = Date.now(); status('Fordere Download für „' + (name || docId) + '“ an …');
      var t = await ticket(docId, info.n > 1, String(name || 'Dokument').replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 60) + '.zip');
      var st = q('.td-st'); st.style.color = '#3d3d3d'; S.dlZeit = Date.now(); st.innerHTML = 'Datei bereit: <a class="td-dl" target="_blank" rel="noopener" style="color:#368ec4">' + esc(t.name || 'herunterladen') + '</a> (startet der Download nicht von selbst, hier klicken)';
      var a = q('.td-dl'); a.href = t.url; if (t.name) a.setAttribute('download', t.name);
      try { a.click(); } catch (e) { }
    } catch (e) { status('Download fehlgeschlagen: ' + e.message, true); }
    diagnose();
  }

  // ---------- Datei eines Bauteils/einer Baugruppe herunterladen ----------
  // Weg 1: CAD-Datei eines xCAD-Objekts (z. B. CATIA V5 .CATPart/.CATProduct) über dsxcad AuthoringFile/DownloadTicket.
  // Weg 2: abgeleitete Formate (Derived Outputs, z. B. STEP oder 3DXML) über dsdo Locate + DownloadTicket.
  // Beide Aufrufe laut DS-SDK ws3dx-dotnet (POST mit CSRF-Token), auf der Plattform noch unbestätigt.
  function ticketAus(r) {
    var gef = null;
    (function such(o, t) { if (gef || !o || typeof o !== 'object' || t > 6) return; if (o.ticketURL) { gef = o; return; } Object.keys(o).forEach(function (k) { such(o[k], t + 1); }); })(r, 0);
    if (!gef) return null;
    return { url: gef.ticketURL, name: gef.filename || gef.fileName || gef.title || '', ticket: gef.ticket || gef.jobticket || gef.jobTicket || '',
      param: gef.ticketparam || gef.ticketParam || '__fcs__jobTicket', felder: Object.keys(gef).join(', ') };
  }
  // Ticket-Download beim FCS: steht das Ticket nicht schon in der Adresse, wird es als Formularfeld (POST) mitgeschickt.
  // Ohne Ticket antwortet das FCS mit „Error ticket is null.“ (auf der Plattform gesehen, Adapter 16).
  function fcsWeg(t) {
    if (!t.ticket || t.url.indexOf(t.param + '=') >= 0) return 'link';
    return 'post';
  }
  function fcsSenden(t) {
    var f = document.createElement('form'); f.method = 'POST'; f.action = t.url; f.target = '_blank'; f.style.display = 'none';
    f.setAttribute('accept-charset', 'UTF-8');
    var i = document.createElement('input'); i.type = 'hidden'; i.name = t.param; i.value = t.ticket; f.appendChild(i);
    (S.root || document.body).appendChild(f);
    try { f.submit(); } finally { setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 2000); }
  }
  function zeigeDownload(t, quelle) {
    var st = q('.td-st'); st.style.color = '#3d3d3d';
    var weg = fcsWeg(t), name = esc(t.name || 'herunterladen');
    if (weg === 'link') {
      S.dlZeit = Date.now(); st.innerHTML = 'Datei bereit: <a class="td-dl" target="_blank" rel="noopener" style="color:#368ec4">' + name + '</a>' + (quelle ? ' – ' + esc(quelle) : '') + ' (startet der Download nicht von selbst, hier klicken)';
      var a = q('.td-dl'); a.href = t.url; if (t.name) a.setAttribute('download', t.name);
      try { a.click(); } catch (e) { }
      return 'Link';
    }
    var get = t.url + (t.url.indexOf('?') < 0 ? '?' : '&') + encodeURIComponent(t.param) + '=' + encodeURIComponent(t.ticket);
    S.dlZeit = Date.now(); st.innerHTML = 'Datei bereit: <button class="td-dlp" style="background:#368ec4;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit">⬇ ' + name + '</button>' + (quelle ? ' – ' + esc(quelle) : '') +
      ' (startet der Download nicht von selbst: Knopf drücken; klappt das nicht: <a class="td-dlg" target="_blank" rel="noopener" style="color:#368ec4">Weg 2</a>)';
    q('.td-dlp').onclick = function () { S.dlWeg = 'Knopf (POST)'; fcsSenden(t); diagnose(); };
    var g = q('.td-dlg'); g.href = get; g.onclick = function () { S.dlWeg = 'Weg 2 (Ticket in der Adresse)'; setTimeout(diagnose, 50); };
    try { fcsSenden(t); } catch (e) { }
    return 'Formular (POST, Feld ' + t.param + ')';
  }
  function postMitCsrf(pfad, body) {
    return csrf().then(function (tok) { return hole(pfad, {}, false, 'POST', { ENO_CSRF_TOKEN: tok, 'Content-Type': 'application/json' }, body || {}); });
  }
  function abgeleiteteDateien(r) {
    var liste = [];
    (function such(o, t) {
      if (!o || typeof o !== 'object' || t > 8) return;
      if (Array.isArray(o)) { o.forEach(function (x) { such(x, t + 1); }); return; }
      var k = Object.keys(o).filter(function (x) { return /^derivedoutputfiles$/i.test(x); })[0];
      if (k && Array.isArray(o[k])) o[k].forEach(function (f) { if (f && f.id) liste.push({ doId: o.id || o.doid || '', id: f.id, name: f.filename || f.fileName || '', fmt: String(f.format || '').toUpperCase() }); });
      Object.keys(o).forEach(function (x) { if (x !== k) such(o[x], t + 1); });
    })(r, 0);
    function rang(f) { var e = (f.fmt || (f.name.split('.').pop() || '')).toUpperCase(), i = CADFORMATE.indexOf(e); return i < 0 ? 99 : i; }
    return liste.filter(function (f) { return f.doId; }).sort(function (a, b) { return rang(a) - rang(b); });
  }
  async function cadDownload(id, name) {
    S.dlZeit = Date.now(); await ruheWarten();
    var typ = S.cadTyp[id] || '', wege = [], t = null, quelle = '';
    status('Suche Datei zu „' + (name || id) + '“ …');
    try { await csrf(true); } catch (e) { status('Download fehlgeschlagen: ' + e.message, true); return; }
    var arten = /Drawing|Drw/i.test(typ) ? ['Drawing'] : /Product/i.test(typ) ? ['Product', 'Part'] : ['Part', 'Product'];
    for (var i = 0; i < arten.length && !t; i++) {
      try {
        t = ticketAus(await postMitCsrf(XCAD + 'dsxcad:' + arten[i] + '/' + encodeURIComponent(id) + '/dsxcad:AuthoringFile/DownloadTicket', {}));
        if (t) quelle = 'CAD-Datei (dsxcad:' + arten[i] + ')'; else wege.push('dsxcad:' + arten[i] + ': keine Download-Adresse');
      } catch (e) { wege.push('dsxcad:' + arten[i] + ': ' + e.message); }
    }
    if (!t) {
      try {
        var r = await postMitCsrf(DSDO + 'dsdo:DerivedOutputs/Locate', { referencedObject: [{ source: S.space || '$3DSpace', type: (typ && !/dsxcad/i.test(typ)) ? typ : 'VPMReference', identifier: id, relativePath: ENG + '/' + id }] });
        var dateien = abgeleiteteDateien(r);
        if (!dateien.length) wege.push('Derived Outputs: keine vorhanden');
        for (var j = 0; j < dateien.length && !t; j++) {
          var f = dateien[j];
          try {
            t = ticketAus(await postMitCsrf(DSDO + 'dsdo:DerivedOutputs/' + encodeURIComponent(f.doId) + '/dsdo:DerivedOutputFiles/' + encodeURIComponent(f.id) + '/DownloadTicket', {}));
            if (t) { quelle = 'abgeleitetes Format ' + (f.fmt || '') + ' (Derived Output)'; if (!t.name) t.name = f.name; }
          } catch (e) { wege.push('Derived Output ' + (f.name || f.id) + ': ' + e.message); }
        }
      } catch (e) { wege.push('Derived Outputs: ' + e.message); }
    }
    if (!t) {
      S.cadInfo.push((name || id) + ' [' + id + ', Typ ' + (typ || '?') + ']: keine Datei' + (wege.length ? ' | ' + wege.join(' | ') : ''));
      if (S.cadInfo.length > 30) S.cadInfo.shift();
      status('Zu „' + (name || id) + '“ gibt es keine herunterladbare Datei (weder CAD-Datei wie .CATPart noch abgeleitetes Format wie STEP). Details unter „Diagnose“.', true); return;
    }
    var weg = zeigeDownload(t, quelle);
    S.cadInfo.push((name || id) + ' [' + id + ', Typ ' + (typ || '?') + ']: ok über ' + quelle + ', Datei ' + (t.name || '?') + ', übergeben per ' + weg + ', Felder der Antwort: ' + t.felder +
      ', Ticket ' + (t.ticket ? 'vorhanden (' + t.ticket.length + ' Zeichen)' : 'fehlt') + ', Adresse ' + String(t.url).split('?')[0].slice(0, 80) + (String(t.url).indexOf('?') >= 0 ? ' (mit Parametern)' : ' (ohne Parameter)') + (wege.length ? ' | ' + wege.join(' | ') : ''));
    if (S.cadInfo.length > 30) S.cadInfo.shift();
  }

  // ---------- die einzelnen Abfragen ----------
  function kontexte() {
    return hole(PNO, { current: 'true', select: 'collabspaces' }, true).then(function (r) {
      var liste = [], bevorzugt = '';
      var pc = r && r.preferredcredentials;
      if (pc && pc.role && pc.organization && pc.collabspace) bevorzugt = pc.role.name + '.' + pc.organization.name + '.' + pc.collabspace.name;
      ((r && r.collabspaces) || []).forEach(function (cs) {
        (cs.couples || []).forEach(function (c) { if (c.role && c.organization) liste.push(c.role.name + '.' + c.organization.name + '.' + cs.name); });
      });
      if (bevorzugt && liste.indexOf(bevorzugt) < 0) liste.unshift(bevorzugt);
      return { liste: liste, bevorzugt: bevorzugt || liste[0] || '' };
    });
  }
  function sucheBookmarks(text) {
    return hole(BKS + '/search', { $searchStr: text || '*', $mask: 'dsbks:BksMask.Details', $top: 100, $skip: 0 }).then(mitglieder);
  }
  // Unterordner, die nicht als normaler Inhalt kommen: ganze Antwort nach Objekten mit Ordner-Typ durchsuchen (Adapter 24, Feldname auf der Plattform unbekannt).
  // Nicht unter Schlüsseln wie parent/owner/context (sonst ginge es nach oben); der Bookmark selbst zählt nicht.
  function ordnerInAntwort(o, selbst, weg, aus, tiefe) {
    if (!o || typeof o !== 'object' || tiefe > 7) return aus;
    if (Array.isArray(o)) { o.forEach(function (x) { ordnerInAntwort(x, selbst, weg, aus, tiefe + 1); }); return aus; }
    var ro = o.referencedObject || o, i = ro.identifier || ro.id || ro.physicalid, t = ro.type || o.type || '';
    if (i && i !== selbst && istOrdner(t) && weg && !aus.some(function (a) { return a.id === i; })) aus.push({ id: i, titel: ro.title || o.title || ro.name || o.name || '', typ: t, feld: weg });
    Object.keys(o).forEach(function (k) { if (!/parent|owner|context|collabspace|organization|project/i.test(k)) ordnerInAntwort(o[k], selbst, weg ? weg + '.' + k : k, aus, tiefe + 1); });
    return aus;
  }
  async function unterordnerEco(o) {
    var tok = ''; try { tok = await csrf(); } catch (e) { }
    var kopf = { 'Content-Type': 'application/json' }; if (tok) kopf.ENO_CSRF_TOKEN = tok;
    var typ = o.typ || 'Workspace', eintraege = [{ id: o.id, relTypesTaxonomies: ECOTAX[typ] || ('types/' + typ), serviceId: '3DSpace', type: typ }, { id: o.id }], letzter = null;
    for (var i = 0; i < eintraege.length; i++) {
      try {
        var r = await hole(ECO, { xrequestedwith: 'xmlhttprequest' }, false, 'POST', kopf, { widgetId: '3Deep', label: '3Deep-' + Date.now(), relations: ['workspaces_folders_to', 'workspaces_bookmarks_to'], lang: 'en',
          computeWithInstances: false, allRelationsMode: true, publicationsMode: false, attributesForView: ['ds6w:label', 'ds6w:type', 'ds6w:identifier'], ghostMode: false,
          excludedRelations: ['v6_structure_roots_from'], direction: 'out', restrictedMode: false, responseMode: 'ObjectsAndLinks', items: [eintraege[i]], redirectQueryToSGI: true });
        var obj = {}; ((r && r.objects) || []).forEach(function (x) { if (x && x.id) obj[x.id] = x; });
        vorschauMerken((r && r.objects) || []);
        var kinder = ((r && r.links) || []).filter(function (l) { return l && l.type === 'workspaces_bookmarks_to' && l.source === o.id && l.target && l.target !== o.id; }).map(function (l) {
          var x = obj[l.target] || {}; return { id: l.target, titel: x['ds6w:label'] || x.name || '', typ: x.type || 'Workspace Vault' }; });
        return { kinder: kinder, objekte: ((r && r.links) || []).filter(function (l) { return l && l.type === 'workspaces_folders_to'; }).length, variante: i };
      } catch (e) { letzter = e; }
    }
    throw letzter;
  }
  function bookmarkInhalt(id) {
    var kopf = null, extra = [];
    return alleSeiten(BKS + '/' + encodeURIComponent(id), { $mask: 'dsbks:BksMask.Items2' }, function (r) {
      var b = mitglieder(r), bm = b.filter(function (x) { return x.id === id; })[0] || b[0] || {};
      if (!kopf) kopf = bm;
      ordnerInAntwort(r, id, '', extra, 0);
      var it = bm.items; if (Array.isArray(it) && it.length && it[0] && it[0].member) it = it[0];
      return mitglieder(it);
    }).then(function (items) { return { kopf: kopf || {}, items: items, extra: extra }; });
  }
  // Ganze Struktur unter einem Engineering Item in einer Abfrage (laut DS-SDK: POST dseng:EngItem/{ID}/expand, Maske dskern:Mask.Default).
  // Antwort: member[] mit Referenzen, Instanzen und (withPath) Pfaden [Referenz, Instanz, Referenz, …]. Liefert null, wenn die Antwort nicht auswertbar ist.
  async function expandStruktur(id, tiefe) {
    var tok = await csrf();
    var r = await hole(ENG + '/' + encodeURIComponent(id) + '/expand', {}, false, 'POST', { ENO_CSRF_TOKEN: tok, 'Content-Type': 'application/json' },
      { expandDepth: tiefe, withPath: true, type_filter_bo: ['VPMReference'], type_filter_rel: ['VPMInstance'] });
    var m = mitglieder(r), refs = {}, inst = {}, pfade = [];
    m.forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var pf = x.Path || x.path || x.paths;
      if (Array.isArray(pf)) { pfade.push(pf.map(function (e) { return typeof e === 'object' && e ? (e.id || e.identifier) : e; })); return; }
      if (!x.id) return;
      if (/Instance/i.test(x.type || '')) inst[x.id] = x; else refs[x.id] = x;
    });
    if (!pfade.length && !Object.keys(refs).length) return null;
    var kinder = {}, tiefeVon = {}; tiefeVon[id] = 0;
    pfade.forEach(function (pf) {
      if (pf[0] !== id) return;
      for (var i = 0; i + 2 < pf.length; i += 2) {
        var el = pf[i], ins = pf[i + 1], ki = pf[i + 2]; if (!el || !ki) continue;
        var k = kinder[el] = kinder[el] || {}; k[ki] = k[ki] || {}; if (ins) k[ki][ins] = 1;
        var t2 = i / 2 + 1; if (tiefeVon[ki] == null || t2 < tiefeVon[ki]) tiefeVon[ki] = t2;
      }
    });
    if (Object.keys(refs).length > 1 && !Object.keys(kinder).length) return null;   // Referenzen ohne Pfade: Struktur nicht ableitbar
    return { refs: refs, kinder: kinder, tiefe: tiefeVon, voll: m.length >= EXPANDGRENZE };
  }
  function engItem(id) {
    return hole(ENG + '/' + encodeURIComponent(id), { $mask: 'dsmveng:EngItemMask.Details' }).then(function (r) { return mitglieder(r)[0] || null; });
  }
  function instanzen(id) {
    return alleSeiten(ENG + '/' + encodeURIComponent(id) + '/dseng:EngInstance', { $mask: 'dsmveng:EngInstanceMask.Details' }).then(function (m) {
      var zahl = {}, folge = [];
      m.forEach(function (inst) { var ro = inst.referencedObject || {}, k = ro.identifier; if (!k) return; if (ro.type && !S.cadTyp[k]) S.cadTyp[k] = ro.type; if (!zahl[k]) { zahl[k] = 0; folge.push(k); } zahl[k]++; });
      return folge.map(function (k) { return { id: k, n: zahl[k] }; });
    });
  }
  function dokument(id) {
    return hole(DOC + '/' + encodeURIComponent(id), {}).then(function (r) { var d = mitglieder(r)[0]; return d ? (d.dataelements || d) : null; });
  }

  function dokumenteZu(id, rel) {
    return hole(DOC + '/parentId/' + encodeURIComponent(id), { parentRelName: rel, parentDirection: 'from', $include: 'files' }).then(mitglieder);
  }
  function issueIds(grenze, text) {
    var alles = []; grenze = grenze || MAXISSUES;
    function seite(skip) {
      return hole(ISS + '/search', { $searchStr: text || '*', $top: 100, $skip: skip }).then(function (r) {
        var m = mitglieder(r).map(function (x) { return x.identifier || x.id; }).filter(Boolean), neu = m.filter(function (x) { return alles.indexOf(x) < 0; });
        alles = alles.concat(neu);
        return (!neu.length || m.length < 20 || alles.length >= grenze) ? alles.slice(0, grenze) : seite(skip + m.length);
      });
    }
    return seite(0);
  }
  // Die Zusatzangaben eines Issues (Mitglieder, betroffene Objekte, Kontexte) kommen nur auf Anforderung über $fields
  var ISSFELDER = ['members,affectedItems,resolvedBy,resolution,contexts', 'all', ''], issVar = 0;
  // Zwischenspeicher der Issue-Details je Widget-Sitzung (Adapter 20): nur im Arbeitsspeicher, gültig S.issCacheMs (10 min).
  // Die Issue-Liste (issue/search) wird immer neu gelesen, nur die Details einzelner Issues kommen aus dem Speicher.
  function issueDetail(id) {
    var c = S.issCache[id];
    if (c && Date.now() - c.t < S.issCacheMs) { S.issCacheZ.treffer++; return Promise.resolve(c.d); }
    return issueDetailHolen(id).then(function (d) { if (d) { S.issCache[id] = { d: d, t: Date.now() }; S.issCacheZ.neu++; } return d; });
  }
  function issueCacheLeeren() { S.issCache = {}; S.issCacheZ = { treffer: 0, neu: 0 }; }
  function issueDetailHolen(id) {
    var v = issVar, p = ISSFELDER[v] ? { $fields: ISSFELDER[v] } : {};
    return hole(ISS + '/' + encodeURIComponent(id), p).then(function (r) { return mitglieder(r)[0] || (r && (r.id || r.title) ? r : null); },
      function (e) { if (!S.abbruch && !/Zeitlimit/.test(e.message) && v < ISSFELDER.length - 1) { if (issVar === v) issVar = v + 1; return issueDetailHolen(id); } throw e; });
  }
  // alle 32-stelligen IDs irgendwo in einer Antwort (Rückfall, wenn die erwarteten Felder fehlen)
  function alleIds(o, aus) {
    aus = aus || [];
    if (typeof o === 'string') { if (/^[0-9A-Fa-f]{32}$/.test(o)) aus.push(o); }
    else if (Array.isArray(o)) o.forEach(function (x) { alleIds(x, aus); });
    else if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { alleIds(o[k], aus); });
    return aus;
  }
  var taskInclude = true;
  function taskAufruf(pfad, params) {
    var p = {}; Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    if (!taskInclude) return hole(pfad, p).then(mitglieder);
    var mit = {}; Object.keys(p).forEach(function (k) { mit[k] = p[k]; }); mit.$include = 'all';
    return hole(pfad, mit).then(mitglieder, function (e) { if (S.abbruch || /Zeitlimit/.test(e.message)) throw e; taskInclude = false; return hole(pfad, p).then(mitglieder); });
  }
  function refIds(liste) {
    var ids = [];
    (Array.isArray(liste) ? liste : []).forEach(function (x) {
      if (!x) return;
      if (Array.isArray(x.elements)) { ids = ids.concat(refIds(x.elements)); return; }
      var i = x.identifier || x.id || (x.dataelements || {}).objectId; if (i) ids.push(i);
    });
    return ids;
  }
  function refObjs(liste) {
    var aus = [];
    (Array.isArray(liste) ? liste : []).forEach(function (x) {
      if (!x) return;
      if (Array.isArray(x.elements)) { aus = aus.concat(refObjs(x.elements)); return; }
      var i = x.identifier || x.id || (x.dataelements || {}).objectId; if (i) aus.push({ id: i, typ: x.type || '', pfad: x.relativePath || '' });
    });
    return aus;
  }
  function dokMeta(d, typ, id) {
    var e = (d && d.dataelements) || d || {}, dateien = [], anz = 0;
    try { (((d && d.relateddata) || {}).files || []).forEach(function (f) { anz++; var t = (f.dataelements || {}).title || f.title; if (t) dateien.push(t); }); } catch (x) { }
    S.dateien[id] = { n: (d && d.relateddata && d.relateddata.files) ? anz : 1 };
    var meta = { Titel: e.title || '', Name: e.name || '', Revision: e.revision || '', Reifegrad: e.stateNLS || e.state || '', Beschreibung: e.description || '', Dateien: dateien.join(', '),
      Besitzer: e.owner || '', Erstellt: datum(e.originated || e.created), 'Geändert': datum(e.modified), 'Collaborative Space': e.collabspace || '', Typ: e.typeNLS || (d && d.type) || typ || 'Document', ID: id };
    Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
    return { meta: meta, name: e.title || dateien[0] || e.name || ((typ || 'Dokument') + ' ' + String(id).slice(-6)), state: e.state || e.stateNLS || '' };
  }

  // ---------- Bookmark + Struktur lesen und in das 3Deep-JSON umsetzen ----------
  var ZUSTAND = { IN_WORK: 'In Work', FROZEN: 'Frozen', RELEASED: 'Released', OBSOLETE: 'Obsolete', PRIVATE: 'In Work' };
  function istProdukt(t) { return /VPMReference|EngItem|Physical ?Product/i.test(t || ''); }
  function istOrdner(t) { return /Workspace ?Vault|Bookmark|Workspace/i.test(t || ''); }

  // Zone Query ohne Raumfilter = Expand über den Index mit frei wählbaren 6W-Attributen; mehrere Wurzeln in einer Abfrage.
  // Antwort laut Doku: {results:[{attributes:[{name:'did',value},…]}, …, {path:[did,…]}], error?}. Liefert {physicalid: {Prädikat: Wert}}.
  function zoneAntwort(r) {
    var res = r && r.results; if (!Array.isArray(res)) throw new Error('keine Ergebnisliste (leere Antwort? Security Context prüfen)');
    if (res.length === 1 && res[0] && res[0].status) throw new Error(res[0].status);
    var aus = {}, zahl = 0, didPid = {}, pfadeD = [];
    res.forEach(function (x) {
      if (x && Array.isArray(x.path)) { pfadeD.push(x.path); return; }
      if (!x || !Array.isArray(x.attributes)) return;
      var a = {};
      x.attributes.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        if ('name' in e && 'value' in e) a[e.name] = e.value;
        else Object.keys(e).forEach(function (k) { a[k] = e[k]; });   // Form {"physicalid":"…"} aus dem Doku-Beispiel
      });
      var pid = a.physicalid; if (!pid) return;
      if (a.did != null) didPid[String(a.did)] = pid;
      delete a.did; delete a.physicalid; aus[pid] = a; zahl++;
    });
    if (!zahl) throw new Error('keine Attribute in der Antwort');
    Object.defineProperty(aus, '_pfade', { value: pfadeD.map(function (pf) { return pf.map(function (d) { return didPid[String(d)] || ''; }); }), enumerable: false });
    return aus;
  }
  async function zoneAttribute(wurzeln, tiefe) {
    var tok = '', basis = (S.space || '').replace(/\/enovia\/?$/i, ''), versuche = [];
    try { tok = await csrf(); } catch (e) { }
    for (var v = zqVar; v < ZQATTR.length; v++) versuche.push({ v: v, pfad: ZQ });
    if (S.live && basis && basis !== S.space) versuche.push({ v: ZQATTR.length - 1, pfad: basis + ZQ, ohneEnovia: true });
    var fehl = [];
    for (var i = 0; i < versuche.length; i++) {
      var w = versuche[i], kopf = { 'Content-Type': 'application/json' }; if (tok) kopf.ENO_CSRF_TOKEN = tok;
      try {
        var r = await hole(w.pfad, {}, false, 'POST', kopf, { root_path_physicalid: wurzeln.map(function (x) { return [x]; }), label: '3Deep.' + Date.now(),
          expand_iter: String(tiefe), select_bo: ZQATTR[w.v], select_rel: ['physicalid'], max_count_path: '50000' });
        var a = zoneAntwort(r);
        zqVar = w.v;
        return { attr: a, variante: w.v, ohneEnovia: !!w.ohneEnovia, fehl: fehl, fehler: r.error ? (r.error.errorMessage || JSON.stringify(r.error)).slice(0, 200) : '' };
      } catch (e) { fehl.push('Variante ' + (w.v + 1) + (w.ohneEnovia ? ' ohne /enovia' : '') + ': ' + e.message); }
    }
    throw new Error(fehl.join(' | '));
  }
  // Person (Start per Drag&Drop): Benutzername über pno/person/{ID} (Aufruf vermutet), sonst aus dem Drop-Eintrag
  async function personInfo(p) {
    var pi = { id: p.id, login: p.login || '', voll: p.name || '', mail: '', quelle: 'Drop-Eintrag' };
    try {
      var r = await hole(PNO + '/' + encodeURIComponent(p.id), {}, true), d = (r && (r.name || r.firstname)) ? r : (mitglieder(r)[0] || {});
      if (d.name) { pi.login = d.name; pi.quelle = 'pno/person/{ID}'; }
      var voll = d.fullname || [d.firstname, d.lastname].filter(Boolean).join(' '); if (voll) pi.voll = voll;
      if (d.email) pi.mail = d.email;
    } catch (e) { pi.fehler = e.message; }
    if (!pi.login && !pi.voll) pi.login = p.id;
    return pi;
  }
  function rollenVon(d, pi) {
    var m = d.members || {}, ro = [], gleich = function (x) { x = String(x || '').toLowerCase(); return !!x && ((pi.login && x === pi.login.toLowerCase()) || (pi.voll && x === pi.voll.toLowerCase())); };
    var namen = function (l) { return (Array.isArray(l) ? l : l ? [l] : []).map(function (x) { return typeof x === 'object' && x ? (x.name || x.login || x.fullname || '') : x; }); };
    if (namen(m.assignees).some(gleich)) ro.push('Zugewiesen');
    if (gleich(d.owner) || namen(m.coowners).some(gleich)) ro.push('Besitzer');
    if (namen(m.contributors).some(gleich)) ro.push('Mitwirkend');
    return ro;
  }
  // Zeichnungen (Adapter 18). Weg 1: Zone-Query-Pfade [… Referenz, RepInstanz, Repräsentation]; Repräsentation mit ds6w:type „Drawing“ (laut Doku liefert die
  // Zone Query auch Repräsentationen, Typname vermutet). Weg 2 je Objekt: dseng:EngItem/{ID}/dseng:EngRepInstance (vermutet).
  // Weg 3 für CATIA-V5-Objekte (xCAD): dsxcad:Part|Product/{ID}/dsxcad:Drawing (vermutet).
  function zeichnungenAusZone(zq) {
    var gef = {}, typen = {};
    Object.keys(zq).forEach(function (k) { var t = zq[k]['ds6w:type']; if (t) typen[t] = (typen[t] || 0) + 1; });
    (zq._pfade || []).forEach(function (pf) {
      for (var j = 2; j < pf.length; j += 2) {
        var rid = pf[j], a = zq[rid] || {};
        if (!rid || !/Drawing|Drw/i.test(a['ds6w:type'] || '')) continue;
        var g = gef[rid] = gef[rid] || { id: rid, eltern: {}, a: a, quelle: 'Zone Query' }; if (pf[j - 2]) g.eltern[pf[j - 2]] = 1;
      }
    });
    return { gef: gef, typen: typen };
  }
  function zeichnungenEng(id) {
    return alleSeiten(ENG + '/' + encodeURIComponent(id) + '/dseng:EngRepInstance', {}).then(function (m) {
      return m.map(function (x) { var ro = x.referencedObject || {}; return { id: ro.identifier || ro.id, typ: ro.type || '', titel: ro.title || x.title || String(x.name || '').replace(/\.\d+$/, '') }; })
        .filter(function (x) { return x.id && /Drawing|Drw/i.test(x.typ); });
    });
  }
  // Zeichnungen, die nur per Zeigerbeziehung am Produkt hängen (Adapter 26). Gesichert per Mitschnitt (Relational Explorer, von der Zeichnung aus):
  // getecosystem direction "out", relations ["v6_cad_document_to"], Link Zeichnung -> Produkt, "ro.xcadbasedependency.v_cadlinktype": "drawing".
  // Vom Produkt aus (hier): direction "in", relations v6_cad_document_from/_to (vermutet), mehrere Produkte je Aufruf (vermutet, sonst einzeln).
  var ECOTAX_PRD = 'types/PLMEntity/PLMReference/PLMCoreReference/LPAbstractReference/PHYSICALAbstractReference/VPMReference';
  var ECOTAX_DOC = 'types/DOCUMENTS/Document', ECOTAX_DRW = 'types/PLMEntity/PLMReference/PLMCoreRepReference/VPMRepReference/Drawing';
  function ecoProdukt(id) { return { id: id, typ: (S.cadTyp[id] && !/dsxcad/i.test(S.cadTyp[id])) ? S.cadTyp[id] : 'VPMReference', tax: ECOTAX_PRD }; }
  // getecosystem für viele Objekte (Adapter 29): Pakete zu ECOPAKET, ECOPARALLEL gleichzeitig. Schlägt ein Paket fehl, wird es halbiert (bis zum
  // Einzelobjekt); nach 3 Fehlern ohne einen Erfolg ist Schluss. info: {ok, fehler, pakete, einzeln, fehlerText}. auswerten(antwort, objekteNachId).
  // Zeichnungen, Dokumente und Issues fragen gleichzeitig (siehe „vorab“ in leseBookmark); zusammen laufen höchstens ECOPARALLEL Aufrufe.
  var ecoLaeuft = 0, ecoWarte = [];
  function ecoPlatz() { if (ecoLaeuft < ECOPARALLEL) { ecoLaeuft++; return Promise.resolve(); } return new Promise(function (ja) { ecoWarte.push(ja); }); }
  function ecoFrei() { var n = ecoWarte.shift(); if (n) n(); else ecoLaeuft--; }
  async function ecoPakete(objs, relations, richtung, info, auswerten) {
    var tok = ''; try { tok = await csrf(); } catch (e) { }
    var kopf = { 'Content-Type': 'application/json' }; if (tok) kopf.ENO_CSRF_TOKEN = tok;
    async function paket(pk) {
      if ((info.fehler >= 3 && !info.ok) || S.abbruch) return;
      await ecoPlatz();
      try {
        var r; try { r = await hole(ECO, { xrequestedwith: 'xmlhttprequest' }, false, 'POST', kopf, { widgetId: '3Deep', label: '3Deep-' + Date.now(), relations: relations, lang: 'en',
          computeWithInstances: false, allRelationsMode: true, publicationsMode: false, attributesForView: ['ds6w:label', 'ds6wg:revision', 'ds6w:status', 'ds6w:type', 'ds6w:modified', 'ds6w:responsible', 'ds6w:project', 'ds6w:identifier'],
          ghostMode: false, excludedRelations: ['v6_structure_roots_from'], direction: richtung, restrictedMode: false, responseMode: 'ObjectsAndLinks', redirectQueryToSGI: true,
          items: pk.map(function (o) { return { id: o.id, relTypesTaxonomies: o.tax, serviceId: '3DSpace', type: o.typ }; }) }); } finally { ecoFrei(); }
        var obj = {}; ((r && r.objects) || []).forEach(function (x) { if (x && x.id) obj[x.id] = x; });
        vorschauMerken((r && r.objects) || []);
        auswerten(r || {}, obj); info.ok += pk.length; info.pakete++;
      } catch (e) {
        if (S.abbruch) return;
        if (!info.fehlerText) info.fehlerText = e.message;
        if (pk.length === 1) { info.fehler++; return; }
        info.einzeln = true;
        var h = Math.ceil(pk.length / 2); await paket(pk.slice(0, h)); await paket(pk.slice(h));
      }
    }
    var pakete = []; for (var i = 0; i < objs.length; i += ECOPAKET) pakete.push(objs.slice(i, i + ECOPAKET));
    await pool(pakete, ECOPARALLEL, paket);
  }
  // Vorschaubilder (Adapter 30): getecosystem liefert je Objekt ein Bildfeld (laut Nutzer preview_url, Adresse auf dem FCS; Aufbau noch nicht per
  // Mitschnitt gesichert). Es wird aus den ohnehin laufenden Sammelabfragen (Zeichnungen, Dokumente, Issues) mitgenommen: keine eigene Abfrage.
  // Die Darstellung bekommt die Adresse als allgemeines Knotenfeld img. Gespeichert je Objekt-ID mit Zeitpunkt (Alter = Hinweis auf die Gültigkeit).
  function vorschauFeld(x) {
    if (typeof x.preview_url === 'string' && x.preview_url) return 'preview_url';
    var k = Object.keys(x).filter(function (k) { return /preview|thumbnail|thumb/i.test(k) && typeof x[k] === 'string' && x[k]; });
    return k[0] || '';
  }
  function vorschauAdr(v) {
    v = String(v || '').trim(); if (/^(https?:|data:image\/|blob:)/i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    if (/^\//.test(v) && S.space) return S.space.replace(/^(https?:\/\/[^\/]+).*$/, '$1') + v;
    return '';
  }
  function vorschauMerken(objs) {
    var vi = S.vorschauInfo; if (!vi) vi = S.vorschauInfo = { gesehen: {}, mit: 0, felder: {}, ohneBsp: null, mitBsp: null, roh: {} };
    objs.forEach(function (x) {
      if (!x || !x.id) return;
      var neu = !vi.gesehen[x.id]; vi.gesehen[x.id] = 1;
      var f = vorschauFeld(x), u = f ? vorschauAdr(x[f]) : '';
      if (!f) { if (!vi.ohneBsp) vi.ohneBsp = { typ: x.type || '?', felder: Object.keys(x).slice(0, 40) }; return; }
      if (neu) { vi.mit++; vi.felder[f] = (vi.felder[f] || 0) + 1; }
      if (!u) { if (!vi.roh[f]) vi.roh[f] = String(x[f]).slice(0, 80); return; }
      if (!vi.mitBsp) vi.mitBsp = { typ: x.type || '?', feld: f };
      [x.id, x.physicalid].forEach(function (id) {
        if (!id) return; var a = S.vorschau[id];
        if (!a || a.u !== u) { S.vorschau[id] = { u: u, t: Date.now(), feld: f, typ: x.type || '' }; S.vorschauZahl++; }
      });
    });
  }
  function vorschauAufraeumen() {
    var ks = Object.keys(S.vorschau), jetzt = Date.now();
    ks.forEach(function (k) { if (jetzt - S.vorschau[k].t > 4 * 3600 * 1000) delete S.vorschau[k]; });
    ks = Object.keys(S.vorschau); if (ks.length > 20000) ks.sort(function (a, b) { return S.vorschau[a].t - S.vorschau[b].t; }).slice(0, ks.length - 20000).forEach(function (k) { delete S.vorschau[k]; });
  }
  function adrKurz(u) {
    if (/^data:/i.test(u)) return u.slice(0, u.indexOf(',') + 1) + '… (' + u.length + ' Zeichen)';
    return u.replace(/([?&][^=&#]+)=[^&#]*/g, '$1=…').slice(0, 220);
  }
  // Ladetest im Browser des Widgets: lädt das Bild wie die Darstellung (img, ohne eigene Kopfzeilen); Pixel nur lesbar mit CORS-Freigabe oder data:
  function bildTest(u) {
    return new Promise(function (ja) {
      var t0 = Date.now(), im = new Image(), aus = false, uhr = setTimeout(function () { if (!aus) { aus = true; ja({ ok: false, text: 'keine Antwort nach 15 s' }); } }, 15000);
      im.onload = function () {
        if (aus) return; aus = true; clearTimeout(uhr);
        var r = { ok: true, w: im.naturalWidth, h: im.naturalHeight, ms: Date.now() - t0 };
        var p = new Image(); p.crossOrigin = 'anonymous';
        p.onload = function () {
          try {
            var c = document.createElement('canvas'); c.width = p.naturalWidth || 1; c.height = p.naturalHeight || 1; var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(p, 0, 0);
            var w = c.width - 1, h = c.height - 1, ecken = [[0, 0], [w, 0], [0, h], [w, h]].map(function (q) { return g.getImageData(q[0], q[1], 1, 1).data; });
            var tr = ecken.filter(function (d) { return d[3] < 20; }).length;
            r.hg = tr >= 3 ? 'transparent' : 'fest (Ecken ' + ecken.map(function (d) { return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')' + (d[3] < 255 ? ' α' + d[3] : ''); }).join(' / ') + ')';
          } catch (e) { r.hg = 'nicht prüfbar (Pixel gesperrt)'; }
          ja(r);
        };
        p.onerror = function () { r.hg = 'nicht prüfbar (keine CORS-Freigabe)'; ja(r); };
        p.src = u;
      };
      im.onerror = function () { if (aus) return; aus = true; clearTimeout(uhr); ja({ ok: false, ms: Date.now() - t0, text: 'lädt nicht (Fehler, abgelaufen oder keine Berechtigung)' }); };
      im.src = u;
    });
  }
  // Bis zu 3 verschiedene Adressen prüfen (bevorzugt Strukturobjekte); „Bilder prüfen“ in der Diagnose wiederholt den Test (Gültigkeitsdauer).
  async function vorschauPruefen() {
    var ids = Object.keys(S.vorschau), gesehen = {}, wahl = [];
    ids.sort(function (a, b) { return (/VPMReference|Part|Product/i.test(S.vorschau[b].typ) ? 1 : 0) - (/VPMReference|Part|Product/i.test(S.vorschau[a].typ) ? 1 : 0); });
    ids.forEach(function (id) { var v = S.vorschau[id]; if (wahl.length < 3 && !gesehen[v.u]) { gesehen[v.u] = 1; wahl.push({ id: id, v: v }); } });
    if (!wahl.length) { S.vorschauTest = { t: Date.now(), erg: [] }; diagnose(); return; }
    var erg = await Promise.all(wahl.map(function (w) { return bildTest(w.v.u).then(function (r) { r.id = w.id; r.typ = w.v.typ; r.alter = Date.now() - w.v.t; return r; }); }));
    S.vorschauTest = { t: Date.now(), erg: erg }; diagnose();
  }
  function ecoInfo() { return { ok: 0, fehler: 0, pakete: 0, einzeln: false, fehlerText: '', links: 0 }; }
  function ecoText(i) { return i.ok + ' Objekte geprüft' + (i.pakete ? ' in ' + i.pakete + ' Paketen' : '') + (i.einzeln ? ', teils geteilt' : '') + ', ' + i.fehler + ' Fehler'; }
  // Zeichnungen, die nur per Zeigerbeziehung am Produkt hängen (Adapter 26, auf der Plattform bestätigt): vom Produkt aus eingehend,
  // Link v6_cad_document_*, anderes Ende Typ Drawing oder "ro.xcadbasedependency.v_cadlinktype": "drawing".
  async function zeichnungenEco(ids, info) {
    var gef = [], menge = {}; ids.forEach(function (i) { menge[i] = 1; });
    await ecoPakete(ids.map(ecoProdukt), ['v6_cad_document_from', 'v6_cad_document_to'], 'in', info, function (r, obj) {
      (r.links || []).forEach(function (l) {
        if (!l || !/v6_cad_document/i.test(l.type || '')) return;
        [[l.source, l.target], [l.target, l.source]].forEach(function (p) {
          var z = obj[p[0]] || {}, art = String(l['ro.xcadbasedependency.v_cadlinktype'] || '').toLowerCase();
          if (!menge[p[1]] || menge[p[0]] || !(/Drawing/i.test(z.type || '') || art === 'drawing')) return;
          var tax = [].concat(z.taxonomies || [], z.relTypesTaxonomies || []).join(' ');
          gef.push({ id: p[0], el: p[1], typ: z.type || 'Drawing', titel: z['ds6w:label'] || z.name || '', v5: /XCADRepExtension/i.test(tax),
            a: { 'ds6w:label': z['ds6w:label'] || z.name, 'ds6w:identifier': z['ds6w:identifier'], 'ds6wg:revision': z['ds6wg:revision'] || z.revision, 'ds6w:status': z['ds6w:status'], 'ds6w:modified': z['ds6w:modified'], 'ds6w:responsible': z['ds6w:responsible'] } });
        });
      });
    });
    return gef;
  }
  // Issues zu geladenen Objekten (Adapter 27, auf der Plattform bestätigt): eingehend issue_from / issue_context_from (Namen aus getrelationcount).
  async function issuesEco(objs, info) {
    var menge = {}, gef = {}; objs.forEach(function (o) { menge[o.id] = 1; });
    await ecoPakete(objs, ['issue_from', 'issue_context_from', 'issue_to', 'issue_context_to'], 'in', info, function (r, obj) {
      (r.links || []).forEach(function (l) {
        if (!l || !/^issue(_context)?_(from|to)$/i.test(l.type || '')) return;
        [[l.source, l.target], [l.target, l.source]].forEach(function (pq) {
          var z = obj[pq[0]];
          if (!menge[pq[1]] || menge[pq[0]] || !(z ? /Issue/i.test(z.type || '') : true)) return;
          var g = gef[pq[0]] = gef[pq[0]] || { ids: [], kontext: [], titel: (z && (z['ds6w:label'] || z.name)) || '' };
          var feld = /context/i.test(l.type) ? g.kontext : g.ids; if (feld.indexOf(pq[1]) < 0) feld.push(pq[1]);
          info.links++;
        });
      });
    });
    return gef;
  }
  // Dokumente an Strukturobjekten (Adapter 29): vom Objekt aus ausgehend, Links v6_specdoc_to (Spezifikation) und v6_annexdoc_to (Attachment).
  // Namen gesichert über getrelationcount am Produkt und den Mitschnitt am Issue (v6_annexdoc_to -> Document); mehrere Objekte je Aufruf wie eingehend.
  // Liefert nur, WO Dokumente hängen, samt Grunddaten; Dateien und Beschreibung kommen danach über documents/parentId (nur für Objekte mit Dokumenten).
  async function dokumenteEco(ids, info) {
    var gef = [], menge = {}; ids.forEach(function (i) { menge[i] = 1; });
    await ecoPakete(ids.map(ecoProdukt), ['v6_specdoc_to', 'v6_annexdoc_to'], 'out', info, function (r, obj) {
      (r.links || []).forEach(function (l) {
        var m = l && /^v6_(specdoc|annexdoc)_(to|from)$/i.exec(l.type || ''); if (!m) return;
        [[l.source, l.target], [l.target, l.source]].forEach(function (p) {
          if (!menge[p[0]] || menge[p[1]] || !p[1]) return;
          var z = obj[p[1]] || {}; if (/Issue|Person/i.test(z.type || '')) return;
          var st = String(z['ds6w:status'] || '').split('.').pop();
          info.links++;
          gef.push({ id: p[1], el: p[0], art: /spec/i.test(m[1]) ? 'spec' : 'praes', rel: l.type,
            d: { id: p[1], type: z.type || 'Document', eco: true, dataelements: { title: z['ds6w:label'] || z.name || '', name: z['ds6w:identifier'] || '', revision: z['ds6wg:revision'] || z.revision || '', state: st,
              owner: z['ds6w:responsible'] || z.owner || '', modified: z['ds6w:modified'] || '', collabspace: z['ds6w:project'] || '' } } });
        });
      });
    });
    return gef;
  }
  // Beziehungsübersicht (Adapter 29) für die Diagnose: welche Beziehungen haben die ersten Objekte überhaupt? Ein Aufruf getrelationcount
  // (Aufbau wie im Mitschnitt: relations ["use-auto-by-type-relations"], mehrere items). Zeigt, ob es Beziehungen gibt, die das Widget noch nicht liest.
  async function beziehungsUebersicht(objs) {
    var tok = ''; try { tok = await csrf(); } catch (e) { }
    var kopf = { 'Content-Type': 'application/json' }; if (tok) kopf.ENO_CSRF_TOKEN = tok;
    var t0 = Date.now(), r = await hole(RCNT, { xrequestedwith: 'xmlhttprequest' }, false, 'POST', kopf, { widgetId: '3Deep', label: '3Deep-' + Date.now(), allRelationsMode: true,
      attributesForView: ['ds6w:label', 'ds6wg:revision', 'ds6w:status', 'ds6w:type', 'ds6w:modified', 'ds6w:responsible', 'ds6w:project', 'ds6w:dataSource', 'ds6w:identifier'],
      computeWithInstances: false, excludedRelations: ['v6_structure_roots_from'], ghostMode: false,
      items: objs.map(function (o) { return { id: o.id, relTypesTaxonomies: o.tax, serviceId: '3DSpace', type: o.typ }; }), lang: 'en', publicationsMode: false, redirectQueryToSGI: true, relations: ['use-auto-by-type-relations'] });
    var sum = {}; ((r && r.counts) || []).forEach(function (c) { if (!c || !c.name) return; var s = sum[c.name] = sum[c.name] || { richtung: c.direction || '', objekte: 0, zahl: 0 }; s.objekte++; s.zahl += +c.count || 0; });
    return { sum: sum, ms: Date.now() - t0, n: objs.length };
  }
  function zeichnungenXcad(id) {
    var art = /Product/i.test(S.cadTyp[id] || '') ? 'Product' : 'Part';
    return hole(XCAD + 'dsxcad:' + art + '/' + encodeURIComponent(id) + '/dsxcad:Drawing', {}).then(function (r) {
      return mitglieder(r).map(function (x) { var d = x.dataelements || x; return { id: x.id || x.identifier, typ: x.type || 'dsxcad:Drawing', titel: d.title || d.name || '', d: d }; }).filter(function (x) { return x.id; });
    });
  }
  function zqWert(k, v) {
    if (v == null || v === '') return '';
    if (k === 'ds6w:created' || k === 'ds6w:modified') return datum(v);
    return Array.isArray(v) ? v.join(', ') : String(v);
  }

  // q fehlt: Start beim Bookmark. q.issues = [IDs]: Start bei diesen Issues (per Drag & Drop).
  // q.produkte = [IDs]: Start bei Physical Products (nur abwärts). q.person = {id, name}: Start bei einer Person (ihre Issues und Aufgaben).
  async function leseBookmark(bmId, bmTitel, q) {
    var nodes = [], edges = [], gesehen = {}, hinweise = [], qIss = !!(q && (q.issues || q.person)), pi = null;
    var status = fortschritt;   // alle Fortschrittsmeldungen dieses Ladens (mit Vorspann, sobald das erste Bild steht)
    // Ergebnisse der Hintergrundstufen stehen von Anfang an bereit, damit baue() jederzeit einen Zwischenstand liefern kann
    var items = {}, anzahl = 0, grenze = false, zq = {}, zeich = {}, zeichZahl = 0, doks = {}, dokKanten = [], dokZahl = 0, dokGrenze = false;
    var exKnoten = [], exKanten = [], pers = {}, issues = {}, tasks = {};
    // Laden in Stufen (Adapter 29): melde() schickt den aktuellen Stand an die Darstellung. sofort = am Ende einer Stufe, sonst höchstens alle 1,5 s.
    // aend zählt Änderungen, die die Zahl der Objekte nicht verändern (nachgelieferte Attribute, Dokumentdetails).
    var letzteMeldung = 0, letzteSig = '', aend = 0;
    function pruef() { if (S.abbruch) throw new Error('abgebrochen'); }
    function abstand(ns) { var a = 3; ns.forEach(function (n) { if (n.type === 'folder' || n.type === 'dwg') return; var g = +n.size > 0 ? +n.size : ((types[n.type] || {}).size || 1); if (g > a) a = g; }); return +(2.8 * a).toFixed(3); }
    function melde(name, sofort) {
      if (!S.aufStufe || S.abbruch || (!sofort && Date.now() - letzteMeldung < 1500)) return;
      var g = {}; Object.keys(gesehen).forEach(function (k) { g[k] = gesehen[k]; });
      var z = baue(nodes.slice(), edges.slice(), g); if (!z.nodes.length) return;
      var sig = z.nodes.length + '/' + z.edges.length + '/' + aend + '/' + S.vorschauZahl; if (sig === letzteSig) return;
      letzteSig = sig; letzteMeldung = Date.now();
      S.aufStufe({ types: types, relTypes: relTypes, nodes: z.nodes, edges: z.edges, spacing: abstand(z.nodes), maxObjects: Math.max(500, z.nodes.length) }, name);
    }
    var types = {
      folder: { color: '#e6d2a6', size: 6, shape: 'folder', label: 'Bookmark-Folder' },
      asm: { color: '#4f8cff', size: 3.36, label: 'Baugruppe' },
      part: { color: '#2fc4ad', size: 1.96, label: 'Einzelteil' },
      issue: { color: '#ff4d6d', size: 2.2, shape: 'torus', label: 'Issue' },
      task: { color: '#f2c400', size: 1.4, shape: 'dodecahedron', label: 'Aufgabe' },
      person: { color: '#5fcf3f', size: 2.2, shape: 'bust', label: 'Person' },
      spec: { color: '#e5534b', size: 1.3, shape: 'book', label: 'Spezifikation' },
      praes: { color: '#f08a3c', size: 0.9, label: 'Attachment' },
      dwg: { color: '#9aa5b1', size: 1.8, label: 'Zeichnung' }
    };
    var relTypes = {
      struktur: { label: 'Strukturlink (enthält)', color: '#2f3f5c', directed: false },
      inhalt: { label: 'Enthalten in Bookmark', color: '#b07a10', directed: true },
      betrifft: { label: 'Issue betrifft', color: '#c2255c', directed: true },
      aufgabe: { label: 'Aufgabe für', color: '#b59500', directed: true },
      zuweisung: { label: 'Zugewiesen an', color: '#3a8f2f', directed: true },
      spec: { label: 'Spezifikationslink', color: '#b8403a', directed: true },
      praes: { label: 'Attachment-Link', color: '#c76a1c', directed: true },
      zeichnung: { label: 'Zeichnungslink', color: '#5d6975', directed: true }
    };
    var palette = ['#e5534b', '#d67bd9', '#f08a3c', '#5fcf3f', '#ff4d6d', '#9aa5b1', '#7c6cf0'], pi = 0;
    function typFuer(name) {
      var key = 't_' + String(name || 'Objekt').replace(/[^A-Za-z0-9]+/g, '_');
      if (!types[key]) {
        if (/Document/i.test(name)) types[key] = { color: '#c9a227', size: 1.3, shape: 'book', label: q ? 'Dokument' : 'Dokument (im Bookmark)' };
        else if (/Drawing/i.test(name)) types[key] = { color: '#9aa5b1', size: 0.9, label: 'Zeichnung' };
        else if (/Issue/i.test(name)) types[key] = { color: '#ff4d6d', size: 2.2, shape: 'torus', label: 'Issue' };
        else types[key] = { color: palette[pi++ % palette.length], size: 1.3, label: String(name || 'Objekt') };
      }
      return key;
    }

    // 1. Bookmark-Ordner (samt Unterordnern, soweit sie als Inhalt geliefert werden)
    var startProdukte = [], ordner = q ? [] : [{ id: bmId, titel: bmTitel, eltern: null }], oi = 0, andere = []; S.bmInfo = []; S.ecoFehl = 0;
    // Seit Adapter 29: Inhalt (Items2) und Unterordner (getecosystem) eines Ordners gleichzeitig, und die nächsten wartenden Ordner (bis zu 8) schon mit;
    // ausgewertet wird weiter in der bisherigen Reihenfolge.
    var holOrdner = {}, ordnerStart = function (x) {
      if (holOrdner[x.id]) return;
      holOrdner[x.id] = { inh: bookmarkInhalt(x.id).then(function (v) { return { ok: v }; }, function (e) { return { fehler: e }; }),
        eco: S.ecoFehl < 2 ? unterordnerEco(x).then(function (v) { return { ok: v }; }, function (e) { return { fehler: e }; }) : null };
    };
    while (oi < ordner.length && ordner.length < 200) {
      ordner.slice(oi, oi + 8).forEach(ordnerStart);
      var o = ordner[oi++];
      status('Lese Bookmark „' + (o.titel || o.id) + '“ …');
      var hol = holOrdner[o.id], ir0 = await hol.inh; pruef(); if (ir0.fehler) throw ir0.fehler;
      var inh = ir0.ok, ecoP = hol.eco;
      var k = inh.kopf || {};
      nodes.push({ id: 'bm:' + o.id, type: 'folder', name: k.title || k.name || o.titel || 'Bookmark',
        meta: { Titel: k.title || o.titel || '', Beschreibung: k.description || '', Besitzer: k.owner || '', Erstellt: datum(k.created), 'Geändert': datum(k.modified), 'Collaborative Space': k.collabspace || '', 'Objekte im Ordner': String(inh.items.length), ID: o.id } });
      if (o.eltern) edges.push({ from: 'bm:' + o.id, to: 'bm:' + o.eltern, type: 'inhalt' });
      inh.items.forEach(function (it) {
        var ro = (it && it.referencedObject) || it || {}, id = ro.identifier || ro.id, typ = ro.type || it.type || '';
        if (!id) return;
        if (istProdukt(typ)) { startProdukte.push({ id: id, bm: o.id }); if (typ && !S.cadTyp[id]) S.cadTyp[id] = typ; }
        else if (istOrdner(typ)) { if (!ordner.some(function (x) { return x.id === id; })) ordner.push({ id: id, titel: ro.title || it.title || '', eltern: o.id, typ: typ }); }
        else andere.push({ id: id, typ: typ, bm: o.id, titel: ro.title || it.title || ro.name || it.name || '' });
      });
      var typen = {}, vorher = ordner.length, ausFeld = [];
      inh.items.forEach(function (it) { var ro = (it && it.referencedObject) || it || {}, t = ro.type || it.type || '?'; typen[t] = (typen[t] || 0) + 1; });
      inh.extra.forEach(function (x) { if (!ordner.some(function (y) { return y.id === x.id; })) { ordner.push({ id: x.id, titel: x.titel, eltern: o.id, typ: x.typ }); ausFeld.push(x.feld); } });
      var eco = '';
      if (ecoP && ordner.length < 200) {
        var er0 = await ecoP; pruef();
        if (er0.ok) {
          var ue = er0.ok, neu = 0; S.ecoFehl = 0;
          ue.kinder.forEach(function (x) { if (!ordner.some(function (y) { return y.id === x.id; })) { ordner.push({ id: x.id, titel: x.titel, eltern: o.id, typ: x.typ }); neu++; } });
          eco = ', getecosystem: ' + ue.kinder.length + ' Unterordner' + (neu < ue.kinder.length ? ' (' + (ue.kinder.length - neu) + ' schon bekannt)' : '') + ', ' + ue.objekte + ' Objekte' + (ue.variante ? ' (nur mit ID)' : '');
        } else { S.ecoFehl++; eco = ', getecosystem fehlgeschlagen: ' + String(er0.fehler.message).slice(0, 160) + (S.ecoFehl >= 2 ? ' (für weitere Ordner übersprungen)' : ''); }
      } else if (S.ecoFehl >= 2) eco = ', getecosystem übersprungen';
      S.bmInfo.push('„' + (k.title || o.titel || o.id) + '“: ' + inh.items.length + ' Inhalte (' + (Object.keys(typen).map(function (t) { return t + ' ' + typen[t]; }).join(', ') || 'keine') + ')' +
        (ausFeld.length ? ', ' + ausFeld.length + ' Unterordner außerhalb des Inhalts (Feld ' + ausFeld.filter(function (f, i) { return ausFeld.indexOf(f) === i; }).join(', ') + ')' : '') +
        eco + (o.eltern ? ', Unterordner' : '') + '; Felder des Bookmarks: ' + Object.keys(k).join(', '));
    }
    if (ordner.length > 1 || S.bmInfo.length) S.bmInfo.unshift(ordner.length + ' Bookmark-Ordner gelesen (' + (ordner.length - 1) + ' Unterordner)' + (ordner.length >= 200 ? ', Grenze 200 erreicht' : ''));

    // 1b. Start bei Issues: Details lesen und die genannten Objekte als Ausgangspunkt nehmen
    var vorIssues = null;
    if (q && q.produkte) q.produkte.forEach(function (id) { startProdukte.push({ id: id, bm: null }); });
    S.personRollen = {}; S.personInfo = null;
    if (q && q.person) { pi = await personInfo(q.person); S.personInfo = pi; }
    if (qIss) {
      status(q.person ? 'Suche Issues von ' + (pi.voll || pi.login) + ' …' : 'Lese Issue …');
      var qIds = q.person ? await issueIds(MAXISSUES) : q.issues, qFertig = 0, schon = {};
      vorIssues = {}; S.issueZahl = qIds.length;
      await pool(qIds, PARALLEL, async function (iid) {
        try {
          var d = await issueDetail(iid);
          if (d && q.person) { var ro = rollenVon(d, pi); if (ro.length) S.personRollen[iid] = ro; else d = null; }
          if (d) vorIssues[iid] = d;
        } catch (e) { }
        qFertig++; if (qFertig % 10 === 0 || qFertig === qIds.length) status((q.person ? 'Prüfe Issues: ' : 'Lese Issues: ') + qFertig + ' von ' + qIds.length + ' …');
      });
      if (q.person) S.personInfo.issues = Object.keys(vorIssues).length + ' von ' + qIds.length + ' Issues mit Bezug zur Person';
      Object.keys(vorIssues).forEach(function (iid) {
        var d = vorIssues[iid];
        refObjs(d.affectedItems).concat(refObjs(d.contexts)).forEach(function (r) {
          if (schon[r.id] || vorIssues[r.id]) return; schon[r.id] = 1;
          if (/Document/i.test(r.typ) || /\/documents\//.test(r.pfad)) andere.push({ id: r.id, typ: 'Document', bm: null, titel: '' });
          else if (istOrdner(r.typ) || /Project|Space|Route|Task|Issue|Person|Change/i.test(r.typ)) andere.push({ id: r.id, typ: r.typ, bm: null, titel: '' });
          else startProdukte.push({ id: r.id, bm: null });
        });
      });
    }
    var maxTiefe = q ? (q.struktur ? MAXTIEFE : 0) : MAXTIEFE;
    S.wurzeln = startProdukte.map(function (p) { return p.id; });
    // 2. Produktstruktur abwärts
    pruef();
    var front = []; startProdukte.forEach(function (p) { if (front.indexOf(p.id) < 0) front.push(p.id); });
    S.expandInfo = []; S.expandFehl = 0; S.expandOk = false;
    // 2·. Attribute aller Strukturobjekte mit einer Zone Query (eine Abfrage für alle Startprodukte). Seit Adapter 29 läuft sie gleichzeitig mit
    // der Struktur: das erste Bild wartet nicht darauf, die Attribute kommen als zweite Stufe nach. Bei Fehler weiter wie bisher.
    var zqP = null; S.zqInfo = []; S.zqOk = false;
    if (S.mitZone && maxTiefe > 0 && front.length) {
      if ((S.zqFehl || 0) >= 2) S.zqInfo.push('übersprungen: in dieser Sitzung zweimal ohne Erfolg (Widget neu laden für einen neuen Versuch)');
      else {
        var tz = Date.now();
        zqP = zoneAttribute(front.slice(), maxTiefe === MAXTIEFE ? -1 : maxTiefe).then(function (zr) {
          zq = zr.attr; S.zqFehl = 0; S.zqOk = true; aend++;
          var namen = {}, pn = 0; Object.keys(zq).forEach(function (k) { Object.keys(zq[k]).forEach(function (n) { if (zq[k][n] !== '' && zq[k][n] != null) namen[n] = (namen[n] || 0) + 1; }); if (zq[k]['ds6wg:EnterpriseExtension.V_PartNumber']) pn++; });
          S.zqInfo.push('ok: Variante ' + (zr.variante + 1) + ' von ' + ZQATTR.length + (zr.ohneEnovia ? ' (Adresse ohne /enovia)' : '') + ', ' + Object.keys(zq).length + ' Objekte mit Attributen, davon ' + pn + ' mit Teilenummer, ' + ((Date.now() - tz) / 1000).toFixed(1) + ' s');
          S.zqInfo.push('gelieferte Attribute (Anzahl Objekte): ' + (Object.keys(namen).map(function (n) { return n + ' ' + namen[n]; }).join(', ') || '(keine)'));
          if (zr.fehl.length) S.zqInfo.push('vorher fehlgeschlagen: ' + zr.fehl.join(' | '));
          if (zr.fehler) S.zqInfo.push('Hinweis der Plattform: ' + zr.fehler);
          var bsp = Object.keys(zq)[0]; if (bsp) S.zqInfo.push('Beispiel ' + bsp + ': ' + JSON.stringify(zq[bsp]).slice(0, 600));
        }, function (e) { if (!S.abbruch) S.zqFehl = (S.zqFehl || 0) + 1; zq = {}; S.zqInfo.push('Rückfall auf den bisherigen Weg: ' + e.message); });
      }
    }
    // 2a. schneller Weg: ganze Struktur je Startprodukt mit einer expand-Abfrage (bis zu 4 Produkte gleichzeitig); bei Fehlern Rückfall auf Ebene für Ebene
    if (S.mitExpand && maxTiefe > 0 && front.length) {
      var rest = [], t0 = Date.now(), tiefeEx = maxTiefe === MAXTIEFE ? -1 : maxTiefe;
      status('Lese Produktstruktur (expand): ' + front.length + (front.length === 1 ? ' Produkt' : ' Produkte') + ' …');
      var exErg = await pool(front, 4, async function (wid) {
        if (S.expandFehl >= 2 && !S.expandOk) return { aus: true };   // expand geht hier offenbar nicht: nicht weiter versuchen
        var ex = null, grund = '';
        try { ex = await expandStruktur(wid, tiefeEx); if (!ex) grund = 'Antwort nicht auswertbar'; else if (ex.voll) { grund = 'Grenze von ' + EXPANDGRENZE + ' Einträgen erreicht'; ex = null; } }
        catch (e) { grund = e.message; }
        if (!ex) { S.expandFehl = (S.expandFehl || 0) + 1; return { grund: grund }; }
        S.expandOk = true; return { ex: ex };
      });
      pruef();
      front.forEach(function (wid, wi) {
        var er = exErg[wi] || {}, ex = er.ex;
        if (!ex) { rest.push(wid); if (!er.aus) S.expandInfo.push(wid + ': Rückfall auf Ebene für Ebene (' + (er.grund || (er.fehler && er.fehler.message) || '?') + ')'); return; }
        var reihe = Object.keys(ex.tiefe).sort(function (a, b) { return ex.tiefe[a] - ex.tiefe[b]; }), neu = 0;
        reihe.forEach(function (rid) {
          if (items[rid]) return;
          if (anzahl + nodes.length + andere.length >= S.max) { grenze = true; return; }
          var kk = ex.kinder[rid] || {};
          items[rid] = { id: rid, det: ex.refs[rid] || null, tiefe: ex.tiefe[rid], ausExpand: true,
            kinder: Object.keys(kk).map(function (c) { return { id: c, n: Math.max(1, Object.keys(kk[c]).length) }; }) };
          if (ex.refs[rid] && ex.refs[rid].type && !S.cadTyp[rid]) S.cadTyp[rid] = ex.refs[rid].type;
          anzahl++; neu++;
        });
        S.expandInfo.push(wid + ': ' + neu + ' Objekte über expand');
      });
      S.expandInfo.push('Dauer expand: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      front = rest;
      melde('Struktur', true);   // erstes Bild: Bookmark und Produktstruktur
    }
    for (var tiefe = 0; front.length && tiefe <= maxTiefe; tiefe++) {
      var frei = S.max - anzahl - nodes.length - andere.length;
      if (front.length > frei) { front = front.slice(0, Math.max(0, frei)); grenze = true; }
      front = front.filter(function (id) { return !items[id]; });
      front.forEach(function (id) { items[id] = { id: id, kinder: [], det: null, tiefe: tiefe }; });
      anzahl += front.length;
      status('Lese Produktstruktur: Ebene ' + (tiefe + 1) + ', bisher ' + anzahl + ' Objekte …');
      await pool(front, PARALLEL, async function (id) {
        try { items[id].det = await engItem(id); } catch (e) { items[id].fehler = e.message; }
        try { items[id].kinder = await instanzen(id); } catch (e) { items[id].kinder = []; if (!items[id].fehler) items[id].fehler = e.message; }
      });
      var naechste = [];
      front.forEach(function (id) { items[id].kinder.forEach(function (c) { if (!items[c.id] && naechste.indexOf(c.id) < 0) naechste.push(c.id); }); });
      front = naechste;
      pruef(); melde('Struktur', tiefe === 0 || !front.length);
      if (grenze) break;
    }
    if (grenze || (front.length && maxTiefe === MAXTIEFE)) hinweise.push('Höchstzahl von ' + S.max + ' Objekten erreicht, die Struktur ist unvollständig.');
    melde('Struktur', true);
    // Hintergrund vorab (Adapter 29): Sobald die Struktur steht, starten die Sammelabfragen für Zeichnungen, Dokumente und Issues gleichzeitig.
    // Ausgewertet werden sie weiter unten der Reihe nach; so überlappen sich nur die Wartezeiten.
    var vorab = {}, vorabStart = function (fn) { return fn().then(function (v) { return { ok: v }; }, function (e) { return { fehler: e }; }); }, idsS = Object.keys(items);
    var issObjA = []; ordner.forEach(function (o) { if (ECOTAX[o.typ]) issObjA.push({ id: o.id, typ: o.typ, tax: ECOTAX[o.typ] }); }); idsS.forEach(function (id) { issObjA.push(ecoProdukt(id)); });
    if (idsS.length && S.mitZeich) { vorab.ze = ecoInfo(); vorab.zeich = vorabStart(function () { return zeichnungenEco(idsS, vorab.ze); }); }
    if (idsS.length && S.mitDok && !S.testOhneDokEco) { vorab.de = ecoInfo(); vorab.dok = vorabStart(function () { return dokumenteEco(idsS, vorab.de); }); }
    if (S.mitIssues && !qIss && !S.testOhneIssEco && issObjA.length) { vorab.ie = ecoInfo(); vorab.iss = vorabStart(function () { return issuesEco(issObjA, vorab.ie); }); }
    // Stufe 2: Attribute aus der Zone Query; Details einzeln nur, wo weder expand noch die Zone Query Grunddaten geliefert haben
    if (zqP) { status('Lese Attribute der Produktstruktur (Zone Query) …'); await zqP; pruef(); }
    var ohne = Object.keys(items).filter(function (k) { var d = items[k].det; return items[k].ausExpand && (!d || !(d.title || d.name)) && !(zq[k] && (zq[k]['ds6w:label'] || zq[k]['ds6w:identifier'])); });
    if (ohne.length) {
      status('Lese Details zu ' + ohne.length + ' Objekten …');
      await pool(ohne, PARALLEL, async function (k) { try { items[k].det = await engItem(k); } catch (e) { items[k].fehler = e.message; } });
      aend++; pruef();
    }
    // übrige Bookmark-Inhalte (Dokumente usw.): Details gleich jetzt, es sind wenige
    await pool(andere, PARALLEL, async function (a) {
      if (/Document/i.test(a.typ)) { try { a.det = await dokument(a.id); aend++; } catch (e) { } }
    });
    pruef(); melde('Attribute', true);

    // 2a'. Zeichnungen der Strukturobjekte (Hintergrund). Seit Adapter 29: Zone Query (kostet nichts extra) und Zeigerbeziehung (ein Durchgang in Paketen);
    // die Abfragen je Objekt nur noch als Rückfall: EngRepInstance, wenn die Zone Query nicht verfügbar ist, dsxcad, wenn die Zeigerbeziehung nicht lesbar war.
    S.zgInfo = [];
    if (S.mitZeich && Object.keys(items).length) {
      var tz0 = Date.now(), nimm = function (z, el, quelle) {
        if (!z.id || items[z.id]) return;
        if (!zeich[z.id]) { if (nodes.length + anzahl + andere.length + zeichZahl >= S.max) return; zeich[z.id] = { id: z.id, typ: z.typ || '', titel: z.titel || '', a: z.a || {}, d: z.d || {}, eltern: {}, quelle: quelle }; zeichZahl++; }
        if (el && items[el]) zeich[z.id].eltern[el] = 1;
      };
      var zz = zeichnungenAusZone(zq), zoneZahl = Object.keys(zz.gef).length;
      Object.keys(zz.gef).forEach(function (k) { var g = zz.gef[k]; Object.keys(g.eltern).concat([null]).forEach(function (el) { nimm({ id: k, typ: g.a['ds6w:type'], titel: g.a['ds6w:label'] || g.a['ds6w:identifier'], a: g.a }, el, 'Zone Query'); }); });
      if (S.zqOk) S.zgInfo.push('Zone Query: ' + zoneZahl + ' Zeichnungen; Typen in der Antwort: ' + (Object.keys(zz.typen).map(function (t) { return t + ' ' + zz.typen[t]; }).join(', ') || '(keine)'));
      else S.zgInfo.push('Zone Query nicht verfügbar (Häkchen „Attribute“ aus oder Fehler)');
      melde('Zeichnungen', true);
      var ids2 = Object.keys(items), ze = vorab.ze || ecoInfo(), vorEco = zeichZahl;
      status('Suche Zeichnungen per Zeigerbeziehung …');
      var zv = await (vorab.zeich || vorabStart(function () { return zeichnungenEco(ids2, ze); })), zl = zv.ok || []; pruef();
      if (zv.fehler) { ze.fehler++; if (!ze.fehlerText) ze.fehlerText = zv.fehler.message; }
      zl.forEach(function (x) { nimm(x, x.el, 'Zeigerbeziehung'); if (zeich[x.id] && x.v5) zeich[x.id].v5 = true; });
      S.zgInfo.push('Zeigerbeziehung (getecosystem, eingehend): ' + ecoText(ze) + ', ' +
        zl.length + ' Verweise, ' + (zeichZahl - vorEco) + ' neue Zeichnungen' + (ze.fehlerText ? ' (erster Fehler: ' + ze.fehlerText + ')' : ''));
      melde('Zeichnungen', true);
      var zf = { eng: { ok: 0, fehler: 0, treffer: 0, fehlerText: '' }, xcad: { ok: 0, fehler: 0, treffer: 0, fehlerText: '' } }, zErl = 0;
      var mitEng = !S.zqOk, ecoAus = ze.fehler > 0 && !ze.ok, xIds = ecoAus ? ids2.filter(function (id) { return /dsxcad/i.test(S.cadTyp[id] || ''); }) : [];
      if (mitEng || xIds.length) {
        status('Suche Zeichnungen je Objekt …');
        await pool(ids2, PARALLEL, async function (id) {
          var auf = [];
          if (mitEng) auf.push(['eng', zeichnungenEng]);
          if (xIds.indexOf(id) >= 0) auf.push(['xcad', zeichnungenXcad]);
          await Promise.all(auf.map(async function (w) {
            var z = zf[w[0]]; if ((z.fehler >= 3 && !z.ok) || S.abbruch) return;
            try { var l = await w[1](id); z.ok++; z.treffer += l.length; l.forEach(function (x) { nimm(x, id, w[0] === 'eng' ? 'EngRepInstance' : 'dsxcad'); }); }
            catch (e) { z.fehler++; if (!z.fehlerText) z.fehlerText = e.message; }
          }));
          zErl++; if (zErl % 10 === 0 || zErl === ids2.length) { status('Suche Zeichnungen: ' + zErl + ' von ' + ids2.length + ' Objekten, ' + zeichZahl + ' gefunden …'); melde('Zeichnungen'); }
        });
        pruef();
      }
      if (mitEng) S.zgInfo.push('EngRepInstance je Objekt: ' + zf.eng.ok + ' ok, ' + zf.eng.fehler + ' Fehler, ' + zf.eng.treffer + ' Zeichnungen' + (zf.eng.fehlerText ? ' (erster Fehler: ' + zf.eng.fehlerText + ')' : ''));
      else S.zgInfo.push('EngRepInstance je Objekt: übersprungen (Zone Query verfügbar)');
      if (ecoAus) S.zgInfo.push('dsxcad Drawing je V5-Objekt (' + xIds.length + ' Objekte): ' + zf.xcad.ok + ' ok, ' + zf.xcad.fehler + ' Fehler, ' + zf.xcad.treffer + ' Zeichnungen' + (zf.xcad.fehlerText ? ' (erster Fehler: ' + zf.xcad.fehlerText + ')' : ''));
      else S.zgInfo.push('dsxcad Drawing je V5-Objekt: übersprungen (Zeigerbeziehung lesbar)');
      S.zgInfo.push('Ergebnis: ' + zeichZahl + ' Zeichnungen in ' + ((Date.now() - tz0) / 1000).toFixed(1) + ' s');
      if (!zeichZahl && ecoAus && (!mitEng || (zf.eng.fehler && !zf.eng.ok)) && (!xIds.length || (zf.xcad.fehler && !zf.xcad.ok))) hinweise.push('Zeichnungen nicht lesbar (Details unter „Diagnose“).');
      melde('Zeichnungen', true);
    }

    // 2b. Spezifikationen und Attachments der Objekte (Hintergrund). Seit Adapter 29 zwei Schritte: (1) getecosystem ausgehend in Paketen findet,
    // WO Dokumente hängen (statt drei Abfragen je Objekt); (2) die bisherige Abfrage documents/parentId nur noch für diese Objekte liefert Dateien,
    // Beschreibung und alle Beziehungsarten. Ist getecosystem nicht vollständig lesbar: wie bisher alle Objekte einzeln (Rückfall).
    S.dokInfo = [];
    if (S.mitDok && Object.keys(items).length) {
      var ids = Object.keys(items), erledigt = 0, zaehler = {}, tD = Date.now(), ecoK = {}, dokK = {};
      DOKREL.forEach(function (r) { zaehler[r.rel] = { ok: 0, fehler: 0 }; });
      var nimmDok = function (d, did, art, id, rel, ausEco) {
        if (!doks[did]) {
          if (nodes.length + anzahl + andere.length + dokZahl + zeichZahl >= S.max) { dokGrenze = true; return; }
          doks[did] = { d: d, art: art }; dokZahl++;
        } else {
          if (art === 'spec') doks[did].art = 'spec';
          if (!ausEco && doks[did].d && doks[did].d.eco) { doks[did].d = d; aend++; }   // Grunddaten aus getecosystem durch die vollständigen ersetzen
        }
        var key = did + '>' + id + '>' + art, k = dokK[key];
        if (!k) { k = dokK[key] = { from: 'o:' + did, to: id, type: art, meta: { Beziehung: rel } }; dokKanten.push(k); if (ausEco) { k.eco = did; (ecoK[id] = ecoK[id] || []).push(k); } }
        else if (!ausEco && k.eco) { k.meta = { Beziehung: rel }; delete k.eco; }
      };
      var de = vorab.de || ecoInfo(), dokEco = false;
      if (!S.testOhneDokEco) {
        status('Suche Spezifikationen und Attachments …');
        var dv = await (vorab.dok || vorabStart(function () { return dokumenteEco(ids, de); })); pruef();
        if (dv.fehler) { de.fehler++; if (!de.fehlerText) de.fehlerText = dv.fehler.message; }
        else { dokEco = de.ok > 0 && !de.fehler; if (dokEco) dv.ok.forEach(function (x) { nimmDok(x.d, x.id, x.art, x.el, x.rel, true); }); }
        S.dokInfo.push('getecosystem (ausgehend): ' + ecoText(de) + ', ' + de.links + ' Verweise' + (de.fehlerText ? ' (erster Fehler: ' + de.fehlerText + ')' : ''));
        if (dokEco) melde('Dokumente', true);
      }
      var idsD = dokEco ? ids.filter(function (id) { return ecoK[id]; }) : ids, vorDet = dokZahl;
      S.dokInfo.push(dokEco ? 'Weg: getecosystem, Details über documents/parentId für ' + idsD.length + ' von ' + ids.length + ' Objekten' : 'Weg: documents/parentId für alle ' + ids.length + ' Objekte (' + (S.testOhneDokEco ? 'getecosystem abgeschaltet' : 'Rückfall, getecosystem nicht vollständig') + ')');
      await pool(idsD, PARALLEL, async function (id) {
        // alle Beziehungen eines Objekts gleichzeitig abfragen (seit Adapter 15), ausgewertet in fester Reihenfolge
        async function eine(r) { var z = zaehler[r.rel]; if ((z.fehler >= 3 && !z.ok) || S.abbruch) return null; try { var l = await dokumenteZu(id, r.rel); z.ok++; return l; } catch (e) { z.fehler++; return null; } }
        var listen = [];
        if (S.dokSeriell) { for (var rs = 0; rs < DOKREL.length; rs++) listen.push(await eine(DOKREL[rs])); }   // nur für den Testvergleich
        else listen = await Promise.all(DOKREL.map(eine));
        var gefunden = {}, gelesen = false;
        for (var ri = 0; ri < DOKREL.length; ri++) {
          var r = DOKREL[ri], liste = listen[ri];
          if (!liste) continue;
          gelesen = true;
          liste.forEach(function (d) { var did = d && (d.id || d.identifier); if (!did) return; gefunden[did] = 1; nimmDok(d, did, r.art, id, r.rel, false); });
        }
        // Verweise aus getecosystem, die die genaue Abfrage unter anderer Art liefert, entfallen (sonst doppelte Kante); unbestätigte bleiben
        if (gelesen) (ecoK[id] || []).forEach(function (k) { if (k.eco && gefunden[k.eco]) k.tot = true; });
        erledigt++;
        if (erledigt % 10 === 0 || erledigt === idsD.length) { status('Lese Spezifikationen und Attachments: ' + erledigt + ' von ' + idsD.length + ' Objekten, ' + dokZahl + ' Dokumente …'); melde('Dokumente'); }
      });
      pruef();
      dokKanten = dokKanten.filter(function (k) { return !k.tot; });
      DOKREL.forEach(function (r) { var z = zaehler[r.rel]; if (z.fehler && !z.ok) hinweise.push('Beziehung „' + r.rel + '“ nicht lesbar.'); });
      if (dokGrenze) hinweise.push('Höchstzahl von ' + S.max + ' Objekten erreicht, nicht alle Dokumente gezeigt.');
      S.dokInfo.push('documents/parentId: ' + DOKREL.map(function (r) { return r.rel + ' ' + zaehler[r.rel].ok + ' ok/' + zaehler[r.rel].fehler + ' Fehler'; }).join(', ') + (dokEco ? ', ' + (dokZahl - vorDet) + ' Dokumente zusätzlich zu getecosystem' : ''));
      S.dokInfo.push('Ergebnis: ' + dokZahl + ' Dokumente in ' + ((Date.now() - tD) / 1000).toFixed(1) + ' s');
      aend++; melde('Dokumente', true);
    }

    // 2c. Issues, Aufgaben und Personen
    if (S.mitIssues || qIss) {
      var ziel = {};   // Plattform-ID -> Knoten-ID in der Darstellung
      ordner.forEach(function (o) { ziel[o.id] = 'bm:' + o.id; });
      Object.keys(items).forEach(function (id) { ziel[id] = id; });
      Object.keys(doks).forEach(function (id) { ziel[id] = 'o:' + id; });
      Object.keys(zeich).forEach(function (id) { ziel[id] = 'z:' + id; });
      andere.forEach(function (a) { if (!ziel[a.id]) ziel[a.id] = 'o:' + a.id; });
      var frei2 = function () { return nodes.length + anzahl + andere.length + dokZahl + zeichZahl + exKnoten.length < S.max; }, exGrenze = false;
      var person = function (login, voll, mail) {
        login = String(login || '').trim(); if (!login) return null;
        if (!pers[login]) {
          if (!frei2()) { exGrenze = true; return null; }
          pers[login] = { id: 'p:' + login, type: 'person', name: voll || login, meta: { Benutzername: login } }; exKnoten.push(pers[login]);
        }
        if (voll && pers[login].name === login) pers[login].name = voll;
        if (mail) pers[login].meta['E-Mail'] = mail;
        return pers[login].id;
      };
      var pId = pi ? person(pi.login || pi.voll, pi.voll, pi.mail) : null;   // Start bei einer Person: sie ist immer dabei
      var istPerson = function (login, voll) { return !!pi && ((pi.login && login && String(login).toLowerCase() === pi.login.toLowerCase()) || (pi.voll && voll && voll === pi.voll)); };
      var IZ = { CREATE: 'To do', DRAFT: 'To do', ASSIGN: 'To do', 'TO DO': 'To do', ACTIVE: 'In Work', 'IN WORK': 'In Work', 'IN PROGRESS': 'In Work', REVIEW: 'Frozen', 'IN APPROVAL': 'Frozen', 'IN REVIEW': 'Frozen', APPROVED: 'Released', CLOSE: 'Released', CLOSED: 'Released', COMPLETE: 'Released', COMPLETED: 'Released', REJECTED: 'Obsolete' };
      var zustand = function (s) { return IZ[String(s || '').toUpperCase().replace(/_/g, ' ')] || s || ''; };
      // Issues: alle sichtbaren Issues lesen und die behalten, die ein geladenes Objekt betreffen
      try {
        var iIds, iFertig = 0, ecoIss = null, ie = vorab.ie || ecoInfo(), iWeg = 'Start bei Issue/Person';
        if (!qIss) {
          status('Suche Issues zu den geladenen Objekten …');
          // Bookmark-Ordner und Strukturobjekte laufen schon (vorab); Dokumente und Zeichnungen kommen in einer zweiten, kleinen Abfrage dazu
          var eObjB = [];
          Object.keys(doks).forEach(function (id) { eObjB.push({ id: id, typ: 'Document', tax: ECOTAX_DOC }); });
          Object.keys(zeich).forEach(function (id) { eObjB.push({ id: id, typ: 'Drawing', tax: ECOTAX_DRW }); });
          if (!S.testOhneIssEco) {
            var iv = await (vorab.iss || vorabStart(function () { return issuesEco(issObjA, ie); }));
            if (iv.fehler) { ie.fehler++; if (!ie.fehlerText) ie.fehlerText = iv.fehler.message; } else ecoIss = iv.ok;
            if (ecoIss && eObjB.length) {
              try {
                var g2 = await issuesEco(eObjB, ie);
                Object.keys(g2).forEach(function (k) { var x = ecoIss[k]; if (!x) { ecoIss[k] = g2[k]; return; } g2[k].ids.forEach(function (i) { if (x.ids.indexOf(i) < 0) x.ids.push(i); }); g2[k].kontext.forEach(function (i) { if (x.kontext.indexOf(i) < 0) x.kontext.push(i); }); });
              } catch (e) { ie.fehler++; if (!ie.fehlerText) ie.fehlerText = e.message; }
            }
            pruef();
          }
          if (ecoIss && ie.ok && !ie.fehler) { iIds = Object.keys(ecoIss); iWeg = 'getecosystem (eingehend)'; }
          else { status('Suche Issues …'); iIds = await issueIds(); iWeg = S.testOhneIssEco ? 'alle Issues (getecosystem abgeschaltet)' : 'alle Issues (Rückfall, getecosystem nicht vollständig)'; ecoIss = null; }
        } else iIds = Object.keys(vorIssues);
        S.issueInfo = { gefunden: iIds.length, gelesen: 0, mitBezug: [], alle: [], weg: iWeg, eco: (qIss || S.testOhneIssEco) ? '' : 'getecosystem (eingehend): ' + ie.ok + ' Objekte geprüft' + (ie.pakete ? ' in ' + ie.pakete + ' Paketen' : '') + (ie.einzeln ? ', teils einzeln' : '') + ', ' + ie.fehler + ' Fehler, ' + ie.links + ' Verweise' + (ie.fehlerText ? ' (erster Fehler: ' + ie.fehlerText + ')' : '') };
        await pool(iIds, PARALLEL, async function (iid) {
          var d = null; if (qIss) d = vorIssues[iid]; else { try { d = await issueDetail(iid); } catch (e) { } }
          iFertig++; if (!qIss && (iFertig % 10 === 0 || iFertig === iIds.length)) status('Prüfe Issues: ' + iFertig + ' von ' + iIds.length + ' …');
          var eg = ecoIss && ecoIss[iid];
          if (!d && eg) { d = { title: eg.titel || ('Issue ' + iid.slice(-6)), id: iid }; S.issueInfo.ohneDetail = (S.issueInfo.ohneDetail || 0) + 1; }   // Details nicht lesbar: Issue trotzdem zeigen (Angaben aus getecosystem)
          if (!d) return;
          S.issueInfo.gelesen++;
          var roh = refIds(d.affectedItems).concat(refIds(d.contexts));
          if (eg) eg.ids.concat(eg.kontext).forEach(function (x) { if (roh.indexOf(x) < 0) roh.push(x); });
          S.issueInfo.alle.push({ t: d.title || d.name || iid, d: d['Creation Date'] || '' });
          if (roh.length) {
            S.issueInfo.mitBezug.push({ t: d.title || d.name || iid, d: d['Creation Date'] || '', ids: roh, treffer: roh.filter(function (x) { return ziel[x]; }).length });
            if (!S.roh['Beispiel: Issue mit betroffenen Objekten']) { var bt = JSON.stringify(d, sauber, 1); S.roh['Beispiel: Issue mit betroffenen Objekten'] = bt.length > 5000 ? bt.slice(0, 5000) + '\n… (gekürzt)' : bt; }
          }
          var bez = roh.filter(function (x) { return ziel[x]; });
          if (!bez.length) bez = alleIds(d).filter(function (x) { return ziel[x] && x !== iid; });
          if ((!bez.length && !qIss) || issues[iid]) return;
          if (!frei2()) { exGrenze = true; return; }
          var m = d.members || {}, meta = { Titel: d.title || '', Name: d.name || '', Status: d.state || '', 'Priorität': d.Priority || d.priority || '', Beschreibung: d.description || '', Besitzer: d.owner || '',
            Zugewiesen: (m.assignees || []).join(', '), 'Geplantes Ende': datum(d['Estimated End Date']), 'Tatsächliches Ende': datum(d['Actual End Date']), 'Collaborative Space': d.collabSpace || d.collabspace || '', Typ: d.type || 'Issue', ID: iid };
          Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
          var n = { id: 'i:' + iid, type: 'issue', name: d.title || d.name || ('Issue ' + iid.slice(-6)), meta: meta, imgText: d.title || d.name || '' }; if (d.state) n.state = zustand(d.state);   // Adapter 34: Titel statt Vorschaubild
          issues[iid] = n; exKnoten.push(n); ziel[iid] = n.id;
          var doppelt = {}; bez.forEach(function (x) { if (!doppelt[x]) { doppelt[x] = 1; exKanten.push({ from: n.id, to: ziel[x], type: 'betrifft' }); } });
          (m.assignees || []).forEach(function (a) { var p = person(a); if (p) exKanten.push({ from: n.id, to: p, type: 'zuweisung' }); });
          var ro = S.personRollen[iid] || [];
          if (pId && ro.length && ro.indexOf('Zugewiesen') < 0) exKanten.push({ from: n.id, to: pId, type: 'zuweisung', label: ro.join(', '), meta: { Rolle: ro.join(', ') } });
        });
        pruef(); melde('Issues', true);
        if (!ecoIss && !qIss && iIds.length >= MAXISSUES) hinweise.push('Nur die ersten ' + iIds.length + ' Issues der Plattform gelesen.');
        // Attachments direkt am Issue
        if (S.mitDok || qIss) {
          var aIds = Object.keys(issues), aFertig = 0, aOk = 0, aFehler = 0;
          await pool(aIds, PARALLEL, async function (iid) {
            if (aFehler >= 3 && !aOk) return;
            var liste = []; try { liste = await dokumenteZu(iid, 'Reference Document'); aOk++; } catch (e) { aFehler++; }
            liste.forEach(function (d) {
              var did = d && (d.id || d.identifier); if (!did) return;
              if (!doks[did]) { if (!frei2()) { exGrenze = true; return; } doks[did] = { d: d, art: 'praes' }; dokZahl++; ziel[did] = 'o:' + did; }
              dokKanten.push({ from: 'o:' + did, to: 'i:' + iid, type: 'praes', meta: { Beziehung: 'Reference Document' } });
            });
            aFertig++; if (aFertig % 10 === 0 || aFertig === aIds.length) status('Lese Attachments der Issues: ' + aFertig + ' von ' + aIds.length + ' …');
          });
          if (aFehler && !aOk) hinweise.push('Attachments der Issues nicht lesbar.');
          pruef(); melde('Issues', true);
        }
      } catch (e) { if (S.abbruch) throw e; hinweise.push('Issues nicht lesbar (' + e.message + ').'); }
      // Aufgaben: eigene Aufgaben des Benutzers und Aufgaben mit einem geladenen Objekt als Kontext
      var nimmTask = function (t) {
        if (!t) return;
        var tid = t.id || t.identifier, e = t.dataelements || {}, rd = t.relateddata || {}; if (!tid) return;
        var bez = refIds(rd.scopes).concat(refIds(rd.references)).concat(refIds(rd.deliverables)).concat(refIds(rd.contents)).filter(function (x) { return ziel[x]; });
        if (t._scope && ziel[t._scope]) bez.push(t._scope);
        var fuerPerson = pId && (Array.isArray(rd.assignees) ? rd.assignees : []).some(function (a) { var ad = (a && a.dataelements) || {}; return istPerson(ad.name || a.name, ad.fullname); });
        if (!bez.length && !fuerPerson) return;
        if (!tasks[tid]) {
          if (!frei2()) { exGrenze = true; return; }
          var meta = { Titel: e.title || '', Status: e.state || e.status || '', Beschreibung: e.description || '', 'Fällig am': datum(e.dueDate), 'Geplanter Start': datum(e.estimatedStartDate), 'Fertig in %': e.percentComplete != null && e.percentComplete !== '' ? e.percentComplete + ' %' : '',
            Projekt: e.project || '', Erstellt: datum(e.originated), 'Geändert': datum(e.modified), Typ: e.nlsType || t.type || 'Task', ID: tid };
          Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
          var n = { id: 't:' + tid, type: 'task', name: e.title || ('Aufgabe ' + String(tid).slice(-6)), meta: meta, _k: {} }; if (e.state) n.state = zustand(e.state);
          tasks[tid] = n; exKnoten.push(n);
          (Array.isArray(rd.assignees) ? rd.assignees : []).forEach(function (a) {
            var ad = (a && a.dataelements) || {}, voll = ad.fullname || [ad.firstname, ad.lastname].filter(Boolean).join(' ');
            var p = person(ad.name || a.name || voll, voll, ad.email); if (p) exKanten.push({ from: n.id, to: p, type: 'zuweisung' });
          });
        }
        bez.forEach(function (x) { if (!tasks[tid]._k[x]) { tasks[tid]._k[x] = 1; exKanten.push({ from: tasks[tid].id, to: ziel[x], type: 'aufgabe' }); } });
      };
      try { status('Lese Aufgaben …'); (await taskAufruf(TSK, { showProjectTasks: 'true' })).forEach(nimmTask); } catch (e) { if (S.abbruch) throw e; hinweise.push('Eigene Aufgaben nicht lesbar (' + e.message + ').'); }
      melde('Aufgaben', true);
      var sIds = ordner.map(function (o) { return o.id; }).concat(Object.keys(items)).concat(Object.keys(issues)), sOk = 0, sFehler = 0, sFertig = 0;
      await pool(sIds, PARALLEL, async function (sid) {
        if ((sFehler >= 3 && !sOk) || S.abbruch) return;
        try { var l = await taskAufruf(TSK + '/scopeId/' + encodeURIComponent(sid), {}); sOk++; l.forEach(function (t) { if (t) { t._scope = sid; nimmTask(t); } }); } catch (e) { sFehler++; }
        sFertig++; if (sFertig % 10 === 0 || sFertig === sIds.length) { status('Lese Aufgaben: ' + sFertig + ' von ' + sIds.length + ' Objekten, ' + Object.keys(tasks).length + ' Aufgaben …'); melde('Aufgaben'); }
      });
      pruef();
      if (sFehler && !sOk) hinweise.push('Aufgaben je Objekt nicht lesbar.');
      if (exGrenze) hinweise.push('Höchstzahl von ' + S.max + ' Objekten erreicht, nicht alle Issues/Aufgaben gezeigt.');
      exKnoten.forEach(function (n) { delete n._k; });
      melde('Aufgaben', true);
    }

    // 4. Knoten und Beziehungen
    function baue(nodes, edges, gesehen) {
      var verwendet = {}; Object.keys(items).forEach(function (id) { items[id].kinder.forEach(function (c) { verwendet[c.id] = (verwendet[c.id] || 0) + 1; }); });
      var fehlend = 0;
      Object.keys(items).forEach(function (id) {
        var it = items[id], d = it.det || {}, er = d['dseng:EnterpriseReference'] || {};
        if (!it.det) fehlend++;
        var kinder = it.kinder.filter(function (c) { return items[c.id]; });
        var meta = { Titel: d.title || '', Name: d.name || '', Revision: d.revision || '', Reifegrad: d.state || '', Beschreibung: d.description || '', Teilenummer: er.partNumber || '',
          Besitzer: d.owner || '', Organisation: d.organization || '', 'Collaborative Space': d.collabspace || '', Erstellt: datum(d.created), 'Geändert': datum(d.modified), Typ: d.type || 'VPMReference',
          'Direkte Kinder': String(it.kinder.length), Verwendungen: String(verwendet[id] || 0), ID: id };
        var za = zq[id];
        if (za) Object.keys(za).forEach(function (a) {
          var w = zqWert(a, za[a]); if (!w || a === 'ds6w:type') return;
          var feld = ZQMETA[a] || a;
          if (feld === 'Reifegrad') { if (!meta.Reifegrad) meta.Reifegrad = w.split('.').pop(); return; }
          if (!meta[feld]) meta[feld] = w;
        });
        Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
        var n = { id: id, type: it.kinder.length ? 'asm' : 'part', name: d.title || d.name || (za && (za['ds6w:label'] || za['ds6w:identifier'])) || ('Objekt ' + id.slice(-6)), meta: meta, dl: true };
        S.cad[id] = 1; if (d.type && (!S.cadTyp[id] || /^VPMReference$/i.test(S.cadTyp[id]))) S.cadTyp[id] = /dsxcad/i.test(S.cadTyp[id] || '') ? S.cadTyp[id] : d.type;
        if (d.state) n.state = ZUSTAND[d.state] || d.state;
        else if (za && za['ds6w:status']) { var zs = String(za['ds6w:status']).split('.').pop().toUpperCase().replace(/ /g, '_'); n.state = ZUSTAND[zs] || zs; }
        nodes.push(n);
        kinder.forEach(function (c) { var e = { from: c.id, to: id, type: 'struktur' }; if (c.n > 1) { e.label = '×' + c.n; e.meta = { Instanzen: String(c.n) }; } edges.push(e); });
      });
      startProdukte.forEach(function (p) { if (items[p.id] && p.bm) { var key = p.id + '>' + p.bm; if (!gesehen[key]) { gesehen[key] = 1; edges.push({ from: p.id, to: 'bm:' + p.bm, type: 'inhalt' }); } } });
      Object.keys(zeich || {}).forEach(function (zid) {
        var z = zeich[zid], a = z.a || {}, d = z.d || {}, v5 = /dsxcad/i.test(z.typ) || !!z.v5;
        var meta = { Titel: z.titel || a['ds6w:label'] || d.title || '', Name: a['ds6w:identifier'] || d.name || '', Revision: a['ds6wg:revision'] || d.revision || '', Reifegrad: (a['ds6w:status'] ? String(a['ds6w:status']).split('.').pop() : '') || d.state || '',
          Besitzer: a['ds6w:responsible'] || d.owner || '', 'Geändert': a['ds6w:modified'] ? datum(a['ds6w:modified']) : datum(d.modified), Dateityp: v5 ? 'CATDrawing' : '', Typ: z.typ || 'Drawing', Quelle: z.quelle, ID: zid };
        Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
        var n = { id: 'z:' + zid, type: 'dwg', name: meta.Titel || meta.Name || ('Zeichnung ' + zid.slice(-6)), meta: meta, dl: true };
        var st = String(a['ds6w:status'] || d.state || '').split('.').pop().toUpperCase().replace(/ /g, '_'); if (st) n.state = ZUSTAND[st] || st;
        S.cad[zid] = 1; S.cadTyp[zid] = z.typ || 'Drawing';
        nodes.push(n);
        Object.keys(z.eltern).forEach(function (el) { if (items[el]) edges.push({ from: 'z:' + zid, to: el, type: 'zeichnung' }); });
      });
      Object.keys(doks || {}).forEach(function (did) {
        var x = dokMeta(doks[did].d, 'Document', did), n = { id: 'o:' + did, type: doks[did].art, name: x.name, meta: x.meta, dl: true };
        if (x.state) n.state = ZUSTAND[String(x.state).toUpperCase().replace(/ /g, '_')] || x.state;
        gesehen['o:' + did] = 1; nodes.push(n);
      });
      var kg = {}; (dokKanten || []).forEach(function (k) { var s = k.from + '>' + k.to + '>' + k.type; if (!k.tot && (doks || {})[k.from.slice(2)] && !kg[s]) { kg[s] = 1; edges.push({ from: k.from, to: k.to, type: k.type, meta: k.meta }); } });
      andere.forEach(function (a) {
        var d = a.det || {}, id = 'o:' + a.id;
        if (!gesehen[id]) {
          gesehen[id] = 1;
          var meta = { Titel: d.title || a.titel || '', Name: d.name || '', Revision: d.revision || '', Reifegrad: d.stateNLS || d.state || '', Beschreibung: d.description || '', Typ: a.typ, ID: a.id };
          Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
          var n = { id: id, type: typFuer(a.typ), name: d.title || a.titel || d.name || (a.typ + ' ' + a.id.slice(-6)), meta: meta };
          if (/Document/i.test(a.typ)) { n.dl = true; if (!S.dateien[a.id]) S.dateien[a.id] = { n: 1 }; }
          if (d.state) n.state = ZUSTAND[d.state] || d.state;
          nodes.push(n);
        }
        if (a.bm) edges.push({ from: id, to: 'bm:' + a.bm, type: 'inhalt' });
      });
      (exKnoten || []).forEach(function (n) { nodes.push(n); });
      var vk = {}, vz = 0; nodes.forEach(function (n) { var v = S.vorschau[String(n.id).replace(/^(o|z|i|t|p|bm):/, '')]; if (v) { n.img = v.u; vz++; vk[n.type] = (vk[n.type] || 0) + 1; } else delete n.img; });
      fotosAnwenden(nodes);
      S.vorschauKnoten = vz + ' von ' + nodes.length + ' Objekten mit Bild' + (vz ? ' (' + Object.keys(vk).map(function (k) { return ((types[k] || {}).label || k) + ' ' + vk[k]; }).join(', ') + ')' : '');
      var vorhanden = {}; nodes.forEach(function (n) { vorhanden[n.id] = 1; });
      (exKanten || []).forEach(function (k) { if (vorhanden[k.from] && vorhanden[k.to]) edges.push(k); });
      return { nodes: nodes, edges: edges, fehlend: fehlend };
    }
    pruef();
    // Beziehungsübersicht für die Diagnose: läuft nebenher, das Ergebnis wartet nicht darauf
    S.relInfo = null;
    var uObj = Object.keys(items).sort(function (a, b) { return (items[a].tiefe || 0) - (items[b].tiefe || 0); }).slice(0, ECOPAKET).map(ecoProdukt), uNr = S.ladeNr;
    if (uObj.length && !S.ohneUebersicht) beziehungsUebersicht(uObj).then(function (u) { if (S.ladeNr === uNr) { S.relInfo = u; diagnose(); } }, function (e) { if (S.ladeNr === uNr && !/abgebrochen/.test(e.message)) { S.relInfo = { fehler: e.message }; diagnose(); } });
    var fertigD = baue(nodes, edges, gesehen), fehlend = fertigD.fehlend;
    S.wurzelInfo = (S.wurzeln || []).map(function (id) { var d = (items[id] && items[id].det) || {}; return (d.title || '?') + ' ' + (d.revision || '') + ' [' + id + ']'; });
    if (fehlend) hinweise.push(fehlend + ' Objekte ohne Detaildaten (keine Leserechte oder kein Engineering Item).');
    // Abstand wie vor Adapter 28 (Ordner damals 3, Zeichnung 0.9): größere Ordner/Zeichnungen sollen den Raum nicht auseinanderziehen (abstand())
    return { daten: { types: types, relTypes: relTypes, nodes: nodes, edges: edges, spacing: abstand(nodes), maxObjects: Math.max(500, nodes.length) }, hinweise: hinweise };
  }

  // ---------- Darstellung (iframe) ----------
  function sende(nachricht) {
    S.wartend = nachricht;
    if (S.bereit && S.frame && S.frame.contentWindow) { S.frame.contentWindow.postMessage(nachricht, '*'); S.wartend = null; }
  }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.quelle !== '3deep' || !S.frame || e.source !== S.frame.contentWindow) return;
    if (m.download) { download(m.download, m.name); return; }
    if (m.bereit) { S.bereit = true; if (S.wartend) sende(S.wartend); }  // Adapter 31: keine Steuerungsvorgabe mehr, die Darstellung bleibt bei CATIA (Wunsch des Nutzers)
  });

  // ---------- Drag & Drop aus 3DEXPERIENCE (Format 3DXContent: {protocol:'3DXContent', data:{items:[{objectId, objectType, displayName, displayType, …}]}}) ----------
  function dropArt(it) {
    var t = String(it.objectType || it.type || '') + ' ' + String(it.displayType || '');
    if (/Issue/i.test(t)) return 'issue';
    if (/Person/i.test(t)) return 'person';
    if (/Bookmark|Workspace/i.test(t)) return 'bm';
    if (/VPMReference|Physical ?Product|dsxcad|CATPart|CATProduct|Engineering ?Item|3DShape|Product|Part/i.test(t)) return 'produkt';
    return '';
  }
  function dropLesen(roh) {
    var d = roh;
    if (typeof d === 'string') { var t = d.trim(); if (!t) return { fehler: 'Leere Übergabe.' }; try { d = JSON.parse(t); } catch (e) { return { fehler: 'Kein 3DEXPERIENCE-Objekt erkannt (Inhalt ist kein JSON).' }; } }
    if (!d || typeof d !== 'object') return { fehler: 'Kein 3DEXPERIENCE-Objekt erkannt.' };
    var items = (d.data && d.data.items) || d.items || (d.objectId ? [d] : null);
    if (!Array.isArray(items) || !items.length) return { fehler: 'Kein Objekt in der Übergabe gefunden.' };
    if (items.length > 1) return { fehler: 'Bitte nur EIN Objekt ablegen (' + items.length + ' erhalten). Es wurde nichts geladen.' };
    var it = items[0] || {}, id = it.objectId || it.physicalid || it.id, art = dropArt(it), titel = it.displayName || it.objectTitle || it.title || id;
    if (!id) return { fehler: 'Objekt ohne ID erhalten.' };
    if (!art) return { fehler: 'Objekttyp „' + (it.displayType || it.objectType || '?') + '“ wird nicht unterstützt. Möglich: Physical Product, Bookmark, Issue, Person.' };
    return { art: art, id: id, title: titel, typ: it.objectType || '', anzeige: it.displayType || '', ctx: it.contextId || '' };
  }
  function dropWarnung(text) {
    status(text, true);
    var z = q('.td-dz'); if (!z) return;
    z.style.borderColor = '#cc092f'; z.style.color = '#cc092f'; z.textContent = '⚠ ' + (/EIN Objekt/.test(text) ? 'Nur ein Objekt!' : 'Nicht erkannt');
    clearTimeout(S.dzUhr); S.dzUhr = setTimeout(dropRuhe, 4000);
  }
  function dropRuhe() { var z = q('.td-dz'); if (!z) return; z.style.borderColor = '#368ec4'; z.style.color = '#368ec4'; z.style.background = 'transparent'; z.textContent = '⤓ Objekt hierher ziehen'; }
  function dropEmpfang(roh) {
    var txt = typeof roh === 'string' ? roh : (function () { try { return JSON.stringify(roh); } catch (e) { return String(roh); } })();
    if (S.letzterDrop && S.letzterDrop.t === txt && Date.now() - S.letzterDrop.z < 800) return;   // Plattformmodul und Browser melden denselben Drop
    S.letzterDrop = { t: txt, z: Date.now() };
    var e = dropLesen(roh);
    S.dropInfo = ['Übergabe: ' + String(txt).slice(0, 1500), e.fehler ? 'Ergebnis: ' + e.fehler : 'Erkannt: ' + e.art + ' „' + e.title + '“ [' + e.id + '], Typ ' + (e.typ || '-') + ' / ' + (e.anzeige || '-')];
    clearTimeout(S.dzUhr); dropRuhe(); diagnose();
    if (e.fehler) { dropWarnung(e.fehler); return; }
    if (e.art === 'produkt' && /dsxcad/i.test(e.typ)) S.cadTyp[e.id] = e.typ;
    laden({ drop: e });
  }
  function dropEinrichten(z) {
    z.addEventListener('dragenter', function (ev) { ev.preventDefault(); z.style.background = '#e5f1f9'; });
    z.addEventListener('dragover', function (ev) { ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'copy'; } catch (x) { } });
    z.addEventListener('dragleave', function () { z.style.background = 'transparent'; });
    z.addEventListener('drop', function (ev) {
      ev.preventDefault(); z.style.background = 'transparent';
      var dt = ev.dataTransfer, t = '';
      try { t = dt.getData('text/plain') || dt.getData('text') || dt.getData('Text') || ''; } catch (x) { }
      if (!t && dt && dt.files && dt.files.length) { dropWarnung('Dateien werden nicht unterstützt. Bitte ein Objekt aus einer 3DEXPERIENCE-Suche ziehen.'); return; }
      dropEmpfang(t);
    });
  }
  // Plattformmodul für Drag & Drop (nur im 3DDashboard; zusätzlich zum Browser-Drop, doppelte Meldungen fängt dropEmpfang ab)
  function dropPlattform(z) {
    if (window.require) {
      try {
        window.require(['DS/DataDragAndDrop/DataDragAndDrop'], function (DnD) {
          if (DnD && typeof DnD.droppable === 'function') DnD.droppable(z, { drop: function (data) { z.style.background = 'transparent'; dropEmpfang(data); },
            enter: function () { z.style.background = '#e5f1f9'; }, leave: function () { z.style.background = 'transparent'; } });
        }, function () { });
      } catch (x) { }
    }
  }

  // ---------- Bedienung ----------
  async function suchen() {
    if (S.sucht) return;
    var text = q('.td-su').value.trim(), sel = q('.td-tr');
    try {
      S.sucht = true; await ruheWarten(); status('Suche Bookmarks …');
      if (/^[0-9A-Fa-f]{20,}$/.test(text)) S.treffer = [{ id: text, title: 'ID ' + text, art: 'bm' }];
      else S.treffer = await sucheBookmarks(text);
      sel.innerHTML = S.treffer.map(function (b, i) { return '<option value="' + i + '">' + esc(b.title || b.name || b.id) + (b.owner ? ' (' + esc(b.owner) + ')' : '') + '</option>'; }).join('');
      sel.style.display = S.treffer.length ? '' : 'none'; q('.td-la').style.display = S.treffer.length ? '' : 'none';
      status(S.treffer.length ? S.treffer.length + ' Bookmark(s) gefunden. Auswählen und „Laden“ drücken.' : 'Kein Bookmark gefunden.', !S.treffer.length);
    } catch (e) { status('Suche fehlgeschlagen: ' + e.message, true); } finally { S.sucht = false; diagnose(); }
  }
  // Im Nachlade-Modus (Häkchen umgeschaltet oder „↻ Neu lesen“, gleiches Objekt) bleibt das Bild stehen: Zwischenstände werden mit dem letzten
  // fertigen Stand vereinigt, solange die Art der Objekte noch gewünscht ist. So verschwindet nichts, nur weil seine Stufe noch nicht wieder dran war.
  function vereinige(daten) {
    var alt = S.letzte; if (!alt) return daten;
    var da = {}; daten.nodes.forEach(function (n) { da[n.id] = 1; });
    var plus = alt.nodes.filter(function (n) { return !da[n.id] && !(n.type === 'dwg' && !S.mitZeich) && !((n.type === 'spec' || n.type === 'praes') && !S.mitDok) && !(/^(issue|task|person)$/.test(n.type) && !S.mitIssues); });
    if (!plus.length) return daten;
    plus.forEach(function (n) { da[n.id] = 1; });
    var ke = {}; daten.edges.forEach(function (e) { ke[e.from + '>' + e.to + '>' + e.type] = 1; });
    var kanten = alt.edges.filter(function (e) { return da[e.from] && da[e.to] && !ke[e.from + '>' + e.to + '>' + e.type]; });
    var types = {}; Object.keys(alt.types).forEach(function (k) { types[k] = alt.types[k]; }); Object.keys(daten.types).forEach(function (k) { types[k] = daten.types[k]; });
    return { types: types, relTypes: daten.relTypes, nodes: daten.nodes.concat(plus), edges: daten.edges.concat(kanten), spacing: daten.spacing, maxObjects: Math.max(500, daten.nodes.length + plus.length) };
  }
  // Laden in Stufen (Adapter 29): erst Bookmark und Struktur (erstes Bild), dann im Hintergrund Attribute, Zeichnungen, Dokumente, Issues, Aufgaben.
  // Ein neues Laden (anderes Objekt, Drop, Häkchen, „↻“) löst ein laufendes ab: S.abbruch beendet es, danach startet das neue (S.naechstes).
  // sonder: {drop: Objekt, nach: true = gleiches Objekt nachladen (Bild bleibt stehen), frisch: true = Zwischenspeicher vorher leeren}
  async function laden(sonder) {
    var b = sonder ? sonder.drop : S.treffer[+q('.td-tr').value]; if (!b) return;
    if (S.laeuft) { S.naechstes = { drop: b, nach: !!(sonder && sonder.nach), frisch: !!(sonder && sonder.frisch) }; S.abbruch = true; S.vorn = ''; status('Löse das laufende Laden ab …'); return; }
    S.zuletzt = b; S.nachladen = false; if (!(sonder && sonder.nach)) S.letztesAuto = !!(sonder && sonder.auto);
    var t0 = Date.now(), fertig, gleich = !!(sonder && sonder.nach && S.gezeigt === S.lauf && S.lauf > 0);
    S.laufP = new Promise(function (ja) { fertig = ja; });
    try {
      S.laeuft = true; S.abbruch = false; S.vorn = ''; S.ladeNr = (S.ladeNr || 0) + 1;
      S.max = Math.max(10, parseInt(S.maxText, 10) || 1500); S.mitDok = q('.td-dk').checked; S.mitIssues = q('.td-ia').checked; S.mitExpand = !S.ohneExpand; S.mitZone = !S.ohneZone; /* Adapter 32: Häkchen „Schnell“ und „Attribute“ entfernt, immer an (Rückfälle bleiben); S.ohneExpand/S.ohneZone nur für Tests */ S.mitZeich = q('.td-zg').checked;
      if (sonder && sonder.frisch) cacheLeeren(); else cacheAufraeumen();
      S.aufrufe = 0; S.issCacheZ = { treffer: 0, neu: 0 }; S.cacheZ = { treffer: 0, neu: 0 }; S.issueInfo = null; S.vorschauInfo = null; vorschauAufraeumen();   // Diagnose-Abschnitte gelten nur für dieses Laden
      S.stufen = []; S.zwischen = gleich;
      if (!gleich) { S.lauf = (S.lauf || 0) + 1; S.letzte = null; }
      var nl = q('.td-nl'); if (nl) nl.style.display = '';
      S.aufStufe = function (daten, name) {
        var d = gleich ? vereinige(daten) : daten, sek = (Date.now() - t0) / 1000;
        sende({ quelle: '3deep-adapter', daten: d, name: b.title || 'Daten', lauf: S.lauf, start: !S.zwischen, ergaenzen: true });
        S.zwischen = true; S.gezeigt = S.lauf;
        S.stufen.push({ name: name, s: sek, n: d.nodes.length, e: d.edges.length });
        if (!S.vorn) { S.vorn = (gleich ? 'Lade nach' : 'Bild steht (' + d.nodes.length + ' Objekte nach ' + sek.toFixed(1) + ' s)') + ' – im Hintergrund: '; fortschritt('weitere Daten …'); }
        diagnose();
      };
      var erg;
      if (b.art === 'issue') erg = await leseBookmark(null, null, { issues: [b.id], struktur: false });
      else if (b.art === 'produkt') erg = await leseBookmark(null, null, { produkte: [b.id], struktur: true });
      else if (b.art === 'person') erg = await leseBookmark(null, null, { person: { id: b.id, name: b.title }, struktur: false });
      else erg = await leseBookmark(b.id, b.title || b.name || '');
      if (S.abbruch) throw new Error('abgebrochen');
      await fotosHolen(erg.daten);
      if (S.abbruch) throw new Error('abgebrochen');
      sende({ quelle: '3deep-adapter', daten: erg.daten, name: b.title || 'Daten', lauf: S.lauf, start: !S.zwischen, ergaenzen: S.zwischen, fertig: true });
      S.zwischen = true; S.gezeigt = S.lauf; S.letzte = erg.daten; S.vorn = '';
      letztesMerken(b);
      var sek = (Date.now() - t0) / 1000, erstes = S.stufen.length ? S.stufen[0].s : sek;
      S.stufen.push({ name: 'Fertig', s: sek, n: erg.daten.nodes.length, e: erg.daten.edges.length });
      status(erg.daten.nodes.length + ' Objekte, ' + erg.daten.edges.length + ' Beziehungen aus „' + (b.title || b.id) + '“ in ' + sek.toFixed(1) + ' s, ' + S.aufrufe + ' Abfragen' +
        (S.cacheZ.treffer ? ' (+ ' + S.cacheZ.treffer + ' aus dem Zwischenspeicher)' : '') + '.' + (S.stufen.length > 1 && !gleich ? ' Erstes Bild nach ' + erstes.toFixed(1) + ' s.' : '') +
        (erg.hinweise.length ? ' Hinweis: ' + erg.hinweise.join(' ') : ''), erg.hinweise.length > 0);
      // Vorschaubilder einmal testen (3 Bilder, keine REST-Abfrage), höchstens alle 5 min; Ergebnis nur in der Diagnose
      if (Object.keys(S.vorschau).length && (!S.vorschauTest || Date.now() - S.vorschauTest.t > 5 * 60000)) vorschauPruefen();
    } catch (e) {
      S.vorn = '';
      if (!S.abbruch) status('Laden fehlgeschlagen: ' + e.message + ' (Details unter „Diagnose“)', true);
      if (S.letztesAuto && !S.abbruch) { try { localStorage.removeItem(letztesSchluessel()); } catch (x) { } status('Das zuletzt geöffnete Objekt „' + (b.title || b.id) + '“ ließ sich nicht laden (' + e.message + ') und wird nicht mehr automatisch geöffnet.', true); }
    } finally {
      S.laeuft = false; S.aufStufe = null; S.vorn = '';
      var n = S.naechstes; S.naechstes = null; S.abbruch = false;
      diagnose(); fertig();
      if (n) laden(n); else if (S.nachladen) haekchenGeaendert();
    }
  }
  // Adapter 33 (Wunsch des Nutzers): zuletzt erfolgreich geladenes Objekt (Bookmark oder Drop) im Browser merken (localStorage, je Tenant)
  // und beim nächsten Öffnen automatisch laden – die Darstellung zeigt es erst nach ihrem Intro (sie sammelt die Nachrichten bis dahin).
  function letztesSchluessel() { return '3deep_letztes_' + (S.live ? (S.tenant || '-') : 'test'); }
  function letztesMerken(b) {
    var m = { art: b.art || 'bm', id: b.id, title: b.title || b.name || '', typ: b.typ || '', anzeige: b.anzeige || '', ctx: b.ctx || '', t: Date.now() };
    S.letztesGemerkt = m; try { localStorage.setItem(letztesSchluessel(), JSON.stringify(m)); } catch (e) { }
  }
  function letztesLaden() {
    if (S.letztesGestartet || S.laeuft || S.zuletzt) return; S.letztesGestartet = true;
    var m = null; try { m = JSON.parse(localStorage.getItem(letztesSchluessel()) || 'null'); } catch (e) { }
    if (!m || !m.id) return;
    S.letztesGemerkt = m;
    if (m.art === 'bm' || !m.art) q('.td-su').value = m.title || m.id;
    status('Lade das zuletzt geöffnete Objekt „' + (m.title || m.id) + '“ …');
    laden({ drop: m, auto: true });
  }
  // Häkchen nach dem Laden geändert: zuletzt geladenes Objekt (Drop oder Bookmark) mit den neuen Einstellungen nachladen (Bild bleibt stehen).
  // Mehrere Häkchen kurz hintereinander = ein Ladevorgang; ein noch laufendes Laden wird abgelöst.
  function haekchenGeaendert() {
    if (!S.zuletzt) return;
    S.nachladen = false; clearTimeout(S.neuUhr);
    if (!S.laeuft) status('Einstellung geändert – lade „' + (S.zuletzt.title || S.zuletzt.id) + '“ nach …');
    S.neuUhr = setTimeout(function () { S.neuLaden = (S.neuLaden || 0) + 1; laden({ drop: S.zuletzt, nach: true }); }, S.neuVerzug);
  }
  // „↻ Neu lesen“: Zwischenspeicher leeren und das zuletzt geladene Objekt frisch von der Plattform lesen (Bild bleibt stehen)
  function neuLesen() {
    if (!S.zuletzt) { var n0 = cacheLeeren(); status('Zwischenspeicher geleert (' + n0 + ' Einträge).'); diagnose(); return; }
    clearTimeout(S.neuUhr); laden({ drop: S.zuletzt, nach: true, frisch: true });
  }
  function diagnoseText() {
    var z = ['3Deep-Widget Diagnose (Adapter 34, Darstellung ' + DARSTELLUNG + '), ' + new Date().toLocaleString('de-DE'), 'Modus: ' + (S.live ? 'live im 3DDashboard' : 'Testmodus (Beispieldaten)'),
      '3DSpace: ' + (S.space || '-') + (S.spaceQuelle ? ' (' + S.spaceQuelle + ')' : ''), 'Rahmen: ' + window.location.href.replace(/token=[^&]*/, 'token=…').slice(0, 300), 'Tenant: ' + (S.tenant || '-'), 'Security Context: ' + (S.ctx || '-') + (S.ctxZahl ? ' (automatisch gewählt, ' + S.ctxZahl + ' verfügbar)' : ''), 'Darstellung: ' + S.viewerUrl + (S.bereit ? ' (bereit)' : ' (noch nicht gemeldet)'), ''];
    z.push('Zuletzt geöffnet (gemerkt, wird beim Öffnen geladen): ' + (S.letztesGemerkt ? (S.letztesGemerkt.title || '-') + ' [' + S.letztesGemerkt.id + '], ' + (S.letztesGemerkt.art || 'bm') : '-'));
    if (S.stufen && S.stufen.length) {
      z.push('', 'Ablauf (dieses Laden): ' + (S.aufrufe || 0) + ' Abfragen an die Plattform, ' + S.cacheZ.treffer + ' aus dem Zwischenspeicher' + (S.laeuft ? ' – läuft noch' : ''));
      S.stufen.forEach(function (s) { z.push('  ' + s.s.toFixed(1).padStart(6) + ' s  ' + s.name + ' – ' + s.n + ' Objekte, ' + s.e + ' Beziehungen'); });
    }
    var cz = Object.keys(S.cache);
    if (cz.length) {
      var calt = cz.reduce(function (m, k) { return Math.min(m, S.cache[k].t); }, Date.now());
      z.push('', 'Zwischenspeicher: ' + cz.length + ' Abfragen gespeichert (älteste vor ' + Math.round((Date.now() - calt) / 60000) + ' min, gültig ' + Math.round(S.cacheMs / 60000) + ' min). „↻“ in der Leiste liest das geladene Objekt frisch.');
    }
    if (S.wurzelInfo) { z.push('', 'Produkte im Bookmark:'); S.wurzelInfo.forEach(function (w) { z.push('  ' + w); }); }
    if (S.issueInfo) {
      var ii = S.issueInfo, nachDatum = function (a, b) { return String(b.d).localeCompare(String(a.d)); };
      var mitTreffer = ii.mitBezug.filter(function (x) { return x.treffer > 0; }).length;
      z.push('', 'Issues (dieses Laden):', '  Weg: ' + (ii.weg || '-'));
      if (ii.eco) z.push('  ' + ii.eco);
      z.push('  Issue-Abruf mit $fields=' + (ISSFELDER[issVar] || '(ohne)'), '  Issues: ' + ii.gefunden + ' gefunden, ' + ii.gelesen + ' gelesen' + (ii.ohneDetail ? ' (' + ii.ohneDetail + ' ohne Details, nur aus getecosystem)' : '') + ', ' + ii.mitBezug.length + ' mit betroffenen Objekten, davon ' + mitTreffer + ' mit Treffer im Bookmark');
      z.push('Neueste Issues:'); ii.alle.slice().sort(nachDatum).slice(0, 8).forEach(function (x) { z.push('  ' + x.d + '  ' + x.t); });
      z.push('Issues mit betroffenen Objekten (neueste zuerst, höchstens 40):');
      ii.mitBezug.slice().sort(nachDatum).slice(0, 40).forEach(function (x) { z.push('  ' + x.d + '  ' + x.t + '  -> ' + (x.ids.join(', ') || '(keine ID erkannt)') + '  Treffer im Bookmark: ' + x.treffer); });
    }
    var ic = Object.keys(S.issCache);
    if (ic.length || S.issCacheZ.treffer) {
      var alt = ic.reduce(function (m, k) { return Math.min(m, S.issCache[k].t); }, Date.now());
      z.push('', 'Issue-Zwischenspeicher: ' + ic.length + ' Issues gespeichert (ältestes vor ' + Math.round((Date.now() - alt) / 60000) + ' min, gültig ' + Math.round(S.issCacheMs / 60000) + ' min)',
        '  letztes Laden: ' + S.issCacheZ.treffer + ' aus dem Zwischenspeicher, ' + S.issCacheZ.neu + ' neu gelesen. „Zwischenspeicher leeren“ oder „↻“ leert den Speicher.');
    }
    if (S.dropInfo) { z.push('', 'Letzter Drop:'); S.dropInfo.forEach(function (c) { z.push('  ' + c); }); }
    if (S.personInfo) { var pp = S.personInfo; z.push('', 'Person: ' + (pp.voll || '-') + ', Benutzername ' + (pp.login || '-') + ' (aus ' + pp.quelle + (pp.fehler ? ', pno-Fehler: ' + pp.fehler : '') + ')' + (pp.issues ? ', ' + pp.issues : '')); }
    if (S.bmInfo && S.bmInfo.length) { z.push('', 'Bookmark-Ordner:'); S.bmInfo.forEach(function (c) { z.push('  ' + c); }); }
    if (S.zgInfo && S.zgInfo.length) { z.push('', 'Zeichnungen:'); S.zgInfo.forEach(function (c) { z.push('  ' + c); }); }
    if (S.dokInfo && S.dokInfo.length) { z.push('', 'Dokumente:'); S.dokInfo.forEach(function (c) { z.push('  ' + c); }); }
    if (S.fotoInfo && S.fotoInfo.gesamt) { var fi = S.fotoInfo; z.push('', 'Fotos (Attachments png/jpg, Adapter 34):', '  ' + fi.gesamt + ' Fotos, ' + fi.geholt + ' Download-Tickets neu geholt' + (fi.gesamt > FOTO_MAX ? ', höchstens ' + FOTO_MAX : '') + (fi.fehler ? ', ' + fi.fehler + ' Fehler (zuletzt: ' + fi.letzterFehler + ')' : '')); if (fi.bsp) z.push('  Beispieladresse (Werte ausgeblendet): ' + fi.bsp); }
    if (S.vorschauInfo || S.vorschauTest) {
      var vi = S.vorschauInfo || { gesehen: {}, mit: 0, felder: {}, roh: {} }, vf = Object.keys(vi.felder);
      z.push('', 'Vorschaubilder (Feld aus getecosystem, keine eigene Abfrage):', '  getecosystem-Objekte: ' + Object.keys(vi.gesehen).length + ' gesehen, ' + vi.mit + ' mit Bildfeld' + (vf.length ? ' (' + vf.map(function (k) { return k + ': ' + vi.felder[k]; }).join(', ') + ')' : ''));
      if (S.vorschauKnoten) z.push('  im Bild: ' + S.vorschauKnoten);
      Object.keys(vi.roh || {}).forEach(function (k) { z.push('  Feld ' + k + ' ohne verwertbare Adresse, z. B. „' + vi.roh[k] + '“'); });
      if (vi.ohneBsp) z.push('  Beispiel ohne Bildfeld (Typ ' + vi.ohneBsp.typ + '), Felder: ' + vi.ohneBsp.felder.join(', '));
      var bsp = Object.keys(S.vorschau).map(function (k) { return S.vorschau[k]; })[0];
      if (bsp) z.push('  Beispieladresse (Werte ausgeblendet): ' + adrKurz(bsp.u));
      var vt = S.vorschauTest;
      if (!vt) z.push('  Ladetest: noch nicht gelaufen („Bilder prüfen“).');
      else if (!vt.erg.length) z.push('  Ladetest: keine Bildadressen bekannt.');
      else {
        z.push('  Ladetest vor ' + Math.round((Date.now() - vt.t) / 60000) + ' min (' + vt.erg.filter(function (r) { return r.ok; }).length + ' von ' + vt.erg.length + ' geladen; „Bilder prüfen“ wiederholt ihn, z. B. nach 30 und 60 min):');
        vt.erg.forEach(function (r) { z.push('    ' + (r.typ || '?') + ' ' + r.id + ', Adresse ' + Math.round(r.alter / 60000) + ' min alt: ' + (r.ok ? 'ok, ' + r.w + '×' + r.h + ' px, ' + r.ms + ' ms, Hintergrund ' + r.hg : r.text)); });
      }
    }
    if (S.relInfo) {
      // Beziehungen, die das Widget heute auswertet; alle anderen stehen als „nicht ausgewertet“ da (Hinweis auf mögliche Erweiterungen oder Lücken)
      var bekannt = /^(v6_structure_|v6_specdoc_|v6_annexdoc_|v6_cad_document_|issue_|issue_context_|workspaces_folders_|workspaces_bookmarks_)/;
      if (S.relInfo.fehler) z.push('', 'Beziehungsübersicht (getrelationcount): nicht lesbar – ' + S.relInfo.fehler);
      else {
        var rn = Object.keys(S.relInfo.sum).sort(), zeile = function (n) { var s = S.relInfo.sum[n]; return n + ' (' + s.richtung + '): ' + s.objekte + ' Objekte, ' + s.zahl + ' Beziehungen'; };
        z.push('', 'Beziehungsübersicht (getrelationcount, die ersten ' + S.relInfo.n + ' Strukturobjekte, ' + (S.relInfo.ms / 1000).toFixed(1) + ' s):');
        rn.filter(function (n) { return bekannt.test(n); }).forEach(function (n) { z.push('  ausgewertet:       ' + zeile(n)); });
        rn.filter(function (n) { return !bekannt.test(n); }).forEach(function (n) { z.push('  nicht ausgewertet: ' + zeile(n)); });
        if (!rn.length) z.push('  (keine Beziehungen gemeldet)');
      }
    }
    if (S.zqInfo && S.zqInfo.length) { z.push('', 'Zone Query (Attribute):'); S.zqInfo.forEach(function (c) { z.push('  ' + c); }); }
    if (S.expandInfo && S.expandInfo.length) { z.push('', 'Produktstruktur:'); S.expandInfo.forEach(function (c) { z.push('  ' + c); }); }
    if (S.cadInfo.length) { z.push('', 'Downloads von Bauteilen/Baugruppen:'); S.cadInfo.forEach(function (c) { z.push('  ' + c); }); if (S.dlWeg) z.push('  zuletzt von Hand gewählt: ' + S.dlWeg); }
    z.push('', '=== Ab hier nur bei Bedarf: alle Aufrufe ===', 'Aufrufe:');
    S.log.forEach(function (l) { z.push(l.zeit + '  ' + (l.ok ? 'ok    ' : 'FEHLER') + '  ' + l.aufruf + '  ' + l.info + '  ' + l.ms + ' ms'); });
    z.push('', 'Erste Antwort je Aufrufart (gekürzt):');
    Object.keys(S.roh).sort(function (x, y) { return (/Beispiel|dsiss/.test(y) ? 1 : 0) - (/Beispiel|dsiss/.test(x) ? 1 : 0); }).forEach(function (k) { z.push('--- ' + k, S.roh[k]); });
    return z.join('\n');
  }
  function diagnose() { var d = q('.td-dx'); if (d && d.style.display !== 'none') d.value = diagnoseText(); }

  function baueOberflaeche(root) {
    S.root = root;
    var knopf = 'background:#fff;color:#3d3d3d;border:1px solid #b4b6ba;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit';
    var feld = 'background:#fff;color:#3d3d3d;border:1px solid #b4b6ba;border-radius:4px;padding:4px 8px;font:inherit';
    root.innerHTML =
      '<div class="td-w" style="position:fixed;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;background:#0b1220;color:#3d3d3d;font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif">' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 10px;background:#fff;border-bottom:1px solid #e2e4e3;accent-color:#368ec4">' +
      '<div class="td-dz" title="Ein Objekt aus einer 3DEXPERIENCE-Suche hierher ziehen: Physical Product (Struktur abwärts), Bookmark, Issue oder Person" style="border:2px dashed #368ec4;border-radius:4px;padding:3px 10px;color:#368ec4;white-space:nowrap">⤓ Objekt hierher ziehen</div>' +
      '<input class="td-su" type="text" placeholder="Bookmark-Name oder ID" title="Bookmark nach Name oder ID suchen" style="' + feld + ';width:190px" />' +
      '<button class="td-sb" style="' + knopf + '">Suchen</button>' +
      '<select class="td-tr" style="' + feld + ';max-width:260px;display:none"></select>' +
      '<button class="td-la" style="' + knopf + ';background:#368ec4;border-color:#368ec4;color:#fff;display:none">Laden</button>' +
      '<button class="td-nl" title="Neu lesen: Zwischenspeicher leeren und das geladene Objekt frisch von der Plattform holen (Daten bleiben sonst 30 Minuten gespeichert)" style="' + knopf + ';display:none">↻</button>' +
      '<label title="Spezifikationen und Attachments der Objekte mitlesen (im Hintergrund, nach dem ersten Bild)" style="display:flex;align-items:center;gap:4px"><input class="td-dk" type="checkbox" checked="checked" />Dokumente</label>' +
      '<label title="Zeichnungen (Drawings) der Strukturobjekte suchen und anzeigen (im Hintergrund, nach dem ersten Bild)" style="display:flex;align-items:center;gap:4px"><input class="td-zg" type="checkbox" checked="checked" />Zeichnungen</label>' +
      '<label title="Issues, Aufgaben und Personen zu den Objekten mitlesen (im Hintergrund, nach dem ersten Bild)" style="display:flex;align-items:center;gap:4px"><input class="td-ia" type="checkbox" checked="checked" />Issues/Aufgaben</label>' +
      '<input class="td-ci" type="text" placeholder="Security Context: Rolle.Organisation.Collaborative Space" title="Security Context von Hand" style="' + feld + ';width:330px;display:none" />' +
      '<button class="td-db" style="' + knopf + '">Diagnose</button>' +
      '<span class="td-mo" style="padding:2px 8px;border-radius:10px;background:#fff3cd;color:#7a5c00;border:1px solid #e6cf7a;display:none">Testmodus: Beispieldaten</span>' +
      '<span class="td-st" style="flex:1;min-width:200px;color:#3d3d3d">Starte …</span></div>' +
      '<div class="td-dp" style="display:none;padding:6px 8px;background:#f4f5f6;border-bottom:1px solid #d1d4d4">' +
      '<div style="margin-bottom:4px">Protokoll aller Abfragen. Zum Weitergeben: „Kopieren“ drücken, vorher Vertrauliches prüfen. <button class="td-dc" style="' + knopf + '">Kopieren</button> <button class="td-vb" title="Vorschaubilder: Laden, Größe und Hintergrund testen (für die Gültigkeitsdauer später wiederholen)" style="' + knopf + '">Bilder prüfen</button> <button class="td-ir" title="Zwischenspeicher leeren (alle Abfragen und Issue-Details); beim nächsten Laden wird alles frisch von der Plattform gelesen" style="' + knopf + '">Zwischenspeicher leeren</button></div>' +
      '<textarea class="td-dx" readonly="readonly" style="' + feld + ';width:100%;height:180px;box-sizing:border-box;font:12px monospace;display:none"></textarea></div>' +
      '<iframe class="td-fr" title="3Deep Darstellung" allow="fullscreen" style="flex:1;width:100%;border:0;background:#0b1220"></iframe></div>';
    q('.td-sb').onclick = suchen; q('.td-la').onclick = function () { laden(); };
    q('.td-su').addEventListener('keydown', function (e) { if (e.key === 'Enter') suchen(); });
    q('.td-db').onclick = function () { var p = q('.td-dp'), d = q('.td-dx'), auf = p.style.display === 'none'; p.style.display = auf ? '' : 'none'; d.style.display = auf ? '' : 'none'; diagnose(); };
    q('.td-ir').onclick = function () { var n = cacheLeeren(); status('Zwischenspeicher geleert (' + n + ' Einträge). Beim nächsten Laden wird alles neu gelesen.'); diagnose(); };
    q('.td-nl').onclick = neuLesen;
    q('.td-vb').onclick = function () { status('Prüfe Vorschaubilder …'); vorschauPruefen().then(function () { status('Vorschaubilder geprüft – Ergebnis in der Diagnose unter „Vorschaubilder“.'); }); };
    q('.td-dc').onclick = function () { var d = q('.td-dx'); d.value = diagnoseText(); d.select(); try { document.execCommand('copy'); } catch (e) { } if (navigator.clipboard) navigator.clipboard.writeText(d.value).catch(function () { }); };
    q('.td-ci').onchange = function (e) { S.ctx = e.target.value.trim(); try { localStorage.setItem('3deep_ctx', S.ctx); } catch (x) { } if (S.ctx) status('Security Context gesetzt. Bookmark-Namen eingeben und „Suchen“ drücken.'); };
    ['.td-dk', '.td-zg', '.td-ia'].forEach(function (k) { q(k).addEventListener('change', haekchenGeaendert); });
    S.frame = q('.td-fr');
    dropEinrichten(q('.td-dz'));
  }
  function ladeDarstellung() {
    S.frame.src = S.viewerUrl;
    setTimeout(function () { if (!S.bereit) status('Die Darstellung meldet sich nicht (' + S.viewerUrl + '). Adresse in den Widget-Einstellungen unter „Adresse von datenraum3d.html“ prüfen.', true); }, 12000);
  }

  // ---------- Start im 3DDashboard ----------
  function tenantAus(url) { var h = (String(url).match(/^https?:\/\/([^\/]+)/) || [])[1] || ''; return h.split('-')[0].toUpperCase(); }
  function spaceAusRahmen() {
    var kandidaten = [];
    try { kandidaten.push(new URLSearchParams(window.location.search).get('widgetDomain') || ''); } catch (e) { }
    try { kandidaten.push(document.referrer || ''); } catch (e) { }
    try { kandidaten.push(window.location.href); } catch (e) { }
    for (var i = 0; i < kandidaten.length; i++) {
      var m = String(kandidaten[i]).match(/^(https:\/\/[A-Za-z0-9]+-[A-Za-z0-9-]*?)-ifwe\.([A-Za-z0-9.-]+)/);
      if (m) return m[1] + '-space.' + m[2] + '/enovia';
    }
    return '';
  }
  function startLive() {
    var w = window.widget;
    baueOberflaeche(w.body || document.body);
    S.live = true;
    dropPlattform(q('.td-dz'));
    S.maxText = w.getValue('MaxObjekte');
    var basis = w.getValue('ViewerUrl') || '';
    if (!basis) basis = window.__3deep.basis + 'datenraum3d.html?v=' + DARSTELLUNG;
    S.viewerUrl = basis; ladeDarstellung();
    status('Lade Plattform-Module …');
    window.require(['DS/WAFData/WAFData', 'DS/i3DXCompassServices/i3DXCompassServices'], function (WAFData, Compass) {
      S.WAF = WAFData;
      var plattform = w.getValue('x3dPlatformId') || '';
      status('Ermittle 3DSpace-Adresse …');
      var erledigt = false;
      function nutze(url, quelle) {
        if (erledigt) return; erledigt = true;
        S.space = String(url).replace(/\/$/, ''); S.tenant = plattform || tenantAus(S.space); S.spaceQuelle = quelle;
        var fest = (w.getValue('SecurityContext') || '').trim();
        if (fest) { S.ctx = fest; status('Bereit. Bookmark-Namen eingeben und „Suchen“ drücken.'); letztesLaden(); return; }
        kontexte().then(function (k) {
          S.ctx = k.bevorzugt; S.ctxZahl = k.liste.length;   // automatisch: bevorzugter, sonst erster Kontext (kein Auswahlfeld, Wunsch des Nutzers)
          if (!S.ctx) ctxVonHand('Kein Security Context gefunden.'); else { status('Bereit. Bookmark-Namen eingeben und „Suchen“ drücken.'); letztesLaden(); }
        }, function (e) { ctxVonHand('Security Context nicht ermittelbar (' + e.message + ').'); }).then(diagnose);
      }
      function ctxVonHand(grund) {
        var f = q('.td-ci'), alt = ''; try { alt = localStorage.getItem('3deep_ctx') || ''; } catch (x) { }
        f.style.display = ''; f.value = alt; S.ctx = alt;
        status(alt ? 'Bereit (Security Context aus der letzten Sitzung). Bookmark-Namen eingeben und „Suchen“ drücken.' : grund + ' Bitte oben im Feld „Security Context“ eintragen (Rolle.Organisation.Collaborative Space), dann suchen.', !alt);
        if (alt) letztesLaden();
      }
      function rueckfall(grund) {
        if (erledigt) return;
        var u = spaceAusRahmen();
        if (u) nutze(u, 'aus der Dashboard-Adresse abgeleitet (' + grund + ')');
        else { erledigt = true; status('Die 3DSpace-Adresse konnte nicht ermittelt werden (' + grund + ').', true); }
      }
      setTimeout(function () { rueckfall('Plattform antwortet nicht'); }, 8000);
      try {
        Compass.getServiceUrl({
          serviceName: '3DSpace', platformId: plattform || undefined,
          onComplete: function (r) {
            var url = '';
            if (typeof r === 'string') url = r;
            else if (Array.isArray(r) && r.length) { var m = r.filter(function (x) { return !plattform || x.platformId === plattform; })[0] || r[0]; url = m.url || ''; }
            else if (r && r.url) url = r.url;
            if (url && url !== 'undefined') nutze(url, 'von der Plattform'); else rueckfall('keine Adresse geliefert');
          },
          onFailure: function () { rueckfall('Abfrage fehlgeschlagen'); }
        });
      } catch (e) { rueckfall(e.message); }
    }, function (e) { status('Plattform-Module nicht ladbar: ' + (e && e.message || e), true); });
  }

  // ---------- Testmodus: Beispieldaten im Format der echten Antworten ----------
  var TEST = null;
  function testDaten() {
    var n = 0; function id() { n++; return ('A1B2C3D4E5F6' + ('00000000000000000000' + n.toString(16).toUpperCase()).slice(-20)); }
    var T = { bm: {}, it: {}, kids: {}, doc: {}, v5: {}, dout: {} };
    function v5(i, endung) { T.v5[i] = { typ: endung === 'CATProduct' ? 'dsxcad:Product' : 'dsxcad:Part', datei: T.it[i].title + '.' + endung }; return i; }
    function item(titel, state, kinder) {
      var i = id(); T.it[i] = { id: i, name: 'prd-R1132100000000-' + ('00000000' + n).slice(-8), title: titel, description: 'Beispielobjekt ' + titel, type: 'VPMReference', revision: 'A.1', state: state || 'IN_WORK',
        owner: 'A. Bauer', organization: 'Company Name', collabspace: 'Common Space', created: '2026-09-14T08:12:00Z', modified: '2026-10-21T15:40:00Z', cestamp: 'C0FFEE' + n, isManufacturable: true,
        'dseng:EnterpriseReference': { partNumber: 'P-' + (1000 + n) } };
      T.kids[i] = (kinder || []).map(function (k, j) { return { id: id(), name: titel + '.' + (j + 1), type: 'VPMInstance', referencedObject: { source: '$3DSpace', type: (T.v5[k] && T.v5[k].typ) || 'VPMReference', identifier: k, relativePath: ENG + '/' + k } }; });
      return i;
    }
    var sensor = item('Temperatursensor', 'RELEASED');
    var schraube = item('Schraube M6x20', 'RELEASED');
    var scheibe = v5(item('Bremsscheibe', 'RELEASED'), 'CATPart'), sattel = v5(item('Bremssattel', 'FROZEN'), 'CATPart');
    var bremse = v5(item('Bremsanlage vorn', 'IN_WORK', [scheibe, sattel, sensor, schraube, schraube, schraube, schraube]), 'CATProduct');
    var vorder = item('Vorderachse', 'IN_WORK', [bremse, item('Querlenker', 'IN_WORK'), item('Radlager', 'RELEASED')]);
    var fahrwerk = item('Fahrwerk', 'IN_WORK', [vorder, item('Hinterachse', 'FROZEN', [item('Achsträger', 'FROZEN'), item('Stoßdämpfer', 'RELEASED')]), item('Lenkung', 'IN_WORK', [item('Lenkgetriebe', 'IN_WORK')])]);
    var kuehl = item('Kühlkörper', 'RELEASED'); T.dout[kuehl] = 'Kuehlkoerper';
    var le = item('Leistungselektronik', 'IN_WORK', [item('Wechselrichter-Modul', 'IN_WORK', [item('Leiterplatte', 'IN_WORK'), kuehl]), sensor, schraube, schraube]);
    var antrieb = item('Elektroantrieb', 'IN_WORK', [item('E-Motor', 'FROZEN', [le, item('Rotor', 'RELEASED'), item('Stator', 'RELEASED')]), item('Thermomanagement', 'IN_WORK', [item('Kühlmittelpumpe', 'OBSOLETE')])]);
    var lose = item('Ladekabel Typ 2', 'RELEASED');
    T.rel = {};
    function dok(titel, datei, state) { var i = id(); T.doc[i] = { id: i, type: 'Document', dataelements: { title: titel, name: 'DOC-' + n, revision: 'A.1', state: state || 'RELEASED', stateNLS: state === 'IN_WORK' ? 'In Work' : 'Released', description: 'Beispieldokument', owner: 'A. Bauer', modified: '2026-10-21T15:40:00Z' }, relateddata: { files: [{ id: id(), dataelements: { title: datei } }] } }; return i; }
    function haenge(item, rel, d) { var k = item + '|' + rel; (T.rel[k] = T.rel[k] || []).push(d); }
    var sp1 = dok('Spezifikation Leistungselektronik', 'Spez_LE.pdf'), sp2 = dok('Lastenheft Bremsanlage', 'LH_Bremse.pdf', 'IN_WORK'), sp3 = dok('Prüfvorschrift Temperatursensor', 'PV_Sensor.pdf');
    haenge(le, 'SpecificationDocument', sp1); haenge(antrieb, 'SpecificationDocument', sp1); haenge(bremse, 'SpecificationDocument', sp2); haenge(sensor, 'SpecificationDocument', sp3);
    haenge(fahrwerk, 'PLMDocConnection', dok('Präsentation Fahrwerk', 'Fahrwerk.pptx')); haenge(sensor, 'PLMDocConnection', dok('Datenblatt Sensor', 'Datenblatt.pdf')); haenge(le, 'PLMDocConnection', dok('Messprotokoll', 'Messung.xlsx'));
    var d1 = id(); T.doc[d1] = { id: d1, type: 'Document', dataelements: { title: 'Lastenheft Elektroantrieb.pdf', name: 'DOC-0001', revision: '1.1', state: 'RELEASED', stateNLS: 'Released', description: 'Spezifikation' } };
    T.iss = {}; T.tsk = {}; T.scope = {}; T.pers = {};
    function pers(login, vor, nach) { var i = id(); T.pers[i] = { id: i, name: login, firstname: vor, lastname: nach, email: login + '@example.com' }; return i; }
    T.cmeier = pers('cmeier', 'C.', 'Meier'); T.abauer = pers('abauer', 'A.', 'Bauer'); T.fremd = pers('xnobody', 'X.', 'Niemand');
    function eref(typ, i) { return { source: '$3DSpace', type: typ, identifier: i, relativePath: '/…/' + i }; }
    function issue(titel, state, betrifft, wer) { var i = id(); T.iss[i] = { id: i, type: 'Issue', name: 'ISS-' + n, title: titel, description: 'Beispiel-Issue', state: state, owner: 'abauer', organization: 'Company Name', collabSpace: 'Common Space', Priority: 'High', 'Estimated End Date': '2026-12-01T00:00:00Z',
      members: { coowners: [], assignees: wer, contributors: [] }, affectedItems: [{ elements: betrifft.map(function (b) { return eref('VPMReference', b); }) }], contexts: [] }; return i; }
    function aufgabe(titel, state, scope, wer, refs) { var i = id(); T.tsk[i] = { id: i, type: 'Task', identifier: i, dataelements: { title: titel, state: state, description: 'Beispielaufgabe', dueDate: '2026-11-30T00:00:00Z', percentComplete: '40', originated: '2026-10-01T08:00:00Z' },
      relateddata: { assignees: wer.map(function (w) { return { id: id(), type: 'Person', dataelements: { name: w[0], fullname: w[1], email: w[0] + '@example.com' } }; }), scopes: scope ? [{ id: scope, type: 'x', identifier: scope }] : [], references: (refs || []).map(function (r) { return { id: r, identifier: r }; }), deliverables: [] } };
      if (scope) (T.scope[scope] = T.scope[scope] || []).push(i); return i; }
    T.fahrwerk = fahrwerk; T.bremse = bremse; T.vorder = vorder; T.sp1 = sp1;
    // Repräsentationen: native Zeichnung an Leistungselektronik, 3D-Form an Bremsscheibe (keine Zeichnung), V5-Zeichnung zum Bremssattel (xCAD)
    T.rep = {}; T.xdrw = {};
    function rep(eltern, titel, typ) { var r = id(), ins = id(); T.it[r] = { id: r, name: 'drw-' + n, title: titel, description: '', type: typ, revision: 'A.1', state: 'RELEASED', owner: 'A. Bauer', created: '2026-09-14T08:12:00Z', modified: '2026-10-21T15:40:00Z' };
      (T.rep[eltern] = T.rep[eltern] || []).push({ id: ins, type: 'VPMRepInstance', name: titel + '.1', referencedObject: { source: '$3DSpace', type: typ, identifier: r, relativePath: '/…/' + r } }); return r; }
    T.zle = rep(le, 'Zeichnung Leistungselektronik', 'Drawing'); rep(scheibe, 'Bremsscheibe 3D', '3DShape');
    var xd = id(); T.xdrw[sattel] = [{ id: xd, type: 'dsxcad:Drawing', dataelements: { title: 'Bremssattel', name: 'Bremssattel.CATDrawing', revision: 'B', state: 'RELEASED', owner: 'A. Bauer', modified: '2026-10-21T15:40:00Z' } }];
    T.v5[xd] = { typ: 'dsxcad:Drawing', datei: 'Bremssattel.CATDrawing' }; T.xd = xd;
    var is1 = issue('Sensor liefert bei Kälte falsche Werte', 'In Work', [sensor, le], ['cmeier']);
    haenge(is1, 'Reference Document', dok('Foto Fehlerbild', 'Fehlerbild.png'));
    T.is1 = is1;
    issue('Issue ohne Bezug zum Bookmark', 'Create', ['FFFF0000FFFF0000FFFF0000FFFF0000'], ['cmeier']);
    aufgabe('Sensor neu qualifizieren', 'Active', is1, [['abauer', 'A. Bauer']]);
    aufgabe('Bremssattel-Zeichnung prüfen', 'Create', bremse, [['cmeier', 'C. Meier'], ['abauer', 'A. Bauer']]);
    T.meine = aufgabe('Lastenheft überarbeiten', 'Review', null, [['abauer', 'A. Bauer']], [sp2]);
    aufgabe('Aufgabe ohne Bezug', 'Create', null, [['abauer', 'A. Bauer']]);
    function ref(typ, i) { return { referencedObject: { source: '$3DSpace', type: typ, identifier: i, relativePath: '/…/' + i } }; }
    var unter = id(), haupt = id();
    T.bm[unter] = { id: unter, title: 'Dokumente', description: 'Unterordner', owner: 'A. Bauer', created: '2026-09-14T08:00:00Z', modified: '2026-10-01T09:00:00Z', collabspace: 'Common Space', type: 'Workspace Vault', items: [ref('Document', d1)] };
    T.bm[haupt] = { id: haupt, title: 'E-Fahrzeug-Review', description: 'Review-Ordner (Beispiel)', owner: 'A. Bauer', created: '2026-09-14T08:00:00Z', modified: '2026-10-21T15:40:00Z', collabspace: 'Common Space', type: 'Workspace Vault',
      items: [ref('VPMReference', fahrwerk), ref('VPMReference', antrieb), ref('VPMReference', lose), ref('Workspace Vault', unter)] };
    T.unter2 = id(); T.bm[T.unter2] = { id: T.unter2, title: 'Prüfberichte', description: 'Unter-Unterordner (nur Test S.testUnterFeld)', owner: 'A. Bauer', created: '2026-09-20T08:00:00Z', modified: '2026-10-02T09:00:00Z', collabspace: 'Common Space', type: 'Workspace Vault', items: [] };
    return T;
  }
  function T5(i) { return TEST.v5[i] && TEST.v5[i].typ; }
  function eref2(typ, i) { return { source: '$3DSpace', type: typ, identifier: i, relativePath: '/…/' + i }; }
  // Testmodus (Adapter 30): getecosystem-Antworten bekommen ein Bildfeld preview_url wie (laut Nutzer) auf der Plattform.
  // S.testVorschau: 'frei' (Voreinstellung, transparent), 'weiss' (fester weißer Hintergrund), 'kaputt' (Adresse lädt nicht), 'aus' (kein Feld)
  function testFoto(fn) {
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#8a96a3"/><rect y="300" width="640" height="120" fill="#4a525b"/>' +
      '<circle cx="300" cy="200" r="110" fill="#c9d0d6"/><circle cx="300" cy="200" r="36" fill="#3a4048"/><text x="14" y="405" font-family="sans-serif" font-size="18" fill="#fff">' + String(fn).replace(/[<&>]/g, '') + '</text></svg>');
  }
  function testBild(id, weiss) {
    var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    var c = function (l) { return 'hsl(' + [210, 28, 192, 220][h % 4] + ',16%,' + l + '%)'; }, b = 20 + (h % 3) * 8;
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="104" viewBox="0 0 128 104">' + (weiss ? '<rect width="128" height="104" fill="#ffffff"/>' : '') +
      '<polygon points="64,' + (40 - b) + ' 112,' + (64 - b) + ' 64,' + (88 - b) + ' 16,' + (64 - b) + '" fill="' + c(80) + '"/><polygon points="16,' + (64 - b) + ' 64,' + (88 - b) + ' 64,96 16,72" fill="' + c(42) + '"/>' +
      '<polygon points="64,' + (88 - b) + ' 112,' + (64 - b) + ' 112,72 64,96" fill="' + c(60) + '"/><ellipse cx="64" cy="' + (64 - b) + '" rx="13" ry="6.5" fill="' + c(24) + '"/></svg>');
  }
  function testGet(pfad, p, methode, body) {
    return testGetRoh(pfad, p, methode, body).then(function (r) {
      if (pfad === ECO && r && r.objects && S.testVorschau !== 'aus') r.objects.forEach(function (x) {
        if (!x || !x.id || /Issue|Person|Workspace/i.test(x.type || '')) return;
        x.preview_url = S.testVorschau === 'kaputt' ? 'https://fcs.invalid/fcs/servlet/fcs/thumbnail?__fcs__jobTicket=TEST' + x.id + '&file=thumb.jpg' : testBild(x.id, S.testVorschau === 'weiss');
      });
      return r;
    });
  }
  function testGetRoh(pfad, p, methode, body) {
    if (!TEST) TEST = testDaten();
    return new Promise(function (ja, nein) {
      setTimeout(function () {
        var skip = +p.$skip || 0, anz = +p.$top || 50, m;
        function seite(a) { return a.slice(skip, skip + anz); }
        if (pfad === RCNT) {   // Test (Adapter 29): Beziehungsübersicht; S.testRelFehler = Fehler. „mkp_ctxt_from“ steht für eine Beziehung, die das Widget nicht auswertet
          if (S.testRelFehler) return nein(new Error('500 Internal Server Error'));
          var cn = [], zc = function (src, name, dir, n) { if (n) cn.push({ count: n, direction: dir, id: src + '_' + name, name: name, source: src }); };
          ((body || {}).items || []).forEach(function (it, ix) {
            zc(it.id, 'v6_structure_to', 'out', (TEST.kids[it.id] || []).length);
            zc(it.id, 'v6_specdoc_to', 'out', (TEST.rel[it.id + '|SpecificationDocument'] || []).length);
            zc(it.id, 'v6_annexdoc_to', 'out', (TEST.rel[it.id + '|PLMDocConnection'] || []).length + (TEST.rel[it.id + '|Reference Document'] || []).length);
            zc(it.id, 'issue_from', 'in', Object.keys(TEST.iss).filter(function (k) { return refIds(TEST.iss[k].affectedItems).indexOf(it.id) >= 0; }).length);
            if (ix === 0) zc(it.id, 'mkp_ctxt_from', 'in', 3);
          });
          return ja({ counts: cn, info: [{ domain: '3DSpace', success: true }], unindexedObjects: [] });
        }
        if (pfad === ECO && (body || {}).direction === 'out' && ((body || {}).relations || []).indexOf('v6_specdoc_to') >= 0) {
          // Test (Adapter 29): Dokumente an Objekten. S.testEcoDokFehler = Fehler; S.testEcoOhnePlm = Beziehung PLMDocConnection erscheint hier nicht
          if (S.testEcoDokFehler) return nein(new Error('500 Internal Server Error'));
          var dob = [], dli = [];
          ((body || {}).items || []).forEach(function (it) {
            dob.push({ id: it.id, type: it.type });
            [['SpecificationDocument', 'v6_specdoc_to'], ['Reference Document', 'v6_annexdoc_to'], ['PLMDocConnection', S.testEcoOhnePlm ? '' : 'v6_annexdoc_to']].forEach(function (rn) {
              if (!rn[1]) return;
              (TEST.rel[it.id + '|' + rn[0]] || []).forEach(function (did) {
                var e = (TEST.doc[did] || {}).dataelements || {};
                dob.push({ id: did, name: e.title, type: 'Document', 'ds6w:label': e.title, 'ds6w:identifier': e.name, revision: e.revision, 'ds6w:status': 'Document Release.' + (e.state || ''), 'ds6w:modified': e.modified, 'ds6w:responsible': e.owner });
                dli.push({ type: rn[1], source: it.id, target: did, direction: 'out' });
              });
            });
          });
          return ja({ objects: dob, links: dli, info: [{ domain: '3DSpace', success: true }] });
        }
        if (pfad === ECO) {   // Test (Adapter 25): getecosystem für Bookmark-Ordner; S.testEcoFehler = Fehler, S.testWieReal = Unter-Unterordner „Prüfberichte“ nur hier
          if ((body || {}).direction === 'in' && ((body || {}).relations || []).indexOf('issue_from') >= 0) {   // Test (Adapter 27): Issues eingehend; S.testEcoIssFehler = Fehler
            if (S.testEcoIssFehler) return nein(new Error('500 Internal Server Error'));
            var io2 = [], il2 = [], inr = {}; ((body || {}).items || []).forEach(function (it) { io2.push({ id: it.id, type: it.type }); inr[it.id] = 1; });
            Object.keys(TEST.iss).forEach(function (k) { var x = TEST.iss[k], drin = false;
              refIds(x.affectedItems).forEach(function (b) { if (inr[b]) { drin = true; il2.push({ type: 'issue_to', source: k, target: b, direction: 'out' }); } });
              refIds(x.contexts).forEach(function (b) { if (inr[b]) { drin = true; il2.push({ type: 'issue_context_to', source: k, target: b, direction: 'out' }); } });
              if (drin) io2.push({ id: k, type: 'Issue', name: x.title, 'ds6w:label': x.title, 'ds6w:identifier': x.name }); });
            return ja({ objects: io2, links: il2, info: [{ domain: '3DSpace', success: true }] });
          }
          if ((body || {}).direction === 'in') {   // Test (Adapter 26): Zeichnungen per Zeigerbeziehung; S.testEcoZeichnung = Zeichnung „_Bremsanlage“ (V5) an Bremsanlage vorn
            if (S.testEcoZeichFehler) return nein(new Error('500 Internal Server Error'));
            var zo = [], zlk = [];
            ((body || {}).items || []).forEach(function (it) {
              zo.push({ id: it.id, type: 'VPMReference' });
              (TEST.xdrw[it.id] || []).forEach(function (xz) { var xe = xz.dataelements || {};   // V5-Zeichnung des Testmodells: wie auf der Plattform per Zeigerbeziehung sichtbar
                zo.push({ id: xz.id, name: xe.title, type: 'Drawing', 'ds6w:label': xe.title, 'ds6w:identifier': xe.name, revision: xe.revision, 'ds6w:status': 'VPLM_SMB_Definition.' + (xe.state || ''), 'ds6w:responsible': xe.owner, 'ds6w:modified': xe.modified,
                  taxonomies: ['types/PLMEntity/PLMReference/PLMCoreRepReference/VPMRepReference/Drawing', 'interfaces/XCADRepExtension'] });
                zlk.push({ type: 'v6_cad_document_to', source: xz.id, target: it.id, direction: 'in', 'ro.xcadbasedependency.v_cadlinktype': 'drawing' }); });
              if (S.testEcoZeichnung && it.id === TEST.bremse) { zo.push({ id: 'ECODRW0001', name: '_Bremsanlage', type: 'Drawing', 'ds6w:label': '_Bremsanlage', 'ds6w:identifier': 'drw-0001', revision: 'A.1', 'ds6w:status': 'VPLM_SMB_Definition.IN_WORK',
                taxonomies: ['types/PLMEntity/PLMReference/PLMCoreRepReference/VPMRepReference/Drawing', 'interfaces/XCADRepExtension'] });
                zlk.push({ type: 'v6_cad_document_to', source: 'ECODRW0001', target: it.id, direction: 'in', 'ro.xcadbasedependency.v_cadlinktype': 'drawing' }); }
            });
            return ja({ objects: zo, links: zlk });
          }
          if (S.testEcoFehler) return nein(new Error('404 Not Found'));
          var eid = (((body || {}).items || [])[0] || {}).id, eb = TEST.bm[eid]; if (!eb) return ja({ objects: [], links: [] });
          var obs = [{ id: eb.id, name: eb.title, type: eb.type }], lks = [], rid = function (x) { return (x.referencedObject || x).identifier || (x.referencedObject || x).id; };
          eb.items.concat(S.testWieReal && eb.title === 'Dokumente' ? [{ referencedObject: { type: 'Workspace Vault', identifier: TEST.unter2 } }] : []).forEach(function (x) {
            var t = (x.referencedObject || x).type, i2 = rid(x), u = TEST.bm[i2];
            if (/Workspace/.test(t)) { obs.push({ id: i2, name: u.title, type: 'Workspace Vault', 'ds6w:label': u.title }); lks.push({ type: 'workspaces_bookmarks_to', source: eb.id, target: i2, direction: 'out' }); }
            else { obs.push({ id: i2, type: t }); lks.push({ type: 'workspaces_folders_to', source: eb.id, target: i2, direction: 'out' }); }
          });
          return ja({ objects: obs, links: lks, info: [{ domain: '3DSpace', success: true }] });
        }
        if (pfad === BKS + '/search') {
          var s = String(p.$searchStr || '*').toLowerCase().replace(/\*/g, '');
          var alle = Object.keys(TEST.bm).map(function (k) { var b = TEST.bm[k]; return { id: b.id, title: b.title, description: b.description, owner: b.owner, type: b.type }; }).filter(function (b) { return !s || b.title.toLowerCase().indexOf(s) >= 0; });
          return ja({ totalItems: alle.length, member: seite(alle) });
        }
        if ((m = pfad.match(/dsbks:Bookmark\/([^\/]+)$/))) {
          var b = TEST.bm[m[1]]; if (!b) return nein(new Error('404 Bookmark nicht gefunden'));
          var kopie = {}, its = b.items; Object.keys(b).forEach(function (k) { kopie[k] = b[k]; });
          if (S.testWieReal) { its = b.items.filter(function (x) { return !/Workspace/.test((x.referencedObject || x).type); }); kopie = { id: b.id, name: b.title }; }
          if (S.testUnterFeld) {   // Test (Adapter 24): Unterordner nicht im Inhalt, sondern in einem eigenen Feld; Eltern-Feld darf nicht nach oben führen
            its = b.items.filter(function (x) { return !/Workspace/.test(x.referencedObject ? x.referencedObject.type : x.type); });
            kopie.subBookmarks = b.items.filter(function (x) { return its.indexOf(x) < 0; }).map(function (x) { var u = TEST.bm[(x.referencedObject || x).identifier || (x.referencedObject || x).id] || {}; return { id: u.id, title: u.title, type: 'Workspace Vault' }; })
              .concat(b.title === 'Dokumente' ? [{ id: TEST.unter2, title: 'Prüfberichte', type: 'Workspace Vault' }] : []);
            var el = Object.keys(TEST.bm).filter(function (k) { return TEST.bm[k].items.some(function (x) { return ((x.referencedObject || x).identifier || (x.referencedObject || x).id) === b.id; }); })[0];
            if (el) kopie.parentBookmark = { id: el, title: TEST.bm[el].title, type: 'Workspace Vault' };
          }
          delete kopie.items; kopie.items = { totalItems: its.length, member: seite(its) };
          return ja({ totalItems: 1, member: [kopie] });
        }
        if ((m = pfad.match(/dseng:EngItem\/([^\/]+)\/expand$/))) {
          if (methode !== 'POST') return nein(new Error('405'));
          if (S.testExpandFehler) return nein(new Error('404 Not Found'));
          var wurzel = m[1]; if (!TEST.it[wurzel]) return nein(new Error('404 Objekt nicht gefunden'));
          var mem = [], gesehenR = {}, maxT = (body || {}).expandDepth; if (maxT == null || maxT < 0) maxT = 99;
          (function ab(rid, pfadBis, t) {
            if (!gesehenR[rid]) { gesehenR[rid] = 1; var o = TEST.it[rid], k = {}; ['id', 'name', 'title', 'description', 'type', 'revision', 'state', 'owner', 'organization', 'collabspace', 'created', 'modified', 'cestamp'].forEach(function (f) { k[f] = o[f]; }); if (T5(rid)) k.type = T5(rid); mem.push(k); }
            if (t >= maxT) return;
            (TEST.kids[rid] || []).forEach(function (ins) { var c = ins.referencedObject.identifier, p2 = pfadBis.concat([ins.id, c]);
              mem.push({ id: ins.id, type: 'VPMInstance', name: ins.name }); mem.push({ Path: p2 }); ab(c, p2, t + 1); });
          })(wurzel, [wurzel], 0);
          return ja({ totalItems: mem.length, member: mem });
        }
        if (pfad === ZQ) {
          if (methode !== 'POST') return nein(new Error('405'));
          var sb = (body || {}).select_bo || [];
          if (S.testZoneFehler === 'alle') return nein(new Error('404 Not Found'));
          if (S.testZoneFehler === 'leer') return ja({});
          if (S.testZoneFehler === 'ds6wg' && sb.some(function (x) { return /^ds6wg:/.test(x); })) return nein(new Error('400 Invalid parameter select_bo !'));
          if (!body || !Array.isArray(body.root_path_physicalid) || !body.label) return nein(new Error('400 Invalid parameter root_path_physicalid !'));
          var did = 1000, dids = {}, res = [], pfadeZ = [], maxZ = +body.expand_iter; if (!(maxZ >= 0)) maxZ = 99;
          function wert(o, a) { return { physicalid: o.id, 'ds6w:label': o.title, 'ds6w:identifier': o.name, 'ds6w:type': o.type, 'ds6w:status': 'VPLM_SMB_Definition.' + o.state, 'ds6w:responsible': o.owner,
            'ds6w:created': o.created, 'ds6w:modified': o.modified, 'ds6w:description': o.description, 'ds6wg:revision': o.revision, 'ds6wg:EnterpriseExtension.V_PartNumber': (o['dseng:EnterpriseReference'] || {}).partNumber }[a]; }
          function el(pid, o) {
            if (dids[pid]) return dids[pid]; var d = ++did; dids[pid] = d;
            var at = [{ name: 'did', value: String(d) }]; sb.forEach(function (a) { var w = o ? wert(o, a) : (a === 'physicalid' ? pid : a === 'ds6w:type' ? 'VPMInstance' : null); if (w != null) at.push({ name: a, value: w }); });
            res.push({ attributes: at }); return d;
          }
          body.root_path_physicalid.forEach(function (rp) {
            var wz = rp[rp.length - 1]; if (!TEST.it[wz]) return;
            (function ab(rid, pf, t) {
              var kk = t < maxZ ? (TEST.kids[rid] || []) : [];
              (TEST.rep[rid] || []).forEach(function (ri) { var rr = ri.referencedObject.identifier; pfadeZ.push(pf.concat([el(ri.id, null), el(rr, TEST.it[rr])])); });
              if (!kk.length && !(TEST.rep[rid] || []).length) pfadeZ.push(pf.slice());
              kk.forEach(function (ins) { var c = ins.referencedObject.identifier; ab(c, pf.concat([el(ins.id, null), el(c, TEST.it[c])]), t + 1); });
            })(wz, [el(wz, TEST.it[wz])], 0);
          });
          pfadeZ.forEach(function (pp) { res.push({ path: pp }); });
          return ja({ results: res });
        }
        if ((m = pfad.match(/dseng:EngItem\/([^\/]+)\/dseng:EngRepInstance$/))) { if (S.testZeichFehler) return nein(new Error('404 Not Found')); var rr2 = TEST.rep[m[1]] || []; return ja({ totalItems: rr2.length, member: seite(rr2) }); }
        if ((m = pfad.match(/dsxcad:(Part|Product)\/([^\/]+)\/dsxcad:Drawing$/))) { if (S.testZeichFehler) return nein(new Error('404 Not Found')); var xx = TEST.xdrw[m[2]] || []; return ja({ totalItems: xx.length, member: xx }); }
        if ((m = pfad.match(/dseng:EngItem\/([^\/]+)\/dseng:EngInstance$/))) { var kk = TEST.kids[m[1]] || []; return ja({ totalItems: kk.length, member: seite(kk) }); }
        if ((m = pfad.match(/dseng:EngItem\/([^\/]+)$/))) { var it = TEST.it[m[1]]; return it ? ja({ totalItems: 1, member: [it] }) : nein(new Error('404 Objekt nicht gefunden')); }
        if (pfad === '/resources/v1/application/CSRF') return ja({ success: true, csrf: { name: 'ENO_CSRF_TOKEN', value: 'TEST-TOKEN' } });
        if ((m = pfad.match(/dsxcad:(Part|Product|Drawing)\/([^\/]+)\/dsxcad:AuthoringFile\/DownloadTicket$/))) {
          if (methode !== 'POST') return nein(new Error('405'));
          var v = TEST.v5[m[2]];
          if (!v || v.typ !== 'dsxcad:' + m[1]) return nein(new Error('404 kein ' + m[1] + ' im xCAD-Modell'));
          return ja({ ticketURL: S.testFcs || 'https://eu1-dfcs.3dexperience.example/fcs/servlet/fcs/checkout', ticket: 'TICKET-' + m[2], filename: v.datei, jobticket: 'JOB-' + m[2] });
        }
        if (pfad === DSDO + 'dsdo:DerivedOutputs/Locate') {
          if (methode !== 'POST') return nein(new Error('405'));
          var rid = (((body || {}).referencedObject || [])[0] || {}).identifier, dn = TEST.dout[rid];
          return ja({ totalItems: dn ? 1 : 0, member: dn ? [{ id: 'D0' + rid.slice(-8), referencedObject: eref2('VPMReference', rid), derivedoutputfiles: [{ id: 'F1', filename: dn + '.cgr', format: 'CGR' }, { id: 'F2', filename: dn + '.stp', format: 'STEP' }] }] : [] });
        }
        if ((m = pfad.match(/dsdo:DerivedOutputs\/([^\/]+)\/dsdo:DerivedOutputFiles\/([^\/]+)\/DownloadTicket$/))) {
          if (methode !== 'POST') return nein(new Error('405'));
          var fname = m[2] === 'F2' ? 'Kuehlkoerper.stp' : 'Kuehlkoerper.cgr';
          return ja({ success: true, statusCode: 200, data: { doid: m[1], dataelements: { ticketURL: S.testFcs || 'https://eu1-dfcs.3dexperience.example/fcs/servlet/fcs/checkout', ticket: 'TICKET-DO-' + m[2], filename: fname } } });
        }
        if ((m = pfad.match(/documents\/([^\/]+)\/files\/DownloadTicket$/))) {
          if (methode !== 'PUT') return nein(new Error('405'));
          var dd = TEST.doc[m[1]], fn = (((dd || {}).relateddata || {}).files || [{}])[0].dataelements; fn = (fn && fn.title) || 'Beispiel.txt';
          if (/\.(png|jpe?g)$/i.test(fn)) { S.testFotoTickets = (S.testFotoTickets || 0) + 1; if (S.testFotoFehler) return nein(new Error('500')); return ja({ success: true, data: [{ id: m[1], dataelements: { ticketURL: testFoto(fn), fileName: fn } }] }); }   // Adapter 34
          return ja({ success: true, data: [{ id: m[1], dataelements: { ticketURL: 'data:text/plain;charset=utf-8,' + encodeURIComponent('Beispieldatei aus dem 3Deep-Testmodus: ' + fn), fileName: fn + '.txt' } }] });
        }
        if (pfad === ISS + '/search') { var st = String(p.$searchStr || '*').toLowerCase().replace(/\*/g, ''); var ii = Object.keys(TEST.iss).filter(function (k) { return !st || (TEST.iss[k].title + ' ' + TEST.iss[k].name).toLowerCase().indexOf(st) >= 0; }).map(function (k) { return eref2('Issue', k); }); return ja({ issue: seite(ii) }); }
        if ((m = pfad.match(/dsiss\/issue\/([^\/]+)$/))) { var io = TEST.iss[m[1]]; if (!io || S.testIssDetailFehler) return nein(new Error('404'));   // S.testIssDetailFehler (Adapter 27): Details nicht lesbar
          var flach = {}; Object.keys(io).forEach(function (k) { if (p.$fields || ['members', 'affectedItems', 'contexts'].indexOf(k) < 0) flach[k] = io[k]; });
          return ja(flach); }
        if (pfad === TSK) { return ja({ success: true, data: Object.keys(TEST.tsk).filter(function (k) { return !(TEST.tsk[k].relateddata.scopes || []).length; }).map(function (k) { return TEST.tsk[k]; }) }); }
        if ((m = pfad.match(/tasks\/scopeId\/([^\/]+)$/))) { return ja({ success: true, data: (TEST.scope[m[1]] || []).map(function (k) { return TEST.tsk[k]; }) }); }
        if ((m = pfad.match(/documents\/parentId\/([^\/]+)$/))) {
          return ja({ success: true, data: (TEST.rel[m[1] + '|' + p.parentRelName] || []).map(function (i) { return TEST.doc[i]; }) });
        }
        if ((m = pfad.match(/documents\/([^\/]+)$/))) { var d = TEST.doc[m[1]]; return d ? ja({ success: true, data: [d] }) : nein(new Error('404')); }
        if ((m = pfad.match(/pno\/person\/([^\/]+)$/))) { var pr = TEST.pers[m[1]]; return pr ? ja(pr) : nein(new Error('404 Person nicht gefunden')); }
        if (pfad === PNO) return ja({ name: 'abauer', preferredcredentials: { role: { name: 'VPLMProjectLeader' }, organization: { name: 'Company Name' }, collabspace: { name: 'Common Space' } },
          collabspaces: [{ name: 'Common Space', couples: [{ role: { name: 'VPLMProjectLeader' }, organization: { name: 'Company Name' } }, { role: { name: 'VPLMCreator' }, organization: { name: 'Company Name' } }] }] });
        nein(new Error('Testmodus kennt diesen Aufruf nicht: ' + pfad));
      }, S.testMs || 15);
    });
  }
  function startTest() {
    baueOberflaeche(document.body);
    S.live = false; S.maxText = '1500'; S.viewerUrl = window.__3deep.basis + 'datenraum3d.html?v=' + DARSTELLUNG;
    q('.td-mo').style.display = ''; q('.td-su').value = 'E-Fahrzeug';
    ladeDarstellung();
    kontexte().then(function (k) { S.ctx = k.bevorzugt; status('Testmodus (nicht im 3DDashboard). „Suchen“ und dann „Laden“ drücken.'); if (!S.ohneLetztes) letztesLaden(); });
  }

  // ---------- Einstieg (vom Lader index.html aufgerufen) ----------
  window.__3deep = { S: S, testGet: testGet, leseBookmark: leseBookmark, dropLesen: dropLesen, basis: '',
    testDaten: function () { if (!TEST) TEST = testDaten(); return TEST; },
    start: function (live, basis) {
      if (S.root) return; this.basis = basis || '';
      try { if (live) startLive(); else startTest(); }
      catch (e) { var z = (window.widget && window.widget.body) || document.body; z.innerHTML = '<p style="padding:10px">3Deep konnte nicht starten: ' + esc(e.message) + '</p>'; }
    } };
})();
