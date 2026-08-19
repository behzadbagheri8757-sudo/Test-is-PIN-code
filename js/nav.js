/* nav.js — multi-page navigation & boot
   UI/Navigation only. Does not change accounting logic.
*/
const NAV_ITEMS = [
  { id: 'dashboard', href: './index.html',     label: 'داشبورد' },
  { id: 'customers', href: './customers.html', label: 'مشتریان' },
  { id: 'products',  href: './products.html',  label: 'اجناس' },
  { id: 'inventory', href: './inventory.html', label: 'انبار' },
  { id: 'suppliers', href: './suppliers.html', label: 'تامین‌کننده‌ها' },
  { id: 'invoices',  href: './invoices.html',  label: 'فاکتورها' },
  { id: 'payments',  href: './payments.html',  label: 'پرداخت‌ها' },
  { id: 'checks',    href: './checks.html',    label: 'چک‌ها' },
  { id: 'visits',    href: './visits.html',    label: 'ویزیت' },
  { id: 'prospects', href: './prospects.html', label: 'ارزیابی مغازه' },
  { id: 'reports',   href: './reports.html',   label: 'گزارش‌ها' },
  { id: 'settings',  href: './settings.html',  label: 'تنظیمات' },
];

/** Primary mobile bottom bar (5 items). */
const BOTTOM_NAV_ITEMS = [
  {
    id: 'dashboard',
    href: './index.html',
    label: 'داشبورد',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 10v10h14V10"/></svg>'
  },
  {
    id: 'customers',
    href: './customers.html',
    label: 'مشتریان',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  },
  {
    id: 'products',
    href: './products.html',
    label: 'اجناس',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5"/><path d="M12 22V12"/></svg>'
  },
  {
    id: 'invoices',
    href: './invoices.html',
    label: 'فاکتورها',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>'
  },
  {
    id: 'more',
    href: '#more',
    label: 'بیشتر',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>'
  },
];

/** Secondary destinations opened from «بیشتر». */
const MORE_NAV_ITEMS = [
  { id: 'inventory', href: './inventory.html', label: 'انبار' },
  { id: 'suppliers', href: './suppliers.html', label: 'تأمین‌کنندگان' },
  { id: 'payments',  href: './payments.html',  label: 'پرداخت‌ها' },
  { id: 'checks',    href: './checks.html',    label: 'چک‌ها' },
  { id: 'visits',    href: './visits.html',    label: 'ویزیت مشتریان' },
  { id: 'reports',   href: './reports.html',   label: 'گزارش‌ها' },
  { id: 'settings',  href: './settings.html',  label: 'تنظیمات و Backup' },
  { id: 'prospects', href: './prospects.html', label: 'ارزیابی مغازه‌ها' },
];

function renderSharedNav(activeId){
  const nav = document.getElementById('nav');
  if(!nav) return;
  nav.innerHTML = NAV_ITEMS.map(t => {
    const active = t.id === activeId ? ' active' : '';
    return `<a class="nav-link${active}" href="${t.href}">${t.label}</a>`;
  }).join('');
  nav.setAttribute('aria-label', 'منوی بالای صفحه');
}

