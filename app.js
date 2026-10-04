/* Viabilità Mugello: mappa di lavori, chiusure, cantieri, sfalci, deviazioni, incidenti.
   Le geometrie seguono le strade di OpenStreetMap: i tratti disegnati vengono agganciati
   alla strada reale col calcolo del percorso (OSRM, lo stesso usato da openstreetmap.org). */

const TIPI = {
  interruzione:      { nome: 'Strada chiusa',            colore: '#d0312d', sim: '⛔' },
  'senso-alternato': { nome: 'Senso unico alternato',    colore: '#e8590c', sim: '🚦' },
  lavori:            { nome: 'Lavori stradali',          colore: '#f08c00', sim: '🚧' },
  cantiere:          { nome: 'Cantiere e occupazione',   colore: '#9c6644', sim: '🏗️' },
  sfalcio:           { nome: 'Sfalcio e verde',          colore: '#2f9e44', sim: '🌿' },
  deviazione:        { nome: 'Deviazione',               colore: '#1c7ed6', sim: '↪️' },
  incidente:         { nome: 'Incidente',                colore: '#c2255c', sim: '🚨' },
  frana:             { nome: 'Frana e dissesto',         colore: '#7048e8', sim: '⛰️' },
  evento:            { nome: 'Manifestazione e mercato', colore: '#0c8599', sim: '🎪' },
  divieto:           { nome: 'Divieti e limitazioni',    colore: '#495057', sim: '🚫' },
  traffico:          { nome: 'Code e rallentamenti',     colore: '#ae3ec9', sim: '🚗' },
};
// tipi di strada (classificazione del grafo della Città Metropolitana): colori dei cartelli stradali
const TIPI_STRADA = {
  autostrada:  { nome: 'Autostrade', colore: '#2f9e44', peso: 5 },
  statale:     { nome: 'Statali', colore: '#1d3fa8', peso: 4.5 },
  regionale:   { nome: 'Regionali', colore: '#4c6ef5', peso: 4.5 },
  provinciale: { nome: 'Provinciali', colore: '#15aabf', peso: 3.5 },
};
const COMUNI = ['Barberino di Mugello', 'Borgo San Lorenzo', 'Dicomano', 'Firenzuola', 'Londa', 'Marradi',
  'Palazzuolo sul Senio', 'Pelago', 'Pontassieve', 'Rufina', 'San Godenzo', 'Scarperia e San Piero', 'Vaglia', 'Vicchio'];
const OSRM = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const ZOOM_PRECISO = 15;
// versione pubblica (generata da tools/pubblica.py): solo fonti ripubblicabili, niente satellite Esri né telecamere
const PUBBLICO = !!window.PUBBLICO;
const CENTRO = [43.975, 11.45];

const S = {
  eventi: [], aggiornato: null, sola: false,
  oggi: oggiISO(), quando: 'attivi', pDal: oggiISO(), pAl: '', tipi: new Set(), comune: '', strada: '', raggruppa: 'stato', q: '',
  scelto: null, bozza: null, disegno: null, coda: [], comuniGeo: null, stradeGeo: null,
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- date ---------- */
function oggiISO() { const d = new Date(); return iso(d); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daISO(s) { const [y, m, g] = s.split('-').map(Number); return new Date(y, m - 1, g); }
function piuGiorni(s, n) { const d = daISO(s); d.setDate(d.getDate() + n); return iso(d); }
// il giorno della settimana lo calcola il calendario, mai scritto a mano
function dataLunga(s, anno) {
  const o = { weekday: 'long', day: 'numeric', month: 'long' };
  if (anno) o.year = 'numeric';
  return daISO(s).toLocaleDateString('it-IT', o);
}
function dataBreve(s) { return daISO(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); }
function periodo(ev) {
  const anno = (s) => s.slice(0, 4) !== S.oggi.slice(0, 4);
  if (ev.dal && ev.al && ev.dal === ev.al) return `solo ${dataLunga(ev.dal, anno(ev.dal))}`;
  if (ev.dal && ev.al) return `da ${dataLunga(ev.dal, anno(ev.dal))} a ${dataLunga(ev.al, anno(ev.al))}`;
  if (ev.dal) return `da ${dataLunga(ev.dal, anno(ev.dal))}, fine non indicata`;
  if (ev.al) return `fino a ${dataLunga(ev.al, anno(ev.al))}`;
  return 'date non indicate';
}

/* ---------- stato rispetto al giorno scelto ---------- */
// giorno a cui si riferisce la vista: Domani = domani, Date = primo giorno scelto, altrimenti oggi
function giornoRif() { const r = intervallo(); return r ? r[0] : S.oggi; }
// con "7 giorni" e "Date" un evento che comincia dentro il periodo va mostrato pieno, non sbiadito
function arrivaNelPeriodo(ev) { return (S.quando === 'settimana' || S.quando === 'periodo') && stato(ev) === 'programmato'; }
function stato(ev, g = giornoRif()) {
  if (ev.risolto) return 'concluso';
  if (ev.al && ev.al < g) return 'concluso';
  if (ev.dal && ev.dal > g) return 'programmato';
  return 'in-corso';
}
function etichettaStato(ev) {
  const st = stato(ev);
  if (st === 'in-corso') return ev.al ? `In corso, fino al ${dataBreve(ev.al)}` : 'In corso';
  if (st === 'programmato') return arrivaNelPeriodo(ev) ? `Comincia ${dataLunga(ev.dal)}` : `Dal ${dataBreve(ev.dal)}`;
  return ev.risolto ? 'Risolto' : 'Concluso';
}
// 'SP 117', 'SR 302', 'A1'... dal campo sigla o dal testo della strada; altrimenti il nome della via
function chiaveStrada(ev) {
  const t = ev.sigla || ev.strada || '';
  const m = t.match(/\b(S\.?\s?[PRS]\.?|SGC)\s?(\d{1,3})\s?(bis|ter|dir)?\b/i);
  if (m) return `${m[1].replace(/[\s.]/g, '').toUpperCase()} ${m[2]}${(m[3] || '').toUpperCase()}`;
  if (/\bA\s?1\b/.test(t)) return /variante/i.test(t) ? 'A1 Variante' : 'A1';
  return (ev.strada || '').trim() || 'Senza strada';
}
function ordineStrada(k) {
  const m = k.match(/^(A|SS|SR|SP|SGC)\s?(\d+)/);
  return m ? `${'0A1SS2SR3SP4SG'.indexOf(m[1]) + 10}${m[2].padStart(4, '0')}` : `9${k}`;
}
function intervallo() {
  const o = S.oggi;
  if (S.quando === 'oggi') return [o, o];
  if (S.quando === 'domani') return [piuGiorni(o, 1), piuGiorni(o, 1)];
  if (S.quando === 'settimana') return [o, piuGiorni(o, 6)];  // oggi più i 6 giorni dopo = 7 giorni
  if (S.quando === 'periodo') return [S.pDal || o, S.pAl || S.pDal || o];
  return null;
}
function visibile(ev, senza = '') {
  const st = stato(ev);
  const r = intervallo();
  if (r) {
    if ((ev.dal || '0000') > r[1] || (ev.al || '9999') < r[0]) return false;
    if (S.quando !== 'periodo' && ev.risolto) return false;
  }
  if (S.quando === 'attivi' && st === 'concluso') return false;
  if (S.quando === 'conclusi' && st !== 'concluso') return false;
  if (senza !== 'tipo' && S.tipi.size && !S.tipi.has(ev.tipo)) return false;
  if (senza !== 'comune' && S.comune && ev.comune !== S.comune) return false;
  if (senza !== 'strada' && S.strada && chiaveStrada(ev) !== S.strada) return false;
  if (S.q) {
    const t = [ev.titolo, ev.comune, ev.strada, ev.localita, ev.descrizione, ev.deviazione].join(' ').toLowerCase();
    if (!S.q.toLowerCase().split(/\s+/).every((p) => t.includes(p))) return false;
  }
  return true;
}
function ordina(a, b) {
  const peso = { 'in-corso': 0, programmato: 1, concluso: 2 };
  const sa = stato(a), sb = stato(b);
  if (sa !== sb) return peso[sa] - peso[sb];
  if (sa === 'concluso') return (b.al || '').localeCompare(a.al || '');
  return (a.dal || '').localeCompare(b.dal || '') || a.titolo.localeCompare(b.titolo);
}

/* ---------- mappa ---------- */
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, className: 'base-tenue', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});
const esriAttr = 'Immagini © Esri, Maxar, Earthstar Geographics';
const satellite = L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: esriAttr }),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18 }),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18 }),
]);
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17, attribution: '© OpenStreetMap, SRTM | stile © <a href="https://opentopomap.org">OpenTopoMap</a>',
});
const mappa = L.map('mappa', { zoomControl: true, layers: [osm] }).setView(CENTRO, 11);
mappa.createPane('confini').style.zIndex = 330;
mappa.getPane('confini').style.pointerEvents = 'none';
mappa.createPane('strade').style.zIndex = 350;
// nomi delle località sopra ai tratti: chi apre la mappa capisce subito dove si trova
mappa.createPane('nomi').style.zIndex = 640;
mappa.getPane('nomi').style.pointerEvents = 'none';
const livConfini = L.layerGroup();
const livStrade = L.layerGroup();
const livCamere = L.layerGroup();
const sentieri = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
  maxZoom: 18, opacity: 0.85, attribution: 'Sentieri: <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA)',
});
L.control.layers(PUBBLICO ? { 'Stradale (OpenStreetMap)': osm, 'Topografica': topo }
  : { 'Stradale (OpenStreetMap)': osm, 'Satellite con strade e nomi': satellite, 'Topografica': topo },
  PUBBLICO ? { 'Confini comunali': livConfini, 'Tipi di strada a colori': livStrade, 'Sentieri escursionistici': sentieri }
  : { 'Confini comunali': livConfini, 'Tipi di strada a colori': livStrade, 'Sentieri escursionistici': sentieri, 'Telecamere': livCamere },
  { position: 'topright' }).addTo(mappa);
