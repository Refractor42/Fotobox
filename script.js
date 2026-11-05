/* ============================================================
   SnapBox — Photobox Interaction Logic
   ============================================================ */

const gsap = window.gsap;
const { timeline } = gsap;
const PHOTO_WIDTH = 1920;
const PHOTO_HEIGHT = 1080;

// --- DOM references ---
const $splash        = document.getElementById('splash');
const $camera        = document.getElementById('camera');
const $gallery       = document.getElementById('gallery');
const $countdown     = document.getElementById('countdown');
const $flash         = document.getElementById('flash');
const $captureBtn    = document.getElementById('captureBtn');
const $processing    = document.getElementById('processing');
const $placeholder   = $camera.querySelector('.camera__placeholder');
const $viewfinderFrame = $camera.querySelector('.viewfinder__frame');
const $corners       = $camera.querySelectorAll('.viewfinder__corner');
const $galleryGrid   = document.getElementById('galleryGrid');
const $galleryEmpty  = document.getElementById('galleryEmpty');
const $galleryLoadMoreWrap = document.getElementById('galleryLoadMoreWrap');
const $galleryLoadMore = document.getElementById('galleryLoadMore');
const $video         = document.getElementById('cameraVideo');
const $permission    = document.getElementById('permission');
const $streakPill    = document.getElementById('streakPill');
const $streakCount   = document.getElementById('streakCount');
let currentStreak = 0;
let lastPhotoTimestamp = null;

const photos = [];
// Wie photos, aber mit Server-ID — für Splash-Kette und Galerie.
const photoRecords = [];
// Alle Server-IDs ohne Bilddaten: hält Gesamtzahl und Challenge-Zähler
// korrekt, auch wenn nur eine Fotoseite geladen ist.
const photoIndexIds = [];

// --- State ---
let currentState = 'splash';
// Merkt sich, von wo die Galerie geöffnet wurde. Der Zurück-Weg führt
// dadurch zum Startbildschirm, zum Endscreen oder in die Kamera — nie
// pauschal an einen anderen Ort.
let galleryReturnState = 'camera';
let hasPhoto = false;
let photoCount = 0;
let videoPlaying = false;
let viewfinderVisible = false;
let isCapturing = false;
let isSavingPhoto = false;
let captureRunId = 0;
let captureCommitted = false;
let captureTaskCancel = null;
let captureFlash = null;
let capturePrint = null;
let processingTimer = 0;
let processingRevision = 0;
let countdownState = null;
let sessionCompletion = null;

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
    challengeVersus: '{home} gegen {away}',
    challengeEntries: 'Teilnahmen für {location}',
    challengeDaysOne: 'noch 1 Tag',
    challengeDays: 'noch {n} Tage',
    challengeLastDay: 'letzter Tag',
    themeJan: 'Neuer Start',
    themeFeb: 'Liebe & Winter',
    themeMar: 'Frühlingswachen',
    themeApr: 'Bunt & Verrückt',
    themeMay: 'Blütenpracht',
    themeJun: 'Sommer-Vibes',
    themeJul: 'Strand & Sonne',
    themeAug: 'Heiße Nächte',
    themeSep: 'Goldener Herbst',
    themeOct: 'Halloween & Laub',
    themeNov: 'Gemütlichkeit',
    themeDec: 'Winterzauber',
    themeHalloween: 'Halloween Motive',
    themeWinter: 'Winterzauber',
    themeDefault: 'Monatsmotiv',
    endChallengeKicker: 'MONATS-CHALLENGE',
    endChallengeQuestion: 'Foto für {location} einreichen?',
    endChallengeHint: 'Dein Foto erscheint in der Web-App. Jeder Like bringt dem Team Extrapunkte.',
    endChallengeQrOnly: 'Web-App per QR öffnen — Einreichen wird im Admin freigeschaltet.',
    challengeThemeLabel: 'Motto:',
    challengeThemePrompt: 'Schieße ein Foto zum Thema {theme}',
    endChallengeYes: 'Ja, mitmachen',
    endChallengeNo: 'Nein, danke',
    endChallengeSubmitting: 'Wird eingereicht…',
    endChallengeSubmitted: 'Dabei! Dein Foto steht jetzt in der Challenge-Galerie.',
    endChallengeDeclined: 'Nicht eingereicht. Vielleicht beim nächsten Foto.',
    endChallengeError: 'Einreichung hat nicht geklappt. Bitte noch einmal tippen.',
    endChallengeQrLabel: 'Web-App',
    endChallengeQrHint: 'Scannen & liken',
    endChallengeQrAria: 'QR-Code zur Web-App mit Leaderboard und Challenge-Galerie',
    captionMode: 'MODUS',
    modeGroupAria: 'Aufnahmemodus',
    modeSingle: 'Einzelfoto',
    modeStrip: 'Fotocollage',
    startHomeAria: 'Zum Startbildschirm',
    startHomeLabel: 'Start',
    endHomeAria: 'Zurück zum Start',
    captureCancel: 'Abbrechen',
    captureCancelAria: 'Aufnahme abbrechen',
    acceptAria: 'Bearbeitung fertigstellen',
    btnAccept: 'Fertig',
    btnDone: 'Zurück zum Start',
    endQr: 'QR-Code',
    endPrint: 'Drucken',
    sideFilter: 'Filter',
    sideOverlay: 'Overlay',
    sideStamp: 'Sticker',
    sideMenuAria: 'Filter, Overlay und Sticker',
    sideMenuTabsAria: 'Bereich wählen',
    sideMenuToggleOpen: 'Menü',
    sideMenuToggleClose: 'Schließen',
    tabFace: 'Gesicht',
    tabAll: 'Komplett',
    tabStandard: 'Standard',
    tabEvent: 'Event',
    tabEmoji: 'Emojis',
    tabUni: 'Hochschule',
    stickerShapes: 'Aufkleber',
    stickersNeedPhoto: 'Mach zuerst ein Foto — danach kannst du Sticker platzieren.',
    stickerEmojiAria: 'Emoji {emoji} hinzufügen',
    stickerOhren: 'Katzenohren',
    stickerKrone: 'Krone',
    stickerBrille: 'Sonnenbrille',
    stickerHut: 'Partyhut',
    scrollHint: 'scrollen',
    sideMenuShowAria: 'Menü öffnen: Filter, Overlay und Sticker',
    sideMenuHideAria: 'Menü schließen',
    barOptions: 'Einstellungen',
    barFilters: 'Filter',
    barFiltersShowAria: 'Filter anzeigen',
    barFiltersHideAria: 'Filter schließen',
    barMenuAria: 'Filter wählen',
    barFilterReset: 'Zurücksetzen',
    barFrames: 'Rahmen',
    barFramesShowAria: 'Rahmen anzeigen',
    barFramesHideAria: 'Rahmen schließen',
    barOptionsAria: 'Countdown und Modus einstellen',
    scrollUpAria: 'Nach oben scrollen',
    scrollDownAria: 'Nach unten scrollen',
    overlayNone: 'Kein Rahmen',
    overlaySizeMismatch: 'Dieser Rahmen passt nur auf Aufnahmen mit {width} \u00d7 {height} Pixeln.',
    permissionResolutionHint: 'Dieser Rahmen ben\u00f6tigt eine Kamera mit 1920 \u00d7 1080 Pixeln. W\u00e4hle eine Kamera, die dieses Aufnahmeformat unterst\u00fctzt.',
    overlayColorFrame: 'Farbrahmen',
    overlayWhiteFrame: 'Weißer Rahmen',
    overlayStripesH: 'Horizontale Streifen',
    overlayStripesV: 'Vertikale Streifen',
    filterStandard: 'Standard',
    filterNone: 'Keine Filter',
    filtersNoneActive: 'Keine Filter aktiv',
    filterRemoveHint: 'Erneut tippen zum Entfernen',
    filterVintage: 'Vintage',
    toastDownloaded: 'Foto heruntergeladen.',
    toastPrintBlocked: 'Druckfenster wurde blockiert — bitte Pop-ups erlauben.',
    toastNoPrinter: 'Kein Drucker eingerichtet — bitte in Windows einen Drucker als Standard festlegen.',
    toastVirtualPrinter: '„{name}“ ist ein PDF-Drucker. Bitte einen echten Drucker als Standard festlegen.',
    toastPrinterOffline: 'Der Drucker „{name}“ ist offline.',
    toastPrinterUnknown: 'Druckerstatus konnte nicht geprüft werden.',
    toastFullscreenOn: 'Vollbild an — Shift+F zum Verlassen',
    toastFullscreenError: 'Vollbild konnte nicht geöffnet werden.',
    processing: 'Foto wird erfasst \u2026',
    idleResetTitle: 'Hey, bist du noch da?',
    idleResetText: 'Zurück zum Start in',
    idleResetStay: 'Irgendwo tippen zum Bleiben',
    permissionText: 'Kamerazugriff für SnapBox erforderlich',
    permissionHint: 'Dauerhaft blockiert? Erlaube die Kamera in den Browser-Einstellungen (Schloss-Symbol in der Adressleiste) und lade die Seite neu.',
    permissionBtn: 'Kamera erlauben',
    permissionOpening: 'Kamera wird geöffnet…',
    permissionRequestingHint: 'Bitte im Browser-Dialog „Zulassen“ wählen. Falls kein Dialog erscheint, ist die Kamera für diese Seite blockiert.',
    permissionDeniedHint: 'Der Browser blockiert die Kamera. Öffne die Kamera-Freigabe über das Schloss-Symbol in der Adressleiste und lade die Seite danach neu.',
    permissionNoDeviceHint: 'Keine Kamera gefunden. Prüfe, ob die Kamera angeschlossen und eingeschaltet ist, und versuche es erneut.',
    permissionBusyHint: 'Die Kamera wird gerade von einer anderen App benutzt. Schließe diese App und versuche es erneut.',
    permissionConstraintHint: 'Die gewählte Kamera ist nicht verfügbar. Prüfe die Kamera-Auswahl im Admin-Panel und versuche es erneut.',
    permissionInsecureHint: 'Kamera braucht eine sichere Verbindung. Öffne die Fotobox über https://localhost:8443 oder starte sie mit Fotobox-Kiosk.cmd.',
    permissionFailedHint: 'Die Kamera konnte nicht geöffnet werden. Prüfe die Browser-Einstellungen und versuche es erneut.',
    captionFace: 'GESICHTSFILTER',
    captionTimer: 'COUNTDOWN',
    captionTimerMenu: 'COUNT\u00adDOWN',
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
    reviewHint: 'Sticker antippen, ziehen und mit +/− in der Größe ändern.',
    stickerDragHint: 'Sticker ziehen · +/− für Größe',
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
    stickerDate: 'Datum',
    stickerTime: 'Uhrzeit',
    stickerDateAria: 'Datum als Sticker hinzufügen',
    stickerTimeAria: 'Uhrzeit als Sticker hinzufügen',
    stickerTextGroup: 'Datum & Uhrzeit',
    stickerSmaller: 'Sticker verkleinern',
    stickerBigger: 'Sticker vergrößern',
    stickerRemove: 'Sticker entfernen',
    stickerClearAll: 'Alle Sticker löschen',
    galleryBtn: 'Galerie',
    galleryOpenAria: 'Galerie öffnen',
    galleryTitle: 'Deine Fotos',
    galleryLoadMore: 'Mehr laden',
    galleryLoading: 'Wird geladen…',
    galleryEmpty: 'Noch keine Fotos — mach dein erstes Foto!',
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
    qrTtlHours: 'Link ist {n} Stunden gültig.',
    qrTtlHour: 'Link ist 1 Stunde gültig.',
    qrTtlDays: 'Link ist {n} Tage gültig.',
    qrTtlDay: 'Link ist 1 Tag gültig.',
    qrRetry: 'Erneut versuchen',
    qrCopy: 'Link kopieren',
    qrCopied: 'Link kopiert.',
    qrCopyError: 'Link konnte nicht kopiert werden.',
    qrNotSaved: 'Foto ist noch nicht gespeichert.',
    qrSvgAria: 'QR-Code zum Herunterladen des Fotos',
    toastSaved: 'Foto gespeichert.',
    toastCaptureCancelled: 'Aufnahme abgebrochen.',
    toastSaveError: 'Foto konnte nicht gespeichert werden — Verbindung prüfen.',
    toastCaptureError: 'Aufnahme fehlgeschlagen. Bitte erneut versuchen.',
    toastEditError: 'Änderungen konnten nicht gespeichert werden.',
    toastEditErrorKeep: 'Änderungen konnten nicht gespeichert werden — Foto bleibt unverändert.',
    toastEditedSaveError: 'Bearbeitetes Foto konnte nicht gespeichert werden — Original bleibt erhalten.',
    toastDeleteError: 'Foto konnte nicht gelöscht werden — Verbindung prüfen.',
    toastDeleteSessionOnly: 'Fotos lassen sich nur während einer laufenden Sitzung löschen.',
    toastDeleted: 'Foto gelöscht.',
    toastEditAction: 'Wiederherstellen und zurück zum Bearbeiten',
    toastRestoreAction: 'Wiederherstellen',
    toastLoadError: 'Gespeicherte Fotos konnten nicht geladen werden.',
    capturedPhotoAlt: 'Aufgenommenes Foto',
    photoPreviewAlt: 'Foto-Vorschau',
    deletePhotoAria: 'Foto löschen',
    langGroupAria: 'Sprache wählen',
    soundOn: 'Ton ausschalten',
    soundOff: 'Ton einschalten',
    soundLabel: 'Audio',
    galleryLabel: 'Galerie',
    settingsOpenLabel: 'Barrierefreiheit',
    settingsTitle: 'Barrierefreiheit',
    settingsOpenAria: 'Barrierefreiheit öffnen',
    accessibilityButtons: 'Buttongröße',
    accessibilityButtonsNormal: 'Normal',
    accessibilityButtonsLarge: 'Groß',
    accessibilityText: 'Schriftgröße',
    accessibilityTextNormal: 'Normal',
    accessibilityTextLarge: 'Groß',
    settingsCloseAria: 'Zurück',
    sessionCompleted: 'Aufnahme abgeschlossen',
    sessionCompletionError: 'Die Sitzung konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
    cvdHint: 'Farbmodus für Sehschwächen',
    a11yResetHint: 'Wird am Startbildschirm automatisch nach {seconds} Sekunden zurückgesetzt.',
    cvdGroupLabel: 'Farbmodus',
    cvdStandard: 'Standard',
    cvdStandardNote: 'Volles Farbspektrum (Normales Sehen)',
    cvdProtan: 'Rot-Grün-Schwäche (Typ 1)',
    cvdProtanNote: 'Protanopie — Rotschwäche\n(angepasste Helligkeit)',
    cvdDeuter: 'Rot-Grün-Schwäche (Typ 2)',
    cvdDeuterNote: 'Deuteranopie — Grünschwäche\n(natürliche Helligkeit)',
    cvdTritan: 'Blau-Gelb-Schwäche',
    cvdTritanNote: 'Tritanopie',
    cvdMono: 'Monochrom',
    cvdMonoNote: 'Graustufen (Achromatopsie)',
    streakAriaOne: 'Foto-Streak: 1 Tag, {s}',
    streakAriaMany: 'Foto-Streak: {n} Tage, {s}',
    streakTaken: 'Foto heute gemacht',
    streakNone: 'heute noch kein Foto',
    faceNone: 'Original',
    faceBig: 'Große Augen + Mund',
    faceFaceswap: 'Gesichtertausch',
    faceThug: 'Thug Life',
    faceMlg: 'MLG',
    faceShades: 'Pixelbrille',
    faceBoss: 'Gangster-Cap',
    faceBling: 'Goldkette',
    faceJoint: 'Joint',
    faceCheeky: 'Freches Grinsen',
    faceUnibrow: 'Monobraue',
    faceCat: 'Katze',
    faceBunny: 'Häschen',
    faceHearts: 'Herzen',
    faceMakeup: 'Schminke',
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
    challengeVersus: '{home} vs. {away}',
    challengeEntries: 'Entries for {location}',
    challengeDaysOne: '1 day left',
    challengeDays: '{n} days left',
    challengeLastDay: 'last day',
    themeJan: 'Fresh start',
    themeFeb: 'Love & winter',
    themeMar: 'Spring awakening',
    themeApr: 'Colorful & wild',
    themeMay: 'Blossom time',
    themeJun: 'Summer vibes',
    themeJul: 'Beach & sun',
    themeAug: 'Hot nights',
    themeSep: 'Golden autumn',
    themeOct: 'Halloween & leaves',
    themeNov: 'Cozy season',
    themeDec: 'Winter magic',
    themeHalloween: 'Halloween motifs',
    themeWinter: 'Winter magic',
    themeDefault: 'Theme of the month',
    endChallengeKicker: 'MONTHLY CHALLENGE',
    endChallengeQuestion: 'Submit this photo for {location}?',
    endChallengeHint: 'Your photo appears in the web app. Every like adds extra points for the team.',
    endChallengeQrOnly: 'Open the web app by QR — submissions are enabled in the admin panel.',
    challengeThemeLabel: 'Theme:',
    challengeThemePrompt: 'Take a photo on the theme of {theme}',
    endChallengeYes: 'Yes, join in',
    endChallengeNo: 'No, thanks',
    endChallengeSubmitting: 'Submitting…',
    endChallengeSubmitted: 'You are in! Your photo is now in the challenge gallery.',
    endChallengeDeclined: 'Not submitted. Maybe the next photo.',
    endChallengeError: 'Submission failed. Please tap again.',
    endChallengeQrLabel: 'Web app',
    endChallengeQrHint: 'Scan & like',
    endChallengeQrAria: 'QR code for the web app with leaderboard and challenge gallery',
    captionMode: 'MODE',
    modeGroupAria: 'Capture mode',
    modeSingle: 'Single photo',
    modeStrip: 'Photo collage',
    startHomeAria: 'Home — go to start screen',
    startHomeLabel: 'Home',
    endHomeAria: 'Back to start',
    captureCancel: 'Cancel',
    captureCancelAria: 'Cancel capture',
    acceptAria: 'Finish editing',
    btnAccept: 'Done',
    btnDone: 'Back to start',
    endQr: 'QR Code',
    endPrint: 'Print',
    sideFilter: 'Filters',
    sideOverlay: 'Overlays',
    sideStamp: 'Stickers',
    sideMenuAria: 'Filters, overlays and stickers',
    sideMenuTabsAria: 'Choose section',
    sideMenuToggleOpen: 'Menu',
    sideMenuToggleClose: 'Close',
    tabFace: 'Face',
    tabAll: 'Full image',
    tabStandard: 'Standard',
    tabEvent: 'Event',
    tabEmoji: 'Emojis',
    tabUni: 'University',
    stickerShapes: 'Sticker shapes',
    stickersNeedPhoto: 'Take a photo first — then you can place stickers.',
    stickerEmojiAria: 'Add {emoji} emoji',
    stickerOhren: 'Cat ears',
    stickerKrone: 'Crown',
    stickerBrille: 'Sunglasses',
    stickerHut: 'Party hat',
    scrollHint: 'scroll',
    sideMenuShowAria: 'Open menu: filters, overlays and stickers',
    sideMenuHideAria: 'Close menu',
    barOptions: 'Settings',
    barFilters: 'Filters',
    barFiltersShowAria: 'Show filters',
    barFiltersHideAria: 'Close filters',
    barMenuAria: 'Choose a filter',
    barFilterReset: 'Reset',
    barFrames: 'Frames',
    barFramesShowAria: 'Show frames',
    barFramesHideAria: 'Close frames',
    barOptionsAria: 'Adjust countdown and mode',
    scrollUpAria: 'Scroll up',
    scrollDownAria: 'Scroll down',
    overlayNone: 'No frame',
    overlaySizeMismatch: 'This frame requires a photo of {width} \u00d7 {height} pixels.',
    permissionResolutionHint: 'This frame requires a camera supporting 1920 \u00d7 1080 pixels. Select a camera that supports this capture format.',
    overlayColorFrame: 'Color frame',
    overlayWhiteFrame: 'White frame',
    overlayStripesH: 'Horizontal stripes',
    overlayStripesV: 'Vertical stripes',
    filterStandard: 'Standard',
    filterNone: 'No filters',
    filtersNoneActive: 'No active filters',
    filterRemoveHint: 'Tap again to remove',
    filterVintage: 'Vintage',
    toastDownloaded: 'Photo downloaded.',
    toastPrintBlocked: 'Print window was blocked — please allow pop-ups.',
    toastNoPrinter: 'No printer set up — please set a printer as default in Windows.',
    toastVirtualPrinter: '“{name}” is a PDF printer. Please set a real printer as default.',
    toastPrinterOffline: 'The printer “{name}” is offline.',
    toastPrinterUnknown: 'Could not check the printer status.',
    toastFullscreenOn: 'Fullscreen on — Shift+F to exit',
    toastFullscreenError: 'Fullscreen could not be opened.',
    processing: 'Capturing photo \u2026',
    idleResetTitle: 'Hey, are you still there?',
    idleResetText: 'Returning to start in',
    idleResetStay: 'Tap anywhere to stay',
    permissionText: 'Camera access required for SnapBox',
    permissionHint: 'Blocked permanently? Allow the camera in your browser settings (lock icon in the address bar), then reload the page.',
    permissionBtn: 'Allow Camera',
    permissionOpening: 'Opening camera…',
    permissionRequestingHint: 'Choose “Allow” in the browser prompt. If no prompt appears, the camera is blocked for this page.',
    permissionDeniedHint: 'The browser is blocking the camera. Open the camera permission via the lock icon in the address bar, then reload the page.',
    permissionNoDeviceHint: 'No camera found. Check that the camera is connected and switched on, then try again.',
    permissionBusyHint: 'Another app is using the camera. Close that app and try again.',
    permissionConstraintHint: 'The selected camera is not available. Check the camera choice in the admin panel and try again.',
    permissionInsecureHint: 'The camera needs a secure connection. Open the photo box at https://localhost:8443 or start it with Fotobox-Kiosk.cmd.',
    permissionFailedHint: 'The camera could not be opened. Check the browser settings and try again.',
    captionFace: 'FACE FILTERS',
    captionTimer: 'COUNTDOWN',
    captionTimerMenu: 'COUNT\u00adDOWN',
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
    reviewHint: 'Tap a sticker, drag it, and resize with +/−.',
    stickerDragHint: 'Drag stickers · +/− to resize',
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
    stickerDate: 'Date',
    stickerTime: 'Time',
    stickerDateAria: 'Add date sticker',
    stickerTimeAria: 'Add time sticker',
    stickerTextGroup: 'Date & time',
    stickerSmaller: 'Shrink sticker',
    stickerBigger: 'Enlarge sticker',
    stickerRemove: 'Remove sticker',
    stickerClearAll: 'Delete all stickers',
    galleryBtn: 'Gallery',
    galleryOpenAria: 'Open gallery',
    galleryTitle: 'Your Photos',
    galleryLoadMore: 'Load more',
    galleryLoading: 'Loading…',
    galleryEmpty: 'No photos yet. Capture your first memory!',
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
    qrTtlHours: 'Link is valid for {n} hours.',
    qrTtlHour: 'Link is valid for 1 hour.',
    qrTtlDays: 'Link is valid for {n} days.',
    qrTtlDay: 'Link is valid for 1 day.',
    qrRetry: 'Try again',
    qrCopy: 'Copy link',
    qrCopied: 'Link copied.',
    qrCopyError: 'Link could not be copied.',
    qrNotSaved: 'Photo is not saved yet.',
    qrSvgAria: 'QR code for downloading the photo',
    toastSaved: 'Photo saved.',
    toastCaptureCancelled: 'Capture cancelled.',
    toastSaveError: 'Photo could not be saved — check the connection.',
    toastCaptureError: 'Capture failed. Please try again.',
    toastEditError: 'Changes could not be saved.',
    toastEditErrorKeep: 'Changes could not be saved — the photo stays unchanged.',
    toastEditedSaveError: 'Edited photo could not be saved — the original is kept.',
    toastDeleteError: 'Photo could not be deleted — check the connection.',
    toastDeleteSessionOnly: 'Photos can only be deleted during an active session.',
    toastDeleted: 'Photo deleted.',
    toastEditAction: 'Restore and return to editing',
    toastRestoreAction: 'Restore',
    toastLoadError: 'Saved photos could not be loaded.',
    capturedPhotoAlt: 'Captured photo',
    photoPreviewAlt: 'Photo preview',
    deletePhotoAria: 'Delete photo',
    langGroupAria: 'Choose language',
    soundOn: 'Mute sound',
    soundOff: 'Turn sound on',
    soundLabel: 'Audio',
    galleryLabel: 'Gallery',
    settingsOpenLabel: 'Accessibility',
    settingsTitle: 'Accessibility',
    settingsOpenAria: 'Open accessibility settings',
    accessibilityButtons: 'Button size',
    accessibilityButtonsNormal: 'Normal',
    accessibilityButtonsLarge: 'Large',
    accessibilityText: 'Text size',
    accessibilityTextNormal: 'Normal',
    accessibilityTextLarge: 'Large',
    settingsCloseAria: 'Back',
    sessionCompleted: 'Capture complete',
    sessionCompletionError: 'The session could not be completed. Please try again.',
    cvdHint: 'Colour mode for vision deficiencies',
    a11yResetHint: 'Resets automatically on the start screen after {seconds} seconds.',
    cvdGroupLabel: 'Colour mode',
    cvdStandard: 'Default',
    cvdStandardNote: 'Full colour spectrum (normal vision)',
    cvdProtan: 'Red-green deficiency (Type 1)',
    cvdProtanNote: 'Protanopia — red-weak\n(adjusted brightness)',
    cvdDeuter: 'Red-green deficiency (Type 2)',
    cvdDeuterNote: 'Deuteranopia — green-weak\n(natural brightness)',
    cvdTritan: 'Blue-yellow deficiency',
    cvdTritanNote: 'Tritanopia',
    cvdMono: 'Monochrome',
    cvdMonoNote: 'Greyscale (achromatopsia)',
    streakAriaOne: 'Photo streak: 1 day, {s}',
    streakAriaMany: 'Photo streak: {n} days, {s}',
    streakTaken: 'photo taken today',
    streakNone: 'no photo yet today',
    faceNone: 'Original',
    faceBig: 'Big Eyes + Mouth',
    faceFaceswap: 'Face Swap',
    faceThug: 'Thug Life',
    faceMlg: 'MLG',
    faceShades: 'Pixel Shades',
    faceBoss: 'Thug Boss',
    faceBling: 'Bling',
    faceJoint: 'Joint',
    faceCheeky: 'Cheeky Grin',
    faceUnibrow: 'Unibrow',
    faceCat: 'Cat',
    faceBunny: 'Bunny',
    faceHearts: 'Hearts',
    faceMakeup: 'Makeup',
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
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  updateA11yResetHint();
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
  applyTimerSelection();
  applyModeSelection();
  // Ein laufender Kamera-Versuch behält seine Beschriftung beim Sprachwechsel.
  const permissionBtn = $permission && $permission.querySelector('[data-action="retry-camera"]');
  if (permissionBtn) permissionBtn.textContent = t(permissionBtn.disabled ? 'permissionOpening' : 'permissionBtn');
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
    syncSideMenuHint();
    renderSideTabs();
    renderSideMenu();
    renderBarMenu();
    if (barMenuShowsStamps()) renderStampPanel();
    updateChallengeCard();
    setSideMenuOpen($sideMenu.classList.contains('is-open'));
  }
}

document.querySelectorAll('.lang-switch__btn').forEach((btn) => {
  btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
});
// Die sichtbaren Sprachlabels gehören zum jeweiligen Flaggen-Button; ein
// Tipp auf den Text soll dieselbe Aktion auslösen wie der Button selbst.
document.querySelectorAll('.lang-switch__label').forEach((label) => {
  label.addEventListener('click', () => {
    const unit = label.closest('.lang-switch__unit');
    const btn = unit && unit.querySelector('.lang-switch__btn');
    if (btn) btn.click();
  });
});


// ============================================================
//  ADMIN SETTINGS (eine Quelle für alle Terminals)
// ============================================================
const SETTINGS_CACHE_KEY = 'snapbox_settings_cache';
const APP_SETTINGS_DEFAULTS = Object.freeze({
  defaultLanguage: 'de',
  trashRetentionDays: 7,
  idleEndSeconds: 40,
  idleProcessSeconds: 75,
  idleWarnSeconds: 15,
  a11yResetSeconds: 12,
  defaultCountdownSeconds: 5,
  defaultCaptureMode: 'single',
  defaultSound: true,
  filtersEnabled: true,
  stickersEnabled: true,
  overlaysEnabled: true,
  cameraFacingMode: 'environment',
  galleryPageSize: 12,
  accentColor: '#ffd700',
  secondaryColor: '#00e0d6',
  backgroundColor: '#0d0d0d',
  buttonColor: '#12161e',
  buttonTransparency: 15,
  brandName: 'SnapBox',
  qrTtlHours: 24,
  endQrEnabled: true,
  endPrintEnabled: true,
  endGalleryEnabled: true,
  challengeEnabled: false,
  challengeLocation: 'lcc',
  challengeAppUrl: 'https://site-6e612acb7a47490692d7da5a7b9d9292.freebuff.page',
  // Nur ein Status-Flag, nie der Schlüssel selbst. Damit kann der Endscreen
  // auch dann einen QR zeigen, wenn die Zusammenfassung gerade nicht lädt.
  challengeApiKeySet: false
});
let appSettings = { ...APP_SETTINGS_DEFAULTS };

