/* ui.js — shared UI helpers (toast, modal/sheet, formatting)
   Phase 0 extract: no logic changes.
*/
// ---------- small utilities ----------
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function faToEnDigits(str){
  if(str===null || str===undefined) return '';
  const map = {'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
               '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
               '٫':'.','،':'','٬':'',',':''};
  // ارقام فارسی/عربی + جداکننده‌های هزار (٬ و ,) و اعشار فارسی
  return String(str).replace(/[۰-۹٠-٩٫،٬,]/g, ch=>map[ch]!==undefined?map[ch]:ch);
}
function enToFaDigits(str){
  const map = {'0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹'};
  return String(str).replace(/[0-9]/g, ch=>map[ch]||ch);
}
function numVal(el){
  if(!el) return 0;
  // faToEnDigits جداکننده‌ها را حذف می‌کند تا parseFloat روی "4,000,000" مقدار 4000000 بدهد
  return parseFloat(faToEnDigits(el.value))||0;
}

/**
 * فرمت زنده مبلغ هنگام تایپ: جداکننده سه‌رقمی، حفظ سبک رقم (فارسی/انگلیسی).
 * فقط رشته نمایش را می‌سازد؛ مقدار عددی از طریق numVal/faToEnDigits خوانده می‌شود.
 */
function formatLiveAmount(str){
  if(str===null || str===undefined) return '';
  const raw = String(str);
  if(!raw) return '';
  const preferFa = /[۰-۹]/.test(raw);
  let cleaned = faToEnDigits(raw).replace(/[^\d.]/g, '');
  if(!cleaned) return '';
  const dot = cleaned.indexOf('.');
  let intPart = dot >= 0 ? cleaned.slice(0, dot) : cleaned;
  let fracPart = dot >= 0 ? cleaned.slice(dot + 1).replace(/\./g, '') : null;
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if(intPart === '' && fracPart !== null) intPart = '0';
  if(intPart === '') return '';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = fracPart !== null ? (grouped + '.' + fracPart) : grouped;
  if(preferFa) out = enToFaDigits(out).replace(/,/g, '٬');
  return out;
}

/** تعداد ارقام (و نقطه اعشار) قبل از موقعیت cursor برای حفظ محل مکان‌نما */
function _countNumericChars(str){
  return faToEnDigits(str).replace(/[^\d.]/g, '').length;
}

function reformatAmountInputEl(el){
  if(!el || el.tagName !== 'INPUT') return;
  const oldVal = el.value;
  const sel = (typeof el.selectionStart === 'number') ? el.selectionStart : oldVal.length;
  const digitsBefore = _countNumericChars(oldVal.slice(0, sel));
  const formatted = formatLiveAmount(oldVal);
  if(formatted === oldVal) return;
  el.value = formatted;
  // مکان‌نما را بعد از همان تعداد رقم قرار بده
  let pos = formatted.length;
  let seen = 0;
  for(let i = 0; i < formatted.length; i++){
    if(/[\d۰-۹٠-٩.]/.test(formatted[i])){
      seen++;
      if(seen >= digitsBefore){
        pos = i + 1;
        break;
      }
    }
  }
  try{ el.setSelectionRange(pos, pos); }catch(e){}
}

/** آیا این input باید فرمت مبلغ زنده بگیرد؟ */
function isLiveAmountInput(el){
  if(!el || el.tagName !== 'INPUT') return false;
  if(el.type === 'date' || el.type === 'time' || el.type === 'checkbox' || el.type === 'file') return false;
  if(el.getAttribute('inputmode') !== 'decimal') return false;
  // فیلدهای تعداد/موجودی/وزن را فرمت مبلغی نکن (جداکننده روی qty معمولاً لازم نیست و ریسک UX دارد)
  const id = (el.id || '').toLowerCase();
  const cls = (el.className && String(el.className)) || '';
  if(/qty|stock|minstock|pkgw|weight|adjust/.test(id)) return false;
  if(/\b(row-qty|ret-qty|mi-qty)\b/.test(cls)) return false;
  return true;
}