livConfini.addTo(mappa);
const livEvidenza = L.layerGroup().addTo(mappa);
const livNomi = L.layerGroup().addTo(mappa);
mappa.on('zoomend', zoomNomi);
mappa.on('overlayadd overlayremove', () => legenda());
mappa.on('overlayadd', (e) => { if (e.layer === livCamere) caricaTelecamere(); });
L.control.scale({ imperial: false }).addTo(mappa);
const livEventi = L.layerGroup().addTo(mappa);
const livBozza = L.layerGroup().addTo(mappa);
const livDisegno = L.layerGroup().addTo(mappa);
const livLuogo = L.layerGroup().addTo(mappa);

function ll(c) { return [c[1], c[0]]; }
function puntoRappresentativo(ev) {
  const p = ev.elementi.find((e) => e.geom.type === 'Point');
  if (p) return ll(p.geom.coordinates);
  const el = ev.elementi.find((e) => e.ruolo !== 'deviazione') || ev.elementi[0];
  const g = el.geom;
  let cs = g.type === 'LineString' ? g.coordinates
    : g.type === 'MultiLineString' ? g.coordinates.flat()
    : g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  if (g.type === 'Polygon') { const n = cs.length; return [cs.reduce((s, c) => s + c[1], 0) / n, cs.reduce((s, c) => s + c[0], 0) / n]; }
  return ll(cs[Math.floor(cs.length / 2)]);
}
function iconaPin(ev, extra = '') {
  const t = TIPI[ev.tipo] || TIPI.lavori;
  const st = stato(ev);
  const col = st === 'concluso' ? '#868e96' : t.colore;
  const arriva = arrivaNelPeriodo(ev);
  return L.divIcon({ className: `pin ${arriva ? 'arriva' : st} ${extra}`, iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<span style="background:${col}">${t.sim}</span>${arriva ? `<em>dal ${dataBreve(ev.dal)}</em>` : ''}` });
}
function disegnaEvento(ev, gruppo, interattivo = true) {
  const t = TIPI[ev.tipo] || TIPI.lavori;
  const st = stato(ev);
  const op = st === 'programmato' && !arrivaNelPeriodo(ev) ? 0.5 : st === 'concluso' ? 0.45 : 1;
  const col = st === 'concluso' ? '#868e96' : t.colore;
  const strati = [];
  for (const el of ev.elementi) {
    const g = el.geom;
    if (g.type === 'Point') continue;
    if (el.ruolo === 'deviazione') {
      strati.push(L.geoJSON(g, { style: { color: '#fff', weight: 9, opacity: 0.9 * op } }));
      strati.push(L.geoJSON(g, { style: { color: '#1c7ed6', weight: 5, opacity: op, dashArray: '10 9', lineCap: 'butt' } }));
    } else if (g.type.includes('Polygon')) {
      strati.push(L.geoJSON(g, { style: { color: col, weight: 3, opacity: op, fillColor: col, fillOpacity: 0.22 * op } }));
    } else if (ev.precisione === 'approssimata') {
      // posizione indicativa (ordinanze "in tratti saltuari" su strade intere): linea sottile a puntini, non copre la mappa
      strati.push(L.geoJSON(g, { style: { color: '#fff', weight: 8, opacity: 0.35 * op } }));
      strati.push(L.geoJSON(g, { style: { color: col, weight: 5.5, opacity: 0.95 * op, dashArray: '2 8', lineCap: 'round' } }));
    } else {
      // bordo scuro: il tratto resta leggibile anche sopra le strade arancioni di OSM e sul satellite
      strati.push(L.geoJSON(g, { style: { color: '#1f2a44', weight: 11, opacity: 0.75 * op } }));
      strati.push(L.geoJSON(g, { style: { color: col, weight: 6, opacity: op } }));
      if (ev.tipo === 'interruzione' && g.type === 'LineString') {
        for (const c of [g.coordinates[0], g.coordinates[g.coordinates.length - 1]]) {
          strati.push(L.marker(ll(c), { interactive: false, icon: L.divIcon({ className: 'capo', html: '⛔', iconSize: [18, 18] }) }));
        }
      }
    }
  }
  const pin = L.marker(puntoRappresentativo(ev), { icon: iconaPin(ev, S.scelto === ev.id ? 'scelto' : ''), riseOnHover: true, zIndexOffset: st === 'in-corso' ? 500 : 0 });
  strati.push(pin);
  for (const s of strati) {
    if (interattivo) {
      s.on?.('click', () => { if (!S.disegno) apriScheda(ev.id); });
      s.bindTooltip?.(`${t.sim} ${esc(ev.titolo)}`, { sticky: true, direction: 'top' });
    }
    gruppo.addLayer(s);
  }
}
function bordi(ev) {
  const g = L.featureGroup();
  for (const el of ev.elementi) g.addLayer(L.geoJSON(el.geom));
  return g.getBounds();
}

/* ---------- confini, tipi di strada, telecamere ---------- */
async function caricaGeo() {
  try {
    S.comuniGeo = await (await fetch('data/comuni.geojson')).json();
    livConfini.addLayer(L.geoJSON(S.comuniGeo, { pane: 'confini', interactive: false,
      style: { color: '#1f2a44', weight: 1.5, opacity: 0.55, dashArray: '5 5', fill: false } }));
  } catch { /* senza confini l'app funziona lo stesso */ }
  try {
    S.stradeGeo = await (await fetch('data/strade.geojson')).json();
    livStrade.addLayer(L.geoJSON(S.stradeGeo, { pane: 'strade',
      style: (f) => { const t = TIPI_STRADA[f.properties.t] || TIPI_STRADA.provinciale; return { color: t.colore, weight: t.peso, opacity: 0.85 }; },
      onEachFeature: (f, l) => l.on('click', (e) => {
        if (S.disegno) return;
        const k = f.properties.s;
        const n = S.eventi.filter((ev) => chiaveStrada(ev) === k && stato(ev) !== 'concluso').length;
        L.popup().setLatLng(e.latlng).setContent(`<b>${esc(k)}</b><br>${esc(f.properties.n)}<br><small>${esc(TIPI_STRADA[f.properties.t]?.nome || '')}</small><br>
          ${n ? `${n} ${n === 1 ? 'evento attivo' : 'eventi attivi'}` : 'Nessun evento attivo'}<br><button type="button" class="link" data-filtra-strada="${esc(k)}">Mostra solo questa strada</button>`).openOn(mappa);
      }),
    }));
  } catch { /* idem */ }
  try {
    // località da OpenStreetMap: capoluoghi sempre, paesi da zoom 11, frazioni da zoom 13
    const d = await (await fetch('data/localita.json')).json();
    const capo = new Set([...COMUNI, 'Scarperia', 'San Piero a Sieve']);
    for (const p of d.luoghi) {
      const lv = capo.has(p.n) ? 1 : (p.t === 'hamlet' ? 3 : 2);
      L.marker([p.lat, p.lon], { pane: 'nomi', interactive: false, keyboard: false,
        icon: L.divIcon({ className: `loc lv${lv}`, html: `<span>${esc(p.n)}</span>`, iconSize: [0, 0] }) }).addTo(livNomi);
    }
  } catch { /* senza nomi l'app funziona lo stesso */ }
}
function zoomNomi() {
  const c = mappa.getContainer(), z = mappa.getZoom();
  c.classList.toggle('nomi-paesi', z >= 11);
  c.classList.toggle('nomi-frazioni', z >= 13);
}
function stradaGeo(k) {
  if (!S.stradeGeo) return null;
  const alt = k.replace(/^SR /, 'SS ').replace(/^SS /, k.startsWith('SS') ? 'SR ' : 'SS ');
  return S.stradeGeo.features.find((f) => f.properties.s === k) || S.stradeGeo.features.find((f) => f.properties.s === alt);
}
function evidenzia(zoom = false) {
  livEvidenza.clearLayers();
  let b = null;
  if (S.comune && S.comuniGeo) {
    const f = S.comuniGeo.features.find((x) => x.properties.nome === S.comune);
    if (f) { const l = L.geoJSON(f, { pane: 'confini', interactive: false, style: { color: '#1f2a44', weight: 3.5, opacity: 0.9, fillColor: '#4c6ef5', fillOpacity: 0.06 } }); livEvidenza.addLayer(l); b = l.getBounds(); }
  }
  if (S.strada) {
    const f = stradaGeo(S.strada);
    if (f) { const l = L.geoJSON(f, { pane: 'strade', interactive: false, style: { color: '#ffd43b', weight: 12, opacity: 0.55 } }); livEvidenza.addLayer(l); b = l.getBounds(); }
  }
  if (zoom && b && b.isValid()) mappa.fitBounds(b, { padding: [30, 30] });
}
async function caricaTelecamere() {
  try {
    const d = await (await fetch('api/telecamere', { cache: 'no-store' })).json();
    livCamere.clearLayers();
    for (const c of d.telecamere) {
      const img = c.immagini?.length ? c.immagini[c.immagini.length - 1] : null;
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'cam', html: '<span>📷</span>', iconSize: [24, 24] }) })
        .bindPopup(`<div class="cam-pop"><b>${esc(c.nome)}</b><br><small>${esc(c.comune)} · ${esc(c.fonte)}${c.ora ? ` · ${esc(c.ora)}` : ''}</small>
          ${img ? `<a href="${esc(img)}" target="_blank" rel="noopener"><img src="${esc(img)}" alt="Immagine della telecamera" loading="lazy"></a>` : '<p>Nessuna immagine recente.</p>'}
          ${c.video ? `<a href="${esc(c.video)}" target="_blank" rel="noopener">Guarda il video</a>` : ''}</div>`, { maxWidth: 320 })
        .addTo(livCamere);
    }
  } catch { avviso('Telecamere non disponibili'); }
}
function legenda() {
  let h = `<b>Eventi</b><span class="lg pieno"></span> tratto interessato <span class="lg puntini"></span> ${PUBBLICO ? 'posizione indicativa (cantieri che si spostano lungo la strada)' : 'evento da verificare (posizione approssimata)'} <span class="lg tratteggio"></span> deviazione ${S.quando === 'settimana' || S.quando === 'periodo' ? '<span class="lg-data">dal 5 ott</span> comincia nel periodo' : S.quando === 'attivi' ? '<span class="lg sbiadito"></span> non ancora iniziato' : ''}`;
  if (mappa.hasLayer(livStrade)) h += `<b>Tipi di strada</b>` + Object.values(TIPI_STRADA).map((t) => `<span class="lg strada" style="border-top-color:${t.colore}"></span> ${t.nome}`).join(' ') + ` <span class="lg strada" style="border-top-color:#ccc"></span> comunali e locali (mappa di base)`;
  if (mappa.hasLayer(sentieri)) h += `<b>Sentieri</b><span class="lg sentiero"></span> sentieri segnati (CAI e reti escursionistiche)`;
  if (mappa.hasLayer(osm)) h += `<b>Mappa di base</b><span class="lg bianca"></span> strade bianche e sterrate`;
  if (mappa.hasLayer(livConfini)) h += ` <span class="lg confine"></span> confini comunali`;
  $('#legenda').innerHTML = h;
}

/* ---------- caricamento ---------- */
async function carica() {
  try {
    if (PUBBLICO) throw new Error();
    const r = await fetch('api/eventi', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const d = await r.json();
    S.eventi = d.eventi; S.aggiornato = d.aggiornato;
  } catch {
    // versione pubblica statica: solo lettura
    const r = await fetch('data/eventi.json', { cache: 'no-store' });
    const d = await r.json();
    S.eventi = d.eventi; S.aggiornato = d.aggiornato; S.sola = true;
    document.body.classList.add('sola-lettura');
  }
  S.oggi = oggiISO();
  disegnaTutto();
  if (!S.sola) caricaCodaFonti();
}
async function caricaCodaFonti() {
  try {
    S.coda = (await (await fetch('api/coda', { cache: 'no-store' })).json()).voci.filter((v) => v.stato === 'da_mappare');
    $('#b-coda').hidden = !S.coda.length;
    $('#n-coda').textContent = S.coda.length;
    const f = await (await fetch('api/fonti', { cache: 'no-store' })).json();
    const nomi = { autostrade: 'Autostrade', cm: 'Città Metropolitana', telecamere: 'Telecamere', cciss: 'CCISS', 'cm-notizie': 'Comunicati Città Metropolitana' };
    $('#fonti').innerHTML = 'Aggiornamenti automatici: ' + Object.entries(nomi).filter(([k]) => f[k]).map(([k, n]) =>
      `${n} ${f[k].ok ? '✓' : '⚠️'} ${new Date(f[k].ora).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`).join(' · ');
  } catch { /* server vecchio o non raggiungibile */ }
}
function finestraCoda() {
  const righe = S.coda.map((v) => `<div class="voce-coda"><b>${esc(v.strada || '')}${v.comune ? ` · ${esc(v.comune)}` : ''}</b>
    <small> · ${esc(v.fonte || '')}, ${esc(v.atto || '')}</small>
    <p>${esc(v.testo)}</p><p><small>${v.dal ? `Dal ${dataBreve(v.dal)}` : ''}${v.al ? ` al ${dataBreve(v.al)}` : ''} · Non mappata in automatico: ${esc(v.motivo || '')}</small></p>
    ${v.note ? `<p class="info">${esc(v.note)}</p>` : ''}
    <div class="bottoni"><button type="button" class="btn blu" data-mappa="${esc(v.id)}">Mettila sulla mappa</button>
    ${v.url ? `<a class="btn" style="text-decoration:none" href="${esc(v.url)}" target="_blank" rel="noopener">Fonte</a>` : ''}
    <button type="button" class="btn rosso" data-scarta="${esc(v.id)}">Non serve</button></div></div>`).join('');
  apriFinestra(`Da mappare (${S.coda.length})`, `<p style="margin:0 0 10px;font-size:.9rem;color:#5c6577">Ordinanze trovate in automatico che non indicano i km: le metto io sulla mappa ogni mattina, oppure puoi farlo tu.</p>${righe}`);
  $('#finestra-corpo').onclick = async (e) => {
    const m = e.target.closest('[data-mappa]')?.dataset.mappa;
    const sc = e.target.closest('[data-scarta]')?.dataset.scarta;
    if (m) {
      const v = S.coda.find((x) => x.id === m);
      $('#finestra').close();
      apriEditor({ ...nuovoEvento(), id: v.id, tipo: TIPI[v.tipo] ? v.tipo : 'lavori', titolo: `${v.strada || ''}: ${(TIPI[v.tipo] || TIPI.lavori).nome.toLowerCase()}`,
        comune: v.comune || '', strada: v.strada || '', sigla: v.strada || '', dal: v.dal || S.oggi, al: v.al || '', descrizione: v.testo,
        fonte: { ente: v.fonte || '', atto: v.atto || '', url: v.url || '', data: '' } });
    }
    if (sc && confirm('Togliere questa ordinanza dalla coda?')) {
      await fetch(`api/coda/${encodeURIComponent(sc)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stato: 'scartato' }) });
      await caricaCodaFonti(); $('#finestra').close(); if (S.coda.length) finestraCoda();
    }
  };
}

