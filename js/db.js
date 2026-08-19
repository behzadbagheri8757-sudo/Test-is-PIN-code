/* db.js — IndexedDB, normalizeData, loadData, saveData
   Phase 0 extract: no logic changes. DB_NAME/store/keys unchanged.
*/
// ---------- IndexedDB layer ----------
// Chosen over localStorage because: async (never blocks the UI thread on an
// iPhone), much higher storage quota, and it survives Safari's storage
// eviction rules better for a long-lived, years-of-invoices dataset.
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, {keyPath:'key'});
      }
    };
    req.onsuccess = (e)=> resolve(e.target.result);
    req.onerror = (e)=> reject(e.target.error);
  });
}
async function getDB(){
  if(!dbInstance) dbInstance = await openDB();
  return dbInstance;
}
async function dbGet(key){
  const db = await getDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = (e)=>reject(e.target.error);
  });
}
async function dbPut(key, value){
  const db = await getDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({key, value});
    tx.oncomplete = ()=>resolve();
    tx.onerror = (e)=>reject(e.target.error);
  });
}
async function dbDelete(key){
  const db = await getDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = ()=>resolve();
    tx.onerror = (e)=>reject(e.target.error);
  });
}

// normalize / migrate any older data shape into the current schema so old
// backups (or the previous version of this app) keep working

// ---------- FIFO migration (idempotent, no historical COGS rewrite) ----------
function migrateBuildInventoryLayers(d){
  const layers = [];
  const existingKeys = new Set();
  function key(purchaseId, productId, itemId){
    return String(purchaseId)+'|'+String(productId)+'|'+String(itemId||'');
  }
  (d.suppliers||[]).forEach(s=>{
    (s.purchases||[]).forEach(purchase=>{
      // multi-item
      if(Array.isArray(purchase.items) && purchase.items.length){
        purchase.items.forEach(it=>{
          if(!it.productId || !(it.qty>0)) return;
          const unitCost = (it.unitCost>0) ? it.unitCost : ((it.lineAmount>0 && it.qty>0) ? it.lineAmount/it.qty : 0);
          // subtract returns for this item if present
          let returned = 0;
          (purchase.returns||[]).forEach(r=>{
            if(Array.isArray(r.items)){
              r.items.filter(x=>x.itemId===it.id || x.productId===it.productId).forEach(x=>{ returned += Number(x.qty)||0; });
            }
          });
          const qtyOrig = Number(it.qty)||0;
          const qtyRem = Math.max(0, qtyOrig - returned);
          const k = key(purchase.id, it.productId, it.id);
          if(existingKeys.has(k)) return;
          existingKeys.add(k);
          layers.push({
            id: (typeof uid==='function'?uid():('L'+Math.random().toString(36).slice(2))),
            purchaseId: purchase.id,
            productId: it.productId,
            itemId: it.id||null,
            qtyOriginal: qtyOrig,
            qtyRemaining: qtyRem,
            unitCost: unitCost,
            status: qtyRem>0 ? 'open' : 'depleted',
            source: 'purchase',
            date: purchase.date||'',
            note: 'migration',
          });
        });
      } else if(purchase.productId && purchase.qty>0){
        const qtyOrig = Number(purchase.qty)||0;
        let unitCost = 0;
        if(qtyOrig>0 && purchase.amount>0) unitCost = purchase.amount / qtyOrig;
        let returned = (purchase.returns||[]).reduce((a,r)=>a+(Number(r.qty)||0),0);
        const qtyRem = Math.max(0, qtyOrig - returned);
        const k = key(purchase.id, purchase.productId, '');
        if(existingKeys.has(k)) return;
        existingKeys.add(k);
        layers.push({
          id: (typeof uid==='function'?uid():('L'+Math.random().toString(36).slice(2))),
          purchaseId: purchase.id,
          productId: purchase.productId,
          itemId: null,
          qtyOriginal: qtyOrig,
          qtyRemaining: qtyRem,
          unitCost: unitCost,
          status: qtyRem>0 ? 'open' : 'depleted',
          source: 'purchase',
          date: purchase.date||'',
          note: 'migration',
        });
      }
    });
  });

  // Drain excess remaining vs current stockQty (deterministic FIFO) — no fake cost layers
  (d.products||[]).forEach(prod=>{
    const stock = Number(prod.stockQty)||0;
    const prodLayers = layers.filter(l=>l.productId===prod.id && l.status==='open').sort((a,b)=>(a.date||'').localeCompare(b.date||'')||String(a.id).localeCompare(String(b.id)));
    let sumRem = prodLayers.reduce((s,l)=>s+(l.qtyRemaining||0),0);
    let excess = sumRem - stock;
    if(excess>1e-9){
      for(const layer of prodLayers){
        if(excess<=0) break;
        const take = Math.min(layer.qtyRemaining||0, excess);
        layer.qtyRemaining = (layer.qtyRemaining||0) - take;
        excess -= take;
        if(layer.qtyRemaining<=0){ layer.qtyRemaining=0; layer.status='depleted'; }
      }
    }
    // if stock > sumRem: do NOT invent cost; leave discrepancy (documented risk)
  });
  return layers;
}

