// Admin JS — enhanced UI, validations and file upload flow
console.log('[admin] app.js loaded');
// Debug: expose openPromoModal for console invocation and report DOM element presence
if(typeof openPromoModal === 'function') window.openPromoModalPublic = openPromoModal;
setTimeout(() => {
  console.log('[admin] elements present', { newPromoBtn: !!document.getElementById('newPromoBtn'), promoModal: !!document.getElementById('promoModal'), promoProductsList: !!document.getElementById('promoProductsList') });
}, 40);
const API_BASE = (location.protocol && location.protocol.startsWith('http')) ? location.origin : "http://127.0.0.1:8000";
// show API base in UI
const apiBaseIndicator = document.getElementById('apiBaseIndicator');
const wsStatus = document.getElementById('wsStatus');
if(apiBaseIndicator) apiBaseIndicator.textContent = API_BASE;
// restore dark mode preference
try{ const dark = localStorage.getItem('dark'); if(dark === '1'){ document.body.classList.add('dark'); const toggle = document.getElementById('toggleDark'); if(toggle) toggle.checked = true; } }catch(e){}

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
  toast.textContent = msg; toast.classList.remove('hidden');
  toast.classList.toggle('toast-error', type === 'error');
  setTimeout(()=>{ toast.classList.add('hidden'); toast.classList.remove('toast-error') }, 3200);
}

function validateForm(){
  const name = productForm.name.value.trim();
  const price = productForm.price.value;
  const desc = productForm.description.value.trim();
  // Basic form checks for product creation/update
  const ok = name.length > 0 && desc.length > 0 && price !== '' && !isNaN(Number(price));
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
  const res = await fetch(`${API_BASE}/products?` + params.toString());
  return res.json();
}

async function createProduct(payload){
  const url = `${API_BASE}/products`;
  console.log('createProduct -> POST', url, payload);
  const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json', 'Accept': 'application/json'}, body: JSON.stringify(payload)});
  if(!res.ok){
    let text;
    try{ text = await res.json(); text = JSON.stringify(text); }catch(e){ text = await res.text().catch(()=>res.statusText); }
    throw new Error(`create-failed (${res.status}) ${text}`);
  }
  return res.json();
}

async function updateProduct(id, payload){
  const url = `${API_BASE}/products/${id}`;
  console.log('updateProduct -> PUT', url, payload);
  const res = await fetch(url, {method:'PUT', headers:{'Content-Type':'application/json', 'Accept': 'application/json'}, body: JSON.stringify(payload)});
  if(!res.ok){
    let text;
    try{ text = await res.json(); text = JSON.stringify(text); }catch(e){ text = await res.text().catch(()=>res.statusText); }
    throw new Error(`update-failed (${res.status}) ${text}`);
  }
  return res.json();
}

