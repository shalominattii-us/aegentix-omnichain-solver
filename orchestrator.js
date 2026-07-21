require('dotenv').config();
const { createClient } = require('ioredis');
const OmnichainSolverEngine = require('./src/solverEngine');
const DexArbWorker = require('./src/dexArbWorker');
const Rebalancer = require('./src/rebalancer');
const Watchdog = require('./src/watchdog');
const InventoryTracker = require('./src/inventoryTracker');

class AegentixOmnichainOrchestrator {
  constructor() {
    this.started = false;
    this.redis = null;
  }

  async boot() {
    this.redis = createClient(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    await this.redis.connect();
    console.log('[BOOT] Redis connected');

    this.inventory = new InventoryTracker(this.redis);
    this.rebalancer = new Rebalancer({ redis: this.redis, inventory: this.inventory });
    this.watchdog = new Watchdog({ redis: this.redis, rebalancer: this.rebalancer });

    const shared = {
      redis: this.redis,
      inventory: this.inventory,
      arbRpc: process.env.ARBITRUM_RPC,
      baseRpc: process.env.BASE_RPC,
      minNetProfitBps: parseInt(process.env.MIN_NET_PROFIT_BPS || '8', 10),
      maxFillUsdc: parseInt(process.env.MAX_FILL_USDC || '50000', 10),
    };

    this.solver = new OmnichainSolverEngine(shared);
    this.dexArb = new DexArbWorker(shared);

    this.rebalancer.start();
    this.watchdog.start();

    await this.solver.start();
    await this.dexArb.start();

    this.started = true;
    console.log('[BOOT] Orchestrator up: AegentixOmnichainEngine + DexArbWorker running');
  }

  async shutdown() {
    console.log('[SHUTDOWN] Stopping workers...');
    await this.solver?.stop();
    await this.dexArb?.stop();
    this.rebalancer?.stop();
    this.watchdog?.stop();
    await this.redis?.quit();
  }
}

(async () => {
  const orchestrator = new AegentixOmnichainOrchestrator();
  process.on('SIGINT', async () => {
    await orchestrator.shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await orchestrator.shutdown();
    process.exit(0);
  });
  await orchestrator.boot();
})();