function disegnaTutto() {
  const vis = S.eventi.filter((e) => visibile(e)).sort(ordina);
  // mappa: l'evento aperto resta visibile anche se i filtri lo nascondono
  livEventi.clearLayers();
  const daMostrare = new Set(vis.map((e) => e.id));
  if (S.scelto) daMostrare.add(S.scelto);
  for (const ev of S.eventi) if (daMostrare.has(ev.id) && !(S.bozza && S.bozza.id === ev.id)) disegnaEvento(ev, livEventi);
  // tipi, con il conteggio degli eventi che resterebbero scegliendoli
  $('#tipi').innerHTML = Object.entries(TIPI).map(([k, t]) => {
    const n = S.eventi.filter((e) => e.tipo === k && visibile(e, 'tipo')).length;
    return `<button type="button" class="chip ${S.tipi.has(k) ? 'on' : ''}" data-tipo="${k}"><span class="pallino" style="background:${t.colore}"></span>${t.nome}${n ? ` <b>${n}</b>` : ''}</button>`;
  }).join('');
  // Comune: tutti i 14, con il numero di eventi
  const nCom = (c) => S.eventi.filter((e) => e.comune === c && visibile(e, 'comune')).length;
  $('#f-comune').innerHTML = `<option value="">Tutto il territorio</option>` + COMUNI.map((c) => `<option value="${esc(c)}" ${S.comune === c ? 'selected' : ''}>${esc(c)}${nCom(c) ? ` (${nCom(c)})` : ''}</option>`).join('');
  $('#f-comune').classList.toggle('attiva', !!S.comune);
  // Strada: quelle con eventi, più quella scelta
  const strade = new Map();
  for (const e of S.eventi) if (visibile(e, 'strada')) { const k = chiaveStrada(e); strade.set(k, (strade.get(k) || 0) + 1); }
  if (S.strada && !strade.has(S.strada)) strade.set(S.strada, 0);
  $('#f-strada').innerHTML = `<option value="">Tutte le strade</option>` + [...strade.entries()].sort((a, b) => ordineStrada(a[0]).localeCompare(ordineStrada(b[0])))
    .map(([k, n]) => `<option value="${esc(k)}" ${S.strada === k ? 'selected' : ''}>${esc(k)} (${n})</option>`).join('');
  $('#f-strada').classList.toggle('attiva', !!S.strada);
  document.querySelectorAll('#quando button').forEach((b) => b.classList.toggle('on', b.dataset.q === S.quando));
  $('#periodo').hidden = S.quando !== 'periodo';
  $('#p-dal').value = S.pDal; $('#p-al').value = S.pAl;
  $('#raggruppa').value = S.raggruppa;
  evidenzia();
  legenda();
  // elenco raggruppato
  const r = intervallo();
  const nomeQuando = { oggi: 'oggi', domani: 'domani', settimana: r ? `da oggi a ${dataLunga(r[1])}` : '', attivi: 'in corso e in arrivo', conclusi: 'conclusi',
    periodo: r ? `dal ${dataBreve(r[0])} al ${dataBreve(r[1])}` : '' }[S.quando];
  const nArriva = vis.filter(arrivaNelPeriodo).length;
  $('#conteggio').textContent = `${vis.length} ${vis.length === 1 ? 'evento' : 'eventi'} ${nomeQuando}`
    + (nArriva ? `: ${vis.length - nArriva} già in corso, ${nArriva} ${nArriva === 1 ? 'comincia' : 'cominciano'} nel periodo` : '');
  if (!vis.length) {
    $('#lista').innerHTML = `<p class="vuoto">${S.eventi.length ? 'Nessun evento con questi filtri.' : 'Ancora nessun evento. Mandami ordinanze e comunicati in chat e li metto sulla mappa.'}</p>`;
    return;
  }
  const finestra = S.quando === 'settimana' || S.quando === 'periodo';
  const chiave = { stato: (e) => ({ 'in-corso': finestra && S.quando === 'periodo' ? `1In corso il ${dataBreve(r[0])}` : '1In corso', programmato: finestra ? '2Cominciano nel periodo' : '2In arrivo', concluso: '3Conclusi' }[stato(e)]),
    strada: (e) => ordineStrada(chiaveStrada(e)) + '|' + chiaveStrada(e), comune: (e) => e.comune || 'Fuori territorio',
    tipo: (e) => String(Object.keys(TIPI).indexOf(e.tipo)).padStart(2, '0') + (TIPI[e.tipo]?.nome || e.tipo) }[S.raggruppa];
  const gruppi = new Map();
  for (const e of vis) { const k = chiave(e); if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(e); }
  const nomeGruppo = (k) => S.raggruppa === 'strada' ? k.split('|')[1] : S.raggruppa === 'comune' ? k : k.slice(S.raggruppa === 'tipo' ? 2 : 1);
  $('#lista').innerHTML = [...gruppi.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, es]) => {
    const nome = nomeGruppo(k);
    const filtro = S.raggruppa === 'strada' ? `data-filtra-strada="${esc(nome)}"` : S.raggruppa === 'comune' ? `data-filtra-comune="${esc(nome)}"` : '';
    return `<div class="gruppo"><span>${esc(nome)}</span><small>${es.length}${filtro ? ` · <button type="button" class="link" ${filtro}>solo questa</button>` : ''}</small></div><ol>${es.map(voce).join('')}</ol>`;
  }).join('');
}
function nomeFonte(ev) {
  return { 'autostrade-eventi': 'Autostrade, in tempo reale', 'autostrade-cantieri': 'Autostrade', 'cm-firenze': 'Città Metropolitana' }[ev.auto] || 'automatico';
}
function voce(ev) {
  const t = TIPI[ev.tipo] || TIPI.lavori;
  const st = stato(ev);
  const dove = [ev.comune, ev.strada || ev.localita].filter(Boolean).join(' · ');
  const quando = [periodo(ev), ev.orario].filter(Boolean).join(', ');
  return `<li class="voce ${st}" data-id="${esc(ev.id)}">
    <span class="simbolo" style="background:${st === 'concluso' ? '#868e96' : t.colore}">${t.sim}</span>
    <div><h3>${esc(ev.titolo)}</h3><p>${esc(dove)}</p><p>${esc(quando)}</p><span class="stato ${st}">${esc(etichettaStato(ev))}</span>${ev.auto && !ev.bloccato ? `<span class="auto">${esc(nomeFonte(ev))}</span>` : ''}${ev.precisione === 'approssimata' ? `<span class="auto" style="background:#fff3bf;color:#8a6d00">${PUBBLICO ? 'posizione indicativa' : 'da verificare'}</span>` : ''}</div></li>`;
}

