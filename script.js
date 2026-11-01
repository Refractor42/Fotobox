/* ============================================================
   SnapBox — Photobox Interaction Logic
   ============================================================ */

const gsap = window.gsap;
const { timeline } = gsap;

// --- DOM references ---
const $splash        = document.getElementById('splash');
const $camera        = document.getElementById('camera');
const $gallery       = document.getElementById('gallery');
const $countdown     = document.getElementById('countdown');
const $flash         = document.getElementById('flash');
const $captureBtn    = document.getElementById('captureBtn');
const $processing    = document.getElementById('processing');
const $processingFill = document.getElementById('processingFill');
const $placeholder   = $camera.querySelector('.camera__placeholder');
const $viewfinderFrame = $camera.querySelector('.viewfinder__frame');
const $corners       = $camera.querySelectorAll('.viewfinder__corner');
const $galleryGrid   = document.getElementById('galleryGrid');
const $galleryEmpty  = document.getElementById('galleryEmpty');
const $video         = document.getElementById('cameraVideo');
const $permission    = document.getElementById('permission');
const $galleryBadge  = document.getElementById('galleryBadge');
const $galleryBtn    = document.getElementById('galleryBtn');
const $streakPill    = document.getElementById('streakPill');
const $streakCount   = document.getElementById('streakCount');
let currentStreak = 0;
let lastPhotoTimestamp = null;

const photos = [];
// Wie photos, aber mit Server-ID — für Challenge-Zähler und Foto-Kette.
const photoRecords = [];

// --- State ---
let currentState = 'splash';
let hasPhoto = false;
let photoCount = 0;
let videoPlaying = false;
let viewfinderVisible = false;
let isCapturing = false;
let captureRunId = 0;
let captureCommitted = false;
let countdownState = null;

// ============================================================
//  I18N — Sprachumschaltung DE/EN (HCI: Accessibility/i18n)
//  Dezente Flaggen-Schalter in der Ecke statt vorgeschalteter Screen.
//  Die Sprache gilt für die ganze Session und springt am Session-Ende
//  („Save“/„Fertig“) auf die Standardsprache zurück, damit der nächste
//  Gast eine vorhersagbare Sprache vorfindet (Predictable System State).
// ============================================================
let defaultLang = 'de';
try {
  const savedLang = localStorage.getItem('snapbox_default_language');
  if (savedLang === 'en' || savedLang === 'de') defaultLang = savedLang;
} catch (e) {}
const I18N = {
  de: {
    splashSubtitle: 'Knipsen. Animieren. Erinnern.',
    splashCta: 'Fotobox starten',
    splashTap: 'Zum Starten tippen',
    challengeTitle: 'Monthly Challenge',
    challengePhotos: 'Fotos',
    challengeDaysOne: 'noch 1 Tag',
    challengeDays: 'noch {n} Tage',
    challengeLastDay: 'letzter Tag',
    themeHalloween: 'Halloween Motive',
    themeWinter: 'Winterzauber',
    themeDefault: 'Monatsmotiv',
    captionMode: 'MODUS',
    modeGroupAria: 'Aufnahmemodus',
    modeSingle: 'Einzelfoto',
    modeStrip: 'Fotostreifen',
    startHomeAria: 'Zum Startbildschirm',
    startHomeLabel: 'Start',
    endHomeAria: 'Fertig — zurück zum Startbildschirm',
    captureCancel: 'Abbrechen',
    captureCancelAria: 'Aufnahme abbrechen',
    acceptAria: 'Foto annehmen',
    btnAccept: 'Annehmen',
    btnStamp: 'Sticker',
    stampOpenAria: 'Sticker auswählen',
    stampCancel: 'Abbrechen',
    stampDone: 'Fertig',
    stampDelete: 'Sticker löschen',
    btnDone: 'Fertig',
    endQr: 'QR-Code',
    endInsta: 'Instagram',
    endPrint: 'Drucken',
    sideFilter: 'Filter',
    sideOverlay: 'Overlays',
    sideStamp: 'Sticker',
    tabFace: 'Gesicht',
    tabAll: 'Komplett',
    tabStandard: 'Standard',
    tabEvent: 'Event',
    tabEmoji: 'Emojis',
    tabUni: 'Hochschule',
    scrollHint: 'scroll',
    overlayNone: 'Kein Rahmen',
    overlayColorFrame: 'Farbrahmen',
    overlayWhiteFrame: 'Weißer Rahmen',
    overlayStripesH: 'Horizontale Streifen',
    overlayStripesV: 'Vertikale Streifen',
    filterStandard: 'Standard',
    filterVintage: 'Vintage',
    toastDownloaded: 'Foto heruntergeladen.',
    toastPrintBlocked: 'Druckfenster wurde blockiert — bitte Pop-ups erlauben.',
    toastFullscreenOn: 'Vollbild an — Shift+F zum Verlassen',
    toastFullscreenError: 'Vollbild konnte nicht geöffnet werden.',
    processing: 'Foto wird verarbeitet…',
    idleResetTitle: 'Noch da?',
    idleResetText: 'Zurück zum Start in',
    idleResetStay: 'Hier bleiben',
    permissionText: 'Kamerazugriff für SnapBox erforderlich',
    permissionBtn: 'Kamera erlauben',
    captionFace: 'GESICHTSFILTER',
    captionTimer: 'COUNTDOWN',
    shutterLabel: 'AUSLÖSER',
    captureAria: 'Foto aufnehmen',
    timerGroupAria: 'Countdown-Dauer',
    faceGroupAria: 'Gesichtsfilter',
    trayColor: 'Farbe',
    trayStickers: 'Sticker',
    filterGroupAria: 'Farbfilter',
    stickerGroupAria: 'Sticker hinzufügen',
    filterSw: 'Schwarzweiß',
    filterKnackig: 'Knackig',
    reviewHint: 'Sticker antippen und aufs Foto ziehen.',
    btnRetake: 'Neu aufnehmen',
    retakeAria: 'Foto neu aufnehmen',
    stickerToggleAria: 'Sticker auswählen',
    filterToggleAria: 'Filter auswählen',
    btnFilters: 'Filter',
    btnSave: 'Speichern',
    stickerOhrenAria: 'Katzenohren hinzufügen',
    stickerKroneAria: 'Krone hinzufügen',
    stickerBrilleAria: 'Sonnenbrille hinzufügen',
    stickerHutAria: 'Partyhut hinzufügen',
    stickerSmaller: 'Sticker verkleinern',
    stickerBigger: 'Sticker vergrößern',
    stickerRemove: 'Sticker entfernen',
    galleryBtn: 'Galerie',
    galleryBack: 'Zurück',
    galleryTitle: 'Deine Fotos',
    galleryTrash: 'Papierkorb',
    galleryEmpty: 'Noch keine Fotos — mach dein erstes Foto!',
    trashRetentionText: 'Neu gelöschte Fotos werden nach {n} Tagen endgültig gelöscht.',
    trashEmpty: 'Der Papierkorb ist leer.',
    confirmTitle: 'Endgültig löschen?',
    confirmText: 'Das Foto wird für immer gelöscht und kann nicht wiederhergestellt werden.',
    confirmCancel: 'Abbrechen',
    confirmOk: 'Endgültig löschen',
    discardTitle: 'Foto verwerfen?',
    discardText: 'Das Foto wurde noch nicht angenommen und wird endgültig gelöscht.',
    discardCancel: 'Weiter bearbeiten',
    discardConfirm: 'Verwerfen',
    qrTitle: 'Foto aufs Handy',
    qrCloseAria: 'QR-Dialog schließen',
    qrLoading: 'Link wird erstellt…',
    qrHint: 'QR-Code mit der Handy-Kamera scannen — das Foto öffnet sich im Browser.',
    qrTtl: 'Link ist 24 Stunden gültig.',
    qrRetry: 'Erneut versuchen',
    qrCopy: 'Link kopieren',
    qrCopied: 'Link kopiert.',
    qrCopyError: 'Link konnte nicht kopiert werden.',
    qrNotSaved: 'Foto ist noch nicht gespeichert.',
    qrSvgAria: 'QR-Code zum Herunterladen des Fotos',
    toastSaved: 'Foto gespeichert.',
    toastCaptureCancelled: 'Aufnahme abgebrochen.',
    toastSaveError: 'Foto konnte nicht gespeichert werden — Verbindung prüfen.',
    toastEditError: 'Änderungen konnten nicht gespeichert werden.',
    toastEditErrorKeep: 'Änderungen konnten nicht gespeichert werden — Foto bleibt unverändert.',
    toastEditedSaveError: 'Bearbeitetes Foto konnte nicht gespeichert werden — Original bleibt erhalten.',
    toastTrashed: 'Foto in den Papierkorb verschoben.',
    toastUndo: 'Rückgängig',
    toastDeleteError: 'Foto konnte nicht gelöscht werden — Verbindung prüfen.',
    toastRestored: 'Foto wiederhergestellt.',
    toastRestoreError: 'Wiederherstellen fehlgeschlagen — das Foto bleibt im Papierkorb.',
    toastRestoreError2: 'Foto konnte nicht wiederhergestellt werden.',
    toastLoadError: 'Gespeicherte Fotos konnten nicht geladen werden.',
    trashLoadError: 'Papierkorb konnte nicht geladen werden.',
    toastPurged: 'Foto endgültig gelöscht.',
    toastPurgeError: 'Foto konnte nicht endgültig gelöscht werden.',
    trashRestoreBtn: 'Wiederherstellen',
    trashPurgeBtn: 'Endgültig löschen',
    trashDaysLeftOne: 'noch 1 Tag',
    trashDaysLeftMany: 'noch {n} Tage',
    trashImgAlt: 'Gelöschtes Foto',
    capturedPhotoAlt: 'Aufgenommenes Foto',
    photoPreviewAlt: 'Foto-Vorschau',
    deletePhotoAria: 'Foto löschen',
    langGroupAria: 'Sprache wählen',
    soundOn: 'Ton ausschalten',
    soundOff: 'Ton einschalten',
    streakAriaOne: 'Foto-Streak: 1 Tag, {s}',
    streakAriaMany: 'Foto-Streak: {n} Tage, {s}',
    streakTaken: 'Foto heute gemacht',
    streakNone: 'heute noch kein Foto',
    faceNone: 'Original',
    faceBig: 'Große Augen + Mund',
    faceThug: 'Thug Life',
    faceMlg: 'MLG',
    faceShades: 'Pixelbrille',
    faceBoss: 'Gangster-Cap',
    faceBling: 'Goldkette',
    faceJoint: 'Joint',
    faceCheeky: 'Freches Grinsen',
    faceUnibrow: 'Monobraue',
    faceSquish: 'Platt',
    faceMelt: 'Schmelzen',
    faceJelly: 'Gelee',
    faceClown: 'Clown',
    faceDog: 'Snap Dog',
    faceClassic: 'Sonnenbrille',
    qrBtnLabel: 'Aufs Handy'
  },
  en: {
    splashSubtitle: 'Capture. Animate. Remember.',
    splashCta: 'Start Photobox',
    splashTap: 'Tap to start',
    challengeTitle: 'Monthly Challenge',
    challengePhotos: 'photos',
    challengeDaysOne: '1 day left',
    challengeDays: '{n} days left',
    challengeLastDay: 'last day',
    themeHalloween: 'Halloween motifs',
    themeWinter: 'Winter magic',
    themeDefault: 'Theme of the month',
    captionMode: 'MODE',
    modeGroupAria: 'Capture mode',
    modeSingle: 'Single photo',
    modeStrip: 'Photo strip',
    startHomeAria: 'Home — go to start screen',
    startHomeLabel: 'Home',
    endHomeAria: 'Done — go to start screen',
    captureCancel: 'Cancel',
    captureCancelAria: 'Cancel capture',
    acceptAria: 'Accept photo',
    btnAccept: 'Accept',
    btnStamp: 'Sticker',
    stampOpenAria: 'Choose sticker',
    stampCancel: 'Cancel',
    stampDone: 'Done',
    stampDelete: 'Delete sticker',
    btnDone: 'Done',
    endQr: 'QR Code',
    endInsta: 'Instagram',
    endPrint: 'Print',
    sideFilter: 'Filters',
    sideOverlay: 'Overlays',
    sideStamp: 'Stickers',
    tabFace: 'Face',
    tabAll: 'Full image',
    tabStandard: 'Standard',
    tabEvent: 'Event',
    tabEmoji: 'Emojis',
    tabUni: 'University',
    scrollHint: 'scroll',
    overlayNone: 'No frame',
    overlayColorFrame: 'Color frame',
    overlayWhiteFrame: 'White frame',
    overlayStripesH: 'Horizontal stripes',
    overlayStripesV: 'Vertical stripes',
    filterStandard: 'Standard',
    filterVintage: 'Vintage',
    toastDownloaded: 'Photo downloaded.',
    toastPrintBlocked: 'Print window was blocked — please allow pop-ups.',
    toastFullscreenOn: 'Fullscreen on — Shift+F to exit',
    toastFullscreenError: 'Fullscreen could not be opened.',
    processing: 'Processing photo…',
    idleResetTitle: 'Still there?',
    idleResetText: 'Returning to start in',
    idleResetStay: 'Stay here',
    permissionText: 'Camera access required for SnapBox',
    permissionBtn: 'Allow Camera',
    captionFace: 'FACE FILTERS',
    captionTimer: 'COUNTDOWN',
    shutterLabel: 'CAPTURE',
    captureAria: 'Take photo',
    timerGroupAria: 'Countdown duration',
    faceGroupAria: 'Face filters',
    trayColor: 'Color',
    trayStickers: 'Stickers',
    filterGroupAria: 'Color filters',
    stickerGroupAria: 'Add stickers',
    filterSw: 'Black & White',
    filterKnackig: 'Vivid',
    reviewHint: 'Tap a sticker, then drag it on the photo.',
    btnRetake: 'Retake',
    retakeAria: 'Retake photo',
    stickerToggleAria: 'Choose stickers',
    filterToggleAria: 'Choose filters',
    btnFilters: 'Filters',
    btnSave: 'Save',
    stickerOhrenAria: 'Add cat ears',
    stickerKroneAria: 'Add crown',
    stickerBrilleAria: 'Add sunglasses',
    stickerHutAria: 'Add party hat',
    stickerSmaller: 'Shrink sticker',
    stickerBigger: 'Enlarge sticker',
    stickerRemove: 'Remove sticker',
    galleryBtn: 'Gallery',
    galleryBack: 'Back',
    galleryTitle: 'Your Photos',
    galleryTrash: 'Trash',
    galleryEmpty: 'No photos yet. Capture your first memory!',
    trashRetentionText: 'Newly deleted photos are permanently removed after {n} days.',
    trashEmpty: 'The trash is empty.',
    confirmTitle: 'Delete permanently?',
    confirmText: 'This photo will be deleted forever and cannot be recovered.',
    confirmCancel: 'Cancel',
    confirmOk: 'Delete permanently',
    discardTitle: 'Discard photo?',
    discardText: 'The photo has not been accepted yet and will be deleted permanently.',
    discardCancel: 'Keep editing',
    discardConfirm: 'Discard',
    qrTitle: 'Photo to your phone',
    qrCloseAria: 'Close QR dialog',
    qrLoading: 'Creating link…',
    qrHint: 'Scan the QR code with your phone camera — the photo opens in your browser.',
    qrTtl: 'Link is valid for 24 hours.',
    qrRetry: 'Try again',
    qrCopy: 'Copy link',
    qrCopied: 'Link copied.',
    qrCopyError: 'Link could not be copied.',
    qrNotSaved: 'Photo is not saved yet.',
    qrSvgAria: 'QR code for downloading the photo',
    toastSaved: 'Photo saved.',
    toastCaptureCancelled: 'Capture cancelled.',
    toastSaveError: 'Photo could not be saved — check the connection.',
    toastEditError: 'Changes could not be saved.',
    toastEditErrorKeep: 'Changes could not be saved — the photo stays unchanged.',
    toastEditedSaveError: 'Edited photo could not be saved — the original is kept.',
    toastTrashed: 'Photo moved to trash.',
    toastUndo: 'Undo',
    toastDeleteError: 'Photo could not be deleted — check the connection.',
    toastRestored: 'Photo restored.',
    toastRestoreError: 'Restore failed — the photo stays in the trash.',
    toastRestoreError2: 'Photo could not be restored.',
    toastLoadError: 'Saved photos could not be loaded.',
    trashLoadError: 'Trash could not be loaded.',
    toastPurged: 'Photo deleted permanently.',
    toastPurgeError: 'Photo could not be deleted permanently.',
    trashRestoreBtn: 'Restore',
    trashPurgeBtn: 'Delete permanently',
    trashDaysLeftOne: '1 day left',
    trashDaysLeftMany: '{n} days left',
    trashImgAlt: 'Deleted photo',
    capturedPhotoAlt: 'Captured photo',
    photoPreviewAlt: 'Photo preview',
    deletePhotoAria: 'Delete photo',
    langGroupAria: 'Choose language',
    soundOn: 'Mute sound',
    soundOff: 'Turn sound on',
    streakAriaOne: 'Photo streak: 1 day, {s}',
    streakAriaMany: 'Photo streak: {n} days, {s}',
    streakTaken: 'photo taken today',
    streakNone: 'no photo yet today',
    faceNone: 'Original',
    faceBig: 'Big Eyes + Mouth',
    faceThug: 'Thug Life',
    faceMlg: 'MLG',
    faceShades: 'Pixel Shades',
    faceBoss: 'Thug Boss',
    faceBling: 'Bling',
    faceJoint: 'Joint',
    faceCheeky: 'Cheeky Grin',
    faceUnibrow: 'Unibrow',
    faceSquish: 'Squish',
    faceMelt: 'Meltdown',
    faceJelly: 'Jelly',
    faceClown: 'Clown',
    faceDog: 'Snap Dog',
    faceClassic: 'Shades',
    qrBtnLabel: 'To phone'
  }
};
let currentLang = defaultLang;

