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
  });
});
// Admin JS — UI principal sin modo oscuro ni botón de tarjeta (card)
console.log('[admin] app.js loaded');
const API_BASE = (location.protocol && location.protocol.startsWith('http')) ? location.origin : "http://127.0.0.1:8000";
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
        fechaDiv.textContent = 'Subida: ' + (img.name || '—');
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
let currentEditId = null;
let imageUrl = null;
let selectedFile = null;
const PROMO_KEY = 'admin_promotions_v1';
const FILTERS_KEY = 'admin_filters_v1';
const PRODUCT_CATEGORIES_KEY = 'admin_product_categories_v1';

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

function validateForm(){
  const name = productForm.name.value.trim();
  const price = productForm.price.value;
  const desc = productForm.description.value.trim();
  // Basic form checks for product creation/update
  // Allow empty description (legacy products may not have descriptions)
  const ok = name.length > 0 && price !== '' && !isNaN(Number(price));
  // Log last product form change (do not pollute with promotion variables)
  try{
    const timestamp = new Date().toISOString();
    const logEntry = { action: currentEditId ? 'update' : 'create', timestamp, name, price: Number(price) };
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
    throw new Error(`update-failed ${e.message}`);
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
  renderProducts(products);
  updateStats(products);
  refreshBtn.disabled = false; refreshBtn.textContent = prevText;
}

function renderProducts(products){
  productsTableBody.innerHTML = '';
  const categories = new Set();
  // attempt to load product->categories map (best-effort and async-safe)
  const productCats = loadProductCategories();
  for(const p of products){
    categories.add(p.category || '');
    const assigned = (productCats && (productCats[String(p.id)] || productCats[String(p.name)])) || [];
    const catsDisplay = (assigned && assigned.length) ? assigned.map(x => `<span class="pc-tag">${escapeHtml(x)}</span>`).join(' ') : (p.category || '');
    const tr = document.createElement('tr');
    let imgSrc = '';
    if(p.image_url){
      if(p.image_url.startsWith('http://') || p.image_url.startsWith('https://') || p.image_url.startsWith('//')) imgSrc = p.image_url;
      else if(p.image_url.startsWith('/')) imgSrc = API_BASE + p.image_url;
      else imgSrc = API_BASE + '/' + p.image_url.replace(/^\//, '');
    }
    tr.innerHTML = `
      <td>${imgSrc ? `<img src="${imgSrc}" alt="${p.name}" width="60" onerror="this.onerror=null;this.src='../images/default.png'">` : ''}</td>
      <td>${p.name}</td>
      <td>${catsDisplay}</td>
      <td>$${parseFloat(p.price).toFixed(2)}</td>
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
  document.getElementById('title').textContent = a.dataset.section === 'dashboard' ? 'Dashboard' : 'Catálogo';
  document.querySelectorAll('.section').forEach(s=>s.classList.add('hidden'));
  const target = document.getElementById(a.dataset.section);
  if(target) target.classList.remove('hidden');
  // If promo-images tab activated, ensure we load images
  try{ if(a.dataset.section === 'promo-images') fetchPromoImages(); }catch(e){ console.warn('fetchPromoImages guard failed', e); }
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

  const payload = { name: productForm.name.value.trim(), price: Number(productForm.price.value), description: productForm.description.value.trim(), category: productForm.category.value.trim() || null, image_url: imageUrl, active: true, stock: Number(productForm.stock?.value || 0) };
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
      // Only overwrite mapping when we have checkboxes loaded (admin explicitly made a choice).
      // If checkboxes did not exist (filters not loaded), preserve any existing mapping to avoid accidental deletion.
      const anyCheckboxes = !!document.querySelector('#categoryCheckboxes input[type=checkbox]');
      if (selectedCats && selectedCats.length) {
        mapping[key] = selectedCats;
      } else if (anyCheckboxes) {
        // If checkboxes exist and none are checked, user intentionally cleared categories -> delete mapping
        delete mapping[key];
      } else {
        // No checkboxes present: do not modify existing mapping (preserve)
      }
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
    productForm.price.value = p.price;
    productForm.category.value = p.category;
    productForm.description.value = p.description;
    try{ productForm.stock.value = (p.stock != null) ? String(p.stock) : '0'; }catch(_){ }
    try{ productForm.discount.value = (p.discount != null) ? String(p.discount) : ''; }catch(_){ }
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
// We now have two sections: web and app. Controls are suffixed with _web/_app.
const orderSearch_web = document.getElementById('orderSearch_web');
const orderDate_web = document.getElementById('orderDate_web');
const clearOrderDate_web = document.getElementById('clearOrderDate_web');
const refreshOrdersBtn_web = document.getElementById('refreshOrdersBtn_web');

const orderSearch_app = document.getElementById('orderSearch_app');
const orderDate_app = document.getElementById('orderDate_app');
const clearOrderDate_app = document.getElementById('clearOrderDate_app');
const refreshOrdersBtn_app = document.getElementById('refreshOrdersBtn_app');

let orderSourceFilter = '';

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
              const srvSrc = String((srv.source || 'web')).toLowerCase();
              // update any row in the DOM to remove pending marker (search across both tables)
              // but do NOT remove or delete local/app rows when the server reports this as 'web'.
              document.querySelectorAll('table[id^="ordersTable"] tbody tr').forEach(r => {
                try{
                  if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() !== String(id)) return;
                  const rowSrc = (r.getAttribute && (r.getAttribute('data-source') || '')).toLowerCase();
                  const isLocal = r.getAttribute && r.getAttribute('data-local-insert');
                  const localPayload = (window.__localOrderRows && window.__localOrderRows[id] && window.__localOrderRows[id].payload) || {};
                  const localPayloadSrc = String(localPayload.source || '').toLowerCase();
                  // Si el pedido ya tiene created_at, limpiar caché local y estado pendiente
                  if (srv && srv.created_at) {
                    try { delete window.__localOrderRows[id]; window.__localOrderIds && window.__localOrderIds.delete(String(id)); saveLocalOrderCache && saveLocalOrderCache(); } catch(_){}
                    r.removeAttribute('data-local-insert');
                    r.classList.remove('pending-sync');
                    r.classList.remove('pending-sync-resolved');
                    return;
                  }
                  const preserveBecauseApp = (rowSrc === 'app' || localPayloadSrc === 'app' || !!isLocal) && srvSrc === 'web';
                  if(preserveBecauseApp){
                    if(hasUserInfo){ r.classList.remove('pending-sync'); r.classList.add('pending-sync-resolved'); }
                    else { r.setAttribute('data-local-insert','1'); r.classList.add('pending-sync'); }
                  } else {
                    if(hasUserInfo){ r.removeAttribute('data-local-insert'); r.classList.remove('pending-sync'); }
                    else { r.setAttribute('data-local-insert','1'); r.classList.add('pending-sync'); }
                  }
                }catch(_){ }
              });
              // If server returned user info and this is NOT a preserved local/app row, we can clear the local cache; otherwise keep it so we can merge token preview into later renders
              try{
                const shouldDeleteLocal = (() => {
                  try{
                    const rec = window.__localOrderRows && window.__localOrderRows[id];
                    const localPayloadSrc = rec && rec.payload ? String(rec.payload.source || '').toLowerCase() : '';
                    // if local/app is present and server says web, do not delete
                    if((localPayloadSrc === 'app') && srvSrc === 'web') return false;
                    return hasUserInfo;
                  }catch(_){ return hasUserInfo; }
                })();
                if(shouldDeleteLocal){ try{ delete window.__localOrderRows[id]; window.__localOrderIds.delete(String(id)); try{ saveLocalOrderCache(); }catch(_){ } }catch(_){ } }
              }catch(_){ }
              try{ console.debug('[admin] verifyServerHasOrder: server-confirmed', id, 'hasUserInfo=', hasUserInfo, 'srvSrc=', srvSrc); }catch(_){ }
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

  // Si source es 'todos', no filtrar; si es 'web' o 'app', filtrar por source estrictamente
  try {
    if (String(source).toLowerCase() !== 'todos') {
      list = (list || []).filter(o => {
        let osrc = (o && typeof o.source !== 'undefined' && o.source !== null && String(o.source).trim() !== '') ? String(o.source) : 'web';
        return String(osrc).toLowerCase() === String(source).toLowerCase();
      });
    }
  } catch (_){ }
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
        if(tr) tr.setAttribute('data-source', String(o.source || source));
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
        const recSource = String((rec.payload.source||'')).toLowerCase();
        if(String(recSource) !== String(source).toLowerCase()) continue;
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
      showToast('Pedido actualizado');
    }catch(e){ console.error('mark seen failed', e); try{ if(row && row.children && row.children[5]) row.children[5].textContent = oldStatus; }catch(_){ } try{ if(btn) btn.textContent = oldBtnText; }catch(_){ } try{ if(btn) btn.classList.remove('updating'); if(row) row.classList.remove('updating'); }catch(_){ } showToast('No se pudo actualizar estado', 'error'); }
    finally{ try{ if(btn) btn.disabled = false; }catch(_){ } }
  }));
}

function orderRowFor(o){
  const itemsArr = safeParseItems(o.items || []);
  const itemsList = (itemsArr || []).map(it => {
    const name = (it && it.meta && it.meta.name) ? it.meta.name : (it && it.id) ? it.id : '';
    const qty = it && it.qty ? it.qty : 1;
    return `<li>${escapeHtml(name)} <span class="muted">×${qty}</span></li>`;
  }).join('');
  const tr = document.createElement('tr');
  const previewName = o._token_preview && (o._token_preview.name || o._token_preview.email) ? (o._token_preview.name || o._token_preview.email) : null;
  const displayName = o.user_full_name || previewName || o.user_email;
  const userDisplay = displayName ? `${displayName}${o.user_email && displayName !== o.user_email ? ' / ' + o.user_email : ''}` : (o.user_id ? `#${o.user_id}` : '—');
  const address = [o.user_barrio, o.user_calle, o.user_numeracion].filter(Boolean).join(', ');
  const fecha = o.created_at ? new Date(o.created_at).toLocaleString('es-ES', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
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
        <div class="order-row-items"><strong>Artículos:</strong><ul class="order-items-list">${itemsList}</ul></div>
        <div class="order-row-user"><strong>Cliente:</strong> ${escapeHtml(userDisplay)}</div>
        <div class="order-row-address"><strong>Dirección:</strong> ${escapeHtml(address || '—')}</div>
        <div class="order-row-total"><strong>Total:</strong> $${Number(o.total||0).toFixed(2)}</div>
        ${isPending ? '<div class="order-row-pending">• pendiente</div>' : ''}
        <div class="order-row-actions">
          <button data-id="${o.id}" class="viewOrderBtn btn">Ver</button>
          <button data-id="${o.id}" class="markSeenBtn btn">${o.status === 'visto' ? 'Visto' : 'Marcar visto'}</button>
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
    // Siempre insertar primero en 'todos'.
    const oid = String(o && o.id || '');
    let effectiveSource = source;
    try{ if(!effectiveSource && o && o.source) effectiveSource = o.source; }catch(_){ }
    try{ if(!effectiveSource && window.__localOrderRows && window.__localOrderRows[oid] && window.__localOrderRows[oid].payload && window.__localOrderRows[oid].payload.source) effectiveSource = window.__localOrderRows[oid].payload.source; }catch(_){ }
    // Insertar en 'todos' siempre
    const todosTableBody = document.querySelector('#ordersTable_todos tbody');
    if(todosTableBody) {
      let found = false;
      todosTableBody.querySelectorAll('tr').forEach(r => {
        if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === String(o.id)) found = true;
      });
      if(!found) {
        const trTodos = orderRowFor(o);
        try{ trTodos.setAttribute('data-source', String(effectiveSource || 'web')); }catch(_){ }
        todosTableBody.insertBefore(trTodos, todosTableBody.firstChild);
        try{ regroupOrdersForTable('todos'); }catch(_){ }
      }
      updateBadgeCount('todos');
    }

    // Solo insertar en la tabla específica si el pedido ya tiene created_at (confirmado por backend)
    // Y solo en la pestaña que corresponde a su source, nunca en la otra
    if(o.created_at && effectiveSource && ['web','app'].includes(String(effectiveSource).toLowerCase())) {
      if(String(effectiveSource).toLowerCase() === 'app') {
        // Nunca insertar en web si es de app
        const tableId = 'ordersTable_app';
        const ordersTableBody = document.querySelector(`#${tableId} tbody`);
        if(ordersTableBody) {
          let found = false;
          ordersTableBody.querySelectorAll('tr').forEach(r => {
            if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === String(o.id)) found = true;
          });
          if(!found) {
            const tr = orderRowFor(o);
            try{ tr.setAttribute('data-source', 'app'); }catch(_){ }
            ordersTableBody.insertBefore(tr, ordersTableBody.firstChild);
            try{ regroupOrdersForTable('app'); }catch(_){ }
          }
          updateBadgeCount('app');
        }
      } else if (String(effectiveSource).toLowerCase() === 'web') {
        // Nunca insertar en app si es de web
        const tableId = 'ordersTable_web';
        const ordersTableBody = document.querySelector(`#${tableId} tbody`);
        if(ordersTableBody) {
          let found = false;
          ordersTableBody.querySelectorAll('tr').forEach(r => {
            if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === String(o.id)) found = true;
          });
          if(!found) {
            const tr = orderRowFor(o);
            try{ tr.setAttribute('data-source', 'web'); }catch(_){ }
            ordersTableBody.insertBefore(tr, ordersTableBody.firstChild);
            try{ regroupOrdersForTable('web'); }catch(_){ }
          }
          updateBadgeCount('web');
        }
      }
    }
    // initialize local insert cache if not present
    try{ window.__localOrderRows = window.__localOrderRows || {}; window.__localOrderIds = window.__localOrderIds || new Set(); }catch(_){ window.__localOrderRows = window.__localOrderRows || {}; window.__localOrderIds = window.__localOrderIds || new Set(); }
    // avoid duplicates: if a row with this id exists in the current table, skip inserting
    let found = false;
    ordersTableBody.querySelectorAll('tr').forEach(r => {
      if(String((r.children && r.children[0] && r.children[0].textContent) || '').trim() === String(o.id)) found = true;
    });
    if(found) return;
    const tr = orderRowFor(o);
    // mark row as locally-inserted for diagnostics and tag its source
    try{ tr.setAttribute('data-local-insert', '1'); tr.classList.add('pending-sync'); if(effectiveSource) tr.setAttribute('data-source', String(effectiveSource)); }catch(_){ }
    ordersTableBody.insertBefore(tr, ordersTableBody.firstChild);
    try{ regroupOrdersForTable(effectiveSource); }catch(_){ }
    try{ console.debug('[admin] insertOrderAtTop inserted', o.id, 'source=' + effectiveSource); }catch(_){ }
    // remove duplicates with same id from other source tables so item only appears in its correct tab
    try {
      const oidStr = String(o.id);
      const otherSources = ['web','app'].filter(s => s !== String(effectiveSource));
      for (const os of otherSources) {
        try {
          const otherTable = document.querySelector(`#ordersTable_${os} tbody`);
          if (!otherTable) continue;
          Array.from(otherTable.querySelectorAll('tr')).forEach(rr => {
            try {
              const rid = String((rr.children && rr.children[0] && rr.children[0].textContent) || '').trim();
              if (rid !== oidStr) return;
              const isLocal = rr.getAttribute && rr.getAttribute('data-local-insert');
              const rowSrc = rr.getAttribute && (rr.getAttribute('data-source') || '').toLowerCase();
              const localCache = (window.__localOrderRows || {})[String(rid)];
              const localPayloadSrc = localCache && localCache.payload ? String(localCache.payload.source || '').toLowerCase() : '';
              // Si la fila es local y el backend la devuelve como 'web', eliminar la fila local de app
              if (os === 'app' && effectiveSource === 'web' && isLocal && (rowSrc === 'app' || localPayloadSrc === 'app')) {
                rr.parentNode && rr.parentNode.removeChild(rr);
                try { delete window.__localOrderRows[rid]; window.__localOrderIds.delete(String(rid)); saveLocalOrderCache(); } catch(_){}
                return;
              }
              // Si la fila local o el cache tiene source 'app', nunca eliminar ni reemplazar por 'web'
              if (isLocal && (rowSrc === 'app' || localPayloadSrc === 'app')) return;
              // Si la fila es local pero el backend la devuelve con source 'app', sí reemplazar
              if (rowSrc === 'app' && effectiveSource === 'app') {
                rr.parentNode && rr.parentNode.replaceChild(tr, rr);
                return;
              }
              // Si la fila es local y el backend la devuelve como 'web', nunca eliminar
              if (isLocal && effectiveSource === 'web') return;
              // default: eliminar si no es local/app
              rr.parentNode && rr.parentNode.removeChild(rr);
            } catch (_) { }
          });
        } catch (_) { }
      }
    } catch (_) { }
    // save HTML snapshot and payload so we can restore/merge it if a render happens concurrently
    try{
      // ensure payload records the effective source so restores remain consistent
      const payload = Object.assign({}, o);
      try{ if(!payload.source && typeof effectiveSource !== 'undefined') payload.source = effectiveSource; }catch(_){ }
      window.__localOrderRows[String(o.id)] = { html: tr.outerHTML, ts: Date.now(), pending: true, payload };
      window.__localOrderIds.add(String(o.id)); try{ saveLocalOrderCache(); }catch(_){ }
    }catch(_){ }
    // wire view button
    try{ tr.querySelector('.viewOrderBtn').onclick = async (ev) => { const id = ev.target.dataset.id; const list = await fetchOrders(String(id)); const order = (list || []).find(x => String(x.id) === String(id)) || (list && list[0]); if(order) showOrderDetail(order); }; }catch(e){}
    // start verification loop to confirm order persisted on server and remove pending state
    try{ verifyServerHasOrder(String(o.id)); }catch(e){ console.warn('verifyServerHasOrder failed start', e); }
  }catch(e){ console.error('insertOrderAtTop failed', e); }
}

