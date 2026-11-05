/* SnapBox Challenge — öffentliche Galerie & Leaderboard */

const MIN_MONTH = '2026-11';

const LANGUAGE_KEY = 'snapboxChallengeLanguage';
const ENGLISH = {
  'Zur Galerie springen': 'Skip to gallery',
  'Monats-Challenge': 'Monthly challenge',
  'Punktestand': 'Score',
  'Punkte = Challenge-Fotos + Likes': 'Points = challenge photos + likes',
  'Führt': 'Leading',
  'Punkte': 'Points',
  'Fotos': 'Photos',
  'Challenge-Galerie': 'Challenge gallery',
  'Monat': 'Month',
  'Lädt…': 'Loading…',
  'Wall of Trophies': 'Wall of Trophies',
  'Jeder gewonnene Monat bleibt für immer.': 'Every winning month is remembered.',
  'Hier erscheinen nur Fotos, die auf der Fotobox ausdrücklich für die Challenge freigegeben wurden.': 'Only photos explicitly shared for the challenge on the photobooth appear here.',
  'Kein Login nötig. Beim Liken bestätigst du mit Face ID, Fingerabdruck oder Geräte-PIN – es werden keine persönlichen Daten gespeichert. Solange die Abstimmung läuft, kannst du dein Like wieder zurücknehmen.': 'No login required. Confirm likes with Face ID, your fingerprint, or your device PIN. No personal data is stored. You can remove your like while voting is open.',
  'Galerie aktualisieren': 'Refresh gallery',
  'Aktualisieren': 'Refresh',
  'Bereiche': 'Sections',
  'Galerie': 'Gallery',
  'Trophäen': 'Trophies',
  'Zurück': 'Back',
  'Rückgängig': 'Undo',
  'Sprache zu Englisch wechseln': 'Switch language to English',
  'Sprache zu Deutsch wechseln': 'Switch language to German',
  'Motto: ': 'Theme: ',
  'Monatsmotiv': 'Monthly theme',
  'Neuer Start': 'Fresh Start',
  'Liebe & Winter': 'Love & Winter',
  'Frühlingswachen': 'Spring Awakening',
  'Bunt & Verrückt': 'Colorful & Crazy',
  'Blütenpracht': 'Blossoms',
  'Sommer-Vibes': 'Summer Vibes',
  'Strand & Sonne': 'Beach & Sun',
  'Heiße Nächte': 'Hot Nights',
  'Goldener Herbst': 'Golden Autumn',
  'Halloween & Laub': 'Halloween & Leaves',
  'Gemütlichkeit': 'Cozy Season',
  'Winterzauber': 'Winter Magic',
  'Galerie konnte nicht geladen werden.': 'The gallery could not be loaded.',
  'Bitte Verbindung prüfen und erneut versuchen.': 'Check your connection and try again.',
  'Erneut versuchen': 'Try again',
  'Galerie wird geladen…': 'Loading gallery…',
  'Galerie wird aktualisiert': 'Refreshing gallery',
  'Noch keine Challenge-Fotos in diesem Monat. Mach an der Fotobox ein Foto und gib es für die Challenge frei!': 'No challenge photos this month yet. Take a photo at the photobooth and share it for the challenge!',
  'In diesem Monat wurden keine Challenge-Fotos eingereicht.': 'No challenge photos were submitted this month.',
  'Abstimmung beendet': 'Voting closed',
  'Like wird entfernt': 'Removing like',
  'Like wird gespeichert': 'Saving like',
  'Like für Foto aus {location} entfernen': 'Remove like from photo from {location}',
  'Foto aus {location} liken': 'Like photo from {location}',
  'Die Abstimmung für diesen Monat ist beendet.': 'Voting for this month has ended.',
  'Like wieder entfernen': 'Remove like',
  'Foto aus {location} vergrößern': 'Enlarge photo from {location}',
  'Challenge-Foto aus {location}': 'Challenge photo from {location}',
  'Foto aus {location}': 'Photo from {location}',
  'Foto {index} von {count}': 'Photo {index} of {count}',
  '1 Like': '1 like',
  '{count} Likes': '{count} likes',
  'Eingereicht am {date} · {likes}': 'Submitted on {date} · {likes}',
  'Der erste Monatssieger wird am Monatsende gekürt.': 'The first monthly winner will be crowned at the end of the month.',
  '{score} Punkte · {entries} Fotos · {votes} Likes': '{score} points · {entries} photos · {votes} likes',
  'Galerie geladen: {count} {photos} im {month}.': 'Gallery loaded: {count} {photos} in {month}.',
  'Foto aus {location}: {likes}.': 'Photo from {location}: {likes}.',
  'Foto': 'Photo',
  'Bitte einen gültigen Monat wählen.': 'Please choose a valid month.',
  'Dieser Monat ist nicht verfügbar.': 'This month is not available.',
  'Aktualisierung fehlgeschlagen.': 'Refresh failed.',
  'Monat: {month}': 'Month: {month}',
  'Like entfernt.': 'Like removed.',
  'Like gespeichert.': 'Like saved.',
  'Ungültige Antwort': 'Invalid response.',
  'Passkey erstellt – dein Like ist gespeichert.': 'Passkey created — your like is saved.',
  'Passkey-Bestätigung abgebrochen.': 'Passkey confirmation cancelled.',
  'Auf diesem Gerät ist bereits ein Passkey hinterlegt. Bitte lade die Seite neu.': 'A passkey is already registered on this device. Please reload the page.',
  'Passkeys funktionieren nur über HTTPS.': 'Passkeys only work over HTTPS.',
  'Passkey wird auf diesem Gerät nicht unterstützt.': 'Passkeys are not supported on this device.',
  'Bitte bestätige die Aktion mit deinem Passkey.': 'Please confirm this action with your passkey.',
  'Like konnte nicht entfernt werden.': 'Could not remove like.',
  'Like konnte nicht gespeichert werden.': 'Could not save like.',
  'Passkey-Anfrage fehlgeschlagen.': 'Passkey request failed.',
  'Ungültige Passkey-Antwort.': 'Invalid passkey response.',
  'Passkey konnte nicht erstellt werden.': 'Could not create passkey.',
  'Dieser Browser unterstützt Passkeys nicht vollständig.': 'This browser does not fully support passkeys.',
  'Passkey-Schlüssel konnte nicht gelesen werden.': 'Could not read passkey key.',
  'Passkey-Bestätigung fehlgeschlagen.': 'Passkey confirmation failed.',
  'Ungültige Passkey-Daten.': 'Invalid passkey data.',
  'Offline': 'Offline',
  'Live': 'Live'
};