function t(key, vars) {
  const dict = I18N[currentLang] && I18N[currentLang][key] != null ? I18N[currentLang] : I18N[defaultLang];
  let s = dict[key] != null ? dict[key] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

const $splashLang = document.querySelector('.lang-switch--splash');

function applyLanguage(lang) {
  currentLang = I18N[lang] ? lang : defaultLang;
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  document.querySelectorAll('.lang-switch__btn').forEach((btn) => {
    const active = btn.dataset.lang === currentLang;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.lang-switch__unit').forEach((unit) => {
    const btn = unit.querySelector('.lang-switch__btn');
    if (!btn) return;
    unit.classList.toggle('is-selected', btn.dataset.lang === currentLang);
  });
  applySoundState(); // Beschriftung des Ton-Buttons in der aktiven Sprache
  renderTrashRetention(); // dynamische Aufbewahrungsdauer (Serverwert)
  // Beschriftungen der Gesichtsfilter-Chips in der aktiven Sprache nachziehen
  if ($filterBar && window.SnapBoxFilters) {
    $filterBar.querySelectorAll('.timer__chip').forEach((chip) => {
      const filter = window.SnapBoxFilters.FILTERS.find((f) => f.id === chip.dataset.filter);
      if (!filter) return;
      chip.textContent = (filter.emoji ? filter.emoji + ' ' : '') + faceLabel(filter);
      chip.setAttribute('aria-label', faceLabel(filter));
    });
  }
  if ($streakPill.classList.contains('visible')) renderStreak();
  // Kiosk-Menü und Challenge-Karte in der neuen Sprache nachziehen.
  if (document.getElementById('sideMenu')) {
    if ($sideMenuHead) $sideMenuHead.textContent = t(sideConfig().head);
    renderSideTabs();
    renderSideMenu();
    updateChallengeCard();
  }
}

document.querySelectorAll('.lang-switch__btn').forEach((btn) => {
  btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
});


// ============================================================
//  ORIENTATION SYNC (Hochformat / Querformat — Admin Panel)
// ============================================================
let currentOrientation = 'portrait';
try {
  const saved = localStorage.getItem('snapbox_orientation');
  if (saved === 'landscape' || saved === 'portrait') currentOrientation = saved;
} catch (e) {}

function applyOrientation(orientation) {
  if (orientation !== 'landscape' && orientation !== 'portrait') {
    orientation = 'portrait';
  }
  currentOrientation = orientation;
  const isLandscape = orientation === 'landscape';
  document.body.classList.toggle('orientation-landscape', isLandscape);
  try {
    localStorage.setItem('snapbox_orientation', orientation);
  } catch (e) {}
}

// Aufbewahrungsdauer aus den Server-Einstellungen (Admin-geschützt).
let serverRetentionDays = 7;

function renderTrashRetention() {
  const el = document.getElementById('trashRetentionText');
  if (el) el.textContent = t('trashRetentionText', { n: serverRetentionDays });
}

// Sofort initial anwenden
applyOrientation(currentOrientation);

// Synchronisation zwischen Tabs über BroadcastChannel
if ('BroadcastChannel' in window) {
  try {
    const settingsChannel = new BroadcastChannel('snapbox_channel');
    settingsChannel.onmessage = (event) => {
      if (!event.data) return;
      if (event.data.type === 'orientation_change') {
        applyOrientation(event.data.orientation);
      }
      if (event.data.type === 'default_language_change') {
        defaultLang = event.data.defaultLanguage === 'en' ? 'en' : 'de';
        try { localStorage.setItem('snapbox_default_language', defaultLang); } catch (e) {}
        applyLanguage(defaultLang);
      }
      if (event.data.type === 'retention_change') {
        const retention = Number(event.data.trashRetentionDays);
        if ([7, 14, 30].includes(retention)) {
          serverRetentionDays = retention;
          renderTrashRetention();
        }
      }
    };
  } catch (e) {}
}

// Synchronisation bei storage Events
window.addEventListener('storage', (e) => {
  if (e.key === 'snapbox_orientation' && (e.newValue === 'landscape' || e.newValue === 'portrait')) {
    applyOrientation(e.newValue);
  }
  if (e.key === 'snapbox_default_language' && (e.newValue === 'de' || e.newValue === 'en')) {
    defaultLang = e.newValue;
    applyLanguage(defaultLang);
  }
});

// Periodische Synchronisation mit dem Server (/api/settings) für Multi-Device / Kiosk
async function syncSettingsFromServer() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data) {
        if (data.orientation && data.orientation !== currentOrientation) {
          applyOrientation(data.orientation);
        }
        if (data.defaultLanguage && (data.defaultLanguage === 'en' || data.defaultLanguage === 'de')) {
          if (defaultLang !== data.defaultLanguage) {
            defaultLang = data.defaultLanguage;
            try { localStorage.setItem('snapbox_default_language', defaultLang); } catch (e) {}
            if (currentState === 'splash') {
              applyLanguage(defaultLang);
            }
          }
        }
        const retention = Number(data.trashRetentionDays);
        if ([7, 14, 30].includes(retention) && retention !== serverRetentionDays) {
          serverRetentionDays = retention;
          renderTrashRetention();
        }
      }
    }
  } catch (e) {}
}

syncSettingsFromServer();
setInterval(syncSettingsFromServer, 2500);

// ============================================================
//  CAMERA ACCESS
// ============================================================
let stream = null;

async function initCamera() {
  $permission.classList.remove('visible');

  // already have a stream (returning from gallery or re-entering)
  if (filterEngine) filterEngine.start();
  if (stream) {
    videoPlaying = true;
    $video.classList.add('has-source');
    if (!$video.srcObject) {
      $video.srcObject = stream;
    }
    $video.style.transform = 'scaleX(-1)';
    $video.play().catch((e) => console.warn('video.play() failed:', e)); // resume playback
    gsap.set($placeholder, { opacity: 0 });
    showViewfinder();
    return true;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    $video.srcObject = stream;
    $video.classList.add('has-source');

    // once video can play, hide placeholder and show viewfinder
    $video.onplaying = () => {
      videoPlaying = true;
      gsap.to($placeholder, { opacity: 0, duration: 0.3 });
      showViewfinder();
    };

    // mirror the video for a natural selfie feel
    $video.style.transform = 'scaleX(-1)';

    return true;
  } catch (err) {
    console.warn('Camera access denied:', err.message);
    showPermissionPrompt();
    return false;
  }
}

function showPermissionPrompt() {
  $permission.classList.add('visible');
  gsap.from('.permission__content > *', {
    y: 20, opacity: 0, stagger: 0.1,
    duration: 0.5, ease: 'power2.out'
  });
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

// ============================================================
//  DAILY STREAK
// ============================================================
// Global streak: the server reads/writes the single Supabase row.
const DAY_MS = 24 * 60 * 60 * 1000;

// Kalendertag in lokaler Zeit. Der Streak zählt Tage, keine rollenden
// 24h-Fenster — sonst bringt ein Foto am Abend und eines am nächsten
// Nachmittag keinen Fortschritt, obwohl an beiden Tagen geknipst wurde.
function localDayIndex(date) {
  return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / DAY_MS);
}

// Tage seit dem letzten Foto; null, wenn es (noch) keins gibt.
function daysSinceLastPhoto() {
  if (!lastPhotoTimestamp) return null;
  const then = new Date(lastPhotoTimestamp);
  if (Number.isNaN(then.getTime())) return null;
  return localDayIndex(new Date()) - localDayIndex(then);
}

function isPhotoTakenToday() {
  return daysSinceLastPhoto() === 0;
}

function renderStreak() {
  const takenToday = isPhotoTakenToday();
  const days = daysSinceLastPhoto();
  // Ein ganzer Tag ohne Foto beendet den Streak — auch ohne Server-Roundtrip,
  // weil die Box oft über Mitternacht hinweg durchläuft.
  const count = days !== null && days > 1 ? 0 : currentStreak;
  $streakCount.textContent = String(count);
  $streakPill.classList.add('visible');
  $streakPill.classList.toggle('streak--active', takenToday && count > 0);
  $streakPill.classList.toggle('streak--due', !takenToday);
  $streakPill.setAttribute(
    'aria-label',
    t(count === 1 ? 'streakAriaOne' : 'streakAriaMany', {
      n: count,
      s: takenToday ? t('streakTaken') : t('streakNone')
    })
  );
}

// Status regelmäßig neu bewerten, damit Anzeige und „fällig"-Zustand um
// Mitternacht umspringen, ohne dass die Seite neu geladen werden muss.
setInterval(() => {
  if ($streakPill.classList.contains('visible')) renderStreak();
}, 60 * 1000);

function applyStreak(streak) {
  if (!streak) return;
  currentStreak = Number(streak.current_streak) || 0;
  lastPhotoTimestamp = streak.last_photo_timestamp || null;
  renderStreak();
}

async function loadStreak() {
  try {
    const res = await fetch('/api/streak', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    applyStreak(await res.json());
  } catch (err) {
    console.warn('Streak could not be loaded:', err);
  }
}

// ============================================================
//  PHOTO CAPTURE (video frame snapshot)
// ============================================================
function captureFromVideo() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const w = $video.videoWidth;
    const h = $video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // mirror to match the displayed (flipped) video + gewählter Filter,
    // damit das Foto exakt der Vorschau entspricht (WYSIWYG)
    ctx.save();
    const filterCss = FILTERS[currentFilter].css;
    if (filterCss !== 'none') ctx.filter = filterCss;
    ctx.scale(-1, 1);
    ctx.drawImage($video, -w, 0, w, h);
    ctx.restore();

    // Face filter: render the whole scene at sensor resolution instead.
    if (filterEngine && filterEngine.getFilter() !== 'none') {
      const faceCanvas = document.createElement('canvas');
      faceCanvas.width = w;
      faceCanvas.height = h;
      const faceCtx = faceCanvas.getContext('2d');
      const colorCss = FILTERS[currentFilter].css;
      if (colorCss !== 'none') faceCtx.filter = colorCss;
      if (filterEngine.drawCapture(faceCtx, w, h)) {
        resolve(faceCanvas.toDataURL('image/jpeg', 0.92));
        return;
      }
    }

    resolve(canvas.toDataURL('image/jpeg', 0.92));
  });
}

// ============================================================
//  ANIMATIONS: Splash reveal
// ============================================================
function animateSplashIn() {
  const tl = timeline();
  tl.to($splash, { display: 'flex', opacity: 1, duration: 0.01 })
    .from('.splash__title', { y: 40, opacity: 0, duration: 1.1, ease: 'elastic.out(1, 0.6)' }, 0.3)
    .from('.splash__subtitle', { y: 20, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.45)
    .from('.splash__cta', { y: 30, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.55);
}

// Start des Kiosk-Flows: Splash ausblenden, Kamera starten. Wird vom
// Swipe-up, vom Start-Button und von der Leertaste aufgerufen.
function startSession() {
  if (currentState === 'camera') return;
  unlockAudio(); // create the AudioContext inside the user gesture
  currentState = 'camera';
  initCamera(); // request camera immediately to preserve user-gesture context

  if (isKioskLayout()) openSideMenu('filter');

  const tl = timeline();
  tl.to(['.splash__content--portrait', '.splash__content--kiosk', '.lang-switch--splash',
    '.splash__brand', '.challenge-card', '.splash__sound'], {
    y: -24, opacity: 0, duration: 0.45, ease: 'power2.in'
  }).to($splash, {
    opacity: 0, duration: 0.01
  }, '+=0.15').add(() => {
    $splash.style.display = 'none';
    if ($splashLang) {
      $splashLang.hidden = true;
      gsap.set($splashLang, { clearProps: 'opacity,transform' });
    }
    animateCameraIn();
  }, '+=0.2');
}

// ============================================================
//  ANIMATIONS: Camera enter
// ============================================================
function animateCameraIn() {
  const tl = timeline({ onStart: () => { $camera.style.display = 'block'; syncCancelHome(); } });
  tl.to($camera, { opacity: 1, duration: 0.01 })
    .from($camera.querySelector('.camera__stage'), {
      y: 60, opacity: 0, duration: 0.9, ease: 'power3.out'
    }, 0)
    // Animate the bar as ONE element: staggering the buttons individually
    // leaves a separate translateY on each button, and if the tween is
    // interrupted (hidden tab, permission dialog) they freeze at different
    // offsets — i.e. buttons that are no longer on the same line.
    .from('.camera__controls', {
      y: 40, opacity: 0, duration: 0.7, ease: 'power2.out', clearProps: 'all'
    }, 0.3)
    .from($placeholder, { opacity: 0, duration: 0.5 }, 0.7);

  // if video already playing (camera was fast), hide placeholder
  if (videoPlaying) {
    gsap.set($placeholder, { opacity: 0 });
  }
  showViewfinder();
}

function showViewfinder() {
  if (viewfinderVisible) return;
  viewfinderVisible = true;
  const tl = timeline();
  tl.to([...$corners, $viewfinderFrame], {
    opacity: 1, scale: [0, 1], duration: 0.6,
    ease: 'back.out(1.4)', stagger: 0.1
  });
}

function hideViewfinder() {
  viewfinderVisible = false;
  return gsap.to([...$corners, $viewfinderFrame], {
    opacity: 0, duration: 0.35, ease: 'power2.in', stagger: 0.05
  });
}

// ============================================================
//  CAPTURE SEQUENCE
// ============================================================
const $review = document.getElementById('review');
const $reviewKeep = document.getElementById('reviewKeep');
const $reviewRetake = document.getElementById('reviewRetake');
const $filterTray = document.getElementById('filterTray');
const $stickerTray = document.getElementById('stickerTray');
const $stickerToggle = document.getElementById('stickerToggle');
const $filterToggle = document.getElementById('filterToggle');
const $timerChips = document.getElementById('timerChips');

// Gäste-Einstellungen gelten nur für die aktuelle Sitzung. Beim Verlassen
// des Startbildschirms werden sie auf diese neutralen Werte zurückgesetzt,
// damit der nächste Gast nicht die Wahl des Vorgängers erbt.
const DEFAULT_CAPTURE_MODE = 'single';
const DEFAULT_COUNTDOWN_SECONDS = 5;

// Countdown-Dauer (Selbstauslöser) — sichtbar gewählt, pro Sitzung gemerkt.
// Default 5s: Standard bei echten Fotoboxen und genug Zeit, um sich zu
// positionieren; 3s bleibt als Schnell-Option wählbar.
let countdownSeconds = Number(localStorage.getItem('countdownSeconds'));
if (![3, 5, 10].includes(countdownSeconds)) countdownSeconds = DEFAULT_COUNTDOWN_SECONDS;

function applyTimerSelection() {
  // Hochformat-Dock und Kiosk-Leiste teilen sich denselben Zustand.
  document.querySelectorAll('[data-seconds]').forEach((chip) => {
    const active = Number(chip.dataset.seconds) === countdownSeconds;
    chip.classList.toggle('is-selected', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}
applyTimerSelection();

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-seconds]');
  if (!chip) return;
  countdownSeconds = Number(chip.dataset.seconds);
  localStorage.setItem('countdownSeconds', String(countdownSeconds));
  applyTimerSelection();
});

// Aufnahmemodus: Einzelfoto oder vierteiliger Fotostreifen.
let captureMode = localStorage.getItem('snapbox_capture_mode') === 'strip' ? 'strip' : DEFAULT_CAPTURE_MODE;

function applyModeSelection() {
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    const active = btn.dataset.mode === captureMode;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}
applyModeSelection();

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  captureMode = btn.dataset.mode === 'strip' ? 'strip' : 'single';
  try { localStorage.setItem('snapbox_capture_mode', captureMode); } catch (err) {}
  applyModeSelection();
});

function syncFaceFilterSelection() {
  if (!filterEngine || !$filterBar) return;
  const active = filterEngine.getFilter();
  $filterBar.querySelectorAll('.timer__chip').forEach((chip) => {
    const isActive = chip.dataset.filter === active;
    chip.classList.toggle('is-selected', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });
}

// Setzt alle gastbezogenen Aufnahme-Einstellungen auf den neutralen Zustand.
// Betreiber-Einstellungen (Ausrichtung, Standardsprache, Aufbewahrung) bleiben
// davon unberührt, weil sie nicht in dieser Funktion liegen.
function resetGuestCaptureSettings() {
  captureMode = DEFAULT_CAPTURE_MODE;
  countdownSeconds = DEFAULT_COUNTDOWN_SECONDS;
  currentFilter = 'standard';
  currentOverlay = null;
  soundEnabled = true;

  // Keine Gästeauswahl im Gerät behalten: Beim nächsten Laden gilt der
  // Standard, nicht die letzte Wahl eines fremden Gastes.
  try {
    localStorage.removeItem('snapbox_capture_mode');
    localStorage.removeItem('countdownSeconds');
    localStorage.removeItem('soundEnabled');
  } catch (err) {}

  if (filterEngine) filterEngine.setFilter('none');
  applyModeSelection();
  applyTimerSelection();
  applyFilterSelection();
  syncFaceFilterSelection();
  applySoundState();
}

// Während der Aufnahmesequenz (Countdown → Verarbeitung) sind Gallery, Timer
// gesperrt: Fehlklicks können die Sequenz nicht mehr abreißen
// (Fehlervermeidung) — Kontrolle kommt danach über Behalten/Neu aufnehmen.
function setControlsLocked(locked) {
  // Alles, was die Aufnahme verändern oder verlassen kann, wird wirklich
  // deaktiviert — nicht nur per pointer-events ausgeblendet. So verhalten
  // sich Maus, Tastatur und Screenreader gleich (HCI: Consistency).
  $galleryBtn.classList.toggle('is-locked', locked);
  $galleryBtn.disabled = locked;
  $timerChips.classList.toggle('is-locked', locked);
  $timerChips.querySelectorAll('button').forEach((btn) => { btn.disabled = locked; });
  ['kioskTimer', 'modeChips'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('is-locked', locked);
    el.querySelectorAll('button').forEach((btn) => { btn.disabled = locked; });
    const switchEl = el.closest('.capture-switch');
    if (switchEl) switchEl.classList.toggle('is-locked', locked);
  });
  const kioskShutter = document.getElementById('landscapeCaptureBtn');
  if (kioskShutter) kioskShutter.disabled = locked;
  const sideMenu = document.getElementById('sideMenu');
  if (sideMenu) {
    sideMenu.classList.toggle('is-locked', locked);
    sideMenu.inert = locked;
    if (locked) sideMenu.setAttribute('aria-disabled', 'true');
    else sideMenu.removeAttribute('aria-disabled');
  }
}

