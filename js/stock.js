/* stock.js — inventory apply/revert effects (invoice, purchase, return)
   FIFO layers: minimal surgery on Phase 0 extract.
*/

// ---------- FIFO layer helpers ----------
function ensureInventoryLayers(){
  if(!data.inventoryLayers) data.inventoryLayers = [];
  return data.inventoryLayers;
}

function openLayersForProduct(productId){
  return ensureInventoryLayers()
    .filter(l => l.productId===productId && l.status==='open' && (l.qtyRemaining||0)>0)
    .slice()
    .sort((a,b)=>{
      const da = a.date||'';
      const db = b.date||'';
      if(da!==db) return da.localeCompare(db);
      return String(a.id||'').localeCompare(String(b.id||''));
    });
}

function layerById(layerId){
  return ensureInventoryLayers().find(l=>l.id===layerId) || null;
}

function layersForPurchase(purchaseId, productId, itemId){
  return ensureInventoryLayers().filter(l=>{
    if(l.purchaseId!==purchaseId) return false;
    if(productId && l.productId!==productId) return false;
    if(itemId!==undefined && itemId!==null && itemId!==''){
      if(l.itemId && l.itemId!==itemId) return false;
    }
    return true;
  });
}

/** Create one inventory layer (purchase or manual/orphan). */
function createInventoryLayer({purchaseId, productId, itemId, qty, unitCost, source, date, note}){
  if(!(qty>0) || !productId) return null;
  const layer = {
    id: uid(),
    purchaseId: purchaseId || null,
    productId,
    itemId: itemId || null,
    qtyOriginal: qty,
    qtyRemaining: qty,
    unitCost: Number(unitCost)||0,
    status: 'open',
    source: source || 'purchase',
    date: date || todayISO(),
    note: note || '',
  };
  ensureInventoryLayers().push(layer);
  return layer;
}

/**
 * Consume qty from open FIFO layers for productId.
 * Returns { ok, allocations:[{layerId,qty,unitCost,cost}], shortfall }
 */
function consumeLayersFIFO(productId, qty){
  const allocations = [];
  let need = Number(qty)||0;
  if(need<=0) return { ok:true, allocations, shortfall:0 };
  const layers = openLayersForProduct(productId);
  for(const layer of layers){
    if(need<=0) break;
    const take = Math.min(layer.qtyRemaining, need);
    if(take<=0) continue;
    layer.qtyRemaining = (layer.qtyRemaining||0) - take;
    if(layer.qtyRemaining<=0){
      layer.qtyRemaining = 0;
      layer.status = 'depleted';
    }
    allocations.push({
      layerId: layer.id,
      qty: take,
      unitCost: layer.unitCost||0,
      cost: take * (layer.unitCost||0),
    });
    need -= take;
  }
  return { ok: need<=0, allocations, shortfall: Math.max(0, need) };
}

/**
 * Restore previously consumed allocations (sale revert / invoice edit).
 * Voided layers are NOT reactivated — orphan restore layer instead.
 */
function restoreLayerAllocations(allocations){
  if(!Array.isArray(allocations)) return;
  allocations.forEach(a=>{
    if(!(a.qty>0)) return;
    const layer = a.layerId ? layerById(a.layerId) : null;
    if(layer && layer.status!=='voided'){
      layer.qtyRemaining = (layer.qtyRemaining||0) + a.qty;
      if(layer.status==='depleted' && layer.qtyRemaining>0) layer.status = 'open';
    } else {
      const pid = (layer && layer.productId) || a.productId || null;
      if(!pid) return;
      createInventoryLayer({
        purchaseId: null,
        productId: pid,
        qty: a.qty,
        unitCost: a.unitCost||0,
        source: 'sale-revert',
        date: todayISO(),
        note: 'بازیابی پس از برگشت فروش (لایه void/حذف\u200cشده)',
      });
    }
  });
}

/** Resolve unitCost for a purchase line (multi or single). */
function purchaseLineUnitCost(purchase, line){
  if(line && line.unitCost>0) return line.unitCost;
  if(purchase.productId && purchase.qty>0 && purchase.amount>0){
    return purchase.amount / purchase.qty;
  }
  if(line && line.lineAmount>0 && line.qty>0) return line.lineAmount / line.qty;
  return 0;
}

