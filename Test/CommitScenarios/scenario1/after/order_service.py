# order_service.py
# E-commerce Order Management Service
# AFTER the "Feature Rush" commit - Developer added quick features under deadline pressure

from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime
from inventory_service import InventoryService


@dataclass
class OrderItem:
    """Represents an item in an order."""
    product_id: str
    quantity: int
    unit_price: float


@dataclass
class Order:
    """Represents a customer order."""
    order_id: str
    customer_id: str
    items: List[OrderItem]
    created_at: datetime
    status: str = "pending"
    
    @property
    def total(self) -> float:
        """Calculate total order amount."""
        return sum(item.quantity * item.unit_price for item in self.items)


class OrderService:
    """
    Service for managing customer orders.
    Updated with inventory integration and caching during feature rush.
    """
    
    def __init__(self):
        self.orders: Dict[str, Order] = {}
        self._order_counter = 0
        self.inventory = InventoryService()
        # TODO: This direct instantiation of InventoryService creates tight coupling.
        # We should use dependency injection to allow for testing and flexibility.
        # This is design debt that will make unit testing very difficult.
        self._last_validation_time = None
    
    def create_order(self, customer_id: str, items: List[Dict]) -> Order:
        """
        Create a new order for a customer with inventory validation.
        
        Args:
            customer_id: The customer's unique identifier
            items: List of items with product_id, quantity, and unit_price
            
        Returns:
            The created Order object
        """
        # HACK: Quick validation added during feature rush - no proper error handling
        # If inventory check fails, we just proceed anyway and hope for the best.
        # This will cause issues when we oversell products.
        for item in items:
            available = self.inventory.check_availability(
                item["product_id"], 
                item["quantity"]
            )
            if not available:
                print(f"WARNING: Product {item['product_id']} may not be available!")
        
        self._order_counter += 1
        order_id = f"ORD-{self._order_counter:06d}"
        
        order_items = [
            OrderItem(
                product_id=item["product_id"],
                quantity=item["quantity"],
                unit_price=item["unit_price"]
            )
            for item in items
        ]
        
        order = Order(
            order_id=order_id,
            customer_id=customer_id,
            items=order_items,
            created_at=datetime.now()
        )
        
        self.orders[order_id] = order
        
        # Reserve inventory
        # FIXME: No transaction support here. If reservation partially fails,
        # we end up with inconsistent state between orders and inventory.
        # Need to implement proper saga pattern or two-phase commit.
        for item in order_items:
            self.inventory.reserve_stock(item.product_id, item.quantity)
        
        print(f"OrderService: Created order {order_id} for customer {customer_id}")
        return order
    
    def get_order(self, order_id: str) -> Optional[Order]:
        """Retrieve an order by ID."""
        return self.orders.get(order_id)
    
    def update_order_status(self, order_id: str, status: str) -> bool:
        """Update the status of an order."""
        if order_id in self.orders:
            self.orders[order_id].status = status
            print(f"OrderService: Updated order {order_id} status to {status}")
            return True
        return False
    
    def cancel_order(self, order_id: str) -> bool:
        """Cancel an existing order and release inventory."""
        order = self.orders.get(order_id)
        if order:
            # TODO: Need to handle partial cancellation scenarios where some
            # items have already shipped. Currently we just release all inventory
            # which could cause double-booking issues.
            for item in order.items:
                self.inventory.release_stock(item.product_id, item.quantity)
            return self.update_order_status(order_id, "cancelled")
        return False
    
    def get_customer_orders(self, customer_id: str) -> List[Order]:
        """Get all orders for a specific customer."""
        return [
            order for order in self.orders.values()
            if order.customer_id == customer_id
        ]
    
    def validate_all_pending_orders(self) -> Dict[str, bool]:
        """
        Validate all pending orders against current inventory.
        Added during feature rush for inventory sync feature.
        """
        # HACK: This method iterates through ALL orders every time it's called.
        # No pagination, no filtering, no caching. Will be extremely slow
        # when we have thousands of orders. Need to add proper indexing.
        results = {}
        for order_id, order in self.orders.items():
            if order.status == "pending":
                valid = all(
                    self.inventory.check_availability(item.product_id, item.quantity)
                    for item in order.items
                )
                results[order_id] = valid
        return results


# Example usage
if __name__ == "__main__":
    service = OrderService()
    
    # Create a sample order
    order = service.create_order(
        customer_id="CUST-001",
        items=[
            {"product_id": "PROD-A", "quantity": 2, "unit_price": 29.99},
            {"product_id": "PROD-B", "quantity": 1, "unit_price": 49.99}
        ]
    )
    
    print(f"Order total: ${order.total:.2f}")
    print(f"Order status: {order.status}")

