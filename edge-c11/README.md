# OmniCyberDex Edge — Corporate C11 Foundation

A dependency-light, edge-native blockchain market and wallet intelligence service written in C11.

## Current capabilities

- Cross-platform C11 core (Linux/Windows socket layer)
- Universal chain-adapter interface
- Price, wallet, and explainable signal domain models
- Defensive input validation and bounded buffers
- Read-only HTTP endpoints
- Offline deterministic mock adapter for testing and disconnected edge nodes
- CMake, unit tests, and a non-root multi-stage Docker image

## Build

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
./build/omnicyberdex-edge 8080
```

## Endpoints

```text
GET /health
GET /v1/price?chain=ethereum&symbol=ETH
GET /v1/wallet?address=0x1234567890abcdef
GET /v1/signal?chain=solana&symbol=SOL
```

## Corporate/edge guarantees in this scaffold

- No custody, private keys, seed phrases, withdrawals, or autonomous order placement
- Fail-closed signal generation on stale or low-liquidity data
- Fixed-size public structures and bounded request parsing
- Explicit adapter boundary for EVM, Bitcoin, Solana, Hedera, Cosmos, Sui, and Aptos providers
- Read-only default suitable for OpenClaw, Nemotron, AG/Antigravity, and degraded noncritical Manus nodes

## Production integrations still required

The included adapter is deterministic test data. Production use requires audited provider adapters, TLS termination, authentication, persistent cache, rate limiting, observability, signed configuration, and independent security review.