// Das Review-Panel bleibt während der Bearbeitung sichtbar: „Save“ ist
// damit auch nach dem Platzieren eines Stickers immer direkt erreichbar.
function isKioskLayout() {
  return document.body.classList.contains('orientation-landscape');
}

// Der globale Start-Button sitzt auf jedem Screen an derselben Stelle:
// unten rechts, bündig mit der rechten Kante des Seitenmenüs. Damit springt
// er weder beim Review-Wechsel noch beim Wechsel in Galerie, Papierkorb oder
// Endscreen.
function syncCancelHome() {
  if (!$cancelHome) return;
  $cancelHome.hidden = currentState === 'splash';
}

// Derselbe Button hat drei Zustände: normal „Start“, während der Aufnahme
// „Abbrechen“ und auf dem Endscreen „Fertig“. Position und Größe bleiben
// dabei unverändert; nur Icon, Label, ARIA und Farbe wechseln.
function setHomeMode(mode = 'default') {
  if (!$cancelHome) return;
  const cancelling = mode === 'cancel';
  const done = mode === 'done';
  $cancelHome.classList.toggle('is-cancelling', cancelling);
  $cancelHome.classList.toggle('is-done', done);
  const label = $cancelHome.querySelector('.cancel-home__label');
  const labelKey = done ? 'btnDone' : cancelling ? 'captureCancel' : 'startHomeLabel';
  const ariaKey = done ? 'endHomeAria' : cancelling ? 'captureCancelAria' : 'startHomeAria';
  if (label) {
    label.dataset.i18n = labelKey;
    label.textContent = t(labelKey);
  }
  $cancelHome.dataset.i18nAria = ariaKey;
  $cancelHome.setAttribute('aria-label', t(ariaKey));
}

function setHomeCancelMode(active) {
  setHomeMode(active ? 'cancel' : 'default');
}

function cancelCapture() {
  if (!isCapturing || captureCommitted) return;
  // Laufende asynchrone Schritte (Countdown, Verarbeitung) invalidieren.
  captureRunId += 1;
  finishCountdown(false);
  hideStripProgress();
  gsap.killTweensOf($countdown);
  gsap.set($countdown, { scale: 1, opacity: 0 });
  $countdown.style.opacity = '0';
  $countdown.setAttribute('aria-hidden', 'true');
  gsap.killTweensOf([...$corners, $viewfinderFrame]);
  gsap.killTweensOf($processing);
  gsap.killTweensOf($flash);
  gsap.set($processing, { opacity: 0 });
  gsap.set($flash, { opacity: 0 });
  $processingFill.style.width = '0%';
  $processingFill.style.transition = 'none';
  isCapturing = false;
  $captureBtn.disabled = false;
  currentState = 'camera';
  setHomeCancelMode(false);
  setControlsLocked(false);
  resetCameraView();
  syncCancelHome();
  showToast(t('toastCaptureCancelled'));
  if ($cancelHome) $cancelHome.focus({ preventScroll: true });
}

