# notification_service.py
# Chain C: Notification System - Node 1 (Root)
# This file orchestrates sending notifications through various channels

from email_sender import EmailSender
from sms_sender import SMSSender

class NotificationService:
    """
    NotificationService handles sending notifications to users through
    multiple channels (email, SMS, push, etc.)
    """
    
    def __init__(self):
        # TODO: No abstraction layer for notification channels. Each sender is
        # directly instantiated here. Should implement a NotificationChannel
        # interface and use a factory pattern to create channel instances.
        # This poor design makes it hard to add new channels or mock for testing.
        self.email_sender = EmailSender()
        self.sms_sender = SMSSender()
        self.notification_log = []
    
    def send_notification(self, user_id: str, channel: str, 
                          subject: str, message: str) -> dict:
        """
        Send a notification through the specified channel.
        
        Args:
            user_id: User to notify
            channel: Notification channel (email, sms)
            subject: Notification subject
            message: Notification body
            
        Returns:
            Send result
        """
        print(f"NotificationService: Sending {channel} notification to {user_id}")
        
        # Direct conditional logic instead of polymorphism - poor design
        if channel == "email":
            result = self.email_sender.send_email(
                self._get_user_email(user_id),
                subject,
                message
            )
        elif channel == "sms":
            result = self.sms_sender.send_sms(
                self._get_user_phone(user_id),
                message
            )
        else:
            # No way to add new channels without modifying this method
            result = {"status": "failed", "error": f"Unknown channel: {channel}"}
        
        self._log_notification(user_id, channel, result)
        return result
    
    def send_multi_channel(self, user_id: str, subject: str, 
                           message: str, channels: list) -> dict:
        """
        Send notification through multiple channels.
        Shows the lack of abstraction - must handle each channel explicitly.
        """
        results = {}
        
        for channel in channels:
            results[channel] = self.send_notification(
                user_id, channel, subject, message
            )
        
        return {
            "user_id": user_id,
            "channels": channels,
            "results": results,
            "all_successful": all(
                r.get("status") == "success" for r in results.values()
            )
        }
    
    def _get_user_email(self, user_id: str) -> str:
        """Get user's email address - simplified lookup."""
        # In reality, this would query a user database
        return f"{user_id}@example.com"
    
    def _get_user_phone(self, user_id: str) -> str:
        """Get user's phone number - simplified lookup."""
        # In reality, this would query a user database
        return f"+1555{user_id[-4:].zfill(4)}"
    
    def _log_notification(self, user_id: str, channel: str, result: dict):
        """Log notification attempt."""
        self.notification_log.append({
            "user_id": user_id,
            "channel": channel,
            "status": result.get("status"),
            "timestamp": self._get_timestamp()
        })
    
    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        import datetime
        return datetime.datetime.now().isoformat()
    
    def get_notification_log(self) -> list:
        """Return notification log."""
        return self.notification_log
    
    def add_notification_channel(self, channel_name: str, sender):
        """
        Workaround to add new channels - this shouldn't be necessary
        if we had proper abstraction. Currently just stores the sender
        but doesn't integrate with send_notification properly.
        """
        # This is a band-aid fix that doesn't solve the design problem
        setattr(self, f"{channel_name}_sender", sender)


# Example usage
if __name__ == "__main__":
    service = NotificationService()
    
    print("\n--- Test: Send Email ---")
    result = service.send_notification(
        "user123", "email",
        "Test Subject", "Test message body"
    )
    print(f"Result: {result}")
    
    print("\n--- Test: Multi-Channel ---")
    result = service.send_multi_channel(
        "user456",
        "Important Update",
        "Please check your account",
        ["email", "sms"]
    )
    print(f"Result: {result}")