/* ---------- scheda ---------- */
function mostraPannello(n) {
  for (const p of ['lista', 'scheda', 'editor']) $(`#pannello-${p}`).hidden = p !== n;
  $('#side').scrollTop = 0;
}
function apriScheda(id, zoom = true) {
  const ev = S.eventi.find((e) => e.id === id);
  if (!ev) return;
  S.scelto = id;
  history.replaceState(null, '', `#e=${encodeURIComponent(id)}`);
  const t = TIPI[ev.tipo] || TIPI.lavori;
  const st = stato(ev);
  const f = ev.fonte || {};
  const fonte = [f.ente, f.atto, f.data ? `del ${dataLunga(f.data, true)}` : ''].filter(Boolean).join(', ');
  const righe = [
    ['Comune', ev.comune], ['Strada', ev.strada], ['Dove', ev.localita],
    ['Quando', periodo(ev)], ['Orario', ev.orario], ['Giorni', ev.giorni],
    ['Regolazione', ev.regolazione], ['Deviazione', ev.deviazione], ['Dettagli', ev.descrizione],
  ].filter(([, v]) => v);
  const c = puntoRappresentativo(ev);
  $('#pannello-scheda').innerHTML = `
    <button type="button" class="indietro" data-az="chiudi">← Elenco</button>
    <div class="testa-scheda"><span class="simbolo" style="background:${st === 'concluso' ? '#868e96' : t.colore}">${t.sim}</span>
      <div><small>${t.nome}</small><span class="stato ${st}">${esc(etichettaStato(ev))}</span></div></div>
    <h1>${esc(ev.titolo)}</h1>
    ${ev.precisione === 'approssimata' ? `<p class="attenzione">Posizione approssimata${ev.nota_posizione ? `: ${esc(ev.nota_posizione)}` : ': la fonte non indica il punto esatto.'}</p>` : ev.nota_posizione ? `<p class="info">${esc(ev.nota_posizione)}</p>` : ''}
    ${ev.auto && !ev.bloccato ? `<p class="info">Inserito in automatico (${esc(nomeFonte(ev))}). Se lo modifichi, da quel momento resta come lo hai lasciato.</p>` : ''}
    ${ev.nota_fine ? `<p class="info">${esc(ev.nota_fine)}</p>` : ''}
    <dl class="campi">${righe.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}
      <dt>Fonte</dt><dd>${fonte ? esc(fonte) : '<em>non indicata</em>'}${f.url ? `<br><a href="${esc(f.url)}" target="_blank" rel="noopener">Apri l'atto originale</a>` : ''}</dd>
      <dt>Aggiornato</dt><dd>${ev.aggiornato ? new Date(ev.aggiornato).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '-'}</dd>
    </dl>
    <div class="bottoni">
      <button type="button" class="btn" data-az="zoom">Mostra sulla mappa</button>
      <button type="button" class="btn" data-az="testo">Copia testo</button>
      <button type="button" class="btn" data-az="link">Copia link</button>
      <a class="btn" href="https://www.openstreetmap.org/#map=18/${c[0].toFixed(5)}/${c[1].toFixed(5)}" target="_blank" rel="noopener" style="text-decoration:none">Apri su OSM</a>
    </div>
    <div class="bottoni solo-editor">
      <button type="button" class="btn blu" data-az="modifica">Modifica</button>
      <button type="button" class="btn" data-az="duplica">Duplica</button>
      <button type="button" class="btn rosso" data-az="cestina">Sposta nel cestino</button>
    </div>`;
  mostraPannello('scheda');
  disegnaTutto();
  if (zoom) mostraSuMappa(ev);
}
function mostraSuMappa(ev) {
  vista('mappa', true);
  const b = bordi(ev);
  if (b.isValid()) mappa.fitBounds(b, { padding: [50, 50], maxZoom: 17 });
}
function chiudiScheda() {
  S.scelto = null;
  history.replaceState(null, '', location.pathname);
  mostraPannello('lista');
  disegnaTutto();
}

/* testo pronto per il bollettino radio: frasi semplici, niente trattini lunghi */
function frase(ev) {
  const f = ev.fonte || {};
  const dove = [ev.strada, ev.localita].filter(Boolean).join(', ');
  let s = `${dove || ev.titolo}: ${(ev.regolazione || TIPI[ev.tipo]?.nome || '').toLowerCase()}`;
  const st = stato(ev);
  if (st === 'programmato') s += ev.al && ev.al !== ev.dal ? `, da ${dataLunga(ev.dal)} a ${dataLunga(ev.al)}` : `, ${dataLunga(ev.dal)}`;
  else if (ev.al) s += ev.al === S.oggi ? ', fino a oggi' : `, fino a ${dataLunga(ev.al)}`;
  if (ev.orario) s += `, orario ${ev.orario}`;
  if (ev.giorni) s += ` (${ev.giorni})`;
  s += '.';
  if (ev.deviazione) s += ` Deviazione: ${ev.deviazione.replace(/\.$/, '')}.`;
  const fonteTxt = [f.ente, f.atto].filter(Boolean).join(', ');
  if (fonteTxt) s += ` (${fonteTxt})`;
  return s.replace(/\s+/g, ' ');
}

/* ---------- bollettino ---------- */
function bollettino() {
  const g = (S.quando === 'oggi' || S.quando === 'domani' || S.quando === 'periodo') ? intervallo()[0] : S.oggi;
  const filtri = (e) => (!S.tipi.size || S.tipi.has(e.tipo)) && (!S.comune || e.comune === S.comune) && (!S.strada || chiaveStrada(e) === S.strada);
  const attivi = S.eventi.filter((e) => stato(e, g) === 'in-corso' && filtri(e));
  const arrivo = S.eventi.filter((e) => stato(e, g) === 'programmato' && e.dal <= piuGiorni(g, 7) && filtri(e));
  const perComune = (lista) => {
    const m = new Map();
    for (const e of lista.sort(ordina)) { const c = e.comune || 'Altre zone'; if (!m.has(c)) m.set(c, []); m.get(c).push(e); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, es]) => `${c.toUpperCase()}\n${es.map((e) => `• ${frase(e)}`).join('\n')}`).join('\n\n');
  };
  let txt = `VIABILITÀ IN MUGELLO E VAL DI SIEVE\nSituazione di ${dataLunga(g, true)}\n\n`;
  txt += attivi.length ? perComune(attivi) : 'Nessuna limitazione in corso tra quelle segnalate.';
  if (arrivo.length) txt += `\n\nIN ARRIVO NEI PROSSIMI 7 GIORNI\n\n${perComune(arrivo)}`;
  apriFinestra('Bollettino viabilità', `<p style="margin:0 0 10px;font-size:.9rem;color:#5c6577">Testo pronto da leggere in radio o da incollare sul sito. Rispetta i filtri attivi (tipo e comune) e il giorno scelto.</p>
    <textarea id="testo-bollettino">${esc(txt)}</textarea>
    <div class="bottoni"><button type="button" class="btn giallo" id="copia-bollettino">Copia testo</button></div>`);
  $('#copia-bollettino').onclick = () => copia($('#testo-bollettino').value, 'Bollettino copiato');
}

/* ---------- cestino ---------- */
async function cestino() {
  const d = await (await fetch('api/cestino', { cache: 'no-store' })).json();
  const righe = d.eventi.slice().reverse().map((e) => `<div class="riga-cestino"><span><b>${esc(e.titolo)}</b><br><small>${esc(e.comune || '')} · tolto il ${new Date(e.cestinato).toLocaleDateString('it-IT')}</small></span>
    <button type="button" class="btn" data-ripristina="${esc(e.id)}">Ripristina</button></div>`).join('');
  apriFinestra('Cestino', righe || '<p class="vuoto">Il cestino è vuoto.</p>');
  document.querySelectorAll('[data-ripristina]').forEach((b) => b.onclick = async () => {
    const r = await fetch(`api/ripristina/${encodeURIComponent(b.dataset.ripristina)}`, { method: 'POST' });
    if (r.ok) { avviso('Evento ripristinato'); $('#finestra').close(); await carica(); }
  });
}

/* ---------- editor ---------- */
function nuovoEvento() {
  return { tipo: 'lavori', titolo: '', comune: '', strada: '', localita: '', dal: S.oggi, al: '', orario: '', giorni: '',
    regolazione: '', deviazione: '', descrizione: '', fonte: { ente: '', atto: '', url: '', data: '' }, precisione: 'esatta', nota_posizione: '', risolto: false, elementi: [] };
}
function apriEditor(ev) {
  S.bozza = JSON.parse(JSON.stringify(ev));
  S.bozza.fonte = S.bozza.fonte || {};
  const b = S.bozza;
  const sel = (v, opz) => opz.map(([k, n]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${n}</option>`).join('');
  const campo = (id, label, v, extra = '') => `<div class="campo"><label for="f-${id}">${label}</label><input id="f-${id}" name="${id}" value="${esc(v)}" ${extra}></div>`;
  const area = (id, label, v, ph = '') => `<div class="campo"><label for="f-${id}">${label}</label><textarea id="f-${id}" name="${id}" placeholder="${ph}">${esc(v)}</textarea></div>`;
  $('#pannello-editor').innerHTML = `
    <button type="button" class="indietro" data-az="annulla">← Annulla</button>
    <h1>${b.id ? 'Modifica evento' : 'Nuovo evento'}</h1>
    <div class="campo"><label for="f-tipo">Tipo</label><select id="f-tipo" name="tipo">${sel(b.tipo, Object.entries(TIPI).map(([k, t]) => [k, `${t.sim} ${t.nome}`]))}</select></div>
    ${campo('titolo', 'Titolo', b.titolo, 'required placeholder="Es. SR 302 chiusa a Ronta"')}
    <div class="campo"><label for="f-comune">Comune</label><input id="f-comune" name="comune" list="lista-comuni" value="${esc(b.comune)}"><datalist id="lista-comuni">${COMUNI.map((c) => `<option value="${c}">`).join('')}</datalist></div>
    ${campo('strada', 'Strada', b.strada, 'placeholder="Es. SR 302 Brisighellese-Ravennate (Via Faentina)"')}
    ${campo('localita', 'Località e tratto', b.localita, 'placeholder="Es. a Ronta, dal km 35+200 al km 35+800"')}
    <div class="due">${campo('dal', 'Dal', b.dal, 'type="date"')}${campo('al', 'Al', b.al, 'type="date"')}</div>
    <div class="due">${campo('orario', 'Orario', b.orario, 'placeholder="8:30-17:30 o h24"')}${campo('giorni', 'Giorni', b.giorni, 'placeholder="Es. solo feriali"')}</div>
    ${campo('regolazione', 'Regolazione', b.regolazione, 'placeholder="Es. chiusura totale, eccetto residenti"')}
    ${area('deviazione', 'Deviazione', b.deviazione, 'Percorso alternativo indicato dalla fonte')}
    ${area('descrizione', 'Dettagli', b.descrizione)}
    <label class="spunta"><input type="checkbox" name="risolto" ${b.risolto ? 'checked' : ''}> Risolto o concluso prima del previsto</label>
    <fieldset><legend>Posizione sulla mappa</legend>
      <div class="strumenti">
        <button type="button" class="btn" data-dis="strada">〰️ Tratto su strada</button>
        <button type="button" class="btn" data-dis="deviazione">↪️ Percorso deviazione</button>
        <button type="button" class="btn" data-dis="punto">📍 Punto</button>
        <button type="button" class="btn" data-dis="area">⬠ Area</button>
        <button type="button" class="btn" data-dis="linea">✏️ Linea libera</button>
      </div>
      <ul class="elementi" id="elementi"></ul>
      <div class="campo" style="margin-top:10px"><label for="f-precisione">Precisione</label><select id="f-precisione" name="precisione">${sel(b.precisione, [['esatta', 'Esatta: la fonte indica il punto'], ['approssimata', 'Approssimata: la fonte è generica']])}</select></div>
      ${campo('nota_posizione', 'Nota sulla posizione', b.nota_posizione, 'placeholder="Es. l\'ordinanza indica solo il nome della via"')}
    </fieldset>
    <fieldset><legend>Fonte</legend>
      ${campo('fonte.ente', 'Ente', b.fonte.ente, 'placeholder="Es. Comune di Borgo San Lorenzo"')}
      <div class="due">${campo('fonte.atto', 'Atto', b.fonte.atto, 'placeholder="Ordinanza n. 123/2026"')}${campo('fonte.data', 'Data atto', b.fonte.data, 'type="date"')}</div>
      ${campo('fonte.url', 'Link', b.fonte.url, 'type="url" placeholder="https://"')}
    </fieldset>
    <div class="bottoni"><button type="submit" class="btn giallo">Salva</button><button type="button" class="btn" data-az="annulla">Annulla</button></div>`;
  mostraPannello('editor');
  disegnaElementi();
  disegnaTutto();
  if (b.elementi.length) mostraSuMappa(b);
}
function leggiForm() {
  const f = $('#pannello-editor');
  const b = S.bozza;
  for (const el of f.elements) {
    if (!el.name) continue;
    const v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (el.name.startsWith('fonte.')) b.fonte[el.name.slice(6)] = v; else b[el.name] = v;
  }
  return b;
}
const NOMI_EL = { tratto: 'Tratto interessato', deviazione: 'Percorso deviazione', punto: 'Punto', area: 'Area' };
function lunghezza(g) {
  const linee = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  let m = 0;
  for (const l of linee) for (let i = 1; i < l.length; i++) m += mappa.distance(ll(l[i - 1]), ll(l[i]));
  return m;
}
function disegnaElementi() {
  const b = S.bozza;
  $('#elementi').innerHTML = b.elementi.length ? b.elementi.map((el, i) => {
    const m = lunghezza(el.geom);
    const misura = m ? ` · ${m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m'}` : '';
    return `<li><span>${NOMI_EL[el.ruolo] || el.ruolo}${misura}</span><button type="button" data-togli="${i}">Togli</button></li>`;
  }).join('') : '<li>Nessuna posizione: usa i pulsanti qui sopra e tocca la mappa.</li>';
  livBozza.clearLayers();
  if (b.elementi.length) disegnaEvento(leggiForm(), livBozza, false);
}
async function salva(e) {
  e.preventDefault();
  const b = leggiForm();
  if (!b.elementi.length) return avviso('Manca la posizione sulla mappa');
  const r = await fetch('api/eventi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const d = await r.json();
  if (!r.ok) return avviso(d.errore || 'Errore nel salvataggio');
  esciDisegno();
  S.bozza = null; livBozza.clearLayers();
  await carica();
  apriScheda(d.id);
  avviso('Salvato');
}

/* ---------- disegno sulla mappa (stile editor di OpenStreetMap) ---------- */
const ISTRUZIONI = {
  strada: 'Tocca la strada nel punto di inizio e in quello di fine del tratto: la linea segue la strada vera. Se prende un\'altra strada aggiungi un punto intermedio.',
  deviazione: 'Tocca i punti del percorso alternativo, dall\'inizio alla fine: la linea segue le strade.',
  punto: 'Tocca la mappa nel punto esatto.',
  area: 'Tocca gli angoli dell\'area (almeno 3).',
  linea: 'Tocca i punti della linea, che resta dritta tra un punto e l\'altro.',
};
function iniziaDisegno(modo) {
  leggiForm();
  S.disegno = { modo, punti: [], geom: null };
  $('#disegno').hidden = false;
  $('#mappa-wrap').classList.add('disegnando');
  vista('mappa', true);
  aggiornaDisegno();
}
function esciDisegno() {
  S.disegno = null;
  livDisegno.clearLayers();
  $('#disegno').hidden = true;
  $('#mappa-wrap').classList.remove('disegnando');
}
function aggiornaDisegno(msg) {
  const d = S.disegno;
  if (!d) return;
  const zoomBasso = mappa.getZoom() < ZOOM_PRECISO && d.modo !== 'area';
  $('#disegno-testo').innerHTML = esc(msg || (zoomBasso ? 'Avvicinati con lo zoom fino a vedere bene la strada: i punti si mettono solo da vicino, per essere precisi.' : ISTRUZIONI[d.modo]));
  $('#d-indietro').disabled = !d.punti.length;
  const minimo = d.modo === 'punto' ? 1 : d.modo === 'area' ? 3 : 2;
  $('#d-fatto').disabled = d.punti.length < minimo || ((d.modo === 'strada' || d.modo === 'deviazione') && !d.geom);
  livDisegno.clearLayers();
  for (const p of d.punti) livDisegno.addLayer(L.circleMarker(p, { radius: 6, color: '#1f2a44', weight: 3, fillColor: '#fff', fillOpacity: 1 }));
  const colore = d.modo === 'deviazione' ? '#1c7ed6' : '#f08c00';
  if ((d.modo === 'strada' || d.modo === 'deviazione') && d.geom) {
    livDisegno.addLayer(L.geoJSON(d.geom, { style: { color: d.modo === 'deviazione' ? '#fff' : '#1f2a44', weight: 11, opacity: 0.8 } }));
    livDisegno.addLayer(L.geoJSON(d.geom, { style: { color: colore, weight: 6, dashArray: d.modo === 'deviazione' ? '10 9' : null } }));
  } else if (d.modo === 'linea' && d.punti.length > 1) livDisegno.addLayer(L.polyline(d.punti, { color: colore, weight: 6 }));
  else if (d.modo === 'area' && d.punti.length > 1) livDisegno.addLayer(L.polygon(d.punti, { color: colore, weight: 3, fillOpacity: 0.2 }));
}
async function aggancia() {
  const d = S.disegno;
  if (d.punti.length < 2) { d.geom = null; return aggiornaDisegno(); }
  aggiornaDisegno('Aggancio alla strada…');
  const coord = d.punti.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  try {
    const r = await fetch(`${OSRM}${coord}?overview=full&geometries=geojson&continue_straight=true`);
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error(j.message || j.code);
    if (S.disegno !== d) return;
    d.geom = j.routes[0].geometry;
    const m = j.routes[0].distance;
    aggiornaDisegno(`Tratto agganciato alla strada: ${m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m'}. Controlla che segua la strada giusta, poi premi Fatto.`);
  } catch (err) {
    d.geom = null;
    aggiornaDisegno('Non riesco ad agganciare la strada (servizio non raggiungibile). Riprova, oppure usa "Linea libera".');
  }
}
mappa.on('click', (e) => {
  const d = S.disegno;
  if (!d) return;
  if (mappa.getZoom() < ZOOM_PRECISO && d.modo !== 'area') {
    mappa.setView(e.latlng, ZOOM_PRECISO + 1);
    return;
  }
  d.punti.push(e.latlng);
  if (d.modo === 'punto') return fineDisegno();
  if (d.modo === 'strada' || d.modo === 'deviazione') aggancia(); else aggiornaDisegno();
});
mappa.on('zoomend', () => S.disegno && !S.disegno.punti.length && aggiornaDisegno());
function fineDisegno() {
  const d = S.disegno;
  const lnglat = (p) => [+p.lng.toFixed(6), +p.lat.toFixed(6)];
  let el;
  if (d.modo === 'punto') el = { ruolo: 'punto', geom: { type: 'Point', coordinates: lnglat(d.punti[0]) } };
  else if (d.modo === 'strada') el = { ruolo: 'tratto', geom: d.geom };
  else if (d.modo === 'deviazione') el = { ruolo: 'deviazione', geom: d.geom };
  else if (d.modo === 'linea') el = { ruolo: 'tratto', geom: { type: 'LineString', coordinates: d.punti.map(lnglat) } };
  else if (d.modo === 'area') el = { ruolo: 'area', geom: { type: 'Polygon', coordinates: [[...d.punti, d.punti[0]].map(lnglat)] } };
  S.bozza.elementi.push(el);
  esciDisegno();
  disegnaElementi();
  if (matchMedia('(max-width: 760px)').matches) vista('lista');
}
$('#d-fatto').onclick = fineDisegno;
$('#d-esci').onclick = esciDisegno;
$('#d-indietro').onclick = () => {
  const d = S.disegno;
  d.punti.pop();
  if (d.modo === 'strada' || d.modo === 'deviazione') aggancia(); else aggiornaDisegno();
};

/* ---------- ricerca luoghi (Nominatim, dati OpenStreetMap) ---------- */
let timerLuoghi;
async function cercaLuoghi(q) {
  if (q.length < 3) { $('#luoghi').hidden = true; return; }
  const u = `${NOMINATIM}?format=jsonv2&limit=6&countrycodes=it&accept-language=it&viewbox=11.10,44.25,11.80,43.70&bounded=1&q=${encodeURIComponent(q)}`;
  try {
    const j = await (await fetch(u)).json();
    if ($('#q').value.trim() !== q) return;
    $('#luoghi').innerHTML = j.map((p, i) => `<li data-i="${i}">${esc(p.name || p.display_name.split(',')[0])}<small>${esc(p.display_name.split(',').slice(1, 4).join(','))}</small></li>`).join('');
    $('#luoghi').hidden = !j.length;
    $('#luoghi').onclick = (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const p = j[li.dataset.i];
      livLuogo.clearLayers();
      if (p.geojson && p.geojson.type !== 'Point') livLuogo.addLayer(L.geoJSON(p.geojson, { style: { color: '#4c6ef5', weight: 4, opacity: 0.6, fill: false } }));
      livLuogo.addLayer(L.circleMarker([+p.lat, +p.lon], { radius: 7, color: '#4c6ef5' }).bindTooltip(esc(p.name || ''), { permanent: true, direction: 'top' }));
      const bb = p.boundingbox.map(Number);
      mappa.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 17 });
      $('#luoghi').hidden = true;
      vista('mappa', true);
    };
  } catch { $('#luoghi').hidden = true; }
}

