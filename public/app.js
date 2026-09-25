import { FeedPoller, identity, audibleTime, trackPosition } from './player.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
const settings = $('settings');
let format = 'flac';
try { if (localStorage.getItem('wave-format') === 'mp3') format = 'mp3'; } catch { /* Private browsing. */ }
let wantsPlayback = false;
let retryCount = 0;
let retryTimer;
let connectTimer;
let pendingTimer;
let currentTrack = null;
let startedAt = 0;
let lastState = null;
let lastSuccess = 0;
let feedFailed = false;
let streamOnline = null;
let streamConfig = null;
let generation = 0;
let artworkKey = '';
let metadataKey = '';
let historyKey = '';
let positionUpdatedAt = 0;

function updateSystemPosition(force = false) {
  const session = navigator.mediaSession;
  if (typeof session?.setPositionState !== 'function') return;
  const now = Date.now();
  if (!force && (audio.paused || now - positionUpdatedAt < 1000)) return;
  try {
    const position = trackPosition(currentTrack, startedAt, now);
    // Never publish the Icecast connection's duration/currentTime as song time.
    session.setPositionState(position || undefined);
    positionUpdatedAt = now;
  } catch { /* Older browsers may expose but not implement position state. */ }
}

function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function status(message) { $('playback-status').textContent = message; }
function updateTransport() {
  $('play-symbol').setAttribute('href', wantsPlayback ? '#i-pause' : '#i-play');
  $('play').setAttribute('aria-label', wantsPlayback ? 'Radio pauzeren' : 'Radio afspelen');
  $('quality-label').textContent = format.toUpperCase();
  document.querySelector(`input[value="${format}"]`).checked = true;
}
function setMetadata(force = false) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = !audio.paused ? 'playing' : 'paused';
  updateSystemPosition(true);
  if (!currentTrack || !('MediaMetadata' in window)) return;
  const artwork = currentTrack.subsonic_id
    ? new URL(`/api/cover/${encodeURIComponent(currentTrack.subsonic_id)}`, location.origin).href
    : new URL('/icon-512.png', location.origin).href;
  const nextKey = JSON.stringify([identity(currentTrack), currentTrack.album, artwork]);
  if (!force && metadataKey === nextKey) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: currentTrack.title || 'SUB/WAVE', artist: currentTrack.artist || 'Live radio',
    album: currentTrack.album || 'SUB/WAVE', artwork: [{ src: artwork, sizes: '512x512' }],
  });
  metadataKey = nextKey;
}
function time(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function updateProgress() {
  const position = trackPosition(currentTrack, startedAt);
  if (!position) {
    $('elapsed').textContent = 'LIVE'; $('duration').textContent = '—'; $('progress').value = 0; return;
  }
  const { duration, position: elapsed } = position;
  $('elapsed').textContent = time(elapsed); $('duration').textContent = `−${time(duration - elapsed)}`;
  $('progress').value = elapsed / duration;
}
function coverFor(track) { return track?.subsonic_id ? `/api/cover/${encodeURIComponent(track.subsonic_id)}` : '/cover.svg'; }
function renderTrack(track, start) {
  currentTrack = track; startedAt = start;
  $('title').textContent = track?.title || 'Live-uitzending';
  $('artist').textContent = track?.artist || 'SUB/WAVE';
  $('album').textContent = track?.album || 'Je luistert naar de live radio';
  const key = coverFor(track);
  if (key !== artworkKey) {
    artworkKey = key;
    $('artwork').src = key;
    $('artwork').alt = track?.album ? `Albumhoes van ${track.album}` : 'WAVE radio';
  }
  setMetadata(); updateProgress(); renderHistory();
}
$('artwork').addEventListener('error', () => {
  if (!$('artwork').src.endsWith('/cover.svg')) $('artwork').src = '/cover.svg';
});
function renderHistory() {
  if (!lastState) return;
  const seen = new Set([identity(currentTrack)]);
  // The controller already orders history most-recent-first.
  const rows = (Array.isArray(lastState.history) ? lastState.history : []).filter(track => {
    const key = identity(track);
    if (!track.title || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 4);
  const nextKey = JSON.stringify(rows);
  if (historyKey === nextKey) return;
  historyKey = nextKey;
  $('history-list').replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Nog geen eerdere nummers.';
    $('history-list').append(empty); return;
  }
  for (const track of rows) {
    const row = document.createElement('div'); row.className = 'history-row';
    const img = document.createElement('img'); img.src = coverFor(track); img.alt = ''; img.loading = 'lazy';
    img.addEventListener('error', () => { if (!img.src.endsWith('/cover.svg')) img.src = '/cover.svg'; });
    const copy = document.createElement('div'); copy.className = 'history-copy';
    const title = document.createElement('strong'); title.textContent = track.title;
    const artist = document.createElement('span'); artist.textContent = track.artist || 'Onbekende artiest';
    copy.append(title, artist);
    const stamp = document.createElement('time');
    const date = new Date(track.t || track.startedAt || '');
    if (Number.isFinite(date.getTime())) { stamp.dateTime = date.toISOString(); stamp.textContent = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); }
    row.append(img, copy, stamp); $('history-list').append(row);
  }
}
async function getJSON(path, signal) {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function poll(signal) {
  // Session and DJ logs are not required for lock-screen metadata.
  // An unavailable history endpoint must not suppress the current track.
  const statePromise = getJSON('/api/state', AbortSignal.any([signal, AbortSignal.timeout(3500)])).then(state => {
    if (!signal.aborted) { lastState = state; renderHistory(); }
    return state;
  }).catch(() => null);
  try {
    const response = await getJSON('/api/now-playing', signal);
    if (!Object.hasOwn(response, 'nowPlaying')) throw new Error('Unexpected station response');
    lastSuccess = Date.now(); feedFailed = false;
    streamOnline = response.streamOnline;
    streamConfig = response.stream;
    $('station-name').textContent = response.dj?.station || 'SUB/WAVE';
    $('connection-info').textContent = `Nummerinformatie bijgewerkt om ${new Date(lastSuccess).toLocaleTimeString('nl-NL')}`;
    const state = await statePromise;
    if (signal.aborted) return;
    const track = response.nowPlaying;
    const at = audibleTime(track, state, response.stream?.bufferSeconds);
    clearTimeout(pendingTimer);
    if (currentTrack && track && identity(track) !== identity(currentTrack) && at > Date.now()) {
      pendingTimer = setTimeout(() => renderTrack(track, at), at - Date.now());
    } else renderTrack(track, at);
    if (!wantsPlayback && streamOnline === false) status('De zender is momenteel offline');
  } catch {
    feedFailed = true;
    $('connection-info').textContent = 'Nummerinformatie tijdelijk niet bereikbaar';
    if (!currentTrack) {
      $('title').textContent = 'Even geen verbinding';
      $('artist').textContent = 'Controleer of SUB/WAVE bereikbaar is';
    }
  }
}
const poller = new FeedPoller({ active: () => !document.hidden || wantsPlayback, poll });
function refresh(force = false) { void poller.refresh(force).catch(() => {}); }

function cancelTimers() {
  clearTimeout(retryTimer); clearTimeout(connectTimer);
  retryTimer = undefined; connectTimer = undefined;
}
function stopPlayback() {
  generation++; wantsPlayback = false; cancelTimers();
  audio.pause(); audio.removeAttribute('src'); audio.load();
  status(streamOnline === false ? 'De zender is momenteel offline' : 'Gepauzeerd · hervatten brengt je live');
  updateTransport(); setMetadata();
}
function failPlayback(message) {
  stopPlayback(); notice(message); status('Afspelen niet gestart');
}
function reconnect() {
  if (!wantsPlayback) return;
  if (retryCount >= 3) { failPlayback('De stream blijft onderbroken. Tik op afspelen om opnieuw te proberen.'); return; }
  retryCount++;
  status(`Opnieuw verbinden · ${format.toUpperCase()}`);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (wantsPlayback) startPlayback(true); }, Math.min(1000 * 2 ** retryCount, 8000));
}
function startPlayback(retrying = false) {
  cancelTimers();
  if (!retrying) retryCount = 0;
  const thisGeneration = ++generation;
  wantsPlayback = true; notice(); updateTransport(); status(`Afstemmen op ${format.toUpperCase()}…`);
  if ('audioSession' in navigator) { try { navigator.audioSession.type = 'playback'; } catch { /* Optional API. */ } }
  // The stream itself chooses the codec. No JS decoding, Web Audio graph,
  // silent keepalive or codec fallback can interfere with background audio.
  audio.src = `/stream.${format}?t=${Date.now()}`;
  const result = audio.play();
  connectTimer = setTimeout(() => {
    if (thisGeneration !== generation || !wantsPlayback) return;
    failPlayback(format === 'flac'
      ? 'FLAC start niet op dit apparaat. Probeer opnieuw, of kies zelf MP3 bij Afstemmen.'
      : 'De stream start niet. Controleer de verbinding en probeer opnieuw.');
  }, 20000);
  result?.catch(error => {
    if (thisGeneration !== generation || !wantsPlayback) return;
    if (error.name === 'NotSupportedError') failPlayback(`Deze browser kan de ${format.toUpperCase()}-stream niet afspelen.${format === 'flac' ? ' Je kunt zelf MP3 kiezen bij Afstemmen.' : ''}`);
    else if (error.name === 'NotAllowedError') failPlayback('Tik opnieuw op afspelen om de radio te starten.');
    else if (error.name !== 'AbortError') reconnect();
  });
  refresh(true);
}
$('play').addEventListener('click', () => wantsPlayback ? stopPlayback() : startPlayback());
audio.addEventListener('playing', () => {
  if (!wantsPlayback) return;
  cancelTimers(); retryCount = 0;
  status(format === 'flac' ? 'FLAC · live verbonden' : 'MP3 · live verbonden');
  notice(); setMetadata(true); refresh(true);
});
audio.addEventListener('pause', () => {
  // Native interruption: don't fight the user's headset or another audio app.
  // load() during our own reconnect also emits pause; it is ignored while loading.
  if (wantsPlayback && audio.paused && !connectTimer) {
    wantsPlayback = false; generation++; cancelTimers(); updateTransport(); status('Gepauzeerd'); setMetadata();
  }
});
audio.addEventListener('waiting', () => { if (wantsPlayback) status('Even bufferen…'); });
audio.addEventListener('stalled', () => {
  if (!wantsPlayback) return;
  const at = audio.currentTime;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (wantsPlayback && audio.currentTime <= at) reconnect(); }, 12000);
});
audio.addEventListener('ended', reconnect);
audio.addEventListener('error', () => {
  if (!wantsPlayback) return;
  if ([3, 4].includes(audio.error?.code)) failPlayback(`${format.toUpperCase()} wordt niet goed afgespeeld. Probeer opnieuw${format === 'flac' ? ', of kies zelf MP3 bij Afstemmen' : ''}.`);
  else reconnect();
});
audio.addEventListener('timeupdate', () => { updateSystemPosition(); refresh(); });
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: () => startPlayback(), pause: stopPlayback, stop: stopPlayback,
    seekbackward: null, seekforward: null, seekto: null, previoustrack: null, nexttrack: null })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Not all actions exist on every iOS. */ }
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(true); updateProgress(); } });
window.addEventListener('pageshow', () => refresh(true));
window.addEventListener('online', () => { refresh(true); if (wantsPlayback && audio.readyState < 3) reconnect(); });
window.addEventListener('offline', () => { if (wantsPlayback) status('Verbinding weg · we proberen te herstellen'); });
setInterval(() => {
  refresh();
  updateSystemPosition();
  if (!document.hidden) updateProgress();
  if (feedFailed && lastSuccess && Date.now() - lastSuccess > 20000) $('connection-info').textContent = 'Titel en hoes zijn mogelijk verouderd';
}, 1000);

function openSettings() { settings.showModal(); }
$('settings-button').addEventListener('click', openSettings);
$('quality-button').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => settings.close());
settings.addEventListener('click', event => { if (event.target === settings) {
  const bounds = settings.getBoundingClientRect();
  if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) settings.close();
} });
document.querySelectorAll('input[name="format"]').forEach(input => input.addEventListener('change', () => {
  const wasPlaying = wantsPlayback;
  if (wasPlaying) stopPlayback();
  format = input.value;
  try { localStorage.setItem('wave-format', format); } catch { /* Best effort. */ }
  updateTransport(); notice();
  if (format === 'flac' && streamConfig?.flacEnabled === false) notice('FLAC staat uit op de zender. Schakel de FLAC-stream in bij SUB/WAVE.');
  if (wasPlaying) startPlayback();
}));
$('refresh-metadata').addEventListener('click', () => refresh(true));
$('history-button').addEventListener('click', () => $('recent').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
if (typeof audio.webkitShowPlaybackTargetPicker === 'function') {
  $('airplay').hidden = false; $('transport-spacer').hidden = true;
  $('airplay').addEventListener('click', () => audio.webkitShowPlaybackTargetPicker());
}
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
updateTransport(); refresh(true);
