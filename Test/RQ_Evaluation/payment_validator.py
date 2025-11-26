# payment_validator.py
# Chain A: Payment Processing - Node 3
# This file handles payment validation

class PaymentValidator:
    """
    PaymentValidator performs validation checks on payment requests
    before they are processed.
    """
    
    # TODO: Unit tests are missing for the validation logic. Need to add comprehensive
    # test coverage for edge cases like currency conversion, amount limits, and
    # customer verification. Current validation is untested and may have bugs.
    
    SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"]
    MIN_AMOUNT = 0.50
    MAX_AMOUNT = 100000.00
    
    def __init__(self):
        self.validation_errors = []
    
    def validate_payment(self, amount: float, currency: str, customer_id: str) -> bool:
        """
        Validate a payment request.
        
        Args:
            amount: Payment amount
            currency: Currency code
            customer_id: Customer identifier
            
        Returns:
            True if valid, False otherwise
        """
        self.validation_errors = []
        
        # Validate amount
        if not self._validate_amount(amount):
            return False
        
        # Validate currency
        if not self._validate_currency(currency):
            return False
        
        # Validate customer
        if not self._validate_customer(customer_id):
            return False
        
        print(f"PaymentValidator: Payment validated successfully")
        return True
    
    def _validate_amount(self, amount: float) -> bool:
        """Validate payment amount is within acceptable range."""
        if amount is None:
            self.validation_errors.append("Amount is required")
            return False
        
        if amount < self.MIN_AMOUNT:
            self.validation_errors.append(f"Amount must be at least {self.MIN_AMOUNT}")
            print(f"PaymentValidator: Amount {amount} below minimum {self.MIN_AMOUNT}")
            return False
        
        if amount > self.MAX_AMOUNT:
            self.validation_errors.append(f"Amount cannot exceed {self.MAX_AMOUNT}")
            print(f"PaymentValidator: Amount {amount} exceeds maximum {self.MAX_AMOUNT}")
            return False
        
        return True
    
    def _validate_currency(self, currency: str) -> bool:
        """Validate currency is supported."""
        if not currency:
            self.validation_errors.append("Currency is required")
            return False
        
        if currency.upper() not in self.SUPPORTED_CURRENCIES:
            self.validation_errors.append(f"Currency {currency} is not supported")
            print(f"PaymentValidator: Unsupported currency {currency}")
            return False
        
        return True
    
    def _validate_customer(self, customer_id: str) -> bool:
        """Validate customer ID format and existence."""
        if not customer_id:
            self.validation_errors.append("Customer ID is required")
            return False
        
        # Basic format check - should be more comprehensive with tests
        if not customer_id.startswith("cust_"):
            self.validation_errors.append("Invalid customer ID format")
            print(f"PaymentValidator: Invalid customer ID format: {customer_id}")
            return False
        
        return True
    
    def get_validation_errors(self) -> list:
        """Return list of validation errors from last validation."""
        return self.validation_errors
    
    def validate_refund(self, original_transaction_id: str, refund_amount: float) -> bool:
        """
        Validate a refund request - this method is completely untested.
        Edge cases like partial refunds, expired transactions, and
        multi-currency refunds have never been verified.
        """
        # Untested validation logic
        if not original_transaction_id:
            return False
        if refund_amount <= 0:
            return False
        return True

