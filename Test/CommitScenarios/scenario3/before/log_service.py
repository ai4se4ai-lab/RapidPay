# log_service.py
# Application Logging Service
# Chain A: Logging infrastructure (isolated chain with 2 nodes)

from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import json


class LogLevel(Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


@dataclass
class LogEntry:
    """Represents a log entry."""
    timestamp: datetime
    level: LogLevel
    message: str
    context: Dict
    source: str


class LogService:
    """
    Central logging service for the application.
    Initial version with known limitations.
    """
    
    def __init__(self, app_name: str = "app"):
        self._app_name = app_name
        self._entries: List[LogEntry] = []
        self._handlers: List[callable] = []
        # TODO: Log storage is in-memory only. All logs are lost on restart.
        # Need to implement persistent storage (file, database, or log service).
        # This makes debugging production issues nearly impossible.
        self._max_entries = 10000
    
    def add_handler(self, handler: callable):
        """Add a log handler callback."""
        self._handlers.append(handler)
    
    def log(self, level: LogLevel, message: str, 
            context: Dict = None, source: str = None) -> LogEntry:
        """
        Log a message.
        
        Args:
            level: Log level
            message: Log message
            context: Additional context
            source: Source component
            
        Returns:
            Created LogEntry
        """
        entry = LogEntry(
            timestamp=datetime.now(),
            level=level,
            message=message,
            context=context or {},
            source=source or self._app_name
        )
        
        self._entries.append(entry)
        
        # Trim old entries
        # HACK: Simple truncation when limit reached. This discards oldest logs
        # without any archiving or rotation. Important debug info may be lost.
        # Need proper log rotation with archival to secondary storage.
        if len(self._entries) > self._max_entries:
            self._entries = self._entries[-self._max_entries:]
        
        # Call handlers
        for handler in self._handlers:
            try:
                handler(entry)
            except Exception as e:
                print(f"LogService: Handler error: {e}")
        
        return entry
    
    def debug(self, message: str, context: Dict = None, source: str = None):
        """Log a debug message."""
        return self.log(LogLevel.DEBUG, message, context, source)
    
    def info(self, message: str, context: Dict = None, source: str = None):
        """Log an info message."""
        return self.log(LogLevel.INFO, message, context, source)
    
    def warning(self, message: str, context: Dict = None, source: str = None):
        """Log a warning message."""
        return self.log(LogLevel.WARNING, message, context, source)
    
    def error(self, message: str, context: Dict = None, source: str = None):
        """Log an error message."""
        return self.log(LogLevel.ERROR, message, context, source)
    
    def critical(self, message: str, context: Dict = None, source: str = None):
        """Log a critical message."""
        return self.log(LogLevel.CRITICAL, message, context, source)
    
    def get_entries(self, level: LogLevel = None, limit: int = 100) -> List[Dict]:
        """Get log entries, optionally filtered by level."""
        entries = self._entries
        if level:
            entries = [e for e in entries if e.level == level]
        return [
            {
                "timestamp": e.timestamp.isoformat(),
                "level": e.level.value,
                "message": e.message,
                "context": e.context,
                "source": e.source
            }
            for e in entries[-limit:]
        ]


# Singleton instance
_log_service: Optional[LogService] = None

def get_logger(app_name: str = "app") -> LogService:
    """Get or create the singleton log service."""
    global _log_service
    if _log_service is None:
        _log_service = LogService(app_name)
    return _log_service


# Example usage
if __name__ == "__main__":
    logger = get_logger("test-app")
    
    logger.info("Application started")
    logger.debug("Debug information", {"key": "value"})
    logger.error("Something went wrong", {"error_code": 500})
    
    print("\nRecent logs:")
    for entry in logger.get_entries(limit=5):
        print(f"  [{entry['level']}] {entry['message']}")