function showOrderDetail(order){
  const modal = document.getElementById('orderModal'); const body = document.getElementById('orderModalBody'); const title = document.getElementById('orderModalTitle');
  if(!modal || !body || !title) return;
  title.textContent = `Pedido #${order.id}`;
  const itemsArr = safeParseItems(order.items || []);
  const itemsHtml = (itemsArr || []).map(it=>`<li><strong>${escapeHtml((it && it.meta && it.meta.name) ? it.meta.name : (it && it.id) ? it.id : '')}</strong> — ${it.qty} × $${Number(it.meta?.price||0).toFixed(2)}</li>`).join('') || '<li>(sin ítems)</li>';
  const address = [order.user_barrio, order.user_calle, order.user_numeracion].filter(Boolean).join(', ');
  // prefer user_* fields, otherwise display token preview when available
  const previewName = order._token_preview && (order._token_preview.name || order._token_preview.email) ? (order._token_preview.name || order._token_preview.email) : null;
  const displayName = order.user_full_name || previewName || order.user_email || (order.user_id ? '#'+order.user_id : '—');
  body.innerHTML = `
    <div class="modal-order-body">
      <div><strong>Usuario:</strong> ${escapeHtml(displayName)} ${order.user_email && displayName !== order.user_email ? ' / ' + escapeHtml(order.user_email) : ''}</div>
      <div><strong>Dirección:</strong> ${escapeHtml(address || '—')}</div>
      <div><strong>Total:</strong> $${Number(order.total||0).toFixed(2)}</div>
      <div><strong>Estado:</strong> ${escapeHtml(order.status||'')}</div>
      <div class="mt-8"><strong>Items:</strong><ul class="order-items-list">${itemsHtml}</ul></div>
    </div>
  `;
  // add action button for marking seen
  try{
    const actionWrap = document.createElement('div'); actionWrap.style.marginTop = '10px';
    const markBtn = document.createElement('button'); markBtn.className = 'btn'; markBtn.textContent = order.status === 'visto' ? 'Visto' : 'Marcar visto';
    markBtn.onclick = async () => {
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
        markBtn.classList.remove('updating');
        showToast('Estado actualizado');
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
    source = source || 'web';
    const q = (source === 'app' ? (orderSearch_app && orderSearch_app.value) : (orderSearch_web && orderSearch_web.value)) ? (source === 'app' ? orderSearch_app.value.trim() : orderSearch_web.value.trim()) : '';
    const date = (source === 'app' ? (orderDate_app && orderDate_app.value) : (orderDate_web && orderDate_web.value)) ? (source === 'app' ? orderDate_app.value : orderDate_web.value) : '';
    const list = await fetchOrders(q, date, source);
    if (list === null){
      console.warn('refreshOrders: fetch failed; preserving existing orders table');
      showToast('No se pudo actualizar pedidos (conservando la vista actual)', 'warning');
      return;
    }
    // If server didn't support date filtering, apply an extra client-side filter by created_at date (ISO YYYY-MM-DD)
    const dateFilter = date || '';
    let toRender = list;
    if(dateFilter){ try{ toRender = (list || []).filter(o => { try{ return (o.created_at || '').slice(0,10) === dateFilter; }catch(_){ return false; } }); }catch(e){ toRender = list; } }
    renderOrders(toRender, source, date);
  }catch(e){ console.error('refreshOrders failed', e); showToast('Error al cargar pedidos', 'error'); }
}

// Wire refresh buttons per-section and add a single test push button
const anchorForTest = document.querySelector('#refreshOrdersBtn_web') || document.querySelector('#refreshOrdersBtn_app');
if(refreshOrdersBtn_web) refreshOrdersBtn_web.addEventListener('click', ()=> refreshOrders('web'));
if(refreshOrdersBtn_app) refreshOrdersBtn_app.addEventListener('click', ()=> refreshOrders('app'));
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

if(orderSearch_app) orderSearch_app.addEventListener('input', ()=> refreshOrders('app'));
if(orderDate_app) orderDate_app.addEventListener('change', ()=> refreshOrders('app'));
if(clearOrderDate_app) clearOrderDate_app.addEventListener('click', ()=> { if(orderDate_app) orderDate_app.value = ''; refreshOrders('app'); });

const orderSearch_todos = document.getElementById('orderSearch_todos');
const orderDate_todos = document.getElementById('orderDate_todos');
const clearOrderDate_todos = document.getElementById('clearOrderDate_todos');
const refreshOrdersBtn_todos = document.getElementById('refreshOrdersBtn_todos');
if(orderSearch_todos) orderSearch_todos.addEventListener('input', ()=> refreshOrders('todos'));
if(orderDate_todos) orderDate_todos.addEventListener('change', ()=> refreshOrders('todos'));
if(clearOrderDate_todos) clearOrderDate_todos.addEventListener('click', ()=> { if(orderDate_todos) orderDate_todos.value = ''; refreshOrders('todos'); });
if(refreshOrdersBtn_todos) refreshOrdersBtn_todos.addEventListener('click', ()=> refreshOrders('todos'));

// Tabs and badges wiring
const ordersSection = document.getElementById('orders');
const tabTodosBtn = document.getElementById('tab_todos');
const tabWebBtn = document.getElementById('tab_web');
const tabAppBtn = document.getElementById('tab_app');
const badgeTodos = document.getElementById('badge_todos');
const badgeWeb = document.getElementById('badge_web');
const badgeApp = document.getElementById('badge_app');
const clearOrderCacheBtn = document.getElementById('clearOrderCache');

function showTab(source){
  try{
    const todosSec = document.getElementById('orders_todos');
    const webSec = document.getElementById('orders_web');
    const appSec = document.getElementById('orders_app');
    if(source === 'todos'){
      if(webSec) webSec.classList.add('hidden');
      if(appSec) appSec.classList.add('hidden');
      if(todosSec) todosSec.classList.remove('hidden');
      if(tabWebBtn) tabWebBtn.classList.remove('active');
      if(tabAppBtn) tabAppBtn.classList.remove('active');
      if(tabTodosBtn) tabTodosBtn.classList.add('active');
      refreshOrders('todos');
    } else if(source === 'app'){
      if(webSec) webSec.classList.add('hidden');
      if(appSec) appSec.classList.remove('hidden');
      if(todosSec) todosSec.classList.add('hidden');
      if(tabWebBtn) tabWebBtn.classList.remove('active');
      if(tabAppBtn) tabAppBtn.classList.add('active');
      if(tabTodosBtn) tabTodosBtn.classList.remove('active');
      refreshOrders('app');
    } else {
      if(appSec) appSec.classList.add('hidden');
      if(webSec) webSec.classList.remove('hidden');
      if(todosSec) todosSec.classList.add('hidden');
      if(tabAppBtn) tabAppBtn.classList.remove('active');
      if(tabWebBtn) tabWebBtn.classList.add('active');
      if(tabTodosBtn) tabTodosBtn.classList.remove('active');
      refreshOrders('web');
    }
  }catch(e){ console.warn('showTab failed', e); }
}

if(tabTodosBtn) tabTodosBtn.addEventListener('click', ()=> showTab('todos'));
if(tabWebBtn) tabWebBtn.addEventListener('click', ()=> showTab('web'));
if(tabAppBtn) tabAppBtn.addEventListener('click', ()=> showTab('app'));
if(clearOrderCacheBtn) clearOrderCacheBtn.addEventListener('click', ()=>{ try{ localStorage.removeItem('admin_local_orders_v1'); window.__localOrderRows = {}; window.__localOrderIds = new Set(); showToast('Caché local de pedidos limpiada', 'info'); refreshOrders('web'); refreshOrders('app'); }catch(e){ console.warn('clearOrderCache failed', e); showToast('No se pudo limpiar caché','error'); } });

function updateBadgeCount(source){
  try{
    const table = document.querySelector(`#ordersTable_${source} tbody`);
    if(!table) return;
    const rows = table.querySelectorAll('tr');
    const count = Array.from(rows).filter(r => !(r.children && r.children[0] && r.children[0].textContent && r.children[0].textContent.indexOf('No hay pedidos') !== -1)).length;
    if(source === 'todos' && badgeTodos) badgeTodos.textContent = String(count);
    if(source === 'app' && badgeApp) badgeApp.textContent = String(count);
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
    renderCategoryCheckboxes(filters, []);
  }catch(e){ console.warn('openModal: failed to populate categories', e); }
  setTimeout(()=> productForm.name.focus(), 120);
}
function closeModal(){
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); currentEditId = null; imageUrl = null; selectedFile = null; fileNameEl.textContent = 'Ningún archivo seleccionado'; imagePreview.innerHTML = ''; productForm.reset(); validateForm();
}
// Close modal when clicking outside the modal card
if(modal) modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
// Close on ESC key
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

