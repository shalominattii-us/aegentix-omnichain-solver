const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mockRedis = () => ({
  connect: async () => {},
  quit: async () => {},
  xGroupCreate: async () => {},
  xReadGroup: async () => [],
  xAdd: async () => '0-0',
  xAck: async () => {},
  xRange: async () => [],
  lRange: async () => [],
  lPop: async () => null,
  get: async () => null,
  setex: async () => {},
  set: async () => {},
  sAdd: async () => {},
  sMembers: async () => [],
});

describe('Orchestrator wiring', () => {
  it('instantiates solver + dexArb + rebalancer + watchdog', async () => {
    const OmnichainSolverEngine = require('../src/solverEngine');
    const DexArbWorker = require('../src/dexArbWorker');
    const Rebalancer = require('../src/rebalancer');
    const Watchdog = require('../src/watchdog');

    assert.ok(OmnichainSolverEngine);
    assert.ok(DexArbWorker);
    assert.ok(Rebalancer);
    assert.ok(Watchdog);

    const redis = mockRedis();

    const rebalancer = new Rebalancer({ redis, inventory: { getAvailable: async () => 0, reserve: async () => {} } });
    const watchdog = new Watchdog({ redis, rebalancer });

    const solver = new OmnichainSolverEngine({
      redis,
      inventory: { getAvailable: async () => 0, reserve: async () => {} },
      arbRpc: 'http://a',
      baseRpc: 'http://b',
      minNetProfitBps: 8,
      maxFillUsdc: 5,
    });

    const dexArb = new DexArbWorker({
      redis,
      inventory: { getAvailable: async () => 0, reserve: async () => {} },
      arbRpc: 'http://a',
      baseRpc: 'http://b',
      minNetProfitBps: 8,
      maxFillUsdc: 5,
      pollIntervalMs: 1,
    });

    solver.start();
    dexArb.start();
    rebalancer.start();
    watchdog.start();

    await solver.stop();
    await dexArb.stop();
    rebalancer.stop();
    watchdog.stop();
  });
});
