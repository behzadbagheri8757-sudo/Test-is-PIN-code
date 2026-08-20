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

// ---------- Legacy opening / migration-gap reconciliation (idempotent) ----------
// شکاف بین stockQty و مجموع لایه‌های FIFO باز را با لایهٔ legacy پر می‌کند.
// موجودی اولیه قبل از FIFO معمولاً purchase record ندارد؛ migrateBuildInventoryLayers
// فقط از supplier.purchases می‌خواند و آن را نمی‌بیند.
//
// قانون طلایی (FIFO-as-additive، نه بازنویسی تاریخ):
//   قیمت لایهٔ legacy هرگز از میانگین/قیمت لایه‌های purchase جدید گرفته نمی‌شود.
//   منبع هزینهٔ تاریخی: priceHistory هم‌زمان با opening، وگرنه product.buy.
//   اگر هیچ مبنایی نباشد، unitCost=0 و basis=unknown (حدس خاموش ممنوع).
//
// لایه‌های purchase واقعی، costAllocations فاکتور، و stockQty هرگز اینجا دست نمی‌خورند.

function earliestKnownDateForProduct(prod){
  const dates = [];
  (prod.priceHistory||[]).forEach(h=>{ if(h.date) dates.push(h.date); });
  (prod.stockLog||[]).forEach(l=>{ if(l.date) dates.push(l.date); });
  dates.sort();
  return dates.length ? dates[0] : '2000-01-01';
}

/**
 * هزینهٔ واحد قابل‌اثبات برای موجودی افتتاحیه/legacy یک کالا.
 * ترتیب اولویت:
 *  1) قدیمی‌ترین priceHistory که buy>0 دارد (معمولاً هم‌زمان با موجودی اولیه)
 *  2) product.buy اگر >0
 *  3) unknown → unitCost 0 (بدون حدس از لایه‌های purchase)
 * هرگز از open purchase layers میانگین نمی‌گیرد.
 */
function legacyOpeningUnitCost(prod){
  const hist = (prod && prod.priceHistory) ? prod.priceHistory.slice() : [];
  hist.sort((a,b)=> String(a.date||'').localeCompare(String(b.date||'')));
  for(let i=0;i<hist.length;i++){
    const b = Number(hist[i].buy);
    if(b>0){
      return { unitCost: b, basis: 'priceHistory', asOf: hist[i].date||null };
    }
  }
  const buy = Number(prod && prod.buy) || 0;
  if(buy>0){
    return { unitCost: buy, basis: 'product.buy', asOf: null };
  }
  return { unitCost: 0, basis: 'unknown', asOf: null };
}

/**
 * اصلاح یک‌بارهٔ لایه‌های legacy که قبلاً با باگ «میانگین لایه‌های purchase»
 * قیمت‌گذاری شده‌اند. فقط unitCost/source/note را در صورت اثبات اشتباه عوض می‌کند.
 * qty / purchase layers / invoices را لمس نمی‌کند.
 *
 * ایمنی در برابر false-positive:
 *   فقط وقتی priceHistory قدیمی و product.buy روی یک عدد توافق دارند
 *   (یا فقط یکی از آن‌ها موجود است) هدف repair قطعی است.
 *   اگر ph0 و product.buy اختلاف معنادار دارند → لایه را دست نزن
 *   (مثال: تخمه کدو دوآتیشه ph0=740k و buy=820k).
 *
 * شرط آلودگی:
 *   unitCost فعلی ≈ هزینهٔ لایهٔ purchase (یا میانگین purchaseهای باز)
 *   و با هدف توافق‌شدهٔ تاریخی اختلاف دارد.
 */
