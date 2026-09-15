#include "ocd/ocd.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void){ocd_asset_id a={0};snprintf(a.chain,sizeof a.chain,"ethereum");snprintf(a.symbol,sizeof a.symbol,"ETH");assert(ocd_validate_asset(&a));assert(!ocd_validate_address("x"));ocd_adapter*ad=ocd_mock_adapter_create();assert(ad);ocd_price_quote q;assert(ad->vtable->get_price(ad,&a,&q)==OCD_OK);ocd_trade_signal s;assert(ocd_generate_signal(&q,&s)==OCD_OK);char b[2048];assert(ocd_signal_to_json(&s,b,sizeof b)>0);assert(strstr(b,"signal")!=NULL);ad->vtable->destroy(ad);puts("all tests passed");return 0;}