function applyPurchaseStockEffects(purchase, supplierName){
  const lines = purchaseLines(purchase);
  const date = purchase.date || todayISO();
  lines.forEach(it=>{
    if(!it.productId || !(it.qty>0)) return;
    const prod = data.products.find(x=>x.id===it.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) + it.qty;
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date, type:'in', qty:it.qty, note:'خرید از '+(supplierName||''), purchaseId:purchase.id});
    }
    const unitCost = purchaseLineUnitCost(purchase, it);
    createInventoryLayer({
      purchaseId: purchase.id,
      productId: it.productId,
      itemId: it.id || null,
      qty: it.qty,
      unitCost,
      source: 'purchase',
      date,
      note: 'خرید از '+(supplierName||''),
    });
  });
}

function revertPurchaseStockEffects(purchase){
  const lines = purchaseLines(purchase);
  lines.forEach(it=>{
    if(!it.productId || !(it.qty>0)) return;
    const prod = data.products.find(x=>x.id===it.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) - it.qty;
      prod.stockLog = (prod.stockLog||[]).filter(l=>{
        if(l.purchaseId) return l.purchaseId !== purchase.id;
        return !(l.type==='in' && l.qty===it.qty && l.note && String(l.note).indexOf('خرید از')===0);
      });
    }
  });
  data.inventoryLayers = ensureInventoryLayers().filter(l=> l.purchaseId!==purchase.id);
}

/**
 * Purchase return: decrease stock + matching purchase layer(s).
 * returnLines: [{productId, qty, itemId?}]
 * BLOCKS with no mutation if any line exceeds layer remaining.
 */
function applyPurchaseReturnStockEffects(purchase, returnLines, supplierName, date){
  const d = date || todayISO();
  const planned = [];
  for(const rl of (returnLines||[])){
    if(!(rl.qty>0) || !rl.productId) continue;
    const layers = layersForPurchase(purchase.id, rl.productId, rl.itemId)
      .filter(l=>l.status==='open' && (l.qtyRemaining||0)>0)
      .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    let need = rl.qty;
    let available = layers.reduce((s,l)=>s+(l.qtyRemaining||0),0);
    if(need > available + 1e-9){
      return { ok:false, error: 'مقدار برگشتی از موجودی باقی\u200cمانده لایه خرید بیشتر است (حداکثر '+available+')' };
    }
    const takes = [];
    for(const layer of layers){
      if(need<=0) break;
      const take = Math.min(layer.qtyRemaining, need);
      takes.push({ layer, take });
      need -= take;
    }
    planned.push({ rl, takes });
  }
  planned.forEach(({rl, takes})=>{
    takes.forEach(({layer, take})=>{
      layer.qtyRemaining = (layer.qtyRemaining||0) - take;
      if(layer.qtyRemaining<=0){ layer.qtyRemaining=0; layer.status='depleted'; }
    });
    const prod = data.products.find(x=>x.id===rl.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) - rl.qty;
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date:d, type:'out', qty:-rl.qty, note:'برگشت خرید به '+(supplierName||''), purchaseId:purchase.id});
    }
  });
  return { ok:true };
}

/**
 * adjustPurchaseLayerQty — API for purchase qty edit.
 * BLOCK if newQty < consumedQty; no mutation before BLOCK.
 */
