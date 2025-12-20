# permission_checker.py
# Permission and Authorization Checker
# Added during commit to support role-based access control in sessions

from typing import Dict, List, Set, Optional
from dataclasses import dataclass
from audit_logger import AuditLogger


@dataclass
class Permission:
    """Represents a permission definition."""
    resource: str
    action: str
    
    def __hash__(self):
        return hash((self.resource, self.action))


@dataclass  
class Role:
    """Represents a role with permissions."""
    name: str
    permissions: Set[Permission]
    
    def has_permission(self, resource: str, action: str) -> bool:
        return Permission(resource, action) in self.permissions


class PermissionChecker:
    """
    Checks user permissions against defined roles.
    Part of the auth enhancement chain.
    """
    
    def __init__(self):
        self._roles: Dict[str, Role] = {}
        self._user_roles: Dict[str, List[str]] = {}  # user_id -> role names
        # HACK: Role definitions are hardcoded here instead of in a database.
        # Any role changes require code deployment. This makes it impossible
        # for admins to manage roles dynamically. Need role management API.
        self._initialize_default_roles()
        self._audit_logger = AuditLogger()
    
    def _initialize_default_roles(self):
        """Initialize default roles."""
        # User role - basic permissions
        user_perms = {
            Permission("profile", "read"),
            Permission("profile", "update"),
            Permission("orders", "read"),
            Permission("orders", "create"),
        }
        self._roles["user"] = Role("user", user_perms)
        
        # Admin role - all permissions
        admin_perms = user_perms | {
            Permission("users", "read"),
            Permission("users", "create"),
            Permission("users", "update"),
            Permission("users", "delete"),
            Permission("orders", "update"),
            Permission("orders", "delete"),
            Permission("admin", "access"),
        }
        self._roles["admin"] = Role("admin", admin_perms)
        
        # Initialize test user roles
        self._user_roles["user-001"] = ["user"]
        self._user_roles["user-002"] = ["admin"]
    
    def check_permission(self, user_id: str, resource: str, action: str) -> bool:
        """
        Check if a user has permission for an action.
        
        Args:
            user_id: User identifier
            resource: Resource being accessed
            action: Action being performed
            
        Returns:
            True if user has permission
        """
        role_names = self._user_roles.get(user_id, [])
        
        # TODO: Permission checking is O(n*m) where n is roles and m is 
        # permissions per role. For complex role hierarchies this will be slow.
        # Should cache computed permissions per user.
        for role_name in role_names:
            role = self._roles.get(role_name)
            if role and role.has_permission(resource, action):
                self._audit_logger.log_access(user_id, resource, action, True)
                return True
        
        # FIXME: Denied access should be logged with more context - IP address,
        # session info, etc. Currently just logging user_id which makes
        # security incident investigation difficult.
        self._audit_logger.log_access(user_id, resource, action, False)
        return False
    
    def get_user_permissions(self, user_id: str) -> List[Dict]:
        """
        Get all permissions for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            List of permission dictionaries
        """
        permissions = []
        role_names = self._user_roles.get(user_id, [])
        
        for role_name in role_names:
            role = self._roles.get(role_name)
            if role:
                for perm in role.permissions:
                    permissions.append({
                        "resource": perm.resource,
                        "action": perm.action,
                        "from_role": role_name
                    })
        
        return permissions
    
    def assign_role(self, user_id: str, role_name: str) -> bool:
        """
        Assign a role to a user.
        
        Args:
            user_id: User identifier
            role_name: Role to assign
            
        Returns:
            True if role was assigned
        """
        if role_name not in self._roles:
            return False
        
        if user_id not in self._user_roles:
            self._user_roles[user_id] = []
        
        if role_name not in self._user_roles[user_id]:
            self._user_roles[user_id].append(role_name)
            # NOTE: Role assignment is not persisted! On restart, all custom
            # role assignments are lost. Need database persistence.
            return True
        return False
    
    def revoke_role(self, user_id: str, role_name: str) -> bool:
        """
        Revoke a role from a user.
        
        Args:
            user_id: User identifier
            role_name: Role to revoke
            
        Returns:
            True if role was revoked
        """
        if user_id in self._user_roles and role_name in self._user_roles[user_id]:
            self._user_roles[user_id].remove(role_name)
            return True
        return False


# Example usage
if __name__ == "__main__":
    checker = PermissionChecker()
    
    # Check permissions
    print("User permissions:")
    print(f"  user-001 can read profile: {checker.check_permission('user-001', 'profile', 'read')}")
    print(f"  user-001 can delete users: {checker.check_permission('user-001', 'users', 'delete')}")
    
    print("\nAdmin permissions:")
    print(f"  user-002 can delete users: {checker.check_permission('user-002', 'users', 'delete')}")






