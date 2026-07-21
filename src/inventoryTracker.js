class InventoryTracker {
  constructor(redis) {
    this.redis = redis;
    this.prefix = 'inventory';
  }

  key(chain, token) {
    return `${this.prefix}:${chain}:${token}`;
  }

  async setSnapshot(chain, token, amount) {
    const k = this.key(chain, token);
    await this.redis.set(k, String(amount));
    await this.redis.sAdd('inventory:chains', chain);
    await this.redis.sAdd('inventory:tokens', token);
  }

  async getAvailable(chain, token) {
    const raw = await this.redis.get(this.key(chain, token));
    if (raw === null) return 0;
    return parseFloat(raw);
  }

  async reserve(chain, token, amount) {
    const k = this.key(chain, token);
    const next = Math.max(0, await this.getAvailable(chain, token) - amount);
    await this.redis.set(k, String(next));
  }

  async credit(chain, token, amount) {
    const k = this.key(chain, token);
    const next = await this.getAvailable(chain, token) + amount;
    await this.redis.set(k, String(next));
  }

  async snapshotAll() {
    const chains = await this.redis.sMembers('inventory:chains');
    const out = {};
    for (const chain of chains) {
      out[chain] = {};
      const tokens = await this.redis.sMembers('inventory:tokens');
      for (const token of tokens) out[chain][token] = await this.getAvailable(chain, token);
    }
    return out;
  }
}

module.exports = InventoryTracker;
