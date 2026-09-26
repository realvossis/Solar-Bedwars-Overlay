'use strict';
// One consistent icon set (16x16 grid, 1.6px strokes, currentColor) shared by every window, so
// buttons and chips stop mixing random Unicode glyphs. Static trusted markup only.
(function () {
  const s = (body, extra = '') => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
  window.SolarIcons = {
    logo: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><defs><linearGradient id="sl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs><circle cx="12" cy="12" r="5" fill="url(#sl)"/><g stroke="url(#sl)" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>',
    refresh: s('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/>'),
    clear: s('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
    pointer: s('<path d="M4 2.5l8.5 5-3.8 1 2.2 4-1.6.9-2.2-4-3.1 2.6z"/>'),
    flag: s('<path d="M4 14V2.5M4 3h7.5l-1.8 2.8L11.5 8.5H4"/>'),
    gear: s('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
    minimize: s('<path d="M3.5 8h9"/>'),
    close: s('<path d="M4 4l8 8M12 4l-8 8"/>'),
    party: s('<circle cx="6" cy="5.5" r="2.2"/><path d="M2 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8"/><circle cx="11.5" cy="6.2" r="1.7"/><path d="M11 9.4c1.8 0 3 1.3 3 3.1"/>'),
    alert: s('<path d="M8 2.2l6 10.8H2z"/><path d="M8 6.5v3M8 11.3v.1"/>'),
    dice: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="5.7" cy="5.7" r=".5" fill="currentColor"/><circle cx="10.3" cy="10.3" r=".5" fill="currentColor"/><circle cx="8" cy="8" r=".5" fill="currentColor"/>'),
    at: s('<circle cx="8" cy="8" r="2.4"/><path d="M10.4 8v1.1c0 1 .8 1.7 1.7 1.7s1.6-.9 1.6-2.3A5.7 5.7 0 1 0 11 12.9"/>'),
    mail: s('<rect x="2" y="3.5" width="12" height="9" rx="1.8"/><path d="M2.5 4.5L8 8.8l5.5-4.3"/>'),
    userPlus: s('<circle cx="6.5" cy="5.5" r="2.4"/><path d="M2 13.5c0-2.4 2-4.2 4.5-4.2s4.5 1.8 4.5 4.2M12.5 5v4M10.5 7h4"/>'),
    eye: s('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    sparkle: s('<path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z"/>'),
    bell: s('<path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3"/>'),
    // Settings sidebar
    user: s('<circle cx="8" cy="5.5" r="2.7"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>'),
    file: s('<path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M9.5 1.8V5h3M6 8.5h4.5M6 11h4.5"/>'),
    bolt: s('<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>'),
    key: s('<circle cx="5" cy="8" r="2.8"/><path d="M7.8 8h6.2M12 8v2.3M14 8v1.6"/>'),
    link: s('<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M9.2 6.8a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.9-.9"/>'),
    palette: s('<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.4-.6 1.4-1.3 0-1.1-1-1.3-1-2.3 0-.8.6-1.3 1.4-1.3h1.6a2.8 2.8 0 0 0 2.8-2.8c0-2.6-2.8-4.7-6.2-4.7z"/><circle cx="5" cy="7" r=".6" fill="currentColor"/><circle cx="7.5" cy="4.6" r=".6" fill="currentColor"/><circle cx="10.6" cy="5.2" r=".6" fill="currentColor"/>'),
    columns: s('<rect x="2" y="2.5" width="12" height="11" rx="1.8"/><path d="M6 2.5v11M10 2.5v11"/>'),
    target: s('<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="2.6"/><path d="M8 .8v2.4M8 12.8v2.4M.8 8h2.4M12.8 8h2.4"/>'),
    gauge: s('<path d="M2.2 11.5a6 6 0 1 1 11.6 0"/><path d="M8 11l2.8-4"/>'),
    info: s('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.8v.1"/>'),
  };
})();