let language = (() => {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'de';
  } catch (e) {
    return 'de';
  }
})();

function t(text, values = {}) {
  const translated = language === 'en' ? (ENGLISH[text] || text) : text;
  return translated.replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  ));
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = language === 'en'
    ? 'SnapBox Challenge — LCC vs. Coburg'
    : 'SnapBox Challenge — LCC gegen Coburg';
  const description = $('pageDescription');
  if (description) {
    description.content = language === 'en'
      ? 'SnapBox monthly challenge: LCC vs. Coburg. Browse photos, like them, and follow the trophy race.'
      : 'SnapBox Monats-Challenge: LCC gegen Coburg. Fotos ansehen, liken und den Pokal verfolgen.';
  }

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });

  const languageToggle = $('languageToggle');
  if (languageToggle) {
    const targetLanguage = language === 'de' ? 'en' : 'de';
    languageToggle.innerHTML = `<span aria-hidden="true">${targetLanguage === 'en' ? '🇬🇧' : '🇩🇪'}</span>`;
    languageToggle.setAttribute('aria-label', t(targetLanguage === 'en'
      ? 'Sprache zu Englisch wechseln'
      : 'Sprache zu Deutsch wechseln'));
    languageToggle.title = targetLanguage === 'en' ? 'English' : 'Deutsch';
  }
  if ($refreshBtn && $refreshBtn.hasAttribute('aria-busy')) {
    $refreshBtn.setAttribute('aria-label', t('Galerie wird aktualisiert'));
  }
  if ($liveBadge) {
    $liveBadge.textContent = t($liveBadge.classList.contains('is-offline') ? 'Offline' : 'Live');
  }
}

const THEMES = [
  'Neuer Start',
  'Liebe & Winter',
  'Frühlingswachen',
  'Bunt & Verrückt',
  'Blütenpracht',
  'Sommer-Vibes',
  'Strand & Sonne',
  'Heiße Nächte',
  'Goldener Herbst',
  'Halloween & Laub',
  'Gemütlichkeit',
  'Winterzauber'
];

const $ = (id) => document.getElementById(id);