// Letzter bekannter Stand der öffentlichen Challenge. Die Karte auf dem
// Startbildschirm zeigt nur eingereichte Fotos, nicht den gesamten Bestand.
let challengeStatus = {
  enabled: false,
  configured: false,
  online: false,
  entries: 0,
  votes: 0,
  location: APP_SETTINGS_DEFAULTS.challengeLocation,
  appUrl: '',
  month: ''
};
let challengeSettingsSignature = '';

function normalizeChallengeUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return (url.origin + url.pathname).replace(/\/+$/, '');
  } catch (err) {
    return '';
  }
}

function normalizeAppSettings(data, base = APP_SETTINGS_DEFAULTS) {
  const raw = data && typeof data === 'object' ? data : {};
  const merged = { ...base, ...raw };
  const intInRange = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const color = (value, fallback) => (
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
  );
  const brand = typeof merged.brandName === 'string' && merged.brandName.trim()
    ? merged.brandName.trim().replace(/[<>]/g, '').slice(0, 32)
    : APP_SETTINGS_DEFAULTS.brandName;
  const retention = Number(merged.trashRetentionDays);
  const pageSize = Number(merged.galleryPageSize);
  const countdown = Number(merged.defaultCountdownSeconds);

  const next = {
    defaultLanguage: merged.defaultLanguage === 'en' ? 'en' : 'de',
    trashRetentionDays: [7, 14, 30].includes(retention) ? retention : APP_SETTINGS_DEFAULTS.trashRetentionDays,
    idleEndSeconds: intInRange(merged.idleEndSeconds, APP_SETTINGS_DEFAULTS.idleEndSeconds, 15, 180),
    idleProcessSeconds: intInRange(merged.idleProcessSeconds, APP_SETTINGS_DEFAULTS.idleProcessSeconds, 20, 300),
    idleWarnSeconds: intInRange(merged.idleWarnSeconds, APP_SETTINGS_DEFAULTS.idleWarnSeconds, 5, 60),
    a11yResetSeconds: intInRange(merged.a11yResetSeconds, APP_SETTINGS_DEFAULTS.a11yResetSeconds, 5, 60),
    defaultCountdownSeconds: [3, 5, 10].includes(countdown) ? countdown : APP_SETTINGS_DEFAULTS.defaultCountdownSeconds,
    defaultCaptureMode: merged.defaultCaptureMode === 'strip' ? 'strip' : 'single',
    defaultSound: merged.defaultSound !== false,
    filtersEnabled: merged.filtersEnabled !== false,
    stickersEnabled: merged.stickersEnabled !== false,
    overlaysEnabled: merged.overlaysEnabled !== false,
    cameraFacingMode: merged.cameraFacingMode === 'user' ? 'user' : 'environment',
    galleryPageSize: [6, 12, 24].includes(pageSize) ? pageSize : APP_SETTINGS_DEFAULTS.galleryPageSize,
    accentColor: color(merged.accentColor, APP_SETTINGS_DEFAULTS.accentColor),
    secondaryColor: color(merged.secondaryColor, APP_SETTINGS_DEFAULTS.secondaryColor),
    backgroundColor: color(merged.backgroundColor, APP_SETTINGS_DEFAULTS.backgroundColor),
    buttonColor: color(merged.buttonColor, APP_SETTINGS_DEFAULTS.buttonColor),
    buttonTransparency: intInRange(merged.buttonTransparency, APP_SETTINGS_DEFAULTS.buttonTransparency, 0, 100),
    brandName: brand || APP_SETTINGS_DEFAULTS.brandName,
    qrTtlHours: intInRange(merged.qrTtlHours, APP_SETTINGS_DEFAULTS.qrTtlHours, 1, 168),
    endQrEnabled: merged.endQrEnabled !== false,
    endPrintEnabled: merged.endPrintEnabled !== false,
    endGalleryEnabled: merged.endGalleryEnabled !== false,
    challengeEnabled: merged.challengeEnabled === true,
    challengeLocation: merged.challengeLocation === 'coburg' ? 'coburg' : 'lcc',
    challengeAppUrl: normalizeChallengeUrl(merged.challengeAppUrl),
    challengeApiKeySet: merged.challengeApiKeySet === true
  };
  next.idleWarnSeconds = Math.max(5, Math.min(
    next.idleWarnSeconds,
    next.idleEndSeconds - 5,
    next.idleProcessSeconds - 5
  ));
  return next;
}

function readCachedAppSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return null;
    return normalizeAppSettings(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function cacheAppSettings(settings) {
  try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings)); } catch (e) {}
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mixHex(hex, targetHex, amount) {
  const from = hexToRgb(hex);
  const to = hexToRgb(targetHex);
  const mix = (a, b) => Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
  return '#' + mix(from.r, to.r) + mix(from.g, to.g) + mix(from.b, to.b);
}

function applyThemeSettings(settings) {
  const root = document.documentElement;
  const style = root.style;
  const scheme = root.getAttribute('data-cvd');

  const buttonColor = typeof settings.buttonColor === 'string' && /^#[0-9a-f]{6}$/i.test(settings.buttonColor)
    ? settings.buttonColor
    : APP_SETTINGS_DEFAULTS.buttonColor;
  const transparencyValue = Number(settings.buttonTransparency);
  const buttonTransparency = Number.isInteger(transparencyValue)
    ? Math.min(100, Math.max(0, transparencyValue))
    : APP_SETTINGS_DEFAULTS.buttonTransparency;
  // Ohne eigene Anpassung bleiben die unterschiedlichen Glaswerte der
  // einzelnen Buttons erhalten. Erst eine bewusste Admin-Änderung legt
  // die gemeinsame Farbe/Transparenz über alle runden Controls.
  const customButtonStyle = buttonColor !== APP_SETTINGS_DEFAULTS.buttonColor
    || buttonTransparency !== APP_SETTINGS_DEFAULTS.buttonTransparency;
  if (customButtonStyle) {
    const buttonRgb = hexToRgb(buttonColor);
    const buttonAlpha = 1 - buttonTransparency / 100;
    style.setProperty('--c-control-bg', `rgb(${buttonRgb.r} ${buttonRgb.g} ${buttonRgb.b} / ${buttonAlpha.toFixed(2)})`);
    style.setProperty('--c-control-hover-bg', `rgb(${buttonRgb.r} ${buttonRgb.g} ${buttonRgb.b} / ${Math.min(1, buttonAlpha + 0.06).toFixed(2)})`);
  } else {
    style.removeProperty('--c-control-bg');
    style.removeProperty('--c-control-hover-bg');
  }
  style.removeProperty('--c-control-rgb');
  style.removeProperty('--c-control-alpha');
  style.removeProperty('--c-control-hover-alpha');

  const props = [
    '--c-bg', '--c-accent', '--c-accent-rgb', '--c-accent-2', '--c-accent-2-rgb',
    '--c-accent-dark', '--c-accent-hover', '--c-accent-contrast',
    '--c-highlight', '--c-highlight-rgb', '--c-highlight-edge', '--c-highlight-edge-rgb'
  ];

  // Die Farbsehschwächen-Schemata sind ein Barrierefreiheitsangebot und
  // haben Vorrang vor frei gewählten Farben aus dem Admin-Panel.
  if (scheme && scheme !== 'standard') {
    props.forEach((prop) => style.removeProperty(prop));
    return;
  }

  const accent = settings.accentColor;
  const secondary = settings.secondaryColor;
  const accentRgb = hexToRgb(accent);
  const secondaryRgb = hexToRgb(secondary);
  const accentLight = relativeLuminance(accent) > 0.55;
  const hover = mixHex(accent, accentLight ? '#000000' : '#ffffff', 0.14);
  const hoverRgb = hexToRgb(hover);
  const accentTuple = `${accentRgb.r} ${accentRgb.g} ${accentRgb.b}`;
  const secondaryTuple = `${secondaryRgb.r} ${secondaryRgb.g} ${secondaryRgb.b}`;
  const hoverTuple = `${hoverRgb.r} ${hoverRgb.g} ${hoverRgb.b}`;

  // rgb(var(--token) / alpha) im Hauptprojekt erwartet Leerzeichen-Tripel.
  style.setProperty('--c-bg', settings.backgroundColor);
  style.setProperty('--c-accent', accent);
  style.setProperty('--c-accent-rgb', accentTuple);
  style.setProperty('--c-accent-2', secondary);
  style.setProperty('--c-accent-2-rgb', secondaryTuple);
  style.setProperty('--c-accent-dark', hover);
  style.setProperty('--c-accent-hover', hover);
  style.setProperty('--c-accent-contrast', accentLight ? '#0b0c10' : '#ffffff');
  style.setProperty('--c-highlight', accent);
  style.setProperty('--c-highlight-rgb', accentTuple);
  style.setProperty('--c-highlight-edge', hover);
  style.setProperty('--c-highlight-edge-rgb', hoverTuple);
}

function applyBrandSettings(name) {
  const brand = name || APP_SETTINGS_DEFAULTS.brandName;
  document.title = `${brand} — Minimalist Photobox`;
  document.querySelectorAll('.splash__brand, .splash__title').forEach((el) => {
    el.textContent = brand;
  });
  I18N.de.permissionText = `Kamerazugriff für ${brand} erforderlich`;
  I18N.en.permissionText = `Camera access required for ${brand}`;
  document.querySelectorAll('[data-i18n="permissionText"]').forEach((el) => {
    el.textContent = currentLang === 'en' ? I18N.en.permissionText : I18N.de.permissionText;
  });
}

function brandFileBase() {
  return (appSettings.brandName || 'SnapBox')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'foto';
}

// Zuletzt bekannte Farben/Marke sofort anwenden, damit beim Neuladen kein
// gelber Zwischenschritt aufblitzt. Alles Weitere kommt vom Server.
const cachedAppSettings = readCachedAppSettings();
if (cachedAppSettings) appSettings = cachedAppSettings;
applyThemeSettings(appSettings);
applyBrandSettings(appSettings.brandName);

// ============================================================
//  BARRIEREFREIHEIT: FARBMODUS UND UNABHÄNGIGE BEDIEN-/SCHRIFTGRÖSSEN
//  Das Barrierefreiheitssymbol im Startbildschirm öffnet die
//  Einstellungen. Die Wahl setzt data-cvd auf <html> — die Schemata in
//  style.css überschreiben damit die Farb-Tokens des ganzen UI. Die
//  Größen und Farben bleiben bis zum stillen Inaktivitäts-Reset auf dem Startbildschirm erhalten.
// ============================================================
const CVD_SCHEMES = ['standard', 'protan', 'deuter', 'tritan', 'mono'];
const ACCESSIBILITY_DEFAULTS = Object.freeze({ colorScheme: 'standard', buttonSize: 'normal', textSize: 'normal' });
const accessibilitySettings = { ...ACCESSIBILITY_DEFAULTS };
let accessibilityOnStart = false;
let accessibilityLastActivity = 0;
let accessibilityResetAnimation = null;

function applyColorScheme(scheme) {
  const colorScheme = CVD_SCHEMES.includes(scheme) ? scheme : 'standard';
  accessibilitySettings.colorScheme = colorScheme;
  if (colorScheme === 'standard') document.documentElement.removeAttribute('data-cvd');
  else document.documentElement.setAttribute('data-cvd', colorScheme);

  // Bei einem CVD-Schema dessen Palette zeigen, sonst die Admin-Farben.
  applyThemeSettings(appSettings);

  document.querySelectorAll('#cvdOptions [data-cvd]').forEach((option) => {
    const active = option.dataset.cvd === colorScheme;
    option.setAttribute('aria-checked', String(active));
    option.tabIndex = active ? 0 : -1;
  });

  return colorScheme;
}
applyColorScheme(accessibilitySettings.colorScheme);

function applyAccessibilitySize(key, value) {
  if (!['buttonSize', 'textSize'].includes(key)) return;
  const size = value === 'large' ? 'large' : 'normal';
  accessibilitySettings[key] = size;
  const root = document.documentElement;
  root.dataset[key] = size;
  root.style.setProperty(key === 'buttonSize' ? '--a11y-control-scale' : '--a11y-text-scale', size === 'large' ? '1.25' : '1');
  document.querySelectorAll('[data-accessibility="' + key + '"]').forEach(input => { input.checked = input.value === size; });
}

function resetAccessibilitySettings() {
  Object.assign(accessibilitySettings, ACCESSIBILITY_DEFAULTS);
  Object.entries(ACCESSIBILITY_DEFAULTS).forEach(([key, value]) => {
    if (key === 'colorScheme') applyColorScheme(value);
    else applyAccessibilitySize(key, value);
  });
  if (soundEnabled !== appSettings.defaultSound) toggleSound();
  try { localStorage.removeItem('soundEnabled'); } catch (e) {}
}

// Der Hinweis im Einstellungs-Dialog nennt die im Admin gesetzte Frist.
function updateA11yResetHint() {
  const hint = document.getElementById('a11yResetHint');
  if (!hint) return;
  hint.textContent = t('a11yResetHint').replace('{seconds}', String(appSettings.a11yResetSeconds));
}

function cancelAccessibilityResetAnimation(complete = false) {
  const animation = accessibilityResetAnimation;
  accessibilityResetAnimation = null;
  if (!animation) return;
  if (animation.timeline) animation.timeline.kill();
  if (animation.restoreStyles) animation.restoreStyles.forEach(restore => restore());
  if (animation.marker) animation.marker.removeAttribute('data-reset-marker');
  if (animation.previousSettings && !complete) {
    const previous = animation.previousSettings;
    applyColorScheme(previous.colorScheme);
    applyAccessibilitySize('buttonSize', previous.buttonSize);
    applyAccessibilitySize('textSize', previous.textSize);
    if (soundEnabled !== previous.sound) toggleSound();
    try {
      if (previous.storedSound === null) localStorage.removeItem('soundEnabled');
      else localStorage.setItem('soundEnabled', previous.storedSound);
    } catch (e) {}
  }
  applySoundState();
  animation.element.remove();
}

function animateAccessibilityReset() {
  const rootTheme = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(Array.from(rootTheme).filter(name => name.startsWith('--c-'))
    .map(name => [name, rootTheme.getPropertyValue(name)]));
  const previousSettings = { ...accessibilitySettings, sound: soundEnabled, storedSound: null };
  try { previousSettings.storedSound = localStorage.getItem('soundEnabled'); } catch (e) {}
  // The line is at x + y = (2 * easedProgress - .5) * (width + height).
  const crossingTime = el => {
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, ((r.left + r.width / 2 + r.top + r.height / 2) / (innerWidth + innerHeight) + 0.5) / 2));
    return 2 * (p < 0.5 ? Math.sqrt(p / 2) : 1 - Math.sqrt((1 - p) / 2)) - 0.14;
  };
  const groups = Array.from(document.querySelectorAll('.splash, .splash__bg, .splash__content, .splash__tool, .splash__settings, .splash__top-branding, .challenge-card, .lang-switch--splash'))
    .filter(el => el.getClientRects().length)
    .map(el => ({ el, time: crossingTime(el), font: getComputedStyle(el).fontSize }));
  const card = document.getElementById('splashStart');
  const cardWidth = card && card.getBoundingClientRect().width ? getComputedStyle(card).width : null;
  const audioIcon = $splashSound.querySelector('.splash__tool-icon');
  const audioColor = getComputedStyle(audioIcon).color;
  const marker = $splashSettings.querySelector('.splash__settings-icon');
  const hasMarker = Object.entries(ACCESSIBILITY_DEFAULTS).some(([key, value]) => previousSettings[key] !== value);
  const element = document.createElement('div');
  element.className = 'accessibility-reset-scan';
  element.setAttribute('aria-hidden', 'true');
  element.appendChild(document.createElement('span'));
  $splash.appendChild(element);
  const animation = { element, timeline: null, previousSettings, restoreStyles: [], marker: hasMarker ? marker : null };
  accessibilityResetAnimation = animation;
  // Prepare the standard state in one task, retaining the old appearance locally.
  // Any input rolls this transaction back before its own button handler executes.
  if (hasMarker) marker.setAttribute('data-reset-marker', '');
  resetAccessibilitySettings();
  const standardTheme = getComputedStyle(document.documentElement);
  groups.forEach(group => { group.standardFont = getComputedStyle(group.el).fontSize; });
  const standardCardWidth = cardWidth ? getComputedStyle(card).width : null;
  const audioTransition = [audioIcon.style.getPropertyValue('transition'), audioIcon.style.getPropertyPriority('transition')];
  audioIcon.style.setProperty('transition', 'none');
  const standardAudioColor = getComputedStyle(audioIcon).color;
  if (audioTransition[0]) audioIcon.style.setProperty('transition', ...audioTransition);
  else audioIcon.style.removeProperty('transition');
  animation.timeline = gsap.timeline({
    paused: true,
    onComplete: () => {
      syncAccessibilityIdle();
      if (accessibilityResetAnimation !== animation) return;
      const busy = isCapturing || isSavingPhoto || isDiscardingPhoto || capturePrint;
      cancelAccessibilityResetAnimation(!busy);
      if (busy) return;
      accessibilityLastActivity = 0;
    },
    onInterrupt: () => {
      if (accessibilityResetAnimation === animation) cancelAccessibilityResetAnimation();
    }
  })
    .fromTo(element, { xPercent: -100, yPercent: -100 },
      { xPercent: 100, yPercent: 100, duration: 2, ease: 'power1.inOut' }, 0)
    .fromTo(element, { opacity: 0 }, { opacity: 0.6, duration: 0.25 }, 0)
    .to(element, { opacity: 0, duration: 0.25 }, 1.75);
  const blend = (el, from, to, time) => {
    const saved = Object.keys(from).map(name => {
      const cssName = name.startsWith('--') ? name : name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      return [cssName, el.style.getPropertyValue(cssName), el.style.getPropertyPriority(cssName)];
    });
    animation.restoreStyles.push(() => saved.forEach(([name, value, priority]) => {
      if (value) el.style.setProperty(name, value, priority);
      else el.style.removeProperty(name);
    }));
    gsap.set(el, { ...from, autoRound: false });
    animation.timeline.to(el, { ...to, autoRound: false, duration: 0.28, ease: 'power1.inOut' }, time);
  };
  groups.forEach(({ el, time, font, standardFont }) => {
    const from = { '--a11y-control-scale': previousSettings.buttonSize === 'large' ? 1.25 : 1,
      '--a11y-text-scale': previousSettings.textSize === 'large' ? 1.25 : 1, fontSize: font };
    const to = { '--a11y-control-scale': 1, '--a11y-text-scale': 1, fontSize: standardFont };
    Object.entries(colors).forEach(([name, value]) => {
      const standard = standardTheme.getPropertyValue(name);
      if (value && standard && value !== standard) { from[name] = value; to[name] = standard; }
    });
    blend(el, from, to, time);
  });
  if (cardWidth) blend(card, { width: cardWidth }, { width: standardCardWidth }, crossingTime(card));
  const audioTime = crossingTime($splashSound);
  blend(audioIcon, { color: audioColor, transition: 'none' }, { color: standardAudioColor, transition: 'none' }, audioTime);
  $splashSound.querySelectorAll('.sound-on, .sound-off').forEach(path => {
    const on = path.classList.contains('sound-on');
    path.style.display = '';
    blend(path, { opacity: on === previousSettings.sound ? 1 : 0 }, { opacity: on === soundEnabled ? 1 : 0 }, audioTime);
  });
  if (hasMarker) blend(marker, { '--reset-marker-opacity': 1, '--reset-marker-color': colors['--c-accent'] },
    { '--reset-marker-opacity': 0, '--reset-marker-color': colors['--c-accent'] }, crossingTime($splashSettings));
  animation.timeline.play();
}

function syncAccessibilityIdle() {
  const onStart = currentState === 'splash'
    && (!$settingsModal || $settingsModal.hidden)
    && (!$creditsModal || $creditsModal.hidden)
    && !sessionCompletion;
  if (!onStart) cancelAccessibilityResetAnimation();
  if (onStart === accessibilityOnStart) return;
  accessibilityOnStart = onStart;
  accessibilityLastActivity = onStart ? Date.now() : 0;
}

function checkAccessibilityIdle() {
  syncAccessibilityIdle();
  if (!accessibilityOnStart || currentState !== 'splash' || !accessibilityLastActivity) return;
  if (Date.now() - accessibilityLastActivity < appSettings.a11yResetSeconds * 1000) return;
  if (isCapturing || isSavingPhoto || isDiscardingPhoto || capturePrint) return;
  if (accessibilityResetAnimation) return;
  const changed = Object.entries(ACCESSIBILITY_DEFAULTS)
    .some(([key, value]) => accessibilitySettings[key] !== value)
    || soundEnabled !== appSettings.defaultSound;
  if (!changed) { accessibilityLastActivity = 0; return; }
  if (reducedCaptureMotion()) {
    resetAccessibilitySettings();
    accessibilityLastActivity = 0;
  } else animateAccessibilityReset();
}

document.querySelectorAll('[data-accessibility]').forEach(input => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    // Größenwechsel bleiben bewusst stumm.
    applyAccessibilitySize(input.dataset.accessibility, input.value);
  });
});

const $settingsModal = document.getElementById('settingsModal');
const $settingsClose = document.getElementById('settingsClose');
const $splashSettings = document.getElementById('splashSettings');
const $cvdOptions = document.getElementById('cvdOptions');
let settingsReturnFocus = null;

function openSettings() {
  if (!$settingsModal || !$settingsModal.hidden) return;
  settingsReturnFocus = document.activeElement;
  $settingsModal.hidden = false;
  syncAccessibilityIdle();
  // Fokus in den Dialog: die aktuelle Auswahl, sonst der Schließen-Knopf.
  const current = $settingsModal.querySelector('[data-accessibility="buttonSize"]:checked')
    || ($cvdOptions && $cvdOptions.querySelector('[data-cvd][aria-checked="true"]'));
  $settingsModal.querySelector('.settings-modal__body').scrollTop = 0;
  if (current) current.focus({ preventScroll: true });
  else if ($settingsClose) $settingsClose.focus();
  gsap.from($settingsModal.querySelector('.settings-modal__card'), {
    y: 24, opacity: 0, scale: 0.96, duration: 0.3, ease: 'power2.out', clearProps: 'all'
  });
}

function closeSettings() {
  if (!$settingsModal || $settingsModal.hidden) return;
  $settingsModal.hidden = true;
  syncAccessibilityIdle();
  // Fokus zurück zum Barrierefreiheitsbutton.
  if (settingsReturnFocus && settingsReturnFocus.isConnected) settingsReturnFocus.focus();
  settingsReturnFocus = null;
}

if ($splashSettings) $splashSettings.addEventListener('click', openSettings);
if ($settingsClose) $settingsClose.addEventListener('click', closeSettings);
if ($settingsModal) {
  $settingsModal.addEventListener('click', (e) => { if (e.target === $settingsModal) closeSettings(); });
}

const $creditsModal = document.getElementById('creditsModal');
const $creditsClose = document.getElementById('creditsClose');
const $splashCredits = document.getElementById('splashCredits');
let creditsReturnFocus = null;
let creditsInertScreens = [];

function openCredits() {
  if (!$creditsModal || !$creditsModal.hidden || currentState !== 'splash') return;
  creditsReturnFocus = document.activeElement;
  creditsInertScreens = [$splash, $camera, $gallery, $sideRail, $splashLang].filter(Boolean)
    .map(el => ({ el, inert: el.inert }));
  creditsInertScreens.forEach(({ el }) => { el.inert = true; });
  $creditsModal.hidden = false;
  syncAccessibilityIdle();
  $creditsModal.querySelector('.settings-modal__body').scrollTop = 0;
  $creditsModal.querySelector('details').open = false;
  $creditsClose.focus({ preventScroll: true });
}

function closeCredits() {
  if (!$creditsModal || $creditsModal.hidden) return;
  $creditsModal.hidden = true;
  syncAccessibilityIdle();
  creditsInertScreens.forEach(({ el, inert }) => { el.inert = inert; });
  creditsInertScreens = [];
  if (creditsReturnFocus && creditsReturnFocus.isConnected) creditsReturnFocus.focus({ preventScroll: true });
  creditsReturnFocus = null;
}

if ($splashCredits) $splashCredits.addEventListener('click', openCredits);
if ($creditsClose) $creditsClose.addEventListener('click', closeCredits);
if ($creditsModal) {
  $creditsModal.addEventListener('click', (e) => { if (e.target === $creditsModal) closeCredits(); });
  $creditsModal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const controls = Array.from($creditsModal.querySelectorAll('button, a[href], summary'))
      .filter(el => el.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

if ($cvdOptions) {
  $cvdOptions.addEventListener('click', (e) => {
    const option = e.target.closest('[data-cvd]');
    if (!option) return;
    applyColorScheme(option.dataset.cvd);
    option.focus();
  });

  // Radiogroup-Tastatur: Pfeiltasten wandern durch die Auswahl und wählen sie.
  $cvdOptions.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const options = Array.from($cvdOptions.querySelectorAll('[data-cvd]'));
    if (!options.length) return;
    e.preventDefault();
    const index = options.indexOf(document.activeElement);
    const current = index < 0 ? 0 : index;
    let next = current;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (current + 1) % options.length;
    else next = (current - 1 + options.length) % options.length;
    applyColorScheme(options[next].dataset.cvd);
    options[next].focus();
  });
}

// ============================================================
//  ORIENTATION (fest Querformat)
// ============================================================
// Die Kiosk-Oberfläche gibt es nur noch im Querformat. Eine früher im
// localStorage gespeicherte Hochformat-Einstellung wird ignoriert und entfernt.
function applyOrientation() {
  document.body.classList.add('orientation-landscape');
  try { localStorage.removeItem('snapbox_orientation'); } catch (e) {}
}

function applyAppSettings(data) {
  appSettings = normalizeAppSettings(data, appSettings);
  applyThemeSettings(appSettings);
  applyBrandSettings(appSettings.brandName);
  applyFeatureAvailability();
  applyEndScreenActions();

  // Nur bei geänderter Challenge-Konfiguration neu laden, nicht bei jedem
  // 2,5-Sekunden-Sync.
  const signature = [
    appSettings.challengeEnabled,
    appSettings.challengeLocation,
    appSettings.challengeAppUrl,
    appSettings.challengeApiKeySet
  ].join('|');
  if (signature !== challengeSettingsSignature) {
    challengeSettingsSignature = signature;
    refreshChallengeSummary();
  }

  applyOrientation();
  if (appSettings.defaultLanguage !== defaultLang) {
    defaultLang = appSettings.defaultLanguage;
    try { localStorage.setItem('snapbox_default_language', defaultLang); } catch (e) {}
    if (currentState === 'splash') applyLanguage(defaultLang);
  }
  updateA11yResetHint();
  cacheAppSettings(appSettings);
}

// Sofort initial anwenden
applyOrientation();

// Synchronisation zwischen Tabs über BroadcastChannel
if ('BroadcastChannel' in window) {
  try {
    const settingsChannel = new BroadcastChannel('snapbox_channel');
    settingsChannel.onmessage = (event) => {
      if (!event.data) return;
      if (event.data.type === 'settings_change' && event.data.settings) {
        applyAppSettings(event.data.settings);
      }
      if (event.data.type === 'default_language_change') {
        defaultLang = event.data.defaultLanguage === 'en' ? 'en' : 'de';
        try { localStorage.setItem('snapbox_default_language', defaultLang); } catch (e) {}
        applyLanguage(defaultLang);
      }
    };
  } catch (e) {}
}

// Synchronisation bei storage Events
window.addEventListener('storage', (e) => {
  if (e.key === 'snapbox_default_language' && (e.newValue === 'de' || e.newValue === 'en')) {
    defaultLang = e.newValue;
    applyLanguage(defaultLang);
  }
});

// Periodische Synchronisation mit dem Server (/api/settings) für Multi-Device / Kiosk
async function syncSettingsFromServer() {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data) applyAppSettings(data);
    }
  } catch (e) {}
}

const settingsReady = syncSettingsFromServer();
setInterval(syncSettingsFromServer, 2500);

// ============================================================
//  CAMERA ACCESS
// ============================================================
let stream = null;
// Ein laufender getUserMedia-Aufruf. Verhindert, dass Doppelklicks mehrere
// gleichzeitige Berechtigungsdialoge öffnen.
let cameraRequest = null;

function hasLiveVideoTrack(mediaStream) {
  return !!mediaStream && mediaStream.getVideoTracks().some((track) => track.readyState === 'live');
}

function setPermissionBusy(busy) {
  const button = $permission.querySelector('[data-action="retry-camera"]');
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.textContent = t(busy ? 'permissionOpening' : 'permissionBtn');
}

function setPermissionHint(key) {
  const hint = $permission.querySelector('.permission__hint');
  if (!hint) return;
  hint.dataset.i18n = key;
  hint.textContent = t(key);
}

// Fehlername → konkreter Hinweis mit Lösung. Ein pauschales „geht nicht“
// hilft niemandem; der Gast soll wissen, was er jetzt tun kann.
function cameraErrorHint(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permissionDeniedHint';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'permissionNoDeviceHint';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'permissionBusyHint';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return err && ['width', 'height'].includes(err.constraint)
        ? 'permissionResolutionHint' : 'permissionConstraintHint';
    default:
      return 'permissionFailedHint';
  }
}