function showReview() {
  $camera.classList.add('is-reviewing');
  syncCancelHome();
  closeReviewTools();
  // Ausgangszustand: ungefiltertes Foto, Auswahl auf „Standard“.
  applyFilterSelection();
  renderOverlayPreview();

  if (isKioskLayout()) {
    // Im Querformat liegen die Aktionen unter dem Foto und das Menü rechts.
    $review.hidden = true;
    const actions = document.getElementById('reviewActions');
    const stamps = document.getElementById('stampActions');
    if (stamps) stamps.hidden = true;
    if (actions) {
      actions.hidden = false;
      gsap.from(actions, { y: 16, opacity: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
    }
    openSideMenu('overlay');
    const keepBtn = document.getElementById('landscapeKeep');
    if (keepBtn) keepBtn.focus();
    return;
  }

  $review.hidden = false;
  gsap.from($review, { y: 24, opacity: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
  $reviewKeep.focus();
}

function hideReview() {
  $review.hidden = true;
  const actions = document.getElementById('reviewActions');
  const stamps = document.getElementById('stampActions');
  if (actions) actions.hidden = true;
  if (stamps) stamps.hidden = true;
  $camera.classList.remove('is-reviewing', 'is-stamping');
  syncCancelHome();
  closeReviewTools();
}

// Werkzeugleiste im Instagram-Stil: immer nur ein Tray offen, und das Tray
// liegt unter dem Foto statt darüber.
let openReviewTool = null;

function setReviewTool(tool) {
  openReviewTool = openReviewTool === tool ? null : tool;
  const stickersOpen = openReviewTool === 'stickers';
  const filtersOpen = openReviewTool === 'filters';
  $stickerTray.hidden = !stickersOpen;
  $filterTray.hidden = !filtersOpen;
  $stickerToggle.setAttribute('aria-expanded', String(stickersOpen));
  $filterToggle.setAttribute('aria-expanded', String(filtersOpen));
  const tray = stickersOpen ? $stickerTray : filtersOpen ? $filterTray : null;
  if (tray) {
    gsap.fromTo(tray, { y: 8, opacity: 0 }, {
      y: 0, opacity: 1, duration: 0.2, ease: 'power2.out', clearProps: 'all'
    });
  }
}

function closeReviewTools() {
  openReviewTool = null;
  $stickerTray.hidden = true;
  $filterTray.hidden = true;
  $stickerToggle.setAttribute('aria-expanded', 'false');
  $filterToggle.setAttribute('aria-expanded', 'false');
}

$stickerToggle.addEventListener('click', () => setReviewTool('stickers'));
$filterToggle.addEventListener('click', () => setReviewTool('filters'));

// Wirft das aktuell angezeigte Foto weg (in den Papierkorb, mit Undo-Toast)
// und setzt die Kameraansicht zurück — vom Review-„Neu aufnehmen" genutzt.
function discardCurrentPhoto() {
  if (!hasPhoto) return;
  if (lastPhoto) {
    deletePhoto(lastPhoto.card, lastPhoto.id);
    lastPhoto = null;
  }
  const capturedImg = $camera.querySelector('.viewfinder img.stage-photo');
  if (capturedImg) {
    gsap.to(capturedImg, {
      scale: 0.7, opacity: 0, duration: 0.35, ease: 'power2.in', rotation: -6,
      onComplete: resetCameraView
    });
  } else {
    resetCameraView();
  }
}

// Home-Abbruch vor „Annehmen“: Die Aufnahme wurde nie bestätigt und wird
// deshalb endgültig verworfen statt in den Papierkorb zu wandern.
function discardUnacceptedPhoto() {
  if (!hasPhoto) return;
  if (lastPhoto) {
    deletePhoto(lastPhoto.card, lastPhoto.id, { permanent: true });
    lastPhoto = null;
  }
}

async function keepPhoto() {
  // Session-Ende: Sprache für den nächsten Gast auf Deutsch zurücksetzen
  // (HCI: Predictable System State — der Nachfolger in der Warteschlange
  // darf nicht durch eine fremde Sprache verwirrt werden).
  applyLanguage(defaultLang);
  hideReview();
  setControlsLocked(false);

  const photo = lastPhoto;
  const stagePhoto = $camera.querySelector('.viewfinder img.stage-photo');
  const photoUrl = stagePhoto ? stagePhoto.src : null;
  const hasEdits = activeStickers.length || currentFilter !== 'standard' || !!currentOverlay;

  // Farbe, Sticker oder Overlay gewählt: Foto neu komponieren und serverseitig
  // überschreiben. Im Kiosk endet der Flow danach auf dem Endscreen.
  if (hasEdits) {
    await saveEditedPhoto({ endScreen: isKioskLayout() });
    return;
  }

  if (isKioskLayout()) {
    if (photo && photo.savePromise) {
      try { await photo.savePromise; } catch (e) { /* Fehler wurde bereits gemeldet */ }
    }
    if (photo && photo.id) showToast(t('toastSaved'));
    if (photoUrl) showEndScreen(photoUrl);
    return;
  }

  // Erst „Speichern“ bestätigt das Foto. Die Server-Speicherung läuft
  // bereits seit der Aufnahme; hier warten wir ihr Ergebnis ab, damit
  // „Foto gespeichert“ nicht fälschlich vor der Entscheidung erscheint.
  resetCameraView();
  if (photo && photo.savePromise) {
    try { await photo.savePromise; } catch (e) { /* Fehler wurde bereits gemeldet */ }
    if (photo.id) showToast(t('toastSaved'));
  }
}

function retakePhoto() {
  hideReview();
  setControlsLocked(false);
  clearStickers();
  discardCurrentPhoto();
}

$reviewKeep.addEventListener('click', keepPhoto);
$reviewRetake.addEventListener('click', retakePhoto);

const $landscapeKeep = document.getElementById('landscapeKeep');
if ($landscapeKeep) $landscapeKeep.addEventListener('click', keepPhoto);
const $landscapeRetake = document.getElementById('landscapeRetake');
if ($landscapeRetake) $landscapeRetake.addEventListener('click', retakePhoto);

// ============================================================
//  QR-DIALOG: Foto aufs Handy (signierter Download-Link)
// ============================================================
const $qrModal = document.getElementById('qrModal');
const $qrFrame = document.getElementById('qrFrame');
const $qrClose = document.getElementById('qrClose');
const $qrTtl = document.getElementById('qrTtl');
let lastQrPhotoId = null;
let lastQrFocusTarget = null;

function resetQrFrame() {
  $qrFrame.innerHTML = `
    <div class="qr-modal__loading" id="qrLoading">
      <span class="qr-modal__spinner" aria-hidden="true"></span>
      <p>${t('qrLoading')}</p>
    </div>`;
  $qrTtl.textContent = '';
}

function closeQrDialog() {
  $qrModal.hidden = true;
  lastQrPhotoId = null;
  if (lastQrFocusTarget && lastQrFocusTarget.focus) lastQrFocusTarget.focus();
  lastQrFocusTarget = null;
}

$qrClose.addEventListener('click', closeQrDialog);
$qrModal.addEventListener('click', (e) => { if (e.target === $qrModal) closeQrDialog(); });

function showErrorInQrFrame() {
  $qrFrame.innerHTML = '';
  const retry = document.createElement('button');
  retry.className = 'qr-modal__retry';
  retry.type = 'button';
  retry.textContent = t('qrRetry');
  retry.addEventListener('click', () => showQrDialog(lastQrPhotoId));
  const wrap = document.createElement('div');
  wrap.className = 'qr-modal__loading';
  wrap.appendChild(retry);
  $qrFrame.appendChild(wrap);
}

function renderQrInto(frame, url) {
  frame.innerHTML = '';
  if (typeof qrcode === 'function') {
    const qr = qrcode(0, 'M');
    qr.addData(url, 'Byte');
    qr.make();
    const holder = document.createElement('div');
    holder.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    const svg = holder.querySelector('svg');
    if (svg) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', t('qrSvgAria'));
      frame.appendChild(svg);
      return;
    }
  }
  // Fallback, falls die QR-Library nicht geladen werden konnte:
  // Link lesbar zeigen + kopierbar machen
  const box = document.createElement('div');
  box.className = 'qr-modal__loading';
  const link = document.createElement('p');
  link.className = 'qr-modal__fallback';
  link.textContent = url;
  const copy = document.createElement('button');
  copy.className = 'qr-modal__retry';
  copy.type = 'button';
  copy.textContent = t('qrCopy');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(url)
      .then(() => showToast(t('qrCopied')))
      .catch(() => showToast(t('qrCopyError'), { error: true }));
  });
  box.appendChild(link);
  box.appendChild(copy);
  frame.appendChild(box);
}

async function showQrDialog(photoId) {
  if (!photoId) {
    showToast(t('qrNotSaved'), { error: true });
    return;
  }
  lastQrPhotoId = photoId;
  lastQrFocusTarget = document.activeElement;
  $qrModal.hidden = false;
  resetQrFrame();
  gsap.from($qrModal.querySelector('.qr-modal__card'), {
    y: 24, opacity: 0, scale: 0.96, duration: 0.3, ease: 'power2.out', clearProps: 'all'
  });
  $qrClose.focus();
  try {
    const res = await fetch('/api/photos?qr=1&id=' + encodeURIComponent(photoId), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if ($qrModal.hidden || lastQrPhotoId !== photoId) return; // inzwischen geschlossen
    renderQrInto($qrFrame, data.url);
    $qrTtl.textContent = t('qrTtl');
  } catch (err) {
    console.warn('QR link could not be created:', err);
    if (!$qrModal.hidden) showErrorInQrFrame();
  }
}

// ============================================================
//  FARBFILTER — werden im Review auf das fertige Foto angewendet
// ============================================================
const FILTERS = {
  standard: { css: 'none' },
  sw:       { css: 'grayscale(1) contrast(1.1)' },
  vintage:  { css: 'sepia(0.55) contrast(0.95) saturate(1.2) brightness(0.97)' },
  knackig:  { css: 'saturate(1.35) contrast(1.15)' }
};
const $filterChips = document.querySelectorAll('#filterChips .timer__chip');
const $filterCanvas = document.getElementById('filterCanvas');
const $filterBar = document.getElementById('filterBar');

// ============================================================
//  FACE FILTERS (filters.js)
// ============================================================
let filterEngine = null;
try {
  if (window.SnapBoxFilters && $filterCanvas) {
    filterEngine = window.SnapBoxFilters.create({ video: $video, canvas: $filterCanvas });
  }
} catch (err) {
  console.warn('Face filters could not start, camera will run without them:', err);
}

const FACE_LABEL_KEYS = {
  none: 'faceNone', thug: 'faceThug', mlg: 'faceMlg', big: 'faceBig', cheeky: 'faceCheeky',
  shades: 'faceShades', boss: 'faceBoss', bling: 'faceBling', joint: 'faceJoint',
  unibrow: 'faceUnibrow',
  squish: 'faceSquish', melt: 'faceMelt', jelly: 'faceJelly', clown: 'faceClown',
  dog: 'faceDog', classic: 'faceClassic'
};
function faceLabel(filter) {
  const key = FACE_LABEL_KEYS[filter.id];
  return key ? t(key) : filter.label;
}

function initFilterBar() {
  if (!filterEngine || !$filterBar) return;
  window.SnapBoxFilters.FILTERS.forEach((filter) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'timer__chip';
    chip.dataset.filter = filter.id;
    const active = filter.id === filterEngine.getFilter();
    chip.setAttribute('aria-pressed', String(active));
    if (active) chip.classList.add('is-selected');

    chip.textContent = (filter.emoji ? filter.emoji + ' ' : '') + faceLabel(filter);
    chip.setAttribute('aria-label', faceLabel(filter));
    chip.addEventListener('click', () => {
      const selected = filterEngine.setFilter(filter.id);
      $filterBar.querySelectorAll('.timer__chip').forEach((el) => {
        const isActive = el.dataset.filter === selected;
        el.classList.toggle('is-selected', isActive);
        el.setAttribute('aria-pressed', String(isActive));
      });
    });
    $filterBar.appendChild(chip);
  });

  // Vertical wheel scrolls the filter row horizontally on desktop.
  $filterBar.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if ($filterBar.scrollWidth <= $filterBar.clientWidth + 1) return;
    $filterBar.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // Mouse drag-to-scroll for desktop
  let isFilterDrag = false;
  let filterStartX = 0;
  let filterScrollLeft = 0;
  let hasDragged = false;

  $filterBar.addEventListener('mousedown', (e) => {
    isFilterDrag = true;
    hasDragged = false;
    filterStartX = e.pageX - $filterBar.offsetLeft;
    filterScrollLeft = $filterBar.scrollLeft;
  });

  window.addEventListener('mouseup', () => {
    isFilterDrag = false;
    setTimeout(() => { hasDragged = false; }, 50);
  });

  $filterBar.addEventListener('mousemove', (e) => {
    if (!isFilterDrag) return;
    const x = e.pageX - $filterBar.offsetLeft;
    const walk = (x - filterStartX) * 1.2;
    if (Math.abs(walk) > 4) {
      hasDragged = true;
      e.preventDefault();
      $filterBar.scrollLeft = filterScrollLeft - walk;
    }
  });

  $filterBar.addEventListener('click', (e) => {
    if (hasDragged) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
}
initFilterBar();
// Farbfilter werden erst nach der Aufnahme im Review gewählt und auf das
// geschossene Foto angewendet — die Live-Vorschau bleibt ungefiltert.
let currentFilter = 'standard';

function applyStageFilter() {
  const stage = $camera.querySelector('.viewfinder img.stage-photo');
  if (!stage) return;
  const css = FILTERS[currentFilter].css;
  stage.style.filter = css === 'none' ? 'none' : css;
}

// Komplett-Filter im Kiosk schon in der Live-Vorschau zeigen. Das Foto wird
// beim Auslösen mit demselben Filter gebacken (WYSIWYG).
function applyColorPreview() {
  const css = FILTERS[currentFilter] ? FILTERS[currentFilter].css : 'none';
  const show = isKioskLayout()
    && currentState === 'camera'
    && !$camera.classList.contains('is-reviewing')
    && !$camera.classList.contains('is-stamping');
  [$video, $filterCanvas].forEach((el) => {
    if (!el) return;
    el.style.filter = show && css !== 'none' ? css : '';
  });
}

function applyFilterSelection() {
  $filterChips.forEach((chip) => {
    const selected = chip.dataset.filter === currentFilter;
    chip.classList.toggle('is-selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
  applyStageFilter();
  applyColorPreview();
}

$filterChips.forEach((chip) => chip.addEventListener('click', () => {
  currentFilter = chip.dataset.filter;
  applyFilterSelection();
}));
applyFilterSelection();

// ============================================================
//  STICKER — Nachbearbeitung in der Review-Phase (Direkte Manipulation)
// ============================================================
const $stickerPalette = document.getElementById('stickerPalette');
let activeStickers = [];   // { el, x, y, w } — x/y/w in % der Bühne
let selectedSticker = null;

function stickerSvgUrl(kind) {
  const svg = $stickerPalette.querySelector('[data-sticker="' + kind + '"] svg').cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // width/height für verlässliche naturalWidth beim Canvas-Rendering
  const vb = svg.getAttribute('viewBox').split(/\s+/);
  svg.setAttribute('width', vb[2]);
  svg.setAttribute('height', vb[3]);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
}

function addSticker(kind) {
  const el = document.createElement('div');
  el.className = 'sticker';
  const img = document.createElement('img');
  img.src = stickerSvgUrl(kind);
  img.draggable = false;
  img.alt = '';
  el.appendChild(img);

  const st = { el, x: 50, y: 35, w: 26 };
  $camera.querySelector('.viewfinder').appendChild(el);
  activeStickers.push(st);
  positionSticker(st);

  el.addEventListener('pointerdown', (e) => {
    // Tippen auf die Größen-/Löschen-Buttons darf keinen Drag starten:
    // sonst springt der Sticker beim Touch-Tap auf die Button-Position.
    if (e.target.closest('.sticker__ctrl')) return;
    e.preventDefault();
    e.stopPropagation();
    selectSticker(st);
    const frame = photoStageRect();
    const move = (ev) => {
      st.x = ((ev.clientX - frame.left) / frame.width) * 100;
      st.y = ((ev.clientY - frame.top) / frame.height) * 100;
      positionSticker(st);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  selectSticker(st);
}

// Sichtbarer Fotobereich innerhalb der Bühne. Ohne Overlay füllt das Foto
// die Bühne (cover, wird beschnitten); mit Overlay wird das ganze Foto
// gezeigt (contain). Sticker-Prozente beziehen sich immer auf genau diese
// Fläche, damit sie nie in den schwarzen Rand oder über den Rahmen laufen.
function photoStageRect() {
  const viewfinder = $camera.querySelector('.viewfinder');
  if (!viewfinder) return { left: 0, top: 0, width: 1, height: 1, right: 1, bottom: 1 };
  const vf = viewfinder.getBoundingClientRect();
  const stage = viewfinder.querySelector('img.stage-photo');
  const nw = stage ? stage.naturalWidth : 0;
  const nh = stage ? stage.naturalHeight : 0;
  const fit = stage
    ? (stage.style.objectFit || getComputedStyle(stage).objectFit || 'cover').toLowerCase()
    : 'cover';
  if (!nw || !nh || fit !== 'contain') return vf;
  const scale = Math.min(vf.width / nw, vf.height / nh);
  const width = nw * scale;
  const height = nh * scale;
  return {
    left: vf.left + (vf.width - width) / 2,
    top: vf.top + (vf.height - height) / 2,
    width,
    height,
    right: vf.left + (vf.width + width) / 2,
    bottom: vf.top + (vf.height + height) / 2
  };
}

// Rahmen-Overlays haben einen transparenten Innenbereich. Die Ränder werden
// aus dem Alphakanal des Overlays gemessen, damit Sticker nicht auf dem
// dekorativen Rahmen landen. Bis die Messung vorliegt, gilt ein ruhiger
// Standardrand; „Kein Rahmen“ hat keinen Rand.
const DEFAULT_OVERLAY_INSET = 5;
const NO_INSET = { left: 0, right: 0, top: 0, bottom: 0 };

function overlaySafeInsets(overlay) {
  if (!overlay) return NO_INSET;
  return overlay.safeInsets || {
    left: DEFAULT_OVERLAY_INSET,
    right: DEFAULT_OVERLAY_INSET,
    top: DEFAULT_OVERLAY_INSET,
    bottom: DEFAULT_OVERLAY_INSET
  };
}

function measureOverlaySafeArea(overlay) {
  if (!overlay || overlay.safeInsets || overlay.safeMeasure) return;
  overlay.safeMeasure = true;
  const img = new Image();
  img.onload = () => {
    overlay.safeMeasure = false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const W = canvas.width;
      const H = canvas.height;
      const data = ctx.getImageData(0, 0, W, H).data;
      const alphaAt = (x, y) => data[(y * W + x) * 4 + 3];
      const cx = W >> 1;
      const cy = H >> 1;
      let left = cx;
      let right = cx;
      let top = cy;
      let bottom = cy;
      if (alphaAt(cx, cy) < 10) {
        while (left > 0 && alphaAt(left - 1, cy) < 10) left--;
        while (right < W - 1 && alphaAt(right + 1, cy) < 10) right++;
        while (top > 0 && alphaAt(cx, top - 1) < 10) top--;
        while (bottom < H - 1 && alphaAt(cx, bottom + 1) < 10) bottom++;
        overlay.safeInsets = {
          left: (left / W) * 100,
          right: ((W - 1 - right) / W) * 100,
          top: (top / H) * 100,
          bottom: ((H - 1 - bottom) / H) * 100
        };
        if (currentOverlay === overlay) repositionStickers();
      } else {
        overlay.safeInsets = NO_INSET;
      }
    } catch (err) {
      // Bei einem nicht lesbaren Bild bleibt der Standardrand aktiv.
      console.warn('Overlay-Rahmen konnte nicht gemessen werden:', err);
    }
  };
  img.onerror = () => { overlay.safeMeasure = false; };
  img.src = overlay.src;
}

// Fotobereich abzüglich des Overlay-Rahmens: hier dürfen Sticker sitzen.
function stickerSafeRect() {
  const photo = photoStageRect();
  const ins = overlaySafeInsets(currentOverlay);
  const left = photo.left + (photo.width * ins.left) / 100;
  const top = photo.top + (photo.height * ins.top) / 100;
  const right = photo.right - (photo.width * ins.right) / 100;
  const bottom = photo.bottom - (photo.height * ins.bottom) / 100;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// Die +/−/×-Leiste sitzt normalerweise über dem Sticker. Ist dort kein
// Platz, klappt sie unter den Sticker und wird an den Fotorändern gehalten.
function positionStickerControls(st) {
  const ctrl = st.el.querySelector('.sticker__ctrl');
  if (!ctrl || !ctrl.isConnected) return;
  const frame = stickerSafeRect();
  const sr = st.el.getBoundingClientRect();
  const cw = ctrl.offsetWidth || 148;
  const ch = ctrl.offsetHeight || 44;
  const pad = 4;
  const gap = 8;
  const minLeft = frame.left + pad;
  const maxLeft = Math.max(minLeft, frame.right - pad - cw);
  let left = sr.left + sr.width / 2 - cw / 2;
  left = Math.min(maxLeft, Math.max(minLeft, left));

  let top = sr.top - ch - gap;
  if (top < frame.top + pad) top = sr.bottom + gap;
  if (top + ch > frame.bottom - pad) {
    top = Math.max(frame.top + pad, frame.bottom - pad - ch);
  }

  ctrl.style.left = (left - sr.left) + 'px';
  ctrl.style.top = (top - sr.top) + 'px';
  ctrl.style.transform = 'none';
}

function positionSticker(st) {
  const viewfinder = $camera.querySelector('.viewfinder');
  if (!viewfinder) return;
  const vf = viewfinder.getBoundingClientRect();
  const photo = photoStageRect();
  const safe = stickerSafeRect();
  const width = Math.max(1, (st.w / 100) * photo.width);

  st.el.style.width = width + 'px';
  if (st.emoji) {
    st.el.style.fontSize = Math.max(12, Math.round(width * 0.9)) + 'px';
  }

  // Sticker samt sichtbarer Fläche innerhalb der sicheren Fotofläche halten.
  // Das gilt besonders beim Vergrößern direkt am Rand und beim Rahmen.
  const height = st.el.offsetHeight || width;
  const halfW = width / 2;
  const halfH = height / 2;
  let minX = ((safe.left - photo.left) + halfW) / photo.width * 100;
  let maxX = ((safe.right - photo.left) - halfW) / photo.width * 100;
  let minY = ((safe.top - photo.top) + halfH) / photo.height * 100;
  let maxY = ((safe.bottom - photo.top) - halfH) / photo.height * 100;
  if (minX > maxX) minX = maxX = 50;
  if (minY > maxY) minY = maxY = 50;
  st.x = Math.min(maxX, Math.max(minX, st.x));
  st.y = Math.min(maxY, Math.max(minY, st.y));

  st.el.style.left = (photo.left - vf.left + (st.x / 100) * photo.width) + 'px';
  st.el.style.top = (photo.top - vf.top + (st.y / 100) * photo.height) + 'px';
  st.el.style.transform = 'translate(-50%, -50%)';
  positionStickerControls(st);
}

function repositionStickers() {
  activeStickers.forEach(positionSticker);
}

function selectSticker(st) {
  if (selectedSticker === st) return;
  deselectSticker();
  selectedSticker = st;
  st.el.classList.add('is-selected');
  const ctrl = document.createElement('div');
  ctrl.className = 'sticker__ctrl';
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  ctrl.appendChild(mk('−', t('stickerSmaller'), () => scaleSticker(st, 0.85)));
  ctrl.appendChild(mk('+', t('stickerBigger'), () => scaleSticker(st, 1.18)));
  ctrl.appendChild(mk('×', t('stickerRemove'), () => removeSticker(st)));
  st.el.appendChild(ctrl);
  requestAnimationFrame(() => positionStickerControls(st));
}

function deselectSticker() {
  if (!selectedSticker) return;
  selectedSticker.el.classList.remove('is-selected');
  const ctrl = selectedSticker.el.querySelector('.sticker__ctrl');
  if (ctrl) ctrl.remove();
  selectedSticker = null;
}

function scaleSticker(st, factor) {
  st.w = Math.min(90, Math.max(8, st.w * factor));
  positionSticker(st);
}

function removeSticker(st) {
  if (selectedSticker === st) deselectSticker();
  st.el.remove();
  activeStickers = activeStickers.filter((s) => s !== st);
}

function clearStickers() {
  deselectSticker();
  [...activeStickers].forEach((st) => st.el.remove());
  activeStickers = [];
}

$stickerPalette.addEventListener('click', (e) => {
  const btn = e.target.closest('.sticker-pick');
  if (!btn) return;
  addSticker(btn.dataset.sticker);
  // Tray schließen, damit das Foto frei bleibt; Save ist immer sichtbar.
  closeReviewTools();
});

// Klick neben den Sticker hebt die Auswahl auf
$camera.querySelector('.viewfinder').addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.sticker')) deselectSticker();
});

// Speichern aus dem Review: Foto + gewählte Farbe + Sticker auf ein Canvas
// komponieren und serverseitig am selben Storage-Key überschreiben
// (kein Papierkorb-Müll).
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

async function renderEditedPhoto(photoEl) {
  const base = await loadImg(photoEl.src);
  const canvas = document.createElement('canvas');
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext('2d');
  // Farbfilter einbrennen, Sticker danach ungefiltert zeichnen.
  const filterCss = FILTERS[currentFilter].css;
  if (filterCss !== 'none') ctx.filter = filterCss;
  ctx.drawImage(base, 0, 0);
  ctx.filter = 'none';
  // Sticker-Prozente beziehen sich auf die sichtbare Fotofläche. Beim
  // beschnittenen Cover-Bild wird der abgeschnittene Rand eingerechnet, beim
  // vollständig gezeigten Foto (Overlay) direkt auf das Bild abgebildet.
  const viewfinder = $camera.querySelector('.viewfinder');
  const frame = photoStageRect();
  const vf = viewfinder.getBoundingClientRect();
  const fit = (photoEl.style.objectFit || getComputedStyle(photoEl).objectFit || 'cover').toLowerCase();
  const cropped = fit !== 'contain';
  const mapScale = cropped
    ? Math.max(vf.width / base.naturalWidth, vf.height / base.naturalHeight)
    : frame.width / base.naturalWidth;
  const offsetX = cropped ? Math.max(0, (base.naturalWidth * mapScale - vf.width) / 2) : 0;
  const offsetY = cropped ? Math.max(0, (base.naturalHeight * mapScale - vf.height) / 2) : 0;

  for (const st of [...activeStickers]) {
    try {
      const w = ((st.w / 100) * frame.width) / mapScale;
      const x = ((st.x / 100) * frame.width + offsetX) / mapScale;
      const y = ((st.y / 100) * frame.height + offsetY) / mapScale;
      if (st.emoji) {
        ctx.save();
        ctx.font = (w * 0.92) + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(st.emoji, x, y);
        ctx.restore();
      } else {
        const si = await loadImg(st.el.querySelector('img').src);
        const h = w * (si.naturalHeight / si.naturalWidth);
        ctx.drawImage(si, x - w / 2, y - h / 2, w, h);
      }
    } catch (err) {
      console.warn('Sticker konnte nicht gerendert werden:', err);
    }
  }

  // Bild-Overlay wie in der Vorschau einbrennen: beim Fotostreifen je
  // Einzelbild, beim Einzelfoto über die volle Fotofläche.
  if (currentOverlay && currentOverlay.src) {
    try {
      const overlayImg = await loadImg(currentOverlay.src);
      if (photoEl.classList.contains('stage-photo--strip') && lastStripLayout) {
        const { w, h, pad, gap, count } = lastStripLayout;
        for (let i = 0; i < count; i++) {
          ctx.drawImage(overlayImg, pad, pad + i * (h + gap), w, h);
        }
      } else {
        ctx.drawImage(overlayImg, 0, 0, base.naturalWidth, base.naturalHeight);
      }
    } catch (err) {
      console.warn('Overlay konnte nicht gerendert werden:', err);
    }
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function saveEditedPhoto(options = {}) {
  const photoEl = $camera.querySelector('.viewfinder img.stage-photo');
  if (!photoEl) { clearStickers(); resetCameraView(); return; }
  // Original-Speicherung muss durch sein, damit wir ihren Key überschreiben können
  if (lastPhoto && lastPhoto.savePromise) {
    try { await lastPhoto.savePromise; } catch (e) { /* Fehler wurde schon gemeldet */ }
  }
  let edited;
  try {
    edited = await renderEditedPhoto(photoEl);
  } catch (err) {
    console.warn('Foto konnte nicht komponiert werden:', err);
    showToast(t('toastEditError'), { error: true });
    clearStickers();
    resetCameraView();
    return;
  }
  clearStickers();
  if (!lastPhoto || !lastPhoto.id) {
    showToast(t('toastEditErrorKeep'), { error: true });
    resetCameraView();
    return;
  }
  try {
    const res = await fetch('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: edited, id: lastPhoto.id })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (lastPhoto.card && lastPhoto.card.isConnected) {
      const cardImg = lastPhoto.card.querySelector('img');
      if (cardImg) cardImg.src = edited;
    }
    showToast(t('toastSaved'));
  } catch (err) {
    console.warn('Edited photo could not be saved:', err);
    showToast(t('toastEditedSaveError'), { error: true });
  }
  if (options.endScreen) {
    showEndScreen(edited);
  } else {
    resetCameraView();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flashCapture() {
  gsap.to($flash, { opacity: 1, duration: 0.01 });
  gsap.fromTo($flash, { opacity: 1 }, {
    opacity: 0, duration: 0.35, ease: 'power2.out', delay: 0.02
  });
}

async function runSingleCapture(runId) {
  lastStripLayout = null;
  // 1. countdown with tick sounds
  if (!(await runCountdown(runId))) return false;
  if (runId !== captureRunId) return false;

  // 2. hide viewfinder + placeholder
  await hideViewfinder();
  if (runId !== captureRunId) return false;
  gsap.to($placeholder, { opacity: 0, duration: 0.2, ease: 'power2.in' });

  // 3. flash + shutter sound
  playShutterSound();
  flashCapture();

  // 4. process photo. Im Kiosk wird der gewählte Komplett-Filter bereits
  // ins JPEG gebacken; danach wird die Auswahl für die Review-Pipeline auf
  // Standard gesetzt, damit der Filter nicht doppelt angewendet wird.
  if (!isKioskLayout()) {
    currentFilter = 'standard';
    applyFilterSelection();
  }
  showProcessing();
  await sleep(200);
  if (runId !== captureRunId) return false;
  $video.pause();
  const photoUrl = await captureFromVideo();
  if (runId !== captureRunId) return false;
  if (isKioskLayout()) {
    currentFilter = 'standard';
    applyFilterSelection();
  }

  // 5. reveal photo in stage
  if (!(await showCaptureResult(photoUrl, runId))) return false;

  // 6. add to gallery + ask for the keep/retake decision
  if (runId !== captureRunId) return false;
  captureCommitted = true;
  addToGallery(photoUrl);
  return true;
}

async function runStripCapture(runId) {
  const frames = [];
  const total = 4;

  await hideViewfinder();
  if (runId !== captureRunId) return false;
  gsap.to($placeholder, { opacity: 0, duration: 0.2, ease: 'power2.in' });

  for (let i = 0; i < total; i++) {
    if (runId !== captureRunId) return false;
    showStripProgress(i + 1, total);
    if (!(await runCountdown(runId))) {
      hideStripProgress();
      return false;
    }
    if (runId !== captureRunId) return false;
    playShutterSound();
    flashCapture();
    await sleep(120);
    if (runId !== captureRunId) return false;
    frames.push(await captureFromVideo());
    if (runId !== captureRunId) return false;
    await sleep(550);
  }
  if (runId !== captureRunId) return false;
  hideStripProgress();

  if (isKioskLayout()) {
    currentFilter = 'standard';
    applyFilterSelection();
  }
  showProcessing();
  await sleep(250);
  if (runId !== captureRunId) return false;
  $video.pause();
  const stripUrl = await composeStrip(frames);
  if (runId !== captureRunId) return false;
  if (!(await showCaptureResult(stripUrl, runId))) return false;

  if (runId !== captureRunId) return false;
  captureCommitted = true;
  addToGallery(stripUrl);
  return true;
}

async function runCaptureSequence() {
  if (currentState !== 'camera') return;
  if (isCapturing) return;
  if (!stream || !$video.srcObject) {
    showPermissionPrompt();
    return;
  }
  const runId = ++captureRunId;
  captureCommitted = false;
  isCapturing = true;
  $captureBtn.disabled = true;
  setControlsLocked(true);
  setHomeCancelMode(true);
  if ($cancelHome) $cancelHome.focus({ preventScroll: true });

  // unlock / resume audio while we still have the user gesture
  unlockAudio();

  try {
    const completed = captureMode === 'strip'
      ? await runStripCapture(runId)
      : await runSingleCapture(runId);
    if (!completed || runId !== captureRunId) return;
    showReview();
  } finally {
    // Ein abgebrochener Lauf darf einen bereits gestarteten neuen Lauf
    // nicht mehr zurücksetzen.
    if (runId !== captureRunId) return;
    isCapturing = false;
    $captureBtn.disabled = false;
    currentState = 'camera';
    setHomeCancelMode(false);
    // während des Reviews bleiben die übrigen Buttons gesperrt
    if ($review.hidden) setControlsLocked(false);
  }
}

function showStripProgress(current, total) {
  let el = document.getElementById('stripProgress');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stripProgress';
    el.className = 'strip-progress';
    el.setAttribute('aria-live', 'polite');
    $camera.querySelector('.viewfinder').appendChild(el);
  }
  el.textContent = current + ' / ' + total;
  el.classList.add('is-visible');
}

function hideStripProgress() {
  const el = document.getElementById('stripProgress');
  if (el) el.remove();
}

async function composeStrip(frames) {
  const images = await Promise.all(frames.map(loadImg));
  const w = images[0].naturalWidth || 1280;
  const h = images[0].naturalHeight || 960;
  const pad = Math.round(w * 0.035);
  const gap = Math.round(w * 0.018);
  const footer = Math.round(w * 0.075);
  lastStripLayout = { w, h, pad, gap, footer, count: images.length };
  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = pad * 2 + h * images.length + gap * (images.length - 1) + footer;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    ctx.drawImage(img, pad, pad + i * (h + gap), w, h);
  });
  ctx.fillStyle = '#111111';
  ctx.font = '700 ' + Math.round(footer * 0.5) + "px 'SF Pro Display', -apple-system, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SNAPBOX', canvas.width / 2, canvas.height - footer * 0.55);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function finishCountdown(completed) {
  if (!countdownState) return;
  const state = countdownState;
  countdownState = null;
  state.timers.forEach((id) => clearTimeout(id));
  $countdown.setAttribute('aria-hidden', 'true');
  state.resolve(completed);
}

function runCountdown(runId) {
  if (countdownState) finishCountdown(false);
  return new Promise((resolve) => {
    let count = countdownSeconds;
    const STEP_MS = 900;
    const state = { resolve, timers: [] };
    countdownState = state;

    const schedule = (fn, ms) => {
      const id = setTimeout(fn, ms);
      state.timers.push(id);
    };

    gsap.killTweensOf($countdown);
    $countdown.style.opacity = '1';
    $countdown.setAttribute('aria-hidden', 'false');

    const showTick = () => {
      if (runId !== captureRunId) {
        finishCountdown(false);
        return;
      }
      $countdown.textContent = String(count);
      playCountdownTick(count === 1);

      gsap.fromTo(
        $countdown,
        { scale: 0.35, opacity: 0, y: 0 },
        { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.2)' }
      );

      // Fade the digit out near the end of the step, but keep the timing
      // logic independent of GSAP so a throttled tab can't stall the capture.
      schedule(() => {
        gsap.to($countdown, {
          scale: 0.8,
          opacity: 0,
          duration: 0.22,
          ease: 'power2.in'
        });
      }, STEP_MS - 220);

      schedule(() => {
        count--;
        if (count >= 1) {
          showTick();
        } else {
          gsap.set($countdown, { opacity: 0 });
          finishCountdown(true);
        }
      }, STEP_MS);
    };

    showTick();
  });
}

function showProcessing() {
  gsap.to($processing, { opacity: 1, duration: 0.4, pointerEvents: 'none' });
  $processingFill.style.transition = 'width 0.8s ease';
  $processingFill.style.width = '100%';
}

async function showCaptureResult(photoUrl, runId = captureRunId) {
  if (runId !== captureRunId) return false;
  gsap.to($placeholder, { opacity: 0, duration: 0.001 });

  const img = document.createElement('img');
  img.className = 'stage-photo';
  // Ein Fotostreifen ist hochkant und würde mit "cover" beschnitten —
  // deshalb wird er vollständig (contain) gezeigt.
  const fit = captureMode === 'strip' ? 'contain' : 'cover';
  if (captureMode === 'strip') img.classList.add('stage-photo--strip');
  img.src = photoUrl;
  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: ${fit}; background: #000; opacity: 0;
    border-radius: 0; filter: grayscale(100%) contrast(1.1);
  `;
  $camera.querySelector('.viewfinder').appendChild(img);

  const tl = timeline({ defaults: { ease: 'power2.out' } });
  await tl.to($flash, { opacity: 0.9, duration: 0.01 })
    .to($flash, { opacity: 0, duration: 0.3 }, '+=0.05');
  if (runId !== captureRunId) { img.remove(); return false; }

  gsap.to(img, { opacity: 1, duration: 0.5 });
  await gsap.to(img, {
    filter: 'grayscale(0%) contrast(1)', duration: 0.7, delay: 0.2
  });
  if (runId !== captureRunId) { img.remove(); return false; }

  gsap.to($processing, { opacity: 0, duration: 0.3, delay: 0.5 });
  $processingFill.style.width = '0%';
  $processingFill.style.transition = 'none';

  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: ${fit}; background: #000; opacity: 1; border-radius: 0;
    filter: grayscale(0%) contrast(1);
  `;
  // a photo is now shown in the stage
  hasPhoto = true;
  await new Promise((r) => setTimeout(r, 300));
  if (runId !== captureRunId) {
    img.remove();
    hasPhoto = false;
    return false;
  }
  return true;
}

function resetCameraView() {
  const existingImg = $camera.querySelector('.viewfinder img.stage-photo');
  if (existingImg) existingImg.remove();
  clearStickers();
  currentOverlay = null;
  lastStripLayout = null;
  renderOverlayPreview();
  $camera.classList.remove('is-reviewing', 'is-stamping', 'is-ended');
  const endScreen = document.getElementById('endScreen');
  if (endScreen) endScreen.hidden = true;
  const reviewActions = document.getElementById('reviewActions');
  const stampActions = document.getElementById('stampActions');
  if (reviewActions) reviewActions.hidden = true;
  if (stampActions) stampActions.hidden = true;
  if (isKioskLayout()) openSideMenu('filter');
  currentFilter = 'standard';
  applyFilterSelection();

  gsap.set($processing, { opacity: 0 });
  gsap.set($flash, { opacity: 0 });
  gsap.killTweensOf($countdown);
  gsap.set($countdown, { scale: 1, opacity: 0 });
  $countdown.style.opacity = '0';

  // no photo shown anymore
  hasPhoto = false;

  // if video is active, hide placeholder; otherwise show it
  if (stream) {
    gsap.set($placeholder, { opacity: 0 });
    $video.play().catch((e) => console.warn('video.play() failed:', e)); // resume if paused/hidden
  } else {
    gsap.to($placeholder, { opacity: 1, duration: 0.3, ease: 'power2.out' });
  }

  // reset viewfinder guard so corners can re-animate
  viewfinderVisible = false;
  showViewfinder();
}


// ============================================================
//  GALLERY MANAGEMENT
// ============================================================
let lightbox = null;
let lastPhoto = null; // { card, id } of the most recent capture, used by Discard

// Schnelles Doppelklicken darf keine zweite, fehlschlagende Anfrage auslösen:
// Solange eine Operation für ein Objekt läuft, werden weitere ignoriert.
const pendingOps = new Set();
// Saves a photo in the database through the server. Failure is logged only,
// so the photo still shows in the current session.
function savePhotoToServer(photoUrl) {
  return fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: photoUrl })
  }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then((data) => {
      applyStreak(data.streak);
      return data.id;
    })
    .catch((err) => {
      console.warn('Photo could not be saved to database:', err);
      showToast(t('toastSaveError'), { error: true });
      return null;
    });
}

// Moves a photo to the trash (Papierkorb) on the server, removes its card and
// offers an undo toast. With options.permanent the object is deleted for good
// (unaccepted captures aborted via the Home button). Without a server id the
// photo was never saved, so only the card is removed.
async function deletePhoto(card, photoId, options = {}) {
  const permanent = options.permanent === true;
  if (!photoId) {
    // Noch kein Server-Objekt: Die ID kommt ggf. erst nach dem Upload. Merken,
    // damit der Save-Callback die Datei dann endgültig löscht.
    if (permanent && card) card.dataset.discardPermanent = '1';
    removeCard(card);
    return;
  }
  const key = (permanent ? 'purge:' : 'trash:') + photoId;
  if (pendingOps.has(key)) return;
  pendingOps.add(key);
  const image = card.querySelector('img') ? card.querySelector('img').src : null;
  try {
    // Die Aufbewahrungsdauer setzt der Server aus den Admin-Einstellungen.
    const query = 'id=' + encodeURIComponent(photoId) + (permanent ? '&purge=1' : '');
    const res = await fetch('/api/photos?' + query, {
      method: 'DELETE'
    });
    // 404 = bereits gelöscht/verschoben (Doppelklick-Race) — gilt als Erfolg
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    const data = res.status === 404 ? {} : await res.json();
    removeCard(card);
    // Verworfene, nie angenommene Fotos landen nicht im Papierkorb.
    if (permanent) return;
    refreshTrashCount();
    if (data.trashId) {
      showToast(t('toastTrashed'), {
        actionLabel: t('toastUndo'),
        onAction: () => restoreFromTrash(data.trashId, image)
      });
    } else {
      showToast(t('toastTrashed'));
    }
  } catch (err) {
    console.warn('Photo could not be deleted:', err);
    showToast(t('toastDeleteError'), { error: true });
  } finally {
    pendingOps.delete(key);
  }
}

// Undo path: moves the object back on the server and re-adds the card locally.
async function restoreFromTrash(trashId, image) {
  const key = 'restore:' + trashId;
  if (pendingOps.has(key)) return;
  pendingOps.add(key);
  try {
    const res = await fetch('/api/trash?id=' + encodeURIComponent(trashId), { method: 'POST' });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    const data = res.status === 404 ? {} : await res.json().catch(() => ({}));
    if (image && data.id) addToGallery(image, false, data.id);
    else loadPhotosFromServer(); // 404-Fall: Zustand vom Server nachladen
    refreshTrashCount();
    showToast(t('toastRestored'));
  } catch (err) {
    console.warn('Photo could not be restored:', err);
    showToast(t('toastRestoreError'), { error: true });
  } finally {
    pendingOps.delete(key);
  }
}

function removeCard(card) {
  if (!card.isConnected) return;
  if (lastPhoto && lastPhoto.card === card) lastPhoto = null;
  // Auch den Datensatz entfernen, sonst taucht das gelöschte Foto weiter in
  // Challenge-Zähler und Splash-Kette auf.
  if (card._photoRecord) {
    const recordIndex = photoRecords.indexOf(card._photoRecord);
    if (recordIndex !== -1) photoRecords.splice(recordIndex, 1);
    const urlIndex = photos.indexOf(card._photoRecord.url);
    if (urlIndex !== -1) photos.splice(urlIndex, 1);
  }
  card.remove();
  photoCount = Math.max(0, photoCount - 1);
  $galleryBadge.textContent = String(photoCount);
  if (!$galleryGrid.querySelector('.gallery__card')) $galleryEmpty.style.display = '';
  updateChallengeCard();
  renderSplashChain();
}

// Adds a delete button to a gallery card.
function attachDelete(card, photoId) {
  const btn = document.createElement('button');
  btn.className = 'gallery__delete';
  btn.type = 'button';
  btn.setAttribute('aria-label', t('deletePhotoAria'));
  btn.textContent = '×';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePhoto(card, photoId);
  });
  card.appendChild(btn);
}

// Loads all stored photos from the database when the page starts.
function loadPhotosFromServer() {
  return fetch('/api/photos', { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((items) => {
      items.forEach((item) => addToGallery(item.image, false, item.id));
      updateChallengeCard();
      renderSplashChain();
    })
    .catch((err) => {
      console.warn('Photos could not be loaded from database:', err);
      showToast(t('toastLoadError'), { error: true });
    });
}

function addToGallery(photoUrl, save = true, photoId = null) {
  let savePromise = null;
  if (save) {
    savePromise = savePhotoToServer(photoUrl).then((id) => {
      if (!id) return;
      card.dataset.id = id;
      if (card.isConnected) {
        attachDelete(card, id);
        // Keine Bestätigung hier: Der Gast entscheidet erst im Review
        // zwischen „Neu aufnehmen“ und „Speichern“.
      } else {
        // Vor dem Speichern verworfen: endgültig löschen, wenn es ein
        // Home-Abbruch war; sonst wie bisher in den Papierkorb.
        deletePhoto(card, id, { permanent: card.dataset.discardPermanent === '1' });
      }
      if (lastPhoto && lastPhoto.card === card) lastPhoto.id = id;
      record.id = id;
      updateChallengeCard();
      renderSplashChain();
    });
  }

  const card = document.createElement('div');
  card.className = 'gallery__card';

  const img = document.createElement('img');
  img.src = photoUrl;
  img.alt = t('capturedPhotoAlt');
  img.loading = 'lazy';
  card.appendChild(img);
  if (photoId) {
    card.dataset.id = photoId;
    attachDelete(card, photoId);
  }

  $galleryGrid.appendChild(card);
  $galleryEmpty.style.display = 'none';

  // staggered entrance
  gsap.from(card, {
    y: 30, opacity: 0, scale: 0.85,
    duration: 0.6, ease: 'back.out(1.3)'
  });

  // lightbox on click
  // Beim Klick die AKTUELLE Bildquelle lesen — nach dem Sticker-Überschreiben
  // wäre die ursprüngliche photoUrl aus dem Closure veraltet.
  card.addEventListener('click', () => openLightbox(card.querySelector('img').src, card.dataset.id || null));
  photos.push(photoUrl);
  const record = { id: photoId || null, url: photoUrl };
  photoRecords.push(record);
  card._photoRecord = record;
  if (save) lastPhoto = { card, id: null, savePromise };

  // update badge
  photoCount++;
  $galleryBadge.textContent = String(photoCount);
  $galleryBadge.classList.add('has-new');
  setTimeout(() => $galleryBadge.classList.remove('has-new'), 600);

  // success animation on gallery button
  gsap.from($galleryBtn, {
    scale: [1, 1.15, 1], duration: 0.5, ease: 'elastic.out(1, 0.6)'
  });
}

function openLightbox(photoUrl, photoId = null) {
  if (lightbox) lightbox.remove();

  lightbox = document.createElement('div');
  lightbox.className = 'lb';

  const img = document.createElement('img');
  img.src = photoUrl;
  img.alt = t('photoPreviewAlt');
  lightbox.appendChild(img);

  // QR-Übergabe: Foto per signiertem Link aufs Handy laden
  if (photoId) {
    const bar = document.createElement('div');
    bar.className = 'lb__bar';
    const qrBtn = document.createElement('button');
    qrBtn.className = 'btn btn--ghost lb__qr';
    qrBtn.type = 'button';
    qrBtn.innerHTML = `
      <span class="btn__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M17.5 17.5L21 21"></path></svg>
      </span>
      ${t('qrBtnLabel')}`;
    qrBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showQrDialog(photoId);
    });
    bar.appendChild(qrBtn);
    lightbox.appendChild(bar);
  }

  lightbox.addEventListener('click', () => {
    const tl = timeline({
      onComplete: () => { lightbox.remove(); lightbox = null; }
    });
    tl.to(img, { scale: 0.9, opacity: 0, duration: 0.3, ease: 'power2.in' })
      .to(lightbox, { opacity: 0, duration: 0.3, ease: 'power2.in' }, 0);
  });

  document.body.appendChild(lightbox);
  gsap.set(lightbox, { opacity: 0 });
  gsap.to(lightbox, { opacity: 1, duration: 0.3, ease: 'power2.out' });
  gsap.from(img, { scale: 0.85, opacity: 0, duration: 0.4, ease: 'back.out(1.2)' });
}

// ============================================================
//  STATE NAVIGATION
// ============================================================
function goTo(sectionName) {
  const sections = { splash: $splash, camera: $camera, gallery: $gallery };
  const target = sections[sectionName];
  if (!target) return;

  // hide all non-target sections immediately
  Object.values(sections).forEach((s) => {
    if (s !== target) s.style.display = 'none';
  });

  // show target with a smooth fade-in
  target.style.display = 'block';
  target.style.opacity = '0';
  gsap.to(target, { opacity: 1, duration: 0.3, ease: 'power2.out' });

  currentState = sectionName;
  syncCancelHome();

  // Der Splash-Schalter (fest unten rechts) gehört zum Startbildschirm und
  // verschwindet danach — in der Kameraansicht sitzt der zweite Schalter in
  // der Steuerleiste, in der Galerie bleibt Sprache außen vor.
  if ($splashLang) $splashLang.hidden = sectionName !== 'splash';

  if (sectionName === 'camera') {
    // init camera + reset view after fade
    gsap.delayedCall(0.3, () => {
      initCamera();
      resetCameraView();
    });
  }
}

// ============================================================
//  FEEDBACK: toasts (Systemstatus-Meldungen)
// ============================================================
const $toasts = document.getElementById('toasts');

// Zeigt eine kurze Statusmeldung. Optionen:
// { actionLabel, onAction, error, duration } — mit Aktion (z. B. Rückgängig)
// bleibt der Toast länger stehen.
function showToast(message, options = {}) {
  const {
    actionLabel = null,
    onAction = null,
    error = false,
    duration = actionLabel ? 6000 : 3000
  } = options;

  const toast = document.createElement('div');
  toast.className = 'toast' + (error ? ' toast--error' : '');

  const msg = document.createElement('span');
  msg.className = 'toast__msg';
  msg.textContent = message;
  toast.appendChild(msg);

  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    gsap.to(toast, { opacity: 0, y: 10, duration: 0.25, ease: 'power2.in', onComplete: () => toast.remove() });
  };

  if (actionLabel) {
    const action = document.createElement('button');
    action.className = 'toast__action';
    action.type = 'button';
    action.textContent = actionLabel;
    action.addEventListener('click', () => { hide(); if (onAction) onAction(); });
    toast.appendChild(action);
  }

  $toasts.appendChild(toast);
  gsap.from(toast, { y: 16, opacity: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
  setTimeout(hide, duration);
  return hide;
}

// ============================================================
//  CONFIRM MODAL (nur für endgültiges, unwiederbringliches Löschen)
// ============================================================
const $confirmModal = document.getElementById('confirmModal');
const $confirmTitle = document.getElementById('confirmTitle');
const $confirmText = document.getElementById('confirmText');
const $confirmOk = document.getElementById('confirmOk');
const $confirmCancel = document.getElementById('confirmCancel');
let confirmResolve = null;

// Löst mit true (bestätigt) oder false (abgebrochen).
// Optionaler Text, damit derselbe Dialog auch das Verwerfen eines noch nicht
// angenommenen Fotos absichern kann.
function askConfirm(options = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $confirmTitle.textContent = options.title || t('confirmTitle');
    $confirmText.textContent = options.text || t('confirmText');
    $confirmOk.textContent = options.ok || t('confirmOk');
    $confirmCancel.textContent = options.cancel || t('confirmCancel');
    $confirmModal.hidden = false;
    gsap.from($confirmModal.querySelector('.modal__card'), {
      y: 24, opacity: 0, scale: 0.96, duration: 0.3, ease: 'power2.out', clearProps: 'all'
    });
    $confirmCancel.focus();
  });
}

function closeConfirm(result) {
  if (!confirmResolve) return;
  $confirmModal.hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve(result);
}

$confirmOk.addEventListener('click', () => closeConfirm(true));
$confirmCancel.addEventListener('click', () => closeConfirm(false));
$confirmModal.addEventListener('click', (e) => { if (e.target === $confirmModal) closeConfirm(false); });

// ============================================================
//  PAPIERKORB (trash view)
// ============================================================
const $trashToggle = document.getElementById('trashToggle');
const $trashBadge = document.getElementById('trashBadge');
const $trashView = document.getElementById('trashView');
const $trashGrid = document.getElementById('trashGrid');
const $trashEmpty = document.getElementById('trashEmpty');

let trashOpen = false;
let trashItems = []; // { id, image, expiresAt }
let trashVersion = 0; // lokale Änderungen invalidieren noch laufende loadTrash-Antworten

// Mülleimer-Zähler am Galerie-Header — erst ab 1 sichtbar (0 = Rauschen).
// Zählt serverseitig ohne die Bilder selbst zu laden.
function refreshTrashCount() {
  fetch('/api/trash/count', { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((data) => {
      $trashBadge.hidden = data.count < 1;
      $trashBadge.textContent = String(data.count);
    })
    .catch(() => { /* Zähler ist optional — still ignorieren */ });
}

function toggleTrash(force = !trashOpen) {
  trashOpen = force;
  $trashToggle.classList.toggle('active', trashOpen);
  $trashView.hidden = !trashOpen;
  $galleryGrid.style.display = trashOpen ? 'none' : '';
  $galleryEmpty.style.display = trashOpen
    ? 'none'
    : ($galleryGrid.querySelector('.gallery__card') ? 'none' : '');
  if (trashOpen) loadTrash();
}

function loadTrash() {
  const version = trashVersion;
  fetch('/api/trash', { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((items) => {
      // Antwort veraltet? Zwischenzeitlich wurde lokal gelöscht/wiederhergestellt —
      // sonst würde sie den aktuelleren Zustand überschreiben.
      if (version !== trashVersion) return;
      trashItems = items;
      renderTrash();
    })
    .catch((err) => {
      console.warn('Trash could not be loaded:', err);
      showToast(t('trashLoadError'), { error: true });
    });
}

function renderTrash() {
  $trashGrid.innerHTML = '';
  trashItems.forEach((item) => $trashGrid.appendChild(buildTrashCard(item)));
  $trashEmpty.style.display = trashItems.length ? 'none' : '';
}

function trashDaysLeftLabel(expiresAt) {
  if (!expiresAt) return '';
  const daysLeft = Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 86400000));
  return daysLeft === 1 ? t('trashDaysLeftOne') : t('trashDaysLeftMany', { n: daysLeft });
}

function buildTrashCard(item) {
  const card = document.createElement('div');
  card.className = 'trash__card';

  const img = document.createElement('img');
  img.src = item.image;
  img.alt = t('trashImgAlt');
  img.loading = 'lazy';
  card.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'trash__meta';

  const days = document.createElement('span');
  days.className = 'trash__days';
  days.textContent = trashDaysLeftLabel(item.expiresAt);
  meta.appendChild(days);

  const actions = document.createElement('div');
  actions.className = 'trash__actions';

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'trash__btn trash__btn--restore';
  restoreBtn.type = 'button';
  restoreBtn.textContent = t('trashRestoreBtn');
  restoreBtn.addEventListener('click', () => restoreTrashedPhoto(item));
  actions.appendChild(restoreBtn);

  const purgeBtn = document.createElement('button');
  purgeBtn.className = 'trash__btn trash__btn--purge';
  purgeBtn.type = 'button';
  purgeBtn.textContent = t('trashPurgeBtn');
  // Nur die wirklich zerstörerische Aktion fragt nach — das Trash-Löschen
  // selbst bleibt ohne Dialog und über den Toast rückgängig machbar.
  purgeBtn.addEventListener('click', async () => {
    if (await askConfirm()) purgeTrashedPhoto(item);
  });
  actions.appendChild(purgeBtn);

  meta.appendChild(actions);
  card.appendChild(meta);
  return card;
}

async function restoreTrashedPhoto(item) {
  const key = 'restore:' + item.id;
  if (pendingOps.has(key)) return;
  pendingOps.add(key);
  // Karte sofort entfernen (optimistisch) — verhindert auch Doppelklick-Racen
  trashVersion++;
  trashItems = trashItems.filter((t) => t.id !== item.id);
  renderTrash();
  try {
    const res = await fetch('/api/trash?id=' + encodeURIComponent(item.id), { method: 'POST' });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    const data = res.status === 404 ? {} : await res.json().catch(() => ({}));
    if (data.id) addToGallery(item.image, false, data.id);
    else loadPhotosFromServer(); // 404-Fall: Zustand vom Server nachladen
    refreshTrashCount();
    showToast(t('toastRestored'));
  } catch (err) {
    trashVersion++;
    trashItems.push(item); // optimistic removal zurückrollen
    renderTrash();
    console.warn('Photo could not be restored:', err);
    showToast(t('toastRestoreError2'), { error: true });
  } finally {
    pendingOps.delete(key);
  }
}

async function purgeTrashedPhoto(item) {
  const key = 'purge:' + item.id;
  if (pendingOps.has(key)) return;
  pendingOps.add(key);
  trashVersion++;
  trashItems = trashItems.filter((t) => t.id !== item.id);
  renderTrash();
  try {
    const res = await fetch('/api/trash?id=' + encodeURIComponent(item.id), { method: 'DELETE' });
    // 404 = bereits endgültig gelöscht — gilt ebenfalls als Erfolg
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    refreshTrashCount();
    showToast(t('toastPurged'));
  } catch (err) {
    trashVersion++;
    trashItems.push(item); // optimistic removal zurückrollen
    renderTrash();
    console.warn('Photo could not be purged:', err);
    showToast(t('toastPurgeError'), { error: true });
  } finally {
    pendingOps.delete(key);
  }
}

// ============================================================
//  SOUND
// ============================================================
// A single shared AudioContext is created lazily from a user gesture.
// Creating a new context per shot is unreliable and Chrome may leave it
// suspended, which is why the original shutter stayed silent.
let audioCtx = null;
let noiseBuffer = null;

// Real shutter recording (camera-shutter.mp3). It is fetched right away and
// decoded into the shared AudioContext on the first user gesture, so the
// recording is ready long before the capture button is pressed.
const SHUTTER_SRC = 'assets/audio/camera-shutter.mp3';
let shutterBytes = null;      // raw file data, fetched at load
let shutterBuffer = null;     // decoded AudioBuffer, ready for playback
let shutterLoadPromise = null;
let shutterDecodePromise = null;

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioCtx();
    } catch (e) {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function unlockAudio() {
  // Must be called from inside a click/keydown handler.
  const ctx = getAudioContext();
  if (ctx) prepareShutterSound(ctx);
}

// Fetch the recording once. Runs at page load, so the bytes are cached by the
// time the user presses "start".
function preloadShutterSound() {
  if (shutterLoadPromise) return shutterLoadPromise;
  shutterLoadPromise = fetch(SHUTTER_SRC)
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then((bytes) => {
      shutterBytes = bytes;
      return bytes;
    })
    .catch((err) => {
      console.warn('Shutter MP3 could not be loaded, using synthesized fallback:', err);
      return null;
    });
  return shutterLoadPromise;
}

// The recording starts with ~1.2 s of silence. Playing that untouched would
// put the click over a second after the flash, so cut the silence away while
// keeping a short pre/post roll for a natural attack and tail.
function trimSilence(buffer, ctx, threshold = 0.02, preRoll = 0.01, postRoll = 0.06) {
  const channels = buffer.numberOfChannels;
  const data = buffer.getChannelData(0);
  let first = -1;
  let last = -1;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > threshold) { first = i; break; }
  }
  for (let i = data.length - 1; i >= 0; i--) {
    if (Math.abs(data[i]) > threshold) { last = i; break; }
  }
  if (first < 0 || last <= first) return buffer;

  const rate = buffer.sampleRate;
  const startIdx = Math.max(0, first - Math.floor(preRoll * rate));
  const endIdx = Math.min(data.length, last + Math.floor(postRoll * rate));
  const length = endIdx - startIdx;
  if (length >= data.length) return buffer;

  const trimmed = ctx.createBuffer(channels, length, rate);
  for (let c = 0; c < channels; c++) {
    trimmed.copyToChannel(buffer.getChannelData(c).subarray(startIdx, endIdx), c);
  }
  return trimmed;
}

// Decoding needs an AudioContext, so this runs after the first gesture.
function prepareShutterSound(ctx) {
  if (shutterBuffer || !ctx) return Promise.resolve(shutterBuffer);
  if (shutterDecodePromise) return shutterDecodePromise;
  shutterDecodePromise = (async () => {
    try {
      const bytes = shutterBytes || (await preloadShutterSound());
      if (!bytes) return null;
      // decodeAudioData detaches its input, so hand it a copy.
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      shutterBuffer = trimSilence(decoded, ctx);
      return shutterBuffer;
    } catch (err) {
      console.warn('Shutter MP3 could not be decoded, using synthesized fallback:', err);
      return null;
    } finally {
      shutterDecodePromise = null;
    }
  })();
  return shutterDecodePromise;
}

function getNoiseBuffer(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.2);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// One mechanical shutter strike: a bright noise snap, a short metallic
// ring from the mechanism and a low body thump. Layering those three gives
// the dry "ka-chak" of a real camera instead of a generic beep/thud.
function playShutterStrike(ctx, when, opts) {
  const {
    level,
    noiseFreq,
    q,
    decay,
    ringFreq,
    thumpFreq,
    thumpLevel,
    thumpDecay
  } = opts;

  // 1. broadband snap of the mirror/shutter blades
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = noiseFreq;
  band.Q.value = q;

  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = noiseFreq * 0.5;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, when);
  noiseGain.gain.exponentialRampToValueAtTime(level, when + 0.0015);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

  noise.connect(band).connect(high).connect(noiseGain).connect(ctx.destination);
  noise.start(when);
  noise.stop(when + decay + 0.02);

  // 2. tiny metallic ring — the spring/blade resonance that reads as "camera"
  const ring = ctx.createOscillator();
  const ringGain = ctx.createGain();
  ring.type = 'triangle';
  ring.frequency.setValueAtTime(ringFreq, when);
  ring.frequency.exponentialRampToValueAtTime(ringFreq * 0.82, when + 0.028);
  ringGain.gain.setValueAtTime(0.0001, when);
  ringGain.gain.exponentialRampToValueAtTime(level * 0.22, when + 0.002);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  ring.connect(ringGain).connect(ctx.destination);
  ring.start(when);
  ring.stop(when + 0.035);

  // 3. body thump so the click has some weight
  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(thumpFreq, when);
  thump.frequency.exponentialRampToValueAtTime(thumpFreq * 0.55, when + thumpDecay);
  thumpGain.gain.setValueAtTime(0.0001, when);
  thumpGain.gain.exponentialRampToValueAtTime(thumpLevel, when + 0.003);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + thumpDecay);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(when);
  thump.stop(when + thumpDecay + 0.01);
}

