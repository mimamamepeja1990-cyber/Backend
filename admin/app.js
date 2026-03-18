/* promo-image initial block removed to avoid early API_BASE usage; code reinserted after API_BASE definition */

const SECTION_TITLES = {
  'dashboard': 'Dashboard',
  'catalog': 'Catálogo',
  'retail-prices': 'Precios minorista',
  'consumos': 'Consumición inmediata',
  'promotions': 'Promociones',
  'promo-images': 'Imágenes Promocionales',
  'filters': 'Filtros',
  'orders': 'Pedidos',
  'customers': 'Clientes',
  'preparations': 'Preparaciones',
  'routes': 'Rutas',
  'deliveries': 'Entregas',
  'users': 'Usuarios',
  'admin-console': 'Consola Admin',
};
let currentAdminUser = null;
let currentSectionId = 'dashboard';

let driverMap = null;
let driverMapReady = false;
let driverMapInit = false;
let driverMapPoll = null;
const driverMapMarkers = new Map();
const driverMarkerAnim = new Map();
let driverAnimFrame = null;
const driverRouteState = new Map();
let driverDirectionsService = null;
const driverMapData = new Map();
let selectedDriverId = '';
let selectedDriverData = null;
let selectedDriverInsights = null;
let driverInspectorView = 'orders';
let driverLiveTracePolyline = null;
let driverPlannedRoutePolyline = null;
const driverRouteStopMarkers = [];
let driverInsightsReqSeq = 0;
let driverRouteOverlayReqSeq = 0;
// 0 disables age-based hiding; rely on explicit offline events instead.
const DRIVER_LOCATION_STALE_SEC = 0;
const DRIVER_ANIM_MIN_MS = 600;
const DRIVER_ANIM_MAX_MS = 8000;
const DRIVER_ROUTE_HISTORY_MS = 12000;
const DRIVER_ROUTE_REFRESH_MS = 6000;
const DRIVER_ROUTE_MIN_DISTANCE_M = 60;
const DRIVER_ROUTE_SEGMENT_MIN_MS = 120;
const DRIVER_ROUTE_SEGMENT_MAX_MS = 900;
const DRIVER_USE_ROAD_SNAPPING = true;
const DRIVER_ROUTE_DIRECTIONS_MAX_WAYPOINTS = 23;
const DRIVER_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#eef2f6' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#334155' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e8f5e9' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3b82f6' }] },
];

function getDriverMapElements(){
  return {
    container: document.getElementById('driverMap'),
    empty: document.getElementById('driverMapEmpty'),
  };
}

function getDriverInspectorElements(){
  return {
    root: document.getElementById('driverInspector'),
    title: document.getElementById('driverInspectorTitle'),
    meta: document.getElementById('driverInspectorMeta'),
    body: document.getElementById('driverInspectorBody'),
    tabs: document.getElementById('driverInspectorTabs'),
    metricKm: document.getElementById('driverMetricKm'),
    metricKmMeta: document.getElementById('driverMetricKmMeta'),
    metricTime: document.getElementById('driverMetricTime'),
    metricTimeMeta: document.getElementById('driverMetricTimeMeta'),
    metricCompleted: document.getElementById('driverMetricCompleted'),
    metricCompletedMeta: document.getElementById('driverMetricCompletedMeta'),
    metricEfficiency: document.getElementById('driverMetricEfficiency'),
    metricEfficiencyMeta: document.getElementById('driverMetricEfficiencyMeta'),
  };
}

function getDriverId(driver){
  if (!driver) return '';
  return String(driver.driver_id || driver.id || driver.driver_username || driver.username || driver.driver_name || driver.full_name || '').trim();
}

function getDriverMarkerIcon(isSelected){
  if (!(window.google && window.google.maps)) return null;
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: isSelected ? 9 : 7,
    fillColor: isSelected ? '#f26b38' : '#0ea5e9',
    fillOpacity: 0.95,
    strokeColor: '#0f172a',
    strokeOpacity: 0.7,
    strokeWeight: isSelected ? 3 : 2,
  };
}

function syncDriverMarkerStyle(id){
  const marker = driverMapMarkers.get(id);
  if (!marker) return;
  const icon = getDriverMarkerIcon(id === selectedDriverId);
  if (icon){
    try{ marker.setIcon(icon); }catch(_){ }
  }
}

function syncAllDriverMarkerStyles(){
  driverMapMarkers.forEach((marker, id) => {
    try{ syncDriverMarkerStyle(id); }catch(_){ }
  });
}

function clearDriverRouteOverlays(){
  driverRouteOverlayReqSeq += 1;
  if (driverLiveTracePolyline){
    try{ driverLiveTracePolyline.setMap(null); }catch(_){ }
    driverLiveTracePolyline = null;
  }
  if (driverPlannedRoutePolyline){
    try{ driverPlannedRoutePolyline.setMap(null); }catch(_){ }
    driverPlannedRoutePolyline = null;
  }
  while (driverRouteStopMarkers.length){
    const marker = driverRouteStopMarkers.pop();
    try{ marker && marker.setMap(null); }catch(_){ }
  }
}

function clearDriverMarkers(){
  driverMapMarkers.forEach((marker) => {
    try{ marker.setMap(null); }catch(_){ }
  });
  driverMapMarkers.clear();
  driverMapData.clear();
  driverMarkerAnim.clear();
  driverRouteState.clear();
  driverAnimFrame = null;
  clearDriverRouteOverlays();
  selectedDriverId = '';
  selectedDriverData = null;
  selectedDriverInsights = null;
  renderDriverInspectorPlaceholder();
}

function removeDriverMarkerById(id){
  if (!id) return;
  const marker = driverMapMarkers.get(id);
  if (marker){
    try{ marker.setMap(null); }catch(_){ }
    driverMapMarkers.delete(id);
  }
  driverMapData.delete(id);
  driverMarkerAnim.delete(id);
  driverRouteState.delete(id);
  if (selectedDriverId && String(selectedDriverId) === String(id)){
    selectedDriverId = '';
    selectedDriverData = null;
    selectedDriverInsights = null;
    clearDriverRouteOverlays();
    renderDriverInspectorPlaceholder('El repartidor seleccionado quedó offline o sin ubicación reciente.');
    syncAllDriverMarkerStyles();
  }
}

function toLatLngLiteral(pos){
  if (!pos) return null;
  try{
    if (typeof pos.lat === 'function' && typeof pos.lng === 'function'){
      return { lat: pos.lat(), lng: pos.lng() };
    }
  }catch(_){ }
  if (typeof pos.lat === 'number' && typeof pos.lng === 'number'){
    return { lat: pos.lat, lng: pos.lng };
  }
  return null;
}

function animateDriverMarkerTo(id, marker, target, durationMs, onComplete){
  if (!id || !marker || !target) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const state = driverMarkerAnim.get(id) || {};
  const current = toLatLngLiteral(marker.getPosition()) || target;
  let duration = Number(durationMs);
  if (!Number.isFinite(duration)){
    duration = 1200;
    if (state.lastUpdateAt){
      const delta = Math.max(0, now - state.lastUpdateAt);
      duration = Math.min(DRIVER_ANIM_MAX_MS, Math.max(DRIVER_ANIM_MIN_MS, delta));
    }
  }
  state.start = current;
  state.end = target;
  state.startTime = now;
  state.endTime = now + duration;
  state.lastUpdateAt = now;
  state.onComplete = typeof onComplete === 'function' ? onComplete : null;
  driverMarkerAnim.set(id, state);
  if (!driverAnimFrame){
    driverAnimFrame = requestAnimationFrame(stepDriverAnimations);
  }
}

function stepDriverAnimations(ts){
  let active = false;
  driverMarkerAnim.forEach((state, id) => {
    const marker = driverMapMarkers.get(id);
    if (!marker){
      driverMarkerAnim.delete(id);
      return;
    }
    if (!state || !state.start || !state.end || !state.startTime || !state.endTime){
      return;
    }
    const denom = state.endTime - state.startTime || 1;
    const t = Math.min(1, Math.max(0, (ts - state.startTime) / denom));
    const lat = state.start.lat + (state.end.lat - state.start.lat) * t;
    const lng = state.start.lng + (state.end.lng - state.start.lng) * t;
    try{ marker.setPosition({ lat, lng }); }catch(_){ }
    if (t < 1){
      active = true;
    } else {
      const done = state.onComplete;
      state.onComplete = null;
      state.start = state.end;
      state.startTime = null;
      state.endTime = null;
      if (done){
        try{ done(); }catch(_){ }
        active = true;
      }
    }
  });
  if (active){
    driverAnimFrame = requestAnimationFrame(stepDriverAnimations);
  } else {
    driverAnimFrame = null;
  }
}

function getDriverRouteState(id){
  if (!id) return null;
  let state = driverRouteState.get(id);
  if (!state){
    state = { history: [], pending: false, lastRouteAt: 0, routeQueue: null };
    driverRouteState.set(id, state);
  }
  return state;
}

function toRad(v){ return (v * Math.PI) / 180; }
function distanceMeters(a, b){
  if (!a || !b) return 0;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bufferDriverHistory(id, point){
  const state = getDriverRouteState(id);
  if (!state) return;
  const now = Date.now();
  state.history.push({ lat: point.lat, lng: point.lng, ts: now });
  const cutoff = now - DRIVER_ROUTE_HISTORY_MS;
  while (state.history.length > 0 && state.history[0].ts < cutoff){
    state.history.shift();
  }
}

function getDirectionsService(){
  if (!driverDirectionsService && window.google && window.google.maps && window.google.maps.DirectionsService){
    driverDirectionsService = new google.maps.DirectionsService();
  }
  return driverDirectionsService;
}

function normalizePathPoints(points){
  if (!Array.isArray(points)) return [];
  const out = [];
  points.forEach((p) => {
    try{
      if (p && typeof p.lat === 'function' && typeof p.lng === 'function'){
        out.push({ lat: p.lat(), lng: p.lng() });
        return;
      }
    }catch(_){ }
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)){
      out.push({ lat: p.lat, lng: p.lng });
    }
  });
  return out;
}

function buildDriverRouteCacheKey(routePoints){
  if (!Array.isArray(routePoints)) return '';
  return routePoints.map((point, index) => {
    const lat = Number(point && point.lat);
    const lng = Number(point && (point.lng ?? point.lon));
    return [
      String(point && point.kind || 'point'),
      String(point && point.order_id || index),
      Number.isFinite(lat) ? lat.toFixed(5) : 'nan',
      Number.isFinite(lng) ? lng.toFixed(5) : 'nan',
    ].join(':');
  }).join('|');
}

function mergeDriverRoutePath(target, source){
  const out = Array.isArray(target) ? target.slice() : [];
  normalizePathPoints(source).forEach((point) => {
    const prev = out.length ? out[out.length - 1] : null;
    if (prev && Math.abs(prev.lat - point.lat) < 0.000001 && Math.abs(prev.lng - point.lng) < 0.000001) return;
    out.push(point);
  });
  return out;
}

function requestDriverRoadSegment(service, stops){
  return new Promise((resolve, reject) => {
    if (!service || !Array.isArray(stops) || stops.length < 2){
      reject(new Error('invalid-road-segment'));
      return;
    }
    const origin = { lat: Number(stops[0].lat), lng: Number(stops[0].lng) };
    const destination = { lat: Number(stops[stops.length - 1].lat), lng: Number(stops[stops.length - 1].lng) };
    const waypoints = stops.slice(1, -1).map((point) => ({
      location: { lat: Number(point.lat), lng: Number(point.lng) },
      stopover: true,
    }));
    service.route(
      {
        origin,
        destination,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (status === 'OK' && result && result.routes && result.routes[0]){
          resolve(normalizePathPoints(result.routes[0].overview_path || []));
          return;
        }
        reject(new Error(String(status || 'route-failed')));
      },
    );
  });
}

async function buildDriverRoadPath(driverId, routePoints){
  const state = getDriverRouteState(driverId);
  const stops = normalizePathPoints((routePoints || []).map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) })));
  if (!state || stops.length < 2) return stops;
  const cacheKey = buildDriverRouteCacheKey(routePoints);
  if (state.plannedRouteKey === cacheKey && Array.isArray(state.plannedRoutePath) && state.plannedRoutePath.length > 1){
    return state.plannedRoutePath.slice();
  }
  if (state.plannedRoutePromise && state.plannedRouteKey === cacheKey){
    return state.plannedRoutePromise;
  }
  const service = getDirectionsService();
  if (!service) return stops;

  state.plannedRouteKey = cacheKey;
  state.plannedRoutePromise = (async () => {
    let cursor = 0;
    let fullPath = [];
    while (cursor < stops.length - 1){
      const chunk = stops.slice(cursor, Math.min(stops.length, cursor + DRIVER_ROUTE_DIRECTIONS_MAX_WAYPOINTS + 2));
      const segmentPath = await requestDriverRoadSegment(service, chunk);
      fullPath = mergeDriverRoutePath(fullPath, segmentPath);
      cursor += Math.max(1, chunk.length - 1);
    }
    state.plannedRoutePath = fullPath.length > 1 ? fullPath.slice() : stops.slice();
    state.plannedRoutePromise = null;
    return state.plannedRoutePath.slice();
  })().catch((err) => {
    state.plannedRoutePromise = null;
    state.plannedRoutePath = stops.slice();
    throw err;
  });
  return state.plannedRoutePromise;
}

function fitDriverRouteBounds(locationPoints, routePoints, plannedPath){
  if (!(driverMapReady && window.google && window.google.maps)) return;
  const bounds = new google.maps.LatLngBounds();
  let pointCount = 0;
  locationPoints.forEach((point) => { bounds.extend(point); pointCount += 1; });
  normalizePathPoints(plannedPath).forEach((point) => { bounds.extend(point); pointCount += 1; });
  if (!pointCount){
    routePoints.forEach((point) => {
      bounds.extend({ lat: Number(point.lat), lng: Number(point.lng) });
      pointCount += 1;
    });
  }
  if (pointCount > 1){
    try{ driverMap.fitBounds(bounds, 64); }catch(_){ }
  } else if (pointCount === 1){
    try{
      const center = bounds.getCenter();
      driverMap.setCenter(center);
      driverMap.setZoom(13);
    }catch(_){ }
  }
}

function startDriverRouteAnimation(id, points, durationMs){
  const marker = driverMapMarkers.get(id);
  if (!marker) return;
  const state = getDriverRouteState(id);
  if (!state) return;
  const path = normalizePathPoints(points);
  if (path.length < 2) return;
  const totalSegments = Math.max(1, path.length - 1);
  const segMs = Math.min(
    DRIVER_ROUTE_SEGMENT_MAX_MS,
    Math.max(DRIVER_ROUTE_SEGMENT_MIN_MS, Number(durationMs) / totalSegments || DRIVER_ROUTE_SEGMENT_MIN_MS),
  );
  state.routeQueue = { points: path, index: 0, segMs: segMs };
  advanceDriverRoute(id);
}

function advanceDriverRoute(id){
  const state = driverRouteState.get(id);
  if (!state || !state.routeQueue) return;
  const marker = driverMapMarkers.get(id);
  if (!marker){
    state.routeQueue = null;
    return;
  }
  const queue = state.routeQueue;
  if (queue.index >= queue.points.length - 1){
    state.routeQueue = null;
    return;
  }
  queue.index += 1;
  const target = queue.points[queue.index];
  animateDriverMarkerTo(id, marker, target, queue.segMs, () => advanceDriverRoute(id));
}

async function loadGoogleMapsApi(){
  if (window.google && window.google.maps) return true;
  const key = (window.GOOGLE_MAPS_API_KEY || '').trim();
  if (!key) return false;
  if (window.__googleMapsLoading) return window.__googleMapsLoading;
  window.__googleMapsLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      try{ window.__googleMapsLoading = null; }catch(_){ }
      reject(new Error('maps-load-failed'));
    };
    document.head.appendChild(script);
  });
  try{
    await window.__googleMapsLoading;
    return true;
  }catch(e){
    try{ window.__googleMapsLoading = null; }catch(_){ }
    return false;
  }
}

function setDriverMapEmpty(message){
  const { empty } = getDriverMapElements();
  if (!empty) return;
  empty.textContent = message || '';
  empty.style.display = message ? 'block' : 'none';
}

async function initDriverMap(){
  if (driverMapInit) return;
  driverMapInit = true;
  const { container } = getDriverMapElements();
  if (!container){
    driverMapInit = false;
    driverMapReady = false;
    return;
  }
  const ok = await loadGoogleMapsApi();
  if (!ok){
    setDriverMapEmpty('Configura GOOGLE_MAPS_JS_API_KEY para ver el mapa.');
    driverMapInit = false;
    driverMapReady = false;
    return;
  }
  const center = { lat: -32.883, lng: -68.84 };
  driverMap = new google.maps.Map(container, {
    center,
    zoom: 10,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    styles: DRIVER_MAP_STYLE,
  });
  try{
    driverMap.addListener('click', () => {
      if (!selectedDriverId) return;
      clearDriverRouteOverlays();
      selectedDriverId = '';
      selectedDriverData = null;
      selectedDriverInsights = null;
      syncAllDriverMarkerStyles();
      renderDriverInspectorPlaceholder();
    });
  }catch(_){ }
  driverMapReady = true;
  setDriverMapEmpty('');
  renderDriverInspectorPlaceholder();
  try{ await refreshDriverLocations(true); }catch(_){ }
}

function updateDriverMarker(driver){
  if (!driver || !driverMapReady) return;
  const lat = Number(driver.lat);
  const lon = Number(driver.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const id = getDriverId(driver);
  if (!id) return false;
  const labelText = String(driver.driver_name || driver.driver_username || '').trim();
  driverMapData.set(id, Object.assign({}, driver));
  const icon = getDriverMarkerIcon(id === selectedDriverId);
  let marker = driverMapMarkers.get(id);
  const state = getDriverRouteState(id);
  const now = Date.now();
  const point = { lat, lng: lon };
  if (!marker){
    marker = new google.maps.Marker({
      map: driverMap,
      position: { lat, lng: lon },
      icon: icon || undefined,
      label: labelText ? { text: labelText, fontSize: '12px', fontWeight: '600', color: '#1f2937' } : undefined,
      title: labelText || 'Repartidor',
    });
    try{
      marker.addListener('click', () => {
        selectDriverOnMap(driverMapData.get(id) || driver, { focusMap: driverInspectorView === 'route' });
      });
    }catch(_){ }
    driverMapMarkers.set(id, marker);
    driverMarkerAnim.set(id, { lastUpdateAt: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() });
    if (state) bufferDriverHistory(id, point);
  } else {
    if (state) bufferDriverHistory(id, point);
    let usedRoute = false;
    if (DRIVER_USE_ROAD_SNAPPING && state){
      const service = getDirectionsService();
      if (service && !state.pending){
        const elapsed = now - (state.lastRouteAt || 0);
        if (elapsed >= DRIVER_ROUTE_REFRESH_MS && state.history.length >= 2){
          const origin = state.history[0];
          const dest = state.history[state.history.length - 1];
          const dist = distanceMeters(origin, dest);
          if (dist >= DRIVER_ROUTE_MIN_DISTANCE_M){
            state.pending = true;
            state.lastRouteAt = now;
            service.route(
              {
                origin: origin,
                destination: dest,
                travelMode: google.maps.TravelMode.DRIVING,
                provideRouteAlternatives: false,
              },
              (result, status) => {
                state.pending = false;
                if (status === 'OK' && result && result.routes && result.routes[0]){
                  const routePath = result.routes[0].overview_path || [];
                  startDriverRouteAnimation(id, routePath, Math.max(DRIVER_ROUTE_REFRESH_MS, elapsed));
                  state.history = [dest];
                }
              },
            );
            usedRoute = true;
          }
        }
      }
      if (state.routeQueue){
        usedRoute = true;
      }
    }
    if (!usedRoute){
      animateDriverMarkerTo(id, marker, { lat, lng: lon });
    }
    if (labelText) marker.setLabel({ text: labelText, fontSize: '12px', fontWeight: '600', color: '#1f2937' });
    if (icon) marker.setIcon(icon);
  }
  if (id === selectedDriverId){
    selectedDriverData = Object.assign({}, selectedDriverData || {}, driver);
  }
  return true;
}

async function refreshDriverLocations(force){
  if (!driverMapReady) return;
  let list = [];
  try{
    list = await safeFetch(API_BASE + '/admin/driver-locations');
  }catch(e){
    const status = Number(e && e.status);
    if (status === 401 || status === 403){
      setDriverMapEmpty('Sin acceso a ubicaciones. Volvé a iniciar sesión.');
      clearDriverMarkers();
    } else {
      setDriverMapEmpty('No se pudieron cargar ubicaciones.');
    }
    return;
  }
  if (!Array.isArray(list) || list.length === 0){
    if (driverMapMarkers.size === 0){
      setDriverMapEmpty('Sin ubicaciones recientes de repartidores.');
    }
    return;
  }
  const seen = new Set();
  let visible = 0;
  list.forEach((driver) => {
    const id = getDriverId(driver);
    if (!id) return;
    const age = Number(driver.age_sec);
    if (DRIVER_LOCATION_STALE_SEC > 0 && Number.isFinite(age) && age > DRIVER_LOCATION_STALE_SEC) return;
    const ok = updateDriverMarker(driver);
    if (ok){
      seen.add(id);
      visible += 1;
    }
  });
  driverMapMarkers.forEach((marker, id) => {
    if (!seen.has(id)){
      removeDriverMarkerById(id);
    }
  });
  if (visible === 0){
    setDriverMapEmpty('Sin ubicaciones recientes de repartidores.');
  } else {
    setDriverMapEmpty('');
  }
  if (selectedDriverId){
    try{ await refreshSelectedDriverInsights(false); }catch(_){ }
  }
}

function startDriverMapPolling(){
  if (driverMapPoll) return;
  driverMapPoll = setInterval(() => {
    if (currentSectionId !== 'dashboard') return;
    refreshDriverLocations(false);
  }, 10000);
}

function stopDriverMapPolling(){
  if (driverMapPoll){
    clearInterval(driverMapPoll);
    driverMapPoll = null;
  }
}

function formatDriverRelativeAge(ageSec, recordedAt){
  let age = Number(ageSec);
  if (!Number.isFinite(age) && recordedAt){
    const parsed = Date.parse(recordedAt);
    if (Number.isFinite(parsed)){
      age = Math.max(0, (Date.now() - parsed) / 1000);
    }
  }
  if (!Number.isFinite(age)) return '';
  if (age < 60) return `Actualizado hace ${Math.round(age)}s`;
  if (age < 3600) return `Actualizado hace ${Math.round(age / 60)} min`;
  return `Actualizado hace ${Math.round(age / 3600)} h`;
}

function formatDriverDistance(km){
  const n = Number(km);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} km`;
}

function formatDriverActiveTime(minutes){
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (!total) return '0 min';
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

function formatDriverEfficiency(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n >= 100 ? 0 : 1)}%`;
}

function setDriverInspectorView(view){
  driverInspectorView = ['orders', 'route', 'history'].includes(view) ? view : 'orders';
  const { tabs } = getDriverInspectorElements();
  if (!tabs) return;
  tabs.querySelectorAll('[data-driver-view]').forEach((btn) => {
    btn.classList.toggle('active', String(btn.dataset.driverView || '') === driverInspectorView);
  });
}

function resetDriverInspectorMetrics(){
  const els = getDriverInspectorElements();
  if (els.metricKm) els.metricKm.textContent = '—';
  if (els.metricKmMeta) els.metricKmMeta.textContent = 'Seleccioná un repartidor';
  if (els.metricTime) els.metricTime.textContent = '—';
  if (els.metricTimeMeta) els.metricTimeMeta.textContent = 'Operativa de hoy';
  if (els.metricCompleted) els.metricCompleted.textContent = '—';
  if (els.metricCompletedMeta) els.metricCompletedMeta.textContent = 'Operativa de hoy';
  if (els.metricEfficiency) els.metricEfficiency.textContent = '—';
  if (els.metricEfficiencyMeta) els.metricEfficiencyMeta.textContent = 'Sobre pedidos gestionados';
}

function renderDriverInspectorPlaceholder(message){
  const els = getDriverInspectorElements();
  if (els.title) els.title.textContent = 'Seleccioná un repartidor';
  if (els.meta) els.meta.textContent = message || 'Hacé click sobre un repartidor del mapa para ver pedidos activos, ruta e historial.';
  if (els.body) els.body.innerHTML = `<div class="driver-empty-note">${escapeHtml(message || 'Seleccioná un repartidor para explorar su operación.')}</div>`;
  resetDriverInspectorMetrics();
  setDriverInspectorView(driverInspectorView);
}

function renderDriverInspectorLoading(driver){
  const els = getDriverInspectorElements();
  const name = String((driver && (driver.driver_name || driver.full_name || driver.driver_username || driver.username)) || 'Repartidor').trim();
  if (els.title) els.title.textContent = name || 'Repartidor';
  if (els.meta) els.meta.textContent = 'Cargando pedidos, ruta e historial...';
  if (els.body) els.body.innerHTML = '<div class="driver-empty-note">Cargando detalle del repartidor...</div>';
  resetDriverInspectorMetrics();
  setDriverInspectorView(driverInspectorView);
}

function getSelectedDriverName(source){
  if (!source) return 'Repartidor';
  return String(source.driver_name || source.full_name || source.driver_username || source.username || 'Repartidor').trim() || 'Repartidor';
}

function getDriverInsightsOrderById(orderId){
  const id = String(orderId || '').trim();
  if (!id || !selectedDriverInsights) return null;
  const collections = []
    .concat(Array.isArray(selectedDriverInsights.active_orders) ? selectedDriverInsights.active_orders : [])
    .concat(Array.isArray(selectedDriverInsights.history_orders) ? selectedDriverInsights.history_orders : []);
  return collections.find(o => String(o && o.id) === id) || null;
}

function bindDriverInspectorBodyActions(){
  const { body } = getDriverInspectorElements();
  if (!body) return;
  body.querySelectorAll('.viewDriverOrderBtn').forEach((btn) => {
    btn.onclick = async () => {
      const id = String((btn && btn.dataset && btn.dataset.orderId) || '').trim();
      if (!id) return;
      const existing = getDriverInsightsOrderById(id);
      if (existing){
        showOrderDetail(existing);
        return;
      }
      const list = await fetchOrders(String(id));
      const order = (list || []).find(x => String(x.id) === id) || (list && list[0]);
      if (order) showOrderDetail(order);
    };
  });
}

function renderDriverRouteOverlay(insights, focusMap){
  clearDriverRouteOverlays();
  if (!(driverMapReady && window.google && window.google.maps) || !insights) return;
  const overlayReqId = driverRouteOverlayReqSeq;
  const locationPoints = (Array.isArray(insights.location_points) ? insights.location_points : []).map((point) => {
    const lat = Number(point && point.lat);
    const lon = Number(point && (point.lon ?? point.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lng: lon };
  }).filter(Boolean);
  const routePoints = (Array.isArray(insights.route_points) ? insights.route_points : []).map((point) => {
    const lat = Number(point && point.lat);
    const lon = Number(point && (point.lon ?? point.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return Object.assign({}, point, { lat, lng: lon });
  }).filter(Boolean);
  const driverId = getDriverId((insights && insights.driver) || selectedDriverData || {});
  const fallbackPath = routePoints.map((point) => ({ lat: point.lat, lng: point.lng }));

  if (locationPoints.length > 1){
    driverLiveTracePolyline = new google.maps.Polyline({
      map: driverMap,
      path: locationPoints,
      strokeColor: '#0ea5e9',
      strokeOpacity: 0.95,
      strokeWeight: 4,
    });
  }
  routePoints.forEach((point, idx) => {
    if (String(point.kind || '') !== 'order') return;
    const marker = new google.maps.Marker({
      map: driverMap,
      position: { lat: point.lat, lng: point.lng },
      label: { text: String(point.route_order || (idx + 1)), color: '#0f172a', fontWeight: '700', fontSize: '11px' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: '#ffffff',
        fillOpacity: 0.98,
        strokeColor: '#f26b38',
        strokeWeight: 2,
      },
      title: point.label || `Parada ${idx + 1}`,
    });
    driverRouteStopMarkers.push(marker);
  });
  if (focusMap){
    fitDriverRouteBounds(locationPoints, routePoints, fallbackPath);
  }
  if (routePoints.length <= 1){
    return;
  }
  buildDriverRoadPath(driverId, routePoints)
    .then((plannedPath) => {
      if (overlayReqId !== driverRouteOverlayReqSeq) return;
      const finalPath = normalizePathPoints(plannedPath).length > 1 ? normalizePathPoints(plannedPath) : fallbackPath;
      driverPlannedRoutePolyline = new google.maps.Polyline({
        map: driverMap,
        path: finalPath,
        strokeColor: locationPoints.length > 1 ? '#f59e0b' : '#f26b38',
        strokeOpacity: locationPoints.length > 1 ? 0.46 : 0.92,
        strokeWeight: locationPoints.length > 1 ? 4 : 5,
      });
      if (focusMap){
        fitDriverRouteBounds(locationPoints, routePoints, finalPath);
      }
    })
    .catch((err) => {
      console.warn('driver route directions fallback', err);
      if (overlayReqId !== driverRouteOverlayReqSeq) return;
      driverPlannedRoutePolyline = new google.maps.Polyline({
        map: driverMap,
        path: fallbackPath,
        strokeColor: locationPoints.length > 1 ? '#f59e0b' : '#f26b38',
        strokeOpacity: locationPoints.length > 1 ? 0.42 : 0.92,
        strokeWeight: locationPoints.length > 1 ? 3 : 4,
      });
      if (focusMap){
        fitDriverRouteBounds(locationPoints, routePoints, fallbackPath);
      }
    });
}

function buildDriverInspectorMeta(insights){
  if (!insights) return '';
  const driver = insights.driver || {};
  const live = insights.live_location || {};
  const metrics = insights.metrics || {};
  const parts = [];
  if (driver.zone) parts.push(`Zona ${driver.zone}`);
  const ageLabel = formatDriverRelativeAge(live.age_sec, live.recorded_at);
  if (ageLabel) parts.push(ageLabel);
  const activeOrders = Number(metrics.active_orders || 0);
  parts.push(activeOrders === 1 ? '1 pedido activo' : `${activeOrders} pedidos activos`);
  return parts.join(' · ');
}

function buildDriverOrderCard(order, extraHtml, extraChips){
  const customer = getOrderPrimaryName(order) || `Pedido #${order && order.id}`;
  const address = getOrderAddress(order) || 'Dirección pendiente';
  const notes = getOrderDeliveryNotes(order);
  const statusNorm = normalizeOrderStatus(order && order.status);
  const statusLabel = formatOrderStatusLabel(statusNorm);
  const mapsLinkHtml = getOrderGoogleMapsLinkHtml(order, 'Abrir en Maps', 'route-map-link');
  const chips = [
    `<span class="driver-detail-chip">#${escapeHtml(order && order.id)}</span>`,
    `<span class="driver-detail-chip">${escapeHtml(statusLabel)}</span>`,
    `<span class="driver-detail-chip">$${Number((order && order.total) || 0).toFixed(2)}</span>`,
  ].concat(Array.isArray(extraChips) ? extraChips : []);
  return `
    <div class="driver-detail-card">
      <div class="driver-detail-top">
        <div>
          <div class="driver-detail-title">${escapeHtml(customer)}</div>
          <div class="driver-detail-subtitle">${escapeHtml(address)}</div>
        </div>
        <div class="driver-detail-meta">${chips.join('')}</div>
      </div>
      ${notes ? `<div class="driver-history-note"><strong>Notas:</strong> ${escapeHtml(notes)}</div>` : ''}
      ${extraHtml || ''}
      <div class="driver-detail-actions">
        <button type="button" class="btn small viewDriverOrderBtn" data-order-id="${escapeHtml(order && order.id)}">Ver pedido</button>
        ${mapsLinkHtml || ''}
      </div>
    </div>
  `;
}

function renderDriverOrdersView(insights){
  const activeOrders = Array.isArray(insights && insights.active_orders) ? insights.active_orders : [];
  if (!activeOrders.length){
    return '<div class="driver-empty-note">Este repartidor no tiene pedidos activos ahora mismo.</div>';
  }
  return `
    <div class="driver-summary-line">
      <span class="driver-summary-pill">${activeOrders.length} pedidos activos</span>
      <span class="driver-summary-pill">Click en "Ver pedido" para abrir el detalle completo</span>
    </div>
    <div class="driver-detail-list">
      ${activeOrders.map((order) => {
        const routeOrder = Number(order && order.route_order);
        const chip = Number.isFinite(routeOrder) ? [`<span class="driver-detail-chip">Parada ${routeOrder}</span>`] : [];
        return buildDriverOrderCard(order, '', chip);
      }).join('')}
    </div>
  `;
}

function renderDriverRouteView(insights){
  const routePoints = Array.isArray(insights && insights.route_points) ? insights.route_points : [];
  const locationPoints = Array.isArray(insights && insights.location_points) ? insights.location_points : [];
  const mode = String((insights && insights.route_mode) || '');
  const label = mode === 'live_trace' ? 'Trayecto real reciente sobre calles' : 'Ruta planificada sobre calles';
  if (!routePoints.length){
    if (locationPoints.length > 1){
      return `
        <div class="driver-summary-line">
          <span class="driver-summary-pill">${escapeHtml(label)}</span>
        </div>
        <div class="driver-empty-note">No hay pedidos activos cargados ahora mismo, pero el mapa muestra el recorrido reciente del repartidor.</div>
      `;
    }
    return '<div class="driver-empty-note">No hay puntos suficientes para dibujar la ruta de este repartidor.</div>';
  }
  return `
    <div class="driver-summary-line">
      <span class="driver-summary-pill">${escapeHtml(label)}</span>
      <span class="driver-summary-pill">${routePoints.filter(point => String(point.kind || '') === 'order').length} paradas activas</span>
    </div>
    <div class="driver-route-stack">
      ${routePoints.map((point, index) => {
        const isLive = String(point && point.kind || '') === 'live';
        const idxLabel = isLive ? '●' : String(point.route_order || (index + 1));
        const title = isLive ? (point.label || getSelectedDriverName(selectedDriverData || selectedDriverInsights && selectedDriverInsights.driver)) : (point.label || `Pedido #${point.order_id || index}`);
        const subtitle = isLive ? (formatDriverRelativeAge(null, point.recorded_at) || 'Ubicación actual') : (point.address || 'Dirección pendiente');
        const actionHtml = isLive || !point.order_id
          ? ''
          : `<div class="driver-detail-actions"><button type="button" class="btn small viewDriverOrderBtn" data-order-id="${escapeHtml(point.order_id)}">Ver pedido</button></div>`;
        return `
          <div class="driver-route-row ${isLive ? 'live' : ''}">
            <span class="driver-route-index">${escapeHtml(idxLabel)}</span>
            <div class="driver-route-main">
              <div class="driver-route-title">${escapeHtml(title)}</div>
              <div class="driver-route-address">${escapeHtml(subtitle)}</div>
              ${!isLive && point.status ? `<div class="driver-inline-note">${escapeHtml(formatOrderStatusLabel(point.status))}</div>` : ''}
              ${actionHtml}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderDriverHistoryView(insights){
  const historyOrders = Array.isArray(insights && insights.history_orders) ? insights.history_orders : [];
  if (!historyOrders.length){
    return '<div class="driver-empty-note">No hay entregas ni incidencias recientes para este repartidor.</div>';
  }
  return `
    <div class="driver-detail-list">
      ${historyOrders.map((order) => {
        const latestIssue = getLatestDeliveryIssue(order);
        const eventLabel = formatDeliveryIncidentLabel(latestIssue, order);
        const eventAt = order.delivered_at || (latestIssue && latestIssue.created_at) || order.last_delivery_issue_at || order.created_at || null;
        const eventDate = eventAt ? new Date(eventAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const photoHtml = buildDeliveryPhotoHtml((latestIssue && latestIssue.photo_url) || order.last_delivery_issue_photo_url || '');
        const noteHtml = String((latestIssue && latestIssue.note) || order.cancel_reason || '').trim()
          ? `<div class="driver-history-note">${escapeHtml(String((latestIssue && latestIssue.note) || order.cancel_reason || '').trim())}</div>`
          : '';
        const extraHtml = `
          <div class="driver-history-event">
            <div class="driver-history-meta">
              <span class="driver-inline-note">${escapeHtml(eventLabel)}</span>
              <span class="driver-history-date">${escapeHtml(eventDate)}</span>
            </div>
            ${noteHtml}
            ${photoHtml.indexOf('<img') >= 0 ? `<div>${photoHtml}</div>` : ''}
          </div>
        `;
        return buildDriverOrderCard(order, extraHtml, []);
      }).join('')}
    </div>
  `;
}

function renderSelectedDriverInsights(insights, options){
  if (!insights) return;
  selectedDriverInsights = insights;
  const driver = insights.driver || selectedDriverData || {};
  const metrics = insights.metrics || {};
  const els = getDriverInspectorElements();
  if (els.title) els.title.textContent = getSelectedDriverName(driver);
  if (els.meta) els.meta.textContent = buildDriverInspectorMeta(insights);
  if (els.metricKm) els.metricKm.textContent = formatDriverDistance(metrics.km_travelled);
  if (els.metricKmMeta) els.metricKmMeta.textContent = metrics.km_estimated ? 'Estimado de hoy' : 'Trazado real de hoy';
  if (els.metricTime) els.metricTime.textContent = formatDriverActiveTime(metrics.active_minutes);
  if (els.metricTimeMeta) els.metricTimeMeta.textContent = metrics.active_time_estimated ? 'Estimado por actividad' : 'Tomado desde ubicaciones';
  if (els.metricCompleted) els.metricCompleted.textContent = String(Number(metrics.completed_deliveries || 0));
  if (els.metricCompletedMeta) els.metricCompletedMeta.textContent = 'Entregas cerradas hoy';
  if (els.metricEfficiency) els.metricEfficiency.textContent = formatDriverEfficiency(metrics.efficiency_pct);
  if (els.metricEfficiencyMeta) els.metricEfficiencyMeta.textContent = `${Number(metrics.active_orders || 0)} activos · ${Number(metrics.issues || 0)} incidencias`;
  setDriverInspectorView(driverInspectorView);
  if (els.body){
    if (driverInspectorView === 'route'){
      els.body.innerHTML = renderDriverRouteView(insights);
    } else if (driverInspectorView === 'history'){
      els.body.innerHTML = renderDriverHistoryView(insights);
    } else {
      els.body.innerHTML = renderDriverOrdersView(insights);
    }
  }
  bindDriverInspectorBodyActions();
  renderDriverRouteOverlay(insights, !!(options && options.focusMap));
}

async function loadDriverInsights(driver){
  const id = getDriverId(driver);
  if (!id) return null;
  await ensureApiBase();
  const params = new URLSearchParams();
  if (driver && (driver.driver_id || driver.id)) params.set('driver_id', String(driver.driver_id || driver.id));
  else if (driver && (driver.driver_username || driver.username)) params.set('driver_username', String(driver.driver_username || driver.username));
  const requestId = ++driverInsightsReqSeq;
  const payload = await safeFetch(`${API_BASE}/admin/driver-insights?${params.toString()}`, { cache: 'no-store' });
  if (requestId !== driverInsightsReqSeq) return null;
  return payload;
}

async function selectDriverOnMap(driverOrId, options){
  const base = typeof driverOrId === 'string'
    ? (
      driverMapData.get(String(driverOrId))
      || ((selectedDriverData && getDriverId(selectedDriverData) === String(driverOrId)) ? selectedDriverData : null)
    )
    : driverOrId;
  const id = getDriverId(base);
  if (!id) return;
  selectedDriverId = id;
  selectedDriverData = Object.assign({}, driverMapData.get(id) || base || {});
  if (options && options.view) setDriverInspectorView(options.view);
  else setDriverInspectorView(driverInspectorView);
  syncAllDriverMarkerStyles();
  renderDriverInspectorLoading(selectedDriverData);
  try{
    const payload = await loadDriverInsights(selectedDriverData);
    if (!payload || selectedDriverId !== id) return;
    renderSelectedDriverInsights(payload, { focusMap: !!(options && options.focusMap) || driverInspectorView === 'route' });
  }catch(e){
    console.error('selectDriverOnMap failed', e);
    renderDriverInspectorPlaceholder('No se pudo cargar el detalle del repartidor.');
  }
}

async function refreshSelectedDriverInsights(forceMapFocus){
  if (!selectedDriverId || currentSectionId !== 'dashboard') return;
  const driver = driverMapData.get(selectedDriverId) || selectedDriverData;
  if (!driver) return;
  try{
    const payload = await loadDriverInsights(driver);
    if (!payload || selectedDriverId !== getDriverId(driver)) return;
    renderSelectedDriverInsights(payload, { focusMap: !!forceMapFocus && driverInspectorView === 'route' });
  }catch(_){ }
}

function canAccessSection(sectionId){
  if (!currentAdminUser || !sectionId) return false;
  if (currentAdminUser.role === 'owner') return true;
  if (currentAdminUser.role === 'admin') return sectionId !== 'admin-console';
  return false;
}

function activateSection(sectionId){
  if (!sectionId) return false;
  currentSectionId = sectionId;
  if (!canAccessSection(sectionId)){
    try{ showToast('No tenés acceso a esa sección', 'error'); }catch(_){ }
    return false;
  }
  document.querySelectorAll('main > section.section').forEach(sec => sec.classList.add('hidden'));
  const sec = document.getElementById(sectionId);
  if (sec) sec.classList.remove('hidden');
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`.sidebar nav a[data-section="${sectionId}"]`);
  if (link) link.classList.add('active');
  const titleEl = document.getElementById('title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[sectionId] || 'Administración';

  if (sectionId === 'promo-images') fetchPromoImages();
  if (sectionId === 'dashboard') {
    try{ refreshSalesStats({ force: false, quiet: true }); }catch(_){ }
    try{ initDriverMap(); startDriverMapPolling(); }catch(_){ }
  } else {
    stopDriverMapPolling();
    clearDriverRouteOverlays();
  }
  if (sectionId === 'customers') { try{ refreshCustomers(false); }catch(_){ } }
  if (sectionId === 'retail-prices') { try{ refreshRetailPrices(); }catch(_){ } }
  if (sectionId === 'preparations') { try{ refreshPreparations(false); }catch(_){ } }
  if (sectionId === 'routes') { try{ refreshRoutes(false); }catch(_){ } }
  if (sectionId === 'deliveries') { try{ refreshDeliveries(false); }catch(_){ } }
  if (sectionId === 'admin-console') {
    try{
      ensureAdminConsole();
      if (!adminConsoleState.openedOnce){
        adminConsoleState.openedOnce = true;
        logAdminConsole('Consola lista. Usa /help para ver comandos.', 'note');
      }
      adminConsoleState.input && adminConsoleState.input.focus();
    }catch(_){ }
  }
  if (sectionId === 'users') { try{ const p = renderUsers(); if (p && p.catch) p.catch(()=>{}); }catch(_){ } }
  return true;
}

// Mostrar sección al hacer click en el menú
document.querySelectorAll('.sidebar nav a[data-section]').forEach(link => {
  link.addEventListener('click', function() {
    const ok = activateSection(this.getAttribute('data-section'));
    if (!ok) return;
    // On mobile, close the sidebar after navigation
    try{
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && window.innerWidth <= 900) {
        sidebar.classList.remove('open');
        document.body.classList.remove('sidebar-open');
        const btn = document.getElementById('mobileMenuBtn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    }catch(e){}
  });
});
try{
  const { tabs } = getDriverInspectorElements();
  if (tabs){
    tabs.querySelectorAll('[data-driver-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextView = String((btn && btn.dataset && btn.dataset.driverView) || '').trim();
        setDriverInspectorView(nextView);
        if (selectedDriverInsights){
          renderSelectedDriverInsights(selectedDriverInsights, { focusMap: nextView === 'route' });
        } else {
          renderDriverInspectorPlaceholder();
        }
      });
    });
  }
}catch(_){ }
// Admin JS ? UI principal sin modo oscuro ni bot?n de tarjeta (card)
console.log('[admin] app.js loaded');
const REMOTE_API_BASE = 'https://backend-0lcs.onrender.com';
let API_BASE = (location.protocol && location.protocol.startsWith('http')) ? location.origin : REMOTE_API_BASE;
function getActor(){
  try{
    const v = localStorage.getItem('admin:actor');
    if (v && String(v).trim()) return String(v).trim();
  }catch(_){ }
  if (currentAdminUser && currentAdminUser.username) return currentAdminUser.username;
  return 'admin-panel';
}

const ADMIN_TOKEN_KEY = 'admin:token:v1';
const ADMIN_SESSION_KEY = 'admin:session:v2';

function readLocalJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  }catch(_){ return fallback; }
}

function writeLocalJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(_){ }
}

function normalizeUsername(value){
  return String(value || '').trim().toLowerCase();
}

function getAdminToken(){
  try{
    const t = localStorage.getItem(ADMIN_TOKEN_KEY);
    return t ? String(t) : '';
  }catch(_){ return ''; }
}

function setAdminToken(token){
  try{
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, String(token));
  }catch(_){ }
}

function clearAdminToken(){
  try{
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }catch(_){ }
}

function getSessionUser(){
  const session = readLocalJson(ADMIN_SESSION_KEY, null);
  if (!session || !session.username) return null;
  return session;
}

function setSessionUser(user){
  if (!user) return;
  const session = {
    id: user.id,
    username: user.username,
    role: user.role,
    full_name: user.full_name || null,
    loginAt: Date.now(),
  };
  writeLocalJson(ADMIN_SESSION_KEY, session);
  try{ localStorage.setItem('admin:actor', user.username); }catch(_){ }
}

function clearSessionUser(){
  try{
    localStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem('admin:actor');
  }catch(_){ }
}

function setAuthLocked(locked){
  try{ document.body.classList.toggle('auth-locked', locked); }catch(_){ }
  try{
    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.setAttribute('aria-hidden', locked ? 'false' : 'true');
  }catch(_){ }
}

function formatRoleLabel(role){
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'repartidor') return 'Repartidor';
  return role || '—';
}

function updateUserUI(user){
  const userLabel = document.getElementById('currentUserLabel');
  const roleLabel = document.getElementById('currentRoleLabel');
  if (userLabel) userLabel.textContent = user ? user.username : '—';
  if (roleLabel) roleLabel.textContent = user ? formatRoleLabel(user.role) : '—';
}

function applyRoleAccess(user){
  currentAdminUser = user || null;
  updateUserUI(user);
  updateUserFormAccess();
  const role = user ? user.role : null;

  if (role === 'repartidor'){
    try{ window.location.href = 'repartidor.html'; }catch(_){ }
    return;
  }

  document.querySelectorAll('[data-role]').forEach((el) => {
    const roles = String(el.dataset.role || '').split(',').map(r => r.trim()).filter(Boolean);
    const allowed = role && roles.includes(role);
    el.classList.toggle('role-hidden', !allowed);
  });

  const activeLink = document.querySelector('.sidebar nav a.active[data-section]');
  const activeSection = activeLink ? activeLink.getAttribute('data-section') : null;
  if (activeSection && !canAccessSection(activeSection)){
    activateSection('dashboard');
  }
}

function initAuth(){
  const loginForm = document.getElementById('authLoginForm');
  const userInput = document.getElementById('authUser');
  const passInput = document.getElementById('authPass');
  const showPass = document.getElementById('authShowPass');
  const errorEl = document.getElementById('authError');
  const logoutBtn = document.getElementById('logoutBtn');

  function setAuthError(msg){
    if (!errorEl) return;
    errorEl.textContent = msg || '';
  }

  if (showPass && passInput){
    showPass.addEventListener('change', () => {
      passInput.type = showPass.checked ? 'text' : 'password';
    });
  }
  if (userInput) userInput.addEventListener('input', () => setAuthError(''));
  if (passInput) passInput.addEventListener('input', () => setAuthError(''));
  if (loginForm){
    loginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const username = userInput ? String(userInput.value || '').trim() : '';
      const password = passInput ? String(passInput.value || '') : '';
      if (!username || !password){
        setAuthError('Ingresá usuario y contraseña.');
        return;
      }
      setAuthError('');
      try{
        await ensureApiBase();
      }catch(_){ }
      try{
        const body = new URLSearchParams();
        body.set('username', username);
        body.set('password', password);
        const res = await fetch(API_BASE + '/admin/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!res || !res.ok){
          setAuthError('Usuario o contraseña incorrecta.');
          return;
        }
        const payload = await res.json().catch(() => null);
        const token = payload && payload.access_token ? String(payload.access_token) : '';
        if (!token){
          setAuthError('No se pudo iniciar sesión.');
          return;
        }
        setAdminToken(token);
        const me = await safeFetch(API_BASE + '/admin/auth/me').catch(() => null);
        if (!me || !me.username){
          setAuthError('No se pudo validar la sesión.');
          clearAdminToken();
          return;
        }
        setSessionUser(me);
        setAuthLocked(false);
        applyRoleAccess(me);
        activateSection('dashboard');
      }catch(e){
        console.error('admin login failed', e);
        setAuthError('No se pudo iniciar sesión.');
      }
    });
  }

  if (logoutBtn){
    logoutBtn.addEventListener('click', () => {
      clearAdminToken();
      clearSessionUser();
      setAuthLocked(true);
      currentAdminUser = null;
      try{ location.reload(); }catch(_){ }
    });
  }

  (async () => {
    try{
      await ensureApiBase();
    }catch(_){ }
    const token = getAdminToken();
    if (token){
      const me = await safeFetch(API_BASE + '/admin/auth/me').catch(() => null);
    if (me && me.username){
      setSessionUser(me);
      setAuthLocked(false);
      applyRoleAccess(me);
      if (me.role !== 'repartidor'){
        const activeLink = document.querySelector('.sidebar nav a.active[data-section]');
        const activeSection = activeLink ? activeLink.getAttribute('data-section') : null;
        activateSection(activeSection || 'dashboard');
      }
      return;
    }
    }
    clearAdminToken();
    clearSessionUser();
    setAuthLocked(true);
    try{ userInput && userInput.focus(); }catch(_){ }
  })();
}
initAuth();
// Small helper to wrap fetch and provide consistent errors and JSON parsing
async function safeFetch(url, opts) {
  const next = opts ? Object.assign({}, opts) : {};
  let shouldAttachAuthHeaders = true;
  try{
    const resolved = new URL(url, location.origin);
    const apiOrigin = new URL(API_BASE, location.origin).origin;
    shouldAttachAuthHeaders = resolved.origin === location.origin || resolved.origin === apiOrigin;
  }catch(_){ }
  if (shouldAttachAuthHeaders){
    try{
      const headers = new Headers(next.headers || {});
      headers.set('X-Actor', getActor());
      const token = getAdminToken();
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', 'Bearer ' + token);
      }
      next.headers = headers;
    }catch(_){ }
  }
  const res = await fetch(url, next);
  if (!res) throw new Error('no-response');
  const ct = res.headers.get('content-type') || '';
  let payload = null;
  try {
    if (ct.indexOf('application/json') !== -1) payload = await res.json();
    else payload = await res.text();
  } catch (e) {
    payload = null;
  }
  if (!res.ok) {
    const err = new Error('http-error:' + res.status);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function ensureApiBase(){
  const candidates = [];
  const fileMode = !(location.protocol && location.protocol.startsWith('http'));
  if (fileMode){
    candidates.push('http://127.0.0.1:8000');
    candidates.push(REMOTE_API_BASE);
  } else {
    try{ if (API_BASE) candidates.push(String(API_BASE)); }catch(_){ }
  }
  for (const c of ['http://127.0.0.1:8000', REMOTE_API_BASE]){
    if (!candidates.includes(c)) candidates.push(c);
  }
  for (const base of candidates){
    try{
      const controller = new AbortController();
      const t = setTimeout(()=> controller.abort(), 2500);
      const res = await fetch(base + '/health', { cache: 'no-store', signal: controller.signal });
      clearTimeout(t);
      if (res && res.ok){
        API_BASE = base;
        if(apiBaseIndicator) apiBaseIndicator.textContent = API_BASE;
        return API_BASE;
      }
    }catch(_){ }
  }
  if(apiBaseIndicator) apiBaseIndicator.textContent = API_BASE + ' (sin conexión)';
  return API_BASE;
}
// --- Imágenes Promocionales (admin) ---
const promoImagesList = document.getElementById('promoImagesList');
const promoImageInput = document.getElementById('promoImageInput');
const promoImageForm = document.getElementById('promoImageForm');
const promoImageSelectBtn = document.getElementById('promoImageSelectBtn');
const promoImageFileName = document.getElementById('promoImageFileName');
const promoImageUploadBtn = document.getElementById('promoImageUploadBtn');

function fetchPromoImages() {
  (async () => {
    try{
      if (!promoImagesList) return;
      promoImagesList.innerHTML = '';
      const uploads = await safeFetch(API_BASE + '/api/uploads').catch(()=>[]);
      const selected = await safeFetch(API_BASE + '/api/promos').catch(()=>[]);
      const selectedNames = new Set((selected || []).map(i => i.name));
      if (!uploads || uploads.length === 0) {
        promoImagesList.innerHTML = '<div style="color:#888">No hay imágenes subidas.</div>';
        return;
      }
      uploads.forEach(img => {
        const div = document.createElement('div');
        div.className = 'promo-image-admin';
        div.classList.add('promo-image-card');
        const imgEl = document.createElement('img');
        imgEl.src = img.url;
        // If image fails to load (missing disk file), re-query /api/uploads
        // to see if the server can provide a DB-backed URL (e.g. /images/{id}).
        imgEl.onerror = async function() {
          try{
            if (this.dataset && this.dataset._retried) return;
            this.dataset._retried = '1';
            const uploadsRefetch = await safeFetch(API_BASE + '/api/uploads').catch(()=>[]);
            if (uploadsRefetch && uploadsRefetch.length) {
              const found = uploadsRefetch.find(u => u.name === (img.name || ''));
              if (found && found.url && found.url !== img.url) {
                this.src = found.url;
                return;
              }
            }
            // final fallback: clear src so broken icon appears; keep alt text
            this.src = '';
          }catch(e){ try{ this.src = ''; }catch(_){ } }
        };
        imgEl.alt = img.alt || '';
        imgEl.classList.add('promo-thumb');
        div.appendChild(imgEl);
        const fechaDiv = document.createElement('div');
        fechaDiv.className = 'meta';
        fechaDiv.textContent = 'Subida: ' + (img.name || '?');
        div.appendChild(fechaDiv);
        // selection toggle
        const selBtn = document.createElement('button');
        selBtn.className = 'btn promo-select-btn';
        const fname = img.name;
        if (selectedNames.has(fname)){
          selBtn.textContent = 'En carrusel (Quitar)';
          selBtn.onclick = async () => {
            if (!confirm('Quitar "' + fname + '" del carrusel?')) return;
            const resp = await fetch(API_BASE + '/api/promos/select/' + encodeURIComponent(fname), { method: 'DELETE' });
            if (resp.ok) {
              await fetchPromoImages();
              try{ if(typeof BroadcastChannel !== 'undefined'){ const bc = new BroadcastChannel('promo_channel'); const promos = await fetch(API_BASE + '/api/promos').then(r=>r.ok? r.json():[]).catch(()=>[]); bc.postMessage({ action: 'promotions-updated', promos }); } }catch(_){ }
            } else alert('No se pudo quitar');
          };
        } else {
          selBtn.textContent = 'Agregar al carrusel';
          selBtn.onclick = async () => {
            const resp = await fetch(API_BASE + '/api/promos/select?name=' + encodeURIComponent(fname), { method: 'POST' });
            if (resp.ok) {
              await fetchPromoImages();
              try{ if(typeof BroadcastChannel !== 'undefined'){ const bc = new BroadcastChannel('promo_channel'); const promos = await fetch(API_BASE + '/api/promos').then(r=>r.ok? r.json():[]).catch(()=>[]); bc.postMessage({ action: 'promotions-updated', promos }); } }catch(_){ }
            } else alert('No se pudo seleccionar');
          };
        }
        div.appendChild(selBtn);
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Eliminar';
        delBtn.className = 'btn danger promo-delete-btn';
        delBtn.onclick = async () => {
          if (!confirm('¿Eliminar esta imagen?')) return;
          try{
            const resp = await fetch(API_BASE + '/api/promos/' + encodeURIComponent(fname), { method: 'DELETE' });
            if (resp.ok) {
              await fetchPromoImages();
              try{ if(typeof BroadcastChannel !== 'undefined'){ const bc = new BroadcastChannel('promo_channel'); const promos = await fetch(API_BASE + '/api/promos').then(r=>r.ok? r.json():[]).catch(()=>[]); bc.postMessage({ action: 'promotions-updated', promos }); } }catch(_){ }
            } else {
              // try to show server error message
              try{
                const data = await resp.json();
                alert('No se pudo eliminar: ' + (data && (data.detail || data.error)));
              }catch(e){
                const txt = await resp.text().catch(()=>null);
                alert('No se pudo eliminar la imagen' + (txt ? ': ' + txt : ''));
              }
            }
          }catch(e){ alert('Error de red al eliminar la imagen'); }
        };
        div.appendChild(delBtn);
        promoImagesList.appendChild(div);
      });
    }catch(err){ if (promoImagesList) promoImagesList.innerHTML = '<div style="color:#888">Error cargando imágenes</div>'; }
  })();
}

if (promoImageSelectBtn && promoImageInput && promoImageFileName && promoImageUploadBtn) {
  promoImageSelectBtn.addEventListener('click', (e) => { e.preventDefault(); promoImageInput.click(); });
  promoImageInput.addEventListener('change', () => {
    if (promoImageInput.files.length) {
      promoImageFileName.textContent = promoImageInput.files[0].name;
      promoImageUploadBtn.disabled = false;
    } else {
      promoImageFileName.textContent = 'Ningún archivo seleccionado';
      promoImageUploadBtn.disabled = true;
    }
  });
  promoImageUploadBtn.addEventListener('click', () => {
    const file = promoImageInput.files[0];
    if (!file) { alert('Selecciona un archivo primero'); return; }
    const fd = new FormData(); fd.append('file', file);
    promoImageUploadBtn.disabled = true;
    fetch(API_BASE + '/api/promos', { method: 'POST', body: fd })
      .then(res => {
        if (res && (res.status === 200 || res.status === 201)) {
          promoImageInput.value = '';
          promoImageFileName.textContent = 'Ningún archivo seleccionado';
          promoImageUploadBtn.disabled = true;
          fetchPromoImages();
        } else {
          alert('No se pudo subir la imagen');
          promoImageUploadBtn.disabled = false;
        }
      })
      .catch(() => { alert('Error de red'); promoImageUploadBtn.disabled = false; });
  });
}
const apiBaseIndicator = document.getElementById('apiBaseIndicator');
const wsStatus = document.getElementById('wsStatus');
if(apiBaseIndicator) apiBaseIndicator.textContent = API_BASE;

// Admin console (tabbed section)
const ADMIN_CLEAR_TARGETS = {
  '1': { key: 'catalog', label: 'Catalogo' },
  '2': { key: 'filters', label: 'Filtros' },
  '3': { key: 'orders', label: 'Pedidos' },
  '4': { key: 'customers', label: 'Clientes' },
  '5': { key: 'preparations', label: 'Preparaciones' },
};
const adminConsoleState = {
  section: null,
  log: null,
  input: null,
  form: null,
  openedOnce: false,
  ready: false,
};

function logAdminConsole(message, tone){
  try{
    ensureAdminConsole();
    if (!adminConsoleState.log) return;
    const line = document.createElement('div');
    const cls = tone ? String(tone) : '';
    line.className = 'admin-console-line' + (cls ? ' ' + cls : '');
    line.textContent = String(message || '');
    adminConsoleState.log.appendChild(line);
    adminConsoleState.log.scrollTop = adminConsoleState.log.scrollHeight;
  }catch(_){ }
}

function ensureAdminConsole(){
  if (adminConsoleState.ready) return adminConsoleState;
  adminConsoleState.section = document.getElementById('admin-console');
  adminConsoleState.log = document.getElementById('adminConsoleLog');
  adminConsoleState.input = document.getElementById('adminConsoleInput');
  adminConsoleState.form = document.getElementById('adminConsoleForm');
  adminConsoleState.ready = true;

  if (adminConsoleState.form) {
    adminConsoleState.form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = adminConsoleState.input;
      const raw = input ? String(input.value || '') : '';
      if (input) input.value = '';
      await handleAdminConsoleCommand(raw);
    });
  }

  return adminConsoleState;
}

function clearLocalOrderCache(){
  try{
    localStorage.removeItem('admin_local_orders_v1');
    window.__localOrderRows = {};
    window.__localOrderIds = new Set();
  }catch(_){ }
}

async function runAdminClear(target){
  if (!target || !target.key) return;
  await ensureApiBase();
  logAdminConsole(`Limpiando ${target.label}...`, 'note');
  try{
    const resp = await safeFetch(`${API_BASE}/debug/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target.key }),
    });
    const details = [];
    try{
      if (resp && resp.deleted){
        Object.keys(resp.deleted).forEach((k) => {
          details.push(`${k}:${resp.deleted[k]}`);
        });
      }
      if (resp && resp.updated){
        Object.keys(resp.updated).forEach((k) => {
          details.push(`${k}:${resp.updated[k]}`);
        });
      }
    }catch(_){ }
    logAdminConsole(`OK ${target.label}.`, 'ok');
    if (details.length) logAdminConsole('Detalle: ' + details.join(', '), 'note');

    if (target.key === 'catalog'){
      try{ catalogPage = 1; }catch(_){ }
      try{ allProductsCache = []; allProductsCacheTs = 0; }catch(_){ }
      try{ await refresh(); }catch(_){ }
    } else if (target.key === 'filters'){
      try{ saveFilters([]); }catch(_){ }
      try{ renderFilters(); }catch(_){ }
    } else if (target.key === 'orders'){
      clearLocalOrderCache();
      try{ await refreshOrders('web'); }catch(_){ }
      try{ await refreshPreparations(true); }catch(_){ }
      try{ await refreshCustomers(true); }catch(_){ }
    } else if (target.key === 'customers'){
      try{ await refreshCustomers(true); }catch(_){ }
    } else if (target.key === 'preparations'){
      try{ await refreshOrders('web'); }catch(_){ }
      try{ await refreshPreparations(true); }catch(_){ }
      try{ await refreshCustomers(true); }catch(_){ }
    }
  }catch(e){
    const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? (e.payload.detail || e.payload.error) : (e && e.message ? e.message : 'Error');
    logAdminConsole('Error: ' + msg, 'err');
  }
}

async function handleAdminConsoleCommand(raw){
  if (!canAccessSection('admin-console')){
    logAdminConsole('Sin acceso a la consola.', 'err');
    return;
  }
  const cmd = String(raw || '').trim();
  if (!cmd) return;
  logAdminConsole('> ' + cmd, 'cmd');
  if (cmd === '/help' || cmd === 'help' || cmd === '/?'){
    logAdminConsole('Comandos disponibles:', 'note');
    logAdminConsole('/clear @1 Catalogo', 'note');
    logAdminConsole('/clear @2 Filtros', 'note');
    logAdminConsole('/clear @3 Pedidos', 'note');
    logAdminConsole('/clear @4 Clientes', 'note');
    logAdminConsole('/clear @5 Preparaciones', 'note');
    return;
  }
  const match = cmd.match(/^\/clear\s+@?(\d+)\s*$/i);
  if (!match){
    logAdminConsole('Comando no reconocido. Usa /help.', 'err');
    return;
  }
  const key = String(match[1] || '').trim();
  const target = ADMIN_CLEAR_TARGETS[key];
  if (!target){
    logAdminConsole('Target invalido. Usa /help.', 'err');
    return;
  }
  const ok = confirm(`Vaciar ${target.label}? Esta accion es irreversible.`);
  if (!ok){
    logAdminConsole('Cancelado.', 'note');
    return;
  }
  await runAdminClear(target);
}

// WS indicator remains informational (no hidden console)

const salesOrders30El = document.getElementById('salesOrders30');
const salesRevenue30El = document.getElementById('salesRevenue30');
const salesAvgTicket30El = document.getElementById('salesAvgTicket30');
const salesChartCanvas = document.getElementById('salesChart');
const dashboardAlertsWrap = document.querySelector('.dashboard-alerts');
const alertLowStockEl = document.getElementById('alertLowStock');
const alertOrdersUnseenEl = document.getElementById('alertOrdersUnseen');
const alertOrdersUnpreparedEl = document.getElementById('alertOrdersUnprepared');
const LOW_STOCK_FALLBACK = 5;

const productsTableBody = document.querySelector('#productsTable tbody');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const sortSelect = document.getElementById('sortSelect');
const pageSizeSelect = document.getElementById('pageSizeSelect');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const importCsvInput = document.getElementById('importCsvInput');
const importExcelBtn = document.getElementById('importExcelBtn');
const importExcelInput = document.getElementById('importExcelInput');
const autoImageProgress = document.getElementById('autoImageProgress');
const autoImageProgressFill = document.getElementById('autoImageProgressFill');
const autoImageProgressLabel = document.getElementById('autoImageProgressLabel');
const autoImageProgressMeta = document.getElementById('autoImageProgressMeta');
const autoImageProgressStatus = document.getElementById('autoImageProgressStatus');
const productsPager = document.getElementById('productsPager');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const pageTotalInfo = document.getElementById('pageTotalInfo');
const bulkBar = document.getElementById('bulkBar');
const bulkCountEl = document.getElementById('bulkCount');
const bulkTarget = document.getElementById('bulkTarget');
const bulkMode = document.getElementById('bulkMode');
const bulkValue = document.getElementById('bulkValue');
const applyBulkBtn = document.getElementById('applyBulkBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const selectAllProducts = document.getElementById('selectAllProducts');
const refreshBtn = document.getElementById('refreshBtn');
const newBtn = document.getElementById('newBtn');
const modal = document.getElementById('modal');
const historyModal = document.getElementById('historyModal');
const historyModalClose = document.getElementById('historyModalClose');
const historyModalTitle = document.getElementById('historyModalTitle');
const historyModalBody = document.getElementById('historyModalBody');
const productForm = document.getElementById('productForm');
const cancelBtn = document.getElementById('cancelBtn');
const uploadImageBtn = document.getElementById('uploadImageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const imageUrlInput = document.getElementById('imageUrlInput');
const imageUrlBtn = document.getElementById('imageUrlBtn');
const imageSearchBtn = document.getElementById('imageSearchBtn');
const fileNameEl = document.getElementById('fileName');
const toast = document.getElementById('toast');
const modalClose = document.getElementById('modalClose');
const saveBtn = document.getElementById('saveBtn');
const saleUnitSelect = document.getElementById('sale_unit');
const kgPerUnitField = document.getElementById('kgPerUnitField');
const stockLabel = document.getElementById('stockLabel');
const priceLabel = document.getElementById('priceLabel');
const productCodeInput = document.getElementById('code');
const brandInput = document.getElementById('brand');
const costInput = document.getElementById('cost');
const minStockInput = document.getElementById('min_stock');
const activeSelect = document.getElementById('active');
const retailPriceInput = document.getElementById('price_retail');
const retailPricesTableBody = document.querySelector('#retailPricesTable tbody');
const retailPriceSearch = document.getElementById('retailPriceSearch');
const retailRefreshBtn = document.getElementById('retailRefreshBtn');
const retailSaveAllBtn = document.getElementById('retailSaveAllBtn');
const userForm = document.getElementById('userForm');
const userUsernameInput = document.getElementById('userUsername');
const userPasswordInput = document.getElementById('userPassword');
const userRoleSelect = document.getElementById('userRole');
const userZoneSelect = document.getElementById('userZone');
const userFormMsg = document.getElementById('userFormMsg');
const usersTableBody = document.querySelector('#usersTable tbody');

function getZoneOptions(){
  const opts = [];
  if (userZoneSelect && userZoneSelect.options){
    Array.from(userZoneSelect.options).forEach((o) => {
      opts.push({ value: String(o.value || ''), label: String(o.textContent || o.value || '') });
    });
  }
  return opts;
}

function updateUserFormAccess(){
  if (!userForm) return;
  const isOwner = currentAdminUser && currentAdminUser.role === 'owner';
  userForm.classList.toggle('role-hidden', !isOwner);
}
let currentEditId = null;
let imageUrl = null;
let selectedFile = null;
let autoImagePollTimer = null;
let retailProductsCache = [];
let productLookupById = new Map();
const PROMO_KEY = 'admin_promotions_v1';
const FILTERS_KEY = 'admin_filters_v1';
const PRODUCT_CATEGORIES_KEY = 'admin_product_categories_v1';
const ORDER_MAPS_COORD_CACHE_KEY = 'admin_order_maps_coords_v6';
const MENDOZA_GEO_BOUNDS = Object.freeze({
  minLat: -37.7,
  maxLat: -31.0,
  minLon: -70.7,
  maxLon: -66.2,
});
const MENDOZA_POSTAL_TO_DEPARTMENTS = Object.freeze({
  '5500': ['Capital'],
  '5501': ['Godoy Cruz'],
  '5502': ['Godoy Cruz'],
  '5503': ['Godoy Cruz'],
  '5507': ['Lujan de Cuyo'],
  '5509': ['Lujan de Cuyo'],
  '5511': ['Lujan de Cuyo'],
  '5513': ['Maipu'],
  '5515': ['Maipu'],
  '5517': ['Maipu'],
  '5519': ['Guaymallen'],
  '5521': ['Guaymallen'],
  '5523': ['Guaymallen'],
  '5525': ['Guaymallen'],
  '5533': ['Lavalle'],
  '5535': ['Lavalle'],
  '5539': ['Las Heras'],
  '5540': ['Las Heras'],
  '5541': ['Las Heras'],
  '5549': ['Lujan de Cuyo'],
  '5560': ['Tunuyan'],
  '5561': ['Tupungato'],
  '5569': ['San Carlos'],
  '5570': ['San Martin'],
  '5573': ['San Martin', 'Junin'],
  '5575': ['Junin'],
  '5577': ['Rivadavia'],
  '5590': ['La Paz'],
  '5596': ['Santa Rosa'],
  '5600': ['San Rafael'],
  '5603': ['San Rafael'],
  '5613': ['Malargue'],
  '5620': ['General Alvear']
});
const ORDER_MAPS_COORD_TTL_MS = 1000 * 60 * 60 * 24 * 45;
let orderMapsCoordCache = { byOrderId: {}, byAddressKey: {}, updatedAt: 0 };
let orderMapsRerenderTimer = null;
const orderMapsCoordInFlight = new Set();
const orderMapsCoordFailUntil = new Map();

// Promotions UI
const promotionsSection = document.getElementById('promotions');
const newPromoBtn = document.getElementById('newPromoBtn');
let promoModal = document.getElementById('promoModal');
const promoModalClose = document.getElementById('promoModalClose');
const promoForm = document.getElementById('promoForm');
const promoName = document.getElementById('promoName');
const promoDesc = document.getElementById('promoDesc');
const promoProductSearch = document.getElementById('promoProductSearch');
const promoProductsList = document.getElementById('promoProductsList');
const promoType = document.getElementById('promoType');
const promoValue = document.getElementById('promoValue');
const promoValueField = document.getElementById('promoValueField');
const promoValidUntil = document.getElementById('promoValidUntil');
const savePromoBtn = document.getElementById('savePromoBtn');
const cancelPromoBtn = document.getElementById('cancelPromoBtn');
const promoSearch = document.getElementById('promoSearch');
const exportPromosBtn = document.getElementById('exportPromosBtn');
const promotionsTableBody = document.querySelector('#promotionsTable tbody');

let allProductsCache = [];
let allProductsCacheTs = 0;
let allProductsCacheHydrating = null;
let catalogPage = 1;
let catalogPageSize = 50;
let catalogTotal = 0;
let catalogPageItems = [];
const selectedProductIds = new Set();
let duplicateSkuSet = new Set();
let duplicateSkuSetTs = 0;
let salesStatsTs = 0;
let salesStatsCache = null;
let currentPromotionEditId = null;
const SALES_STATS_TTL_MS = 1000 * 60;

// Helpers
function showToast(msg, type = 'info'){
  // Show toast and keep full message in title for easier inspection
  toast.textContent = msg;
  toast.title = msg;
  toast.classList.remove('hidden');
  toast.classList.toggle('toast-error', type === 'error');
  const duration = type === 'error' ? 7000 : 3200;
  setTimeout(()=>{ toast.classList.add('hidden'); toast.classList.remove('toast-error'); toast.title = ''; }, duration);
}

function setUserFormMessage(msg, tone){
  if (!userFormMsg) return;
  userFormMsg.textContent = msg || '';
  userFormMsg.classList.remove('error', 'success');
  if (tone) userFormMsg.classList.add(tone);
}

function formatUserDate(ts){
  try{
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }catch(_){ return '—'; }
}

let adminUsersCache = [];
let driverNextZonesCache = new Map();

async function fetchAdminUsers(){
  try{
    const list = await safeFetch(`${API_BASE}/admin/users`).catch(() => []);
    adminUsersCache = Array.isArray(list) ? list : [];
  }catch(_){
    adminUsersCache = [];
  }
  return adminUsersCache;
}

async function fetchDriverNextZones(){
  try{
    const list = await safeFetch(`${API_BASE}/admin/driver-next-zones`).catch(() => []);
    const next = new Map();
    (Array.isArray(list) ? list : []).forEach((entry) => {
      const key = String((entry && (entry.driver_id || entry.driver_username)) || '').trim();
      if (key) next.set(key, entry);
    });
    driverNextZonesCache = next;
  }catch(_){
    driverNextZonesCache = new Map();
  }
  return driverNextZonesCache;
}

function formatNextZoneDate(value){
  try{
    const raw = String(value || '').trim();
    if (!raw) return '';
    const dt = new Date(`${raw}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleDateString('es-AR', { dateStyle: 'short' });
  }catch(_){ return String(value || '').trim(); }
}

async function renderUsers(){
  if (!usersTableBody) return;
  if (!currentAdminUser || (currentAdminUser.role !== 'owner' && currentAdminUser.role !== 'admin')) return;
  updateUserFormAccess();
  const users = await fetchAdminUsers();
  await fetchDriverNextZones();
  const roleOrder = { owner: 0, admin: 1, repartidor: 2 };
  users.sort((a, b) => {
    const ra = roleOrder[a.role] ?? 99;
    const rb = roleOrder[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return String(a.username || '').localeCompare(String(b.username || ''));
  });
  usersTableBody.innerHTML = '';
  const zoneOptions = getZoneOptions();
  const canAssignZone = currentAdminUser && (currentAdminUser.role === 'owner' || currentAdminUser.role === 'admin');
  users.forEach((u) => {
    const tr = document.createElement('tr');
    const tdUser = document.createElement('td');
    tdUser.textContent = u.username || '—';
    const tdRole = document.createElement('td');
    tdRole.textContent = formatRoleLabel(u.role);
    const tdZone = document.createElement('td');
    const tdNextZone = document.createElement('td');
    const isRepartidor = String(u.role || '').toLowerCase() === 'repartidor';
    if (isRepartidor && canAssignZone){
      const select = document.createElement('select');
      select.className = 'user-zone-select';
      zoneOptions.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label || opt.value;
        select.appendChild(option);
      });
      const currentZone = String(u.zone || '');
      select.value = currentZone;
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn small user-zone-save-btn';
      saveBtn.textContent = 'Guardar';
      saveBtn.disabled = true;
      select.addEventListener('change', () => {
        saveBtn.disabled = (String(select.value || '') === currentZone);
      });
      saveBtn.addEventListener('click', async () => {
        const nextZone = String(select.value || '').trim();
        if (!nextZone){
          showToast('Elegí una zona válida', 'error');
          return;
        }
        saveBtn.disabled = true;
        const prevText = saveBtn.textContent;
        saveBtn.textContent = 'Guardando...';
        try{
          await ensureApiBase();
        }catch(_){ }
        try{
          await safeFetch(`${API_BASE}/admin/users/${encodeURIComponent(u.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zone: nextZone }),
          });
          showToast('Zona actualizada');
          await renderUsers();
        }catch(e){
          const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? String(e.payload.detail || e.payload.error) : 'No se pudo actualizar la zona.';
          showToast(msg, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = prevText;
        }
      });
      const wrap = document.createElement('div');
      wrap.className = 'user-zone-control';
      wrap.appendChild(select);
      wrap.appendChild(saveBtn);
      tdZone.appendChild(wrap);

      const nextZoneKey = String((u && (u.id || u.username)) || '').trim();
      const nextZoneEntry = driverNextZonesCache.get(nextZoneKey) || driverNextZonesCache.get(String(u.username || '').trim()) || null;
      const nextZoneSelect = document.createElement('select');
      nextZoneSelect.className = 'user-zone-select';
      const nextEmpty = document.createElement('option');
      nextEmpty.value = '';
      nextEmpty.textContent = 'Sin aviso';
      nextZoneSelect.appendChild(nextEmpty);
      zoneOptions
        .filter(opt => String(opt.value || '').trim())
        .forEach((opt) => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label || opt.value;
          nextZoneSelect.appendChild(option);
        });
      const currentNextZone = String((nextZoneEntry && nextZoneEntry.zone) || '').trim();
      nextZoneSelect.value = currentNextZone;
      const nextZoneSaveBtn = document.createElement('button');
      nextZoneSaveBtn.type = 'button';
      nextZoneSaveBtn.className = 'btn small user-zone-save-btn';
      nextZoneSaveBtn.textContent = currentNextZone ? 'Actualizar' : 'Avisar';
      nextZoneSaveBtn.disabled = true;
      nextZoneSelect.addEventListener('change', () => {
        const changed = String(nextZoneSelect.value || '').trim() !== currentNextZone;
        nextZoneSaveBtn.disabled = !changed;
        nextZoneSaveBtn.textContent = String(nextZoneSelect.value || '').trim() ? (currentNextZone ? 'Actualizar' : 'Avisar') : 'Limpiar';
      });
      nextZoneSaveBtn.addEventListener('click', async () => {
        const nextZone = String(nextZoneSelect.value || '').trim();
        nextZoneSaveBtn.disabled = true;
        const prevText = nextZoneSaveBtn.textContent;
        nextZoneSaveBtn.textContent = nextZone ? 'Guardando...' : 'Limpiando...';
        try{
          await ensureApiBase();
        }catch(_){ }
        try{
          await safeFetch(`${API_BASE}/admin/users/${encodeURIComponent(u.id)}/next-zone`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zone: nextZone || null }),
          });
          showToast(nextZone ? 'Zona de mañana actualizada' : 'Zona de mañana limpiada');
          await renderUsers();
        }catch(e){
          const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? String(e.payload.detail || e.payload.error) : 'No se pudo actualizar la zona de mañana.';
          showToast(msg, 'error');
          nextZoneSaveBtn.disabled = false;
          nextZoneSaveBtn.textContent = prevText;
        }
      });
      const nextWrap = document.createElement('div');
      nextWrap.className = 'user-zone-control user-zone-control-next';
      nextWrap.appendChild(nextZoneSelect);
      nextWrap.appendChild(nextZoneSaveBtn);
      const nextMeta = document.createElement('div');
      nextMeta.className = 'user-next-zone-meta';
      nextMeta.textContent = currentNextZone && nextZoneEntry && nextZoneEntry.delivery_date
        ? `Para ${formatNextZoneDate(nextZoneEntry.delivery_date)}`
        : 'Sin aviso cargado';
      tdNextZone.appendChild(nextWrap);
      tdNextZone.appendChild(nextMeta);
    } else {
      tdZone.textContent = u.zone ? String(u.zone) : '—';
      tdNextZone.textContent = '—';
    }
    const tdCreated = document.createElement('td');
    tdCreated.textContent = formatUserDate(u.created_at || u.createdAt);
    const tdActions = document.createElement('td');
    if (!currentAdminUser || currentAdminUser.role !== 'owner' || u.role === 'owner'){
      tdActions.textContent = '—';
    } else {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger user-delete-btn';
      delBtn.type = 'button';
      delBtn.dataset.userId = String(u.id || '');
      delBtn.textContent = 'Eliminar';
      tdActions.appendChild(delBtn);
    }
    tr.appendChild(tdUser);
    tr.appendChild(tdRole);
    tr.appendChild(tdZone);
    tr.appendChild(tdNextZone);
    tr.appendChild(tdCreated);
    tr.appendChild(tdActions);
    usersTableBody.appendChild(tr);
  });
}

function handleUserFormSubmit(ev){
  ev.preventDefault();
  if (!currentAdminUser || currentAdminUser.role !== 'owner'){
    setUserFormMessage('Solo el owner puede crear usuarios.', 'error');
    return;
  }
  const username = userUsernameInput ? String(userUsernameInput.value || '').trim() : '';
  const password = userPasswordInput ? String(userPasswordInput.value || '') : '';
  const role = userRoleSelect ? String(userRoleSelect.value || 'admin') : 'admin';
  const zone = userZoneSelect ? String(userZoneSelect.value || '').trim() : '';
  if (!username || !password){
    setUserFormMessage('Completá usuario y contraseña.', 'error');
    return;
  }
  if (role === 'owner'){
    setUserFormMessage('No se pueden crear owners adicionales.', 'error');
    return;
  }
  if (role === 'repartidor' && !zone){
    setUserFormMessage('Elegí una zona para el repartidor.', 'error');
    return;
  }
  (async () => {
    try{
      await ensureApiBase();
    }catch(_){ }
    try{
      await safeFetch(`${API_BASE}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role, zone: zone || null }),
      });
      setUserFormMessage('Usuario creado correctamente.', 'success');
      if (userForm) userForm.reset();
      renderUsers();
    }catch(e){
      const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? String(e.payload.detail || e.payload.error) : 'No se pudo crear el usuario.';
      setUserFormMessage(msg, 'error');
    }
  })();
}

function setupUserManagement(){
  if (userForm){
    userForm.addEventListener('submit', handleUserFormSubmit);
    userForm.addEventListener('input', () => setUserFormMessage(''));
  }
  if (usersTableBody){
    usersTableBody.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.user-delete-btn') : null;
      if (!btn) return;
      if (!currentAdminUser || currentAdminUser.role !== 'owner'){
        setUserFormMessage('Solo el owner puede eliminar usuarios.', 'error');
        return;
      }
      const userId = String(btn.dataset.userId || '').trim();
      if (!userId) return;
      const user = (Array.isArray(adminUsersCache) ? adminUsersCache : []).find(u => String(u.id || '') === userId);
      const uname = user && user.username ? user.username : userId;
      if (user && user.role === 'owner') return;
      const ok = confirm(`Eliminar usuario "${uname}"?`);
      if (!ok) return;
      (async () => {
        try{
          await ensureApiBase();
        }catch(_){ }
        try{
          await safeFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
          await renderUsers();
          setUserFormMessage('Usuario eliminado.', 'success');
        }catch(e){
          const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? String(e.payload.detail || e.payload.error) : 'No se pudo eliminar el usuario.';
          setUserFormMessage(msg, 'error');
        }
      })();
    });
  }
}

setupUserManagement();

const moneyFmt0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const moneyFmt2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt0 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const numFmt3 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

function formatMoney(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? moneyFmt0.format(n) : moneyFmt2.format(n);
}

function formatNumber(value, { digits = 0 } = {}){
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return digits >= 3 ? numFmt3.format(n) : numFmt0.format(n);
}

function formatPercent(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const fixed = Math.round(n * 10) / 10;
  // Use comma for decimals in es-AR
  return String(fixed).replace('.', ',') + '%';
}

function formatShortDateLabel(iso){
  try{
    const raw = String(iso || '').trim();
    const parts = raw.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
    return raw;
  }catch(_){ return String(iso || ''); }
}

function renderSalesStats(stats){
  const st = stats && typeof stats === 'object' ? stats : null;
  try{ if (salesOrders30El) salesOrders30El.textContent = st ? formatNumber(st.orders || 0) : '—'; }catch(_){ }
  try{ if (salesRevenue30El) salesRevenue30El.textContent = st ? formatMoney(st.revenue || 0) : '—'; }catch(_){ }
  try{ if (salesAvgTicket30El) salesAvgTicket30El.textContent = st ? formatMoney(st.avg_ticket || 0) : '—'; }catch(_){ }

  // Chart (by_day)
  if (!salesChartCanvas || typeof Chart === 'undefined') return;
  const series = (st && Array.isArray(st.by_day)) ? st.by_day : [];
  const labels = series.map(x => formatShortDateLabel(x && x.date));
  const revenue = series.map(x => Number(x && x.revenue || 0));
  const orders = series.map(x => Number(x && x.orders || 0));

  try{
    if (window.salesChart && typeof window.salesChart.destroy === 'function') {
      window.salesChart.destroy();
    } else {
      try{ delete window.salesChart; }catch(_){ window.salesChart = null; }
    }
  }catch(_){ }

  try{
    const ctx = salesChartCanvas.getContext ? salesChartCanvas.getContext('2d') : salesChartCanvas;
    window.salesChart = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Pedidos',
            data: orders,
            yAxisID: 'y1',
            backgroundColor: 'rgba(242,107,56,0.28)',
            borderColor: 'rgba(242,107,56,0.45)',
            borderWidth: 1,
            borderRadius: 8,
            maxBarThickness: 18,
          },
          {
            type: 'line',
            label: 'Ventas',
            data: revenue,
            yAxisID: 'y',
            borderColor: '#0a2240',
            backgroundColor: 'rgba(10,34,64,0.14)',
            pointRadius: 2,
            pointHoverRadius: 4,
            tension: 0.35,
            fill: true,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              title: (items) => {
                try{
                  const idx = items && items[0] ? items[0].dataIndex : null;
                  const iso = (idx != null && series[idx]) ? series[idx].date : '';
                  if (!iso) return '—';
                  const parts = String(iso).split('-');
                  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(iso);
                }catch(_){ return ''; }
              },
              label: (ctx) => {
                try{
                  if (ctx && ctx.dataset && ctx.dataset.yAxisID === 'y1') return `Pedidos: ${formatNumber(ctx.parsed && ctx.parsed.y || 0)}`;
                  return `Ventas: ${formatMoney(ctx.parsed && ctx.parsed.y || 0)}`;
                }catch(_){ return ''; }
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true }
          },
          y: {
            position: 'left',
            beginAtZero: true,
            ticks: {
              callback: (v) => formatMoney(v),
              maxTicksLimit: 6,
            }
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              callback: (v) => formatNumber(v),
              precision: 0,
              maxTicksLimit: 6,
            }
          }
        }
      }
    });
  }catch(e){
    console.error('Failed to create salesChart', e);
  }
}

async function refreshSalesStats({ force = false, quiet = true, days = 30 } = {}){
  const now = Date.now();
  if (!force && salesStatsCache && (now - salesStatsTs) < SALES_STATS_TTL_MS) {
    try{ renderSalesStats(salesStatsCache); }catch(_){ }
    return salesStatsCache;
  }
  try{
    const d = Math.max(1, Math.min(365, Number(days || 30)));
    const stats = await safeFetch(`${API_BASE}/sales/stats?days=${encodeURIComponent(String(d))}`, { cache: 'no-store' });
    salesStatsCache = stats;
    salesStatsTs = now;
    renderSalesStats(stats);
    return stats;
  }catch(e){
    console.error('refreshSalesStats failed', e);
    if (!quiet) showToast('No se pudieron cargar estadísticas de ventas', 'error');
    if (!salesStatsCache) {
      try{ renderSalesStats(null); }catch(_){ }
    }
    throw e;
  }
}

function updateCatalogPager(){
  try{
    const totalPages = Math.max(1, Math.ceil((catalogTotal || 0) / Math.max(1, catalogPageSize || 1)));
    if (pageInfo) pageInfo.textContent = `Página ${catalogPage} / ${totalPages}`;
    if (pageTotalInfo) pageTotalInfo.textContent = `· ${formatNumber(catalogTotal || 0)} productos`;
    if (prevPageBtn) prevPageBtn.disabled = catalogPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = catalogPage >= totalPages;
  }catch(_){ }
}

function updateBulkBar(){
  try{
    const count = selectedProductIds.size;
    if (bulkBar) bulkBar.classList.toggle('hidden', count === 0);
    if (bulkCountEl) bulkCountEl.textContent = String(count);
    // active bulk: percent mode doesn't apply
    if (bulkTarget && bulkMode && bulkValue){
      const t = String(bulkTarget.value || '');
      const isActive = t === 'active';
      bulkMode.disabled = isActive;
      bulkValue.placeholder = isActive ? 'si / no' : '10';
    }
  }catch(_){ }
}

function clearSelection(){
  selectedProductIds.clear();
  try{
    if (selectAllProducts) selectAllProducts.checked = false;
  }catch(_){ }
  // Re-render current page checkboxes state without refetching
  try{
    (productsTableBody || document).querySelectorAll('.rowSelect').forEach((cb) => {
      try{ cb.checked = false; }catch(_){ }
    });
  }catch(_){ }
  updateBulkBar();
}

function round2(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

async function applyBulk(){
  try{
    if (!selectedProductIds.size) return;
    const ids = Array.from(selectedProductIds);
    if (!bulkTarget) return;
    const target = String(bulkTarget.value || 'price');
    const mode = bulkMode ? String(bulkMode.value || 'percent') : 'percent';
    const raw = bulkValue ? String(bulkValue.value || '').trim() : '';

    let updates = [];
    if (target === 'active'){
      const v = raw.toLowerCase();
      let nextActive = null;
      if (['1','true','si','sí','s','on','activo','activa'].includes(v)) nextActive = true;
      if (['0','false','no','n','off','inactivo','inactiva'].includes(v)) nextActive = false;
      if (nextActive === null) {
        showToast('Para "Activo" escribí: si / no', 'error');
        return;
      }
      updates = ids
        .map((id) => ({ id: Number(id), active: nextActive }))
        .filter((u) => Number.isFinite(u.id));
    } else {
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        showToast('Valor inválido', 'error');
        return;
      }
      for (const id of ids){
        const pid = String(id || '').trim();
        if (!pid) continue;
        const prod = getCachedProductById(pid) || null;
        if (!prod) continue;
        const basePrice = Number(prod.price || 0);
        const retailExists = !(prod.price_retail === null || prod.price_retail === undefined || prod.price_retail === '');
        const baseRetail = retailExists ? Number(prod.price_retail) : null;

        const payload = { id: Number(pid) };
        if (!Number.isFinite(payload.id)) continue;

        if (mode === 'percent'){
          const factor = 1 + (num / 100);
          if (target === 'price' || target === 'both_prices') payload.price = round2(basePrice * factor);
          if (target === 'price_retail' || target === 'both_prices') {
            if (baseRetail !== null && Number.isFinite(baseRetail)) payload.price_retail = round2(baseRetail * factor);
          }
        } else {
          // set
          if (target === 'price' || target === 'both_prices') payload.price = round2(num);
          if (target === 'price_retail' || target === 'both_prices') payload.price_retail = round2(num);
        }
        updates.push(payload);
      }
    }

    if (!updates.length) {
      showToast('No hay productos válidos para actualizar', 'warning');
      return;
    }

    if (applyBulkBtn) applyBulkBtn.disabled = true;
    const result = await safeFetch(`${API_BASE}/products/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(updates),
    });
    const updated = Number(result && result.updated != null ? result.updated : 0) || 0;
    showToast(`Edición masiva: ${updated}/${updates.length} actualizados`);
    clearSelection();
    await ensureAllProductsCache({ force: true }).catch(()=>null);
    await refresh();
  }catch(e){
    console.error('applyBulk failed', e);
    showToast('Error aplicando edición masiva', 'error');
  } finally {
    if (applyBulkBtn) applyBulkBtn.disabled = false;
  }
}

function parseCsvLine(line, delimiter){
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter){
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text){
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).filter(l => String(l || '').trim() !== '');
  if (!lines.length) return [];
  const headerLine = lines[0];
  const comma = headerLine.split(',').length;
  const semi = headerLine.split(';').length;
  const delimiter = semi > comma ? ';' : ',';
  const headers = parseCsvLine(headerLine, delimiter).map(h => String(h || '').trim().replace(/^\\uFEFF/, '').toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++){
    const cols = parseCsvLine(lines[i], delimiter);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] != null) ? String(cols[idx]).trim() : ''; });
    rows.push(obj);
  }
  return rows;
}

function parseCsvNumber(raw){
  const s = String(raw || '').trim();
  if (!s) return null;
  const normalized = s.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function importCsvFile(file){
  if (!file) return;
  try{
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      showToast('CSV vacío o inválido', 'error');
      return;
    }
    await ensureAllProductsCache({ force: true }).catch(()=>null);
    const byCode = new Map();
    for (const p of (allProductsCache || [])){
      const code = normalizeProductCode(p.code || p.codigo);
      if (code) byCode.set(code.toLowerCase(), p);
    }
    const updates = [];
    const missing = [];
    for (const r of rows){
      const code = normalizeProductCode(r.code || r.sku || r.codigo || r['código'] || r['sku']);
      if (!code) continue;
      const prod = byCode.get(code.toLowerCase());
      if (!prod || !prod.id) { missing.push(code); continue; }
      const u = { id: Number(prod.id) };
      if (!Number.isFinite(u.id)) continue;
      const price = parseCsvNumber(r.price || r.precio);
      const retail = parseCsvNumber(r.price_retail || r.precio_minorista || r.minorista);
      const cost = parseCsvNumber(r.cost || r.costo);
      const stock = parseCsvNumber(r.stock);
      const minStock = parseCsvNumber(r.min_stock || r.stock_min || r['stock mínimo']);
      if (price !== null) u.price = round2(price);
      if (retail !== null) u.price_retail = round2(retail);
      if (cost !== null) u.cost = round2(cost);
      if (stock !== null) u.stock = Math.max(0, Math.round(stock));
      if (minStock !== null) u.min_stock = Math.max(0, Math.round(minStock));
      updates.push(u);
    }
    if (!updates.length){
      showToast(missing.length ? `No se encontró ningún SKU del CSV (faltan: ${missing.slice(0,5).join(', ')}${missing.length>5?'...':''})` : 'No hay filas importables', 'error');
      return;
    }
    const res = await safeFetch(`${API_BASE}/products/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(updates),
    });
    const updated = Number(res && res.updated != null ? res.updated : 0) || 0;
    if (missing.length) showToast(`Importación: ${updated} actualizados · ${missing.length} SKUs no encontrados`, 'warning');
    else showToast(`Importación: ${updated} actualizados`);
    await ensureAllProductsCache({ force: true }).catch(()=>null);
    await refresh();
  }catch(e){
    console.error('importCsvFile failed', e);
    showToast('Error importando CSV', 'error');
  }
}

async function importExcelFile(file){
  if (!file) return;
  try{
    const fd = new FormData();
    fd.append('file', file, file.name || 'import.xlsx');
    const res = await safeFetch(`${API_BASE}/products/import-excel`, {
      method: 'POST',
      body: fd,
    });
    const created = Number(res && res.created != null ? res.created : 0) || 0;
    const updated = Number(res && res.updated != null ? res.updated : 0) || 0;
    const skipped = Number(res && res.skipped != null ? res.skipped : 0) || 0;
    const duplicates = Array.isArray(res && res.duplicates) ? res.duplicates.length : 0;
    const missingName = Number(res && res.missing_name != null ? res.missing_name : 0) || 0;
    const errors = Array.isArray(res && res.errors) ? res.errors.length : 0;
    const detail = [];
    if (updated) detail.push(`actualizados ${updated}`);
    if (skipped) detail.push(`omitidos ${skipped}`);
    if (duplicates) detail.push(`duplicados ${duplicates}`);
    if (missingName) detail.push(`sin nombre ${missingName}`);
    if (errors) detail.push(`errores ${errors}`);
    showToast(`Importación Excel: ${created} creados${detail.length ? ' · ' + detail.join(' · ') : ''}`, errors ? 'warning' : 'success');
    await ensureAllProductsCache({ force: true }).catch(()=>null);
    await refresh();
    try{ startAutoImageProgressPolling(); }catch(_){ }
    try{ await fetchAutoImageProgress(); }catch(_){ }
  }catch(e){
    console.error('importExcelFile failed', e);
    let msg = 'Error importando Excel';
    try{
      if (e && e.payload && e.payload.detail) msg = e.payload.detail;
      else if (e && e.payload && typeof e.payload === 'string') msg = e.payload;
    }catch(_){ }
    showToast(msg, 'error');
  }
}

function parseIsoToMs(value){
  try{
    if (!value) return 0;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }catch(_){
    return 0;
  }
}

function renderAutoImageProgress(state){
  if (!autoImageProgress) return;
  if (!state || state.enabled === false || state.status === 'disabled'){
    autoImageProgress.classList.add('hidden');
    return;
  }
  const total = Math.max(0, Number(state.total || 0));
  const processed = Math.max(0, Number(state.processed || 0));
  const attached = Math.max(0, Number(state.attached || 0));
  const status = state.status || 'idle';
  const finishedAt = parseIsoToMs(state.finished_at || state.last_update);
  const recentlyFinished = (status === 'done' || status === 'error') && finishedAt && (Date.now() - finishedAt) < 15000;
  const shouldShow = status === 'running' || status === 'queued' || status === 'error' || recentlyFinished;
  if (!shouldShow || (!total && status !== 'running' && status !== 'queued' && !recentlyFinished)){
    autoImageProgress.classList.add('hidden');
    return;
  }
  autoImageProgress.classList.remove('hidden');
  const safeTotal = total > 0 ? total : Math.max(processed, 1);
  const percent = Math.min(100, Math.round((processed / safeTotal) * 100));
  if (autoImageProgressFill) autoImageProgressFill.style.width = `${percent}%`;
  if (autoImageProgressLabel) autoImageProgressLabel.textContent = `${percent}%`;
  if (autoImageProgressMeta) autoImageProgressMeta.textContent = `${processed}/${total || safeTotal} · ${attached} con foto`;
  if (autoImageProgressStatus){
    if (status === 'error'){
      autoImageProgressStatus.textContent = state.last_error ? `Error: ${state.last_error}` : 'Error';
      autoImageProgressStatus.classList.add('error');
    } else if (status === 'queued'){
      autoImageProgressStatus.textContent = 'En cola…';
      autoImageProgressStatus.classList.remove('error');
    } else if (status === 'running'){
      autoImageProgressStatus.textContent = 'Procesando…';
      autoImageProgressStatus.classList.remove('error');
    } else if (status === 'done'){
      autoImageProgressStatus.textContent = 'Listo';
      autoImageProgressStatus.classList.remove('error');
    } else {
      autoImageProgressStatus.textContent = '';
      autoImageProgressStatus.classList.remove('error');
    }
  }
}

async function fetchAutoImageProgress(){
  if (!autoImageProgress) return;
  try{
    const state = await safeFetch(`${API_BASE}/products/auto-image/status`, { cache: 'no-store' });
    renderAutoImageProgress(state);
  }catch(e){
    autoImageProgress.classList.add('hidden');
  }
}

function startAutoImageProgressPolling(){
  if (!autoImageProgress || autoImagePollTimer) return;
  autoImagePollTimer = setInterval(()=>{ fetchAutoImageProgress(); }, 2500);
  fetchAutoImageProgress();
}

async function downloadExportCsv(){
  if (!exportCsvBtn) return;
  const prevText = exportCsvBtn.textContent;
  exportCsvBtn.disabled = true;
  exportCsvBtn.textContent = 'Exportando...';
  try{
    const url = `${API_BASE}/export?format=csv&ts=` + Date.now();
    const res = await fetch(url, { cache: 'no-store', headers: { 'X-Actor': getActor() } });
    if (!res.ok) throw new Error('http-' + res.status);
    const csvText = await res.text();
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `productos-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    try{ setTimeout(() => URL.revokeObjectURL(a.href), 1200); }catch(_){ }
    showToast('CSV exportado');
  }catch(e){
    console.error('downloadExportCsv failed', e);
    showToast('No se pudo exportar CSV', 'error');
  } finally {
    exportCsvBtn.disabled = false;
    exportCsvBtn.textContent = prevText || 'Exportar CSV';
  }
}

// Persist local order previews so pending orders with token info don't disappear on reload
function loadLocalOrderCache(){
  try {
    const raw = localStorage.getItem('admin_local_orders_v1');
    if (!raw) { window.__localOrderRows = window.__localOrderRows || {}; window.__localOrderIds = window.__localOrderIds || new Set(); return; }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      window.__localOrderRows = parsed;
      window.__localOrderIds = new Set(Object.keys(parsed));
      // remove very old entries older than 24 hours
      const now = Date.now();
      for(const id of Object.keys(window.__localOrderRows)){
      try{
        const rec = window.__localOrderRows[id];
        if(!rec || !rec.ts) continue;
        // Preserve records that include user information (do not auto-delete)
        const hasUserInfo = !!(rec.payload && (rec.payload.user_full_name || rec.payload.user_email || (rec.payload._token_preview && (rec.payload._token_preview.name || rec.payload._token_preview.email))));
        const maxAge = 1000*60*60*24*30; // 30 days for non-user rows
        if(!hasUserInfo && (now - rec.ts) > maxAge){
          delete window.__localOrderRows[id]; window.__localOrderIds.delete(id);
        }
      }catch(_){ }
    }
    } else {
      window.__localOrderRows = window.__localOrderRows || {};
      window.__localOrderIds = window.__localOrderIds || new Set();
    }
  } catch (e) {
    window.__localOrderRows = window.__localOrderRows || {};
    window.__localOrderIds = window.__localOrderIds || new Set();
    console.warn('loadLocalOrderCache failed', e);
  }
}

function saveLocalOrderCache(){
  try{
    localStorage.setItem('admin_local_orders_v1', JSON.stringify(window.__localOrderRows || {}));
  }catch(e){ console.warn('saveLocalOrderCache failed', e); }
}

function normalizeOrderMapsKeyToken(value){
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOrderAddressCacheKeyFromSnapshot(addr){
  try{
    if (!addr || typeof addr !== 'object') return '';
    const street = [addr.calle, addr.numeracion].filter(Boolean).join(' ').trim();
    const raw = String(addr.rawAddress || '').trim();
    const barrio = String(addr.barrio || '').trim();
    const postal = normalizeOrderPostalCode(addr.postalCode || addr.postal_code || '');
    const department = String(addr.department || '').trim();
    const base = [street, barrio, department, postal, raw].filter(Boolean).join(' | ');
    return normalizeOrderMapsKeyToken(base);
  }catch(_){ return ''; }
}

function loadOrderMapsCoordCache(){
  try{
    const raw = localStorage.getItem(ORDER_MAPS_COORD_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const byOrderId = (parsed.byOrderId && typeof parsed.byOrderId === 'object') ? parsed.byOrderId : {};
    const byAddressKey = (parsed.byAddressKey && typeof parsed.byAddressKey === 'object') ? parsed.byAddressKey : {};
    const now = Date.now();
    const keepFresh = (entry) => {
      try{
        if (!entry || typeof entry !== 'object') return false;
        const ts = Number(entry.ts || 0);
        const lat = Number(entry.lat);
        const lon = Number(entry.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
        if (ts && (now - ts) > ORDER_MAPS_COORD_TTL_MS) return false;
        return true;
      }catch(_){ return false; }
    };
    const cleanByOrderId = {};
    const cleanByAddressKey = {};
    Object.keys(byOrderId).forEach((k) => { if (keepFresh(byOrderId[k])) cleanByOrderId[k] = byOrderId[k]; });
    Object.keys(byAddressKey).forEach((k) => { if (keepFresh(byAddressKey[k])) cleanByAddressKey[k] = byAddressKey[k]; });
    orderMapsCoordCache = {
      byOrderId: cleanByOrderId,
      byAddressKey: cleanByAddressKey,
      updatedAt: Number(parsed.updatedAt || now) || now,
    };
  }catch(e){
    console.warn('loadOrderMapsCoordCache failed', e);
    orderMapsCoordCache = { byOrderId: {}, byAddressKey: {}, updatedAt: 0 };
  }
}

function saveOrderMapsCoordCache(){
  try{
    const payload = {
      byOrderId: orderMapsCoordCache.byOrderId || {},
      byAddressKey: orderMapsCoordCache.byAddressKey || {},
      updatedAt: Date.now(),
    };
    localStorage.setItem(ORDER_MAPS_COORD_CACHE_KEY, JSON.stringify(payload));
  }catch(e){
    console.warn('saveOrderMapsCoordCache failed', e);
  }
}

function getCachedOrderCoords(orderId, addressKey){
  try{
    if (orderId){
      const direct = orderMapsCoordCache.byOrderId && orderMapsCoordCache.byOrderId[String(orderId)];
      if (direct && Number.isFinite(Number(direct.lat)) && Number.isFinite(Number(direct.lon))){
        return { lat: Number(direct.lat), lon: Number(direct.lon) };
      }
    }
    if (addressKey){
      const keyed = orderMapsCoordCache.byAddressKey && orderMapsCoordCache.byAddressKey[String(addressKey)];
      if (keyed && Number.isFinite(Number(keyed.lat)) && Number.isFinite(Number(keyed.lon))){
        return { lat: Number(keyed.lat), lon: Number(keyed.lon) };
      }
    }
    return null;
  }catch(_){ return null; }
}

function setCachedOrderCoords(order, lat, lon){
  try{
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return;
    const fixedLat = Number(latNum.toFixed(6));
    const fixedLon = Number(lonNum.toFixed(6));
    const snapshot = getOrderAddressSnapshot(order);
    const orderId = order && order.id != null ? String(order.id) : '';
    const addressKey = buildOrderAddressCacheKeyFromSnapshot(snapshot);
    const entry = { lat: fixedLat, lon: fixedLon, ts: Date.now() };
    if (orderId) orderMapsCoordCache.byOrderId[orderId] = entry;
    if (addressKey) orderMapsCoordCache.byAddressKey[addressKey] = entry;
    saveOrderMapsCoordCache();
  }catch(_){ }
}

function isMendozaPoint(lat, lon){
  try{
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return false;
    return latNum >= MENDOZA_GEO_BOUNDS.minLat &&
      latNum <= MENDOZA_GEO_BOUNDS.maxLat &&
      lonNum >= MENDOZA_GEO_BOUNDS.minLon &&
      lonNum <= MENDOZA_GEO_BOUNDS.maxLon;
  }catch(_){ return false; }
}

function normalizeOrderPostalDigits(value){
  try{
    const raw = String(value || '').trim();
    if (!raw) return '';
    const m = raw.match(/\d{4}/);
    return m ? String(m[0] || '') : '';
  }catch(_){ return ''; }
}

function normalizeOrderPostalCode(value){
  try{
    const digits = normalizeOrderPostalDigits(value);
    return digits ? ('M' + digits) : '';
  }catch(_){ return ''; }
}

function getOrderPostalDepartments(value){
  try{
    const digits = normalizeOrderPostalDigits(value);
    if (!digits) return [];
    const deps = MENDOZA_POSTAL_TO_DEPARTMENTS[digits];
    return Array.isArray(deps) ? deps.slice() : [];
  }catch(_){ return []; }
}

function normalizeOrderDepartmentToken(value){
  return normalizeOrderMapsKeyToken(String(value || '').replace(/\./g, ' '));
}

function orderPostalMatchesDepartment(postal, department){
  try{
    const postalCode = normalizeOrderPostalCode(postal);
    const depToken = normalizeOrderDepartmentToken(department);
    if (!postalCode || !depToken) return true;
    const deps = getOrderPostalDepartments(postalCode);
    if (!deps.length) return true;
    return deps.some((dep) => normalizeOrderDepartmentToken(dep) === depToken);
  }catch(_){ return true; }
}

function isLikelyLasHerasPostal(postal){
  const digits = normalizeOrderPostalDigits(postal);
  // Las Heras commonly uses M5539 / M5540
  return digits === '5539' || digits === '5540';
}

function buildOrderGeocodeQueryFromSnapshot(addr){
  try{
    if (!addr || typeof addr !== 'object') return '';
    let street = [addr.calle, addr.numeracion].filter(Boolean).join(' ').trim();
    if (!street){
      const first = String(addr.rawAddress || '').split(',')[0] || '';
      if (/\d/.test(first)) street = first.trim();
    }
    const barrio = String(addr.barrio || '')
      .replace(/\bM\d{4}\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
    let postal = normalizeOrderPostalCode(addr.postalCode || addr.postal_code || String(addr.rawAddress || ''));
    const probe = `${street} ${barrio} ${String(addr.rawAddress || '')}`;
    const postalDeps = getOrderPostalDepartments(postal);
    const departmentToken = normalizeOrderMapsKeyToken(addr.department || '');
    let locality = String(addr.department || '').trim();
    if (!locality && departmentToken){
      locality = departmentToken;
    }
    if (!locality && /las heras/i.test(probe)) locality = 'Las Heras';
    if (!locality && postalDeps.length) locality = String(postalDeps[0] || '').trim();
    if (postal && locality && !orderPostalMatchesDepartment(postal, locality)){
      const rawPostal = normalizeOrderPostalCode(String(addr.rawAddress || ''));
      postal = orderPostalMatchesDepartment(rawPostal, locality) ? rawPostal : '';
    }
    const parts = [];
    const pushPart = (value) => {
      const part = String(value || '').replace(/\s+/g, ' ').trim();
      if (!part) return;
      const token = part.toLowerCase();
      if (parts.some((p) => p.toLowerCase() === token)) return;
      parts.push(part);
    };
    pushPart(street);
    pushPart(locality);
    pushPart(barrio);
    pushPart(postal);
    if (!parts.length && addr.rawAddress) pushPart(addr.rawAddress);
    pushPart('Mendoza');
    pushPart('Argentina');
    return parts.join(', ');
  }catch(_){ return ''; }
}

function normalizeOrderPostalToken(value){
  try{
    return normalizeOrderPostalDigits(value);
  }catch(_){ return ''; }
}

function buildOrderArcGisCandidateText(candidate){
  try{
    const attrs = candidate && candidate.attributes && typeof candidate.attributes === 'object'
      ? candidate.attributes
      : {};
    const parts = [
      candidate && candidate.address,
      attrs.Match_addr,
      attrs.LongLabel,
      attrs.ShortLabel,
      attrs.Place_addr,
      attrs.StAddr,
      attrs.District,
      attrs.City,
      attrs.Subregion,
      attrs.Region,
      attrs.Postal,
      attrs.CntryName
    ];
    return normalizeOrderMapsKeyToken(parts.filter(Boolean).join(' '));
  }catch(_){ return ''; }
}

function buildOrderArcGisHints(addr){
  try{
    const raw = String(addr && addr.rawAddress || '');
    const streetRaw = String(addr && addr.calle || '');
    const street = normalizeOrderMapsKeyToken(streetRaw.replace(/\bcalle\b/ig, ' '));
    const streetTokens = street.split(' ').filter((t) => t.length >= 3 && !/^\d/.test(t));
    const numberRaw = String(addr && addr.numeracion || '').trim();
    const numberMatch = numberRaw.match(/\d{1,6}/);
    const number = numberMatch ? String(numberMatch[0]) : '';
    const postalRawMatch = raw.match(/\bM?\d{4}\b/i);
    const postal = normalizeOrderPostalToken(addr && (addr.postalCode || addr.postal_code) || (postalRawMatch ? postalRawMatch[0] : ''));
    const areaProbe = normalizeOrderMapsKeyToken([addr && addr.barrio, raw, streetRaw].filter(Boolean).join(' '));
    const wantsLasHeras = areaProbe.includes('las heras') || isLikelyLasHerasPostal(postal);
    return { streetTokens, number, postal, wantsLasHeras };
  }catch(_){ return { streetTokens: [], number: '', postal: '', wantsLasHeras: false }; }
}

function hasOrderWordToken(text, token){
  try{
    const t = normalizeOrderMapsKeyToken(text);
    const tk = normalizeOrderMapsKeyToken(token);
    if (!t || !tk) return false;
    return new RegExp(`(^|\\s)${tk}(\\s|$)`, 'i').test(t);
  }catch(_){ return false; }
}

async function resolveOrderCoordsWithArcGis(query, addr = null){
  try{
    const clean = String(query || '').trim();
    if (!clean) return null;
    const hints = buildOrderArcGisHints(addr || {});
    const url = `${API_BASE}/admin/arcgis-geocode?q=${encodeURIComponent(clean)}`;
    const data = await safeFetch(url, { cache: 'no-store' }).catch(() => null);
    const candidates = Array.isArray(data && data.candidates) ? data.candidates : [];
    let bestStrict = null;
    let bestRelaxed = null;
    const updateBest = (target, payload) => {
      if (!target || payload.rank > target.rank) return payload;
      return target;
    };
    for (const candidate of candidates){
      const score = Number(candidate && candidate.score);
      if (Number.isFinite(score) && score < 62) continue;
      const loc = candidate && candidate.location && typeof candidate.location === 'object' ? candidate.location : {};
      const lat = Number(loc.y);
      const lon = Number(loc.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!isMendozaPoint(lat, lon)) continue;
      const text = buildOrderArcGisCandidateText(candidate);
      if (!text) continue;
      const streetMatches = hints.streetTokens.filter((token) => text.includes(token));
      const streetHitCount = streetMatches.length;
      const hasStreetHint = hints.streetTokens.length > 0;
      const numberMatches = hints.number ? hasOrderWordToken(text, hints.number) : false;
      const hasNumberHint = !!hints.number;
      const hasLasHerasMatch = text.includes('las heras');
      const localityStrictOk = hints.wantsLasHeras ? hasLasHerasMatch : true;
      const postalToken = normalizeOrderPostalToken((candidate && candidate.attributes && candidate.attributes.Postal) || text);
      const postalMatches = hints.postal ? (postalToken === hints.postal || text.includes(hints.postal)) : false;
      if (!localityStrictOk) continue;
      let rank = Number.isFinite(score) ? score : 0;
      rank += streetHitCount * 6;
      if (numberMatches) rank += 8;
      if (postalMatches) rank += 4;
      if (hasLasHerasMatch) rank += hints.wantsLasHeras ? 5 : 1;
      const addrType = normalizeOrderMapsKeyToken(
        (candidate && candidate.attributes && (candidate.attributes.Addr_type || candidate.attributes.Type)) || ''
      );
      if (addrType.includes('pointaddress') || addrType.includes('streetaddress')) rank += 5;
      const strict = (!hasStreetHint || streetHitCount > 0) && (!hasNumberHint || numberMatches);
      const relaxed = (!hasStreetHint || streetHitCount > 0 || text.includes('mendoza')) && (!hasNumberHint || numberMatches || streetHitCount > 0);
      const payload = { lat, lon, score, rank };
      if (strict) bestStrict = updateBest(bestStrict, payload);
      else if (relaxed) bestRelaxed = updateBest(bestRelaxed, payload);
    }
    if (bestStrict) return { lat: bestStrict.lat, lon: bestStrict.lon, score: bestStrict.score };
    if (bestRelaxed) return { lat: bestRelaxed.lat, lon: bestRelaxed.lon, score: bestRelaxed.score };
    return null;
  }catch(_){ return null; }
}

function scheduleOrderMapLinksRerender(){
  if (orderMapsRerenderTimer) return;
  orderMapsRerenderTimer = setTimeout(() => {
    orderMapsRerenderTimer = null;
    try{
      if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
    }catch(_){ }
    try{
      const ordersTableBody = document.querySelector('#ordersTable_web tbody');
      if (ordersTableBody && Array.isArray(lastOrdersBaseWeb) && lastOrdersBaseWeb.length){
        const dateFilter = (typeof orderDate_web !== 'undefined' && orderDate_web && orderDate_web.value) ? orderDate_web.value : '';
        renderOrders(lastOrdersBaseWeb, 'web', dateFilter);
      }
    }catch(_){ }
    try{
      const modal = document.getElementById('orderModal');
      if (modal && !modal.classList.contains('hidden')){
        const titleEl = document.getElementById('orderModalTitle');
        const txt = String((titleEl && titleEl.textContent) || '');
        const match = txt.match(/#(\d+)/);
        const orderId = match ? String(match[1]) : '';
        if (orderId){
          const order = (lastOrdersBaseWeb || []).find((o) => String(o && o.id) === orderId) ||
            (lastPreparationsBase || []).find((o) => String(o && o.id) === orderId);
          if (order) showOrderDetail(order);
        }
      }
    }catch(_){ }
  }, 220);
}

function queueOrderCoordsResolution(order, snapshot = null){
  try{
    const addr = snapshot || getOrderAddressSnapshot(order);
    const orderId = order && order.id != null ? String(order.id) : '';
    const addressKey = buildOrderAddressCacheKeyFromSnapshot(addr);
    if (!orderId && !addressKey) return;
    if (getCachedOrderCoords(orderId, addressKey)) return;
    const query = buildOrderGeocodeQueryFromSnapshot(addr);
    if (!query) return;
    const inFlightKey = orderId ? ('id:' + orderId) : ('addr:' + addressKey);
    if (!inFlightKey || orderMapsCoordInFlight.has(inFlightKey)) return;
    const failUntil = Number(orderMapsCoordFailUntil.get(inFlightKey) || 0);
    if (failUntil && failUntil > Date.now()) return;
    orderMapsCoordInFlight.add(inFlightKey);
    resolveOrderCoordsWithArcGis(query, addr)
      .then((resolved) => {
        if (!resolved){
          orderMapsCoordFailUntil.set(inFlightKey, Date.now() + (1000 * 60 * 5));
          return;
        }
        orderMapsCoordFailUntil.delete(inFlightKey);
        setCachedOrderCoords(order, resolved.lat, resolved.lon);
        scheduleOrderMapLinksRerender();
      })
      .catch(() => {})
      .finally(() => {
        orderMapsCoordInFlight.delete(inFlightKey);
      });
  }catch(_){ }
}

function normalizeSaleUnit(val){
  const v = String(val || '').trim().toLowerCase();
  if (v === 'kg' || v === 'kilo' || v === 'kilos' || v === 'kilogram' || v === 'kilograms' || v === 'kilogramo' || v === 'kilogramos') return 'kg';
  return 'unit';
}

function normalizeProductCode(value){
  const code = String(value || '').trim();
  return code || '';
}

function syncProductLookup(products){
  const list = Array.isArray(products) ? products : [];
  const next = new Map();
  list.forEach((p) => {
    const key = String((p && (p.id ?? p._id)) || '').trim();
    if (!key) return;
    next.set(key, p || {});
  });
  productLookupById = next;
}

function getCachedProductById(productId){
  const key = String(productId || '').trim();
  if (!key) return null;
  return productLookupById.get(key) || null;
}

function getProductStockKg(p){
  try{
    const stockKg = Number(p?.stock_kg);
    const fallback = Number(p?.stock ?? 0);
    if (Number.isFinite(stockKg) && stockKg > 0) return stockKg;
    if ((!Number.isFinite(stockKg) || stockKg <= 0) && Number.isFinite(fallback) && fallback > 0) return fallback;
    if (Number.isFinite(stockKg)) return Math.max(0, stockKg);
    return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
  }catch(_){ return 0; }
}

function getProductKgPerUnit(p){
  try{
    const n = Number(p?.kg_per_unit);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }catch(_){ return 1; }
}

function syncProductUnitFields(){
  try{
    const unit = normalizeSaleUnit((productForm && productForm.sale_unit && productForm.sale_unit.value) ? productForm.sale_unit.value : 'unit');
    const isKg = unit === 'kg';
    const stockInput = productForm && productForm.stock ? productForm.stock : null;
    const kgInput = productForm && productForm.kg_per_unit ? productForm.kg_per_unit : null;

    if (kgPerUnitField) kgPerUnitField.style.display = isKg ? '' : 'none';
    if (stockLabel) stockLabel.textContent = isKg ? 'Stock disponible (kg)' : 'Stock';
    if (priceLabel) priceLabel.textContent = isKg ? 'Precio mayorista (unidad completa)' : 'Precio mayorista';

    if (stockInput){
      stockInput.step = isKg ? '0.01' : '1';
      stockInput.min = '0';
      if (!isKg) {
        const current = Number(stockInput.value);
        if (!Number.isNaN(current)) stockInput.value = String(Math.max(0, Math.round(current)));
      }
    }
    if (kgInput){
      const cur = Number(kgInput.value);
      if (Number.isNaN(cur) || cur <= 0) kgInput.value = '1';
      kgInput.required = isKg;
    }
  }catch(e){ console.warn('syncProductUnitFields failed', e); }
}

function validateForm(){
  const name = productForm.name.value.trim();
  const price = productForm.price.value;
  const retailPrice = retailPriceInput ? retailPriceInput.value : '';
  const desc = productForm.description.value.trim();
  const saleUnit = normalizeSaleUnit((productForm.sale_unit && productForm.sale_unit.value) ? productForm.sale_unit.value : 'unit');
  const kgPerUnit = Number(productForm.kg_per_unit && productForm.kg_per_unit.value ? productForm.kg_per_unit.value : 1);
  const retailPriceOk = (retailPrice === '' || (!isNaN(Number(retailPrice)) && Number(retailPrice) >= 0));
  // Basic form checks for product creation/update
  // Allow empty description (legacy products may not have descriptions)
  const ok = name.length > 0 && price !== '' && !isNaN(Number(price)) && Number(price) >= 0 && retailPriceOk && (saleUnit !== 'kg' || (!isNaN(kgPerUnit) && kgPerUnit > 0));
  // Log last product form change (do not pollute with promotion variables)
  try{
    const timestamp = new Date().toISOString();
    const logEntry = { action: currentEditId ? 'update' : 'create', timestamp, name, price: Number(price), price_retail: (retailPrice === '' ? null : Number(retailPrice)) };
    localStorage.setItem('productFormLog', JSON.stringify(logEntry));
    localStorage.setItem('admin_products_v1_lastUpdated', timestamp);
  }catch(e){ console.warn('Failed to write product log or lastUpdated to localStorage', e); }
  // Save button should be enabled only when required fields valid AND if imageUrl exists or no file selected
  saveBtn.disabled = !ok || (selectedFile && !imageUrl);
}

// small helper to avoid XSS when inserting strings into innerHTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
if(imageInput) imageInput.onchange = () =>{
  const f = imageInput.files[0];
  selectedFile = f || null;
  fileNameEl.textContent = f ? f.name : 'Ningún archivo seleccionado';
  imagePreview.innerHTML = '';
  try{ if(imageUrlInput) imageUrlInput.value = ''; }catch(_){ }
  if(f){
    const reader = new FileReader();
    reader.onload = e => { const img = document.createElement('img'); img.src = e.target.result; imagePreview.appendChild(img); };
    reader.readAsDataURL(f);
    uploadImageBtn.disabled = false; // enable upload
    imageUrl = null; // reset url until uploaded
  } else {
    uploadImageBtn.disabled = true;
  }
  validateForm();
}

if(uploadImageBtn) uploadImageBtn.onclick = async () =>{
  if(!selectedFile) return showToast('Selecciona un archivo primero', 'error');
  uploadImageBtn.disabled = true;
  try{
    const res = await uploadImage(selectedFile);
    imageUrl = res.image_url;
    showToast('Imagen subida correctamente');
  }catch(err){
    console.error(err); showToast('Error al subir imagen', 'error');
  } finally { uploadImageBtn.disabled = false; validateForm(); }
}

async function uploadImage(file){
  return await uploadImageWithProgress(file);
}

function uploadImageWithProgress(file, onProgress){
  return new Promise((resolve, reject) => {
    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload-image`);
    xhr.upload.onprogress = (ev) => { if(ev.lengthComputable && onProgress) onProgress(Math.round(ev.loaded/ev.total*100)); };
    xhr.onload = () => {
      if(xhr.status >=200 && xhr.status < 300){
        try{ resolve(JSON.parse(xhr.responseText)); }catch(e){ resolve({}); }
      } else {
        reject(new Error('upload-failed'));
      }
    };
    xhr.onerror = () => reject(new Error('upload-failed'));
    xhr.send(fd);
  });
}

function buildImagePreviewSrc(rawUrl){
  try{
    if (!rawUrl) return '';
    const u = String(rawUrl);
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('//')) return u;
    if (u.startsWith('/')) return API_BASE + u;
    return API_BASE + '/' + u.replace(/^\//, '');
  }catch(_){ return ''; }
}

async function uploadImageFromUrl(url){
  return await safeFetch(`${API_BASE}/upload-image-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

if (imageUrlBtn) imageUrlBtn.onclick = async () => {
  const raw = imageUrlInput ? String(imageUrlInput.value || '').trim() : '';
  if (!raw) return showToast('Pegá una URL primero', 'error');
  const prevText = imageUrlBtn.textContent;
  imageUrlBtn.disabled = true; imageUrlBtn.textContent = 'Cargando...';
  try{
    const res = await uploadImageFromUrl(raw);
    imageUrl = (res && res.image_url) ? res.image_url : raw;
    selectedFile = null;
    try{ if(imageInput) imageInput.value = ''; }catch(_){ }
    if (uploadImageBtn) uploadImageBtn.disabled = true;
    const previewSrc = buildImagePreviewSrc(imageUrl);
    imagePreview.innerHTML = previewSrc ? `<img src="${previewSrc}" onerror="this.onerror=null;this.src='../images/default.png'"/>` : '';
    try{ fileNameEl.textContent = imageUrl ? imageUrl.split('/').pop() : 'Ningún archivo seleccionado'; }catch(_){ }
    showToast('Imagen cargada desde URL');
  }catch(e){
    console.error('uploadImageFromUrl failed', e);
    let msg = 'No se pudo cargar imagen desde URL';
    try{
      if (e && e.payload && e.payload.detail) msg = e.payload.detail;
    }catch(_){ }
    showToast(msg, 'error');
  }finally{
    imageUrlBtn.disabled = false;
    imageUrlBtn.textContent = prevText || 'Usar URL';
    validateForm();
  }
};

if (imageSearchBtn) imageSearchBtn.onclick = () => {
  try{
    const name = productForm && productForm.name ? String(productForm.name.value || '').trim() : '';
    if (!name) { showToast('Escribí el nombre del producto primero', 'error'); return; }
    const q = encodeURIComponent(name);
    window.open(`https://www.google.com/search?tbm=isch&q=${q}`, '_blank', 'noopener');
  }catch(e){
    console.warn('imageSearchBtn failed', e);
  }
};

// CRUD fetchers
async function fetchProducts(q = '', category = '', sort = '', opts = {}){
  const params = new URLSearchParams();
  if(q) params.append('q', q);
  if(category) params.append('category', category);
  if(sort) params.append('sort', sort);
  try{
    if (opts && typeof opts.skip !== 'undefined') params.append('skip', String(Math.max(0, Number(opts.skip) || 0)));
    if (opts && typeof opts.limit !== 'undefined') params.append('limit', String(Math.max(1, Number(opts.limit) || 100)));
  }catch(_){ }
  const url = `${API_BASE}/products?` + params.toString();
  return await safeFetch(url).catch(err => { console.error('fetchProducts failed', err); throw err; });
}

async function fetchProductsPaged(q = '', category = '', sort = '', skip = 0, limit = 50){
  const params = new URLSearchParams();
  if(q) params.append('q', q);
  if(category) params.append('category', category);
  if(sort) params.append('sort', sort);
  params.append('skip', String(Math.max(0, Number(skip) || 0)));
  params.append('limit', String(Math.max(1, Number(limit) || 50)));
  const url = `${API_BASE}/products/paged?` + params.toString();
  try{
    const page = await safeFetch(url);
    if (page && Array.isArray(page.items)) return page;
  }catch(e){
    console.warn('fetchProductsPaged failed, falling back to /products', e);
  }
  const items = await fetchProducts(q, category, sort, { skip, limit });
  return { total: Array.isArray(items) ? items.length : 0, skip: 0, limit: Array.isArray(items) ? items.length : 0, items: Array.isArray(items) ? items : [] };
}

async function ensureAllProductsCache({ force = false } = {}){
  const freshMs = 1000 * 60 * 5;
  const now = Date.now();
  if (!force && allProductsCache.length && (now - allProductsCacheTs) < freshMs) return allProductsCache;
  if (allProductsCacheHydrating) return allProductsCacheHydrating;
  allProductsCacheHydrating = (async () => {
    try{
      const list = await fetchProducts('', '', 'name_asc', { skip: 0, limit: 5000 });
      allProductsCache = Array.isArray(list) ? list : [];
      allProductsCacheTs = Date.now();
      syncProductLookup(allProductsCache);
      return allProductsCache;
    } finally {
      allProductsCacheHydrating = null;
    }
  })();
  return allProductsCacheHydrating;
}

async function ensureSkuDiagnostics({ force = false } = {}){
  const freshMs = 1000 * 60 * 5;
  const now = Date.now();
  if (!force && duplicateSkuSetTs && (now - duplicateSkuSetTs) < freshMs) return duplicateSkuSet;
  try{
    const list = await safeFetch(`${API_BASE}/products/duplicates?limit=500`).catch(() => []);
    const next = new Set();
    if (Array.isArray(list)) {
      list.forEach((d) => {
        try{
          const code = String(d && d.code || '').trim().toLowerCase();
          if (code) next.add(code);
        }catch(_){ }
      });
    }
    duplicateSkuSet = next;
    duplicateSkuSetTs = Date.now();
  }catch(e){
    console.warn('ensureSkuDiagnostics failed', e);
  }
  return duplicateSkuSet;
}

async function createProduct(payload){
  const url = `${API_BASE}/products`;
  console.log('createProduct -> POST', url, payload);
  try{
    return await safeFetch(url, {method:'POST', headers:{'Content-Type':'application/json', 'Accept': 'application/json'}, body: JSON.stringify(payload)});
  }catch(e){
    console.error('createProduct failed', e, e.payload || null);
    // rethrow original error so caller can inspect status/payload
    throw e;
  }
}

async function updateProduct(id, payload){
  const url = `${API_BASE}/products/${id}`;
  console.log('updateProduct -> PUT', url, payload);
  try{
    return await safeFetch(url, {method:'PUT', headers:{'Content-Type':'application/json', 'Accept': 'application/json'}, body: JSON.stringify(payload)});
  }catch(e){
    console.error('updateProduct failed', e);
    throw e;
  }
}

async function deleteProduct(id){
  const url = `${API_BASE}/products/${id}`;
  console.log('deleteProduct -> DELETE', url);
  try{
    const resp = await safeFetch(url, { method: 'DELETE' });
    return resp;
  }catch(e){
    console.error('deleteProduct failed', e);
    throw new Error(`delete-failed ${e.message}`);
  }
}

async function refresh(){
  const q = searchInput.value.trim();
  const cat = categoryFilter.value;
  const sort = sortSelect.value;
  const prevText = refreshBtn.textContent;
  refreshBtn.disabled = true; refreshBtn.textContent = 'Cargando...';
  try{
    if (pageSizeSelect) {
      const parsed = parseInt(String(pageSizeSelect.value || '50'), 10);
      catalogPageSize = Number.isFinite(parsed) ? Math.max(1, parsed) : catalogPageSize;
    }
  }catch(_){ }

  await ensureAllProductsCache({ force: false }).catch(()=>null);
  await ensureSkuDiagnostics({ force: false }).catch(()=>null);

  const fetchAndRender = async () => {
    const skip = Math.max(0, (catalogPage - 1) * catalogPageSize);
    const page = await fetchProductsPaged(q, cat, sort, skip, catalogPageSize);
    catalogTotal = Number(page && page.total != null ? page.total : ((page && page.items) ? page.items.length : 0)) || 0;
    catalogPageItems = Array.isArray(page && page.items) ? page.items : [];
    // If filter changes caused the current page to go out of range, snap back.
    const totalPages = Math.max(1, Math.ceil((catalogTotal || 0) / (catalogPageSize || 1)));
    if (catalogPage > totalPages) {
      catalogPage = totalPages;
      return await fetchAndRender();
    }
    renderProducts(catalogPageItems);
    try{
      const counter = document.getElementById('productCounter');
      if (counter) counter.textContent = String(catalogTotal || 0);
    }catch(_){ }
    updateCatalogPager();
  };

  await fetchAndRender();
  // Keep dashboard stats based on the full cache (not the current page)
  try{
    const base = (allProductsCache && allProductsCache.length) ? allProductsCache : catalogPageItems;
    updateStats(base || []);
    const dash = document.getElementById('dashboard');
    if (dash && !dash.classList.contains('hidden')) {
      refreshSalesStats({ force: false, quiet: true }).catch(()=>{});
    }
  }catch(_){ }
  // If retail-prices is visible, refresh that section with a dedicated query (full list)
  try{
    const retailSection = document.getElementById('retail-prices');
    if (retailSection && !retailSection.classList.contains('hidden')) {
      await refreshRetailPrices();
    }
  }catch(_){ }
  refreshBtn.disabled = false; refreshBtn.textContent = prevText;
}

function renderProducts(products){
  productsTableBody.innerHTML = '';
  const categories = new Set();
  const categoriesSource = (allProductsCache && allProductsCache.length) ? allProductsCache : (products || []);
  for (const p of (categoriesSource || [])) categories.add(p.category || '');

  // attempt to load product->categories map (best-effort and async-safe)
  const productCats = loadProductCategories();
  for(const p of (products || [])){
    const id = String(p.id || '').trim();
    const productCode = normalizeProductCode(p.code || p.codigo);
    const assigned = (productCats && (productCats[String(p.id)] || productCats[String(p.name)])) || [];
    const catsDisplay = (assigned && assigned.length) ? assigned.map(x => `<span class="pc-tag">${escapeHtml(x)}</span>`).join(' ') : (p.category || '');
    const tr = document.createElement('tr');
    let imgSrc = '';
    if(p.image_url){
      if(p.image_url.startsWith('http://') || p.image_url.startsWith('https://') || p.image_url.startsWith('//')) imgSrc = p.image_url;
      else if(p.image_url.startsWith('/')) imgSrc = API_BASE + p.image_url;
      else imgSrc = API_BASE + '/' + p.image_url.replace(/^\//, '');
    }
    const unit = normalizeSaleUnit(p.sale_unit || p.unit_type || p.unit || 'unit');
    const unitSuffix = unit === 'kg' ? ' / unidad' : '';
    const stockSuffix = unit === 'kg' ? ' kg' : '';
    const stockRaw = unit === 'kg' ? getProductStockKg(p) : Number(p.stock ?? 0);
    const stockNum = Number(stockRaw || 0);
    const stockDisplay = unit === 'kg'
      ? (Number.isFinite(stockNum) ? formatNumber(stockNum, { digits: 3 }) : '0')
      : String(Number.isFinite(stockNum) ? Math.max(0, Math.round(stockNum)) : 0);
    const kgPerUnitNum = getProductKgPerUnit(p);
    const kgPerUnitHint = unit === 'kg'
      ? ` <small style="color:var(--muted);font-weight:700">(1 = ${formatNumber(kgPerUnitNum, { digits: 3 })} kg)</small>`
      : '';

    const brand = String(p.brand || '').trim();
    const price = Number(p.price ?? 0);
    const retail = (p.price_retail === null || p.price_retail === undefined || p.price_retail === '') ? null : Number(p.price_retail);
    const cost = (p.cost === null || p.cost === undefined || p.cost === '') ? null : Number(p.cost);
    const minStock = Number(p.min_stock ?? 0);
    const hasMinStock = Number.isFinite(minStock) && minStock > 0;
    const isLowStock = hasMinStock && Number.isFinite(stockNum) && stockNum < minStock;
    if (isLowStock) tr.classList.add('row-low-stock');
    if (!productCode) tr.classList.add('row-missing-sku');
    const codeKey = productCode ? String(productCode).trim().toLowerCase() : '';
    const isDupSku = !!(codeKey && duplicateSkuSet && duplicateSkuSet.has(codeKey));
    if (isDupSku) tr.classList.add('row-dup-sku');

    let marginPct = null;
    if (Number.isFinite(price) && price > 0 && Number.isFinite(cost) && cost !== null) {
      marginPct = ((price - cost) / price) * 100;
    }
    const marginClass = (marginPct == null || !Number.isFinite(marginPct)) ? 'cell-muted' : (marginPct >= 30 ? 'cell-good' : (marginPct >= 10 ? 'cell-warn' : 'cell-danger'));
    const marginLabel = (marginPct == null || !Number.isFinite(marginPct)) ? '—' : formatPercent(marginPct);

    const checked = id && selectedProductIds.has(id);

    tr.innerHTML = `
      <td class="col-select"><input type="checkbox" class="rowSelect" data-id="${escapeHtml(id)}" ${checked ? 'checked' : ''} aria-label="Seleccionar producto" /></td>
      <td>${imgSrc ? `<img src="${imgSrc}" alt="${escapeHtml(p.name || '')}" width="60" height="60" style="border-radius:10px;object-fit:cover;background:#fff7ed;border:1px solid rgba(2,6,23,0.06)" onerror="this.onerror=null;this.src='icon.png'">` : ''}</td>
      <td>${escapeHtml(p.name || '')}</td>
      <td>${brand ? escapeHtml(brand) : '<span class="cell-muted">—</span>'}</td>
      <td>${productCode ? (escapeHtml(productCode) + (isDupSku ? ' <span class="cell-danger">Duplicado</span>' : '')) : '<span class="cell-warn">Falta</span>'}</td>
      <td>${catsDisplay}</td>
      <td>${formatMoney(price)}${unitSuffix}</td>
      <td>${retail === null || !Number.isFinite(retail) ? '<span class="cell-muted">—</span>' : (formatMoney(retail) + unitSuffix)}</td>
      <td>${cost === null || !Number.isFinite(cost) ? '<span class="cell-muted">—</span>' : formatMoney(cost)}</td>
      <td><span class="${marginClass}">${escapeHtml(marginLabel)}</span></td>
      <td>${stockDisplay}${stockSuffix}${kgPerUnitHint}</td>
      <td>${hasMinStock ? escapeHtml(String(minStock)) : '<span class="cell-muted">—</span>'}</td>
      <td>${p.active ? 'Sí' : 'No'}</td>
      <td>
        <button data-id="${escapeHtml(id)}" class="editBtn btn">Editar</button>
        <button data-id="${escapeHtml(id)}" class="dupBtn btn">Duplicar</button>
        <button data-id="${escapeHtml(id)}" class="histBtn btn">Historial</button>
        <button data-id="${escapeHtml(id)}" class="delBtn btn danger">Eliminar</button>
      </td>
    `;
    productsTableBody.appendChild(tr);
  }

  // Preserve selection when rebuilding options
  const currentCat = categoryFilter ? String(categoryFilter.value || '') : '';
  if (categoryFilter){
    categoryFilter.innerHTML = '<option value="">Todas</option>' + Array.from(categories).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    try{
      if (currentCat && Array.from(categories).includes(currentCat)) categoryFilter.value = currentCat;
    }catch(_){ }
  }

  // Wire events
  productsTableBody.querySelectorAll('.editBtn').forEach(el => el.onclick = async e => { await onEdit(e.target.dataset.id) });
  productsTableBody.querySelectorAll('.dupBtn').forEach(el => el.onclick = async e => { await onDuplicate(e.target.dataset.id) });
  productsTableBody.querySelectorAll('.histBtn').forEach(el => el.onclick = async e => { await openProductHistory(e.target.dataset.id) });
  productsTableBody.querySelectorAll('.delBtn').forEach(el => el.onclick = async e => { await onDelete(e.target.dataset.id) });
  productsTableBody.querySelectorAll('.rowSelect').forEach((el) => {
    el.addEventListener('change', () => {
      const pid = String(el.dataset.id || '').trim();
      if (!pid) return;
      if (el.checked) selectedProductIds.add(pid);
      else selectedProductIds.delete(pid);
      updateBulkBar();
    });
  });

  // Select-all applies to current page only
  try{
    if (selectAllProducts){
      selectAllProducts.checked = (products || []).length > 0 && (products || []).every(p => selectedProductIds.has(String(p.id || '').trim()));
    }
  }catch(_){ }
  updateBulkBar();
}

function parseRetailPriceInput(rawValue){
  const raw = String(rawValue ?? '').trim();
  if (!raw) return null;
  const num = Number(raw);
  if (Number.isNaN(num) || num < 0) return null;
  return num;
}

function normalizeRetailComparable(rawValue){
  const parsed = parseRetailPriceInput(rawValue);
  return parsed === null ? '' : parsed.toFixed(2);
}

function markRetailRowDirty(inputEl){
  if (!inputEl) return;
  const row = inputEl.closest('tr');
  if (!row) return;
  const original = String(row.dataset.originalRetail || '');
  const current = normalizeRetailComparable(inputEl.value);
  const changed = current !== original;
  row.classList.toggle('retail-row-dirty', changed);
}

function renderRetailPrices(products){
  if (!retailPricesTableBody) return;
  retailPricesTableBody.innerHTML = '';
  for (const p of (products || [])) {
    const tr = document.createElement('tr');
    const retailRaw = (p.price_retail === null || p.price_retail === undefined) ? '' : String(p.price_retail);
    const retailNorm = normalizeRetailComparable(retailRaw);
    tr.dataset.productId = String(p.id);
    tr.dataset.originalRetail = retailNorm;
    tr.innerHTML = `
      <td>${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.category || '')}</td>
      <td>$${Number(p.price || 0).toFixed(2)}</td>
      <td><input class="retail-price-input" type="number" min="0" step="0.01" value="${retailNorm}" placeholder="(usa mayorista)" /></td>
      <td><button class="btn saveRetailRowBtn" data-id="${p.id}">Guardar</button></td>
    `;
    retailPricesTableBody.appendChild(tr);
  }
  retailPricesTableBody.querySelectorAll('.retail-price-input').forEach((input) => {
    input.addEventListener('input', () => markRetailRowDirty(input));
  });
  retailPricesTableBody.querySelectorAll('.saveRetailRowBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const input = row ? row.querySelector('.retail-price-input') : null;
      const id = row ? Number(row.dataset.productId) : NaN;
      if (!input || !Number.isFinite(id)) return;
      await saveSingleRetailPrice(id, input);
    });
  });
}

async function saveSingleRetailPrice(productId, inputEl){
  const raw = String(inputEl.value || '').trim();
  const parsed = parseRetailPriceInput(raw);
  if (raw && parsed === null) {
    showToast('Precio minorista inválido', 'error');
    return false;
  }
  const btn = inputEl.closest('tr')?.querySelector('.saveRetailRowBtn');
  if (btn) btn.disabled = true;
  try{
    await updateProduct(productId, { price_retail: parsed });
    const row = inputEl.closest('tr');
    if (row) {
      row.dataset.originalRetail = normalizeRetailComparable(parsed);
      row.classList.remove('retail-row-dirty');
    }
    return true;
  }catch(e){
    console.error('saveSingleRetailPrice failed', e);
    showToast('No se pudo guardar el precio minorista', 'error');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveAllRetailPrices(){
  if (!retailPricesTableBody) return;
  const rows = Array.from(retailPricesTableBody.querySelectorAll('tr.retail-row-dirty'));
  if (!rows.length) {
    showToast('No hay cambios para guardar', 'info');
    return;
  }
  let okCount = 0;
  let failCount = 0;
  if (retailSaveAllBtn) retailSaveAllBtn.disabled = true;
  for (const row of rows) {
    const input = row.querySelector('.retail-price-input');
    const id = Number(row.dataset.productId);
    if (!input || !Number.isFinite(id)) { failCount += 1; continue; }
    const ok = await saveSingleRetailPrice(id, input);
    if (ok) okCount += 1;
    else failCount += 1;
  }
  if (retailSaveAllBtn) retailSaveAllBtn.disabled = false;
  if (okCount > 0 && failCount === 0) showToast('Precios minorista actualizados');
  else if (okCount > 0 && failCount > 0) showToast(`Guardados: ${okCount} · Fallidos: ${failCount}`, 'error');
  else showToast('No se pudieron guardar los cambios', 'error');
  try{ await refresh(); }catch(_){ }
  try{ await refreshRetailPrices(); }catch(_){ }
}

async function refreshRetailPrices(){
  if (!retailPricesTableBody) return;
  const q = retailPriceSearch ? retailPriceSearch.value.trim() : '';
  const oldText = retailRefreshBtn ? retailRefreshBtn.textContent : '';
  if (retailRefreshBtn) { retailRefreshBtn.disabled = true; retailRefreshBtn.textContent = 'Cargando...'; }
  try{
    const products = await fetchProducts(q, '', 'name_asc', { skip: 0, limit: 5000 });
    retailProductsCache = products || [];
    renderRetailPrices(retailProductsCache);
  }catch(e){
    console.error('refreshRetailPrices failed', e);
    showToast('No se pudieron cargar precios minorista', 'error');
  } finally {
    if (retailRefreshBtn) { retailRefreshBtn.disabled = false; retailRefreshBtn.textContent = oldText || 'Actualizar lista'; }
  }
}

function updateDashboardAlertsVisibility(){
  if (!dashboardAlertsWrap) return;
  try{
    const items = Array.from(dashboardAlertsWrap.querySelectorAll('.alert-item'));
    const anyVisible = items.some(it => !it.classList.contains('hidden'));
    dashboardAlertsWrap.classList.toggle('hidden', !anyVisible);
  }catch(_){ }
}

function updateAlertItem(el, label, count){
  if (!el) return;
  const num = Number(count);
  const safeCount = Number.isFinite(num) ? num : 0;
  el.textContent = `⚠ ${label}: ${formatNumber(safeCount)}`;
  el.classList.toggle('hidden', safeCount === 0);
  el.classList.toggle('alert-ok', safeCount === 0);
  updateDashboardAlertsVisibility();
}

function getProductStockValue(p){
  const unit = normalizeSaleUnit(p && (p.sale_unit || p.unit || ''));
  const stockRaw = unit === 'kg' ? getProductStockKg(p) : Number(p && (p.stock ?? p.cantidad ?? 0));
  return Number.isFinite(stockRaw) ? stockRaw : 0;
}

function isProductLowStock(p){
  if (!p || p.active === false) return false;
  const stockVal = getProductStockValue(p);
  const minStock = Number(p.min_stock ?? 0);
  if (Number.isFinite(minStock) && minStock > 0){
    return stockVal <= minStock;
  }
  return stockVal <= LOW_STOCK_FALLBACK;
}

function updateLowStockAlert(products){
  const list = Array.isArray(products) ? products : [];
  const lowCount = list.filter(isProductLowStock).length;
  updateAlertItem(alertLowStockEl, 'Productos con stock bajo', lowCount);
  return lowCount;
}

function updateOrderAlertCounts(orders){
  const list = Array.isArray(orders) ? orders : [];
  let unseen = 0;
  let unprepared = 0;
  list.forEach((o) => {
    const st = normalizeOrderStatus(o && o.status);
    if (st === 'recibido') unseen += 1;
    else if (st === 'visto') unprepared += 1;
  });
  updateAlertItem(alertOrdersUnseenEl, 'Pedidos sin ver', unseen);
  updateAlertItem(alertOrdersUnpreparedEl, 'Pedidos sin preparar', unprepared);
  return { unseen, unprepared };
}

function updateStats(products){
  const list = Array.isArray(products) ? products : [];
  const totalActive = list.filter(p => p && p.active).length;
  document.getElementById('totalActive').textContent = formatNumber(totalActive);
  const avg = list.reduce((s,p)=> s + Number((p && p.price) || 0), 0) / (list.length || 1);
  document.getElementById('avgPrice').textContent = formatMoney(avg);
  updateLowStockAlert(list);
  const byCat = {};
  list.forEach(p => { const k = (p && p.category) ? p.category : 'Sin categoría'; byCat[k] = (byCat[k] || 0) + 1 });
  const ctx = document.getElementById('categoryChart');
  try{
    if (window.categoryChart && typeof window.categoryChart.destroy === 'function') {
      window.categoryChart.destroy();
    } else {
      // ensure we don't hold a stale non-chart object
      try{ delete window.categoryChart; }catch(_){ window.categoryChart = null; }
    }
  }catch(e){ console.warn('Could not destroy previous categoryChart', e); }
  try{
    // Create responsive pie chart that respects CSS-specified canvas size
    const ctx2 = (ctx && ctx.getContext) ? ctx.getContext('2d') : ctx;
    window.categoryChart = new Chart(ctx2, {
      type: 'pie',
      data: { labels: Object.keys(byCat), datasets: [{ data: Object.values(byCat), backgroundColor: ['#f26b38','#ffb84d','#0ea5a4','#0a2240','#f97316','#fb7185','#22c55e'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }catch(e){ console.error('Failed to create categoryChart', e); }
}

// Modal and form behaviors
if(newBtn) newBtn.onclick = () => { openModal(); };
if(modalClose) modalClose.onclick = () => closeModal();
if(cancelBtn) cancelBtn.onclick = () => closeModal();
// Bind the save button and form submit to handleSave so "Guardar" actually triggers product create/update
if(saveBtn) saveBtn.onclick = handleSave;
if(productForm) productForm.addEventListener('submit', handleSave);
if(refreshBtn) refreshBtn.onclick = () => refresh();
if(searchInput) searchInput.oninput = () => { catalogPage = 1; refresh(); };
if(categoryFilter) categoryFilter.onchange = () => { catalogPage = 1; refresh(); };
if(sortSelect) sortSelect.onchange = () => { catalogPage = 1; refresh(); };
if(pageSizeSelect) pageSizeSelect.onchange = () => { catalogPage = 1; refresh(); };
if(prevPageBtn) prevPageBtn.onclick = () => { if (catalogPage > 1) { catalogPage -= 1; refresh(); } };
if(nextPageBtn) nextPageBtn.onclick = () => {
  const totalPages = Math.max(1, Math.ceil((catalogTotal || 0) / Math.max(1, catalogPageSize || 1)));
  if (catalogPage < totalPages) { catalogPage += 1; refresh(); }
};
if(selectAllProducts) selectAllProducts.onchange = () => {
  const checked = !!selectAllProducts.checked;
  for (const p of (catalogPageItems || [])){
    const id = String(p && p.id || '').trim();
    if (!id) continue;
    if (checked) selectedProductIds.add(id);
    else selectedProductIds.delete(id);
  }
  try{
    productsTableBody.querySelectorAll('.rowSelect').forEach((cb) => { try{ cb.checked = checked; }catch(_){ } });
  }catch(_){ }
  updateBulkBar();
};
if(bulkTarget) bulkTarget.onchange = () => updateBulkBar();
if(applyBulkBtn) applyBulkBtn.onclick = () => applyBulk();
if(clearSelectionBtn) clearSelectionBtn.onclick = () => clearSelection();
if(exportCsvBtn) exportCsvBtn.onclick = () => downloadExportCsv();
if(importCsvBtn) importCsvBtn.onclick = () => { try{ if(importCsvInput) importCsvInput.click(); }catch(_){ } };
if(importCsvInput) importCsvInput.onchange = async () => {
  try{
    const file = importCsvInput.files && importCsvInput.files[0] ? importCsvInput.files[0] : null;
    if (!file) return;
    await importCsvFile(file);
  } finally {
    try{ importCsvInput.value = ''; }catch(_){ }
  }
};
if(importExcelBtn) importExcelBtn.onclick = () => { try{ if(importExcelInput) importExcelInput.click(); }catch(_){ } };
if(importExcelInput) importExcelInput.onchange = async () => {
  try{
    const file = importExcelInput.files && importExcelInput.files[0] ? importExcelInput.files[0] : null;
    if (!file) return;
    await importExcelFile(file);
  } finally {
    try{ importExcelInput.value = ''; }catch(_){ }
  }
};
if(retailRefreshBtn) retailRefreshBtn.onclick = () => refreshRetailPrices();
if(retailSaveAllBtn) retailSaveAllBtn.onclick = () => saveAllRetailPrices();
if(retailPriceSearch) retailPriceSearch.oninput = () => refreshRetailPrices();
// manual backup (admin)
const backupBtn = document.getElementById('backupBtn');
if (backupBtn) backupBtn.addEventListener('click', async () => {
  backupBtn.disabled = true; backupBtn.textContent = 'Creando backup...';
  try{
    const res = await fetch(API_BASE + '/backup', { method: 'POST' });
    if (!res.ok) throw new Error('backup-failed');
    showToast('Backup creado correctamente');
  }catch(err){ console.error(err); showToast('Error creando backup (revisa logs)', 'error'); }
  finally{ backupBtn.disabled = false; backupBtn.textContent = 'Backup'; }
});

// Theme toggle
const toggle = document.getElementById('toggleDark'); if(toggle) toggle.onchange = () => { document.body.classList.toggle('dark', toggle.checked); try{ localStorage.setItem('dark', toggle.checked ? '1' : '0'); }catch(e){} };

async function handleSave(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  console.log('[admin] handleSave invoked', { currentEditId, name: productForm.name.value, price: productForm.price.value, selectedFile, imageUrl });
  saveBtn.disabled = true;
  // collect selected categories from checkboxes in modal (admin-managed filters)
  let selectedCats = [];
  try{
    selectedCats = Array.from(document.querySelectorAll('#categoryCheckboxes input[type=checkbox]:checked')).map(i => i.value);
  }catch(e){ selectedCats = []; }
  // maintain compatibility: set hidden category to first selected or existing value
  productForm.category.value = (selectedCats && selectedCats.length) ? String(selectedCats[0]) : (productForm.category.value || '');

  let parsedCost = null;
  try{
    const raw = costInput ? String(costInput.value || '').trim() : '';
    if (raw !== ''){
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) parsedCost = n;
      else {
        showToast('Costo inválido', 'error');
        saveBtn.disabled = false;
        return;
      }
    }
  }catch(_){ parsedCost = null; }

  let parsedMinStock = 0;
  try{
    const raw = minStockInput ? String(minStockInput.value || '').trim() : '';
    if (raw !== ''){
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) parsedMinStock = Math.round(n);
      else {
        showToast('Stock mínimo inválido', 'error');
        saveBtn.disabled = false;
        return;
      }
    }
  }catch(_){ parsedMinStock = 0; }

  const payload = {
    code: normalizeProductCode(productCodeInput ? productCodeInput.value : '') || null,
    name: productForm.name.value.trim(),
    brand: (brandInput && String(brandInput.value || '').trim()) ? String(brandInput.value || '').trim() : null,
    price: Number(productForm.price.value),
    cost: parsedCost,
    description: productForm.description.value.trim(),
    category: productForm.category.value.trim() || null,
    image_url: imageUrl,
    active: (activeSelect ? String(activeSelect.value) !== 'false' : true),
    min_stock: parsedMinStock
  };
  try{
    const retailRaw = retailPriceInput ? String(retailPriceInput.value || '').trim() : '';
    payload.price_retail = retailRaw === '' ? null : Number(retailRaw);
    if (payload.price_retail !== null && (isNaN(payload.price_retail) || payload.price_retail < 0)) {
      showToast('Precio minorista inválido', 'error');
      saveBtn.disabled = false;
      return;
    }
  }catch(_){ payload.price_retail = null; }
  try{
    const su = normalizeSaleUnit((productForm.sale_unit && productForm.sale_unit.value) ? productForm.sale_unit.value : 'unit');
    payload.sale_unit = su;
    if (su === 'kg') {
      const stockKg = Number(productForm.stock?.value || 0);
      const kgPerUnit = Number(productForm.kg_per_unit?.value || 1);
      payload.stock_kg = !isNaN(stockKg) ? Math.max(0, stockKg) : 0;
      payload.kg_per_unit = (!isNaN(kgPerUnit) && kgPerUnit > 0) ? kgPerUnit : 1;
      payload.stock = Math.max(0, Math.round(payload.stock_kg));
    } else {
      const stockUnits = Number(productForm.stock?.value || 0);
      payload.stock = !isNaN(stockUnits) ? Math.max(0, Math.round(stockUnits)) : 0;
      payload.stock_kg = payload.stock;
      payload.kg_per_unit = 1;
    }
  }catch(_){ payload.sale_unit = 'unit'; payload.stock = 0; payload.stock_kg = 0; payload.kg_per_unit = 1; }
  // Only include discount when provided so it's optional
  try{
    const discVal = productForm.discount && productForm.discount.value !== '' ? Number(productForm.discount.value) : undefined;
    if(typeof discVal !== 'undefined' && !isNaN(discVal)) payload.discount = discVal;
  }catch(e){ }

  try{
    let created = null;
    if(currentEditId){ await updateProduct(currentEditId, payload); showToast('Producto actualizado'); created = { id: currentEditId }; }
    else { created = await createProduct(payload); showToast('Producto creado'); }
    // update product-categories mapping (use id when available, otherwise fallback to name)
    try{
      const key = String((created && created.id) ? created.id : payload.name);
      const mapping = loadProductCategories() || {};
      if(selectedCats && selectedCats.length) mapping[key] = selectedCats; else delete mapping[key];
      await saveProductCategories(mapping);
    }catch(e){ console.warn('Failed to save product categories', e); }

    closeModal(); refresh();
  }catch(err){
    try{ console.error('handleSave error', err); }catch(_){ }
    // If server provided JSON error payload, show it to the admin for debugging
    try{
      if(err && err.payload){
        const p = err.payload;
        const msg = (p && (p.detail || p.error || p.message)) ? (p.detail || p.error || p.message) : JSON.stringify(p);
        showToast('Error guardando producto: ' + String(msg), 'error');
      } else if (err && (String(err.message || '').includes('Failed to fetch') || String(err).includes('NetworkError') || String(err).includes('TypeError'))) {
        showToast('No se pudo conectar al API (' + API_BASE + ')', 'error');
      } else {
        showToast('Error guardando producto','error');
      }
    }catch(e){ showToast('Error guardando producto','error'); }
  }
  finally { saveBtn.disabled = false; }
}

// If the admin loaded with promo-images active, trigger fetch on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  try{
    const active = document.querySelector('.sidebar nav a.active');
    if(active && active.dataset && active.dataset.section === 'promo-images'){
      // Ensure DOM nodes exist then fetch
      setTimeout(()=>{ try{ fetchPromoImages(); }catch(e){ /* ignore */ } }, 40);
    }
      // Ensure a single active section is visible on load
      const activeNav = document.querySelector('.sidebar nav a.active');
      document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
      let toShow = 'dashboard';
      if (activeNav && activeNav.dataset && activeNav.dataset.section) toShow = activeNav.dataset.section;
      const secEl = document.getElementById(toShow);
      if (secEl) secEl.classList.remove('hidden');
      // If the promo-images tab is active load images
      if (toShow === 'promo-images'){
        setTimeout(()=>{ try{ fetchPromoImages(); }catch(e){ /* ignore */ } }, 40);
      }
      if (toShow === 'retail-prices'){
        setTimeout(()=>{ try{ refreshRetailPrices(); }catch(e){ /* ignore */ } }, 40);
      }
      if (toShow === 'preparations'){
        setTimeout(()=>{ try{ refreshPreparations(false); }catch(e){ /* ignore */ } }, 40);
      }
      // If promoImagesList exists but is empty, show a helpful hint so UI isn't blank
      if(promoImagesList && promoImagesList.children.length === 0){
        promoImagesList.innerHTML = '<div class="empty-note">Seleccione la pestaña o recargue la página para gestionar imágenes promocionales.</div>';
      }
  }catch(e){ console.warn('promo-images init guard failed', e); }
});


async function onEdit(id){
  try{
    const res = await fetch(API_BASE + '/products/' + id);
    const p = await res.json();
    currentEditId = id;
    productForm.name.value = p.name;
    if (productCodeInput) productCodeInput.value = normalizeProductCode(p.code || p.codigo);
    if (brandInput) brandInput.value = String(p.brand || '');
    productForm.price.value = p.price;
    if (retailPriceInput) retailPriceInput.value = (p.price_retail === null || p.price_retail === undefined || p.price_retail === '') ? '' : String(p.price_retail);
    try{ if (costInput) costInput.value = (p.cost === null || p.cost === undefined || p.cost === '') ? '' : String(p.cost); }catch(_){ }
    try{ if (minStockInput) minStockInput.value = (p.min_stock === null || p.min_stock === undefined || p.min_stock === '') ? '0' : String(p.min_stock); }catch(_){ }
    try{ if (activeSelect) activeSelect.value = (p.active === false) ? 'false' : 'true'; }catch(_){ }
    productForm.category.value = p.category;
    productForm.description.value = p.description;
    try{ if(productForm.sale_unit){ productForm.sale_unit.value = normalizeSaleUnit(String(p.sale_unit || p.unit_type || p.unit || 'unit')); } }catch(_){ }
    try{
      const unit = normalizeSaleUnit(String(p.sale_unit || p.unit_type || p.unit || 'unit'));
      if (unit === 'kg') productForm.stock.value = String(getProductStockKg(p));
      else productForm.stock.value = (p.stock != null) ? String(Math.max(0, Math.round(Number(p.stock) || 0))) : '0';
    }catch(_){ }
    try{ if(productForm.kg_per_unit){ productForm.kg_per_unit.value = String(getProductKgPerUnit(p)); } }catch(_){ }
    try{ productForm.discount.value = (p.discount != null) ? String(p.discount) : ''; }catch(_){ }
    try{ syncProductUnitFields(); }catch(_){ }
    let previewSrc = '';
    if(p.image_url){
      if(p.image_url.startsWith('http://') || p.image_url.startsWith('https://') || p.image_url.startsWith('//')) previewSrc = p.image_url;
      else if(p.image_url.startsWith('/')) previewSrc = API_BASE + p.image_url;
      else previewSrc = API_BASE + '/' + p.image_url.replace(/^\//, '');
    }
  imagePreview.innerHTML = previewSrc ? `<img src="${previewSrc}" onerror="this.onerror=null;this.src='../images/default.png'"/>` : '';
    imageUrl = p.image_url;
    selectedFile = null; fileNameEl.textContent = p.image_url ? p.image_url.split('/').pop() : 'Ningún archivo seleccionado';
    try{ if(imageUrlInput) imageUrlInput.value = p.image_url || ''; }catch(_){ }

    // populate category checkboxes (ensure filters sync first, then mapping)
    try{
      await fetchAndSyncProductCategories().catch(()=>null);
      const filters = loadFilters();
      const mapping = loadProductCategories();
      const key = String(p.id || p.name || '');
      const assigned = (mapping && (mapping[key] || mapping[String(p.name)])) || [];
      renderCategoryCheckboxes(filters, assigned);
    }catch(e){ console.warn('populate category checkboxes failed', e); }

    document.getElementById('modalTitle').textContent = 'Editar producto';
    openModal();
    validateForm();
  }catch(err){console.error(err); showToast('Error cargando producto','error')}
}

async function onDuplicate(id){
  const pid = String(id || '').trim();
  if (!pid) return;
  try{
    const res = await fetch(API_BASE + '/products/' + pid);
    if (!res.ok) throw new Error('http-' + res.status);
    const p = await res.json();
    currentEditId = null;

    // Reset modal state
    try{ productForm.reset(); }catch(_){ }
    imageUrl = p.image_url || null;
    selectedFile = null;
    try{ fileNameEl.textContent = imageUrl ? String(imageUrl).split('/').pop() : 'Ningun archivo seleccionado'; }catch(_){ }
    try{ if(imageUrlInput) imageUrlInput.value = imageUrl || ''; }catch(_){ }

    // Prefill with a safe duplicate (force new SKU + zero stock)
    productForm.name.value = String(p.name || '').trim() ? (String(p.name).trim() + ' (Copia)') : 'Producto (Copia)';
    if (productCodeInput) productCodeInput.value = '';
    if (brandInput) brandInput.value = String(p.brand || '');
    productForm.price.value = (p.price != null) ? String(p.price) : '';
    if (retailPriceInput) retailPriceInput.value = (p.price_retail == null || p.price_retail === '') ? '' : String(p.price_retail);
    if (costInput) costInput.value = (p.cost == null || p.cost === '') ? '' : String(p.cost);
    if (minStockInput) minStockInput.value = (p.min_stock == null || p.min_stock === '') ? '0' : String(p.min_stock);
    if (activeSelect) activeSelect.value = 'true';
    productForm.category.value = p.category || '';
    productForm.description.value = p.description || '';
    try{ if(productForm.sale_unit){ productForm.sale_unit.value = normalizeSaleUnit(String(p.sale_unit || p.unit_type || p.unit || 'unit')); } }catch(_){ }
    try{ if(productForm.kg_per_unit){ productForm.kg_per_unit.value = String(getProductKgPerUnit(p)); } }catch(_){ }
    try{ productForm.stock.value = '0'; }catch(_){ }
    try{ productForm.discount.value = (p.discount != null) ? String(p.discount) : ''; }catch(_){ }
    try{ syncProductUnitFields(); }catch(_){ }

    // Preview image (reuse URL)
    let previewSrc = '';
    if(imageUrl){
      const u = String(imageUrl);
      if(u.startsWith('http://') || u.startsWith('https://') || u.startsWith('//')) previewSrc = u;
      else if(u.startsWith('/')) previewSrc = API_BASE + u;
      else previewSrc = API_BASE + '/' + u.replace(/^\//, '');
    }
    imagePreview.innerHTML = previewSrc ? `<img src="${previewSrc}" onerror="this.onerror=null;this.src='icon.png'"/>` : '';

    document.getElementById('modalTitle').textContent = 'Duplicar producto';
    await openModal();
    // Copy assigned categories from the original mapping
    try{
      const filters = loadFilters();
      const mapping = loadProductCategories() || {};
      const assigned = (mapping && (mapping[String(p.id)] || mapping[String(p.name)])) || [];
      renderCategoryCheckboxes(filters, assigned);
    }catch(_){ }
    validateForm();
  }catch(e){
    console.error('onDuplicate failed', e);
    showToast('No se pudo duplicar el producto', 'error');
  }
}

function closeHistoryModal(){
  try{
    if (!historyModal) return;
    historyModal.classList.add('hidden');
    historyModal.setAttribute('aria-hidden', 'true');
    if (historyModalBody) historyModalBody.innerHTML = '';
  }catch(_){ }
}

function renderProductHistory(list){
  if (!historyModalBody) return;
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length){
    historyModalBody.innerHTML = '<div class="empty-note">Sin cambios registrados.</div>';
    return;
  }
  historyModalBody.innerHTML = '';
  for (const ch of arr){
    const entry = document.createElement('div');
    entry.className = 'history-entry';
    const action = String((ch && ch.action) || 'update').toUpperCase();
    const actor = String((ch && ch.actor) || '').trim() || '—';
    let dateText = '';
    try{
      dateText = ch && ch.created_at ? new Date(ch.created_at).toLocaleString('es-AR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    }catch(_){ dateText = ''; }
    const changed = (ch && ch.changed_fields && typeof ch.changed_fields === 'object') ? ch.changed_fields : null;
    let diffText = '';
    if (changed){
      const keys = Object.keys(changed);
      if (keys.length){
        const lines = [];
        for (const k of keys.slice(0, 40)){
          const from = (changed[k] && Object.prototype.hasOwnProperty.call(changed[k], 'from')) ? changed[k].from : undefined;
          const to = (changed[k] && Object.prototype.hasOwnProperty.call(changed[k], 'to')) ? changed[k].to : undefined;
          lines.push(`${k}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
        }
        if (keys.length > 40) lines.push('... (truncado)');
        diffText = lines.join('\\n');
      }
    }
    if (!diffText){
      try{
        const payload = { before: ch.before || null, after: ch.after || null };
        diffText = JSON.stringify(payload, null, 2);
        if (diffText.length > 4000) diffText = diffText.slice(0, 4000) + '\\n... (truncado)';
      }catch(_){ diffText = ''; }
    }
    entry.innerHTML = `
      <div class="history-meta">
        <span class="history-action">${escapeHtml(action)}</span>
        <span class="history-date">${escapeHtml(dateText || '')}</span>
        <span class="history-actor">${escapeHtml(actor)}</span>
      </div>
      <pre class="history-diff">${escapeHtml(diffText || '')}</pre>
    `;
    historyModalBody.appendChild(entry);
  }
}

async function openProductHistory(id){
  const pid = String(id || '').trim();
  if (!pid || !historyModal) return;
  const prod = getCachedProductById(pid) || null;
  const name = prod && prod.name ? String(prod.name) : 'Producto';
  const code = normalizeProductCode(prod && (prod.code || prod.codigo));
  if (historyModalTitle) historyModalTitle.textContent = `Historial: ${name}${code ? (' · SKU ' + code) : ''}`;
  if (historyModalBody) historyModalBody.innerHTML = '<div class="empty-note">Cargando historial...</div>';
  historyModal.classList.remove('hidden');
  historyModal.setAttribute('aria-hidden','false');
  try{
    const list = await safeFetch(`${API_BASE}/product-changes?product_id=${encodeURIComponent(pid)}&limit=120`).catch(() => []);
    renderProductHistory(list);
  }catch(e){
    console.error('openProductHistory failed', e);
    if (historyModalBody) historyModalBody.innerHTML = '<div class="empty-note">No se pudo cargar el historial.</div>';
  }
}

async function onDelete(id){
  const pid = String(id || '').trim();
  if (!pid) return;
  const prod = getCachedProductById(pid) || null;
  const name = prod && prod.name ? String(prod.name) : 'producto';
  const code = normalizeProductCode(prod && (prod.code || prod.codigo));
  const label = code ? `${name} (SKU ${code})` : name;
  const typed = prompt(`Vas a eliminar: ${label}\n\nEscribí ELIMINAR para confirmar:`, '');
  if (typed !== 'ELIMINAR') return;
  try{ await deleteProduct(pid); showToast('Eliminado'); await ensureAllProductsCache({ force: true }).catch(()=>null); refresh(); }
  catch(err){ console.error(err); showToast('Error eliminando','error'); }
}

// --- Orders (admin) ---
// Orders section is Web-only.
const orderSearch_web = document.getElementById('orderSearch_web');
const orderDate_web = document.getElementById('orderDate_web');
const clearOrderDate_web = document.getElementById('clearOrderDate_web');
const markAllSeenBtn_web = document.getElementById('markAllSeenBtn_web');
const refreshOrdersBtn_web = document.getElementById('refreshOrdersBtn_web');
const ordersTypeTabMayorista = document.getElementById('ordersTypeTab_mayorista');
const ordersTypeTabMinorista = document.getElementById('ordersTypeTab_minorista');
const badgeTypeMayorista = document.getElementById('badge_type_mayorista');
const badgeTypeMinorista = document.getElementById('badge_type_minorista');
const preparationsSearch = document.getElementById('preparationsSearch');
const preparationsDate = document.getElementById('preparationsDate');
const filterPreparationsTomorrowBtn = document.getElementById('filterPreparationsTomorrow');
const clearPreparationsDate = document.getElementById('clearPreparationsDate');
const markAllPreparedBtn = document.getElementById('markAllPreparedBtn');
const refreshPreparationsBtn = document.getElementById('refreshPreparationsBtn');
const preparationsList = document.getElementById('preparationsList');
let currentOrderCustomerType = 'mayorista';
let lastOrdersBaseWeb = [];
let lastPreparationsBase = [];

function mergePatchedOrderIntoCaches(updated, fallbackId){
  const uid = String((updated && updated.id) || fallbackId || '').trim();
  if (!uid || !updated || updated.id == null) return;

  let replacedInPreparations = false;
  lastPreparationsBase = (lastPreparationsBase || []).map((entry) => {
    if (String(entry && entry.id) === uid){
      replacedInPreparations = true;
      return mergeOrderRecord(entry, updated);
    }
    return entry;
  });
  if (!replacedInPreparations){
    lastPreparationsBase = [updated, ...(lastPreparationsBase || [])];
  }

  let replacedInOrders = false;
  lastOrdersBaseWeb = (lastOrdersBaseWeb || []).map((entry) => {
    if (String(entry && entry.id) === uid){
      replacedInOrders = true;
      return mergeOrderRecord(entry, updated);
    }
    return entry;
  });
  if (!replacedInOrders){
    lastOrdersBaseWeb = [updated, ...(lastOrdersBaseWeb || [])];
  }
}

async function patchOrderStatus(orderId, targetStatus){
  await ensureApiBase();
  const updated = await safeFetch(API_BASE + '/orders/' + encodeURIComponent(orderId) + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: targetStatus }),
  });
  mergePatchedOrderIntoCaches(updated, orderId);
  return updated;
}

function collectBulkActionIds(selector, root){
  const seen = new Set();
  const out = [];
  try{
    Array.from((root || document).querySelectorAll(selector)).forEach((node) => {
      const id = node && node.dataset ? String(node.dataset.id || '').trim() : '';
      if (!id || seen.has(id) || (node && node.disabled)) return;
      seen.add(id);
      out.push(id);
    });
  }catch(_){ }
  return out;
}

async function runBulkOrderStatusUpdate(ids, targetStatus, button, options){
  const orderIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  const total = orderIds.length;
  const progressLabel = options && options.progressLabel ? String(options.progressLabel) : 'Actualizando';
  const emptyMessage = options && options.emptyMessage ? String(options.emptyMessage) : 'No hay pedidos para actualizar.';
  const successSuffix = options && options.successSuffix ? String(options.successSuffix) : 'actualizados';
  if (!total){
    showToast(emptyMessage);
    return;
  }
  if (!confirm(progressLabel + ' ' + total + ' pedido(s)?')) return;

  const controls = [markAllSeenBtn_web, markAllPreparedBtn, refreshOrdersBtn_web, refreshPreparationsBtn].filter(Boolean);
  const previousLabels = new Map();
  controls.forEach((el) => {
    previousLabels.set(el, String(el.textContent || ''));
    el.disabled = true;
  });

  let successCount = 0;
  let failedCount = 0;
  try{
    for (let index = 0; index < orderIds.length; index += 1){
      if (button) button.textContent = progressLabel + ' ' + String(index + 1) + '/' + String(total);
      try{
        await patchOrderStatus(orderIds[index], targetStatus);
        successCount += 1;
      }catch(err){
        failedCount += 1;
        console.error('bulk status patch failed', { orderId: orderIds[index], targetStatus, err });
      }
    }
    try{ await refreshOrders('web'); }catch(_){ }
    try{ await refreshPreparations(true); }catch(_){ }
    if (failedCount){
      showToast('Listo: ' + successCount + '/' + total + ' ' + successSuffix + '. ' + failedCount + ' fallaron.', failedCount === total ? 'error' : 'warning');
    } else {
      showToast('Se marcaron ' + successCount + ' pedidos como ' + successSuffix + '.');
    }
  } finally {
    previousLabels.forEach((label, el) => {
      try{
        el.disabled = false;
        el.textContent = label;
      }catch(_){ }
    });
  }
}

function normalizeOrderCustomerType(value){
  const v = String(value || '').trim().toLowerCase();
  return v === 'minorista' ? 'minorista' : 'mayorista';
}

function normalizeOrderStatus(value){
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'recibido';
  const key = raw.replace(/[\s-]+/g, '_');
  const aliases = {
    nuevo: 'recibido',
    new: 'recibido',
    pendiente: 'recibido',
    pending: 'recibido',
    seen: 'visto',
    viewed: 'visto',
    preparando: 'preparado',
    preparing: 'preparado',
    prepared: 'preparado',
    en_camino: 'enviado',
    encamino: 'enviado',
    delivering: 'enviado',
    shipped: 'enviado',
    delivered: 'entregado',
    canceled: 'cancelado',
    cancelled: 'cancelado',
  };
  const norm = aliases[key] || key;
  const allowed = new Set(['recibido','visto','preparado','enviado','entregado','cancelado']);
  return allowed.has(norm) ? norm : 'recibido';
}

function orderStatusRank(value){
  const st = normalizeOrderStatus(value);
  const rank = { recibido: 1, visto: 2, preparado: 3, enviado: 4, entregado: 5, cancelado: 99 };
  return rank[st] || 0;
}

function formatOrderStatusLabel(value){
  const st = normalizeOrderStatus(value);
  const map = {
    recibido: 'Recibido',
    visto: 'Visto',
    preparado: 'Preparado',
    enviado: 'Enviado',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
  };
  return map[st] || st;
}

function buildOrderStepperHtml(statusValue){
  const st = normalizeOrderStatus(statusValue);
  const cur = orderStatusRank(st);
  const steps = [
    { key: 'recibido', label: 'Recibido' },
    { key: 'visto', label: 'Visto' },
    { key: 'preparado', label: 'Preparado' },
    { key: 'enviado', label: 'Enviado' },
    { key: 'entregado', label: 'Entregado' },
  ];
  return `
    <ol class="order-stepper" aria-label="Estado del pedido">
      ${steps.map((s) => {
        const r = orderStatusRank(s.key);
        const cls = r < cur ? 'is-done' : (r === cur ? 'is-current' : '');
        const aria = r === cur ? ' aria-current="step"' : '';
        return `<li class="order-step ${cls}"${aria}><span class="order-step-dot" aria-hidden="true"></span><span class="order-step-label">${escapeHtml(s.label)}</span></li>`;
      }).join('')}
    </ol>
  `;
}

function hasMeaningfulOrderValue(value){
  if (value === null || typeof value === 'undefined') return false;
  if (typeof value === 'string') return String(value).trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function mergeOrderRecord(existing, incoming){
  const prev = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const merged = Object.assign({}, prev, next);
  const keepIfIncomingMissing = [
    'items',
    'created_at',
    'total',
    'customer_type',
    'user_id',
    'user_full_name',
    'user_email',
    'user_barrio',
    'user_calle',
    'user_numeracion',
    'user_postal_code',
    'user_department',
    'user_address',
    'user_direccion',
    'user_lat',
    'user_lon',
    'delivery_address',
    'user_full_address',
    '_token_preview',
    '_token_received',
    'payment_method',
    'payment_status',
    'payment_reference',
    'scheduled_delivery_date',
    'delivery_cutoff_applied',
    'delivery_timezone',
    'delivery_cutoff_hour',
    'maps_url',
  ];
  keepIfIncomingMissing.forEach((field) => {
    if (!hasMeaningfulOrderValue(next[field]) && hasMeaningfulOrderValue(prev[field])){
      merged[field] = prev[field];
    }
  });
  return merged;
}

function applyOrdersCustomerTypeTabState(){
  try{
    const isMinorista = currentOrderCustomerType === 'minorista';
    if (ordersTypeTabMayorista) ordersTypeTabMayorista.classList.toggle('active', !isMinorista);
    if (ordersTypeTabMinorista) ordersTypeTabMinorista.classList.toggle('active', isMinorista);
  }catch(_){ }
}

function updateOrdersCustomerTypeBadges(list){
  try{
    const rows = Array.isArray(list) ? list : [];
    let mayoristaCount = 0;
    let minoristaCount = 0;
    rows.forEach((o) => {
      const t = normalizeOrderCustomerType(o && o.customer_type);
      if (t === 'minorista') minoristaCount += 1;
      else mayoristaCount += 1;
    });
    if (badgeTypeMayorista) badgeTypeMayorista.textContent = String(mayoristaCount);
    if (badgeTypeMinorista) badgeTypeMinorista.textContent = String(minoristaCount);
  }catch(_){ }
}

// source-filter buttons were removed to avoid duplication with the tab UI
// The clear cache control is available in the Orders tab UI (`clearOrderCache`).

// --- Filters (admin) ---
const filtersSection = document.getElementById('filters');
const filterNameInput = document.getElementById('filterName');
const addFilterBtn = document.getElementById('addFilterBtn');
const importFiltersBtn = document.getElementById('importFiltersBtn');
const filtersTableBody = document.querySelector('#filtersTable tbody');

async function fetchOrders(q = '', date = '', source = '', limit = ''){
  const params = new URLSearchParams();
  if(q) params.append('q', q);
  if(date) params.append('date', date);
  if(source) params.append('source', source);
  if(limit) params.append('limit', String(limit));
  const url = `${API_BASE}/orders` + (params.toString() ? ('?'+params.toString()) : '');
  try{
    // Prevent browser caching (304) from returning stale snapshots for orders
    const data = await safeFetch(url, { cache: 'no-store' }).catch(err => { console.warn('fetchOrders failed', err); return null; });
    if(data === null) return null;
    // Accept several payload shapes: array, { orders: [] }, { data: [] }
    let arr = null;
    if(Array.isArray(data)) arr = data;
    else if(data && Array.isArray(data.orders)) arr = data.orders;
    else if(data && Array.isArray(data.data)) arr = data.data;
    else if(data && Array.isArray(data.results)) arr = data.results;
    else { console.warn('fetchOrders: unexpected payload shape', data); return null; }
    try{ console.debug('[admin] fetchOrders returned ids', arr.slice(0,20).map(x=>x.id)); }catch(_){ }
    // If some orders lack user info, try fetching persisted token previews
    // from the server and merge them so admins always see contact info.
    try{
      const tpList = await safeFetch(API_BASE + '/debug/token-previews').catch(()=>null);
      if(Array.isArray(tpList) && tpList.length){
        const tpMap = {};
        tpList.forEach(t => { try{ if(t && t.order_id) tpMap[String(t.order_id)] = t.token_preview || null; }catch(_){ } });
        for(const o of (arr || [])){
          try{
            if((!o.user_full_name && !o.user_email) || !o._token_preview){
              const tp = tpMap[String(o.id)];
              if(tp){
                // prefer explicit fields if present in preview
                if(!o.user_full_name && (tp.name || tp.full_name)) o.user_full_name = tp.name || tp.full_name;
                if(!o.user_email && (tp.email || tp.sub)) o.user_email = tp.email || tp.sub;
                if(!o.user_barrio && tp.barrio) o.user_barrio = tp.barrio;
                if(!o.user_calle && tp.calle) o.user_calle = tp.calle;
                if(!o.user_numeracion && tp.numeracion) o.user_numeracion = tp.numeracion;
                if(!o.user_postal_code) o.user_postal_code = tp.postal_code || tp.user_postal_code || (tp.address && (tp.address.postal_code || tp.address.postcode)) || '';
                if(!o.user_department) o.user_department = tp.department || tp.user_department || (tp.address && tp.address.department) || '';
                const ctExisting = String(o.customer_type || '').trim().toLowerCase();
                if((ctExisting !== 'mayorista' && ctExisting !== 'minorista') && tp.customer_type){
                  const ctPreview = String(tp.customer_type || '').trim().toLowerCase();
                  if(ctPreview === 'mayorista' || ctPreview === 'minorista') o.customer_type = ctPreview;
                }
                if(!o._token_preview) o._token_preview = tp;
              }
            }
          }catch(_){ }
        }
      }
    }catch(e){ console.warn('Failed to fetch/merge token previews', e); }
    return arr;
  }catch(e){ console.warn('fetchOrders failed', e); return null; }
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

async function verifyServerHasOrder(id, attempts = 6, interval = 2000){
  try{
    for(let i=0;i<attempts;i++){
      try{
        const list = await fetchOrders(String(id));
        if(Array.isArray(list) && list.length > 0 && String(list[0].id) === String(id)){
          // server has it; decide whether to keep local token preview or mark fully synced
          try{
              const srv = list[0] || {};
              const hasUserInfo = !!(srv.user_full_name || srv.user_email || srv.user_id || (srv._token_preview && (srv._token_preview.email || srv._token_preview.name)) );
              // update pending state only in the Web table
              document.querySelectorAll('#ordersTable_web tbody tr').forEach(r => {
                try{
                  if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() !== String(id)) return;
                  const isLocal = r.getAttribute && r.getAttribute('data-local-insert');
                  // Si el pedido ya tiene created_at, limpiar caché local y estado pendiente
                  if (srv && srv.created_at) {
                    try { delete window.__localOrderRows[id]; window.__localOrderIds && window.__localOrderIds.delete(String(id)); saveLocalOrderCache && saveLocalOrderCache(); } catch(_){}
                    r.removeAttribute('data-local-insert');
                    r.classList.remove('pending-sync');
                    r.classList.remove('pending-sync-resolved');
                    return;
                  }
                  if(!!isLocal && !hasUserInfo){
                    r.setAttribute('data-local-insert','1');
                    r.classList.add('pending-sync');
                  } else {
                    if(hasUserInfo){
                      r.removeAttribute('data-local-insert');
                      r.classList.remove('pending-sync');
                      r.classList.remove('pending-sync-resolved');
                    } else {
                      r.setAttribute('data-local-insert','1');
                      r.classList.add('pending-sync');
                    }
                  }
                }catch(_){ }
              });
              // Si ya hay datos de usuario en servidor (o fecha persistida), limpiar cache local.
              try{
                const shouldDeleteLocal = !!hasUserInfo || !!(srv && srv.created_at);
                if(shouldDeleteLocal){ try{ delete window.__localOrderRows[id]; window.__localOrderIds.delete(String(id)); try{ saveLocalOrderCache(); }catch(_){ } }catch(_){ } }
              }catch(_){ }
              try{ console.debug('[admin] verifyServerHasOrder: server-confirmed', id, 'hasUserInfo=', hasUserInfo); }catch(_){ }
          }catch(_){ }
          return true;
        }
      }catch(e){ console.warn('verifyServerHasOrder fetch failed', id, e); }
      await sleep(interval);
    }
    // after attempts, leave pending but add a subtle visual note
    try{
      document.querySelectorAll('table[id^="ordersTable"] tbody tr').forEach(r => { if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === String(id)){ r.classList.add('pending-sync'); } });
      try{ console.warn('[admin] verifyServerHasOrder: could not confirm order on server after retries', id); }catch(_){ }
    }catch(_){ }
    return false;
  }catch(e){ console.error('verifyServerHasOrder unexpected error', e); return false; }
}

function safeParseItems(items){
  if(!items) return [];
  if(Array.isArray(items)) return items;
  try{ return JSON.parse(items); }catch(e){
    // fallback: if it's a comma-separated string, try to split
    if(typeof items === 'string') return items.split(',').map(s=>s.trim()).filter(Boolean);
    return [];
  }
}

function getOrderItemCode(it){
  try{
    if (!it || typeof it !== 'object') return '';
    const meta = (it.meta && typeof it.meta === 'object') ? it.meta : {};
    const fromMeta = normalizeProductCode(meta.code || meta.codigo);
    if (fromMeta) return fromMeta;
    const fromItem = normalizeProductCode(it.code || it.codigo);
    if (fromItem) return fromItem;
    const prod = getCachedProductById(it.id);
    if (prod) return normalizeProductCode(prod.code || prod.codigo);
    return '';
  }catch(_){ return ''; }
}

function renderOrderItemLabel(it){
  try{
    if(it === null || typeof it === 'undefined') return '';
    if(typeof it === 'string') return escapeHtml(it);
    const name = getOrderItemPlainName(it) || ((it && it.id) ? String(it.id) : '');
    const code = getOrderItemCode(it);
    const baseLabel = code ? `[${code}] ${name}` : name;
    const isConsumo = isOrderItemConsumo(it);
    const promoName = getOrderItemPromoName(it);
    let badges = '';
    if (isConsumo) {
      badges += ' <span style="margin-left:6px;padding:2px 6px;border-radius:999px;background:#fff1e6;border:1px solid rgba(242,107,56,0.25);color:#b45309;font-weight:700;font-size:11px;vertical-align:middle">Consumo inmediato</span>';
    }
    if (promoName) {
      badges += ' <span style="margin-left:6px;padding:2px 6px;border-radius:999px;background:#ecfeff;border:1px solid rgba(8,145,178,0.25);color:#0e7490;font-weight:700;font-size:11px;vertical-align:middle">Promo: ' + escapeHtml(promoName) + '</span>';
    }
    return `${escapeHtml(baseLabel)}${badges}`;
  }catch(_){
    return '';
  }
}

function formatKgQtyLabel(qty){
  try{
    const num = Number(qty);
    if (Number.isNaN(num)) return String(qty || '');
    const opts = [
      { value: 1, label: '1' },
      { value: 0.5, label: '1/2' },
      { value: 1/3, label: '1/3' },
      { value: 0.25, label: '1/4' }
    ];
    const match = opts.find(o => Math.abs(o.value - num) < 0.0001);
    if (match) return match.label;
    return String(parseFloat(num.toFixed(3)));
  }catch(_){ return String(qty || ''); }
}

function formatOrderQty(it){
  try{
    const qty = (it && typeof it.qty !== 'undefined') ? it.qty : 1;
    const meta = (it && it.meta && typeof it.meta === 'object') ? it.meta : {};
    const unit = String(meta.unit_type || meta.sale_unit || meta.unit || '').toLowerCase();
    if (unit === 'kg' || unit === 'kilo' || unit === 'kilos' || unit === 'kilogram' || unit === 'kilograms' || unit === 'kilogramo' || unit === 'kilogramos'){
      const base = meta.qty_label ? String(meta.qty_label) : formatKgQtyLabel(qty);
      let weight = Number(meta.ordered_weight_kg);
      if (!Number.isFinite(weight) || weight <= 0) {
        const kpu = Number(meta.kg_per_unit || 0);
        weight = (Number.isFinite(kpu) && kpu > 0) ? Number(qty || 0) * kpu : 0;
      }
      if (Number.isFinite(weight) && weight > 0) return `${base} (${parseFloat(weight.toFixed(3))} kg)`;
      return base;
    }
    return String(qty);
  }catch(_){
    return '1';
  }
}

function isOrderItemConsumo(it){
  try{
    if(!it || typeof it !== 'object') return false;
    const forceRegular = !!(it && it.meta && it.meta.force_regular);
    if(forceRegular) return false;
    const meta = it.meta && typeof it.meta === 'object' ? it.meta : {};
    const key = String((it && it.key) || (meta && meta.key) || '');
    if (meta && (meta.consumo === true || meta.consumo_consumed > 0 || meta.consumo_id || meta.discount_type || meta.discount_value || meta.discount_label)) return true;
    if (typeof it.consumo !== 'undefined') return !!it.consumo;
    if (typeof it.consumo_id !== 'undefined') return !!it.consumo_id;
    return key.includes(':consumo');
  }catch(_){
    return false;
  }
}

function getOrderItemPromoName(it){
  try{
    if(!it || typeof it !== 'object') return '';
    const meta = (it.meta && typeof it.meta === 'object') ? it.meta : {};
    const explicit = String(meta.promo_name || meta.promotion_name || '').trim();
    if (explicit) return explicit;
    const idStr = String(it.id || '').toLowerCase();
    if (meta.is_promo || idStr.startsWith('promo:')) {
      const fallback = String(meta.name || '').trim();
      return fallback;
    }
    return '';
  }catch(_){
    return '';
  }
}

function normalizeOrderPaymentMethod(method){
  const raw = String(method || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'mercadopago' || raw === 'mp' || raw === 'mercado_pago') return 'mercadopago';
  if (raw === 'cash' || raw === 'efectivo') return 'cash';
  return raw;
}

function formatOrderPaymentMethod(order){
  try{
    const method = normalizeOrderPaymentMethod(order && order.payment_method);
    if (method === 'mercadopago') return 'Mercado Pago';
    if (method === 'cash') return 'Efectivo';
    return order && order.payment_method ? String(order.payment_method) : '';
  }catch(_){
    return '—';
  }
}

function formatOrderPaymentStatus(order){
  try{
    const status = String((order && order.payment_status) || '').trim().toLowerCase();
    if (!status) return '';
    const labels = {
      mp_pending: 'pendiente',
      cash_pending: 'a cobrar',
      approved: 'aprobado',
      rejected: 'rechazado',
      cancelled: 'cancelado',
      refunded: 'reintegrado',
      in_process: 'en proceso'
    };
    return labels[status] || status;
  }catch(_){
    return '';
  }
}

const DEFAULT_ORDER_CUTOFF_HOUR = 18;
const PREPARATIONS_ITEMS_PREVIEW_LIMIT = 4;

function normalizeIsoDateKey(value){
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3];
}

function getTomorrowIsoDateKey(){
  try{
    const dt = new Date();
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() + 1);
    return [
      dt.getFullYear(),
      String(dt.getMonth() + 1).padStart(2, '0'),
      String(dt.getDate()).padStart(2, '0'),
    ].join('-');
  }catch(_){ return ''; }
}

function formatIsoDateKeyWithWeekday(value){
  const key = normalizeIsoDateKey(value);
  if (!key) return '';
  try{
    const parts = key.split('-');
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(dt.getTime())) return key;
    const weekday = dt.toLocaleDateString('es-AR', { weekday: 'long' });
    const dmy = dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1) + ' ' + dmy;
  }catch(_){ return key; }
}

function normalizeOrderCutoffHour(rawValue, fallbackValue = DEFAULT_ORDER_CUTOFF_HOUR){
  try{
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return fallbackValue;
    if (parsed < 0) return 0;
    if (parsed > 23) return 23;
    return Math.trunc(parsed);
  }catch(_){ return fallbackValue; }
}

function isOrderCutoffApplied(rawValue){
  if (rawValue === true) return true;
  const normalized = String(rawValue || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

function addDaysToIsoDateKey(dateKey, daysToAdd){
  const key = normalizeIsoDateKey(dateKey);
  if (!key) return '';
  try{
    const parts = key.split('-');
    const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    if (isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + Number(daysToAdd || 0));
    return [
      dt.getUTCFullYear(),
      String(dt.getUTCMonth() + 1).padStart(2, '0'),
      String(dt.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }catch(_){ return ''; }
}

function getDatePartsForTimeZone(dateObj, timeZone){
  try{
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: String(timeZone || ''),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(dateObj);
    const out = {};
    parts.forEach((p) => {
      if (!p || !p.type) return;
      if (p.type === 'year' || p.type === 'month' || p.type === 'day' || p.type === 'hour' || p.type === 'minute'){
        out[p.type] = Number(p.value);
      }
    });
    if (!Number.isFinite(out.year) || !Number.isFinite(out.month) || !Number.isFinite(out.day)) return null;
    if (!Number.isFinite(out.hour)) out.hour = 0;
    if (!Number.isFinite(out.minute)) out.minute = 0;
    return out;
  }catch(_){ return null; }
}

function resolveOrderScheduleInfo(order){
  const cutoffHour = normalizeOrderCutoffHour(order && order.delivery_cutoff_hour, DEFAULT_ORDER_CUTOFF_HOUR);
  const explicitDateKey = normalizeIsoDateKey(order && order.scheduled_delivery_date);
  if (explicitDateKey){
    return {
      dateKey: explicitDateKey,
      cutoffApplied: isOrderCutoffApplied(order && order.delivery_cutoff_applied),
      cutoffHour,
    };
  }
  try{
    const rawCreated = order && order.created_at ? new Date(String(order.created_at)) : null;
    if (!rawCreated || isNaN(rawCreated.getTime())){
      return { dateKey: '', cutoffApplied: false, cutoffHour };
    }
    const tzName = String((order && order.delivery_timezone) || 'America/Argentina/Buenos_Aires').trim() || 'America/Argentina/Buenos_Aires';
    const localParts = getDatePartsForTimeZone(rawCreated, tzName);
    if (!localParts){
      return { dateKey: '', cutoffApplied: false, cutoffHour };
    }
    const baseDateKey = [
      String(localParts.year).padStart(4, '0'),
      String(localParts.month).padStart(2, '0'),
      String(localParts.day).padStart(2, '0'),
    ].join('-');
    const cutoffApplied = Number(localParts.hour || 0) >= cutoffHour;
    const resolvedDateKey = addDaysToIsoDateKey(baseDateKey, cutoffApplied ? 2 : 1);
    return {
      dateKey: resolvedDateKey,
      cutoffApplied,
      cutoffHour,
    };
  }catch(_){
    return { dateKey: '', cutoffApplied: false, cutoffHour };
  }
}

function formatScheduleInfoLabel(scheduleInfo){
  try{
    const dateKey = normalizeIsoDateKey(scheduleInfo && scheduleInfo.dateKey);
    if (!dateKey) return '';
    const label = formatIsoDateKeyWithWeekday(dateKey);
    if (!label) return '';
    const cutoffHour = normalizeOrderCutoffHour(scheduleInfo && scheduleInfo.cutoffHour, DEFAULT_ORDER_CUTOFF_HOUR);
    if (scheduleInfo && scheduleInfo.cutoffApplied){
      return label + ' (pedido despues de las ' + String(cutoffHour).padStart(2, '0') + ':00)';
    }
    return label;
  }catch(_){ return ''; }
}

function formatOrderScheduledDelivery(order){
  return formatScheduleInfoLabel(resolveOrderScheduleInfo(order));
}

function findOrderRowById(id){
  try{ return Array.from(document.querySelectorAll('table[id^="ordersTable"] tbody tr')).find(r => String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === String(id)); }catch(e){ return null; }
}
// Lookback window (in days) used to hide very old orders from the UI by default
const ORDERS_LOOKBACK_DAYS = 30;

function renderOrders(list, source, dateFilter){
  const tableId = `ordersTable_${source}`;
  const ordersTableBody = document.querySelector(`#${tableId} tbody`);
  if(!ordersTableBody) return;
  try{ console.debug('[admin] renderOrders called (rebuild)', { count: Array.isArray(list)?list.length:0, source }); }catch(_){ }
  ordersTableBody.innerHTML = '';
  if(!list || list.length === 0){
    const emptyRow = document.createElement('tr'); emptyRow.innerHTML = `<td colspan="8" class="empty-note">No hay pedidos. Si esperas ver pedidos, prueba el botón "Probar evento WS" o crea uno desde el frontend.</td>`;
    ordersTableBody.appendChild(emptyRow);
    try{ updateBadgeCount(source); }catch(_){ }
    return;
  }

  // El panel de pedidos ahora es solo Web.
  try{
    list = (list || []).filter(o => {
      const osrc = (o && typeof o.source !== 'undefined' && o.source !== null && String(o.source).trim() !== '') ? String(o.source) : 'web';
      return String(osrc).toLowerCase() === 'web';
    });
  }catch(_){ }
  try{
    const activeSearch = orderSearch_web && orderSearch_web.value ? String(orderSearch_web.value).trim() : '';
    const shouldFilterByType = !activeSearch;
    if (shouldFilterByType){
      const selectedType = normalizeOrderCustomerType(currentOrderCustomerType);
      list = (list || []).filter(o => normalizeOrderCustomerType(o && o.customer_type) === selectedType);
    }
  }catch(_){ }
  // Agrupar por día y deduplicar por id (siempre mostrar solo una vez por tabla)
  const groups = new Map();
  const seenIds = new Set();
  for(const o of (list || [])){
    try{
      const id = String(o.id);
      if(seenIds.has(id)) continue;
      seenIds.add(id);
      const d = o.created_at ? new Date(String(o.created_at)) : new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }catch(_){ if(!groups.has('unknown')) groups.set('unknown', []); groups.get('unknown').push(o); }
  }

  // Sort keys descending (newest first)
  const sortedKeys = Array.from(groups.keys()).sort((a,b)=> a<b?1:-1);

  for(const key of sortedKeys){
    const items = groups.get(key) || [];
    // header
    try{
      const hdr = document.createElement('tr'); hdr.className = 'orders-day-header'; hdr.setAttribute('data-day', key);
      const hdrLabel = document.createElement('td'); hdrLabel.setAttribute('colspan','8');
      const parts = key.split('-'); const lab = new Date(Number(parts[0])||0, Number(parts[1]) - 1 || 0, Number(parts[2])||0);
      const dayText = isNaN(lab.getTime()) ? 'Sin fecha' : lab.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
      hdrLabel.innerHTML = `<div class="day-label">${escapeHtml(dayText)} <span class="badge-pill">${items.length}</span></div>`;
      hdr.appendChild(hdrLabel);
      ordersTableBody.appendChild(hdr);
    }catch(_){ }

    // sort items newest first within day
    try{ items.sort((a,b)=> (new Date(String(b.created_at))).getTime() - (new Date(String(a.created_at))).getTime()); }catch(_){ }

    for(const o of items){
      try{
        const tr = orderRowFor(o);
        if(tr){
          tr.setAttribute('data-source', String(o.source || source));
          tr.setAttribute('data-customer-type', normalizeOrderCustomerType(o && o.customer_type));
        }
        ordersTableBody.appendChild(tr);
      }catch(_){ }
    }
  }

  // Restaurar solo filas locales cuyo source sea exactamente el de la pestaña
  try{
    window.__localOrderRows = window.__localOrderRows || {};
    for(const lid of Object.keys(window.__localOrderRows)){
      try{
        const rec = window.__localOrderRows[lid];
        if(!rec || !rec.payload) continue;
        const recSource = String((rec.payload.source||'web')).toLowerCase();
        if(recSource !== 'web') continue;
        const recCustomerType = normalizeOrderCustomerType(rec.payload.customer_type);
        if(recCustomerType !== normalizeOrderCustomerType(currentOrderCustomerType)) continue;
        const ageOk = (Date.now() - (rec.ts||0)) < (1000*60*60*24);
        const hasUserInfo = !!(rec.payload.user_full_name || rec.payload.user_email || (rec.payload._token_preview && (rec.payload._token_preview.name || rec.payload._token_preview.email)));
        const isPending = !!rec.pending || !(rec.payload && rec.payload.created_at);
        if(!(isPending || hasUserInfo || ageOk)) { delete window.__localOrderRows[lid]; continue; }
        if(findOrderRowById(lid)) continue;
        const temp = document.createElement('tbody'); temp.innerHTML = rec.html || rec;
        const newTr = temp.querySelector('tr'); if(newTr) ordersTableBody.insertBefore(newTr, ordersTableBody.firstChild);
      }catch(_){ }
    }
    try{ saveLocalOrderCache(); }catch(_){ }
  }catch(_){ }

  updateBadgeCount(source);

  // wire buttons after rendering
  document.querySelectorAll('.viewOrderBtn').forEach(el => el.onclick = async (ev) => { const id = ev.target.dataset.id; const list = await fetchOrders(String(id)); const order = (list || []).find(x => String(x.id) === String(id)) || (list && list[0]); if(order) showOrderDetail(order); });
  document.querySelectorAll('.markSeenBtn').forEach(el => el.addEventListener('click', async (ev) => {
    const btn = el;
    const id = btn && btn.dataset ? btn.dataset.id : null;
    if(!id) return;
    let row = null;
    try{ row = (btn && btn.closest) ? btn.closest('tr') : null; }catch(_){ }
    if(!row) try{ row = findOrderRowById(id); }catch(_){ }

    const currentStatus = normalizeOrderStatus((row && row.dataset ? row.dataset.status : '') || '');
    if (orderStatusRank(currentStatus) >= orderStatusRank('visto')){
      showToast('Este pedido ya está marcado (estado: ' + formatOrderStatusLabel(currentStatus) + ')');
      return;
    }

    const targetStatus = 'visto';
    const oldBtnText = btn && btn.textContent ? btn.textContent : '';
    try{ if(btn){ btn.textContent = 'Marcando...'; btn.classList.add('updating'); } if(row) row.classList.add('updating'); }catch(_){ }
    try{ if(btn) btn.disabled = true; }catch(_){ }
    try{
      const updated = await safeFetch(API_BASE + '/orders/' + encodeURIComponent(id) + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: targetStatus }) });
      try{
        if(row && row.dataset){
          row.dataset.status = normalizeOrderStatus(updated && updated.status);
        }
      }catch(_){ }
      if(document.getElementById('orderModal') && document.getElementById('orderModal').classList.contains('hidden')===false) try{ showOrderDetail(updated); }catch(_){ }
      try{
        const uid = String((updated && updated.id) || id);
        lastPreparationsBase = (lastPreparationsBase || []).map((entry) => String(entry && entry.id) === uid ? mergeOrderRecord(entry, updated) : entry);
        if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
      }catch(_){ }
      try{ await refreshOrders('web'); }catch(_){ }
      if (String((updated && updated.status) || targetStatus).toLowerCase() === 'visto') showToast('Pedido marcado como visto y movido a Preparaciones');
      else showToast('Pedido actualizado');
    }catch(e){
      console.error('mark seen failed', e);
      try{ if(btn) btn.textContent = oldBtnText; }catch(_){ }
      const msg = (e && e.status === 409 && e.payload && e.payload.current)
        ? ('No se puede volver atrás (actual: ' + formatOrderStatusLabel(e.payload.current) + ').')
        : 'No se pudo actualizar estado';
      showToast(msg, 'error');
    } finally {
      try{ if(btn) btn.classList.remove('updating'); if(row) row.classList.remove('updating'); }catch(_){ }
      try{ if(btn) btn.disabled = false; }catch(_){ }
    }
  }));

  document.querySelectorAll('.markPreparedBtn').forEach(el => el.addEventListener('click', async (ev) => {
    const btn = el;
    const id = btn && btn.dataset ? btn.dataset.id : null;
    if (!id) return;
    let row = null;
    try{ row = (btn && btn.closest) ? btn.closest('tr') : null; }catch(_){ }
    if (!row) try{ row = findOrderRowById(id); }catch(_){ }

    const currentStatus = normalizeOrderStatus((row && row.dataset ? row.dataset.status : '') || '');
    if (orderStatusRank(currentStatus) >= orderStatusRank('preparado')){
      showToast('Este pedido ya está marcado (estado: ' + formatOrderStatusLabel(currentStatus) + ')');
      return;
    }
    if (orderStatusRank(currentStatus) < orderStatusRank('visto')){
      showToast('Primero marcá el pedido como visto.');
      return;
    }

    const targetStatus = 'preparado';
    const oldBtnText = btn && btn.textContent ? btn.textContent : '';
    try{ if (btn){ btn.textContent = 'Guardando...'; btn.classList.add('updating'); } if (row) row.classList.add('updating'); }catch(_){ }
    try{ if (btn) btn.disabled = true; }catch(_){ }
    try{
      const updated = await safeFetch(API_BASE + '/orders/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus })
      });
      try{
        if (row && row.dataset){
          row.dataset.status = normalizeOrderStatus(updated && updated.status);
        }
      }catch(_){ }
      if (document.getElementById('orderModal') && document.getElementById('orderModal').classList.contains('hidden') === false) {
        try{ showOrderDetail(updated); }catch(_){ }
      }
      try{
        const uid = String((updated && updated.id) || id);
        let replacedInPreparations = false;
        lastPreparationsBase = (lastPreparationsBase || []).map((entry) => {
          if (String(entry && entry.id) === uid){
            replacedInPreparations = true;
            return mergeOrderRecord(entry, updated);
          }
          return entry;
        });
        if (!replacedInPreparations && updated && updated.id != null){
          lastPreparationsBase = [updated, ...(lastPreparationsBase || [])];
        }
        let replacedInOrders = false;
        lastOrdersBaseWeb = (lastOrdersBaseWeb || []).map((entry) => {
          if (String(entry && entry.id) === uid){
            replacedInOrders = true;
            return mergeOrderRecord(entry, updated);
          }
          return entry;
        });
        if (!replacedInOrders && updated && updated.id != null){
          lastOrdersBaseWeb = [updated, ...(lastOrdersBaseWeb || [])];
        }
        if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
      }catch(_){ }
      try{ await refreshOrders('web'); }catch(_){ }
      if (String((updated && updated.status) || targetStatus).toLowerCase() === 'preparado') showToast('Pedido marcado como preparado');
      else showToast('Pedido actualizado');
    }catch(e){
      console.error('mark prepared failed', e);
      try{ if (btn) btn.textContent = oldBtnText; }catch(_){ }
      const msg = (e && e.status === 409 && e.payload && e.payload.current)
        ? ('No se puede volver atrás (actual: ' + formatOrderStatusLabel(e.payload.current) + ').')
        : 'No se pudo actualizar estado';
      showToast(msg, 'error');
    } finally {
      try{ if (btn) btn.classList.remove('updating'); if (row) row.classList.remove('updating'); }catch(_){ }
      try{ if (btn) btn.disabled = false; }catch(_){ }
    }
  }));
}

function isWebOrderEntry(order){
  try{
    const src = (order && typeof order.source !== 'undefined' && order.source !== null && String(order.source).trim() !== '')
      ? String(order.source)
      : 'web';
    return String(src).toLowerCase() === 'web';
  }catch(_){ return true; }
}

function isPreparationsSectionActive(){
  try{
    const section = document.getElementById('preparations');
    return !!(section && !section.classList.contains('hidden'));
  }catch(_){ return false; }
}

function getOrderDisplayName(order){
  try{
    const previewName = order && order._token_preview && (order._token_preview.name || order._token_preview.email)
      ? (order._token_preview.name || order._token_preview.email)
      : null;
    const displayName = (order && (order.user_full_name || previewName || order.user_email)) || '';
    if (!displayName && order && order.user_id) return '#' + String(order.user_id);
    if (order && order.user_email && displayName && displayName !== order.user_email){
      return displayName + ' / ' + order.user_email;
    }
    return displayName || '—';
  }catch(_){ return '—'; }
}

function getOrderPrimaryName(order){
  try{
    const previewName = order && order._token_preview && order._token_preview.name
      ? String(order._token_preview.name).trim()
      : '';
    const explicitName = order && order.user_full_name ? String(order.user_full_name).trim() : '';
    if (explicitName) return explicitName;
    if (previewName) return previewName;
    if (order && order.user_id) return '#' + String(order.user_id);
    if (order && order.user_email) return String(order.user_email).trim();
    return '—';
  }catch(_){ return '—'; }
}

function getOrderEmail(order){
  try{
    const previewEmail = order && order._token_preview && order._token_preview.email
      ? String(order._token_preview.email).trim()
      : '';
    const explicitEmail = order && order.user_email ? String(order.user_email).trim() : '';
    return explicitEmail || previewEmail || '—';
  }catch(_){ return '—'; }
}

function getOrderAddressSnapshot(order){
  try{
    const orderId = order && order.id != null ? String(order.id) : '';
    const tokenPreview = order && order._token_preview && typeof order._token_preview === 'object'
      ? order._token_preview
      : {};
    const nestedAddress = tokenPreview && tokenPreview.address && typeof tokenPreview.address === 'object'
      ? tokenPreview.address
      : {};
    const barrio = (order && (order.user_barrio || order.barrio || order.user_neighborhood)) ||
      tokenPreview.barrio || nestedAddress.barrio || tokenPreview.neighborhood || nestedAddress.neighborhood || tokenPreview.city || nestedAddress.city || '';
    const calle = (order && (order.user_calle || order.calle || order.user_street)) ||
      tokenPreview.calle || nestedAddress.calle || tokenPreview.street || nestedAddress.street || nestedAddress.road || '';
    const numeracion = (order && (order.user_numeracion || order.numeracion || order.user_number)) ||
      tokenPreview.numeracion || nestedAddress.numeracion || tokenPreview.number || nestedAddress.number || nestedAddress.house_number || '';
    const rawAddress = (order && (
      order.user_address ||
      order.user_direccion ||
      order.delivery_address ||
      order.shipping_address ||
      order.address ||
      order.user_full_address ||
      order.full_address ||
      order.direccion
    )) ||
      tokenPreview.user_address ||
      tokenPreview.direccion ||
      tokenPreview.query_hint ||
      tokenPreview.full_text ||
      tokenPreview.label ||
      nestedAddress.direccion ||
      nestedAddress.query_hint ||
      nestedAddress.full_text ||
      nestedAddress.display_name ||
      '';
    let postalFromMapsUrl = '';
    try{
      const mapsUrl = String(order && order.maps_url || '').trim();
      if (mapsUrl){
        const parsedMapsUrl = new URL(mapsUrl);
        const mapsQuery = String(parsedMapsUrl.searchParams.get('query') || '').trim();
        const decodedMapsQuery = decodeURIComponent(mapsQuery || '');
        const mapsMatch = decodedMapsQuery.match(/\bM?\d{4}\b/i);
        if (mapsMatch) postalFromMapsUrl = mapsMatch[0];
      }
    }catch(_){ postalFromMapsUrl = ''; }
    const postalMatchRaw = String(rawAddress || '').match(/\bM?\d{4}\b/i);
    const postalCode = normalizeOrderPostalCode(
      (order && (order.user_postal_code || order.postal_code || order.postcode || order.zip_code || order.zip)) ||
      (tokenPreview && (tokenPreview.postal_code || tokenPreview.user_postal_code || tokenPreview.postcode || tokenPreview.zip_code || tokenPreview.zip)) ||
      (nestedAddress && (nestedAddress.postal_code || nestedAddress.postcode || nestedAddress.zip_code || nestedAddress.zip)) ||
      postalFromMapsUrl ||
      (postalMatchRaw ? postalMatchRaw[0] : '')
    );
    const department = String(
      (order && (order.user_department || order.department)) ||
      (tokenPreview && (tokenPreview.department || tokenPreview.user_department)) ||
      (nestedAddress && (nestedAddress.department || nestedAddress.county || nestedAddress.state_district)) ||
      ''
    ).trim();
    const latCandidates = [
      order && (order.user_lat || order.user_latitude || order.delivery_lat || order.lat),
      tokenPreview && (tokenPreview.user_lat || tokenPreview.lat || tokenPreview.latitude || tokenPreview.delivery_lat),
      nestedAddress && (nestedAddress.lat || nestedAddress.latitude)
    ];
    const lonCandidates = [
      order && (order.user_lon || order.user_lng || order.user_longitude || order.delivery_lon || order.delivery_lng || order.lon || order.lng),
      tokenPreview && (tokenPreview.user_lon || tokenPreview.user_lng || tokenPreview.lon || tokenPreview.lng || tokenPreview.longitude || tokenPreview.delivery_lon || tokenPreview.delivery_lng),
      nestedAddress && (nestedAddress.lon || nestedAddress.lng || nestedAddress.longitude)
    ];
    let lat = null;
    let lon = null;
    for (const candidate of latCandidates){
      const n = Number(candidate);
      if (Number.isFinite(n)){ lat = Number(n.toFixed(6)); break; }
    }
    for (const candidate of lonCandidates){
      const n = Number(candidate);
      if (Number.isFinite(n)){ lon = Number(n.toFixed(6)); break; }
    }
    const addressKey = buildOrderAddressCacheKeyFromSnapshot({
      barrio,
      calle,
      numeracion,
      rawAddress,
      postalCode,
      department,
    });
    return {
      barrio: String(barrio || '').trim(),
      calle: String(calle || '').trim(),
      numeracion: String(numeracion || '').trim(),
      rawAddress: String(rawAddress || '').trim(),
      postalCode: String(postalCode || '').trim(),
      department: String(department || '').trim(),
      lat,
      lon,
      orderId,
      addressKey,
    };
  }catch(_){
    return { barrio: '', calle: '', numeracion: '', rawAddress: '', postalCode: '', department: '', lat: null, lon: null, orderId: '', addressKey: '' };
  }
}

function getOrderAddress(order){
  try{
    const addr = getOrderAddressSnapshot(order);
    const street = [addr.calle, addr.numeracion].filter((p) => String(p || '').trim()).join(' ').trim();
    let displayPostal = String(addr.postalCode || '').trim();
    if (displayPostal && addr.department && !orderPostalMatchesDepartment(displayPostal, addr.department)){
      displayPostal = '';
    }
    const parts = [street, addr.barrio, addr.department, displayPostal].filter((p) => String(p || '').trim());
    if (parts.length) return parts.join(', ');
    if (String(addr.rawAddress || '').trim()) return String(addr.rawAddress).trim();
    return '—';
  }catch(_){ return '—'; }
}

function getOrderDeliveryNotes(order){
  try{
    const rawOrder = order && typeof order === 'object' ? order : {};
    const parseObject = (value) => {
      if (value && typeof value === 'object') return value;
      if (typeof value === 'string'){
        try{
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object') return parsed;
        }catch(_){ }
      }
      return {};
    };
    const tokenPreview = parseObject(rawOrder._token_preview);
    const nestedAddress = parseObject(tokenPreview.address);
    const directAddress = parseObject(rawOrder.address);
    const normalizeNote = (value) => {
      if (value === null || typeof value === 'undefined') return '';
      let out = '';
      if (typeof value === 'string') out = value;
      else if (typeof value === 'number' || typeof value === 'boolean') out = String(value);
      else return '';
      out = out.replace(/\s+/g, ' ').trim();
      const lower = out.toLowerCase();
      if (!out || lower === 'null' || lower === 'undefined' || out === '-') return '';
      return out;
    };
    const candidates = [
      rawOrder.user_delivery_notes,
      rawOrder.delivery_notes,
      rawOrder.user_address_notes,
      rawOrder.instructions,
      rawOrder.instrucciones,
      rawOrder.notes,
      tokenPreview.delivery_notes,
      tokenPreview.user_delivery_notes,
      tokenPreview.instructions,
      tokenPreview.instrucciones,
      tokenPreview.notes,
      nestedAddress.delivery_notes,
      nestedAddress.user_delivery_notes,
      nestedAddress.instructions,
      nestedAddress.instrucciones,
      nestedAddress.notes,
      directAddress.delivery_notes,
      directAddress.user_delivery_notes,
      directAddress.instructions,
      directAddress.instrucciones,
      directAddress.notes,
    ];
    for (const candidate of candidates){
      const note = normalizeNote(candidate);
      if (note) return note;
    }
    return '';
  }catch(_){ return ''; }
}

function buildOrderGoogleMapsUrl(order){
  try{
    const addr = getOrderAddressSnapshot(order);
    const parseCoord = (value) => {
      if (value === null || typeof value === 'undefined') return NaN;
      if (typeof value === 'string'){
        const normalized = value.trim().replace(',', '.');
        return Number(normalized);
      }
      return Number(value);
    };
    const lat = parseCoord(addr.lat);
    const lon = parseCoord(addr.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && isMendozaPoint(lat, lon)){
      const q = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    }
    const cachedCoords = getCachedOrderCoords(addr.orderId, addr.addressKey);
    if (cachedCoords && isMendozaPoint(cachedCoords.lat, cachedCoords.lon)){
      const q = `${Number(cachedCoords.lat).toFixed(6)},${Number(cachedCoords.lon).toFixed(6)}`;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    }

    const query = buildOrderGeocodeQueryFromSnapshot(addr);
    if (query){
      queueOrderCoordsResolution(order, addr);
    }

    const backendMapsUrl = String(order && order.maps_url || '').trim();
    if (backendMapsUrl){
      const lower = backendMapsUrl.toLowerCase();
      const isGoogleMaps = lower.startsWith('https://www.google.com/maps/') || lower.startsWith('https://maps.google.com/');
      const backendHasCoords = (() => {
        if (!isGoogleMaps) return false;
        try{
          const parsed = new URL(backendMapsUrl);
          const probe = [
            parsed.searchParams.get('query'),
            parsed.searchParams.get('q'),
            parsed.searchParams.get('ll'),
            parsed.searchParams.get('center'),
            decodeURIComponent(parsed.pathname || '')
          ].filter(Boolean).join(' ');
          return /-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?/.test(probe);
        }catch(_){ return false; }
      })();
      if (backendHasCoords){
        return backendMapsUrl;
      }
      if (isGoogleMaps && !query){
        return backendMapsUrl;
      }
    }
    if (query){
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
    }
    return '';
  }catch(_){ return ''; }
}

function getOrderGoogleMapsLinkHtml(order, label = 'Abrir en Google Maps', className = ''){
  try{
    const url = buildOrderGoogleMapsUrl(order);
    if (!url){
      const addr = getOrderAddressSnapshot(order);
      const hasAddress = !!String([addr.calle, addr.numeracion, addr.barrio, addr.rawAddress].filter(Boolean).join(' ')).trim();
      return hasAddress ? '<span class="order-map-pending">Resolviendo ubicacion...</span>' : '';
    }
    const extraClass = String(className || '').trim();
    const classes = ['btn', 'small', 'order-map-link'];
    if (extraClass) classes.push(extraClass);
    return `<a class="${escapeHtml(classes.join(' '))}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }catch(_){ return ''; }
}

function getOrderGoogleMapsUrlHtml(order, className = ''){
  return '';
}

function getOrderCreatedTimestamp(order){
  try{
    if (!order || !order.created_at) return 0;
    const ts = new Date(String(order.created_at)).getTime();
    return isNaN(ts) ? 0 : ts;
  }catch(_){ return 0; }
}

function getOrderCreatedAtLabel(order){
  try{
    if (!order || !order.created_at) return 'Sin fecha de pedido';
    const dt = new Date(String(order.created_at));
    if (isNaN(dt.getTime())) return 'Sin fecha de pedido';
    return dt.toLocaleString('es-AR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }catch(_){ return 'Sin fecha de pedido'; }
}

function getOrderItemPlainName(it){
  try{
    if (!it) return '';
    if (typeof it === 'string') return String(it).trim();
    const meta = it && it.meta && typeof it.meta === 'object' ? it.meta : {};
    const explicit = String(meta.name || '').trim();
    if (explicit) return explicit;
    const prod = getCachedProductById(it.id);
    if (prod) {
      const cachedName = String((prod && (prod.name || prod.nombre)) || '').trim();
      if (cachedName) return cachedName;
    }
    return String(it.id || '').trim();
  }catch(_){ return ''; }
}

function getOrderItemSummaryLabel(it){
  try{
    const name = getOrderItemPlainName(it) || 'Item';
    const code = getOrderItemCode(it);
    return code ? `[${code}] ${name}` : name;
  }catch(_){ return 'Item'; }
}

function getOrderItemsSummary(order){
  try{
    const itemsArr = safeParseItems(order && order.items ? order.items : []);
    if (!Array.isArray(itemsArr) || itemsArr.length === 0) return 'Sin items';
    const labels = itemsArr.map((it) => {
      const name = getOrderItemSummaryLabel(it);
      const qty = formatOrderQty(it);
      return name + ' x' + qty;
    });
    if (labels.length <= 3) return labels.join(' · ');
    return labels.slice(0, 3).join(' · ') + ' · +' + String(labels.length - 3) + ' más';
  }catch(_){ return 'Sin items'; }
}

function ensureCustomersMonthDefault(){
  if (!customersMonthInput) return;
  if (customersMonthInput.value) return;
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  customersMonthInput.value = `${now.getFullYear()}-${mm}`;
}

function getMonthRangeFromInput(value){
  const raw = String(value || '').trim();
  let year = 0;
  let monthIndex = 0;
  if (/^\d{4}-\d{2}$/.test(raw)){
    const parts = raw.split('-');
    year = Number(parts[0]);
    monthIndex = Math.max(0, Math.min(11, Number(parts[1]) - 1));
  } else {
    const now = new Date();
    year = now.getFullYear();
    monthIndex = now.getMonth();
  }
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
  const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  let label = '';
  try{
    label = start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }catch(_){
    label = key;
  }
  return { start, end, key, label };
}

function getOrderTotalValue(order){
  try{
    const raw = order && (order.total ?? order.total_amount ?? order.amount ?? order.price_total);
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  }catch(_){ return 0; }
}

function getCustomerIdentity(order){
  const nameRaw = getOrderPrimaryName(order);
  const emailRaw = getOrderEmail(order);
  const userIdRaw = order && order.user_id ? String(order.user_id).trim() : '';
  const name = (nameRaw && nameRaw !== '—') ? String(nameRaw).trim() : '';
  const email = (emailRaw && emailRaw !== '—') ? String(emailRaw).trim() : '';
  const isAnonymous = !userIdRaw && !email && !name;
  const displayName = name || 'Cliente sin identificar';
  let key = '';
  if (userIdRaw) key = `id:${userIdRaw}`;
  else if (email) key = `email:${email.toLowerCase()}`;
  else if (name) key = `name:${name.toLowerCase()}`;
  else key = `anon:${String(order && order.id || Math.random())}`;
  return { key, name: displayName, email, isAnonymous };
}

function getOrderItemQtyNumber(it){
  try{
    if (!it || typeof it !== 'object') return 1;
    const meta = (it.meta && typeof it.meta === 'object') ? it.meta : {};
    const raw = (typeof it.qty !== 'undefined') ? it.qty
      : (typeof it.cantidad !== 'undefined') ? it.cantidad
      : (typeof it.quantity !== 'undefined') ? it.quantity
      : (typeof meta.qty !== 'undefined') ? meta.qty
      : (typeof meta.quantity !== 'undefined') ? meta.quantity
      : 1;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : 1;
  }catch(_){ return 1; }
}

function buildCustomerStats(orders, monthInfo){
  const list = [];
  if (!Array.isArray(orders) || !monthInfo) return { list, activeCount: 0, monthOrders: 0, monthRevenue: 0 };
  const startMs = monthInfo.start.getTime();
  const endMs = monthInfo.end.getTime();
  const map = new Map();
  let monthOrders = 0;
  let monthRevenue = 0;
  orders.forEach((order) => {
    const ts = getOrderCreatedTimestamp(order);
    if (!ts) return;
    const identity = getCustomerIdentity(order);
    if (identity.isAnonymous) return;
    let entry = map.get(identity.key);
    if (!entry){
      entry = {
        key: identity.key,
        name: identity.name,
        email: identity.email,
        orders_month: 0,
        total_month: 0,
        orders_total: 0,
        last_order_ts: 0,
        product_counts: {},
      };
      map.set(identity.key, entry);
    } else {
      if ((!entry.name || entry.name === 'Cliente sin identificar') && identity.name) entry.name = identity.name;
      if (!entry.email && identity.email) entry.email = identity.email;
    }
    entry.orders_total += 1;
    if (ts > entry.last_order_ts) entry.last_order_ts = ts;
    if (ts >= startMs && ts < endMs){
      entry.orders_month += 1;
      const totalVal = getOrderTotalValue(order);
      entry.total_month += totalVal;
      monthOrders += 1;
      monthRevenue += totalVal;
      const itemsArr = safeParseItems(order && order.items ? order.items : []);
      if (Array.isArray(itemsArr) && itemsArr.length){
        itemsArr.forEach((it) => {
          const name = getOrderItemPlainName(it) || getOrderItemPromoName(it) || (typeof it === 'string' ? String(it) : '');
          if (!name) return;
          const qty = getOrderItemQtyNumber(it);
          entry.product_counts[name] = (entry.product_counts[name] || 0) + qty;
        });
      }
    }
  });
  map.forEach((entry) => {
    let topProduct = '—';
    let topQty = 0;
    Object.keys(entry.product_counts || {}).forEach((name) => {
      const qty = Number(entry.product_counts[name] || 0);
      if (qty > topQty){
        topQty = qty;
        topProduct = name;
      }
    });
    entry.top_product = topProduct;
    list.push(entry);
  });
  list.sort((a, b) => {
    if (b.orders_month !== a.orders_month) return b.orders_month - a.orders_month;
    if (b.total_month !== a.total_month) return b.total_month - a.total_month;
    return b.last_order_ts - a.last_order_ts;
  });
  const activeCount = list.filter(c => c.orders_month > 0).length;
  return { list, activeCount, monthOrders, monthRevenue };
}

function applyCustomerFilters(list){
  let filtered = Array.isArray(list) ? list.slice() : [];
  const q = customersSearchInput ? String(customersSearchInput.value || '').trim().toLowerCase() : '';
  if (q){
    filtered = filtered.filter((entry) => {
      const name = String(entry.name || '').toLowerCase();
      const email = String(entry.email || '').toLowerCase();
      const top = String(entry.top_product || '').toLowerCase();
      return name.includes(q) || email.includes(q) || top.includes(q);
    });
  }
  if (customersActiveOnlyToggle && customersActiveOnlyToggle.checked){
    filtered = filtered.filter(entry => Number(entry.orders_month || 0) > 0);
  }
  return filtered;
}

function updateCustomersSummary(stats){
  try{ if (customersActiveCountEl) customersActiveCountEl.textContent = formatNumber(stats.activeCount || 0); }catch(_){ }
  try{ if (customersOrdersCountEl) customersOrdersCountEl.textContent = formatNumber(stats.monthOrders || 0); }catch(_){ }
  try{ if (customersRevenueTotalEl) customersRevenueTotalEl.textContent = formatMoney(stats.monthRevenue || 0); }catch(_){ }
}

function renderCustomers(list, monthInfo, meta){
  if (!customersTableBody) return;
  customersTableBody.innerHTML = '';
  const filtered = applyCustomerFilters(list);
  if (!filtered.length){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="empty-note">No hay clientes para mostrar.</td>';
    customersTableBody.appendChild(tr);
  } else {
    filtered.forEach((entry) => {
      const tr = document.createElement('tr');
      if (!entry.orders_month) tr.classList.add('customer-inactive');
      const lastLabel = entry.last_order_ts
        ? new Date(entry.last_order_ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : '—';
      const nameHtml = `<div class="customer-name">${escapeHtml(entry.name || '—')}</div>` +
        (entry.email ? `<div class="customer-meta">${escapeHtml(entry.email)}</div>` : '');
      tr.innerHTML = `
        <td>${nameHtml}</td>
        <td>${formatNumber(entry.orders_month || 0)}</td>
        <td>${formatMoney(entry.total_month || 0)}</td>
        <td class="customer-top-product">${escapeHtml(entry.top_product || '—')}</td>
        <td>${escapeHtml(lastLabel)}</td>
      `;
      customersTableBody.appendChild(tr);
    });
  }
  if (customersNoteEl && monthInfo){
    const label = monthInfo.label ? (monthInfo.label.charAt(0).toUpperCase() + monthInfo.label.slice(1)) : monthInfo.key;
    const totalOrders = meta && Number(meta.totalOrders || 0) ? Number(meta.totalOrders || 0) : 0;
    const limit = meta && Number(meta.limit || 0) ? Number(meta.limit || 0) : 0;
    const truncated = limit && totalOrders >= limit;
    const activeLabel = formatNumber((meta && meta.activeCount) ? meta.activeCount : (list || []).filter(c => c.orders_month > 0).length);
    let note = `Mes: ${label} · Clientes activos: ${activeLabel} · Pedidos analizados: ${formatNumber(totalOrders)}`;
    if (truncated) note += ` (límite ${limit})`;
    customersNoteEl.textContent = note;
  }
}

function renderCustomersFromCache(){
  if (!customersSection) return;
  ensureCustomersMonthDefault();
  const monthInfo = getMonthRangeFromInput(customersMonthInput ? customersMonthInput.value : '');
  const activeCount = Array.isArray(lastCustomersBase)
    ? lastCustomersBase.filter(c => Number(c.orders_month || 0) > 0).length
    : 0;
  renderCustomers(lastCustomersBase || [], monthInfo, {
    totalOrders: lastCustomersOrdersRaw.length,
    limit: lastCustomersOrdersMeta.limit,
    activeCount,
  });
}

function recomputeCustomersFromOrders(){
  if (!lastCustomersOrdersRaw || !lastCustomersOrdersRaw.length){
    refreshCustomers(true);
    return;
  }
  ensureCustomersMonthDefault();
  const monthInfo = getMonthRangeFromInput(customersMonthInput ? customersMonthInput.value : '');
  const stats = buildCustomerStats(lastCustomersOrdersRaw, monthInfo);
  lastCustomersBase = stats.list;
  lastCustomersMonthKey = monthInfo.key;
  updateCustomersSummary(stats);
  renderCustomers(stats.list, monthInfo, {
    totalOrders: lastCustomersOrdersRaw.length,
    limit: lastCustomersOrdersMeta.limit,
    activeCount: stats.activeCount,
  });
}

async function refreshCustomers(force = true){
  try{
    if (!customersSection) return;
    if (!force && Array.isArray(lastCustomersOrdersRaw) && lastCustomersOrdersRaw.length){
      recomputeCustomersFromOrders();
      return;
    }
    ensureCustomersMonthDefault();
    const monthInfo = getMonthRangeFromInput(customersMonthInput ? customersMonthInput.value : '');
    const limit = 1200;
    if (customersNoteEl) customersNoteEl.textContent = 'Cargando clientes...';
    const orders = await fetchOrders('', '', 'web', limit);
    if (!Array.isArray(orders)){
      if (customersNoteEl) customersNoteEl.textContent = 'No se pudieron cargar los pedidos.';
      return;
    }
    lastCustomersOrdersRaw = orders;
    lastCustomersOrdersMeta = { totalOrders: orders.length, limit };
    const stats = buildCustomerStats(orders, monthInfo);
    lastCustomersBase = stats.list;
    lastCustomersMonthKey = monthInfo.key;
    updateCustomersSummary(stats);
    renderCustomers(stats.list, monthInfo, {
      totalOrders: orders.length,
      limit,
      activeCount: stats.activeCount,
    });
  }catch(e){
    console.warn('refreshCustomers failed', e);
    if (customersNoteEl) customersNoteEl.textContent = 'No se pudieron cargar los clientes.';
  }
}

function getPreparationItemsListHtml(order){
  try{
    const itemsArr = safeParseItems(order && order.items ? order.items : []);
    if (!Array.isArray(itemsArr) || itemsArr.length === 0){
      return '<span class="muted">Sin items</span>';
    }
    const visibleItems = itemsArr.slice(0, PREPARATIONS_ITEMS_PREVIEW_LIMIT);
    const hiddenCount = Math.max(0, itemsArr.length - visibleItems.length);
    const listItems = visibleItems.map((it) => {
      const name = getOrderItemSummaryLabel(it) || 'Item';
      const qty = formatOrderQty(it);
      return `<li><span class="prep-item-name">${escapeHtml(name)}</span><span class="prep-item-qty">x${escapeHtml(qty)}</span></li>`;
    }).join('');
    const moreRow = hiddenCount > 0
      ? `<li class="prep-items-more"><button type="button" class="prep-more-btn prepOpenFullOrderBtn" data-id="${escapeHtml(order && order.id)}">+${hiddenCount} más (ver pedido completo)</button></li>`
      : '';
    return `<ul class="prep-items-list">${listItems}${moreRow}</ul>`;
  }catch(_){
    return '<span class="muted">Sin items</span>';
  }
}

function buildPreparationsSearchIndex(order){
  try{
    const itemsArr = safeParseItems(order && order.items ? order.items : []);
    const itemNames = (itemsArr || []).map((it) => getOrderItemSummaryLabel(it)).join(' ');
    const itemCodes = (itemsArr || []).map((it) => getOrderItemCode(it)).join(' ');
    const deliveryNotes = getOrderDeliveryNotes(order);
    return [
      order && order.id,
      order && order.status,
      order && order.user_full_name,
      order && order.user_email,
      order && order.user_barrio,
      order && order.user_calle,
      order && order.user_numeracion,
      deliveryNotes,
      itemNames,
      itemCodes,
    ].join(' ').toLowerCase();
  }catch(_){ return ''; }
}

function syncPreparationsSnapshot(list){
  try{
    const rows = Array.isArray(list) ? list : [];
    const seen = new Set();
    const deduped = [];
    rows.forEach((order) => {
      if (!isWebOrderEntry(order)) return;
      const id = String((order && order.id) || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      deduped.push(order);
    });
    lastPreparationsBase = deduped;
  }catch(_){
    lastPreparationsBase = Array.isArray(list) ? list.slice() : [];
  }
}

function renderPreparations(list){
  if (!preparationsList) return;
  const rows = Array.isArray(list) ? list.slice() : [];
  const q = preparationsSearch && preparationsSearch.value ? preparationsSearch.value.trim().toLowerCase() : '';
  const dateFilter = normalizeIsoDateKey(preparationsDate && preparationsDate.value ? preparationsDate.value : '');
  const filtered = [];
  rows.forEach((order) => {
    if (!isWebOrderEntry(order)) return;
    const statusNorm = normalizeOrderStatus(order && order.status);
    if (statusNorm !== 'visto' && statusNorm !== 'preparado') return;
    const scheduleInfo = resolveOrderScheduleInfo(order);
    const scheduleDateKey = normalizeIsoDateKey(scheduleInfo && scheduleInfo.dateKey);
    if (dateFilter && scheduleDateKey !== dateFilter) return;
    if (q){
      const searchIndex = buildPreparationsSearchIndex(order);
      if (!searchIndex.includes(q)) return;
    }
    filtered.push({ order, scheduleInfo, scheduleDateKey: scheduleDateKey || 'sin_fecha', statusNorm });
  });

  preparationsList.innerHTML = '';
  if (!filtered.length){
    preparationsList.innerHTML = '<div class="empty-note">No hay pedidos para preparar con los filtros actuales.</div>';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'preparations-summary';
  const validDateGroups = new Set(filtered.map((entry) => entry.scheduleDateKey)).size;
  summary.textContent = String(filtered.length) + ' pedidos agrupados en ' + String(validDateGroups) + ' día(s) de salida';
  preparationsList.appendChild(summary);

  const groups = new Map();
  filtered.forEach((entry) => {
    if (!groups.has(entry.scheduleDateKey)) groups.set(entry.scheduleDateKey, []);
    groups.get(entry.scheduleDateKey).push(entry);
  });
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'sin_fecha') return 1;
    if (b === 'sin_fecha') return -1;
    if (a === b) return 0;
    return a > b ? -1 : 1;
  });
  const byId = new Map(filtered.map((entry) => [String(entry.order.id), entry.order]));

  sortedKeys.forEach((key) => {
    const dayEntries = groups.get(key) || [];
    dayEntries.sort((a, b) => {
      const ta = getOrderCreatedTimestamp(a.order);
      const tb = getOrderCreatedTimestamp(b.order);
      return tb - ta;
    });

    const dayBlock = document.createElement('section');
    dayBlock.className = 'preparation-day-block';

    const head = document.createElement('div');
    head.className = 'preparation-day-head';
    const title = key === 'sin_fecha' ? 'Sin fecha de salida' : formatIsoDateKeyWithWeekday(key);
    head.innerHTML = `<div class="preparation-day-title">${escapeHtml(title)}</div><span class="badge-pill">${dayEntries.length}</span>`;
    dayBlock.appendChild(head);

    const cards = document.createElement('div');
    cards.className = 'preparation-cards';
    dayEntries.forEach((entry) => {
      const order = entry.order || {};
      const statusNorm = normalizeOrderStatus(order && order.status);
      const isPrepared = statusNorm === 'preparado';
      const customerName = getOrderPrimaryName(order);
      const customerEmail = getOrderEmail(order);
      const deliveryNotes = getOrderDeliveryNotes(order);
      const statusLabel = isPrepared ? 'Preparado' : 'Visto';
      const card = document.createElement('article');
      card.className = 'preparation-card';
      const scheduleLabel = formatScheduleInfoLabel(entry.scheduleInfo) || (key === 'sin_fecha' ? 'Sin fecha de salida' : formatIsoDateKeyWithWeekday(key));
      const customerTypeLabel = normalizeOrderCustomerType(order.customer_type) === 'minorista' ? 'Minorista' : 'Mayorista';
      const mapsLinkHtml = getOrderGoogleMapsLinkHtml(order, 'Abrir en Maps', 'prep-map-link');
      card.innerHTML = `
        <div class="preparation-card-top">
          <div class="preparation-card-identity">
            <span class="order-id">#${escapeHtml(order.id)}</span>
            <span class="prep-profile-chip">${escapeHtml(customerTypeLabel)}</span>
          </div>
          <span class="order-date">${escapeHtml(getOrderCreatedAtLabel(order))}</span>
        </div>
        <div class="preparation-row prep-row-highlight"><span class="prep-label">Salida</span><span class="prep-value">${escapeHtml(scheduleLabel)}</span></div>
        <div class="preparation-row"><span class="prep-label">Cliente</span><span class="prep-value">${escapeHtml(customerName)}</span></div>
        <div class="preparation-row"><span class="prep-label">Email</span><span class="prep-value">${escapeHtml(customerEmail)}</span></div>
        <div class="preparation-row"><span class="prep-label">Dirección</span><span class="prep-value">${escapeHtml(getOrderAddress(order))}</span></div>
        ${deliveryNotes ? `<div class="preparation-row"><span class="prep-label">Instrucciones</span><span class="prep-value">${escapeHtml(deliveryNotes)}</span></div>` : ''}
        ${mapsLinkHtml ? `<div class="preparation-row prep-row-map"><span class="prep-label">Ubicación</span><span class="prep-value prep-map-value">${mapsLinkHtml}</span></div>` : ''}
        <div class="preparation-row preparation-row-items"><span class="prep-label">Items</span><div class="prep-value prep-items-value">${getPreparationItemsListHtml(order)}</div></div>
        <div class="preparation-row"><span class="prep-label">Total</span><span class="prep-value prep-value-total">$${Number(order.total || 0).toFixed(2)}</span></div>
        <div class="preparation-footer">
          <span class="prep-status-badge ${isPrepared ? 'is-prepared' : 'is-seen'}">${escapeHtml(statusLabel)}</span>
          <div class="preparation-actions">
            <button class="btn small prepViewOrderBtn" data-id="${escapeHtml(order.id)}">Ver pedido completo</button>
            ${isPrepared
              ? '<span class="prep-status-chip">Preparado</span>'
              : `<button class="btn small prepMarkPreparedBtn prep-mark-btn" data-id="${escapeHtml(order.id)}">Marcar preparado</button>`
            }
          </div>
        </div>
      `;
      cards.appendChild(card);
    });
    dayBlock.appendChild(cards);
    preparationsList.appendChild(dayBlock);
  });

  const openPreparationOrderDetail = async (idRaw) => {
    const id = String(idRaw || '').trim();
    if (!id) return;
    const existing = byId.get(id);
    if (existing){
      showOrderDetail(existing);
      return;
    }
    try{
      const fetched = await fetchOrders(String(id));
      const order = (fetched || []).find((x) => String(x.id) === id) || (fetched && fetched[0]);
      if (order) showOrderDetail(order);
    }catch(_){ }
  };

  preparationsList.querySelectorAll('.prepViewOrderBtn, .prepOpenFullOrderBtn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn && btn.dataset ? String(btn.dataset.id || '') : '';
      await openPreparationOrderDetail(id);
    };
  });

  preparationsList.querySelectorAll('.prepMarkPreparedBtn').forEach((btn) => {
    btn.onclick = async () => {
      try{
        const id = btn && btn.dataset ? String(btn.dataset.id || '') : '';
        if (!id) return;
        btn.disabled = true;
        btn.textContent = 'Guardando...';
        const updated = await patchOrderStatus(id, 'preparado');
        const uid = String((updated && updated.id) || id);
        try{
          const modal = document.getElementById('orderModal');
          if (modal && !modal.classList.contains('hidden')){
            const title = document.getElementById('orderModalTitle');
            if (title && String(title.textContent || '').includes('#' + uid)){
              showOrderDetail(Object.assign({}, byId.get(uid) || {}, updated));
            }
          }
        }catch(_){ }
        try{ await refreshOrders('web'); }catch(_){ }
        renderPreparations(lastPreparationsBase);
        showToast('Pedido marcado como preparado');
      }catch(e){
        console.error('prepMarkPrepared failed', e);
        showToast('No se pudo marcar como preparado', 'error');
        try{
          btn.disabled = false;
          btn.textContent = 'Marcar preparado';
        }catch(_){ }
      }
    };
  });
}

async function refreshPreparations(forceFetch){
  try{
    const shouldFetch = !!forceFetch || !Array.isArray(lastPreparationsBase) || lastPreparationsBase.length === 0;
    if (shouldFetch){
      const fetched = await fetchOrders('', '', 'web');
      if (fetched === null){
        showToast('No se pudo actualizar preparaciones (se mantiene la vista actual)', 'warning');
      } else {
        syncPreparationsSnapshot(fetched);
      }
    }
    renderPreparations(lastPreparationsBase);
  }catch(e){
    console.error('refreshPreparations failed', e);
    showToast('Error al cargar preparaciones', 'error');
  }
}

// ---------------------- Rutas (asignación y optimización) ----------------------
const routesDriverSelect = document.getElementById('routesDriverSelect');
const routesRefreshBtn = document.getElementById('routesRefreshBtn');
const routesOptimizeBtn = document.getElementById('routesOptimizeBtn');
const routesAutoAssignBtn = document.getElementById('routesAutoAssignBtn');
const routesUnassigned = document.getElementById('routesUnassigned');
const routesAssigned = document.getElementById('routesAssigned');
let routesDriversCache = [];
let routesAssignedBase = [];
let routesUnassignedBase = [];

function renderRoutesEmpty(container, message){
  if (!container) return;
  container.innerHTML = `<div class="empty-note">${escapeHtml(message || 'Sin datos.')}</div>`;
}

function renderRouteDriversSelect(drivers){
  if (!routesDriverSelect) return;
  const prev = String(routesDriverSelect.value || '');
  routesDriverSelect.innerHTML = '';
  if (!drivers || !drivers.length){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin repartidores';
    routesDriverSelect.appendChild(opt);
    return;
  }
  drivers.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = String(d.id || '');
    const zoneLabel = d.zone ? ` · ${d.zone}` : '';
    opt.textContent = `${d.username || 'repartidor'}${zoneLabel}`;
    routesDriverSelect.appendChild(opt);
  });
  if (prev && Array.from(routesDriverSelect.options).some(o => String(o.value) === prev)){
    routesDriverSelect.value = prev;
  }
}

function getSelectedRouteDriver(){
  if (!routesDriverSelect) return null;
  const id = String(routesDriverSelect.value || '').trim();
  if (!id) return null;
  return (routesDriversCache || []).find(d => String(d.id || '') === id) || null;
}

async function fetchRouteDrivers(){
  try{
    await ensureApiBase();
  }catch(_){ }
  const list = await safeFetch(`${API_BASE}/admin/users`).catch(() => []);
  const arr = Array.isArray(list) ? list : [];
  routesDriversCache = arr.filter(u => String(u.role || '').toLowerCase() === 'repartidor');
  return routesDriversCache;
}

function computeRouteOrder(orders){
  const list = Array.isArray(orders) ? orders.slice() : [];
  const withCoords = [];
  const withoutCoords = [];
  list.forEach((o) => {
    const snap = getOrderAddressSnapshot(o);
    const lat = Number(snap.lat);
    const lon = Number(snap.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      withCoords.push({ order: o, lat, lon });
    } else {
      withoutCoords.push(o);
    }
  });
  if (withCoords.length < 2){
    return { ordered: list, optimized: false, missing: withoutCoords.length };
  }
  const remaining = withCoords.slice();
  const ordered = [];
  let current = remaining.shift();
  ordered.push(current);
  while (remaining.length){
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++){
      const cand = remaining[i];
      const d = haversineKm(current.lat, current.lon, cand.lat, cand.lon);
      if (d < bestDist){
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  const orderedOrders = ordered.map(x => x.order).concat(withoutCoords);
  return { ordered: orderedOrders, optimized: true, missing: withoutCoords.length };
}

function haversineKm(lat1, lon1, lat2, lon2){
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function renderRoutesUnassigned(list, driver){
  if (!routesUnassigned) return;
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length){
    renderRoutesEmpty(routesUnassigned, 'No hay pedidos preparados sin asignar.');
    return;
  }
  routesUnassigned.innerHTML = '';
  rows.forEach((order) => {
    const card = document.createElement('div');
    card.className = 'routes-card';
    const statusNorm = normalizeOrderStatus(order && order.status);
    const statusLabel = formatOrderStatusLabel(statusNorm);
    const mapsLinkHtml = getOrderGoogleMapsLinkHtml(order, 'Abrir en Maps', 'route-map-link');
    card.innerHTML = `
      <div class="routes-card-top">
        <div class="routes-card-meta">
          <span class="order-id">#${escapeHtml(order.id)}</span>
          <span class="routes-status">${escapeHtml(statusLabel)}</span>
        </div>
      </div>
      <div class="routes-row"><strong>Cliente:</strong> ${escapeHtml(getOrderPrimaryName(order))}</div>
      <div class="routes-row"><strong>Dirección:</strong> ${escapeHtml(getOrderAddress(order))}</div>
      ${mapsLinkHtml ? `<div class="routes-row">${mapsLinkHtml}</div>` : ''}
      <div class="routes-row">
        <button class="btn small routes-assign-btn" data-id="${escapeHtml(order.id)}">Asignar a ${escapeHtml(driver.username || 'repartidor')}</button>
      </div>
    `;
    routesUnassigned.appendChild(card);
  });
  routesUnassigned.querySelectorAll('.routes-assign-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn && btn.dataset ? String(btn.dataset.id || '') : '';
      if (!id || !driver) return;
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = 'Asignando...';
      try{
        await ensureApiBase();
      }catch(_){ }
      try{
        await safeFetch(`${API_BASE}/admin/orders/${encodeURIComponent(id)}/assign`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driver_id: driver.id }),
        });
        showToast('Pedido asignado');
        await refreshRoutes(true);
      }catch(e){
        const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? String(e.payload.detail || e.payload.error) : 'No se pudo asignar.';
        showToast(msg, 'error');
        btn.disabled = false;
        btn.textContent = prevText;
      }
    });
  });
}

function renderRoutesAssigned(list, optimized){
  if (!routesAssigned) return;
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length){
    renderRoutesEmpty(routesAssigned, 'No hay pedidos asignados a este repartidor.');
    return;
  }
  routesAssigned.innerHTML = '';
  rows.forEach((order, idx) => {
    const card = document.createElement('div');
    card.className = 'routes-card';
    const statusNorm = normalizeOrderStatus(order && order.status);
    const statusLabel = formatOrderStatusLabel(statusNorm);
    const mapsLinkHtml = getOrderGoogleMapsLinkHtml(order, 'Abrir en Maps', 'route-map-link');
    card.innerHTML = `
      <div class="routes-card-top">
        <div class="routes-card-meta">
          <span class="route-index">${idx + 1}</span>
          <span class="order-id">#${escapeHtml(order.id)}</span>
          <span class="routes-status">${escapeHtml(statusLabel)}</span>
        </div>
        ${optimized ? '<span class="muted" style="font-size:12px">Ruta optimizada</span>' : ''}
      </div>
      <div class="routes-row"><strong>Cliente:</strong> ${escapeHtml(getOrderPrimaryName(order))}</div>
      <div class="routes-row"><strong>Dirección:</strong> ${escapeHtml(getOrderAddress(order))}</div>
      ${mapsLinkHtml ? `<div class="routes-row">${mapsLinkHtml}</div>` : ''}
    `;
    routesAssigned.appendChild(card);
  });
}

async function refreshRoutes(forceFetch){
  try{
    if (!routesDriverSelect || !routesUnassigned || !routesAssigned) return;
    if (forceFetch || !routesDriversCache.length){
      await fetchRouteDrivers();
    }
    renderRouteDriversSelect(routesDriversCache);
    const driver = getSelectedRouteDriver();
    if (!driver){
      renderRoutesEmpty(routesUnassigned, 'Seleccioná un repartidor.');
      renderRoutesEmpty(routesAssigned, 'Seleccioná un repartidor.');
      return;
    }
    if (forceFetch){
      try{
        await safeFetch(`${API_BASE}/admin/routes/auto-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driver_id: driver.id, include_assigned: true }),
        });
      }catch(_){ }
    }
    routesUnassigned.innerHTML = '<div class="empty-note">Cargando pedidos...</div>';
    routesAssigned.innerHTML = '<div class="empty-note">Cargando pedidos...</div>';
    const zoneParam = driver.zone ? `&zone=${encodeURIComponent(driver.zone)}` : '';
    const unassignedAll = await safeFetch(`${API_BASE}/admin/orders?status=preparado${zoneParam}`).catch(() => []);
    const unassignedRows = (Array.isArray(unassignedAll) ? unassignedAll : []).filter(o => !o.assigned_driver_id && !o.assigned_driver_username);
    routesUnassignedBase = unassignedRows;
    renderRoutesUnassigned(unassignedRows, driver);
    const assignedRows = await safeFetch(`${API_BASE}/admin/orders?status=preparado,enviado&driver_id=${encodeURIComponent(driver.id)}`).catch(() => []);
    routesAssignedBase = Array.isArray(assignedRows) ? assignedRows : [];
    renderRoutesAssigned(routesAssignedBase, false);
  }catch(e){
    console.error('refreshRoutes failed', e);
    renderRoutesEmpty(routesUnassigned, 'No se pudieron cargar pedidos.');
    renderRoutesEmpty(routesAssigned, 'No se pudieron cargar pedidos.');
  }
}

if (routesRefreshBtn){
  routesRefreshBtn.addEventListener('click', () => refreshRoutes(true));
}
if (routesOptimizeBtn){
  routesOptimizeBtn.addEventListener('click', () => {
    const optimized = computeRouteOrder(routesAssignedBase || []);
    renderRoutesAssigned(optimized.ordered, optimized.optimized);
    if (optimized.optimized && optimized.missing){
      showToast('Ruta optimizada (algunos pedidos sin coordenadas)', 'info');
    } else if (optimized.optimized){
      showToast('Ruta optimizada');
    } else {
      showToast('No hay coordenadas suficientes para optimizar', 'warning');
    }
  });
}
if (routesAutoAssignBtn){
  routesAutoAssignBtn.addEventListener('click', async () => {
    try{
      await ensureApiBase();
      await safeFetch(`${API_BASE}/admin/routes/auto-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_assigned: true }),
      });
      showToast('Rutas optimizadas por zona');
      await refreshRoutes(true);
    }catch(e){
      console.error('routes auto-assign failed', e);
      showToast('No se pudo auto-optimizar', 'error');
    }
  });
}
if (routesDriverSelect){
  routesDriverSelect.addEventListener('change', () => refreshRoutes(true));
}

// ---------------------- Entregas (historial) ----------------------
const deliveriesDriverSelect = document.getElementById('deliveriesDriverSelect');
const deliveriesDateFrom = document.getElementById('deliveriesDateFrom');
const deliveriesDateTo = document.getElementById('deliveriesDateTo');
const deliveriesRefreshBtn = document.getElementById('deliveriesRefreshBtn');
const deliveriesTableBody = document.querySelector('#deliveriesTable tbody');

function getLatestDeliveryIssue(order){
  if (!order) return null;
  const issues = Array.isArray(order.delivery_issues) ? order.delivery_issues : [];
  if (issues.length) return issues[issues.length - 1];
  const issueType = String(order.last_delivery_issue_type || '').trim();
  if (!issueType) return null;
  return {
    type: issueType,
    note: order.last_delivery_issue_note || '',
    photo_url: order.last_delivery_issue_photo_url || '',
    created_at: order.last_delivery_issue_at || null,
    reported_by_id: order.last_delivery_issue_by_id || null,
    reported_by_username: order.last_delivery_issue_by_username || '',
    closed_attempt: order.closed_attempts || null,
  };
}

function formatDeliveryIncidentLabel(issue, order){
  if (!issue || !issue.type){
    return normalizeOrderStatus(order && order.status) === 'entregado' ? 'Entrega completada' : '—';
  }
  const type = String(issue.type || '').trim();
  if (type === 'negocio_cerrado'){
    const attempts = Number(issue.closed_attempt || (order && order.closed_attempts) || 0);
    return attempts >= 2 ? 'Negocio cerrado · cancelado' : 'Negocio cerrado · reprogramado';
  }
  if (type === 'problema'){
    return 'Problema reportado';
  }
  return type;
}

function buildDeliveryPhotoHtml(rawUrl){
  const src = buildImagePreviewSrc(rawUrl);
  if (!src) return '<span class="cell-muted">—</span>';
  return `<a class="delivery-photo-link" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer"><img class="delivery-photo-thumb" src="${escapeHtml(src)}" alt="Foto del cierre" loading="lazy"></a>`;
}

function renderDeliveriesDriversSelect(drivers){
  if (!deliveriesDriverSelect) return;
  deliveriesDriverSelect.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'Todos los repartidores';
  deliveriesDriverSelect.appendChild(optAll);
  (drivers || []).forEach((d) => {
    const opt = document.createElement('option');
    opt.value = String(d.id || '');
    const zoneLabel = d.zone ? ` · ${d.zone}` : '';
    opt.textContent = `${d.username || 'repartidor'}${zoneLabel}`;
    deliveriesDriverSelect.appendChild(opt);
  });
}

function renderDeliveries(list){
  if (!deliveriesTableBody) return;
  const rows = Array.isArray(list) ? list : [];
  deliveriesTableBody.innerHTML = '';
  if (!rows.length){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="10" class="empty-note">Sin entregas ni incidencias en el período.</td>';
    deliveriesTableBody.appendChild(tr);
    return;
  }
  rows.forEach((o) => {
    const tr = document.createElement('tr');
    const latestIssue = getLatestDeliveryIssue(o);
    const eventAtRaw = o.delivered_at || (latestIssue && latestIssue.created_at) || o.last_delivery_issue_at || null;
    const deliveredAt = eventAtRaw ? new Date(eventAtRaw).toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' }) : '—';
    const driverName = o.delivered_by_username || o.assigned_driver_username || '—';
    const zone = o.assigned_driver_zone || '—';
    const statusLabel = formatOrderStatusLabel(o.status);
    const incidentLabel = formatDeliveryIncidentLabel(latestIssue, o);
    const incidentNote = String((latestIssue && latestIssue.note) || o.cancel_reason || '').trim();
    const photoHtml = buildDeliveryPhotoHtml((latestIssue && latestIssue.photo_url) || o.last_delivery_issue_photo_url || '');
    tr.innerHTML = `
      <td>#${escapeHtml(o.id)}</td>
      <td>${escapeHtml(driverName)}</td>
      <td>${escapeHtml(zone)}</td>
      <td>${escapeHtml(statusLabel)}</td>
      <td>
        <div>${escapeHtml(incidentLabel)}</div>
        ${incidentNote ? `<div class="delivery-incident-note">${escapeHtml(incidentNote)}</div>` : ''}
      </td>
      <td>${escapeHtml(deliveredAt)}</td>
      <td>${escapeHtml(getOrderPrimaryName(o))}</td>
      <td>${escapeHtml(getOrderAddress(o))}</td>
      <td>${photoHtml}</td>
      <td>$${Number(o.total || 0).toFixed(2)}</td>
    `;
    deliveriesTableBody.appendChild(tr);
  });
}

async function refreshDeliveries(force){
  try{
    if (!deliveriesTableBody) return;
    await ensureApiBase();
    if (force || !routesDriversCache.length){
      await fetchRouteDrivers();
    }
    renderDeliveriesDriversSelect(routesDriversCache);
    const driverId = deliveriesDriverSelect ? String(deliveriesDriverSelect.value || '').trim() : '';
    const from = deliveriesDateFrom ? String(deliveriesDateFrom.value || '').trim() : '';
    const to = deliveriesDateTo ? String(deliveriesDateTo.value || '').trim() : '';
    const params = [];
    if (driverId) params.push('driver_id=' + encodeURIComponent(driverId));
    if (from) params.push('date_from=' + encodeURIComponent(from));
    if (to) params.push('date_to=' + encodeURIComponent(to));
    const url = `${API_BASE}/admin/deliveries${params.length ? '?' + params.join('&') : ''}`;
    const list = await safeFetch(url).catch(() => []);
    renderDeliveries(list);
  }catch(e){
    console.error('refreshDeliveries failed', e);
    if (deliveriesTableBody){
      deliveriesTableBody.innerHTML = '<tr><td colspan="10" class="empty-note">No se pudieron cargar las entregas.</td></tr>';
    }
  }
}

if (deliveriesRefreshBtn){
  deliveriesRefreshBtn.addEventListener('click', () => refreshDeliveries(true));
}

try{
  setInterval(() => {
    if (currentSectionId === 'deliveries') {
      refreshDeliveries(false);
    }
  }, 20000);
}catch(_){ }

function orderRowFor(o){
  const itemsArr = safeParseItems(o.items || []);
  const hasConsumo = (itemsArr || []).some(it => isOrderItemConsumo(it));
  const paymentMethod = formatOrderPaymentMethod(o);
  const paymentStatus = formatOrderPaymentStatus(o);
  const paymentReference = String((o && o.payment_reference) || '').trim();
  const itemsList = (itemsArr || []).map(it => {
    const qtyLabel = formatOrderQty(it);
    return `<li>${renderOrderItemLabel(it)} <span class="muted">× ${escapeHtml(qtyLabel)}</span></li>`;
  }).join('');
  const tr = document.createElement('tr');
  const previewName = o._token_preview && (o._token_preview.name || o._token_preview.email) ? (o._token_preview.name || o._token_preview.email) : null;
  const displayName = o.user_full_name || previewName || o.user_email;
  const userDisplay = displayName ? `${displayName}${o.user_email && displayName !== o.user_email ? ' / ' + o.user_email : ''}` : (o.user_id ? `#${o.user_id}` : '');
  const address = getOrderAddress(o);
  const deliveryNotes = getOrderDeliveryNotes(o);
  const scheduledDeliveryLabel = formatOrderScheduledDelivery(o);
  const orderCustomerType = normalizeOrderCustomerType(o.customer_type);
  const orderCustomerTypeLabel = orderCustomerType === 'minorista' ? 'Minorista' : 'Mayorista';
  const orderStatusNorm = normalizeOrderStatus(o && o.status);
  const statusLabel = formatOrderStatusLabel(orderStatusNorm);
  const statusRank = orderStatusRank(orderStatusNorm);
  const canMarkSeen = statusRank < orderStatusRank('visto');
  const canMarkPrepared = statusRank === orderStatusRank('visto');
  const fecha = o.created_at ? new Date(o.created_at).toLocaleString('es-ES', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const mapsLinkHtml = getOrderGoogleMapsLinkHtml(o, 'Ver en Google Maps', 'order-map-link-card');
  // Solo mostrar 'pendiente' si NO tiene created_at y está en el caché local como pending
  let isPending = false;
  const localCache = window.__localOrderRows && window.__localOrderRows[String(o.id)];
  if (!o.created_at && localCache && localCache.pending) {
    isPending = true;
  } else if (o.created_at && localCache) {
    // Si el pedido ya tiene created_at, eliminar del caché local y nunca mostrar como pendiente
    try { delete window.__localOrderRows[String(o.id)]; window.__localOrderIds && window.__localOrderIds.delete(String(o.id)); saveLocalOrderCache && saveLocalOrderCache(); } catch(_){}
    isPending = false;
  }
  let primaryActionHtml = `<button class="btn" disabled title="Estado actual">${escapeHtml(statusLabel)}</button>`;
  if (isPending){
    primaryActionHtml = '<button class="btn" disabled title="Pendiente: sincronizando con servidor">Pendiente</button>';
  } else if (canMarkSeen){
    primaryActionHtml = `<button data-id="${o.id}" class="markSeenBtn btn primary" title="Marcar como visto">Marcar visto</button>`;
  } else if (canMarkPrepared){
    primaryActionHtml = `<button data-id="${o.id}" class="markPreparedBtn btn primary" title="Marcar como preparado">Marcar preparado</button>`;
  }
  tr.innerHTML = `
    <td colspan="8" style="padding:0;">
      <div class="order-card-vertical">
        <div class="order-row-top">
          <span class="order-id">#${o.id}</span>
          <span class="order-date">${fecha}</span>
        </div>
        ${hasConsumo ? '<div class="order-row-banner" style="margin:6px 0 10px;padding:8px 10px;border-radius:10px;background:#fff7ed;border:1px solid rgba(242,107,56,0.25);color:#9a3412;font-weight:800">Pedido con consumo inmediato</div>' : ''}
        <div class="order-row-status"><strong>Estado:</strong> <span class="order-status-pill status-${escapeHtml(orderStatusNorm)}">${escapeHtml(statusLabel)}</span></div>
        <div class="order-row-progress">${buildOrderStepperHtml(orderStatusNorm)}</div>
        <div class="order-row-items"><strong>Artículos:</strong><ul class="order-items-list">${itemsList}</ul></div>
        <div class="order-row-user"><strong>Cliente:</strong> ${escapeHtml(userDisplay)}</div>
        <div class="order-row-customer-type"><strong>Perfil:</strong> ${escapeHtml(orderCustomerTypeLabel)}</div>
        <div class="order-row-address"><strong>Dirección:</strong> ${escapeHtml(address || '—')}</div>
        ${deliveryNotes ? `<div class="order-row-notes"><strong>Instrucciones:</strong> ${escapeHtml(deliveryNotes)}</div>` : ''}
        ${mapsLinkHtml ? `<div class="order-row-map">${mapsLinkHtml}</div>` : ''}
        ${scheduledDeliveryLabel ? `<div class="order-row-address"><strong>Entrega programada:</strong> ${escapeHtml(scheduledDeliveryLabel)}</div>` : ''}
        <div class="order-row-total"><strong>Total:</strong> $${Number(o.total||0).toFixed(2)}</div>
        <div class="order-row-payment"><strong>Forma de pago:</strong> ${escapeHtml(paymentMethod)}${paymentStatus ? ` <span class="muted">(${escapeHtml(paymentStatus)})</span>` : ''}</div>
        ${paymentReference ? `<div class="order-row-payment-ref"><strong>Ref MP:</strong> ${escapeHtml(paymentReference)}</div>` : ''}
        ${isPending ? '<div class="order-row-pending"> pendiente</div>' : ''}
        <div class="order-row-actions">
          <button data-id="${o.id}" class="viewOrderBtn btn">Ver</button>
          ${primaryActionHtml}
        </div>
      </div>
    </td>
  `;
  try{
    tr.dataset.orderId = String(o.id || '');
    tr.dataset.status = String(orderStatusNorm || '');
  }catch(_){ }
  // disable mark-seen for local-only rows that haven't been persisted to DB yet
  try{
    const btn = tr.querySelector('.markSeenBtn');
    if(btn){
      const lid = String(o.id);
      if((!o.created_at) || (window.__localOrderRows && window.__localOrderRows[lid] && window.__localOrderRows[lid].pending)){
        btn.disabled = true; btn.title = 'Pendiente: sincronizando con servidor';
      }
    }
  }catch(e){ }
  return tr;
}

function insertOrderAtTop(o, source){
  try{
    const oid = String((o && o.id) || '');
    if(!oid) return;

    let effectiveSource = source;
    try{ if(!effectiveSource && o && o.source) effectiveSource = o.source; }catch(_){ }
    try{
      if(!effectiveSource && window.__localOrderRows && window.__localOrderRows[oid] && window.__localOrderRows[oid].payload && window.__localOrderRows[oid].payload.source){
        effectiveSource = window.__localOrderRows[oid].payload.source;
      }
    }catch(_){ }

    const normalizedSource = String(effectiveSource || 'web').toLowerCase();
    if(normalizedSource !== 'web') return;
    const normalizedCustomerType = normalizeOrderCustomerType(o && o.customer_type);
    const shouldRenderNow = normalizedCustomerType === normalizeOrderCustomerType(currentOrderCustomerType);

    const ordersTableBody = document.querySelector('#ordersTable_web tbody');
    if(!ordersTableBody) return;
    try{
      const incoming = Object.assign({}, o, { source: 'web', customer_type: normalizedCustomerType });
      const prev = Array.isArray(lastOrdersBaseWeb) ? lastOrdersBaseWeb.filter(x => String((x && x.id) || '') !== oid) : [];
      lastOrdersBaseWeb = [incoming, ...prev];
      updateOrdersCustomerTypeBadges(lastOrdersBaseWeb);
      const prepPrev = Array.isArray(lastPreparationsBase) ? lastPreparationsBase.filter(x => String((x && x.id) || '') !== oid) : [];
      lastPreparationsBase = [incoming, ...prepPrev];
      if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
    }catch(_){ }

    try{
      window.__localOrderRows = window.__localOrderRows || {};
      window.__localOrderIds = window.__localOrderIds || new Set();
    }catch(_){
      window.__localOrderRows = window.__localOrderRows || {};
      window.__localOrderIds = window.__localOrderIds || new Set();
    }

    let found = false;
    ordersTableBody.querySelectorAll('tr').forEach(r => {
      if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === oid) found = true;
    });
    if(found) return;

    const tr = orderRowFor(o);
    try{
      tr.setAttribute('data-local-insert', '1');
      tr.classList.add('pending-sync');
      tr.setAttribute('data-source', 'web');
      tr.setAttribute('data-customer-type', normalizedCustomerType);
    }catch(_){ }

    if(shouldRenderNow){
      ordersTableBody.insertBefore(tr, ordersTableBody.firstChild);
      try{ regroupOrdersForTable('web'); }catch(_){ }
      updateBadgeCount('web');
    }

    try{ console.debug('[admin] insertOrderAtTop inserted', o.id, 'source=web'); }catch(_){ }

    try{
      const payload = Object.assign({}, o, { source: 'web', customer_type: normalizedCustomerType });
      window.__localOrderRows[oid] = { html: tr.outerHTML, ts: Date.now(), pending: true, payload };
      window.__localOrderIds.add(oid);
      try{ saveLocalOrderCache(); }catch(_){ }
    }catch(_){ }

    try{
      tr.querySelector('.viewOrderBtn').onclick = async (ev) => {
        const id = ev.target.dataset.id;
        const list = await fetchOrders(String(id));
        const order = (list || []).find(x => String(x.id) === String(id)) || (list && list[0]);
        if(order) showOrderDetail(order);
      };
    }catch(_){ }

    try{ verifyServerHasOrder(oid); }catch(e){ console.warn('verifyServerHasOrder failed start', e); }
  }catch(e){
    console.error('insertOrderAtTop failed', e);
  }
}

function showOrderDetail(order){
  const modal = document.getElementById('orderModal'); const body = document.getElementById('orderModalBody'); const title = document.getElementById('orderModalTitle');
  if(!modal || !body || !title) return;
  title.textContent = `Pedido #${order.id}`;
  const itemsArr = safeParseItems(order.items || []);
  const hasConsumo = (itemsArr || []).some(it => isOrderItemConsumo(it));
  const itemsHtml = (itemsArr || []).map(it=>`<li><strong>${renderOrderItemLabel(it)}</strong>  ${escapeHtml(formatOrderQty(it))}  $${Number(it.meta?.price||0).toFixed(2)}</li>`).join('') || '<li>(sin tems)</li>';
  const address = getOrderAddress(order);
  const paymentMethod = formatOrderPaymentMethod(order);
  const paymentStatus = formatOrderPaymentStatus(order);
  const paymentReference = String((order && order.payment_reference) || '').trim();
  const scheduledDeliveryLabel = formatOrderScheduledDelivery(order);
  const deliveryNotes = getOrderDeliveryNotes(order);
  const customerTypeLabel = normalizeOrderCustomerType(order && order.customer_type) === 'minorista' ? 'Minorista' : 'Mayorista';
  const mapsLinkHtml = getOrderGoogleMapsLinkHtml(order, 'Abrir en Google Maps', 'order-map-link-modal');
  const statusNorm = normalizeOrderStatus(order && order.status);
  const statusLabel = formatOrderStatusLabel(statusNorm);
  // prefer user_* fields, otherwise display token preview when available
  const previewName = order._token_preview && (order._token_preview.name || order._token_preview.email) ? (order._token_preview.name || order._token_preview.email) : null;
  const displayName = order.user_full_name || previewName || order.user_email || (order.user_id ? '#'+order.user_id : '');
  body.innerHTML = `
    <div class="modal-order-body">
      <div><strong>Usuario:</strong> ${escapeHtml(displayName)} ${order.user_email && displayName !== order.user_email ? ' / ' + escapeHtml(order.user_email) : ''}</div>
      <div><strong>Perfil:</strong> ${escapeHtml(customerTypeLabel)}</div>
      <div><strong>Dirección:</strong> ${escapeHtml(address || '—')}</div>
      ${deliveryNotes ? `<div><strong>Instrucciones:</strong> ${escapeHtml(deliveryNotes)}</div>` : ''}
      ${mapsLinkHtml ? `<div><strong>Ubicación:</strong> ${mapsLinkHtml}</div>` : ''}
      ${scheduledDeliveryLabel ? `<div><strong>Entrega programada:</strong> ${escapeHtml(scheduledDeliveryLabel)}</div>` : ''}
      <div><strong>Total:</strong> $${Number(order.total||0).toFixed(2)}</div>
      <div><strong>Estado:</strong> <span class="order-status-pill status-${escapeHtml(statusNorm)}">${escapeHtml(statusLabel)}</span></div>
      <div class="order-row-progress">${buildOrderStepperHtml(statusNorm)}</div>
      <div><strong>Forma de pago:</strong> ${escapeHtml(paymentMethod)}${paymentStatus ? ` <span class="muted">(${escapeHtml(paymentStatus)})</span>` : ''}</div>
      ${paymentReference ? `<div><strong>Ref MP:</strong> ${escapeHtml(paymentReference)}</div>` : ''}
      ${hasConsumo ? '<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:#fff7ed;border:1px solid rgba(242,107,56,0.25);color:#9a3412;font-weight:800">Pedido con consumo inmediato</div>' : ''}
      <div class="mt-8"><strong>Items:</strong><ul class="order-items-list">${itemsHtml}</ul></div>
    </div>
  `;
  // add action button for next step (recibido -> visto -> preparado)
  try{
    const actionWrap = document.createElement('div'); actionWrap.style.marginTop = '10px';
    const stRank = orderStatusRank(statusNorm);
    const canMarkSeen = stRank < orderStatusRank('visto');
    const canMarkPrepared = stRank === orderStatusRank('visto');
    const nextTarget = canMarkSeen ? 'visto' : (canMarkPrepared ? 'preparado' : '');
    const nextLabel = nextTarget === 'visto' ? 'Marcar visto' : (nextTarget === 'preparado' ? 'Marcar preparado' : '');
    const markBtn = document.createElement('button');
    markBtn.className = 'btn primary';
    markBtn.textContent = nextLabel || statusLabel;
    markBtn.disabled = !nextTarget;
    markBtn.title = nextTarget ? ('Marcar como ' + nextTarget) : 'Pedido ya marcado (progreso avanzado)';
    markBtn.onclick = async () => {
      if (!nextTarget) return;
      const targetStatus = nextTarget;
      const oldBtnText = markBtn.textContent || nextLabel || 'Guardar';
      try{
        markBtn.disabled = true;
        markBtn.textContent = 'Guardando...';
        markBtn.classList.add('updating');
        const updated = await safeFetch(API_BASE + '/orders/' + encodeURIComponent(order.id) + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: targetStatus }) });
        showOrderDetail(updated);
        try{ await refreshOrders('web'); }catch(_){ }
        const updatedStatus = String((updated && updated.status) || targetStatus).toLowerCase();
        if (updatedStatus === 'visto') showToast('Pedido marcado como visto y movido a Preparaciones');
        else if (updatedStatus === 'preparado') showToast('Pedido marcado como preparado');
        else showToast('Estado actualizado');
      }catch(e){
        console.error('modal mark seen failed', e);
        const msg = (e && e.status === 409 && e.payload && e.payload.current)
          ? ('No se puede volver atrás (actual: ' + formatOrderStatusLabel(e.payload.current) + ').')
          : 'No se pudo actualizar estado';
        showToast(msg, 'error');
        markBtn.disabled = false;
        markBtn.textContent = oldBtnText;
      }finally{
        markBtn.classList.remove('updating');
      }
    };
    actionWrap.appendChild(markBtn);
    body.appendChild(actionWrap);
  }catch(e){ console.warn('Could not append mark seen button', e); }
  // if this was a pending local row, show hint
  try{ if(order && String(order.id) && (window.__localOrderRows || {})[String(order.id)]){ const hint = document.createElement('div'); hint.style.fontSize='12px'; hint.style.color='var(--muted)'; hint.textContent = 'Pendiente: sincronizando con servidor'; body.appendChild(hint); } }catch(_){ }
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
}

// close order modal
const orderModalClose = document.getElementById('orderModalClose'); if(orderModalClose) orderModalClose.onclick = () => { const m = document.getElementById('orderModal'); if(m){ m.classList.add('hidden'); m.setAttribute('aria-hidden','true'); } };

async function refreshOrders(source){
  try{
    source = 'web';
    const q = (orderSearch_web && orderSearch_web.value) ? orderSearch_web.value.trim() : '';
    const date = (orderDate_web && orderDate_web.value) ? orderDate_web.value : '';
    const list = await fetchOrders(q, date, source);
    if (list === null){
      console.warn('refreshOrders: fetch failed; preserving existing orders table');
      showToast('No se pudo actualizar pedidos (conservando la vista actual)', 'warning');
      return;
    }
    if (!q && !date) updateOrderAlertCounts(list);
    syncPreparationsSnapshot(list);
    const dateFilter = date || '';
    let toRender = list;
    if(dateFilter){ try{ toRender = (list || []).filter(o => { try{ return (o.created_at || '').slice(0,10) === dateFilter; }catch(_){ return false; } }); }catch(e){ toRender = list; } }
    lastOrdersBaseWeb = Array.isArray(toRender) ? toRender.slice() : [];
    updateOrdersCustomerTypeBadges(lastOrdersBaseWeb);
    applyOrdersCustomerTypeTabState();
    renderOrders(toRender, source, date);
    if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
  }catch(e){ console.error('refreshOrders failed', e); showToast('Error al cargar pedidos', 'error'); }
}

// Wire refresh buttons per-section and add a single test push button
const anchorForTest = document.querySelector('#refreshOrdersBtn_web');
if(refreshOrdersBtn_web) refreshOrdersBtn_web.addEventListener('click', ()=> refreshOrders('web'));
if(markAllSeenBtn_web) markAllSeenBtn_web.addEventListener('click', async ()=> {
  const ids = collectBulkActionIds('#ordersTable_web .markSeenBtn[data-id]');
  await runBulkOrderStatusUpdate(ids, 'visto', markAllSeenBtn_web, {
    progressLabel: 'Marcando vistos',
    emptyMessage: 'No hay pedidos visibles para marcar como vistos.',
    successSuffix: 'vistos',
  });
});
try{
  const testBtn = document.createElement('button'); testBtn.id = 'testPushBtn'; testBtn.className = 'btn'; testBtn.style.marginLeft = '8px'; testBtn.textContent = 'Probar evento WS';
  if(anchorForTest && anchorForTest.parentNode) anchorForTest.parentNode.appendChild(testBtn); else document.body.appendChild(testBtn);
  testBtn.addEventListener('click', async ()=>{
    testBtn.disabled = true; testBtn.textContent = 'Enviando...';
    try{
      const sample = { items:[{id:'debug-sample', qty:1, meta:{name:'Pedido Test', price:1}}], total:1, created_at: new Date().toISOString() };
      try{ await safeFetch(API_BASE + '/debug/push-order', { method: 'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(sample) }); }catch(e){ throw new Error('push failed'); }
      showToast('Evento enviado (revisa tabla)');
    }catch(e){ console.error('testPush failed', e); showToast('Error enviando evento','error'); }
    finally{ testBtn.disabled = false; testBtn.textContent = 'Probar evento WS'; }
  });
}catch(e){ console.warn('Could not add test push button', e); }

// wire search/date inputs per-section
if(orderSearch_web) orderSearch_web.addEventListener('input', ()=> refreshOrders('web'));
if(orderDate_web) orderDate_web.addEventListener('change', ()=> refreshOrders('web'));
if(clearOrderDate_web) clearOrderDate_web.addEventListener('click', ()=> { if(orderDate_web) orderDate_web.value = ''; refreshOrders('web'); });
if(preparationsSearch) preparationsSearch.addEventListener('input', ()=> renderPreparations(lastPreparationsBase));
if(preparationsDate) preparationsDate.addEventListener('change', ()=> renderPreparations(lastPreparationsBase));
if(filterPreparationsTomorrowBtn) filterPreparationsTomorrowBtn.addEventListener('click', ()=> {
  const tomorrowKey = getTomorrowIsoDateKey();
  if(preparationsDate && tomorrowKey) preparationsDate.value = tomorrowKey;
  renderPreparations(lastPreparationsBase);
});
if(clearPreparationsDate) clearPreparationsDate.addEventListener('click', ()=> { if(preparationsDate) preparationsDate.value = ''; renderPreparations(lastPreparationsBase); });
if(markAllPreparedBtn) markAllPreparedBtn.addEventListener('click', async ()=> {
  const ids = collectBulkActionIds('.prepMarkPreparedBtn[data-id]', preparationsList || document);
  await runBulkOrderStatusUpdate(ids, 'preparado', markAllPreparedBtn, {
    progressLabel: 'Marcando preparados',
    emptyMessage: 'No hay pedidos visibles para marcar como preparados.',
    successSuffix: 'preparados',
  });
});
if(refreshPreparationsBtn) refreshPreparationsBtn.addEventListener('click', ()=> refreshPreparations(true));

// Tabs and badges wiring (web only)
const ordersSection = document.getElementById('orders');
const tabWebBtn = document.getElementById('tab_web');
const badgeWeb = document.getElementById('badge_web');
const clearOrderCacheBtn = document.getElementById('clearOrderCache');
const customersSection = document.getElementById('customers');
const customersTableBody = document.querySelector('#customersTable tbody');
const customersMonthInput = document.getElementById('customersMonth');
const customersSearchInput = document.getElementById('customersSearch');
const customersActiveOnlyToggle = document.getElementById('customersActiveOnly');
const refreshCustomersBtn = document.getElementById('refreshCustomersBtn');
const customersActiveCountEl = document.getElementById('customersActiveCount');
const customersOrdersCountEl = document.getElementById('customersOrdersCount');
const customersRevenueTotalEl = document.getElementById('customersRevenueTotal');
const customersNoteEl = document.getElementById('customersNote');

let lastCustomersBase = [];
let lastCustomersMonthKey = '';
let lastCustomersOrdersMeta = { totalOrders: 0, limit: 0 };
let lastCustomersOrdersRaw = [];

function showTab(){
  try{
    const webSec = document.getElementById('orders_web');
    if(webSec) webSec.classList.remove('hidden');
    if(tabWebBtn) tabWebBtn.classList.add('active');
    refreshOrders('web');
  }catch(e){ console.warn('showTab failed', e); }
}

if(tabWebBtn) tabWebBtn.addEventListener('click', ()=> showTab());
if(clearOrderCacheBtn) clearOrderCacheBtn.addEventListener('click', ()=>{ try{ localStorage.removeItem('admin_local_orders_v1'); window.__localOrderRows = {}; window.__localOrderIds = new Set(); showToast('Cache local de pedidos limpiada', 'info'); refreshOrders('web'); }catch(e){ console.warn('clearOrderCache failed', e); showToast('No se pudo limpiar cache','error'); } });
if(customersMonthInput) customersMonthInput.addEventListener('change', ()=> recomputeCustomersFromOrders());
if(customersSearchInput) customersSearchInput.addEventListener('input', ()=> renderCustomersFromCache());
if(customersActiveOnlyToggle) customersActiveOnlyToggle.addEventListener('change', ()=> renderCustomersFromCache());
if(refreshCustomersBtn) refreshCustomersBtn.addEventListener('click', ()=> refreshCustomers(true));
ensureCustomersMonthDefault();

function setOrdersCustomerType(type){
  currentOrderCustomerType = normalizeOrderCustomerType(type);
  applyOrdersCustomerTypeTabState();
  if(Array.isArray(lastOrdersBaseWeb) && lastOrdersBaseWeb.length){
    renderOrders(lastOrdersBaseWeb, 'web', (orderDate_web && orderDate_web.value) ? orderDate_web.value : '');
  }else{
    refreshOrders('web');
  }
}

if (ordersTypeTabMayorista) ordersTypeTabMayorista.addEventListener('click', () => setOrdersCustomerType('mayorista'));
if (ordersTypeTabMinorista) ordersTypeTabMinorista.addEventListener('click', () => setOrdersCustomerType('minorista'));
applyOrdersCustomerTypeTabState();

function updateBadgeCount(source){
  try{
    const table = document.querySelector(`#ordersTable_${source} tbody`);
    if(!table) return;
    const count = table.querySelectorAll('tr td .order-card-vertical').length;
    if(source === 'web' && badgeWeb) badgeWeb.textContent = String(count);
  }catch(e){ console.warn('updateBadgeCount failed', e); }
}

async function openModal(){
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false');
  document.getElementById('modalTitle').textContent = currentEditId ? 'Editar producto' : 'Nuevo producto';
  // Populate category checkboxes for new product modal (best-effort)
  try{
    // Ensure filters are synced from server/local snapshot before rendering
    await fetchAndSyncProductCategories().catch(()=>null);
    const filters = loadFilters();
    if (!currentEditId) {
      renderCategoryCheckboxes(filters, []);
    }
  }catch(e){ console.warn('openModal: failed to populate categories', e); }
  try{ syncProductUnitFields(); }catch(_){ }
  setTimeout(()=> productForm.name.focus(), 120);
}
function closeModal(){
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); currentEditId = null; imageUrl = null; selectedFile = null; fileNameEl.textContent = 'Ningun archivo seleccionado'; imagePreview.innerHTML = ''; try{ if(imageUrlInput) imageUrlInput.value = ''; }catch(_){ } productForm.reset(); try{ if(productForm.sale_unit) productForm.sale_unit.value = 'unit'; }catch(_){ } try{ if(productForm.kg_per_unit) productForm.kg_per_unit.value = '1'; }catch(_){ } try{ syncProductUnitFields(); }catch(_){ } validateForm();
}
// Close modal when clicking outside the modal card
if(modal) modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
if(historyModal) historyModal.addEventListener('click', e => { if(e.target === historyModal) closeHistoryModal(); });
if(historyModalClose) historyModalClose.onclick = () => closeHistoryModal();
// Close on ESC key
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  try{ if (historyModal && !historyModal.classList.contains('hidden')) { closeHistoryModal(); return; } }catch(_){ }
  try{ if (!modal.classList.contains('hidden')) closeModal(); }catch(_){ }
});

// Enable validation
if(productForm) productForm.addEventListener('input', validateForm);
if(saleUnitSelect) saleUnitSelect.addEventListener('change', ()=>{ syncProductUnitFields(); validateForm(); });
try{ syncProductUnitFields(); }catch(_){ }

// Promotions persistence helpers
function loadPromotions(){
  try{ const raw = localStorage.getItem(PROMO_KEY) || '[]'; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }catch(e){ console.warn('loadPromotions failed', e); return []; }
}
function savePromotions(promos){
  try{ localStorage.setItem(PROMO_KEY, JSON.stringify(promos || [])); }catch(e){ console.warn('savePromotions failed', e); }
}

function normalizePromotionsList(list){
  if(!Array.isArray(list)) return [];
  return list.map((p, idx) => {
    if(!p || typeof p !== 'object') return null;
    const name = String(p.name || '').trim();
    if(!name) return null;
    const rawProductIds = Array.isArray(p.productIds) ? p.productIds : (Array.isArray(p.product_ids) ? p.product_ids : []);
    const productIds = rawProductIds
      .map((idVal) => {
        const n = Number(idVal);
        return Number.isFinite(n) ? n : null;
      })
      .filter((n) => n != null);
    const type = String(p.type || 'percent').trim() || 'percent';
    const value = (p.value == null || p.value === '') ? null : Number(p.value);
    return {
      id: p.id != null ? p.id : `promo_${Date.now()}_${idx}`,
      name,
      description: p.description != null ? String(p.description) : '',
      productIds,
      type,
      value: Number.isFinite(value) ? value : null,
      valid_until: p.valid_until || p.validUntil || null,
    };
  }).filter(Boolean);
}

function extractPromotionsArray(payload){
  if(Array.isArray(payload)) return payload;
  if(payload && Array.isArray(payload.promotions)) return payload.promotions;
  if(payload && Array.isArray(payload.data)) return payload.data;
  return null;
}

async function fetchAndSyncPromotionsFromServer(){
  const tryUrls = [
    `${API_BASE}/promotions`,
    `${API_BASE}/catalogo/promotions.json`,
    '/promotions',
    '/catalogo/promotions.json',
  ];
  for(const url of tryUrls){
    try{
      const payload = await safeFetch(url, { cache: 'no-store' }).catch((err) => {
        console.warn('fetch promotions failed for', url, err);
        return null;
      });
      const rawList = extractPromotionsArray(payload);
      if(!Array.isArray(rawList)) continue;
      const normalized = normalizePromotionsList(rawList);
      savePromotions(normalized);
      return normalized;
    }catch(e){
      console.warn('fetchAndSyncPromotionsFromServer error for', url, e);
    }
  }
  return loadPromotions();
}

function parsePromoDate(value){
  if (!value) return null;
  try{
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.endsWith('Z') ? raw : raw.replace(' ', 'T');
    const dt = new Date(normalized);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  }catch(_){ return null; }
}

function promoInputToIso(value){
  const dt = parsePromoDate(value);
  return dt ? dt.toISOString() : null;
}

function isoToPromoInput(value){
  const dt = parsePromoDate(value);
  if (!dt) return '';
  const local = new Date(dt.getTime() - (dt.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function formatPromoValidity(value){
  const dt = parsePromoDate(value);
  if (!dt) return '<span class="muted">Sin vencimiento</span>';
  return dt.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function isPromoExpired(value){
  const dt = parsePromoDate(value);
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

function renderPromotions(){
  try{
    const promos = loadPromotions();
    if(!promotionsTableBody) return;
    promotionsTableBody.innerHTML = '';
    for(const p of (promos || [])){
      const validity = formatPromoValidity(p.valid_until);
      const expiredClass = isPromoExpired(p.valid_until) ? ' style="color:#b42318;font-weight:700"' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.type || ''}${p.type === 'percent' && p.value ? ' ('+p.value+'%)' : ''}</td><td${expiredClass}>${validity}</td><td>${(p.productIds||[]).length}</td><td><button data-id="${p.id}" class="editPromo btn">Editar</button><button data-id="${p.id}" class="delPromo btn">Eliminar</button></td>`;
      promotionsTableBody.appendChild(tr);
    }
    document.querySelectorAll('.delPromo').forEach(btn => btn.onclick = () => { deletePromotion(btn.dataset.id); });
    document.querySelectorAll('.editPromo').forEach(btn => btn.onclick = () => { editPromotion(btn.dataset.id); });
  }catch(e){ console.warn('renderPromotions failed', e); }
}

// Filters persistence and UI (admin)
function loadFilters(){
  try{ const raw = localStorage.getItem(FILTERS_KEY) || '[]'; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }catch(e){ console.warn('loadFilters failed', e); return []; }
}
function normalizeFiltersList(list){
  if(!Array.isArray(list)) return [];
  return list.map((f, idx) => {
    if(typeof f === 'string'){
      const name = String(f).trim();
      if(!name) return null;
      return { id: `f_${idx}_${name.toLowerCase()}`, name, value: name.toLowerCase() };
    }
    if(!f || typeof f !== 'object') return null;
    const name = String(f.name || f.label || f.value || f.id || '').trim();
    const valueRaw = String(f.value || name).trim();
    if(!name || !valueRaw) return null;
    return {
      id: f.id != null ? f.id : `f_${idx}_${valueRaw.toLowerCase()}`,
      name,
      value: valueRaw.toLowerCase(),
    };
  }).filter(Boolean);
}

function saveFilters(filters, options){
  const opts = options || {};
  const shouldPublish = opts.publish !== false;
  const normalized = normalizeFiltersList(filters || []);
  try{ localStorage.setItem(FILTERS_KEY, JSON.stringify(normalized)); }catch(e){ console.warn('saveFilters failed', e); }
  if(!shouldPublish) return;
  try{ publishFilters(normalized); }catch(e){ console.warn('publishFilters failed', e); }
}

function extractFiltersArray(payload){
  if(Array.isArray(payload)) return payload;
  if(payload && Array.isArray(payload.filters)) return payload.filters;
  if(payload && Array.isArray(payload.data)) return payload.data;
  return null;
}

async function fetchAndSyncFiltersFromServer(){
  const tryUrls = [
    `${API_BASE}/filters.json`,
    `${API_BASE}/filters`,
    '/filters.json',
    '/filters',
  ];
  for(const url of tryUrls){
    try{
      const payload = await safeFetch(url, { cache: 'no-store' }).catch((err) => {
        console.warn('fetch filters failed for', url, err);
        return null;
      });
      const rawList = extractFiltersArray(payload);
      if(!Array.isArray(rawList)) continue;
      const normalized = normalizeFiltersList(rawList);
      saveFilters(normalized, { publish: false });
      return normalized;
    }catch(e){
      console.warn('fetchAndSyncFiltersFromServer error for', url, e);
    }
  }
  return loadFilters();
}

function prettifyFilterName(raw){
  const text = String(raw || '').trim();
  if(!text) return '';
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function deriveFiltersFromProducts(products){
  const rows = Array.isArray(products) ? products : [];
  const seen = new Set();
  const out = [];
  for(const p of rows){
    const value = String((p && p.category) || '').trim().toLowerCase();
    if(!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      id: `auto_${value}`,
      name: prettifyFilterName(value),
      value,
    });
  }
  return normalizeFiltersList(out);
}

async function seedFiltersFromProductsIfMissing(){
  const existing = loadFilters();
  if(Array.isArray(existing) && existing.length > 0) return existing;
  try{
    const products = await ensureAllProductsCache({ force: true }).catch(() => []);
    const derived = deriveFiltersFromProducts(products);
    if(Array.isArray(derived) && derived.length > 0){
      saveFilters(derived);
      return derived;
    }
  }catch(e){
    console.warn('seedFiltersFromProductsIfMissing failed', e);
  }
  return loadFilters();
}

// Publish filters to server so the public catalog (possibly on a different origin)
// can fetch them from /filters.json. This is best-effort and failures are non-fatal.
async function publishFilters(filters){
  try{
    const url = `${API_BASE}/filters`;
    try{
      const resp = await safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters || []) });
      // safeFetch will throw on non-ok
      return resp;
    }catch(e){
      console.warn('publishFilters: server returned or failed', e);
    }
  }catch(e){ console.warn('publishFilters failed', e); }
}

// Product categories persistence helpers (productKey -> [filterValue,...])
function loadProductCategories(){
  try{ const raw = localStorage.getItem(PRODUCT_CATEGORIES_KEY) || '{}'; const parsed = JSON.parse(raw); return (parsed && typeof parsed === 'object') ? parsed : {}; }catch(e){ console.warn('loadProductCategories failed', e); return {}; }
}
async function fetchAndSyncProductCategories(){
  const tryUrls = [`${API_BASE}/product-categories.json`, `${API_BASE}/admin/product-categories.json`, '/product-categories.json', '/admin/product-categories.json'];
  for(const url of tryUrls){
    try{
      const data = await safeFetch(url, { cache: 'no-store' }).catch(err => { console.warn('fetch product-categories failed for', url, err); return null; });
      if(data && typeof data === 'object'){
        try{ localStorage.setItem(PRODUCT_CATEGORIES_KEY, JSON.stringify(data)); }catch(e){ console.warn('failed to write product categories to localStorage', e); }
        return data;
      }
    }catch(e){ console.warn('fetchAndSyncProductCategories inner error', e); }
  }
  // If no categories file found, attempt to seed filters from admin static filters.json
  try{
    const furls = [`${API_BASE}/admin/filters.json`, `${API_BASE}/filters.json`, '/admin/filters.json', '/filters.json'];
    for(const fu of furls){
      try{
        const fdata = await safeFetch(fu, { cache: 'no-store' }).catch(()=>null);
        if(Array.isArray(fdata) && fdata.length){
          // Normalize to simple array of values if file uses strings, or objects with id/label
          const norms = fdata.map(x => {
            if(typeof x === 'string') return { id: x, name: x, value: String(x).toLowerCase() };
            if(x && typeof x === 'object') return { id: x.id || x.value || x.name, name: x.name || x.label || x.value, value: x.value || (x.name ? String(x.name).toLowerCase() : String(x.id || '').toLowerCase()) };
            return null;
          }).filter(Boolean);
          // persist as filters and also as product-categories mapping (values)
          try{ localStorage.setItem(FILTERS_KEY, JSON.stringify(norms)); }catch(e){ }
          const vals = norms.map(n => n.value);
          try{ localStorage.setItem(PRODUCT_CATEGORIES_KEY, JSON.stringify(vals)); }catch(e){}
          return vals;
        }
      }catch(e){ }
    }
  }catch(e){ }
  return loadProductCategories();
}

async function publishProductCategories(mapping){
  try{
    const url = `${API_BASE}/product-categories`;
    try{ await safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mapping || {}) }); }catch(e){ console.warn('publishProductCategories failed', e); }
  }catch(e){ console.warn('publishProductCategories failed', e); }
}

async function saveProductCategories(mapping){
  try{
    localStorage.setItem(PRODUCT_CATEGORIES_KEY, JSON.stringify(mapping || {}));
  }catch(e){ console.warn('saveProductCategories localStorage failed', e); }
  try{ await publishProductCategories(mapping); }catch(e){ console.warn('saveProductCategories publish failed', e); }
  try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('product_categories_channel'); bc.postMessage({ action: 'product-categories-updated', mapping }); bc.close(); } }catch(e){ console.warn('BroadcastChannel product-categories send failed', e); }
}

// Render filters as checkboxes for product modal
function renderCategoryCheckboxes(filters, assignedList){
  try{
    const container = document.getElementById('categoryCheckboxes');
    if(!container) return;
    container.innerHTML = '';
    (filters || []).forEach(f => {
      // Support filter shapes: {id,name,value,label} or simple strings
      const rawVal = (typeof f === 'string') ? f : (f.value || f.name || f.label || f.id || '');
      const rawName = (typeof f === 'string') ? f : (f.name || f.label || f.value || f.id || '');
      const cleanVal = String(rawVal || '').replace(/[^a-z0-9_-]/gi,'_');
      const id = `pc_${String(rawVal)}_${cleanVal}`;
      const div = document.createElement('label');
      div.className = 'pc-item';
      div.setAttribute('for', id);
      div.innerHTML = `
        <input id="${id}" type="checkbox" value="${escapeHtml(rawVal)}">
        <span class="pc-pill">
          <span class="pc-name">${escapeHtml(rawName)}</span>
          <span class="pc-ind" aria-hidden="true"></span>
        </span>
      `;
      const input = div.querySelector('input[type=checkbox]');
      if(input && Array.isArray(assignedList) && assignedList.some(x => String(x).toLowerCase() === String(input.value).toLowerCase())) input.checked = true;
      container.appendChild(div);
    });
  }catch(e){ console.warn('renderCategoryCheckboxes failed', e); }
}
function renderFilters(){
  try{
    const filters = loadFilters();
    if(!filtersTableBody) return;
    filtersTableBody.innerHTML = '';
    for(const f of (filters || [])){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.value)}</td><td><button data-id="${f.id}" class="editFilter btn">Editar</button><button data-id="${f.id}" class="delFilter btn">Eliminar</button></td>`;
      filtersTableBody.appendChild(tr);
    }
    document.querySelectorAll('.delFilter').forEach(btn => btn.onclick = () => { deleteFilter(btn.dataset.id); });
    document.querySelectorAll('.editFilter').forEach(btn => btn.onclick = () => { editFilter(btn.dataset.id); });
  }catch(e){ console.warn('renderFilters failed', e); }
}
function addFilter(name){
  try{
    const filters = loadFilters();
    const value = (name || '').trim(); if(!value) return;
    const f = { id: Date.now(), name: value, value: value.toLowerCase() };
    filters.push(f);
    saveFilters(filters);
    renderFilters();
    showToast('Filtro agregado');
    // broadcast to public catalog
    try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('filters_channel'); bc.postMessage({ action: 'filters-updated', filters }); bc.close(); } }catch(e){ console.warn('BroadcastChannel filters send failed', e); }
  }catch(e){ console.warn('addFilter failed', e); }
}
function deleteFilter(id){
  if(!confirm('Eliminar filtro?')) return;
  try{ let filters = loadFilters(); filters = filters.filter(f => String(f.id) !== String(id)); saveFilters(filters); renderFilters(); showToast('Filtro eliminado'); try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('filters_channel'); bc.postMessage({ action: 'filters-updated', filters }); bc.close(); } }catch(e){ console.warn('BroadcastChannel filters send failed', e); } }catch(e){ console.warn('deleteFilter failed', e); }
}
function editFilter(id){
  try{
    const filters = loadFilters(); const f = filters.find(x=> String(x.id) === String(id)); if(!f) return;
    // Inline edit: replace the table row cells with an input and save/cancel buttons
    const row = filtersTableBody.querySelector(`button.editFilter[data-id='${id}']`)?.closest('tr');
    if(!row) return;
    const nameCell = row.children[0]; const valueCell = row.children[1]; const actionsCell = row.children[2];
    nameCell.innerHTML = `<input class="edit-filter-input" value="${escapeHtml(f.name)}" />`;
    valueCell.innerHTML = `<input class="edit-filter-value" value="${escapeHtml(f.value)}" />`;
    actionsCell.innerHTML = `<button class="btn saveEdit">Guardar</button> <button class="btn cancelEdit">Cancelar</button>`;
    const input = nameCell.querySelector('.edit-filter-input'); const valueInput = valueCell.querySelector('.edit-filter-value');
    actionsCell.querySelector('.cancelEdit').onclick = () => { renderFilters(); };
    actionsCell.querySelector('.saveEdit').onclick = () => {
      const newName = input.value.trim(); const newValue = valueInput.value.trim() || newName.toLowerCase();
      if(!newName) return showToast('El nombre no puede estar vacío','error');
      f.name = newName; f.value = newValue;
      saveFilters(filters); renderFilters(); showToast('Filtro actualizado');
      try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('filters_channel'); bc.postMessage({ action: 'filters-updated', filters }); bc.close(); } }catch(e){ console.warn('BroadcastChannel filters send failed', e); }
    };
  }catch(e){ console.warn('editFilter failed', e); }
}
if(addFilterBtn) addFilterBtn.addEventListener('click', ()=>{ try{ const name = (filterNameInput && filterNameInput.value) ? filterNameInput.value.trim() : ''; if(!name){ showToast('Escribe el nombre del filtro','warning'); return; } addFilter(name); if(filterNameInput) filterNameInput.value=''; }catch(e){ console.warn('addFilter click failed', e); } });
// allow pressing Enter inside the input to add a filter
if(filterNameInput) filterNameInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); try{ const name = (filterNameInput && filterNameInput.value) ? filterNameInput.value.trim() : ''; if(!name){ showToast('Escribe el nombre del filtro','warning'); return; } addFilter(name); if(filterNameInput) filterNameInput.value=''; }catch(err){ console.warn('addFilter enter failed', err); } } });

if(importFiltersBtn) importFiltersBtn.addEventListener('click', async ()=>{
  try{
    const f = await safeFetch(`${API_BASE}/filters.json`).catch(()=>null);
    const rawFilters = extractFiltersArray(f);
    if(Array.isArray(rawFilters)){
      const normalized = normalizeFiltersList(rawFilters);
      saveFilters(normalized);
      renderFilters();
      showToast('Filtros importados');
      try{
        if(window.BroadcastChannel){
          const bc = new BroadcastChannel('filters_channel');
          bc.postMessage({ action: 'filters-updated', filters: normalized });
          bc.close();
        }
      }catch(_){}
    } else {
      showToast('Archivo de filtros inválido o no encontrado','error');
    }
  }catch(e){
    console.error('importFilters failed', e);
    showToast('Error importando filtros','error');
  }
});

// Listen for product-categories broadcast updates
try{ if(window.BroadcastChannel){ const bcpc = new BroadcastChannel('product_categories_channel'); bcpc.onmessage = (ev) => { try{ if(ev.data && ev.data.action === 'product-categories-updated'){ console.log('[admin] product-categories updated via BroadcastChannel'); fetchAndSyncProductCategories().then(()=>refresh()).catch(()=>refresh()); } }catch(e){} }; } }catch(e){}

async function bootstrapAdmin(){
  try{ await ensureApiBase(); }catch(e){ console.warn('ensureApiBase failed', e); }
  // Pull latest server snapshots first so a fresh browser does not start empty.
  try{ await fetchAndSyncFiltersFromServer(); }catch(e){ console.warn('initial filters sync failed', e); }
  // If server has no filters snapshot yet, seed from current product categories.
  try{ await seedFiltersFromProductsIfMissing(); }catch(e){ console.warn('initial filter seed failed', e); }
  try{ await fetchAndSyncPromotionsFromServer(); }catch(e){ console.warn('initial promotions sync failed', e); }
  // ensure filters UI is initialized
  try{ renderFilters(); }catch(e){ console.warn('initial renderFilters failed', e); }
  try{ renderPromotions(); }catch(e){ console.warn('initial renderPromotions failed', e); }
  // fetch product-categories snapshot (best-effort)
  try{ await fetchAndSyncProductCategories(); console.log('[admin] product-categories synced'); }catch(e){ console.warn('initial fetchAndSyncProductCategories failed', e); }
  // initial load
  try{ await refresh(); }catch(e){ console.warn('initial refresh failed', e); }
  // restore any locally-inserted order previews (persisted across reloads)
  try{ loadLocalOrderCache(); }catch(e){ console.warn('loadLocalOrderCache failed', e); }
  try{ loadOrderMapsCoordCache(); }catch(e){ console.warn('loadOrderMapsCoordCache failed', e); }
  try{ await refreshOrders('web'); }catch(e){ console.warn('refreshOrders web failed', e); }
  try{ startAutoImageProgressPolling(); }catch(e){ console.warn('auto image polling failed', e); }
}
bootstrapAdmin();

// Cleanup any duplicate rows that may already be present across tables.
function dedupeDOMOrders(){
  try{
    const rows = Array.from(document.querySelectorAll('table[id^="ordersTable"] tbody tr')).filter(r => !r.classList.contains('orders-day-header') && !(r.querySelector && r.querySelector('.empty-note')));
    const byId = new Map();
    for(const r of rows){
      try{
        const id = String((r.children && r.children[0] && r.children[0].textContent) || '').trim();
        if(!id) continue;
        const createdText = (r.children && r.children[6] && r.children[6].textContent) ? r.children[6].textContent.trim() : '';
        const createdTs = createdText ? (new Date(createdText)).getTime() : 0;
          if(!byId.has(id)) { byId.set(id, { row: r, ts: createdTs }); }
          else {
            const prev = byId.get(id);
            try{
              // Si alguna fila es local/pending, conservarla hasta que sincronice
              const prevIsLocal = prev.row.getAttribute && prev.row.getAttribute('data-local-insert');
              const currIsLocal = r.getAttribute && r.getAttribute('data-local-insert');
              if(prevIsLocal){
                // nunca borrar ni reemplazar filas locales pendientes
                try{ r.parentNode && r.parentNode.removeChild(r); }catch(_){ }
                continue;
              }
              if(currIsLocal){
                // nunca borrar ni reemplazar filas locales pendientes
                try{ prev.row.parentNode && prev.row.parentNode.removeChild(prev.row); }catch(_){ }
                byId.set(id, { row: r, ts: createdTs });
                continue;
              }
              // Si ninguna es local, preferir la más reciente
              if((createdTs || 0) > (prev.ts || 0)){
                try{ prev.row.parentNode && prev.row.parentNode.removeChild(prev.row); }catch(_){ }
                byId.set(id, { row: r, ts: createdTs });
              } else {
                try{ r.parentNode && r.parentNode.removeChild(r); }catch(_){ }
              }
            }catch(_){
              try{ r.parentNode && r.parentNode.removeChild(r); }catch(_){ }
            }
          }
      }catch(_){ }
    }
  }catch(e){ console.warn('dedupeDOMOrders failed', e); }
}
try{ dedupeDOMOrders(); }catch(_){ }

// Regroup rows in a table by their created_at date (places rows under correct day headers)
function regroupOrdersForTable(source){
  try{
    const tableId = `ordersTable_${source}`;
    const tbody = document.querySelector(`#${tableId} tbody`);
    if(!tbody) return;
    // collect data rows (ignore day headers and empty-note rows)
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => !r.classList.contains('orders-day-header') && !(r.querySelector && r.querySelector('.empty-note')));
    const groups = new Map();
    for(const r of rows){
      try{
        const createdText = (r.children && r.children[6] && r.children[6].textContent) ? r.children[6].textContent.trim() : '';
        let d = createdText ? new Date(createdText) : new Date();
        if(isNaN(d.getTime())) d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if(!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ row: r, ts: d.getTime() });
      }catch(_){ }
    }
    // sort keys desc
    const sortedKeys = Array.from(groups.keys()).sort((a,b) => (a<b?1:-1));
    // clear body and rebuild grouped
    tbody.innerHTML = '';
    for(const key of sortedKeys){
      const items = groups.get(key) || [];
      // create header
      try{
        const parts = key.split('-'); const lab = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const dayText = lab.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        const hdr = document.createElement('tr'); hdr.className = 'orders-day-header'; hdr.setAttribute('data-day', key);
        const hdrLabel = document.createElement('td'); hdrLabel.setAttribute('colspan','8'); hdrLabel.innerHTML = `<div class="day-label">${escapeHtml(dayText)} <span class="badge-pill">${items.length}</span></div>`;
        hdr.appendChild(hdrLabel);
        tbody.appendChild(hdr);
      }catch(_){ }
      // append rows sorted by timestamp desc
      try{ items.sort((a,b)=> b.ts - a.ts); for(const it of items){ tbody.appendChild(it.row); } }catch(_){ for(const it of items){ tbody.appendChild(it.row); } }
    }
  }catch(e){ console.warn('regroupOrdersForTable failed', e); }
}

// Add periodic polling as a fallback so the orders table refreshes even if WS fails
try{
  setInterval(()=>{ refreshOrders('web'); }, 10000); // every 10s
}catch(e){ console.warn('orders polling setup failed', e); }

// websocket to refresh list live with reconnection/backoff
function setupSocket(attempt = 0){
  if(!location.protocol || !location.protocol.startsWith('http')) return;
  const proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
  const wsUrl = `${proto}${location.host}/ws/products`;
  let socket;
  try{ socket = new WebSocket(wsUrl); }catch(e){ socket = null; }
  if(!socket){ const delay = Math.min(30000, Math.pow(2, attempt) * 1000 + Math.random()*1000); setTimeout(()=> setupSocket(attempt + 1), delay); return; }
  socket.onopen = () => { console.log('Admin WS connected'); if(wsStatus){ wsStatus.classList.add('connected'); wsStatus.classList.remove('disconnected'); wsStatus.title = 'Conectado'; } };
  socket.onclose = () => { console.log('Admin WS closed, retrying'); if(wsStatus){ wsStatus.classList.remove('connected'); wsStatus.classList.add('disconnected'); wsStatus.title = 'Desconectado'; } const delay = Math.min(30000, Math.pow(2, attempt) * 1000 + Math.random()*1000); setTimeout(()=> setupSocket(attempt + 1), delay); };
  socket.onerror = (err) => console.error('Admin WS error', err);
  socket.onmessage = async (ev) => {
    try{
      const data = JSON.parse(ev.data);
      if (data && data.action === 'driver_location_offline'){
        const driver = data.driver || data;
        const id = getDriverId(driver);
        if (id) removeDriverMarkerById(id);
        if (driverMapMarkers.size === 0){
          setDriverMapEmpty('Sin ubicaciones recientes de repartidores.');
        }
        return;
      }
      if (data && data.action === 'driver_location' && data.driver){
        try{ updateDriverMarker(data.driver); }catch(_){ }
        return;
      }
      if(['created','updated','deleted'].includes(data.action)){
        refresh(); showToast(`Evento: ${data.action}`);
      }
      if(data.action && data.action.indexOf && data.action.indexOf('order') === 0){
        // Debug: show raw event payload in console so we can inspect user_* fields
        try{ console.debug('[admin WS] order event received', data); }catch(_){ }
        // If the server sent the full order object, insert it only if source is correcto
        if(data.action === 'order_created' && data.order){
          try{
            // Si no hay source, default a web
            if(!data.order.source){ data.order.source = 'web'; }
            // Solo insertar pedidos web en el panel web-only
            const src = String(data.order.source).toLowerCase();
            if(src === 'web') {
              insertOrderAtTop(data.order);
              showToast(`Pedido recibido: #${data.order.id}`);
            }
            return;
          }catch(e){ console.warn('insertOrderAtTop failed, falling back to full refresh', e); }
        }
        // If no full order object was provided, request it specifically by id to avoid race with full list refreshes
        try{
          if(data.action === 'order_created' && data.id){
            (async ()=>{
              const id = String(data.id);
              try{
                const list = await fetchOrders(String(id));
                if(Array.isArray(list) && list.length > 0){
                  // server has the record; solo insertar si es web
                  try{
                    const srv = list[0];
                    if(srv && srv.source === 'web'){
                      insertOrderAtTop(srv);
                      try{ showToast(`Pedido recibido: #${srv.id}`); }catch(_){ }
                    }
                  }catch(_){ }
                } else {
                  // fallback: full refresh web table
                  refreshOrders('web');
                }
              }catch(e){ console.warn('fetch by id after ws event failed', e); refreshOrders('web'); }
            })();
            return;
          }
        }catch(e){ console.warn('post-ws fetch-by-id handling failed', e); }
      }
      const closeBtn = document.getElementById('closePromoFallback'); if(closeBtn) closeBtn.onclick = ()=> { fm.remove(); };
      // if snapshot file exists, we can load products and show, but avoid blocking
      try{ const resp = await fetch('../catalogo/products.json'); if(resp.ok){ const items = await resp.json(); const list = (items && items.length) ? items.map(i=> `<div>${i.name}</div>`).join('') : 'Ninguno'; const _pf = document.getElementById('promoProductsFallback'); if(_pf) _pf.innerHTML = list; } }catch(e){}
      return;
    }catch(e){ console.error('[admin] failed to create fallback modal', e); showToast('No se pudo abrir el modal y el fallback falló', 'error'); return; }
  }
}

// Start websocket connection
try{ setupSocket(); }catch(e){ console.warn('setupSocket start failed', e); }

async function openPromoModal(editId){
  try{
    promoModal.classList.remove('hidden');
    promoModal.setAttribute('aria-hidden','false');
    // ensure the modal appears above other content
    promoModal.style.zIndex = '99999';
    try{ console.log('[admin] promoModal classes after open:', promoModal.className, 'computed-display:', getComputedStyle(promoModal).display, 'zIndex:', getComputedStyle(promoModal).zIndex); }catch(e){}
  }catch(e){ console.error('[admin] error opening promo modal', e); showToast('Error abriendo el modal', 'error'); }
  currentPromotionEditId = editId;
  if(promoName) promoName.value = '';
  if(promoDesc) promoDesc.value = '';
  if(promoType) promoType.value = 'percent';
  if(promoValue) promoValue.value = '';
  if(promoValueField) promoValueField.style.display = 'block';
  if(promoValidUntil) promoValidUntil.value = '';
  if(savePromoBtn) savePromoBtn.disabled = true;
  if(promoProductsList) promoProductsList.innerHTML = 'Cargando productos...';
  let products = [];
  try{ products = await ensureAllProductsCache({ force: true }); }catch(e){ console.warn('ensureAllProductsCache failed', e); }
  if(!products || !products.length){
    // try snapshot file
    try{ const resp = await fetch('../catalogo/products.json'); if(resp.ok){ products = await resp.json(); } }catch(e){}
  }
  allProductsCache = (products || []);
  syncProductLookup(allProductsCache);
  if(!allProductsCache.length){ if(promoProductsList) promoProductsList.innerHTML = '<div class="empty">No se encontraron productos</div>'; }
  else { renderPromoProductsList(allProductsCache); }
  if(editId){
  const promos = loadPromotions(); const p = promos.find(x => x.id == editId); if(p){ if(promoName) promoName.value = p.name; if(promoDesc) promoDesc.value = p.description || ''; if(promoType) promoType.value = p.type || 'percent'; if(promoValue) promoValue.value = (p.value != null ? String(p.value) : ''); if(promoValueField) promoValueField.style.display = (promoType && promoType.value === 'percent') ? 'block' : 'none'; if(promoValidUntil) promoValidUntil.value = isoToPromoInput(p.valid_until); }
    // mark selected products
  setTimeout(()=>{ if(editId){ const promos = loadPromotions(); const p = promos.find(x=> x.id == editId); if(p && promoProductsList){ p.productIds.forEach(pid => { const cb = promoProductsList.querySelector(`input[data-id='${pid}']`); if(cb) cb.checked = true; }); } } try{ updateSavePromoBtn(); }catch(_){ } }, 80);
  }
  // focus first input to make it obvious modal opened
  setTimeout(()=>{ try{ if(promoName) promoName.focus(); }catch(e){} }, 80);
  console.log('[admin] openPromoModal done, products count=', allProductsCache.length);
}
// expose function after declaration so it is always available from console
if(typeof openPromoModal === 'function') window.openPromoModalPublic = openPromoModal;

function closePromoModal(){ promoModal.classList.add('hidden'); promoModal.setAttribute('aria-hidden', 'true'); currentPromotionEditId = null; promoProductsList.innerHTML = ''; }

function renderPromoProductsList(products){ promoProductsList.innerHTML = ''; for(const pr of products){ const div = document.createElement('div'); div.className = 'promo-product-row'; div.innerHTML = `<input type="checkbox" data-id="${pr.id}" id="promo-p-${pr.id}" /><label for="promo-p-${pr.id}">${pr.name} <small class="muted">${pr.category||''}</small></label>`; promoProductsList.appendChild(div); } }

function updateSavePromoBtn(){ const name = promoName.value.trim(); const anyChecked = Array.from(promoProductsList.querySelectorAll('input[type=checkbox]')).some(cb => cb.checked); let ok = (name && anyChecked); try{ if(promoType && promoType.value === 'percent'){ const v = Number(promoValue.value); ok = ok && !isNaN(v) && v > 0; } }catch(e){}; try{ const hasValidUntil = !!promoInputToIso(promoValidUntil && promoValidUntil.value ? promoValidUntil.value : ''); ok = ok && hasValidUntil; }catch(e){}; if(savePromoBtn) savePromoBtn.disabled = !ok; }
// When type is percent, ensure a value is entered
if(promoType) promoType.onchange = () => { try{ if(promoType.value === 'percent'){ if(promoValueField) promoValueField.style.display = 'block'; } else { if(promoValueField) promoValueField.style.display = 'none'; } }catch(e){}; updateSavePromoBtn(); };
if(promoValue) promoValue.oninput = () => { updateSavePromoBtn(); };
if(promoValidUntil) promoValidUntil.oninput = () => { updateSavePromoBtn(); };

function filterPromoProducts(q){ q = (q||'').toLowerCase(); const filtered = allProductsCache.filter(p => !q || p.name.toLowerCase().includes(q) || (p.brand||'').toLowerCase().includes(q)); renderPromoProductsList(filtered); }

async function savePromo(){ const name = promoName.value.trim(); const desc = promoDesc.value.trim(); const checked = Array.from(promoProductsList.querySelectorAll('input[type=checkbox]:checked')).map(cb => Number(cb.getAttribute('data-id'))); if(!name || !checked.length){ return showToast('Agrega nombre y al menos un producto','error'); }
  // compute type and value
  const type = (promoType && promoType.value) ? promoType.value : 'percent';
  const value = (promoValue && promoValue.value) ? Number(promoValue.value) : null;
  const validUntilRaw = promoValidUntil && promoValidUntil.value ? promoValidUntil.value.trim() : '';
  const validUntilIso = promoInputToIso(validUntilRaw);
  if(!validUntilIso){ return showToast('Defini hasta cuando dura la promocion', 'error'); }
  let promos = loadPromotions(); if(currentPromotionEditId){ const idx = promos.findIndex(x=> x.id == currentPromotionEditId); if(idx > -1){ promos[idx].name = name; promos[idx].description = desc; promos[idx].productIds = checked; promos[idx].type = type; promos[idx].value = value; promos[idx].valid_until = validUntilIso; } }else{ const p = { id: Date.now(), name, description: desc, productIds: checked, type, value, valid_until: validUntilIso }; promos.push(p); }
  savePromotions(promos); renderPromotions(); closePromoModal(); showToast('Promoción guardada');
  console.log('[admin] saved promotions to localStorage, count=', (promos || []).length, promos);
  // Broadcast promotions update to other tabs/pages (same-origin)
  try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('promo_channel'); bc.postMessage({ action: 'promotions-updated', promos }); bc.close(); console.log('[admin] broadcasted promotions via BroadcastChannel'); } }catch(e){ console.warn('BroadcastChannel send failed', e); }
  // If API base is available, try to persist the promotions to the server (writes promotions.json snapshot)
  try{
    if(API_BASE && API_BASE.startsWith('http')){
      fetch(API_BASE + '/promotions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(promos) })
        .then(r => { if(r.ok) { showToast('Promociones guardadas en servidor', 'info'); console.log('[admin] server saved promotions ok'); } else { console.warn('Server did not accept promotions', r.status); showToast('No se pudo guardar en servidor', 'error'); } })
        .catch(err => { console.warn('Failed sending promotions to server', err); showToast('Error guardando promos en servidor', 'error'); });
    }
  }catch(e){ console.error('Persist to server error', e); }
}

function deletePromotion(id){
  if(!confirm('Eliminar promoción?')) return;
  let promos = loadPromotions();
  promos = promos.filter(p => p.id != id);
  savePromotions(promos);
  renderPromotions();
  showToast('Promoción eliminada');
  console.log('[admin] deletePromotion: broadcast & persist updated promotions count=', promos.length);
  // Broadcast promotions change so other tabs (catalogo) update
  try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('promo_channel'); bc.postMessage({ action: 'promotions-updated', promos }); bc.close(); console.log('[admin] broadcasted promotions update after delete'); } }catch(e){ console.warn('BroadcastChannel send failed', e); }
  // Persist to server if possible (write snapshot)
  try{ if(API_BASE && API_BASE.startsWith('http')){ fetch(API_BASE + '/promotions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(promos) }) .then(r => { if(r.ok) { console.log('[admin] server saved promotions (post-delete) ok'); } else { console.warn('Server did not accept promotions on delete', r.status); } }) .catch(err => { console.warn('Failed sending promotions to server on delete', err); }); } }catch(e){ console.error('Persist to server error on delete', e); }
}


function editPromotion(id){ openPromoModal(Number(id)); }

// Promo event listeners
if(newPromoBtn){
  // prefer addEventListener and log clicks for debugging
  newPromoBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    console.log('[admin] newPromoBtn clicked', ev);
    try{ openPromoModal(); }catch(e){ console.error('[admin] openPromoModal error', e); }
  });
} else {
  // fallback: delegate from body to catch events if button couldn't be bound (rare)
  document.body.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('#newPromoBtn');
    if(b){ ev.preventDefault(); ev.stopPropagation(); console.log('[admin] delegated newPromoBtn click', ev); try{ openPromoModal(); }catch(e){ console.error('[admin] openPromoModal error', e); } }
  });
}

// Removed debug floating test button to declutter the UI.
// Use the 'Añadir promoción' button in the Promotions section to open the promo modal.
if(promoModalClose) promoModalClose.onclick = ()=> closePromoModal();
if(cancelPromoBtn) cancelPromoBtn.onclick = ()=> closePromoModal();
if(savePromoBtn) savePromoBtn.onclick = ()=> savePromo();
if(promoProductSearch) promoProductSearch.oninput = (e)=> filterPromoProducts(e.target.value);
if(promoSearch) promoSearch.oninput = (e)=> { const q = e.target.value.toLowerCase(); const promos = loadPromotions().filter(ps => ps.name.toLowerCase().includes(q) || (ps.description||'').toLowerCase().includes(q)); promotionsTableBody.innerHTML = ''; for(const p of promos){ const tr = document.createElement('tr'); const validity = formatPromoValidity(p.valid_until); const expiredClass = isPromoExpired(p.valid_until) ? ' style="color:#b42318;font-weight:700"' : ''; tr.innerHTML = `<td>${p.name}</td><td>${p.type || ''}${p.type === 'percent' && p.value ? ' ('+p.value+'%)' : ''}</td><td${expiredClass}>${validity}</td><td>${(p.productIds||[]).length}</td><td><button data-id="${p.id}" class="editPromo btn">Editar</button><button data-id="${p.id}" class="delPromo btn">Eliminar</button></td>`; promotionsTableBody.appendChild(tr); } document.querySelectorAll('.delPromo').forEach(btn => btn.onclick = () => { deletePromotion(btn.dataset.id); }); document.querySelectorAll('.editPromo').forEach(btn => btn.onclick = () => { editPromotion(btn.dataset.id); }); }
if(exportPromosBtn) exportPromosBtn.onclick = ()=>{
  try{
    const promos = loadPromotions(); const blob = new Blob([JSON.stringify(promos, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'promotions.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); }, 500);
    showToast('Promociones exportadas', 'info');
  }catch(e){ console.error('Export promos failed', e); showToast('Error exportando promociones', 'error'); }
};

// delegate change event for checkboxes inside promoProductsList to update save button
promoProductsList && promoProductsList.addEventListener('change', (e)=> { if(e.target && e.target.matches('input[type=checkbox]')) updateSavePromoBtn(); });
promoName && promoName.addEventListener('input', updateSavePromoBtn);

// ---------------------- Consumición inmediata (admin) ----------------------
const loadConsumosBtn = document.getElementById('loadConsumosBtn');
const saveConsumosBtn = document.getElementById('saveConsumosBtn');
const consumosList = document.getElementById('consumosList');
const consumoSearch = document.getElementById('consumoSearch');

async function loadConsumos(){
  try{
    let products = [];
    try{ products = await ensureAllProductsCache({ force: true }); }catch(e){ console.warn('ensureAllProductsCache failed for consumos', e); }
    // try snapshot fallback
    if(!products || !products.length){ try{ const resp = await fetch('../catalogo/products.json'); if(resp.ok) products = await resp.json(); }catch(e){} }
    const resp = await safeFetch(API_BASE + '/api/consumos').catch(()=>[]);
    const consumos = Array.isArray(resp) ? resp : [];
    renderConsumosList(products, consumos);
  }catch(e){ console.error('loadConsumos failed', e); showToast('No se pudieron cargar consumos','error'); }
}

function renderConsumosList(products, consumos){
  if(!consumosList) return;
  consumosList.innerHTML = '';
  const map = {};
  (consumos || []).forEach(c => { map[String(c.id)] = { discount: c.discount, qty: c.qty }; });
  for(const p of (products || [])){
    const row = document.createElement('div'); row.className = 'consumo-row';
    const left = document.createElement('div'); left.className = 'left';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.id = String(p.id); cb.id = 'consumo-p-' + p.id; if(map[String(p.id)] && map[String(p.id)].discount) cb.checked = true;
    const lbl = document.createElement('label'); lbl.htmlFor = cb.id; lbl.innerText = p.name + (p.category ? '  '+p.category : '');
    left.appendChild(cb); left.appendChild(lbl);
    const right = document.createElement('div'); right.className = 'right';
    const inp = document.createElement('input'); inp.type='number'; inp.min=0; inp.max=100; inp.placeholder='Descuento %'; inp.value = (map[String(p.id)] && map[String(p.id)].discount != null) ? String(map[String(p.id)].discount) : '';
    inp.dataset.id = String(p.id);
    const inpQty = document.createElement('input'); inpQty.type='number'; inpQty.className='qty-input'; inpQty.min=0; inpQty.placeholder='Cant. venc.'; inpQty.value = (map[String(p.id)] && map[String(p.id)].qty != null) ? String(map[String(p.id)].qty) : '';
    inpQty.dataset.id = String(p.id);
    right.appendChild(inp);
    right.appendChild(inpQty);
    row.appendChild(left); row.appendChild(right);
    consumosList.appendChild(row);
  }
}

async function saveConsumos(){
  try{
    if(!consumosList) return;
    const rows = Array.from(consumosList.querySelectorAll('.consumo-row'));
    const data = [];
    for(const r of rows){
      const cb = r.querySelector('input[type=checkbox]');
      const inp = r.querySelector('input[type=number]');
      const qtyInp = r.querySelector('input.qty-input') || r.querySelectorAll('input[type=number]')[1];
      const id = Number(cb?.dataset?.id);
      const discount = Number(inp && inp.value ? inp.value : 0);
      const qty = Number(qtyInp && qtyInp.value ? qtyInp.value : 0);
      const shouldInclude = (cb && cb.checked) || (discount > 0);
      if(!shouldInclude) continue;
      if(isNaN(discount) || discount <= 0) continue;
      if(isNaN(qty) || qty < 0) continue;
      data.push({ id, discount, qty });
    }
    if (data.length === 0) {
      if (!confirm('La lista de consumos está vacía. Esto eliminará todos los consumos publicados. ¿Desea continuar?')){
        showToast('Guardar cancelado', 'info');
        return;
      }
    }
    const url = API_BASE + '/api/consumos' + (data.length === 0 ? '?confirm=true' : '');
    const resp = await safeFetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    showToast('Consumiciones guardadas', 'info');
  }catch(e){ console.error('saveConsumos failed', e); showToast('Error guardando consumos','error'); }
}

if(loadConsumosBtn) loadConsumosBtn.addEventListener('click', (e)=>{ e.preventDefault(); loadConsumos(); });
if(saveConsumosBtn) saveConsumosBtn.addEventListener('click', (e)=>{ e.preventDefault(); saveConsumos(); });
if(consumoSearch) consumoSearch.addEventListener('input', (e)=>{ const q = (e.target.value||'').toLowerCase(); if(!consumosList) return; Array.from(consumosList.querySelectorAll('.consumo-row')).forEach(r=>{ const txt = (r.textContent||'').toLowerCase(); r.style.display = (!q || txt.includes(q)) ? 'flex' : 'none'; }); });


// Mobile sidebar toggle: wire hamburger button and outside click to close
try{
  const mobileBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.querySelector('.sidebar');
  if(mobileBtn && sidebar){
    mobileBtn.addEventListener('click', (ev)=>{
      const open = sidebar.classList.toggle('open');
      mobileBtn.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('sidebar-open', open);
    });
    // close when clicking outside sidebar on mobile
    document.addEventListener('pointerdown', (ev)=>{
      if(window.innerWidth > 900) return; // only mobile
      if(!sidebar.classList.contains('open')) return;
      if(ev.target.closest && (ev.target.closest('.sidebar') || ev.target.closest('#mobileMenuBtn'))) return;
      sidebar.classList.remove('open');
      const btn = document.getElementById('mobileMenuBtn'); if(btn) btn.setAttribute('aria-expanded','false');
      document.body.classList.remove('sidebar-open');
    });
    // close with Escape
    window.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape' && sidebar.classList.contains('open')) { sidebar.classList.remove('open'); const btn = document.getElementById('mobileMenuBtn'); if(btn) btn.setAttribute('aria-expanded','false'); document.body.classList.remove('sidebar-open'); } });
    // ensure sidebar state resets on desktop
    window.addEventListener('resize', ()=> {
      if (window.innerWidth > 900) {
        sidebar.classList.remove('open');
        const btn = document.getElementById('mobileMenuBtn');
        if (btn) btn.setAttribute('aria-expanded','false');
        document.body.classList.remove('sidebar-open');
      }
    });
  }
}catch(e){console.warn('mobile menu wiring failed', e)}
