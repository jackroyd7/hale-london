(function(){
"use strict";
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d){ try { const v = localStorage.getItem("hale:"+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem("hale:"+k, JSON.stringify(v)); } catch(e){} }
};
const STATIONS = OSMDATA.stations;
const PAGE = 40;

/* ---------- geometry ---------- */
function inRing(lng, lat, ring){
  let inside = false;
  for (let i=0, j=ring.length-1; i<ring.length; j=i++){
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function boroughAt(lat, lng){
  for (const f of BOROUGHS.features) for (const poly of f.geometry.coordinates)
    if (inRing(lng, lat, poly[0]) && !poly.slice(1).some(h => inRing(lng, lat, h))) return f.properties.name;
  return null;
}
function metres(a, b){
  const R = 6371000, r = Math.PI/180;
  const dLat = (b[0]-a[0])*r, dLng = (b[1]-a[1])*r;
  const h = Math.sin(dLat/2)**2 + Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
const regionOf = {};
Object.entries(REGIONS).forEach(([r, list]) => list.forEach(b => regionOf[b] = r));

/* ---------- venues ---------- */
const VENUES = [], BY_ID = {};
function addVenue(r, extra){
  const v = { ...r, ...(extra || {}) };
  v.region = regionOf[v.borough] || "";
  v.needs = v.needs || [];
  v.complete = (v.web ? 2 : 0) + (v.hours ? 1.5 : v.ohRaw ? 0.5 : 0) + (v.addr ? 0.5 : 0) + (v.wc ? 0.3 : 0) + (v.phone ? 0.2 : 0) + (v.chain ? 0 : 0.4);
  VENUES.push(v); BY_ID[v.id] = v;
  return v;
}
OSMDATA.venues.forEach(r => addVenue(r));
store.get("claimed2", []).forEach(r => { try { if (!BY_ID[r.id]) addVenue(r, {pending:1}); } catch(e){} });

/* ---------- time (Europe/London) ---------- */
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function londonNow(){
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London", weekday:"short", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return { day: DAYS.indexOf(g("weekday")), mins: (+g("hour"))*60 + (+g("minute")) };
}
const toMins = t => { const [h, m] = t.split(":").map(Number); return h*60 + m; };
function status(v){
  if (!v.hours) return { known:false, open:false, text: v.ohRaw ? "Hours: see listing" : "Hours not listed" };
  const now = londonNow();
  const prev = (now.day + 6) % 7;
  for (const [o, c] of v.hours[prev] || []){ const om = toMins(o), cm = toMins(c); if (cm <= om && now.mins < cm) return { known:true, open:true, soon: cm - now.mins <= 60, text: "Open · until " + c }; }
  for (const [o, c] of v.hours[now.day] || []){
    const om = toMins(o); let cm = toMins(c); if (cm <= om) cm += 1440;
    if (now.mins >= om && now.mins < cm){
      if (o === "00:00" && c === "24:00") return { known:true, open:true, text:"Open 24 hours" };
      const left = cm - now.mins;
      return { known:true, open:true, soon: left <= 60, text: (left <= 60 ? "Closes soon · " : "Open · until ") + c };
    }
    if (now.mins < om) return { known:true, open:false, text: "Closed · opens " + o };
  }
  for (let i=1; i<=7; i++){
    const d = (now.day + i) % 7, h = v.hours[d];
    if (h && h.length) return { known:true, open:false, text: "Closed · opens " + (i === 1 ? "tomorrow" : DAYS[d]) + " " + h[0][0] };
  }
  return { known:true, open:false, text:"Closed" };
}

/* ---------- state ---------- */
const DEFAULT_FILTERS = () => ({ q:"", cats:[], subs:[], region:"", borough:"", needs:[], openNow:false, stepFree:false, hasWeb:false, indie:false, vegan:false });
const S = {
  view: "explore", f: DEFAULT_FILTERS(), sort: "recommended", inView: false, shown: PAGE,
  origin: store.get("origin2", null),
  favs: new Set(store.get("favs2", [])),
  myGuides: loadGuides(), editing: null, shared: null, gq: "",
  route: store.get("route", true),
  guide: null, detail: null, concierge: null, pickOrigin: false,
  showFilters: store.get("showFilters", window.innerWidth >= 820)
};
function saveLocal(){ store.set("favs2", [...S.favs]); store.set("origin2", S.origin); saveGuides(); }

/* ---------- your own guides ---------- */
const TONES = ["clinic", "move", "eat", "recover", "mind"];
const SHARE = !!window.HALE_SHARE;
function loadGuides(){
  let g = store.get("guides3", null);
  if (!g) g = store.get("lists2", []).map(l => ({ id: l.id, name: l.name, desc: "", tone: "move", items: (l.ids || []).map(id => ({ id, note: "" })), updated: Date.now() }));
  return Array.isArray(g) ? g.filter(x => x && Array.isArray(x.items)) : [];
}
function saveGuides(){ store.set("guides3", S.myGuides); }
const myGuide = id => S.myGuides.find(g => g.id === id);
const guideStops = g => g.items.filter(it => BY_ID[it.id]).map(it => ({ ...it, v: BY_ID[it.id] }));
function legMins(a, b){ return Math.max(1, Math.round(metres([a.lat, a.lng], [b.lat, b.lng]) * 1.25 / 80)); }
const dur = m => m < 60 ? m + " min" : Math.floor(m / 60) + " hr" + (m % 60 ? " " + (m % 60) + " min" : "");
function walkTotal(vs){ let m = 0; for (let i = 1; i < vs.length; i++) m += legMins(vs[i - 1], vs[i]); return m; }
function newGuide(name, ids){
  const g = { id: "g" + Date.now().toString(36), name: name || "My guide", desc: "", tone: "move", items: (ids || []).map(id => ({ id, note: "" })), updated: Date.now() };
  S.myGuides.unshift(g); saveGuides(); return g;
}
function touch(g){ g.updated = Date.now(); saveGuides(); }
function b64e(str){ return btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64d(str){ str = str.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(str); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
function encodeShare(g){ return b64e(JSON.stringify({ v: 1, n: g.name, d: g.desc, t: g.tone, i: g.items.map(it => it.note ? [it.id, it.note] : [it.id]) })); }
function decodeShare(str){
  try {
    const o = JSON.parse(b64d(decodeURIComponent(str)));
    if (!o || !Array.isArray(o.i)) return null;
    return { id: "shared", name: String(o.n || "Shared guide").slice(0, 80), desc: String(o.d || "").slice(0, 600), tone: TONES.includes(o.t) ? o.t : "move",
      items: o.i.slice(0, 100).map(x => ({ id: String(x[0]), note: String(x[1] || "").slice(0, 400) })) };
  } catch(e){ return null; }
}
function shareLink(g){ return location.origin + location.pathname + "#share=" + encodeShare(g); }
function guideText(g){
  const st = guideStops(g);
  return [g.name, g.desc, ""].filter((x, i) => x || i === 2).join("\n") + st.map((it, i) => `${i + 1}. ${it.v.name}${it.v.branch ? " " + it.v.branch : ""}: ${it.v.sub}, ${it.v.addr || it.v.borough}${it.note ? "\n   " + it.note : ""}${it.v.web ? "\n   " + it.v.web : ""}`).join("\n");
}
function originPoint(){
  if (!S.origin) return null;
  if (S.origin.key){ const s = STATIONS[S.origin.key]; return s ? {lat:s[1], lng:s[2], label:s[0]} : null; }
  return S.origin;
}
function walkMins(v){ const o = originPoint(); return o ? Math.round(metres([o.lat, o.lng], [v.lat, v.lng]) * 1.25 / 80) : null; }
function walkText(m){ if (m == null) return ""; return m <= 45 ? m + " min walk" : (m * 80 / 1.25 / 1000).toFixed(1) + " km away"; }

function matches(v, f){
  if (f.cats.length && !f.cats.includes(v.cat)) return false;
  if (f.subs.length && !f.subs.includes(v.sub)) return false;
  if (f.region && v.region !== f.region) return false;
  if (f.borough && v.borough !== f.borough) return false;
  if (f.needs.length && !f.needs.some(n => v.needs.includes(n))) return false;
  if (f.openNow && !status(v).open) return false;
  if (f.stepFree && v.wc !== "yes") return false;
  if (f.hasWeb && !v.web) return false;
  if (f.indie && v.chain) return false;
  if (f.vegan && !(v.vegan || v.sub === "Vegan")) return false;
  if (f.q){
    const hay = [v.name, v.branch, v.sub, v.borough, v.st, v.addr, typeof v.chain === "string" ? v.chain : "", CATEGORIES[v.cat].label, ...v.needs.map(n => NEEDS[n])].join(" ").toLowerCase();
    const squashed = (v.name + " " + (v.branch || "")).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w) || squashed.includes(w.replace(/[^a-z0-9]/g, "")))) return false;
  }
  return true;
}
function sortList(list){
  const l = list.slice();
  if (S.sort === "nearest" && originPoint()) l.sort((a, b) => walkMins(a) - walkMins(b));
  else if (S.sort === "az") l.sort((a, b) => a.name.localeCompare(b.name));
  else if (originPoint()) l.sort((a, b) => (b.complete - walkMins(b) / 15) - (a.complete - walkMins(a) / 15));
  else l.sort((a, b) => b.complete - a.complete || a.name.localeCompare(b.name));
  return l;
}
function filtered(){
  let l = VENUES.filter(v => matches(v, S.f));
  if (S.inView && map){ const b = map.getBounds(); l = l.filter(v => b.contains([v.lat, v.lng])); }
  return sortList(l);
}

/* ---------- guides (built from the data by rule) ---------- */
const nearPoint = (lat, lng, m) => v => metres([lat, lng], [v.lat, v.lng]) <= m;
const GUIDES = [
  {id:"saunas", title:"Saunas and bathhouses", blurb:"Saunas, steam rooms and public baths across London.", tone:"recover", test: v => v.sub === "Sauna & bathhouse"},
  {id:"lidos", title:"Lidos and outdoor swimming", blurb:"Outdoor pools and swimming ponds.", tone:"move", test: v => v.sub === "Lido & open water"},
  {id:"climbing", title:"Climbing and bouldering walls", blurb:"Indoor walls for strength, focus and meeting people.", tone:"move", test: v => v.sub === "Climbing"},
  {id:"vegan-east", title:"Vegan and vegetarian in East London", blurb:"Fully vegan or vegetarian cafés and restaurants in the eastern boroughs.", tone:"eat", test: v => v.region === "East" && (v.sub === "Vegan" || v.sub === "Vegetarian")},
  {id:"city-physio", title:"Physios and osteopaths near the City", blurb:"Clinics within about 20 minutes' walk of Bank.", tone:"clinic", test: v => ["Physiotherapy","Osteopathy","Chiropractic"].includes(v.sub) && nearPoint(51.5133, -0.0886, 1600)(v)},
  {id:"yoga-north", title:"Yoga in North London", blurb:"Studios in Camden, Islington, Haringey, Barnet and Enfield.", tone:"move", test: v => v.sub === "Yoga" && ["Camden","Islington","Haringey","Barnet","Enfield"].includes(v.borough)},
  {id:"indie-gyms", title:"Independent gyms", blurb:"Gyms that aren't part of a chain, with a website you can check.", tone:"move", test: v => v.sub === "Gym" && !v.chain && v.web},
  {id:"sober", title:"Juice bars and alcohol-free spots", blurb:"Places to meet up without drinking.", tone:"eat", test: v => v.sub === "Juice & smoothies" || v.sub === "Alcohol-free bar"},
  {id:"mind", title:"Meditation centres", blurb:"Meditation and Buddhist centres offering classes and drop-ins.", tone:"mind", test: v => v.sub === "Meditation centre"},
  {id:"step-free-recovery", title:"Step-free spas and saunas", blurb:"Recovery venues mapped as wheelchair accessible.", tone:"recover", test: v => v.cat === "recover" && v.wc === "yes"}
].map(g => ({...g, items: VENUES.filter(g.test).sort((a, b) => b.complete - a.complete || a.name.localeCompare(b.name))})).filter(g => g.items.length >= 3);

/* ---------- rendering helpers ---------- */
const catDot = c => `<span class="cdot" style="--c:var(--c-${c})" aria-hidden="true">${CATEGORIES[c].glyph}</span>`;
function heart(id){
  const on = S.favs.has(id);
  return `<button class="heart${on ? " on" : ""}" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? "Remove from saved" : "Save"}" title="${on ? "Saved" : "Save"}"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.5 0 5.7 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></button>`;
}
function badges(v){
  const b = [];
  if (v.pending) b.push(`<span class="pill pending">Pending review</span>`);
  if (v.wc === "yes") b.push(`<span class="pill access">Step-free</span>`);
  if (v.wc === "limited") b.push(`<span class="pill">Partly step-free</span>`);
  if (v.vegan === "only" || v.sub === "Vegan") b.push(`<span class="pill diet">Fully vegan</span>`);
  else if (v.vegan === "yes") b.push(`<span class="pill diet">Vegan options</span>`);
  if (v.veggie === "only" && v.sub !== "Vegan" && v.vegan !== "only") b.push(`<span class="pill diet">Vegetarian</span>`);
  if (v.gf) b.push(`<span class="pill diet">Gluten-free options</span>`);
  if (v.women) b.push(`<span class="pill">Women-only</span>`);
  if (v.chain) b.push(`<span class="pill">${typeof v.chain === "string" ? esc(v.chain) : "Chain"}</span>`);
  else if (v.cat !== "clinic" && v.cat !== "mind" && !v.pending) b.push(`<span class="pill indie">Independent</span>`);
  return b.join("");
}
function card(v, extra){
  const st = status(v), w = walkMins(v);
  return `<article class="card" data-venue="${esc(v.id)}" tabindex="0">
    <div class="card-top">${catDot(v.cat)}<span class="eyebrow">${esc(v.sub)} · ${esc(v.borough)}</span>${heart(v.id)}</div>
    <h3 class="card-name">${esc(v.name)}${v.branch ? ` <span class="branch">${esc(v.branch)}</span>` : ""}</h3>
    ${extra ? `<p class="why">${extra}</p>` : ""}
    ${v.addr ? `<p class="card-sum">${esc(v.addr)}</p>` : ""}
    <div class="meta">
      <span class="${st.open ? (st.soon ? "warn" : "ok") : "muted"}">${st.text}</span>
      ${w != null ? `<span>${walkText(w)}</span>` : `<span class="muted">${v.stWalk} min from ${esc(v.st)}</span>`}
      ${v.web ? `<span class="muted">Website ✓</span>` : ""}
    </div>
    <div class="pills">${badges(v)}</div>
  </article>`;
}

/* ---------- map ---------- */
let map, boroughLayer, cluster, originMarker, thames, markers = {};
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
const TILES = !!window.HALE_TILES;
let tileLayer = null;
function isDark(){ return cssVar("color-scheme") === "dark" || getComputedStyle(document.body).colorScheme === "dark" || document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches); }
function setTiles(){
  if (!TILES || !map || !L.maplibreGL) return;
  const style = "https://tiles.openfreemap.org/styles/" + (isDark() ? "dark" : "positron");
  if (tileLayer){ if (tileLayer._haleStyle === style) return; tileLayer.getMaplibreMap().setStyle(style); tileLayer._haleStyle = style; return; }
  tileLayer = L.maplibreGL({ style, attribution:'<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
  tileLayer._haleStyle = style;
}
function boroughStyle(f){
  const sel = S.f.borough === f.properties.name;
  const inRegion = S.f.region && regionOf[f.properties.name] === S.f.region;
  if (TILES) return { color: cssVar(sel ? "--accent" : "--map-line-tiles"), weight: sel ? 3 : 1.2, dashArray: sel ? null : "4 4", fillColor: cssVar("--accent"), fillOpacity: sel ? 0.08 : inRegion ? 0.05 : 0 };
  return { color: cssVar(sel ? "--accent" : "--map-line"), weight: sel ? 2.2 : 1, fillColor: cssVar(sel || inRegion ? "--map-land-sel" : "--map-land"), fillOpacity: 1 };
}
function initMap(){
  map = L.map("map", { zoomControl:false, attributionControl:false, minZoom:9, maxZoom: TILES ? 19 : 18, maxBounds:[[51.2,-0.65],[51.75,0.4]], maxBoundsViscosity:0.8, zoomSnap:0.5 });
  L.control.zoom({position:"topright"}).addTo(map);
  if (TILES){ L.control.attribution({position:"bottomright", prefix:false}).addTo(map); setTiles(); }
  map.setView([51.507, -0.125], window.innerWidth < 820 ? 10.5 : 11.5);
  boroughLayer = L.geoJSON(BOROUGHS, {
    style: boroughStyle,
    onEachFeature(f, layer){
      if (!TILES) layer.bindTooltip(f.properties.name, {permanent:true, direction:"center", className:"blabel", interactive:false});
      else layer.bindTooltip(f.properties.name, {sticky:true, direction:"top", className:"vtip"});
      layer.on("click", () => { if (S.pickOrigin) return; S.f.borough = S.f.borough === f.properties.name ? "" : f.properties.name; S.f.region = ""; S.shown = PAGE; S.concierge = null; setView("explore"); lastSetKey = ""; renderAll(); });
      layer.on("mouseover", () => { if (S.f.borough !== f.properties.name) layer.setStyle(TILES ? {fillColor: cssVar("--accent"), fillOpacity: 0.06} : {fillColor: cssVar("--map-land-hover")}); });
      layer.on("mouseout", () => boroughLayer.resetStyle(layer));
    }
  }).addTo(map);
  thames = L.polyline(THAMES, {color: cssVar("--map-water"), weight: 9, opacity: TILES ? 0 : 1, lineCap:"round", lineJoin:"round", interactive:false}).addTo(map);
  if (TILES) map.getContainer().classList.add("has-tiles");
  cluster = L.markerClusterGroup({
    showCoverageOnHover:false, maxClusterRadius:50, disableClusteringAtZoom:17, spiderfyOnMaxZoom:true, chunkedLoading:true,
    iconCreateFunction(c){
      const kids = c.getAllChildMarkers(), counts = {};
      kids.forEach(m => counts[m.options.cat] = (counts[m.options.cat] || 0) + 1);
      let acc = 0; const stops = [];
      Object.keys(CATEGORIES).forEach(k => { if (counts[k]){ const a = acc / kids.length * 100; acc += counts[k]; stops.push(`var(--c-${k}) ${a}% ${acc / kids.length * 100}%`); } });
      const n = kids.length, size = n < 10 ? 36 : n < 50 ? 42 : n < 200 ? 48 : 54;
      return L.divIcon({ html:`<div class="clu" style="width:${size}px;height:${size}px;background:conic-gradient(${stops.join(",")})"><span>${n}</span></div>`, className:"clu-wrap", iconSize:[size, size] });
    }
  });
  map.addLayer(cluster);
  const zcls = () => { map.getContainer().classList.toggle("z-labels", map.getZoom() >= 11.5 && !TILES); thames.setStyle({weight: Math.max(4, (map.getZoom() - 9) * 4)}); };
  map.on("zoomend", zcls); zcls();
  map.on("moveend", () => { if (S.inView && S.view === "explore" && !S.detail){ S.shown = PAGE; renderPanel(); } });
  map.on("click", e => {
    if (!S.pickOrigin) return;
    S.origin = {lat:e.latlng.lat, lng:e.latlng.lng, label:"your pinned point"}; S.pickOrigin = false; S.sort = "nearest";
    map.getContainer().classList.remove("picking"); saveLocal(); renderAll();
  });
}
function pinIcon(v, hl, num){
  return L.divIcon({ className:"pin-wrap", iconSize:[28, 28], iconAnchor:[14, 14],
    html:`<div class="pin${hl ? " hl" : ""}${v.pending ? " pend" : ""}${num ? " num" : ""}" style="--c:var(--c-${v.cat})"><span>${num || CATEGORIES[v.cat].glyph}</span></div>` });
}
function currentGuide(){
  if (S.view !== "guides" || !S.guide) return null;
  if (S.guide === "shared") return S.shared;
  if (S.guide.startsWith("my:")) return myGuide(S.guide.slice(3)) || null;
  return null;
}
function mapSet(){
  const cg = currentGuide();
  if (cg) return guideStops(cg).map(it => it.v);
  if (S.view === "guides" && S.guide && GUIDES.find(g => g.id === S.guide)) return GUIDES.find(g => g.id === S.guide).items.slice(0, 25);
  if (S.view === "saved") return VENUES.filter(v => S.favs.has(v.id));
  if (S.view === "explore" && S.concierge && S.concierge.picks && S.concierge.picks.length) return S.concierge.picks.map(p => BY_ID[p.id]);
  return VENUES.filter(v => matches(v, S.f));
}
let lastSetKey = "", plainLayer = null;
function renderMap(fit){
  if (!map) return;
  const set = mapSet();
  const numbered = S.view === "guides" && !!S.guide;
  const key = (numbered ? "n" + (S.route ? "r" : "") : "") + set.length + ":" + (set.length < 400 ? set.map(v => v.id).join(",") : set.map(v => v.id).join(",").length + ":" + set.slice(0, 40).map(v => v.id).join(","));
  if (key !== lastSetKey){
    cluster.clearLayers(); markers = {};
    if (!plainLayer) plainLayer = L.layerGroup().addTo(map);
    plainLayer.clearLayers();
    if (numbered && S.route && set.length > 1){
      L.polyline(set.map(v => [v.lat, v.lng]), { color: cssVar("--accent"), weight: 3, opacity: 0.8, dashArray: "6 7", interactive: false }).addTo(plainLayer);
    }
    const ms = set.map((v, i) => {
      const num = numbered ? i + 1 : 0;
      const m = L.marker([v.lat, v.lng], {icon: pinIcon(v, S.detail === v.id, num), cat: v.cat, num, title: v.name, riseOnHover:true, zIndexOffset: numbered ? 500 - i : 0});
      m.bindTooltip(`<b>${esc(v.name)}</b><br>${esc(v.sub)}`, {direction:"top", offset:[0, -13], className:"vtip"});
      m.on("click", () => openDetail(v.id));
      markers[v.id] = m; return m;
    });
    if (numbered) ms.forEach(m => m.addTo(plainLayer)); else cluster.addLayers(ms);
    lastSetKey = key;
    if (fit && set.length && set.length < VENUES.length) fitTo(set);
  }
  boroughLayer.setStyle(boroughStyle);
  if (originMarker){ map.removeLayer(originMarker); originMarker = null; }
  const o = originPoint();
  if (o) originMarker = L.marker([o.lat, o.lng], {interactive:false, zIndexOffset:1000, icon: L.divIcon({className:"origin-wrap", iconSize:[22,22], iconAnchor:[11,11], html:`<div class="origin"></div>`})}).addTo(map);
}
function fitTo(set){
  if (!set.length) return;
  map.flyToBounds(L.latLngBounds(set.map(v => [v.lat, v.lng])).pad(0.2), {maxZoom:15, duration:0.6});
}
function highlight(id, on){
  const m = markers[id]; if (!m) return;
  m.setIcon(pinIcon(BY_ID[id], on || S.detail === id, m.options.num));
  m.setZIndexOffset(on ? 800 : 0);
}

/* ---------- panel views ---------- */
function renderTabs(){
  $$(".tab").forEach(t => t.setAttribute("aria-current", t.dataset.view === S.view ? "page" : "false"));
  $("#savedCount").textContent = S.favs.size || "";
  document.body.dataset.view = S.view;
}
function chip(label, active, attrs, count){
  return `<button class="chip${active ? " on" : ""}" aria-pressed="${active}" ${attrs}>${label}${count != null ? `<span class="cnt">${count}</span>` : ""}</button>`;
}
function activeFilterCount(){
  const f = S.f; let n = f.cats.length + f.subs.length + f.needs.length + (f.region?1:0) + (f.borough?1:0) + (f.q?1:0);
  ["openNow","stepFree","hasWeb","indie","vegan"].forEach(k => f[k] && n++);
  return n;
}
let stationOptsCache = "";
const stationOptions = () => stationOptsCache || (stationOptsCache = Object.values(STATIONS).map(s => s[0]).sort().map(n => `<option value="${esc(n)}"></option>`).join(""));
function renderExplore(){
  const f = S.f;
  const catCounts = {}; VENUES.filter(v => matches(v, {...f, cats:[], subs:[]})).forEach(v => catCounts[v.cat] = (catCounts[v.cat] || 0) + 1);
  const subCounts = {}; VENUES.filter(v => matches(v, {...f, subs:[]})).forEach(v => subCounts[v.sub] = (subCounts[v.sub] || 0) + 1);
  const list = filtered();
  const o = originPoint();
  const nActive = activeFilterCount();
  const c = S.concierge;
  let conc = "";
  if (c){
    conc = `<section class="concierge-out" aria-live="polite">
      <div class="co-head"><span class="eyebrow">Concierge</span><button class="link" data-act="clear-concierge">Clear</button></div>
      <p class="co-q">“${esc(c.query)}”</p>
      ${c.understood ? `<p class="co-note">${c.understood}</p>` : ""}
      ${c.loading ? `<p class="co-reply thinking">Asking Claude for personal picks…</p>` : ""}
      ${c.reply ? `<p class="co-reply">${esc(c.reply)}</p>` : ""}
      ${c.error ? `<p class="co-note">${esc(c.error)}</p>` : ""}
      ${c.picks && c.picks.length ? `<div class="list">${c.picks.map(p => card(BY_ID[p.id], esc(p.why))).join("")}</div><h4 class="sub-h">Everything else that matches</h4>` : ""}
    </section>`;
  }
  const subsShown = Object.keys(subCounts).sort();
  const curOrigin = o && S.origin.key ? o.label : "";
  return `
  <form class="ask" id="askForm" autocomplete="off">
    <label for="askInput" class="ask-label">What are you looking for?${sampleFn ? ` <span class="ai-tag">Personal picks by Claude</span>` : ""}</label>
    <div class="ask-row">
      <input id="askInput" type="text" placeholder="e.g. physio for a sore back near Old Street" value="${c ? esc(c.query) : ""}">
      <button type="submit" class="btn primary">Ask</button>
    </div>
    <div class="ask-eg">${["Sauna open now near London Bridge","Vegan lunch in Hackney","Bouldering in North London","Counsellor near Brixton"].map(t => `<button type="button" class="eg" data-eg="${esc(t)}">${esc(t)}</button>`).join("")}</div>
  </form>
  ${conc}
  <div class="filters${S.showFilters ? "" : " collapsed"}">
    <div class="frow search-row">
      <input id="q" type="search" placeholder="Search by name, street, postcode or type" value="${esc(f.q)}" aria-label="Search">
      <button class="btn ghost" data-act="toggle-filters" aria-expanded="${S.showFilters}">Filters${nActive ? ` · ${nActive}` : ""}</button>
    </div>
    <div class="chips" role="group" aria-label="Type of place">${Object.entries(CATEGORIES).map(([k, cdef]) => chip(`${catDot(k)}${cdef.label}`, f.cats.includes(k), `data-cat="${k}"`, catCounts[k] || 0)).join("")}</div>
    <div class="fbody">
      <div class="fgroup">
        <span class="flabel">Kind of place</span>
        <div class="chips small">${subsShown.map(s => chip(esc(s), f.subs.includes(s), `data-sub="${esc(s)}"`, subCounts[s] || 0)).join("")}</div>
      </div>
      <div class="fgroup">
        <span class="flabel">Area</span>
        <div class="seg" role="group" aria-label="Region">${["", "Central", "North", "East", "South", "West"].map(r => `<button class="${f.region === r && !f.borough ? "on" : ""}" data-region="${r}">${r || "All London"}</button>`).join("")}</div>
        <select id="borough" aria-label="Borough"><option value="">Any borough</option>${Object.keys(regionOf).sort().map(b => `<option${f.borough === b ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>
      </div>
      <div class="fgroup">
        <span class="flabel">Good for</span>
        <div class="chips small">${Object.entries(NEEDS).filter(([k]) => VENUES.some(v => v.needs.includes(k))).map(([k, l]) => chip(l, f.needs.includes(k), `data-need="${k}"`)).join("")}</div>
      </div>
      <div class="fgroup">
        <label class="field" for="originInput"><span class="flabel">Starting from</span></label>
        <div class="ask-row"><input id="originInput" list="stationList" placeholder="${S.origin && !S.origin.key ? "Pinned point on the map" : "Type a station, e.g. Angel"}" value="${esc(curOrigin)}"><datalist id="stationList">${stationOptions()}</datalist>${S.origin ? `<button type="button" class="btn ghost" data-act="clear-origin">Clear</button>` : ""}</div>
      </div>
      <div class="fgroup">
        <div class="toggles">${[["openNow","Open now"],["stepFree","Step-free"],["hasWeb","Has a website"],["indie","Independent"],["vegan","Vegan"]].map(([k, l]) => chip(l, f[k], `data-flag="${k}"`)).join("")}</div>
      </div>
      <div class="fgroup row-actions">
        <button class="link" data-act="pick-origin">${S.pickOrigin ? "Click the map to set your start…" : "Pick a starting point on the map"}</button>
        ${nActive ? `<button class="link" data-act="reset">Clear all filters</button>` : ""}
      </div>
    </div>
  </div>
  <div class="results-head">
    <p><b>${list.length.toLocaleString("en-GB")}</b> ${list.length === 1 ? "place" : "places"}${f.borough ? " in " + esc(f.borough) : f.region ? " in " + f.region + " London" : ""}${o ? ` <span class="muted">· from ${esc(o.label)}</span>` : ""}</p>
    <div class="rh-right">
      <label class="inview"><input type="checkbox" id="inView"${S.inView ? " checked" : ""}> In map view</label>
      <select id="sort" aria-label="Sort">${[["recommended","Most detail first"],["nearest","Nearest"],["az","A–Z"]].map(([v,l]) => `<option value="${v}"${S.sort === v ? " selected" : ""}${v === "nearest" && !o ? " disabled" : ""}>${l}</option>`).join("")}</select>
    </div>
  </div>
  <div class="list">${list.length ? list.slice(0, S.shown).map(v => card(v)).join("") : `<div class="empty"><p>Nothing matches all of those filters.</p><button class="btn" data-act="reset">Clear filters</button></div>`}</div>
  ${list.length > S.shown ? `<button class="btn more" data-act="more">Show ${Math.min(PAGE, list.length - S.shown)} more (${(list.length - S.shown).toLocaleString("en-GB")} left)</button>` : ""}
  <p class="source">Venue data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, ODbL. Details can be out of date, so check with the venue before you go.</p>`;
}
function guideTile(g){
  const st = guideStops(g);
  return `<button class="guide mine" data-myguide="${esc(g.id)}" style="--c:var(--c-${g.tone})">
    <span class="g-count">${st.length} ${st.length === 1 ? "place" : "places"}${st.length > 1 ? " · " + dur(walkTotal(st.map(x => x.v))) + " walking" : ""}</span>
    <span class="g-title">${esc(g.name)}</span>${g.desc ? `<span class="g-blurb">${esc(g.desc.length > 110 ? g.desc.slice(0, 108) + "…" : g.desc)}</span>` : ""}
    <span class="g-names">${st.length ? st.slice(0, 3).map(x => esc(x.v.name)).join(" · ") : "No places yet"}</span></button>`;
}
function renderMyGuide(g, shared){
  const st = guideStops(g), missing = g.items.length - st.length;
  const n = st.length;
  return `<button class="back" data-act="guide-back">← All guides</button>
    ${shared ? `<div class="shared-banner"><b>Someone shared this guide with you.</b> Save it to keep a copy you can edit.<button class="btn primary" data-act="save-shared">Save to my guides</button></div>` : ""}
    <header class="view-head g-head" style="--c:var(--c-${g.tone})"><span class="eyebrow">${shared ? "Shared guide" : "Your guide"} · ${n} ${n === 1 ? "place" : "places"}${n > 1 ? ` · about ${dur(walkTotal(st.map(x => x.v)))} walking between stops` : ""}</span>
      <h2>${esc(g.name)}</h2>${g.desc ? `<p class="g-desc">${esc(g.desc)}</p>` : ""}</header>
    ${shared ? "" : `<div class="g-actions">
      <button class="btn primary" data-act="edit-guide">Edit guide</button>
      ${n ? `<button class="btn" data-act="share-guide">${SHARE ? "Copy share link" : "Copy as text"}</button>${SHARE ? `<button class="btn ghost" data-act="copy-guide">Copy as text</button>` : ""}` : ""}
      <button class="link danger" data-act="delete-guide">Delete guide</button></div>`}
    ${n > 1 ? `<label class="inview route-t"><input type="checkbox" id="routeToggle"${S.route ? " checked" : ""}> Show the route on the map</label>` : ""}
    <p class="copy-status" id="copyStatus" aria-live="polite"></p>
    ${n ? `<ol class="list guide-list">${st.map((it, i) => `<li><span class="gnum">${i + 1}</span><div class="stop">${card(it.v)}${it.note ? `<p class="note">${esc(it.note)}</p>` : ""}${i < n - 1 ? `<p class="leg">${dur(legMins(it.v, st[i + 1].v))} walk to stop ${i + 2}</p>` : ""}</div></li>`).join("")}</ol>`
      : `<div class="empty"><p>${shared ? "None of this guide's places are on the map any more." : "No places yet. Open any place and choose “Add to a guide”, or edit this guide to search for places."}</p>${shared ? "" : `<button class="btn" data-act="edit-guide">Add places</button>`}</div>`}
    ${missing ? `<p class="muted small">${missing} ${missing === 1 ? "place is" : "places are"} no longer on the map and ${missing === 1 ? "is" : "are"} hidden.</p>` : ""}`;
}
function guideSearchResults(g){
  const q = S.gq.trim().toLowerCase();
  if (q.length < 2) return `<p class="muted small">Type at least two letters of a name, street, area or type of place.</p>`;
  const have = new Set(g.items.map(it => it.id));
  const words = q.split(/\s+/);
  const res = VENUES.filter(v => { const h = [v.name, v.branch, v.sub, v.borough, v.addr, v.st].join(" ").toLowerCase(); return words.every(w => h.includes(w)); })
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || b.complete - a.complete).slice(0, 8);
  if (!res.length) return `<p class="muted small">No places match “${esc(S.gq)}”.</p>`;
  return res.map(v => `<div class="add-row">${catDot(v.cat)}<span class="add-name"><b>${esc(v.name)}${v.branch ? " " + esc(v.branch) : ""}</b><span class="muted">${esc(v.sub)} · ${esc(v.borough)}</span></span>${have.has(v.id) ? `<span class="muted small">Added</span>` : `<button class="btn" data-addto="${esc(v.id)}">Add</button>`}</div>`).join("");
}
function renderEditor(g){
  const st = guideStops(g);
  const favsToAdd = [...S.favs].filter(id => BY_ID[id] && !g.items.some(it => it.id === id)).length;
  return `<button class="back" data-act="edit-done">← Done</button>
    <header class="view-head"><span class="eyebrow">Edits save as you type</span><h2>Edit guide</h2></header>
    <div class="editor">
      <label class="field"><span class="flabel">Title</span><input id="gName" maxlength="80" value="${esc(g.name)}"></label>
      <label class="field"><span class="flabel">Description</span><textarea id="gDesc" rows="3" maxlength="600" placeholder="What's this guide for? e.g. A slow Sunday in South London">${esc(g.desc)}</textarea></label>
      <div class="field"><span class="flabel">Colour</span><div class="chips small">${TONES.map(k => chip(`${catDot(k)}${CATEGORIES[k].one}`, g.tone === k, `data-tone="${k}"`)).join("")}</div></div>
      <div class="field"><span class="flabel">Places, in order (${st.length})</span>
        ${st.length ? `<ol class="edit-list">${st.map((it, i) => `<li class="edit-row">
          <span class="gnum">${i + 1}</span>
          <div class="edit-main"><b>${esc(it.v.name)}${it.v.branch ? " " + esc(it.v.branch) : ""}</b><span class="muted small">${esc(it.v.sub)} · ${esc(it.v.borough)}</span>
            <textarea class="note-in" data-note="${esc(it.id)}" rows="2" maxlength="400" placeholder="Your note (optional), e.g. Book the 7am class">${esc(it.note)}</textarea></div>
          <div class="edit-btns"><button class="icon-btn" data-mv="${esc(it.id)}:-1" aria-label="Move up"${i === 0 ? " disabled" : ""}>↑</button><button class="icon-btn" data-mv="${esc(it.id)}:1" aria-label="Move down"${i === st.length - 1 ? " disabled" : ""}>↓</button><button class="icon-btn danger" data-rm="${esc(it.id)}" aria-label="Remove">✕</button></div>
        </li>`).join("")}</ol>` : `<p class="muted small">No places yet. Search below to add some.</p>`}
      </div>
      <div class="field"><label class="flabel" for="gSearch">Add places</label>
        <input id="gSearch" type="search" placeholder="Search by name, area or type, e.g. sauna Hackney" value="${esc(S.gq)}" autocomplete="off">
        <div id="gResults" class="add-results">${guideSearchResults(g)}</div>
        ${favsToAdd ? `<button class="link" data-act="add-favs">Add your ${favsToAdd} saved ${favsToAdd === 1 ? "place" : "places"}</button>` : ""}
      </div>
      <div class="g-actions"><button class="btn primary" data-act="edit-done">Done</button><button class="link danger" data-act="delete-guide">Delete guide</button></div>
    </div>`;
}
function renderGuides(){
  if (S.guide === "shared" && S.shared) return renderMyGuide(S.shared, true);
  if (S.guide && S.guide.startsWith("my:")){
    const g = myGuide(S.guide.slice(3));
    if (g) return S.editing === g.id ? renderEditor(g) : renderMyGuide(g, false);
    S.guide = null;
  }
  const cg = S.guide && GUIDES.find(x => x.id === S.guide);
  if (cg){
    const vs = cg.items.slice(0, 25);
    return `<button class="back" data-act="guide-back">← All guides</button>
      <header class="view-head"><span class="eyebrow">Guide · ${cg.items.length} places</span><h2>${esc(cg.title)}</h2><p>${esc(cg.blurb)}${cg.items.length > 25 ? " Showing the 25 with the most detail." : ""}</p></header>
      <div class="g-actions"><button class="btn" data-act="copy-curated">Make my own copy</button></div>
      <ol class="list guide-list">${vs.map((v, i) => `<li><span class="gnum">${i + 1}</span>${card(v)}</li>`).join("")}</ol>`;
  }
  const favN = [...S.favs].filter(id => BY_ID[id]).length;
  return `<header class="view-head"><span class="eyebrow">Lists you make and lists we make</span><h2>Guides</h2><p>Make your own guide with notes for each stop, then share it. Or start from one of ours.</p></header>
  <section class="saved-sec"><div class="sec-head"><h3>Your guides <span class="muted">${S.myGuides.length}</span></h3></div>
    <div class="guides">
      <button class="guide new" data-act="new-guide"><span class="g-title">+ Create a guide</span><span class="g-blurb">Give it a title, add places in order and write a note for each.</span></button>
      ${favN ? `<button class="guide new" data-act="guide-from-favs"><span class="g-title">Make one from your saved places</span><span class="g-blurb">Starts a guide with your ${favN} saved ${favN === 1 ? "place" : "places"}.</span></button>` : ""}
      ${S.myGuides.map(guideTile).join("")}
    </div></section>
  <section class="saved-sec"><div class="sec-head"><h3>From Hale</h3></div>
  <div class="guides">${GUIDES.map(g => `<button class="guide" data-guide="${g.id}" style="--c:var(--c-${g.tone})">
      <span class="g-count">${g.items.length} places</span><span class="g-title">${esc(g.title)}</span><span class="g-blurb">${esc(g.blurb)}</span>
      <span class="g-names">${g.items.slice(0, 3).map(v => esc(v.name)).join(" · ")}</span></button>`).join("")}</div></section>`;
}
function renderSaved(){
  const favs = VENUES.filter(v => S.favs.has(v.id));
  return `<header class="view-head"><span class="eyebrow">Stored in this browser</span><h2>Saved</h2><p>Tap the heart on any place to save it. To put places in order with notes, make a guide.</p></header>
  <section class="saved-sec"><div class="sec-head"><h3>Saved places <span class="muted">${favs.length}</span></h3>${favs.length ? `<span><button class="link" data-act="guide-from-favs">Make a guide from these</button> · <button class="link" data-copy="favs">Copy as text</button></span>` : ""}</div>
    <div class="list">${favs.length ? favs.map(v => card(v)).join("") : `<div class="empty"><p>No saved places yet. Tap the heart on any place to keep it here.</p></div>`}</div></section>
  <p class="copy-status" id="copyStatus" aria-live="polite"></p>`;
}
function renderBusiness(){
  const views = [42,51,48,63,70,66,81,77,92,88,104,97,118,126];
  const max = Math.max(...views), W = 280, Hh = 64;
  const y = n => (Hh - 6 - n / max * (Hh - 14)).toFixed(1);
  const pts = views.map((n, i) => `${(i / (views.length - 1) * W).toFixed(1)},${y(n)}`).join(" ");
  const counts = {}; VENUES.forEach(v => counts[v.cat] = (counts[v.cat] || 0) + 1);
  return `<div class="biz">
  <header class="view-head wide"><span class="eyebrow">For studios, clinics, cafés and spas</span><h2>Get found by people looking for you</h2>
    <p>Hale maps ${VENUES.length.toLocaleString("en-GB")} wellness places across London's 33 boroughs, starting from OpenStreetMap. Claim your listing to add photos, prices and classes, keep your hours right, and see how many people find you.</p></header>
  <div class="plans">
    <div class="plan"><h3>Listed</h3><p class="price">Free</p><ul><li>Name, hours, address and links</li><li>Shown on the map and in search</li><li>Edit your details any time</li></ul></div>
    <div class="plan hi"><h3>Featured</h3><p class="price">£49<span>/month</span></p><ul><li>Photos, prices and a full description</li><li>Intro offers and events</li><li>Monthly stats: views, clicks, saves</li><li>Higher placement in your area</li></ul></div>
    <div class="plan"><h3>Partner</h3><p class="price">Coming soon</p><ul><li>Live class and appointment availability</li><li>Connect Mindbody, Glofox, Cliniko and others</li><li>Commission only on bookings</li></ul></div>
  </div>
  <div class="biz-grid">
    <form id="claimForm" class="claim">
      <h3>Add a missing place</h3>
      <p class="muted small">Not on the map yet? Add it here. Submissions are reviewed before they appear for everyone.</p>
      <label class="field"><span class="flabel">Business name</span><input id="cName" required maxlength="60" placeholder="Your business name"></label>
      <div class="two">
        <label class="field"><span class="flabel">Type</span><select id="cCat">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join("")}</select></label>
        <label class="field"><span class="flabel">What you offer</span><input id="cSub" maxlength="30" placeholder="e.g. Reformer Pilates"></label>
      </div>
      <label class="field"><span class="flabel">Nearest station</span><input id="cSt" list="stationList2" placeholder="e.g. Angel"><datalist id="stationList2">${stationOptions()}</datalist></label>
      <label class="field"><span class="flabel">Address</span><input id="cAddr" maxlength="80" placeholder="Street and postcode"></label>
      <label class="field"><span class="flabel">Website</span><input id="cWeb" type="url" maxlength="120" placeholder="https://"></label>
      <fieldset class="field"><legend class="flabel">Good for</legend><div class="chips small">${Object.entries(NEEDS).map(([k, l]) => `<label class="chk"><input type="checkbox" name="cNeed" value="${k}"> ${l}</label>`).join("")}</div></fieldset>
      <label class="chk wide"><input type="checkbox" id="cWc"> Step-free access</label>
      <button class="btn primary" type="submit">Submit for review</button>
      <p class="form-msg" id="claimMsg" aria-live="polite"></p>
    </form>
    <div class="biz-side">
      <div class="preview-box"><span class="eyebrow">Live preview</span><div id="claimPreview"></div></div>
      <div class="stats"><span class="eyebrow">What Featured listings see (example figures)</span>
        <div class="stat-row"><div><b>1,173</b><span>listing views</span></div><div><b>214</b><span>website clicks</span></div><div><b>96</b><span>saves</span></div></div>
        <svg viewBox="0 0 ${W} ${Hh}" class="spark" role="img" aria-label="Example: listing views rising over 14 weeks, from 42 to 126 a week">
          <polygon points="0,${Hh} ${pts} ${W},${Hh}" class="spark-fill"/><polyline points="${pts}" class="spark-line"/>
          <circle cx="${W}" cy="${y(views[views.length-1])}" r="3.5" class="spark-dot"/></svg>
        <p class="muted small">Weekly listing views, last 14 weeks (illustration only)</p></div>
      <div class="stats"><span class="eyebrow">On the map today</span>
        <div class="coverage">${Object.entries(CATEGORIES).map(([k, cdef]) => `<div>${catDot(k)}<span>${cdef.label}</span><b>${(counts[k] || 0).toLocaleString("en-GB")}</b></div>`).join("")}</div></div>
    </div>
  </div></div>`;
}
function hoursTable(v){
  const now = londonNow();
  if (!v.hours) return v.ohRaw ? `<p class="raw">${esc(v.ohRaw)}</p><p class="muted small">Shown as recorded on OpenStreetMap.</p>` : `<p class="muted">No opening hours recorded. Check the venue's website.</p>`;
  return `<table class="htable">${DAYS.map((d, i) => `<tr class="${i === now.day ? "today" : ""}"><td>${d}${i === now.day ? " (today)" : ""}</td><td>${(v.hours[i] || []).length ? v.hours[i].map(([o, c]) => o === "00:00" && c === "24:00" ? "24 hours" : o + "–" + c).join(", ") : "Closed"}</td></tr>`).join("")}</table>`;
}
function renderDetail(){
  const v = BY_ID[S.detail]; if (!v) return "";
  const st = status(v), w = walkMins(v);
  const near = VENUES.filter(x => x.id !== v.id).map(x => [x, metres([v.lat, v.lng], [x.lat, x.lng])]).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${v.lat.toFixed(5)},${v.lng.toFixed(5)}&travelmode=transit`;
  const search = `https://www.google.com/search?q=${encodeURIComponent(v.name + " " + (v.addr || v.borough) + " London")}`;
  return `<div class="detail" role="dialog" aria-label="${esc(v.name)}">
    <div class="d-bar"><button class="back" data-act="close-detail">← Back</button>${heart(v.id)}</div>
    <header class="d-head" style="--c:var(--c-${v.cat})">
      <span class="eyebrow">${catDot(v.cat)} ${CATEGORIES[v.cat].one} · ${esc(v.sub)}</span>
      <h2>${esc(v.name)}${v.branch ? ` <span class="branch">${esc(v.branch)}</span>` : ""}</h2>
      <div class="meta"><span>${esc(v.borough)}${v.region ? " · " + v.region + " London" : ""}</span><span class="${st.open ? (st.soon ? "warn" : "ok") : "muted"}">${st.text}</span></div>
    </header>
    <div class="pills">${badges(v)}</div>
    <div class="d-actions">
      ${v.web ? `<a class="btn primary" href="${esc(v.web)}" target="_blank" rel="noopener">Visit website ↗</a>` : `<a class="btn primary" href="${search}" target="_blank" rel="noopener">Search the web ↗</a>`}
      <a class="btn" href="${gmaps}" target="_blank" rel="noopener">Directions ↗</a>
    </div>
    <section class="d-sec"><h4>Details</h4>
      <dl class="facts">
      ${v.addr ? `<dt>Address</dt><dd>${esc(v.addr)}</dd>` : ""}
      ${v.web ? `<dt>Website</dt><dd class="wrap">${esc(v.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</dd>` : ""}
      ${v.phone ? `<dt>Phone</dt><dd><span class="sel">${esc(v.phone)}</span> <button class="link" data-copyphone="${esc(v.phone)}">Copy</button></dd>` : ""}
      <dt>Nearest station</dt><dd>${esc(v.st)}, about ${v.stWalk} min walk</dd>
      ${w != null ? `<dt>From ${esc(originPoint().label)}</dt><dd>${walkText(w)}</dd>` : ""}
      <dt>Access</dt><dd>${v.wc === "yes" ? "Step-free (wheelchair accessible)" : v.wc === "limited" ? "Partly step-free" : v.wc === "no" ? "Not step-free" : "Not recorded. Check with the venue."}</dd>
      ${v.chain ? `<dt>Part of</dt><dd>${typeof v.chain === "string" ? esc(v.chain) : "A chain or group"}</dd>` : ""}
      </dl><p class="copy-status" id="copyStatus" aria-live="polite"></p></section>
    <section class="d-sec"><h4>Opening hours</h4>${hoursTable(v)}</section>
    ${v.needs.length ? `<section class="d-sec"><h4>Typically good for</h4><div class="chips small">${v.needs.map(n => `<button class="chip" data-goneed="${n}">${NEEDS[n]}</button>`).join("")}</div><p class="muted small">Based on the type of place, not on this venue's own claims.</p></section>` : ""}
    <section class="d-sec"><h4>Add to a guide</h4>
      ${S.myGuides.length ? `<div class="addlist">${S.myGuides.map(g => chip(esc(g.name), g.items.some(it => it.id === v.id), `data-toguide="${esc(g.id)}"`)).join("")}</div>` : ""}
      <form class="ask-row" id="quickGuide"><input id="quickGuideName" placeholder="New guide, e.g. Sunday reset" maxlength="80" aria-label="New guide name"><button class="btn">Create & add</button></form></section>
    <section class="d-sec"><h4>Nearby</h4><div class="list">${near.map(([x]) => card(x)).join("")}</div></section>
    ${v.osm && !v.src ? `<p class="source">Listing from <a href="${esc(v.osm)}" target="_blank" rel="noopener">OpenStreetMap</a>. Something wrong? You can fix it there and it will flow through to Hale.</p>` : v.src ? `<p class="source">Club details from ${esc(v.src)}'s own website.</p>` : `<p class="source">Submitted through Hale, pending review.</p>`}
  </div>`;
}
let panelScroll = {};
function renderPanel(){
  const p = $("#panel");
  const key = S.detail ? "d:" + S.detail : S.view + (S.guide || "") + (S.editing ? ":edit" : "");
  const prevKey = p.dataset.key;
  if (prevKey) panelScroll[prevKey] = p.scrollTop;
  const ae = document.activeElement, focusId = ae && ae.id;
  let selStart = null; try { selStart = ae && ae.selectionStart; } catch(e){}
  let html;
  if (S.detail) html = renderDetail();
  else if (S.view === "guides") html = renderGuides();
  else if (S.view === "saved") html = renderSaved();
  else if (S.view === "business") html = renderBusiness();
  else html = renderExplore();
  p.innerHTML = html;
  p.dataset.key = key;
  p.scrollTop = panelScroll[key] || 0;
  if (focusId){ const el = document.getElementById(focusId); if (el){ el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch(e){} } }
  if (S.view === "business" && !S.detail) updatePreview();
}
function renderAll(fit){ renderTabs(); renderPanel(); renderMap(fit); }

/* ---------- navigation ---------- */
function setView(v, push=true){
  S.view = v; S.detail = null;
  if (v !== "guides"){ S.guide = null; S.editing = null; }
  if (push){ try { history.pushState(null, "", "#" + v); } catch(e){} }
}
function openGuide(id, edit){
  S.view = "guides"; S.detail = null; S.guide = "my:" + id; S.editing = edit ? id : null;
  try { history.pushState(null, "", "#" + (edit ? "edit-" : "my-") + id); } catch(e){}
  lastSetKey = ""; renderAll(true); $("#panel").scrollTop = 0; window.scrollTo(0, 0);
}
function openDetail(id, push=true){
  if (!BY_ID[id]) return;
  const prev = S.detail; S.detail = id;
  if (push){ try { history.pushState(null, "", "#v-" + id); } catch(e){} }
  renderTabs(); renderPanel();
  $("#panel").scrollTop = 0; window.scrollTo(0, 0);
  if (prev) highlight(prev, false);
  if (!markers[id]){ lastSetKey = ""; renderMap(); }
  const v = BY_ID[id], m = markers[id];
  if (map){
    map.once("moveend", () => highlight(id, true));
    map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), TILES ? 16 : 15), {duration:0.6});
    highlight(id, true);
  }
  document.body.classList.remove("show-map"); updateMapToggle();
}
function closeDetail(){
  const id = S.detail; S.detail = null;
  if (id) highlight(id, false);
  try { history.pushState(null, "", "#" + S.view); } catch(e){}
  renderAll();
}
function fromHash(){
  const h = (location.hash || "").slice(1);
  if (h.startsWith("v-") && BY_ID[h.slice(2)]) S.detail = h.slice(2);
  else if (["explore","guides","saved","business"].includes(h)){ S.view = h; S.detail = null; S.guide = null; S.editing = null; }
  else if (h.startsWith("g-") && GUIDES.some(g => g.id === h.slice(2))){ S.view = "guides"; S.guide = h.slice(2); S.editing = null; S.detail = null; }
  else if (h.startsWith("my-") && myGuide(h.slice(3))){ S.view = "guides"; S.guide = "my:" + h.slice(3); S.editing = null; S.detail = null; }
  else if (h.startsWith("edit-") && myGuide(h.slice(5))){ S.view = "guides"; S.guide = "my:" + h.slice(5); S.editing = h.slice(5); S.detail = null; }
  else if (h.startsWith("share=")){ const g = decodeShare(h.slice(6)); if (g){ S.shared = g; S.view = "guides"; S.guide = "shared"; S.editing = null; S.detail = null; } }
  else S.detail = null;
}

/* ---------- concierge ---------- */
const CHAIN_NAMES = new Set(VENUES.map(v => typeof v.chain === "string" ? v.chain.toLowerCase() : "").filter(Boolean));
const VENUE_NAMES = [...new Set(VENUES.flatMap(v => [v.name.toLowerCase(), typeof v.chain === "string" ? v.chain.toLowerCase() : ""]).filter(Boolean))];
const SYN = [
  [/back|neck|spine|sciatica|posture/, "back-pain"],[/injur|rehab|sprain|knee|ankle|hamstring|shoulder/, "injury"],
  [/\brun(ning|ner)?\b|marathon|\b5k\b|\b10k\b/, "running"],[/stress|anxi|burn ?out|overwhelm|calm|unwind|relax|switch off|decompress/, "stress"],
  [/sleep|insomnia/, "sleep"],[/energy|fatigue|tired|exhaust/, "energy"],
  [/gut|ibs|bloat|digest/, "gut-health"],[/strength|strong|lift|weights/, "strength"],
  [/flexib|mobility|stiff|stretch/, "flexibility"],[/recover|sore muscles|cold plunge|ice bath/, "recovery"],
  [/social|meet people|friends|lonely|new to london/, "social"],[/sober|alcohol.free|not drinking|dry january/, "sober"],[/focus|concentrat/, "focus"]
];
const SUBWORDS = [
  [/physio/, "Physiotherapy"],[/osteo/, "Osteopathy"],[/chiro/, "Chiropractic"],[/acupunct/, "Acupuncture"],[/podiatr|\bfoot\b|\bfeet\b/, "Podiatry"],
  [/dietitian|nutrition/, "Nutrition & dietetics"],[/counsel|therapist|therapy|psycholog|\bcbt\b|talk to someone/, "Counselling & therapy"],[/meditat|buddhis/, "Meditation centre"],
  [/\bgym\b/, "Gym"],[/boutique|spin|cycling class|\bride\b|hiit|bootcamp/, "Boutique studio"],[/yoga/, "Yoga"],[/pilates|reformer/, "Pilates"],[/climb|boulder/, "Climbing"],[/boxing|martial|karate|judo|jiu|kickbox|muay/, "Boxing & martial arts"],[/\bdanc/, "Dance"],
  [/lido|pond|outdoor swim|wild swim/, "Lido & open water"],[/\bswim|\bpool\b/, "Swimming pool"],[/sauna|bathhouse|steam room|hammam|banya/, "Sauna & bathhouse"],[/\bspa\b/, "Spa"],[/massage/, "Sports & remedial massage"],
  [/vegan/, "Vegan"],[/vegetarian/, "Vegetarian"],[/juice|smoothie/, "Juice & smoothies"],[/salad|poke|healthy (lunch|food|eat)/, "Healthy food"],[/health food|wholefood/, "Health food shop"],[/alcohol.free bar|mocktail/, "Alcohol-free bar"]
];
const CATWORDS = [[/lunch|brunch|breakfast|dinner|\beat\b|food|caf[eé]|coffee/, "eat"],[/class|workout|exercise|train/, "move"],[/clinic|doctor|\bgp\b/, "clinic"]];
function parseQuery(q){
  const t = q.toLowerCase();
  const f = DEFAULT_FILTERS(); const bits = []; let origin = null;
  SUBWORDS.forEach(([re, sub]) => { if (re.test(t) && !f.subs.includes(sub) && !(sub === "Swimming pool" && f.subs.includes("Lido & open water"))){ f.subs.push(sub); bits.push(sub); } });
  if (f.subs.includes("Vegan")){ f.subs = f.subs.filter(s => s !== "Vegan"); f.vegan = true; bits[bits.indexOf("Vegan")] = "vegan"; f.cats.push("eat"); }
  if (!f.subs.length){
    SYN.forEach(([re, val]) => { if (re.test(t) && !f.needs.includes(val)){ f.needs.push(val); bits.push(NEEDS[val]); } });
    CATWORDS.forEach(([re, cat]) => { if (re.test(t) && !f.cats.includes(cat)){ f.cats.push(cat); bits.push(CATEGORIES[cat].label); } });
  }
  if (/open now|right now|\bnow\b/.test(t)){ f.openNow = true; bits.push("open now"); }
  if (/wheelchair|step.?free|accessible/.test(t)){ f.stepFree = true; bits.push("step-free"); }
  if (/independent|not a chain/.test(t)){ f.indie = true; bits.push("independent"); }
  let nearBranch = null;
  // A venue or brand name in the request ("Third Space near Bank") becomes a name search.
  const GENERIC = new Set(["the gym", "gym", "yoga", "spa", "sauna", "pilates", "physio", "physiotherapy", "fitness", "the yoga studio", "health food"]);
  let nameHit = null;
  const plain = x => x.replace(/['’]/g, "");
  const tp = plain(t);
  for (const n of VENUE_NAMES){ if (n.length >= 5 && !GENERIC.has(n) && (n.includes(" ") || n.length >= 7 || CHAIN_NAMES.has(n)) && new RegExp("\\b" + plain(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(tp) && (!nameHit || n.length > nameHit.length)) nameHit = n; }
  if (!nameHit){ const tsq = tp.replace(/[^a-z0-9]/g, ""); for (const n of CHAIN_NAMES){ const nsq = n.replace(/[^a-z0-9]/g, ""); if (nsq.length >= 5 && !GENERIC.has(n) && tsq.includes(nsq) && (!nameHit || n.length > nameHit.length)) nameHit = n; } }
  if (nameHit){
    const branches = VENUES.filter(v => v.branch && (v.name.toLowerCase() === nameHit || (typeof v.chain === "string" && v.chain.toLowerCase() === nameHit)));
    const esc2 = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const said = branches.filter(v => tp.includes(plain(v.branch.toLowerCase()))).sort((a, b) => b.branch.length - a.branch.length)[0];
    if (said){
      const bl = plain(said.branch.toLowerCase());
      if (new RegExp("(near|by|close to|around|from)\\s+(the\\s+)?" + esc2(bl)).test(tp)) nearBranch = said;
      else nameHit = nameHit + " " + bl;
    }
  }
  if (nameHit){ f.q = nameHit; f.subs = []; f.cats = []; f.needs = []; f.vegan = false; bits.length = 0; bits.push("places called “" + (VENUES.find(v => nameHit.startsWith(v.name.toLowerCase()) || (typeof v.chain === "string" && nameHit.startsWith(v.chain.toLowerCase()))).name + (nameHit.includes(" ") && !VENUE_NAMES.includes(nameHit) ? " " + nameHit.split(" ").slice(-1)[0].replace(/^./, c => c.toUpperCase()) : "")) + "”"); if (/open now|right now|\bnow\b/.test(t)){ f.openNow = true; bits.push("open now"); } }
  let best = null;
  for (const [k, s] of Object.entries(STATIONS)){
    const n = s[0].toLowerCase(); if (n.length < 4) continue;
    if (new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t) && (!best || n.length > best[1].length)) best = [k, n];
  }
  const b = Object.keys(regionOf).find(b => new RegExp("\\b" + b.toLowerCase().replace(/ upon thames| and .*/, "") + "\\b").test(t));
  if (b && (!best || /\bin\b/.test(t.slice(Math.max(0, t.indexOf(b.toLowerCase().split(" ")[0]) - 4))))){ f.borough = b; bits.push("in " + b); }
  else if (nearBranch && !(best && t.includes(STATIONS[best[0]][0].toLowerCase()) && STATIONS[best[0]][0].length > nearBranch.branch.length)){ origin = {lat: nearBranch.lat, lng: nearBranch.lng, label: nearBranch.name + " " + nearBranch.branch}; bits.push("near " + nearBranch.name + " " + nearBranch.branch); }
  else if (best){ origin = {key: best[0]}; bits.push("near " + STATIONS[best[0]][0]); }
  else for (const r of Object.keys(REGIONS)) if (new RegExp("\\b" + r.toLowerCase() + "\\b").test(t)){ f.region = r; bits.push(r + " London"); break; }
  return { f, origin, bits };
}
let sampleFn = null, conciergeCtl = null;
async function runConcierge(q){
  q = q.trim(); if (!q) return;
  const { f, origin, bits } = parseQuery(q);
  S.f = f; S.shown = PAGE; S.inView = false;
  if (origin){ S.origin = origin; S.sort = "nearest"; saveLocal(); } else if (S.sort === "nearest" && !originPoint()) S.sort = "recommended";
  let relaxed = "";
  const any = () => VENUES.some(v => matches(v, S.f));
  if (!any() && S.f.openNow){ S.f.openNow = false; relaxed = "Nothing with recorded hours is open right now, so closed places are included."; }
  if (!any() && S.f.subs.length > 1) S.f.subs = S.f.subs.slice(0, 1);
  if (!any() && (S.f.borough || S.f.region)){ S.f.borough = ""; S.f.region = ""; relaxed += " I widened the search to all of London."; }
  S.concierge = { query:q, understood: bits.length ? "Filtered for " + bits.map(esc).join(", ") + "." + (relaxed ? " " + relaxed : "") : "I couldn't pick out specific filters, so here's everything, most detailed first.", picks:null, loading: !!sampleFn };
  setView("explore"); lastSetKey = ""; renderAll(true);
  if (!sampleFn) return;
  if (conciergeCtl) conciergeCtl.abort();
  const ctl = conciergeCtl = new AbortController();
  const cands = filtered().slice(0, 120);
  if (!cands.length){ S.concierge.loading = false; renderPanel(); return; }
  const o = originPoint();
  const catalog = cands.map(v => [v.id, v.name + (v.branch ? " (" + v.branch + ")" : ""), v.sub, v.borough, v.addr || "", "near " + v.st + (o ? " (" + walkText(walkMins(v)) + " from the visitor)" : ""), status(v).text,
    [v.web && "has website", v.wc === "yes" && "step-free", v.vegan && "vegan " + v.vegan, v.chain ? "chain: " + (typeof v.chain === "string" ? v.chain : "yes") : "independent"].filter(Boolean).join(", ")].join(" | ")).join("\n");
  const prompt = `You are the concierge for Hale, a map of wellness places in London built from OpenStreetMap data. A visitor wrote: "${q}".
From the candidate places below (already filtered to roughly match), choose the 3 to 5 that best fit the request. Respect location, timing and access needs. Only use facts given in the list: there are no prices, ratings or reviews, so never mention or guess any. If they describe a medical problem, suggest seeing a registered clinician and do not diagnose.
Reply with JSON only, in this exact shape:
{"reply": "<one or two friendly, plain sentences>", "picks": [{"id": "<id from the list>", "why": "<one short factual sentence>"}]}

Candidates (id | name | type | borough | address | location | hours now | details):
${catalog}`;
  try {
    const out = await sampleFn.json(prompt, { signal: ctl.signal, modelTier: "default" });
    if (ctl.signal.aborted || !S.concierge || S.concierge.query !== q) return;
    const picks = (out && Array.isArray(out.picks) ? out.picks : []).filter(p => p && BY_ID[p.id]).slice(0, 5).map(p => ({id:p.id, why:String(p.why || "").slice(0, 200)}));
    S.concierge = { ...S.concierge, loading:false, reply: out && out.reply ? String(out.reply).slice(0, 400) : "", picks };
    lastSetKey = ""; renderAll(true);
  } catch(e){
    if (e && e.code === "cancelled") return;
    if (!S.concierge || S.concierge.query !== q) return;
    const msg = e && e.code === "not_granted" ? "Personal picks need permission to use Claude. The filtered results below still apply."
      : e && e.code === "rate_limited" ? "The concierge is busy. Try again in a minute; the filtered results below still apply."
      : "Personal picks aren't available right now. The filtered results below still apply.";
    if (e && e.code === "not_granted") sampleFn = null;
    S.concierge = { ...S.concierge, loading:false, error: msg };
    renderPanel();
  }
}

/* ---------- business form ---------- */
function stationKeyByName(n){ n = (n || "").trim().toLowerCase(); return Object.keys(STATIONS).find(k => STATIONS[k][0].toLowerCase() === n); }
function claimRecord(){
  const name = $("#cName").value.trim() || "Your business";
  const id = "new-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "place");
  const sk = stationKeyByName($("#cSt").value) || Object.keys(STATIONS).find(k => STATIONS[k][0] === "Angel") || Object.keys(STATIONS)[0];
  const s = STATIONS[sk];
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const lat = s[1] + ((seed % 37) - 18) / 10000, lng = s[2] + ((seed % 53) - 26) / 10000;
  const cat = $("#cCat").value;
  const r = { id, name, cat, sub: $("#cSub").value.trim() || CATEGORIES[cat].one, lat, lng, borough: boroughAt(lat, lng) || "London",
    st: s[0], stWalk: 4, needs: $$('input[name="cNeed"]:checked').map(i => i.value).slice(0, 4) };
  const web = $("#cWeb").value.trim(); if (/^https?:\/\/\S+\.\S+/.test(web)) r.web = web;
  const addr = $("#cAddr").value.trim(); if (addr) r.addr = addr;
  if ($("#cWc").checked) r.wc = "yes";
  return r;
}
function updatePreview(){
  const box = $("#claimPreview"); if (!box) return;
  const r = claimRecord();
  box.innerHTML = card({...r, pending:1, region: regionOf[r.borough] || "", complete:0}).replace('class="heart', 'disabled class="heart').replace('tabindex="0"', "");
}

/* ---------- events wiring ---------- */
function copyText(text, label){
  const el = $("#copyStatus");
  const done = ok => { if (!el) return; el.textContent = ok ? (label || "Copied to clipboard.") : "Couldn't copy automatically. Select the text below and copy it."; if (!ok){ el.innerHTML += `<textarea class="copy-fallback" rows="5" readonly>${esc(text)}</textarea>`; el.querySelector("textarea").select(); } };
  try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch(e){ done(false); }
}
function listText(name, ids){
  return name + "\n" + ids.map(id => BY_ID[id]).filter(Boolean).map(v => `• ${v.name}: ${v.sub}, ${v.addr || v.borough}${v.web ? " " + v.web : ""}`).join("\n");
}
function toggleFav(id){
  if (S.favs.has(id)) S.favs.delete(id); else S.favs.add(id);
  saveLocal();
  $$(`[data-fav="${CSS.escape(id)}"]`).forEach(b => { const on = S.favs.has(id); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Remove from saved" : "Save"); });
  renderTabs();
  if (S.view === "saved" && !S.detail){ renderPanel(); lastSetKey = ""; renderMap(); }
}
function resetFilters(){ S.f = DEFAULT_FILTERS(); S.concierge = null; S.inView = false; S.shown = PAGE; }
const refilter = () => { S.concierge = null; S.shown = PAGE; renderAll(); };

document.addEventListener("click", e => {
  const t = e.target.closest("button, [data-venue], a");
  if (!t || t.matches("a")) return;
  const d = t.dataset;
  if (d.fav){ e.stopPropagation(); toggleFav(d.fav); return; }
  if (t.classList.contains("tab")){ setView(d.view); lastSetKey = ""; renderAll(d.view !== "explore"); return; }
  if (d.cat !== undefined && t.closest(".filters")){ const i = S.f.cats.indexOf(d.cat); i < 0 ? S.f.cats.push(d.cat) : S.f.cats.splice(i, 1); S.f.subs = S.f.subs.filter(s => !S.f.cats.length || VENUES.some(v => v.sub === s && S.f.cats.includes(v.cat))); refilter(); return; }
  if (d.sub){ const i = S.f.subs.indexOf(d.sub); i < 0 ? S.f.subs.push(d.sub) : S.f.subs.splice(i, 1); refilter(); return; }
  if (d.need){ const i = S.f.needs.indexOf(d.need); i < 0 ? S.f.needs.push(d.need) : S.f.needs.splice(i, 1); refilter(); return; }
  if (d.flag){ S.f[d.flag] = !S.f[d.flag]; refilter(); return; }
  if (d.region !== undefined){ S.f.region = d.region; S.f.borough = ""; refilter(); if (d.region) fitTo(VENUES.filter(v => v.region === d.region)); else map.flyTo([51.507,-0.125], 11, {duration:0.5}); return; }
  if (d.guide){ S.guide = d.guide; try { history.pushState(null, "", "#g-" + d.guide); } catch(e){} lastSetKey = ""; renderAll(true); $("#panel").scrollTop = 0; return; }
  if (d.eg){ $("#askInput").value = d.eg; runConcierge(d.eg); return; }
  if (d.goneed){ setView("explore"); resetFilters(); S.f.needs = [d.goneed]; lastSetKey = ""; renderAll(true); return; }
  if (d.myguide){ openGuide(d.myguide, false); return; }
  if (d.toguide){ const g = myGuide(d.toguide); const i = g.items.findIndex(it => it.id === S.detail); i < 0 ? g.items.push({ id: S.detail, note: "" }) : g.items.splice(i, 1); touch(g); renderPanel(); return; }
  if (d.tone){ const g = currentGuide(); if (g){ g.tone = d.tone; touch(g); renderPanel(); } return; }
  if (d.mv){ const g = currentGuide(); const [id, dir] = d.mv.split(":"); const i = g.items.findIndex(it => it.id === id), j = i + Number(dir); if (i >= 0 && j >= 0 && j < g.items.length){ [g.items[i], g.items[j]] = [g.items[j], g.items[i]]; touch(g); renderPanel(); renderMap(); } return; }
  if (d.rm){ const g = currentGuide(); g.items = g.items.filter(it => it.id !== d.rm); touch(g); renderPanel(); renderMap(); return; }
  if (d.addto){ const g = currentGuide(); if (g && !g.items.some(it => it.id === d.addto)){ g.items.push({ id: d.addto, note: "" }); touch(g); renderPanel(); renderMap(true); const el = $("#gSearch"); if (el) el.focus(); } return; }
  if (d.copy){ if (d.copy === "favs") copyText(listText("My saved places on Hale", [...S.favs])); return; }
  if (d.copyphone){ copyText(d.copyphone, "Phone number copied."); return; }
  if (d.act){
    const a = d.act;
    if (a === "close-detail") closeDetail();
    else if (a === "guide-back"){ S.guide = null; S.editing = null; try { history.pushState(null, "", "#guides"); } catch(e){} lastSetKey = ""; renderAll(); }
    else if (a === "new-guide"){ const g = newGuide("", []); g.name = "My guide"; touch(g); openGuide(g.id, true); setTimeout(() => { const el = $("#gName"); if (el){ el.focus(); el.select(); } }, 30); }
    else if (a === "guide-from-favs"){ const g = newGuide("My saved places", [...S.favs].filter(id => BY_ID[id])); openGuide(g.id, false); }
    else if (a === "copy-curated"){ const cg = GUIDES.find(x => x.id === S.guide); const g = newGuide(cg.title, cg.items.slice(0, 25).map(v => v.id)); g.desc = cg.blurb; g.tone = cg.tone; touch(g); openGuide(g.id, true); }
    else if (a === "edit-guide"){ const g = currentGuide(); if (g) openGuide(g.id, true); }
    else if (a === "edit-done"){ const g = currentGuide(); S.gq = ""; if (g) openGuide(g.id, false); }
    else if (a === "share-guide"){ const g = currentGuide(); if (SHARE) copyText(shareLink(g), "Link copied. Anyone who opens it sees this guide and can save their own copy."); else copyText(guideText(g)); }
    else if (a === "copy-guide"){ copyText(guideText(currentGuide())); }
    else if (a === "delete-guide"){
      if (t.dataset.confirm){ const g = currentGuide(); S.myGuides = S.myGuides.filter(x => x !== g); saveGuides(); S.guide = null; S.editing = null; try { history.pushState(null, "", "#guides"); } catch(e){} lastSetKey = ""; renderAll(); }
      else { t.dataset.confirm = "1"; t.textContent = "Tap again to delete"; setTimeout(() => { if (t.isConnected){ delete t.dataset.confirm; t.textContent = "Delete guide"; } }, 3000); }
    }
    else if (a === "save-shared"){ const sg = S.shared; const g = newGuide(sg.name, []); g.desc = sg.desc; g.tone = sg.tone; g.items = sg.items.filter(it => BY_ID[it.id]).map(it => ({ ...it })); touch(g); S.shared = null; openGuide(g.id, false); }
    else if (a === "add-favs"){ const g = currentGuide(); [...S.favs].filter(id => BY_ID[id] && !g.items.some(it => it.id === id)).forEach(id => g.items.push({ id, note: "" })); touch(g); renderPanel(); renderMap(true); }
    else if (a === "reset"){ resetFilters(); renderAll(); }
    else if (a === "clear-concierge"){ if (conciergeCtl) conciergeCtl.abort(); resetFilters(); lastSetKey = ""; renderAll(); }
    else if (a === "toggle-filters"){ S.showFilters = !S.showFilters; store.set("showFilters", S.showFilters); renderPanel(); }
    else if (a === "more"){ S.shown += PAGE; renderPanel(); }
    else if (a === "clear-origin"){ S.origin = null; if (S.sort === "nearest") S.sort = "recommended"; saveLocal(); renderAll(); }
    else if (a === "pick-origin"){ S.pickOrigin = !S.pickOrigin; map.getContainer().classList.toggle("picking", S.pickOrigin); if (S.pickOrigin){ document.body.classList.add("show-map"); updateMapToggle(); setTimeout(() => map.invalidateSize(), 60); } renderPanel(); }
    else if (a === "theme") cycleTheme();
    else if (a === "toggle-map"){ document.body.classList.toggle("show-map"); setTimeout(() => map.invalidateSize(), 60); updateMapToggle(); }
    return;
  }
  if (d.venue){ openDetail(d.venue); return; }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.matches("article.card")) openDetail(e.target.dataset.venue);
  if (e.key === "Escape" && S.detail) closeDetail();
  if (e.key === "Enter" && e.target.id === "gSearch"){ e.preventDefault(); const b = $("#gResults [data-addto]"); if (b) b.click(); }
});
let hoverId = null, qTimer;
document.addEventListener("mouseover", e => { const c = e.target.closest("[data-venue]"); if (c && c.dataset.venue !== hoverId){ if (hoverId) highlight(hoverId, false); hoverId = c.dataset.venue; highlight(hoverId, true); } });
document.addEventListener("mouseout", e => { const c = e.target.closest("[data-venue]"); if (c && !c.contains(e.relatedTarget) && hoverId){ highlight(hoverId, false); hoverId = null; } });
document.addEventListener("input", e => {
  if (e.target.id === "q"){ clearTimeout(qTimer); qTimer = setTimeout(() => { S.f.q = e.target.value; refilter(); }, 180); }
  if (e.target.closest && e.target.closest("#claimForm")) updatePreview();
  const g = (S.editing && currentGuide()) || null;
  if (g){
    if (e.target.id === "gName"){ g.name = e.target.value.trim() || "Untitled guide"; touch(g); }
    else if (e.target.id === "gDesc"){ g.desc = e.target.value; touch(g); }
    else if (e.target.dataset && e.target.dataset.note){ const it = g.items.find(x => x.id === e.target.dataset.note); if (it){ it.note = e.target.value; touch(g); } }
    else if (e.target.id === "gSearch"){ S.gq = e.target.value; const r = $("#gResults"); if (r) r.innerHTML = guideSearchResults(g); }
  }
});
document.addEventListener("change", e => {
  const id = e.target.id;
  if (id === "borough"){ S.f.borough = e.target.value; S.f.region = ""; refilter(); if (S.f.borough) fitTo(VENUES.filter(v => v.borough === S.f.borough)); }
  else if (id === "originInput"){ const k = stationKeyByName(e.target.value); if (k){ S.origin = {key:k}; S.sort = "nearest"; saveLocal(); renderAll(); map.flyTo([STATIONS[k][1], STATIONS[k][2]], 14.5, {duration:0.5}); } }
  else if (id === "sort"){ S.sort = e.target.value; renderPanel(); }
  else if (id === "inView"){ S.inView = e.target.checked; S.shown = PAGE; renderPanel(); }
  else if (id === "routeToggle"){ S.route = e.target.checked; store.set("route", S.route); renderMap(); }
  else if (e.target.closest("#claimForm")) updatePreview();
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "askForm") runConcierge($("#askInput").value);
  else if (id === "quickGuide"){ const n = $("#quickGuideName").value.trim(); if (!n) return; newGuide(n, [S.detail]); renderPanel(); }
  else if (id === "claimForm"){
    if (!$("#cName").value.trim()){ $("#claimMsg").textContent = "Add the business name first."; return; }
    if (!stationKeyByName($("#cSt").value)){ $("#claimMsg").textContent = "Choose the nearest station from the suggestions so we can place it on the map."; return; }
    const r = claimRecord();
    if (BY_ID[r.id]){ $("#claimMsg").textContent = "You've already submitted a place with that name."; return; }
    const v = addVenue(r, {pending:1});
    const saved = store.get("claimed2", []); saved.push(r); store.set("claimed2", saved);
    $("#claimMsg").innerHTML = `Submitted. <b>${esc(v.name)}</b> shows on your map as “Pending review”. In the live product it would be checked before anyone else sees it. <button class="link" data-venue="${esc(v.id)}">View it</button>`;
    lastSetKey = "";
  }
});
window.addEventListener("popstate", () => { fromHash(); lastSetKey = ""; renderAll(); });

/* ---------- theme ---------- */
function applyTheme(t){
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
  const b = $("#themeBtn"); if (b){ b.textContent = t === "dark" ? "Dark" : t === "light" ? "Light" : "Auto"; b.setAttribute("aria-label", "Theme: " + b.textContent); }
  if (map){ boroughLayer.setStyle(boroughStyle); thames.setStyle({color: cssVar("--map-water")}); setTiles(); }
}
function cycleTheme(){ const cur = store.get("theme", "auto"); const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto"; store.set("theme", next); applyTheme(next); }
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(store.get("theme", "auto"))); } catch(e){}
function updateMapToggle(){ const b = $("#mapToggle"); if (b) b.textContent = document.body.classList.contains("show-map") ? "Show list" : "Show map"; }

/* ---------- boot ---------- */
applyTheme(store.get("theme", "auto"));
fromHash();
initMap();
renderAll();
if (S.detail){ const v = BY_ID[S.detail]; map.setView([v.lat, v.lng], 16); highlight(S.detail, true); }
updateMapToggle();
setInterval(() => { if (!document.activeElement || !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) renderPanel(); }, 60000);
if (window.claude && window.claude.use){
  window.claude.use("sample").then(fn => { sampleFn = fn || null; if (sampleFn && S.view === "explore" && !S.detail) renderPanel(); }).catch(() => {});
}
})();