function repairMispricedLegacyLayers(d){
  const EPS_COST = 0.5;
  if(!d.inventoryLayers) return;
  const prods = {};
  (d.products||[]).forEach(p=>{ prods[p.id]=p; });
  (d.inventoryLayers||[]).forEach(layer=>{
    const src = layer.source||'';
    if(src!=='migration-gap' && src!=='legacy-opening') return;
    if(layer.purchaseId) return;
    const prod = prods[layer.productId];
    if(!prod) return;

    // هدف قطعی: ph0 و product.buy باید توافق کنند؛ در غیر این صورت no-op
    const histSorted = (prod.priceHistory||[]).slice().sort((a,b)=>
      String(a.date||'').localeCompare(String(b.date||'')));
    let ph0 = 0;
    for(let i=0;i<histSorted.length;i++){
      const b = Number(histSorted[i].buy);
      if(b>0){ ph0 = b; break; }
    }
    const buy = Number(prod.buy)||0;
    let target = null;
    let basis = null;
    if(ph0>0 && buy>0){
      if(Math.abs(ph0 - buy) <= EPS_COST){
        target = ph0; basis = 'priceHistory+product.buy';
      } else {
        // مبنا مبهم — legacy سالم یا نامشخص را دست نزن
        if(src==='migration-gap' && Math.abs((Number(layer.unitCost)||0) - buy) <= EPS_COST){
          layer.source = 'legacy-opening';
          layer.note = layer.note || 'موجودی افتتاحیه — هزینه منطبق با product.buy (ph0 متفاوت؛ بدون اصلاح قیمت)';
        }
        return;
      }
    } else if(ph0>0){
      target = ph0; basis = 'priceHistory';
    } else if(buy>0){
      target = buy; basis = 'product.buy';
    } else {
      return;
    }

    const cur = Number(layer.unitCost)||0;
    if(Math.abs(cur - target) <= EPS_COST){
      if(src==='migration-gap'){
        layer.source = 'legacy-opening';
        layer.note = layer.note || 'موجودی افتتاحیه (قبل از FIFO) — هزینه از '+basis;
      }
      return;
    }

    const purchaseCosts = (d.inventoryLayers||[])
      .filter(l=> l.productId===layer.productId
        && l.source==='purchase'
        && (l.status==='open' || l.status==='depleted')
        && (Number(l.unitCost)||0)>0)
      .map(l=> Number(l.unitCost)||0);
    const openPurch = (d.inventoryLayers||[]).filter(l=>
      l.productId===layer.productId && l.source==='purchase'
      && l.status==='open' && (l.qtyRemaining||0)>0);
    let weighted = null;
    if(openPurch.length){
      const q = openPurch.reduce((s,l)=>s+(l.qtyRemaining||0),0);
      const v = openPurch.reduce((s,l)=>s+(l.qtyRemaining||0)*(l.unitCost||0),0);
      if(q>0) weighted = v/q;
    }
    const matchesPurchase = purchaseCosts.some(c=> Math.abs(c - cur) <= EPS_COST)
      || (weighted!=null && Math.abs(weighted - cur) <= Math.max(EPS_COST, Math.abs(weighted)*1e-9));
    if(!matchesPurchase) return;

    layer.unitCost = target;
    layer.source = 'legacy-opening';
    layer.note = 'موجودی افتتاحیه (قبل از FIFO) — هزینه اصلاح‌شده از '+basis
      +' (قبلاً به‌اشتباه از لایهٔ خرید جدید برچسب خورده بود)';
  });
}

function reconcileMissingInventoryLayers(d){
  const EPS = 1e-6;
  const EPS_COST = 0.5;
  if(!d.inventoryLayers) d.inventoryLayers = [];
  (d.products||[]).forEach(prod=>{
    const stock = Number(prod.stockQty)||0;
    const openLayers = d.inventoryLayers.filter(l=>l.productId===prod.id && l.status==='open' && (l.qtyRemaining||0)>0);
    const openQty = openLayers.reduce((s,l)=>s+(l.qtyRemaining||0),0);
    const gap = stock - openQty;
    if(gap <= EPS) return;
    // هرگز از میانگین لایه‌های purchase برای قیمت legacy استفاده نکن.
    // اگر ph0 و product.buy اختلاف دارند → product.buy (بدون حدس از purchase).
    const histSorted = (prod.priceHistory||[]).slice().sort((a,b)=>
      String(a.date||'').localeCompare(String(b.date||'')));
    let ph0 = 0, ph0Date = null;
    for(let i=0;i<histSorted.length;i++){
      const b = Number(histSorted[i].buy);
      if(b>0){ ph0 = b; ph0Date = histSorted[i].date||null; break; }
    }
    const buy = Number(prod.buy)||0;
    let unitCost = 0, basis = 'unknown';
    if(ph0>0 && buy>0){
      if(Math.abs(ph0 - buy) <= EPS_COST){
        unitCost = ph0; basis = 'priceHistory+product.buy';
      } else {
        unitCost = buy; basis = 'product.buy (ph0 differs; no purchase average)';
      }
    } else if(ph0>0){
      unitCost = ph0; basis = 'priceHistory';
    } else if(buy>0){
      unitCost = buy; basis = 'product.buy';
    }
    const note = basis==='unknown'
      ? 'موجودی افتتاحیه بدون سند هزینهٔ قابل‌اثبات (unitCost=0)'
      : ('موجودی افتتاحیه (قبل از FIFO) — هزینه از '+basis
          +(ph0Date && basis.indexOf('priceHistory')===0 ? (' @ '+ph0Date) : ''));
    d.inventoryLayers.push({
      id: (typeof uid==='function'?uid():('L'+Math.random().toString(36).slice(2))),
      purchaseId: null,
      productId: prod.id,
      itemId: null,
      qtyOriginal: gap,
      qtyRemaining: gap,
      unitCost: unitCost,
      status: 'open',
      source: 'legacy-opening',
      date: earliestKnownDateForProduct(prod),
      note: note,
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
  // اول لایه‌های legacy قبلی که با باگ میانگین purchase قیمت خورده‌اند را اصلاح کن
  // (فقط unitCost/source/note؛ qty و purchase و فاکتور دست‌نخورده)
  repairMispricedLegacyLayers(d);
  // سپس هر شکاف باقی‌مانده را با هزینهٔ تاریخی (نه میانگین purchase) بساز
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