// Enable validation
if(productForm) productForm.addEventListener('input', validateForm);

// Promotions persistence helpers
function loadPromotions(){
  try{ const raw = localStorage.getItem(PROMO_KEY) || '[]'; const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }catch(e){ console.warn('loadPromotions failed', e); return []; }
}
function savePromotions(promos){
  try{ localStorage.setItem(PROMO_KEY, JSON.stringify(promos || [])); }catch(e){ console.warn('savePromotions failed', e); }
}
function renderPromotions(){
  try{
    const promos = loadPromotions();
    if(!promotionsTableBody) return;
    promotionsTableBody.innerHTML = '';
    for(const p of (promos || [])){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.type || ''}${p.type === 'percent' && p.value ? ' ('+p.value+'%)' : ''}</td><td>${(p.productIds||[]).length}</td><td><button data-id="${p.id}" class="editPromo btn">Editar</button><button data-id="${p.id}" class="delPromo btn">Eliminar</button></td>`;
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
function saveFilters(filters){
  try{ localStorage.setItem(FILTERS_KEY, JSON.stringify(filters || [])); }catch(e){ console.warn('saveFilters failed', e); }
  try{ publishFilters(filters); }catch(e){ console.warn('publishFilters failed', e); }
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
      const div = document.createElement('div'); div.className = 'pc-item';
      div.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" value="${escapeHtml(rawVal)}"> ${escapeHtml(rawName)}</label>`;
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

if(importFiltersBtn) importFiltersBtn.addEventListener('click', async ()=>{ try{ const f = await safeFetch(`${API_BASE}/filters.json`).catch(()=>null); if(f && Array.isArray(f)){ saveFilters(f); renderFilters(); showToast('Filtros importados'); try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('filters_channel'); bc.postMessage({ action: 'filters-updated', filters: f }); bc.close(); } }catch(e){} } else showToast('Archivo de filtros inválido o no encontrado','error'); }catch(e){ console.error('importFilters failed', e); showToast('Error importando filtros','error'); } });

