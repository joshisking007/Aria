// ============================================================
//  ARIA EXPLORE — Nearby Places
//  Geolocation · Leaflet map · Overpass OSM API · Aria Q&A flow
// ============================================================

const ariaExplore = (() => {

  // ── State ──────────────────────────────────────────────────
  let userLat = null;
  let userLng = null;
  let locationLabel = 'detecting location…';
  let locationGranted = false;
  let mapInstance = null;
  let mapMarkers = [];
  let userMarker = null;
  let activeCategory = 'cafe';
  let currentPlaces = [];
  let ariaContext = { occasion: null, hurry: null, foodPref: null };
  let contextCollected = false;
  let leafletLoaded = false;

  // ── Category definitions ───────────────────────────────────
  const CATEGORIES = [
    { id: 'cafe',        label: 'Cafes',        icon: '☕', osm: ['amenity=cafe', 'amenity=coffee_shop'] },
    { id: 'restaurant',  label: 'Food',         icon: '🍕', osm: ['amenity=restaurant', 'amenity=fast_food', 'amenity=food_court'] },
    { id: 'supermarket', label: 'Grocery',      icon: '🛒', osm: ['shop=supermarket', 'shop=grocery', 'shop=convenience'] },
    { id: 'hospital',    label: 'Medical',      icon: '🏥', osm: ['amenity=hospital', 'amenity=clinic', 'amenity=pharmacy'] },
    { id: 'gym',         label: 'Gym',          icon: '💪', osm: ['leisure=fitness_centre', 'leisure=gym', 'amenity=gym'] },
    { id: 'petrol',      label: 'Petrol',       icon: '⛽', osm: ['amenity=fuel', 'amenity=charging_station'] },
    { id: 'bank',        label: 'Bank/ATM',     icon: '🏧', osm: ['amenity=bank', 'amenity=atm'] },
    { id: 'hotel',       label: 'Hotels',       icon: '🏨', osm: ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel'] },
    { id: 'pharmacy',    label: 'Pharmacy',     icon: '💊', osm: ['amenity=pharmacy'] },
    { id: 'bar',         label: 'Bars',         icon: '🍺', osm: ['amenity=bar', 'amenity=pub'] },
    { id: 'school',      label: 'Schools',      icon: '🏫', osm: ['amenity=school', 'amenity=university', 'amenity=college'] },
    { id: 'park',        label: 'Parks',        icon: '🌳', osm: ['leisure=park', 'leisure=playground'] },
  ];

  // ── Leaflet loader ─────────────────────────────────────────
  function loadLeaflet() {
    return new Promise((resolve) => {
      if (leafletLoaded && window.L) { resolve(); return; }
      // CSS
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        document.head.appendChild(link);
      }
      // JS
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      script.onload = () => { leafletLoaded = true; resolve(); };
      document.head.appendChild(script);
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
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        locationGranted = true;
        reverseGeocode(userLat, userLng);
        hideBanner();
        if (mapInstance) moveMapTo(userLat, userLng);
        else initMap();
      },
      (err) => {
        console.warn('Geolocation error:', err.code, err.message);
        let msg = 'location unavailable';
        if (err.code === 1) msg = 'location access denied';
        setLocStatus('error', msg + ' — enter manually');
        showManualInput();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function reverseGeocode(lat, lng) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
      .then(r => r.json())
      .then(data => {
        const addr = data.address || {};
        const parts = [
          addr.suburb || addr.neighbourhood || addr.quarter,
          addr.city || addr.town || addr.village
        ].filter(Boolean);
        locationLabel = parts.join(', ') || 'your location';
        setLocStatus('active', '📍 ' + locationLabel);
      })
      .catch(() => {
        locationLabel = `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
        setLocStatus('active', '📍 ' + locationLabel);
      });
  }

  function geocodeManual(query) {
    setLocStatus('loading', 'searching for "' + query + '"…');
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`)
      .then(r => r.json())
      .then(results => {
        if (!results.length) {
          setLocStatus('error', 'location not found — try again');
          return;
        }
        userLat = parseFloat(results[0].lat);
        userLng = parseFloat(results[0].lon);
        locationLabel = results[0].display_name.split(',').slice(0,2).join(',').trim();
        locationGranted = true;
        setLocStatus('active', '📍 ' + locationLabel);
        if (mapInstance) moveMapTo(userLat, userLng);
        else initMap();
        loadPlaces();
      })
      .catch(() => setLocStatus('error', 'search failed — check connection'));
  }

  // ── Map ────────────────────────────────────────────────────
  async function initMap() {
    await loadLeaflet();
    const L = window.L;
    const container = document.getElementById('exploreMap');
    if (!container) return;

    // Destroy old instance
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }

    // Replace placeholder
    container.innerHTML = '<div id="exploreMapInner" style="width:100%;height:100%;"></div>';
    const inner = document.getElementById('exploreMapInner');

    mapInstance = L.map(inner, {
      center: [userLat || 51.505, userLng || -0.09],
      zoom: 15,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(mapInstance);

    if (userLat) placeUserMarker();
  }

  function moveMapTo(lat, lng) {
    if (!mapInstance) { initMap(); return; }
    mapInstance.setView([lat, lng], 15, { animate: true });
    placeUserMarker();
  }

  function placeUserMarker() {
    if (!mapInstance || !window.L) return;
    const L = window.L;
    if (userMarker) { userMarker.remove(); }
    const pulseIcon = L.divIcon({
      className: '',
      html: '<div class="explore-user-pulse"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    userMarker = L.marker([userLat, userLng], { icon: pulseIcon })
      .addTo(mapInstance)
      .bindPopup('<strong style="color:#f97316">You are here</strong>');
  }

  function addPlaceMarkers(places) {
    if (!mapInstance || !window.L) return;
    const L = window.L;
    // Clear old markers
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];

    places.slice(0, 20).forEach((p, i) => {
      const cat = CATEGORIES.find(c => c.id === activeCategory);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:30px;height:30px;background:var(--card2);border:2px solid rgba(249,115,22,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${cat ? cat.icon : '📍'}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      const m = L.marker([p.lat, p.lon], { icon })
        .addTo(mapInstance)
        .bindPopup(`<strong>${p.name || 'Unnamed'}</strong>${p.dist ? '<br><span style="color:#f97316">'+p.dist+'</span>' : ''}`);
      m.on('click', () => openPlaceDetail(p));
      mapMarkers.push(m);
    });
  }

  // ── Overpass OSM fetch ──────────────────────────────────────
  async function fetchPlacesOSM(lat, lng, category) {
    const cat = CATEGORIES.find(c => c.id === category);
    if (!cat) return [];

    const radius = 1500; // metres
    const unionParts = cat.osm.map(tag => {
      const [k, v] = tag.split('=');
      return `node["${k}"="${v}"](around:${radius},${lat},${lng});way["${k}"="${v}"](around:${radius},${lat},${lng});`;
    }).join('');

    const query = `[out:json][timeout:15];(${unionParts});out center 30;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    const res = await fetch(url);
    const data = await res.json();
    return data.elements || [];
  }

  function calcDist(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return d < 1000 ? Math.round(d) + 'm' : (d/1000).toFixed(1) + 'km';
  }

  function distMetres(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function normalisePlaces(elements) {
    return elements
      .map(el => {
        const tags = el.tags || {};
        const lat = el.lat || (el.center && el.center.lat);
        const lon = el.lon || (el.center && el.center.lon);
        if (!lat || !lon) return null;
        const dist = userLat ? calcDist(userLat, userLng, lat, lon) : null;
        const distM = userLat ? distMetres(userLat, userLng, lat, lon) : 999999;
        return {
          id: el.id,
          name: tags.name || tags['name:en'] || 'Unnamed Place',
          lat, lon,
          dist, distM,
          phone: tags.phone || tags['contact:phone'] || null,
          website: tags.website || tags['contact:website'] || null,
          address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || null,
          opening: tags.opening_hours || null,
          cuisine: tags.cuisine || null,
          wheelchair: tags.wheelchair || null,
          tags
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distM - b.distM);
  }

  // ── Load places ─────────────────────────────────────────────
  async function loadPlaces() {
    if (!userLat) { showToast('share your location first', 'error'); return; }
    showSkeletons();
    try {
      const raw = await fetchPlacesOSM(userLat, userLng, activeCategory);
      currentPlaces = normalisePlaces(raw);
      renderPlacesList(currentPlaces);
      addPlaceMarkers(currentPlaces);
    } catch(e) {
      console.error('Explore fetch error:', e);
      document.getElementById('explorePlacesList').innerHTML = `
        <div class="explore-empty">
          <div class="explore-empty-icon">📡</div>
          <div class="explore-empty-text">couldn't load places — check your connection</div>
        </div>`;
    }
  }

  function showSkeletons() {
    const list = document.getElementById('explorePlacesList');
    list.innerHTML = Array(5).fill(`
      <div class="explore-skeleton">
        <div class="skel-icon"></div>
        <div class="skel-body">
          <div class="skel-line"></div>
          <div class="skel-line short"></div>
        </div>
      </div>`).join('');
  }

  function renderPlacesList(places) {
    const list = document.getElementById('explorePlacesList');
    const cat = CATEGORIES.find(c => c.id === activeCategory);
    const icon = cat ? cat.icon : '📍';

    // Aria's top pick (closest with a name)
    const topPick = places.find(p => p.name !== 'Unnamed Place');

    if (!places.length) {
      list.innerHTML = `<div class="explore-empty">
        <div class="explore-empty-icon">${icon}</div>
        <div class="explore-empty-text">no ${cat ? cat.label.toLowerCase() : 'places'} found nearby.<br>try another category or location.</div>
      </div>`;
      return;
    }

    list.innerHTML = places.slice(0, 25).map((p, i) => {
      const isAriaPick = topPick && p.id === topPick.id && ariaContext.occasion;
      return `
        <div class="explore-place-card" onclick="ariaExplore.openPlaceDetail(${JSON.stringify(p).replace(/"/g,'&quot;')})" style="animation-delay:${i * 0.04}s">
          <div class="explore-place-icon">${icon}</div>
          <div class="explore-place-body">
            <div class="explore-place-name">${p.name}</div>
            <div class="explore-place-meta">
              ${p.dist ? `<span class="explore-place-dist">${p.dist}</span>` : ''}
              ${p.address ? `<span>· ${p.address}</span>` : ''}
              ${p.cuisine ? `<span>· ${p.cuisine}</span>` : ''}
            </div>
            ${isAriaPick ? '<div class="explore-aria-pick">✦ aria\'s pick</div>' : ''}
          </div>
          <div class="explore-place-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        </div>`;
    }).join('');
  }

  // ── Place detail modal ──────────────────────────────────────
  function openPlaceDetail(place) {
    if (typeof place === 'string') { try { place = JSON.parse(place); } catch(e) { return; } }
    const cat = CATEGORIES.find(c => c.id === activeCategory);
    const icon = cat ? cat.icon : '📍';

    const ariaNote = buildAriaNote(place);

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`;
    const osmUrl = `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`;

    document.getElementById('explorePlaceDetailBody').innerHTML = `
      <div class="explore-detail-header">
        <div class="explore-detail-icon">${icon}</div>
        <div>
          <div class="explore-detail-name">${place.name}</div>
          <div class="explore-detail-type">${cat ? cat.label : activeCategory}</div>
        </div>
      </div>
      <div class="explore-detail-meta">
        ${place.dist ? `<div class="explore-detail-pill rose">📍 ${place.dist} away</div>` : ''}
        ${place.opening ? `<div class="explore-detail-pill green">🕐 ${place.opening.split(';')[0]}</div>` : ''}
        ${place.phone ? `<div class="explore-detail-pill">📞 ${place.phone}</div>` : ''}
        ${place.wheelchair === 'yes' ? `<div class="explore-detail-pill">♿ accessible</div>` : ''}
      </div>
      ${place.address ? `<div style="font-size:12px;color:var(--muted);margin-bottom:14px;">📌 ${place.address}</div>` : ''}
      ${ariaNote ? `<div class="explore-detail-aria-note"><strong>✦ Aria says</strong>${ariaNote}</div>` : ''}
      <div class="explore-detail-actions">
        <button class="explore-detail-btn primary" onclick="window.open('${mapsUrl}','_blank')">🗺 Directions</button>
        ${place.website ? `<button class="explore-detail-btn secondary" onclick="window.open('${place.website}','_blank')">🌐 Website</button>` :
          `<button class="explore-detail-btn secondary" onclick="window.open('${osmUrl}','_blank')">🗺 View on map</button>`}
      </div>
    `;
    openModal('explorePlaceDetailModal');
  }

  function buildAriaNote(place) {
    const { occasion, hurry, foodPref } = ariaContext;
    if (!occasion && !hurry && !foodPref) return null;
    let note = '';
    if (hurry === 'yes' && place.dist) note += `Quick option — only ${place.dist} away. `;
    if (occasion === 'date' && place.tags.cuisine) note += `${place.tags.cuisine} cuisine could work well for a date. `;
    if (occasion === 'work') note += `Good spot for a work meetup if they have seating. `;
    if (occasion === 'casual') note += `Looks like a relaxed spot. `;
    if (foodPref && place.tags.cuisine && place.tags.cuisine.toLowerCase().includes(foodPref.toLowerCase())) {
      note += `Matches your ${foodPref} preference. `;
    }
    if (place.opening) note += `Check hours: ${place.opening.split(';')[0]}. `;
    return note.trim() || null;
  }

  // ── Aria Q&A context flow ───────────────────────────────────
  function renderAriaContextCard() {
    const card = document.getElementById('exploreAriaCard');
    if (!card) return;

    if (contextCollected) { card.style.display = 'none'; return; }

    card.style.display = 'block';
    card.innerHTML = `
      <div class="explore-aria-card-header">
        <div class="explore-aria-card-dot"></div>
        <div class="explore-aria-card-label">Aria</div>
      </div>
      <div class="explore-aria-card-msg" id="exploreAriaMsg">
        before I find you somewhere — quick check-in 👀
      </div>
      <div class="explore-q-row">
        <div class="explore-q-item">
          <div class="explore-q-label">what's the occasion?</div>
          <div class="explore-q-chips" id="qOccasion">
            ${['just browsing','date night','work meetup','with friends','solo trip'].map(o =>
              `<div class="explore-q-chip" onclick="ariaExplore.selectQ('occasion','${o}',this)">${o}</div>`
            ).join('')}
          </div>
        </div>
        <div class="explore-q-item">
          <div class="explore-q-label">are you in a hurry?</div>
          <div class="explore-q-chips" id="qHurry">
            ${['nope, chilling','kinda','yes, fast please'].map(o =>
              `<div class="explore-q-chip" onclick="ariaExplore.selectQ('hurry','${o}',this)">${o}</div>`
            ).join('')}
          </div>
        </div>
        <div class="explore-q-item">
          <div class="explore-q-label">any food preference? <span style="color:var(--muted);font-size:10px;">(optional)</span></div>
          <div class="explore-q-chips" id="qFood">
            ${['anything','vegetarian','vegan','halal','no preference'].map(o =>
              `<div class="explore-q-chip" onclick="ariaExplore.selectQ('foodPref','${o}',this)">${o}</div>`
            ).join('')}
          </div>
        </div>
      </div>
      <button class="explore-go-btn" onclick="ariaExplore.submitContext()">
        show me places
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    `;
  }

  function selectQ(key, value, el) {
    const parent = el.parentElement;
    parent.querySelectorAll('.explore-q-chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    ariaContext[key] = value;

    // Personalise Aria's message
    const msg = document.getElementById('exploreAriaMsg');
    if (msg) {
      if (key === 'occasion' && value === 'date night') msg.textContent = "ooh a date night? i'll find you somewhere decent 😏";
      else if (key === 'occasion' && value === 'work meetup') msg.textContent = "keeping it professional — got you 💼";
      else if (key === 'hurry' && value === 'yes, fast please') msg.textContent = "on it — i'll sort by closest first ⚡";
    }
  }

  function submitContext() {
    contextCollected = true;
    const card = document.getElementById('exploreAriaCard');
    if (card) card.style.display = 'none';

    // Sort by distance if in a hurry
    if (ariaContext.hurry === 'yes, fast please') {
      currentPlaces = [...currentPlaces].sort((a, b) => a.distM - b.distM);
      renderPlacesList(currentPlaces);
    }
    loadPlaces();
  }

  // ── UI helpers ──────────────────────────────────────────────
  function setLocStatus(state, text) {
    const dot = document.getElementById('exploreLocDot');
    const label = document.getElementById('exploreLocText');
    if (!dot || !label) return;
    dot.className = 'explore-loc-dot ' + (state === 'active' ? 'active' : state === 'loading' ? 'loading' : '');
    label.textContent = text;
  }

  function hideBanner() {
    const b = document.getElementById('exploreLocationBanner');
    if (b) b.style.display = 'none';
  }

  function showManualInput() {
    const wrap = document.getElementById('exploreManualWrap');
    if (wrap) wrap.style.display = 'block';
  }

  // ── Category selector ───────────────────────────────────────
  function selectCategory(id) {
    activeCategory = id;
    document.querySelectorAll('.explore-cat-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.cat === id);
    });
    if (userLat) loadPlaces();
  }

  function renderCategoryChips() {
    const wrap = document.getElementById('exploreCats');
    if (!wrap) return;
    wrap.innerHTML = CATEGORIES.map(c => `
      <div class="explore-cat-chip ${c.id === activeCategory ? 'active' : ''}" data-cat="${c.id}" onclick="ariaExplore.selectCategory('${c.id}')">
        <div class="explore-cat-icon">${c.icon}</div>
        <div class="explore-cat-label">${c.label}</div>
      </div>`).join('');
  }

  // ── Init screen ─────────────────────────────────────────────
  async function initScreen() {
    renderCategoryChips();
    renderAriaContextCard();

    // Show banner if no location yet
    const banner = document.getElementById('exploreLocationBanner');
    if (!locationGranted && banner) banner.style.display = 'flex';

    // If we already have location, go straight
    if (userLat) {
      hideBanner();
      setLocStatus('active', '📍 ' + locationLabel);
      await initMap();
      if (contextCollected) loadPlaces();
    } else {
      // Show map placeholder
      const mapWrap = document.getElementById('exploreMap');
      if (mapWrap) mapWrap.innerHTML = `
        <div class="explore-map-placeholder">
          <div class="explore-map-placeholder-icon">🗺</div>
          <div class="explore-map-placeholder-text">share location to see the map</div>
        </div>`;
    }
  }

  // ── Chat command hook ──────────────────────────────────────
  // Call this from sendChatMessage() when the message triggers a location search.
  // Returns true if handled, false otherwise.
  function detectChatTrigger(text) {
    const triggers = [
      /find\s+(me\s+)?(a\s+|some\s+)?place/i,
      /nearby/i,
      /around\s+(me|here)/i,
      /what('?s|\s+is)\s+(near|close|around)/i,
      /caf[eé]s?\s+near/i,
      /restaurants?\s+near/i,
      /hospital\s+near/i,
      /supermarket\s+near/i,
      /explore/i,
      /where\s+(can\s+i|should\s+i)\s+go/i,
      /places\s+near/i,
      /help\s+me\s+find/i
    ];
    return triggers.some(r => r.test(text));
  }

  // Injects an Aria-like mini card into the chat, then opens explore screen after delay
  function injectChatCard() {
    // Reset context for fresh session
    ariaContext = { occasion: null, hurry: null, foodPref: null };
    contextCollected = false;

    // Build mini card HTML to inject as an aria message
    const cardHtml = `
      <div style="margin-top:8px;padding:12px 14px;background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2);border-radius:12px;">
        <div style="font-size:10px;color:#f97316;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">✦ Explore Nearby</div>
        <div style="font-size:12px;color:rgba(240,236,228,0.75);margin-bottom:10px;line-height:1.5;">let me help you find somewhere. i just need a couple of quick answers first.</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
          <div style="font-size:10px;color:rgba(240,236,228,0.4);text-transform:uppercase;letter-spacing:0.6px;">occasion?</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;" id="chatExpOcc">
            ${['date','work','friends','solo'].map(o => `<div onclick="ariaExplore._chatSelectOcc('${o}',this)" style="padding:5px 10px;background:var(--card2);border:1px solid var(--border);border-radius:16px;font-size:11px;color:var(--text2);cursor:pointer;">${o}</div>`).join('')}
          </div>
          <div style="font-size:10px;color:rgba(240,236,228,0.4);text-transform:uppercase;letter-spacing:0.6px;margin-top:4px;">in a hurry?</div>
          <div style="display:flex;gap:6px;" id="chatExpHurry">
            ${['nope','kinda','yes'].map(o => `<div onclick="ariaExplore._chatSelectHurry('${o}',this)" style="padding:5px 10px;background:var(--card2);border:1px solid var(--border);border-radius:16px;font-size:11px;color:var(--text2);cursor:pointer;">${o}</div>`).join('')}
          </div>
        </div>
        <button onclick="ariaExplore._chatOpenExplore()" style="width:100%;padding:9px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;font-family:'DM Sans',sans-serif;cursor:pointer;">
          find me somewhere →
        </button>
      </div>
    `;
    return cardHtml;
  }

  function _chatSelectOcc(val, el) {
    ariaContext.occasion = val;
    document.querySelectorAll('#chatExpOcc div').forEach(d => { d.style.background='var(--card2)'; d.style.borderColor='var(--border)'; d.style.color='var(--text2)'; });
    el.style.background='rgba(249,115,22,0.12)'; el.style.borderColor='rgba(249,115,22,0.35)'; el.style.color='#f97316';
  }
  function _chatSelectHurry(val, el) {
    ariaContext.hurry = val === 'yes' ? 'yes, fast please' : val;
    document.querySelectorAll('#chatExpHurry div').forEach(d => { d.style.background='var(--card2)'; d.style.borderColor='var(--border)'; d.style.color='var(--text2)'; });
    el.style.background='rgba(249,115,22,0.12)'; el.style.borderColor='rgba(249,115,22,0.35)'; el.style.color='#f97316';
  }
  function _chatOpenExplore() {
    contextCollected = ariaContext.occasion != null;
    showScreen('exploreScreen');
    setTimeout(() => {
      initScreen();
      if (userLat && contextCollected) loadPlaces();
    }, 300);
  }

  // ── Public API ──────────────────────────────────────────────
  return {
    init: initScreen,
    requestLocation,
    geocodeManual,
    selectCategory,
    selectQ,
    submitContext,
    openPlaceDetail,
    loadPlaces,
    detectChatTrigger,
    injectChatCard,
    _chatSelectOcc,
    _chatSelectHurry,
    _chatOpenExplore
  };

})();

// ── Hook into sendChatMessage in aria-app.js ────────────────
// Patch the existing sendChatMessage to intercept location queries
(function patchChatForExplore() {
  const originalSend = window.sendChatMessage;
  if (typeof originalSend !== 'function') {
    // If aria-app.js hasn't loaded yet, wait
    document.addEventListener('DOMContentLoaded', () => setTimeout(patchChatForExplore, 500));
    return;
  }

  window.sendChatMessage = async function() {
    const input = document.getElementById('chatInput');
    if (!input) { return originalSend.apply(this, arguments); }
    const text = input.value.trim();

    if (text && ariaExplore.detectChatTrigger(text)) {
      // Let the normal path add the user bubble, then inject explore card
      input.value = '';
      if (typeof chatInputResize === 'function') chatInputResize(input);
      if (typeof appendUserMessage === 'function') appendUserMessage(text);
      if (typeof chatHistory !== 'undefined') chatHistory.push({ role: 'user', content: text });
      if (typeof scrollChatToBottom === 'function') scrollChatToBottom();

      // Small delay then inject aria's mini card as a message bubble
      setTimeout(() => {
        const msgs = document.getElementById('chatMessages');
        if (!msgs) return;
        const wrap = document.createElement('div');
        wrap.className = 'chat-msg-aria-wrap';
        wrap.style.animation = 'slide-up 0.25s ease both';
        wrap.innerHTML = `
          <div class="chat-msg-aria">
            <div class="chat-bubble-aria" style="padding:0;background:transparent;border:none;">
              ${ariaExplore.injectChatCard()}
            </div>
          </div>`;
        msgs.appendChild(wrap);
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
      }, 600);

      return;
    }

    return originalSend.apply(this, arguments);
  };
})();
