# email_sender.py
# Chain C: Notification System - Node 2
# This file handles sending emails

import time

class EmailSender:
    """
    EmailSender handles sending emails through an SMTP server.
    """
    
    def __init__(self):
        self.smtp_server = "smtp.example.com"
        self.smtp_port = 587
        self.timeout = 30
        self.sent_emails = []
    
    def send_email(self, to_address: str, subject: str, body: str) -> dict:
        """
        Send an email to the specified address.
        
        Args:
            to_address: Recipient email address
            subject: Email subject
            body: Email body
            
        Returns:
            Send result
        """
        print(f"EmailSender: Sending email to {to_address}")
        
        # HACK: Using blocking I/O for email sending. This blocks the entire
        # thread while waiting for SMTP server response, which can take several
        # seconds. Should use async I/O or a background task queue to avoid
        # blocking the main application thread.
        result = self._blocking_send(to_address, subject, body)
        
        if result.get("status") == "success":
            self.sent_emails.append({
                "to": to_address,
                "subject": subject,
                "timestamp": self._get_timestamp()
            })
        
        return result
    
    def _blocking_send(self, to_address: str, subject: str, body: str) -> dict:
        """
        Perform the actual email send using blocking I/O.
        This is where the blocking behavior occurs.
        """
        try:
            # Simulate SMTP connection and send - BLOCKING
            print(f"EmailSender: Connecting to {self.smtp_server}:{self.smtp_port} (blocking)...")
            time.sleep(0.5)  # Simulate connection time - blocks thread
            
            print(f"EmailSender: Sending message (blocking)...")
            time.sleep(0.3)  # Simulate send time - blocks thread
            
            print(f"EmailSender: Waiting for server response (blocking)...")
            time.sleep(0.2)  # Simulate response wait - blocks thread
            
            return {
                "status": "success",
                "message_id": f"msg_{hash(to_address + subject) % 10000}",
                "blocking_time_ms": 1000  # Total blocking time
            }
        
        except Exception as e:
            return {
                "status": "failed",
                "error": str(e)
            }
    
    def send_bulk_emails(self, recipients: list, subject: str, body: str) -> dict:
        """
        Send bulk emails - blocking behavior makes this very slow.
        Each email blocks, so N emails take N * blocking_time.
        """
        results = []
        total_blocking_time = 0
        
        for recipient in recipients:
            start_time = time.time()
            result = self.send_email(recipient, subject, body)
            blocking_time = time.time() - start_time
            total_blocking_time += blocking_time
            results.append(result)
        
        return {
            "total_sent": len([r for r in results if r.get("status") == "success"]),
            "total_failed": len([r for r in results if r.get("status") != "success"]),
            "total_blocking_time_seconds": total_blocking_time,
            "avg_time_per_email_seconds": total_blocking_time / len(recipients)
        }
    
    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        import datetime
        return datetime.datetime.now().isoformat()
    
    def get_sent_emails(self) -> list:
        """Return list of sent emails."""
        return self.sent_emails
    
    def configure_smtp(self, server: str, port: int, timeout: int = 30):
        """Configure SMTP settings."""
        self.smtp_server = server
        self.smtp_port = port
        self.timeout = timeout