// ---------- Migration-gap reconciliation (idempotent, runs on every load) ----------
// شکاف بین stockQty فعلی و مجموع لایه‌های FIFO باز را با یک لایه‌ی شفاف و ردیابی‌پذیر
// (source:'migration-gap') پر می‌کند — برای موجودی‌ای که سابقه‌ی خرید واقعی در سیستم
// FIFO ندارد (مثلاً «موجودی اولیه»ای که قبل از فعال‌شدن FIFO، مستقیم روی stockQty
// ثبت شده بود و migrateBuildInventoryLayers چون فقط از supplier.purchases می‌خونه،
// اصلاً نمی‌بینتش). لایه‌های خرید واقعی و allocationهای فروش قبلی هرگز دست نمی‌خورند؛
// این تابع فقط زمانی که stockQty > مجموع لایه‌های باز باشه یک لایه‌ی جدید اضافه می‌کنه —
// idempotent است چون هر بار gap واقعیِ لحظه رو از روی داده‌ی فعلی حساب می‌کنه، نه یک پرچمِ
// «قبلاً اجرا شده».
function earliestKnownDateForProduct(prod){
  const dates = [];
  (prod.priceHistory||[]).forEach(h=>{ if(h.date) dates.push(h.date); });
  (prod.stockLog||[]).forEach(l=>{ if(l.date) dates.push(l.date); });
  dates.sort();
  return dates.length ? dates[0] : '2000-01-01';
}
function reconcileMissingInventoryLayers(d){
  const EPS = 1e-6;
  if(!d.inventoryLayers) d.inventoryLayers = [];
  (d.products||[]).forEach(prod=>{
    const stock = Number(prod.stockQty)||0;
    const openLayers = d.inventoryLayers.filter(l=>l.productId===prod.id && l.status==='open' && (l.qtyRemaining||0)>0);
    const openQty = openLayers.reduce((s,l)=>s+(l.qtyRemaining||0),0);
    const gap = stock - openQty;
    if(gap <= EPS) return; // چیزی کم نیست (یا لایه‌ها از stock بیشترن — کار migrateBuildInventoryLayers است، نه این تابع)
    let unitCost;
    if(openLayers.length){
      // میانگین وزنی لایه‌های باز همین کالا: دقیق‌تر از fallback چون از خرید واقعی همین کالا می‌آد
      const val = openLayers.reduce((s,l)=>s+(l.qtyRemaining||0)*(l.unitCost||0),0);
      unitCost = openQty>0 ? val/openQty : (prod.buy||0);
    } else {
      // هیچ خرید واقعی‌ای برای این کالا در سیستم FIFO ثبت نشده — تنها مبنای موجود، قیمت خرید دستی است
      unitCost = prod.buy||0;
    }
    d.inventoryLayers.push({
      id: (typeof uid==='function'?uid():('L'+Math.random().toString(36).slice(2))),
      purchaseId: null,
      productId: prod.id,
      itemId: null,
      qtyOriginal: gap,
      qtyRemaining: gap,
      unitCost: unitCost,
      status: 'open',
      source: 'migration-gap',
      date: earliestKnownDateForProduct(prod),
      note: 'موجودی بدون سابقه‌ی خرید در FIFO (اصلاح خودکار شکاف Migration)',
    });
  });
}

