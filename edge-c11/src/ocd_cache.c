/* Reserved for durable edge cache implementation. The MVP deliberately keeps
 * cache policy isolated so SQLite/LMDB can be added without changing APIs. */
int ocd_cache_translation_unit_anchor(void){return 0;}
