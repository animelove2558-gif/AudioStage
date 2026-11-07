// Small policies the main process uses so that one fault does not turn into a flood (plain Node, tested in tests/guards.test.js).

/* At most one error dialog per interval; the rest is only counted (and logged by the caller). After `restartAfter`
   dialogs in one run the dialog offers a restart, because the app is probably in an unknown state. */
class DialogThrottle {
  constructor(o = {}) { this.intervalMs = o.intervalMs || 30000; this.restartAfter = o.restartAfter || 3; this.lastShown = -Infinity; this.shown = 0; this.suppressed = 0; }
  hit(now = Date.now()) {
    if (now - this.lastShown < this.intervalMs) { this.suppressed++; return { show: false, suppressed: this.suppressed }; }
    this.lastShown = now; this.shown++;
    const suppressed = this.suppressed; this.suppressed = 0;
    return { show: true, suppressed, offerRestart: this.shown >= this.restartAfter };
  }
}

/* Reloading a window that dies again right away would loop forever: at most `max` automatic reloads per window of time. */
class ReloadLimiter {
  constructor(o = {}) { this.max = o.max || 3; this.windowMs = o.windowMs || 60000; this.times = []; }
  allow(now = Date.now()) {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.max) return false;
    this.times.push(now); return true;
  }
}

module.exports = { DialogThrottle, ReloadLimiter };
