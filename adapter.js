/* 3Deep-Widget, Adapter Version 12.
   Liest einen Bookmark-Ordner samt Produktstruktur über die 3DEXPERIENCE-REST-Schnittstellen (3DSpace)
   und übergibt das Ergebnis im 3Deep-JSON-Format an die Darstellung datenraum3d.html (eingebettet als iframe).
   Im 3DDashboard: Anmeldung des Benutzers über DS/WAFData. Direkt im Browser geöffnet: Testmodus mit Beispieldaten
   im Format der echten Schnittstellen-Antworten. */
(function () {
  'use strict';
  var DARSTELLUNG = '67';   // Version von datenraum3d.html; muss zu <meta name="3deep-darstellung"> dort passen (tests/test-gleichstand.js)
  var BKS = '/resources/v1/modeler/dsbks/dsbks:Bookmark';
  var ENG = '/resources/v1/modeler/dseng/dseng:EngItem';
  var DOC = '/resources/v1/modeler/documents';
  var PNO = '/resources/modeler/pno/person';
  var ISS = '/resources/v1/modeler/dsiss/issue';
  var TSK = '/resources/v1/modeler/tasks';
  var XCAD = '/resources/v1/modeler/dsxcad/', DSDO = '/resources/v1/modeler/dsdo/';
  // bevorzugte abgeleitete Formate (Derived Outputs) für den Download von Bauteilen
  var CADFORMATE = ['STEP', 'STP', '3DXML', 'JT', 'IGES', 'IGS', 'STL', 'CGR', 'PDF'];
  var MAXISSUES = 400, MAXALLE = 3000, FRIST_ALLE = 180;   // Sekunden für die Entwicklerfunktion „Alle Issues“
  var SEITE = 50, PARALLEL = 8, MAXTIEFE = 12;
  // Dokument-Beziehungen eines Objekts: Name der Beziehung -> Art in der Darstellung
  var DOKREL = [{ rel: 'SpecificationDocument', art: 'spec' }, { rel: 'PLMDocConnection', art: 'praes' }, { rel: 'Reference Document', art: 'praes' }];
  var S = { live: false, WAF: null, space: '', tenant: '', ctx: '', root: null, log: [], roh: {}, bereit: false, wartend: null,
    frame: null, viewerUrl: '', max: 1500, laeuft: false, treffer: [], dateien: {}, csrf: '', cad: {}, cadTyp: {}, cadInfo: [] };

  // ---------- kleine Helfer ----------
  function q(sel) { return S.root.querySelector(sel); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function status(t, fehler) { var e = q('.td-st'); if (e) { e.textContent = t; e.style.color = fehler ? '#ff8a8a' : '#c9d4e8'; } }
  function mitglieder(r) {
    if (Array.isArray(r)) return r; if (!r || typeof r !== 'object') return [];
    if (Array.isArray(r.member)) return r.member; if (Array.isArray(r.data)) return r.data; if (Array.isArray(r.issue)) return r.issue;
    var k = Object.keys(r).filter(function (x) { return Array.isArray(r[x]) && ['masks', 'definitions'].indexOf(x) < 0; });
    return k.length === 1 ? r[k[0]] : [];
  }
  function sauber(k, v) { if (k === 'csrf') return '(entfernt)'; if (k === 'ticketURL') return String(v).slice(0, 70) + '… (gekürzt)'; return v; }
  function datum(t) { if (!t) return ''; var d = new Date(t); return isNaN(d) ? String(t) : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
  function pool(liste, n, fn) {
    var i = 0, erg = [];
    function weiter() { if (i >= liste.length) return Promise.resolve(); var k = i++; return fn(liste[k], k).then(function (r) { erg[k] = r; }, function (e) { erg[k] = { fehler: e }; }).then(weiter); }
    var w = []; for (var j = 0; j < Math.min(n, liste.length); j++) w.push(weiter());
    return Promise.all(w).then(function () { return erg; });
  }

  // ---------- Zugriff auf die Plattform ----------
  function muster(pfad) { return pfad.replace(/\/[0-9A-Fa-f]{16,}(?=\/|$)/g, '/{ID}'); }
  function protokoll(pfad, params, ok, antwort, ms) {
    var m = muster(pfad) + (params && params.$mask ? ' [' + params.$mask + ']' : '') + (params && params.$fields ? ' [$fields=' + params.$fields + ']' : '') + (params && params.parentRelName ? ' [' + params.parentRelName + ']' : '');
    S.log.push({ zeit: new Date().toLocaleTimeString('de-DE'), aufruf: m, ok: ok, info: ok ? mitglieder(antwort).length + ' Einträge' : String(antwort), ms: ms });
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
        S.WAF.authenticatedRequest(S.space + pfad + (qs ? '?' + qs : ''), {
          method: methode || 'GET', type: 'json', headers: kopf, timeout: 30000, data: body == null ? undefined : JSON.stringify(body),
          onComplete: function (d) { if (fertig) return; fertig = true; if (typeof d === 'string') { try { d = d ? JSON.parse(d) : {}; } catch (e) { } } ja(d || {}); },
          onFailure: fehler, onPassportError: function (e) { fehler(e || new Error('Anmeldung (3DPassport) fehlgeschlagen')); },
          onTimeout: function () { fehler(new Error('keine Antwort nach 30 s')); }
        });
      } catch (e) { fehler(e); }
    });
  }
  function hole(pfad, params, ohneKontext, methode, kopfPlus, body) {
    var p = {}; Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    if (S.tenant) p.tenant = S.tenant;
    if (S.frist && Date.now() > S.frist) return Promise.reject(new Error('Zeitlimit erreicht'));
    S.aufrufe = (S.aufrufe || 0) + 1;
    var t0 = Date.now(), anfrage = S.live ? liveGet(pfad, p, ohneKontext, methode, kopfPlus, body) : testGet(pfad, p, methode, body);
    return anfrage.then(function (d) { protokoll(pfad, p, true, d, Date.now() - t0); return d; },
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
    return hole('/resources/v1/application/CSRF', {}, true).then(function (r) {
      S.csrf = (r && r.csrf && r.csrf.value) || ''; if (!S.csrf) throw new Error('kein CSRF-Token erhalten'); return S.csrf;
    });
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
  async function download(knotenId, name) {
    var docId = String(knotenId || '').replace(/^o:/, ''), info = S.dateien[docId];
    if (docId && !info && S.cad[docId]) { await cadDownload(docId, name); diagnose(); return; }
    if (!docId || !info) { status('Zu diesem Objekt ist keine Datei bekannt.', true); return; }
    if (!info.n) { status('„' + (name || docId) + '“ enthält keine Datei.', true); return; }
    try {
      status('Fordere Download für „' + (name || docId) + '“ an …');
      var t = await ticket(docId, info.n > 1, String(name || 'Dokument').replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 60) + '.zip');
      var st = q('.td-st'); st.style.color = '#c9d4e8'; st.innerHTML = 'Datei bereit: <a class="td-dl" target="_blank" rel="noopener" style="color:#8ec1ff">' + esc(t.name || 'herunterladen') + '</a> (startet der Download nicht von selbst, hier klicken)';
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
    return gef ? { url: gef.ticketURL, name: gef.filename || gef.fileName || gef.title || '' } : null;
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
    var typ = S.cadTyp[id] || '', wege = [], t = null, quelle = '';
    status('Suche Datei zu „' + (name || id) + '“ …');
    try { await csrf(true); } catch (e) { status('Download fehlgeschlagen: ' + e.message, true); return; }
    var arten = /Product/i.test(typ) ? ['Product', 'Part'] : ['Part', 'Product'];
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
    S.cadInfo.push((name || id) + ' [' + id + ', Typ ' + (typ || '?') + ']: ' + (t ? 'ok über ' + quelle + ', Datei ' + (t.name || '?') : 'keine Datei') + (wege.length ? ' | ' + wege.join(' | ') : ''));
    if (S.cadInfo.length > 30) S.cadInfo.shift();
    if (!t) { status('Zu „' + (name || id) + '“ gibt es keine herunterladbare Datei (weder CAD-Datei wie .CATPart noch abgeleitetes Format wie STEP). Details unter „Diagnose“.', true); return; }
    var st = q('.td-st'); st.style.color = '#c9d4e8';
    st.innerHTML = 'Datei bereit: <a class="td-dl" target="_blank" rel="noopener" style="color:#8ec1ff">' + esc(t.name || 'herunterladen') + '</a> – ' + esc(quelle) + ' (startet der Download nicht von selbst, hier klicken)';
    var a = q('.td-dl'); a.href = t.url; if (t.name) a.setAttribute('download', t.name);
    try { a.click(); } catch (e) { }
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
  function bookmarkInhalt(id) {
    var kopf = null;
    return alleSeiten(BKS + '/' + encodeURIComponent(id), { $mask: 'dsbks:BksMask.Items2' }, function (r) {
      var b = mitglieder(r), bm = b.filter(function (x) { return x.id === id; })[0] || b[0] || {};
      if (!kopf) kopf = bm;
      var it = bm.items; if (Array.isArray(it) && it.length && it[0] && it[0].member) it = it[0];
      return mitglieder(it);
    }).then(function (items) { return { kopf: kopf || {}, items: items }; });
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
  function issueDetail(id) {
    var v = issVar, p = ISSFELDER[v] ? { $fields: ISSFELDER[v] } : {};
    return hole(ISS + '/' + encodeURIComponent(id), p).then(function (r) { return mitglieder(r)[0] || (r && (r.id || r.title) ? r : null); },
      function (e) { if (!/Zeitlimit/.test(e.message) && v < ISSFELDER.length - 1) { if (issVar === v) issVar = v + 1; return issueDetail(id); } throw e; });
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
    return hole(pfad, mit).then(mitglieder, function (e) { if (/Zeitlimit/.test(e.message)) throw e; taskInclude = false; return hole(pfad, p).then(mitglieder); });
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

  // q fehlt: Start beim Bookmark. q.issues = [IDs]: Start bei diesen Issues. q.alleIssues: alle Issues der Plattform.
  async function leseBookmark(bmId, bmTitel, q) {
    var nodes = [], edges = [], gesehen = {}, hinweise = [];
    var types = {
      folder: { color: '#f5b942', size: 3, shape: 'box', label: 'Bookmark-Folder' },
      asm: { color: '#4f8cff', size: 3.36, label: 'Baugruppe' },
      part: { color: '#2fc4ad', size: 1.96, label: 'Einzelteil' },
      issue: { color: '#ff4d6d', size: 2.2, shape: 'torus', label: 'Issue' },
      task: { color: '#f2c400', size: 1.4, shape: 'dodecahedron', label: 'Aufgabe' },
      person: { color: '#5fcf3f', size: 2.2, shape: 'bust', label: 'Person' },
      spec: { color: '#e5534b', size: 1.3, shape: 'book', label: 'Spezifikation' },
      praes: { color: '#f08a3c', size: 0.9, label: 'Attachment' }
    };
    var relTypes = {
      struktur: { label: 'Strukturlink (enthält)', color: '#2f3f5c', directed: false },
      inhalt: { label: 'Enthalten in Bookmark', color: '#b07a10', directed: true },
      betrifft: { label: 'Issue betrifft', color: '#c2255c', directed: true },
      aufgabe: { label: 'Aufgabe für', color: '#b59500', directed: true },
      zuweisung: { label: 'Zugewiesen an', color: '#3a8f2f', directed: true },
      spec: { label: 'Spezifikationslink', color: '#b8403a', directed: true },
      praes: { label: 'Attachment-Link', color: '#c76a1c', directed: true }
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
    var startProdukte = [], ordner = q ? [] : [{ id: bmId, titel: bmTitel, eltern: null }], oi = 0, andere = [];
    while (oi < ordner.length && ordner.length < 200) {
      var o = ordner[oi++];
      status('Lese Bookmark „' + (o.titel || o.id) + '“ …');
      var inh = await bookmarkInhalt(o.id);
      var k = inh.kopf || {};
      nodes.push({ id: 'bm:' + o.id, type: 'folder', name: k.title || k.name || o.titel || 'Bookmark',
        meta: { Titel: k.title || o.titel || '', Beschreibung: k.description || '', Besitzer: k.owner || '', Erstellt: datum(k.created), 'Geändert': datum(k.modified), 'Collaborative Space': k.collabspace || '', 'Objekte im Ordner': String(inh.items.length), ID: o.id } });
      if (o.eltern) edges.push({ from: 'bm:' + o.id, to: 'bm:' + o.eltern, type: 'inhalt' });
      inh.items.forEach(function (it) {
        var ro = (it && it.referencedObject) || it || {}, id = ro.identifier || ro.id, typ = ro.type || it.type || '';
        if (!id) return;
        if (istProdukt(typ)) { startProdukte.push({ id: id, bm: o.id }); if (typ && !S.cadTyp[id]) S.cadTyp[id] = typ; }
        else if (istOrdner(typ)) { if (!ordner.some(function (x) { return x.id === id; })) ordner.push({ id: id, titel: ro.title || it.title || '', eltern: o.id }); }
        else andere.push({ id: id, typ: typ, bm: o.id, titel: ro.title || it.title || ro.name || it.name || '' });
      });
    }

    // 1b. Start bei Issues: Details lesen und die genannten Objekte als Ausgangspunkt nehmen
    var vorIssues = null;
    if (q) {
      status(q.alleIssues ? 'Suche alle Issues …' : 'Lese Issue …');
      var qIds = q.alleIssues ? await issueIds(MAXALLE) : q.issues, qFertig = 0, schon = {};
      vorIssues = {}; S.issueZahl = qIds.length;
      await pool(qIds, PARALLEL, async function (iid) {
        try { var d = await issueDetail(iid); if (d) vorIssues[iid] = d; } catch (e) { }
        qFertig++; if (qFertig % 10 === 0 || qFertig === qIds.length) status('Lese Issues: ' + qFertig + ' von ' + qIds.length + ' …');
      });
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
    // 2. Produktstruktur abwärts, Ebene für Ebene
    var items = {}, anzahl = 0, grenze = false;
    var front = []; startProdukte.forEach(function (p) { if (front.indexOf(p.id) < 0) front.push(p.id); });
    for (var tiefe = 0; front.length && tiefe <= maxTiefe; tiefe++) {
      var frei = S.max - anzahl - nodes.length - andere.length;
      if (front.length > frei) { front = front.slice(0, Math.max(0, frei)); grenze = true; }
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
      if (grenze) break;
    }
    if (grenze || (front.length && maxTiefe === MAXTIEFE)) hinweise.push('Höchstzahl von ' + S.max + ' Objekten erreicht, die Struktur ist unvollständig.');

    // 2b. Spezifikationen und Attachments der Objekte
    var doks = {}, dokKanten = [], dokZahl = 0, dokGrenze = false;
    if (S.mitDok) {
      var ids = Object.keys(items), erledigt = 0, zaehler = {};
      DOKREL.forEach(function (r) { zaehler[r.rel] = { ok: 0, fehler: 0 }; });
      await pool(ids, PARALLEL, async function (id) {
        for (var ri = 0; ri < DOKREL.length; ri++) {
          var r = DOKREL[ri], z = zaehler[r.rel];
          if (z.fehler >= 3 && !z.ok) continue;   // diese Beziehung kennt die Plattform nicht
          var liste;
          try { liste = await dokumenteZu(id, r.rel); z.ok++; } catch (e) { z.fehler++; continue; }
          liste.forEach(function (d) {
            var did = d && (d.id || d.identifier); if (!did) return;
            if (!doks[did]) {
              if (nodes.length + anzahl + andere.length + dokZahl >= S.max) { dokGrenze = true; return; }
              doks[did] = { d: d, art: r.art }; dokZahl++;
            } else if (r.art === 'spec') doks[did].art = 'spec';
            dokKanten.push({ from: 'o:' + did, to: id, type: r.art, meta: { Beziehung: r.rel } });
          });
        }
        erledigt++;
        if (erledigt % 10 === 0 || erledigt === ids.length) status('Lese Spezifikationen und Attachments: ' + erledigt + ' von ' + ids.length + ' Objekten, ' + dokZahl + ' Dokumente …');
      });
      DOKREL.forEach(function (r) { var z = zaehler[r.rel]; if (z.fehler && !z.ok) hinweise.push('Beziehung „' + r.rel + '“ nicht lesbar.'); });
      if (dokGrenze) hinweise.push('Höchstzahl von ' + S.max + ' Objekten erreicht, nicht alle Dokumente gezeigt.');
    }

    // 2c. Issues, Aufgaben und Personen
    var exKnoten = [], exKanten = [], pers = {}, issues = {}, tasks = {};
    if (S.mitIssues || q) {
      var ziel = {};   // Plattform-ID -> Knoten-ID in der Darstellung
      ordner.forEach(function (o) { ziel[o.id] = 'bm:' + o.id; });
      Object.keys(items).forEach(function (id) { ziel[id] = id; });
      Object.keys(doks).forEach(function (id) { ziel[id] = 'o:' + id; });
      andere.forEach(function (a) { if (!ziel[a.id]) ziel[a.id] = 'o:' + a.id; });
      var frei2 = function () { return nodes.length + anzahl + andere.length + dokZahl + exKnoten.length < S.max; }, exGrenze = false;
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
      var IZ = { CREATE: 'To do', DRAFT: 'To do', ASSIGN: 'To do', 'TO DO': 'To do', ACTIVE: 'In Work', 'IN WORK': 'In Work', 'IN PROGRESS': 'In Work', REVIEW: 'Frozen', 'IN APPROVAL': 'Frozen', 'IN REVIEW': 'Frozen', APPROVED: 'Released', CLOSE: 'Released', CLOSED: 'Released', COMPLETE: 'Released', COMPLETED: 'Released', REJECTED: 'Obsolete' };
      var zustand = function (s) { return IZ[String(s || '').toUpperCase().replace(/_/g, ' ')] || s || ''; };
      // Issues: alle sichtbaren Issues lesen und die behalten, die ein geladenes Objekt betreffen
      try {
        if (!q) status('Suche Issues …');
        var iIds = q ? Object.keys(vorIssues) : await issueIds(), iFertig = 0;
        S.issueInfo = { gefunden: iIds.length, gelesen: 0, mitBezug: [], alle: [] };
        await pool(iIds, PARALLEL, async function (iid) {
          var d = null; if (q) d = vorIssues[iid]; else { try { d = await issueDetail(iid); } catch (e) { } }
          iFertig++; if (!q && (iFertig % 10 === 0 || iFertig === iIds.length)) status('Prüfe Issues: ' + iFertig + ' von ' + iIds.length + ' …');
          if (!d) return;
          S.issueInfo.gelesen++;
          var roh = refIds(d.affectedItems).concat(refIds(d.contexts));
          S.issueInfo.alle.push({ t: d.title || d.name || iid, d: d['Creation Date'] || '' });
          if (roh.length || d.affectedItems || d.contexts) {
            S.issueInfo.mitBezug.push({ t: d.title || d.name || iid, d: d['Creation Date'] || '', ids: roh, treffer: roh.filter(function (x) { return ziel[x]; }).length });
            if (!S.roh['Beispiel: Issue mit betroffenen Objekten']) { var bt = JSON.stringify(d, sauber, 1); S.roh['Beispiel: Issue mit betroffenen Objekten'] = bt.length > 5000 ? bt.slice(0, 5000) + '\n… (gekürzt)' : bt; }
          }
          var bez = refIds(d.affectedItems).concat(refIds(d.contexts)).filter(function (x) { return ziel[x]; });
          if (!bez.length) bez = alleIds(d).filter(function (x) { return ziel[x] && x !== iid; });
          if ((!bez.length && !q) || issues[iid]) return;
          if (!frei2()) { exGrenze = true; return; }
          var m = d.members || {}, meta = { Titel: d.title || '', Name: d.name || '', Status: d.state || '', 'Priorität': d.Priority || d.priority || '', Beschreibung: d.description || '', Besitzer: d.owner || '',
            Zugewiesen: (m.assignees || []).join(', '), 'Geplantes Ende': datum(d['Estimated End Date']), 'Tatsächliches Ende': datum(d['Actual End Date']), 'Collaborative Space': d.collabSpace || d.collabspace || '', Typ: d.type || 'Issue', ID: iid };
          Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
          var n = { id: 'i:' + iid, type: 'issue', name: d.title || d.name || ('Issue ' + iid.slice(-6)), meta: meta }; if (d.state) n.state = zustand(d.state);
          issues[iid] = n; exKnoten.push(n); ziel[iid] = n.id;
          var doppelt = {}; bez.forEach(function (x) { if (!doppelt[x]) { doppelt[x] = 1; exKanten.push({ from: n.id, to: ziel[x], type: 'betrifft' }); } });
          (m.assignees || []).forEach(function (a) { var p = person(a); if (p) exKanten.push({ from: n.id, to: p, type: 'zuweisung' }); });
        });
        if (iIds.length >= (q ? MAXALLE : MAXISSUES)) hinweise.push('Nur die ersten ' + iIds.length + ' Issues der Plattform gelesen.');
        // Attachments direkt am Issue
        if (S.mitDok || q) {
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
        }
      } catch (e) { hinweise.push('Issues nicht lesbar (' + e.message + ').'); }
      // Aufgaben: eigene Aufgaben des Benutzers und Aufgaben mit einem geladenen Objekt als Kontext
      var nimmTask = function (t) {
        if (!t) return;
        var tid = t.id || t.identifier, e = t.dataelements || {}, rd = t.relateddata || {}; if (!tid) return;
        var bez = refIds(rd.scopes).concat(refIds(rd.references)).concat(refIds(rd.deliverables)).concat(refIds(rd.contents)).filter(function (x) { return ziel[x]; });
        if (t._scope && ziel[t._scope]) bez.push(t._scope);
        if (!bez.length) return;
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
      try { status('Lese Aufgaben …'); (await taskAufruf(TSK, { showProjectTasks: 'true' })).forEach(nimmTask); } catch (e) { hinweise.push('Eigene Aufgaben nicht lesbar (' + e.message + ').'); }
      var sIds = (q && q.alleIssues ? [] : ordner.map(function (o) { return o.id; }).concat(Object.keys(items))).concat(Object.keys(issues)), sOk = 0, sFehler = 0, sFertig = 0;
      await pool(sIds, PARALLEL, async function (sid) {
        if (sFehler >= 3 && !sOk) return;
        try { var l = await taskAufruf(TSK + '/scopeId/' + encodeURIComponent(sid), {}); sOk++; l.forEach(function (t) { if (t) { t._scope = sid; nimmTask(t); } }); } catch (e) { sFehler++; }
        sFertig++; if (sFertig % 10 === 0 || sFertig === sIds.length) status('Lese Aufgaben: ' + sFertig + ' von ' + sIds.length + ' Objekten, ' + Object.keys(tasks).length + ' Aufgaben …');
      });
      if (sFehler && !sOk) hinweise.push('Aufgaben je Objekt nicht lesbar.');
      if (exGrenze) hinweise.push('Höchstzahl von ' + S.max + ' Objekten erreicht, nicht alle Issues/Aufgaben gezeigt.');
      exKnoten.forEach(function (n) { delete n._k; });
    }

    // 3. übrige Bookmark-Inhalte (Dokumente usw.)
    await pool(andere, PARALLEL, async function (a) {
      if (doks[a.id]) return;
      if (/Document/i.test(a.typ)) { try { a.det = await dokument(a.id); } catch (e) { } }
    });

    // 4. Knoten und Beziehungen
    var verwendet = {}; Object.keys(items).forEach(function (id) { items[id].kinder.forEach(function (c) { verwendet[c.id] = (verwendet[c.id] || 0) + 1; }); });
    var fehlend = 0;
    Object.keys(items).forEach(function (id) {
      var it = items[id], d = it.det || {}, er = d['dseng:EnterpriseReference'] || {};
      if (!it.det) fehlend++;
      var kinder = it.kinder.filter(function (c) { return items[c.id]; });
      var meta = { Titel: d.title || '', Name: d.name || '', Revision: d.revision || '', Reifegrad: d.state || '', Beschreibung: d.description || '', Teilenummer: er.partNumber || '',
        Besitzer: d.owner || '', Organisation: d.organization || '', 'Collaborative Space': d.collabspace || '', Erstellt: datum(d.created), 'Geändert': datum(d.modified), Typ: d.type || 'VPMReference',
        'Direkte Kinder': String(it.kinder.length), Verwendungen: String(verwendet[id] || 0), ID: id };
      Object.keys(meta).forEach(function (k) { if (meta[k] === '') delete meta[k]; });
      var n = { id: id, type: it.kinder.length ? 'asm' : 'part', name: d.title || d.name || ('Objekt ' + id.slice(-6)), meta: meta, dl: true };
      S.cad[id] = 1; if (d.type && (!S.cadTyp[id] || /^VPMReference$/i.test(S.cadTyp[id]))) S.cadTyp[id] = /dsxcad/i.test(S.cadTyp[id] || '') ? S.cadTyp[id] : d.type;
      if (d.state) n.state = ZUSTAND[d.state] || d.state;
      nodes.push(n);
      kinder.forEach(function (c) { var e = { from: c.id, to: id, type: 'struktur' }; if (c.n > 1) { e.label = '×' + c.n; e.meta = { Instanzen: String(c.n) }; } edges.push(e); });
    });
    startProdukte.forEach(function (p) { if (items[p.id] && p.bm) { var key = p.id + '>' + p.bm; if (!gesehen[key]) { gesehen[key] = 1; edges.push({ from: p.id, to: 'bm:' + p.bm, type: 'inhalt' }); } } });
    Object.keys(doks).forEach(function (did) {
      var x = dokMeta(doks[did].d, 'Document', did), n = { id: 'o:' + did, type: doks[did].art, name: x.name, meta: x.meta, dl: true };
      if (x.state) n.state = ZUSTAND[String(x.state).toUpperCase().replace(/ /g, '_')] || x.state;
      gesehen['o:' + did] = 1; nodes.push(n);
    });
    var kg = {}; dokKanten.forEach(function (k) { var s = k.from + '>' + k.to + '>' + k.type; if (doks[k.from.slice(2)] && !kg[s]) { kg[s] = 1; edges.push(k); } });
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
    exKnoten.forEach(function (n) { nodes.push(n); });
    var vorhanden = {}; nodes.forEach(function (n) { vorhanden[n.id] = 1; });
    exKanten.forEach(function (k) { if (vorhanden[k.from] && vorhanden[k.to]) edges.push(k); });
    S.wurzelInfo = (S.wurzeln || []).map(function (id) { var d = (items[id] && items[id].det) || {}; return (d.title || '?') + ' ' + (d.revision || '') + ' [' + id + ']'; });
    if (S.frist && Date.now() > S.frist) { hinweise = hinweise.filter(function (h) { return !/nicht lesbar/.test(h); }); hinweise.push('Zeitlimit von ' + FRIST_ALLE + ' s erreicht, das Ergebnis ist unvollständig.'); }
    if (fehlend) hinweise.push(fehlend + ' Objekte ohne Detaildaten (keine Leserechte oder kein Engineering Item).');
    return { daten: { types: types, relTypes: relTypes, nodes: nodes, edges: edges, maxObjects: Math.max(500, nodes.length) }, hinweise: hinweise };
  }

  // ---------- Darstellung (iframe) ----------
  function sende(nachricht) {
    S.wartend = nachricht;
    if (S.bereit && S.frame && S.frame.contentWindow) { S.frame.contentWindow.postMessage(nachricht, '*'); S.wartend = null; }
  }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.quelle !== '3deep' || !S.frame || e.source !== S.frame.contentWindow) return;
    if (m.download) { download(m.download, m.name); return; }
    if (m.bereit) { S.bereit = true; if (S.wartend) sende(S.wartend); else sende({ quelle: '3deep-adapter', steuerung: 'game' }); }
  });

  // ---------- Bedienung ----------
  async function suchen() {
    if (S.laeuft) return;
    var text = q('.td-su').value.trim(), sel = q('.td-tr'), iss = q('.td-ar').value === 'iss', was = iss ? 'Issue' : 'Bookmark';
    try {
      S.laeuft = true; S.frist = 0; status('Suche ' + was + 's …');
      if (/^[0-9A-Fa-f]{20,}$/.test(text)) S.treffer = [{ id: text, title: 'ID ' + text, art: iss ? 'issue' : 'bm' }];
      else if (iss) {
        var ids = await issueIds(60, text), liste = [];
        await pool(ids, PARALLEL, async function (iid) { try { var d = await issueDetail(iid); if (d) liste.push({ id: iid, art: 'issue', title: (d.name ? d.name + '  ' : '') + (d.title || ''), owner: d.owner || '', d: d['Creation Date'] || '' }); } catch (e) { } });
        S.treffer = liste.sort(function (x, y) { return String(y.d).localeCompare(String(x.d)); });
      } else S.treffer = await sucheBookmarks(text);
      sel.innerHTML = S.treffer.map(function (b, i) { return '<option value="' + i + '">' + esc(b.title || b.name || b.id) + (b.owner ? ' (' + esc(b.owner) + ')' : '') + '</option>'; }).join('');
      sel.style.display = S.treffer.length ? '' : 'none'; q('.td-la').style.display = S.treffer.length ? '' : 'none';
      status(S.treffer.length ? S.treffer.length + ' ' + was + '(s) gefunden' + (iss && S.treffer.length >= 60 ? ' (nur die ersten 60, Suchtext eingrenzen)' : '') + '. Auswählen und „Laden“ drücken.' : 'Kein ' + was + ' gefunden.', !S.treffer.length);
    } catch (e) { status('Suche fehlgeschlagen: ' + e.message, true); } finally { S.laeuft = false; diagnose(); }
  }
  async function laden(sonder) {
    if (S.laeuft) return;
    var b = sonder ? { title: 'Alle Issues' } : S.treffer[+q('.td-tr').value]; if (!b) return;
    try {
      S.laeuft = true; S.max = Math.max(10, parseInt(S.maxText, 10) || 1500); S.mitDok = q('.td-dk').checked; S.mitIssues = q('.td-ia').checked;
      S.aufrufe = 0; S.frist = 0;
      var t0 = Date.now(), erg;
      if (sonder && sonder.alleIssues) { S.frist = t0 + FRIST_ALLE * 1000; S.max = Math.max(S.max, 5000); erg = await leseBookmark(null, null, { alleIssues: true, struktur: false }); }
      else if (b.art === 'issue') erg = await leseBookmark(null, null, { issues: [b.id], struktur: q('.td-sk').checked });
      else erg = await leseBookmark(b.id, b.title || b.name || '');
      S.frist = 0;
      sende({ quelle: '3deep-adapter', daten: erg.daten, name: b.title || 'Daten', steuerung: 'game' });
      status(erg.daten.nodes.length + ' Objekte, ' + erg.daten.edges.length + ' Beziehungen aus „' + (b.title || b.id) + '“ in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + S.aufrufe + ' Abfragen.' + (erg.hinweise.length ? ' Hinweis: ' + erg.hinweise.join(' ') : ''), erg.hinweise.length > 0);
    } catch (e) { status('Laden fehlgeschlagen: ' + e.message + ' (Details unter „Diagnose“)', true); } finally { S.laeuft = false; S.frist = 0; diagnose(); }
  }
  function diagnoseText() {
    var z = ['3Deep-Widget Diagnose (Adapter 12, Darstellung ' + DARSTELLUNG + '), ' + new Date().toLocaleString('de-DE'), 'Modus: ' + (S.live ? 'live im 3DDashboard' : 'Testmodus (Beispieldaten)'),
      '3DSpace: ' + (S.space || '-') + (S.spaceQuelle ? ' (' + S.spaceQuelle + ')' : ''), 'Rahmen: ' + window.location.href.replace(/token=[^&]*/, 'token=…').slice(0, 300), 'Tenant: ' + (S.tenant || '-'), 'Security Context: ' + (S.ctx || '-'), 'Darstellung: ' + S.viewerUrl + (S.bereit ? ' (bereit)' : ' (noch nicht gemeldet)'), ''];
    if (S.wurzelInfo) { z.push('', 'Produkte im Bookmark:'); S.wurzelInfo.forEach(function (w) { z.push('  ' + w); }); }
    if (S.issueInfo) {
      var ii = S.issueInfo, nachDatum = function (a, b) { return String(b.d).localeCompare(String(a.d)); };
      z.push('', 'Issue-Abruf mit $fields=' + (ISSFELDER[issVar] || '(ohne)'), 'Issues: ' + ii.gefunden + ' gefunden, ' + ii.gelesen + ' gelesen, ' + ii.mitBezug.length + ' mit betroffenen Objekten');
      z.push('Neueste Issues:'); ii.alle.slice().sort(nachDatum).slice(0, 8).forEach(function (x) { z.push('  ' + x.d + '  ' + x.t); });
      z.push('Issues mit betroffenen Objekten (neueste zuerst, höchstens 40):');
      ii.mitBezug.slice().sort(nachDatum).slice(0, 40).forEach(function (x) { z.push('  ' + x.d + '  ' + x.t + '  -> ' + (x.ids.join(', ') || '(keine ID erkannt)') + '  Treffer im Bookmark: ' + x.treffer); });
    }
    if (S.cadInfo.length) { z.push('', 'Downloads von Bauteilen/Baugruppen:'); S.cadInfo.forEach(function (c) { z.push('  ' + c); }); }
    z.push('', '=== Ab hier nur bei Bedarf: alle Aufrufe ===', 'Aufrufe:');
    S.log.forEach(function (l) { z.push(l.zeit + '  ' + (l.ok ? 'ok    ' : 'FEHLER') + '  ' + l.aufruf + '  ' + l.info + '  ' + l.ms + ' ms'); });
    z.push('', 'Erste Antwort je Aufrufart (gekürzt):');
    Object.keys(S.roh).sort(function (x, y) { return (/Beispiel|dsiss/.test(y) ? 1 : 0) - (/Beispiel|dsiss/.test(x) ? 1 : 0); }).forEach(function (k) { z.push('--- ' + k, S.roh[k]); });
    return z.join('\n');
  }
  function diagnose() { var d = q('.td-dx'); if (d && d.style.display !== 'none') d.value = diagnoseText(); }

  function baueOberflaeche(root) {
    S.root = root;
    var knopf = 'background:#2b3d63;color:#e8eefc;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit';
    var feld = 'background:#0d1526;color:#e8eefc;border:1px solid #3a4a68;border-radius:6px;padding:5px 8px;font:inherit';
    root.innerHTML =
      '<div class="td-w" style="position:fixed;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;background:#0b1220;color:#e8eefc;font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif">' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;background:#121c30;border-bottom:1px solid #26344f">' +
      '<b style="margin-right:4px">3Deep</b>' +
      '<select class="td-ar" title="Womit beginnen?" style="' + feld + '"><option value="bm">Bookmark</option><option value="iss">Issue</option></select>' +
      '<input class="td-su" type="text" placeholder="Bookmark-Name oder ID" style="' + feld + ';width:190px" />' +
      '<button class="td-sb" style="' + knopf + '">Suchen</button>' +
      '<select class="td-tr" style="' + feld + ';max-width:260px;display:none"></select>' +
      '<button class="td-la" style="' + knopf + ';background:#2563d6;display:none">Laden</button>' +
      '<label title="Spezifikationen und Attachments der Objekte mitlesen" style="display:flex;align-items:center;gap:4px"><input class="td-dk" type="checkbox" checked="checked" />Dokumente</label>' +
      '<label title="Issues, Aufgaben und Personen zu den Objekten mitlesen" style="display:flex;align-items:center;gap:4px"><input class="td-ia" type="checkbox" checked="checked" />Issues/Aufgaben</label>' +
      '<label class="td-skl" title="Produktstruktur der betroffenen Objekte abwärts mitlesen" style="display:none;align-items:center;gap:4px"><input class="td-sk" type="checkbox" />Struktur</label>' +
      '<button class="td-ai" title="Entwicklerfunktion (Performancetest): alle Issues der Plattform mit ihren Objekten, Zeitlimit ' + FRIST_ALLE + ' s" style="' + knopf + ';background:#5a3d10">Alle Issues</button>' +
      '<select class="td-cx" title="Security Context" style="' + feld + ';max-width:240px;display:none"></select>' +
      '<input class="td-ci" type="text" placeholder="Security Context: Rolle.Organisation.Collaborative Space" title="Security Context von Hand" style="' + feld + ';width:330px;display:none" />' +
      '<button class="td-db" style="' + knopf + '">Diagnose</button>' +
      '<span class="td-mo" style="padding:2px 8px;border-radius:10px;background:#5a4410;color:#ffd98a;display:none">Testmodus: Beispieldaten</span>' +
      '<span class="td-st" style="flex:1;min-width:200px;color:#c9d4e8">Starte …</span></div>' +
      '<div class="td-dp" style="display:none;padding:6px 8px;background:#121c30;border-bottom:1px solid #26344f">' +
      '<div style="margin-bottom:4px">Protokoll aller Abfragen. Zum Weitergeben: „Kopieren“ drücken, vorher Vertrauliches prüfen. <button class="td-dc" style="' + knopf + '">Kopieren</button></div>' +
      '<textarea class="td-dx" readonly="readonly" style="' + feld + ';width:100%;height:180px;box-sizing:border-box;font:12px monospace;display:none"></textarea></div>' +
      '<iframe class="td-fr" title="3Deep Darstellung" allow="fullscreen" style="flex:1;width:100%;border:0;background:#0b1220"></iframe></div>';
    q('.td-sb').onclick = suchen; q('.td-la').onclick = function () { laden(); };
    q('.td-ai').onclick = function () { laden({ alleIssues: true }); };
    q('.td-ar').onchange = function (e) {
      var iss = e.target.value === 'iss';
      q('.td-su').placeholder = iss ? 'Issue-Titel, Name oder ID (leer = alle)' : 'Bookmark-Name oder ID';
      q('.td-skl').style.display = iss ? 'flex' : 'none'; S.treffer = []; q('.td-tr').style.display = 'none'; q('.td-la').style.display = 'none';
    };
    q('.td-su').addEventListener('keydown', function (e) { if (e.key === 'Enter') suchen(); });
    q('.td-db').onclick = function () { var p = q('.td-dp'), d = q('.td-dx'), auf = p.style.display === 'none'; p.style.display = auf ? '' : 'none'; d.style.display = auf ? '' : 'none'; diagnose(); };
    q('.td-dc').onclick = function () { var d = q('.td-dx'); d.value = diagnoseText(); d.select(); try { document.execCommand('copy'); } catch (e) { } if (navigator.clipboard) navigator.clipboard.writeText(d.value).catch(function () { }); };
    q('.td-cx').onchange = function (e) { S.ctx = e.target.value; };
    q('.td-ci').onchange = function (e) { S.ctx = e.target.value.trim(); try { localStorage.setItem('3deep_ctx', S.ctx); } catch (x) { } if (S.ctx) status('Security Context gesetzt. Bookmark-Namen eingeben und „Suchen“ drücken.'); };
    S.frame = q('.td-fr');
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
        if (fest) { S.ctx = fest; status('Bereit. Bookmark-Namen eingeben und „Suchen“ drücken.'); return; }
        kontexte().then(function (k) {
          var sel = q('.td-cx'); S.ctx = k.bevorzugt;
          sel.innerHTML = k.liste.map(function (c) { return '<option' + (c === k.bevorzugt ? ' selected="selected"' : '') + '>' + esc(c) + '</option>'; }).join('');
          if (k.liste.length > 1) sel.style.display = '';
          if (!S.ctx) ctxVonHand('Kein Security Context gefunden.'); else status('Bereit. Bookmark-Namen eingeben und „Suchen“ drücken.');
        }, function (e) { ctxVonHand('Security Context nicht ermittelbar (' + e.message + ').'); }).then(diagnose);
      }
      function ctxVonHand(grund) {
        var f = q('.td-ci'), alt = ''; try { alt = localStorage.getItem('3deep_ctx') || ''; } catch (x) { }
        f.style.display = ''; f.value = alt; S.ctx = alt;
        status(alt ? 'Bereit (Security Context aus der letzten Sitzung). Bookmark-Namen eingeben und „Suchen“ drücken.' : grund + ' Bitte oben im Feld „Security Context“ eintragen (Rolle.Organisation.Collaborative Space), dann suchen.', !alt);
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
    T.iss = {}; T.tsk = {}; T.scope = {};
    function eref(typ, i) { return { source: '$3DSpace', type: typ, identifier: i, relativePath: '/…/' + i }; }
    function issue(titel, state, betrifft, wer) { var i = id(); T.iss[i] = { id: i, type: 'Issue', name: 'ISS-' + n, title: titel, description: 'Beispiel-Issue', state: state, owner: 'abauer', organization: 'Company Name', collabSpace: 'Common Space', Priority: 'High', 'Estimated End Date': '2026-12-01T00:00:00Z',
      members: { coowners: [], assignees: wer, contributors: [] }, affectedItems: [{ elements: betrifft.map(function (b) { return eref('VPMReference', b); }) }], contexts: [] }; return i; }
    function aufgabe(titel, state, scope, wer, refs) { var i = id(); T.tsk[i] = { id: i, type: 'Task', identifier: i, dataelements: { title: titel, state: state, description: 'Beispielaufgabe', dueDate: '2026-11-30T00:00:00Z', percentComplete: '40', originated: '2026-10-01T08:00:00Z' },
      relateddata: { assignees: wer.map(function (w) { return { id: id(), type: 'Person', dataelements: { name: w[0], fullname: w[1], email: w[0] + '@example.com' } }; }), scopes: scope ? [{ id: scope, type: 'x', identifier: scope }] : [], references: (refs || []).map(function (r) { return { id: r, identifier: r }; }), deliverables: [] } };
      if (scope) (T.scope[scope] = T.scope[scope] || []).push(i); return i; }
    var is1 = issue('Sensor liefert bei Kälte falsche Werte', 'In Work', [sensor, le], ['cmeier']);
    haenge(is1, 'Reference Document', dok('Foto Fehlerbild', 'Fehlerbild.png'));
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
    return T;
  }
  function eref2(typ, i) { return { source: '$3DSpace', type: typ, identifier: i, relativePath: '/…/' + i }; }
  function testGet(pfad, p, methode, body) {
    if (!TEST) TEST = testDaten();
    return new Promise(function (ja, nein) {
      setTimeout(function () {
        var skip = +p.$skip || 0, anz = +p.$top || 50, m;
        function seite(a) { return a.slice(skip, skip + anz); }
        if (pfad === BKS + '/search') {
          var s = String(p.$searchStr || '*').toLowerCase().replace(/\*/g, '');
          var alle = Object.keys(TEST.bm).map(function (k) { var b = TEST.bm[k]; return { id: b.id, title: b.title, description: b.description, owner: b.owner, type: b.type }; }).filter(function (b) { return !s || b.title.toLowerCase().indexOf(s) >= 0; });
          return ja({ totalItems: alle.length, member: seite(alle) });
        }
        if ((m = pfad.match(/dsbks:Bookmark\/([^\/]+)$/))) {
          var b = TEST.bm[m[1]]; if (!b) return nein(new Error('404 Bookmark nicht gefunden'));
          var kopie = {}; Object.keys(b).forEach(function (k) { kopie[k] = b[k]; }); kopie.items = { totalItems: b.items.length, member: seite(b.items) };
          return ja({ totalItems: 1, member: [kopie] });
        }
        if ((m = pfad.match(/dseng:EngItem\/([^\/]+)\/dseng:EngInstance$/))) { var kk = TEST.kids[m[1]] || []; return ja({ totalItems: kk.length, member: seite(kk) }); }
        if ((m = pfad.match(/dseng:EngItem\/([^\/]+)$/))) { var it = TEST.it[m[1]]; return it ? ja({ totalItems: 1, member: [it] }) : nein(new Error('404 Objekt nicht gefunden')); }
        if (pfad === '/resources/v1/application/CSRF') return ja({ success: true, csrf: { name: 'ENO_CSRF_TOKEN', value: 'TEST-TOKEN' } });
        if ((m = pfad.match(/dsxcad:(Part|Product)\/([^\/]+)\/dsxcad:AuthoringFile\/DownloadTicket$/))) {
          if (methode !== 'POST') return nein(new Error('405'));
          var v = TEST.v5[m[2]];
          if (!v || v.typ !== 'dsxcad:' + m[1]) return nein(new Error('404 kein ' + m[1] + ' im xCAD-Modell'));
          return ja({ ticketURL: 'data:text/plain;charset=utf-8,' + encodeURIComponent('Beispiel-CAD-Datei aus dem 3Deep-Testmodus: ' + v.datei), ticket: 'T', filename: v.datei + '.txt' });
        }
        if (pfad === DSDO + 'dsdo:DerivedOutputs/Locate') {
          if (methode !== 'POST') return nein(new Error('405'));
          var rid = (((body || {}).referencedObject || [])[0] || {}).identifier, dn = TEST.dout[rid];
          return ja({ totalItems: dn ? 1 : 0, member: dn ? [{ id: 'D0' + rid.slice(-8), referencedObject: eref2('VPMReference', rid), derivedoutputfiles: [{ id: 'F1', filename: dn + '.cgr', format: 'CGR' }, { id: 'F2', filename: dn + '.stp', format: 'STEP' }] }] : [] });
        }
        if ((m = pfad.match(/dsdo:DerivedOutputs\/([^\/]+)\/dsdo:DerivedOutputFiles\/([^\/]+)\/DownloadTicket$/))) {
          if (methode !== 'POST') return nein(new Error('405'));
          var fname = m[2] === 'F2' ? 'Kuehlkoerper.stp' : 'Kuehlkoerper.cgr';
          return ja({ success: true, statusCode: 200, data: { doid: m[1], dataelements: { ticketURL: 'data:text/plain;charset=utf-8,' + encodeURIComponent('Beispiel-Derived-Output: ' + fname), ticket: 'T', filename: fname + '.txt' } } });
        }
        if ((m = pfad.match(/documents\/([^\/]+)\/files\/DownloadTicket$/))) {
          if (methode !== 'PUT') return nein(new Error('405'));
          var dd = TEST.doc[m[1]], fn = (((dd || {}).relateddata || {}).files || [{}])[0].dataelements; fn = (fn && fn.title) || 'Beispiel.txt';
          return ja({ success: true, data: [{ id: m[1], dataelements: { ticketURL: 'data:text/plain;charset=utf-8,' + encodeURIComponent('Beispieldatei aus dem 3Deep-Testmodus: ' + fn), fileName: fn + '.txt' } }] });
        }
        if (pfad === ISS + '/search') { var st = String(p.$searchStr || '*').toLowerCase().replace(/\*/g, ''); var ii = Object.keys(TEST.iss).filter(function (k) { return !st || (TEST.iss[k].title + ' ' + TEST.iss[k].name).toLowerCase().indexOf(st) >= 0; }).map(function (k) { return eref2('Issue', k); }); return ja({ issue: seite(ii) }); }
        if ((m = pfad.match(/dsiss\/issue\/([^\/]+)$/))) { var io = TEST.iss[m[1]]; if (!io) return nein(new Error('404'));
          var flach = {}; Object.keys(io).forEach(function (k) { if (p.$fields || ['members', 'affectedItems', 'contexts'].indexOf(k) < 0) flach[k] = io[k]; });
          return ja(flach); }
        if (pfad === TSK) { return ja({ success: true, data: Object.keys(TEST.tsk).filter(function (k) { return !(TEST.tsk[k].relateddata.scopes || []).length; }).map(function (k) { return TEST.tsk[k]; }) }); }
        if ((m = pfad.match(/tasks\/scopeId\/([^\/]+)$/))) { return ja({ success: true, data: (TEST.scope[m[1]] || []).map(function (k) { return TEST.tsk[k]; }) }); }
        if ((m = pfad.match(/documents\/parentId\/([^\/]+)$/))) {
          return ja({ success: true, data: (TEST.rel[m[1] + '|' + p.parentRelName] || []).map(function (i) { return TEST.doc[i]; }) });
        }
        if ((m = pfad.match(/documents\/([^\/]+)$/))) { var d = TEST.doc[m[1]]; return d ? ja({ success: true, data: [d] }) : nein(new Error('404')); }
        if (pfad === PNO) return ja({ name: 'abauer', preferredcredentials: { role: { name: 'VPLMProjectLeader' }, organization: { name: 'Company Name' }, collabspace: { name: 'Common Space' } },
          collabspaces: [{ name: 'Common Space', couples: [{ role: { name: 'VPLMProjectLeader' }, organization: { name: 'Company Name' } }, { role: { name: 'VPLMCreator' }, organization: { name: 'Company Name' } }] }] });
        nein(new Error('Testmodus kennt diesen Aufruf nicht: ' + pfad));
      }, 15);
    });
  }
  function startTest() {
    baueOberflaeche(document.body);
    S.live = false; S.maxText = '1500'; S.viewerUrl = window.__3deep.basis + 'datenraum3d.html?v=' + DARSTELLUNG;
    q('.td-mo').style.display = ''; q('.td-su').value = 'E-Fahrzeug';
    ladeDarstellung();
    kontexte().then(function (k) { S.ctx = k.bevorzugt; status('Testmodus (nicht im 3DDashboard). „Suchen“ und dann „Laden“ drücken.'); });
  }

  // ---------- Einstieg (vom Lader index.html aufgerufen) ----------
  window.__3deep = { S: S, testGet: testGet, leseBookmark: leseBookmark, basis: '',
    start: function (live, basis) {
      if (S.root) return; this.basis = basis || '';
      try { if (live) startLive(); else startTest(); }
      catch (e) { var z = (window.widget && window.widget.body) || document.body; z.innerHTML = '<p style="padding:10px">3Deep konnte nicht starten: ' + esc(e.message) + '</p>'; }
    } };
})();