function normalizeData(parsed){
  const d = emptyData();
  if(!parsed || typeof parsed !== 'object') return d;
  // نسخه‌ی ورودی را فقط برای لاگ/عیب‌یابی نگه می‌داریم؛ نبودش یعنی بکاپ قدیمی (نسخه ۱)
  const inputSchemaVersion = parsed.schemaVersion || 1;
  d.invoiceSeq = parsed.invoiceSeq || 1000;
  d.products = (parsed.products||[]).map(p=>({
    id: p.id||uid(),
    name: p.name||'',
    category: p.category||'',
    packageWeight: p.packageWeight||0,
    buy: p.buy||0,
    wholesale: (p.wholesale!==undefined? p.wholesale : p.sell) || 0,
    retail: (p.retail!==undefined? p.retail : p.sell) || 0,
    sell: p.sell || p.retail || 0,
    stockQty: p.stockQty!==undefined ? p.stockQty : 0,
    minStock: p.minStock||0,
    priceHistory: p.priceHistory||[],
    stockLog: p.stockLog||[],
    active: p.active!==false,
  }));
  d.customers = (parsed.customers||[]).map(c=>({
    id: c.id||uid(),
    name: c.name||'',
    ownerName: c.ownerName||'',
    phone: c.phone||'',
    address: c.address||'',
    region: c.region||'',
    route: c.route||'',
    note: c.note||'',
    openingBalance: c.openingBalance||0,
    visits: c.visits||[],
    active: c.active!==false,
  }));
  d.invoices = (parsed.invoices||[]).map(i=>({
    id:i.id||uid(), number:i.number, customerId:i.customerId, date:i.date,
    items:(i.items||[]).map(it=>({
      productId:it.productId, name:it.name, qty:it.qty, price:it.price,
      buyPrice:it.buyPrice||0, discount:it.discount||0, weight:it.weight||0,
    })),
    total:i.total||0, discount:i.discount||0, discountType:i.discountType,
    prevBalance:i.prevBalance, cashPaid:i.cashPaid||0, checkPaid:i.checkPaid||0,
    cardPaid:i.cardPaid||0, transferPaid:i.transferPaid||0,
    newBalance:i.newBalance,
    editHistory:i.editHistory||[],
  }));
  d.payments = (parsed.payments||[]).map(p=>({
    id:p.id||uid(), customerId:p.customerId, date:p.date, amount:p.amount,
    method:p.method||'cash', invoiceId:p.invoiceId, note:p.note||'',
    // برگشت‌های قدیمی این فیلد را ندارند => آرایه خالی => رفتار قبلی (فقط اصلاح حساب) دقیقاً حفظ می‌شود
    returnItems: Array.isArray(p.returnItems) ? p.returnItems.map(ri=>({
      productId: ri.productId, name: ri.name||'', qty: ri.qty||0, price: ri.price||0,
    })) : [],
  }));
  d.checks = (parsed.checks||[]).map(c=>({
    id:c.id||uid(), customerId:c.customerId, amount:c.amount, dueDate:c.dueDate,
    checkNumber:c.checkNumber||'', status:c.status||'pending', invoiceId:c.invoiceId,
  }));
  d.suppliers = (parsed.suppliers||[]).map(s=>({
    id:s.id||uid(), name:s.name||'', phone:s.phone||'',
    openingBalance: s.openingBalance||0,
    // FIX 1: archival/inactive flag only — never removes the supplier or its history.
    // Same convention as products/customers (`active!==false` keeps old backups defaulting to active).
    active: s.active!==false,
    purchases:(s.purchases||[]).map(p=>({
      id:p.id||uid(), date:p.date, amount:p.amount, desc:p.desc||'', productId:p.productId||'', qty:p.qty||0,
      items: Array.isArray(p.items) ? p.items.map(it=>({id:it.id||uid(), productId:it.productId||'', name:it.name||'', qty:it.qty||0, unitCost:it.unitCost||0, lineAmount:it.lineAmount||0})) : undefined,
      returns:(p.returns||[]).map(r=>({
        id:r.id||uid(), date:r.date||p.date, qty:r.qty||0, amount:r.amount||0,
        items: Array.isArray(r.items) ? r.items.map(x=>({itemId:x.itemId, productId:x.productId||'', qty:x.qty||0, amount:x.amount||0})) : undefined,
      })),
    })),
    payments:s.payments||[],
  }));
  // inventory layers (FIFO)
  // schema < 3 or missing/empty layers → build from real purchases (never claim empty=[] is migration)
  if(inputSchemaVersion >= 3 && Array.isArray(parsed.inventoryLayers) && parsed.inventoryLayers.length){
    d.inventoryLayers = parsed.inventoryLayers.map(l=>({
      id: l.id||uid(),
      purchaseId: l.purchaseId||null,
      productId: l.productId,
      itemId: l.itemId||null,
      qtyOriginal: Number(l.qtyOriginal)||0,
      qtyRemaining: Number(l.qtyRemaining)||0,
      unitCost: Number(l.unitCost)||0,
      status: l.status||'open',
      source: l.source||'purchase',
      date: l.date||'',
      note: l.note||'',
    }));
  } else {
    d.inventoryLayers = migrateBuildInventoryLayers(d);
  }
  reconcileMissingInventoryLayers(d);

  // invoice item costAllocations preserved when present (no rewrite of historical buyPrice)
  d.invoices = d.invoices.map((inv, idx)=>{
    const src = (parsed.invoices||[])[idx];
    if(!src) return inv;
    inv.items = (inv.items||[]).map((it, j)=>{
      const sit = (src.items||[])[j];
      if(sit && Array.isArray(sit.costAllocations)){
        it.costAllocations = sit.costAllocations.map(a=>({
          layerId: a.layerId||null,
          qty: Number(a.qty)||0,
          unitCost: Number(a.unitCost)||0,
          cost: Number(a.cost)||0,
          emergency: !!a.emergency,
        }));
      }
      if(sit && sit.cogs!==undefined) it.cogs = sit.cogs;
      return it;
    });
    return inv;
  });

  // بعد از migration و آماده‌سازی کامل داده، همیشه نسخه‌ی فعلی schema خروجی گرفته می‌شود
  d.schemaVersion = CURRENT_SCHEMA_VERSION;
  if(inputSchemaVersion !== CURRENT_SCHEMA_VERSION){
    console.log('normalizeData: migrated data from schemaVersion', inputSchemaVersion, 'to', CURRENT_SCHEMA_VERSION);
  }
  return d;
}