function ensureBottomNavDOM(){
  if(!document.getElementById('bottom-nav')){
    const bar = document.createElement('nav');
    bar.id = 'bottom-nav';
    bar.className = 'bottom-nav';
    bar.setAttribute('aria-label', 'منوی پایین');
    document.body.appendChild(bar);
  }
  if(!document.getElementById('more-sheet-root')){
    const root = document.createElement('div');
    root.id = 'more-sheet-root';
    root.innerHTML = `
      <div class="more-overlay" id="more-overlay" hidden></div>
      <div class="more-sheet" id="more-sheet" hidden role="dialog" aria-modal="true" aria-label="منوی بیشتر">
        <div class="more-sheet-handle"></div>
        <div class="more-sheet-title">بیشتر</div>
        <div class="more-sheet-list" id="more-sheet-list"></div>
        <button type="button" class="btn secondary more-sheet-close" id="more-sheet-close">بستن</button>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('more-overlay').addEventListener('click', closeMoreSheet);
    document.getElementById('more-sheet-close').addEventListener('click', closeMoreSheet);
  }
}

function isMoreSectionActive(activeId){
  return MORE_NAV_ITEMS.some(t => t.id === activeId);
}


/**
 * Keep #bottom-nav pinned to the visible bottom of the screen.
 * On mobile browsers the visual viewport moves when the URL bar shows/hides;
 * position:fixed alone then appears to float mid-page. Adjust `bottom` by the
 * gap between layout viewport bottom and visual viewport bottom.
 * Presentation only — does not touch CRM data or navigation destinations.
 */
function pinBottomNav(){
  const el = document.getElementById('bottom-nav');
  if(!el) return;
  try{
    if(window.visualViewport){
      const vv = window.visualViewport;
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty('bottom', gap + 'px', 'important');
    }else{
      el.style.setProperty('bottom', '0px', 'important');
    }
  }catch(e){
    /* ignore — bar still uses CSS bottom:0 */
  }
}

function ensureBottomNavPinned(){
  if(ensureBottomNavPinned._bound) return;
  ensureBottomNavPinned._bound = true;
  let ticking = false;
  function schedule(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      ticking = false;
      pinBottomNav();
    });
  }
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('scroll', schedule, {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', schedule, {passive:true});
    window.visualViewport.addEventListener('scroll', schedule, {passive:true});
  }
  // orientation / pageshow after bfcache
  window.addEventListener('pageshow', schedule, {passive:true});
  window.addEventListener('orientationchange', function(){
    setTimeout(schedule, 50);
  }, {passive:true});
}

function renderBottomNav(activeId){
  ensureBottomNavDOM();
  const bar = document.getElementById('bottom-nav');
  if(!bar) return;
  const moreActive = isMoreSectionActive(activeId);
  bar.innerHTML = BOTTOM_NAV_ITEMS.map(t => {
    let active = false;
    if(t.id === 'more') active = moreActive;
    else active = t.id === activeId;
    const cls = 'bottom-nav-item' + (active ? ' active' : '');
    if(t.id === 'more'){
      return `<button type="button" class="${cls}" data-bottom-more="1" aria-label="بیشتر">
        <span class="bn-ico">${t.icon}</span>
        <span class="bn-label">${t.label}</span>
      </button>`;
    }
    return `<a class="${cls}" href="${t.href}">
      <span class="bn-ico">${t.icon}</span>
      <span class="bn-label">${t.label}</span>
    </a>`;
  }).join('');

  const moreBtn = bar.querySelector('[data-bottom-more]');
  if(moreBtn){
    moreBtn.addEventListener('click', function(e){
      e.preventDefault();
      openMoreSheet(activeId);
    });
  }

  // Fill more sheet list
  const list = document.getElementById('more-sheet-list');
  if(list){
    list.innerHTML = MORE_NAV_ITEMS.map(t => {
      const active = t.id === activeId ? ' active' : '';
      return `<a class="more-sheet-item${active}" href="${t.href}">${t.label}</a>`;
    }).join('');
  }

  ensureBottomNavPinned();
  pinBottomNav();
}

function openMoreSheet(activeId){
  ensureBottomNavDOM();
  const overlay = document.getElementById('more-overlay');
  const sheet = document.getElementById('more-sheet');
  if(!overlay || !sheet) return;
  const list = document.getElementById('more-sheet-list');
  if(list){
    list.innerHTML = MORE_NAV_ITEMS.map(t => {
      const active = t.id === activeId ? ' active' : '';
      return `<a class="more-sheet-item${active}" href="${t.href}">${t.label}</a>`;
    }).join('');
  }
  overlay.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    sheet.classList.add('show');
  });
  document.body.classList.add('more-open');
}

function closeMoreSheet(){
  const overlay = document.getElementById('more-overlay');
  const sheet = document.getElementById('more-sheet');
  if(overlay){ overlay.classList.remove('show'); }
  if(sheet){ sheet.classList.remove('show'); }
  document.body.classList.remove('more-open');
  setTimeout(() => {
    if(overlay) overlay.hidden = true;
    if(sheet) sheet.hidden = true;
  }, 200);
}


/** In-app Back: history.back when same-origin referrer, else Dashboard. Navigation only. */
function canAppHistoryBack(){
  try{
    const ref = document.referrer || '';
    if(!ref) return false;
    const u = new URL(ref);
    return u.origin === location.origin;
  }catch(e){
    return false;
  }
}

function goAppBack(e){
  if(e && typeof e.preventDefault === 'function') e.preventDefault();
  // Never submit forms / never write data — pure navigation
  if(canAppHistoryBack() && window.history.length > 1){
    window.history.back();
    return;
  }
  location.href = './index.html';
}

/**
 * Inject a compact Back control into <header> on internal pages.
 * Skipped on dashboard (index).
 */
function ensureAppBackButton(activeId){
  const header = document.querySelector('header');
  if(!header) return;

  const existing = header.querySelector('.app-back');
  const isDash = !activeId || activeId === 'dashboard' ||
    /(?:^|\/)index\.html(?:$|\?)/i.test(location.pathname) ||
    document.body.classList.contains('page-dashboard');

  if(isDash){
    if(existing) existing.remove();
    header.classList.remove('has-back');
    return;
  }

  if(existing){
    // already bound once
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-back';
  btn.setAttribute('aria-label', 'بازگشت');
  btn.innerHTML = '<span class="app-back-ico" aria-hidden="true">›</span><span class="app-back-txt">بازگشت</span>';
  btn.addEventListener('click', goAppBack);
  header.insertBefore(btn, header.firstChild);
  header.classList.add('has-back');
}

function getQueryParam(name){
  try{
    return new URLSearchParams(window.location.search).get(name);
  }catch(e){
    return null;
  }
}

/** Load IndexedDB data, draw shared + bottom nav, then run page callback. */
async function bootPage(activeId, afterLoad){
  try{
    /* PIN gate (minimal): unlock before any CRM render. Does not touch data/FIFO. */
    try{
      var pinConfigured = false;
      try{ pinConfigured = !!(localStorage.getItem('baqeri_pin_lock_v1')); }catch(_e){}
      if(pinConfigured){
        if(!window.pinLock || typeof window.pinLock.ensureUnlocked !== 'function'){
          document.body.innerHTML = '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">قفل PIN فعال است اما ماژول قفل بارگذاری نشد. صفحه را دوباره باز کنید.</div>';
          return;
        }
        await window.pinLock.ensureUnlocked();
      } else if(window.pinLock && typeof window.pinLock.ensureUnlocked === 'function'){
        await window.pinLock.ensureUnlocked();
      }
    }catch(pinErr){
      console.error('pin lock gate failed', pinErr);
      document.body.innerHTML = '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">خطا در قفل PIN. صفحه را دوباره باز کنید.</div>';
      return;
    }
    await loadData();
    renderSharedNav(activeId);
    renderBottomNav(activeId);
    ensureAppBackButton(activeId);
    if(typeof afterLoad === 'function'){
      await afterLoad();
    }
  }catch(e){
    console.error('bootPage failed', e);
    if(typeof showToast === 'function'){
      showToast('خطا در بارگذاری اطلاعات');
    }
    const main = document.getElementById('main');
    if(main){
      main.innerHTML = `<div class="empty">خطا در بارگذاری اطلاعات. صفحه را دوباره باز کنید.</div>`;
    }
  }
}

function pageShellNote(title, detail){
  return `
    <h2 class="section-title">${title}</h2>
    <div class="page-skeleton-note">
      ${detail || 'این صفحه در مرحله ۱ فقط اسکلت معماری است. امکانات کامل در مراحل بعد منتقل می‌شوند.'}
    </div>
  `;
}
