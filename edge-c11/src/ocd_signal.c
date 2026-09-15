#include "ocd/ocd.h"
#include <stdio.h>
#include <string.h>

ocd_status ocd_generate_signal(const ocd_price_quote *q, ocd_trade_signal *o) {
    if (!q || !o || !ocd_validate_asset(&q->asset) || q->price_usd <= 0.0) return OCD_ERR_INVALID;
    memset(o,0,sizeof *o); o->asset=q->asset; snprintf(o->timeframe,sizeof o->timeframe,"4h");
    if (q->stale || ocd_now_ms() > q->observed_at_ms + q->ttl_ms) {
        o->side=OCD_SIGNAL_HOLD; o->confidence=15; o->risk=OCD_RISK_HIGH;
        snprintf(o->reasons[o->reason_count++],OCD_REASON_MAX,"Price data is stale; trading signal suppressed");
    } else if (q->liquidity_usd < 100000.0) {
        o->side=OCD_SIGNAL_HOLD; o->confidence=20; o->risk=OCD_RISK_CRITICAL;
        snprintf(o->reasons[o->reason_count++],OCD_REASON_MAX,"Liquidity below corporate safety threshold");
    } else if (q->change_24h_pct >= 3.0 && q->volume_24h_usd >= 1000000.0) {
        o->side=OCD_SIGNAL_BUY; o->confidence=(uint8_t)(q->change_24h_pct>8?82:70); o->risk=OCD_RISK_MEDIUM;
        snprintf(o->reasons[o->reason_count++],OCD_REASON_MAX,"Positive 24h momentum with volume confirmation");
    } else if (q->change_24h_pct <= -5.0) {
        o->side=OCD_SIGNAL_SELL; o->confidence=74; o->risk=OCD_RISK_HIGH;
        snprintf(o->reasons[o->reason_count++],OCD_REASON_MAX,"Negative momentum exceeds downside threshold");
    } else {
        o->side=OCD_SIGNAL_HOLD; o->confidence=55; o->risk=OCD_RISK_MEDIUM;
        snprintf(o->reasons[o->reason_count++],OCD_REASON_MAX,"No high-conviction directional setup");
    }
    o->entry_low=q->price_usd*0.995; o->entry_high=q->price_usd*1.005;
    o->target_1=q->price_usd*1.04; o->target_2=q->price_usd*1.08;
    o->invalidation=q->price_usd*0.96; o->generated_at_ms=ocd_now_ms();
    return OCD_OK;
}
