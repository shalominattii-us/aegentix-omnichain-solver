#include "ocd/ocd.h"
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
int ocd_http_run(unsigned short,ocd_adapter*);
int main(int argc,char**argv){unsigned long p=8080;if(argc>1){char*e=NULL;errno=0;p=strtoul(argv[1],&e,10);if(errno||!e||*e||p<1024||p>65535){fprintf(stderr,"invalid port\n");return 64;}}ocd_adapter*a=ocd_mock_adapter_create();if(!a){fprintf(stderr,"adapter allocation failed\n");return 70;}int rc=ocd_http_run((unsigned short)p,a);a->vtable->destroy(a);return rc;}
