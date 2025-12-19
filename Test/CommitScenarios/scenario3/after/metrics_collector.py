# metrics_collector.py
# Application Metrics Collection
# Chain B: Metrics infrastructure - NOW connected to observability aggregator

from typing import Dict, List, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import time


class MetricType(Enum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    TIMER = "timer"


@dataclass
class Metric:
    """Represents a metric measurement."""
    name: str
    type: MetricType
    value: float
    timestamp: datetime
    tags: Dict = field(default_factory=dict)


class MetricsCollector:
    """
    Collects application metrics.
    Now integrated with observability aggregator for unified telemetry.
    """
    
    def __init__(self, namespace: str = "app"):
        self._namespace = namespace
        self._metrics: List[Metric] = []
        self._counters: Dict[str, float] = {}
        self._gauges: Dict[str, float] = {}
        # HACK: Storing all metrics in memory indefinitely. For high-throughput
        # apps, this will consume massive amounts of memory. Need proper
        # time-series storage with aggregation and downsampling.
        self._timers: Dict[str, List[float]] = {}
        self._aggregator_callback: Optional[Callable] = None
    
    def register_aggregator(self, callback: Callable):
        """Register observability aggregator callback."""
        self._aggregator_callback = callback
    
    def _full_name(self, name: str) -> str:
        """Get fully qualified metric name."""
        return f"{self._namespace}.{name}"
    
    def _notify_aggregator(self, metric: Metric):
        """Notify aggregator of new metric."""
        # BUG: Aggregator notification happens before the metric is fully
        # recorded. If aggregator reads back from collector, it might not
        # see the latest value. Race condition potential.
        if self._aggregator_callback:
            try:
                self._aggregator_callback("metric", metric)
            except Exception as e:
                print(f"MetricsCollector: Aggregator error: {e}")
    
    def increment(self, name: str, value: float = 1, tags: Dict = None):
        """
        Increment a counter metric.
        
        Args:
            name: Metric name
            value: Value to add
            tags: Metric tags
        """
        full_name = self._full_name(name)
        self._counters[full_name] = self._counters.get(full_name, 0) + value
        
        metric = Metric(
            name=full_name,
            type=MetricType.COUNTER,
            value=self._counters[full_name],
            timestamp=datetime.now(),
            tags=tags or {}
        )
        self._metrics.append(metric)
        self._notify_aggregator(metric)
    
    def gauge(self, name: str, value: float, tags: Dict = None):
        """
        Set a gauge metric value.
        
        Args:
            name: Metric name
            value: Current value
            tags: Metric tags
        """
        full_name = self._full_name(name)
        self._gauges[full_name] = value
        
        metric = Metric(
            name=full_name,
            type=MetricType.GAUGE,
            value=value,
            timestamp=datetime.now(),
            tags=tags or {}
        )
        self._metrics.append(metric)
        self._notify_aggregator(metric)
    
    def timer(self, name: str):
        """
        Create a timer context manager.
        
        Args:
            name: Timer name
            
        Returns:
            Timer context manager
        """
        return TimerContext(self, self._full_name(name))
    
    def record_time(self, name: str, duration_ms: float, tags: Dict = None):
        """
        Record a timing measurement.
        
        Args:
            name: Timer name
            duration_ms: Duration in milliseconds
            tags: Metric tags
        """
        full_name = self._full_name(name)
        if full_name not in self._timers:
            self._timers[full_name] = []
        self._timers[full_name].append(duration_ms)
        
        metric = Metric(
            name=full_name,
            type=MetricType.TIMER,
            value=duration_ms,
            timestamp=datetime.now(),
            tags=tags or {}
        )
        self._metrics.append(metric)
        self._notify_aggregator(metric)
    
    def get_counter(self, name: str) -> float:
        """Get current counter value."""
        return self._counters.get(self._full_name(name), 0)
    
    def get_gauge(self, name: str) -> float:
        """Get current gauge value."""
        return self._gauges.get(self._full_name(name), 0)
    
    def get_timer_stats(self, name: str) -> Optional[Dict]:
        """Get timer statistics."""
        full_name = self._full_name(name)
        values = self._timers.get(full_name)
        if not values:
            return None
        
        # TODO: No percentile calculations (p50, p95, p99). This limits
        # usefulness for SLA monitoring. Need proper histogram buckets.
        return {
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "avg": sum(values) / len(values)
        }
    
    def get_all_metrics(self) -> Dict:
        """Get all current metric values."""
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "timers": {k: self.get_timer_stats(k.replace(f"{self._namespace}.", ""))
                      for k in self._timers}
        }


class TimerContext:
    """Context manager for timing code blocks."""
    
    def __init__(self, collector: MetricsCollector, name: str):
        self._collector = collector
        self._name = name
        self._start = None
    
    def __enter__(self):
        self._start = time.time()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = (time.time() - self._start) * 1000
        self._collector.record_time(
            self._name.replace(f"{self._collector._namespace}.", ""),
            duration_ms
        )
        return False


# Singleton instance
_collector: Optional[MetricsCollector] = None

def get_metrics(namespace: str = "app") -> MetricsCollector:
    """Get or create the singleton metrics collector."""
    global _collector
    if _collector is None:
        _collector = MetricsCollector(namespace)
    return _collector


# Example usage
if __name__ == "__main__":
    metrics = get_metrics("test")
    
    metrics.increment("requests", tags={"endpoint": "/api/users"})
    metrics.gauge("active_connections", 42)
    
    with metrics.timer("db_query"):
        time.sleep(0.1)  # Simulate work
    
    print(metrics.get_all_metrics())