async function initCamera({ retry = false } = {}) {
  if (cameraRequest) return cameraRequest;

  if (filterEngine) filterEngine.start();

  // already have a live stream (returning from gallery or re-entering)
  if (hasLiveVideoTrack(stream)) {
    videoPlaying = true;
    $permission.classList.remove('visible');
    setPermissionBusy(false);
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

  // Ein alter, beendeter Track darf einen neuen Versuch nicht verhindern.
  if (stream) stopCamera();

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    showPermissionPrompt('permissionInsecureHint');
    setPermissionBusy(false);
    return false;
  }

  if (retry) {
    // Der Dialog bleibt sichtbar und zeigt sofort, dass der Klick angekommen ist.
    showPermissionPrompt('permissionRequestingHint');
    setPermissionBusy(true);
  } else {
    $permission.classList.remove('visible');
    setPermissionBusy(false);
  }

  cameraRequest = (async () => {
    const requestStarted = performance.now();
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: appSettings.cameraFacingMode,
          width: { exact: PHOTO_WIDTH },
          height: { exact: PHOTO_HEIGHT }
        },
        audio: false
      });
      stream = mediaStream;
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

      $permission.classList.remove('visible');
      setPermissionBusy(false);
      return true;
    } catch (err) {
      stream = null;
      console.warn('Camera access failed:', err && err.name, err && err.message);
      // Bei sofortiger Ablehnung (blockierte Kamera) den Busy-Zustand kurz
      // stehen lassen, sonst wirkt der Klick wie ohne Reaktion.
      if (retry) {
        const remaining = 700 - (performance.now() - requestStarted);
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      showPermissionPrompt(cameraErrorHint(err));
      setPermissionBusy(false);
      return false;
    } finally {
      cameraRequest = null;
    }
  })();

  return cameraRequest;
}

function showPermissionPrompt(hintKey = 'permissionHint') {
  const wasVisible = $permission.classList.contains('visible');
  setPermissionHint(hintKey);
  $permission.classList.add('visible');
  if (!wasVisible) {
    gsap.from('.permission__content > *', {
      y: 20, opacity: 0, stagger: 0.1,
      duration: 0.5, ease: 'power2.out'
    });
  }
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
  $splash.classList.add('is-eye-idle');
  const tl = timeline();
  tl.to($splash, { display: 'flex', opacity: 1, duration: 0.01 })
    .from('.splash__title', { y: 40, opacity: 0, duration: 1.1, ease: 'elastic.out(1, 0.6)' }, 0.3)
    .from('.splash__subtitle', { y: 20, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.45)
    .from('.splash__cta', { y: 30, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.55);
}

// Start des Kiosk-Flows: Splash ausblenden, Kamera starten. Wird vom
// Swipe-up, vom Start-Button sowie von Leertaste und PageUp/PageDown aufgerufen.
function startSession() {
  if (currentState === 'camera') return;
  beginPhotoSession();
  unlockAudio(); // create the AudioContext inside the user gesture
  playUiSound('cancel.mp3', true);
  playUiSound('switch.mp3', true);
  playUiSound('afk_timer.mp3', true);
  currentState = 'camera';
  initCamera(); // request camera immediately to preserve user-gesture context
  syncAccessibilityIdle();
  $splash.classList.remove('is-eye-idle');

  // Menü-Inhalt vorbereiten, aber geschlossen lassen: Die Vorschau startet
  // in voller Größe, das Menü öffnet der Gast über die untere Leiste.
  if (isKioskLayout()) {
    openSideMenu('filter');
    setSideMenuOpen(false);
  }
  setCaptureOptionsOpen(false);

  const tl = timeline();
  tl.to(['.splash__content--portrait', '.splash__content--kiosk', '.lang-switch--splash',
    '.splash__brand', '.challenge-card', '.splash__sound', '.splash__gallery', '.splash__settings'], {
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
// des Startbildschirms werden sie auf die Admin-Standardwerte zurückgesetzt,
// damit der nächste Gast nicht die Wahl des Vorgängers erbt.

// Countdown-Dauer (Selbstauslöser) — sichtbar gewählt, pro Sitzung gemerkt.
let countdownSeconds = Number(localStorage.getItem('countdownSeconds'));
if (![3, 5, 10].includes(countdownSeconds)) countdownSeconds = appSettings.defaultCountdownSeconds;

function applyTimerSelection() {
  // Hochformat-Dock und Kiosk-Leiste teilen sich denselben Zustand.
  document.querySelectorAll('[data-cycle="timer"]').forEach((button) => {
    button.dataset.value = String(countdownSeconds);
    button.querySelector('.option-cycle__value').textContent = countdownSeconds + 's';
    button.setAttribute('aria-label', t('timerGroupAria') + ': ' + countdownSeconds + 's');
    button.querySelectorAll('.option-cycle__segments path').forEach((segment, i) => {
      segment.classList.toggle('is-active', [3, 5, 10][i] === countdownSeconds);
    });
  });
}
applyTimerSelection();

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-cycle="timer"]');
  if (!chip || chip.disabled) return;
  playUiSound('switch.mp3');
  countdownSeconds = [3, 5, 10][([3, 5, 10].indexOf(countdownSeconds) + 1) % 3];
  document.querySelectorAll('[data-cycle="timer"]').forEach(button => button.classList.add('is-used'));
  localStorage.setItem('countdownSeconds', String(countdownSeconds));
  applyTimerSelection();
});

// Aufnahmemodus: Einzelfoto oder vierteilige Fotocollage (2×2).
const storedCaptureMode = localStorage.getItem('snapbox_capture_mode');
let captureMode = storedCaptureMode === 'strip' || storedCaptureMode === 'single'
  ? storedCaptureMode
  : appSettings.defaultCaptureMode;

function applyModeSelection() {
  document.querySelectorAll('[data-cycle="mode"]').forEach((button) => {
    const label = t(captureMode === 'strip' ? 'modeStrip' : 'modeSingle');
    button.dataset.value = captureMode;
    button.setAttribute('aria-label', t('modeGroupAria') + ': ' + label);
    button.querySelectorAll('.option-cycle__segments path').forEach((segment, i) => {
      segment.classList.toggle('is-active', i === (captureMode === 'strip' ? 1 : 0));
    });
  });
}
applyModeSelection();

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cycle="mode"]');
  if (!btn || btn.disabled) return;
  playUiSound('switch.mp3');
  captureMode = captureMode === 'single' ? 'strip' : 'single';
  btn.classList.add('is-used');
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
  updateBarMenuSelection();
}

// Setzt alle gastbezogenen Aufnahme-Einstellungen auf den neutralen Zustand.
// Betreiber-Einstellungen (Ausrichtung, Standardsprache, Aufbewahrung) bleiben
// davon unberührt, weil sie nicht in dieser Funktion liegen.
function resetGuestCaptureSettings(options = {}) {
  hideFilterRemoveHint();
  filterRemoveHintShown = false;
  // Scroll-Demonstrationen gelten je Gast-Sitzung und Menü genau einmal.
  resetListScrollHints();
  document.querySelectorAll('.option-cycle.is-used').forEach(button => button.classList.remove('is-used'));
  captureMode = appSettings.defaultCaptureMode;
  countdownSeconds = appSettings.defaultCountdownSeconds;
  currentFilter = 'standard';
  currentOverlay = null;
  if (!options.preserveSound) soundEnabled = appSettings.defaultSound;

  // Keine Gästeauswahl im Gerät behalten: Beim nächsten Laden gilt der
  // Standard, nicht die letzte Wahl eines fremden Gastes.
  try {
    localStorage.removeItem('snapbox_capture_mode');
    localStorage.removeItem('countdownSeconds');
    if (!options.preserveSound) localStorage.removeItem('soundEnabled');
    localStorage.removeItem('snapbox_color_scheme'); // Altbestand früherer Versionen
  } catch (err) {}

  if (filterEngine) filterEngine.setFilter('none');
  applyModeSelection();
  applyTimerSelection();
  applyFilterSelection();
  syncFaceFilterSelection();
  applySoundState();
  applyFeatureAvailability();
}

// Blendet Gäste-Funktionen aus, die im Admin-Panel deaktiviert wurden.
// Die Klasse nutzt !important, weil einzelne Komponenten eigene display-Werte
// haben (Buttons sind z. B. inline-flex) und [hidden] sonst überschreiben.
function setFeatureHidden(el, hidden) {
  if (el) el.classList.toggle('feature-disabled', hidden);
}

// Kiosk-Seitenmenü: Auf der Kamera gibt es nur Filter, im Review nur
// Overlay und Sticker. So bleibt jeder Screen auf seine Aufgabe beschränkt.
function sideMenuStageIds() {
  const inReview = $camera.classList.contains('is-reviewing')
    || $camera.classList.contains('is-stamping');
  // Review nutzt ausschließlich die Leisten-Pillen (Sticker + Rahmen);
  // die Schublade gehört nur noch zur Kamera-Filterauswahl.
  return inReview ? [] : ['filter'];
}

function sideMenuFeatureEnabled(context) {
  if (context === 'filter') return appSettings.filtersEnabled !== false;
  if (context === 'overlay') return appSettings.overlaysEnabled !== false;
  if (context === 'stamp') return appSettings.stickersEnabled !== false;
  return false;
}

function sideMenuContextAvailable(context) {
  return sideMenuStageIds().includes(context) && sideMenuFeatureEnabled(context);
}

function chooseSideMenuContext(preferred) {
  const available = sideMenuStageIds().filter(sideMenuFeatureEnabled);
  if (available.includes(preferred)) return preferred;
  return available[0] || null;
}

function setSideMenuVisible(visible) {
  if (!$sideMenu) return;
  $sideMenu.classList.toggle('feature-disabled', !visible);
  // Der Leistenknopf hängt nicht mehr an dieser Schublade: er zeigt in der
  // Kamera die Filter und im Review die Rahmen.
  if (!visible) setSideMenuOpen(false);
}

function refreshSideMenu() {
  if (!isKioskLayout() || !$sideMenu) return;
  const next = chooseSideMenuContext(sideContext);
  setSideMenuVisible(!!next);
  // Der linke Knopf bleibt sichtbar, solange irgendein Menü erreichbar ist:
  // Filter in der Kamera, Rahmen im Review oder die Sticker-Schublade.
  const barMenus = (barMenuShowsFilters() && appSettings.filtersEnabled !== false)
    || barMenuShowsOverlays();
  setFeatureHidden($sideMenuToggle, !barMenus && !next);
  if (!next) return;
  openSideMenu(next);
}

function applyFeatureAvailability() {
  const filtersOn = appSettings.filtersEnabled !== false;
  const stickersOn = appSettings.stickersEnabled !== false;
  const overlaysOn = appSettings.overlaysEnabled !== false;

  setFeatureHidden(document.querySelector('.dock-group--filters'), !filtersOn);
  setFeatureHidden(document.getElementById('filterToggle'), !filtersOn);
  setFeatureHidden(document.getElementById('filterTray'), !filtersOn);
  setFeatureHidden(document.getElementById('stickerToggle'), !stickersOn);
  setFeatureHidden(document.getElementById('stickerTray'), !stickersOn);

  if (!filtersOn) {
    if (filterEngine && filterEngine.getFilter() !== 'none') filterEngine.setFilter('none');
    if (currentFilter !== 'standard') {
      currentFilter = 'standard';
      applyFilterSelection();
    }
    if (openReviewTool === 'filters') closeReviewTools();
  }

  if (!stickersOn) {
    if ($camera.classList.contains('is-stamping')) closeStampMode();
    if (activeStickers.length) clearStickers();
    if (openReviewTool === 'stickers') closeReviewTools();
  }

  if (!overlaysOn && currentOverlay) {
    currentOverlay = null;
    renderOverlayPreview();
    repositionStickers();
  }

  if (isKioskLayout()) refreshSideMenu();
}

// Während der Aufnahmesequenz (Countdown → Verarbeitung) sind Gallery, Timer
// gesperrt: Fehlklicks können die Sequenz nicht mehr abreißen
// (Fehlervermeidung) — Kontrolle kommt danach über Behalten/Neu aufnehmen.
function setControlsLocked(locked) {
  // Alles, was die Aufnahme verändern oder verlassen kann, wird wirklich
  // deaktiviert — nicht nur per pointer-events ausgeblendet. So verhalten
  // sich Maus, Tastatur und Screenreader gleich (HCI: Consistency).
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
    sideMenu.inert = locked || !sideMenu.classList.contains('is-open');
    if (locked) sideMenu.setAttribute('aria-disabled', 'true');
    else sideMenu.removeAttribute('aria-disabled');
  }
  if ($sideMenuToggle) $sideMenuToggle.disabled = locked;
  if ($captureOptionsToggle) {
    $captureOptionsToggle.disabled = locked;
    setCaptureOptionsOpen(false);
  }
  // Die Schublade verdeckt sonst die Vorschau während Countdown und
  // Verarbeitung.
  if (locked) setSideMenuOpen(false);
  if (locked) setBarMenuOpen(false);
}

// Das Review-Panel bleibt während der Bearbeitung sichtbar: „Save“ ist
// damit auch nach dem Platzieren eines Stickers immer direkt erreichbar.
function isKioskLayout() {
  return document.body.classList.contains('orientation-landscape');
}

// Der globale Start-Button sitzt auf jedem Screen an derselben Stelle in der
// rechten Schiene. In der Kameraansicht teilt er sie sich mit dem Griff fürs
// Seitenmenü; in der Galerie bleibt darüber nur die Trennlinie stehen.
function syncCancelHome() {
  if (!$cancelHome) return;
  syncAccessibilityIdle();
  const onSplash = currentState === 'splash';
  // Reuse the same button and handler in the final layout; keep it available in the gallery.
  const homeHost = currentState === 'camera' && $camera.classList.contains('is-ended')
    ? document.querySelector('#endScreen .endscreen__inner')
    : document.querySelector('.side-rail__home');
  if (homeHost && $cancelHome.parentElement !== homeHost) homeHost.appendChild($cancelHome);
  $splash.classList.toggle('is-eye-idle', onSplash);
  // Nur das Home-Symbol: die Beschriftung gehört zu Kamera- und Endscreen.
  $cancelHome.classList.toggle('is-gallery', currentState === 'gallery');
  $cancelHome.hidden = onSplash || $camera.classList.contains('is-capture-cancellable');
  if ($sideRail) $sideRail.hidden = onSplash;
  if ($sideMenuToggle) {
    const showToggle = !onSplash && currentState === 'camera'
      && !$camera.classList.contains('is-ended');
    if (!showToggle) {
      setSideMenuOpen(false);
      setBarMenuOpen(false);
      setCaptureOptionsOpen(false);
    }
    $sideMenuToggle.hidden = !showToggle;
    syncBarToggleLabel();
  }
}

// Derselbe Button zeigt Start/Abbrechen und auf dem Endscreen die
// Rückkehr zum Start unter den Ausgabeoptionen; der Click-Handler bleibt gleich.
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
  $camera.classList.toggle('is-capture-cancellable', active);
  [$captureBtn, document.getElementById('landscapeCaptureBtn')].filter(Boolean).forEach(button => {
    button.disabled = false;
    button.dataset.i18nAria = active ? 'captureCancelAria' : 'captureAria';
    button.setAttribute('aria-label', t(button.dataset.i18nAria));
    const label = button.querySelector('.kiosk-shutter__label, .btn__capture-text');
    if (label) label.dataset.cancelLabel = t('captureCancel');
  });
  setHomeMode('default');
  syncCancelHome();
}

function cancelCapture() {
  if (!isCapturing || captureCommitted) return;
  // Laufende asynchrone Schritte (Countdown, Verarbeitung) invalidieren.
  captureRunId += 1;
  finishCountdown(false);
  hideCountdown();
  hideStripProgress();
  gsap.killTweensOf([...$corners, $viewfinderFrame]);
  clearCapturePresentation();
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
  playUiSound('paper_crush.mp3', true);
  // Ein Countdown darf nie über dem fertigen Foto stehen bleiben.
  stopCountdown();
  $camera.classList.add('is-reviewing');
  // Die Pille der Leiste zeigt ab jetzt die Rahmen statt der Filter.
  renderBarMenu();
  syncCancelHome();
  setBarMenuOpen(false);
  setStampMenuOpen(false);
  setCaptureOptionsOpen(false);
  closeReviewTools();
  // Ausgangszustand: ungefiltertes Foto, Auswahl auf „Standard“.
  applyFilterSelection();
  renderOverlayPreview();

  if (isKioskLayout()) {
    // Im Querformat liegen die Aktionen unter dem Foto und das Menü rechts.
    $review.hidden = true;
    const actions = document.getElementById('reviewActions');
    if (actions) {
      actions.hidden = false;
      // Nur einblenden, nicht verschieben: „Annehmen“ ist fixiert und würde
      // in einem transformierten Eltern-Element für einen Moment falsch sitzen.
      if (!$camera.classList.contains('is-capture-result')) {
        gsap.from(actions, { opacity: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
      }
    }
    renderBarMenu();
    syncBarToggleLabel();
    const keepBtn = document.getElementById('landscapeKeep');
    if (keepBtn) keepBtn.focus();
    return;
  }

  $review.hidden = false;
  if (!$camera.classList.contains('is-capture-result')) {
    gsap.from($review, { y: 24, opacity: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
  }
  $reviewKeep.focus();
}

function hideReview() {
  $review.hidden = true;
  const actions = document.getElementById('reviewActions');
  if (actions) actions.hidden = true;
  $camera.classList.remove('is-reviewing', 'is-stamping');
  // Die in der Review geöffnete Pille (Rahmen) darf nach dem Annehmen nicht
  // als Filterband stehen bleiben — sonst wirkt der Aufnahme-Modus wieder da.
  setStampMenuOpen(false);
  setBarMenuOpen(false);
  setCaptureOptionsOpen(false);
  renderBarMenu();
  syncCancelHome();
  closeReviewTools();
}

// Werkzeugleiste im Instagram-Stil: immer nur ein Tray offen, und das Tray
// liegt unter dem Foto statt darüber.
let openReviewTool = null;

function setReviewTool(tool) {
  if (tool === 'stickers' && !appSettings.stickersEnabled) return;
  if (tool === 'filters' && !appSettings.filtersEnabled) return;
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

// Wirft das aktuell angezeigte Foto endgültig weg und setzt die Kameraansicht
// zurück — vom Review-„Neu aufnehmen" genutzt.
function discardCurrentPhoto() {
  if (!hasPhoto) return;
  const viewfinder = $camera.querySelector('.viewfinder');
  const capturedImg = viewfinder.querySelector('img.stage-photo');
  const reduced = reducedCaptureMotion();
  const sheet = document.createElement('div');
  sheet.className = 'paper-crumple';
  sheet.setAttribute('aria-hidden', 'true');
  const layers = [capturedImg, ...viewfinder.querySelectorAll('.photo-overlay, .photo-overlay-strip, .sticker')].filter(Boolean);
  const points = [[0, 0], [60, 0], [100, 0], [100, 100], [40, 100], [0, 100]];
  const facets = [];
  for (let i = 0; i < (reduced ? 1 : points.length); i++) {
    const facet = document.createElement('div');
    facet.className = 'paper-crumple__facet';
    if (!reduced) {
      const a = points[i], b = points[(i + 1) % points.length];
      facet.style.clipPath = 'polygon(49% 48%, ' + a[0] + '% ' + a[1] + '%, ' + b[0] + '% ' + b[1] + '%)';
      facet.style.setProperty('--fold-angle', (35 + i * 60) + 'deg');
    }
    layers.forEach(layer => {
      const clone = layer.cloneNode(true);
      clone.removeAttribute('id');
      clone.classList.remove('is-selected');
      clone.querySelectorAll('[id], .sticker__ctrl').forEach(el => {
        if (el.classList.contains('sticker__ctrl')) el.remove();
        else el.removeAttribute('id');
      });
      facet.appendChild(clone);
    });
    sheet.appendChild(facet);
    facets.push(facet);
  }
  viewfinder.appendChild(sheet);
  // Keep a continuous paper surface beneath the folding sections.
  const backing = facets[0].cloneNode(true);
  backing.className = 'paper-crumple__backing';
  backing.style.clipPath = '';
  sheet.prepend(backing);
  $camera.classList.add('is-crumpling');
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    sheet.remove();
    $camera.classList.remove('is-crumpling');
    hideReview();
    resetCameraView();
    isDiscardingPhoto = false;
    setControlsLocked(false);
    [$reviewKeep, $landscapeKeep, $reviewRetake, $landscapeRetake].filter(Boolean)
      .forEach(button => { button.disabled = false; });
  };
  if (lastPhoto) {
    deletePhoto(lastPhoto.card, lastPhoto.id, { undoMode: 'edit' });
    lastPhoto = null;
  }
  if (!capturedImg) { finish(); return; }
  const animation = gsap.timeline({
    onStart: () => playUiSound('paper_crush.mp3'),
    onComplete: finish, onInterrupt: finish
  });
  if (reduced) {
    animation.to(sheet, { opacity: 0, duration: 0.25, ease: 'power1.out' });
    return;
  }
  animation
    .to(backing, { scaleX: 0.6, scaleY: 0.63, rotation: -2, duration: 0.78, ease: 'power1.inOut',
      clipPath: 'polygon(9% 5%, 57% 0%, 96% 12%, 100% 87%, 43% 100%, 0% 90%)' }, 0)
    .to(backing, { scaleX: 0.2, scaleY: 0.23, rotation: 3, duration: 0.32, ease: 'power1.inOut',
      clipPath: 'polygon(17% 8%, 62% 0%, 95% 24%, 88% 88%, 38% 100%, 0% 72%)' }, 0.78)
    .to(sheet, { '--crease': 1, duration: 0.35 }, 0)
    .to(facets, {
      rotation: i => i % 2 ? 1 : -1, rotationX: i => i % 2 ? 3 : -3,
      scaleX: 0.99, scaleY: 0.99, duration: 0.18, ease: 'power1.in'
    }, 0)
    .to(facets, {
      x: i => [12, -6, -14, -10, 8, 15][i],
      y: i => [8, 13, 4, -9, -12, -5][i],
      scaleX: i => [0.58, 0.67, 0.53, 0.72, 0.61, 0.56][i],
      scaleY: i => [0.75, 0.55, 0.68, 0.59, 0.63, 0.71][i],
      rotationX: i => i % 2 ? 24 : -20, rotationY: i => i % 2 ? -22 : 26,
      rotation: i => [3, -4, 6, -5, 4, -3][i],
      duration: 0.6, ease: 'power1.inOut'
    }, 0.18)
    .to(facets, {
      scaleX: i => [0.16, 0.22, 0.19, 0.27, 0.17, 0.24][i],
      scaleY: i => [0.24, 0.18, 0.29, 0.21, 0.25, 0.17][i],
      rotationX: i => i % 2 ? 38 : -33, rotationY: i => i % 2 ? -32 : 35,
      rotation: i => [5, -7, 8, -6, 7, -5][i],
      duration: 0.32, ease: 'power1.inOut'
    }, 0.78)
    .to(sheet, { y: 16, rotation: 3, scale: 0.75, opacity: 0, duration: 0.2, ease: 'power1.in' }, 1.1);
}

// Home-Abbruch vor „Annehmen“: Die Aufnahme wurde nie bestätigt und wird
// deshalb endgültig verworfen.
function discardUnacceptedPhoto() {
  if (!hasPhoto) return;
  if (lastPhoto) {
    deletePhoto(lastPhoto.card, lastPhoto.id);
    lastPhoto = null;
  }
}

async function keepPhoto() {
  if (isSavingPhoto || !hasPhoto) return;
  playUiSound('Button_push.mp3');
  isSavingPhoto = true;
  const actions = [$reviewKeep, $landscapeKeep, $reviewRetake, $landscapeRetake].filter(Boolean);
  actions.forEach((button) => { button.disabled = true; });
  $camera.setAttribute('aria-busy', 'true');
  try {
    applyLanguage(defaultLang);
    const photo = lastPhoto;
    const stagePhoto = $camera.querySelector('.viewfinder img.stage-photo');
    const photoUrl = stagePhoto ? stagePhoto.src : null;
    const hasEdits = activeStickers.length || currentFilter !== 'standard' || !!currentOverlay;
    // Keep the review and its geometry intact until the edited upload succeeds.
    if (hasEdits) {
      await saveEditedPhoto({ endScreen: isKioskLayout() });
      return;
    }
    if (photo && photo.savePromise) {
      try { await photo.savePromise; } catch (e) { /* already reported */ }
    }
    hideReview();
    setControlsLocked(false);
    if (isKioskLayout()) {
      if (photo && photo.id) showToast(t('toastSaved'));
      if (photoUrl) showEndScreen(photoUrl);
      return;
    }
    resetCameraView();
    if (photo && photo.id) showToast(t('toastSaved'));
  } finally {
    isSavingPhoto = false;
    $camera.removeAttribute('aria-busy');
    actions.forEach((button) => { button.disabled = false; });
  }
}

function retakePhoto() {
  if (isDiscardingPhoto || !hasPhoto || isSavingPhoto) return;
  isDiscardingPhoto = true;
  setControlsLocked(true);
  [$reviewKeep, $landscapeKeep, $reviewRetake, $landscapeRetake].filter(Boolean)
    .forEach((button) => { button.disabled = true; });
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

// Die Gültigkeit kommt vom Server (ttl in Sekunden) und entspricht damit
// genau der im Admin-Panel gesetzten Stundenzahl. Ab 24 Stunden in Tagen.
function qrTtlLabel(seconds) {
  const fallback = (appSettings.qrTtlHours || 24) * 3600;
  const hours = Math.max(1, Math.round((Number(seconds) || fallback) / 3600));
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? t('qrTtlDay') : t('qrTtlDays').replace('{n}', String(days));
  }
  return hours === 1 ? t('qrTtlHour') : t('qrTtlHours').replace('{n}', String(hours));
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
    $qrTtl.textContent = qrTtlLabel(data.ttl);
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
  none: 'faceNone', thug: 'faceThug', mlg: 'faceMlg', big: 'faceBig', faceswap: 'faceFaceswap', cheeky: 'faceCheeky',
  shades: 'faceShades', boss: 'faceBoss', bling: 'faceBling', joint: 'faceJoint',
  unibrow: 'faceUnibrow', cat: 'faceCat', bunny: 'faceBunny', hearts: 'faceHearts', makeup: 'faceMakeup',
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
      if (!appSettings.filtersEnabled) return;
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
  updateBarMenuSelection();
}

$filterChips.forEach((chip) => chip.addEventListener('click', () => {
  if (!appSettings.filtersEnabled) return;
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
let activeStickerDragCancel = null;

function enablePlacedStickerDrag(st) {
  st.el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sticker__ctrl') || e.button !== 0 || e.isPrimary === false) return;
    if (activeStickerDragCancel) activeStickerDragCancel();
    if (st.dragReturnCancel) st.dragReturnCancel();
    e.preventDefault();
    e.stopPropagation();
    selectSticker(st);
    const frame = photoStageRect();
    const origin = st.el.getBoundingClientRect();
    const originalOpacity = st.el.style.opacity;
    const originalTransform = st.el.style.transform;
    const pointerId = e.pointerId;
    let dragging = false;
    let ghost = null;
    let ghostCleaned = false;
    const cleanupGhost = () => {
      if (ghostCleaned) return;
      ghostCleaned = true;
      if (ghost) { gsap.killTweensOf(ghost); ghost.remove(); }
      st.el.style.opacity = originalOpacity;
      delete st.dragReturnCancel;
    };
    try { st.el.setPointerCapture(pointerId); } catch (err) {}
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        dragging = true;
        ghost = document.createElement('div');
        ghost.className = 'sticker-drag-preview';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        const stickerStyle = getComputedStyle(st.el);
        const width = parseFloat(stickerStyle.width);
        const height = parseFloat(stickerStyle.height);
        Object.assign(ghost.style, {
          left: (origin.left + origin.width / 2 - width / 2) + 'px',
          top: (origin.top + origin.height / 2 - height / 2) + 'px',
          width: width + 'px', height: height + 'px'
        });
        const copy = st.el.cloneNode(true);
        copy.classList.remove('is-selected');
        copy.removeAttribute('id');
        copy.querySelectorAll('.sticker__ctrl').forEach(el => el.remove());
        Object.assign(copy.style, { left: '50%', top: '50%', width: '100%', height: '100%' });
        ghost.appendChild(copy);
        document.body.appendChild(ghost);
        st.el.style.opacity = '0';
        startElementTrash();
      }
      ev.preventDefault();
      updateElementTrash(ev.clientX, ev.clientY);
      ghost.style.transform = 'translate(' + (ev.clientX - e.clientX) + 'px, ' + (ev.clientY - e.clientY) + 'px)';
    };
    const up = (ev) => {
      if (ev.pointerId !== undefined && ev.pointerId !== pointerId) return;
      const remove = dragging && ev.type === 'pointerup' && elementTrashContains(ev.clientX, ev.clientY);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel, true);
      window.removeEventListener('keydown', keydown, true);
      try { st.el.releasePointerCapture(pointerId); } catch (err) {}
      activeStickerDragCancel = null;
      if (dragging) stopElementTrash();
      if (remove) {
        cleanupGhost();
        removeSticker(st);
      } else if (dragging && ev.type === 'pointerup' && pointerInside(frame, ev.clientX, ev.clientY)) {
        st.x = ((origin.left + origin.width / 2 + ev.clientX - e.clientX - frame.left) / frame.width) * 100;
        st.y = ((origin.top + origin.height / 2 + ev.clientY - e.clientY - frame.top) / frame.height) * 100;
        positionSticker(st);
        st.el.style.transform = originalTransform;
        positionStickerControls(st);
        cleanupGhost();
      } else if (dragging && ev.type === 'pointerup' && !reducedCaptureMotion()) {
        // Invalid drop: only the temporary drawing returns; saved coordinates never moved.
        st.dragReturnCancel = cleanupGhost;
        gsap.to(ghost, { x: 0, y: 0, duration: 0.22, ease: 'power2.out', onComplete: cleanupGhost, onInterrupt: cleanupGhost });
      } else cleanupGhost();
    };
    const cancel = () => up({ type: 'pointercancel', pointerId });
    const keydown = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancel();
    };
    activeStickerDragCancel = cancel;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel, true);
    window.addEventListener('keydown', keydown, true);
  });
}

