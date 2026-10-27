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

// --- State ---
let currentState = 'splash';
let hasPhoto = false;
let photoCount = 0;
let videoPlaying = false;
let viewfinderVisible = false;
let isCapturing = false;

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
const STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

function isPhotoTakenRecently(isoTimestamp) {
  if (!isoTimestamp) return false;
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < STREAK_WINDOW_MS;
}

function renderStreak() {
  const takenRecently = isPhotoTakenRecently(lastPhotoTimestamp);
  $streakCount.textContent = String(currentStreak);
  $streakPill.classList.add('visible');
  $streakPill.classList.toggle('streak--active', takenRecently);
  $streakPill.classList.toggle('streak--due', !takenRecently);
  $streakPill.setAttribute(
    'aria-label',
    'Daily streak: ' + currentStreak + (currentStreak === 1 ? ' day, ' : ' days, ')
      + (takenRecently ? 'photo taken in the last 24 hours' : 'no photo in the last 24 hours')
  );
}

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

// ============================================================
//  ANIMATIONS: Camera enter
// ============================================================
function animateCameraIn() {
  const tl = timeline({ onStart: () => { $camera.style.display = 'block'; } });
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

// Countdown-Dauer (Selbstauslöser) — sichtbar gewählt, pro Gerät gemerkt.
// Default 5s: Standard bei echten Fotoboxen und genug Zeit, um sich zu
// positionieren; 3s bleibt als Schnell-Option wählbar.
let countdownSeconds = Number(localStorage.getItem('countdownSeconds'));
if (![3, 5, 10].includes(countdownSeconds)) countdownSeconds = 5;

function applyTimerSelection() {
  $timerChips.querySelectorAll('.timer__chip').forEach((chip) => {
    const active = Number(chip.dataset.seconds) === countdownSeconds;
    chip.classList.toggle('is-selected', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}
applyTimerSelection();

$timerChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.timer__chip');
  if (!chip) return;
  countdownSeconds = Number(chip.dataset.seconds);
  localStorage.setItem('countdownSeconds', String(countdownSeconds));
  applyTimerSelection();
});

// Während der Aufnahmesequenz (Countdown → Verarbeitung) sind Gallery, Timer
// gesperrt: Fehlklicks können die Sequenz nicht mehr abreißen
// (Fehlervermeidung) — Kontrolle kommt danach über Behalten/Neu aufnehmen.
function setControlsLocked(locked) {
  $galleryBtn.classList.toggle('is-locked', locked);
  $timerChips.classList.toggle('is-locked', locked);
}

// Das Review-Panel bleibt während der Bearbeitung sichtbar: „Save“ ist
// damit auch nach dem Platzieren eines Stickers immer direkt erreichbar.
function showReview() {
  $review.hidden = false;
  $camera.classList.add('is-reviewing');
  closeReviewTools();
  // Ausgangszustand: ungefiltertes Foto, Auswahl auf „Standard“.
  applyFilterSelection();
  gsap.from($review, { y: 24, opacity: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
  $reviewKeep.focus();
}

function hideReview() {
  $review.hidden = true;
  $camera.classList.remove('is-reviewing');
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

$reviewKeep.addEventListener('click', () => {
  hideReview();
  setControlsLocked(false);
  // Farbe oder Sticker gewählt: Foto neu komponieren und serverseitig
  // überschreiben, sonst zurück ins Livebild, bereit für den nächsten Schuss.
  if (activeStickers.length || currentFilter !== 'standard') {
    saveEditedPhoto();
  } else {
    resetCameraView();
  }
});

$reviewRetake.addEventListener('click', () => {
  hideReview();
  setControlsLocked(false);
  clearStickers();
  discardCurrentPhoto();
});

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
      <p>Link wird erstellt…</p>
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
  retry.textContent = 'Erneut versuchen';
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
      svg.setAttribute('aria-label', 'QR-Code zum Herunterladen des Fotos');
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
  copy.textContent = 'Link kopieren';
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link kopiert.'))
      .catch(() => showToast('Link konnte nicht kopiert werden.', { error: true }));
  });
  box.appendChild(link);
  box.appendChild(copy);
  frame.appendChild(box);
}

async function showQrDialog(photoId) {
  if (!photoId) {
    showToast('Foto ist noch nicht gespeichert.', { error: true });
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
    $qrTtl.textContent = 'Link ist 24 Stunden gültig.';
  } catch (err) {
    console.warn('QR link could not be created:', err);
    if (!$qrModal.hidden) showErrorInQrFrame();
  }
}

// ============================================================
//  FILTER — Live-Vorschau aufs Video, beim Capture mit eingebrannt
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

    chip.textContent = filter.label;
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

function applyFilterSelection() {
  $filterChips.forEach((chip) => {
    const selected = chip.dataset.filter === currentFilter;
    chip.classList.toggle('is-selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
  applyStageFilter();
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
  positionSticker(st);
  $camera.querySelector('.viewfinder').appendChild(el);
  activeStickers.push(st);

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectSticker(st);
    const rect = $camera.querySelector('.viewfinder').getBoundingClientRect();
    const move = (ev) => {
      st.x = ((ev.clientX - rect.left) / rect.width) * 100;
      st.y = ((ev.clientY - rect.top) / rect.height) * 100;
      st.x = Math.min(100, Math.max(0, st.x));
      st.y = Math.min(100, Math.max(0, st.y));
      positionSticker(st);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  selectSticker(st);
}

function positionSticker(st) {
  st.el.style.width = st.w + '%';
  st.el.style.left = st.x + '%';
  st.el.style.top = st.y + '%';
  st.el.style.transform = 'translate(-50%, -50%)';
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
  ctrl.appendChild(mk('−', 'Sticker verkleinern', () => scaleSticker(st, 0.85)));
  ctrl.appendChild(mk('+', 'Sticker vergrößern', () => scaleSticker(st, 1.18)));
  ctrl.appendChild(mk('×', 'Sticker entfernen', () => removeSticker(st)));
  st.el.appendChild(ctrl);
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
  for (const st of [...activeStickers]) {
    try {
      const si = await loadImg(st.el.querySelector('img').src);
      const w = (st.w / 100) * canvas.width;
      const h = w * (si.naturalHeight / si.naturalWidth);
      const x = (st.x / 100) * canvas.width - w / 2;
      const y = (st.y / 100) * canvas.height - h / 2;
      ctx.drawImage(si, x, y, w, h);
    } catch (err) {
      console.warn('Sticker konnte nicht gerendert werden:', err);
    }
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function saveEditedPhoto() {
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
    showToast('Änderungen konnten nicht gespeichert werden.', { error: true });
    clearStickers();
    resetCameraView();
    return;
  }
  clearStickers();
  if (!lastPhoto || !lastPhoto.id) {
    showToast('Änderungen konnten nicht gespeichert werden — Foto bleibt unverändert.', { error: true });
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
    showToast('Foto gespeichert.');
  } catch (err) {
    console.warn('Edited photo could not be saved:', err);
    showToast('Bearbeitetes Foto konnte nicht gespeichert werden — Original bleibt erhalten.', { error: true });
  }
  resetCameraView();
}

async function runCaptureSequence() {
  if (currentState !== 'camera') return;
  if (isCapturing) return;
  if (!stream || !$video.srcObject) {
    showPermissionPrompt();
    return;
  }
  isCapturing = true;
  $captureBtn.disabled = true;
  setControlsLocked(true);

  // unlock / resume audio while we still have the user gesture
  unlockAudio();

  try {
    // 1. countdown with tick sounds
    await runCountdown();

    // 2. hide viewfinder + placeholder
    await hideViewfinder();
    gsap.to($placeholder, { opacity: 0, duration: 0.2, ease: 'power2.in' });

    // 3. flash + shutter sound
    playShutterSound();
    gsap.to($flash, { opacity: 1, duration: 0.01 });
    gsap.fromTo($flash, { opacity: 1 }, {
      opacity: 0, duration: 0.35, ease: 'power2.out', delay: 0.02
    });

    // 4. process photo — die Live-Vorschau ist immer ungefiltert; Farbe wird
    // erst im Review auf das fertige Foto angewendet.
    currentFilter = 'standard';
    applyFilterSelection();
    showProcessing();
    await new Promise((r) => setTimeout(r, 200));
    $video.pause();
    const photoUrl = await captureFromVideo();

    // 5. reveal photo in stage
    await showCaptureResult(photoUrl);

    // 6. add to gallery + ask for the keep/retake decision
    addToGallery(photoUrl);
    showReview();
  } finally {
    isCapturing = false;
    $captureBtn.disabled = false;
    currentState = 'camera';
    // während des Reviews bleiben die übrigen Buttons gesperrt
    if ($review.hidden) setControlsLocked(false);
  }
}

function runCountdown() {
  return new Promise((resolve) => {
    let count = countdownSeconds;
    const STEP_MS = 900;

    gsap.killTweensOf($countdown);
    $countdown.style.opacity = '1';

    const showTick = () => {
      $countdown.textContent = String(count);
      playCountdownTick(count === 1);

      gsap.fromTo(
        $countdown,
        { scale: 0.35, opacity: 0, y: 0 },
        { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.2)' }
      );

      // Fade the digit out near the end of the step, but keep the timing
      // logic independent of GSAP so a throttled tab can't stall the capture.
      setTimeout(() => {
        gsap.to($countdown, {
          scale: 0.8,
          opacity: 0,
          duration: 0.22,
          ease: 'power2.in'
        });
      }, STEP_MS - 220);

      setTimeout(() => {
        count--;
        if (count >= 1) {
          showTick();
        } else {
          gsap.set($countdown, { opacity: 0 });
          resolve();
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

async function showCaptureResult(photoUrl) {
  gsap.to($placeholder, { opacity: 0, duration: 0.001 });

  const img = document.createElement('img');
  img.className = 'stage-photo';
  img.src = photoUrl;
  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 0;
    border-radius: 0; filter: grayscale(100%) contrast(1.1);
  `;
  $camera.querySelector('.viewfinder').appendChild(img);

  const tl = timeline({ defaults: { ease: 'power2.out' } });
  await tl.to($flash, { opacity: 0.9, duration: 0.01 })
    .to($flash, { opacity: 0, duration: 0.3 }, '+=0.05');

  gsap.to(img, { opacity: 1, duration: 0.5 });
  await gsap.to(img, {
    filter: 'grayscale(0%) contrast(1)', duration: 0.7, delay: 0.2
  });

  gsap.to($processing, { opacity: 0, duration: 0.3, delay: 0.5 });
  $processingFill.style.width = '0%';
  $processingFill.style.transition = 'none';

  img.style.cssText = `
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 1; border-radius: 0;
    filter: grayscale(0%) contrast(1);
  `;
  // a photo is now shown in the stage
  hasPhoto = true;
  return new Promise((r) => setTimeout(r, 300));
}

function resetCameraView() {
  const existingImg = $camera.querySelector('.viewfinder img.stage-photo');
  if (existingImg) existingImg.remove();
  clearStickers();
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
      showToast('Foto konnte nicht gespeichert werden — Verbindung prüfen.', { error: true });
      return null;
    });
}

// Moves a photo to the trash (Papierkorb) on the server, removes its card and
// offers an undo toast. Without a server id the photo was never saved, so only
// the card is removed.
async function deletePhoto(card, photoId) {
  if (!photoId) {
    removeCard(card);
    return;
  }
  const key = 'trash:' + photoId;
  if (pendingOps.has(key)) return;
  pendingOps.add(key);
  const image = card.querySelector('img') ? card.querySelector('img').src : null;
  try {
    const res = await fetch('/api/photos?id=' + encodeURIComponent(photoId) + '&days=' + getRetentionDays(), {
      method: 'DELETE'
    });
    // 404 = bereits verschoben (Doppelklick-Race) — gilt ebenfalls als Erfolg
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    const data = res.status === 404 ? {} : await res.json();
    removeCard(card);
    refreshTrashCount();
    if (data.trashId) {
      showToast('Foto in den Papierkorb verschoben.', {
        actionLabel: 'Rückgängig',
        onAction: () => restoreFromTrash(data.trashId, image)
      });
    } else {
      showToast('Foto in den Papierkorb verschoben.');
    }
  } catch (err) {
    console.warn('Photo could not be deleted:', err);
    showToast('Foto konnte nicht gelöscht werden — Verbindung prüfen.', { error: true });
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
    showToast('Foto wiederhergestellt.');
  } catch (err) {
    console.warn('Photo could not be restored:', err);
    showToast('Wiederherstellen fehlgeschlagen — das Foto bleibt im Papierkorb.', { error: true });
  } finally {
    pendingOps.delete(key);
  }
}

function removeCard(card) {
  if (!card.isConnected) return;
  if (lastPhoto && lastPhoto.card === card) lastPhoto = null;
  card.remove();
  photoCount = Math.max(0, photoCount - 1);
  $galleryBadge.textContent = String(photoCount);
  if (!$galleryGrid.querySelector('.gallery__card')) $galleryEmpty.style.display = '';
}

// Adds a delete button to a gallery card.
function attachDelete(card, photoId) {
  const btn = document.createElement('button');
  btn.className = 'gallery__delete';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Delete photo');
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
    .then((items) => items.forEach((item) => addToGallery(item.image, false, item.id)))
    .catch((err) => {
      console.warn('Photos could not be loaded from database:', err);
      showToast('Gespeicherte Fotos konnten nicht geladen werden.', { error: true });
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
        showToast('Foto gespeichert.');
      } else {
        deletePhoto(card, id); // discarded before the save finished
      }
      if (lastPhoto && lastPhoto.card === card) lastPhoto.id = id;
    });
  }

  const card = document.createElement('div');
  card.className = 'gallery__card';

  const img = document.createElement('img');
  img.src = photoUrl;
  img.alt = 'Captured photo';
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
  img.alt = 'Photo preview';
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
      Aufs Handy`;
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
const $confirmOk = document.getElementById('confirmOk');
const $confirmCancel = document.getElementById('confirmCancel');
let confirmResolve = null;

// Löst mit true (bestätigt) oder false (abgebrochen).
function askConfirm() {
  return new Promise((resolve) => {
    confirmResolve = resolve;
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
const $trashRetention = document.getElementById('trashRetention');
const RETENTION_KEY = 'trashRetentionDays';

let trashOpen = false;
let trashItems = []; // { id, image, expiresAt }
let trashVersion = 0; // lokale Änderungen invalidieren noch laufende loadTrash-Antworten

function getRetentionDays() {
  const v = Number(localStorage.getItem(RETENTION_KEY));
  return [7, 14, 30].includes(v) ? v : 7;
}

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

$trashRetention.value = String(getRetentionDays());
$trashRetention.addEventListener('change', () => {
  localStorage.setItem(RETENTION_KEY, $trashRetention.value);
  showToast('Papierkorb wird nach ' + $trashRetention.value + ' Tagen geleert.');
});

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
      showToast('Papierkorb konnte nicht geladen werden.', { error: true });
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
  return 'noch ' + daysLeft + (daysLeft === 1 ? ' Tag' : ' Tage');
}

function buildTrashCard(item) {
  const card = document.createElement('div');
  card.className = 'trash__card';

  const img = document.createElement('img');
  img.src = item.image;
  img.alt = 'Gelöschtes Foto';
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
  restoreBtn.textContent = 'Wiederherstellen';
  restoreBtn.addEventListener('click', () => restoreTrashedPhoto(item));
  actions.appendChild(restoreBtn);

  const purgeBtn = document.createElement('button');
  purgeBtn.className = 'trash__btn trash__btn--purge';
  purgeBtn.type = 'button';
  purgeBtn.textContent = 'Endgültig löschen';
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
    showToast('Foto wiederhergestellt.');
  } catch (err) {
    trashVersion++;
    trashItems.push(item); // optimistic removal zurückrollen
    renderTrash();
    console.warn('Photo could not be restored:', err);
    showToast('Foto konnte nicht wiederhergestellt werden.', { error: true });
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
    showToast('Foto endgültig gelöscht.');
  } catch (err) {
    trashVersion++;
    trashItems.push(item); // optimistic removal zurückrollen
    renderTrash();
    console.warn('Photo could not be purged:', err);
    showToast('Foto konnte nicht endgültig gelöscht werden.', { error: true });
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
let soundEnabled = localStorage.getItem('soundEnabled') !== '0';

function applySoundState() {
  $soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  $soundToggle.setAttribute('aria-label', soundEnabled ? 'Ton ausschalten' : 'Ton einschalten');
  $soundToggle.querySelectorAll('.sound-on').forEach((el) => { el.style.display = soundEnabled ? '' : 'none'; });
  $soundToggle.querySelectorAll('.sound-off').forEach((el) => { el.style.display = soundEnabled ? 'none' : ''; });
}
applySoundState();

$soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled ? '1' : '0');
  applySoundState();
});

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
        unlockAudio(); // create the AudioContext inside the user gesture
        currentState = 'camera';
        initCamera(); // request camera immediately to preserve user-gesture context
        const tl = timeline();
        tl.to('.splash__content', {
          y: -30, opacity: 0, duration: 0.5, ease: 'power2.in'
        }).to($splash, {
          opacity: 0, duration: 0.01
        }, '+=0.2').add(() => {
          $splash.style.display = 'none';
          animateCameraIn();
        }, '+=0.3');
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
//  INIT
// ============================================================
window.addEventListener('load', () => {
  animateSplashIn();
  loadPhotosFromServer();
  loadStreak();

  // Fetch the shutter recording up front; it is decoded on the first gesture.
  preloadShutterSound();

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (currentState === 'camera' && (e.key === ' ' || e.key === 'Enter')) {
      unlockAudio(); // keyboard activation is a gesture too
      runCaptureSequence();
    }
    if (e.key === 'Escape') {
      if (!$qrModal.hidden) { closeQrDialog(); return; }
      if (!$confirmModal.hidden) { closeConfirm(false); return; }
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

