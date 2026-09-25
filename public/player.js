export function identity(track) {
  return track ? `${track.subsonic_id || ''}|${track.title || ''}|${track.artist || ''}` : '';
}

// Radio media time measures the connection, not the song. Use the station's
// buffered start time for both the UI and the system media controls.
export function trackPosition(track, startedAt, now = Date.now()) {
  const duration = Number(track?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  return { duration, position: Math.min(duration, Math.max(0, (now - startedAt) / 1000)), playbackRate: 1 };
}

export function audibleTime(track, state, bufferSeconds, now = Date.now()) {
  const current = state?.current;
  if (!track || !current || (track.subsonic_id && current.subsonic_id
    ? track.subsonic_id !== current.subsonic_id
    : track.title !== current.title || track.artist !== current.artist)) return now;
  const started = Date.parse(current.startedAt);
  const buffer = Number.isFinite(bufferSeconds) ? Math.min(60, Math.max(0, bufferSeconds)) : 0;
  return Number.isFinite(started) && started <= now ? started + buffer * 1000 : now;
}

// Timers are best-effort on iOS. Active audio keeps polling eligible; returning
// to the app and media timeupdate events provide additional refresh chances.
export class FeedPoller {
  constructor({ active, poll, interval = 5000, now = () => Date.now() }) {
    this.active = active;
    this.poll = poll;
    this.interval = interval;
    this.now = now;
    this.last = -Infinity;
    this.pending = null;
  }
  async refresh(force = false) {
    if (!this.active() || this.pending || (!force && this.now() - this.last < this.interval)) return;
    const controller = new AbortController();
    this.pending = controller;
    this.last = this.now();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try { await this.poll(controller.signal); }
    catch (error) { if (!controller.signal.aborted) throw error; }
    finally { clearTimeout(timeout); this.pending = null; }
  }
}
