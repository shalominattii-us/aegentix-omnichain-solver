require('dotenv').config();
const { createClient } = require('ioredis');
const OmnichainSolverEngine = require('./solverEngine');
const Rebalancer = require('./rebalancer');
const Watchdog = require('./watchdog');
const InventoryTracker = require('./inventoryTracker');

const redis = createClient(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

async function main() {
  await redis.connect();
  console.log('[BOOT] Redis connected');

  const inventory = new InventoryTracker(redis);
  const solver = new OmnichainSolverEngine({
    redis,
    inventory,
    arbRpc: process.env.ARBITRUM_RPC,
    baseRpc: process.env.BASE_RPC,
    minNetProfitBps: parseInt(process.env.MIN_NET_PROFIT_BPS || '8', 10),
    maxFillUsdc: parseInt(process.env.MAX_FILL_USDC || '50000', 10),
  });

  const rebalancer = new Rebalancer({ redis, inventory });
  const watchdog = new Watchdog({ redis, solver, rebalancer });

  // Start rebalance loop
  rebalancer.start();

  // Start settlement watchdog
  watchdog.start();

  // Consume intent mempool stream
  console.log('[BOOT] Subscribing to intent mempool');
  await redis.xGroupCreate(
    process.env.INTENT_MEMPOOL_REDIS_STREAM || 'intent:incoming',
    'solver-group',
    '0',
    true
  );

  while (true) {
    try {
      const messages = await redis.xReadGroup(
        'solver-group',
        'worker-1',
        [{ key: process.env.INTENT_MEMPOOL_REDIS_STREAM || 'intent:incoming', id: '>' }],
        { COUNT: 10, BLOCK: 5000 }
      );

      if (!messages || messages.length === 0) continue;

      for (const msg of messages) {
        const id = msg.id;
        const fields = msg.message;
        const payload = JSON.parse(fields.payload || fields.intent || '{}');

        console.log(`[INTENT] Received ${id}:`, fields.intentId || payload.intentId);

        const executed = await solver.evaluateIntent(payload);

        if (executed) {
          await redis.xAck(
            process.env.INTENT_MEMPOOL_REDIS_STREAM || 'intent:incoming',
            'solver-group',
            id
          );
        } else {
          // Failed intents go to failed stream
          await redis.xAdd(
            process.env.FAILED_STREAM || 'intent:failed',
            '*',
            'intentId',
            payload.intentId || id,
            'reason',
            fields.reason || 'insufficient_inventory_or_yield'
          );
          await redis.xAck(
            process.env.INTENT_MEMPOOL_REDIS_STREAM || 'intent:incoming',
            'solver-group',
            id
          );
        }
      }
    } catch (err) {
      console.error('[LOOP][ERROR]', err.message);
    }
  }
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
