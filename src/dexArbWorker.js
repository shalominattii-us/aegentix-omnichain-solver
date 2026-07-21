class DexArbWorker {
  constructor({ redis, inventory, arbRpc, baseRpc, minNetProfitBps = 8, maxFillUsdc = 50000 }) {
    this.redis = redis;
    this.inventory = inventory;
    this.arbRpc = arbRpc;
    this.baseRpc = baseRpc;
    this.minNetProfitBps = minNetProfitBps;
    this.maxFillUsdc = maxFillUsdc;
    this.pollIntervalMs = parseInt(process.env.DEX_ARB_POLL_MS || '2000', 10);
    this.timer = null;
    this.running = false;
    this.swaps = new (require('./swapExecutor'))({ redis, inventory, arbRpc, baseRpc });
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log('[DEX-ARB] Starting spatial inventory arb worker');
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    this.tick();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  async tick() {
    try {
      const arbPrice = await this.fetchMidPrice(this.arbRpc, 'WETH');
      const basePrice = await this.fetchMidPrice(this.baseRpc, 'WETH');
      if (!Number.isFinite(arbPrice) || !Number.isFinite(basePrice)) return;

      const diffPct = ((basePrice - arbPrice) / arbPrice) * 100;
      const effectiveBps = diffPct * 100;

      if (effectiveBps <= this.minNetProfitBps) {
        console.log(`[DEX-ARB] No edge: arb=${arbPrice.toFixed(2)} base=${basePrice.toFixed(2)} edge=${effectiveBps.toFixed(2)} bps`);
        return;
      }

      const volumeUsdc = this.pickVolume(effectiveBps);
      const arbInventory = await this.inventory.getAvailable('arbitrum', 'WETH');
      const baseInventory = await this.inventory.getAvailable('base', 'USDC');

      if (arbInventory * arbPrice < volumeUsdc || baseInventory < volumeUsdc) {
        console.log('[DEX-ARB] SKIP: insufficient inventory for spatial arb');
        return;
      }

      console.log(`[DEX-ARB] EXEC edge=${effectiveBps.toFixed(2)} bps vol=${volumeUsdc} buy@arb sell@base`);
      await this.redis.xAdd('dex:arb:executions', '*', 'edgeBps', String(effectiveBps.toFixed(2)), 'volumeUsdc', String(volumeUsdc), 'arbPrice', String(arbPrice), 'basePrice', String(basePrice));

      await this.inventory.reserve('arbitrum', 'USDC', volumeUsdc);
      await this.inventory.reserve('base', 'WETH', volumeUsdc / basePrice);
      await this.swaps.executeBuy('arbitrum', 'WETH', volumeUsdc / arbPrice, 'solver-wallet');
      await this.swaps.executeSell('base', 'WETH', volumeUsdc / basePrice, 'solver-wallet');

      await this.redis.lPush('rebalance:queue', JSON.stringify({
        srcChain: 'arbitrum',
        destChain: 'base',
        token: 'WETH',
        amount: volumeUsdc / arbPrice,
      }));
    } catch (err) {
      console.error('[DEX-ARB][ERROR]', err.message);
    }
  }

  async fetchMidPrice(rpc, token) {
    // TODO: replace with real DEX mid-price fetch via RPC/indexer
    // Placeholder deterministic values for local testing
    if (rpc?.includes('arbitrum')) return 3000 + Math.random() * 2;
    if (rpc?.includes('base')) return 3000 + Math.random() * 2;
    return 3000;
  }

  pickVolume(edgeBps) {
    const maxUsdc = this.maxFillUsdc;
    const scale = Math.min(1, edgeBps / 20);
    return Number((maxUsdc * scale).toFixed(2));
  }
}

module.exports = DexArbWorker;