// A DSLR shutter is two strikes: mirror up, then shutter close.
// Only used when the MP3 is unavailable (offline first run, decode error).
function playSynthShutter(ctx) {
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  // a tiny random gap keeps repeated shots from sounding machine-identical
  const gap = 0.075 + Math.random() * 0.01;
  try {
    // first strike: mirror swings up — heavier, more body
    playShutterStrike(ctx, now, {
      level: 0.85,
      noiseFreq: 2500,
      q: 0.9,
      decay: 0.045,
      ringFreq: 2300,
      thumpFreq: 220,
      thumpLevel: 0.26,
      thumpDecay: 0.06
    });
    // second strike: shutter closes — sharper, brighter snap
    playShutterStrike(ctx, now + gap, {
      level: 0.55,
      noiseFreq: 4200,
      q: 0.8,
      decay: 0.03,
      ringFreq: 3300,
      thumpFreq: 180,
      thumpLevel: 0.14,
      thumpDecay: 0.04
    });
  } catch (e) {
    /* audio not available */
  }
}

// Plays the recorded shutter. Returns true when the real MP3 was used, and
// falls back to the synthesized shutter so a shot is never silent.
// ============================================================
//  SOUND: An/Aus-Schalter
// ============================================================
const $soundToggle = document.getElementById('soundToggle');
const $splashSound = document.getElementById('splashSound');
let soundEnabled = localStorage.getItem('soundEnabled') !== '0';

