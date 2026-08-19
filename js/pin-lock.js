/* pin-lock.js — UI PIN lock for CRM entry (independent of CRM data).
 * Stores only salted hash in localStorage. Never touches IndexedDB / data / backup.
 * Offline-only. No external APIs.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'baqeri_pin_lock_v1';
  var ATTEMPTS_KEY = 'baqeri_pin_attempts_v1';
  /* Session unlock survives multi-page navigations inside the app (same tab).
     Cleared only on real background / Lock Now / process kill. */
  var SESSION_UNLOCK_KEY = 'baqeri_pin_session_ok';
  var HIDDEN_AT_KEY = 'baqeri_pin_hidden_at';
  /* Gaps shorter than this are treated as in-app navigation, not real leave. */
  var BACKGROUND_LOCK_MS = 2500;
  var MAX_ATTEMPTS_BEFORE_DELAY = 5;
  var DELAY_MS = 30000;

  var isUnlocked = false;
  var unlockWaiters = [];
  var overlayEl = null;
  var listenersBound = false;

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.salt || !o.hash) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function writeStore(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  }

  function clearStore() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    try { localStorage.removeItem(ATTEMPTS_KEY); } catch (e) {}
  }

  function isPinSet() {
    return !!readStore();
  }

  function hasSessionUnlock() {
    try { return sessionStorage.getItem(SESSION_UNLOCK_KEY) === '1'; } catch (e) { return false; }
  }

  function markSessionUnlocked() {
    try { sessionStorage.setItem(SESSION_UNLOCK_KEY, '1'); } catch (e) {}
    try { sessionStorage.removeItem(HIDDEN_AT_KEY); } catch (e) {}
    isUnlocked = true;
  }

  function clearSessionUnlocked() {
    try { sessionStorage.removeItem(SESSION_UNLOCK_KEY); } catch (e) {}
    isUnlocked = false;
  }

  function bytesToHex(buf) {
    var a = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < a.length; i++) {
      var h = a[i].toString(16);
      s += h.length === 1 ? '0' + h : h;
    }
    return s;
  }

  function randomSaltHex() {
    var a = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(a);
    } else {
      for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    }
    return bytesToHex(a);
  }

  function sha256Hex(str) {
    if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
      return Promise.reject(new Error('Web Crypto در دسترس نیست'));
    }
    var enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(str)).then(function (buf) {
      return bytesToHex(buf);
    });
  }

  function hashPin(pin, salt) {
    return sha256Hex(String(pin) + String(salt));
  }

  function normalizePin(v) {
    return String(v || '').replace(/\D/g, '').slice(0, 6);
  }

  function isValidPinFormat(pin) {
    return /^\d{6}$/.test(pin);
  }

  function readAttempts() {
    try {
      var o = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}');
      return {
        count: Number(o.count) || 0,
        lockUntil: Number(o.lockUntil) || 0
      };
    } catch (e) {
      return { count: 0, lockUntil: 0 };
    }
  }

  function writeAttempts(o) {
    try {
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(o));
    } catch (e) {}
  }

  function remainingLockMs() {
    var a = readAttempts();
    var left = a.lockUntil - Date.now();
    return left > 0 ? left : 0;
  }

  function recordFailedAttempt() {
    var a = readAttempts();
    a.count = (a.count || 0) + 1;
    if (a.count >= MAX_ATTEMPTS_BEFORE_DELAY) {
      a.lockUntil = Date.now() + DELAY_MS;
      a.count = 0;
    }
    writeAttempts(a);
  }

  function clearAttempts() {
    try { localStorage.removeItem(ATTEMPTS_KEY); } catch (e) {}
  }

  function resolveWaiters() {
    var list = unlockWaiters.slice();
    unlockWaiters = [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (e) {}
    }
  }

  function ensureOverlayCss() {
    if (document.getElementById('pin-lock-style')) return;
    var st = document.createElement('style');
    st.id = 'pin-lock-style';
    st.textContent =
      '#pin-lock-overlay{position:fixed;inset:0;z-index:99999;background:#0B1F3A;display:flex;align-items:center;justify-content:center;padding:20px;' +
        'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Tahoma,sans-serif;-webkit-font-smoothing:antialiased;}' +
      '#pin-lock-overlay[hidden]{display:none !important;}' +
      '#pin-lock-overlay .pin-box{width:100%;max-width:340px;background:#fff;border-radius:20px;padding:28px 20px 22px;' +
        'box-shadow:0 16px 48px rgba(0,0,0,.28);text-align:center;}' +
      '#pin-lock-overlay .pin-lock-icon{width:44px;height:44px;margin:0 auto 14px;border-radius:12px;background:#E7F6F0;' +
        'display:flex;align-items:center;justify-content:center;color:#20A879;font-size:1.25rem;}' +
      '#pin-lock-overlay .pin-title{font-size:1.1rem;font-weight:800;color:#0B1F3A;margin:0 0 6px;letter-spacing:-0.01em;}' +
      '#pin-lock-overlay .pin-sub{font-size:.8rem;color:#6A7383;margin:0 0 20px;line-height:1.55;}' +
      '#pin-lock-overlay .pin-cells-wrap{position:relative;margin:0 auto 4px;max-width:280px;}' +
      '#pin-lock-overlay .pin-cells{display:flex;gap:8px;justify-content:center;direction:ltr;}' +
      '#pin-lock-overlay .pin-cell{width:40px;height:48px;border-radius:12px;border:1.5px solid #E2E7EE;background:#F7F9FC;' +
        'display:flex;align-items:center;justify-content:center;font-size:1.25rem;font-weight:700;color:#0B1F3A;' +
        'transition:border-color .15s ease, background .15s ease, box-shadow .15s ease, transform .12s ease;}' +
      '#pin-lock-overlay .pin-cell.filled{border-color:#C5E8DA;background:#F0FAF6;}' +
      '#pin-lock-overlay .pin-cell.active{border-color:#20A879;background:#fff;box-shadow:0 0 0 3px #E7F6F0;transform:scale(1.06);}' +
      '#pin-lock-overlay .pin-cell .dot{width:10px;height:10px;border-radius:50%;background:#0B1F3A;display:inline-block;}' +
      '#pin-lock-overlay .pin-cell .digit{opacity:1;transition:opacity .2s ease;}' +
      '#pin-lock-overlay .pin-input-real{position:absolute;inset:0;width:100%;height:100%;opacity:0.02;border:0;background:transparent;' +
        'color:transparent;caret-color:transparent;font-size:16px;z-index:2;}' +
      '#pin-lock-overlay .pin-err{color:#E04545;font-size:.8rem;font-weight:700;min-height:1.25em;margin:12px 0 0;}' +
      '#pin-lock-overlay .pin-btn{width:100%;margin-top:14px;padding:14px;border:none;border-radius:14px;background:#20A879;color:#fff;' +
        'font-weight:800;font-size:.95rem;font-family:inherit;min-height:50px;cursor:pointer;' +
        'transition:opacity .15s ease, background .15s ease, transform .1s ease;}' +
      '#pin-lock-overlay .pin-btn:disabled{opacity:.4;cursor:not-allowed;background:#9AA3B2;}' +
      '#pin-lock-overlay .pin-btn:not(:disabled):active{transform:scale(0.98);}' +
      '#pin-lock-overlay .pin-box.shake{animation:pinShake .4s ease;}' +
      '@keyframes pinShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}' +
      '#pin-lock-overlay .pin-cover-only{color:#fff;font-size:1rem;font-weight:700;text-align:center;opacity:.9;}';
    document.head.appendChild(st);
  }

  function showCoverOnly() {
    ensureOverlayCss();
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'pin-lock-overlay';
      document.body.appendChild(overlayEl);
    }
    overlayEl.hidden = false;
    overlayEl.innerHTML = '<div class="pin-cover-only">قفل</div>';
  }

  function showUnlockUI() {
    ensureOverlayCss();
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'pin-lock-overlay';
      document.body.appendChild(overlayEl);
    }
    overlayEl.hidden = false;
    var lockLeft = remainingLockMs();
    var cellsHtml = '';
    for (var ci = 0; ci < 6; ci++) {
      cellsHtml += '<div class="pin-cell" data-i="' + ci + '"></div>';
    }
    overlayEl.innerHTML =
      '<div class="pin-box" id="pin-lock-card" dir="rtl">' +
        '<div class="pin-lock-icon" aria-hidden="true">🔒</div>' +
        '<div class="pin-title">ورود با PIN</div>' +
        '<div class="pin-sub">کد شش‌رقمی را وارد کنید</div>' +
        '<div class="pin-cells-wrap">' +
          '<div class="pin-cells" id="pin-lock-cells">' + cellsHtml + '</div>' +
          '<input class="pin-input-real" id="pin-lock-input" type="tel" inputmode="numeric" pattern="[0-9]*" ' +
            'maxlength="6" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" enterkeyhint="done">' +
        '</div>' +
        '<div class="pin-err" id="pin-lock-err"></div>' +
        '<button type="button" class="pin-btn" id="pin-lock-submit" disabled>ورود</button>' +
      '</div>';

    var input = document.getElementById('pin-lock-input');
    var err = document.getElementById('pin-lock-err');
    var btn = document.getElementById('pin-lock-submit');
    var cells = overlayEl.querySelectorAll('.pin-cell');
    var card = document.getElementById('pin-lock-card');
    var revealTimers = [];

    function setErr(msg) {
      if (err) err.textContent = msg || '';
    }

    function clearRevealTimers() {
      for (var t = 0; t < revealTimers.length; t++) {
        try { clearTimeout(revealTimers[t]); } catch (e) {}
      }
      revealTimers = [];
    }

    function paintCells(pin, opts) {
      opts = opts || {};
      var len = pin.length;
      for (var i = 0; i < 6; i++) {
        var cell = cells[i];
        if (!cell) continue;
        cell.className = 'pin-cell';
        if (i < len) cell.classList.add('filled');
        if (i === len && len < 6) cell.classList.add('active');
        cell.innerHTML = '';
        if (i < len) {
          if (opts.revealIndex === i) {
            cell.innerHTML = '<span class="digit">' + pin.charAt(i) + '</span>';
          } else {
            cell.innerHTML = '<span class="dot"></span>';
          }
        }
      }
      if (btn && remainingLockMs() <= 0) {
        btn.disabled = len !== 6;
      }
    }

    function applyLockoutState() {
      var left = remainingLockMs();
      if (left > 0) {
        var sec = Math.ceil(left / 1000);
        setErr('لطفاً ' + sec + ' ثانیه صبر کنید');
        if (btn) btn.disabled = true;
        if (input) input.disabled = true;
        setTimeout(function () {
          if (!isUnlocked) applyLockoutState();
        }, Math.min(left, 1000));
        return true;
      }
      if (input) input.disabled = false;
      var pinNow = normalizePin(input && input.value);
      if (btn) btn.disabled = pinNow.length !== 6;
      return false;
    }

    if (lockLeft > 0) applyLockoutState();
    else paintCells('');

    function trySubmit() {
      if (applyLockoutState()) return;
      var pin = normalizePin(input && input.value);
      if (!isValidPinFormat(pin)) {
        setErr('PIN باید ۶ رقم باشد');
        return;
      }
      if (btn) btn.disabled = true;
      verifyPin(pin).then(function (ok) {
        if (ok) {
          clearAttempts();
          markSessionUnlocked();
          hideOverlay();
          resolveWaiters();
        } else {
          recordFailedAttempt();
          setErr('PIN نادرست است');
          clearRevealTimers();
          if (input) {
            input.value = '';
            paintCells('');
            try { input.focus(); } catch (e) {}
          }
          if (card) {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
          }
          applyLockoutState();
        }
      }).catch(function () {
        setErr('خطا در بررسی PIN');
        if (btn) btn.disabled = false;
      });
    }

    function onInput() {
      if (applyLockoutState()) return;
      var pin = normalizePin(input.value);
      if (input.value !== pin) input.value = pin;
      setErr('');
      clearRevealTimers();
      var last = pin.length - 1;
      paintCells(pin, { revealIndex: last >= 0 ? last : -1 });
      if (last >= 0) {
        revealTimers.push(setTimeout(function () {
          paintCells(normalizePin(input.value), {});
        }, 280));
      }
      if (pin.length === 6) {
        /* auto-submit after short beat so last digit can flash */
        revealTimers.push(setTimeout(function () {
          if (normalizePin(input.value).length === 6 && !isUnlocked) trySubmit();
        }, 120));
      }
    }

    if (btn) btn.addEventListener('click', trySubmit);
    if (input) {
      input.addEventListener('input', onInput);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          trySubmit();
        }
      });
      /* tap cells → focus real input (helps iOS) */
      if (cells && cells.length) {
        for (var k = 0; k < cells.length; k++) {
          cells[k].addEventListener('click', function () {
            try { input.focus(); } catch (e) {}
          });
        }
      }
      setTimeout(function () {
        try { input.focus(); } catch (e) {}
      }, 80);
    }
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.hidden = true;
  }

  function verifyPin(pin) {
    var store = readStore();
    if (!store) return Promise.resolve(true);
    return hashPin(pin, store.salt).then(function (h) {
      return h === store.hash;
    });
  }

  function setPin(pin) {
    pin = normalizePin(pin);
    if (!isValidPinFormat(pin)) return Promise.reject(new Error('PIN باید ۶ رقم باشد'));
    var salt = randomSaltHex();
    return hashPin(pin, salt).then(function (hash) {
      writeStore({ v: 1, salt: salt, hash: hash });
      clearAttempts();
      markSessionUnlocked();
      return true;
    });
  }

  function changePin(oldPin, newPin) {
    oldPin = normalizePin(oldPin);
    newPin = normalizePin(newPin);
    if (!isValidPinFormat(newPin)) return Promise.reject(new Error('PIN جدید باید ۶ رقم باشد'));
    return verifyPin(oldPin).then(function (ok) {
      if (!ok) return Promise.reject(new Error('PIN فعلی نادرست است'));
      return setPin(newPin);
    });
  }

  function clearPin(currentPin) {
    currentPin = normalizePin(currentPin);
    if (!isPinSet()) {
      clearStore();
      return Promise.resolve(true);
    }
    return verifyPin(currentPin).then(function (ok) {
      if (!ok) return Promise.reject(new Error('PIN فعلی نادرست است'));
      clearStore();
      markSessionUnlocked();
      hideOverlay();
      return true;
    });
  }

  function lock() {
    if (!isPinSet()) return;
    /* Explicit lock (Lock Now) or confirmed long background — end session unlock */
    clearSessionUnlocked();
    /* Cover immediately so iOS App Switcher snapshot is less likely to show CRM */
    showCoverOnly();
  }

  function ensureUnlocked() {
    if (!isPinSet()) {
      isUnlocked = true;
      hideOverlay();
      return Promise.resolve();
    }
    /* Restore unlock across multi-page navigations in the same browser session */
    if (hasSessionUnlock()) {
      isUnlocked = true;
      hideOverlay();
      return Promise.resolve();
    }
    if (isUnlocked) {
      hideOverlay();
      return Promise.resolve();
    }
    showUnlockUI();
    return new Promise(function (resolve) {
      unlockWaiters.push(resolve);
    });
  }

  function onPossiblyReturnedFromBackground() {
    if (!isPinSet()) return;
    var hiddenAt = 0;
    try { hiddenAt = Number(sessionStorage.getItem(HIDDEN_AT_KEY) || 0) || 0; } catch (e) {}
    try { sessionStorage.removeItem(HIDDEN_AT_KEY); } catch (e) {}
    var elapsed = hiddenAt ? (Date.now() - hiddenAt) : 0;
    /* Short gap ≈ in-app page change; long gap ≈ Home / app switch / lock screen */
    if (elapsed >= BACKGROUND_LOCK_MS) {
      clearSessionUnlocked();
    } else if (hasSessionUnlock()) {
      isUnlocked = true;
    }
    if (!isUnlocked && !hasSessionUnlock()) {
      showUnlockUI();
    } else {
      hideOverlay();
    }
  }

  function bindLifecycle() {
    if (listenersBound) return;
    listenersBound = true;

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' || document.hidden) {
        try { sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now())); } catch (e) {}
        /* Cover for snapshot only — do NOT clear session here (in-app nav also goes hidden) */
        if (isPinSet()) showCoverOnly();
      } else if (document.visibilityState === 'visible') {
        onPossiblyReturnedFromBackground();
      }
    });

    /* pagehide: cover for snapshot; do not clear session (fires on every internal link) */
    window.addEventListener('pagehide', function () {
      try { sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now())); } catch (e) {}
      if (isPinSet()) showCoverOnly();
    });

    window.addEventListener('pageshow', function () {
      onPossiblyReturnedFromBackground();
    });
  }

  /**
   * Fail-closed helper for boot when script is missing elsewhere:
   * if storage says PIN is set but this module never loaded, boot should stop.
   * Exported so nav can call pinLock.isPinSet even if only partial load — here always true module.
   */
  function pinIsConfiguredInStorage() {
    return isPinSet();
  }

  bindLifecycle();

  /* Cold start / new page: honor session unlock so in-app navigation does not re-ask PIN */
  if (isPinSet()) {
    if (hasSessionUnlock()) {
      isUnlocked = true;
    } else {
      isUnlocked = false;
      if (document.body) {
        showCoverOnly();
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          if (!isUnlocked && isPinSet() && !hasSessionUnlock()) showCoverOnly();
        });
      }
    }
  }

  window.pinLock = {
    isPinSet: isPinSet,
    isUnlocked: function () { return isUnlocked; },
    ensureUnlocked: ensureUnlocked,
    lock: lock,
    setPin: setPin,
    changePin: changePin,
    clearPin: clearPin,
    pinIsConfiguredInStorage: pinIsConfiguredInStorage
  };
})();
