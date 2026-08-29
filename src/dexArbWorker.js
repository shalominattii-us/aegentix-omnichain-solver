class DexArbWorker {
  constructor({ redis, inventory, arbRpc, baseRpc, minNetProfitBps = 8, maxFillUsdc = 50000, quoteAdapter }) {
    this.redis = redis;
    this.inventory = inventory;
    this.arbRpc = arbRpc;
    this.baseRpc = baseRpc;
    this.minNetProfitBps = minNetProfitBps;
    this.maxFillUsdc = maxFillUsdc;
    this.pollIntervalMs = parseInt(process.env.DEX_ARB_POLL_MS || '2000', 10);
    this.timer = null;
    this.running = false;
    this.quoteAdapter = quoteAdapter;
    this.swaps = new (require('./swapExecutor'))({ redis, inventory, arbRpc, baseRpc });
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log('[DEX-ARB] Starting real DEX quote worker (execution remains paper)');
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
      const [arbQuote, baseQuote] = await Promise.all([
        this.quoteAdapter.quote('arbitrum', 'WETH'),
        this.quoteAdapter.quote('base', 'WETH'),
      ]);
      const arbPrice = arbQuote.price;
      const basePrice = baseQuote.price;
      if (!Number.isFinite(arbPrice) || !Number.isFinite(basePrice) || arbPrice <= 0 || basePrice <= 0) return;

      const diffPct = ((basePrice - arbPrice) / arbPrice) * 100;
      const effectiveBps = diffPct * 100;

      if (effectiveBps <= this.minNetProfitBps) {
        console.log(`[DEX-ARB] No edge: arb=${arbPrice.toFixed(4)} base=${basePrice.toFixed(4)} edge=${effectiveBps.toFixed(2)} bps`);
        return;
      }

      const volumeUsdc = this.pickVolume(effectiveBps);
      const arbInventory = await this.inventory.getAvailable('arbitrum', 'WETH');
      const baseInventory = await this.inventory.getAvailable('base', 'USDC');
      if (arbInventory * arbPrice < volumeUsdc || baseInventory < volumeUsdc) {
        console.log('[DEX-ARB] SKIP: insufficient inventory for spatial arb');
        return;
      }

      console.log(`[DEX-ARB] PAPER EXEC edge=${effectiveBps.toFixed(2)} bps vol=${volumeUsdc} buy@arbitrum sell@base`);
      await this.redis.xAdd('dex:arb:executions', '*',
        'mode', 'paper', 'edgeBps', String(effectiveBps.toFixed(2)),
        'volumeUsdc', String(volumeUsdc), 'arbPrice', String(arbPrice), 'basePrice', String(basePrice),
        'arbBlockTimestampLast', String(arbQuote.blockTimestampLast), 'baseBlockTimestampLast', String(baseQuote.blockTimestampLast));

      await this.inventory.reserve('arbitrum', 'USDC', volumeUsdc);
      await this.inventory.reserve('base', 'WETH', volumeUsdc / basePrice);
      await this.swaps.executeBuy('arbitrum', 'WETH', volumeUsdc / arbPrice, 'solver-wallet');
      await this.swaps.executeSell('base', 'WETH', volumeUsdc / basePrice, 'solver-wallet');

      await this.redis.lPush('rebalance:queue', JSON.stringify({ srcChain: 'arbitrum', destChain: 'base', token: 'WETH', amount: volumeUsdc / arbPrice }));
    } catch (err) {
      console.error('[DEX-ARB][ERROR]', err.message);
    }
  }

  pickVolume(edgeBps) {
    const maxUsdc = this.maxFillUsdc;
    const scale = Math.min(1, edgeBps / 20);
    return Number((maxUsdc * scale).toFixed(2));
  }
}

module.exports = DexArbWorker;