function applySoundState() {
  [$soundToggle, $splashSound].forEach((btn) => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(soundEnabled));
    btn.setAttribute('aria-label', soundEnabled ? t('soundOn') : t('soundOff'));
    btn.querySelectorAll('.sound-on').forEach((el) => { el.style.display = soundEnabled ? '' : 'none'; });
    btn.querySelectorAll('.sound-off').forEach((el) => { el.style.display = soundEnabled ? 'none' : ''; });
  });
}
applySoundState();

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled ? '1' : '0');
  applySoundState();
}
$soundToggle.addEventListener('click', toggleSound);
if ($splashSound) $splashSound.addEventListener('click', toggleSound);

function playShutterSound(ctx = getAudioContext()) {
  if (!soundEnabled) return false;
  if (!ctx) return false;

  if (shutterBuffer) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = shutterBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain).connect(ctx.destination);
      src.start(ctx.currentTime + 0.005);
      return true;
    } catch (e) {
      /* fall through to the synth */
    }
  }

  // Not decoded yet (e.g. very first shot after a cold start): warm it up for
  // the next shot, and use the synth so this one is not silent.
  prepareShutterSound(ctx);
  playSynthShutter(ctx);
  return false;
}

function playCountdownTick(isFinal) {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isFinal ? 1320 : 880, t);
    osc.frequency.exponentialRampToValueAtTime(isFinal ? 1760 : 1040, t + 0.09);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.21);
  } catch (e) {
    /* audio not available */
  }
}


