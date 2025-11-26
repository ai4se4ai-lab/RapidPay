# data_loader.py
# Chain B: Data Pipeline - Node 3 (Leaf)
# This file handles loading transformed data into target systems

import threading
import time

class DataLoader:
    """
    DataLoader writes transformed data to various target systems.
    """
    
    def __init__(self):
        self.loaded_records = []
        self.lock = threading.Lock()  # Insufficient for the actual race condition
        self.batch_size = 100
    
    def load_data(self, data: list, target: str) -> dict:
        """
        Load data into the specified target.
        
        Args:
            data: List of records to load
            target: Target system identifier
            
        Returns:
            Load result statistics
        """
        print(f"DataLoader: Loading {len(data)} records to {target}")
        
        # BUG: Race condition exists when multiple threads call load_data
        # simultaneously. The lock doesn't properly protect the batch processing
        # and can result in duplicate records or lost data. This needs to be
        # fixed with proper transaction handling and atomic batch operations.
        
        if target == "database":
            return self._load_to_database(data)
        elif target == "file":
            return self._load_to_file(data)
        elif target == "api":
            return self._load_to_api(data)
        else:
            raise ValueError(f"Unknown target: {target}")
    
    def _load_to_database(self, data: list) -> dict:
        """Load data to database - has race condition in batch processing."""
        loaded_count = 0
        failed_count = 0
        
        # Process in batches
        for i in range(0, len(data), self.batch_size):
            batch = data[i:i + self.batch_size]
            
            # Race condition: lock doesn't cover the full transaction
            with self.lock:
                # Only protects this small section, not the actual DB write
                self.loaded_records.extend(batch)
            
            # Simulated database write - NOT protected by lock
            time.sleep(0.01)  # Simulate I/O
            
            # Another thread could modify loaded_records here
            loaded_count += len(batch)
        
        return {
            "status": "completed",
            "loaded": loaded_count,
            "failed": failed_count,
            "target": "database"
        }
    
    def _load_to_file(self, data: list) -> dict:
        """Load data to file - also susceptible to race conditions."""
        print(f"DataLoader: Writing {len(data)} records to file")
        
        # Race condition: file handle not properly synchronized
        with self.lock:
            self.loaded_records.extend(data)
        
        return {
            "status": "completed",
            "loaded": len(data),
            "failed": 0,
            "target": "file"
        }
    
    def _load_to_api(self, data: list) -> dict:
        """Load data via API - batch API calls have race condition."""
        loaded_count = 0
        
        for record in data:
            # Race condition in concurrent API calls
            with self.lock:
                self.loaded_records.append(record)
            
            # Simulated API call - NOT protected
            time.sleep(0.001)
            loaded_count += 1
        
        return {
            "status": "completed",
            "loaded": loaded_count,
            "failed": 0,
            "target": "api"
        }
    
    def load_concurrent(self, data: list, target: str, num_threads: int = 4) -> dict:
        """
        Load data using multiple threads - exposes the race condition.
        This method makes the race condition bug more likely to occur.
        """
        threads = []
        chunk_size = len(data) // num_threads
        
        for i in range(num_threads):
            start = i * chunk_size
            end = start + chunk_size if i < num_threads - 1 else len(data)
            chunk = data[start:end]
            
            thread = threading.Thread(
                target=self._load_to_database,
                args=(chunk,)
            )
            threads.append(thread)
            thread.start()
        
        for thread in threads:
            thread.join()
        
        # Count may be incorrect due to race condition
        return {
            "status": "completed",
            "reported_loaded": len(self.loaded_records),
            "expected_loaded": len(data),
            "possible_race_condition": len(self.loaded_records) != len(data)
        }
    
    def get_loaded_records(self) -> list:
        """Return list of loaded records - may be inconsistent due to race condition."""
        return self.loaded_records
    
    def clear_loaded_records(self):
        """Clear the loaded records list."""
        with self.lock:
            self.loaded_records = []

