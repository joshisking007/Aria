// ============================================================
//  ARIA EXPLORE — Nearby Places  v2
//  Fixes: map init race · auto-load after location · mirror fallbacks
// ============================================================

const ariaExplore = (() => {

  // ── State ──────────────────────────────────────────────────
  let userLat        = null;
  let userLng        = null;
  let locationLabel  = 'detecting location…';
  let locationGranted = false;
  let mapInstance    = null;
  let mapMarkers     = [];
  let userMarker     = null;
  let activeCategory = 'cafe';
  let currentPlaces  = [];
  let ariaContext    = { occasion: null, hurry: null, foodPref: null };
  let contextCollected = false;
  let leafletLoaded  = false;
  let placesLoading  = false;

  // ── Categories ─────────────────────────────────────────────
  const CATEGORIES = [
    { id: 'cafe',        label: 'Cafes',    icon: '☕', osm: ['amenity=cafe','amenity=coffee_shop'] },
    { id: 'restaurant',  label: 'Food',     icon: '🍕', osm: ['amenity=restaurant','amenity=fast_food','amenity=food_court'] },
    { id: 'supermarket', label: 'Grocery',  icon: '🛒', osm: ['shop=supermarket','shop=grocery','shop=convenience'] },
    { id: 'hospital',    label: 'Medical',  icon: '🏥', osm: ['amenity=hospital','amenity=clinic','amenity=pharmacy'] },
    { id: 'gym',         label: 'Gym',      icon: '💪', osm: ['leisure=fitness_centre','leisure=gym','amenity=gym'] },
    { id: 'petrol',      label: 'Petrol',   icon: '⛽', osm: ['amenity=fuel'] },
    { id: 'bank',        label: 'Bank/ATM', icon: '🏧', osm: ['amenity=bank','amenity=atm'] },
    { id: 'hotel',       label: 'Hotels',   icon: '🏨', osm: ['tourism=hotel','tourism=guest_house','tourism=hostel'] },
    { id: 'pharmacy',    label: 'Pharmacy', icon: '💊', osm: ['amenity=pharmacy'] },
    { id: 'bar',         label: 'Bars',     icon: '🍺', osm: ['amenity=bar','amenity=pub'] },
    { id: 'school',      label: 'Schools',  icon: '🏫', osm: ['amenity=school','amenity=university','amenity=college'] },
    { id: 'park',        label: 'Parks',    icon: '🌳', osm: ['leisure=park','leisure=playground'] },
  ];

  // ── Overpass mirrors ────────────────────────────────────────
  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
  ];

  // ── Leaflet loader ─────────────────────────────────────────
  function loadLeaflet() {
    return new Promise((resolve, reject) => {
      if (leafletLoaded && window.L) { resolve(); return; }
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        document.head.appendChild(link);
      }
      if (document.querySelector('script[src*="leaflet.min.js"]') && window.L) {
        leafletLoaded = true; resolve(); return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload  = () => { leafletLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Leaflet failed to load'));
      document.head.appendChild(s);
    });
  }

  // ── Geolocation ────────────────────────────────────────────
  function requestLocation() {
    setLocStatus('loading', 'requesting location…');
    if (!navigator.geolocation) {
      setLocStatus('error', 'geolocation not supported');
      showManualInput();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        locationGranted = true;
        hideBanner();
        setLocStatus('active', '📍 ' + userLat.toFixed(3) + ', ' + userLng.toFixed(3));
        reverseGeocode(userLat, userLng);
        await initMap();
        loadPlaces();
      },
      (err) => {
        let msg = 'location unavailable';
        if (err.code === 1) msg = 'location access denied';
        setLocStatus('error', msg + ' — enter manually');
        showManualInput();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function reverseGeocode(lat, lng) {
    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng)
      .then(function(r){ return r.json(); })
      .then(function(data) {
        const addr  = data.address || {};
        const parts = [addr.suburb || addr.neighbourhood || addr.quarter, addr.city || addr.town || addr.village].filter(Boolean);
        locationLabel = parts.join(', ') || 'your location';
        setLocStatus('active', '📍 ' + locationLabel);
      })
      .catch(function() {
        locationLabel = lat.toFixed(3) + ', ' + lng.toFixed(3);
        setLocStatus('active', '📍 ' + locationLabel);
      });
  }

  function geocodeManual(query) {
    if (!query) return;
    setLocStatus('loading', 'searching for "' + query + '"…');
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&limit=1')
      .then(function(r){ return r.json(); })
      .then(async function(results) {
        if (!results.length) { setLocStatus('error', 'location not found — try again'); return; }
        userLat = parseFloat(results[0].lat);
        userLng = parseFloat(results[0].lon);
        locationLabel = results[0].display_name.split(',').slice(0, 2).join(',').trim();
        locationGranted = true;
        setLocStatus('active', '📍 ' + locationLabel);
        if (mapInstance) moveMapTo(userLat, userLng);
        else await initMap();
        loadPlaces();
      })
      .catch(function(){ setLocStatus('error', 'search failed — check your connection'); });
  }

  // ── Map ────────────────────────────────────────────────────
  async function initMap() {
    try { await loadLeaflet(); }
    catch(e) { console.warn('[Explore] Leaflet load failed:', e); return; }

    const L = window.L;
    const container = document.getElementById('exploreMap');
    if (!container) return;

    if (mapInstance) { try { mapInstance.remove(); } catch(_){} mapInstance = null; }

    container.innerHTML = '<div id="exploreMapInner" style="width:100%;height:100%;"></div>';
    const inner = document.getElementById('exploreMapInner');
    if (!inner) return;

    mapInstance = L.map(inner, {
      center: [userLat || 9.076, userLng || 7.487],
      zoom: 15,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance);
    if (userLat) placeUserMarker();
  }

  function moveMapTo(lat, lng) {
    if (!mapInstance) return;
    mapInstance.setView([lat, lng], 15, { animate: true });
    placeUserMarker();
  }

  function placeUserMarker() {
    if (!mapInstance || !window.L) return;
    if (userMarker) { try { userMarker.remove(); } catch(_){} }
    const icon = window.L.divIcon({
      className: '',
      html: '<div class="explore-user-pulse"></div>',
      iconSize: [16, 16], iconAnchor: [8, 8],
    });
    userMarker = window.L.marker([userLat, userLng], { icon })
      .addTo(mapInstance)
      .bindPopup('<strong style="color:#f97316">You are here</strong>');
  }

  function addPlaceMarkers(places) {
    if (!mapInstance || !window.L) return;
    mapMarkers.forEach(function(m){ try { m.remove(); } catch(_){} });
    mapMarkers = [];
    const cat  = CATEGORIES.find(function(c){ return c.id === activeCategory; });
    const icon = cat ? cat.icon : '📍';
    places.slice(0, 20).forEach(function(p) {
      const mi = window.L.divIcon({
        className: '',
        html: '<div style="width:30px;height:30px;background:var(--card2);border:2px solid rgba(249,115,22,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">' + icon + '</div>',
        iconSize: [30, 30], iconAnchor: [15, 15],
      });
      const m = window.L.marker([p.lat, p.lon], { icon: mi })
        .addTo(mapInstance)
        .bindPopup('<strong>' + p.name + '</strong>' + (p.dist ? '<br><span style="color:#f97316">' + p.dist + '</span>' : ''));
      m.on('click', function(){ openPlaceDetail(p); });
      mapMarkers.push(m);
    });
  }

  // ── Overpass fetch with mirror fallback ────────────────────
  function tryFetch(url, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function(resolve, reject) {
      const ctrl  = new AbortController();
      const timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs);
      fetch(url, { signal: ctrl.signal })
        .then(function(res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(data){ resolve(data.elements || []); })
        .catch(function(e){ clearTimeout(timer); reject(e); });
    });
  }

  async function fetchPlacesOSM(lat, lng, category) {
    const cat = CATEGORIES.find(function(c){ return c.id === category; });
    if (!cat) return [];

    const radius = 2500;
    const parts  = cat.osm.map(function(tag) {
      const kv = tag.split('=');
      const k = kv[0], v = kv[1];
      return 'node["' + k + '"="' + v + '"](around:' + radius + ',' + lat + ',' + lng + ');' +
             'way["'  + k + '"="' + v + '"](around:' + radius + ',' + lat + ',' + lng + ');' +
             'relation["' + k + '"="' + v + '"](around:' + radius + ',' + lat + ',' + lng + ');';
    }).join('');

    const query = '[out:json][timeout:30];(' + parts + ');out center 50;';

    let lastErr;
    for (let i = 0; i < MIRRORS.length; i++) {
      try {
        const url = MIRRORS[i] + '?data=' + encodeURIComponent(query);
        const elements = await tryFetch(url);
        console.log('[Explore] mirror OK:', MIRRORS[i], '→', elements.length, 'results');
        return elements;
      } catch(e) {
        console.warn('[Explore] mirror failed:', MIRRORS[i], e.message);
        lastErr = e;
      }
    }
    throw lastErr || new Error('All mirrors failed');
  }

  // ── Distance helpers ───────────────────────────────────────
  function calcDist(lat1, lng1, lat2, lng2) {
    const d = calcDistM(lat1, lng1, lat2, lng2);
    return d < 1000 ? Math.round(d) + 'm' : (d / 1000).toFixed(1) + 'km';
  }
  function calcDistM(lat1, lng1, lat2, lng2) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function normalisePlaces(elements) {
    return elements
      .map(function(el) {
        const tags = el.tags || {};
        const lat  = el.lat  || (el.center && el.center.lat);
        const lon  = el.lon  || (el.center && el.center.lon);
        if (!lat || !lon) return null;
        return {
          id: el.id,
          name:       tags.name || tags['name:en'] || 'Unnamed Place',
          lat: lat, lon: lon,
          dist:       userLat ? calcDist(userLat, userLng, lat, lon) : null,
          distM:      userLat ? calcDistM(userLat, userLng, lat, lon) : 999999,
          phone:      tags.phone    || tags['contact:phone']   || null,
          website:    tags.website  || tags['contact:website'] || null,
          address:    [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || null,
          opening:    tags.opening_hours || null,
          cuisine:    tags.cuisine       || null,
          wheelchair: tags.wheelchair    || null,
          tags: tags,
        };
      })
      .filter(Boolean)
      .sort(function(a, b){ return a.distM - b.distM; });
  }

  // ── Load places ─────────────────────────────────────────────
  async function loadPlaces() {
    if (!userLat) { if (typeof showToast === 'function') showToast('share your location first'); return; }
    if (placesLoading) return;
    placesLoading = true;
    showSkeletons();
    try {
      const raw = await fetchPlacesOSM(userLat, userLng, activeCategory);
      currentPlaces = normalisePlaces(raw);
      renderPlacesList(currentPlaces);
      addPlaceMarkers(currentPlaces);
    } catch(e) {
      console.error('[Explore] load error:', e);
      const list = document.getElementById('explorePlacesList');
      if (list) list.innerHTML =
        '<div class="explore-empty">' +
          '<div class="explore-empty-icon">📡</div>' +
          '<div class="explore-empty-text">couldn\'t reach map servers.<br>' +
          '<span style="font-size:11px;color:var(--muted);">try WiFi or tap retry.</span><br><br>' +
          '<span onclick="ariaExplore.loadPlaces()" style="color:var(--rose);font-size:13px;cursor:pointer;">↻ tap to retry</span>' +
          '</div></div>';
    } finally {
      placesLoading = false;
    }
  }

  function showSkeletons() {
    const list = document.getElementById('explorePlacesList');
    if (!list) return;
    const skel = '<div class="explore-skeleton"><div class="skel-icon"></div><div class="skel-body"><div class="skel-line"></div><div class="skel-line short"></div></div></div>';
    list.innerHTML = skel + skel + skel + skel + skel;
  }

  // ── Render list ─────────────────────────────────────────────
  function renderPlacesList(places) {
    const list = document.getElementById('explorePlacesList');
    if (!list) return;
    const cat  = CATEGORIES.find(function(c){ return c.id === activeCategory; });
    const icon = cat ? cat.icon : '📍';
    const topPick = places.find(function(p){ return p.name !== 'Unnamed Place'; });

    if (!places.length) {
      list.innerHTML = '<div class="explore-empty"><div class="explore-empty-icon">' + icon + '</div><div class="explore-empty-text">no ' + (cat ? cat.label.toLowerCase() : 'places') + ' found nearby.<br>try a wider search or another category.</div></div>';
      return;
    }

    list.innerHTML = places.slice(0, 25).map(function(p, i) {
      const isTop   = topPick && p.id === topPick.id && ariaContext.occasion;
      const encoded = encodeURIComponent(JSON.stringify(p));
      return '<div class="explore-place-card" onclick="ariaExplore.openPlaceDetailEncoded(\'' + encoded + '\')" style="animation-delay:' + (i * 0.04) + 's">' +
        '<div class="explore-place-icon">' + icon + '</div>' +
        '<div class="explore-place-body">' +
          '<div class="explore-place-name">' + p.name + '</div>' +
          '<div class="explore-place-meta">' +
            (p.dist    ? '<span class="explore-place-dist">' + p.dist + '</span>' : '') +
            (p.address ? '<span>· ' + p.address + '</span>' : '') +
            (p.cuisine ? '<span>· ' + p.cuisine + '</span>' : '') +
          '</div>' +
          (isTop ? '<div class="explore-aria-pick">✦ aria\'s pick</div>' : '') +
        '</div>' +
        '<div class="explore-place-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>' +
      '</div>';
    }).join('');
  }

  // ── Place detail ────────────────────────────────────────────
  function openPlaceDetailEncoded(encoded) {
    try { openPlaceDetail(JSON.parse(decodeURIComponent(encoded))); } catch(e) { console.error(e); }
  }

  function openPlaceDetail(place) {
    const cat      = CATEGORIES.find(function(c){ return c.id === activeCategory; });
    const icon     = cat ? cat.icon : '📍';
    const ariaNote = buildAriaNote(place);
    const mapsUrl  = 'https://www.google.com/maps/dir/?api=1&destination=' + place.lat + ',' + place.lon;
    const osmUrl   = 'https://www.openstreetmap.org/?mlat=' + place.lat + '&mlon=' + place.lon + '#map=17/' + place.lat + '/' + place.lon;
    const body     = document.getElementById('explorePlaceDetailBody');
    if (!body) return;
    body.innerHTML =
      '<div class="explore-detail-header">' +
        '<div class="explore-detail-icon">' + icon + '</div>' +
        '<div><div class="explore-detail-name">' + place.name + '</div>' +
        '<div class="explore-detail-type">' + (cat ? cat.label : activeCategory) + '</div></div>' +
      '</div>' +
      '<div class="explore-detail-meta">' +
        (place.dist    ? '<div class="explore-detail-pill rose">📍 ' + place.dist + ' away</div>' : '') +
        (place.opening ? '<div class="explore-detail-pill green">🕐 ' + place.opening.split(';')[0] + '</div>' : '') +
        (place.phone   ? '<div class="explore-detail-pill">📞 ' + place.phone + '</div>' : '') +
        (place.wheelchair === 'yes' ? '<div class="explore-detail-pill">♿ accessible</div>' : '') +
      '</div>' +
      (place.address ? '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;">📌 ' + place.address + '</div>' : '') +
      (ariaNote ? '<div class="explore-detail-aria-note"><strong>✦ Aria says</strong>' + ariaNote + '</div>' : '') +
      '<div class="explore-detail-actions">' +
        '<button class="explore-detail-btn primary" onclick="window.open(\'' + mapsUrl + '\',\'_blank\')">🗺 Directions</button>' +
        (place.website
          ? '<button class="explore-detail-btn secondary" onclick="window.open(\'' + place.website + '\',\'_blank\')">🌐 Website</button>'
          : '<button class="explore-detail-btn secondary" onclick="window.open(\'' + osmUrl + '\',\'_blank\')">🗺 View map</button>') +
      '</div>';
    if (typeof openModal === 'function') openModal('explorePlaceDetailModal');
  }

  function buildAriaNote(place) {
    const occ = ariaContext.occasion, hurry = ariaContext.hurry, food = ariaContext.foodPref;
    if (!occ && !hurry && !food) return null;
    let n = '';
    if (hurry === 'yes, fast please' && place.dist) n += 'Quick option — only ' + place.dist + ' away. ';
    if (occ === 'date night'   && place.cuisine) n += place.cuisine + ' cuisine could be great for a date. ';
    if (occ === 'work meetup')  n += 'Could be a decent work spot. ';
    if (occ === 'with friends') n += 'Looks like a solid group spot. ';
    if (food && place.cuisine  && place.cuisine.toLowerCase().indexOf(food.toLowerCase()) > -1) n += 'Matches your ' + food + ' preference. ';
    if (place.opening) n += 'Hours: ' + place.opening.split(';')[0] + '. ';
    return n.trim() || null;
  }

  // ── Aria context card ───────────────────────────────────────
  function renderAriaContextCard() {
    const card = document.getElementById('exploreAriaCard');
    if (!card) return;
    if (contextCollected) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    card.innerHTML =
      '<div class="explore-aria-card-header"><div class="explore-aria-card-dot"></div><div class="explore-aria-card-label">Aria</div></div>' +
      '<div class="explore-aria-card-msg" id="exploreAriaMsg">before I find you somewhere — quick check-in 👀</div>' +
      '<div class="explore-q-row">' +
        '<div class="explore-q-item">' +
          '<div class="explore-q-label">what\'s the occasion?</div>' +
          '<div class="explore-q-chips">' +
            ['just browsing','date night','work meetup','with friends','solo trip'].map(function(o){
              return '<div class="explore-q-chip" onclick="ariaExplore.selectQ(\'occasion\',\'' + o + '\',this)">' + o + '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="explore-q-item">' +
          '<div class="explore-q-label">are you in a hurry?</div>' +
          '<div class="explore-q-chips">' +
            ['nope, chilling','kinda','yes, fast please'].map(function(o){
              return '<div class="explore-q-chip" onclick="ariaExplore.selectQ(\'hurry\',\'' + o + '\',this)">' + o + '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="explore-q-item">' +
          '<div class="explore-q-label">food preference? <span style="color:var(--muted);font-size:10px;">(optional)</span></div>' +
          '<div class="explore-q-chips">' +
            ['anything','vegetarian','vegan','halal'].map(function(o){
              return '<div class="explore-q-chip" onclick="ariaExplore.selectQ(\'foodPref\',\'' + o + '\',this)">' + o + '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="explore-go-btn" style="flex:1;" onclick="ariaExplore.submitContext()">show me places <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>' +
        '<button onclick="ariaExplore.skipContext()" style="padding:12px 14px;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font-size:12px;cursor:pointer;font-family:\'DM Sans\',sans-serif;">skip</button>' +
      '</div>';
  }

  function selectQ(key, value, el) {
    el.parentElement.querySelectorAll('.explore-q-chip').forEach(function(c){ c.classList.remove('selected'); });
    el.classList.add('selected');
    ariaContext[key] = value;
    const msg = document.getElementById('exploreAriaMsg');
    if (msg) {
      if (key === 'occasion' && value === 'date night')   msg.textContent = "ooh a date night? i'll find you somewhere decent 😏";
      if (key === 'occasion' && value === 'work meetup')  msg.textContent = "keeping it professional — got you 💼";
      if (key === 'hurry'    && value === 'yes, fast please') msg.textContent = "on it — sorting by closest first ⚡";
    }
  }

  function submitContext() {
    contextCollected = true;
    const card = document.getElementById('exploreAriaCard');
    if (card) card.style.display = 'none';
    loadPlaces();
  }

  function skipContext() {
    contextCollected = true;
    const card = document.getElementById('exploreAriaCard');
    if (card) card.style.display = 'none';
    loadPlaces();
  }

  // ── UI helpers ──────────────────────────────────────────────
  function setLocStatus(state, text) {
    const dot   = document.getElementById('exploreLocDot');
    const label = document.getElementById('exploreLocText');
    if (!dot || !label) return;
    dot.className = 'explore-loc-dot' + (state === 'active' ? ' active' : state === 'loading' ? ' loading' : '');
    label.textContent = text;
  }
  function hideBanner() { const b = document.getElementById('exploreLocationBanner'); if (b) b.style.display = 'none'; }
  function showManualInput() { const w = document.getElementById('exploreManualWrap'); if (w) w.style.display = 'block'; }

  // ── Category chips ──────────────────────────────────────────
  function selectCategory(id) {
    activeCategory = id;
    document.querySelectorAll('.explore-cat-chip').forEach(function(c){
      c.classList.toggle('active', c.dataset.cat === id);
    });
    if (userLat) loadPlaces();
  }

  function renderCategoryChips() {
    const wrap = document.getElementById('exploreCats');
    if (!wrap) return;
    wrap.innerHTML = CATEGORIES.map(function(c){
      return '<div class="explore-cat-chip ' + (c.id === activeCategory ? 'active' : '') + '" data-cat="' + c.id + '" onclick="ariaExplore.selectCategory(\'' + c.id + '\')">' +
        '<div class="explore-cat-icon">' + c.icon + '</div>' +
        '<div class="explore-cat-label">' + c.label + '</div>' +
      '</div>';
    }).join('');
  }

  // ── Init screen ─────────────────────────────────────────────
  async function initScreen() {
    renderCategoryChips();
    const banner = document.getElementById('exploreLocationBanner');

    if (userLat) {
      // Already have location
      if (banner) banner.style.display = 'none';
      setLocStatus('active', '📍 ' + locationLabel);
      await initMap();
      if (!placesLoading) loadPlaces();
    } else {
      // No location — show banner and auto-request
      if (banner) banner.style.display = 'flex';
      setLocStatus('loading', 'requesting location…');
      const mapWrap = document.getElementById('exploreMap');
      if (mapWrap && !mapInstance) {
        mapWrap.innerHTML = '<div class="explore-map-placeholder"><div class="explore-map-placeholder-icon">🗺</div><div class="explore-map-placeholder-text">share location to see the map</div></div>';
      }
      // Show context card now so it's ready
      renderAriaContextCard();
      // Auto-trigger location request
      requestLocation();
    }
  }

  // ── Chat trigger ────────────────────────────────────────────
  function detectChatTrigger(text) {
    return [
      /find\s+(me\s+)?(a\s+|some\s+)?place/i,
      /nearby/i,
      /around\s+(me|here)/i,
      /what.?s\s+(near|close|around)/i,
      /where\s+(can\s+i|should\s+i)\s+go/i,
      /places\s+near/i,
      /help\s+me\s+find/i,
      /hospital\s+near/i,
      /caf.+near/i,
      /restaurant.+near/i,
    ].some(function(r){ return r.test(text); });
  }

  function injectChatCard() {
    ariaContext = { occasion: null, hurry: null, foodPref: null };
    contextCollected = false;
    return '<div style="margin-top:8px;padding:12px 14px;background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2);border-radius:12px;">' +
      '<div style="font-size:10px;color:#f97316;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">✦ Explore Nearby</div>' +
      '<div style="font-size:12px;color:rgba(240,236,228,0.75);margin-bottom:10px;line-height:1.5;">let me help you find somewhere. just two quick questions.</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">' +
        '<div style="font-size:10px;color:rgba(240,236,228,0.4);text-transform:uppercase;letter-spacing:0.6px;">occasion?</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;" id="chatExpOcc">' +
          ['date','work','friends','solo'].map(function(o){
            return '<div onclick="ariaExplore._chatSelectOcc(\'' + o + '\',this)" style="padding:5px 10px;background:var(--card2);border:1px solid var(--border);border-radius:16px;font-size:11px;color:var(--text2);cursor:pointer;">' + o + '</div>';
          }).join('') +
        '</div>' +
        '<div style="font-size:10px;color:rgba(240,236,228,0.4);text-transform:uppercase;letter-spacing:0.6px;margin-top:2px;">in a hurry?</div>' +
        '<div style="display:flex;gap:6px;" id="chatExpHurry">' +
          ['nope','kinda','yes'].map(function(o){
            return '<div onclick="ariaExplore._chatSelectHurry(\'' + o + '\',this)" style="padding:5px 10px;background:var(--card2);border:1px solid var(--border);border-radius:16px;font-size:11px;color:var(--text2);cursor:pointer;">' + o + '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<button onclick="ariaExplore._chatOpenExplore()" style="width:100%;padding:9px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;font-family:\'DM Sans\',sans-serif;cursor:pointer;">find me somewhere →</button>' +
    '</div>';
  }

  function _chatSelectOcc(val, el) {
    ariaContext.occasion = val;
    document.querySelectorAll('#chatExpOcc div').forEach(function(d){ d.style.background='var(--card2)'; d.style.borderColor='var(--border)'; d.style.color='var(--text2)'; });
    el.style.background='rgba(249,115,22,0.12)'; el.style.borderColor='rgba(249,115,22,0.35)'; el.style.color='#f97316';
  }
  function _chatSelectHurry(val, el) {
    ariaContext.hurry = val === 'yes' ? 'yes, fast please' : val;
    document.querySelectorAll('#chatExpHurry div').forEach(function(d){ d.style.background='var(--card2)'; d.style.borderColor='var(--border)'; d.style.color='var(--text2)'; });
    el.style.background='rgba(249,115,22,0.12)'; el.style.borderColor='rgba(249,115,22,0.35)'; el.style.color='#f97316';
  }
  function _chatOpenExplore() {
    contextCollected = true;
    if (typeof showScreen === 'function') showScreen('exploreScreen');
    setTimeout(function(){ initScreen(); }, 300);
  }

  // ── Public API ──────────────────────────────────────────────
  return {
    init: initScreen,
    requestLocation: requestLocation,
    geocodeManual: geocodeManual,
    selectCategory: selectCategory,
    selectQ: selectQ,
    submitContext: submitContext,
    skipContext: skipContext,
    openPlaceDetail: openPlaceDetail,
    openPlaceDetailEncoded: openPlaceDetailEncoded,
    loadPlaces: loadPlaces,
    detectChatTrigger: detectChatTrigger,
    injectChatCard: injectChatCard,
    _chatSelectOcc: _chatSelectOcc,
    _chatSelectHurry: _chatSelectHurry,
    _chatOpenExplore: _chatOpenExplore,
  };

})();

// ── Patch sendChatMessage ───────────────────────────────────
(function patchChatForExplore() {
  function doHook() {
    var orig = window.sendChatMessage;
    if (typeof orig !== 'function') { setTimeout(doHook, 300); return; }
    window.sendChatMessage = async function() {
      var input = document.getElementById('chatInput');
      if (!input) return orig.apply(this, arguments);
      var text = input.value.trim();
      if (text && ariaExplore.detectChatTrigger(text)) {
        input.value = '';
        if (typeof chatInputResize  === 'function') chatInputResize(input);
        if (typeof appendUserMessage === 'function') appendUserMessage(text);
        if (typeof chatHistory !== 'undefined') chatHistory.push({ role: 'user', content: text });
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
        setTimeout(function() {
          var msgs = document.getElementById('chatMessages');
          if (!msgs) return;
          var wrap = document.createElement('div');
          wrap.className = 'chat-msg-aria-wrap';
          wrap.style.animation = 'slide-up 0.25s ease both';
          wrap.innerHTML = '<div class="chat-msg-aria"><div class="chat-bubble-aria" style="padding:0;background:transparent;border:none;">' + ariaExplore.injectChatCard() + '</div></div>';
          msgs.appendChild(wrap);
          if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
        }, 600);
        return;
      }
      return orig.apply(this, arguments);
    };
  }
  doHook();
})();