// یک‌بار روی document: فرمت هنگام تایپ برای inputهای مبلغ (بدون نیاز به تغییر app.js)
(function bindLiveAmountFormatting(){
  function onInput(e){
    const el = e.target;
    if(!isLiveAmountInput(el)) return;
    reformatAmountInputEl(el);
  }
  if(typeof document !== 'undefined'){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', function(){
        document.addEventListener('input', onInput, true);
      });
    }else{
      document.addEventListener('input', onInput, true);
    }
  }
})();
function esc(s){
  return String(s===undefined||s===null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toman(n){ return (Math.round(n||0)).toLocaleString('fa-IR'); }
function balanceStatusWord(balance){
  if(balance>0) return 'بدهکار';
  if(balance<0) return 'بستانکار';
  return 'تسویه شده';
}
function balanceStatusText(balance, amountText){
  return balance===0 ? balanceStatusWord(balance) : (balanceStatusWord(balance)+': '+amountText);
}
/** Local calendar date as YYYY-MM-DD (not UTC — avoids Iran midnight offset). */
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function nowHHMM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

/* ---------- Shamsi/Jalali helpers (UI + period only; storage stays Gregorian YYYY-MM-DD) ---------- */
const SHAMSI_MONTH_NAMES = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

/** Parse YYYY-MM-DD without UTC shift. Returns {y,m,d} or null. */
function parseISODateParts(iso){
  if(!iso) return null;
  const m = String(iso).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if(!(y>=1200 && y<=3500) || !(mo>=1 && mo<=12) || !(d>=1 && d<=31)) return null;
  return { y, m: mo, d };
}
function isoFromParts(y, m, d){
  return y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0');
}

/** Gregorian Y/M/D → Jalali [jy, jm, jd] (standard civil algorithm). */
function gregorianToJalali(gy, gm, gd){
  const g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if(days > 365){
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

/** Jalali Y/M/D → Gregorian [gy, gm, gd]. */
function jalaliToGregorian(jy, jm, jd){
  jy = parseInt(jy, 10); jm = parseInt(jm, 10); jd = parseInt(jd, 10);
  const jy2 = jy + 1595;
  let days = -355668 + (365 * jy2) + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4) + jd
    + ((jm < 7) ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if(days > 36524){
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if(days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if(days > 365){
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [0,31,((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  let gm = 1;
  for(; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

function isJalaliLeap(jy){
  const r = jy % 33;
  return r === 1 || r === 5 || r === 9 || r === 13 || r === 17 || r === 22 || r === 26 || r === 30;
}
function jalaliMonthLength(jy, jm){
  if(jm <= 6) return 31;
  if(jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

/** YYYY-MM-DD → [jy,jm,jd] or null */
function isoToJalali(iso){
  const p = parseISODateParts(iso);
  if(!p) return null;
  return gregorianToJalali(p.y, p.m, p.d);
}
/** jy,jm,jd → YYYY-MM-DD */
function jalaliToISO(jy, jm, jd){
  const g = jalaliToGregorian(+jy, +jm, +jd);
  return isoFromParts(g[0], g[1], g[2]);
}

function faDate(iso){
  if(!iso) return '—';
  // Prefer pure conversion so date-only ISO never shifts via UTC midnight
  const j = isoToJalali(String(iso).slice(0, 10));
  if(j){
    return enToFaDigits(j[0] + '/' + j[1] + '/' + j[2]);
  }
  try{ return new Date(iso).toLocaleDateString('fa-IR'); }catch(e){ return iso; }
}

/**
 * Shamsi month equality for period filters («این ماه»).
 * iso: YYYY-MM-DD string; ref: Date (usually new Date()).
 */
function isSameJalaliMonth(iso, ref){
  const p = parseISODateParts(iso);
  if(!p || !ref || isNaN(ref.getTime())) return false;
  const a = gregorianToJalali(p.y, p.m, p.d);
  const b = gregorianToJalali(ref.getFullYear(), ref.getMonth() + 1, ref.getDate());
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * HTML for a Shamsi date field — single field like native input.
 * Tap opens iOS-style bottom sheet with scroll wheels (Jalali Y/M/D).
 * Hidden input keeps Gregorian YYYY-MM-DD (same id) for existing .value readers.
 * NOTE: Native iOS <input type="date"> cannot use Jalali; this is the closest safe UX.
 */
function shamsiDateInputHTML(id, valueISO){
  const iso = (valueISO && parseISODateParts(valueISO)) ? String(valueISO).slice(0,10) : todayISO();
  const j = isoToJalali(iso) || gregorianToJalali(
    new Date().getFullYear(), new Date().getMonth()+1, new Date().getDate()
  );
  const label = enToFaDigits(j[0] + '/' + j[1] + '/' + j[2]);
  return `<div class="shamsi-date" data-shamsi-root="1">
    <input type="hidden" id="${esc(id)}" value="${esc(iso)}" data-shamsi-hidden="1">
    <input type="text" class="shamsi-date-field" data-shamsi-field="1" readonly inputmode="none" value="${esc(label)}" aria-label="تاریخ شمسی">
  </div>`;
}

function _shamsiPadWheel(col, countBefore){
  // spacer items so first/last can center in the highlight band
  let html = '';
  for(let i = 0; i < countBefore; i++) html += '<div class="shamsi-wheel-item shamsi-wheel-spacer" aria-hidden="true"></div>';
  return html;
}

function _shamsiBuildWheelHTML(part, values, selected, labels){
  // values: array of numbers; labels optional parallel strings
  const spacers = 2;
  let html = _shamsiPadWheel(part, spacers);
  for(let i = 0; i < values.length; i++){
    const v = values[i];
    const lab = labels ? labels[i] : enToFaDigits(String(v));
    const sel = (v === selected) ? ' data-selected="1"' : '';
    html += `<div class="shamsi-wheel-item" data-v="${v}"${sel}>${lab}</div>`;
  }
  html += _shamsiPadWheel(part, spacers);
  return html;
}

function _shamsiItemH(){
  return 36;
}

function _shamsiScrollToValue(col, value){
  if(!col) return;
  const item = col.querySelector('.shamsi-wheel-item[data-v="' + value + '"]');
  if(!item) return;
  const h = _shamsiItemH();
  // center item in column (2 spacers * h offset already in DOM)
  const top = item.offsetTop - (col.clientHeight / 2) + (h / 2);
  col.scrollTop = Math.max(0, top);
}

function _shamsiReadWheel(col){
  if(!col) return null;
  const h = _shamsiItemH();
  const mid = col.scrollTop + col.clientHeight / 2;
  const items = col.querySelectorAll('.shamsi-wheel-item[data-v]');
  let best = null, bestDist = Infinity;
  items.forEach(function(it){
    const c = it.offsetTop + h / 2;
    const d = Math.abs(c - mid);
    if(d < bestDist){ bestDist = d; best = it; }
  });
  if(!best) return null;
  return parseInt(best.getAttribute('data-v'), 10);
}

function _shamsiSnapWheel(col){
  const v = _shamsiReadWheel(col);
  if(v != null) _shamsiScrollToValue(col, v);
  return v;
}

function _shamsiFillDayCol(dayCol, jy, jm, jd){
  const dim = jalaliMonthLength(jy, jm);
  if(jd > dim) jd = dim;
  const vals = [];
  for(let d = 1; d <= dim; d++) vals.push(d);
  dayCol.innerHTML = _shamsiBuildWheelHTML('d', vals, jd, null);
  _shamsiScrollToValue(dayCol, jd);
  return jd;
}

function openShamsiPicker(fieldEl){
  const root = fieldEl.closest('[data-shamsi-root]');
  if(!root) return;
  const hid = root.querySelector('[data-shamsi-hidden]');
  if(!hid) return;
  const iso = hid.value || todayISO();
  const j = isoToJalali(iso) || gregorianToJalali(
    new Date().getFullYear(), new Date().getMonth()+1, new Date().getDate()
  );
  let jy = j[0], jm = j[1], jd = j[2];

  // remove any existing sheet
  const prev = document.getElementById('shamsi-picker-sheet');
  if(prev) prev.remove();

  const yVals = [];
  for(let y = jy + 5; y >= jy - 15; y--) yVals.push(y);
  const mVals = [1,2,3,4,5,6,7,8,9,10,11,12];
  const mLabs = SHAMSI_MONTH_NAMES.slice();

  const overlay = document.createElement('div');
  overlay.id = 'shamsi-picker-sheet';
  overlay.className = 'shamsi-sheet-overlay';
  overlay.innerHTML =
    '<div class="shamsi-sheet" role="dialog" aria-label="انتخاب تاریخ شمسی">' +
      '<div class="shamsi-sheet-toolbar">' +
        '<button type="button" class="shamsi-sheet-btn" data-shamsi-cancel="1">لغو</button>' +
        '<span class="shamsi-sheet-title">تاریخ</span>' +
        '<button type="button" class="shamsi-sheet-btn shamsi-sheet-done" data-shamsi-done="1">تأیید</button>' +
      '</div>' +
      '<div class="shamsi-wheels-wrap">' +
        '<div class="shamsi-wheels-highlight" aria-hidden="true"></div>' +
        '<div class="shamsi-wheels">' +
          '<div class="shamsi-wheel" data-shamsi-wheel="y"></div>' +
          '<div class="shamsi-wheel" data-shamsi-wheel="m"></div>' +
          '<div class="shamsi-wheel" data-shamsi-wheel="d"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  const yCol = overlay.querySelector('[data-shamsi-wheel="y"]');
  const mCol = overlay.querySelector('[data-shamsi-wheel="m"]');
  const dCol = overlay.querySelector('[data-shamsi-wheel="d"]');

  yCol.innerHTML = _shamsiBuildWheelHTML('y', yVals, jy, yVals.map(function(y){ return enToFaDigits(String(y)); }));
  mCol.innerHTML = _shamsiBuildWheelHTML('m', mVals, jm, mLabs);
  _shamsiFillDayCol(dCol, jy, jm, jd);

  // initial scroll after layout
  requestAnimationFrame(function(){
    _shamsiScrollToValue(yCol, jy);
    _shamsiScrollToValue(mCol, jm);
    _shamsiScrollToValue(dCol, jd);
  });

  let scrollTimers = {};
  function onWheelScroll(ev){
    const col = ev.currentTarget;
    const part = col.getAttribute('data-shamsi-wheel');
    clearTimeout(scrollTimers[part]);
    scrollTimers[part] = setTimeout(function(){
      const v = _shamsiSnapWheel(col);
      if(part === 'y' && v != null) jy = v;
      if(part === 'm' && v != null) jm = v;
      if(part === 'd' && v != null) jd = v;
      if(part === 'y' || part === 'm'){
        jd = _shamsiFillDayCol(dCol, jy, jm, jd);
      }
    }, 80);
  }
  yCol.addEventListener('scroll', onWheelScroll, { passive: true });
  mCol.addEventListener('scroll', onWheelScroll, { passive: true });
  dCol.addEventListener('scroll', onWheelScroll, { passive: true });

  function close(){
    overlay.remove();
  }

  function apply(){
    jy = _shamsiSnapWheel(yCol) || jy;
    jm = _shamsiSnapWheel(mCol) || jm;
    jd = _shamsiSnapWheel(dCol) || jd;
    const dim = jalaliMonthLength(jy, jm);
    if(jd > dim) jd = dim;
    const newIso = jalaliToISO(jy, jm, jd);
    const prev = hid.value;
    hid.value = newIso;
    const field = root.querySelector('[data-shamsi-field]');
    if(field) field.value = enToFaDigits(jy + '/' + jm + '/' + jd);
    if(prev !== newIso){
      try{
        hid.dispatchEvent(new Event('input', { bubbles: true }));
        hid.dispatchEvent(new Event('change', { bubbles: true }));
      }catch(e){}
    }
    close();
  }

  overlay.addEventListener('click', function(e){
    if(e.target === overlay) close();
  });
  overlay.querySelector('[data-shamsi-cancel]').addEventListener('click', function(e){
    e.preventDefault(); close();
  });
  overlay.querySelector('[data-shamsi-done]').addEventListener('click', function(e){
    e.preventDefault(); apply();
  });
}

/** Tap on Shamsi date field opens wheel sheet (document delegation). */
(function bindShamsiDateDelegation(){
  if(typeof document === 'undefined') return;
  function onClick(e){
    const t = e.target;
    if(!t || !t.closest) return;
    const field = t.closest('[data-shamsi-field]');
    if(field){
      e.preventDefault();
      openShamsiPicker(field);
    }
  }
  function bind(){
    document.addEventListener('click', onClick, true);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();


function daysAgo(iso){
  if(!iso) return Infinity;
  const p = parseISODateParts(iso);
  if(p){
    const t = new Date(p.y, p.m - 1, p.d).getTime();
    if(!isNaN(t)) return Math.floor((Date.now() - t) / 86400000);
  }
  const d = new Date(iso);
  if(isNaN(d)) return Infinity;
  return Math.floor((Date.now()-d.getTime())/86400000);
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=>t.classList.remove('show'), 2000);
}


// ---------- modals ----------
function closeModal(){
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  if(window.scrollX) window.scrollTo(0, window.scrollY);
}

function openSheet(html){
  const root = document.getElementById('modalRoot');
  // مطمئن شو هر Modal قبلی کاملاً پاک شده (نه فقط مخفی) قبل از ساختن Modal جدید،
  // و یک reflow اجباری بین پاک‌شدن و رندر جدید انجام بده تا ظاهر (گوشه‌های گرد و غیره) بعد از باز/بسته‌شدن‌های مکرر خراب نشه
  closeModal();
  void root.offsetHeight;
  root.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="sheet" style="position:relative;">
        <button class="close-x" id="closeX">×</button>
        ${html}
      </div>
    </div>`;
  document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay') closeModal(); });
  document.getElementById('closeX').addEventListener('click', closeModal);
}