const $theme = $('theme');
const $monthLabel = $('monthLabel');
const $monthSelect = $('monthSelect');
const $refreshBtn = $('refreshBtn');
const $galleryState = $('galleryState');
const $galleryGrid = $('galleryGrid');
const $trophyGrid = $('trophyGrid');
const $liveBadge = $('liveBadge');
const $toast = $('toast');
const $toastText = $('toastText');
const $toastAction = $('toastAction');
const $loadStatus = $('loadStatus');
const $scoreboard = $('scoreboard');
const $photoView = $('photoView');
const $photoBack = $('photoBack');
const $photoViewImage = $('photoViewImage');
const $photoViewTitle = $('photoViewTitle');
const $photoViewMeta = $('photoViewMeta');
const $photoViewIndex = $('photoViewIndex');
const $photoViewActions = $('photoViewActions');
const tabs = Array.from(document.querySelectorAll('.tab[data-target]'));
const sections = ['scoreboard', 'gallery', 'trophies'].map((id) => $(id)).filter(Boolean);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Einmalige Migration der früheren localStorage-ID in den Server-Cookie.
let legacyVoterId = (() => {
  try {
    const stored = localStorage.getItem('snapboxChallengeVoter');
    return stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored) ? stored : '';
  } catch (e) {
    return '';
  }
})();
const CREDENTIAL_STORAGE_KEY = 'snapboxChallengeCredential';
const CREDENTIAL_RE = /^[A-Za-z0-9_-]{16,2048}$/;
let credentialId = (() => {
  try {
    const stored = localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    return stored && CREDENTIAL_RE.test(stored) ? stored : '';
  } catch (e) {
    return '';
  }
})();
let state = {
  month: currentMonth() < MIN_MONTH ? MIN_MONTH : currentMonth(),
  data: null,
  controller: null,
  pendingVotes: new Set(),
  openEntryId: '',
  ticker: null
};
let lastPhotoOpener = null;
let activeTabId = 'scoreboard';
let toastTimer = null;
let toastActionHandler = null;

function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit'
  }).format(new Date());
}


function isSelectableMonth(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && value >= MIN_MONTH && value <= currentMonth();
}

function monthLabel(month) {
  const date = new Date(month + '-15T12:00:00Z');
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Berlin'
    }).format(date);
  } catch (e) {
    return '';
  }
}

function locationName(location) {
  return location === 'lcc' ? 'LCC' : 'Coburg';
}

function b64urlToBuffer(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Ungültige Passkey-Daten.');
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function saveCredentialId(value) {
  if (typeof value !== 'string' || !CREDENTIAL_RE.test(value)) return;
  credentialId = value;
  try { localStorage.setItem(CREDENTIAL_STORAGE_KEY, value); } catch (e) {}
}

async function passkeysAvailable() {
  if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  toastActionHandler = null;
  if ($toastAction) {
    $toastAction.hidden = true;
    $toastAction.onclick = null;
  }
  if ($toast) $toast.hidden = true;
}

// Der Toast liegt normalerweise am Body. Im modalen Foto-Dialog wuerde er
// hinter der Dialog-Ebene verschwinden; dort gehoert er in den Dialog.
function syncToastHost(forceBody = false) {
  if (!$toast) return;
  const host = !forceBody && $photoView && $photoView.open ? $photoView : document.body;
  if ($toast.parentElement !== host) host.appendChild($toast);
}

function showToast(message, { actionLabel = '', onAction = null, duration = 0 } = {}) {
  if (!$toast || !$toastText) return;
  syncToastHost();
  clearTimeout(toastTimer);
  $toastText.textContent = message;
  toastActionHandler = typeof onAction === 'function' ? onAction : null;
  if ($toastAction) {
    $toastAction.hidden = !toastActionHandler;
    $toastAction.textContent = actionLabel || t('Rückgängig');
    $toastAction.onclick = () => {
      const handler = toastActionHandler;
      hideToast();
      if (handler) handler();
    };
  }
  $toast.hidden = false;
  const timeout = duration || (toastActionHandler ? 7000 : 4200);
  toastTimer = setTimeout(hideToast, timeout);
}

function setLive(online) {
  if (!$liveBadge) return;
  $liveBadge.textContent = t(online ? 'Live' : 'Offline');
  $liveBadge.classList.toggle('is-offline', !online);
}

function announceStatus(message) {
  if ($loadStatus) $loadStatus.textContent = message;
}

function showState(message, { error = false, retry = false } = {}) {
  if (!$galleryState) return;
  $galleryState.hidden = false;
  $galleryState.classList.toggle('is-error', error);
  $galleryState.innerHTML = '';

  if (error) {
    const strong = document.createElement('strong');
    strong.textContent = t('Galerie konnte nicht geladen werden.');
    $galleryState.appendChild(strong);
  }

  const p = document.createElement('p');
  p.textContent = message || (error ? t('Bitte Verbindung prüfen und erneut versuchen.') : '');
  $galleryState.appendChild(p);

  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('Erneut versuchen');
    button.addEventListener('click', () => loadOverview());
    $galleryState.appendChild(button);
  }
}

function hideState() {
  if ($galleryState) $galleryState.hidden = true;
}

function skeletonCard() {
  const card = document.createElement('div');
  card.className = 'skeleton-card';
  card.setAttribute('aria-hidden', 'true');

  const thumb = document.createElement('div');
  thumb.className = 'skeleton-thumb';

  const line = document.createElement('div');
  line.className = 'skeleton-line skeleton-line--short';

  card.append(thumb, line);
  return card;
}

