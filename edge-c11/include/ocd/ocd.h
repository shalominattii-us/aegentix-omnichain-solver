#ifndef OCD_H
#define OCD_H
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#define OCD_SYMBOL_MAX 16
#define OCD_CHAIN_MAX 32
#define OCD_ADDRESS_MAX 128
#define OCD_REASON_MAX 160
#define OCD_MAX_REASONS 6

typedef enum {
    OCD_OK = 0,
    OCD_ERR_INVALID = 1,
    OCD_ERR_NOT_FOUND = 2,
    OCD_ERR_UNAVAILABLE = 3,
    OCD_ERR_STALE = 4,
    OCD_ERR_INTERNAL = 5
} ocd_status;

typedef enum { OCD_SIGNAL_SELL=-1, OCD_SIGNAL_HOLD=0, OCD_SIGNAL_BUY=1 } ocd_signal_side;
typedef enum { OCD_RISK_LOW=0, OCD_RISK_MEDIUM=1, OCD_RISK_HIGH=2, OCD_RISK_CRITICAL=3 } ocd_risk;

typedef struct {
    char chain[OCD_CHAIN_MAX];
    char symbol[OCD_SYMBOL_MAX];
    char contract_address[OCD_ADDRESS_MAX];
} ocd_asset_id;

typedef struct {
    ocd_asset_id asset;
    double price_usd;
    double change_24h_pct;
    double volume_24h_usd;
    double liquidity_usd;
    uint64_t observed_at_ms;
    uint32_t ttl_ms;
    bool stale;
} ocd_price_quote;

typedef struct {
    char chain[OCD_CHAIN_MAX];
    char address[OCD_ADDRESS_MAX];
    double portfolio_usd;
    uint32_t asset_count;
    uint64_t observed_at_ms;
    ocd_risk risk;
} ocd_wallet_snapshot;

typedef struct {
    ocd_asset_id asset;
    char timeframe[8];
    ocd_signal_side side;
    uint8_t confidence;
    double entry_low;
    double entry_high;
    double target_1;
    double target_2;
    double invalidation;
    ocd_risk risk;
    char reasons[OCD_MAX_REASONS][OCD_REASON_MAX];
    size_t reason_count;
    uint64_t generated_at_ms;
} ocd_trade_signal;

typedef struct ocd_adapter ocd_adapter;
typedef struct {
    ocd_status (*get_price)(ocd_adapter*, const ocd_asset_id*, ocd_price_quote*);
    ocd_status (*get_wallet)(ocd_adapter*, const char*, ocd_wallet_snapshot*);
    void (*destroy)(ocd_adapter*);
} ocd_adapter_vtable;

struct ocd_adapter {
    const ocd_adapter_vtable *vtable;
    void *impl;
    char name[32];
};

uint64_t ocd_now_ms(void);
bool ocd_validate_asset(const ocd_asset_id *asset);
bool ocd_validate_address(const char *address);
ocd_status ocd_generate_signal(const ocd_price_quote *quote, ocd_trade_signal *out);
ocd_adapter *ocd_mock_adapter_create(void);
const char *ocd_status_string(ocd_status s);
const char *ocd_signal_string(ocd_signal_side s);
const char *ocd_risk_string(ocd_risk r);

size_t ocd_price_to_json(const ocd_price_quote*, char*, size_t);
size_t ocd_wallet_to_json(const ocd_wallet_snapshot*, char*, size_t);
size_t ocd_signal_to_json(const ocd_trade_signal*, char*, size_t);
size_t ocd_error_to_json(ocd_status, const char*, char*, size_t);

#endif
