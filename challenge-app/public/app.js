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

let voterId = readVoterId();
let state = {
  month: currentMonth(),
  data: null,
  loading: false,
  pendingVotes: new Set(),
  ticker: null
};

function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit'
  }).format(new Date());
}

function readVoterId() {
  const key = 'snapboxChallengeVoter';
  try {
    const stored = localStorage.getItem(key);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const fresh = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : ('v' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(key, fresh);
    return fresh;
  } catch (e) {
    return 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function monthLabel(month) {
  const date = new Date(month + '-15T12:00:00Z');
  return new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function locationName(location) {
  return location === 'lcc' ? 'LCC' : 'Coburg';
}

function showToast(message) {
  if (!$toast) return;
  $toast.textContent = message;
  $toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { $toast.hidden = true; }, 4200);
}

function setLive(online) {
  if (!$liveBadge) return;
  $liveBadge.textContent = online ? 'Live' : 'Offline';
  $liveBadge.classList.toggle('is-offline', !online);
}

function showState(message, { error = false, retry = false } = {}) {
  if (!$galleryState) return;
  $galleryState.hidden = false;
  $galleryState.classList.toggle('is-error', error);
  $galleryState.innerHTML = '';

  if (error) {
    const strong = document.createElement('strong');
    strong.textContent = 'Galerie konnte nicht geladen werden.';
    const p = document.createElement('p');
    p.textContent = message || 'Bitte Verbindung prüfen und erneut versuchen.';
    $galleryState.append(strong, p);
  } else {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const p = document.createElement('p');
    p.textContent = message;
    $galleryState.append(spinner, p);
  }

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

function populateMonths(months) {
  if (!$monthSelect) return;
  const values = new Set();
  const now = currentMonth();
  values.add(now);
  values.add(state.month);

  for (const month of months || []) {
    if (/^\d{4}-\d{2}$/.test(month)) values.add(month);
  }

  const [year, month] = now.split('-').map(Number);
  for (let i = 1; i <= 11; i += 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 15));
    values.add(d.toISOString().slice(0, 7));
  }

  const sorted = [...values].sort().reverse();
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

function makeLikeButton(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'like-button';
  button.dataset.entryId = entry.id;
  button.innerHTML = heartSvg();
  const count = document.createElement('span');
  count.textContent = String(entry.votes);
  button.appendChild(count);
  button.setAttribute('aria-label', entry.liked
    ? `Like für Foto aus ${locationName(entry.location)} entfernen`
    : `Foto aus ${locationName(entry.location)} liken`);
  button.setAttribute('aria-pressed', String(entry.liked));
  button.disabled = !state.data.votingOpen;

  if (!state.data.votingOpen) {
    button.title = 'Die Abstimmung für diesen Monat ist beendet.';
  }
  if (state.data.votingOpen) {
    button.addEventListener('click', () => toggleLike(entry, button));
  }
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

    const img = document.createElement('img');
    img.className = 'photo-card__image';
    img.src = entry.imageUrl;
    img.alt = `Challenge-Foto aus ${locationName(entry.location)}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    const body = document.createElement('div');
    body.className = 'photo-card__body';

    const tag = document.createElement('span');
    tag.className = 'location-tag' + (entry.location === 'coburg' ? ' location-tag--coburg' : '');
    tag.textContent = locationName(entry.location);

    body.append(tag, makeLikeButton(entry));
    card.append(img, body);
    $galleryGrid.appendChild(card);
  }
}

async function toggleLike(entry, button) {
  if (state.pendingVotes.has(entry.id)) return;
  state.pendingVotes.add(entry.id);
  button.disabled = true;

  try {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: entry.id, voterId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Like konnte nicht gespeichert werden.');

    const delta = data.voted ? 1 : -1;
    entry.votes = Number(data.votes) || 0;
    entry.liked = !!data.voted;

    const location = state.data.locations[entry.location];
    if (location) {
      location.votes = Math.max(0, location.votes + delta);
      location.score = location.entries + location.votes;
    }

    button.setAttribute('aria-pressed', String(entry.liked));
    button.setAttribute('aria-label', entry.liked
      ? `Like für Foto aus ${locationName(entry.location)} entfernen`
      : `Foto aus ${locationName(entry.location)} liken`);
    button.querySelector('span').textContent = String(entry.votes);
    renderScoreboard();
  } catch (err) {
    showToast(err.message || 'Like konnte nicht gespeichert werden.');
    setLive(false);
  } finally {
    state.pendingVotes.delete(entry.id);
    button.disabled = !state.data.votingOpen;
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
  const data = state.data;
  $theme.textContent = 'Motto: ' + (data.theme || THEMES[Number(state.month.slice(5, 7)) - 1] || 'Monatsmotiv');
  $monthLabel.textContent = monthLabel(state.month);
  populateMonths(data.months);
  renderScoreboard();
  renderGallery();
  renderTrophies();
  setLive(true);

  const $gallerySub = $('gallerySub');
  if ($gallerySub) {
    $gallerySub.textContent = data.votingOpen
      ? 'Ein Like pro Foto und Gerät.'
      : 'Die Abstimmung für diesen Monat ist beendet.';
  }
}

async function loadOverview({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $refreshBtn.classList.add('is-spinning');

  if (!silent || !state.data) {
    if (!state.data) showState('Galerie wird geladen…');
  }

  try {
    const query = new URLSearchParams({ month: state.month, voterId });
    const res = await fetch('/api/overview?' + query.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !data.ok) throw new Error('Ungültige Antwort');
    state.data = data;
    render();
  } catch (err) {
    setLive(false);
    if (!state.data) {
      showState('Bitte Verbindung prüfen und erneut versuchen.', { error: true, retry: true });
    } else if (!silent) {
      showToast('Aktualisierung fehlgeschlagen.');
    }
  } finally {
    state.loading = false;
    $refreshBtn.classList.remove('is-spinning');
  }
}

if ($monthSelect) {
  $monthSelect.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}$/.test($monthSelect.value)) return;
    state.month = $monthSelect.value;
    state.data = null;
    $galleryGrid.innerHTML = '';
    loadOverview();
  });
}

if ($refreshBtn) {
  $refreshBtn.addEventListener('click', () => loadOverview());
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadOverview({ silent: true });
});

state.ticker = setInterval(() => {
  if (document.visibilityState === 'visible' && !state.pendingVotes.size) {
    loadOverview({ silent: true });
  }
}, 30000);

loadOverview();