function showSkeletons() {
  hideState();
  if ($galleryGrid) {
    $galleryGrid.setAttribute('aria-busy', 'true');
    $galleryGrid.innerHTML = '';
    for (let i = 0; i < 6; i += 1) $galleryGrid.appendChild(skeletonCard());
  }
  if ($scoreboard) $scoreboard.setAttribute('aria-busy', 'true');
  announceStatus(t('Galerie wird geladen…'));
}

function endSkeletons() {
  if ($galleryGrid) $galleryGrid.removeAttribute('aria-busy');
  if ($scoreboard) $scoreboard.removeAttribute('aria-busy');
}

function populateMonths(months) {
  if (!$monthSelect) return;
  // Während das Auswahlfeld offen ist, die Liste nicht neu aufbauen.
  if (document.activeElement === $monthSelect) return;

  const values = new Set();
  const now = currentMonth();
  if (state.month > now) state.month = now;
  if (state.month < MIN_MONTH) state.month = now >= MIN_MONTH ? now : MIN_MONTH;
  if (now >= MIN_MONTH) values.add(now);
  if (state.month >= MIN_MONTH) values.add(state.month);

  // Nur Monate ab November 2026 und bis zum aktuellen Monat:
  for (const month of months || []) {
    if (isSelectableMonth(month)) values.add(month);
  }

  // Zusätzliche Monate ab MIN_MONTH bis heute generieren
  const [minYear, minMonth] = MIN_MONTH.split('-').map(Number);
  const [nowYear, nowMonth] = now.split('-').map(Number);
  let curY = nowYear;
  let curM = nowMonth;
  while (curY > minYear || (curY === minYear && curM >= minMonth)) {
    const mStr = String(curM).padStart(2, '0');
    values.add(`${curY}-${mStr}`);
    curM--;
    if (curM < 1) {
      curM = 12;
      curY--;
    }
  }

  const sorted = [...values].filter(isSelectableMonth).sort().reverse();
  $monthSelect.innerHTML = '';
  for (const value of sorted) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = monthLabel(value);
    if (value === state.month) option.selected = true;
    $monthSelect.appendChild(option);
  }
}

function renderScoreboard() {
  const data = state.data;
  if (!data) return;
  const lcc = data.locations.lcc || { entries: 0, votes: 0, score: 0 };
  const coburg = data.locations.coburg || { entries: 0, votes: 0, score: 0 };

  $('scoreLcc').textContent = String(lcc.score);
  $('entriesLcc').textContent = String(lcc.entries);
  $('likesLcc').textContent = String(lcc.votes);
  $('scoreCoburg').textContent = String(coburg.score);
  $('entriesCoburg').textContent = String(coburg.entries);
  $('likesCoburg').textContent = String(coburg.votes);

  const max = Math.max(lcc.score, coburg.score, 1);
  $('barLcc').style.width = (lcc.score ? Math.max(6, (lcc.score / max) * 100) : 0) + '%';
  $('barCoburg').style.width = (coburg.score ? Math.max(6, (coburg.score / max) * 100) : 0) + '%';

  const leadLcc = $('leadLcc');
  const leadCoburg = $('leadCoburg');
  if (leadLcc) leadLcc.hidden = !(lcc.score > coburg.score);
  if (leadCoburg) leadCoburg.hidden = !(coburg.score > lcc.score);
}

function heartSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path>'
    + '</svg>';
}

function trophySvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"></path>'
    + '<path d="M8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3"></path>'
    + '<path d="M12 13v4M9 21h6M10 17h4"></path>'
    + '</svg>';
}

function photoMeta(entry) {
  const date = formatDate(entry.createdAt);
  const likes = entry.votes === 1 ? t('1 Like') : t('{count} Likes', { count: entry.votes });
  return date ? t('Eingereicht am {date} · {likes}', { date, likes }) : likes;
}

