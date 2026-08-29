const fetch = global.fetch;

class DexQuoteAdapter {
  constructor({ arbRpc, baseRpc, arbPair, basePair, quoteTimeoutMs = 1500 }) {
    this.rpcs = { arbitrum: arbRpc, base: baseRpc };
    this.pairs = { arbitrum: arbPair, base: basePair };
    this.quoteTimeoutMs = quoteTimeoutMs;
  }

  async quote(chain, token = 'WETH') {
    const rpc = this.rpcs[chain];
    const pair = this.pairs[chain];
    if (!rpc || !pair) throw new Error(`Missing real DEX quote configuration for ${chain}`);
    const response = await fetch(rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: pair, data: '0x0902f1ac' }, 'latest'] }),
      signal: AbortSignal.timeout(this.quoteTimeoutMs),
    });
    if (!response.ok) throw new Error(`RPC ${chain} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${chain}: ${body.error.message || 'eth_call failed'}`);
    const hex = body.result;
    if (!hex || hex.length < 194) throw new Error(`Invalid getReserves result from ${chain}`);
    const reserve0 = BigInt(`0x${hex.slice(2, 66)}`);
    const reserve1 = BigInt(`0x${hex.slice(66, 130)}`);
    const blockTimestampLast = Number(BigInt(`0x${hex.slice(130, 194)}`));
    const token0 = (process.env[`${chain.toUpperCase()}_PAIR_TOKEN0`] || '').toLowerCase();
    const token1 = (process.env[`${chain.toUpperCase()}_PAIR_TOKEN1`] || '').toLowerCase();
    const weth = (process.env.WETH_ADDRESS || '').toLowerCase();
    const usdc = (process.env.USDC_ADDRESS || '').toLowerCase();
    if (!weth || !usdc || !token0 || !token1) throw new Error(`Missing token ordering configuration for ${chain}`);
    let wethReserve, usdcReserve;
    if (token0 === weth && token1 === usdc) { wethReserve = reserve0; usdcReserve = reserve1; }
    else if (token0 === usdc && token1 === weth) { wethReserve = reserve1; usdcReserve = reserve0; }
    else throw new Error(`Configured pair on ${chain} is not WETH/USDC`);
    const decimalsWeth = Number(process.env.WETH_DECIMALS || 18);
    const decimalsUsdc = Number(process.env.USDC_DECIMALS || 6);
    const price = (Number(usdcReserve) / 10 ** decimalsUsdc) / (Number(wethReserve) / 10 ** decimalsWeth);
    return { chain, token, price, blockTimestampLast };
  }
}

module.exports = DexQuoteAdapter;
