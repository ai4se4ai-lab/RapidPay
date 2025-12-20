# observability_aggregator.py
# Unified Observability Aggregator
# NEW FILE - Developer commit that bridges logging and metrics chains
# This creates a merged 6-node chain from two previously isolated chains

from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import json

# Import from both chains - creating the bridge
from log_service import get_logger, LogService
from log_formatter import LogFormatter
from metrics_collector import get_metrics, MetricsCollector
from metrics_exporter import MetricsExporter


class TelemetryType(Enum):
    LOG = "log"
    METRIC = "metric"
    TRACE = "trace"
    EVENT = "event"


@dataclass
class TelemetryRecord:
    """Unified telemetry record combining logs and metrics."""
    record_id: str
    type: TelemetryType
    timestamp: datetime
    source: str
    data: Dict
    correlation_id: Optional[str] = None
    tags: Dict = field(default_factory=dict)


class ObservabilityAggregator:
    """
    Aggregates telemetry from logging and metrics subsystems.
    Bridges the previously isolated observability chains.
    
    This is the new node that creates technical debt propagation
    between the logging chain and metrics chain.
    """
    
    def __init__(self, app_name: str = "app"):
        self._app_name = app_name
        self._records: List[TelemetryRecord] = []
        self._record_counter = 0
        
        # TODO: Connecting to both logging and metrics creates tight coupling.
        # If either subsystem changes its interface, this aggregator breaks.
        # Should use event bus or pub/sub pattern for loose coupling.
        self._logger = get_logger(app_name)
        self._metrics = get_metrics(app_name)
        self._formatter = LogFormatter()
        self._exporter = MetricsExporter()
        
        # Register callbacks to receive telemetry
        self._logger.register_aggregator(self._on_telemetry)
        self._metrics.register_aggregator(self._on_telemetry)
        
        # HACK: Correlation tracking is simplistic. Using a global current_id
        # that gets overwritten. In async/multi-threaded scenarios, this will
        # cause incorrect correlation. Need thread-local or context-based tracking.
        self._current_correlation_id: Optional[str] = None
        
        # FIXME: No buffer size limit! Records grow unboundedly. Combined with
        # the inherited memory issues from both logging and metrics chains,
        # this makes the memory leak problem even worse.
        self._correlation_index: Dict[str, List[str]] = {}
    
    def _generate_record_id(self) -> str:
        """Generate unique record ID."""
        self._record_counter += 1
        return f"TR-{datetime.now().strftime('%Y%m%d%H%M%S')}-{self._record_counter:06d}"
    
    def set_correlation_id(self, correlation_id: str):
        """Set current correlation ID for request tracing."""
        self._current_correlation_id = correlation_id
    
    def clear_correlation_id(self):
        """Clear correlation ID."""
        self._current_correlation_id = None
    
    def _on_telemetry(self, telemetry_type: str, data: Any):
        """
        Callback for receiving telemetry from subsystems.
        
        Args:
            telemetry_type: "log" or "metric"
            data: LogEntry or Metric object
        """
        record_id = self._generate_record_id()
        
        if telemetry_type == "log":
            record = TelemetryRecord(
                record_id=record_id,
                type=TelemetryType.LOG,
                timestamp=data.timestamp,
                source=data.source,
                data={
                    "level": data.level.value,
                    "message": data.message,
                    "context": data.context
                },
                correlation_id=self._current_correlation_id
            )
        else:  # metric
            record = TelemetryRecord(
                record_id=record_id,
                type=TelemetryType.METRIC,
                timestamp=data.timestamp,
                source=self._app_name,
                data={
                    "name": data.name,
                    "value": data.value,
                    "type": data.type.value
                },
                correlation_id=self._current_correlation_id,
                tags=data.tags
            )
        
        self._records.append(record)
        
        # Index by correlation ID
        if record.correlation_id:
            if record.correlation_id not in self._correlation_index:
                self._correlation_index[record.correlation_id] = []
            self._correlation_index[record.correlation_id].append(record_id)
        
        # Auto-export errors to metrics
        # BUG: This creates a feedback loop! Logging an error generates a metric,
        # which if it fails, could log an error, generating another metric...
        # Need circuit breaker to prevent infinite loops.
        if telemetry_type == "log" and data.level.value in ("ERROR", "CRITICAL"):
            self._metrics.increment("errors", tags={"source": data.source})
    
    def get_correlated_telemetry(self, correlation_id: str) -> List[Dict]:
        """
        Get all telemetry for a correlation ID (e.g., a request trace).
        
        Args:
            correlation_id: Request/trace correlation ID
            
        Returns:
            List of telemetry records
        """
        # TODO: This is O(n) where n is all records. For large systems with
        # millions of records, this will be extremely slow. Need proper
        # indexing in a time-series database.
        record_ids = self._correlation_index.get(correlation_id, [])
        return [
            self._record_to_dict(r) 
            for r in self._records 
            if r.record_id in record_ids
        ]
    
    def _record_to_dict(self, record: TelemetryRecord) -> Dict:
        """Convert record to dictionary."""
        return {
            "record_id": record.record_id,
            "type": record.type.value,
            "timestamp": record.timestamp.isoformat(),
            "source": record.source,
            "data": record.data,
            "correlation_id": record.correlation_id,
            "tags": record.tags
        }
    
    def get_health_summary(self) -> Dict:
        """
        Get aggregated health summary combining logs and metrics.
        
        Returns:
            Health summary dictionary
        """
        now = datetime.now()
        last_hour = now - timedelta(hours=1)
        
        # Count recent errors
        recent_errors = sum(
            1 for r in self._records
            if r.type == TelemetryType.LOG 
            and r.data.get("level") in ("ERROR", "CRITICAL")
            and r.timestamp > last_hour
        )
        
        # HACK: Health calculation logic is hardcoded. Thresholds should be
        # configurable per environment. What's "healthy" in dev is different
        # from production.
        health_status = "healthy"
        if recent_errors > 100:
            health_status = "critical"
        elif recent_errors > 10:
            health_status = "degraded"
        
        return {
            "status": health_status,
            "timestamp": now.isoformat(),
            "metrics": {
                "total_records": len(self._records),
                "recent_errors": recent_errors,
                "active_correlations": len(self._correlation_index)
            }
        }
    
    def query_telemetry(self, 
                        telemetry_type: TelemetryType = None,
                        since: datetime = None,
                        until: datetime = None,
                        source: str = None,
                        limit: int = 100) -> List[Dict]:
        """
        Query telemetry with filters.
        
        Args:
            telemetry_type: Filter by type
            since: Start time
            until: End time
            source: Filter by source
            limit: Maximum results
            
        Returns:
            List of matching records
        """
        # NOTE: Full table scan for every query. This is acceptable for small
        # datasets but will not scale. Need to implement proper query engine
        # or use external time-series database.
        results = []
        
        for record in reversed(self._records):  # Most recent first
            if len(results) >= limit:
                break
            
            if telemetry_type and record.type != telemetry_type:
                continue
            if since and record.timestamp < since:
                continue
            if until and record.timestamp > until:
                continue
            if source and record.source != source:
                continue
            
            results.append(self._record_to_dict(record))
        
        return results
    
    def export_dashboard_data(self) -> Dict:
        """
        Export data for observability dashboard.
        Combines insights from both logging and metrics chains.
        
        Returns:
            Dashboard data dictionary
        """
        # TODO: Dashboard data generation is synchronous and expensive.
        # Should be cached and refreshed in background. Every dashboard
        # refresh causes a full scan of all telemetry.
        return {
            "health": self.get_health_summary(),
            "recent_logs": self.query_telemetry(
                telemetry_type=TelemetryType.LOG, 
                limit=20
            ),
            "recent_metrics": self.query_telemetry(
                telemetry_type=TelemetryType.METRIC,
                limit=20
            ),
            "all_metrics": self._metrics.get_all_metrics(),
            "active_traces": list(self._correlation_index.keys())[-10:]
        }


