const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('ioredis');
const OmnichainSolverEngine = require('../src/solverEngine');
const InventoryTracker = require('../src/inventoryTracker');

describe('OmnichainSolverEngine', () => {
  let engine;
  let inventory;
  let redis;

  before(async () => {
    const client = createClient('redis://127.0.0.1:6379');
    try {
      await client.connect();
      await client.ping();
      redis = client;
    } catch (err) {
      await client.disconnect();
      console.log('[TEST] Skipping Redis-dependent tests: Redis not reachable at redis://127.0.0.1:6379');
      process.exit(0);
    }
    inventory = new InventoryTracker(redis);
    await inventory.setSnapshot('arbitrum', 'USDC', '100000');
    await inventory.setSnapshot('base', 'USDC', '100000');
    engine = new OmnichainSolverEngine({
      redis,
      inventory,
      arbRpc: 'http://localhost:8545',
      baseRpc: 'http://localhost:8545',
      minNetProfitBps: 8,
      maxFillUsdc: 50000,
    });
  });

  after(async () => {
    await redis?.quit();
  });

  it('rejects malformed intent', async () => {
    assert.equal(await engine.evaluateIntent({}), false);
  });

  it('fills when inventory suffices and yield clears threshold', async () => {
    const result = await engine.evaluateIntent({
      intentId: 'test-1',
      sourceChain: 'arbitrum',
      destChain: 'base',
      amountUsdc: '1000',
      offeredFeeBps: '25',
      recipient: '0xrecipient',
    });
    assert.equal(result, true);
    assert.equal(await inventory.getAvailable('base', 'USDC'), 99000);
  });

  it('skips when offered fee is too low after rebalance cost', async () => {
    assert.equal(await engine.evaluateIntent({
      intentId: 'test-2',
      sourceChain: 'arbitrum',
      destChain: 'base',
      amountUsdc: '1000',
      offeredFeeBps: '5',
      recipient: '0xrecipient',
    }), false);
  });
});
