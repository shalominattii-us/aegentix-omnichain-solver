const fetch = global.fetch;

const SLOT0_SELECTOR = '0x3850c7bd';

class DexQuoteAdapter {
  constructor({ arbRpc, baseRpc, arbPool, basePool, quoteTimeoutMs = 1500 }) {
    this.rpcs = { arbitrum: arbRpc, base: baseRpc };
    this.pools = { arbitrum: arbPool, base: basePool };
    this.quoteTimeoutMs = quoteTimeoutMs;
  }

  async quote(chain, token = 'WETH') {
    const rpc = this.rpcs[chain];
    const pool = this.pools[chain];
    if (!rpc || !pool) throw new Error(`Missing real Uniswap V3 configuration for ${chain}`);

    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: pool, data: SLOT0_SELECTOR }, 'latest'],
      }),
      signal: AbortSignal.timeout(this.quoteTimeoutMs),
    });

    if (!response.ok) throw new Error(`RPC ${chain} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${chain}: ${body.error.message || 'slot0 eth_call failed'}`);

    const hex = body.result;
    if (!hex || hex.length < 450) throw new Error(`Invalid slot0 result from ${chain}`);

    // slot0(): sqrtPriceX96, tick, observationIndex, observationCardinality,
    // observationCardinalityNext, feeProtocol, unlocked.
    const sqrtPriceX96 = BigInt(`0x${hex.slice(2, 66)}`);
    const tickRaw = BigInt(`0x${hex.slice(66, 130)}`);
    const tick = Number(tickRaw >= (1n << 255n) ? tickRaw - (1n << 256n) : tickRaw);

    const prefix = chain.toUpperCase();
    const token0 = (process.env[`${prefix}_POOL_TOKEN0`] || '').toLowerCase();
    const token1 = (process.env[`${prefix}_POOL_TOKEN1`] || '').toLowerCase();
    const weth = (process.env.WETH_ADDRESS || '').toLowerCase();
    const usdc = (process.env.USDC_ADDRESS || '').toLowerCase();

    if (!token0 || !token1 || !weth || !usdc) {
      throw new Error(`Missing WETH/USDC pool token ordering for ${chain}`);
    }

    const decimals0 = token0 === weth ? 18 : token0 === usdc ? 6 : null;
    const decimals1 = token1 === weth ? 18 : token1 === usdc ? 6 : null;
    if (decimals0 === null || decimals1 === null || token0 === token1) {
      throw new Error(`Configured ${chain} pool is not WETH/USDC`);
    }

    // Uniswap V3 price = (sqrtPriceX96 / 2^96)^2, then adjust token decimals.
    // BigInt keeps the on-chain sqrt price exact until the final human-readable conversion.
    const sqrt = Number(sqrtPriceX96) / 2 ** 96;
    const rawPrice1Per0 = sqrt * sqrt;
    const priceToken1PerToken0 = rawPrice1Per0 * 10 ** (decimals0 - decimals1);
    const wethPerUsdc = token0 === weth ? 1 / priceToken1PerToken0 : priceToken1PerToken0;
    const wethUsdcPrice = token0 === weth ? priceToken1PerToken0 : 1 / priceToken1PerToken0;

    return {
      chain,
      token,
      pool,
      price: wethUsdcPrice,
      tick,
      sqrtPriceX96: sqrtPriceX96.toString(),
      quotedAt: Date.now(),
      priceDirection: token0 === weth ? 'WETH->USDC' : 'USDC->WETH',
      wethPerUsdc,
    };
  }
}

module.exports = DexQuoteAdapter;
