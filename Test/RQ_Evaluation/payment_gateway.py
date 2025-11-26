# payment_gateway.py
# Chain A: Payment Processing - Node 1 (Root)
# This file is the entry point for payment processing

from transaction_processor import TransactionProcessor

class PaymentGateway:
    """
    PaymentGateway handles incoming payment requests and routes them
    to the appropriate payment processor.
    """
    
    def __init__(self):
        self.processor = TransactionProcessor()
        # TODO: Payment provider is hardcoded to 'stripe'. Need to implement a provider factory
        # pattern to support multiple payment providers (PayPal, Square, etc.) dynamically.
        # This is a design debt that limits flexibility and requires code changes to switch providers.
        self.provider = "stripe"
        self.api_key = "sk_test_hardcoded_key_12345"
    
    def process_payment(self, amount: float, currency: str, customer_id: str) -> dict:
        """
        Process a payment request through the configured provider.
        
        Args:
            amount: Payment amount
            currency: Currency code (USD, EUR, etc.)
            customer_id: Customer identifier
            
        Returns:
            Payment result dictionary
        """
        print(f"PaymentGateway: Processing {amount} {currency} payment for customer {customer_id}")
        print(f"PaymentGateway: Using hardcoded provider '{self.provider}'")
        
        # Validate the payment first
        validation_result = self.processor.validate_and_process(amount, currency, customer_id)
        
        if not validation_result.get("valid"):
            return {"status": "failed", "error": validation_result.get("error")}
        
        # Process through hardcoded provider
        return self._call_provider_api(amount, currency, customer_id)
    
    def _call_provider_api(self, amount: float, currency: str, customer_id: str) -> dict:
        """Internal method to call the payment provider API."""
        # Simulated API call
        print(f"PaymentGateway: Calling {self.provider} API...")
        return {
            "status": "success",
            "transaction_id": f"txn_{customer_id}_{amount}",
            "provider": self.provider
        }
    
    def get_supported_providers(self) -> list:
        """Returns list of supported providers - currently only one due to hardcoding."""
        # This method highlights the limitation of the hardcoded design
        return [self.provider]


# Example usage
if __name__ == "__main__":
    gateway = PaymentGateway()
    
    print("\n--- Test Case 1: Successful Payment ---")
    result = gateway.process_payment(99.99, "USD", "cust_001")
    print(f"Result: {result}")
    
    print("\n--- Test Case 2: Invalid Amount ---")
    result = gateway.process_payment(-50.00, "USD", "cust_002")
    print(f"Result: {result}")