function adjustPurchaseLayerQty(purchaseId, productId, newQty, itemId){
  const layers = layersForPurchase(purchaseId, productId, itemId);
  if(!layers.length){
    return { ok:false, error:'لایه خرید پیدا نشد' };
  }
  const layer = layers[0];
  const snapshot = { qtyOriginal: layer.qtyOriginal, qtyRemaining: layer.qtyRemaining, status: layer.status };
  const consumed = (layer.qtyOriginal||0) - (layer.qtyRemaining||0);
  const nq = Number(newQty);
  if(!(nq>=0) || isNaN(nq)) return { ok:false, error:'مقدار نامعتبر' };
  if(nq < consumed){
    return { ok:false, error:'نمی\u200cتوان مقدار را کمتر از مصرف\u200cشده ('+consumed+') قرار داد', consumed, noMutation:true };
  }
  const delta = nq - (layer.qtyOriginal||0);
  layer.qtyOriginal = nq;
  layer.qtyRemaining = (layer.qtyRemaining||0) + delta;
  if(layer.qtyRemaining>0 && layer.status==='depleted') layer.status = 'open';
  if(layer.qtyRemaining<=0){ layer.qtyRemaining=0; layer.status = layer.status==='voided' ? 'voided' : 'depleted'; }
  const prod = data.products.find(x=>x.id===productId);
  if(prod && delta!==0){
    prod.stockQty = (prod.stockQty||0) + delta;
    prod.stockLog = prod.stockLog||[];
    prod.stockLog.push({id:uid(), date:todayISO(), type: delta>=0?'in':'out', qty:delta, note:'ویرایش مقدار خرید', purchaseId});
  }
  for(const s of (data.suppliers||[])){
    const p = (s.purchases||[]).find(x=>x.id===purchaseId);
    if(!p) continue;
    if(p.productId===productId){
      p.qty = nq;
    }
    if(Array.isArray(p.items) && itemId){
      const it = p.items.find(x=>x.id===itemId);
      if(it){ it.qty = nq; it.lineAmount = nq * (it.unitCost||0); }
    }
  }
  return { ok:true, layer, delta };
}

/** Void purchase layers. Historical allocations remain; not consumable. */
function voidPurchaseLayers(purchaseId){
  const layers = ensureInventoryLayers().filter(l=>l.purchaseId===purchaseId);
  const byProduct = {};
  layers.forEach(layer=>{
    const rem = layer.qtyRemaining||0;
    if(rem>0){
      byProduct[layer.productId] = (byProduct[layer.productId]||0) + rem;
    }
    layer.status = 'voided';
  });
  Object.keys(byProduct).forEach(pid=>{
    const prod = data.products.find(x=>x.id===pid);
    if(prod){
      prod.stockQty = (prod.stockQty||0) - byProduct[pid];
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-byProduct[pid], note:'باطل\u200cسازی خرید', purchaseId});
    }
  });
  return { ok:true, layers };
}

/** HARD DELETE when nothing consumed. */
function hardDeletePurchaseLayers(purchaseId){
  const layers = ensureInventoryLayers().filter(l=>l.purchaseId===purchaseId);
  for(const layer of layers){
    const consumed = (layer.qtyOriginal||0) - (layer.qtyRemaining||0);
    if(consumed>0) return { ok:false, error:'خرید مصرف شده؛ از void استفاده کنید', consumed };
  }
  layers.forEach(layer=>{
    const rem = layer.qtyRemaining||0;
    const prod = data.products.find(x=>x.id===layer.productId);
    if(prod && rem>0){
      prod.stockQty = (prod.stockQty||0) - rem;
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-rem, note:'حذف خرید', purchaseId});
    }
  });
  data.inventoryLayers = ensureInventoryLayers().filter(l=>l.purchaseId!==purchaseId);
  return { ok:true };
}

/** Delete or void purchase — production API for future UI. */
function deleteOrVoidPurchase(purchaseId){
  const layers = ensureInventoryLayers().filter(l=>l.purchaseId===purchaseId);
  const anyConsumed = layers.some(l => ((l.qtyOriginal||0)-(l.qtyRemaining||0))>0);
  if(anyConsumed){
    const r = voidPurchaseLayers(purchaseId);
    return { ok:r.ok, mode:'void' };
  }
  const r = hardDeletePurchaseLayers(purchaseId);
  if(!r.ok) return r;
  for(const s of (data.suppliers||[])){
    if(!s.purchases) continue;
    const idx = s.purchases.findIndex(p=>p.id===purchaseId);
    if(idx>=0){ s.purchases.splice(idx,1); break; }
  }
  return { ok:true, mode:'hard-delete' };
}

