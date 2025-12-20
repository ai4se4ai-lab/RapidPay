# log_formatter.py
# Log Message Formatter
# Chain A: Part of the logging chain

from typing import Dict, Optional
from dataclasses import dataclass
from datetime import datetime
import json


@dataclass
class FormatConfig:
    """Configuration for log formatting."""
    include_timestamp: bool = True
    include_level: bool = True
    include_source: bool = True
    timestamp_format: str = "%Y-%m-%d %H:%M:%S"
    json_output: bool = False


class LogFormatter:
    """
    Formats log entries for output.
    Part of the logging infrastructure chain.
    """
    
    def __init__(self, config: FormatConfig = None):
        self._config = config or FormatConfig()
        # FIXME: Format configuration is not validated. Invalid timestamp format
        # string will cause runtime errors later. Need validation on init.
    
    def format(self, timestamp: datetime, level: str, message: str,
               context: Dict = None, source: str = None) -> str:
        """
        Format a log entry.
        
        Args:
            timestamp: Entry timestamp
            level: Log level
            message: Log message
            context: Additional context
            source: Source component
            
        Returns:
            Formatted log string
        """
        if self._config.json_output:
            return self._format_json(timestamp, level, message, context, source)
        return self._format_text(timestamp, level, message, context, source)
    
    def _format_text(self, timestamp: datetime, level: str, message: str,
                     context: Dict = None, source: str = None) -> str:
        """Format as plain text."""
        parts = []
        
        if self._config.include_timestamp:
            # TODO: No timezone handling. Logs will have inconsistent times
            # in distributed systems. Should use UTC with timezone indicator.
            parts.append(timestamp.strftime(self._config.timestamp_format))
        
        if self._config.include_level:
            parts.append(f"[{level}]")
        
        if self._config.include_source and source:
            parts.append(f"({source})")
        
        parts.append(message)
        
        if context:
            parts.append(f"| {context}")
        
        return " ".join(parts)
    
    def _format_json(self, timestamp: datetime, level: str, message: str,
                     context: Dict = None, source: str = None) -> str:
        """Format as JSON."""
        entry = {
            "message": message,
            "level": level
        }
        
        if self._config.include_timestamp:
            entry["timestamp"] = timestamp.isoformat()
        
        if self._config.include_source and source:
            entry["source"] = source
        
        if context:
            entry["context"] = context
        
        return json.dumps(entry)
    
    def set_json_output(self, enabled: bool):
        """Enable or disable JSON output."""
        self._config.json_output = enabled


# Example usage
if __name__ == "__main__":
    formatter = LogFormatter()
    
    formatted = formatter.format(
        timestamp=datetime.now(),
        level="INFO",
        message="User logged in",
        context={"user_id": "123"},
        source="auth"
    )
    print(formatted)






