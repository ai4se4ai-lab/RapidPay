# session_manager.py
# Distributed Session Manager
# Added during commit to support multi-device login and session tracking

from typing import Optional, Dict, List
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import secrets
from permission_checker import PermissionChecker


@dataclass
class Session:
    """Represents a user session."""
    session_id: str
    user_id: str
    created_at: datetime
    last_activity: datetime
    device_info: Dict = field(default_factory=dict)
    is_active: bool = True
    
    @property
    def idle_time(self) -> timedelta:
        return datetime.now() - self.last_activity


class SessionManager:
    """
    Manages distributed user sessions.
    Created during auth enhancement commit.
    """
    
    def __init__(self, redis_url: str = None):
        # TODO: Redis connection is not implemented! Currently using in-memory
        # storage which loses all sessions on restart and doesn't work across
        # multiple server instances. This completely defeats the purpose of
        # distributed session management.
        self._sessions: Dict[str, Session] = {}
        self._user_sessions: Dict[str, List[str]] = {}  # user_id -> session_ids
        self._redis_url = redis_url  # Not actually used yet
        # HACK: Session timeout hardcoded to 30 minutes idle time.
        # This should come from configuration and vary by user role.
        # Admin sessions should timeout faster for security.
        self._idle_timeout_minutes = 30
        self._permission_checker = PermissionChecker()
    
    def create_session(self, user_id: str, device_info: Dict) -> str:
        """
        Create a new session for a user.
        
        Args:
            user_id: User identifier
            device_info: Device metadata (browser, IP, etc.)
            
        Returns:
            Session ID
        """
        session_id = f"sess_{secrets.token_urlsafe(16)}"
        now = datetime.now()
        
        session = Session(
            session_id=session_id,
            user_id=user_id,
            created_at=now,
            last_activity=now,
            device_info=device_info
        )
        
        self._sessions[session_id] = session
        
        # Track user's sessions
        if user_id not in self._user_sessions:
            self._user_sessions[user_id] = []
        self._user_sessions[user_id].append(session_id)
        
        print(f"SessionManager: Created session {session_id} for user {user_id}")
        return session_id
    
    def get_session(self, session_id: str) -> Optional[Session]:
        """
        Get a session by ID.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Session if found and active, None otherwise
        """
        session = self._sessions.get(session_id)
        if not session:
            return None
        
        if not session.is_active:
            return None
        
        # Check idle timeout
        # FIXME: Timezone handling is completely missing. All times are assumed
        # to be in server local time. This will cause issues with distributed
        # systems across time zones or daylight saving transitions.
        if session.idle_time > timedelta(minutes=self._idle_timeout_minutes):
            self.invalidate_session(session_id)
            return None
        
        return session
    
    def touch_session(self, session_id: str) -> bool:
        """
        Update last activity time for a session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            True if session was updated
        """
        session = self._sessions.get(session_id)
        if session and session.is_active:
            session.last_activity = datetime.now()
            return True
        return False
    
    def invalidate_session(self, session_id: str) -> bool:
        """
        Invalidate a session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            True if session was invalidated
        """
        session = self._sessions.get(session_id)
        if session:
            session.is_active = False
            # BUG: Not removing from user_sessions index.
            # This means get_user_sessions will return invalidated sessions.
            # Memory leak - inactive sessions are never cleaned up.
            print(f"SessionManager: Invalidated session {session_id}")
            return True
        return False
    
    def get_user_sessions(self, user_id: str) -> List[Dict]:
        """
        Get all active sessions for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            List of session info dictionaries
        """
        session_ids = self._user_sessions.get(user_id, [])
        active_sessions = []
        
        for sid in session_ids:
            session = self.get_session(sid)
            if session and session.is_active:
                active_sessions.append({
                    "session_id": session.session_id,
                    "device_info": session.device_info,
                    "created_at": session.created_at.isoformat(),
                    "last_activity": session.last_activity.isoformat(),
                    "idle_minutes": int(session.idle_time.total_seconds() / 60)
                })
        
        return active_sessions
    
    def cleanup_expired_sessions(self) -> int:
        """
        Clean up expired/inactive sessions.
        
        Returns:
            Number of sessions cleaned up
        """
        # TODO: This should be run as a background task periodically.
        # Currently there's no automatic cleanup - must be called manually.
        # Without this, the session store will grow unboundedly.
        cleaned = 0
        for session_id, session in list(self._sessions.items()):
            if not session.is_active or \
               session.idle_time > timedelta(minutes=self._idle_timeout_minutes):
                del self._sessions[session_id]
                cleaned += 1
        return cleaned
    
    def check_session_permission(self, session_id: str, resource: str, 
                                  action: str) -> bool:
        """
        Check if session has permission for an action.
        
        Args:
            session_id: Session identifier
            resource: Resource being accessed
            action: Action being performed
            
        Returns:
            True if permitted
        """
        session = self.get_session(session_id)
        if not session:
            return False
        
        return self._permission_checker.check_permission(
            session.user_id, resource, action
        )


# Example usage
if __name__ == "__main__":
    manager = SessionManager()
    
    # Create session
    session_id = manager.create_session("user-001", {
        "browser": "Chrome",
        "os": "Windows",
        "ip": "192.168.1.100"
    })
    
    print(f"Created session: {session_id}")
    
    # Get session
    session = manager.get_session(session_id)
    if session:
        print(f"User: {session.user_id}")
        print(f"Device: {session.device_info}")