// Listen for product-categories broadcast updates
try{ if(window.BroadcastChannel){ const bcpc = new BroadcastChannel('product_categories_channel'); bcpc.onmessage = (ev) => { try{ if(ev.data && ev.data.action === 'product-categories-updated'){ console.log('[admin] product-categories updated via BroadcastChannel'); fetchAndSyncProductCategories().then(()=>refresh()).catch(()=>refresh()); } }catch(e){} }; } }catch(e){}

// ensure filters UI is initialized
try{ renderFilters(); }catch(e){ console.warn('initial renderFilters failed', e); }
// ensure server has current filters snapshot when admin loads
try{ publishFilters(loadFilters()); }catch(e){ console.warn('initial publishFilters failed', e); }
// fetch product-categories snapshot (best-effort)
try{ fetchAndSyncProductCategories().then(()=>{ console.log('[admin] product-categories synced'); }).catch(e => console.warn('product-categories sync failed', e)); }catch(e){ console.warn('initial fetchAndSyncProductCategories failed', e); }

// initial load
refresh();
renderPromotions();
// restore any locally-inserted order previews (persisted across reloads)
loadLocalOrderCache();
refreshOrders('web');
refreshOrders('app');

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
              // Si alguna fila es local/pending o app, nunca la borres ni la reemplaces por una web
              const prevIsLocal = prev.row.getAttribute && prev.row.getAttribute('data-local-insert');
              const currIsLocal = r.getAttribute && r.getAttribute('data-local-insert');
              const prevSrc = prev.row.getAttribute && (prev.row.getAttribute('data-source') || '').toLowerCase();
              const currSrc = r.getAttribute && (r.getAttribute('data-source') || '').toLowerCase();
              if(prevIsLocal || prevSrc === 'app'){
                // nunca borrar ni reemplazar local/app
                try{ r.parentNode && r.parentNode.removeChild(r); }catch(_){ }
                continue;
              }
              if(currIsLocal || currSrc === 'app'){
                // nunca borrar ni reemplazar local/app
                try{ prev.row.parentNode && prev.row.parentNode.removeChild(prev.row); }catch(_){ }
                byId.set(id, { row: r, ts: createdTs });
                continue;
              }
              // Si ninguna es local/app, preferir la más reciente
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
  setInterval(()=>{ refreshOrders('web'); refreshOrders('app'); }, 10000); // every 10s
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
            // Solo insertar si el source es válido
            const src = String(data.order.source).toLowerCase();
            if(src === 'app' || src === 'web') {
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
                  // server has the record; solo insertar si el source es válido
                  try{
                    const srv = list[0];
                    if(srv && (srv.source === 'app' || srv.source === 'web')){
                      insertOrderAtTop(srv);
                      try{ showToast(`Pedido recibido: #${srv.id}`); }catch(_){ }
                    }
                  }catch(_){ }
                } else {
                  // fallback: full refresh both sections
                  refreshOrders('web'); refreshOrders('app');
                }
              }catch(e){ console.warn('fetch by id after ws event failed', e); refreshOrders('web'); refreshOrders('app'); }
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
  if(promoName) promoName.value = ''; if(promoDesc) promoDesc.value = '';
  if(savePromoBtn) savePromoBtn.disabled = true;
  if(promoProductsList) promoProductsList.innerHTML = 'Cargando productos...';
  let products = [];
  try{ products = await fetchProducts(); }catch(e){ console.warn('fetchProducts failed', e); }
  if(!products || !products.length){
    // try snapshot file
    try{ const resp = await fetch('../catalogo/products.json'); if(resp.ok){ products = await resp.json(); } }catch(e){}
  }
  allProductsCache = (products || []);
  if(!allProductsCache.length){ if(promoProductsList) promoProductsList.innerHTML = '<div class="empty">No se encontraron productos</div>'; }
  else { renderPromoProductsList(allProductsCache); }
  if(editId){
  const promos = loadPromotions(); const p = promos.find(x => x.id == editId); if(p){ if(promoName) promoName.value = p.name; if(promoDesc) promoDesc.value = p.description || ''; }
    // mark selected products
  setTimeout(()=>{ if(editId){ const promos = loadPromotions(); const p = promos.find(x=> x.id == editId); if(p && promoProductsList){ p.productIds.forEach(pid => { const cb = promoProductsList.querySelector(`input[data-id='${pid}']`); if(cb) cb.checked = true; }); } } }, 80);
  }
  // focus first input to make it obvious modal opened
  setTimeout(()=>{ try{ if(promoName) promoName.focus(); }catch(e){} }, 80);
  console.log('[admin] openPromoModal done, products count=', allProductsCache.length);
}
// expose function after declaration so it is always available from console
if(typeof openPromoModal === 'function') window.openPromoModalPublic = openPromoModal;

