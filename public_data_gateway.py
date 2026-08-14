"""AEGENTIX public DEX / chain market-data gateway.

Read-only by design. No exchange API keys and no private keys are required.
The gateway normalizes public market/ledger sources behind one FastAPI surface.
It never signs or submits transactions.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

APP_NAME = "AEGENTIX Public DEX Gateway"
VERSION = "0.1.0"
TIMEOUT = float(os.getenv("PUBLIC_DATA_TIMEOUT_SECONDS", "8"))
CACHE_TTL = float(os.getenv("PUBLIC_DATA_CACHE_TTL_SECONDS", "2"))

DEXSCREENER = "https://api.dexscreener.com"
GECKO = "https://api.geckoterminal.com/api/v2"
XRPL = os.getenv("XRPL_RPC_URL", "https://xrplcluster.com/")

app = FastAPI(title=APP_NAME, version=VERSION)
_cache: dict[str, tuple[float, Any]] = {}
_lock = asyncio.Lock()


async def get_json(url: str, *, params: dict[str, Any] | None = None) -> Any:
    key = url + "?" + str(sorted((params or {}).items()))
    now = time.monotonic()
    async with _lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < CACHE_TTL:
            return cached[1]
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": "AEGENTIX-PublicDEXGateway/0.1"}) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    async with _lock:
        _cache[key] = (time.monotonic(), data)
    return data


async def post_json(url: str, payload: dict[str, Any]) -> Any:
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": "AEGENTIX-PublicDEXGateway/0.1"}) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "online", "mode": "READ_ONLY", "version": VERSION, "timestamp": time.time()}


@app.get("/sources")
async def sources() -> dict[str, Any]:
    return {
        "dex": ["dexscreener", "geckoterminal"],
        "chains": ["xrpl"],
        "credentials_required": False,
        "execution": "disabled",
        "notes": "Public data sources are rate-limited; use multiple sources and freshness checks before trading decisions.",
    }


@app.get("/dex/search")
async def dex_search(q: str = Query(min_length=1, max_length=120)) -> Any:
    try:
        return await get_json(f"{DEXSCREENER}/latest/dex/search", params={"q": q})
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"DEX Screener unavailable: {exc}") from exc


@app.get("/dex/pairs/{chain_id}/{pair_id}")
async def dex_pair(chain_id: str, pair_id: str) -> Any:
    try:
        return await get_json(f"{DEXSCREENER}/latest/dex/pairs/{chain_id}/{pair_id}")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"DEX Screener unavailable: {exc}") from exc


@app.get("/dex/token-pairs/{chain_id}/{token_address}")
async def dex_token_pairs(chain_id: str, token_address: str) -> Any:
    try:
        return await get_json(f"{DEXSCREENER}/token-pairs/v1/{chain_id}/{token_address}")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"DEX Screener unavailable: {exc}") from exc


@app.get("/dex/tokens/{chain_id}/{token_addresses}")
async def dex_tokens(chain_id: str, token_addresses: str) -> Any:
    try:
        return await get_json(f"{DEXSCREENER}/tokens/v1/{chain_id}/{token_addresses}")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"DEX Screener unavailable: {exc}") from exc


@app.get("/gecko/networks/{network}/tokens/{token_address}")
async def gecko_token(network: str, token_address: str) -> Any:
    try:
        return await get_json(f"{GECKO}/networks/{network}/tokens/{token_address}")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"GeckoTerminal unavailable: {exc}") from exc


@app.get("/gecko/networks/{network}/tokens/{token_address}/pools")
async def gecko_token_pools(network: str, token_address: str) -> Any:
    try:
        return await get_json(f"{GECKO}/networks/{network}/tokens/{token_address}/pools")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"GeckoTerminal unavailable: {exc}") from exc


@app.post("/xrpl/rpc")
async def xrpl_rpc(payload: dict[str, Any]) -> Any:
    """Proxy read-only XRPL JSON-RPC methods to a public XRPL server."""
    method = payload.get("method")
    allowed = {
        "server_info", "ledger", "ledger_closed", "account_info", "account_lines",
        "account_offers", "book_offers", "amm_info", "tx", "submit",
    }
    # submit is deliberately blocked here: this service is market-data only.
    if method == "submit" or method not in allowed:
        raise HTTPException(403, "XRPL execution/signing is disabled in the public data gateway")
    try:
        return await post_json(XRPL, payload)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"XRPL public server unavailable: {exc}") from exc


@app.get("/aggregate/search")
async def aggregate_search(q: str = Query(min_length=1, max_length=120)) -> dict[str, Any]:
    """Fan out a discovery query to independent public market-data sources."""
    dex_task = asyncio.create_task(dex_search(q))
    # GeckoTerminal is address/network-oriented; its discovery endpoint varies by deployment,
    # so DEX Screener remains the primary symbol/search source here.
    try:
        dex = await dex_task
    except Exception as exc:
        dex = {"error": str(exc)}
    return {"query": q, "sources": {"dexscreener": dex}, "timestamp": time.time()}
