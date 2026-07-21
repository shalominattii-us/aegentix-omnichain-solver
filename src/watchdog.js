class Watchdog {
  constructor({ redis, rebalancer, checkIntervalMs = 15000 }) {
    this.redis = redis;
    this.rebalancer = rebalancer;
    this.checkIntervalMs = checkIntervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    console.log('[WDOG] Starting settlement watchdog');
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    this.tick();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    try {
      const jobs = await this.redis.xRange('intent:pending', '-', '+');
      for (const msg of jobs) {
        const id = msg.id;
        const fields = msg.message;
        if (fields.status === 'awaiting_settlement') {
          const done = await this.confirmSettlement(id, fields);
          if (done) await this.redis.xAck('intent:pending', 'watchdog-group', id);
        }
      }
    } catch (err) {
      console.error('[WDOG][ERROR]', err.message);
    }
  }

  async confirmSettlement(id, fields) {
    const ageMs = Date.now() - Number(fields.queuedAt || 0);
    if (ageMs > 1000 * 60 * 60) {
      console.log(`[WDOG] Unwinding stale intent ${id}`);
      await this.redis.xAdd('intent:failed', '*', 'intentId', fields.id, 'reason', 'stale_settlement_unwind');
      return true;
    }
    console.log(`[WDOG] Still awaiting settlement for ${id}`);
    return false;
  }
}

module.exports = Watchdog;