// ---------- برگشت فروش = ورود کالا + orphan layer ----------
function applyReturnStockEffects(returnItems, date, payment){
  returnItems.forEach(ri=>{
    const prod = data.products.find(p=>p.id===ri.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) + (ri.qty||0);
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date, type:'return', qty:ri.qty||0, note:'برگشت از فروش', paymentId:payment.id});
    }
    if(!(ri.qty>0) || !ri.productId) return;
    let unitCost = (ri.unitCost!==undefined && ri.unitCost!==null) ? Number(ri.unitCost) : null;
    if(unitCost===null || isNaN(unitCost)){
      const sold = (data.invoices||[])
        .filter(inv=>inv.customerId===payment.customerId)
        .flatMap(inv=>(inv.items||[]).filter(it=>it.productId===ri.productId));
      const last = sold.length ? sold[sold.length-1] : null;
      if(last && last.costAllocations && last.costAllocations.length){
        const tQty = last.costAllocations.reduce((s,a)=>s+(a.qty||0),0);
        const tCost = last.costAllocations.reduce((s,a)=>s+(a.cost||0),0);
        unitCost = tQty>0 ? tCost/tQty : (last.buyPrice||0);
      } else if(last){
        unitCost = last.buyPrice||0;
      } else {
        unitCost = prod ? (prod.buy||0) : 0;
      }
    }
    createInventoryLayer({
      purchaseId: null,
      productId: ri.productId,
      qty: ri.qty,
      unitCost,
      source: 'sale-return',
      date,
      note: 'برگشت از فروش',
    });
  });
}

/** مجموع qtyRemaining لایه‌های open قابل مصرف برای یک کالا */
function fifoAvailableQty(productId){
  return openLayersForProduct(productId).reduce((s,l)=>s+(l.qtyRemaining||0),0);
}

/**
 * اعتبارسنجی فروش قبل از هر mutation.
 * creditStock/creditFifo: مقدارهایی که با revert فاکتور در حال ویرایش آزاد می‌شوند.
 * Returns { ok, error, code:'STOCK'|'FIFO_DESYNC'|'NEGATIVE_STOCK' }
 */
function validateSaleAvailability(items, creditStockByProduct, creditFifoByProduct){
  creditStockByProduct = creditStockByProduct || {};
  creditFifoByProduct = creditFifoByProduct || {};
  const needed = {};
  (items||[]).forEach(it=>{
    if(!it.productId) return;
    needed[it.productId] = (needed[it.productId]||0) + (Number(it.qty)||0);
  });
  for(const pid of Object.keys(needed)){
    const need = needed[pid];
    if(!(need>0)) continue;
    const prod = data.products.find(p=>p.id===pid);
    const name = prod ? (prod.name||pid) : pid;
    const stock = (prod ? (prod.stockQty||0) : 0) + (creditStockByProduct[pid]||0);
    const fifo = fifoAvailableQty(pid) + (creditFifoByProduct[pid]||0);
    if(stock < 0){
      return { ok:false, code:'NEGATIVE_STOCK', error:'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.\n\n«'+name+'»: موجودی کالا منفی است.' };
    }
    if(need > stock){
      return { ok:false, code:'STOCK', error:'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.\n\n«'+name+'»: موجودی واقعی برای فروش کافی نیست.\nموجودی: '+stock+'\nدرخواستی: '+need };
    }
    if(need > fifo){
      return { ok:false, code:'FIFO_DESYNC', error:'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.\n\n«'+name+'»: موجودی FIFO با موجودی کالا ناسازگار است.\nموجودی کالا: '+stock+'\nموجودی لایه‌های قابل مصرف: '+fifo+'\nدرخواستی: '+need };
    }
  }
  return { ok:true };
}

/** qty آزادشونده از allocationهای یک فاکتور برای یک کالا (ویرایش فاکتور) */
function invoiceReleasedFifoQty(inv, productId){
  let q = 0;
  (inv && inv.items || []).forEach(it=>{
    if(it.productId!==productId) return;
    if(Array.isArray(it.costAllocations) && it.costAllocations.length){
      it.costAllocations.forEach(a=>{
        if(a.emergency) return; // emergency دیگر ساخته نمی‌شود؛ اگر داده قدیمی بود در اعتبارسنجی نمی‌شماریم
        q += Number(a.qty)||0;
      });
    } else {
      // فاکتور قدیمی بدون allocation: بعد از revert orphan ساخته می‌شود؛ برای pre-check از qty ردیف استفاده کن
      q += Number(it.qty)||0;
    }
  });
  return q;
}

