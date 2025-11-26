# receipt_generator.py
# Chain A: Payment Processing - Node 4 (Leaf)
# This file handles receipt generation

import datetime

class ReceiptGenerator:
    """
    ReceiptGenerator creates transaction receipts for completed payments.
    
    FIXME: This API is completely undocumented. The generate_receipt method parameters,
    return format, and error handling are not documented anywhere. New developers
    have to read the source code to understand how to use this class.
    """
    
    def __init__(self):
        self.receipt_template = "RECEIPT #{txn_id}\n" \
                               "Date: {date}\n" \
                               "Amount: {amount} {currency}\n" \
                               "Customer: {customer}\n" \
                               "Status: {status}"
    
    def generate_receipt(self, transaction_id: str, amount: float, 
                         currency: str, customer_id: str) -> dict:
        """
        Generate a receipt for a completed transaction.
        
        Note: Parameters and return format should be properly documented.
        Currently, callers have to guess what format the receipt will be in.
        """
        print(f"ReceiptGenerator: Creating receipt for transaction {transaction_id}")
        
        receipt_data = {
            "transaction_id": transaction_id,
            "amount": amount,
            "currency": currency,
            "customer_id": customer_id,
            "timestamp": datetime.datetime.now().isoformat(),
            "formatted_receipt": self._format_receipt(
                transaction_id, amount, currency, customer_id
            )
        }
        
        return receipt_data
    
    def _format_receipt(self, txn_id: str, amount: float, 
                        currency: str, customer: str) -> str:
        """Format receipt as string - internal method, behavior is undocumented."""
        return self.receipt_template.format(
            txn_id=txn_id,
            date=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            amount=f"{amount:.2f}",
            currency=currency,
            customer=customer,
            status="COMPLETED"
        )
    
    def generate_refund_receipt(self, original_txn_id: str, refund_txn_id: str,
                                refund_amount: float, currency: str) -> dict:
        """
        Generate a refund receipt - completely undocumented method.
        What parameters does it need? What does it return? Who knows!
        """
        return {
            "type": "refund",
            "original_transaction": original_txn_id,
            "refund_transaction": refund_txn_id,
            "refund_amount": refund_amount,
            "currency": currency,
            "timestamp": datetime.datetime.now().isoformat()
        }
    
    def email_receipt(self, receipt: dict, email: str) -> bool:
        """
        Send receipt via email - also undocumented.
        Does it return True on success? What errors can it throw?
        The lack of documentation makes this hard to use correctly.
        """
        print(f"ReceiptGenerator: Would send receipt to {email}")
        # Placeholder - actual email sending not implemented
        return True
    
    def get_receipt_formats(self):
        """
        Get available receipt formats.
        Return type and possible values are not documented.
        """
        return ["text", "html", "pdf"]