function closePromoModal(){ promoModal.classList.add('hidden'); promoModal.setAttribute('aria-hidden', 'true'); currentPromotionEditId = null; promoProductsList.innerHTML = ''; }

function renderPromoProductsList(products){ promoProductsList.innerHTML = ''; for(const pr of products){ const div = document.createElement('div'); div.className = 'promo-product-row'; div.innerHTML = `<input type="checkbox" data-id="${pr.id}" id="promo-p-${pr.id}" /><label for="promo-p-${pr.id}">${pr.name} <small class="muted">${pr.category||''}</small></label>`; promoProductsList.appendChild(div); } }

function updateSavePromoBtn(){ const name = promoName.value.trim(); const anyChecked = Array.from(promoProductsList.querySelectorAll('input[type=checkbox]')).some(cb => cb.checked); let ok = (name && anyChecked); try{ if(promoType && promoType.value === 'percent'){ const v = Number(promoValue.value); ok = ok && !isNaN(v) && v > 0; } }catch(e){}; if(savePromoBtn) savePromoBtn.disabled = !ok; }
// When type is percent, ensure a value is entered
if(promoType) promoType.onchange = () => { try{ if(promoType.value === 'percent'){ if(promoValueField) promoValueField.style.display = 'block'; } else { if(promoValueField) promoValueField.style.display = 'none'; } }catch(e){}; updateSavePromoBtn(); };
if(promoValue) promoValue.oninput = () => { updateSavePromoBtn(); };