function applyInvoiceStockEffects(items, date, inv, isNewInvoice){
  // BLOCK کامل قبل از هر mutation — بدون emergency allocation
  const check = validateSaleAvailability(items);
  if(!check.ok){
    const err = new Error(check.error || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.');
    err.code = check.code || 'STOCK';
    throw err;
  }

  items.forEach(it=>{
    const prod = data.products.find(p=>p.id===it.productId);
    if(!prod) return;
    const need = it.qty||0;
    if(!(need>0)) return;
    const { allocations, shortfall } = consumeLayersFIFO(it.productId, need);
    // دفاع نهایی: اگر با وجود pre-check shortfall آمد، وضعیت را به هم نزن — این حالت نباید رخ دهد
    if(shortfall>0){
      // بازگردانی همان consume جزئی این ردیف
      restoreLayerAllocations(allocations.map(a=>({...a, productId: it.productId})));
      const err = new Error('موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.');
      err.code = 'FIFO_DESYNC';
      throw err;
    }
    if(allocations.some(a=>!a.layerId)){
      restoreLayerAllocations(allocations.map(a=>({...a, productId: it.productId})));
      const err = new Error('موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.');
      err.code = 'FIFO_DESYNC';
      throw err;
    }
    const cogs = allocations.reduce((s,a)=>s+(a.cost||0),0);
    it.costAllocations = allocations;
    it.cogs = cogs;
    if(need>0) it.buyPrice = cogs / need;

    prod.stockQty = (prod.stockQty||0) - need;
    prod.stockLog = prod.stockLog||[];
    prod.stockLog.push({id:uid(), date, type:'sale', qty:-need, note:'فروش (فاکتور #'+inv.number+')', invoiceId:inv.id});
  });
}

function revertInvoiceStockEffects(inv){
  (inv.items||[]).forEach(it=>{
    const prod = data.products.find(p=>p.id===it.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) + it.qty;
      prod.stockLog = (prod.stockLog||[]).filter(l=>{
        if(l.invoiceId) return l.invoiceId !== inv.id;
        return !(l.type==='sale' && l.qty===-it.qty && l.note && l.note.includes('فاکتور #'+inv.number+')'));
      });
    }
    if(it.costAllocations && it.costAllocations.length){
      const allocs = it.costAllocations.filter(a=>a.layerId && !a.emergency).map(a=>({
        ...a,
        productId: it.productId,
      }));
      restoreLayerAllocations(allocs);
      // emergency قدیمی (اگر در داده باشد): orphan صریح بدون احیای خرید
      it.costAllocations.filter(a=>a.emergency && a.qty>0).forEach(a=>{
        createInventoryLayer({
          purchaseId: null,
          productId: it.productId,
          qty: a.qty,
          unitCost: a.unitCost||0,
          source: 'sale-revert',
          date: todayISO(),
          note: 'بازیابی داده قدیمی emergency',
        });
      });
    } else if(it.qty>0 && it.productId){
      createInventoryLayer({
        purchaseId: null,
        productId: it.productId,
        qty: it.qty,
        unitCost: it.buyPrice||0,
        source: 'sale-revert',
        date: todayISO(),
        note: 'بازیابی فاکتور قدیمی',
      });
    }
  });
}

function manualStockIn(productId, qty, note){
  const prod = data.products.find(p=>p.id===productId);
  if(!prod || !(qty>0)) return { ok:false, error:'نامعتبر' };
  prod.stockQty = (prod.stockQty||0) + qty;
  prod.stockLog = prod.stockLog||[];
  prod.stockLog.push({id:uid(), date:todayISO(), type:'in', qty, note: note||'ورود کالا'});
  createInventoryLayer({
    purchaseId: null,
    productId,
    qty,
    unitCost: prod.buy||0,
    source: 'manual-in',
    date: todayISO(),
    note: note||'ورود کالا',
  });
  return { ok:true };
}

