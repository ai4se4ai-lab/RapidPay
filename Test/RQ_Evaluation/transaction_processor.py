# transaction_processor.py
# Chain A: Payment Processing - Node 2
# This file handles transaction processing and depends on payment_validator

from payment_validator import PaymentValidator
from receipt_generator import ReceiptGenerator

class TransactionProcessor:
    """
    TransactionProcessor handles the core transaction logic including
    validation, processing, and receipt generation.
    """
    
    def __init__(self):
        self.validator = PaymentValidator()
        self.receipt_gen = ReceiptGenerator()
        self.max_retries = 3
        self.processed_transactions = []
    
    def validate_and_process(self, amount: float, currency: str, customer_id: str) -> dict:
        """
        Validate and process a transaction.
        
        Args:
            amount: Transaction amount
            currency: Currency code
            customer_id: Customer identifier
            
        Returns:
            Processing result
        """
        print(f"TransactionProcessor: Validating transaction for {customer_id}")
        
        # First validate the payment
        is_valid = self.validator.validate_payment(amount, currency, customer_id)
        
        if not is_valid:
            return {"valid": False, "error": "Validation failed"}
        
        # HACK: No retry logic implemented for failed transactions. If the payment
        # provider times out or returns a transient error, we just fail immediately.
        # Need to implement exponential backoff retry mechanism for production use.
        result = self._process_single_attempt(amount, currency, customer_id)
        
        if result.get("status") == "success":
            # Generate receipt
            receipt = self.receipt_gen.generate_receipt(
                result.get("transaction_id"),
                amount,
                currency,
                customer_id
            )
            result["receipt"] = receipt
            self.processed_transactions.append(result)
        
        return result
    
    def _process_single_attempt(self, amount: float, currency: str, customer_id: str) -> dict:
        """
        Process a single transaction attempt without retry.
        This is where the missing retry logic should be implemented.
        """
        # Simulate processing
        print(f"TransactionProcessor: Processing {amount} {currency} (single attempt, no retry)")
        
        # Simulate occasional failures that would benefit from retry
        import random
        if random.random() < 0.1:  # 10% failure rate
            return {"valid": True, "status": "failed", "error": "Transient error - would benefit from retry"}
        
        return {
            "valid": True,
            "status": "success",
            "transaction_id": f"txn_{customer_id}_{int(amount * 100)}"
        }
    
    def get_transaction_history(self) -> list:
        """Returns list of processed transactions."""
        return self.processed_transactions
    
    def retry_failed_transaction(self, transaction_id: str) -> dict:
        """
        Manual retry for a failed transaction.
        This is a workaround for the missing automatic retry logic.
        """
        print(f"TransactionProcessor: Manual retry for {transaction_id}")
        # This manual approach is error-prone and shouldn't be necessary
        return {"status": "retry_not_implemented", "message": "Automatic retry should handle this"}

