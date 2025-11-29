# auth_handler.py
# Authentication Handler
# Initial implementation with existing technical debt (2 SATD instances)

from typing import Optional, Dict
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import secrets


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
    
    @property
    def is_expired(self) -> bool:
        return datetime.now() > self.expires_at


class AuthHandler:
    """
    Handles user authentication and token management.
    This is the initial version with some known debt.
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
        self._initialize_test_users()
    
    def _initialize_test_users(self):
        """Initialize with test users for development."""
        test_user = User(
            user_id="user-001",
            username="testuser",
            email="test@example.com"
        )
        self._users[test_user.user_id] = test_user
        self._password_hashes[test_user.user_id] = self._hash_password("password123")
    
    def _hash_password(self, password: str) -> str:
        """
        Hash a password for storage.
        """
        # HACK: Using MD5 for password hashing which is cryptographically weak.
        # This is a major security vulnerability. Need to migrate to bcrypt
        # or Argon2 with proper salt. Legacy code that needs immediate attention.
        return hashlib.md5(password.encode()).hexdigest()
    
    def authenticate(self, username: str, password: str) -> Optional[AuthToken]:
        """
        Authenticate a user and return a token.
        
        Args:
            username: User's username
            password: User's password
            
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
        
        # Generate token
        token = self._generate_token(user.user_id)
        print(f"AuthHandler: User '{username}' authenticated successfully")
        return token
    
    def _generate_token(self, user_id: str) -> AuthToken:
        """Generate a new authentication token."""
        token_str = secrets.token_urlsafe(32)
        expires_at = datetime.now() + timedelta(hours=self._token_expiry_hours)
        
        token = AuthToken(
            token=token_str,
            user_id=user_id,
            expires_at=expires_at
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
        
        return self._users.get(token.user_id)
    
    def revoke_token(self, token_str: str) -> bool:
        """Revoke an authentication token."""
        if token_str in self._tokens:
            del self._tokens[token_str]
            return True
        return False
    
    def get_user(self, user_id: str) -> Optional[User]:
        """Get a user by ID."""
        return self._users.get(user_id)


# Example usage
if __name__ == "__main__":
    handler = AuthHandler()
    
    # Authenticate
    token = handler.authenticate("testuser", "password123")
    if token:
        print(f"Token: {token.token[:20]}...")
        print(f"Expires: {token.expires_at}")
        
        # Validate
        user = handler.validate_token(token.token)
        print(f"Validated user: {user.username if user else 'None'}")