function filterPromoProducts(q){ q = (q||'').toLowerCase(); const filtered = allProductsCache.filter(p => !q || p.name.toLowerCase().includes(q) || (p.brand||'').toLowerCase().includes(q)); renderPromoProductsList(filtered); }

async function savePromo(){ const name = promoName.value.trim(); const desc = promoDesc.value.trim(); const checked = Array.from(promoProductsList.querySelectorAll('input[type=checkbox]:checked')).map(cb => Number(cb.getAttribute('data-id'))); if(!name || !checked.length){ return showToast('Agrega nombre y al menos un producto','error'); }
  // compute type and value
  const type = (promoType && promoType.value) ? promoType.value : 'percent';
  const value = (promoValue && promoValue.value) ? Number(promoValue.value) : null;
  let promos = loadPromotions(); if(currentPromotionEditId){ const idx = promos.findIndex(x=> x.id == currentPromotionEditId); if(idx > -1){ promos[idx].name = name; promos[idx].description = desc; promos[idx].productIds = checked; promos[idx].type = type; promos[idx].value = value; } }else{ const p = { id: Date.now(), name, description: desc, productIds: checked, type, value }; promos.push(p); }
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
if(promoSearch) promoSearch.oninput = (e)=> { const q = e.target.value.toLowerCase(); const promos = loadPromotions().filter(ps => ps.name.toLowerCase().includes(q) || (ps.description||'').toLowerCase().includes(q)); promotionsTableBody.innerHTML = ''; for(const p of promos){ const tr = document.createElement('tr'); tr.innerHTML = `<td>${p.name}</td><td>${p.type || ''}${p.type === 'percent' && p.value ? ' ('+p.value+'%)' : ''}</td><td>${(p.productIds||[]).length}</td><td><button data-id="${p.id}" class="editPromo btn">Editar</button><button data-id="${p.id}" class="delPromo btn">Eliminar</button></td>`; promotionsTableBody.appendChild(tr); } document.querySelectorAll('.delPromo').forEach(btn => btn.onclick = () => { deletePromotion(btn.dataset.id); }); document.querySelectorAll('.editPromo').forEach(btn => btn.onclick = () => { editPromotion(btn.dataset.id); }); }
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
const addConsumosBtn = document.getElementById('addConsumosBtn');
const addConsumosModal = document.getElementById('addConsumoModal');
const addConsumosList = document.getElementById('addConsumosList');
const addConsumosSearch = document.getElementById('addConsumosSearch');
const addConsumosConfirmBtn = document.getElementById('addConsumosConfirmBtn');
const addConsumosCloseBtn = document.getElementById('addConsumosCloseBtn');
const addConsumosCancelBtn = document.getElementById('addConsumosCancelBtn');

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

// --- Add Consumptions modal behaviors ---
async function openAddConsumosModal(){
  if(!addConsumosModal) return;
  try{
    // Fetch products and existing consumos to prefill values
    let products = [];
    try{ products = await fetchProducts(); }catch(e){ console.warn('openAddConsumosModal: fetchProducts failed', e); }
    if(!products || !products.length){ try{ const resp = await fetch('../catalogo/products.json'); if(resp.ok) products = await resp.json(); }catch(e){} }
    let existing = [];
    try{ const r = await safeFetch(API_BASE + '/api/consumos').catch(()=>[]); existing = Array.isArray(r) ? r : []; }catch(e){ existing = []; }
    renderAddConsumosList(products, existing);
    addConsumosModal.classList.remove('hidden'); addConsumosModal.setAttribute('aria-hidden','false');
    if(addConsumosSearch) setTimeout(()=> addConsumosSearch.focus(), 80);
  }catch(e){ console.error('openAddConsumosModal failed', e); showToast('No se pudo abrir el selector de consumos','error'); }
}
function closeAddConsumosModal(){ if(!addConsumosModal) return; addConsumosModal.classList.add('hidden'); addConsumosModal.setAttribute('aria-hidden','true'); if(addConsumosList) addConsumosList.innerHTML = ''; }

function renderAddConsumosList(products, existing){
  if(!addConsumosList) return;
  try{
    const map = {};
    (existing || []).forEach(c => { try{ map[String(c.id)] = Number(c.discount || c.value || 0); }catch(_){ } });
    addConsumosList.innerHTML = '';
    const frag = document.createDocumentFragment();
    for(const p of (products || [])){
      try{
        const row = document.createElement('div'); row.className = 'add-consumo-row'; row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.padding = '6px 8px'; row.style.borderBottom = '1px solid rgba(0,0,0,0.04)';
        const left = document.createElement('div'); left.style.flex = '1'; left.innerHTML = `${escapeHtml(p.name || p.nombre || '')} <small style="color:#666; display:block">${escapeHtml(p.category || p.categoria || '')}</small>`;
        const right = document.createElement('div'); right.style.display = 'flex'; right.style.gap = '8px';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.id = String(p.id); cb.id = 'addc_' + String(p.id);
        const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.max = 100; inp.placeholder = 'Descuento %'; inp.style.width = '88px'; inp.dataset.id = String(p.id);
        if(map[String(p.id)] != null){ cb.checked = true; inp.value = String(map[String(p.id)]); }
        right.appendChild(inp); right.appendChild(cb);
        row.appendChild(left); row.appendChild(right); frag.appendChild(row);
      }catch(e){ /* ignore individual row errors */ }
    }
    addConsumosList.appendChild(frag);
  }catch(e){ console.warn('renderAddConsumosList failed', e); }
}

async function confirmAddConsumos(){
  try{
    if(!addConsumosList) return;
    const rows = Array.from(addConsumosList.querySelectorAll('.add-consumo-row'));
    const selected = [];
    for(const r of rows){
      try{
        const cb = r.querySelector('input[type=checkbox]');
        const inp = r.querySelector('input[type=number]');
        if(cb && cb.checked){
          const id = Number(cb.dataset.id);
          const discount = Number(inp && inp.value ? inp.value : 0);
          if(!isNaN(discount) && discount > 0){ selected.push({ id, discount }); }
        }
      }catch(_){ }
    }
    // Merge with existing consumos: fetch current, replace per selected, preserve others not touched
    let existing = [];
    try{ const r = await safeFetch(API_BASE + '/api/consumos').catch(()=>[]); existing = Array.isArray(r) ? r : []; }catch(e){ existing = []; }
    const selMap = {}; selected.forEach(s => { selMap[String(s.id)] = s.discount; });
    const merged = [];
    // keep existing ones not replaced
    (existing || []).forEach(e => { if(!selMap[String(e.id)]) merged.push(e); });
    // add selected ones
    selected.forEach(s => merged.push({ id: s.id, discount: s.discount }));
    // Save merged consumos
    const resp = await safeFetch(API_BASE + '/api/consumos', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(merged) });
    showToast('Consumiciones agregadas', 'info');
    // Broadcast update so catalog refreshes
    try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('consumos_channel'); bc.postMessage({ action: 'consumos-updated', consumos: merged }); bc.close(); } }catch(e){}
    closeAddConsumosModal();
    // reload admin view
    await loadConsumos();
  }catch(e){ console.error('confirmAddConsumos failed', e); showToast('Error agregando consumos','error'); }
}