/* ---------- utilità ---------- */
function vista(v, soloTelefono = false) {
  if (soloTelefono && !matchMedia('(max-width: 760px)').matches) return;
  document.body.dataset.vista = v;
  document.querySelectorAll('#vista button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'mappa') setTimeout(() => mappa.invalidateSize(), 50);
}
function apriFinestra(titolo, html) {
  $('#finestra-titolo').textContent = titolo;
  $('#finestra-corpo').innerHTML = html;
  $('#finestra').showModal();
}
let timerAvviso;
function avviso(t) {
  const a = $('#avviso'); a.textContent = t; a.hidden = false;
  clearTimeout(timerAvviso); timerAvviso = setTimeout(() => { a.hidden = true; }, 2600);
}
async function copia(t, msg) {
  try { await navigator.clipboard.writeText(t); avviso(msg); } catch { avviso('Copia non riuscita: seleziona il testo a mano'); }
}

/* ---------- eventi interfaccia ---------- */
$('#tipi').onclick = (e) => { const b = e.target.closest('[data-tipo]'); if (!b) return; S.tipi.has(b.dataset.tipo) ? S.tipi.delete(b.dataset.tipo) : S.tipi.add(b.dataset.tipo); disegnaTutto(); };
$('#quando').onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; S.quando = b.dataset.q; disegnaTutto(); };
$('#p-dal').onchange = (e) => { S.pDal = e.target.value; if (S.pAl && S.pAl < S.pDal) S.pAl = S.pDal; disegnaTutto(); };
$('#p-al').onchange = (e) => { S.pAl = e.target.value; disegnaTutto(); };
$('#f-comune').onchange = (e) => { S.comune = e.target.value; disegnaTutto(); evidenzia(true); };
$('#f-strada').onchange = (e) => { S.strada = e.target.value; disegnaTutto(); evidenzia(true); };
$('#raggruppa').onchange = (e) => { S.raggruppa = e.target.value; disegnaTutto(); };
$('#b-coda').onclick = finestraCoda;
// "solo questa" nei gruppi e "mostra solo questa strada" nei popup delle strade
document.addEventListener('click', (e) => {
  const st = e.target.closest('[data-filtra-strada]')?.dataset.filtraStrada;
  const co = e.target.closest('[data-filtra-comune]')?.dataset.filtraComune;
  if (st === undefined && co === undefined) return;
  if (st !== undefined) S.strada = st;
  if (co !== undefined) S.comune = co;
  mappa.closePopup(); chiudiScheda(); evidenzia(true); vista('lista', true);
});
$('#lista').onclick = (e) => { const li = e.target.closest('[data-id]'); if (li) apriScheda(li.dataset.id); };
// sul sito pubblico niente ricerca mentre si scrive: le regole di Nominatim vietano l'autocompletamento, si cerca con Invio
$('#q').oninput = (e) => { S.q = e.target.value.trim(); disegnaTutto(); clearTimeout(timerLuoghi); if (!PUBBLICO) timerLuoghi = setTimeout(() => cercaLuoghi(S.q), 450); };
$('#q').onkeydown = (e) => { if (PUBBLICO && e.key === 'Enter') { e.preventDefault(); cercaLuoghi(S.q); } };
$('#vista').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) vista(b.dataset.v); };
$('#home').onclick = (e) => { e.preventDefault(); if (S.bozza) return; S.comune = ''; S.strada = ''; S.tipi.clear(); chiudiScheda();
  if (S.comuniGeo) mappa.fitBounds(L.geoJSON(S.comuniGeo).getBounds(), { padding: [10, 10] }); else mappa.setView(CENTRO, 11); };
