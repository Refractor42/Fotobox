/* SnapBox Challenge — öffentliche Galerie & Leaderboard */

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
  month: currentMonth(),
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
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && value <= currentMonth();
}

function monthLabel(month) {
  const date = new Date(month + '-15T12:00:00Z');
  return new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', {
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
    $toastAction.textContent = actionLabel || 'Rückgängig';
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
  $liveBadge.textContent = online ? 'Live' : 'Offline';
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
    strong.textContent = 'Galerie konnte nicht geladen werden.';
    $galleryState.appendChild(strong);
  }

  const p = document.createElement('p');
  p.textContent = message || (error ? 'Bitte Verbindung prüfen und erneut versuchen.' : '');
  $galleryState.appendChild(p);

  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Erneut versuchen';
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
  announceStatus('Galerie wird geladen…');
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
  values.add(now);
  values.add(state.month);

  // Nur laufende und vergangene Monate: niemals Optionen aus der Zukunft.
  for (const month of months || []) {
    if (isSelectableMonth(month)) values.add(month);
  }

  const [year, month] = now.split('-').map(Number);
  for (let i = 1; i <= 11; i += 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 15));
    values.add(d.toISOString().slice(0, 7));
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
  const likes = entry.votes === 1 ? '1 Like' : `${entry.votes} Likes`;
  return date ? `Eingereicht am ${date} · ${likes}` : likes;
}

function updateLikeButton(button, entry) {
  const liked = !!entry.liked;
  const pending = state.pendingVotes.has(entry.id);
  button.dataset.entryId = entry.id;
  button.setAttribute('aria-pressed', String(liked));
  button.setAttribute('aria-label', liked
    ? `Like für Foto aus ${locationName(entry.location)} entfernen`
    : `Foto aus ${locationName(entry.location)} liken`);

  const count = button.querySelector('.like-button__count') || button.querySelector('span');
  if (count) count.textContent = String(entry.votes);

  button.disabled = !state.data || !state.data.votingOpen || pending;
  button.classList.toggle('is-pending', pending);
  if (pending) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');

  if (state.data && !state.data.votingOpen) {
    button.title = 'Die Abstimmung für diesen Monat ist beendet.';
  } else if (liked) {
    button.title = 'Like wieder entfernen';
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
      ? 'Noch keine Challenge-Fotos in diesem Monat. Mach an der Fotobox ein Foto und gib es für die Challenge frei!'
      : 'In diesem Monat wurden keine Challenge-Fotos eingereicht.');
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
    media.setAttribute('aria-label', `Foto aus ${locationName(entry.location)} vergrößern`);

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
  $photoViewImage.alt = `Challenge-Foto aus ${locationName(entry.location)}`;
  if ($photoViewTitle) $photoViewTitle.textContent = `Foto aus ${locationName(entry.location)}`;
  if ($photoViewMeta) $photoViewMeta.textContent = photoMeta(entry);
  if ($photoViewIndex) {
    $photoViewIndex.textContent = index >= 0 ? `Foto ${index + 1} von ${entries.length}` : '';
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
    const err = new Error(data.error || 'Bitte bestätige die Aktion mit deinem Passkey.');
    err.passkeyRequired = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(data.error || (action === 'remove'
      ? 'Like konnte nicht entfernt werden.'
      : 'Like konnte nicht gespeichert werden.'));
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
  if (!optionsRes.ok) throw new Error(options.error || 'Passkey-Anfrage fehlgeschlagen.');
  if (!options || !options.publicKey || (options.mode !== 'create' && options.mode !== 'get')) {
    throw new Error('Ungültige Passkey-Antwort.');
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
    if (!credential || !credential.response) throw new Error('Passkey konnte nicht erstellt werden.');
    const response = credential.response;
    if (typeof response.getPublicKey !== 'function' || typeof response.getPublicKeyAlgorithm !== 'function') {
      throw new Error('Dieser Browser unterstützt Passkeys nicht vollständig.');
    }
    const spki = response.getPublicKey();
    if (!spki) throw new Error('Passkey-Schlüssel konnte nicht gelesen werden.');
    endpoint = '/api/webauthn/register';
    payload = {
      id: credential.id,
      publicKey: bufferToB64url(spki),
      algorithm: response.getPublicKeyAlgorithm(),
      clientDataJSON: bufferToB64url(response.clientDataJSON)
    };
  } else {
    credential = await navigator.credentials.get({ publicKey });
    if (!credential || !credential.response) throw new Error('Passkey-Bestätigung fehlgeschlagen.');
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
      ? 'Like konnte nicht entfernt werden.'
      : 'Like konnte nicht gespeichert werden.'));
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
    if (action === 'remove') {
      showToast('Like entfernt.', {
        actionLabel: 'Rückgängig',
        onAction: () => {
          if (!state.data) return;
          const current = state.data.entries.find((item) => item.id === entry.id);
          if (current && !current.liked) toggleLike(current);
        }
      });
    } else if (data.registered) {
      showToast('Passkey erstellt – dein Like ist gespeichert.');
    }
  } catch (err) {
    if (err && err.name === 'NotAllowedError') {
      showToast('Passkey-Bestätigung abgebrochen.');
    } else if (err && err.name === 'InvalidStateError') {
      showToast('Auf diesem Gerät ist bereits ein Passkey hinterlegt. Bitte lade die Seite neu.');
    } else if (err && err.name === 'SecurityError') {
      showToast('Passkeys funktionieren nur über HTTPS.');
    } else if (err && (err.name === 'NotSupportedError' || err.name === 'NotReadableError')) {
      showToast('Passkey wird auf diesem Gerät nicht unterstützt.');
    } else if (err && err.passkeyRequired) {
      showToast(err.message);
    } else {
      showToast((err && err.message) || (action === 'remove'
        ? 'Like konnte nicht entfernt werden.'
        : 'Like konnte nicht gespeichert werden.'));
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
    empty.textContent = 'Der erste Monatssieger wird am Monatsende gekürt.';
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
    score.textContent = `${trophy.score} Punkte · ${trophy.entries} Fotos · ${trophy.votes} Likes`;

    card.append(month, winner, score);
    $trophyGrid.appendChild(card);
  }
}