async function deleteProduct(id){
  const url = `${API_BASE}/products/${id}`;
  console.log('deleteProduct -> DELETE', url);
  const res = await fetch(url, {method: 'DELETE'});
  if(!res.ok){
    let text;
    try{ text = await res.json(); text = JSON.stringify(text); }catch(e){ text = await res.text().catch(()=>res.statusText); }
    throw new Error(`delete-failed (${res.status}) ${text}`);
  }
  return res;
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
  for(const p of products){
    categories.add(p.category || '');
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
      <td>${p.category || ''}</td>
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
  if(window.categoryChart) window.categoryChart.destroy();
  window.categoryChart = new Chart(ctx, {type:'pie', data:{labels:Object.keys(byCat), datasets:[{data:Object.values(byCat), backgroundColor:['#60A5FA','#F59E0B','#10B981','#F43F5E','#8B5CF6']} ]}});
}

// Modal and form behaviors
if(newBtn) newBtn.onclick = () => { openModal(); };
if(modalClose) modalClose.onclick = () => closeModal();
if(cancelBtn) cancelBtn.onclick = () => closeModal();
if(refreshBtn) refreshBtn.onclick = () => refresh();
if(searchInput) searchInput.oninput = () => refresh();
if(sortSelect) sortSelect.onchange = () => refresh();
document.querySelectorAll('.sidebar nav a').forEach(a => a.onclick = () => { document.querySelectorAll('.sidebar nav a').forEach(x=>x.classList.remove('active')); a.classList.add('active'); document.getElementById('title').textContent = a.dataset.section === 'dashboard' ? 'Dashboard' : 'Catálogo'; document.querySelectorAll('.section').forEach(s=>s.classList.add('hidden')); document.getElementById(a.dataset.section).classList.remove('hidden'); });

// Theme toggle
const toggle = document.getElementById('toggleDark'); if(toggle) toggle.onchange = () => { document.body.classList.toggle('dark', toggle.checked); try{ localStorage.setItem('dark', toggle.checked ? '1' : '0'); }catch(e){} };

async function handleSave(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  console.log('[admin] handleSave invoked', { currentEditId, name: productForm.name.value, price: productForm.price.value, selectedFile, imageUrl });
  saveBtn.disabled = true;
  const payload = { name: productForm.name.value.trim(), price: Number(productForm.price.value), description: productForm.description.value.trim(), category: productForm.category.value.trim() || null, image_url: imageUrl, active: true };
  try{
    if(currentEditId){ await updateProduct(currentEditId, payload); showToast('Producto actualizado'); }
    else { await createProduct(payload); showToast('Producto creado'); }
    closeModal(); refresh();
  }catch(err){ console.error(err); showToast('Error guardando producto','error'); }
  finally { saveBtn.disabled = false; }
}
if(productForm) productForm.onsubmit = handleSave;
if(saveBtn){
  try{ saveBtn.addEventListener('click', handleSave); }catch(e){ saveBtn.onclick = handleSave; }
}

async function onEdit(id){
  try{
    const res = await fetch(API_BASE + '/products/' + id);
    const p = await res.json();
    currentEditId = id;
    productForm.name.value = p.name;
    productForm.price.value = p.price;
    productForm.category.value = p.category;
    productForm.description.value = p.description;
    let previewSrc = '';
    if(p.image_url){
      if(p.image_url.startsWith('http://') || p.image_url.startsWith('https://') || p.image_url.startsWith('//')) previewSrc = p.image_url;
      else if(p.image_url.startsWith('/')) previewSrc = API_BASE + p.image_url;
      else previewSrc = API_BASE + '/' + p.image_url.replace(/^\//, '');
    }
  imagePreview.innerHTML = previewSrc ? `<img src="${previewSrc}" onerror="this.onerror=null;this.src='../images/default.png'"/>` : '';
    imageUrl = p.image_url;
    selectedFile = null; fileNameEl.textContent = p.image_url ? p.image_url.split('/').pop() : 'Ningún archivo seleccionado';
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

function openModal(){
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false');
  document.getElementById('modalTitle').textContent = currentEditId ? 'Editar producto' : 'Nuevo producto';
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

// initial load
refresh();
renderPromotions();

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
  socket.onmessage = (ev) => {
    try{ const data = JSON.parse(ev.data); if(['created','updated','deleted'].includes(data.action)){ refresh(); showToast(`Evento: ${data.action}`); } }catch(e){console.error(e)}
  };
}
setupSocket();

// Promotions functions
function loadPromotions(){ try{ return JSON.parse(localStorage.getItem(PROMO_KEY) || '[]'); }catch(e){ return []; } }
function savePromotions(promos){ try{ localStorage.setItem(PROMO_KEY, JSON.stringify(promos)); try{ localStorage.setItem(PROMO_KEY + '_lastUpdated', new Date().toISOString()); }catch(e){} }catch(e){} }
function renderPromotions(){ const promos = loadPromotions(); promotionsTableBody.innerHTML = ''; for(const p of promos){ const tr = document.createElement('tr'); tr.innerHTML = `<td>${p.name}</td><td>${p.type || ''}${p.type === 'percent' && p.value ? ' ('+p.value+'%)' : ''}</td><td>${(p.productIds||[]).length}</td><td><button data-id="${p.id}" class="editPromo btn">Editar</button><button data-id="${p.id}" class="delPromo btn">Eliminar</button></td>`; promotionsTableBody.appendChild(tr); }
  document.querySelectorAll('.delPromo').forEach(btn => btn.onclick = () => { deletePromotion(btn.dataset.id); });
  document.querySelectorAll('.editPromo').forEach(btn => btn.onclick = () => { editPromotion(btn.dataset.id); });
}

async function openPromoModal(editId = null){
  console.log('[admin] openPromoModal start', editId);
  // ensure we have a reference to the modal in case the global was not set
  try{ if(!promoModal){ promoModal = document.getElementById('promoModal'); } }catch(e){}
  console.log('[admin] openPromoModal promoModal?', promoModal);
  // open modal, load products list
  if(!promoModal){
    console.error('[admin] promoModal element missing after lookup — creating fallback modal');
    // create a simple fallback modal to allow admin to add promotions when the real modal is missing
    try{
      const fm = document.createElement('div'); fm.id = 'promoModalFallback'; fm.className = 'modal'; fm.style.zIndex = 99998; fm.innerHTML = `<div class="modal-card"><h2>Promoción (fallback)</h2><div id="promoProductsFallback">Cargando...</div><div style="margin-top:12px;text-align:right"><button id="closePromoFallback" class="btn">Cerrar</button></div></div>`;
      document.body.appendChild(fm);
      const closeBtn = document.getElementById('closePromoFallback'); if(closeBtn) closeBtn.onclick = ()=> { fm.remove(); };
      // if snapshot file exists, we can load products and show, but avoid blocking
      try{ const resp = await fetch('../catalogo/products.json'); if(resp.ok){ const items = await resp.json(); const list = (items && items.length) ? items.map(i=> `<div>${i.name}</div>`).join('') : 'Ninguno'; document.getElementById('promoProductsFallback').innerHTML = list; } }catch(e){}
      return;
    }catch(e){ console.error('[admin] failed to create fallback modal', e); showToast('No se pudo abrir el modal y el fallback falló', 'error'); return; }
  }
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

function renderPromoProductsList(products){ promoProductsList.innerHTML = ''; for(const pr of products){ const div = document.createElement('div'); div.className = 'promo-product-row'; div.style.display='flex'; div.style.alignItems='center'; div.style.gap='8px'; div.style.padding='6px 8px'; div.innerHTML = `<input type="checkbox" data-id="${pr.id}" id="promo-p-${pr.id}" /><label for="promo-p-${pr.id}">${pr.name} <small style="color: #6b7280">${pr.category||''}</small></label>`; promoProductsList.appendChild(div); } }

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

// Debug quick button: if binding fails, add a small floating test button so users can open the promo modal manually
try{
  if(!document.getElementById('debugOpenPromoBtn')){
    const btn = document.createElement('button');
    btn.id = 'debugOpenPromoBtn';
    btn.className = 'btn';
    btn.textContent = '⌁ Test Promo Modal';
    btn.style.position = 'fixed'; btn.style.left = '12px'; btn.style.bottom = '12px'; btn.style.zIndex = 99999; btn.style.padding = '6px 10px'; btn.style.borderRadius = '6px';
    btn.onclick = () => { console.log('[admin] debugOpenPromoBtn clicked'); try{ openPromoModal(); }catch(e){ console.error('[admin] openPromoModal error', e); } };
    document.body.appendChild(btn);
  }
}catch(e){}
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