// ============================================================
//  EVENT LISTENERS
// ============================================================
document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => {
    const action = el.dataset.action;
    switch (action) {
      case 'start':
        startSession();
        break;
      case 'capture':
        runCaptureSequence();
        break;
      case 'gallery':
        if (currentState === 'camera' && !isCapturing) {
          const img = $camera.querySelector('.viewfinder img.stage-photo');
          if (img) img.remove();
          clearStickers();
          gsap.to($camera, {
            opacity: 0, duration: 0.3, ease: 'power2.in',
            onComplete: () => {
              $camera.style.display = 'none';
              goTo('gallery');
              refreshTrashCount();
            }
          });
        }
        break;
      case 'back-camera':
        // Back kehrt genau EINE Ebene zurück: Papierkorb -> Fotoliste -> Kamera.
        // Ein Sprung über zwei Ebenen verstößt gegen das gelernte Back-Modell.
        if (trashOpen) {
          toggleTrash(false);
          break;
        }
        gsap.to($gallery, {
          opacity: 0, duration: 0.3, ease: 'power2.in',
          onComplete: () => { $gallery.style.display = 'none'; goTo('camera'); }
        });
        break;
      case 'toggle-trash':
        if (currentState === 'gallery') toggleTrash();
        break;
      case 'retry-camera':
        initCamera();
        break;
    }
  });
});



// ============================================================
//  KIOSK-FLOW (UX-SKIZZEN): Seitenmenü, Overlays, Sticker, Endscreen
// ============================================================
const $sideMenu = document.getElementById('sideMenu');
const $sideMenuHead = document.getElementById('sideMenuHead');
const $sideMenuTabs = document.getElementById('sideMenuTabs');
const $sideMenuList = document.getElementById('sideMenuList');
const $sideScrollUp = document.getElementById('sideScrollUp');
const $sideScrollDown = document.getElementById('sideScrollDown');
const $endScreen = document.getElementById('endScreen');
const $cancelHome = document.getElementById('cancelHome');

const SIDE_CONFIG = {
  filter: {
    head: 'sideFilter',
    defaultTab: 'face',
    tabs: [['face', 'tabFace'], ['all', 'tabAll']]
  },
  overlay: {
    head: 'sideOverlay',
    defaultTab: 'standard',
    tabs: [['standard', 'tabStandard'], ['event', 'tabEvent'], ['uni', 'tabUni']]
  },
  stamp: {
    head: 'sideStamp',
    defaultTab: 'emoji',
    tabs: [['emoji', 'tabEmoji'], ['uni', 'tabUni']]
  }
};

let sideContext = 'filter';
let sideTab = 'face';
let currentOverlay = null;
// Bildpixel-Layout des zuletzt erzeugten Fotostreifens, damit das Overlay in
// der Vorschau und im gespeicherten Foto je Einzelbild sitzt.
let lastStripLayout = null;
let stampSnapshot = [];
let endPhotoUrl = null;

// Bild-Overlays im 16:9-Format (1280×720, transparente Bildmitte). Sie liegen
// deckungsgleich über dem Foto und werden beim Speichern mit eingebrannt.
const OVERLAY_DIR = 'assets/overlays/';
const NO_OVERLAY_ID = 'none';
// Leeres, durchgestrichenes 16:9-Feld als Vorschau für „Kein Rahmen“.
const NO_OVERLAY_THUMB = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 36">'
  + '<rect x="2" y="2" width="60" height="32" rx="4" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-dasharray="5 4"/>'
  + '<path d="M18 27 46 9" stroke="#fff" stroke-opacity=".8" stroke-width="3" stroke-linecap="round"/>'
  + '</svg>'
);
const NO_OVERLAY_OPTION = { id: NO_OVERLAY_ID, labelKey: 'overlayNone', src: NO_OVERLAY_THUMB };
const OVERLAYS = {
  standard: [
    { id: 'color-frame', labelKey: 'overlayColorFrame', src: OVERLAY_DIR + 'standard-farbrahmen.png' },
    { id: 'white-frame', labelKey: 'overlayWhiteFrame', src: OVERLAY_DIR + 'standard-weiss.png' },
    { id: 'stripes-h', labelKey: 'overlayStripesH', src: OVERLAY_DIR + 'standard-streifen-horizontal.png' },
    { id: 'stripes-v', labelKey: 'overlayStripesV', src: OVERLAY_DIR + 'standard-streifen-vertikal.png' }
  ],
  event: [
    { id: 'cobooo-urg', label: 'CoBOOOurg', src: OVERLAY_DIR + 'event-cobooo-urg.png' },
    { id: 'pumpkins-ahead', label: 'Pumpkins ahead', src: OVERLAY_DIR + 'event-pumpkins-ahead.png' },
    { id: 'scary-season', label: 'Scary season', src: OVERLAY_DIR + 'event-scary-season.png' },
    { id: 'cozy-campus-time', label: 'Cozy campus time', src: OVERLAY_DIR + 'event-cozy-campus-time.png' },
    { id: 'cozy-november', label: 'Cozy november', src: OVERLAY_DIR + 'event-cozy-november.png' }
  ],
  uni: [
    { id: 'uni-co-frame', label: 'CO-Rahmen', src: OVERLAY_DIR + 'uni-rahmen-co.png' },
    { id: 'uni-come-together', label: 'Come together', src: OVERLAY_DIR + 'uni-come-together.png' },
    { id: 'uni-cool-to-be-here', label: 'Cool to be here', src: OVERLAY_DIR + 'uni-cool-to-be-here.png' },
    { id: 'uni-coffee-chaos', label: 'Coffee & chaos', src: OVERLAY_DIR + 'uni-coffee-chaos.png' },
    { id: 'uni-core-memory', label: 'Core memory', src: OVERLAY_DIR + 'uni-core-memory.png' },
    { id: 'uni-lcc', label: 'LCC', src: OVERLAY_DIR + 'uni-lcc.png' },
    { id: 'uni-co-white', label: 'CO weiß', src: OVERLAY_DIR + 'uni-co-white.png' }
  ]
};

const STAMPS = {
  emoji: [
    { glyph: '❤️' }, { glyph: '🔥' }, { glyph: '⭐' }, { glyph: '🎉' },
    { glyph: '😎' }, { glyph: '✨' }, { glyph: '👻' }, { glyph: '🎃' }
  ],
  uni: [
    { glyph: '🎓' }, { glyph: '📚' }, { glyph: '🍻' },
    { glyph: '🧪' }, { glyph: '🏛️' }, { glyph: '🎒' }
  ]
};

function photoTimestamp(id) {
  const match = /^photos\/(\d+)-/.exec(String(id || ''));
  return match ? Number(match[1]) : null;
}

function themeKeyForNow() {
  const month = new Date().getMonth();
  if (month === 9) return 'themeHalloween';
  if (month === 11) return 'themeWinter';
  return 'themeDefault';
}

function updateChallengeCard() {
  const countEl = document.getElementById('challengeCount');
  if (!countEl) return;
  const now = new Date();
  const count = photoRecords.filter((record) => {
    const ts = photoTimestamp(record.id);
    if (!ts) return false;
    const date = new Date(ts);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  countEl.textContent = String(count);
  const goal = document.getElementById('challengeGoal');
  if (goal) goal.textContent = '42';
  const unit = document.getElementById('challengePhotos');
  if (unit) unit.textContent = t('challengePhotos');
  const days = document.getElementById('challengeDays');
  if (days) {
    days.textContent = daysLeft === 0
      ? t('challengeLastDay')
      : (daysLeft === 1 ? t('challengeDaysOne') : t('challengeDays', { n: daysLeft }));
  }
  const theme = document.getElementById('challengeTheme');
  if (theme) theme.textContent = t(themeKeyForNow());
}

function renderSplashChain() {
  const chain = document.getElementById('splashChain');
  if (!chain) return;
  const urls = photoRecords.slice(-10).map((record) => record.url).filter(Boolean);
  chain.innerHTML = '';
  if (!urls.length) return;
  const track = document.createElement('div');
  track.className = 'splash__chain-track';
  // Zwei Kopien, damit die -50%-Animation nahtlos umläuft.
  urls.concat(urls).forEach((url) => {
    const card = document.createElement('div');
    card.className = 'splash__chain-card';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    card.appendChild(img);
    track.appendChild(card);
  });
  chain.appendChild(track);
}

function sideConfig() {
  return SIDE_CONFIG[sideContext] || SIDE_CONFIG.filter;
}

function openSideMenu(context, tab) {
  if (!SIDE_CONFIG[context] || !$sideMenu) return;
  sideContext = context;
  const config = SIDE_CONFIG[context];
  const wanted = tab || config.defaultTab;
  sideTab = config.tabs.some((pair) => pair[0] === wanted) ? wanted : config.defaultTab;
  $sideMenu.dataset.context = context;
  $sideMenuHead.textContent = t(config.head);
  renderSideTabs();
  renderSideMenu();
}

function renderSideTabs() {
  if (!$sideMenuTabs) return;
  $sideMenuTabs.innerHTML = '';
  sideConfig().tabs.forEach(([id, labelKey]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-tab';
    btn.dataset.tab = id;
    btn.setAttribute('role', 'tab');
    const active = id === sideTab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.textContent = t(labelKey);
    btn.addEventListener('click', () => {
      sideTab = id;
      renderSideTabs();
      renderSideMenu();
    });
    $sideMenuTabs.appendChild(btn);
  });
}

function renderSideMenu() {
  if (!$sideMenuList) return;
  $sideMenuList.innerHTML = '';

  if (sideContext === 'filter' && sideTab === 'face') {
    const filters = window.SnapBoxFilters ? window.SnapBoxFilters.FILTERS : [];
    filters.forEach((filter) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'side-menu__item';
      btn.dataset.value = filter.id;
      btn.setAttribute('role', 'option');
      const active = !!filterEngine && filterEngine.getFilter() === filter.id;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-selected', String(active));
      if (filter.emoji) {
        const emoji = document.createElement('span');
        emoji.className = 'side-menu__emoji';
        emoji.textContent = filter.emoji;
        btn.appendChild(emoji);
      }
      const label = document.createElement('span');
      label.textContent = faceLabel(filter);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        if (!filterEngine) return;
        filterEngine.setFilter(filter.id);
        updateSideSelection();
      });
      $sideMenuList.appendChild(btn);
    });
  } else if (sideContext === 'filter') {
    const labels = { standard: 'filterStandard', sw: 'filterSw', vintage: 'filterVintage', knackig: 'filterKnackig' };
    Object.keys(FILTERS).forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'side-menu__item side-menu__item--overlay';
      btn.dataset.value = id;
      btn.setAttribute('role', 'option');
      const active = currentFilter === id;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-selected', String(active));
      btn.textContent = t(labels[id] || id);
      btn.addEventListener('click', () => {
        currentFilter = id;
        applyFilterSelection();
        updateSideSelection();
      });
      $sideMenuList.appendChild(btn);
    });
  } else if (sideContext === 'overlay') {
    [NO_OVERLAY_OPTION, ...(OVERLAYS[sideTab] || [])].forEach((overlay) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'side-menu__item side-menu__item--overlay';
      btn.dataset.value = overlay.id;
      btn.setAttribute('role', 'option');
      const isNone = overlay.id === NO_OVERLAY_ID;
      const active = isNone ? !currentOverlay : (!!currentOverlay && currentOverlay.id === overlay.id);
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-selected', String(active));
      const thumb = document.createElement('span');
      thumb.className = 'side-menu__thumb';
      const thumbImg = document.createElement('img');
      thumbImg.src = overlay.src;
      thumbImg.alt = '';
      thumbImg.loading = 'lazy';
      thumb.appendChild(thumbImg);
      btn.appendChild(thumb);
      const label = document.createElement('span');
      label.className = 'side-menu__label';
      label.textContent = overlayLabel(overlay);
      btn.appendChild(label);
      btn.addEventListener('click', () => setOverlay(overlay.id));
      $sideMenuList.appendChild(btn);
    });
  } else if (sideContext === 'stamp') {
    (STAMPS[sideTab] || []).forEach((stamp) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'side-menu__item';
      btn.setAttribute('aria-label', stamp.glyph);
      const glyph = document.createElement('span');
      glyph.className = 'side-menu__glyph';
      glyph.textContent = stamp.glyph;
      btn.appendChild(glyph);
      btn.addEventListener('click', () => addEmojiStamp(stamp.glyph));
      $sideMenuList.appendChild(btn);
    });
  }

  requestAnimationFrame(updateScrollHints);
}

function updateSideSelection() {
  if (!$sideMenuList) return;
  $sideMenuList.querySelectorAll('.side-menu__item').forEach((el) => {
    const value = el.dataset.value;
    let active = false;
    if (sideContext === 'filter' && sideTab === 'face') {
      active = !!filterEngine && filterEngine.getFilter() === value;
    } else if (sideContext === 'filter') {
      active = currentFilter === value;
    } else if (sideContext === 'overlay') {
      active = value === NO_OVERLAY_ID ? !currentOverlay : (!!currentOverlay && currentOverlay.id === value);
    }
    el.classList.toggle('is-selected', active);
    el.setAttribute('aria-selected', String(active));
  });
}

function updateScrollHints() {
  const viewport = document.querySelector('.side-menu__viewport');
  if (!viewport || !$sideScrollUp || !$sideScrollDown) return;
  $sideScrollUp.classList.toggle('is-enabled', viewport.scrollTop > 2);
  $sideScrollDown.classList.toggle('is-enabled', viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2);
}

if ($sideScrollUp) {
  $sideScrollUp.addEventListener('click', () => {
    const viewport = document.querySelector('.side-menu__viewport');
    if (viewport) viewport.scrollBy({ top: -viewport.clientHeight * 0.8, behavior: 'smooth' });
  });
}
if ($sideScrollDown) {
  $sideScrollDown.addEventListener('click', () => {
    const viewport = document.querySelector('.side-menu__viewport');
    if (viewport) viewport.scrollBy({ top: viewport.clientHeight * 0.8, behavior: 'smooth' });
  });
}
const $sideViewport = document.querySelector('.side-menu__viewport');
if ($sideViewport) $sideViewport.addEventListener('scroll', updateScrollHints, { passive: true });
window.addEventListener('resize', () => {
  updateScrollHints();
  repositionStickers();
});

function overlayLabel(overlay) {
  return overlay.labelKey ? t(overlay.labelKey) : overlay.label;
}

function findOverlay(id) {
  return Object.keys(OVERLAYS)
    .reduce((all, key) => all.concat(OVERLAYS[key]), [])
    .find((overlay) => overlay.id === id) || null;
}

function setOverlay(id) {
  if (id === NO_OVERLAY_ID) {
    currentOverlay = null;
    renderOverlayPreview();
    updateSideSelection();
    repositionStickers();
    return;
  }
  const found = findOverlay(id);
  currentOverlay = currentOverlay && currentOverlay.id === id ? null : (found || null);
  renderOverlayPreview();
  updateSideSelection();
  repositionStickers();
}

function renderOverlayPreview() {
  const viewfinder = $camera.querySelector('.viewfinder');
  if (!viewfinder) return;
  viewfinder.querySelectorAll('.photo-overlay, .photo-overlay-strip').forEach((el) => el.remove());
  // Der orange Review-Rahmen würde den Overlay-Rahmen überdecken.
  $camera.classList.toggle('has-overlay', !!currentOverlay);
  const stage = viewfinder.querySelector('img.stage-photo');
  if (!currentOverlay) {
    // Ohne Overlay wieder randlos wie bisher.
    if (stage && !stage.classList.contains('stage-photo--strip')) stage.style.objectFit = 'cover';
    return;
  }
  if (!stage) return;
  measureOverlaySafeArea(currentOverlay);

  // Ist das Foto noch nicht dekodiert, wären die Maße 0 und das Overlay
  // würde unsichtbar in der Ecke sitzen. Nach dem Laden neu berechnen.
  if (!stage.naturalWidth || !stage.naturalHeight) {
    stage.style.objectFit = 'contain';
    if (!stage.dataset.overlayLoadHooked) {
      stage.dataset.overlayLoadHooked = '1';
      stage.addEventListener('load', () => {
        delete stage.dataset.overlayLoadHooked;
        if (currentOverlay) {
          renderOverlayPreview();
          repositionStickers();
        }
      }, { once: true });
    }
    return;
  }

  // Fotostreifen werden vollständig (contain) gezeigt. Das Overlay wird
  // deshalb je Einzelbild platziert, nicht über den ganzen Streifen gezogen.
  if (stage.classList.contains('stage-photo--strip') && lastStripLayout && stage.naturalWidth) {
    const vf = viewfinder.getBoundingClientRect();
    const scale = Math.min(vf.width / stage.naturalWidth, vf.height / stage.naturalHeight);
    const displayW = stage.naturalWidth * scale;
    const displayH = stage.naturalHeight * scale;
    const { w, h, pad, gap, footer, count } = lastStripLayout;
    const totalW = w + pad * 2;
    const totalH = pad * 2 + h * count + gap * (count - 1) + footer;
    const wrap = document.createElement('div');
    wrap.className = 'photo-overlay-strip';
    wrap.style.left = Math.round((vf.width - displayW) / 2) + 'px';
    wrap.style.top = Math.round((vf.height - displayH) / 2) + 'px';
    wrap.style.width = Math.round(displayW) + 'px';
    wrap.style.height = Math.round(displayH) + 'px';
    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.src = currentOverlay.src;
      img.alt = '';
      img.style.left = ((pad / totalW) * 100) + '%';
      img.style.top = (((pad + i * (h + gap)) / totalH) * 100) + '%';
      img.style.width = ((w / totalW) * 100) + '%';
      img.style.height = ((h / totalH) * 100) + '%';
      wrap.appendChild(img);
    }
    viewfinder.appendChild(wrap);
    return;
  }

  // Einzelfoto: Für die Auswahl wird das ganze Foto gezeigt (contain), damit
  // der Rahmen ringsum sichtbar ist; das Overlay deckt exakt diese Fläche.
  stage.style.objectFit = 'contain';
  const img = document.createElement('img');
  img.className = 'photo-overlay';
  img.src = currentOverlay.src;
  img.alt = '';
  const vf = viewfinder.getBoundingClientRect();
  if (stage.naturalWidth && stage.naturalHeight && vf.width && vf.height) {
    const fit = Math.min(vf.width / stage.naturalWidth, vf.height / stage.naturalHeight);
    const w = stage.naturalWidth * fit;
    const h = stage.naturalHeight * fit;
    img.style.left = Math.round((vf.width - w) / 2) + 'px';
    img.style.top = Math.round((vf.height - h) / 2) + 'px';
    img.style.width = Math.round(w) + 'px';
    img.style.height = Math.round(h) + 'px';
  } else {
    // Bühne noch nicht vermessen (z. B. direkt nach dem Aufbau): erst die
    // volle Fläche nutzen und nach dem nächsten Layout neu berechnen.
    img.style.width = '100%';
    img.style.height = '100%';
    requestAnimationFrame(() => {
      if (!currentOverlay) return;
      const rect = viewfinder.getBoundingClientRect();
      if (rect.width && rect.height) renderOverlayPreview();
    });
  }
  viewfinder.appendChild(img);
}

