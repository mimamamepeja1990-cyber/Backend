// Load products from API and keep in sync via WebSocket.
const API_BASE = (location.protocol && location.protocol.startsWith('http')) ? location.origin : ''; // if opened via file://, use empty base so local relative paths work
let products = [];
let lastCreatedId = null;
const CART_KEY = 'catalog_cart_v1';
let cart = [];
let promotions = [];
// Listen for broadcast messages from admin page to update promotions in real time (same-origin)
try{
  if(window.BroadcastChannel){
    const bc = new BroadcastChannel('promo_channel');
    bc.onmessage = (ev) => {
      console.log('[catalog] BroadcastChannel message received:', ev.data);
      if(!ev || !ev.data) return;
      if(ev.data.action === 'promotions-updated'){
        try{
            const remote = (ev.data.promos || []).map(mapPromotion);
            // Use the broadcasted promotions as authoritative (do not preserve deleted promos from local state)
            promotions = remote;
          console.log('[catalog] promotions updated from BroadcastChannel, count=', promotions.length);
        const active = document.querySelector('.filter-btn.active');
        if(active && active.getAttribute('data-filter') === 'promociones') renderPromotions(promotions);
        else renderProducts(products);
        }catch(e){ console.error('Failed handling broadcasted promotions', e); }
      }
    };
  }
}catch(e){}
// Also listen for localStorage changes (other tabs) as a fallback to notify catalog of promotions changes
window.addEventListener('storage', (ev) => {
  try{
    if(ev.key === ADMIN_PROMO_KEY){
      const localStr = ev.newValue || '[]';
      const localPromos = JSON.parse(localStr || '[]');
      promotions = localPromos.map(mapPromotion);
      const active = document.querySelector('.filter-btn.active');
      if(active && active.getAttribute('data-filter') === 'promociones') renderPromotions(promotions);
      else renderProducts(products);
      console.log('[catalog] promotions updated from storage event:', promotions.length);
    }
  }catch(e){ /* ignore */ }
});
const ADMIN_PROMO_KEY = 'admin_promotions_v1';
let _promo_local_snapshot = null;

const wsStatus = document.getElementById('wsStatus');

// (dark mode support removed)

const catalogGrid = document.getElementById('catalogGrid');
const searchInput = document.getElementById('search');
const filterBtns = document.querySelectorAll('.filter-btn');

function renderProducts(list){
  catalogGrid.innerHTML = '';
  if(list.length === 0){
    catalogGrid.innerHTML = `<div class="no-results">No hay productos que coincidan con tu búsqueda.</div>`;
    return;
  }
  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.setAttribute('data-category', p.category);
    card.setAttribute('data-id', p.id);
    card.innerHTML = `
      <div class="price-bubble">${formatPrice(p.price)}</div>
      <div class="tag">${p.category}</div>
    <img src="${p.image}" alt="${p.name}" class="product-thumb" loading="lazy" width="320" height="220" onerror="this.onerror=null;this.src='../images/default.png'" onclick="openProductModal(${p.id})" />
    <div class="card-overlay">
      <div class="overlay-actions">
        <button class="btn btn-outline" aria-label="Agregar a favoritos" title="Agregar a favoritos" onclick="addToWish(${p.id})">❤</button>
        <button class="btn btn-primary" aria-label="Agregar al carrito" title="Agregar al carrito" onclick="openProductModal(${p.id})">Agregar</button>
      </div>
    </div>
    <div class="product-info">
      <div>
  <div class="product-title" title="${escapeHtml(p.name)}">${p.name}</div>
  <div class="product-sub" title="${escapeHtml(p.brand || '')}">${p.brand || ''}</div>
        <div class="product-meta">${p.category}</div>
      </div>
      <div class="product-actions">
        <div>
          <button class="btn btn-outline" aria-label="Agregar a favoritos" title="Agregar a favoritos" onclick="addToWish(${p.id})">Favoritos</button>
        </div>
        <div>
          <button class="btn btn-primary" aria-label="Agregar al carrito" title="Agregar al carrito" onclick="openProductModal(${p.id})">Agregar al carrito</button>
        </div>
      </div>
    </div>
    `;
    catalogGrid.appendChild(card);
    // Observe the card for entrance animation (works even when catalog is loaded via file://)
    try{ if(window._productCardObserver){ window._productCardObserver.observe(card); } }catch(e){}
  });
  // update filter counts
  const counts = {};
  list.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
  filterBtns.forEach(btn => { const f = btn.getAttribute('data-filter'); const base = btn.textContent.split(' (')[0]; const c = f === 'all' ? list.length : (counts[f] || 0); btn.textContent = `${base} (${c})`; });
  // update promotions counter if present
  try{ const promoBtn = document.querySelector('.filter-btn[data-filter="promociones"]'); if(promoBtn){ const base = promoBtn.textContent.split(' (')[0]; promoBtn.textContent = `${base} (${promotions.length})`; } }catch(e){}
  // If showing all products, append promotions cards
  try{ const active = document.querySelector('.filter-btn.active')?.getAttribute('data-filter') || 'all'; if(active === 'all' && promotions && promotions.length){ promotions.forEach(pr => {
    const card = buildPromotionCard(pr);
    catalogGrid.appendChild(card); try{ if(window._productCardObserver){ window._productCardObserver.observe(card); } }catch(e){} }); }
  }catch(e){}
}

