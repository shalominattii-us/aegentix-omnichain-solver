class DexArbWorker {
  constructor({ redis, inventory, arbRpc, baseRpc, minNetProfitBps = 8, maxFillUsdc = 50000, quoteAdapter }) {
    this.redis = redis;
    this.inventory = inventory;
    this.arbRpc = arbRpc;
    this.baseRpc = baseRpc;
    this.minNetProfitBps = minNetProfitBps;
    this.maxFillUsdc = maxFillUsdc;
    this.pollIntervalMs = parseInt(process.env.DEX_ARB_POLL_MS || '2000', 10);
    this.quoteUsdc = process.env.DEX_ARB_QUOTE_USDC || '1000';
    this.timer = null;
    this.running = false;
    this.quoteAdapter = quoteAdapter;
    this.swaps = new (require('./swapExecutor'))({ redis, inventory, arbRpc, baseRpc });
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log(`[DEX-ARB] Starting exact DEX quote worker (paper execution, quote size=${this.quoteUsdc} USDC)`);
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
      const roundTrip = await this.quoteAdapter.quoteRoundTrip({ amountUsdc: this.quoteUsdc });
      const grossBps = roundTrip.grossBps;
      const volumeUsdc = Math.min(Number(this.quoteUsdc), this.maxFillUsdc);

      console.log(`[DEX-ARB] EXACT quote in=${roundTrip.amountUsdc} out=${roundTrip.finalUsdc} gross=${grossBps.toFixed(2)} bps delta=${roundTrip.grossDeltaUsdc} USDC`);

      await this.redis.xAdd('dex:arb:quotes', '*',
        'mode', 'paper',
        'source', roundTrip.source,
        'amountUsdc', roundTrip.amountUsdc,
        'finalUsdc', roundTrip.finalUsdc,
        'grossDeltaUsdc', roundTrip.grossDeltaUsdc,
        'grossBps', String(grossBps),
        'arbAmountOutWeth', roundTrip.buy.amountOut,
        'arbGasEstimate', roundTrip.buy.gasEstimate,
        'baseGasEstimate', roundTrip.sell.gasEstimate,
        'quotedAt', String(roundTrip.quotedAt));

      if (grossBps <= this.minNetProfitBps) return;

      const arbUsdc = await this.inventory.getAvailable('arbitrum', 'USDC');
      const baseWeth = await this.inventory.getAvailable('base', 'WETH');
      const wethNeeded = Number(roundTrip.buy.amountOut) / 1e18;
      if (arbUsdc < volumeUsdc || baseWeth < wethNeeded) {
        console.log('[DEX-ARB] OPPORTUNITY BLOCKED: insufficient inventory for quoted route');
        return;
      }

      console.log(`[DEX-ARB] PAPER EXEC edge=${grossBps.toFixed(2)} bps vol=${volumeUsdc} USDC buy@arbitrum sell@base`);
      await this.redis.xAdd('dex:arb:executions', '*',
        'mode', 'paper',
        'edgeBps', String(grossBps),
        'volumeUsdc', String(volumeUsdc),
        'arbAmountOutWeth', roundTrip.buy.amountOut,
        'baseAmountOutUsdc', roundTrip.sell.amountOut,
        'arbGasEstimate', roundTrip.buy.gasEstimate,
        'baseGasEstimate', roundTrip.sell.gasEstimate);

      await this.inventory.reserve('arbitrum', 'USDC', volumeUsdc);
      await this.inventory.reserve('base', 'WETH', wethNeeded);
      await this.swaps.executeBuy('arbitrum', 'WETH', wethNeeded, 'solver-wallet');
      await this.swaps.executeSell('base', 'WETH', wethNeeded, 'solver-wallet');

      await this.redis.lPush('rebalance:queue', JSON.stringify({
        srcChain: 'arbitrum',
        destChain: 'base',
        token: 'WETH',
        amount: wethNeeded,
        reason: 'dex-arb-exact-quote',
      }));
    } catch (err) {
      console.error('[DEX-ARB][ERROR]', err.message);
    }
  }
}

module.exports = DexArbWorker;