function addEmojiStamp(glyph) {
  const el = document.createElement('div');
  el.className = 'sticker sticker--emoji';
  const span = document.createElement('span');
  span.textContent = glyph;
  span.setAttribute('aria-hidden', 'true');
  el.appendChild(span);

  // Neue Sticker leicht versetzt platzieren, damit sie nicht exakt stapeln.
  const step = (activeStickers.length % 3) - 1;
  const st = { el, x: 50 + step * 9, y: 38 + step * 8, w: 12, emoji: glyph };
  $camera.querySelector('.viewfinder').appendChild(el);
  activeStickers.push(st);
  positionSticker(st);

  el.addEventListener('pointerdown', (e) => {
    // Tippen auf die Größen-/Löschen-Buttons darf keinen Drag starten:
    // sonst springt der Sticker beim Touch-Tap auf die Button-Position.
    if (e.target.closest('.sticker__ctrl')) return;
    e.preventDefault();
    e.stopPropagation();
    selectSticker(st);
    const frame = photoStageRect();
    const move = (ev) => {
      st.x = ((ev.clientX - frame.left) / frame.width) * 100;
      st.y = ((ev.clientY - frame.top) / frame.height) * 100;
      positionSticker(st);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  selectSticker(st);
}

function openStampMode() {
  if (!hasPhoto) return;
  stampSnapshot = activeStickers.slice();
  $camera.classList.add('is-stamping');
  const actions = document.getElementById('reviewActions');
  const stampActions = document.getElementById('stampActions');
  if (actions) actions.hidden = true;
  if (stampActions) stampActions.hidden = false;
  openSideMenu('stamp', 'emoji');
  const done = document.getElementById('stampDone');
  if (done) done.focus();
}

function closeStampMode(keep) {
  if (!keep) {
    [...activeStickers].forEach((st) => {
      if (!stampSnapshot.includes(st)) removeSticker(st);
    });
  }
  stampSnapshot = [];
  $camera.classList.remove('is-stamping');
  const actions = document.getElementById('reviewActions');
  const stampActions = document.getElementById('stampActions');
  if (actions) actions.hidden = false;
  if (stampActions) stampActions.hidden = true;
  if (isKioskLayout()) openSideMenu('overlay');
}

function deleteSelectedStamp() {
  if (selectedSticker) { removeSticker(selectedSticker); return; }
  if (activeStickers.length) removeSticker(activeStickers[activeStickers.length - 1]);
}

const $landscapeStamp = document.getElementById('landscapeStamp');
if ($landscapeStamp) $landscapeStamp.addEventListener('click', openStampMode);
const $stampCancel = document.getElementById('stampCancel');
if ($stampCancel) $stampCancel.addEventListener('click', () => closeStampMode(false));
const $stampDone = document.getElementById('stampDone');
if ($stampDone) $stampDone.addEventListener('click', () => closeStampMode(true));
const $stampDelete = document.getElementById('stampDelete');
if ($stampDelete) $stampDelete.addEventListener('click', deleteSelectedStamp);

function showEndScreen(url) {
  endPhotoUrl = url;
  const wrap = document.getElementById('endPhoto');
  if (wrap) {
    wrap.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = t('photoPreviewAlt');
    wrap.appendChild(img);
  }
  if ($endScreen) $endScreen.hidden = false;
  $camera.classList.add('is-ended');
  $camera.classList.remove('is-reviewing', 'is-stamping');
  setHomeMode('done');
  syncCancelHome();
  if ($cancelHome) $cancelHome.focus({ preventScroll: true });
}

function returnToIdle() {
  resetGuestCaptureSettings();
  if ($endScreen) $endScreen.hidden = true;
  $camera.classList.remove('is-ended', 'is-reviewing', 'is-stamping');
  setHomeMode('default');
  clearStickers();
  currentOverlay = null;
  lastStripLayout = null;
  renderOverlayPreview();
  resetCameraView();
  $gallery.style.display = 'none';
  $camera.style.display = 'none';
  $splash.style.display = 'flex';
  // Beim Start wurden Brand, Challenge-Karte und Ton-Button ausgeblendet;
  // für den nächsten Gast müssen sie wieder sichtbar sein.
  gsap.set(['.splash__brand', '.challenge-card', '.splash__sound', '.splash__content--kiosk'], { clearProps: 'all' });
  gsap.fromTo($splash, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' });
  gsap.fromTo('.splash__content--kiosk', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', delay: 0.1, clearProps: 'all' });
  currentState = 'splash';
  syncCancelHome();
  if ($splashLang) $splashLang.hidden = false;
  applyLanguage(defaultLang);
  updateChallengeCard();
  renderSplashChain();
}

async function shareEndPhoto() {
  if (!endPhotoUrl) return;
  try {
    const blob = await (await fetch(endPhotoUrl)).blob();
    const file = new File([blob], 'snapbox.jpg', { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'SnapBox' });
      return;
    }
  } catch (err) {
    /* Web Share nicht verfügbar — Download-Fallback */
  }
  const link = document.createElement('a');
  link.href = endPhotoUrl;
  link.download = 'snapbox.jpg';
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast(t('toastDownloaded'));
}

function printEndPhoto() {
  if (!endPhotoUrl) return;
  const win = window.open('', '_blank');
  if (!win) {
    showToast(t('toastPrintBlocked'), { error: true });
    return;
  }
  win.document.write('<!doctype html><html><head><title>SnapBox</title><style>'
    + 'html,body{margin:0;height:100%;background:#fff}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + 'img{max-width:100%;max-height:100vh;object-fit:contain}'
    + '</style></head><body><img src="' + endPhotoUrl + '" onload="window.print()"></body></html>');
  win.document.close();
}

document.querySelectorAll('.endscreen__action').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.end === 'qr') {
      if (lastPhoto && lastPhoto.id) showQrDialog(lastPhoto.id);
      else showToast(t('qrNotSaved'), { error: true });
    } else if (btn.dataset.end === 'insta') {
      shareEndPhoto();
    } else if (btn.dataset.end === 'print') {
      printEndPhoto();
    }
  });
});
if ($cancelHome) {
  $cancelHome.addEventListener('click', async () => {
    if (isCapturing) {
      cancelCapture();
      return;
    }
    if (!$confirmModal.hidden) return;

    // Vor „Annehmen“ gibt es noch kein bestätigtes Foto. Der Weg zum Start
    // verwirft es deshalb nicht still, sondern fragt vorher nach.
    const inReview = $camera.classList.contains('is-reviewing') || $camera.classList.contains('is-stamping');
    if (inReview && hasPhoto) {
      const confirmed = await askConfirm({
        title: t('discardTitle'),
        text: t('discardText'),
        ok: t('discardConfirm'),
        cancel: t('discardCancel')
      });
      if (!confirmed) {
        $cancelHome.focus();
        return;
      }
      discardUnacceptedPhoto();
    }
    resetToStartScreen();
  });
}
// Swipe up auf dem Startbildschirm (Touch) plus Klick auf die Affordance.
let splashGestureStart = null;
$splash.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#splashStart')) return;
  splashGestureStart = { x: e.clientX, y: e.clientY };
});
$splash.addEventListener('pointerup', (e) => {
  if (!splashGestureStart) return;
  const dy = e.clientY - splashGestureStart.y;
  const dx = e.clientX - splashGestureStart.x;
  splashGestureStart = null;
  if (dy < -60 && Math.abs(dx) < 140) startSession();
});

// ============================================================
//  VOLLBILD (Tastatur)
//  Shift+F schaltet ein und wieder aus. Esc und das Schließen-Symbol des
//  Browsers bleiben als Sicherheitsausgang erhalten — die Seite kann sie
//  technisch nicht abschalten.
// ============================================================
function toggleFullscreen() {
  const fail = () => showToast(t('toastFullscreenError'), { error: true });
  if (document.fullscreenElement) {
    try {
      const exit = document.exitFullscreen ? document.exitFullscreen() : null;
      if (exit && typeof exit.catch === 'function') exit.catch(fail);
    } catch (err) {
      fail();
    }
    return;
  }
  const root = document.documentElement;
  if (!root.requestFullscreen) {
    fail();
    return;
  }
  try {
    const request = root.requestFullscreen();
    if (request && typeof request.then === 'function') {
      request.then(() => showToast(t('toastFullscreenOn'))).catch(fail);
    } else {
      showToast(t('toastFullscreenOn'));
    }
  } catch (err) {
    fail();
  }
}

// ============================================================
//  INIT
// ============================================================
window.addEventListener('load', () => {
  applyLanguage(defaultLang);
  // Alte Gästeauswahl aus früheren Versionen darf nicht in die erste
  // Sitzung nach dem Laden hineinreichen.
  resetGuestCaptureSettings();
  animateSplashIn();
  loadPhotosFromServer();
  loadStreak();
  updateChallengeCard();
  renderSplashChain();
  if (isKioskLayout()) openSideMenu('filter');

  // Fetch the shutter recording up front; it is decoded on the first gesture.
  preloadShutterSound();

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const onButton = !!(target && target.closest && target.closest('button, [role="button"]'));

    // Vollbild ein/aus — unabhängig vom aktuellen Screen.
    if (e.code === 'KeyF' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    if (e.key === ' ' && currentState === 'splash') {
      e.preventDefault();
      startSession();
      return;
    }

    if ((e.key === ' ' || e.key === 'Enter') && currentState === 'camera' && !onButton
      && !$camera.classList.contains('is-reviewing')
      && !$camera.classList.contains('is-ended')) {
      e.preventDefault();
      unlockAudio(); // keyboard activation is a gesture too
      runCaptureSequence();
      return;
    }

    if ((e.key === 'g' || e.key === 'G') && currentState === 'camera'
      && !$camera.classList.contains('is-reviewing')
      && !$camera.classList.contains('is-ended')
      && $qrModal.hidden && $confirmModal.hidden) {
      e.preventDefault();
      $galleryBtn.click();
      return;
    }

    if (e.key === 'Escape') {
      if (isCapturing) { e.preventDefault(); cancelCapture(); return; }
      if (!$qrModal.hidden) { closeQrDialog(); return; }
      if (!$confirmModal.hidden) { closeConfirm(false); return; }
      if (!$endScreen.hidden) { returnToIdle(); return; }
      if ($camera.classList.contains('is-reviewing')) { retakePhoto(); return; }
      if (trashOpen) { toggleTrash(false); return; }
      if (lightbox) { lightbox.remove(); lightbox = null; }
      if (currentState === 'gallery') {
        gsap.to($gallery, {
          opacity: 0, duration: 0.3, ease: 'power2.in',
          onComplete: () => { $gallery.style.display = 'none'; goTo('camera'); }
        });
      }
    }
  });
});

// lightbox styles injected at runtime
const style = document.createElement('style');
style.textContent = `
  .lb {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.9);
    z-index: 9999;
  }
  .lb img {
    max-width: 90vw; max-height: 90vh;
    border-radius: var(--radius-sm);
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.8);
  }
  .lb__bar {
    position: absolute;
    bottom: 28px;
    left: 0; right: 0;
    display: flex;
    justify-content: center;
  }
  .lb__qr {
    background: rgba(10 10 10 / 0.72);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
`;
document.head.appendChild(style);

// ============================================================
//  INAKTIVITÄTS-RESET (Kiosk)
//  Nach dem Foto (Endscreen) 40 s, mitten im Ablauf 75 s. 15 s vor
//  dem Rücksprung erscheint ein Countdown, den jeder Tipp oder
//  Tastendruck abbricht.
// ============================================================
const $idleWarning = document.getElementById('idleWarning');
const $idleCount = document.getElementById('idleCount');
const $idleStay = document.getElementById('idleStay');

const IDLE_WARN_MS = 15000;
const IDLE_END_MS = 40000;
const IDLE_PROCESS_MS = 75000;

let idleDeadline = 0;
let idleWarnUntil = 0;
let idleWarnVisible = false;
let idleStateKey = 'splash';

function currentIdleStateKey() {
  if (currentState === 'splash') return 'splash';
  if ($qrModal && !$qrModal.hidden) return 'qr';
  if ($confirmModal && !$confirmModal.hidden) return 'confirm';
  if (lightbox) return 'lightbox';
  if (trashOpen) return 'trash';
  if ($endScreen && !$endScreen.hidden) return 'end';
  if (currentState === 'gallery') return 'gallery';
  if ($camera.classList.contains('is-reviewing') || $camera.classList.contains('is-stamping')) return 'review';
  return 'camera';
}

function idleTimeoutFor(key) {
  if (key === 'splash') return 0;
  return key === 'end' ? IDLE_END_MS : IDLE_PROCESS_MS;
}

function resetIdleDeadline() {
  const key = currentIdleStateKey();
  const timeout = idleTimeoutFor(key);
  idleStateKey = key;
  idleDeadline = timeout ? Date.now() + timeout : 0;
}

function hideIdleWarning() {
  if (!idleWarnVisible) return;
  idleWarnVisible = false;
  if ($idleWarning) $idleWarning.hidden = true;
}

function showIdleWarning() {
  if (!$idleWarning) return;
  idleWarnVisible = true;
  idleWarnUntil = Date.now() + IDLE_WARN_MS;
  if ($idleCount) $idleCount.textContent = String(Math.round(IDLE_WARN_MS / 1000));
  $idleWarning.hidden = false;
  gsap.fromTo(
    $idleWarning.querySelector('.idle-warning__card'),
    { y: 16, opacity: 0, scale: 0.96 },
    { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out', clearProps: 'all' }
  );
}

function resetToStartScreen() {
  hideIdleWarning();
  if ($qrModal && !$qrModal.hidden) closeQrDialog();
  if ($confirmModal && !$confirmModal.hidden) closeConfirm(false);
  if (lightbox) { lightbox.remove(); lightbox = null; }
  if (trashOpen) toggleTrash(false);
  returnToIdle();
  idleStateKey = 'splash';
  idleDeadline = 0;
}

// Jede echte Eingabe zählt als Aktivität. Während der Warnung wird die
// Eingabe geschluckt, damit sie nicht zusätzlich eine App-Aktion auslöst.
function noteIdleActivity(e) {
  if (idleWarnVisible) {
    if (e && e.type === 'keydown') {
      e.preventDefault();
      e.stopPropagation();
    }
    hideIdleWarning();
  }
  resetIdleDeadline();
}

window.addEventListener('pointerdown', noteIdleActivity, true);
window.addEventListener('keydown', noteIdleActivity, true);
window.addEventListener('wheel', noteIdleActivity, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetIdleDeadline();
});

if ($idleStay) {
  $idleStay.addEventListener('click', () => {
    hideIdleWarning();
    resetIdleDeadline();
  });
}

resetIdleDeadline();

setInterval(() => {
  if (document.hidden) return;

  const key = currentIdleStateKey();
  if (key !== idleStateKey) {
    hideIdleWarning();
    resetIdleDeadline();
    return;
  }

  // Während der Aufnahme nicht unterbrechen; die Frist läuft danach weiter.
  if (isCapturing) {
    idleDeadline = Date.now() + idleTimeoutFor(key);
    return;
  }

  if (!idleDeadline) {
    if (idleWarnVisible) hideIdleWarning();
    return;
  }

  const now = Date.now();
  if (!idleWarnVisible) {
    if (now >= idleDeadline) showIdleWarning();
    return;
  }

  const left = Math.max(0, Math.ceil((idleWarnUntil - now) / 1000));
  if ($idleCount && $idleCount.textContent !== String(left)) $idleCount.textContent = String(left);
  if (now >= idleWarnUntil) resetToStartScreen();
}, 250);