function escapeHtml(str){
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderPromotions(list){
  catalogGrid.innerHTML = '';
  if(!list || list.length === 0){ catalogGrid.innerHTML = `<div class="no-results">No hay promociones disponibles.</div>`; return; }
  list.forEach(pr => {
    const card = buildPromotionCard(pr);
    catalogGrid.appendChild(card);
    try{ if(window._productCardObserver){ window._productCardObserver.observe(card); } }catch(e){}
  });
  // update promotions count label if exists
  try{ const promoBtn = document.querySelector('.filter-btn[data-filter="promociones"]'); if(promoBtn){ const base = promoBtn.textContent.split(' (')[0]; promoBtn.textContent = `${base} (${list.length})`; } }catch(e){}
}

function buildPromotionCard(pr){
  const card = document.createElement('article');
  card.className = 'product-card promotion-card';
  card.setAttribute('data-id', pr.id);
  // keyboard and click accessibility: Enter opens the promo modal; clicking non-button area opens modal
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.addEventListener('keydown', (ev) => { if(ev.key === 'Enter') openPromotionModal(pr.id); });
  card.addEventListener('click', (ev) => { if(!ev.target.closest('button')) openPromotionModal(pr.id); });
  // gather product images
  const prodObjs = (pr.productIds || []).map(pid => findProductById(pid)).filter(Boolean);
  // show up to 2 thumbs to avoid stretching cards horizontally; if more, show +N indicator
  const thumbLimit = 2;
  const visibleThumbs = prodObjs.slice(0, thumbLimit);
  const moreCount = prodObjs.length - visibleThumbs.length;
  const thumbs = visibleThumbs.map((p, idx) => `<div class="promo-thumb-wrap" title="${escapeHtml(p.name)}"><img src="${p.image}" alt="${p.name}" width="64" height="64" loading="lazy" class="promo-thumb" onerror="this.onerror=null;this.src='../images/default.png'"/></div>`).join('') + (moreCount > 0 ? `<div class="promo-thumb-more">+${moreCount}</div>` : '');
  // compute prices
  const priceSum = prodObjs.reduce((s, p) => s + (Number(p.price) || 0), 0);
  let bubbleText = pr.type === 'percent' && pr.value ? `-${pr.value}%` : (pr.type === '2x1' ? '2x1' : 'PROMO');
  const productCount = prodObjs.length;
  let priceDisplay = '';
  if(pr.type === 'percent' && pr.value){ const rate = Number(pr.value) || 0; const discounted = priceSum * (1 - rate/100); priceDisplay = `<div class="price-compare"><span class="old">${formatPrice(priceSum)}</span> <span class="new">${formatPrice(discounted)}</span></div>`; }
  else { priceDisplay = `<div class="price-compare"><span class="new">${formatPrice(priceSum)}</span></div>`; }
  card.innerHTML = `
    <div class="price-bubble">${bubbleText}</div>
    <div class="tag">Promoción</div>
    <div class="product-thumb" style="height:140px;display:flex;align-items:center;justify-content:center;padding:12px;">
  ${pr.image ? `<img src="${pr.image}" alt="${pr.name}" width="320" height="140" loading="lazy" style="max-height:120px;object-fit:contain" />` : `<div style="display:flex;align-items:center">${thumbs || `<svg width=60 height=60 viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"2\" y=\"6\" width=\"20\" height=\"12\" rx=\"2\" fill=\"#fff\" stroke=\"currentColor\"/></svg>`}</div>`}
    </div>
    <div class="product-info">
      <div>
  <div class="product-title" title="${escapeHtml(pr.name)}">${pr.name}</div>
  <div class="product-sub" title="${escapeHtml(pr.description || '')}">${(pr.description||'')}</div>
  <div class="promotion-thumbs" style="display:flex;margin-top:8px">${thumbs}</div>
      </div>
  <div class="product-actions"><div style="display:flex;flex-direction:column;align-items:flex-end"><div class="promo-count">${productCount} producto${productCount!==1?'s':''}</div><div style="margin-top:6px"><button class="btn btn-outline" onclick="openPromotionModal(${pr.id})">Ver</button></div></div><div><button class="btn btn-primary" onclick="addPromoProductsToCart(${pr.id})">Agregar</button></div></div>
      <div class="price-display">${priceDisplay}</div>
    </div>
    
  `;
  // Add JSON-LD for the product to the modal
  try{
    const ld = { "@context": "https://schema.org", "@type": "Product", "name": p.name, "description": p.brand || '', "image": [p.image], "sku": p.id, "offers": { "@type": "Offer", "priceCurrency": "ARS", "price": p.price } };
    modal.innerHTML += `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  }catch(e){ }
  // Append JSON-LD structured data for the promotion
  try{
    const ld = { "@context": "https://schema.org", "@type": "Product", "name": pr.name, "description": pr.description || '', "image": (pr.image ? [pr.image] : prodObjs.map(p => p.image)), "sku": `promo-${pr.id}`, "offers": { "@type": "AggregateOffer", "offerCount": prodObjs.length } };
    const script = document.createElement('script'); script.type = 'application/ld+json'; script.textContent = JSON.stringify(ld); card.appendChild(script);
  }catch(e){ }
  return card;
}

function forceReloadPromotions(){
  try{ console.log('[catalog] manual promotions reload requested'); fetchPromotions().then(()=>{
    const active = document.querySelector('.filter-btn.active');
    const f = active ? active.getAttribute('data-filter') : 'all';
    if(f === 'promociones') renderPromotions(promotions);
    else if(f === 'all') renderProducts(products);
  }); }catch(e){ console.error('forceReloadPromotions failed', e); }
}

// wire button (if present)
try{ const rb = document.getElementById('refreshPromosBtn'); if(rb) rb.addEventListener('click', ()=> forceReloadPromotions()); }catch(e){}

function addPromoProductsToCart(promoId){ const pr = promotions.find(x => x.id == promoId); if(!pr) return; addPromoGroupToCart(pr); showCatalogToast('Promoción añadida al carrito'); }

function addPromoGroupToCart(promo, qty = 1){ if(!promo) return; const promoMeta = { id: promo.id, name: promo.name || `promo-${promo.id}`, type: promo.type, value: promo.value }; // look for an existing promo-group entry
  const existing = cart.find(i => i.promoGroup && i.promo && i.promo.id === promoMeta.id);
  if(existing){ existing.qty = (existing.qty || 1) + qty; }
  else {
    // create grouped promo entry; include an expand flag to UI
    cart.push({ id: `promo-${promo.id}`, qty: qty, promoGroup: true, promoProductIds: (promo.productIds||[]).slice(), promo: promoMeta, expanded: false });
  }
  saveCart(); renderCart(); }

function openPromotionModal(id){ const pr = promotions.find(x => x.id == id); if(!pr) return; const modal = document.getElementById('productModal'); // reuse productModal to display promotion
  const prodObjs = (pr.productIds || []).map(pid => findProductById(pid)).filter(Boolean);
  const prodList = prodObjs.map(p => `<li style="display:flex;align-items:center;gap:8px;"><img src=\"${p.image}\" style=\"width:36px;height:36px;object-fit:cover;border-radius:4px;\" onerror=\"this.onerror=null;this.src='../images/default.png'\"/> <div><div style=\"font-weight:600\">${p.name}</div><div style=\"font-size:12px;color:#666\">${formatPrice(p.price)}</div></div></li>`).join('');
  const priceSum = prodObjs.reduce((s,p) => s + (Number(p.price) || 0), 0);
  let priceHtml = `<div class=\"modal-price\">Total: <strong>${formatPrice(priceSum)}</strong></div>`;
  if(pr.type === 'percent' && pr.value){ const rate = Number(pr.value) || 0; const discounted = priceSum * (1 - rate/100); priceHtml = `<div class=\"modal-price\">Total: <span style=\"text-decoration:line-through;color:#666;margin-right:8px\">${formatPrice(priceSum)}</span><strong>${formatPrice(discounted)}</strong> <span style=\"background:#ef4444;color:#fff;padding:2px 6px;border-radius:4px;margin-left:8px\">-${rate}%</span></div>`; }
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><div style="display:flex;gap:12px"><div style="flex:1"><div class="modal-title">${pr.name}</div><div class="modal-desc">${pr.description || ''}</div><ul style=\"padding-left:16px;\">${prodList}</ul>${priceHtml}</div></div><div style=\"display:flex;gap:12px;align-items:center;margin-top:8px\"><div style=\"display:flex;align-items:center;gap:8px\"><div style=\"font-weight:700\">Cantidad</div><div class=\"quantity-control modal-qty\" data-idx=\"promo-qty\"><button class=\"dec\">-</button><div class=\"qty\">1</div><button class=\"inc\">+</button></div></div></div><div class=\"modal-actions\" style=\"margin-top:8px\"><button class=\"btn\" id=\"addPromoAllBtn\">Agregar</button><button class=\"btn secondary\" id=\"closePromoViewBtn\">Cerrar</button></div></div>`;
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  // Focus primary action and register modal ESC key
  try{ const addEl = modal.querySelector('#addPromoAllBtn'); if(addEl) addEl.focus(); }catch(e){}
  _registerModalEsc();
  _trapFocus(modal);
  _trapFocus(modal);
  modal.querySelector('#closePromoViewBtn').onclick = ()=> { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); modal.innerHTML = ''; _unregisterModalEsc(); _releaseFocus(); };
  // wire modal quantity controls
  try{ const mqc = modal.querySelector('.modal-qty'); if(mqc){ mqc.querySelector('.dec').onclick = ()=>{ const qEl = mqc.querySelector('.qty'); let q = Number(qEl.textContent)||1; if(q>1){ q--; qEl.textContent = q; } }; mqc.querySelector('.inc').onclick = ()=>{ const qEl = mqc.querySelector('.qty'); let q = Number(qEl.textContent)||1; q++; qEl.textContent = q; }; } }catch(e){}
  modal.querySelector('#addPromoAllBtn').onclick = ()=> { try{ const qEl = modal.querySelector('.modal-qty .qty'); const q = Number(qEl ? qEl.textContent : 1) || 1; addPromoGroupToCart(pr, q); }catch(e){ addPromoGroupToCart(pr, 1); } modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); modal.innerHTML = ''; _unregisterModalEsc(); _releaseFocus(); };
}

