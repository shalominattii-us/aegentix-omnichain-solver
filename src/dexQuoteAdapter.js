const { Interface, parseUnits, formatUnits } = require('ethers');
const fetch = global.fetch;

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
];
const QUOTER_V2_IFACE = new Interface(QUOTER_V2_ABI);
const SLOT0_SELECTOR = '0x3850c7bd';
const TOKEN0_SELECTOR = '0x0dfe1681';
const TOKEN1_SELECTOR = '0xd21220a7';
const DEFAULT_QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';

class DexQuoteAdapter {
  constructor({
    arbRpc,
    baseRpc,
    arbPool,
    basePool,
    arbQuoter = process.env.ARBITRUM_QUOTER_V2 || DEFAULT_QUOTER_V2,
    baseQuoter = process.env.BASE_QUOTER_V2 || DEFAULT_QUOTER_V2,
    arbFee = parseInt(process.env.ARBITRUM_POOL_FEE || '500', 10),
    baseFee = parseInt(process.env.BASE_POOL_FEE || '500', 10),
    quoteTimeoutMs = 2000,
  }) {
    this.rpcs = { arbitrum: arbRpc, base: baseRpc };
    this.pools = { arbitrum: arbPool, base: basePool };
    this.quoters = { arbitrum: arbQuoter, base: baseQuoter };
    this.fees = { arbitrum: arbFee, base: baseFee };
    this.quoteTimeoutMs = quoteTimeoutMs;
    this.gasSafetyMultiplier = Number(process.env.DEX_GAS_SAFETY_MULTIPLIER || '1.25');
    this.rebalanceBufferUsdc = Number(process.env.DEX_REBALANCE_BUFFER_USDC || '0');
  }

