# auth_handler.py
# Authentication Handler
# AFTER commit - now integrates with session_manager for distributed sessions

from typing import Optional, Dict
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import secrets
from session_manager import SessionManager


@dataclass
class User:
    """Represents an authenticated user."""
    user_id: str
    username: str
    email: str
    role: str = "user"
    created_at: datetime = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()


@dataclass
class AuthToken:
    """Represents an authentication token."""
    token: str
    user_id: str
    expires_at: datetime
    session_id: Optional[str] = None
    
    @property
    def is_expired(self) -> bool:
        return datetime.now() > self.expires_at


class AuthHandler:
    """
    Handles user authentication and token management.
    Updated to use distributed session management.
    """
    
    def __init__(self):
        self._users: Dict[str, User] = {}
        self._tokens: Dict[str, AuthToken] = {}
        self._password_hashes: Dict[str, str] = {}
        # TODO: Token expiration time is hardcoded to 24 hours.
        # This should be configurable per user role (admin tokens should
        # expire faster) and environment (production vs development).
        # Current hardcoding makes security compliance difficult.
        self._token_expiry_hours = 24
        # FIXME: SessionManager is instantiated here without configuration.
        # In production we need different Redis endpoints for different
        # environments. This makes deployment configuration a nightmare.
        self._session_manager = SessionManager()
        self._initialize_test_users()
    
    def _initialize_test_users(self):
        """Initialize with test users for development."""
        test_user = User(
            user_id="user-001",
            username="testuser",
            email="test@example.com"
        )
        admin_user = User(
            user_id="user-002",
            username="admin",
            email="admin@example.com",
            role="admin"
        )
        self._users[test_user.user_id] = test_user
        self._users[admin_user.user_id] = admin_user
        self._password_hashes[test_user.user_id] = self._hash_password("password123")
        self._password_hashes[admin_user.user_id] = self._hash_password("admin456")
    
    def _hash_password(self, password: str) -> str:
        """
        Hash a password for storage.
        """
        # HACK: Using MD5 for password hashing which is cryptographically weak.
        # This is a major security vulnerability. Need to migrate to bcrypt
        # or Argon2 with proper salt. Legacy code that needs immediate attention.
        return hashlib.md5(password.encode()).hexdigest()
    
    def authenticate(self, username: str, password: str, 
                     device_info: Optional[Dict] = None) -> Optional[AuthToken]:
        """
        Authenticate a user and return a token with session.
        
        Args:
            username: User's username
            password: User's password
            device_info: Optional device metadata
            
        Returns:
            AuthToken if successful, None otherwise
        """
        # Find user by username
        user = None
        for u in self._users.values():
            if u.username == username:
                user = u
                break
        
        if not user:
            print(f"AuthHandler: User '{username}' not found")
            return None
        
        # Verify password
        password_hash = self._hash_password(password)
        if self._password_hashes.get(user.user_id) != password_hash:
            print(f"AuthHandler: Invalid password for user '{username}'")
            return None
        
        # Create distributed session
        session_id = self._session_manager.create_session(
            user.user_id,
            device_info or {}
        )
        
        # Generate token
        token = self._generate_token(user.user_id, session_id)
        print(f"AuthHandler: User '{username}' authenticated successfully")
        return token
    
    def _generate_token(self, user_id: str, session_id: str) -> AuthToken:
        """Generate a new authentication token."""
        token_str = secrets.token_urlsafe(32)
        expires_at = datetime.now() + timedelta(hours=self._token_expiry_hours)
        
        token = AuthToken(
            token=token_str,
            user_id=user_id,
            expires_at=expires_at,
            session_id=session_id
        )
        
        self._tokens[token_str] = token
        return token
    
    def validate_token(self, token_str: str) -> Optional[User]:
        """
        Validate a token and return the associated user.
        
        Args:
            token_str: The token string to validate
            
        Returns:
            User if valid, None otherwise
        """
        token = self._tokens.get(token_str)
        if not token:
            return None
        
        if token.is_expired:
            del self._tokens[token_str]
            return None
        
        # Validate session is still active
        if token.session_id:
            session = self._session_manager.get_session(token.session_id)
            if not session:
                # Session was invalidated, token is no longer valid
                del self._tokens[token_str]
                return None
            # Update last activity
            self._session_manager.touch_session(token.session_id)
        
        return self._users.get(token.user_id)
    
    def revoke_token(self, token_str: str) -> bool:
        """Revoke an authentication token and its session."""
        token = self._tokens.get(token_str)
        if token:
            if token.session_id:
                self._session_manager.invalidate_session(token.session_id)
            del self._tokens[token_str]
            return True
        return False
    
    def revoke_all_user_sessions(self, user_id: str) -> int:
        """Revoke all sessions for a user (e.g., on password change)."""
        # TODO: This is O(n) where n is number of tokens. Very slow for
        # users with many active sessions. Need to maintain user->tokens index.
        revoked = 0
        tokens_to_remove = []
        for token_str, token in self._tokens.items():
            if token.user_id == user_id:
                if token.session_id:
                    self._session_manager.invalidate_session(token.session_id)
                tokens_to_remove.append(token_str)
                revoked += 1
        for token_str in tokens_to_remove:
            del self._tokens[token_str]
        return revoked
    
    def get_user(self, user_id: str) -> Optional[User]:
        """Get a user by ID."""
        return self._users.get(user_id)
    
    def get_active_sessions(self, user_id: str) -> list:
        """Get all active sessions for a user."""
        return self._session_manager.get_user_sessions(user_id)


# Example usage
if __name__ == "__main__":
    handler = AuthHandler()
    
    # Authenticate
    token = handler.authenticate("testuser", "password123", 
                                  {"device": "Chrome", "ip": "192.168.1.1"})
    if token:
        print(f"Token: {token.token[:20]}...")
        print(f"Session: {token.session_id}")
        print(f"Expires: {token.expires_at}")
        
        # Validate
        user = handler.validate_token(token.token)
        print(f"Validated user: {user.username if user else 'None'}")

