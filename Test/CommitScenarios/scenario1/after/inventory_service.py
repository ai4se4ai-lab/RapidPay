# inventory_service.py
# Inventory Management Service
# Created during "Feature Rush" commit to support order-inventory integration

from typing import Dict, Optional
from dataclasses import dataclass
from cache_manager import CacheManager


@dataclass
class InventoryItem:
    """Represents inventory for a product."""
    product_id: str
    available_quantity: int
    reserved_quantity: int
    reorder_threshold: int = 10
    
    @property
    def total_quantity(self) -> int:
        return self.available_quantity + self.reserved_quantity
    
    @property
    def needs_reorder(self) -> bool:
        return self.available_quantity < self.reorder_threshold


class InventoryService:
    """
    Service for managing product inventory.
    Created during feature rush with several known issues.
    """
    
    def __init__(self):
        self._inventory: Dict[str, InventoryItem] = {}
        # TODO: Cache initialization is done synchronously in constructor.
        # This blocks the service startup and could cause timeouts.
        # Should use lazy initialization or async startup.
        self._cache = CacheManager()
        self._initialize_sample_inventory()
    
    def _initialize_sample_inventory(self):
        """Initialize with sample data for testing."""
        self._inventory = {
            "PROD-A": InventoryItem("PROD-A", 100, 0),
            "PROD-B": InventoryItem("PROD-B", 50, 0),
            "PROD-C": InventoryItem("PROD-C", 200, 0),
        }
    
    def check_availability(self, product_id: str, quantity: int) -> bool:
        """
        Check if the requested quantity is available.
        
        Args:
            product_id: Product identifier
            quantity: Requested quantity
            
        Returns:
            True if available, False otherwise
        """
        # HACK: Using cache without proper invalidation strategy.
        # Cached values might be stale causing overselling issues.
        # Need to implement cache-aside pattern with TTL.
        cached = self._cache.get(f"avail:{product_id}")
        if cached is not None:
            return cached >= quantity
        
        item = self._inventory.get(product_id)
        if item:
            available = item.available_quantity >= quantity
            # Cache for future lookups (but this causes staleness issues!)
            self._cache.set(f"avail:{product_id}", item.available_quantity)
            return available
        return False
    
    def reserve_stock(self, product_id: str, quantity: int) -> bool:
        """
        Reserve stock for an order.
        
        Args:
            product_id: Product identifier
            quantity: Quantity to reserve
            
        Returns:
            True if reservation successful
        """
        item = self._inventory.get(product_id)
        if item and item.available_quantity >= quantity:
            item.available_quantity -= quantity
            item.reserved_quantity += quantity
            # FIXME: Not invalidating cache here! This creates a race condition
            # where availability check sees stale data after reservation.
            # Multiple concurrent orders could reserve the same stock.
            print(f"InventoryService: Reserved {quantity} units of {product_id}")
            return True
        print(f"InventoryService: Failed to reserve {quantity} units of {product_id}")
        return False
    
    def release_stock(self, product_id: str, quantity: int) -> bool:
        """
        Release reserved stock back to available.
        
        Args:
            product_id: Product identifier
            quantity: Quantity to release
            
        Returns:
            True if release successful
        """
        item = self._inventory.get(product_id)
        if item and item.reserved_quantity >= quantity:
            item.reserved_quantity -= quantity
            item.available_quantity += quantity
            # BUG: Cache invalidation is missing here too.
            # After releasing stock, cached availability is still stale.
            print(f"InventoryService: Released {quantity} units of {product_id}")
            return True
        return False
    
    def get_inventory_status(self, product_id: str) -> Optional[Dict]:
        """Get current inventory status for a product."""
        item = self._inventory.get(product_id)
        if item:
            return {
                "product_id": product_id,
                "available": item.available_quantity,
                "reserved": item.reserved_quantity,
                "needs_reorder": item.needs_reorder
            }
        return None
    
    def bulk_check_availability(self, items: Dict[str, int]) -> Dict[str, bool]:
        """
        Check availability for multiple products at once.
        
        Args:
            items: Dict of product_id -> quantity
            
        Returns:
            Dict of product_id -> availability
        """
        # TODO: This should be a single database query or batch cache lookup.
        # Current implementation makes N calls which is very inefficient.
        # Will cause performance issues with large shopping carts.
        return {
            product_id: self.check_availability(product_id, qty)
            for product_id, qty in items.items()
        }
    
    def get_low_stock_products(self) -> list:
        """Get all products that need reordering."""
        # HACK: Iterating through entire inventory on every call.
        # No indexing, no caching. This will be slow with thousands of products.
        # Should maintain a separate low-stock index.
        return [
            item.product_id 
            for item in self._inventory.values() 
            if item.needs_reorder
        ]


# Example usage
if __name__ == "__main__":
    service = InventoryService()
    
    print("Initial inventory status:")
    print(service.get_inventory_status("PROD-A"))
    
    print("\nChecking availability:")
    print(f"50 units of PROD-A available: {service.check_availability('PROD-A', 50)}")
    
    print("\nReserving stock:")
    service.reserve_stock("PROD-A", 30)
    print(service.get_inventory_status("PROD-A"))