  async ethCall(rpc, to, data, chain, method = 'eth_call', params = [{ to, data }, 'latest']) {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(this.quoteTimeoutMs),
    });
    if (!response.ok) throw new Error(`RPC ${chain} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${chain}: ${body.error.message || `${method} failed`}`);
    if (body.result === undefined || body.result === null) throw new Error(`RPC ${chain}: empty ${method} result`);
    return body.result;
  }

  async gasPriceWei(chain) {
    const rpc = this.rpcs[chain];
    if (!rpc) throw new Error(`Missing RPC for ${chain}`);
    const raw = await this.ethCall(rpc, null, null, chain, 'eth_gasPrice', []);
    return BigInt(raw);
  }

  async quoteExactInput(chain, tokenIn, tokenOut, amountIn, fee = this.fees[chain]) {
    const rpc = this.rpcs[chain];
    const quoter = this.quoters[chain];
    if (!rpc || !quoter) throw new Error(`Missing QuoterV2 configuration for ${chain}`);
    const data = QUOTER_V2_IFACE.encodeFunctionData('quoteExactInputSingle', [{
      tokenIn,
      tokenOut,
      amountIn: BigInt(amountIn),
      fee,
      sqrtPriceLimitX96: 0n,
    }]);
    const raw = await this.ethCall(rpc, quoter, data, chain);
    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] =
      QUOTER_V2_IFACE.decodeFunctionResult('quoteExactInputSingle', raw);
    return {
      chain,
      tokenIn,
      tokenOut,
      amountIn: BigInt(amountIn).toString(),
      amountOut: amountOut.toString(),
      fee,
      sqrtPriceX96After: sqrtPriceX96After.toString(),
      initializedTicksCrossed: Number(initializedTicksCrossed),
      gasEstimate: gasEstimate.toString(),
      quotedAt: Date.now(),
      source: 'uniswap-v3-quoter-v2',
    };
  }

  async quoteRoundTrip({ amountUsdc = process.env.DEX_ARB_QUOTE_USDC || '1000' } = {}) {
    const arbWeth = (process.env.ARBITRUM_WETH_ADDRESS || process.env.WETH_ADDRESS || '').toLowerCase();
    const arbUsdc = (process.env.ARBITRUM_USDC_ADDRESS || process.env.USDC_ADDRESS || '').toLowerCase();
    const baseWeth = (process.env.BASE_WETH_ADDRESS || process.env.WETH_ADDRESS || '').toLowerCase();
    const baseUsdc = (process.env.BASE_USDC_ADDRESS || process.env.USDC_ADDRESS || '').toLowerCase();
    if (!arbWeth || !arbUsdc || !baseWeth || !baseUsdc) throw new Error('Missing chain-specific WETH/USDC addresses');

    const inputUsdc = parseUnits(String(amountUsdc), 6);
    const [buy, arbGasPriceWei, baseGasPriceWei] = await Promise.all([
      this.quoteExactInput('arbitrum', arbUsdc, arbWeth, inputUsdc, this.fees.arbitrum),
      this.gasPriceWei('arbitrum'),
      this.gasPriceWei('base'),
    ]);
    const sell = await this.quoteExactInput('base', baseWeth, baseUsdc, BigInt(buy.amountOut), this.fees.base);

    const finalUsdc = BigInt(sell.amountOut);
    const grossDeltaUsdc = finalUsdc - inputUsdc;
    const grossBps = Number(grossDeltaUsdc) / Number(inputUsdc) * 10000;

    // QuoterV2 supplies a gas estimate for the quoted swap path. Apply a configurable
    // safety multiplier before converting native gas into USDC. This is still a
    // conservative estimate, not a live router eth_estimateGas result.
    const arbGas = Number(BigInt(buy.gasEstimate) * arbGasPriceWei) / 1e18;
    const baseGas = Number(BigInt(sell.gasEstimate) * baseGasPriceWei) / 1e18;
    const arbWethAmount = Number(BigInt(buy.amountOut)) / 1e18;
    const baseWethAmount = arbWethAmount;
    const arbWethUsdc = Number(inputUsdc) / 1e6 / arbWethAmount;
    const baseWethUsdc = Number(finalUsdc) / 1e6 / baseWethAmount;
    const arbGasUsdc = arbGas * arbWethUsdc * this.gasSafetyMultiplier;
    const baseGasUsdc = baseGas * baseWethUsdc * this.gasSafetyMultiplier;
    const gasCostUsdc = arbGasUsdc + baseGasUsdc;
    const totalCostUsdc = gasCostUsdc + this.rebalanceBufferUsdc;
    const netDeltaUsdc = Number(formatUnits(grossDeltaUsdc, 6)) - totalCostUsdc;
    const netBps = (netDeltaUsdc / Number(amountUsdc)) * 10000;

    return {
      amountUsdc: String(amountUsdc),
      buy,
      sell,
      finalUsdc: formatUnits(finalUsdc, 6),
      grossDeltaUsdc: formatUnits(grossDeltaUsdc, 6),
      grossBps,
      arbGasPriceWei: arbGasPriceWei.toString(),
      baseGasPriceWei: baseGasPriceWei.toString(),
      gasSafetyMultiplier: this.gasSafetyMultiplier,
      arbGasUsdc,
      baseGasUsdc,
      gasCostUsdc,
      rebalanceBufferUsdc: this.rebalanceBufferUsdc,
      totalCostUsdc,
      netDeltaUsdc,
      netBps,
      quotedAt: Date.now(),
      source: 'uniswap-v3-quoter-v2-roundtrip-net',
    };
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
    if (slot0Hex.length < 450 || token0Hex.length < 66 || token1Hex.length < 66) throw new Error(`Invalid pool state from ${chain}`);
    const sqrtPriceX96 = BigInt(`0x${slot0Hex.slice(2, 66)}`);
    const tickRaw = BigInt(`0x${slot0Hex.slice(66, 130)}`);
    const tick = Number(tickRaw >= (1n << 255n) ? tickRaw - (1n << 256n) : tickRaw);
    const token0 = `0x${token0Hex.slice(-40)}`.toLowerCase();
    const token1 = `0x${token1Hex.slice(-40)}`.toLowerCase();
    const weth = (process.env[`${chain.toUpperCase()}_WETH_ADDRESS`] || process.env.WETH_ADDRESS || '').toLowerCase();
    const usdc = (process.env[`${chain.toUpperCase()}_USDC_ADDRESS`] || process.env.USDC_ADDRESS || '').toLowerCase();
    if (!weth || !usdc) throw new Error(`Missing WETH/USDC addresses for ${chain}`);
    if (!((token0 === weth && token1 === usdc) || (token0 === usdc && token1 === weth))) throw new Error(`Configured ${chain} pool is not expected WETH/USDC`);
    const sqrt = Number(sqrtPriceX96) / 2 ** 96;
    const rawPrice = sqrt * sqrt;
    const priceToken1PerToken0 = rawPrice * 10 ** ((token0 === weth ? 18 : 6) - (token1 === weth ? 18 : 6));
    const wethUsdcPrice = token0 === weth ? priceToken1PerToken0 : 1 / priceToken1PerToken0;
    return { chain, token, pool, token0, token1, price: wethUsdcPrice, tick, sqrtPriceX96: sqrtPriceX96.toString(), quotedAt: Date.now(), source: 'uniswap-v3-slot0' };
  }
}

module.exports = DexQuoteAdapter;