function textStickerSpec(kind) {
  return TEXT_STICKERS.find((item) => item.kind === kind) || null;
}

// Datum und Uhrzeit beziehen sich auf den Moment der Aufnahme, nicht auf
// den Zeitpunkt, an dem der Sticker aus dem Menü gezogen wird.
function stickerStampDate() {
  const capturedAt = lastPhoto && lastPhoto.capturedAt ? lastPhoto.capturedAt : Date.now();
  return new Date(capturedAt);
}

function stickerStampValue(kind) {
  const date = stickerStampDate();
  const locale = currentLang === 'en' ? 'en-GB' : 'de-DE';
  try {
    if (kind === 'date') {
      return new Intl.DateTimeFormat(locale, {
        day: '2-digit', month: '2-digit', year: 'numeric'
      }).format(date);
    }
    if (kind === 'time') {
      return new Intl.DateTimeFormat(locale, {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).format(date);
    }
  } catch (e) {}
  return kind === 'date' ? date.toLocaleDateString() : date.toTimeString().slice(0, 5);
}

function escapeXmlText(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[ch]);
}

// Text-Sticker werden als SVG gerendert. Dadurch laufen Vorschau und
// exportiertes Foto durch dieselbe Sticker-Pipeline wie Formen und Emojis.
function textStickerSvg(kind) {
  const spec = textStickerSpec(kind);
  if (!spec) return '';
  const text = escapeXmlText(stickerStampValue(kind));
  const width = spec.svgWidth;
  const height = spec.svgHeight;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '">'
    + '<rect x="2" y="2" width="' + (width - 4) + '" height="' + (height - 4) + '" rx="' + ((height - 4) / 2) + '" fill="#090a0e" fill-opacity="0.78" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/>'
    + '<text x="' + (width / 2) + '" y="' + (height / 2) + '" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI, Arial, sans-serif" font-size="' + spec.fontSize + '" font-weight="700" letter-spacing="2" fill="#ffffff">' + text + '</text>'
    + '</svg>';
}

function stickerSvgUrl(kind) {
  const textSvg = textStickerSvg(kind);
  if (textSvg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(textSvg);
  }
  const svg = $stickerPalette.querySelector('[data-sticker="' + kind + '"] svg').cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // width/height für verlässliche naturalWidth beim Canvas-Rendering
  const vb = svg.getAttribute('viewBox').split(/\s+/);
  svg.setAttribute('width', vb[2]);
  svg.setAttribute('height', vb[3]);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
}

function addSticker(kind) {
  if (!appSettings.stickersEnabled) return;
  const el = document.createElement('div');
  el.className = 'sticker';
  const img = document.createElement('img');
  img.src = stickerSvgUrl(kind);
  img.draggable = false;
  img.alt = '';
  el.appendChild(img);

  const textSpec = textStickerSpec(kind);
  const st = textSpec
    ? { el, x: textSpec.x, y: textSpec.y, w: textSpec.w }
    : { el, x: 50, y: 35, w: 26 };
  $camera.querySelector('.viewfinder').appendChild(el);
  activeStickers.push(st);
  positionSticker(st);

  enablePlacedStickerDrag(st);

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
  const topAligned = getComputedStyle(stage).objectPosition.split(/\s+/)[1] === '0%';
  const top = vf.top + (topAligned ? 0 : (vf.height - height) / 2);
  return {
    left: vf.left + (vf.width - width) / 2,
    top,
    width,
    height,
    right: vf.left + (vf.width + width) / 2,
    bottom: top + height
  };
}

// Sticker positions are limited to the visible photo area.
function stickerSafeRect() {
  return photoStageRect();
}

// Die +/−/Mülleimer-Leiste sitzt normalerweise über dem Sticker. Ist dort
// kein Platz, klappt sie unter den Sticker und wird an den Fotorändern gehalten.
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
  const remove = mk('', t('stickerRemove'), () => removeSticker(st));
  // Derselbe Papierkorb wie an den Galerie-Fotos, damit dieselbe Aktion
  // überall gleich aussieht.
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>';
  ctrl.appendChild(remove);
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
  if (st.dragReturnCancel) st.dragReturnCancel();
  if (selectedSticker === st) deselectSticker();
  st.el.remove();
  activeStickers = activeStickers.filter((s) => s !== st);
}

function clearStickers() {
  if (activeStickerDragCancel) activeStickerDragCancel();
  cancelMenuDrag();
  deselectSticker();
  [...activeStickers].forEach((st) => {
    if (st.dragReturnCancel) st.dragReturnCancel();
    st.el.remove();
  });
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

  if (currentOverlay) {
    const overlay = currentOverlay;
    if (!overlayFitsPhoto(overlay, photoEl)) throw new Error('Frame and photo pixel dimensions differ');
    const img = await loadNativeOverlay(overlay);
    if (photoEl.classList.contains('stage-photo--strip') && lastStripLayout) {
      const { w, h, pad, gap, count, cols = 2 } = lastStripLayout;
      for (let i = 0; i < count; i++) {
        // Three arguments: native PNG pixels at the tile origin, no scaling.
        ctx.drawImage(img, pad + (i % cols) * (w + gap), pad + Math.floor(i / cols) * (h + gap));
      }
    } else {
      ctx.drawImage(img, 0, 0);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}

async function saveEditedPhoto(options = {}) {
  const photoEl = $camera.querySelector('.viewfinder img.stage-photo');
  const photo = lastPhoto;
  if (!photoEl || !photo) return false;
  if (photo.savePromise) {
    try { await photo.savePromise; } catch (e) { /* already reported */ }
  }
  let edited;
  try {
    edited = await renderEditedPhoto(photoEl);
  } catch (err) {
    console.warn('Photo composition failed:', err);
    showToast(t('toastEditError'), { error: true });
    return false;
  }
  if (lastPhoto !== photo || !photoEl.isConnected) return false;
  try {
    // If the original upload failed, save the edited photo as a new object.
    const payload = { image: edited };
    if (photo.id) payload.id = photo.id;
    const res = await fetch('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...photoSessionHeaders() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const id = data.id || photo.id;
    if (!id) throw new Error('Photo upload returned no ID');
    const hadId = !!photo.id;
    photo.id = id;
    const card = photo.card;
    if (card && card.isConnected) {
      card.dataset.id = id;
      const image = card.querySelector('img');
      if (image) image.src = edited;
      if (!hadId) attachDelete(card, id);
      if (card._photoRecord) {
        const index = photos.indexOf(card._photoRecord.url);
        if (index !== -1) photos[index] = edited;
        card._photoRecord.id = id;
        card._photoRecord.url = edited;
      }
    }
    addPhotoIndexId(id);
    if (data.streak) applyStreak(data.streak);
  } catch (err) {
    console.warn('Edited photo could not be saved:', err);
    showToast(t('toastEditedSaveError'), { error: true });
    // Preserve the photo, selected frame and stickers for another attempt.
    return false;
  }
  if (lastPhoto !== photo || !photoEl.isConnected) return false;
  clearStickers();
  currentOverlay = null;
  photoEl.src = edited;
  renderOverlayPreview();
  hideReview();
  setControlsLocked(false);
  showToast(t('toastSaved'));
  if (options.endScreen) showEndScreen(edited);
  else resetCameraView();
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reducedCaptureMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function awaitCaptureTask(task, runId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (captureTaskCancel === cancel) captureTaskCancel = null;
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new DOMException('Capture cancelled', 'AbortError'));
    const timer = window.setTimeout(() => finish(new Error('Capture processing timed out')), 20000);
    captureTaskCancel = cancel;
    Promise.resolve(task).then(value => finish(null, value), error => finish(error));
    if (runId !== captureRunId) cancel();
  });
}

function prepareCaptureResult() {
  // Switch scenes once, while the full-screen flash is at its peak.
  $camera.classList.add('is-reviewing', 'is-printing', 'is-capture-result');
  // Focus in an expanded menu can leave the clipped stage scrolled sideways.
  $camera.querySelector('.camera__stage').scrollLeft = 0;
  const actions = document.getElementById('reviewActions');
  if (actions) actions.hidden = !isKioskLayout();
  $review.hidden = isKioskLayout();
  syncBarToggleLabel();
  gsap.set($placeholder, { opacity: 0 });
}

function flashCapture(toResult = false) {
  if (captureFlash) captureFlash.finish();
  const reduced = reducedCaptureMotion();
  let resolve, resolveReady;
  const promise = new Promise(done => { resolve = done; });
  const ready = new Promise(done => { resolveReady = done; });
  let finished = false;
  const effect = { promise, ready, tween: null, finish: () => {
    if (finished) return;
    finished = true;
    if (effect.tween) effect.tween.kill();
    gsap.set($flash, { opacity: 0 });
    if (captureFlash === effect) captureFlash = null;
    resolveReady();
    resolve();
  } };
  captureFlash = effect;
  effect.tween = timeline({ onComplete: effect.finish, onInterrupt: effect.finish })
    .to($flash, {
      opacity: reduced ? 0.16 : 1, duration: reduced ? 0.15 : 0.18, ease: 'power1.out',
      onComplete: () => {
        if (toResult) prepareCaptureResult();
        resolveReady();
      }
    })
    .to($flash, { opacity: 0, duration: reduced ? 0.25 : 0.4, ease: 'power1.inOut' });
  return promise;
}

function clearCapturePresentation() {
  if (captureTaskCancel) captureTaskCancel();
  if (capturePrint) capturePrint.finish(false);
  if (captureFlash) captureFlash.finish();
  stopPrinterSound();
  clearTimeout(processingTimer);
  processingTimer = 0;
  ++processingRevision;
  gsap.killTweensOf($processing);
  gsap.set($processing, { opacity: 0 });
  $processing.hidden = true;
  $processing.setAttribute('aria-hidden', 'true');
  $camera.classList.remove('is-printing');
}

function animatePrintedPhoto(targets, runId) {
  const reduced = reducedCaptureMotion();
  const duration = reduced ? 0.18 : 2;
  const distance = $camera.querySelector('.viewfinder').getBoundingClientRect().height;
  if (capturePrint) capturePrint.finish(false);
  // Keep controls stationary and reveal them after the photo has finished printing.
  const controls = (isKioskLayout()
    ? [document.getElementById('captureBar'), $cancelHome]
    : [$review]).filter(Boolean);
  const controlStates = controls.map(el => ({ el, inert: el.inert }));
  const homeWasHidden = $cancelHome && $cancelHome.hidden;
  if (isKioskLayout() && $cancelHome) $cancelHome.hidden = false;
  controls.forEach(el => { el.inert = true; });
  return new Promise(resolve => {
    let finished = false;
    const effect = { tween: null, finish: (success) => {
      if (finished) return;
      finished = true;
      if (effect.tween) effect.tween.kill();
      stopPrinterSound();
      window.removeEventListener('resize', completeOnResize);
      gsap.set(targets, { opacity: 1, clearProps: 'transform,visibility' });
      gsap.set(controls, { clearProps: 'transform,visibility,opacity' });
      controlStates.forEach(({ el, inert }) => { el.inert = inert; });
      if (!success && isKioskLayout() && $cancelHome) $cancelHome.hidden = homeWasHidden;
      $camera.classList.remove('is-printing');
      if (capturePrint === effect) capturePrint = null;
      resolve(!!success && runId === captureRunId);
    } };
    const completeOnResize = () => effect.finish(true);
    capturePrint = effect;
    window.addEventListener('resize', completeOnResize);
    gsap.set(targets, { y: reduced ? 0 : -distance, opacity: reduced ? 0 : 1, visibility: 'visible' });
    gsap.set(controls, { opacity: 0, visibility: 'visible', clearProps: 'transform' });
    effect.tween = gsap.timeline({
      defaults: { duration, ease: reduced ? 'power1.out' : 'none' },
      onStart: () => { if (!reduced) playPrinterSound(duration); },
      onComplete: () => effect.finish(true),
      onInterrupt: () => effect.finish(false)
    })
      .to(targets, { y: 0, opacity: 1 }, 0)
      .call(stopPrinterSound, [], duration)
      .to(controls, { opacity: 1, duration: reduced ? 0 : 0.4, ease: 'power1.inOut' }, duration);
  });
}

async function runSingleCapture(runId) {
  lastStripLayout = null;
  // 1. countdown with tick sounds
  if (!(await runCountdown(runId))) return false;
  if (runId !== captureRunId) return false;

  // Flash directly after the countdown; switch scenes at the white peak.
  playShutterSound();
  flashCapture(true);

  // 4. process photo. Im Kiosk wird der gewählte Komplett-Filter bereits
  // ins JPEG gebacken; danach wird die Auswahl für die Review-Pipeline auf
  // Standard gesetzt, damit der Filter nicht doppelt angewendet wird.
  if (!isKioskLayout()) {
    currentFilter = 'standard';
    applyFilterSelection();
  }
  showProcessing(runId);
  $video.pause();
  const photoUrl = await awaitCaptureTask(captureFromVideo(), runId);
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

  for (let i = 0; i < total; i++) {
    if (runId !== captureRunId) return false;
    showStripProgress(i + 1, total);
    if (!(await runCountdown(runId))) {
      hideStripProgress();
      return false;
    }
    if (runId !== captureRunId) return false;
    playShutterSound();
    const flashDone = flashCapture(i === total - 1);
    frames.push(await awaitCaptureTask(captureFromVideo(), runId));
    if (runId !== captureRunId) return false;
    await awaitCaptureTask(flashDone, runId);
  }
  if (runId !== captureRunId) return false;
  hideStripProgress();

  if (isKioskLayout()) {
    currentFilter = 'standard';
    applyFilterSelection();
  }
  showProcessing(runId);
  $video.pause();
  const stripUrl = await awaitCaptureTask(composeStrip(frames), runId);
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
  // Während ein Foto zum Annehmen/Neuaufnehmen offen ist, darf kein
  // weiterer Countdown darüberlaufen (z. B. durch einen Fernauslöser).
  if ($camera.classList.contains('is-reviewing')
    || $camera.classList.contains('is-ended')
    || $camera.classList.contains('is-finishing')) return;
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
  const shutter = isKioskLayout() ? document.getElementById('landscapeCaptureBtn') : $captureBtn;
  if (shutter) shutter.focus({ preventScroll: true });

  // unlock / resume audio while we still have the user gesture
  unlockAudio();

  try {
    const completed = captureMode === 'strip'
      ? await runStripCapture(runId)
      : await runSingleCapture(runId);
    if (!completed || runId !== captureRunId) return;
    showReview();
  } catch (err) {
    if (runId !== captureRunId) return;
    console.warn('Photo capture failed:', err);
    stopCountdown();
    hideStripProgress();
    resetCameraView();
    showToast(t('toastCaptureError'), { error: true });
  } finally {
    // Ein abgebrochener Lauf darf einen bereits gestarteten neuen Lauf
    // nicht mehr zurücksetzen.
    if (runId !== captureRunId) return;
    clearCapturePresentation();
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
    el = document.createElement('span');
    el.id = 'stripProgress';
    el.className = 'strip-progress';
    el.setAttribute('aria-live', 'polite');
  }
  const shutter = isKioskLayout() ? document.getElementById('landscapeCaptureBtn') : $captureBtn;
  if (el.parentElement !== shutter) shutter.appendChild(el);
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
  if (images.some((img) => img.naturalWidth !== w || img.naturalHeight !== h)) {
    throw new Error('Collage photos have different pixel dimensions');
  }
  const cols = 2;
  const rows = Math.ceil(images.length / cols);
  const pad = Math.round(w * 0.035);
  const gap = Math.round(w * 0.018);
  const footer = Math.round(w * 0.075);
  lastStripLayout = { w, h, pad, gap, footer, count: images.length, cols, rows };
  const canvas = document.createElement('canvas');
  canvas.width = pad * 2 + w * cols + gap * (cols - 1);
  canvas.height = pad * 2 + h * rows + gap * (rows - 1) + footer;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    const x = pad + (i % cols) * (w + gap);
    const y = pad + Math.floor(i / cols) * (h + gap);
    ctx.drawImage(img, x, y);
  });
  ctx.fillStyle = '#111111';
  ctx.font = '700 ' + Math.round(footer * 0.5) + "px 'SF Pro Display', -apple-system, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SNAPBOX', canvas.width / 2, canvas.height - footer * 0.55);
  return canvas.toDataURL('image/jpeg', 0.92);
}

// Blendet die Countdown-Anzeige sofort und dauerhaft aus. Das ist bewusst
// strenger als nur `opacity: 0`: Auch ein hängender GSAP-Tween oder ein
// abgebrochener Lauf kann die Ziffer so nicht über dem Review stehen lassen.
function hideCountdown() {
  gsap.killTweensOf($countdown);
  gsap.set($countdown, { scale: 1, opacity: 0 });
  $countdown.style.opacity = '0';
  $countdown.style.visibility = 'hidden';
  $countdown.setAttribute('aria-hidden', 'true');
}

// Beendet einen laufenden Countdown samt Timern und blendet ihn aus.
function stopCountdown() {
  if (countdownState) {
    const state = countdownState;
    countdownState = null;
    state.timers.forEach((id) => clearTimeout(id));
    cancelAnimationFrame(state.ringFrame);
    state.resolve(false);
  }
  hideCountdown();
}

function finishCountdown(completed) {
  if (!countdownState) {
    hideCountdown();
    return;
  }
  const state = countdownState;
  countdownState = null;
  state.timers.forEach((id) => clearTimeout(id));
  cancelAnimationFrame(state.ringFrame);
  hideCountdown();
  state.resolve(completed);
}