function addToWish(id){
  const p = products.find(x => x.id === id);
  alert(`${p.name} agregado a favoritos (demo).`);
}

function quote(id){
  const p = products.find(x => x.id === id);
  const message = `Hola DistriAr! Me interesa el producto: ${p.name} (${p.brand}). ¿Podrías enviarme un presupuesto y condiciones de entrega?`;
  const url = `https://wa.me/5492616838446?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

// filter handlers
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.getAttribute('data-filter');
    applyFilters(f, searchInput.value);
  });
});

searchInput.addEventListener('input', (e) => {
  const q = e.target.value.trim();
  const active = document.querySelector('.filter-btn.active');
  applyFilters(active?.getAttribute('data-filter') || 'all', q);
});

function applyFilters(filter, query){
  const q = (query || '').toLowerCase();
  if(filter === 'promociones'){
    const res = promotions.filter(pr => !q || pr.name.toLowerCase().includes(q) || (pr.description||'').toLowerCase().includes(q));
    renderPromotions(res);
    return;
  }
  const result = products.filter(p => {
    const matchFilter = filter === 'all' ? true : p.category === filter;
    const matchQuery = !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
    return matchFilter && matchQuery;
  });
  renderProducts(result);
}

function formatPrice(value){
  if (value === null || value === undefined) return '';
  if (typeof value === 'number'){
    // use Intl if available
    try{ return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value); }catch(e){return `$${value}`}
  }
  return value; // already formatted string
}

function mapProduct(p){
  return {
    id: p.id,
    name: p.name,
    category: p.category || 'general',
    brand: p.brand || '',
    price: p.price,
    image: resolveImageUrl(p)
  };
}

function mapPromotion(pr){
  return {
    id: pr.id,
    name: pr.name,
    description: pr.description || '',
    productIds: pr.productIds || [],
    image: pr.image ? resolveImageUrl({ image: pr.image }) : null,
    type: pr.type || 'percent',
    value: (pr.value !== undefined && pr.value !== null) ? pr.value : null
  };
}

function resolveImageUrl(p){
  const srcRaw = p.image_url || p.image || '';
  if(!srcRaw) return '../images/default.png';
  const src = String(srcRaw);
  // If already absolute URL, return as-is.
  if(src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) return src;
  const isFile = location.protocol === 'file:' || !location.host;
  // If running on file:// and the path starts with /uploads or uploads, make a relative path to catalogo's parent
  if(isFile){
    if(src.startsWith('/uploads')){
      return '../' + src.replace(/^\//, '');
    }
    if(src.startsWith('uploads/')){
      return '../' + src;
    }
    if(src.startsWith('/')){ // leading slash but file:// -> try parent
      return '../' + src.replace(/^\//, '');
    }
    // otherwise, just try a relative path to catalogo folder
    if(!src.startsWith('.')) return './' + src.replace(/^\//, '');
  }
  // If path starts with / it's relative to host root; prefix API_BASE
  if(src.startsWith('/')) return API_BASE + src;
  // fallback: treat 'uploads/...' or 'foo.png' as relative under server root
  return (API_BASE || '') + '/' + src.replace(/^\//, '');
}

// Small IntersectionObserver used locally in catalogo to reveal cards on scroll
if(!window._productCardObserver){
  window._productCardObserver = new IntersectionObserver((entries)=>{
    entries.forEach(entry => {
      if(entry.isIntersecting){ entry.target.classList.add('in-view'); }
    });
  }, { threshold: 0.12 });
}

async function fetchProducts(){
  // show skeletons while loading
  showSkeletons(6);
  catalogGrid.classList.add('loading');
  try{
    // Try to read a static snapshot first (useful when the page is opened via file:// or we serve a static JSON)
    let resp;
    const localSnapshotPaths = [
      'products.json', // relative to catalogo/ folder
      `${location.origin}/catalogo/products.json`,
    ];
    let usedSnapshot = false;
    for(const p of localSnapshotPaths){
      try{
        resp = await fetch(p);
        if(resp.ok){ usedSnapshot = true; break; }
      }catch(e){ resp = null; }
    }
    if(!usedSnapshot){
      resp = await fetch(API_BASE + '/products');
    }
    if(!resp.ok) throw new Error('Failed to fetch products');
  const data = await resp.json();
  products = data.map(mapProduct);
  // also load promotions from snapshot/localStorage
  try{ await fetchPromotions(); }catch(e){ console.warn('fetchPromotions failed', e); }
    renderProducts(products);
  // Keep a snapshot of the fetched JSON so we can detect updates via polling
  try{ window._catalog_last_snapshot = JSON.stringify(data); }catch(e){ window._catalog_last_snapshot = null; }
  }catch(err){
    console.error('Error fetching products', err);
  }
  catalogGrid.classList.remove('loading');
}

async function fetchPromotions(){
  let resp = null;
  const localSnapshotPaths = [ 'promotions.json', `${location.origin}/catalogo/promotions.json` ];
  let usedSnapshot = false;
  for(const p of localSnapshotPaths){
    try{ resp = await fetch(p); if(resp.ok){ usedSnapshot = true; break; } }catch(e){ resp = null; }
  }
  if(!usedSnapshot){
    try{ resp = await fetch(API_BASE + '/promotions'); }catch(e){ resp = null; }
  }
  if(!resp || !resp.ok){
    // no remote or snapshot found — try to load from admin localStorage fallback
    try{
      const localStr = localStorage.getItem(ADMIN_PROMO_KEY) || '[]';
      const localPromos = JSON.parse(localStr || '[]');
      if(Array.isArray(localPromos) && localPromos.length){
        promotions = localPromos.map(mapPromotion);
        _promo_local_snapshot = localStr;
        console.log('[catalog] promotions loaded from admin localStorage fallback:', promotions.length);
      }
    }catch(e){ /* ignore */ }
    // trigger a rerender depending on active filter
    try{ const active = document.querySelector('.filter-btn.active'); const f = active ? active.getAttribute('data-filter') : 'all'; if(f === 'promociones') renderPromotions(promotions); else renderProducts(products); }catch(e){}
    return; // done
  }
  try{
    const data = await resp.json();
  promotions = data.map(mapPromotion);
  console.log('[catalog] remote promotions loaded:', promotions.length);
  // also merge localStorage promos created in admin panel if available, dedupe by id with local overriding remote
  try{ const local = JSON.parse(localStorage.getItem('admin_promotions_v1') || '[]'); if(Array.isArray(local) && local.length){ const mapped = local.map(mapPromotion); const merged = {}; promotions.forEach(p => { if(p && p.id) merged[p.id] = p; }); mapped.forEach(p => { merged[p.id] = p; }); promotions = Object.values(merged); } }catch(e){}
  try{ const localStr = localStorage.getItem(ADMIN_PROMO_KEY) || '[]'; _promo_local_snapshot = localStr; console.log('[catalog] local promotions snapshot length:', JSON.parse(localStr || '[]').length); }catch(e){}
  }catch(e){ console.error('Error parsing promotions', e); }
  // after successfully fetching and merging, rerender depending on active filter
  try{ const active = document.querySelector('.filter-btn.active'); const f = active ? active.getAttribute('data-filter') : 'all'; if(f === 'promociones') renderPromotions(promotions); else renderProducts(products); }catch(e){}
}

function showSkeletons(count){
  catalogGrid.innerHTML = '';
  for(let i=0;i<count;i++){
    const s = document.createElement('div'); s.className = 'skeleton product-card';
    s.innerHTML = `<div class="thumb"></div><div class="line" style="width:88%"></div><div class="line" style="width:60%"></div><div class="line" style="width:40%"></div>`;
    catalogGrid.appendChild(s);
  }
}

// WebSocket for live updates
function showCatalogToast(msg){
  const el = document.createElement('div');
  el.className = 'catalog-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=> el.classList.add('visible'), 30);
  setTimeout(()=> { el.classList.remove('visible'); setTimeout(()=>el.remove(), 400) }, 4000);
}

// CART: localStorage-backed cart, product modal and drawer
function loadCart(){
  try{ const raw = localStorage.getItem(CART_KEY); cart = raw ? JSON.parse(raw) : []; }catch(e){ cart = []; }
}
function saveCart(){
  try{ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }catch(e){}
  updateCartFloating();
}
function updateCartFloating(){
  const el = document.getElementById('cartFloating');
  if(!el) return;
  const badge = el.querySelector('.cart-badge');
  // Count total product units: single items use qty; promoGroup uses qty * number of products in the promo
  const totalCount = cart.reduce((s,i)=> {
    if(i.promoGroup){ const count = (i.promoProductIds||[]).length || 0; return s + ((i.qty||1) * count); }
    return s + (i.qty||1);
  }, 0);
  if(totalCount <= 0){ el.classList.add('hidden'); } else { el.classList.remove('hidden'); }
  if(badge) badge.textContent = totalCount;
}

function findProductById(id){ return products.find(p => p.id === id); }

function openProductModal(id){
  const p = findProductById(id);
  if(!p) return;
  const modal = document.getElementById('productModal');
  modal.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-media">
      <img src="${p.image}" alt="${p.name}" onerror="this.onerror=null;this.src='../images/default.png'" />
      <div style="flex:1">
        <div id="modalTitle" class="modal-title">${p.name}</div>
        <div class="modal-desc">${p.brand || ''} · ${p.category}</div>
        <div class="modal-desc" style="margin-top:8px;font-weight:700">${formatPrice(p.price)}</div>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between">
      <div class="quantity-control" role="group" aria-label="Cantidad">
        <button id="qtyMinus">-</button>
        <div class="qty" id="qtyVal">1</div>
        <button id="qtyPlus">+</button>
      </div>
      <div style="margin-left:8px;font-size:14px;color:rgba(10,34,64,0.7);">Total: <span id="modalTotal">${formatPrice(p.price)}</span></div>
    </div>
    <div class="modal-actions">
        <button class="btn" id="addToCartBtn" aria-label="Agregar al carrito (modal)" title="Agregar al carrito">Agregar al carrito</button>
      <button class="btn secondary" id="cancelAddBtn" aria-label="Cerrar" title="Cerrar">Cancelar</button>
    </div>
  </div>`;
  
  let qty = 1;
  const totalEl = modal.querySelector('#modalTotal');
  const qtyVal = modal.querySelector('#qtyVal');
  const addBtn = modal.querySelector('#addToCartBtn');
  const cancelBtn = modal.querySelector('#cancelAddBtn');
  const minus = modal.querySelector('#qtyMinus');
  const plus = modal.querySelector('#qtyPlus');
  const updateTotal = ()=> totalEl.textContent = formatPrice(qty * (typeof p.price === 'number' ? p.price : Number(p.price)));
  minus.onclick = ()=> { if(qty>1) { qty--; qtyVal.textContent = qty; updateTotal(); } };
  plus.onclick = ()=> { qty++; qtyVal.textContent = qty; updateTotal(); };
  cancelBtn.onclick = ()=> { closeProductModal(); };
  addBtn.onclick = ()=> { addToCart(p.id, qty); closeProductModal(); showCatalogToast('Producto agregado al carrito'); };
  // focus primary button in modal & register ESC
  try{ addBtn.focus(); }catch(e){}
  _registerModalEsc();
  // ensure modal is visible and trap focus
  try{ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); _trapFocus(modal); }catch(e){}
}
function closeProductModal(){ const modal = document.getElementById('productModal'); modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); modal.innerHTML = ''; _unregisterModalEsc(); _releaseFocus(); }

