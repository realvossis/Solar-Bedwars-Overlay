'use strict';
const api = window.solarBridge;

api.appInfo().then((i) => { document.getElementById('ver').textContent = 'v' + i.version; }).catch(() => {});

// Total on-screen time before handing off to the overlay; matches the CSS timings in splash.css.
const HOLD_MS = 2300;
const FADE_MS = 350;

setTimeout(() => {
  document.getElementById('card').classList.add('leaving');
  setTimeout(() => api.splashDone(), FADE_MS);
}, HOLD_MS);