function manualStockOut(productId, qty, note){
  const prod = data.products.find(p=>p.id===productId);
  if(!prod || !(qty>0)) return { ok:false, error:'نامعتبر' };
  const stock = Number(prod.stockQty)||0;
  const available = fifoAvailableQty(productId);
  // Atomic: no layer/stock/log mutation unless the full request is feasible
  if(qty > stock + 1e-9){
    return {
      ok:false,
      code:'STOCK',
      error:'موجودی کالا کافی نیست. درخواست: '+qty+' — موجودی: '+stock,
      requested: qty,
      available: stock,
    };
  }
  if(qty > available + 1e-9){
    return {
      ok:false,
      code:'FIFO_SHORTFALL',
      error:'موجودی FIFO کافی نیست. درخواست: '+qty+' — قابل خروج: '+available,
      requested: qty,
      available,
    };
  }
  const { allocations, shortfall } = consumeLayersFIFO(productId, qty);
  // Defensive: should not happen after pre-check; roll back partial consume
  if(shortfall > 0){
    restoreLayerAllocations(allocations.map(a=>({...a, productId})));
    return {
      ok:false,
      code:'FIFO_SHORTFALL',
      error:'موجودی FIFO کافی نیست. درخواست: '+qty+' — قابل خروج: '+(qty-shortfall),
      requested: qty,
      available: qty-shortfall,
    };
  }
  prod.stockQty = stock - qty;
  prod.stockLog = prod.stockLog||[];
  prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-qty, note: note||'خروج/اصلاح دستی'});
  return { ok:true, allocations, shortfall:0 };
}

function manualStockAdjustAbsolute(productId, targetQty, note){
  const prod = data.products.find(p=>p.id===productId);
  if(!prod) return { ok:false, error:'کالا پیدا نشد' };
  const current = prod.stockQty||0;
  const target = Number(targetQty)||0;
  const delta = target - current;
  if(delta===0) return { ok:true, delta:0 };
  if(delta>0){
    prod.stockQty = target;
    prod.stockLog = prod.stockLog||[];
    prod.stockLog.push({id:uid(), date:todayISO(), type:'adjust', qty:delta, note: note||'ویرایش دستی موجودی'});
    createInventoryLayer({
      purchaseId: null,
      productId,
      qty: delta,
      unitCost: prod.buy||0,
      source: 'manual-adjust',
      date: todayISO(),
      note: note||'ویرایش دستی موجودی',
    });
  } else {
    const need = -delta;
    const available = fifoAvailableQty(productId);
    // Atomic: block entire adjust-down if FIFO cannot cover the full reduction
    if(need > available + 1e-9){
      return {
        ok:false,
        code:'FIFO_SHORTFALL',
        error:'امکان کاهش موجودی نیست؛ موجودی FIFO کافی نیست. درخواست کاهش: '+need+' — قابل خروج: '+available,
        requested: need,
        available,
        delta:0,
      };
    }
    if(need > current + 1e-9){
      return {
        ok:false,
        code:'STOCK',
        error:'امکان کاهش موجودی نیست؛ موجودی کالا کافی نیست. درخواست کاهش: '+need+' — موجودی: '+current,
        requested: need,
        available: current,
        delta:0,
      };
    }
    const { allocations, shortfall } = consumeLayersFIFO(productId, need);
    if(shortfall > 0){
      restoreLayerAllocations(allocations.map(a=>({...a, productId})));
      return {
        ok:false,
        code:'FIFO_SHORTFALL',
        error:'امکان کاهش موجودی نیست؛ موجودی FIFO کافی نیست.',
        requested: need,
        available: need-shortfall,
        delta:0,
      };
    }
    prod.stockQty = target;
    prod.stockLog = prod.stockLog||[];
    prod.stockLog.push({id:uid(), date:todayISO(), type:'adjust', qty:delta, note: note||'ویرایش دستی موجودی'});
  }
  return { ok:true, delta };
}