function render() {
  if (!state.data) return;
  endSkeletons();
  const data = state.data;

  $theme.textContent = 'Motto: ' + (data.theme || THEMES[Number(state.month.slice(5, 7)) - 1] || 'Monatsmotiv');
  $monthLabel.textContent = monthLabel(state.month);
  populateMonths(data.months);
  renderScoreboard();
  renderGallery();
  renderTrophies();
  refreshOpenPhotoView();
  setLive(true);

  const gallerySub = $('gallerySub');
  if (gallerySub) {
    gallerySub.textContent = data.votingOpen
      ? 'Ein Like pro Foto und Gerät – jederzeit wieder zurücknehmbar.'
      : 'Die Abstimmung für diesen Monat ist beendet.';
  }
}

async function loadOverview({ silent = false } = {}) {
  if (state.month > currentMonth()) state.month = currentMonth();
  if (!state.data) showSkeletons();

  const controller = new AbortController();
  if (state.controller) state.controller.abort();
  state.controller = controller;

  if ($refreshBtn) {
    $refreshBtn.classList.add('is-spinning');
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
    if (!data || !data.ok) throw new Error('Ungültige Antwort');
    if (state.controller !== controller) return false;

    state.data = data;
    if (legacyVoterId) {
      legacyVoterId = '';
      try { localStorage.removeItem('snapboxChallengeVoter'); } catch (e) {}
    }
    render();

    if (!silent) {
      const count = data.entries.length;
      announceStatus(`Galerie geladen: ${count} ${count === 1 ? 'Foto' : 'Fotos'} im ${monthLabel(state.month)}.`);
    }
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    if (state.controller !== controller) return false;

    setLive(false);
    endSkeletons();
    if (!state.data) {
      if ($galleryGrid) $galleryGrid.innerHTML = '';
      showState('Bitte Verbindung prüfen und erneut versuchen.', { error: true, retry: true });
    } else if (!silent) {
      showToast('Aktualisierung fehlgeschlagen.');
    }
    return false;
  } finally {
    if (state.controller === controller) {
      if ($refreshBtn) {
        $refreshBtn.classList.remove('is-spinning');
        $refreshBtn.removeAttribute('aria-busy');
      }
    }
  }
}

async function changeMonth(next, { announce: shouldAnnounce = true } = {}) {
  if (!isSelectableMonth(next)) {
    showToast('Bitte einen gültigen Monat wählen.');
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
    showToast(`Monat: ${monthLabel(next)}`, {
      actionLabel: 'Rückgängig',
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

if ($monthSelect) {
  $monthSelect.addEventListener('change', () => {
    const value = $monthSelect.value;
    if (!isSelectableMonth(value)) {
      showToast('Dieser Monat ist nicht verfügbar.');
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

updateActiveTab();
loadOverview();