// Modal ESC key handling (shared across product & promotion modals)
let _modalEscHandler = null;
function _registerModalEsc(){ if(_modalEscHandler) return; _modalEscHandler = (ev) => { if(ev.key === 'Escape'){ const modal = document.getElementById('productModal'); if(modal && modal.classList.contains('open')){ modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); modal.innerHTML = ''; } const drawer = document.getElementById('cartDrawer'); if(drawer && drawer.classList.contains('open')){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); } } }; document.addEventListener('keydown', _modalEscHandler); }
function _unregisterModalEsc(){ if(!_modalEscHandler) return; document.removeEventListener('keydown', _modalEscHandler); _modalEscHandler = null; }

let _lastFocusedElement = null;
let _focusTrapHandler = null;
function _trapFocus(root){ try{ if(!root) return; _lastFocusedElement = document.activeElement; const focusable = root.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'); const focusables = Array.prototype.slice.call(focusable).filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)); if(focusables.length){ focusables[0].focus(); } _focusTrapHandler = (ev) => { if(ev.key !== 'Tab') return; const first = focusables[0]; const last = focusables[focusables.length-1]; if(ev.shiftKey){ if(document.activeElement === first){ ev.preventDefault(); last.focus(); } } else { if(document.activeElement === last){ ev.preventDefault(); first.focus(); } } }; document.addEventListener('keydown', _focusTrapHandler); }catch(e){}
}
function _releaseFocus(){ try{ if(_focusTrapHandler) document.removeEventListener('keydown', _focusTrapHandler); _focusTrapHandler = null; if(_lastFocusedElement) try{ _lastFocusedElement.focus(); }catch(e){} _lastFocusedElement = null; }catch(e){}
}

function initCartUI(){
  // Ensure floating button exists
  const el = document.getElementById('cartFloating');
  if(!el) return;
  el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
  <span class="cart-badge">0</span>`;
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Abrir carrito');
  el.addEventListener('click', ()=> toggleCartDrawer(true));

  const modal = document.getElementById('cartDrawer');
  modal.innerHTML = `
    <div class="cart-head">
      <div style="font-weight:700">Tu carrito</div>
      <div><button class="btn secondary" id="closeCartBtn" aria-label="Cerrar carrito" title="Cerrar carrito">Cerrar</button></div>
    </div>
  <div class="cart-items" id="cartItems" role="list"></div>
    <div class="cart-footer">
      <div style="display:flex;justify-content:space-between;align-items:center"><div>Total:</div><div id="cartTotalPrice">${formatPrice(0)}</div></div>
  <div class="cart-actions"><button class="btn secondary" id="clearCartBtn" aria-label="Vaciar carrito" title="Vaciar carrito">Vaciar</button><button class="btn" id="checkoutBtn" aria-label="Pedir por WhatsApp" title="Pedir por WhatsApp">Pedir por WhatsApp</button></div>
    </div>`;
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Carrito');
  modal.setAttribute('tabindex', '-1');
  modal.classList.remove('open');
  modal.querySelector('#closeCartBtn').addEventListener('click', ()=> toggleCartDrawer(false));
  modal.querySelector('#clearCartBtn').addEventListener('click', ()=> { cart = []; saveCart(); renderCart(); toggleCartDrawer(false); });
  modal.querySelector('#checkoutBtn').addEventListener('click', ()=> { shareCartViaWhatsApp(); });
  updateCartFloating();
}

function toggleCartDrawer(open){
  const modal = document.getElementById('cartDrawer');
  if(!modal) return;
  if(open){ modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); renderCart(); _registerModalEsc(); _trapFocus(modal); }
  else{ modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); _unregisterModalEsc(); _releaseFocus(); }
}

function addToCart(id, qty = 1, promoMeta = null){
  const cmp = (a, b) => { if(!a && !b) return true; if(!a || !b) return false; return a.id === b.id && a.type === b.type && a.value === b.value; };
  const existing = cart.find(i => i.id === id && cmp(i.promo, promoMeta));
  if(existing){ existing.qty += qty; } else { cart.push({ id, qty, promo: promoMeta || null }); }
  saveCart();
  renderCart();
}

function renderCart(){
  const itemsEl = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotalPrice');
  if(!itemsEl || !totalEl) return;
  itemsEl.innerHTML = '';
  if(cart.length === 0){ itemsEl.innerHTML = '<div class="empty">No hay productos en el carrito.</div>'; totalEl.textContent = formatPrice(0); updateCartFloating(); return; }
  let total = 0;
  cart.forEach((ci, index) => {
  const row = document.createElement('div'); row.className = 'cart-item'; row.setAttribute('role', 'listitem');
  // visual separation relies on CSS; avoid inline fallback to keep spacing controllable via CSS
    if(ci.promoGroup){
      // Ensure promo name is available for display, especially for persisted carts
      try{
        if(ci.promo && !ci.promo.name){ const found = promotions.find(p => p.id == ci.promo.id); if(found && found.name) ci.promo.name = found.name; }
      }catch(e){}
      const prodObjs = (ci.promoProductIds || []).map(id => findProductById(id)).filter(Boolean);
      if(prodObjs.length === 0) return;
      // compute totals for the group
      const original = prodObjs.reduce((s,p) => s + (Number(p.price) || 0), 0) * ci.qty;
      let discounted = original;
      let promoLabel = '';
      if(ci.promo && ci.promo.type === 'percent' && ci.promo.value){ const rate = Number(ci.promo.value) || 0; discounted = original * (1 - rate/100); promoLabel = `<span class="promo-badge">-${ci.promo.value}%</span>`; }
      else if(ci.promo && ci.promo.type === '2x1'){ // apply 2x1 per product
        discounted = prodObjs.reduce((s,p) => { const unit = Number(p.price)||0; const chargeQty = Math.ceil(ci.qty/2); return s + (unit * chargeQty); }, 0);
        promoLabel = `<span class="promo-badge">2x1</span>`;
      }
    row.className = 'cart-item promo-summary';
  const thumbs = prodObjs.slice(0,1).map(p => `<img src="${p.image}" width="48" height="48" loading="lazy" class="promo-thumb" onerror="this.onerror=null;this.src='../images/default.png'"/>`).join('');
  const productCount = prodObjs.length;
  const subListId = `promo-sub-${index}`;
  const expandBtn = `<button class="btn small expander" data-idx="${index}" aria-expanded="${ci.expanded ? 'true' : 'false'}" aria-controls="${subListId}" title="${ci.expanded ? 'Colapsar detalles' : 'Expandir detalles'}" aria-label="${ci.expanded ? 'Colapsar detalles' : 'Expandir detalles'}">${ci.expanded ? '−' : '+'}</button>`;
  // For promos with many products, show a concise summary in the cart (first product + "y N más") instead of listing all names inline
  const shortMeta = productCount > 1 ? `${escapeHtml(prodObjs[0].name)} y ${productCount - 1} más` : `${escapeHtml(prodObjs[0].name || '')}`;
  row.innerHTML = `<div class="summary-row"><div class="cart-thumb">${thumbs}</div><div class="cart-item-info"><div class="cart-item-top"><div class="cart-item-top-left"><div class="cart-item-title" title="${escapeHtml(ci.promo?.name || String(ci.promo?.id || ''))}"><div class="promo-label">Promoción</div><div class="promo-name">${escapeHtml(ci.promo?.name || String(ci.promo?.id || ''))}</div></div><div class="cart-item-count">(${productCount} producto${productCount>1?'s':''})</div></div><div class="cart-item-top-right">${expandBtn}<div class="promo-badge-wrapper">${promoLabel}</div></div></div></div><div class="cart-item-right"><div class="quantity-control" data-idx="${index}"><button class="dec">-</button><div class="qty">${ci.qty}</div><button class="inc">+</button></div><div class="cart-item-price">${formatPrice(discounted)}</div><button class="btn secondary remove" data-idx="${index}" title="Eliminar" aria-label="Eliminar esta promoción">Eliminar</button></div></div>`;
      itemsEl.appendChild(row);
      // sub-list
  const subList = document.createElement('div'); subList.className = 'sub-list'; subList.id = subListId; subList.setAttribute('aria-hidden', ci.expanded ? 'false' : 'true');
      // To keep the promo group compact, show only the first few products when collapsed.
      const MAX_SUB_VISIBLE = 2; // first N products to show when collapsed
      const visibleProds = ci.expanded ? prodObjs : prodObjs.slice(0, MAX_SUB_VISIBLE);
      visibleProds.forEach(p => { const sub = document.createElement('div'); sub.className = 'cart-item sub-entry'; const unit = Number(p.price) || 0; const subTotal = (ci.promo && ci.promo.type === 'percent' && ci.promo.value) ? (unit * (1 - ((Number(ci.promo.value)||0)/100)) * ci.qty) : ((ci.promo && ci.promo.type === '2x1') ? (unit * Math.ceil(ci.qty/2)) : (unit * ci.qty));
        // Use a compact sub-entry: hide thumbnails and show only name and price
        sub.innerHTML = `<div class="cart-item-info"><div class="cart-item-title">${escapeHtml(p.name)}</div></div><div class="cart-item-right"><div class="cart-item-price">${formatPrice(subTotal)}</div></div>`; subList.appendChild(sub); });
      // If there are more products and we're currently collapsed, add a concise 'ver N más' row to expand
  if(!ci.expanded && prodObjs.length > MAX_SUB_VISIBLE){ const moreEl = document.createElement('div'); moreEl.className = 'cart-item sub-entry more-link'; const remaining = prodObjs.length - MAX_SUB_VISIBLE; moreEl.innerHTML = `<div class="cart-item-info"><div class="cart-item-title">Ver ${remaining} producto${remaining>1?'s':''} más...</div></div>`; moreEl.onclick = () => { const item = cart[index]; if(!item) return; item.expanded = true; saveCart(); renderCart(); }; moreEl.setAttribute('role','button'); moreEl.setAttribute('tabindex','0'); moreEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' ') { const item = cart[index]; if(!item) return; item.expanded = true; saveCart(); renderCart(); } }); subList.appendChild(moreEl); }
  // Attach the sub-list inside the promo row so it visually groups and doesn't become a separate top-level item
  row.appendChild(subList);
      if(ci.expanded) row.classList.add('expanded'); else row.classList.remove('expanded');
      total += discounted;
    } else {
      const p = findProductById(ci.id);
      if(!p) return;
      let promoLabel = '';
      if(ci.promo){ if(ci.promo.type === 'percent' && ci.promo.value){ promoLabel = `<span class="promo-badge">-${ci.promo.value}%</span>`; } else if(ci.promo.type === '2x1'){ promoLabel = `<span class="promo-badge">2x1</span>`; } }
      const unitPrice = Number(p.price) || 0;
      let itemTotal = 0;
      if(ci.promo && ci.promo.type === 'percent' && ci.promo.value){ const rate = Number(ci.promo.value) || 0; itemTotal = unitPrice * (1 - (rate/100)) * ci.qty; }
      else if(ci.promo && ci.promo.type === '2x1'){ const chargeQty = Math.ceil(ci.qty / 2); itemTotal = unitPrice * chargeQty; }
      else { itemTotal = unitPrice * ci.qty; }
      row.setAttribute('data-idx', String(index));
  row.innerHTML = `<div class="cart-thumb"><img src="${p.image}" alt="${p.name}" onerror="this.onerror=null;this.src='../images/default.png'"/></div>
  <div class="cart-item-info"><div class="cart-item-title">${p.name} ${promoLabel}</div><div class="cart-item-meta">${p.brand || ''} · ${p.category}</div></div>
  <div class="cart-item-right">
  <div class="quantity-control" data-idx="${index}" role="group" aria-label="Cantidad"><button class="dec">-</button><div class="qty">${ci.qty}</div><button class="inc">+</button></div>
    <div class="cart-item-price">${formatPrice(itemTotal)}</div>
  <button class="btn secondary remove" data-idx="${index}" title="Eliminar" aria-label="Eliminar este producto">Eliminar</button>
  </div>`;
      itemsEl.appendChild(row);
      total += itemTotal;
    }
  });
  // no additional group summary nodes are required because promoGroup cart entries are rendered as a single row
  totalEl.textContent = formatPrice(total);
  // bind events for +/- and remove
  itemsEl.querySelectorAll('.quantity-control').forEach(qc => {
    const idx = Number(qc.getAttribute('data-idx'));
    const dec = qc.querySelector('.dec'); const inc = qc.querySelector('.inc'); const qtyEl = qc.querySelector('.qty');
    dec.onclick = ()=> { const item = cart[idx]; if(item && item.qty>1){ item.qty--; qtyEl.textContent = item.qty; saveCart(); renderCart(); } };
    inc.onclick = ()=> { const item = cart[idx]; if(item){ item.qty++; qtyEl.textContent = item.qty; saveCart(); renderCart(); } };
  });
  // bind expand/collapse for promotion group entries
  itemsEl.querySelectorAll('.expander').forEach(btn => {
    const idx = Number(btn.getAttribute('data-idx'));
    btn.onclick = () => { const item = cart[idx]; if(!item) return; item.expanded = !item.expanded; saveCart(); renderCart(); };
  });
  itemsEl.querySelectorAll('.remove').forEach(btn => { btn.onclick = ()=>{ const idx = Number(btn.getAttribute('data-idx')); cart = cart.filter((i, j) => j !== idx); saveCart(); renderCart(); }; });
  updateCartFloating();
}

function shareCartViaWhatsApp(){
  if(cart.length === 0){ showCatalogToast('El carrito está vacío'); return; }
  // Build message with product list and totals
  let msg = `Hola! Me gustaría pedir los siguientes productos:\n`;
  let total = 0;
  cart.forEach(ci => {
    if(ci.promoGroup){
      const prodObjs = (ci.promoProductIds||[]).map(id => findProductById(id)).filter(Boolean);
      if(prodObjs.length === 0) return;
      const groupOriginal = prodObjs.reduce((s,p) => s + (Number(p.price)||0), 0) * ci.qty;
      let groupTotal = groupOriginal;
      let promoLabel = '';
      if(ci.promo && ci.promo.type === 'percent' && ci.promo.value){ promoLabel = ` (-${ci.promo.value}%)`; groupTotal = groupOriginal * (1 - (Number(ci.promo.value)||0)/100); }
      else if(ci.promo && ci.promo.type === '2x1'){ promoLabel = ` (2x1)`; groupTotal = prodObjs.reduce((s,p)=>{ const unit = Number(p.price)||0; const chargeQty = Math.ceil(ci.qty/2); return s + (unit*chargeQty); },0); }
  msg += `- Promoción ${ci.promo?.name || ci.promo?.id || ''} x${ci.qty}${promoLabel} = ${formatPrice(groupTotal)}\n`;
      if(ci.expanded){ prodObjs.forEach(p => { const unit = Number(p.price)||0; msg += `  - ${p.name} x${ci.qty} = ${formatPrice(unit * ci.qty)}\n`; }); }
      total += groupTotal;
    } else {
      const p = findProductById(ci.id); if(!p) return;
      const unit = Number(p.price) || 0; let itemTotal = 0; let promoLabel = '';
      if(ci.promo && ci.promo.type === 'percent' && ci.promo.value){ const rate = Number(ci.promo.value) || 0; itemTotal = unit * (1 - rate/100) * ci.qty; promoLabel = ` (-${ci.promo.value}%)`; }
      else if(ci.promo && ci.promo.type === '2x1'){ const chargeQty = Math.ceil(ci.qty/2); itemTotal = unit * chargeQty; promoLabel = ` (2x1)`; }
      else { itemTotal = unit * ci.qty; }
      msg += `- ${p.name} x${ci.qty}${promoLabel} = ${formatPrice(itemTotal)}\n`;
      total += itemTotal;
    }
  });
  msg += `\nTotal: ${formatPrice(total)}\nGracias!`;
  const url = `https://wa.me/5492616838446?text=${encodeURIComponent(msg)}`;
  // Open in a new tab
  window.open(url, '_blank');
}

// init cart state
function initCart(){ loadCart(); const modal = document.getElementById('productModal'); if(modal) modal.addEventListener('click', (ev)=>{ if(ev.target === modal) closeProductModal(); }); const floating = document.getElementById('cartFloating'); if(floating) floating.addEventListener('keydown', ev => { if(ev.key === 'Enter') toggleCartDrawer(true); }); initCartUI(); renderCart(); }

function setupSocket(attempt = 0){
  if(!location.protocol || !location.protocol.startsWith('http')){
    console.log('Skipping WebSocket connection (non-http origin)');
    return;
  }
  const proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
  const wsUrl = `${proto}${location.host}/ws/products`;
  let socket;
  try{ socket = new WebSocket(wsUrl); }catch(e){ socket = null; }
  if(!socket){
    const delay = Math.min(30000, Math.pow(2, attempt) * 1000 + Math.random()*1000);
    setTimeout(()=> setupSocket(attempt + 1), delay);
    return;
  }
  socket.onopen = () => { console.log('Catalog WS connected'); if(wsStatus){ wsStatus.classList.add('connected'); wsStatus.classList.remove('disconnected'); wsStatus.title = 'Conectado'; } stopSnapshotPoll(); };
  socket.onclose = () => {
    const delay = Math.min(30000, Math.pow(2, attempt) * 1000 + Math.random()*1000);
    console.log('Catalog WS closed, retrying in', delay);
    if(wsStatus){ wsStatus.classList.remove('connected'); wsStatus.classList.add('disconnected'); wsStatus.title = 'Desconectado'; }
  // When websocket disconnects, fallback to snapshot polling
            console.log('[catalog] promotions loaded from admin localStorage fallback:', promotions.length, localPromos);
    setTimeout(()=> setupSocket(attempt + 1), delay);
  };
  socket.onerror = (err) => console.error('Catalog WS error', err);
  socket.onmessage = (ev) => {
    try{
      const data = JSON.parse(ev.data);
      if(data.action === 'created'){
        lastCreatedId = data.product.id;
        promotions = data.map(mapPromotion);
        console.log('[catalog] remote promotions loaded:', promotions.length, data);
        renderProducts(products);
        showCatalogToast(`Nuevo producto: ${data.product.name}`);
        // highlight afterwards
        setTimeout(()=>{
          const el = document.querySelector(`.product-card[data-id='${data.product.id}']`);
          if(el){ el.classList.add('highlight'); setTimeout(()=> el.classList.remove('highlight'), 2500); el.scrollIntoView({behavior:'smooth', block:'center'}); }
        }, 100);
      }else if(data.action === 'updated'){
        const idx = products.findIndex(p => p.id === data.product.id);
        if(idx > -1) products[idx] = mapProduct(data.product);
        else products.push(mapProduct(data.product));
        renderProducts(products);
        showCatalogToast(`Producto actualizado: ${data.product.name}`);
      }else if(data.action === 'deleted'){
        products = products.filter(p => p.id !== data.product.id);
        renderProducts(products);
        showCatalogToast(`Producto eliminado`);
      }
    }catch(err){ console.error('Invalid WS message', err); }
  };
}

// Polling fallback for static snapshots (useful for file:// views where WebSocket can't connect)
let _snapshotPollTimer = null;
const SNAPSHOT_POLL_INTERVAL = 3000; // ms
let _promotions_last_snapshot = null;
let _promotionsPollTimer = null;
async function pollSnapshot(){
  const localSnapshotPaths = [ 'products.json', `${location.origin}/catalogo/products.json` ];
  let resp = null;
  let usedSnapshot = false;
  for(const p of localSnapshotPaths){
    try{ resp = await fetch(p, { cache: 'no-store' }); if(resp.ok){ usedSnapshot = true; break; } }catch(e){ resp = null; }
  }
  if(!usedSnapshot || !resp) return;
  try{
    const rows = await resp.json();
    const rowsStr = JSON.stringify(rows);
    if(window._catalog_last_snapshot && window._catalog_last_snapshot === rowsStr) return; // no change
    const prevIds = new Set(products.map(p => p.id));
    // update products and UI
    products = rows.map(mapProduct);
    renderProducts(products);
    // compute added IDs
    const added = rows.filter(r => !prevIds.has(r.id)).map(r => r.id);
    if(added.length){
      const newId = added[0];
      showCatalogToast(`Nuevo producto agregado`);
      setTimeout(()=>{
        const el = document.querySelector(`.product-card[data-id='${newId}']`);
        if(el){ el.classList.add('highlight'); setTimeout(()=> el.classList.remove('highlight'), 2500); el.scrollIntoView({behavior:'smooth', block:'center'}); }
      }, 100);
    }else{
      showCatalogToast(`Catálogo actualizado`);
    }
    window._catalog_last_snapshot = rowsStr;
  }catch(e){ console.error('Failed to parse snapshot', e); }
}

async function pollPromotionsSnapshot(){
  try{
    const localPaths = [ 'promotions.json', `${location.origin}/catalogo/promotions.json` ];
    let resp = null; let used = false;
    for(const p of localPaths){ try{ resp = await fetch(p); if(resp.ok){ used = true; break; } }catch(e){ resp = null; } }
    if(!used){ try{ resp = await fetch(API_BASE + '/promotions'); }catch(e){ resp = null; } }
    if(!resp || !resp.ok) return;
    const rows = await resp.json(); const rowStr = JSON.stringify(rows);
    if(_promotions_last_snapshot && _promotions_last_snapshot === rowStr) return; // no change
  _promotions_last_snapshot = rowStr;
  console.log('[catalog] pollPromotionsSnapshot: promotions snapshot updated length=', rows.length);
    // Load promotions with merge
    await fetchPromotions();
    const active = document.querySelector('.filter-btn.active');
    const f = active ? active.getAttribute('data-filter') : 'all';
    if(f === 'promociones') renderPromotions(promotions);
    else if(f === 'all') renderProducts(products);
    console.log('[catalog] promotions snapshot updated (polled)');
  }catch(e){ console.warn('pollPromotionsSnapshot failure', e); }
}

function startPromotionsPoll(){ if(_promotionsPollTimer) return; _promotionsPollTimer = setInterval(pollPromotionsSnapshot, SNAPSHOT_POLL_INTERVAL); }
function stopPromotionsPoll(){ if(_promotionsPollTimer) clearInterval(_promotionsPollTimer); _promotionsPollTimer = null; }

function startSnapshotPoll(){
  if(_snapshotPollTimer) return;
  _snapshotPollTimer = setInterval(pollSnapshot, SNAPSHOT_POLL_INTERVAL);
}

function stopSnapshotPoll(){
  if(_snapshotPollTimer) clearInterval(_snapshotPollTimer); _snapshotPollTimer = null;
}

// initial load and WS startup
fetchProducts().then(()=> initCart()).catch(()=> initCart());
setupSocket();
// Start polling for static snapshots so file:// pages get live updates
startSnapshotPoll();
startPromotionsPoll();

// react to promotions being updated in other tabs (localStorage events)
window.addEventListener('storage', (ev) => {
  if(!ev || !ev.key) return;
  if(ev.key === 'admin_promotions_v1' || ev.key === 'admin_promotions_v1_lastUpdated'){
    try{
      const raw = localStorage.getItem(ADMIN_PROMO_KEY) || '[]';
      const local = JSON.parse(raw || '[]');
      const localMapped = (local||[]).map(mapPromotion);
  // Use the admin local promotions as authoritative for this event
  promotions = localMapped;
      console.log('[catalog] storage event merged promotions; total', promotions.length);
    }catch(e){}
    const active = document.querySelector('.filter-btn.active');
    const f = active ? active.getAttribute('data-filter') : 'all';
    if(f === 'promociones') renderPromotions(promotions);
    else if(f === 'all') renderProducts(products);
  }
});

// Poll localStorage periodically in case 'storage' events are not available (like certain file:// cases)
function initPromoLocalPolling(interval = 2000){
  try{
    setInterval(()=>{
      try{
        const s = localStorage.getItem(ADMIN_PROMO_KEY) || '[]';
        if(s !== _promo_local_snapshot){
          console.log('[catalog] initPromoLocalPolling detected change in local promos snapshot', { prev: _promo_local_snapshot, new: s });
          console.log('[catalog] detected admin promos change via polling');
          _promo_local_snapshot = s;
          try{ fetchPromotions().then(()=>{
            const active = document.querySelector('.filter-btn.active');
            if(active && active.getAttribute('data-filter') === 'promociones') renderPromotions(promotions);
            else renderProducts(products);
          }); }catch(e){}
        }
      }catch(e){}
    }, interval);
  }catch(e){}
}

// start polling to catch changes to localStorage; useful when running locally via file:// or in browsers that restrict storage event
initPromoLocalPolling();
