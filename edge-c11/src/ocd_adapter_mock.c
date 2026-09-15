#include "ocd/ocd.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

static uint32_t hash32(const char *s){uint32_t h=2166136261u;for(;*s;s++){h^=(unsigned char)*s;h*=16777619u;}return h;}
static ocd_status price(ocd_adapter *a,const ocd_asset_id *id,ocd_price_quote *out){(void)a;if(!ocd_validate_asset(id)||!out)return OCD_ERR_INVALID;memset(out,0,sizeof *out);out->asset=*id;uint32_t h=hash32(id->symbol);out->price_usd=1.0+(double)(h%700000)/100.0;out->change_24h_pct=((int)(h%1800)-900)/100.0;out->volume_24h_usd=1000000.0+(double)(h%90000000);out->liquidity_usd=250000.0+(double)(h%50000000);out->observed_at_ms=ocd_now_ms();out->ttl_ms=30000;return OCD_OK;}
static ocd_status wallet(ocd_adapter *a,const char *addr,ocd_wallet_snapshot *out){(void)a;if(!ocd_validate_address(addr)||!out)return OCD_ERR_INVALID;memset(out,0,sizeof *out);snprintf(out->chain,sizeof out->chain,"auto");snprintf(out->address,sizeof out->address,"%s",addr);uint32_t h=hash32(addr);out->portfolio_usd=(double)(h%25000000)/100.0;out->asset_count=1u+(h%40u);out->observed_at_ms=ocd_now_ms();out->risk=(ocd_risk)(h%4u);return OCD_OK;}
static void destroy(ocd_adapter *a){free(a);}
static const ocd_adapter_vtable vt={price,wallet,destroy};
ocd_adapter *ocd_mock_adapter_create(void){ocd_adapter *a=calloc(1,sizeof *a);if(!a)return NULL;a->vtable=&vt;snprintf(a->name,sizeof a->name,"edge-mock");return a;}
