const test = require('node:test');
const assert = require('node:assert/strict');
const DexQuoteAdapter = require('../src/dexQuoteAdapter');

test('quoteRoundTrip computes net profit after gas and rebalance buffer', async () => {
  process.env.ARBITRUM_WETH_ADDRESS = '0x0000000000000000000000000000000000000001';
  process.env.ARBITRUM_USDC_ADDRESS = '0x0000000000000000000000000000000000000002';
  process.env.BASE_WETH_ADDRESS = '0x0000000000000000000000000000000000000003';
  process.env.BASE_USDC_ADDRESS = '0x0000000000000000000000000000000000000004';
  process.env.DEX_GAS_SAFETY_MULTIPLIER = '1';
  process.env.DEX_REBALANCE_BUFFER_USDC = '0.50';

  const adapter = new DexQuoteAdapter({ arbRpc: 'http://arb', baseRpc: 'http://base' });
  adapter.quoteExactInput = async (chain, tokenIn, tokenOut, amountIn) => {
    if (chain === 'arbitrum') {
      return { chain, amountIn: String(amountIn), amountOut: '500000000000000', gasEstimate: '100000' };
    }
    return { chain, amountIn: String(amountIn), amountOut: '1005000000', gasEstimate: '120000' };
  };
  adapter.gasPriceWei = async (chain) => chain === 'arbitrum' ? 100000000n : 200000000n;

  const result = await adapter.quoteRoundTrip({ amountUsdc: '1000' });

  assert.equal(result.finalUsdc, '1005');
  assert.equal(result.grossDeltaUsdc, '5');
  assert.ok(result.grossBps > 49);
  assert.ok(result.gasCostUsdc > 0);
  assert.equal(result.rebalanceBufferUsdc, 0.5);
  assert.equal(result.totalCostUsdc, result.gasCostUsdc + 0.5);
  assert.equal(result.netDeltaUsdc, 5 - result.totalCostUsdc);
  assert.equal(result.netBps, (result.netDeltaUsdc / 1000) * 10000);
});

test('negative net result cannot pass an 8 bps gate', async () => {
  process.env.DEX_GAS_SAFETY_MULTIPLIER = '1';
  process.env.DEX_REBALANCE_BUFFER_USDC = '10';

  const adapter = new DexQuoteAdapter({ arbRpc: 'http://arb', baseRpc: 'http://base' });
  adapter.quoteExactInput = async (chain, tokenIn, tokenOut, amountIn) =>
    chain === 'arbitrum'
      ? { chain, amountIn: String(amountIn), amountOut: '500000000000000', gasEstimate: '100000' }
      : { chain, amountIn: String(amountIn), amountOut: '1001000000', gasEstimate: '120000' };
  adapter.gasPriceWei = async () => 100000000n;

  const result = await adapter.quoteRoundTrip({ amountUsdc: '1000' });
  assert.ok(result.netBps < 8);
});
