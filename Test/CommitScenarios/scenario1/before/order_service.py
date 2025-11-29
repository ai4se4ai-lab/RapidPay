# order_service.py
# E-commerce Order Management Service
# Clean initial implementation before the "Feature Rush" commit

from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime


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
    This is the clean initial version without technical debt.
    """
    
    def __init__(self):
        self.orders: Dict[str, Order] = {}
        self._order_counter = 0
    
    def create_order(self, customer_id: str, items: List[Dict]) -> Order:
        """
        Create a new order for a customer.
        
        Args:
            customer_id: The customer's unique identifier
            items: List of items with product_id, quantity, and unit_price
            
        Returns:
            The created Order object
        """
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
        """Cancel an existing order."""
        return self.update_order_status(order_id, "cancelled")
    
    def get_customer_orders(self, customer_id: str) -> List[Order]:
        """Get all orders for a specific customer."""
        return [
            order for order in self.orders.values()
            if order.customer_id == customer_id
        ]


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

