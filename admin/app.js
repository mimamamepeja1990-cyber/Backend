/* promo-image initial block removed to avoid early API_BASE usage; code reinserted after API_BASE definition */

// Mostrar sección al hacer click en el menú
document.querySelectorAll('.sidebar nav a[data-section]').forEach(link => {
  link.addEventListener('click', function() {
    document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
    const sec = document.getElementById(this.getAttribute('data-section'));
    if (sec) sec.classList.remove('hidden');
    document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
    this.classList.add('active');
    if (this.getAttribute('data-section') === 'promo-images') fetchPromoImages();
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
// Admin JS ? UI principal sin modo oscuro ni bot?n de tarjeta (card)
console.log('[admin] app.js loaded');
const REMOTE_API_BASE = 'https://backend-0lcs.onrender.com';
let API_BASE = (location.protocol && location.protocol.startsWith('http')) ? location.origin : REMOTE_API_BASE;
// Small helper to wrap fetch and provide consistent errors and JSON parsing
async function safeFetch(url, opts) {
  const res = await fetch(url, opts || {});
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

const productsTableBody = document.querySelector('#productsTable tbody');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const sortSelect = document.getElementById('sortSelect');
const refreshBtn = document.getElementById('refreshBtn');
const newBtn = document.getElementById('newBtn');
const modal = document.getElementById('modal');
const productForm = document.getElementById('productForm');
const cancelBtn = document.getElementById('cancelBtn');
const uploadImageBtn = document.getElementById('uploadImageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const fileNameEl = document.getElementById('fileName');
const toast = document.getElementById('toast');
const modalClose = document.getElementById('modalClose');
const saveBtn = document.getElementById('saveBtn');
const saleUnitSelect = document.getElementById('sale_unit');
const kgPerUnitField = document.getElementById('kgPerUnitField');
const stockLabel = document.getElementById('stockLabel');
const priceLabel = document.getElementById('priceLabel');
const productCodeInput = document.getElementById('code');
const retailPriceInput = document.getElementById('price_retail');
const retailPricesTableBody = document.querySelector('#retailPricesTable tbody');
const retailPriceSearch = document.getElementById('retailPriceSearch');
const retailRefreshBtn = document.getElementById('retailRefreshBtn');
const retailSaveAllBtn = document.getElementById('retailSaveAllBtn');
let currentEditId = null;
let imageUrl = null;
let selectedFile = null;
let retailProductsCache = [];
let productLookupById = new Map();
const PROMO_KEY = 'admin_promotions_v1';
const FILTERS_KEY = 'admin_filters_v1';
const PRODUCT_CATEGORIES_KEY = 'admin_product_categories_v1';
const ORDER_MAPS_COORD_CACHE_KEY = 'admin_order_maps_coords_v5';
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
let currentPromotionEditId = null;

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
    const params = new URLSearchParams({
      SingleLine: clean,
      f: 'pjson',
      countryCode: 'ARG',
      maxLocations: '8',
      forStorage: 'false',
      outFields: '*',
      location: '-68.8458,-32.8895',
      searchExtent: '-70.7,-37.7,-66.2,-31.0',
    });
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params.toString()}`;
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

// CRUD fetchers
async function fetchProducts(q = '', category = '', sort = ''){
  const params = new URLSearchParams();
  if(q) params.append('q', q);
  if(category) params.append('category', category);
  if(sort) params.append('sort', sort);
  const url = `${API_BASE}/products?` + params.toString();
  return await safeFetch(url).catch(err => { console.error('fetchProducts failed', err); throw err; });
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
  const products = await fetchProducts(q, cat, sort);
  allProductsCache = Array.isArray(products) ? products.slice() : [];
  syncProductLookup(allProductsCache);
  renderProducts(products);
  updateStats(products);
  try{
    const retailSection = document.getElementById('retail-prices');
    if (retailSection && !retailSection.classList.contains('hidden')) {
      retailProductsCache = products || [];
      renderRetailPrices(retailProductsCache);
    }
  }catch(_){ }
  refreshBtn.disabled = false; refreshBtn.textContent = prevText;
}

function renderProducts(products){
  productsTableBody.innerHTML = '';
  const categories = new Set();
  // attempt to load product->categories map (best-effort and async-safe)
  const productCats = loadProductCategories();
  for(const p of products){
    categories.add(p.category || '');
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
      ? (Number.isFinite(stockNum) ? String(parseFloat(stockNum.toFixed(3))) : '0')
      : String(Number.isFinite(stockNum) ? Math.max(0, Math.round(stockNum)) : 0);
    const kgPerUnitNum = getProductKgPerUnit(p);
    const kgPerUnitHint = unit === 'kg'
      ? ` <small style="color:#6b7280;font-weight:600">(1 = ${Number.isFinite(kgPerUnitNum) ? parseFloat(kgPerUnitNum.toFixed(3)) : 1} kg)</small>`
      : '';
    tr.innerHTML = `
      <td>${imgSrc ? `<img src="${imgSrc}" alt="${p.name}" width="60" onerror="this.onerror=null;this.src='../images/default.png'">` : ''}</td>
      <td>${escapeHtml(p.name || '')}</td>
      <td>${productCode ? escapeHtml(productCode) : '<span class="muted">—</span>'}</td>
      <td>${catsDisplay}</td>
      <td>$${parseFloat(p.price).toFixed(2)}${unitSuffix}</td>
      <td>${(p.price_retail === null || p.price_retail === undefined || p.price_retail === '') ? '<span class="muted"></span>' : ('$' + parseFloat(p.price_retail).toFixed(2) + unitSuffix)}</td>
      <td>${stockDisplay}${stockSuffix}${kgPerUnitHint}</td>
      <td>${p.active ? 'Sí' : 'No'}</td>
      <td>
        <button data-id="${p.id}" class="editBtn btn">Editar</button>
        <button data-id="${p.id}" class="delBtn btn">Eliminar</button>
      </td>
    `;
  productsTableBody.appendChild(tr);
  }
  categoryFilter.innerHTML = '<option value="">Todas</option>' + Array.from(categories).map(c => `<option value="${c}">${c}</option>`).join('');
  document.querySelectorAll('.editBtn').forEach(el => el.onclick = async e => { await onEdit(e.target.dataset.id) });
  document.querySelectorAll('.delBtn').forEach(el => el.onclick = async e => { await onDelete(e.target.dataset.id) });
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
    const products = await fetchProducts(q, '', 'name_asc');
    retailProductsCache = products || [];
    renderRetailPrices(retailProductsCache);
  }catch(e){
    console.error('refreshRetailPrices failed', e);
    showToast('No se pudieron cargar precios minorista', 'error');
  } finally {
    if (retailRefreshBtn) { retailRefreshBtn.disabled = false; retailRefreshBtn.textContent = oldText || 'Actualizar lista'; }
  }
}

function updateStats(products){
  const totalActive = products.filter(p => p.active).length;
  document.getElementById('totalActive').textContent = totalActive;
  document.getElementById('productCounter').textContent = products.length;
  const avg = products.reduce((s,p)=> s + Number(p.price), 0) / (products.length || 1);
  document.getElementById('avgPrice').textContent = '$' + avg.toFixed(2);
  const byCat = {};
  products.forEach(p => { const k = p.category || 'Uncategorized'; byCat[k] = (byCat[k] || 0) + 1 });
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
      data: { labels: Object.keys(byCat), datasets: [{ data: Object.values(byCat), backgroundColor: ['#60A5FA','#F59E0B','#10B981','#F43F5E','#8B5CF6'] }] },
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
if(searchInput) searchInput.oninput = () => refresh();
if(sortSelect) sortSelect.onchange = () => refresh();
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

document.querySelectorAll('.sidebar nav a').forEach(a => a.onclick = () => {
  document.querySelectorAll('.sidebar nav a').forEach(x=>x.classList.remove('active'));
  a.classList.add('active');
  const sectionTitles = {
    'dashboard': 'Dashboard',
    'catalog': 'Catálogo',
    'retail-prices': 'Precios minorista',
    'consumos': 'Consumición inmediata',
    'promotions': 'Promociones',
    'promo-images': 'Imágenes Promocionales',
    'filters': 'Filtros',
    'orders': 'Pedidos',
    'preparations': 'Preparaciones',
  };
  document.getElementById('title').textContent = sectionTitles[a.dataset.section] || 'Administración';
  document.querySelectorAll('.section').forEach(s=>s.classList.add('hidden'));
  const target = document.getElementById(a.dataset.section);
  if(target) target.classList.remove('hidden');
  // If promo-images tab activated, ensure we load images
  try{ if(a.dataset.section === 'promo-images') fetchPromoImages(); }catch(e){ console.warn('fetchPromoImages guard failed', e); }
  try{ if(a.dataset.section === 'retail-prices') refreshRetailPrices(); }catch(e){ console.warn('refreshRetailPrices guard failed', e); }
  try{ if(a.dataset.section === 'preparations') refreshPreparations(false); }catch(e){ console.warn('refreshPreparations guard failed', e); }
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

  const payload = {
    code: normalizeProductCode(productCodeInput ? productCodeInput.value : '') || null,
    name: productForm.name.value.trim(),
    price: Number(productForm.price.value),
    description: productForm.description.value.trim(),
    category: productForm.category.value.trim() || null,
    image_url: imageUrl,
    active: true
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
    productForm.price.value = p.price;
    if (retailPriceInput) retailPriceInput.value = (p.price_retail === null || p.price_retail === undefined || p.price_retail === '') ? '' : String(p.price_retail);
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

async function onDelete(id){
  if(!confirm('¿Eliminar producto?')) return;
  try{ await deleteProduct(id); showToast('Eliminado'); refresh(); }
  catch(err){ showToast('Error eliminando','error'); }
}

// --- Orders (admin) ---
// Orders section is Web-only.
const orderSearch_web = document.getElementById('orderSearch_web');
const orderDate_web = document.getElementById('orderDate_web');
const clearOrderDate_web = document.getElementById('clearOrderDate_web');
const refreshOrdersBtn_web = document.getElementById('refreshOrdersBtn_web');
const ordersTypeTabMayorista = document.getElementById('ordersTypeTab_mayorista');
const ordersTypeTabMinorista = document.getElementById('ordersTypeTab_minorista');
const badgeTypeMayorista = document.getElementById('badge_type_mayorista');
const badgeTypeMinorista = document.getElementById('badge_type_minorista');
const preparationsSearch = document.getElementById('preparationsSearch');
const preparationsDate = document.getElementById('preparationsDate');
const filterPreparationsTomorrowBtn = document.getElementById('filterPreparationsTomorrow');
const clearPreparationsDate = document.getElementById('clearPreparationsDate');
const refreshPreparationsBtn = document.getElementById('refreshPreparationsBtn');
const preparationsList = document.getElementById('preparationsList');
let currentOrderCustomerType = 'mayorista';
let lastOrdersBaseWeb = [];
let lastPreparationsBase = [];

function normalizeOrderCustomerType(value){
  const v = String(value || '').trim().toLowerCase();
  return v === 'minorista' ? 'minorista' : 'mayorista';
}

function normalizeOrderStatus(value){
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 'nuevo';
  return v;
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

async function fetchOrders(q = '', date = '', source = ''){
  const params = new URLSearchParams();
  if(q) params.append('q', q);
  if(date) params.append('date', date);
  if(source) params.append('source', source);
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
    const selectedType = normalizeOrderCustomerType(currentOrderCustomerType);
    list = (list || []).filter(o => normalizeOrderCustomerType(o && o.customer_type) === selectedType);
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
    const btn = el; const id = btn && btn.dataset ? btn.dataset.id : null; if(!id) return; let row = null; try{ row = (btn && btn.closest) ? btn.closest('tr') : null; }catch(_){ }
    if(!row) try{ row = findOrderRowById(id); }catch(_){ }
    let currentStatus = '';
    try{ if(row) currentStatus = (row.children && row.children[5] && row.children[5].textContent) ? row.children[5].textContent.trim() : ''; }catch(_){ }
    const targetStatus = (currentStatus === 'visto') ? 'nuevo' : 'visto';
    const oldStatus = currentStatus; const oldBtnText = btn && btn.textContent ? btn.textContent : '';
    try{ if(row && row.children && row.children[5]) row.children[5].textContent = targetStatus; if(btn){ btn.textContent = targetStatus === 'visto' ? 'Visto' : 'Marcar visto'; btn.classList.add('updating'); } if(row) row.classList.add('updating'); }catch(_){ }
    try{ if(btn) btn.disabled = true; }catch(_){ }
    try{
      const updated = await safeFetch(API_BASE + '/orders/' + encodeURIComponent(id) + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: targetStatus }) });
      try{ if(row && row.children && row.children[5]) row.children[5].textContent = updated.status || ''; if(btn){ btn.textContent = updated.status === 'visto' ? 'Visto' : 'Marcar visto'; btn.classList.remove('updating'); } if(row) row.classList.remove('updating'); }catch(_){ }
      if(document.getElementById('orderModal') && document.getElementById('orderModal').classList.contains('hidden')===false) try{ showOrderDetail(updated); }catch(_){ }
      try{
        const uid = String((updated && updated.id) || id);
        lastPreparationsBase = (lastPreparationsBase || []).map((entry) => String(entry && entry.id) === uid ? mergeOrderRecord(entry, updated) : entry);
        if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
      }catch(_){ }
      try{ await refreshOrders('web'); }catch(_){ }
      if (String((updated && updated.status) || targetStatus).toLowerCase() === 'visto') showToast('Pedido marcado como visto y movido a Preparaciones');
      else showToast('Pedido actualizado');
    }catch(e){ console.error('mark seen failed', e); try{ if(row && row.children && row.children[5]) row.children[5].textContent = oldStatus; }catch(_){ } try{ if(btn) btn.textContent = oldBtnText; }catch(_){ } try{ if(btn) btn.classList.remove('updating'); if(row) row.classList.remove('updating'); }catch(_){ } showToast('No se pudo actualizar estado', 'error'); }
    finally{ try{ if(btn) btn.disabled = false; }catch(_){ } }
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
    if ((!Number.isFinite(lat) || !Number.isFinite(lon))){
      const cached = getCachedOrderCoords(orderId, addressKey);
      if (cached){
        lat = Number(cached.lat);
        lon = Number(cached.lon);
      }
    }
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

function buildOrderGoogleMapsUrl(order){
  try{
    const addr = getOrderAddressSnapshot(order);
    const query = buildOrderGeocodeQueryFromSnapshot(addr);
    if (query && (addr.postalCode || addr.department || /\bM?\d{4}\b/i.test(addr.rawAddress || ''))){
      queueOrderCoordsResolution(order, addr);
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
    }
    const backendMapsUrl = String(order && order.maps_url || '').trim();
    if (backendMapsUrl){
      const lower = backendMapsUrl.toLowerCase();
      if (lower.startsWith('https://www.google.com/maps/') || lower.startsWith('https://maps.google.com/')){
        return backendMapsUrl;
      }
    }
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
      setCachedOrderCoords(order, lat, lon);
      const q = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    }
    const cachedCoords = getCachedOrderCoords(addr.orderId, addr.addressKey);
    if (cachedCoords && isMendozaPoint(cachedCoords.lat, cachedCoords.lon)){
      const q = `${Number(cachedCoords.lat).toFixed(6)},${Number(cachedCoords.lon).toFixed(6)}`;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    }
    if (query){
      queueOrderCoordsResolution(order, addr);
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
    return [
      order && order.id,
      order && order.status,
      order && order.user_full_name,
      order && order.user_email,
      order && order.user_barrio,
      order && order.user_calle,
      order && order.user_numeracion,
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
        const updated = await safeFetch(
          API_BASE + '/orders/' + encodeURIComponent(id) + '/status',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'preparado' }),
          },
        );
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
  const scheduledDeliveryLabel = formatOrderScheduledDelivery(o);
  const orderCustomerType = normalizeOrderCustomerType(o.customer_type);
  const orderCustomerTypeLabel = orderCustomerType === 'minorista' ? 'Minorista' : 'Mayorista';
  const orderStatusNorm = normalizeOrderStatus(o && o.status);
  const isPreparedStatus = orderStatusNorm === 'preparado';
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
  tr.innerHTML = `
    <td colspan="8" style="padding:0;">
      <div class="order-card-vertical">
        <div class="order-row-top">
          <span class="order-id">#${o.id}</span>
          <span class="order-date">${fecha}</span>
        </div>
        ${hasConsumo ? '<div class="order-row-banner" style="margin:6px 0 10px;padding:8px 10px;border-radius:10px;background:#fff7ed;border:1px solid rgba(242,107,56,0.25);color:#9a3412;font-weight:800">Pedido con consumo inmediato</div>' : ''}
        <div class="order-row-items"><strong>Artículos:</strong><ul class="order-items-list">${itemsList}</ul></div>
        <div class="order-row-user"><strong>Cliente:</strong> ${escapeHtml(userDisplay)}</div>
        <div class="order-row-customer-type"><strong>Perfil:</strong> ${escapeHtml(orderCustomerTypeLabel)}</div>
        <div class="order-row-address"><strong>Dirección:</strong> ${escapeHtml(address || '—')}</div>
        ${mapsLinkHtml ? `<div class="order-row-map">${mapsLinkHtml}</div>` : ''}
        ${scheduledDeliveryLabel ? `<div class="order-row-address"><strong>Entrega programada:</strong> ${escapeHtml(scheduledDeliveryLabel)}</div>` : ''}
        <div class="order-row-total"><strong>Total:</strong> $${Number(o.total||0).toFixed(2)}</div>
        <div class="order-row-payment"><strong>Forma de pago:</strong> ${escapeHtml(paymentMethod)}${paymentStatus ? ` <span class="muted">(${escapeHtml(paymentStatus)})</span>` : ''}</div>
        ${paymentReference ? `<div class="order-row-payment-ref"><strong>Ref MP:</strong> ${escapeHtml(paymentReference)}</div>` : ''}
        ${isPending ? '<div class="order-row-pending"> pendiente</div>' : ''}
        <div class="order-row-actions">
          <button data-id="${o.id}" class="viewOrderBtn btn">Ver</button>
          <button data-id="${o.id}" class="markSeenBtn btn" ${isPreparedStatus ? 'disabled title="Pedido ya preparado"' : ''}>${isPreparedStatus ? 'Preparado' : (o.status === 'visto' ? 'Visto' : 'Marcar visto')}</button>
        </div>
      </div>
    </td>
  `;
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
  const customerTypeLabel = normalizeOrderCustomerType(order && order.customer_type) === 'minorista' ? 'Minorista' : 'Mayorista';
  const mapsLinkHtml = getOrderGoogleMapsLinkHtml(order, 'Abrir en Google Maps', 'order-map-link-modal');
  // prefer user_* fields, otherwise display token preview when available
  const previewName = order._token_preview && (order._token_preview.name || order._token_preview.email) ? (order._token_preview.name || order._token_preview.email) : null;
  const displayName = order.user_full_name || previewName || order.user_email || (order.user_id ? '#'+order.user_id : '');
  body.innerHTML = `
    <div class="modal-order-body">
      <div><strong>Usuario:</strong> ${escapeHtml(displayName)} ${order.user_email && displayName !== order.user_email ? ' / ' + escapeHtml(order.user_email) : ''}</div>
      <div><strong>Perfil:</strong> ${escapeHtml(customerTypeLabel)}</div>
      <div><strong>Dirección:</strong> ${escapeHtml(address || '—')}</div>
      ${mapsLinkHtml ? `<div><strong>Ubicación:</strong> ${mapsLinkHtml}</div>` : ''}
      ${scheduledDeliveryLabel ? `<div><strong>Entrega programada:</strong> ${escapeHtml(scheduledDeliveryLabel)}</div>` : ''}
      <div><strong>Total:</strong> $${Number(order.total||0).toFixed(2)}</div>
      <div><strong>Estado:</strong> ${escapeHtml(order.status||'')}</div>
      <div><strong>Forma de pago:</strong> ${escapeHtml(paymentMethod)}${paymentStatus ? ` <span class="muted">(${escapeHtml(paymentStatus)})</span>` : ''}</div>
      ${paymentReference ? `<div><strong>Ref MP:</strong> ${escapeHtml(paymentReference)}</div>` : ''}
      ${hasConsumo ? '<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:#fff7ed;border:1px solid rgba(242,107,56,0.25);color:#9a3412;font-weight:800">Pedido con consumo inmediato</div>' : ''}
      <div class="mt-8"><strong>Items:</strong><ul class="order-items-list">${itemsHtml}</ul></div>
    </div>
  `;
  // add action button for marking seen
  try{
    const actionWrap = document.createElement('div'); actionWrap.style.marginTop = '10px';
    const markBtn = document.createElement('button'); markBtn.className = 'btn'; markBtn.textContent = order.status === 'visto' ? 'Visto' : 'Marcar visto';
    const isPreparedStatus = normalizeOrderStatus(order && order.status) === 'preparado';
    if (isPreparedStatus){
      markBtn.textContent = 'Preparado';
      markBtn.disabled = true;
      markBtn.title = 'Pedido ya preparado';
    }
    markBtn.onclick = async () => {
      if (isPreparedStatus) return;
      // Optimistic update in modal + table
      const targetStatus = order.status === 'visto' ? 'nuevo' : 'visto';
      const oldStatus = order.status;
      const oldBtnText = markBtn.textContent;
      try{
        // update modal UI immediately
        try{ const statusDiv = Array.from(body.children).find(c => c && c.textContent && c.textContent.indexOf('Estado:') !== -1); if(statusDiv) statusDiv.innerHTML = `<strong>Estado:</strong> ${escapeHtml(targetStatus)}`; }catch(_){ }
        markBtn.textContent = targetStatus === 'visto' ? 'Visto' : 'Marcar visto';
        markBtn.classList.add('updating');
        // update table row if present (prefer row matching order.source when available)
        try{
          let row = null;
          try{
            // Prefer matching a row whose data-source equals the order's source (default 'web')
            const orderSrc = String((order && (typeof order.source !== 'undefined' && order.source !== null && String(order.source).trim() !== '') ? order.source : 'web')).toLowerCase();
            row = Array.from(document.querySelectorAll('table[id^="ordersTable"] tbody tr')).find(r => String((r.children && r.children[0] && r.children[0].textContent)||'').trim() === String(order.id) && String((r.getAttribute('data-source')||'web')).toLowerCase() === orderSrc);
          }catch(_){ }
          if(!row) row = findOrderRowById(order.id);
          if(row && row.children && row.children[5]){ row.children[5].textContent = targetStatus; row.classList.add('updating'); const rowBtn = row.querySelector('.markSeenBtn'); if(rowBtn) rowBtn.textContent = targetStatus === 'visto' ? 'Visto' : 'Marcar visto'; }
        }catch(_){ }

        markBtn.disabled = true;
        const updated = await safeFetch(API_BASE + '/orders/' + encodeURIComponent(order.id) + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: targetStatus }) });
        // canonical refresh
        showOrderDetail(updated);
        try{
          let row2 = null;
          try{ const updatedSrc = String((updated && (typeof updated.source !== 'undefined' && updated.source !== null && String(updated.source).trim() !== '') ? updated.source : 'web')).toLowerCase(); row2 = Array.from(document.querySelectorAll('table[id^="ordersTable"] tbody tr')).find(r => String((r.children && r.children[0] && r.children[0].textContent)||'').trim() === String(updated.id) && String((r.getAttribute('data-source')||'web')).toLowerCase() === updatedSrc); }catch(_){ }
          if(!row2) row2 = findOrderRowById(order.id);
          if(row2){ row2.children[5].textContent = updated.status || ''; row2.classList.remove('updating'); const rowBtn2 = row2.querySelector('.markSeenBtn'); if(rowBtn2) rowBtn2.textContent = updated.status === 'visto' ? 'Visto' : 'Marcar visto'; }
        }catch(_){ }
        try{
          const uid = String((updated && updated.id) || order.id);
          lastPreparationsBase = (lastPreparationsBase || []).map((entry) => String(entry && entry.id) === uid ? mergeOrderRecord(entry, updated) : entry);
          if (isPreparationsSectionActive()) renderPreparations(lastPreparationsBase);
        }catch(_){ }
        try{ await refreshOrders('web'); }catch(_){ }
        markBtn.classList.remove('updating');
        if (String((updated && updated.status) || targetStatus).toLowerCase() === 'visto') showToast('Pedido marcado como visto y movido a Preparaciones');
        else showToast('Estado actualizado');
      }catch(e){
        console.error('modal mark seen failed', e);
        // revert modal and table to previous state
        try{ const statusDiv = Array.from(body.children).find(c => c && c.textContent && c.textContent.indexOf('Estado:') !== -1); if(statusDiv) statusDiv.innerHTML = `<strong>Estado:</strong> ${escapeHtml(oldStatus)}`; }catch(_){ }
        try{
          let row = null;
          try{ const orderSrc = String((order && (typeof order.source !== 'undefined' && order.source !== null && String(order.source).trim() !== '') ? order.source : 'web')).toLowerCase(); row = Array.from(document.querySelectorAll('table[id^="ordersTable"] tbody tr')).find(r => String((r.children && r.children[0] && r.children[0].textContent)||'').trim() === String(order.id) && String((r.getAttribute('data-source')||'web')).toLowerCase() === orderSrc); }catch(_){ }
          if(!row) row = findOrderRowById(order.id);
          if(row){ row.children[5].textContent = oldStatus; row.classList.remove('updating'); const rowBtn = row.querySelector('.markSeenBtn'); if(rowBtn) rowBtn.textContent = oldBtnText; }
        }catch(_){ }
        showToast('No se pudo actualizar estado: ' + (e && e.message ? e.message : ''), 'error');
      }finally{ markBtn.disabled = false; markBtn.classList.remove('updating'); }
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
if(refreshPreparationsBtn) refreshPreparationsBtn.addEventListener('click', ()=> refreshPreparations(true));

// Tabs and badges wiring (web only)
const ordersSection = document.getElementById('orders');
const tabWebBtn = document.getElementById('tab_web');
const badgeWeb = document.getElementById('badge_web');
const clearOrderCacheBtn = document.getElementById('clearOrderCache');

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
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); currentEditId = null; imageUrl = null; selectedFile = null; fileNameEl.textContent = 'Ningun archivo seleccionado'; imagePreview.innerHTML = ''; productForm.reset(); try{ if(productForm.sale_unit) productForm.sale_unit.value = 'unit'; }catch(_){ } try{ if(productForm.kg_per_unit) productForm.kg_per_unit.value = '1'; }catch(_){ } try{ syncProductUnitFields(); }catch(_){ } validateForm();
}
// Close modal when clicking outside the modal card
if(modal) modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
// Close on ESC key
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

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
    const products = await fetchProducts().catch(() => []);
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
  try{ products = await fetchProducts(); }catch(e){ console.warn('fetchProducts failed', e); }
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
    try{ products = await fetchProducts(); }catch(e){ console.warn('fetchProducts failed for consumos', e); }
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
