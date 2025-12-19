# audit_logger.py
# Security Audit Logger
# Added during commit to track permission checks and security events

from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime
import json


@dataclass
class AuditEvent:
    """Represents a security audit event."""
    event_id: str
    timestamp: datetime
    event_type: str
    user_id: str
    resource: Optional[str]
    action: Optional[str]
    success: bool
    metadata: Dict
    
    def to_dict(self) -> Dict:
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp.isoformat(),
            "event_type": self.event_type,
            "user_id": self.user_id,
            "resource": self.resource,
            "action": self.action,
            "success": self.success,
            "metadata": self.metadata
        }


class AuditLogger:
    """
    Logs security-related events for compliance and investigation.
    Part of the auth chain for tracking access patterns.
    """
    
    def __init__(self, log_file: str = None):
        self._events: List[AuditEvent] = []
        self._event_counter = 0
        # TODO: Currently storing events in memory only. Need to persist to
        # a proper audit log storage (file, database, or SIEM system).
        # In-memory storage is useless for actual auditing and compliance.
        self._log_file = log_file
    
    def _generate_event_id(self) -> str:
        """Generate a unique event ID."""
        self._event_counter += 1
        return f"EVT-{datetime.now().strftime('%Y%m%d')}-{self._event_counter:06d}"
    
    def log_access(self, user_id: str, resource: str, action: str, 
                   success: bool, metadata: Dict = None) -> str:
        """
        Log an access control event.
        
        Args:
            user_id: User who attempted access
            resource: Resource being accessed
            action: Action attempted
            success: Whether access was granted
            metadata: Additional context
            
        Returns:
            Event ID
        """
        event = AuditEvent(
            event_id=self._generate_event_id(),
            timestamp=datetime.now(),
            event_type="access_control",
            user_id=user_id,
            resource=resource,
            action=action,
            success=success,
            metadata=metadata or {}
        )
        
        self._events.append(event)
        
        # HACK: Printing to stdout as temporary logging. This is not suitable
        # for production - logs get mixed with application output and may be
        # lost. Need proper structured logging to dedicated audit log.
        status = "GRANTED" if success else "DENIED"
        print(f"AUDIT [{event.event_id}]: {status} - User {user_id} {action} on {resource}")
        
        return event.event_id
    
    def log_authentication(self, user_id: str, success: bool,
                           method: str = "password", 
                           metadata: Dict = None) -> str:
        """
        Log an authentication attempt.
        
        Args:
            user_id: User attempting authentication
            success: Whether authentication succeeded
            method: Authentication method used
            metadata: Additional context (IP, device, etc.)
            
        Returns:
            Event ID
        """
        event = AuditEvent(
            event_id=self._generate_event_id(),
            timestamp=datetime.now(),
            event_type="authentication",
            user_id=user_id,
            resource=None,
            action=method,
            success=success,
            metadata=metadata or {}
        )
        
        self._events.append(event)
        
        status = "SUCCESS" if success else "FAILED"
        print(f"AUDIT [{event.event_id}]: AUTH {status} - User {user_id} via {method}")
        
        return event.event_id
    
    def log_session_event(self, user_id: str, session_id: str,
                          event_type: str, metadata: Dict = None) -> str:
        """
        Log a session lifecycle event.
        
        Args:
            user_id: User who owns the session
            session_id: Session identifier
            event_type: Type of session event (created, invalidated, etc.)
            metadata: Additional context
            
        Returns:
            Event ID
        """
        event = AuditEvent(
            event_id=self._generate_event_id(),
            timestamp=datetime.now(),
            event_type=f"session_{event_type}",
            user_id=user_id,
            resource=session_id,
            action=event_type,
            success=True,
            metadata=metadata or {}
        )
        
        self._events.append(event)
        print(f"AUDIT [{event.event_id}]: SESSION {event_type} - User {user_id}, Session {session_id[:20]}...")
        
        return event.event_id
    
    def get_user_events(self, user_id: str, limit: int = 100) -> List[Dict]:
        """
        Get recent events for a user.
        
        Args:
            user_id: User to query
            limit: Maximum events to return
            
        Returns:
            List of event dictionaries
        """
        # FIXME: No indexing on user_id. This is O(n) scan of all events.
        # Will be extremely slow with large audit logs. Need proper indexing
        # or database query.
        user_events = [
            e.to_dict() for e in self._events 
            if e.user_id == user_id
        ]
        return user_events[-limit:]
    
    def get_failed_access_attempts(self, since: datetime = None) -> List[Dict]:
        """
        Get failed access attempts for security analysis.
        
        Args:
            since: Only return events after this time
            
        Returns:
            List of failed access event dictionaries
        """
        # TODO: Should be able to filter by resource, action, time range, etc.
        # Current implementation is too limited for real security analysis.
        # Need flexible query capabilities.
        failed = []
        for event in self._events:
            if not event.success:
                if since is None or event.timestamp > since:
                    failed.append(event.to_dict())
        return failed
    
    def export_events(self, filepath: str) -> int:
        """
        Export events to JSON file for analysis.
        
        Args:
            filepath: File path to write to
            
        Returns:
            Number of events exported
        """
        events_data = [e.to_dict() for e in self._events]
        with open(filepath, 'w') as f:
            json.dump(events_data, f, indent=2)
        return len(events_data)


# Example usage
if __name__ == "__main__":
    logger = AuditLogger()
    
    # Log some events
    logger.log_authentication("user-001", True, "password", {"ip": "192.168.1.1"})
    logger.log_access("user-001", "profile", "read", True)
    logger.log_access("user-001", "admin", "access", False)
    
    print("\nFailed attempts:")
    for event in logger.get_failed_access_attempts():
        print(f"  {event['event_id']}: {event['user_id']} tried {event['action']}")