# Singleton instance
_aggregator: Optional[ObservabilityAggregator] = None

def get_aggregator(app_name: str = "app") -> ObservabilityAggregator:
    """Get or create singleton aggregator."""
    global _aggregator
    if _aggregator is None:
        _aggregator = ObservabilityAggregator(app_name)
    return _aggregator


# Example usage demonstrating chain merge
if __name__ == "__main__":
    # Initialize aggregator (bridges both chains)
    aggregator = get_aggregator("demo-app")
    
    # Set correlation for request tracing
    aggregator.set_correlation_id("req-12345")
    
    # Use logging chain
    logger = get_logger("demo-app")
    logger.info("Processing user request", {"user_id": "u123"})
    
    # Use metrics chain
    metrics = get_metrics("demo-app")
    metrics.increment("requests", tags={"endpoint": "/api/users"})
    
    # Simulate some work
    with metrics.timer("request_processing"):
        logger.debug("Fetching user data")
        metrics.gauge("active_users", 42)
    
    logger.info("Request completed successfully")
    
    # Clear correlation
    aggregator.clear_correlation_id()
    
    # Get correlated telemetry
    print("\n=== Correlated Telemetry ===")
    for record in aggregator.get_correlated_telemetry("req-12345"):
        print(f"  [{record['type']}] {record['data']}")
    
    # Get health summary
    print("\n=== Health Summary ===")
    print(json.dumps(aggregator.get_health_summary(), indent=2))
    
    # Get dashboard data
    print("\n=== Dashboard Data ===")
    dashboard = aggregator.export_dashboard_data()
    print(f"  Total records: {dashboard['health']['metrics']['total_records']}")
    print(f"  Active traces: {len(dashboard['active_traces'])}")