function updateLikeButton(button, entry) {
  const liked = !!entry.liked;
  const pending = state.pendingVotes.has(entry.id);
  const votingOpen = !!(state.data && state.data.votingOpen);
  const voteCount = Math.max(0, Number(entry.votes) || 0);
  const voteLabel = voteCount === 1 ? t('1 Like') : t('{count} Likes', { count: voteCount });
  button.dataset.entryId = entry.id;
  button.setAttribute('aria-pressed', String(liked));
  const actionLabel = !votingOpen
    ? t('Abstimmung beendet')
    : pending
      ? (liked ? t('Like wird entfernt') : t('Like wird gespeichert'))
      : (liked
        ? t('Like für Foto aus {location} entfernen', { location: locationName(entry.location) })
        : t('Foto aus {location} liken', { location: locationName(entry.location) }));
  button.setAttribute('aria-label', `${actionLabel}. ${voteLabel}.`);

  const count = button.querySelector('.like-button__count') || button.querySelector('span');
  if (count) count.textContent = String(voteCount);

  button.disabled = !votingOpen || pending;
  button.classList.toggle('is-pending', pending);
  if (pending) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');

  if (state.data && !state.data.votingOpen) {
    button.title = t('Die Abstimmung für diesen Monat ist beendet.');
  } else if (liked) {
    button.title = t('Like wieder entfernen');
  } else {
    button.removeAttribute('title');
  }
}

function syncLikeButtons(entry) {
  for (const button of document.querySelectorAll('.like-button')) {
    if (button.dataset.entryId === entry.id) updateLikeButton(button, entry);
  }
  if (state.openEntryId === entry.id && $photoViewMeta) {
    $photoViewMeta.textContent = photoMeta(entry);
  }
}

function makeLikeButton(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'like-button';
  button.innerHTML = heartSvg();

  const count = document.createElement('span');
  count.className = 'like-button__count';
  button.appendChild(count);
  updateLikeButton(button, entry);

  button.addEventListener('click', () => toggleLike(entry));
  return button;
}

function renderGallery() {
  const data = state.data;
  if (!data) return;
  $galleryGrid.innerHTML = '';

  if (!data.entries.length) {
    showState(data.votingOpen
      ? t('Noch keine Challenge-Fotos in diesem Monat. Mach an der Fotobox ein Foto und gib es für die Challenge frei!')
      : t('In diesem Monat wurden keine Challenge-Fotos eingereicht.'));
    return;
  }

  hideState();
  for (const entry of data.entries) {
    const card = document.createElement('article');
    card.className = 'photo-card';

    const media = document.createElement('button');
    media.type = 'button';
    media.className = 'photo-card__media';
    media.dataset.openEntry = entry.id;
    media.setAttribute('aria-label', t('Foto aus {location} vergrößern', { location: locationName(entry.location) }));

    const img = document.createElement('img');
    img.className = 'photo-card__image';
    img.src = entry.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    media.appendChild(img);

    const body = document.createElement('div');
    body.className = 'photo-card__body';

    const tag = document.createElement('span');
    tag.className = 'location-tag' + (entry.location === 'coburg' ? ' location-tag--coburg' : '');
    tag.textContent = locationName(entry.location);

    body.append(tag, makeLikeButton(entry));
    card.append(media, body);
    $galleryGrid.appendChild(card);
  }
}

function fillPhotoView(entry) {
  if (!$photoViewImage || !$photoViewActions) return;
  const entries = (state.data && state.data.entries) || [];
  const index = entries.findIndex((item) => item.id === entry.id);

  $photoViewImage.src = entry.imageUrl;
  $photoViewImage.alt = t('Challenge-Foto aus {location}', { location: locationName(entry.location) });
  if ($photoViewTitle) $photoViewTitle.textContent = t('Foto aus {location}', { location: locationName(entry.location) });
  if ($photoViewMeta) $photoViewMeta.textContent = photoMeta(entry);
  if ($photoViewIndex) {
    $photoViewIndex.textContent = index >= 0 ? t('Foto {index} von {count}', { index: index + 1, count: entries.length }) : '';
  }

  $photoViewActions.innerHTML = '';
  $photoViewActions.appendChild(makeLikeButton(entry));
}

function openPhotoView(entry, opener) {
  if (!$photoView || typeof $photoView.showModal !== 'function' || !state.data) return;
  state.openEntryId = entry.id;
  lastPhotoOpener = opener || null;
  fillPhotoView(entry);
  document.body.classList.add('has-dialog');
  try {
    $photoView.showModal();
  } catch (e) {
    document.body.classList.remove('has-dialog');
    state.openEntryId = '';
    return;
  }
  // Ein bereits sichtbarer Toast (z. B. Monats-Undo) muss mit in den Dialog.
  syncToastHost();
  if ($photoBack) $photoBack.focus();
}

function restorePhotoFocus() {
  const opener = lastPhotoOpener;
  lastPhotoOpener = null;
  if (!opener || !opener.isConnected) return;
  const focus = () => {
    if ($photoView && !$photoView.open && opener.isConnected) {
      opener.focus({ preventScroll: true });
    }
  };
  focus();
  setTimeout(focus, 0);
}

function closePhotoView() {
  if ($photoView && $photoView.open) {
    syncToastHost(true);
    $photoView.close();
  }
  document.body.classList.remove('has-dialog');
  restorePhotoFocus();
}