$('#b-bollettino').onclick = bollettino;
$('#b-cestino').onclick = cestino;
$('#b-nuovo').onclick = () => { S.scelto = null; apriEditor(nuovoEvento()); };
$('#finestra-chiudi').onclick = () => $('#finestra').close();
$('#pannello-scheda').onclick = async (e) => {
  const az = e.target.closest('[data-az]')?.dataset.az;
  const ev = S.eventi.find((x) => x.id === S.scelto);
  if (!az || !ev) return;
  if (az === 'chiudi') chiudiScheda();
  if (az === 'zoom') mostraSuMappa(ev);
  if (az === 'testo') copia(`${ev.comune ? ev.comune.toUpperCase() + '. ' : ''}${frase(ev)}`, 'Testo copiato');
  if (az === 'link') copia(location.href, 'Link copiato');
  if (az === 'modifica') apriEditor(ev);
  if (az === 'duplica') { const c = JSON.parse(JSON.stringify(ev)); delete c.id; delete c.creato; c.titolo += ' (copia)'; apriEditor(c); }
  if (az === 'cestina' && confirm(`Spostare nel cestino "${ev.titolo}"? Potrai ripristinarlo.`)) {
    const r = await fetch(`api/eventi/${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
    if (r.ok) { avviso('Spostato nel cestino'); chiudiScheda(); await carica(); }
  }
};
$('#pannello-editor').onsubmit = salva;
$('#pannello-editor').onclick = (e) => {
  const dis = e.target.closest('[data-dis]')?.dataset.dis;
  if (dis) return iniziaDisegno(dis);
  const togli = e.target.closest('[data-togli]')?.dataset.togli;
  if (togli !== undefined) { leggiForm(); S.bozza.elementi.splice(+togli, 1); return disegnaElementi(); }
  if (e.target.closest('[data-az="annulla"]')) {
    esciDisegno();
    const id = S.bozza.id; S.bozza = null; livBozza.clearLayers();
    id && S.eventi.some((x) => x.id === id) ? apriScheda(id, false) : chiudiScheda();
  }
};
$('#pannello-editor').onchange = () => { if (S.bozza) disegnaElementi(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.disegno) esciDisegno(); });

/* avvio: #e=id apre un evento, #map=zoom/lat/lon come su openstreetmap.org */
(async function avvio() {
  vista('lista');
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('map')) {
    const [z, la, lo] = h.get('map').split('/').map(Number);
    if (z && la && lo) mappa.setView([la, lo], z);
  }
  await caricaGeo();
  zoomNomi();
  // vista iniziale: tutti i Comuni seguiti, se il link non indica già un punto
  if (!h.get('map') && !h.get('e') && S.comuniGeo) { const b = L.geoJSON(S.comuniGeo).getBounds(); mappa.fitBounds(b, { padding: [10, 10] }); }
  legenda();
  await carica();
  if (h.get('e')) apriScheda(h.get('e'));
  // ogni 2 minuti ricarica (i dati automatici cambiano), ma non mentre si modifica
  setInterval(() => { if (!S.bozza && !S.disegno) carica(); }, 120000);
})();
