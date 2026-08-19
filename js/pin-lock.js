/* pin-lock.js — UI PIN lock for CRM entry (independent of CRM data).
 * Stores only salted hash in localStorage. Never touches IndexedDB / data / backup.
 * Offline-only. No external APIs.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'baqeri_pin_lock_v1';
  var ATTEMPTS_KEY = 'baqeri_pin_attempts_v1';
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
      '#pin-lock-overlay{position:fixed;inset:0;z-index:99999;background:#0B1F3A;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Tahoma,sans-serif;}' +
      '#pin-lock-overlay[hidden]{display:none !important;}' +
      '#pin-lock-overlay .pin-box{width:100%;max-width:320px;background:#fff;border-radius:16px;padding:22px 18px 18px;box-shadow:0 12px 40px rgba(0,0,0,.35);text-align:center;}' +
      '#pin-lock-overlay .pin-title{font-size:1.05rem;font-weight:800;color:#0B1F3A;margin:0 0 6px;}' +
      '#pin-lock-overlay .pin-sub{font-size:.78rem;color:#6A7383;margin:0 0 14px;line-height:1.5;}' +
      '#pin-lock-overlay .pin-input{width:100%;box-sizing:border-box;font-size:1.4rem;letter-spacing:.35em;text-align:center;padding:12px 10px;border:1.5px solid #E2E7EE;border-radius:12px;font-family:inherit;min-height:48px;}' +
      '#pin-lock-overlay .pin-input:focus{outline:none;border-color:#20A879;box-shadow:0 0 0 3px #E7F6F0;}' +
      '#pin-lock-overlay .pin-err{color:#E04545;font-size:.8rem;font-weight:700;min-height:1.2em;margin:10px 0 0;}' +
      '#pin-lock-overlay .pin-btn{width:100%;margin-top:12px;padding:12px;border:none;border-radius:12px;background:#20A879;color:#fff;font-weight:800;font-size:.92rem;font-family:inherit;min-height:48px;cursor:pointer;}' +
      '#pin-lock-overlay .pin-btn:disabled{opacity:.45;cursor:not-allowed;}' +
      '#pin-lock-overlay .pin-cover-only{color:#fff;font-size:.95rem;font-weight:700;text-align:center;}';
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
    overlayEl.innerHTML =
      '<div class="pin-box" dir="rtl">' +
        '<div class="pin-title">ورود با PIN</div>' +
        '<div class="pin-sub">کد شش‌رقمی را وارد کنید</div>' +
        '<input class="pin-input" id="pin-lock-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="pin-err" id="pin-lock-err"></div>' +
        '<button type="button" class="pin-btn" id="pin-lock-submit">ورود</button>' +
      '</div>';

    var input = document.getElementById('pin-lock-input');
    var err = document.getElementById('pin-lock-err');
    var btn = document.getElementById('pin-lock-submit');

    function setErr(msg) {
      if (err) err.textContent = msg || '';
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
      if (btn) btn.disabled = false;
      if (input) input.disabled = false;
      return false;
    }

    if (lockLeft > 0) applyLockoutState();

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
          isUnlocked = true;
          hideOverlay();
          resolveWaiters();
        } else {
          recordFailedAttempt();
          setErr('PIN نادرست است');
          if (input) {
            input.value = '';
            try { input.focus(); } catch (e) {}
          }
          applyLockoutState();
          if (btn && remainingLockMs() <= 0) btn.disabled = false;
        }
      }).catch(function () {
        setErr('خطا در بررسی PIN');
        if (btn) btn.disabled = false;
      });
    }

    if (btn) btn.addEventListener('click', trySubmit);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          trySubmit();
        }
      });
      setTimeout(function () {
        try { input.focus(); } catch (e) {}
      }, 50);
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
      isUnlocked = true;
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
      isUnlocked = true;
      hideOverlay();
      return true;
    });
  }

  function lock() {
    if (!isPinSet()) return;
    isUnlocked = false;
    /* Cover immediately so iOS App Switcher snapshot is less likely to show CRM */
    showCoverOnly();
  }

  function ensureUnlocked() {
    if (!isPinSet()) {
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

  function bindLifecycle() {
    if (listenersBound) return;
    listenersBound = true;

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' || document.hidden) {
        lock();
      } else if (document.visibilityState === 'visible') {
        if (isPinSet() && !isUnlocked) {
          showUnlockUI();
        }
      }
    });

    window.addEventListener('pagehide', function () {
      lock();
    });

    window.addEventListener('pageshow', function () {
      if (isPinSet() && !isUnlocked) {
        showUnlockUI();
      }
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

  /* If PIN already set on cold start, cover immediately before boot paints CRM */
  if (isPinSet()) {
    isUnlocked = false;
    if (document.body) {
      showCoverOnly();
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        if (!isUnlocked && isPinSet()) showCoverOnly();
      });
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
