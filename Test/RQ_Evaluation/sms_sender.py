# sms_sender.py
# Chain C: Notification System - Node 3 (Leaf)
# This file handles sending SMS messages

class SMSSender:
    """
    SMSSender handles sending SMS messages through a gateway.
    """
    
    def __init__(self):
        self.gateway_url = "https://sms-gateway.example.com"
        self.api_key = "sms_api_key_placeholder"
        self.sent_messages = []
        self.supported_countries = ["US", "CA"]  # Very limited
    
    def send_sms(self, phone_number: str, message: str) -> dict:
        """
        Send an SMS message to the specified phone number.
        
        Args:
            phone_number: Recipient phone number
            message: SMS message text
            
        Returns:
            Send result
        """
        print(f"SMSSender: Sending SMS to {phone_number}")
        
        # NOTE: International SMS support is not implemented yet. Currently only
        # supports US and CA phone numbers. Need to add support for international
        # phone formats, country-specific gateways, and proper number validation.
        # This is a known requirement that hasn't been addressed.
        
        if not self._is_supported_number(phone_number):
            return {
                "status": "failed",
                "error": "International SMS not supported - feature incomplete"
            }
        
        # Truncate message if too long
        if len(message) > 160:
            message = message[:157] + "..."
            print(f"SMSSender: Message truncated to 160 characters")
        
        return self._send_via_gateway(phone_number, message)
    
    def _is_supported_number(self, phone_number: str) -> bool:
        """Check if phone number is from a supported country."""
        # Very basic check - only supports US/CA format
        if phone_number.startswith("+1"):
            return True
        if phone_number.startswith("1") and len(phone_number) == 11:
            return True
        # All other formats are unsupported
        return False
    
    def _send_via_gateway(self, phone_number: str, message: str) -> dict:
        """Send message through SMS gateway."""
        print(f"SMSSender: Calling gateway at {self.gateway_url}")
        
        # Simulated gateway call
        self.sent_messages.append({
            "phone": phone_number,
            "message": message,
            "timestamp": self._get_timestamp()
        })
        
        return {
            "status": "success",
            "message_id": f"sms_{hash(phone_number + message) % 10000}",
            "segments": (len(message) // 160) + 1
        }
    
    def send_international_sms(self, phone_number: str, country_code: str, 
                                message: str) -> dict:
        """
        Placeholder for international SMS - NOT IMPLEMENTED.
        This method exists but doesn't actually work for international numbers.
        """
        # Feature stub - requirement not fulfilled
        return {
            "status": "failed",
            "error": f"International SMS to {country_code} not implemented",
            "message": "This feature is on the roadmap but not yet available"
        }
    
    def get_supported_countries(self) -> list:
        """Return list of supported countries - very limited."""
        return self.supported_countries
    
    def add_country_support(self, country_code: str, gateway_config: dict) -> bool:
        """
        Add support for a new country - partial implementation.
        Config is stored but actual gateway integration is missing.
        """
        # This partially addresses the requirement but doesn't fully implement it
        self.supported_countries.append(country_code)
        print(f"SMSSender: Added {country_code} to supported countries (config not fully integrated)")
        return True
    
    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        import datetime
        return datetime.datetime.now().isoformat()
    
    def get_sent_messages(self) -> list:
        """Return list of sent messages."""
        return self.sent_messages
    
    def validate_phone_number(self, phone_number: str) -> dict:
        """
        Validate a phone number - only works for supported countries.
        International validation is incomplete.
        """
        is_valid = self._is_supported_number(phone_number)
        return {
            "valid": is_valid,
            "supported": is_valid,
            "message": "Valid US/CA number" if is_valid else "International numbers not supported"
        }