function refreshOpenPhotoView() {
  if (!state.openEntryId || !$photoView || !$photoView.open || !state.data) return;
  const entry = state.data.entries.find((item) => item.id === state.openEntryId);
  if (entry) fillPhotoView(entry);
  else closePhotoView();
}

function applyVoteResult(entry, data) {
  const wasLiked = entry.liked;
  entry.votes = Number(data.votes) || 0;
  entry.liked = data.voted !== undefined
    ? !!data.voted
    : (data.liked !== undefined ? !!data.liked : true);

  const location = state.data && state.data.locations[entry.location];
  if (location && entry.liked !== wasLiked) {
    location.votes = Math.max(0, location.votes + (entry.liked ? 1 : -1));
    location.score = location.entries + location.votes;
  }

  syncLikeButtons(entry);
  renderScoreboard();
}

async function legacyVote(entry, action) {
  const res = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId: entry.id, action })
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 428) {
    const err = new Error(data.error || t('Bitte bestätige die Aktion mit deinem Passkey.'));
    err.passkeyRequired = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(data.error || (action === 'remove'
      ? t('Like konnte nicht entfernt werden.')
      : t('Like konnte nicht gespeichert werden.')));
  }
  return data;
}

async function voteWithPasskey(entry, action) {
  const optionsRes = await fetch('/api/webauthn/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId: entry.id, credentialId: credentialId || undefined, action })
  });
  const options = await optionsRes.json().catch(() => ({}));
  if (!optionsRes.ok) throw new Error(options.error || t('Passkey-Anfrage fehlgeschlagen.'));
  if (!options || !options.publicKey || (options.mode !== 'create' && options.mode !== 'get')) {
    throw new Error(t('Ungültige Passkey-Antwort.'));
  }

  if (action === 'remove' && options.mode === 'create') {
    // Ohne hinterlegten Passkey wurde der Like klassisch vergeben; dann darf
    // er auch ohne Passkey wieder entfernt werden.
    return legacyVote(entry, action);
  }

  const publicKey = { ...options.publicKey };
  publicKey.challenge = b64urlToBuffer(publicKey.challenge);
  if (publicKey.user && publicKey.user.id) publicKey.user.id = b64urlToBuffer(publicKey.user.id);
  for (const listName of ['allowCredentials', 'excludeCredentials']) {
    if (Array.isArray(publicKey[listName])) {
      publicKey[listName] = publicKey[listName].map((item) => ({ ...item, id: b64urlToBuffer(item.id) }));
    }
  }

  let credential;
  let endpoint;
  let payload;
  if (options.mode === 'create') {
    credential = await navigator.credentials.create({ publicKey });
    if (!credential || !credential.response) throw new Error(t('Passkey konnte nicht erstellt werden.'));
    const response = credential.response;
    if (typeof response.getPublicKey !== 'function' || typeof response.getPublicKeyAlgorithm !== 'function') {
      throw new Error(t('Dieser Browser unterstützt Passkeys nicht vollständig.'));
    }
    const spki = response.getPublicKey();
    if (!spki) throw new Error(t('Passkey-Schlüssel konnte nicht gelesen werden.'));
    endpoint = '/api/webauthn/register';
    payload = {
      id: credential.id,
      publicKey: bufferToB64url(spki),
      algorithm: response.getPublicKeyAlgorithm(),
      clientDataJSON: bufferToB64url(response.clientDataJSON)
    };
  } else {
    credential = await navigator.credentials.get({ publicKey });
    if (!credential || !credential.response) throw new Error(t('Passkey-Bestätigung fehlgeschlagen.'));
    const response = credential.response;
    endpoint = '/api/webauthn/vote';
    payload = {
      entryId: entry.id,
      credentialId: credential.id,
      action,
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      authenticatorData: bufferToB64url(response.authenticatorData),
      signature: bufferToB64url(response.signature)
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || (action === 'remove'
      ? t('Like konnte nicht entfernt werden.')
      : t('Like konnte nicht gespeichert werden.')));
  }
  saveCredentialId(data.credentialId || credential.id);
  return { ...data, registered: options.mode === 'create' && data.registered !== false };
}

