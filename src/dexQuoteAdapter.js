const fetch = global.fetch;

const SLOT0_SELECTOR = '0x3850c7bd';
const TOKEN0_SELECTOR = '0x0dfe1681';
const TOKEN1_SELECTOR = '0xd21220a7';

class DexQuoteAdapter {
  constructor({ arbRpc, baseRpc, arbPool, basePool, quoteTimeoutMs = 1500 }) {
    this.rpcs = { arbitrum: arbRpc, base: baseRpc };
    this.pools = { arbitrum: arbPool, base: basePool };
    this.quoteTimeoutMs = quoteTimeoutMs;
  }

  async ethCall(rpc, to, data, chain) {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: AbortSignal.timeout(this.quoteTimeoutMs),
    });
    if (!response.ok) throw new Error(`RPC ${chain} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${chain}: ${body.error.message || 'eth_call failed'}`);
    if (!body.result) throw new Error(`RPC ${chain}: empty eth_call result`);
    return body.result;
  }

  async quote(chain, token = 'WETH') {
    const rpc = this.rpcs[chain];
    const pool = this.pools[chain];
    if (!rpc || !pool) throw new Error(`Missing real Uniswap V3 configuration for ${chain}`);

    const [slot0Hex, token0Hex, token1Hex] = await Promise.all([
      this.ethCall(rpc, pool, SLOT0_SELECTOR, chain),
      this.ethCall(rpc, pool, TOKEN0_SELECTOR, chain),
      this.ethCall(rpc, pool, TOKEN1_SELECTOR, chain),
    ]);

    if (slot0Hex.length < 450) throw new Error(`Invalid slot0 result from ${chain}`);
    if (token0Hex.length < 66 || token1Hex.length < 66) throw new Error(`Invalid token metadata from ${chain}`);

    const sqrtPriceX96 = BigInt(`0x${slot0Hex.slice(2, 66)}`);
    const tickRaw = BigInt(`0x${slot0Hex.slice(66, 130)}`);
    const tick = Number(tickRaw >= (1n << 255n) ? tickRaw - (1n << 256n) : tickRaw);
    const token0 = `0x${token0Hex.slice(-40)}`.toLowerCase();
    const token1 = `0x${token1Hex.slice(-40)}`.toLowerCase();
    const weth = (process.env[`${chain.toUpperCase()}_WETH_ADDRESS`] || process.env.WETH_ADDRESS || '').toLowerCase();
    const usdc = (process.env[`${chain.toUpperCase()}_USDC_ADDRESS`] || process.env.USDC_ADDRESS || '').toLowerCase();

    if (!weth || !usdc) throw new Error(`Missing WETH/USDC addresses for ${chain}`);
    if (!((token0 === weth && token1 === usdc) || (token0 === usdc && token1 === weth))) {
      throw new Error(`Configured ${chain} pool is not the expected WETH/USDC pair`);
    }

    const sqrt = Number(sqrtPriceX96) / 2 ** 96;
    const rawPrice = sqrt * sqrt;
    const priceToken1PerToken0 = rawPrice * 10 ** ((token0 === weth ? 18 : 6) - (token1 === weth ? 18 : 6));
    const wethUsdcPrice = token0 === weth ? priceToken1PerToken0 : 1 / priceToken1PerToken0;

    return {
      chain,
      token,
      pool,
      token0,
      token1,
      price: wethUsdcPrice,
      tick,
      sqrtPriceX96: sqrtPriceX96.toString(),
      quotedAt: Date.now(),
      source: 'uniswap-v3-slot0',
    };
  }
}

module.exports = DexQuoteAdapter;