async function loadData(){
  try{
    const record = await dbGet(RECORD_KEY);
    if(record && record.value){
      data = normalizeData(JSON.parse(record.value));
    } else if(window.storage){
      // fallback: recover from an older window.storage-based save, if this
      // file was ever previously run inside a Claude artifact sandbox
      try{
        const legacy = await window.storage.get('baqeri-erp-data', false);
        if(legacy && legacy.value){
          data = normalizeData(JSON.parse(legacy.value));
          await saveData();
        }
      }catch(e){ /* no legacy data — fine */ }
    }
  }catch(e){
    console.error('loadData failed', e);
    showToast('خطا در بارگذاری اطلاعات');
  }
}

async function saveData(){
  try{
    data.schemaVersion = CURRENT_SCHEMA_VERSION;
    await dbPut(RECORD_KEY, JSON.stringify(data));
  }catch(e){
    console.error('save failed', e);
    showToast('⚠️ ذخیره نشد، دوباره تلاش کن');
    // Propagate failure so callers do not show success / close modal / navigate
    throw e;
  }
  // fire-and-forget: بکاپ خودکار کاملاً جدا از ذخیره‌ی اصلی اجرا می‌شود؛
  // ذخیره‌ی اصلی چند خط بالاتر با موفقیت کامل شده، پس هر خطایی اینجا فقط لاگ می‌شود
  autoBackupTick().catch(e=>console.error('auto backup failed', e));
}

function nextInvoiceNumber(){
  data.invoiceSeq = (data.invoiceSeq||1000) + 1;
  return data.invoiceSeq;
}

