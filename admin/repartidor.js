const REMOTE_API_BASE = 'https://backend-0lcs.onrender.com';
let API_BASE = (location.protocol && location.protocol.startsWith('http')) ? location.origin : REMOTE_API_BASE;
const ADMIN_TOKEN_KEY = 'admin:token:v1';
const ADMIN_SESSION_KEY = 'admin:session:v2';

const authOverlay = document.getElementById('authOverlay');
const authLoginForm = document.getElementById('authLoginForm');
const authUser = document.getElementById('authUser');
const authPass = document.getElementById('authPass');
const authShowPass = document.getElementById('authShowPass');
const authError = document.getElementById('authError');

const driverNameEl = document.getElementById('driverName');
const driverZoneEl = document.getElementById('driverZone');
const routeCountEl = document.getElementById('routeCount');
const refreshRouteBtn = document.getElementById('refreshRouteBtn');
const logoutBtn = document.getElementById('logoutBtn');
const driverAppCard = document.getElementById('driverAppCard');
const driverAppInstallBtn = document.getElementById('driverAppInstallBtn');

const currentTitle = document.getElementById('currentTitle');
const currentBadge = document.getElementById('currentBadge');
const currentDetails = document.getElementById('currentDetails');
const navBtn = document.getElementById('navBtn');
const deliverBtn = document.getElementById('deliverBtn');
const nextBtn = document.getElementById('nextBtn');

const routeList = document.getElementById('routeList');
const routeProgress = document.getElementById('routeProgress');

const mapStatus = document.getElementById('mapStatus');
let map = null;
let markers = [];
let polyline = null;

let currentUser = null;
let routeOrders = [];
let currentIndex = 0;
let refreshTimer = null;
let locationWatchId = null;
let lastLocationSentAt = 0;
const LOCATION_SEND_INTERVAL_MS = 8000;

function syncDriverAppInstall(){
  const loggedIn = !!(currentUser && currentUser.role === 'repartidor');
  try{
    if (driverAppCard) driverAppCard.classList.toggle('hidden', !loggedIn);
  }catch(_){ }
  try{
    if (driverAppInstallBtn){
      const base = String(API_BASE || REMOTE_API_BASE || '').replace(/\/$/, '');
      driverAppInstallBtn.href = `${base}/admin/repartidor-app.apk`;
    }
  }catch(_){ }
}

function setAuthError(msg){
  if (!authError) return;
  authError.textContent = msg || '';
}

function setAuthLocked(locked){
  try{ document.body.classList.toggle('auth-locked', locked); }catch(_){ }
  try{
    if (authOverlay) authOverlay.setAttribute('aria-hidden', locked ? 'false' : 'true');
  }catch(_){ }
}

function getToken(){
  try{ return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; }catch(_){ return ''; }
}

function setToken(token){
  try{ if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token); }catch(_){ }
}

function clearToken(){
  try{ localStorage.removeItem(ADMIN_TOKEN_KEY); }catch(_){ }
}

function setSession(user){
  try{ localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(user || {})); }catch(_){ }
}

function clearSession(){
  try{ localStorage.removeItem(ADMIN_SESSION_KEY); }catch(_){ }
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
        return API_BASE;
      }
    }catch(_){ }
  }
  return API_BASE;
}