// Wire add-consumos modal controls
if(addConsumosBtn) addConsumosBtn.addEventListener('click', (e)=>{ e.preventDefault(); openAddConsumosModal(); });
if(addConsumosCloseBtn) addConsumosCloseBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeAddConsumosModal(); });
if(addConsumosCancelBtn) addConsumosCancelBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeAddConsumosModal(); });
if(addConsumosConfirmBtn) addConsumosConfirmBtn.addEventListener('click', (e)=>{ e.preventDefault(); confirmAddConsumos(); });
if(addConsumosSearch) addConsumosSearch.addEventListener('input', (e)=>{ const q = (e.target.value||'').toLowerCase(); if(!addConsumosList) return; Array.from(addConsumosList.children).forEach(r=>{ const txt = (r.textContent||'').toLowerCase(); r.style.display = (!q || txt.includes(q)) ? 'flex' : 'none'; }); });

function renderConsumosList(products, consumos){
  if(!consumosList) return;
  consumosList.innerHTML = '';
  const map = {};
  (consumos || []).forEach(c => { map[String(c.id)] = c.discount; });
  for(const p of (products || [])){
    const row = document.createElement('div'); row.className = 'consumo-row';
    const left = document.createElement('div'); left.className = 'left';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.id = String(p.id); cb.id = 'consumo-p-' + p.id; if(map[String(p.id)]) cb.checked = true;
    const lbl = document.createElement('label'); lbl.htmlFor = cb.id; lbl.innerText = p.name + (p.category ? ' — '+p.category : '');
    left.appendChild(cb); left.appendChild(lbl);
    const right = document.createElement('div'); right.className = 'right';
    const inp = document.createElement('input'); inp.type='number'; inp.min=0; inp.max=100; inp.placeholder='Descuento %'; inp.value = map[String(p.id)] != null ? String(map[String(p.id)]) : '';
    inp.dataset.id = String(p.id);
    right.appendChild(inp);
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
      if(cb && cb.checked){
        const id = Number(cb.dataset.id);
        const discount = Number(inp && inp.value ? inp.value : 0);
        if(isNaN(discount) || discount <= 0) continue;
        data.push({ id, discount });
      }
    }
    const resp = await safeFetch(API_BASE + '/api/consumos', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    showToast('Consumiciones guardadas', 'info');
    // broadcast to frontend so catalog refreshes live
    try{ if(window.BroadcastChannel){ const bc = new BroadcastChannel('consumos_channel'); bc.postMessage({ action: 'consumos-updated', consumos: data }); bc.close(); } }catch(e){}
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
    });
    // close when clicking outside sidebar on mobile
    document.addEventListener('pointerdown', (ev)=>{
      if(window.innerWidth > 900) return; // only mobile
      if(!sidebar.classList.contains('open')) return;
      if(ev.target.closest && (ev.target.closest('.sidebar') || ev.target.closest('#mobileMenuBtn'))) return;
      sidebar.classList.remove('open');
      const btn = document.getElementById('mobileMenuBtn'); if(btn) btn.setAttribute('aria-expanded','false');
    });
    // close with Escape
    window.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape' && sidebar.classList.contains('open')) { sidebar.classList.remove('open'); const btn = document.getElementById('mobileMenuBtn'); if(btn) btn.setAttribute('aria-expanded','false'); } });
  }
}catch(e){console.warn('mobile menu wiring failed', e)}
