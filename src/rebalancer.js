class Rebalancer {
  constructor({ redis, inventory, checkIntervalMs = 30000 }) {
    this.redis = redis;
    this.inventory = inventory;
    this.checkIntervalMs = checkIntervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    console.log('[REBAL] Starting rebalance watcher');
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
      const needed = await this.redis.lRange('rebalance:queue', 0, -1);
      if (!needed.length) return;
      console.log(`[REBAL] Queue depth: ${needed.length}`);
      for (const raw of needed) {
        const job = JSON.parse(raw);
        await this.executeRebalance(job);
        await this.redis.lPop('rebalance:queue');
      }
    } catch (err) {
      console.error('[REBAL][ERROR]', err.message);
    }
  }

  async executeRebalance({ srcChain, destChain, token, amount }) {
    console.log(`[REBAL] ${amount} ${token} ${srcChain} -> ${destChain} (queued)`);
    await this.redis.xAdd('rebalance:executions', '*', 'srcChain', srcChain, 'destChain', destChain, 'token', token, 'amount', String(amount));
  }
}

module.exports = Rebalancer;