async function toggleLike(entry) {
  if (state.pendingVotes.has(entry.id)) return;
  const action = entry.liked ? 'remove' : 'like';
  state.pendingVotes.add(entry.id);
  syncLikeButtons(entry);

  try {
    const usePasskey = await passkeysAvailable();
    const data = usePasskey ? await voteWithPasskey(entry, action) : await legacyVote(entry, action);
    applyVoteResult(entry, data);
    const voteLabel = entry.votes === 1 ? t('1 Like') : t('{count} Likes', { count: entry.votes });
    const resultLabel = action === 'remove' ? t('Like entfernt.') : t('Like gespeichert.');
    announceStatus(`${resultLabel} ${t('Foto aus {location}: {likes}.', { location: locationName(entry.location), likes: voteLabel })}`);
    if (action === 'remove') {
      showToast(t('Like entfernt.'), {
        actionLabel: t('Rückgängig'),
        onAction: () => {
          if (!state.data) return;
          const current = state.data.entries.find((item) => item.id === entry.id);
          if (current && !current.liked) toggleLike(current);
        }
      });
    } else if (data.registered) {
      showToast(t('Passkey erstellt – dein Like ist gespeichert.'));
    }
  } catch (err) {
    if (err && err.name === 'NotAllowedError') {
      showToast(t('Passkey-Bestätigung abgebrochen.'));
    } else if (err && err.name === 'InvalidStateError') {
      showToast(t('Auf diesem Gerät ist bereits ein Passkey hinterlegt. Bitte lade die Seite neu.'));
    } else if (err && err.name === 'SecurityError') {
      showToast(t('Passkeys funktionieren nur über HTTPS.'));
    } else if (err && (err.name === 'NotSupportedError' || err.name === 'NotReadableError')) {
      showToast(t('Passkey wird auf diesem Gerät nicht unterstützt.'));
    } else if (err && err.passkeyRequired) {
      showToast(err.message);
    } else {
      showToast((err && err.message) || (action === 'remove'
        ? t('Like konnte nicht entfernt werden.')
        : t('Like konnte nicht gespeichert werden.')));
      setLive(false);
    }
  } finally {
    state.pendingVotes.delete(entry.id);
    syncLikeButtons(entry);
  }
}

function renderTrophies() {
  const trophies = state.data.trophies || [];
  $trophyGrid.innerHTML = '';

  if (!trophies.length) {
    const empty = document.createElement('p');
    empty.className = 'trophy-empty';
    empty.textContent = t('Der erste Monatssieger wird am Monatsende gekürt.');
    $trophyGrid.appendChild(empty);
    return;
  }

  for (const trophy of trophies) {
    const card = document.createElement('article');
    card.className = 'trophy-card' + (trophy.location === 'coburg' ? ' trophy-card--coburg' : '');

    const month = document.createElement('p');
    month.className = 'trophy-card__month';
    month.textContent = monthLabel(trophy.month);

    const winner = document.createElement('p');
    winner.className = 'trophy-card__winner';
    winner.innerHTML = trophySvg();
    const name = document.createElement('span');
    name.textContent = locationName(trophy.location);
    winner.appendChild(name);

    const score = document.createElement('p');
    score.className = 'trophy-card__score';
    score.textContent = t('{score} Punkte · {entries} Fotos · {votes} Likes', {
      score: trophy.score,
      entries: trophy.entries,
      votes: trophy.votes
    });

    card.append(month, winner, score);
    $trophyGrid.appendChild(card);
  }
}

function render() {
  if (!state.data) return;
  endSkeletons();
  const data = state.data;

  $theme.textContent = t('Motto: ') + t(data.theme || THEMES[Number(state.month.slice(5, 7)) - 1] || 'Monatsmotiv');
  $monthLabel.textContent = monthLabel(state.month);
  populateMonths(data.months);
  renderScoreboard();
  renderGallery();
  renderTrophies();
  refreshOpenPhotoView();
  setLive(true);

  const gallerySub = $('gallerySub');
  if (gallerySub) {
    if (!data.votingOpen) {
      gallerySub.textContent = t('Die Abstimmung für diesen Monat ist beendet.');
      gallerySub.hidden = false;
    } else {
      gallerySub.textContent = '';
      gallerySub.hidden = true;
    }
  }
}

