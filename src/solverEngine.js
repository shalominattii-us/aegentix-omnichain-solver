class OmnichainSolverEngine {
  constructor({ redis, inventory, arbRpc, baseRpc, minNetProfitBps = 8, maxFillUsdc = 50000 }) {
    this.redis = redis;
    this.inventory = inventory;
    this.arbRpc = arbRpc;
    this.baseRpc = baseRpc;
    this.minNetProfitBps = minNetProfitBps;
    this.maxFillUsdc = maxFillUsdc;
    this.running = false;
  }

  start() {
    this.running = true;
    console.log('[SOLVER] Starting intent solver consumer');
    this.consume();
  }

  stop() {
    this.running = false;
  }

  async consume() {
    const stream = process.env.INTENT_MEMPOOL_REDIS_STREAM || 'intent:incoming';
    const group = 'solver-group';
    const consumer = 'worker-1';
    await this.redis.xGroupCreate(stream, group, '0', true);

    while (this.running) {
      try {
        const messages = await this.redis.xReadGroup(
          group,
          consumer,
          [{ key: stream, id: '>' }],
          { COUNT: 10, BLOCK: 5000 }
        );

        if (!messages || messages.length === 0) continue;

        for (const msg of messages) {
          const id = msg.id;
          const fields = msg.message;
          const raw = fields.payload || fields.intent || '{}';
          const payload = JSON.parse(raw);

          console.log(`[INTENT] Received ${id}:`, fields.intentId || payload.intentId);
          const executed = await this.evaluateIntent(payload);

          if (executed) {
            await this.redis.xAck(stream, group, id);
          } else {
            await this.redis.xAdd(process.env.FAILED_STREAM || 'intent:failed', '*', 'intentId', payload.intentId || id, 'reason', fields.reason || 'insufficient_inventory_or_yield');
            await this.redis.xAck(stream, group, id);
          }
        }
      } catch (err) {
        console.error('[SOLVER][ERROR]', err.message);
      }
    }
  }

  async checkInventory(chain) {
    return this.inventory.getAvailable(chain, 'USDC');
  }

  async quoteStargateFee(srcChain, destChain) {
    const cacheKey = `rebalance:quote:${srcChain}->${destChain}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);
    const estimatedBps = 6;
    await this.redis.setex(cacheKey, 30, String(estimatedBps));
    return estimatedBps;
  }

  async evaluateIntent({ intentId, sourceChain, destChain, amountUsdc, offeredFeeBps, recipient, token = 'USDC' }) {
    if (!intentId || !sourceChain || !destChain || !amountUsdc || !recipient) {
      console.log(`[SKIP] Intent ${intentId || '?'}: malformed payload`);
      return false;
    }

    const amount = Number(amountUsdc);
    if (!Number.isFinite(amount) || amount <= 0 || amount > this.maxFillUsdc) {
      console.log(`[SKIP] Intent ${intentId}: invalid amount`);
      return false;
    }

    const destInventory = await this.checkInventory(destChain);
    if (destInventory < amount) {
      console.log(`[SKIP] Intent ${intentId}: insufficient inventory on ${destChain} (${destInventory} < ${amount})`);
      await this.redis.xAdd(process.env.PENDING_SETTLEMENT_STREAM || 'intent:pending', '*', 'id', intentId, 'status', 'skipped_inventory', 'destChain', destChain, 'needed', String(amount), 'available', String(destInventory));
      return false;
    }

    const estimatedRebalanceCostBps = await this.quoteStargateFee(destChain, sourceChain);
    const netYieldBps = Number(offeredFeeBps) - estimatedRebalanceCostBps;

    if (netYieldBps < this.minNetProfitBps) {
      console.log(`[SKIP] Intent ${intentId}: net yield ${netYieldBps} bps below threshold ${this.minNetProfitBps}`);
      return false;
    }

    console.log(`[EXEC] Locking Intent ${intentId} | Expected Net Yield: ${netYieldBps} bps`);
    const executed = await this.executeSolverFill({ intentId, destChain, amountUsdc: String(amount), recipient, token });
    if (executed) await this.inventory.reserve(destChain, token, amount);
    return executed;
  }

  async executeSolverFill({ intentId, destChain, amountUsdc, recipient, token }) {
    try {
      console.log(`[TX] Would fill ${amountUsdc} ${token} on ${destChain} -> ${recipient}`);
      await this.redis.xAdd(process.env.PENDING_SETTLEMENT_STREAM || 'intent:pending', '*', 'id', intentId, 'status', 'awaiting_settlement', 'destChain', destChain, 'amount', amountUsdc, 'token', token, 'recipient', recipient, 'queuedAt', String(Date.now()));
      return true;
    } catch (error) {
      console.error(`[ERROR] Failed to fill intent ${intentId}:`, error.message);
      await this.redis.xAdd(process.env.FAILED_STREAM || 'intent:failed', '*', 'intentId', intentId, 'error', error.message);
      return false;
    }
  }
}

module.exports = OmnichainSolverEngine;
