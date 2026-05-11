// ============================================================
//  ARIA EXPLORE v3
//  - No context card before results
//  - Map and list connected (tap card pans map, tap marker scrolls list)
//  - Aria reacts per category + inline per card tap
//  - Category switch = list swap + map pan, no full reload
//  - Chat trigger opens explore directly, no inline mini-UI
//  - Directions is primary CTA in detail view
//  - All fetch/geo/distance/mirror logic unchanged from v2
// ============================================================

const ariaExplore = (() => {

  // ── State ───────────────────────────────────────────────────
  let userLat         = null;
  let userLng         = null;
  let locationLabel   = 'detecting…';
  let locationGranted = false;
  let mapInstance     = null;
  let mapMarkers      = [];
  let userMarker      = null;
  let activeCategory  = 'cafe';
  let currentPlaces   = [];
  let leafletLoaded   = false;
  let placesLoading   = false;
  let activeCardId    = null;

  // ── Categories ──────────────────────────────────────────────
  const CATEGORIES = [
    { id:'cafe',        label:'Cafes',    icon:'☕', osm:['amenity=cafe','amenity=coffee_shop'],
      ariaLine:'showing cafes near you.' },
    { id:'restaurant',  label:'Food',     icon:'🍕', osm:['amenity=restaurant','amenity=fast_food','amenity=food_court'],
      ariaLine:"here's what's around for food." },
    { id:'supermarket', label:'Grocery',  icon:'🛒', osm:['shop=supermarket','shop=grocery','shop=convenience'],
      ariaLine:'closest grocery options.' },
    { id:'hospital',    label:'Medical',  icon:'🏥', osm:['amenity=hospital','amenity=clinic','amenity=pharmacy'],
      ariaLine:'nearest medical facilities.' },
    { id:'gym',         label:'Gym',      icon:'💪', osm:['leisure=fitness_centre','leisure=gym','amenity=gym'],
      ariaLine:'gyms and fitness centres nearby.' },
    { id:'petrol',      label:'Petrol',   icon:'⛽', osm:['amenity=fuel'],
      ariaLine:'fuel stations sorted by distance.' },
    { id:'bank',        label:'Bank/ATM', icon:'🏧', osm:['amenity=bank','amenity=atm'],
      ariaLine:'banks and ATMs near you.' },
    { id:'hotel',       label:'Hotels',   icon:'🏨', osm:['tourism=hotel','tourism=guest_house','tourism=hostel'],
      ariaLine:'accommodation options nearby.' },
    { id:'pharmacy',    label:'Pharmacy', icon:'💊', osm:['amenity=pharmacy'],
      ariaLine:'pharmacies within reach.' },
    { id:'bar',         label:'Bars',     icon:'🍺', osm:['amenity=bar','amenity=pub'],
      ariaLine:'bars and pubs nearby.' },
    { id:'school',      label:'Schools',  icon:'🏫', osm:['amenity=school','amenity=university','amenity=college'],
      ariaLine:'schools and colleges around you.' },
    { id:'park',        label:'Parks',    icon:'🌳', osm:['leisure=park','leisure=playground'],
      ariaLine:'parks and green spaces near you.' },
  ];

  // ── Overpass mirrors ─────────────────────────────────────────
  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
  ];

  // ── Aria inline reads ────────────────────────────────────────
  function buildAriaInlineRead(place) {
    const lines = [];
    if      (place.distM < 200)  lines.push("right on your doorstep.");
    else if (place.distM < 500)  lines.push("a short walk away.");
    if (place.opening) {
      const raw = place.opening.split(';')[0].trim();
      if (raw) lines.push('hours: ' + raw + '.');
    }
    if (place.cuisine)           lines.push('serving ' + place.cuisine + '.');
    if (place.wheelchair==='yes') lines.push('wheelchair accessible.');
    if (!lines.length)           lines.push('tap again to open details.');
    return lines[0];
  }

  function buildDetailAriaNote(place) {
    const parts = [];
    if      (place.distM < 200)  parts.push('right next to you.');
    else if (place.distM < 800)  parts.push('short walk away.');
    else                         parts.push(place.dist + ' from here.');
    if (place.cuisine)           parts.push(place.cuisine + ' cuisine.');
    if (place.opening)           parts.push('open: ' + place.opening.split(';')[0] + '.');
    if (place.wheelchair==='yes') parts.push('wheelchair accessible.');
    if (!parts.length)           parts.push('tap directions to go.');
    return ' ' + parts.join(' ');
  }

  // ── Leaflet loader ───────────────────────────────────────────
  function loadLeaflet() {
    return new Promise(function(resolve, reject) {
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
      s.onload  = function() { leafletLoaded = true; resolve(); };
      s.onerror = function() { reject(new Error('Leaflet failed')); };
      document.head.appendChild(s);
    });
  }

  // ── Geolocation ──────────────────────────────────────────────
  function requestLocation() {
    setLocStatus('loading', 'requesting…');
    if (!navigator.geolocation) {
      setLocStatus('error', 'not supported'); showManualInput(); return;
    }
    navigator.geolocation.getCurrentPosition(
      async function(pos) {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        locationGranted = true;
        hideBanner();
        setLocStatus('active', userLat.toFixed(3) + ', ' + userLng.toFixed(3));
        reverseGeocode(userLat, userLng);
        await initMap();
        loadPlaces();
      },
      function(err) {
        const msg = err.code === 1 ? 'access denied' : 'unavailable';
        setLocStatus('error', msg + ' — enter manually');
        showManualInput();
      },
      { enableHighAccuracy:true, timeout:12000, maximumAge:60000 }
    );
  }

  function reverseGeocode(lat, lng) {
    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng)
      .then(function(r){ return r.json(); })
      .then(function(data) {
        const addr  = data.address || {};
        const parts = [
          addr.suburb || addr.neighbourhood || addr.quarter,
          addr.city   || addr.town          || addr.village
        ].filter(Boolean);
        locationLabel = parts.join(', ') || 'your location';
        setLocStatus('active', locationLabel);
      })
      .catch(function() {
        locationLabel = lat.toFixed(3) + ', ' + lng.toFixed(3);
        setLocStatus('active', locationLabel);
      });
  }

  function geocodeManual(query) {
    if (!query) return;
    setLocStatus('loading', 'finding "' + query + '"…');
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&limit=1')
      .then(function(r){ return r.json(); })
      .then(async function(results) {
        if (!results.length) { setLocStatus('error', 'not found'); return; }
        userLat = parseFloat(results[0].lat);
        userLng = parseFloat(results[0].lon);
        locationLabel = results[0].display_name.split(',').slice(0,2).join(',').trim();
        locationGranted = true;
        setLocStatus('active', locationLabel);
        if (mapInstance) moveMapTo(userLat, userLng);
        else await initMap();
        loadPlaces();
      })
      .catch(function(){ setLocStatus('error', 'search failed'); });
  }

  // ── Map ──────────────────────────────────────────────────────
  async function initMap() {
    try { await loadLeaflet(); } catch(e) { console.warn('[Explore] Leaflet:', e); return; }
    const L = window.L;
    const container = document.getElementById('exploreMap');
    if (!container) return;
    if (mapInstance) { try { mapInstance.remove(); } catch(_){} mapInstance = null; }
    container.innerHTML = '<div id="exploreMapInner" style="width:100%;height:100%;"></div>';
    const inner = document.getElementById('exploreMapInner');
    if (!inner) return;
    mapInstance = L.map(inner, {
      center: [userLat||9.076, userLng||7.487],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(mapInstance);
    if (userLat) placeUserMarker();
  }

  function moveMapTo(lat, lng) {
    if (!mapInstance) return;
    mapInstance.setView([lat, lng], 15, { animate:true });
    placeUserMarker();
  }

  function placeUserMarker() {
    if (!mapInstance || !window.L) return;
    if (userMarker) { try { userMarker.remove(); } catch(_){} }
    const icon = window.L.divIcon({
      className: '',
      html: '<div class="explore-user-pulse"></div>',
      iconSize: [16,16], iconAnchor: [8,8],
    });
    userMarker = window.L.marker([userLat, userLng], { icon })
      .addTo(mapInstance)
      .bindPopup('<span style="font-family:var(--font-mono);font-size:11px;color:#f97316;">you</span>');
  }

  function addPlaceMarkers(places) {
    if (!mapInstance || !window.L) return;
    mapMarkers.forEach(function(m){ try { m.marker.remove(); } catch(_){} });
    mapMarkers = [];
    const cat  = CATEGORIES.find(function(c){ return c.id===activeCategory; });
    const icon = cat ? cat.icon : '•';
    places.slice(0,20).forEach(function(p) {
      const mi = window.L.divIcon({
        className: '',
        html: '<div class="explore-map-marker" data-pid="' + p.id + '">' + icon + '</div>',
        iconSize: [28,28], iconAnchor: [14,14],
      });
      const m = window.L.marker([p.lat, p.lon], { icon:mi }).addTo(mapInstance);
      // Tap marker → scroll + highlight card
      m.on('click', function() {
        highlightCard(p.id);
        scrollToCard(p.id);
        pulseMarker(p.id);
        m.bindPopup(
          '<div style="font-family:var(--font-mono);font-size:11px;white-space:nowrap;">' +
          p.name + (p.dist ? '<br><span style="color:#f97316;">' + p.dist + '</span>' : '') +
          '</div>'
        ).openPopup();
      });
      mapMarkers.push({ marker:m, placeId:p.id });
    });
  }

  function focusMapOnPlace(place) {
    if (!mapInstance) return;
    mapInstance.setView([place.lat, place.lon], 16, { animate:true });
    pulseMarker(place.id);
  }

  function pulseMarker(pid) {
    const el = document.querySelector('.explore-map-marker[data-pid="' + pid + '"]');
    if (!el) return;
    el.classList.add('explore-marker-active');
    setTimeout(function(){ el.classList.remove('explore-marker-active'); }, 1800);
  }

  // ── Overpass fetch ───────────────────────────────────────────
  function tryFetch(url, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function(resolve, reject) {
      const ctrl  = new AbortController();
      const timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs);
      fetch(url, { signal:ctrl.signal })
        .then(function(res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(data){ resolve(data.elements||[]); })
        .catch(function(e){ clearTimeout(timer); reject(e); });
    });
  }

  async function fetchPlacesOSM(lat, lng, category) {
    const cat = CATEGORIES.find(function(c){ return c.id===category; });
    if (!cat) return [];
    const radius = 2500;
    const parts  = cat.osm.map(function(tag) {
      const kv = tag.split('='), k=kv[0], v=kv[1];
      return 'node["'+k+'"="'+v+'"](around:'+radius+','+lat+','+lng+');'+
             'way["' +k+'"="'+v+'"](around:'+radius+','+lat+','+lng+');'+
             'relation["'+k+'"="'+v+'"](around:'+radius+','+lat+','+lng+');';
    }).join('');
    const query = '[out:json][timeout:30];(' + parts + ');out center 50;';
    let lastErr;
    for (let i=0; i<MIRRORS.length; i++) {
      try {
        const elements = await tryFetch(MIRRORS[i] + '?data=' + encodeURIComponent(query));
        return elements;
      } catch(e) {
        console.warn('[Explore] mirror failed:', MIRRORS[i], e.message);
        lastErr = e;
      }
    }
    throw lastErr || new Error('All mirrors failed');
  }

  // ── Distance helpers ─────────────────────────────────────────
  function calcDist(lat1,lng1,lat2,lng2) {
    const d = calcDistM(lat1,lng1,lat2,lng2);
    return d<1000 ? Math.round(d)+'m' : (d/1000).toFixed(1)+'km';
  }
  function calcDistM(lat1,lng1,lat2,lng2) {
    const R=6371000, toR=Math.PI/180;
    const dLat=(lat2-lat1)*toR, dLng=(lng2-lng1)*toR;
    const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function normalisePlaces(elements) {
    return elements
      .map(function(el) {
        const tags=el.tags||{};
        const lat=el.lat||(el.center&&el.center.lat);
        const lon=el.lon||(el.center&&el.center.lon);
        if (!lat||!lon) return null;
        return {
          id:   el.id,
          name: tags.name||tags['name:en']||'Unnamed Place',
          lat, lon,
          dist:       userLat ? calcDist(userLat,userLng,lat,lon)  : null,
          distM:      userLat ? calcDistM(userLat,userLng,lat,lon) : 999999,
          phone:      tags.phone   ||tags['contact:phone']  ||null,
          website:    tags.website ||tags['contact:website'] ||null,
          address:    [tags['addr:housenumber'],tags['addr:street'],tags['addr:city']].filter(Boolean).join(', ')||null,
          opening:    tags.opening_hours||null,
          cuisine:    tags.cuisine      ||null,
          wheelchair: tags.wheelchair   ||null,
          tags,
        };
      })
      .filter(Boolean)
      .sort(function(a,b){ return a.distM-b.distM; });
  }

  // ── Load places ──────────────────────────────────────────────
  async function loadPlaces() {
    if (!userLat) { if (typeof showToast==='function') showToast('share your location first'); return; }
    if (placesLoading) return;
    placesLoading = true;
    activeCardId  = null;
    showSkeletons();
    updateAriaLine(null);
    try {
      const raw     = await fetchPlacesOSM(userLat, userLng, activeCategory);
      currentPlaces = normalisePlaces(raw);
      renderPlacesList(currentPlaces);
      addPlaceMarkers(currentPlaces);
      const cat = CATEGORIES.find(function(c){ return c.id===activeCategory; });
      if (cat) updateAriaLine(cat.ariaLine);
    } catch(e) {
      console.error('[Explore]', e);
      const list = document.getElementById('explorePlacesList');
      if (list) list.innerHTML =
        '<div class="explore-empty">' +
          '<div class="explore-empty-text">couldn\'t reach map servers.<br>' +
          '<span onclick="ariaExplore.loadPlaces()" ' +
          'style="color:var(--rose);font-family:var(--font-mono);font-size:11px;' +
          'letter-spacing:0.06em;cursor:pointer;">retry</span></div></div>';
    } finally {
      placesLoading = false;
    }
  }

  function showSkeletons() {
    const list = document.getElementById('explorePlacesList');
    if (!list) return;
    const s = '<div class="explore-skeleton"><div class="skel-icon"></div>' +
      '<div class="skel-body"><div class="skel-line"></div>' +
      '<div class="skel-line short"></div></div></div>';
    list.innerHTML = s.repeat(5);
  }

  // ── Render list ──────────────────────────────────────────────
  function renderPlacesList(places) {
    const list = document.getElementById('explorePlacesList');
    if (!list) return;
    const cat  = CATEGORIES.find(function(c){ return c.id===activeCategory; });
    const icon = cat ? cat.icon : '•';
    if (!places.length) {
      list.innerHTML =
        '<div class="explore-empty">' +
          '<div class="explore-empty-text">nothing found nearby.<br>try another category.</div>' +
        '</div>';
      return;
    }
    list.innerHTML = places.slice(0,25).map(function(p,i) {
      return '<div class="explore-place-card" id="epc-' + p.id + '" data-pid="' + p.id + '" ' +
               'onclick="ariaExplore._onCardTap(this)" ' +
               'style="animation-delay:' + (i*0.04) + 's">' +
          '<div class="explore-place-icon">' + icon + '</div>' +
          '<div class="explore-place-body">' +
            '<div class="explore-place-name">' + p.name + '</div>' +
            '<div class="explore-place-meta">' +
              (p.dist    ? '<span class="explore-place-dist">' + p.dist + '</span>' : '') +
              (p.address ? '<span>· ' + p.address + '</span>' : '') +
              (p.cuisine ? '<span>· ' + p.cuisine + '</span>' : '') +
            '</div>' +
            '<div class="explore-aria-read-slot" id="ear-' + p.id + '" style="display:none;"></div>' +
          '</div>' +
          '<div class="explore-place-arrow">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M9 18l6-6-6-6"/></svg>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  // ── Card tap: map + list + inline read ───────────────────────
  function _onCardTap(cardEl) {
    const pid   = cardEl.dataset.pid;
    const place = currentPlaces.find(function(p){ return String(p.id)===String(pid); });
    if (!place) return;

    // Second tap on same card = open detail
    if (activeCardId === pid) {
      openPlaceDetail(place);
      return;
    }

    clearActiveCard();
    activeCardId = pid;
    highlightCard(pid);
    focusMapOnPlace(place);

    // Inline Aria read
    const slot = document.getElementById('ear-' + pid);
    if (slot) {
      slot.textContent = buildAriaInlineRead(place);
      slot.style.display = 'block';
    }
  }

  function highlightCard(pid) {
    document.querySelectorAll('.explore-place-card').forEach(function(c) {
      c.classList.toggle('explore-card-active', c.dataset.pid===String(pid));
    });
  }

  function clearActiveCard() {
    activeCardId = null;
    document.querySelectorAll('.explore-place-card').forEach(function(c) {
      c.classList.remove('explore-card-active');
      const slot = c.querySelector('.explore-aria-read-slot');
      if (slot) slot.style.display = 'none';
    });
  }

  function scrollToCard(pid) {
    const card = document.getElementById('epc-' + pid);
    if (card) card.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  // ── Place detail modal ───────────────────────────────────────
  function openPlaceDetail(place) {
    const cat     = CATEGORIES.find(function(c){ return c.id===activeCategory; });
    const icon    = cat ? cat.icon : '•';
    const mapsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + place.lat + ',' + place.lon;
    const osmUrl  = 'https://www.openstreetmap.org/?mlat=' + place.lat + '&mlon=' + place.lon +
                    '#map=17/' + place.lat + '/' + place.lon;
    const body    = document.getElementById('explorePlaceDetailBody');
    if (!body) return;

    body.innerHTML =
      '<div class="explore-detail-header">' +
        '<div class="explore-detail-icon">' + icon + '</div>' +
        '<div>' +
          '<div class="explore-detail-name">' + place.name + '</div>' +
          '<div class="explore-detail-type">' + (cat ? cat.label : activeCategory) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="explore-detail-meta">' +
        (place.dist     ? '<div class="explore-detail-pill rose">'  + place.dist + ' away</div>'             : '') +
        (place.opening  ? '<div class="explore-detail-pill green">' + place.opening.split(';')[0] + '</div>' : '') +
        (place.phone    ? '<div class="explore-detail-pill">'       + place.phone + '</div>'                 : '') +
        (place.wheelchair==='yes' ? '<div class="explore-detail-pill">accessible</div>'                      : '') +
      '</div>' +
      (place.address
        ? '<div style="font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-bottom:14px;letter-spacing:0.04em;">' + place.address + '</div>'
        : '') +
      '<div class="explore-detail-aria-note">' +
        '<strong>// aria</strong>' + buildDetailAriaNote(place) +
      '</div>' +
      // Directions is the primary full-width CTA
      '<button class="explore-detail-btn primary" ' +
        'onclick="window.open(\'' + mapsUrl + '\',\'_blank\')" ' +
        'style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>' +
        'directions' +
      '</button>' +
      '<div class="explore-detail-actions">' +
        (place.website
          ? '<button class="explore-detail-btn secondary" onclick="window.open(\'' + place.website + '\',\'_blank\')">website</button>'
          : '<button class="explore-detail-btn secondary" onclick="window.open(\'' + osmUrl + '\',\'_blank\')">view on map</button>') +
        '<button class="explore-detail-btn secondary" ' +
          'onclick="ariaExplore._sharePlace(\'' + encodeURIComponent(place.name) + '\',' + place.lat + ',' + place.lon + ')">share</button>' +
      '</div>';

    if (typeof openModal==='function') openModal('explorePlaceDetailModal');
  }

  function _sharePlace(encodedName, lat, lon) {
    const name = decodeURIComponent(encodedName);
    const url  = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon;
    if (navigator.share) {
      navigator.share({ title:name, url }).catch(function(){});
    } else {
      navigator.clipboard.writeText(url).then(function() {
        if (typeof showToast==='function') showToast('link copied', 'green');
      });
    }
  }

  // ── Aria line (top of list) ──────────────────────────────────
  function updateAriaLine(text) {
    const el = document.getElementById('exploreAriaLine');
    if (!el) return;
    if (!text) { el.style.display='none'; return; }
    el.textContent = text;
    el.style.display = 'flex';
  }

  // ── UI helpers ───────────────────────────────────────────────
  function setLocStatus(state, text) {
    const dot   = document.getElementById('exploreLocDot');
    const label = document.getElementById('exploreLocText');
    if (!dot||!label) return;
    dot.className = 'explore-loc-dot' +
      (state==='active' ? ' active' : state==='loading' ? ' loading' : '');
    label.textContent = text;
  }
  function hideBanner()     { const b=document.getElementById('exploreLocationBanner'); if(b) b.style.display='none'; }
  function showManualInput(){ const w=document.getElementById('exploreManualWrap');     if(w) w.style.display='block'; }

  // ── Category chips ───────────────────────────────────────────
  function selectCategory(id) {
    if (id===activeCategory && currentPlaces.length) return;
    activeCategory = id;
    activeCardId   = null;
    document.querySelectorAll('.explore-cat-chip').forEach(function(c) {
      c.classList.toggle('active', c.dataset.cat===id);
    });
    updateAriaLine(null);
    if (userLat) loadPlaces();
  }

  function renderCategoryChips() {
    const wrap = document.getElementById('exploreCats');
    if (!wrap) return;
    wrap.innerHTML = CATEGORIES.map(function(c) {
      return '<div class="explore-cat-chip ' + (c.id===activeCategory ? 'active' : '') +
        '" data-cat="' + c.id + '" onclick="ariaExplore.selectCategory(\'' + c.id + '\')">' +
        '<div class="explore-cat-icon">' + c.icon + '</div>' +
        '<div class="explore-cat-label">' + c.label + '</div>' +
      '</div>';
    }).join('');
  }

  // ── Init screen ──────────────────────────────────────────────
  async function initScreen() {
    renderCategoryChips();
    const banner = document.getElementById('exploreLocationBanner');
    if (userLat) {
      if (banner) banner.style.display='none';
      setLocStatus('active', locationLabel);
      await initMap();
      if (!placesLoading) loadPlaces();
    } else {
      if (banner) banner.style.display='flex';
      setLocStatus('loading', 'requesting location…');
      const mapWrap = document.getElementById('exploreMap');
      if (mapWrap && !mapInstance) {
        mapWrap.innerHTML =
          '<div class="explore-map-placeholder">' +
            '<div class="explore-map-placeholder-text">waiting for location</div>' +
          '</div>';
      }
      requestLocation();
    }
  }

  // ── Chat trigger ─────────────────────────────────────────────
  function detectChatTrigger(text) {
    return [
      /find\s+(me\s+)?(a\s+|some\s+)?place/i,
      /nearby/i, /around\s+(me|here)/i,
      /what.?s\s+(near|close|around)/i,
      /where\s+(can\s+i|should\s+i)\s+go/i,
      /places\s+near/i, /help\s+me\s+find/i,
      /hospital\s+near/i, /caf.+near/i, /restaurant.+near/i,
    ].some(function(r){ return r.test(text); });
  }

  // Simple link card — no inline context questions
  function injectChatCard() {
    return '<div style="margin-top:8px;padding:12px 14px;background:rgba(249,115,22,0.07);' +
      'border:1px solid rgba(249,115,22,0.2);border-left:2px solid rgba(249,115,22,0.5);">' +
      '<div style="font-family:var(--font-mono);font-size:9px;color:#f97316;letter-spacing:0.18em;' +
      'text-transform:uppercase;margin-bottom:6px;">// explore nearby</div>' +
      '<div style="font-family:var(--font-body);font-size:12px;color:rgba(240,236,228,0.75);' +
      'margin-bottom:10px;line-height:1.5;">i\'ll find somewhere for you.</div>' +
      '<button onclick="ariaExplore._chatOpenExplore()" style="width:100%;padding:10px;' +
      'background:transparent;border:1px solid rgba(249,115,22,0.6);color:#f97316;' +
      'font-family:var(--font-display);font-size:10px;font-weight:700;' +
      'letter-spacing:0.1em;cursor:pointer;">open explore</button>' +
    '</div>';
  }

  function _chatOpenExplore() {
    if (typeof showScreen==='function') showScreen('exploreScreen');
    setTimeout(function(){ initScreen(); }, 300);
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    init:                   initScreen,
    requestLocation:        requestLocation,
    geocodeManual:          geocodeManual,
    selectCategory:         selectCategory,
    openPlaceDetail:        openPlaceDetail,
    openPlaceDetailEncoded: function(enc) {
      try { openPlaceDetail(JSON.parse(decodeURIComponent(enc))); } catch(e){ console.error(e); }
    },
    loadPlaces:             loadPlaces,
    detectChatTrigger:      detectChatTrigger,
    injectChatCard:         injectChatCard,
    _chatOpenExplore:       _chatOpenExplore,
    _onCardTap:             _onCardTap,
    _sharePlace:            _sharePlace,
  };

})();

// ── Patch sendChatMessage ────────────────────────────────────
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
        if (typeof chatInputResize    === 'function') chatInputResize(input);
        if (typeof appendUserMessage  === 'function') appendUserMessage(text);
        if (typeof chatHistory        !== 'undefined') chatHistory.push({ role:'user', content:text });
        if (typeof scrollChatToBottom === 'function') scrollChatToBottom();
        setTimeout(function() {
          var msgs = document.getElementById('chatMessages');
          if (!msgs) return;
          var wrap = document.createElement('div');
          wrap.className = 'chat-msg-aria-wrap';
          wrap.style.animation = 'slide-up 0.25s ease both';
          wrap.innerHTML =
            '<div class="chat-msg-aria">' +
              '<div class="chat-bubble-aria" style="padding:0;background:transparent;border:none;">' +
                ariaExplore.injectChatCard() +
              '</div>' +
            '</div>';
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