function runCountdown(runId) {
  if (countdownState) finishCountdown(false);
  return new Promise((resolve) => {
    let count = countdownSeconds;
    const STEP_MS = 900;
    const total = count;
    const digit = document.getElementById('countdownValue');
    const ring = document.getElementById('countdownRing');
    const textMetrics = document.createElement('canvas').getContext('2d');
    const digitStyle = getComputedStyle(digit);
    textMetrics.font = digitStyle.fontWeight + ' ' + digitStyle.fontSize + ' ' + digitStyle.fontFamily;
    const reduced = reducedCaptureMotion();
    const state = { resolve, timers: [], ringFrame: 0, stepStarted: 0 };
    countdownState = state;
    // Render only: interpolate within the existing step; its timer still drives capture.
    const paintRing = () => {
      if (countdownState !== state) return;
      const elapsed = reduced ? 0 : Math.min(1, (performance.now() - state.stepStarted) / STEP_MS);
      ring.style.strokeDashoffset = String(-Math.min(1, (total - count + elapsed) / total));
      if (!reduced) state.ringFrame = requestAnimationFrame(paintRing);
    };

    const schedule = (fn, ms) => {
      const id = setTimeout(fn, ms);
      state.timers.push(id);
    };

    gsap.killTweensOf($countdown);
    $countdown.style.visibility = 'visible';
    $countdown.style.opacity = '1';
    $countdown.setAttribute('aria-hidden', 'false');

    const showTick = () => {
      if (runId !== captureRunId) {
        finishCountdown(false);
        return;
      }
      digit.textContent = String(count);
      // Center the visible glyphs, rather than the font's ascender/descender box.
      const ink = textMetrics.measureText(String(count));
      digit.setAttribute('x', String(50 + (ink.width + ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2));
      digit.setAttribute('y', String(50 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2));
      state.stepStarted = performance.now();
      ring.style.strokeDashoffset = String(-(total - count) / total);
      playCountdownTick(count === 1);

      schedule(() => {
        count--;
        if (count >= 1) {
          showTick();
        } else {
          ring.style.strokeDashoffset = '-1';
          finishCountdown(true);
        }
      }, STEP_MS);
    };

    showTick();
    if (!reduced) state.ringFrame = requestAnimationFrame(paintRing);
  });
}

function showProcessing(runId = captureRunId) {
  const revision = ++processingRevision;
  clearTimeout(processingTimer);
  gsap.killTweensOf($processing);
  $processing.hidden = true;
  $processing.setAttribute('aria-hidden', 'true');
  gsap.set($processing, { opacity: 0 });
  processingTimer = window.setTimeout(async () => {
    processingTimer = 0;
    // Dissolve white into the result surface before showing status.
    if (captureFlash) await captureFlash.promise;
    if (revision !== processingRevision || runId !== captureRunId) return;
    $processing.hidden = false;
    $processing.setAttribute('aria-hidden', 'false');
    gsap.to($processing, { opacity: 1, duration: 0.12, ease: 'power1.out' });
  }, 220);
}

function hideProcessing() {
  ++processingRevision;
  clearTimeout(processingTimer);
  processingTimer = 0;
  gsap.killTweensOf($processing);
  gsap.set($processing, { opacity: 0 });
  $processing.hidden = true;
  $processing.setAttribute('aria-hidden', 'true');
  return Promise.resolve();
}

async function showCaptureResult(photoUrl, runId = captureRunId) {
  if (runId !== captureRunId) return false;
  const img = document.createElement('img');
  img.className = 'stage-photo';
  const fit = captureMode === 'strip' ? 'contain' : 'cover';
  if (captureMode === 'strip') img.classList.add('stage-photo--strip');
  img.src = photoUrl;
  await awaitCaptureTask(img.decode(), runId);
  if (captureFlash) await awaitCaptureTask(captureFlash.ready, runId);
  if (runId !== captureRunId) return false;
  img.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;'
    + 'object-fit: ' + fit + '; background: transparent; opacity: 0; border-radius: 0;'
    + 'filter: grayscale(0%) contrast(1);';
  const viewfinder = $camera.querySelector('.viewfinder');
  viewfinder.appendChild(img);
  prepareCaptureResult();
  hasPhoto = true;
  try {
    await awaitCaptureTask(renderOverlayPreview(), runId);
    await awaitCaptureTask(hideProcessing(), runId);
    if (captureFlash) await awaitCaptureTask(captureFlash.promise, runId);
    if (runId !== captureRunId) return false;
    const targets = [img, ...viewfinder.querySelectorAll('.photo-overlay, .photo-overlay-strip')];
    const completed = await animatePrintedPhoto(targets, runId);
    if (!completed) img.remove();
    return completed;
  } catch (err) {
    img.remove();
    throw err;
  }
}

function resetCameraView() {
  clearCapturePresentation();
  $review.hidden = true;
  const existingImg = $camera.querySelector('.viewfinder img.stage-photo');
  if (existingImg) existingImg.remove();
  clearStickers();
  currentOverlay = null;
  lastStripLayout = null;
  renderOverlayPreview();
  $camera.classList.remove('is-reviewing', 'is-stamping', 'is-ended', 'is-finishing', 'is-capture-result');
  const endScreen = document.getElementById('endScreen');
  if (endScreen) endScreen.hidden = true;
  document.body.classList.remove('challenge-end-active');
  if ($challengeEnd) $challengeEnd.hidden = true;
  challengeEndPhotoId = null;
  challengeEndChoice = null;
  const reviewActions = document.getElementById('reviewActions');
  if (reviewActions) reviewActions.hidden = true;
  if (isKioskLayout()) {
    openSideMenu('filter');
    setSideMenuOpen(false);
  }
  currentFilter = 'standard';
  applyFilterSelection();

  gsap.set($processing, { opacity: 0 });
  gsap.set($flash, { opacity: 0 });
  hideCountdown();

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
    headers: { 'Content-Type': 'application/json', ...photoSessionHeaders() },
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

// ============================================================
//  GÄSTE-SITZUNG
//  Löschen ist nur zwischen Startbildschirm und Zurückspringen erlaubt.
//  Gäste löschen endgültig und haben keinen Papierkorb; dieser existiert nur
//  noch im Admin-Panel.
// ============================================================
const PHOTO_SESSION_HEADER = 'X-Photo-Session';
let photoSessionToken = null;
// Nur diese IDs wurden in der laufenden Sitzung aufgenommen. Die Galerie
// zeigt weiterhin alle Fotos, Löschbuttons bekommen aber nur diese Karten.
const sessionPhotoIds = new Set();

function clearSessionDeleteButtons() {
  document.querySelectorAll('.gallery__delete').forEach((btn) => btn.remove());
}

function photoSessionHeaders(extra = {}) {
  return photoSessionToken
    ? { ...extra, [PHOTO_SESSION_HEADER]: photoSessionToken }
    : extra;
}

// Leichtgewichtige Nutzungszählung für das Admin-Dashboard. Fehler dürfen den
// Gast-Flow nie beeinflussen; deshalb fire-and-forget ohne Rückmeldung.
function trackUsageEvent(event) {
  try {
    fetch('/api/stats/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      keepalive: true
    }).catch(() => {});
  } catch (e) { /* Statistik ist optional */ }
}

async function beginPhotoSession() {
  if (photoSessionToken) return photoSessionToken;
  try {
    const res = await fetch('/api/photo-session', { method: 'POST', cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !data.token) throw new Error('Missing token');
    // Falls inzwischen schon wieder zum Startbildschirm zurückgesprungen
    // wurde, gehört diese Antwort zu keiner aktiven Sitzung mehr.
    if (currentState === 'splash') {
      fetch('/api/photo-session', {
        method: 'DELETE',
        headers: { [PHOTO_SESSION_HEADER]: data.token },
        keepalive: true
      }).catch(() => {});
      return null;
    }
    photoSessionToken = data.token;
    sessionPhotoIds.clear();
    clearSessionDeleteButtons();
    document.body.classList.add('photo-session-active');
    return photoSessionToken;
  } catch (err) {
    console.warn('Guest session could not be started:', err);
    return null;
  }
}

function endPhotoSession() {
  document.body.classList.remove('photo-session-active');
  const token = photoSessionToken;
  photoSessionToken = null;
  sessionPhotoIds.clear();
  clearSessionDeleteButtons();
  if (token) {
    fetch('/api/photo-session', {
      method: 'DELETE',
      headers: { [PHOTO_SESSION_HEADER]: token },
      keepalive: true
    }).catch(() => {});
  }
}

// Gäste löschen endgültig — es gibt für sie keinen Papierkorb. Beim
// „Neu aufnehmen“ führt die Toast-Aktion zurück in den Editor, beim Löschen
// in der Galerie nur zurück in die Galerie.
// Without a server id the photo was never saved, so only the card is removed.
async function deletePhoto(card, photoId, { undoMode = null } = {}) {
  if (!photoSessionToken) {
    showToast(t('toastDeleteSessionOnly'), { error: true });
    return;
  }
  if (!photoId) {
    // Noch kein Server-Objekt: Die ID kommt ggf. erst nach dem Upload. Der
    // Save-Callback löscht die Datei dann, sobald sie existiert.
    removeCard(card);
    return;
  }
  const key = 'delete:' + photoId;
  if (pendingOps.has(key)) return;
  pendingOps.add(key);
  const image = card && card.querySelector('img') ? card.querySelector('img').src : null;
  try {
    const query = 'id=' + encodeURIComponent(photoId) + '&purge=1';
    const res = await fetch('/api/photos?' + query, {
      method: 'DELETE',
      headers: photoSessionHeaders()
    });
    // 404 = bereits gelöscht (Doppelklick-Race) — gilt als Erfolg
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    removeCard(card);
    if (undoMode) {
      if (image) {
        const restoreInGallery = undoMode === 'gallery';
        showToast(t('toastDeleted'), {
          actionLabel: t(restoreInGallery ? 'toastRestoreAction' : 'toastEditAction'),
          onAction: restoreInGallery
            ? () => restorePhotoToGallery(image)
            : () => openPhotoInReview(image)
        });
      } else {
        showToast(t('toastDeleted'));
      }
    }
  } catch (err) {
    console.warn('Photo could not be deleted:', err);
    showToast(t('toastDeleteError'), { error: true });
  } finally {
    pendingOps.delete(key);
  }
}

// Stellt ein in der Galerie gelöschtes Foto wieder her, ohne den Editor zu
// öffnen. Da der Server endgültig löscht, wird das Bild neu hochgeladen und
// als neue Karte angelegt.
function restorePhotoToGallery(imageUrl) {
  if (!imageUrl || !photoSessionToken) return;
  const card = addToGallery(imageUrl);
  // Kein Review-Zustand für ein reines Wiederherstellen anlegen.
  if (lastPhoto && lastPhoto.card === card) lastPhoto = null;
}

// Öffnet ein gelöschtes Foto erneut im Sticker-/Overlay-Screen. Es wird als
// neue Aufnahme angelegt; erst „Annehmen“ übernimmt es wieder in die Galerie.
function openPhotoInReview(imageUrl) {
  if (!imageUrl || isCapturing || !photoSessionToken) return;
  if (lightbox) { lightbox.remove(); lightbox = null; }

  $gallery.style.display = 'none';
  $camera.style.display = 'block';
  $camera.style.opacity = '1';
  if ($endScreen) $endScreen.hidden = true;
  document.body.classList.remove('challenge-end-active');
  if ($challengeEnd) $challengeEnd.hidden = true;
  challengeEndPhotoId = null;
  challengeEndChoice = null;
  currentState = 'camera';
  $camera.classList.remove('is-ended', 'is-reviewing', 'is-stamping', 'is-finishing');
  setSideMenuOpen(false);
  setBarMenuOpen(false);
  setStampMenuOpen(false);
  setCaptureOptionsOpen(false);
  setControlsLocked(true);
  setHomeMode('default');
  syncCancelHome();

  const existing = $camera.querySelector('.viewfinder img.stage-photo');
  if (existing) existing.remove();
  clearStickers();
  currentOverlay = null;
  lastStripLayout = null;
  renderOverlayPreview();
  currentFilter = 'standard';
  applyFilterSelection();

  // Neue Karte anlegen, damit Annehmen/Neu aufnehmen wie nach einer echten
  // Aufnahme funktioniert. Der Upload läuft bereits im Hintergrund.
  addToGallery(imageUrl);

  const img = document.createElement('img');
  img.className = 'stage-photo';
  img.src = imageUrl;
  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; background: #000; opacity: 1; border-radius: 0;
    filter: grayscale(0%) contrast(1);
  `;
  $camera.querySelector('.viewfinder').appendChild(img);
  hasPhoto = true;
  showReview();
}

function removeCard(card) {
  if (!card.isConnected) return;
  if (lastPhoto && lastPhoto.card === card) lastPhoto = null;
  // Auch den Datensatz entfernen, sonst taucht das gelöschte Foto weiter in
  // Challenge-Zähler und Splash-Kette auf.
  if (card._photoRecord) {
    const record = card._photoRecord;
    if (record.id) removePhotoIndexId(record.id);
    const recordIndex = photoRecords.indexOf(record);
    if (recordIndex !== -1) photoRecords.splice(recordIndex, 1);
    const urlIndex = photos.indexOf(record.url);
    if (urlIndex !== -1) photos.splice(urlIndex, 1);
  }
  card.remove();
  setPhotoCount(photoCount - 1);
  if (!$galleryGrid.querySelector('.gallery__card')) $galleryEmpty.style.display = '';
  updateChallengeCard();
  renderSplashChain();
}

// Der Mülleimer gehört an die sichtbare Bildecke, nicht an die Ecke der
// 16:9-Kachel. Bei object-fit: contain liegen sonst schwarze Balken zwischen
// Foto und Button, wodurch er planlos im Kartenrand zu schweben scheint.
function positionGalleryDelete(card) {
  const btn = card.querySelector('.gallery__delete');
  const img = card.querySelector('img');
  if (!btn || !img) return;
  const cw = card.clientWidth;
  const ch = card.clientHeight;
  if (!cw || !ch || !img.naturalWidth || !img.naturalHeight) return;

  const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  const shownW = img.naturalWidth * scale;
  const shownH = img.naturalHeight * scale;
  const left = (cw - shownW) / 2;
  const top = (ch - shownH) / 2;

  // 10 px Abstand zur Bildkante, aber immer mindestens 8 px zur Kachel.
  btn.style.top = Math.max(8, top + 10) + 'px';
  btn.style.right = Math.max(8, left + 10) + 'px';
}

// Adds a delete button only to photos captured in the current session.
function attachDelete(card, photoId) {
  if (!photoSessionToken || !sessionPhotoIds.has(photoId)) return;
  if (card.querySelector('.gallery__delete')) return;
  const btn = document.createElement('button');
  btn.className = 'gallery__delete';
  btn.type = 'button';
  btn.setAttribute('aria-label', t('deletePhotoAria'));
  btn.title = t('deletePhotoAria');
  // Mülleimer statt ×: Die Aktion löscht das Foto endgültig.
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePhoto(card, photoId, { undoMode: 'gallery' });
  });
  card.appendChild(btn);
  positionGalleryDelete(card);
  const img = card.querySelector('img');
  if (img && !img.complete) {
    img.addEventListener('load', () => positionGalleryDelete(card), { once: true });
  }
}

// Galerie-Seitengröße kommt aus den Admin-Einstellungen (6/12/24).
let photoCursor = null;
let photoHasMore = false;
let photoPageLoading = false;

function setPhotoCount(count) {
  photoCount = Math.max(0, Number(count) || 0);
}

function setLoadMoreBusy(busy) {
  if (!$galleryLoadMore) return;
  const key = busy ? 'galleryLoading' : 'galleryLoadMore';
  $galleryLoadMore.disabled = busy;
  $galleryLoadMore.dataset.i18n = key;
  $galleryLoadMore.textContent = t(key);
}

function updateGalleryLoadMore() {
  if (!$galleryLoadMoreWrap || !$galleryLoadMore) return;
  const hasCards = !!$galleryGrid.querySelector('.gallery__card');
  $galleryLoadMoreWrap.hidden = !hasCards
    || (!photoHasMore && !photoPageLoading);
  $galleryLoadMore.disabled = photoPageLoading;
}

function resetGalleryFeed() {
  $galleryGrid.innerHTML = '';
  photos.length = 0;
  photoRecords.length = 0;
  photoIndexIds.length = 0;
  photoCursor = null;
  photoHasMore = false;
  photoPageLoading = false;
  setPhotoCount(0);
  $galleryEmpty.style.display = '';
  setLoadMoreBusy(false);
  updateGalleryLoadMore();
  updateChallengeCard();
  renderSplashChain();
}

async function loadPhotoPage() {
  if (photoPageLoading) return;
  photoPageLoading = true;
  setLoadMoreBusy(true);
  updateGalleryLoadMore();
  try {
    const params = new URLSearchParams({ limit: String(appSettings.galleryPageSize) });
    if (photoCursor) params.set('before', photoCursor);
    const res = await fetch('/api/photos?' + params.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    // Ältere Server ohne Pagination liefern weiterhin ein Array.
    const legacy = Array.isArray(data);
    const items = legacy ? data : (Array.isArray(data.items) ? data.items : []);
    // Die alte Vollliste war aufsteigend; für die Galerie neueste zuerst.
    const pageItems = legacy ? items.slice().reverse() : items;
    pageItems.forEach((item) => addToGallery(item.image, false, item.id, {
      prepend: false,
      count: false
    }));

    if (legacy) {
      photoHasMore = false;
      photoCursor = null;
      setPhotoCount(items.length);
      setPhotoIndexIds(items.map((item) => item.id));
    } else {
      const total = Number(data.total);
      setPhotoCount(Number.isFinite(total) ? total : photoCount + items.length);
      setPhotoIndexIds(Array.isArray(data.allIds) ? data.allIds : items.map((item) => item.id));
      photoHasMore = data.hasMore === true;
      photoCursor = data.nextCursor || null;
    }

    if ($galleryGrid.querySelector('.gallery__card')) {
      $galleryEmpty.style.display = 'none';
    }
    updateChallengeCard();
    renderSplashChain();
  } catch (err) {
    console.warn('Photos could not be loaded from database:', err);
    showToast(t('toastLoadError'), { error: true });
  } finally {
    photoPageLoading = false;
    setLoadMoreBusy(false);
    updateGalleryLoadMore();
  }
}

// Startet die Galerie mit der neuesten Seite statt mit allen Bildern.
function loadPhotosFromServer() {
  if (photoPageLoading) return Promise.resolve();
  resetGalleryFeed();
  return loadPhotoPage();
}

if ($galleryLoadMore) {
  $galleryLoadMore.addEventListener('click', () => loadPhotoPage());
}

function addToGallery(photoUrl, save = true, photoId = null, options = {}) {
  // Neue Aufnahmen kommen oben dazu; ältere Server-Seiten werden angehängt.
  const prepend = options.prepend === true || (options.prepend !== false && save);
  const countNew = options.count !== false;
  const sessionForSave = photoSessionToken;
  let savePromise = null;
  if (save) {
    savePromise = savePhotoToServer(photoUrl).then((id) => {
      if (!id) return;
      card.dataset.id = id;
      // Ein spät fertiger Upload darf nicht in eine neuere Sitzung rutschen.
      if (sessionForSave && photoSessionToken === sessionForSave) {
        sessionPhotoIds.add(id);
      }
      if (card.isConnected) {
        attachDelete(card, id);
        // Keine Bestätigung hier: Der Gast entscheidet erst im Review
        // zwischen „Neu aufnehmen“ und „Speichern“.
      } else {
        // Vor dem Speichern verworfen: Gäste löschen endgültig.
        deletePhoto(card, id);
      }
      if (lastPhoto && lastPhoto.card === card) lastPhoto.id = id;
      record.id = id;
      addPhotoIndexId(id);
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

  if (prepend) $galleryGrid.prepend(card);
  else $galleryGrid.appendChild(card);
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
  if (prepend) {
    photos.unshift(photoUrl);
  } else {
    photos.push(photoUrl);
  }
  const record = { id: photoId || null, url: photoUrl };
  if (prepend) photoRecords.unshift(record);
  else photoRecords.push(record);
  card._photoRecord = record;
  if (save) lastPhoto = { card, id: null, savePromise, capturedAt: Date.now() };

  if (countNew) {
    if (photoId) addPhotoIndexId(photoId);
    setPhotoCount(photoCount + 1);
    updateChallengeCard();
  }

  // Dezente Rückmeldung an allen Galerie-Zugängen (Start und Endscreen).
  document.querySelectorAll('[data-gallery-entry]').forEach((entry) => {
    gsap.from(entry, {
      scale: [1, 1.08, 1], duration: 0.5, ease: 'elastic.out(1, 0.6)'
    });
  });
  return card;
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
let galleryDeleteRaf = 0;
window.addEventListener('resize', () => {
  if (galleryDeleteRaf) return;
  galleryDeleteRaf = requestAnimationFrame(() => {
    galleryDeleteRaf = 0;
    $galleryGrid.querySelectorAll('.gallery__card').forEach(positionGalleryDelete);
  });
});

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
  // In der Galerie gibt es keinen „Fertig“-Rückweg: dort zeigt der Button
  // wieder das Home-Symbol statt der grünen „Zurück zum Start“-Pille.
  if (sectionName === 'gallery') setHomeMode('default');
  syncCancelHome();

  if (sectionName === 'gallery') {
    // Beim Öffnen ist die Galerie erst jetzt sichtbar geworden; vorher hatten
    // die Kacheln keine Breite und der Mülleimer konnte nicht ausgerichtet
    // werden.
    requestAnimationFrame(() => {
      $galleryGrid.querySelectorAll('.gallery__card').forEach(positionGalleryDelete);
    });
  }

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

// Öffnet die Galerie von genau dem Screen, auf dem der Gast sie angetippt
// hat. Der Kamera-Screen hat keinen eigenen Galerie-Button mehr; die Galerie
// ist vom Startbildschirm und vom Endscreen erreichbar.
function openGallery(source = null) {
  if (currentState === 'gallery' || isCapturing) return;
  const from = source || (currentState === 'splash'
    ? 'splash'
    : ($endScreen && !$endScreen.hidden ? 'end' : 'camera'));
  galleryReturnState = from;

  if (from === 'camera') {
    const img = $camera.querySelector('.viewfinder img.stage-photo');
    if (img) img.remove();
    clearStickers();
  }

  const origin = from === 'splash' ? $splash : $camera;
  gsap.to(origin, {
    opacity: 0,
    duration: 0.3,
    ease: 'power2.in',
    onComplete: () => {
      origin.style.display = 'none';
      goTo('gallery');
    }
  });
}

// Zurück führt die Galerie zu dem Screen, von dem sie geöffnet wurde.
// Der Endscreen bleibt dabei erhalten.
function closeGallery() {
  if (currentState !== 'gallery') return;

  const backTo = galleryReturnState;
  gsap.to($gallery, {
    opacity: 0,
    duration: 0.3,
    ease: 'power2.in',
    onComplete: () => {
      $gallery.style.display = 'none';

      if (backTo === 'splash') {
        $splash.style.display = 'flex';
        currentState = 'splash';
        syncCancelHome();
        if ($splashLang) $splashLang.hidden = false;
        gsap.fromTo($splash, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
        // Die zum Viewport passende Variante kann sich während des
        // Übergangs ändern. Deshalb den tatsächlich sichtbaren Zugang
        // fokussieren, nicht nur die beim Öffnen gültige Ausrichtung.
        const entries = [...document.querySelectorAll('.splash__gallery')];
        const entry = entries.find((el) => el.offsetWidth || el.offsetHeight) || entries[0];
        if (entry) entry.focus({ preventScroll: true });
        return;
      }

      if (backTo === 'end') {
        $camera.style.display = 'block';
        gsap.set($camera, { opacity: 1 });
        currentState = 'camera';
        setHomeMode('done');
        syncCancelHome();
        const entry = document.querySelector('.endscreen__action[data-end="gallery"]');
        if (entry) entry.focus({ preventScroll: true });
        return;
      }

      goTo('camera');
    }
  });
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
    if (options.warningSound) playDeleteWarning();
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
//  SOUND
// ============================================================
// A single shared AudioContext is created lazily from a user gesture.
// Creating a new context per shot is unreliable and Chrome may leave it
// suspended, which is why the original shutter stayed silent.
let audioCtx = null;
let noiseBuffer = null;
let isDiscardingPhoto = false;
const uiSoundBuffers = new Map();
const UI_SOUND_SRCS = {
  'cancel.mp3': 'assets/audio/cancel.mp3',
  'switch.mp3': 'assets/audio/switch.mp3',
  'start.mp3': 'assets/audio/start.mp3',
  'Button_push.mp3': 'assets/audio/Button_push.mp3',
  'paper_crush.mp3': 'assets/audio/paper_crush.mp3',
  'afk_timer.mp3': 'assets/audio/afk_timer.MP3',
  'enlargement.mp3': 'assets/audio/enlargement.mp3',
  'success.mp3': 'assets/audio/success.mp3'
};
let enlargementSoundStop = null;
let enlargementSoundGeneration = 0;
let enlargementSoundLoad = null;

function stopEnlargementSound() {
  enlargementSoundGeneration++;
  if (enlargementSoundStop) enlargementSoundStop();
}
const afkTimerSources = new Set();
let afkTimerSoundGeneration = 0;
const successSoundSources = new Set();
let successSoundGeneration = 0;

function stopSuccessSounds() {
  successSoundGeneration++;
  successSoundSources.forEach(source => {
    try { source.stop(); } catch (e) {}
    source.disconnect();
  });
  successSoundSources.clear();
}

function stopAfkTimerSounds() {
  afkTimerSoundGeneration++;
  afkTimerSources.forEach((source) => {
    try { source.stop(); } catch (e) {}
    try { source.disconnect(); } catch (e) {}
  });
  afkTimerSources.clear();
}

function playUiSound(name, preload = false) {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const enlargement = name === 'enlargement.mp3';
  if (enlargement && !preload) stopEnlargementSound();
  const enlargementGeneration = enlargementSoundGeneration;
  const success = name === 'success.mp3';
  if (success && !preload) stopSuccessSounds();
  const successGeneration = successSoundGeneration;
  const afkGeneration = name === 'afk_timer.mp3' ? afkTimerSoundGeneration : null;
  const play = (buffer) => {
    if (!buffer || !soundEnabled || ctx.state !== 'running') return;
    if (name === 'afk_timer.mp3' && (!idleWarnVisible || afkGeneration !== afkTimerSoundGeneration)) return;
    if (enlargement && enlargementGeneration !== enlargementSoundGeneration) return;
    if (enlargement && accessibilitySettings.buttonSize !== 'large' && accessibilitySettings.textSize !== 'large') return;
    if (success && successGeneration !== successSoundGeneration) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (enlargement) {
        const gain = ctx.createGain();
        gain.gain.value = 0.3;
        source.connect(gain);
        gain.connect(ctx.destination);
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          try { source.stop(); } catch (e) {}
          source.disconnect();
          gain.disconnect();
          if (enlargementSoundStop === stop) enlargementSoundStop = null;
        };
        enlargementSoundStop = stop;
        source.onended = stop;
      } else if (name === 'start.mp3') {
        const gain = ctx.createGain();
        gain.gain.value = 0.35;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
      } else source.connect(ctx.destination);
      if (name === 'afk_timer.mp3') {
        afkTimerSources.add(source);
        source.onended = () => afkTimerSources.delete(source);
      } else if (success) {
        successSoundSources.add(source);
        source.onended = () => { successSoundSources.delete(source); source.disconnect(); };
      }
      source.start();
    } catch (err) {
      if (enlargement) stopEnlargementSound();
      // Optional UI sounds must never interrupt the camera flow.
    }
  };
  if (uiSoundBuffers.has(name)) {
    if (!preload) play(uiSoundBuffers.get(name));
    return;
  }
  const src = UI_SOUND_SRCS[name];
  if (!src) return;
  const load = enlargement && enlargementSoundLoad ? enlargementSoundLoad : fetch(src, name === 'afk_timer.mp3' ? { cache: 'no-store' } : undefined)
    .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.arrayBuffer(); })
    .then((bytes) => ctx.decodeAudioData(bytes));
  if (enlargement) enlargementSoundLoad = load;
  load
    .then((buffer) => { uiSoundBuffers.set(name, buffer); if (!preload) play(buffer); })
    .catch((err) => {
      if (enlargement && enlargementSoundLoad === load) enlargementSoundLoad = null;
      console.warn('UI sound could not be loaded:', name, err);
    });
}

// Real shutter recording (camera-shutter.mp3). It is fetched right away and
// decoded into the shared AudioContext on the first user gesture, so the
// recording is ready long before the capture button is pressed.
const SHUTTER_SRC = 'assets/audio/camera-shutter.mp3';
let shutterBytes = null;      // raw file data, fetched at load
let shutterBuffer = null;     // decoded AudioBuffer, ready for playback
let shutterLoadPromise = null;
let shutterDecodePromise = null;

// No printer recording is bundled. Synthesize a quiet motor and paper
// friction in the existing, gesture-unlocked AudioContext. No looping asset.
let printerSoundStop = null;

function stopPrinterSound() {
  if (printerSoundStop) printerSoundStop();
}

function playPrinterSound(duration) {
  stopPrinterSound();
  if (!soundEnabled) return;
  const nodes = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    nodes.forEach(node => {
      try { if (typeof node.stop === 'function') node.stop(); } catch (e) {}
      try { node.disconnect(); } catch (e) {}
    });
    if (printerSoundStop === stop) printerSoundStop = null;
  };
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    printerSoundStop = stop;
    const now = ctx.currentTime;
    const gain = ctx.createGain(); nodes.push(gain);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.025, now + 0.08);
    gain.gain.setValueAtTime(0.025, now + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    gain.connect(ctx.destination);
    const motor = ctx.createOscillator(); nodes.push(motor);
    motor.type = 'triangle';
    motor.frequency.setValueAtTime(155, now);
    motor.frequency.linearRampToValueAtTime(185, now + 0.18);
    motor.frequency.linearRampToValueAtTime(165, now + duration - 0.2);
    motor.frequency.linearRampToValueAtTime(125, now + duration);
    motor.connect(gain);
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const roller = Math.sin((i / ctx.sampleRate) * Math.PI * 18);
      data[i] = (Math.random() * 2 - 1) * (0.2 + roller * roller * 0.3);
    }
    const paper = ctx.createBufferSource(); nodes.push(paper);
    paper.buffer = buffer;
    const band = ctx.createBiquadFilter(); nodes.push(band);
    band.type = 'bandpass'; band.frequency.value = 950; band.Q.value = 0.6;
    paper.connect(band).connect(gain);
    paper.onended = stop;
    motor.start(now); paper.start(now);
    motor.stop(now + duration); paper.stop(now + duration);
  } catch (err) {
    stop(); // Blocked or missing audio must not interrupt the capture.
  }
}

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
const storedSoundSetting = localStorage.getItem('soundEnabled');
let soundEnabled = storedSoundSetting === null ? appSettings.defaultSound : storedSoundSetting !== '0';

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
  if (!soundEnabled) {
    stopEnlargementSound();
    stopSuccessSounds();
    stopPrinterSound();
    stopAfkTimerSounds();
  }
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

// Kurze, tiefe Warnung für endgültiges Löschen oder Verwerfen. Sie erklingt
// nur beim Öffnen des jeweiligen Bestätigungsdialogs und bleibt bei
// stummgeschaltetem Ton aus.
function playDeleteWarning() {
  if (!soundEnabled || isCapturing) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const start = ctx.currentTime + 0.005;
    const notes = [
      { at: 0, freq: 392 },
      { at: 0.145, freq: 311 }
    ];
    notes.forEach(({ at, freq }) => {
      const t = start + at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  } catch (e) {
    /* audio not available */
  }
}


// ============================================================
//  EVENT LISTENERS
// ============================================================
document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', (event) => {
    const action = el.dataset.action;
    switch (action) {
      case 'start':
        startSession();
        break;
      case 'capture':
        if (event.detail > 1) break;
        if (isCapturing) {
          if (!captureCommitted && countdownState) playUiSound('cancel.mp3');
          cancelCapture();
        }
        else runCaptureSequence();
        break;
      case 'open-gallery':
        openGallery(el.dataset.gallerySource || null);
        break;
      case 'back-camera':
        closeGallery();
        break;
      case 'retry-camera':
        initCamera({ retry: true });
        break;
    }
  });
});



// ============================================================
//  KIOSK-FLOW (UX-SKIZZEN): Seitenmenü, Overlays, Sticker, Endscreen
// ============================================================
const $sideMenu = document.getElementById('sideMenu');
const $sideMenuPanel = document.getElementById('sideMenuPanel');
const $sideMenuSubhead = document.getElementById('sideMenuSubhead');
const $sideMenuTabs = document.getElementById('sideMenuTabs');
const $sideMenuList = document.getElementById('sideMenuList');
const $sideViewport = document.querySelector('.side-menu__viewport');
const $sideScrollUp = document.getElementById('sideScrollUp');
const $sideScrollDown = document.getElementById('sideScrollDown');
const $sideMenuToggle = document.getElementById('sideMenuToggle');
const $captureOptions = document.getElementById('captureOptions');
const $captureOptionsToggle = document.getElementById('captureOptionsToggle');
const $sideRail = document.getElementById('sideRail');
const $endScreen = document.getElementById('endScreen');
const $cancelHome = document.getElementById('cancelHome');
const $challengeEnd = document.getElementById('challengeEnd');
const $challengeEndTheme = document.getElementById('challengeEndTheme');
const $challengeEndQuestion = document.getElementById('challengeEndQuestion');
const $challengeEndStatus = document.getElementById('challengeEndStatus');
const $challengeEndChoices = document.getElementById('challengeEndChoices');
const $challengeEndQrWrap = document.getElementById('challengeEndQrWrap');
const $challengeEndQr = document.getElementById('challengeEndQr');
let challengeEndPhotoId = null;
let challengeEndChoice = null;
let challengeEndBusy = false;

// Der Home-Button wird nach Aufnahmeaktionen programmatisch fokussiert.
// Nur bei Tastaturbedienung soll daraus ein sichtbarer Fokusring werden;
// nach Touch oder Maus bleibt der Kreis ruhig.
document.addEventListener('keydown', () => {
  document.body.classList.add('is-keyboard-nav');
}, true);
document.addEventListener('pointerdown', () => {
  document.body.classList.remove('is-keyboard-nav');
}, true);

// ============================================================
//  FILTER-MENÜ IN DER UNTEREN LEISTE
//  Kein Overlay mehr: Das Menü klappt in der Leiste selbst auf und
//  zeigt die Filter als runde, horizontal scrollbare Knöpfe. Der
//  Auslöser rutscht dabei weich zur Seite.
// ============================================================
// var statt let: applyLanguage() kann laufen, bevor die Filtervariablen
// weiter oben im Skript initialisiert sind.
var barMenuReady = false;
var filterRemoveHintShown = false;
var filterRemoveHintTimer = 0;

function hideFilterRemoveHint() {
  clearTimeout(filterRemoveHintTimer);
  filterRemoveHintTimer = 0;
  const hint = document.getElementById('barFilterRemoveHint');
  if (hint) {
    hint.classList.remove('is-visible');
    hint.setAttribute('aria-hidden', 'true');
  }
}

function showFilterRemoveHint() {
  if (filterRemoveHintShown || !barMenuIsOpen() || !barMenuShowsFilters()) return;
  const hint = document.getElementById('barFilterRemoveHint');
  if (!hint) return;
  filterRemoveHintShown = true;
  hint.classList.add('is-visible');
  hint.setAttribute('aria-hidden', 'false');
  filterRemoveHintTimer = window.setTimeout(hideFilterRemoveHint, 1500);
}

function barMenuPanelEl() { return document.getElementById('barMenuPanel'); }
function barMenuListEl() { return document.getElementById('barMenuList'); }

const BAR_COLOR_FILTERS = {
  sw: 'filterSw',
  vintage: 'filterVintage',
  knackig: 'filterKnackig'
};

// In der Kamera gehören die Filter in die Leiste; im Review öffnet derselbe
// Button weiterhin die Schublade für Overlay und Sticker.
function barMenuShowsFilters() {
  return !$camera.classList.contains('is-reviewing')
    && !$camera.classList.contains('is-stamping');
}

// Dieselbe Pille zeigt im Review die Rahmen als Kacheln. Im Sticker-Modus
// nicht: dort übernimmt die Sticker-Pille die Auswahl.
function barMenuShowsOverlays() {
  return !$camera.classList.contains('is-stamping')
    && $camera.classList.contains('is-reviewing')
    && appSettings.overlaysEnabled !== false;
}

// Sticker-Pille: gleiche Leiste, gleiches Glas, klappt nach links auf.
function barMenuShowsStamps() {
  return !$camera.classList.contains('is-stamping')
    && $camera.classList.contains('is-reviewing')
    && appSettings.stickersEnabled !== false;
}

function stampPanelEl() { return document.getElementById('stampPanel'); }
function stampListEl() { return document.getElementById('stampList'); }

function stampMenuIsOpen() {
  const panel = stampPanelEl();
  return !!panel && panel.classList.contains('is-open');
}

function renderStampPanel() {
  const list = stampListEl();
  if (!list) return;
  list.innerHTML = '';
  list.parentElement.querySelector('[data-action="clear-stickers"]')?.remove();
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'bar-tile bar-tile--reset dot-chip';
  clear.style.order = '1';
  clear.dataset.action = 'clear-stickers';
  clear.setAttribute('aria-label', t('stickerClearAll'));
  clear.title = t('stickerClearAll');
  clear.appendChild(menuResetDisc('stickers'));
  clear.addEventListener('click', clearStickers);
  list.after(clear);
  STICKER_CATEGORIES.filter(category => category.items.length).forEach((category, index) => {
    if (index) {
      const divider = document.createElement('span');
      divider.className = 'bar-filter-divider';
      divider.style.order = String(1 - index * 2);
      divider.setAttribute('aria-hidden', 'true');
      list.appendChild(divider);
    }
    const group = document.createElement('div');
    group.className = 'sticker-category';
    group.dataset.category = category.id;
    group.style.order = String(-index * 2);
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', category.label);
    list.appendChild(group);
    category.items.filter(sticker => sticker.kind).forEach((sticker) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bar-tile bar-tile--stamp';
      btn.setAttribute('aria-label', t(sticker.ariaKey));
      const source = $stickerPalette.querySelector('[data-sticker="' + sticker.kind + '"] svg');
      if (source) btn.appendChild(source.cloneNode(true));
      else if (sticker.icon) btn.insertAdjacentHTML('beforeend', sticker.icon);
      btn.addEventListener('click', () => {
        if (btn.dataset.dragged === '1') { delete btn.dataset.dragged; return; }
        addSticker(sticker.kind);
      });
      enableMenuDrag(btn, { kind: 'sticker', sticker: sticker.kind });
      group.appendChild(btn);
    });
    category.items.filter(sticker => sticker.glyph).forEach((stamp) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bar-tile bar-tile--stamp bar-tile--stamp-emoji';
      btn.setAttribute('aria-label', t('stickerEmojiAria', { emoji: stamp.glyph }));
      const glyph = document.createElement('span');
      glyph.className = 'bar-tile__glyph';
      glyph.textContent = stamp.glyph;
      btn.appendChild(glyph);
      btn.addEventListener('click', () => {
        if (btn.dataset.dragged === '1') { delete btn.dataset.dragged; return; }
        addEmojiStamp(stamp.glyph);
      });
      enableMenuDrag(btn, { kind: 'sticker', glyph: stamp.glyph });
      group.appendChild(btn);
    });
  });
}

function setStampMenuOpen(open) {
  const panel = stampPanelEl();
  if (!panel) return;
  const next = !!open && barMenuShowsStamps();
  if (next) {
    setBarMenuOpen(false);
    setCaptureOptionsOpen(false);
    renderStampPanel();
  }
  panel.classList.toggle('is-open', next);
  panel.inert = !next;
  panel.setAttribute('aria-hidden', String(!next));
  const btn = document.getElementById('barStickerToggle');
  if (btn) btn.setAttribute('aria-expanded', String(next));
  // Wisch-Hinweis wie im Filterband: erst nach dem Aufklappen messen, sonst
  // ist die sichtbare Breite der Sticker-Pille noch nicht die endgültige.
  if (stampScrollHintTimer) {
    window.clearTimeout(stampScrollHintTimer);
    stampScrollHintTimer = 0;
  }
  const swipeHint = document.getElementById('stampSwipeHint');
  if (!next) hideListScrollHint(swipeHint);
  if (next) {
    const list = stampListEl();
    if (list) list.scrollLeft = list.scrollWidth - list.clientWidth;
    stampScrollHintTimer = window.setTimeout(() => {
      stampScrollHintTimer = 0;
      if (playListScrollHint(stampListEl(), swipeHint, 'stamp', -1)) {
        hintListScroll(stampListEl());
      }
    }, 460);
  }
}

// ---- Elemente aus den Menüs aufs Foto ziehen -------------------------
// Ein kurzer Tipp fügt wie gewohnt in der Mitte ein. Ein senkrechtes Ziehen
// nimmt das Element am Finger mit: die Leiste blendet aus, über dem Foto
// bleibt es liegen, über dem Mülleimer wird es verworfen.
var menuDrag = null;
var menuDragCleanup = null;
var trashWiggle = null;

function elementTrashEl() { return document.getElementById('elementTrash'); }

function startElementTrash() {
  stopElementTrash();
  const trash = elementTrashEl();
  if (!trash) return;
  if (menuDrag && menuDrag.payload.kind === 'overlay') {
    // Preserve the existing frame drag behavior; the fixed menu slot is for stickers.
    const home = $cancelHome.getBoundingClientRect();
    Object.assign(trash.style, { left: 'auto', top: 'auto', right: home.left + 'px',
      bottom: (window.innerHeight - home.bottom) + 'px', width: home.width + 'px', height: home.height + 'px' });
  } else {
    if (!stampMenuIsOpen()) setStampMenuOpen(true);
    window.clearTimeout(stampScrollHintTimer);
    stampScrollHintTimer = 0;
    hideListScrollHint(document.getElementById('stampSwipeHint'));
    const panel = stampPanelEl();
    const clear = panel.querySelector('[data-action="clear-stickers"]');
    if (!clear) return;
    // The reset slot stays outside the scrolling viewport; only its drawing changes.
    const slot = clear.getBoundingClientRect();
    Object.assign(trash.style, { left: slot.left + 'px', top: slot.top + 'px',
      right: 'auto', bottom: 'auto', width: slot.width + 'px', height: slot.height + 'px' });
    panel.classList.add('has-drag-trash');
    clear.disabled = true;
  }
  trash.classList.add('is-visible');
  $camera.classList.add('is-dragging-element');
  if (!reducedCaptureMotion()) {
    trashWiggle = gsap.timeline({ delay: 3, repeat: -1, repeatDelay: 5 })
      .to(trash, { '--trash-wiggle': '-3deg', duration: 0.08 })
      .to(trash, { '--trash-wiggle': '3deg', duration: 0.12 })
      .to(trash, { '--trash-wiggle': '-2deg', duration: 0.1 })
      .to(trash, { '--trash-wiggle': '0deg', duration: 0.1 });
  }
}

function elementTrashContains(x, y) {
  const trash = elementTrashEl();
  if (!trash || !trash.classList.contains('is-visible')) return false;
  if (menuDrag && menuDrag.payload.kind === 'overlay') {
    const rect = trash.getBoundingClientRect();
    return pointerInside({ left: rect.left - 12, right: rect.right + 12,
      top: rect.top - 12, bottom: rect.bottom + 12 }, x, y);
  }
  const photo = photoStageRect();
  if (pointerInside(photo, x, y)) return false;
  const rect = trash.getBoundingClientRect();
  const menu = stampPanelEl().querySelector('.bar-slot__inner').getBoundingClientRect();
  const padding = 6;
  return pointerInside({ left: Math.max(0, menu.left, rect.left - padding),
    right: Math.min(window.innerWidth, menu.right, rect.right + padding),
    top: Math.max(0, menu.top, photo.bottom, rect.top - padding),
    bottom: Math.min(window.innerHeight, menu.bottom, rect.bottom + padding) }, x, y);
}

function updateElementTrash(x, y) {
  const trash = elementTrashEl();
  if (!trash || !trash.classList.contains('is-visible')) return;
  trash.classList.toggle('is-target', elementTrashContains(x, y));
  if (reducedCaptureMotion()) return;
  const rect = trash.getBoundingClientRect();
  const angle = Math.atan2(x - rect.left - rect.width / 2,
    Math.max(240, Math.abs(y - rect.top - rect.height / 2))) * 180 / Math.PI * 0.22;
  gsap.to(trash, {
    '--trash-tilt': Math.max(-20, Math.min(20, angle)) + 'deg',
    duration: 0.28, ease: 'power2.out', overwrite: 'auto'
  });
}

function stopElementTrash() {
  if (trashWiggle) trashWiggle.kill();
  trashWiggle = null;
  const trash = elementTrashEl();
  if (trash) {
    gsap.killTweensOf(trash);
    trash.classList.remove('is-visible', 'is-target');
    trash.style.removeProperty('--trash-tilt');
    trash.style.removeProperty('--trash-wiggle');
  }
  $camera.classList.remove('is-dragging-element');
  const panel = stampPanelEl();
  if (panel) {
    panel.classList.remove('has-drag-trash');
    const clear = panel.querySelector('[data-action="clear-stickers"]');
    if (clear) clear.disabled = false;
  }
}

function pointerInside(rect, x, y) {
  return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function paintMenuGhost(x, y) {
  if (!menuDrag) return;
  menuDrag.x = x;
  menuDrag.y = y;
  menuDrag.ghost.style.left = x + 'px';
  menuDrag.ghost.style.top = y + 'px';
  updateElementTrash(x, y);
}

function beginMenuDrag(btn, payload, ev) {
  const ghost = document.createElement('div');
  ghost.className = 'menu-drag-ghost';
  if (payload.kind === 'overlay') {
    const img = document.createElement('img');
    img.src = payload.src;
    img.alt = '';
    ghost.appendChild(img);
    setBarMenuOpen(false);
  } else {
    if (payload.glyph) {
      const span = document.createElement('span');
      span.className = 'bar-tile__glyph';
      span.textContent = payload.glyph;
      ghost.appendChild(span);
    } else if (textStickerSpec(payload.sticker)) {
      const img = document.createElement('img');
      img.src = stickerSvgUrl(payload.sticker);
      img.alt = '';
      ghost.appendChild(img);
    } else {
      const source = $stickerPalette.querySelector('[data-sticker="' + payload.sticker + '"] svg');
      if (source) ghost.appendChild(source.cloneNode(true));
    }
  }
  document.body.appendChild(ghost);
  menuDrag = { btn, payload, ghost, x: ev.clientX, y: ev.clientY };
  startElementTrash();
  paintMenuGhost(ev.clientX, ev.clientY);
}

function cancelMenuDrag() {
  if (menuDragCleanup) menuDragCleanup();
  if (!menuDrag) return;
  menuDrag.btn.dataset.dragged = '1';
  menuDrag.ghost.remove();
  menuDrag = null;
  stopElementTrash();
}

function endMenuDrag(x, y) {
  if (!menuDrag) return;
  const { btn, payload } = menuDrag;
  const overTrash = elementTrashContains(x, y);
  const viewfinder = $camera.querySelector('.viewfinder');
  const overPhoto = pointerInside(viewfinder && viewfinder.getBoundingClientRect(), x, y);
  cancelMenuDrag();
  btn.dataset.dragged = '1';

  if (overTrash) {
    // Mülleimer: nichts ablegen — ein bereits sichtbarer Rahmen verschwindet.
    if (payload.kind === 'overlay' && currentOverlay && currentOverlay.id === payload.id) {
      setOverlay(NO_OVERLAY_ID);
    }
    return;
  }
  if (!overPhoto) return;
  if (payload.kind === 'overlay') {
    setOverlay(payload.id);
    return;
  }
  // Sticker genau dort platzieren, wo der Finger loslässt.
  if (payload.glyph) addEmojiStamp(payload.glyph);
  else addSticker(payload.sticker);
  const st = activeStickers[activeStickers.length - 1];
  if (!st) return;
  const rect = photoStageRect();
  st.x = Math.min(94, Math.max(6, ((x - rect.left) / rect.width) * 100));
  st.y = Math.min(94, Math.max(6, ((y - rect.top) / rect.height) * 100));
  positionSticker(st);
  selectSticker(st);
}

function enableMenuDrag(btn, payload) {
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.isPrimary === false) return;
    if (menuDragCleanup) cancelMenuDrag();
    delete btn.dataset.dragged;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragging) {
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        // Erst ab einer klaren senkrechten Geste ziehen — sonst bleibt es
        // beim waagerechten Scrollen des Bandes.
        if (dy < 12 || dy <= dx) return;
        dragging = true;
        beginMenuDrag(btn, payload, ev);
      }
      ev.preventDefault();
      paintMenuGhost(ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', cancelMenuDrag);
      window.removeEventListener('resize', cancelMenuDrag);
      window.removeEventListener('keydown', keydown, true);
      menuDragCleanup = null;
    };
    const keydown = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancelMenuDrag();
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      cleanup();
      if (!dragging) return;
      if (ev.type === 'pointercancel') cancelMenuDrag();
      else endMenuDrag(ev.clientX, ev.clientY);
    };
    menuDragCleanup = cleanup;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', cancelMenuDrag);
    window.addEventListener('resize', cancelMenuDrag);
    window.addEventListener('keydown', keydown, true);
  });
}

function barMenuIsOpen() {
  const panel = barMenuPanelEl();
  return !!panel && panel.classList.contains('is-open');
}

function barFilterIcon(kind, value) {
  if (kind === 'color' && (value === 'vintage' || value === 'knackig')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('focusable', 'false');
    const colors = value === 'vintage' ? ['#f4e3c2', '#c9a06a', '#6b4a2f'] : ['#4ee1a0', '#2f7dff', '#ff3d81'];
    const id = 'bar-filter-' + value;
    svg.innerHTML = '<defs><clipPath id="' + id + '-circle"><circle cx="50" cy="50" r="50"/></clipPath><linearGradient id="' + id + '-fill" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="' + colors[0] + '"/><stop offset="55%" stop-color="' + colors[1] + '"/><stop offset="100%" stop-color="' + colors[2] + '"/></linearGradient></defs><rect width="100" height="100" fill="url(#' + id + '-fill)" clip-path="url(#' + id + '-circle)"/>';
    return svg;
  }
  if (kind === 'color' && value === 'sw') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = '<defs><clipPath id="bar-filter-sw-circle"><circle cx="50" cy="50" r="50"/></clipPath></defs><g clip-path="url(#bar-filter-sw-circle)"><rect width="100" height="100" fill="#fff"/><path d="M0 100 100 0v100Z" fill="#000"/></g>';
    return svg;
  }
  if (kind === 'face') {
    const emoji = document.createElement('span');
    emoji.className = 'dot-chip__emoji';
    const filter = ((window.SnapBoxFilters && window.SnapBoxFilters.FILTERS) || []).find(filter => filter.id === value);
    emoji.textContent = filter ? filter.emoji : '';
    return emoji;
  }
  if (kind !== 'reset') return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<circle cx="12" cy="12" r="8"/><path d="m6.343 6.343 11.314 11.314"/>';
  return svg;
}

function menuResetDisc(kind) {
  const svg = barFilterIcon('reset');
  svg.innerHTML = kind === 'frame'
    ? '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="m3.5 3.5 17 17"/>'
    : '<path d="M4 7h16M10 4h4M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M10 11v6M14 11v6"/>';
  const disc = document.createElement('span');
  disc.className = 'dot-chip__disc';
  disc.setAttribute('aria-hidden', 'true');
  disc.appendChild(svg);
  return disc;
}

function barMenuChip(kind, value, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dot-chip';
  btn.dataset.kind = kind;
  btn.dataset.value = value;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.setAttribute('aria-pressed', 'false');
  const discEl = document.createElement('span');
  discEl.className = 'dot-chip__disc';
  discEl.setAttribute('aria-hidden', 'true');
  if (kind === 'color') discEl.classList.add('dot-chip__disc--' + value);
  const icon = barFilterIcon(kind, value);
  if (icon) discEl.appendChild(icon);
  btn.appendChild(discEl);
  btn.addEventListener('click', () => {
    if (!appSettings.filtersEnabled) return;
    if (kind === 'reset') {
      currentFilter = 'standard';
      if (filterEngine) filterEngine.setFilter('none');
      applyFilterSelection();
      syncFaceFilterSelection();
    } else if (kind === 'face') {
      if (!filterEngine) return;
      const active = filterEngine.getFilter();
      filterEngine.setFilter(active === value ? 'none' : value);
      syncFaceFilterSelection();
    } else {
      currentFilter = currentFilter === value ? 'standard' : value;
      applyFilterSelection();
    }
    updateBarMenuSelection();
    updateSideSelection();
    if ((kind === 'color' && currentFilter === value)
      || (kind === 'face' && filterEngine && filterEngine.getFilter() === value)) showFilterRemoveHint();
  });
  return btn;
}

// Rahmen als reine Bildquadrate: kein Text, nur das Vorschaubild.
function renderBarOverlays(list) {
  list.replaceChildren();
  const appendOverlay = (parent, overlay) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bar-tile bar-tile--frame';
    btn.dataset.kind = 'overlay';
    btn.dataset.value = overlay.id;
    btn.setAttribute('aria-label', overlayLabel(overlay));
    btn.title = overlayLabel(overlay);
    btn.setAttribute('aria-pressed', 'false');
    if (overlay.id === NO_OVERLAY_ID) {
      btn.classList.add('bar-tile--reset', 'dot-chip');
      btn.appendChild(menuResetDisc('frame'));
    } else {
      const img = document.createElement('img');
      img.src = overlay.src;
      img.alt = '';
      img.draggable = false;
      btn.appendChild(img);
    }
    btn.addEventListener('click', () => {
      if (btn.dataset.dragged === '1') { delete btn.dataset.dragged; return; }
      setOverlay(currentOverlay && currentOverlay.id === overlay.id ? NO_OVERLAY_ID : overlay.id);
    });
    if (overlay.id !== NO_OVERLAY_ID) {
      enableMenuDrag(btn, { kind: 'overlay', id: overlay.id, src: overlay.src });
    }
    parent.appendChild(btn);
  };
  appendOverlay(list, NO_OVERLAY_OPTION);
  OVERLAY_CATEGORIES.forEach((category, index) => {
    const overlays = OVERLAYS[category.id];
    if (!overlays || !overlays.length) return;
    if (index) {
      const divider = document.createElement('span');
      divider.className = 'bar-filter-divider';
      divider.setAttribute('aria-hidden', 'true');
      list.appendChild(divider);
    }
    const group = document.createElement('div');
    group.className = 'frame-category';
    group.dataset.category = category.id;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', category.label);
    overlays.forEach(overlay => appendOverlay(group, overlay));
    list.appendChild(group);
  });
  list.scrollLeft = 0;
}

function renderBarMenu() {
  const list = barMenuListEl();
  if (!list) return;
  const overlaysMode = barMenuShowsOverlays();
  const panel = barMenuPanelEl();
  if (panel) panel.dataset.mode = overlaysMode ? 'overlays' : 'filters';
  list.innerHTML = '';
  if (overlaysMode) {
    renderBarOverlays(list);
    updateBarMenuSelection();
    return;
  }
  const divider = () => {
    const el = document.createElement('span');
    el.className = 'bar-filter-divider';
    el.setAttribute('aria-hidden', 'true');
    list.appendChild(el);
  };
  list.appendChild(barMenuChip('reset', 'none', t('filterNone')));
  divider();
  Object.keys(BAR_COLOR_FILTERS).forEach((id) => {
    list.appendChild(barMenuChip('color', id, t(BAR_COLOR_FILTERS[id])));
  });
  divider();
  const filters = (window.SnapBoxFilters && window.SnapBoxFilters.FILTERS) || [];
  filters.filter(filter => filter.id !== 'none').forEach((filter) => {
    list.appendChild(barMenuChip('face', filter.id, faceLabel(filter)));
  });
  updateBarMenuSelection();
}

function updateBarMenuSelection() {
  if (!barMenuReady) return;
  const list = barMenuListEl();
  if (!list) return;
  const face = filterEngine ? filterEngine.getFilter() : 'none';
  list.querySelectorAll('[data-kind]').forEach((btn) => {
    const kind = btn.dataset.kind;
    let active;
    if (kind === 'reset') active = currentFilter === 'standard' && face === 'none';
    else if (kind === 'face') active = face === btn.dataset.value;
    else if (kind === 'overlay') {
      active = btn.dataset.value === NO_OVERLAY_ID
        ? !currentOverlay
        : (!!currentOverlay && currentOverlay.id === btn.dataset.value);
    } else active = currentFilter === btn.dataset.value;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const summary = document.getElementById('barActiveFilterNames');
  if (summary) {
    if (barMenuShowsOverlays()) {
      summary.textContent = overlayLabel(currentOverlay || NO_OVERLAY_OPTION);
      return;
    }
    const names = [];
    if (currentFilter !== 'standard' && BAR_COLOR_FILTERS[currentFilter]) names.push(t(BAR_COLOR_FILTERS[currentFilter]));
    const faceFilter = ((window.SnapBoxFilters && window.SnapBoxFilters.FILTERS) || []).find(filter => filter.id === face);
    if (face !== 'none' && faceFilter) names.push(faceLabel(faceFilter));
    const text = names.length ? names.join(' + ') : t('filtersNoneActive');
    if (summary.textContent !== text) summary.textContent = text;
  }
}

// Derselbe Button in der Leiste heißt in der Kamera „Filter“ und im Review
// „Menü“ (Overlay/Sticker). Beschriftung und ARIA hängen am offenen Panel.
function syncBarToggleLabel() {
  const toggle = document.getElementById('sideMenuToggle');
  if (!toggle) return;
  const overlaysMode = barMenuShowsOverlays();
  const filtersMode = !overlaysMode && barMenuShowsFilters();
  setFeatureHidden(toggle, !overlaysMode && (!filtersMode || appSettings.filtersEnabled === false));
  const open = (filtersMode || overlaysMode)
    ? barMenuIsOpen()
    : !!$sideMenu && $sideMenu.classList.contains('is-open');
  let labelKey = 'sideMenuToggleOpen';
  let ariaKey = 'sideMenuShowAria';
  let controls = 'sideMenu';
  if (filtersMode) {
    labelKey = 'barFilters';
    ariaKey = open ? 'barFiltersHideAria' : 'barFiltersShowAria';
    controls = 'barMenuPanel';
  } else if (overlaysMode) {
    labelKey = 'barFrames';
    ariaKey = open ? 'barFramesHideAria' : 'barFramesShowAria';
    controls = 'barMenuPanel';
  } else {
    labelKey = open ? 'sideMenuToggleClose' : 'sideMenuToggleOpen';
    ariaKey = open ? 'sideMenuHideAria' : 'sideMenuShowAria';
  }
  const label = toggle.querySelector('.side-menu-toggle__label');
  if (label) {
    label.dataset.i18n = labelKey;
    label.textContent = t(labelKey);
  }
  // Nur im Rahmen-Modus ersetzt das gelieferte Rahmen-Symbol die Regler.
  toggle.classList.toggle('is-frames-mode', overlaysMode);
  toggle.dataset.i18nAria = ariaKey;
  toggle.setAttribute('aria-label', t(ariaKey));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', controls);
  // Der Sticker-Knopf gehört zur Sticker-Pille und erscheint nur im Review.
  const stickerBtn = document.getElementById('barStickerToggle');
  if (stickerBtn) {
    setFeatureHidden(stickerBtn, !barMenuShowsStamps());
    stickerBtn.setAttribute('aria-expanded', String(stampMenuIsOpen()));
  }
}

// Beim Aufklappen deutet ein kurzer elastischer Ruck an, dass sich das
// Filterband waagerecht scrollen lässt: Das Band scrollt ein Stück weiter
// und federt zurück. Bewusst über scrollLeft und nicht über transform —
// ein verschobenes Band wandert aus der Pille heraus (links) und der am
// Rand neu sichtbare Bereich wird nicht fertig gezeichnet (rechts).
var filterScrollHintTimer = 0;
var stampScrollHintTimer = 0;
// Der Wisch-Hinweis ist eine einmalige Orientierungshilfe: Filter, Rahmen
// und Sticker zeigen ihn pro Gast-Erlebnis nur beim ersten Öffnen.
var listScrollHintsShown = { filter: false, overlay: false, stamp: false };
var filterScrollPulse = 0;
var filterScrollPulseCleanup = null;

// Laufenden Ruck stoppen und dabei die Scroll-Einstellungen zurücksetzen.
function endFilterScrollPulse() {
  if (filterScrollPulse) {
    cancelAnimationFrame(filterScrollPulse);
    filterScrollPulse = 0;
  }
  if (filterScrollPulseCleanup) {
    filterScrollPulseCleanup();
    filterScrollPulseCleanup = null;
  }
}

function hintListScroll(list, maxDistance = 260, minDistance = 70) {
  if (!list) return false;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const max = list.scrollWidth - list.clientWidth;
  if (max <= 2) return false;
  const start = Math.max(0, Math.min(list.scrollLeft, max));
  // Platz in Scrollrichtung nehmen; steht das Band schon am Ende, läuft der
  // Ruck nach links statt ins Leere.
  let room = max - start;
  let direction = 1;
  if (room < 60) {
    direction = -1;
    room = start;
  }
  const distance = Math.round(Math.min(room, Math.max(minDistance, Math.min(maxDistance, list.clientWidth * 0.3))));
  if (distance <= 4) return false;
  endFilterScrollPulse();
  // Snapping und weiches Scrollen würden die Einzelbilder verschlucken: jede
  // gesetzte Position würde sofort auf einen Rastpunkt gezogen bzw. neu
  // weich animiert. Darum während des Rucks aus und danach zurück.
  const prevSnap = list.style.scrollSnapType;
  const prevBehavior = list.style.scrollBehavior;
  filterScrollPulseCleanup = () => {
    list.style.scrollSnapType = prevSnap;
    list.style.scrollBehavior = prevBehavior;
  };
  list.style.scrollSnapType = 'none';
  list.style.scrollBehavior = 'auto';
  const duration = 2000;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    // Erst raus (ease-out), dann zurückfedern (ease-in-out).
    const f = p < 0.45 ? easeOut(p / 0.45) : 1 - easeInOut((p - 0.45) / 0.55);
    list.scrollLeft = start + direction * distance * f;
    filterScrollPulse = p < 1 ? requestAnimationFrame(step) : 0;
    if (p >= 1) endFilterScrollPulse();
  };
  filterScrollPulse = requestAnimationFrame(step);
  return true;
}

// Wisch-Hinweis über dem Filterband: der Fingerpunkt fährt einmal quer
// durch die Pille, damit man sieht, dass die Filter scrollbar sind.
var filterHintHideTimer = 0;
function hideListScrollHint(hint) {
  // Nur den laufenden Hinweis stoppen: Ein bereits geschlossenes Band darf
  // den Hinweis des anderen Menüs nicht vorzeitig abräumen.
  if (hint && !hint.classList.contains('is-playing')) return;
  window.clearTimeout(filterHintHideTimer);
  filterHintHideTimer = 0;
  endFilterScrollPulse();
  if (hint) hint.classList.remove('is-playing');
}

// Beim nächsten Gast-Erlebnis dürfen die Hinweise wieder einmal erscheinen.
function resetListScrollHints() {
  listScrollHintsShown.filter = false;
  listScrollHintsShown.overlay = false;
  listScrollHintsShown.stamp = false;
  if (filterScrollHintTimer) {
    window.clearTimeout(filterScrollHintTimer);
    filterScrollHintTimer = 0;
  }
  if (stampScrollHintTimer) {
    window.clearTimeout(stampScrollHintTimer);
    stampScrollHintTimer = 0;
  }
  hideListScrollHint(document.getElementById('barSwipeHint'));
  hideListScrollHint(document.getElementById('stampSwipeHint'));
  endFilterScrollPulse();
}

function playListScrollHint(list, hint, onceKey, direction = 1) {
  if (!list || !hint) return false;
  if (onceKey && listScrollHintsShown[onceKey]) return false;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (list.scrollWidth <= list.clientWidth + 2) return false;
  // Weg an der Bandbreite ausrichten: je breiter die Pille, desto weiter
  // fährt der Finger, aber gedeckelt, damit er in der Pille bleibt.
  const travel = Math.round(Math.max(120, Math.min(300, list.clientWidth * 0.42)));
  hint.style.setProperty('--hint-travel', travel * direction + 'px');
  hint.classList.remove('is-playing');
  // Reflow erzwingen, damit die Animation beim ersten Anzeigen startet.
  void hint.offsetWidth;
  hint.classList.add('is-playing');
  if (onceKey) listScrollHintsShown[onceKey] = true;
  window.clearTimeout(filterHintHideTimer);
  filterHintHideTimer = window.setTimeout(() => hideListScrollHint(hint), 2250);
  return true;
}

// Menü und Optionen sind Geschwister: Es ist immer nur eines offen.
function updateFrameScrollEdges() {
  const list = barMenuListEl();
  if (!list) return;
  const frames = barMenuShowsOverlays();
  const max = Math.max(0, list.scrollWidth - list.clientWidth);
  list.classList.toggle('has-scroll-before', frames && list.scrollLeft > 1);
  list.classList.toggle('has-scroll-after', frames && list.scrollLeft < max - 1);
}

function setBarMenuOpen(open) {
  const panel = barMenuPanelEl();
  if (!panel) return;
  const next = !!open && (
    (barMenuShowsFilters() && appSettings.filtersEnabled !== false)
    || barMenuShowsOverlays()
  );
  if (next) {
    setSideMenuOpen(false);
    setCaptureOptionsOpen(false);
    setStampMenuOpen(false);
    // Inhalt passend zur Phase aufbauen (Filter oder Rahmen).
    renderBarMenu();
  }
  panel.classList.toggle('is-open', next);
  panel.inert = !next;
  panel.setAttribute('aria-hidden', String(!next));
  const bar = document.getElementById('captureBar');
  if (bar) bar.classList.toggle('is-menu-open', next);
  syncBarToggleLabel();
  updateFrameScrollEdges();
  if (filterScrollHintTimer) {
    window.clearTimeout(filterScrollHintTimer);
    filterScrollHintTimer = 0;
  }
  const filterHint = document.getElementById('barSwipeHint');
  if (!next) {
    hideListScrollHint(filterHint);
    hideFilterRemoveHint();
  }
  if (next) {
    updateBarMenuSelection();
    // Filter und Rahmen teilen sich das Band, zählen für den einmaligen
    // Hinweis aber getrennt.
    const hintKey = barMenuShowsOverlays() ? 'overlay' : 'filter';
    // Erst nach dem Aufklappen messen: während die Pille wächst, ist die
    // sichtbare Breite des Bandes noch nicht die endgültige.
    if (!listScrollHintsShown[hintKey]) {
      filterScrollHintTimer = window.setTimeout(() => {
        filterScrollHintTimer = 0;
        if (playListScrollHint(barMenuListEl(), filterHint, hintKey)) {
          hintListScroll(barMenuListEl());
        }
      }, 460);
    }
  }
}

renderBarMenu();
barMenuReady = true;
updateBarMenuSelection();
// Mausrad scrollt das Filterband waagerecht (Kiosk mit Maus).
if (barMenuListEl()) {
  const list = barMenuListEl();
  list.addEventListener('scroll', updateFrameScrollEdges, { passive: true });
  const stopHint = () => {
    window.clearTimeout(filterScrollHintTimer);
    filterScrollHintTimer = 0;
    hideListScrollHint(document.getElementById('barSwipeHint'));
  };
  list.addEventListener('pointerdown', stopHint, { passive: true });
  list.addEventListener('keydown', stopHint);
  list.addEventListener('click', stopHint, true);
  list.addEventListener('wheel', (e) => {
    stopHint();
    const list = barMenuListEl();
    if (!list) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if (list.scrollWidth <= list.clientWidth + 1) return;
    list.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
}

if (stampListEl()) {
  const list = stampListEl();
  const stopHint = () => {
    window.clearTimeout(stampScrollHintTimer);
    stampScrollHintTimer = 0;
    hideListScrollHint(document.getElementById('stampSwipeHint'));
  };
  list.addEventListener('pointerdown', stopHint, { passive: true });
  list.addEventListener('keydown', stopHint);
  list.addEventListener('click', stopHint, true);
  list.addEventListener('wheel', (e) => {
    stopHint();
    if (list.scrollWidth <= list.clientWidth + 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const unit = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? list.clientWidth : 1;
    list.scrollLeft -= e.deltaY * unit;
    e.preventDefault();
  }, { passive: false });
}

// Ein einziges Randmenü mit drei Bereichen, die je nach Schritt verfügbar
// sind: Kamera = Filter, Review = Overlay und Sticker. Die Unterteilung in
// Gesicht/Komplett bzw. Standard/Event/Hochschule passiert als sichtbare
// Abschnittsüberschrift innerhalb der Liste, nicht als zweite Reiterreihe.
const SIDE_SECTIONS = [
  { id: 'filter', labelKey: 'sideFilter' },
  { id: 'overlay', labelKey: 'sideOverlay' },
  { id: 'stamp', labelKey: 'sideStamp' }
];
const SHAPE_STICKERS = [
  { kind: 'ohren', labelKey: 'stickerOhren', ariaKey: 'stickerOhrenAria' },
  { kind: 'krone', labelKey: 'stickerKrone', ariaKey: 'stickerKroneAria' },
  { kind: 'brille', labelKey: 'stickerBrille', ariaKey: 'stickerBrilleAria' },
  { kind: 'hut', labelKey: 'stickerHut', ariaKey: 'stickerHutAria' }
];
const TEXT_STICKERS = [
  {
    kind: 'date',
    labelKey: 'stickerDate',
    ariaKey: 'stickerDateAria',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M8 3v4M16 3v4M3 10h18"></path><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"></path></svg>',
    w: 30,
    x: 28,
    y: 82,
    svgWidth: 430,
    svgHeight: 104,
    fontSize: 52
  },
  {
    kind: 'time',
    labelKey: 'stickerTime',
    ariaKey: 'stickerTimeAria',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path></svg>',
    w: 18,
    x: 72,
    y: 82,
    svgWidth: 250,
    svgHeight: 104,
    fontSize: 58
  }
];

function sideTabElementId(context) {
  return 'sideTab-' + context;
}

// Seitenmenü als Schublade: Ausfahren legt Filter/Overlay/Sticker über die
// Vorschau, Einklappen gibt dem Foto wieder die volle Breite.
function setSideMenuOpen(open, options = {}) {
  if (!$sideMenu || !$sideMenuToggle) return;
  const wasOpen = $sideMenu.classList.contains('is-open');
  const focusWasInside = $sideMenu.contains(document.activeElement);
  const next = !!open
    && !$sideMenu.classList.contains('feature-disabled')
    && !$sideMenu.classList.contains('is-locked');
  if (next) { setCaptureOptionsOpen(false); setBarMenuOpen(false); }
  $sideMenu.classList.toggle('is-open', next);
  $sideMenu.inert = !next;
  syncBarToggleLabel();
  if (!next && wasOpen && focusWasInside) {
    $sideMenuToggle.focus({ preventScroll: true });
  } else if (next && options.focus) {
    focusActiveSideTab();
  }
}

function focusActiveSideTab() {
  const tab = document.getElementById(sideTabElementId(sideContext));
  // Ein einzelner Bereich braucht keine Reiterreihe; dann ist der erste
  // Menüpunkt der sinnvolle Fokus nach dem Öffnen.
  const target = tab || ($sideMenuList && $sideMenuList.querySelector('.side-menu__item'));
  if (target) target.focus({ preventScroll: true });
}

if ($sideMenuToggle) {
  $sideMenuToggle.addEventListener('click', () => {
    // Kamera: Filter in der Leiste. Review: Schublade für Overlay/Sticker.
    if (barMenuShowsFilters() || barMenuShowsOverlays()) {
      setBarMenuOpen(!barMenuIsOpen());
      return;
    }
    const opening = !$sideMenu.classList.contains('is-open');
    setSideMenuOpen(opening, { focus: opening });
  });
}

// Review: Sticker-Schublade als eigener Knopf, damit die Pille die Rahmen
// zeigen kann.
const $barStickerToggle = document.getElementById('barStickerToggle');
if ($barStickerToggle) {
  $barStickerToggle.addEventListener('click', () => {
    setStampMenuOpen(!stampMenuIsOpen());
  });
}

// Countdown und Modus teilen sich einen Button in der unteren Leiste. Das
// Panel darüber klappt per Tipp wieder zu; es liegt nie über dem Auslöser.
function setCaptureOptionsOpen(open) {
  if (!$captureOptions || !$captureOptionsToggle) return;
  const next = !!open && !$captureOptionsToggle.disabled;
  $captureOptions.classList.toggle('is-open', next);
  $captureOptions.inert = !next;
  $captureOptions.setAttribute('aria-hidden', String(!next));
  const bar = document.getElementById('captureBar');
  if (bar) bar.classList.toggle('is-options-open', next);
  if (next) setBarMenuOpen(false);
  $captureOptionsToggle.setAttribute('aria-expanded', String(next));
}

if ($captureOptionsToggle) {
  $captureOptionsToggle.addEventListener('click', () => {
    const opening = $captureOptionsToggle.getAttribute('aria-expanded') !== 'true';
    if (opening) setSideMenuOpen(false);
    setCaptureOptionsOpen(opening);
  });
}

// Tippen neben das Panel schließt es — wie beim Seitenmenü.
document.addEventListener('click', (e) => {
  if (!$captureOptions || !$captureOptions.classList.contains('is-open')) return;
  if (e.target.closest('#captureOptions, #captureOptionsToggle')) return;
  setCaptureOptionsOpen(false);
});

let sideContext = 'filter';
let currentOverlay = null;
let overlayPreviewRevision = 0;
// Bildpixel-Layout der zuletzt erzeugten Fotocollage, damit das Overlay in
// der Vorschau und im gespeicherten Foto je Kachel sitzt.
let lastStripLayout = null;
let endPhotoUrl = null;

// Frame and photo pixels must match exactly.
const NO_OVERLAY_ID = 'none';
const NO_OVERLAY_OPTION = {
  id: NO_OVERLAY_ID, labelKey: 'overlayNone',
  src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 36"><path d="M8 30 56 6" stroke="white" stroke-width="3"/></svg>')
};
// Static inventory from the actual PNG files; dimensions are native image pixels.
const OVERLAY_CATEGORIES = [
  { id: 'standard', label: 'Standard' },
  { id: 'minimalistic', label: 'Minimalistic' },
  { id: 'uni', label: 'Hochschule' },
  { id: 'events', label: 'Event' }
];
const OVERLAYS = {
  standard: [
    { id: 'standard/Standard_01', label: 'Standard 01', src: 'assets/overlays/standard/Standard_01.png', width: 1920, height: 1080 },
    { id: 'standard/Standard_02', label: 'Standard 02', src: 'assets/overlays/standard/Standard_02.png', width: 1920, height: 1080 }
  ],
  minimalistic: [
    { id: 'minimalistic/01', label: 'Minimalistic 01', src: 'assets/overlays/minimalistic/01.png', width: 1920, height: 1080 },
    { id: 'minimalistic/02', label: 'Minimalistic 02', src: 'assets/overlays/minimalistic/02.png', width: 1920, height: 1080 },
    { id: 'minimalistic/03', label: 'Minimalistic 03', src: 'assets/overlays/minimalistic/03.png', width: 1920, height: 1080 },
    { id: 'minimalistic/04', label: 'Minimalistic 04', src: 'assets/overlays/minimalistic/04.png', width: 1920, height: 1080 },
    { id: 'minimalistic/05', label: 'Minimalistic 05', src: 'assets/overlays/minimalistic/05.png', width: 1920, height: 1080 },
    { id: 'minimalistic/06', label: 'Minimalistic 06', src: 'assets/overlays/minimalistic/06.png', width: 1920, height: 1080 },
    { id: 'minimalistic/07', label: 'Minimalistic 07', src: 'assets/overlays/minimalistic/07.png', width: 1920, height: 1080 },
    { id: 'minimalistic/08', label: 'Minimalistic 08', src: 'assets/overlays/minimalistic/08.png', width: 1920, height: 1080 }
  ],
  uni: [
    { id: 'uni/Hochschule_01', label: 'Hochschule 01', src: 'assets/overlays/uni/Hochschule_01.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_02', label: 'Hochschule 02', src: 'assets/overlays/uni/Hochschule_02.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_03', label: 'Hochschule 03', src: 'assets/overlays/uni/Hochschule_03.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_04', label: 'Hochschule 04', src: 'assets/overlays/uni/Hochschule_04.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_05', label: 'Hochschule 05', src: 'assets/overlays/uni/Hochschule_05.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_06', label: 'Hochschule 06', src: 'assets/overlays/uni/Hochschule_06.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_07', label: 'Hochschule 07', src: 'assets/overlays/uni/Hochschule_07.png', width: 1920, height: 1080 },
    { id: 'uni/Hochschule_08', label: 'Hochschule 08', src: 'assets/overlays/uni/Hochschule_08.png', width: 1920, height: 1080 }
  ],
  events: [
    { id: 'events/halloween_01', label: 'Halloween 01', src: 'assets/overlays/events/halloween_01.png', width: 1920, height: 1080 },
    { id: 'events/halloween_02', label: 'Halloween 02', src: 'assets/overlays/events/halloween_02.png', width: 1920, height: 1080 },
    { id: 'events/halloween_03', label: 'Halloween 03', src: 'assets/overlays/events/halloween_03.png', width: 1920, height: 1080 },
    { id: 'events/halloween_EXCLUSIVE', label: 'Halloween EXCLUSIVE', src: 'assets/overlays/events/halloween_EXCLUSIVE.png', width: 1920, height: 1080 },
    { id: 'events/herbst_05', label: 'Herbst 05', src: 'assets/overlays/events/herbst_05.png', width: 1920, height: 1080 },
    { id: 'events/herbst_06', label: 'Herbst 06', src: 'assets/overlays/events/herbst_06.png', width: 1920, height: 1080 },
    { id: 'events/weihnachten_07', label: 'Weihnachten 07', src: 'assets/overlays/events/weihnachten_07.png', width: 1920, height: 1080 },
    { id: 'events/weihnachten_08', label: 'Weihnachten 08', src: 'assets/overlays/events/weihnachten_08.png', width: 1920, height: 1080 }
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

// Navigation starts at the right: Reactions, then accessories; stamps stay empty.
const STICKER_CATEGORIES = [
  { id: 'reactions', label: 'Reactions', items: STAMPS.emoji.slice(0, 3) },
  { id: 'accessories', label: 'Accessoires', items: SHAPE_STICKERS },
  { id: 'stamps', label: 'Stempel', items: TEXT_STICKERS }
];

function photoTimestamp(id) {
  const match = /^photos\/(\d+)-/.exec(String(id || ''));
  return match ? Number(match[1]) : null;
}

function photoIsCurrentMonth(id) {
  const ts = photoTimestamp(id);
  if (!ts) return false;
  const now = new Date();
  const date = new Date(ts);
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function setPhotoIndexIds(ids) {
  photoIndexIds.length = 0;
  (ids || []).forEach((id) => {
    if (id && !photoIndexIds.includes(id)) photoIndexIds.push(id);
  });
}

function addPhotoIndexId(id) {
  if (id && !photoIndexIds.includes(id)) photoIndexIds.unshift(id);
}

function removePhotoIndexId(id) {
  const index = photoIndexIds.indexOf(id);
  if (index !== -1) photoIndexIds.splice(index, 1);
}

const MONTH_THEME_KEYS = [
  'themeJan', 'themeFeb', 'themeMar', 'themeApr', 'themeMay', 'themeJun',
  'themeJul', 'themeAug', 'themeSep', 'themeOct', 'themeNov', 'themeDec'
];

function themeKeyForNow(month = new Date().getMonth()) {
  return MONTH_THEME_KEYS[month] || 'themeDefault';
}

async function refreshChallengeSummary() {
  try {
    const res = await fetch('/api/challenge/summary', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    challengeStatus = {
      enabled: data.enabled === true,
      configured: data.configured === true,
      online: data.online === true,
      entries: Math.max(0, Number(data.entries) || 0),
      votes: Math.max(0, Number(data.votes) || 0),
      location: data.location === 'coburg' ? 'coburg' : 'lcc',
      appUrl: normalizeChallengeUrl(data.appUrl),
      month: typeof data.month === 'string' ? data.month : ''
    };
  } catch (err) {
    // Die Karte bleibt sichtbar, zeigt aber keinen erfundenen Zähler an.
    challengeStatus.online = false;
  }
  updateChallengeCard();
}

function updateChallengeCard() {
  const countEl = document.getElementById('challengeCount');
  if (!countEl) return;
  // Die App-Karte hängt an Challenge und App-Adresse. Fehlt der Schlüssel,
  // bleibt sie sichtbar und zeigt Striche statt Zahlen.
  const active = appSettings.challengeEnabled && !!appSettings.challengeAppUrl;
  document.body.classList.toggle('challenge-active', active);
  if (!active) return;

  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const location = challengeStatus.location || appSettings.challengeLocation;
  const locationLabel = challengeLocationLabel(location);
  countEl.textContent = challengeStatus.online ? String(challengeStatus.entries) : '—';
  const unit = document.getElementById('challengeEntries');
  if (unit) unit.textContent = t('challengeEntries', { location: locationLabel });
  const versus = document.getElementById('challengeVersus');
  if (versus) {
    versus.textContent = t('challengeVersus', {
      home: locationLabel,
      away: challengeLocationLabel(location === 'coburg' ? 'lcc' : 'coburg')
    });
  }
  const days = document.getElementById('challengeDays');
  if (days) {
    days.textContent = daysLeft === 0
      ? t('challengeLastDay')
      : (daysLeft === 1 ? t('challengeDaysOne') : t('challengeDays', { n: daysLeft }));
  }
  const theme = document.getElementById('challengeTheme');
  if (theme) theme.textContent = t('challengeThemePrompt', { theme: t(themeKeyForNow()) });
}

function renderSplashChain() {
  const chain = document.getElementById('splashChain');
  if (!chain) return;
  // Neueste zuerst: die erste Seite enthält die aktuellsten Fotos.
  const urls = photoRecords.slice(0, 12).map((record) => record.url).filter(Boolean);
  chain.innerHTML = '';
  if (!urls.length) return;
  const grid = document.createElement('div');
  grid.className = 'splash__chain-grid';
  // Drei Collage-Reihen, die langsam seitlich durchlaufen. Jede Reihe hat
  // eine eigene Geschwindigkeit/Richtung; zwei Kopien der Karten machen den
  // Übergang nahtlos. Das zentrale Startfeld bleibt dabei frei.
  const perRow = 4;
  for (let row = 0; row < 3; row += 1) {
    const rowEl = document.createElement('div');
    rowEl.className = 'splash__chain-row' + (row === 1 ? ' splash__chain-row--reverse' : '');
    rowEl.style.setProperty('--row-speed', (92 + row * 14) + 's');
    const track = document.createElement('div');
    track.className = 'splash__chain-track';
    for (let copy = 0; copy < 2; copy += 1) {
      for (let i = 0; i < perRow; i += 1) {
        const card = document.createElement('div');
        card.className = 'splash__chain-card';
        const img = document.createElement('img');
        img.src = urls[(row * perRow + i) % urls.length];
        img.alt = '';
        img.draggable = false;
        card.appendChild(img);
        track.appendChild(card);
      }
    }
    rowEl.appendChild(track);
    grid.appendChild(rowEl);
  }
  chain.appendChild(grid);
}

function syncSideMenuHint() {
  if (!$sideMenuSubhead) return;
  const show = sideContext === 'stamp' && hasPhoto;
  $sideMenuSubhead.textContent = show ? t('stickerDragHint') : '';
  $sideMenuSubhead.hidden = !show;
}

function openSideMenu(context) {
  if (!$sideMenu) return;
  context = chooseSideMenuContext(context);
  if (!context || !SIDE_SECTIONS.some((section) => section.id === context)) {
    setSideMenuVisible(false);
    return;
  }
  const previous = sideContext;
  setSideMenuVisible(true);
  sideContext = context;
  $sideMenu.dataset.context = context;
  syncSideMenuHint();
  renderSideTabs();
  renderSideMenu();
  if (previous !== context && $sideViewport) $sideViewport.scrollTop = 0;
}

function selectSideContext(context, options = {}) {
  if (!sideMenuContextAvailable(context)) return;
  // Der Sticker-Reiter öffnet die Sticker-Auswahl. Die untere Leiste bleibt
  // dabei unverändert bei „Neu aufnehmen“ und „Annehmen“.
  if (context === 'stamp' && hasPhoto && !$camera.classList.contains('is-stamping')) {
    openStampMode();
  } else if (context !== 'stamp' && $camera.classList.contains('is-stamping')) {
    closeStampMode({ keepMenuOpen: true });
    openSideMenu(context);
  } else {
    openSideMenu(context);
  }
  if (options.focusTab !== false) focusActiveSideTab();
}

function handleSideTabKeydown(event) {
  const tabs = [...$sideMenuTabs.querySelectorAll('.side-tab')];
  const index = tabs.indexOf(event.currentTarget);
  if (index === -1) return;
  let nextIndex = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  const next = tabs[nextIndex];
  if (next) selectSideContext(next.dataset.tab);
}

function renderSideTabs() {
  if (!$sideMenuTabs) return;
  const available = SIDE_SECTIONS.filter((section) => sideMenuContextAvailable(section.id));
  if (!available.some((section) => section.id === sideContext)) {
    sideContext = available[0] ? available[0].id : 'filter';
  }
  // Bei nur einem verfügbaren Bereich wäre eine Reiterreihe mit einem
  // einzigen Reiter nur zusätzliche Bedienlast. Sie erscheint erst, wenn
  // wirklich zwischen Bereichen gewählt werden kann (Review: Overlay/Sticker).
  const showTabs = available.length > 1;
  $sideMenuTabs.hidden = !showTabs;
  $sideMenuTabs.innerHTML = '';
  if (!showTabs) {
    if ($sideMenuPanel) {
      $sideMenuPanel.removeAttribute('aria-labelledby');
      if (available[0]) $sideMenuPanel.setAttribute('aria-label', t(available[0].labelKey));
      else $sideMenuPanel.removeAttribute('aria-label');
    }
    return;
  }
  if ($sideMenuPanel) $sideMenuPanel.removeAttribute('aria-label');
  available.forEach((section) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-tab';
    btn.id = sideTabElementId(section.id);
    btn.dataset.tab = section.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'sideMenuPanel');
    const active = section.id === sideContext;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    btn.textContent = t(section.labelKey);
    btn.addEventListener('click', () => selectSideContext(section.id));
    btn.addEventListener('keydown', handleSideTabKeydown);
    $sideMenuTabs.appendChild(btn);
  });
  if ($sideMenuPanel) {
    const active = available.find((section) => section.id === sideContext);
    if (active) $sideMenuPanel.setAttribute('aria-labelledby', sideTabElementId(active.id));
    else $sideMenuPanel.removeAttribute('aria-labelledby');
  }
}

function appendSideGroup(groupKey, labelKey, build) {
  if (!$sideMenuList) return;
  const group = document.createElement('div');
  group.className = 'side-menu__group';
  group.setAttribute('role', 'group');
  const heading = document.createElement('p');
  heading.className = 'side-menu__section';
  heading.id = 'sideGroup-' + groupKey;
  heading.textContent = t(labelKey);
  group.setAttribute('aria-labelledby', heading.id);
  group.appendChild(heading);
  const before = group.children.length;
  build(group);
  if (group.children.length > before) $sideMenuList.appendChild(group);
}

function appendSideEmpty(messageKey) {
  if (!$sideMenuList) return;
  const empty = document.createElement('div');
  empty.className = 'side-menu__empty';
  empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>';
  const text = document.createElement('p');
  text.textContent = t(messageKey);
  empty.appendChild(text);
  $sideMenuList.appendChild(empty);
}

function renderSideMenu() {
  if (!$sideMenuList) return;
  $sideMenuList.innerHTML = '';

  if (sideContext === 'filter') {
    const filters = (filterEngine && window.SnapBoxFilters) ? window.SnapBoxFilters.FILTERS : [];
    if (filters.length) {
      appendSideGroup('face', 'tabFace', (group) => {
        filters.forEach((filter) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'side-menu__item';
          btn.dataset.kind = 'face';
          btn.dataset.value = filter.id;
          const active = !!filterEngine && filterEngine.getFilter() === filter.id;
          btn.classList.toggle('is-selected', active);
          btn.setAttribute('aria-pressed', String(active));
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
          group.appendChild(btn);
        });
      });
    }
    appendSideGroup('color', 'tabAll', (group) => {
      const labels = { standard: 'filterStandard', sw: 'filterSw', vintage: 'filterVintage', knackig: 'filterKnackig' };
      Object.keys(FILTERS).forEach((id) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'side-menu__item side-menu__item--overlay';
        btn.dataset.kind = 'color';
        btn.dataset.value = id;
        const active = currentFilter === id;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-pressed', String(active));
        btn.textContent = t(labels[id] || id);
        btn.addEventListener('click', () => {
          currentFilter = id;
          applyFilterSelection();
          updateSideSelection();
        });
        group.appendChild(btn);
      });
    });
  } else if (sideContext === 'stamp') {
    if (!hasPhoto) {
      appendSideEmpty('stickersNeedPhoto');
    } else {
      appendSideGroup('sticker-text', 'stickerTextGroup', (group) => {
        TEXT_STICKERS.forEach((sticker) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'side-menu__item side-menu__item--textstamp';
          btn.setAttribute('aria-label', t(sticker.ariaKey));
          const glyph = document.createElement('span');
          glyph.className = 'side-menu__glyph';
          glyph.innerHTML = sticker.icon;
          btn.appendChild(glyph);
          const label = document.createElement('span');
          label.className = 'side-menu__label';
          label.textContent = t(sticker.labelKey);
          btn.appendChild(label);
          btn.addEventListener('click', () => addSticker(sticker.kind));
          group.appendChild(btn);
        });
      });
      appendSideGroup('sticker-shapes', 'stickerShapes', (group) => {
        SHAPE_STICKERS.forEach((sticker) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'side-menu__item side-menu__item--shape';
          btn.setAttribute('aria-label', t(sticker.ariaKey));
          const glyph = document.createElement('span');
          glyph.className = 'side-menu__glyph';
          const source = $stickerPalette.querySelector('[data-sticker="' + sticker.kind + '"] svg');
          if (source) glyph.appendChild(source.cloneNode(true));
          btn.appendChild(glyph);
          const label = document.createElement('span');
          label.className = 'side-menu__label';
          label.textContent = t(sticker.labelKey);
          btn.appendChild(label);
          btn.addEventListener('click', () => addSticker(sticker.kind));
          group.appendChild(btn);
        });
      });
      [['emoji', 'tabEmoji'], ['uni', 'tabUni']].forEach(([key, labelKey]) => {
        appendSideGroup('stamp-' + key, labelKey, (group) => {
          (STAMPS[key] || []).forEach((stamp) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'side-menu__item';
            btn.setAttribute('aria-label', t('stickerEmojiAria', { emoji: stamp.glyph }));
            const glyph = document.createElement('span');
            glyph.className = 'side-menu__glyph';
            glyph.textContent = stamp.glyph;
            btn.appendChild(glyph);
            btn.addEventListener('click', () => addEmojiStamp(stamp.glyph));
            group.appendChild(btn);
          });
        });
      });
    }
  }

  requestAnimationFrame(updateScrollHints);
}

function updateSideSelection() {
  updateBarMenuSelection();
  if (!$sideMenuList) return;
  $sideMenuList.querySelectorAll('.side-menu__item[data-kind]').forEach((el) => {
    const kind = el.dataset.kind;
    const value = el.dataset.value;
    let active = false;
    if (kind === 'face') {
      active = !!filterEngine && filterEngine.getFilter() === value;
    } else if (kind === 'color') {
      active = currentFilter === value;
    } else if (kind === 'overlay') {
      active = value === NO_OVERLAY_ID ? !currentOverlay : (!!currentOverlay && currentOverlay.id === value);
    }
    el.classList.toggle('is-selected', active);
    el.setAttribute('aria-pressed', String(active));
  });
}

function updateScrollHints() {
  if (!$sideViewport || !$sideScrollUp || !$sideScrollDown) return;
  const canUp = $sideViewport.scrollTop > 2;
  const canDown = $sideViewport.scrollTop + $sideViewport.clientHeight < $sideViewport.scrollHeight - 2;
  $sideScrollUp.classList.toggle('is-enabled', canUp);
  $sideScrollDown.classList.toggle('is-enabled', canDown);
  $sideScrollUp.disabled = !canUp;
  $sideScrollDown.disabled = !canDown;
}

if ($sideScrollUp) {
  $sideScrollUp.addEventListener('click', () => {
    if ($sideViewport) $sideViewport.scrollBy({ top: -$sideViewport.clientHeight * 0.8, behavior: 'smooth' });
  });
}
if ($sideScrollDown) {
  $sideScrollDown.addEventListener('click', () => {
    if ($sideViewport) $sideViewport.scrollBy({ top: $sideViewport.clientHeight * 0.8, behavior: 'smooth' });
  });
}
if ($sideViewport) $sideViewport.addEventListener('scroll', updateScrollHints, { passive: true });
window.addEventListener('resize', () => {
  updateScrollHints();
  updateFrameScrollEdges();
  renderOverlayPreview();
  repositionStickers();
});

function overlayLabel(overlay) {
  return overlay.labelKey ? t(overlay.labelKey) : overlay.label
    || overlay.src.split('/').pop().replace(/\.[^.]+$/, '')
      .replace(/^(?:frame|overlay)[-_ ]+/i, '').replace(/[_-]+/g, ' ').trim();
}

function findOverlay(id) {
  return Object.keys(OVERLAYS)
    .reduce((all, key) => all.concat(OVERLAYS[key]), [])
    .find((overlay) => overlay.id === id) || null;
}

function overlayFitsPhoto(overlay, photo) {
  if (!overlay || !photo) return false;
  const tile = photo.classList.contains('stage-photo--strip') && lastStripLayout;
  return (tile ? lastStripLayout.w : photo.naturalWidth) === overlay.width
    && (tile ? lastStripLayout.h : photo.naturalHeight) === overlay.height;
}

function loadNativeOverlay(overlay) {
  if (!overlay.imagePromise) {
    overlay.imagePromise = loadImg(overlay.src).then((img) => {
      if (img.naturalWidth !== overlay.width || img.naturalHeight !== overlay.height) {
        throw new Error('Unexpected native frame dimensions');
      }
      return img;
    }).catch((err) => { delete overlay.imagePromise; throw err; });
  }
  return overlay.imagePromise;
}

function setOverlay(id) {
  if (!appSettings.overlaysEnabled) return;
  const selected = id === NO_OVERLAY_ID ? null : findOverlay(id);
  const photo = $camera.querySelector('img.stage-photo');
  if (selected && !overlayFitsPhoto(selected, photo)) {
    showToast(t('overlaySizeMismatch', { width: selected.width, height: selected.height }), { error: true });
    return;
  }
  currentOverlay = selected;
  renderOverlayPreview();
  updateSideSelection();
  repositionStickers();
}

async function renderOverlayPreview() {
  const revision = ++overlayPreviewRevision;
  const overlay = currentOverlay;
  const viewfinder = $camera.querySelector('.viewfinder');
  if (!viewfinder) return;
  viewfinder.querySelectorAll('.photo-overlay, .photo-overlay-strip').forEach((el) => el.remove());
  $camera.classList.remove('has-overlay');
  const photo = viewfinder.querySelector('img.stage-photo');
  if (!overlay) return;
  if (!photo) return;
  if (!photo.naturalWidth || !photo.naturalHeight) {
    if (!photo.dataset.overlayLoadHooked) {
      photo.dataset.overlayLoadHooked = '1';
      photo.addEventListener('load', () => {
        delete photo.dataset.overlayLoadHooked;
        renderOverlayPreview();
      }, { once: true });
    }
    return;
  }
  if (!overlayFitsPhoto(overlay, photo)) {
    currentOverlay = null;
    updateSideSelection();
    return;
  }
  try {
    await loadNativeOverlay(overlay);
  } catch (err) {
    if (revision === overlayPreviewRevision) {
      currentOverlay = null;
      updateSideSelection();
      showToast(t('toastEditError'), { error: true });
    }
    return;
  }
  if (revision !== overlayPreviewRevision || currentOverlay !== overlay
    || viewfinder.querySelector('img.stage-photo') !== photo) return;
  // The overlay follows the existing photo fit and crop without changing it.
  $camera.classList.add('has-overlay');
  const bounds = photoStageRect();
  const vf = viewfinder.getBoundingClientRect();
  const strip = photo.classList.contains('stage-photo--strip') && lastStripLayout;
  if (strip) {
    const wrap = document.createElement('div');
    wrap.className = 'photo-overlay-strip';
    wrap.style.left = (bounds.left - vf.left) + 'px';
    wrap.style.top = (bounds.top - vf.top) + 'px';
    wrap.style.width = bounds.width + 'px';
    wrap.style.height = bounds.height + 'px';
    const { w, h, pad, gap, count, cols = 2 } = lastStripLayout;
    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.src = overlay.src;
      img.alt = '';
      img.style.left = ((pad + (i % cols) * (w + gap)) / photo.naturalWidth * 100) + '%';
      img.style.top = ((pad + Math.floor(i / cols) * (h + gap)) / photo.naturalHeight * 100) + '%';
      img.style.width = (w / photo.naturalWidth * 100) + '%';
      img.style.height = (h / photo.naturalHeight * 100) + '%';
      wrap.appendChild(img);
    }
    viewfinder.appendChild(wrap);
  } else {
    const frame = document.createElement('img');
    frame.className = 'photo-overlay';
    frame.src = overlay.src;
    frame.alt = '';
    frame.setAttribute('aria-hidden', 'true');
    // Match the photo's fit/crop; motifs inside the PNG must remain visible.
    const photoStyle = getComputedStyle(photo);
    frame.style.objectFit = photoStyle.objectFit;
    frame.style.objectPosition = photoStyle.objectPosition;
    frame.style.left = (bounds.left - vf.left) + 'px';
    frame.style.top = (bounds.top - vf.top) + 'px';
    frame.style.width = bounds.width + 'px';
    frame.style.height = bounds.height + 'px';
    viewfinder.appendChild(frame);
  }
  repositionStickers();
}

function addEmojiStamp(glyph) {
  if (!appSettings.stickersEnabled) return;
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

  enablePlacedStickerDrag(st);

  selectSticker(st);
}

function openStampMode() {
  if (!hasPhoto || !appSettings.stickersEnabled) return;
  setBarMenuOpen(false);
  setCaptureOptionsOpen(false);
  $camera.classList.add('is-stamping');
  syncBarToggleLabel();
  openSideMenu('stamp');
  // Sticker werden nur im Menü gewählt; die Review-Aktionen bleiben sichtbar.
  setSideMenuOpen(true);
}

function closeStampMode(options = {}) {
  $camera.classList.remove('is-stamping');
  if (isKioskLayout() && !options.keepMenuOpen) setSideMenuOpen(false);
  // Zurück im Review: die Pille zeigt wieder die Rahmen statt der Filter.
  renderBarMenu();
  syncBarToggleLabel();
}

function challengeLocationLabel(location = challengeStatus.location || appSettings.challengeLocation) {
  return location === 'coburg' ? 'Campus Coburg' : 'LCC';
}

// Baut die Challenge-Karte am Endscreen für das gerade bestätigte Foto auf.
// Die Entscheidung gilt pro Foto; ein neues Foto bekommt wieder Ja/Nein.
function setupChallengeEnd() {
  const panel = $challengeEnd;
  if (!panel) return;
  const photoId = lastPhoto && lastPhoto.id ? lastPhoto.id : null;
  const configured = challengeStatus.configured
    || (appSettings.challengeAppUrl && appSettings.challengeApiKeySet);
  const active = appSettings.challengeEnabled && !!appSettings.challengeAppUrl && !!photoId;
  challengeEndPhotoId = photoId;
  challengeEndChoice = null;
  challengeEndBusy = false;
  panel.classList.remove('is-submitted', 'is-declined', 'is-submitting');
  panel.hidden = !active;
  document.body.classList.toggle('challenge-end-active', active);
  if (!active) return;

  // Ohne API-Schlüssel lässt sich nichts einreichen: dann nur der QR zur App,
  // keine Ja/Nein-Entscheidung.
  const canSubmit = configured;
  if ($challengeEndChoices) $challengeEndChoices.hidden = !canSubmit;
  panel.querySelectorAll('[data-challenge-choice]').forEach((btn) => { btn.disabled = false; });
  if ($challengeEndTheme) $challengeEndTheme.textContent = t('challengeThemeLabel') + ' ' + t(themeKeyForNow());
  if ($challengeEndQuestion) {
    // Ohne Schlüssel gibt es keine Einreichung, also auch keine Ja/Nein-Frage.
    $challengeEndQuestion.hidden = !canSubmit;
    $challengeEndQuestion.textContent = t('endChallengeQuestion', { location: challengeLocationLabel() });
  }
  if ($challengeEndStatus) $challengeEndStatus.textContent = t(canSubmit ? 'endChallengeHint' : 'endChallengeQrOnly');

  const qrUrl = challengeStatus.appUrl || appSettings.challengeAppUrl;
  if ($challengeEndQrWrap && $challengeEndQr) {
    $challengeEndQrWrap.hidden = !qrUrl;
    if (qrUrl) {
      renderQrInto($challengeEndQr, qrUrl);
      const svg = $challengeEndQr.querySelector('svg');
      if (svg) svg.setAttribute('aria-label', t('endChallengeQrAria'));
    }
  }
}

async function submitChallengeEnd() {
  if (challengeEndBusy || challengeEndChoice || !challengeEndPhotoId) return;
  if (!appSettings.challengeEnabled || !appSettings.challengeApiKeySet) return;
  challengeEndBusy = true;
  challengeEndChoice = 'yes';
  const panel = $challengeEnd;
  if (panel) {
    panel.classList.add('is-submitting');
    panel.querySelectorAll('[data-challenge-choice]').forEach((btn) => { btn.disabled = true; });
  }
  if ($challengeEndStatus) $challengeEndStatus.textContent = t('endChallengeSubmitting');

  try {
    const res = await fetch('/api/challenge/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...photoSessionHeaders() },
      body: JSON.stringify({ photoId: challengeEndPhotoId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

    challengeEndChoice = 'submitted';
    challengeEndBusy = false;
    if (panel) {
      panel.classList.remove('is-submitting');
      panel.classList.add('is-submitted');
    }
    if ($challengeEndChoices) $challengeEndChoices.hidden = true;
    if ($challengeEndStatus) $challengeEndStatus.textContent = t('endChallengeSubmitted');
    if (data.duplicate !== true) {
      challengeStatus.entries += 1;
      challengeStatus.online = true;
      updateChallengeCard();
    }
    refreshChallengeSummary();
  } catch (err) {
    console.warn('Challenge submission failed:', err);
    challengeEndChoice = null;
    challengeEndBusy = false;
    if (panel) {
      panel.classList.remove('is-submitting');
      panel.querySelectorAll('[data-challenge-choice]').forEach((btn) => { btn.disabled = false; });
    }
    if ($challengeEndStatus) $challengeEndStatus.textContent = t('endChallengeError');
    showToast(t('endChallengeError'), { error: true });
  }
}

function declineChallengeEnd() {
  if (challengeEndBusy || challengeEndChoice) return;
  challengeEndChoice = 'no';
  if ($challengeEndChoices) $challengeEndChoices.hidden = true;
  if ($challengeEnd) $challengeEnd.classList.add('is-declined');
  if ($challengeEndStatus) $challengeEndStatus.textContent = t('endChallengeDeclined');
}

document.querySelectorAll('[data-challenge-choice]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.challengeChoice === 'yes') submitChallengeEnd();
    else declineChallengeEnd();
  });
});

function showEndScreen(url) {
  // Wurde in der Zwischenzeit zum Start zurückgekehrt (oder die Galerie
  // geöffnet), darf der alte Endscreen nicht mehr auftauchen.
  $camera.classList.remove('is-finishing');
  if (currentState !== 'camera') return;
  endPhotoUrl = url;
  // Druckerstatus schon vorwärmen, damit der Druck-Button später schnell
  // reagiert (die PowerShell-Abfrage wird serverseitig 30 s gecacht).
  fetch('/api/printer', { cache: 'no-store' }).catch(() => {});
  const wrap = document.getElementById('endPhoto');
  if (wrap) {
    wrap.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = t('photoPreviewAlt');
    wrap.appendChild(img);
  }
  if ($endScreen) $endScreen.hidden = false;
  setupChallengeEnd();
  setSideMenuOpen(false);
  setBarMenuOpen(false);
  setStampMenuOpen(false);
  $camera.classList.add('is-ended');
  $camera.classList.remove('is-reviewing', 'is-stamping');
  setHomeMode('done');
  syncCancelHome();
  if ($cancelHome) $cancelHome.focus({ preventScroll: true });
}

function returnToIdle(options = {}) {
  endPhotoSession();
  document.body.classList.remove('challenge-end-active');
  if ($challengeEnd) $challengeEnd.hidden = true;
  challengeEndPhotoId = null;
  challengeEndChoice = null;
  // Der Startbildschirm beginnt ein neues Gast-Erlebnis: Beim nächsten
  // Öffnen zeigen Filter, Rahmen und Sticker ihren Hinweis wieder einmal.
  resetListScrollHints();
  resetGuestCaptureSettings({ ...options, preserveSound: true });
  galleryReturnState = 'camera';
  if ($endScreen) $endScreen.hidden = true;
  $camera.classList.remove('is-ended', 'is-reviewing', 'is-stamping', 'is-finishing');
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
  gsap.set(['.splash__brand', '.challenge-card', '.splash__sound', '.splash__content--kiosk', '.splash__gallery', '.splash__settings'], { clearProps: 'all' });
  if (options.animate !== false) {
    gsap.fromTo($splash, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' });
    gsap.fromTo('.splash__content--kiosk', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', delay: 0.1, clearProps: 'all' });
  } else gsap.set($splash, { opacity: 1 });
  currentState = 'splash';
  syncCancelHome();
  if ($splashLang) $splashLang.hidden = false;
  applyLanguage(defaultLang);
  updateChallengeCard();
  refreshChallengeSummary();
  renderSplashChain();
}

// Druckt über einen unsichtbaren iframe. So öffnet sich weder ein neuer Tab
// noch ein sichtbares Fenster. Den System-Druckdialog kann eine Webseite
// nicht selbst unterdrücken; im Kioskmodus erledigt das der Browserstart mit
// --kiosk-printing (siehe Fotobox-Kiosk.cmd).
function printEndPhoto() {
  if (!endPhotoUrl) return;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  // Nicht display:none, sonst druckt Chrome gelegentlich eine leere Seite.
  // Deshalb nur außerhalb des sichtbaren Bereichs platzieren.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;'
    + 'border:0;pointer-events:none;';
  document.body.appendChild(frame);

  let cleanupTimer = null;
  let loadTimer = null;
  let started = false;
  const cleanup = () => {
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    if (loadTimer) window.clearTimeout(loadTimer);
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  };

  const doc = frame.contentWindow.document;
  doc.open();
  doc.write('<!doctype html><html><head><title>' + appSettings.brandName + '</title><style>'
    + '@page{margin:0}'
    + 'html,body{margin:0;height:100%;background:#fff}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + 'img{max-width:100%;max-height:100vh;object-fit:contain}'
    + '</style></head><body><img alt="" src="' + endPhotoUrl + '"></body></html>');
  doc.close();

  const img = doc.querySelector('img');
  const startPrint = () => {
    if (started) return;
    started = true;
    if (loadTimer) window.clearTimeout(loadTimer);
    // Kurz warten, damit das Bild fertig layoutet ist, bevor gedruckt wird.
    window.setTimeout(() => {
      // Nach dem Druck aufräumen; der Fallback greift, falls afterprint
      // im Kioskmodus nicht ausgelöst wird.
      try {
        frame.contentWindow.addEventListener('afterprint', () => window.setTimeout(cleanup, 150));
      } catch (err) {
        /* ignore */
      }
      try {
        frame.contentWindow.print();
      } catch (err) {
        /* Druck nicht verfügbar */
      }
      cleanupTimer = window.setTimeout(cleanup, 60000);
    }, 60);
  };

  // Ein kaputtes Bild ist laut complete=true ebenfalls "fertig" — dann darf
  // nicht gedruckt werden, sonst käme eine leere Seite aus dem Drucker.
  if (img && img.complete && img.naturalWidth > 0) {
    startPrint();
  } else if (img) {
    img.addEventListener('load', startPrint, { once: true });
    img.addEventListener('error', cleanup, { once: true });
    // Falls das Laden hängt, den unsichtbaren iframe wieder entfernen.
    loadTimer = window.setTimeout(cleanup, 15000);
  } else {
    cleanup();
  }

  trackUsageEvent('print');
}

// Prüft vor dem Druck, ob überhaupt ein echter Drucker als Standard gesetzt
// ist. Ein virtueller PDF-Drucker würde sonst den Windows-Speicherdialog
// öffnen — dann lieber gar nicht drucken und klar Bescheid sagen.
let printCheckInFlight = false;

async function startPrintFlow() {
  if (!endPhotoUrl || printCheckInFlight) return;
  printCheckInFlight = true;

  let info = null;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/printer', { cache: 'no-store', signal: controller.signal });
    window.clearTimeout(timer);
    if (res.ok) info = await res.json();
  } catch (err) {
    /* unten als unbekannter Status behandelt */
  } finally {
    printCheckInFlight = false;
  }

  if (!info || info.error) {
    showToast(t('toastPrinterUnknown'), { error: true, duration: 6000 });
    return;
  }
  // Auf Nicht-Windows-Servern gibt es keine Druckerabfrage — dort wie bisher
  // den Browser drucken lassen, statt das Drucken pauschal zu blockieren.
  if (info.supported === false) {
    printEndPhoto();
    return;
  }
  if (!info.printer) {
    showToast(t('toastNoPrinter'), { error: true, duration: 6000 });
    return;
  }
  if (info.virtual) {
    showToast(t('toastVirtualPrinter').replace('{name}', info.printer), { error: true, duration: 6000 });
    return;
  }
  if (info.offline) {
    showToast(t('toastPrinterOffline').replace('{name}', info.printer), { error: true, duration: 6000 });
    return;
  }

  printEndPhoto();
}

async function completePhotoSession() {
  if (sessionCompletion || isSavingPhoto || isCapturing || !$camera.classList.contains('is-ended')) return;
  const completion = { overlay: null, tween: null };
  sessionCompletion = completion;
  const screens = [$camera, $splash, $gallery, $sideRail, $splashLang].filter(Boolean)
    .map(el => ({ el, inert: el.inert }));
  let committed = false;
  let watchdog = 0;
  try {
    hideIdleWarning();
    screens.forEach(({ el }) => { el.inert = true; });
    const overlay = document.createElement('div');
    completion.overlay = overlay;
    overlay.className = 'session-completion';
    overlay.tabIndex = -1;
    const theme = getComputedStyle(document.documentElement);
    overlay.style.setProperty('--completion-accent', theme.getPropertyValue('--c-highlight'));
    overlay.style.setProperty('--a11y-text-scale', theme.getPropertyValue('--a11y-text-scale'));
    overlay.innerHTML = '<svg class="session-completion__dial" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
      + '<circle class="session-completion__track" cx="50" cy="50" r="46"/>'
      + '<circle class="session-completion__ring" cx="50" cy="50" r="46" pathLength="100" transform="rotate(-90 50 50)"/>'
      + '<text class="session-completion__percent" x="50" y="50" text-anchor="middle">0 %</text></svg>';
    const caption = document.createElement('p');
    caption.className = 'session-completion__caption';
    caption.setAttribute('role', 'status');
    caption.textContent = t('sessionCompleted');
    overlay.appendChild(caption);
    document.body.appendChild(overlay);
    overlay.focus({ preventScroll: true });
    playUiSound('success.mp3', true);

    // Await the existing upload; retry only a failed save, using the final image unchanged.
    const photo = lastPhoto;
    if (!photo || !endPhotoUrl) throw new Error('No completed photo available');
    let saveTimeout;
    try {
      await Promise.race([
        (async () => {
          if (photo.savePromise) await photo.savePromise.catch(() => {});
          if (!photo.id) {
            photo.savePromise = savePhotoToServer(endPhotoUrl).then(id => {
              if (!id) throw new Error('Photo save failed');
              photo.id = id;
              if (photo.card) {
                photo.card.dataset.id = id;
                if (photo.card.isConnected) attachDelete(photo.card, id);
                if (photo.card._photoRecord) photo.card._photoRecord.id = id;
              }
              addPhotoIndexId(id);
            });
            await photo.savePromise;
          }
        })(),
        new Promise((_, reject) => { saveTimeout = setTimeout(() => reject(new Error('Photo save timed out')), 20000); })
      ]);
    } finally { clearTimeout(saveTimeout); }
    if (lastPhoto !== photo || currentState !== 'camera' || !$camera.classList.contains('is-ended')) {
      throw new Error('Photo session changed');
    }

    const progress = { value: 0 };
    const ring = overlay.querySelector('.session-completion__ring');
    const percent = overlay.querySelector('.session-completion__percent');
    const metrics = document.createElement('canvas').getContext('2d');
    const font = getComputedStyle(percent);
    metrics.font = font.fontWeight + ' ' + font.fontSize + ' ' + font.fontFamily;
    const paint = () => {
      percent.textContent = Math.floor(progress.value) + ' %';
      ring.style.strokeDashoffset = String(100 - progress.value);
      const ink = metrics.measureText(percent.textContent);
      percent.setAttribute('x', String(50 + (ink.width + ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2));
      percent.setAttribute('y', String(50 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2));
    };
    paint();
    const reduced = reducedCaptureMotion();
    const duration = reduced ? 0.15 : 2.5;
    const fade = reduced ? 0.1 : 0.5;
    await new Promise((resolve, reject) => {
      // Failure recovery only: this timer never drives progress or the normal transition.
      watchdog = setTimeout(() => reject(new Error('Completion animation timed out')), (duration + fade + 2) * 1000);
      completion.tween = gsap.timeline({ onComplete: resolve, onInterrupt: () => reject(new Error('Completion animation interrupted')) })
        .to(progress, { value: 100, duration, ease: 'none', onUpdate: paint })
        .call(() => {
          try {
            progress.value = 100;
            paint();
            // Prepare the splash beneath the opaque overlay before revealing it.
            overlay.style.backgroundColor = '#08090c';
            resetToStartScreen({ preserveSound: true, animate: false });
            committed = true;
            playUiSound('success.mp3');
          } catch (err) { reject(err); }
        })
        .to(overlay, { opacity: 0, duration: fade, ease: 'power1.inOut' });
    });
  } catch (err) {
    console.warn('Session completion failed:', err);
    if (!committed) showToast(t('sessionCompletionError'), { error: true });
  } finally {
    clearTimeout(watchdog);
    if (completion.tween) completion.tween.kill();
    if (completion.overlay) completion.overlay.remove();
    screens.forEach(({ el, inert }) => { el.inert = inert; });
    if (sessionCompletion === completion) sessionCompletion = null;
    syncAccessibilityIdle();
    if (currentState === 'splash') {
      const start = isKioskLayout() ? document.getElementById('splashStart') : document.querySelector('.splash__cta');
      if (start) start.focus({ preventScroll: true });
    } else {
      resetIdleDeadline();
      $cancelHome.focus({ preventScroll: true });
    }
  }
}

document.querySelectorAll('.endscreen__action').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.end === 'qr') {
      if (lastPhoto && lastPhoto.id) showQrDialog(lastPhoto.id);
      else showToast(t('qrNotSaved'), { error: true });
    } else if (btn.dataset.end === 'print') {
      startPrintFlow();
    } else if (btn.dataset.end === 'gallery') {
      openGallery('end');
    }
  });
});

function applyEndScreenActions() {
  const actionSettings = {
    qr: appSettings.endQrEnabled,
    print: appSettings.endPrintEnabled,
    gallery: appSettings.endGalleryEnabled
  };
  const buttons = Array.from(document.querySelectorAll('.endscreen__action'));
  buttons.forEach((button) => {
    button.hidden = actionSettings[button.dataset.end] === false;
  });
  const actions = document.querySelector('.endscreen__actions');
  if (actions) actions.hidden = buttons.every((button) => button.hidden);
}
if ($cancelHome) {
  $cancelHome.addEventListener('click', async () => {
    if (isDiscardingPhoto || sessionCompletion) return;
    if (isCapturing) {
      cancelCapture();
      return;
    }
    if (!$confirmModal.hidden) return;

    if ($cancelHome.classList.contains('is-done') && currentState === 'camera'
      && $camera.classList.contains('is-ended') && !$endScreen.hidden) {
      playUiSound('Button_push.mp3');
      await completePhotoSession();
      return;
    }

    // Vor „Annehmen“ gibt es noch kein bestätigtes Foto. Der Weg zum Start
    // verwirft es deshalb nicht still, sondern fragt vorher nach.
    const inReview = $camera.classList.contains('is-reviewing') || $camera.classList.contains('is-stamping');
    if (inReview && hasPhoto) {
      const confirmed = await askConfirm({
        title: t('discardTitle'),
        text: t('discardText'),
        ok: t('discardConfirm'),
        cancel: t('discardCancel'),
        warningSound: true
      });
      if (!confirmed) {
        $cancelHome.focus();
        return;
      }
      discardUnacceptedPhoto();
    }
    if (currentState !== 'splash' && !$cancelHome.classList.contains('is-done')) {
      playUiSound('start.mp3');
    }
    resetToStartScreen();
  });
}
// Klick irgendwo auf dem Startbildschirm startet die Fotobox. Buttons
// behalten ihre eigene Funktion (Galerie, Ton, Einstellungen, Sprache) —
// der Start-Button läuft ohnehin über seinen data-action-Handler.
$splash.addEventListener('click', (e) => {
  if (currentState !== 'splash') return;
  if (e.target.closest('button, a, input, select, textarea, label, [role="button"]')) return;
  startSession();
});

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
window.addEventListener('load', async () => {
  // Erst die Admin-Einstellungen anwenden: Sprache, Farben, Marke und die
  // Galerie-Seitengröße sollen schon beim allerersten Aufbau stimmen.
  await settingsReady;
  applyLanguage(defaultLang);
  // Alte Gästeauswahl aus früheren Versionen darf nicht in die erste
  // Sitzung nach dem Laden hineinreichen.
  resetGuestCaptureSettings();
  animateSplashIn();
  loadPhotosFromServer();
  loadStreak();
  updateChallengeCard();
  refreshChallengeSummary();
  renderSplashChain();
  if (isKioskLayout()) openSideMenu('filter');

  // Fetch the shutter recording up front; it is decoded on the first gesture.
  preloadShutterSound();

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (sessionCompletion) { e.preventDefault(); return; }
    const target = e.target;
    // Der Punkt auf Kiosk-Fernbedienungen ist Abbrechen/Home.
    const dotKey = e.key === '.' || e.key === 'Decimal'
      || e.code === 'Period' || e.code === 'NumpadDecimal';
    if ($creditsModal && !$creditsModal.hidden) {
      if (e.key === 'Escape' || dotKey) { e.preventDefault(); closeCredits(); }
      return;
    }
    // Einstellungen offen: nur der Dialog selbst reagiert, damit Leertaste
    // und Enter nicht dahinter die Sitzung starten (Tastaturbedienbarkeit).
    if ($settingsModal && !$settingsModal.hidden) {
      if (e.key === 'Escape' || dotKey) { e.preventDefault(); closeSettings(); }
      return;
    }
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const onButton = !!(target && target.closest && target.closest('button, [role="button"]'));

    // Punkt: Dialoge abbrechen, sonst dieselbe Aktion wie der Home-Button.
    if (dotKey) {
      e.preventDefault();
      if (!$qrModal.hidden) { closeQrDialog(); return; }
      if (!$confirmModal.hidden) { closeConfirm(false); return; }
      if (lightbox) { lightbox.remove(); lightbox = null; return; }
      if (currentState !== 'splash' && $cancelHome) $cancelHome.click();
      return;
    }

    // Vollbild ein/aus — unabhängig vom aktuellen Screen.
    if (e.code === 'KeyF' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    // Viele Kiosk-Fernauslöser senden PageUp/PageDown statt Leertaste.
    // PageUp ist Einzelfoto + Auslöser, PageDown Fotocollage + Auslöser.
    // Auf dem Startbildschirm starten sie die Sitzung direkt im passenden Modus.
    const pageShutter = e.key === 'PageUp' || e.key === 'PageDown';
    if (pageShutter) {
      const pageMode = e.key === 'PageUp' ? 'single' : 'strip';
      if (currentState === 'splash') {
        captureMode = pageMode;
        applyModeSelection();
        e.preventDefault();
        startSession();
        return;
      }
      if (currentState === 'camera' && !isCapturing
        && !$camera.classList.contains('is-reviewing')
        && !$camera.classList.contains('is-ended')
        && $qrModal.hidden && $confirmModal.hidden) {
        captureMode = pageMode;
        applyModeSelection();
        e.preventDefault();
        unlockAudio();
        runCaptureSequence();
        return;
      }
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
      && !$camera.classList.contains('is-finishing')
      && $qrModal.hidden && $confirmModal.hidden) {
      e.preventDefault();
      openGallery('camera');
      return;
    }

    if (e.key === 'Escape') {
      if (barMenuIsOpen()) {
        e.preventDefault();
        setBarMenuOpen(false);
        if ($sideMenuToggle) $sideMenuToggle.focus({ preventScroll: true });
        return;
      }
      if ($captureOptions && $captureOptions.classList.contains('is-open')) {
        e.preventDefault();
        setCaptureOptionsOpen(false);
        if ($captureOptionsToggle) $captureOptionsToggle.focus({ preventScroll: true });
        return;
      }
      if ($sideMenu && $sideMenu.classList.contains('is-open')) {
        e.preventDefault();
        setSideMenuOpen(false);
        if ($sideMenuToggle) $sideMenuToggle.focus({ preventScroll: true });
        return;
      }
      if (isCapturing) { e.preventDefault(); cancelCapture(); return; }
      if (!$qrModal.hidden) { closeQrDialog(); return; }
      if (!$confirmModal.hidden) { closeConfirm(false); return; }
      if (!$endScreen.hidden) { returnToIdle(); return; }
      if ($camera.classList.contains('is-reviewing')) { retakePhoto(); return; }
      if (lightbox) { lightbox.remove(); lightbox = null; }
      if (currentState === 'gallery') {
        closeGallery();
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
const $idleWarningCard = document.getElementById('idleWarningCard');

// Die Fristen sind Admin-Einstellungen; Änderungen greifen beim nächsten
// Zustandswechsel bzw. beim nächsten Zurücksetzen auf den Startbildschirm.
function idleWarnMs() { return appSettings.idleWarnSeconds * 1000; }
function idleEndMs() { return appSettings.idleEndSeconds * 1000; }
function idleProcessMs() { return appSettings.idleProcessSeconds * 1000; }

let idleDeadline = 0;
let idleWarnUntil = 0;
let idleWarnVisible = false;
let idleWarnLastSoundSecond = null;
let idleWarningPreviousFocus = null;
let idleStateKey = 'splash';

function handleIdleWarningInput(event) {
  if (!idleWarnVisible) return;
  // Keep the modal in place through the full pointer/touch sequence so its
  // synthesized click cannot land on a control underneath it.
  if (['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'].includes(event.type)) {
    event.stopImmediatePropagation();
    return;
  }
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
  const previousFocus = idleWarningPreviousFocus;
  hideIdleWarning();
  resetIdleDeadline();
  if (previousFocus && previousFocus.isConnected && previousFocus !== document.body) {
    previousFocus.focus({ preventScroll: true });
  }
}

const idleWarningInputEvents = [
  ['pointerdown', true],
  ['pointerup', true],
  ['mousedown', true],
  ['mouseup', true],
  ['touchstart', { capture: true, passive: false }],
  ['touchend', { capture: true, passive: false }],
  ['click', true],
  ['keydown', true],
  ['wheel', { capture: true, passive: false }]
];

function addIdleWarningInputListeners() {
  idleWarningInputEvents.forEach(([type, options]) => window.addEventListener(type, handleIdleWarningInput, options));
}

function removeIdleWarningInputListeners() {
  idleWarningInputEvents.forEach(([type]) => window.removeEventListener(type, handleIdleWarningInput, true));
}

function currentIdleStateKey() {
  if (currentState === 'splash') return 'splash';
  if ($qrModal && !$qrModal.hidden) return 'qr';
  if ($confirmModal && !$confirmModal.hidden) return 'confirm';
  if (lightbox) return 'lightbox';
  if (currentState === 'gallery') return 'gallery';
  if ($endScreen && !$endScreen.hidden) return 'end';
  if ($camera.classList.contains('is-reviewing') || $camera.classList.contains('is-stamping')) return 'review';
  return 'camera';
}

function idleTimeoutFor(key) {
  if (key === 'splash') return 0;
  return key === 'end' ? idleEndMs() : idleProcessMs();
}

function resetIdleDeadline() {
  const key = currentIdleStateKey();
  const timeout = idleTimeoutFor(key);
  idleStateKey = key;
  idleDeadline = timeout ? Date.now() + timeout : 0;
}

function hideIdleWarning() {
  removeIdleWarningInputListeners();
  stopAfkTimerSounds();
  idleWarnLastSoundSecond = null;
  if (!idleWarnVisible) return;
  idleWarnVisible = false;
  if ($idleWarning) $idleWarning.hidden = true;
  idleWarningPreviousFocus = null;
}

function showIdleWarning() {
  if (!$idleWarning || idleWarnVisible) return;
  idleWarningPreviousFocus = document.activeElement;
  idleWarnVisible = true;
  idleWarnUntil = Date.now() + idleWarnMs();
  const initialSeconds = Math.round(idleWarnMs() / 1000);
  idleWarnLastSoundSecond = initialSeconds;
  if ($idleCount) $idleCount.textContent = String(initialSeconds);
  $idleWarning.hidden = false;
  addIdleWarningInputListeners();
  if ($idleWarningCard) $idleWarningCard.focus({ preventScroll: true });
  gsap.fromTo(
    $idleWarningCard,
    { y: 16, opacity: 0, scale: 0.96 },
    { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out', clearProps: 'all' }
  );
}

function resetToStartScreen(options = {}) {
  hideIdleWarning();
  if ($qrModal && !$qrModal.hidden) closeQrDialog();
  if ($confirmModal && !$confirmModal.hidden) closeConfirm(false);
  if (lightbox) { lightbox.remove(); lightbox = null; }
  returnToIdle(options);
  idleStateKey = 'splash';
  idleDeadline = 0;
}

// Jede echte Eingabe zählt als Aktivität. Während der Warnung wird die
// Eingabe geschluckt, damit sie nicht zusätzlich eine App-Aktion auslöst.
function noteAccessibilityActivity(e) {
  if (e.isTrusted && accessibilityOnStart && currentState === 'splash') {
    cancelAccessibilityResetAnimation();
    accessibilityLastActivity = Date.now();
  }
}

function noteIdleActivity(e) {
  noteAccessibilityActivity(e);
  if (idleWarnVisible) return;
  resetIdleDeadline();
}

window.addEventListener('pointerdown', noteIdleActivity, true);
window.addEventListener('keydown', noteIdleActivity, true);
window.addEventListener('wheel', noteIdleActivity, { capture: true, passive: true });
window.addEventListener('pointermove', noteAccessibilityActivity, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetIdleDeadline();
});

resetIdleDeadline();

setInterval(() => {
  checkAccessibilityIdle();
  if (document.hidden) return;
  if (sessionCompletion) return;

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
  if (left !== idleWarnLastSoundSecond) {
    idleWarnLastSoundSecond = left;
    if (left === 5) playUiSound('afk_timer.mp3');
  }
  if (now >= idleWarnUntil) resetToStartScreen();
}, 250);