async function loadOverview({ silent = false } = {}) {
  if (state.month > currentMonth()) state.month = currentMonth();
  if (state.month < MIN_MONTH) state.month = currentMonth() >= MIN_MONTH ? currentMonth() : MIN_MONTH;
  if (!state.data) showSkeletons();

  const controller = new AbortController();
  if (state.controller) state.controller.abort();
  state.controller = controller;

  if ($refreshBtn) {
    $refreshBtn.classList.add('is-spinning');
    $refreshBtn.setAttribute('aria-label', t('Galerie wird aktualisiert'));
    $refreshBtn.setAttribute('aria-busy', 'true');
  }

  try {
    const query = new URLSearchParams({ month: state.month });
    if (legacyVoterId) query.set('voterId', legacyVoterId);
    if (credentialId) query.set('credentialId', credentialId);

    const res = await fetch('/api/overview?' + query.toString(), {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !data.ok) throw new Error(t('Ungültige Antwort'));
    if (state.controller !== controller) return false;

    state.data = data;
    if (legacyVoterId) {
      legacyVoterId = '';
      try { localStorage.removeItem('snapboxChallengeVoter'); } catch (e) {}
    }
    render();

    if (!silent) {
      const count = data.entries.length;
      announceStatus(t('Galerie geladen: {count} {photos} im {month}.', {
        count,
        photos: t(count === 1 ? 'Foto' : 'Fotos'),
        month: monthLabel(state.month)
      }));
    }
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    if (state.controller !== controller) return false;

    setLive(false);
    endSkeletons();
    if (!state.data) {
      if ($galleryGrid) $galleryGrid.innerHTML = '';
      showState(t('Bitte Verbindung prüfen und erneut versuchen.'), { error: true, retry: true });
    } else if (!silent) {
      showToast(t('Aktualisierung fehlgeschlagen.'));
    }
    return false;
  } finally {
    if (state.controller === controller) {
      if ($refreshBtn) {
        $refreshBtn.classList.remove('is-spinning');
        $refreshBtn.setAttribute('aria-label', t('Galerie aktualisieren'));
        $refreshBtn.removeAttribute('aria-busy');
      }
    }
  }
}

async function changeMonth(next, { announce: shouldAnnounce = true } = {}) {
  if (!isSelectableMonth(next)) {
    showToast(t('Bitte einen gültigen Monat wählen.'));
    if ($monthSelect) $monthSelect.value = state.month;
    return false;
  }

  const previous = state.month;
  if (next === previous && state.data) return true;

  if ($monthSelect) $monthSelect.value = next;
  state.month = next;
  state.data = null;
  if ($galleryGrid) $galleryGrid.innerHTML = '';

  const ok = await loadOverview();
  if (ok && shouldAnnounce) {
    showToast(t('Monat: {month}', { month: monthLabel(next) }), {
      actionLabel: t('Rückgängig'),
      onAction: () => changeMonth(previous, { announce: false })
    });
  }
  return ok;
}

function setActiveTab(id) {
  if (id === activeTabId) return;
  activeTabId = id;
  for (const tab of tabs) {
    if (tab.dataset.target === id) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
  }
}

function updateActiveTab() {
  if (!sections.length) return;
  let active = sections[0].id;
  const marker = window.innerHeight * 0.4;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= marker) active = section.id;
  }
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80) {
    active = sections[sections.length - 1].id;
  }
  setActiveTab(active);
}

const $languageToggle = $('languageToggle');
if ($languageToggle) {
  $languageToggle.addEventListener('click', () => {
    language = language === 'de' ? 'en' : 'de';
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch (e) {}
    applyLanguage();
    if (state.data) render();
    else if (!$galleryState.hidden) {
      showState(t('Bitte Verbindung prüfen und erneut versuchen.'), { error: true, retry: true });
    }
  });
}

if ($monthSelect) {
  $monthSelect.addEventListener('change', () => {
    const value = $monthSelect.value;
    if (!isSelectableMonth(value)) {
      showToast(t('Dieser Monat ist nicht verfügbar.'));
      $monthSelect.value = state.month;
      return;
    }
    changeMonth(value);
  });
}

if ($refreshBtn) {
  $refreshBtn.addEventListener('click', () => loadOverview());
}

if ($galleryGrid) {
  $galleryGrid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !state.data) return;
    const opener = target.closest('[data-open-entry]');
    if (!opener) return;
    const entry = state.data.entries.find((item) => item.id === opener.dataset.openEntry);
    if (entry) openPhotoView(entry, opener);
  });
}

if ($photoBack) {
  $photoBack.addEventListener('click', closePhotoView);
}

if ($photoView) {
  $photoView.addEventListener('click', (event) => {
    if (event.target === $photoView) closePhotoView();
  });
  $photoView.addEventListener('cancel', () => syncToastHost(true));
  $photoView.addEventListener('close', () => {
    syncToastHost();
    document.body.classList.remove('has-dialog');
    state.openEntryId = '';
    restorePhotoFocus();
  });
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const target = document.getElementById(tab.dataset.target);
    if (!target) return;
    setActiveTab(tab.dataset.target);
    target.scrollIntoView({
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
      block: 'start'
    });
  });
}

let scrollFrame = null;
function onScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    updateActiveTab();
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', updateActiveTab);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadOverview({ silent: true });
});

state.ticker = setInterval(() => {
  if (
    document.visibilityState === 'visible'
    && !state.pendingVotes.size
    && !($photoView && $photoView.open)
  ) {
    loadOverview({ silent: true });
  }
}, 30000);

applyLanguage();
updateActiveTab();
loadOverview();


// Service Worker für PWA-Installation registrieren
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker Registrierung fehlgeschlagen:', err);
    });
  });
}
