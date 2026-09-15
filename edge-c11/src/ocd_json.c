#include "ocd/ocd.h"
#include <stdio.h>
#include <string.h>

static size_t done(int n,size_t cap){return n<0?0:(size_t)n>=cap?cap-1:(size_t)n;}
size_t ocd_price_to_json(const ocd_price_quote*q,char*b,size_t c){if(!q||!b||!c)return 0;int n=snprintf(b,c,"{\"chain\":\"%s\",\"symbol\":\"%s\",\"priceUsd\":%.8f,\"change24hPct\":%.4f,\"volume24hUsd\":%.2f,\"liquidityUsd\":%.2f,\"observedAtMs\":%llu,\"stale\":%s}",q->asset.chain,q->asset.symbol,q->price_usd,q->change_24h_pct,q->volume_24h_usd,q->liquidity_usd,(unsigned long long)q->observed_at_ms,q->stale?"true":"false");return done(n,c);}
size_t ocd_wallet_to_json(const ocd_wallet_snapshot*w,char*b,size_t c){if(!w||!b||!c)return 0;int n=snprintf(b,c,"{\"chain\":\"%s\",\"address\":\"%s\",\"portfolioUsd\":%.2f,\"assetCount\":%u,\"risk\":\"%s\",\"observedAtMs\":%llu}",w->chain,w->address,w->portfolio_usd,w->asset_count,ocd_risk_string(w->risk),(unsigned long long)w->observed_at_ms);return done(n,c);}
size_t ocd_signal_to_json(const ocd_trade_signal*s,char*b,size_t c){if(!s||!b||!c)return 0;int n=snprintf(b,c,"{\"chain\":\"%s\",\"symbol\":\"%s\",\"timeframe\":\"%s\",\"signal\":\"%s\",\"confidence\":%u,\"entryLow\":%.8f,\"entryHigh\":%.8f,\"target1\":%.8f,\"target2\":%.8f,\"invalidation\":%.8f,\"risk\":\"%s\",\"reason\":\"%s\",\"generatedAtMs\":%llu}",s->asset.chain,s->asset.symbol,s->timeframe,ocd_signal_string(s->side),s->confidence,s->entry_low,s->entry_high,s->target_1,s->target_2,s->invalidation,ocd_risk_string(s->risk),s->reason_count?s->reasons[0]:"",(unsigned long long)s->generated_at_ms);return done(n,c);}
size_t ocd_error_to_json(ocd_status s,const char*m,char*b,size_t c){if(!b||!c)return 0;int n=snprintf(b,c,"{\"error\":\"%s\",\"message\":\"%s\"}",ocd_status_string(s),m?m:"");return done(n,c);}
