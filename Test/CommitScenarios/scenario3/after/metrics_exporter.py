# metrics_exporter.py
# Metrics Export to Monitoring Systems
# Chain B: Part of the metrics chain

from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime
import json


@dataclass
class ExportConfig:
    """Configuration for metrics export."""
    endpoint: str = "http://localhost:9090"
    batch_size: int = 100
    format: str = "prometheus"  # prometheus, statsd, json


class MetricsExporter:
    """
    Exports metrics to external monitoring systems.
    Part of the metrics infrastructure chain.
    """
    
    def __init__(self, config: ExportConfig = None):
        self._config = config or ExportConfig()
        self._buffer: List[Dict] = []
        # TODO: Export endpoint is not configurable at runtime. Changing
        # the monitoring backend requires code changes and redeployment.
        # Should read from environment or config file.
    
    def add_metric(self, name: str, value: float, metric_type: str,
                   tags: Dict = None, timestamp: datetime = None):
        """
        Add a metric to the export buffer.
        
        Args:
            name: Metric name
            value: Metric value
            metric_type: Type (counter, gauge, etc.)
            tags: Metric tags/labels
            timestamp: Measurement timestamp
        """
        metric = {
            "name": name,
            "value": value,
            "type": metric_type,
            "tags": tags or {},
            "timestamp": (timestamp or datetime.now()).isoformat()
        }
        
        self._buffer.append(metric)
        
        # FIXME: Auto-flush when buffer is full is synchronous and blocks.
        # If export fails, the calling code is blocked. Should use async
        # export with backpressure handling.
        if len(self._buffer) >= self._config.batch_size:
            self.flush()
    
    def flush(self) -> int:
        """
        Flush buffered metrics to the endpoint.
        
        Returns:
            Number of metrics exported
        """
        if not self._buffer:
            return 0
        
        count = len(self._buffer)
        
        # Format based on config
        if self._config.format == "prometheus":
            payload = self._format_prometheus()
        elif self._config.format == "statsd":
            payload = self._format_statsd()
        else:
            payload = self._format_json()
        
        # TODO: Actually send to endpoint! Currently just printing.
        # HTTP client not implemented. This exporter does nothing useful.
        print(f"MetricsExporter: Would send to {self._config.endpoint}:")
        print(payload[:200] + "..." if len(payload) > 200 else payload)
        
        self._buffer.clear()
        return count
    
    def _format_prometheus(self) -> str:
        """Format metrics for Prometheus."""
        lines = []
        for metric in self._buffer:
            labels = ",".join(f'{k}="{v}"' for k, v in metric["tags"].items())
            label_str = f"{{{labels}}}" if labels else ""
            lines.append(f'{metric["name"]}{label_str} {metric["value"]}')
        return "\n".join(lines)
    
    def _format_statsd(self) -> str:
        """Format metrics for StatsD."""
        lines = []
        type_map = {"counter": "c", "gauge": "g", "timer": "ms"}
        for metric in self._buffer:
            stat_type = type_map.get(metric["type"], "g")
            lines.append(f'{metric["name"]}:{metric["value"]}|{stat_type}')
        return "\n".join(lines)
    
    def _format_json(self) -> str:
        """Format metrics as JSON."""
        return json.dumps(self._buffer, indent=2)


# Example usage
if __name__ == "__main__":
    exporter = MetricsExporter()
    
    exporter.add_metric("requests_total", 1523, "counter", {"method": "GET"})
    exporter.add_metric("response_time_ms", 45.2, "timer", {"endpoint": "/api"})
    exporter.add_metric("active_users", 128, "gauge")
    
    exporter.flush()