async function safeFetch(url, opts){
  const next = opts ? Object.assign({}, opts) : {};
  try{
    const headers = new Headers(next.headers || {});
    const token = getToken();
    if (token && !headers.has('Authorization')){
      headers.set('Authorization', 'Bearer ' + token);
    }
    next.headers = headers;
  }catch(_){ }
  const res = await fetch(url, next);
  if (!res) throw new Error('no-response');
  const ct = res.headers.get('content-type') || '';
  let payload = null;
  try{
    payload = ct.includes('application/json') ? await res.json() : await res.text();
  }catch(_){ payload = null; }
  if (!res.ok){
    const err = new Error('http-error:' + res.status);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function sendDriverLocation(position){
  if (!position || !position.coords) return;
  const now = Date.now();
  if (now - lastLocationSentAt < LOCATION_SEND_INTERVAL_MS) return;
  lastLocationSentAt = now;
  const coords = position.coords;
  const payload = {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracy: coords.accuracy,
    speed: coords.speed,
    heading: coords.heading,
    timestamp: position.timestamp,
  };
  try{
    await safeFetch(API_BASE + '/admin/driver-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }catch(_){ }
}

function startLocationTracking(){
  if (!navigator.geolocation || locationWatchId !== null) return;
  try{
    locationWatchId = navigator.geolocation.watchPosition(
      (pos) => { sendDriverLocation(pos); },
      () => { /* ignore errors */ },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 8000 }
    );
  }catch(_){ }
}

function stopLocationTracking(){
  try{
    if (locationWatchId !== null && navigator.geolocation){
      navigator.geolocation.clearWatch(locationWatchId);
    }
  }catch(_){ }
  locationWatchId = null;
}

function normalizeStatus(value){
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'recibido';
  const map = { en_camino: 'enviado', encamino: 'enviado', delivered: 'entregado' };
  return map[raw] || raw;
}

function formatStatus(value){
  const st = normalizeStatus(value);
  const labels = {
    recibido: 'Recibido',
    visto: 'Visto',
    preparado: 'Preparado',
    enviado: 'Enviado',
    entregado: 'Entregado',
  };
  return labels[st] || st;
}

function getOrderAddress(order){
  const parts = [
    order.user_calle,
    order.user_numeracion,
    order.user_barrio,
    order.user_department,
    order.user_postal_code,
  ].filter(v => String(v || '').trim());
  if (parts.length) return parts.join(', ');
  if (order._token_preview && order._token_preview.full_text) return String(order._token_preview.full_text);
  return '—';
}

function getOrderCoords(order){
  const candidates = [
    [order.delivery_lat, order.delivery_lon],
    [order.user_lat, order.user_lon],
    [order.user_latitude, order.user_longitude],
    [order.delivery_lat, order.delivery_lon],
  ];
  try{
    const tp = order._token_preview || {};
    const addr = tp.address || {};
    candidates.push([tp.lat, tp.lon]);
    candidates.push([tp.latitude, tp.longitude]);
    candidates.push([addr.lat, addr.lon]);
    candidates.push([addr.latitude, addr.longitude]);
  }catch(_){ }
  for (const pair of candidates){
    const lat = Number(pair[0]);
    const lon = Number(pair[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      return { lat, lon };
    }
  }
  return null;
}

function initMap(){
  if (!window.L || !document.getElementById('routeMap')){
    if (mapStatus){
      mapStatus.textContent = 'Mapa no disponible.';
      mapStatus.classList.remove('hidden');
    }
    return;
  }
  map = L.map('routeMap', { zoomControl: true, scrollWheelZoom: true }).setView([-32.88, -68.84], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
}

function clearMap(){
  if (!map) return;
  markers.forEach(m => { try{ m.remove(); }catch(_){ } });
  markers = [];
  if (polyline){
    try{ polyline.remove(); }catch(_){ }
    polyline = null;
  }
}

function renderMap(){
  if (!map) return;
  clearMap();
  const coords = [];
  routeOrders.forEach((o, idx) => {
    const c = getOrderCoords(o);
    if (!c) return;
    coords.push({ idx, lat: c.lat, lon: c.lon });
  });
  if (!coords.length){
    if (mapStatus){
      mapStatus.textContent = 'Sin coordenadas para mostrar ruta.';
      mapStatus.classList.remove('hidden');
    }
    return;
  }
  if (mapStatus) mapStatus.classList.add('hidden');
  coords.forEach((pt) => {
    const isCurrent = pt.idx === currentIndex;
    const marker = L.circleMarker([pt.lat, pt.lon], {
      radius: isCurrent ? 9 : 6,
      color: isCurrent ? '#0ea5e9' : '#475569',
      fillColor: isCurrent ? '#38bdf8' : '#94a3b8',
      fillOpacity: 0.9,
    }).addTo(map);
    marker.bindTooltip(`#${routeOrders[pt.idx].id}`, { direction: 'top' });
    markers.push(marker);
  });
  const linePoints = coords.map(c => [c.lat, c.lon]);
  polyline = L.polyline(linePoints, { color: '#0ea5e9', weight: 3, opacity: 0.8 }).addTo(map);
  try{
    const bounds = L.latLngBounds(linePoints);
    map.fitBounds(bounds, { padding: [24, 24] });
  }catch(_){ }
}

function renderRouteList(){
  if (!routeList) return;
  if (!routeOrders.length){
    routeList.innerHTML = '<div class="empty-note">No hay pedidos asignados.</div>';
    return;
  }
  routeList.innerHTML = '';
  routeOrders.forEach((o, idx) => {
    const item = document.createElement('div');
    const isActive = idx === currentIndex;
    item.className = 'route-item' + (isActive ? ' active' : '');
    const statusLabel = formatStatus(o.status);
    const address = getOrderAddress(o);
    item.innerHTML = `
      <div class="route-item-top">
        <span class="route-item-index">${idx + 1}</span>
        <span class="route-item-id">#${o.id}</span>
        <span class="route-item-status">${statusLabel}</span>
      </div>
      <div class="route-item-address">${address}</div>
    `;
    item.addEventListener('click', () => {
      currentIndex = idx;
      renderCurrent();
    });
    routeList.appendChild(item);
  });
}

function renderCurrent(){
  if (!routeOrders.length){
    currentTitle.textContent = 'Sin pedidos';
    currentBadge.textContent = '—';
    currentDetails.textContent = 'No hay pedidos asignados aún.';
    deliverBtn.disabled = true;
    nextBtn.disabled = true;
    navBtn.disabled = true;
    routeProgress.textContent = '0/0';
    renderMap();
    renderRouteList();
    return;
  }
  if (currentIndex < 0 || currentIndex >= routeOrders.length){
    currentIndex = 0;
  }
  const order = routeOrders[currentIndex];
  const address = getOrderAddress(order);
  const statusLabel = formatStatus(order.status);
  currentTitle.textContent = `Pedido #${order.id}`;
  currentBadge.textContent = statusLabel;
  currentDetails.innerHTML = `
    <div><strong>Cliente:</strong> ${order.user_full_name || order.user_email || '—'}</div>
    <div><strong>Dirección:</strong> ${address}</div>
    <div><strong>Total:</strong> $${Number(order.total || 0).toFixed(2)}</div>
  `;
  deliverBtn.disabled = false;
  nextBtn.disabled = routeOrders.length <= 1;
  navBtn.disabled = false;
  routeProgress.textContent = `${currentIndex + 1}/${routeOrders.length}`;
  renderMap();
  renderRouteList();
}

function advanceToNext(){
  if (!routeOrders.length) return;
  const nextIdx = currentIndex + 1;
  if (nextIdx < routeOrders.length){
    currentIndex = nextIdx;
  } else {
    currentIndex = routeOrders.length - 1;
  }
  renderCurrent();
}

async function markDelivered(){
  if (!routeOrders.length) return;
  const order = routeOrders[currentIndex];
  if (!order) return;
  deliverBtn.disabled = true;
  deliverBtn.textContent = 'Guardando...';
  try{
    await ensureApiBase();
    const updated = await safeFetch(`${API_BASE}/orders/${encodeURIComponent(order.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'entregado' }),
    });
    routeOrders = routeOrders.filter(o => String(o.id) !== String(order.id));
    if (updated && updated.id){
      routeOrders = routeOrders.filter(o => String(o.id) !== String(updated.id));
    }
    if (currentIndex >= routeOrders.length){
      currentIndex = Math.max(0, routeOrders.length - 1);
    }
    renderCurrent();
    setTimeout(() => refreshRoute(true), 600);
  }catch(e){
    const msg = (e && e.payload && (e.payload.detail || e.payload.error)) ? String(e.payload.detail || e.payload.error) : 'No se pudo marcar como entregado.';
    setAuthError(msg);
  }finally{
    deliverBtn.disabled = false;
    deliverBtn.textContent = 'Marcar entregado';
  }
}

function openNavigation(){
  if (!routeOrders.length) return;
  const order = routeOrders[currentIndex];
  if (!order) return;
  if (order.maps_url){
    window.open(order.maps_url, '_blank');
    return;
  }
  const address = getOrderAddress(order);
  const query = encodeURIComponent(address);
  const url = `https://www.google.com/maps/dir/?api=1&destination=${query}`;
  window.open(url, '_blank');
}

async function refreshRoute(force){
  try{
    await ensureApiBase();
    const list = await safeFetch(`${API_BASE}/admin/orders?status=preparado,enviado&auto=1`).catch(() => []);
    const arr = Array.isArray(list) ? list : [];
    routeOrders = arr.filter(o => normalizeStatus(o.status) !== 'entregado');
    routeOrders.sort((a, b) => {
      const ra = Number(a.route_order || 0);
      const rb = Number(b.route_order || 0);
      if (ra && rb) return ra - rb;
      return String(a.id).localeCompare(String(b.id));
    });
    if (currentIndex >= routeOrders.length) currentIndex = 0;
    routeCountEl.textContent = String(routeOrders.length);
    renderCurrent();
  }catch(e){
    console.error('refreshRoute failed', e);
    currentDetails.textContent = 'No se pudo cargar la ruta.';
  }
}

async function bootstrap(){
  if (authShowPass && authPass){
    authShowPass.addEventListener('change', () => {
      authPass.type = authShowPass.checked ? 'text' : 'password';
    });
  }
  if (authUser) authUser.addEventListener('input', () => setAuthError(''));
  if (authPass) authPass.addEventListener('input', () => setAuthError(''));
  if (authLoginForm){
    authLoginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const username = String(authUser ? authUser.value : '').trim();
      const password = String(authPass ? authPass.value : '').trim();
      if (!username || !password){
        setAuthError('Ingresá usuario y contraseña.');
        return;
      }
      setAuthError('');
      try{
        await ensureApiBase();
        syncDriverAppInstall();
        const body = new URLSearchParams();
        body.set('username', username);
        body.set('password', password);
        const res = await fetch(`${API_BASE}/admin/auth/token`, {
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
        setToken(token);
        const me = await safeFetch(`${API_BASE}/admin/auth/me`).catch(() => null);
        if (!me || me.role !== 'repartidor'){
          setAuthError('Acceso solo para repartidores.');
          clearToken();
          return;
        }
        currentUser = me;
        setSession(me);
        syncDriverAppInstall();
        setAuthLocked(false);
        driverNameEl.textContent = me.username || '—';
        driverZoneEl.textContent = me.zone || '—';
        initMap();
        startLocationTracking();
        await refreshRoute(true);
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => refreshRoute(false), 60000);
      }catch(e){
        console.error('login failed', e);
        setAuthError('No se pudo iniciar sesión.');
      }
    });
  }

  const token = getToken();
  if (token){
    try{
      await ensureApiBase();
      syncDriverAppInstall();
      const me = await safeFetch(`${API_BASE}/admin/auth/me`).catch(() => null);
      if (me && me.role === 'repartidor'){
        currentUser = me;
        setSession(me);
        syncDriverAppInstall();
        setAuthLocked(false);
        driverNameEl.textContent = me.username || '—';
        driverZoneEl.textContent = me.zone || '—';
        initMap();
        startLocationTracking();
        await refreshRoute(true);
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => refreshRoute(false), 60000);
      } else {
        clearToken();
        setAuthLocked(true);
      }
    }catch(_){
      clearToken();
      setAuthLocked(true);
    }
  } else {
    setAuthLocked(true);
  }
}

if (refreshRouteBtn){
  refreshRouteBtn.addEventListener('click', () => refreshRoute(true));
}
if (logoutBtn){
  logoutBtn.addEventListener('click', () => {
    clearToken();
    clearSession();
    currentUser = null;
    syncDriverAppInstall();
    stopLocationTracking();
    setAuthLocked(true);
    location.reload();
  });
}
if (deliverBtn){
  deliverBtn.addEventListener('click', () => markDelivered());
}
if (nextBtn){
  nextBtn.addEventListener('click', () => {
    if (currentIndex < routeOrders.length - 1){
      currentIndex += 1;
      renderCurrent();
    }
  });
}
if (navBtn){
  navBtn.addEventListener('click', () => openNavigation());
}

bootstrap();
