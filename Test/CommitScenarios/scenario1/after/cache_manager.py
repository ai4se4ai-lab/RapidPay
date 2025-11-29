# cache_manager.py
# Simple Cache Manager
# Created during "Feature Rush" commit as quick caching solution

from typing import Any, Optional, Dict
from datetime import datetime, timedelta
import threading


class CacheEntry:
    """Represents a cached value with metadata."""
    
    def __init__(self, value: Any, ttl_seconds: int = 300):
        self.value = value
        self.created_at = datetime.now()
        self.ttl = timedelta(seconds=ttl_seconds)
    
    @property
    def is_expired(self) -> bool:
        return datetime.now() > self.created_at + self.ttl


class CacheManager:
    """
    Simple in-memory cache manager.
    Built quickly during feature rush - has several known issues.
    """
    
    def __init__(self, default_ttl: int = 300):
        self._cache: Dict[str, CacheEntry] = {}
        self._default_ttl = default_ttl
        # TODO: This lock implementation is naive. Using a single global lock
        # means all cache operations are serialized, causing a major bottleneck.
        # Should use fine-grained locking or lock-free data structures.
        self._lock = threading.Lock()
        self._stats = {"hits": 0, "misses": 0}
    
    def get(self, key: str) -> Optional[Any]:
        """
        Get a value from cache.
        
        Args:
            key: Cache key
            
        Returns:
            Cached value or None if not found/expired
        """
        with self._lock:
            entry = self._cache.get(key)
            if entry:
                if entry.is_expired:
                    # HACK: Expired entries are deleted lazily on access.
                    # This means expired data can accumulate if keys are not
                    # accessed, causing memory bloat. Need background cleanup.
                    del self._cache[key]
                    self._stats["misses"] += 1
                    return None
                self._stats["hits"] += 1
                return entry.value
            self._stats["misses"] += 1
            return None
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """
        Set a value in cache.
        
        Args:
            key: Cache key
            value: Value to cache
            ttl: Optional TTL in seconds
        """
        with self._lock:
            # FIXME: No size limit on cache! The cache will grow unbounded
            # until we run out of memory. Need to implement LRU eviction
            # or max size limit with eviction policy.
            self._cache[key] = CacheEntry(value, ttl or self._default_ttl)
    
    def delete(self, key: str) -> bool:
        """
        Delete a key from cache.
        
        Args:
            key: Cache key to delete
            
        Returns:
            True if key existed and was deleted
        """
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False
    
    def clear(self) -> None:
        """Clear all cached values."""
        with self._lock:
            self._cache.clear()
            print("CacheManager: Cache cleared")
    
    def invalidate_prefix(self, prefix: str) -> int:
        """
        Invalidate all keys starting with a prefix.
        
        Args:
            prefix: Key prefix to match
            
        Returns:
            Number of keys invalidated
        """
        # TODO: This is O(n) where n is total cache size.
        # For large caches with millions of keys, this will be very slow.
        # Should use a trie or prefix index for efficient prefix lookups.
        with self._lock:
            keys_to_delete = [k for k in self._cache if k.startswith(prefix)]
            for key in keys_to_delete:
                del self._cache[key]
            return len(keys_to_delete)
    
    def get_stats(self) -> Dict:
        """Get cache statistics."""
        with self._lock:
            total = self._stats["hits"] + self._stats["misses"]
            hit_rate = self._stats["hits"] / total if total > 0 else 0
            return {
                "hits": self._stats["hits"],
                "misses": self._stats["misses"],
                "hit_rate": hit_rate,
                "size": len(self._cache)
            }
    
    def cleanup_expired(self) -> int:
        """
        Remove all expired entries from cache.
        
        Returns:
            Number of entries removed
        """
        # NOTE: This method should be called periodically by a background task.
        # Currently there's no automatic cleanup - it's entirely manual.
        # Risk of memory leaks if this is never called.
        with self._lock:
            expired_keys = [
                key for key, entry in self._cache.items() 
                if entry.is_expired
            ]
            for key in expired_keys:
                del self._cache[key]
            if expired_keys:
                print(f"CacheManager: Cleaned up {len(expired_keys)} expired entries")
            return len(expired_keys)


# Example usage
if __name__ == "__main__":
    cache = CacheManager(default_ttl=60)
    
    # Basic operations
    cache.set("user:123", {"name": "Alice", "email": "alice@example.com"})
    print(f"Cached user: {cache.get('user:123')}")
    
    # Stats
    print(f"Cache stats: {cache.get_stats()}")

