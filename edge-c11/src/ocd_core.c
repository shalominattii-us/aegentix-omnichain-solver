#include "ocd/ocd.h"
#include <ctype.h>
#include <string.h>
#include <time.h>

uint64_t ocd_now_ms(void) {
struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (uint64_t)ts.tv_sec * 1000ULL + (uint64_t)ts.tv_nsec / 1000000ULL;
}

static size_t bounded_len(const char *s, size_t max) {
    size_t n=0; if(!s) return 0; while(n<max && s[n]) n++; return n;
}

static bool safe_text(const char *s, size_t max) {
    if (!s) return false;
    size_t n = bounded_len(s, max);
    if (n == 0 || n >= max) return false;
    for (size_t i=0;i<n;i++) {
        unsigned char c=(unsigned char)s[i];
        if (!(isalnum(c) || c=='_' || c=='-' || c=='.' || c==':')) return false;
    }
    return true;
}

bool ocd_validate_asset(const ocd_asset_id *a) {
    if (!a || !safe_text(a->chain, sizeof a->chain) || !safe_text(a->symbol, sizeof a->symbol)) return false;
    if (a->contract_address[0] && !ocd_validate_address(a->contract_address)) return false;
    return true;
}

bool ocd_validate_address(const char *a) {
    if (!a) return false;
    size_t n=bounded_len(a, OCD_ADDRESS_MAX);
    if (n < 8 || n >= OCD_ADDRESS_MAX) return false;
    for (size_t i=0;i<n;i++) {
        unsigned char c=(unsigned char)a[i];
        if (!(isalnum(c) || c=='_' || c=='-' || c==':' || c=='.')) return false;
    }
    return true;
}

const char *ocd_status_string(ocd_status s) {
    switch(s){case OCD_OK:return "ok";case OCD_ERR_INVALID:return "invalid";case OCD_ERR_NOT_FOUND:return "not_found";case OCD_ERR_UNAVAILABLE:return "unavailable";case OCD_ERR_STALE:return "stale";default:return "internal";}
}
const char *ocd_signal_string(ocd_signal_side s){return s>0?"BUY":s<0?"SELL":"HOLD";}
const char *ocd_risk_string(ocd_risk r){switch(r){case OCD_RISK_LOW:return "low";case OCD_RISK_MEDIUM:return "medium";case OCD_RISK_HIGH:return "high";default:return "critical";}}
