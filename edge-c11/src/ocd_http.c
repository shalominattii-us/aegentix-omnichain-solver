#include "ocd/ocd.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET sock_t;
#define CLOSESOCK closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
typedef int sock_t;
#define INVALID_SOCKET (-1)
#define CLOSESOCK close
#endif

static void send_json(sock_t c,int code,const char*body){char h[512];const char*msg=code==200?"OK":code==400?"Bad Request":"Not Found";int n=snprintf(h,sizeof h,"HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n\r\n",code,msg,strlen(body));send(c,h,n,0);send(c,body,(int)strlen(body),0);}
static int query_value(const char*path,const char*key,char*out,size_t cap){const char*q=strchr(path,'?');if(!q)return 0;q++;size_t klen=strlen(key);while(*q){if(strncmp(q,key,klen)==0&&q[klen]=='='){q+=klen+1;size_t n=strcspn(q,"& ");if(n==0||n>=cap)return 0;memcpy(out,q,n);out[n]=0;return 1;}q=strchr(q,'&');if(!q)break;q++;}return 0;}
int ocd_http_run(uint16_t port,ocd_adapter*a){
#if defined(_WIN32)
WSADATA w;if(WSAStartup(MAKEWORD(2,2),&w)!=0)return 1;
#endif
sock_t s=socket(AF_INET,SOCK_STREAM,0);if(s==INVALID_SOCKET)return 2;int yes=1;setsockopt(s,SOL_SOCKET,SO_REUSEADDR,(const char*)&yes,sizeof yes);struct sockaddr_in addr={0};addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_ANY);addr.sin_port=htons(port);if(bind(s,(struct sockaddr*)&addr,sizeof addr)!=0||listen(s,32)!=0){CLOSESOCK(s);return 3;}printf("OmniCyberDex Edge listening on 0.0.0.0:%u\n",port);
for(;;){sock_t c=accept(s,NULL,NULL);if(c==INVALID_SOCKET)continue;char req[4096]={0};int got=recv(c,req,sizeof req-1,0);if(got<=0){CLOSESOCK(c);continue;}char method[8]={0},path[1024]={0};if(sscanf(req,"%7s %1023s",method,path)!=2||strcmp(method,"GET")!=0){send_json(c,400,"{\"error\":\"invalid_request\"}");CLOSESOCK(c);continue;}char body[4096];
if(strcmp(path,"/health")==0){send_json(c,200,"{\"ok\":true,\"service\":\"omnicyberdex-edge\",\"mode\":\"read-only\"}");}
else if(strncmp(path,"/v1/price",9)==0){char chain[32],symbol[16];if(!query_value(path,"chain",chain,sizeof chain)||!query_value(path,"symbol",symbol,sizeof symbol)){send_json(c,400,"{\"error\":\"chain_and_symbol_required\"}");}else{ocd_asset_id id={0};snprintf(id.chain,sizeof id.chain,"%s",chain);snprintf(id.symbol,sizeof id.symbol,"%s",symbol);ocd_price_quote q;ocd_status st=a->vtable->get_price(a,&id,&q);if(st==OCD_OK){ocd_price_to_json(&q,body,sizeof body);send_json(c,200,body);}else{ocd_error_to_json(st,"price lookup failed",body,sizeof body);send_json(c,400,body);}}}
else if(strncmp(path,"/v1/wallet",10)==0){char address[128];if(!query_value(path,"address",address,sizeof address)){send_json(c,400,"{\"error\":\"address_required\"}");}else{ocd_wallet_snapshot w;ocd_status st=a->vtable->get_wallet(a,address,&w);if(st==OCD_OK){ocd_wallet_to_json(&w,body,sizeof body);send_json(c,200,body);}else{ocd_error_to_json(st,"wallet lookup failed",body,sizeof body);send_json(c,400,body);}}}
else if(strncmp(path,"/v1/signal",10)==0){char chain[32],symbol[16];if(!query_value(path,"chain",chain,sizeof chain)||!query_value(path,"symbol",symbol,sizeof symbol)){send_json(c,400,"{\"error\":\"chain_and_symbol_required\"}");}else{ocd_asset_id id={0};snprintf(id.chain,sizeof id.chain,"%s",chain);snprintf(id.symbol,sizeof id.symbol,"%s",symbol);ocd_price_quote q;ocd_trade_signal sig;ocd_status st=a->vtable->get_price(a,&id,&q);if(st==OCD_OK)st=ocd_generate_signal(&q,&sig);if(st==OCD_OK){ocd_signal_to_json(&sig,body,sizeof body);send_json(c,200,body);}else{ocd_error_to_json(st,"signal generation failed",body,sizeof body);send_json(c,400,body);}}}
else send_json(c,404,"{\"error\":\"not_found\"}");CLOSESOCK(c);} }
