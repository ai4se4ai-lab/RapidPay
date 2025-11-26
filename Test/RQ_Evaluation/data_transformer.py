# data_transformer.py
# Chain B: Data Pipeline - Node 2
# This file handles data transformation

from data_loader import DataLoader

class DataTransformer:
    """
    DataTransformer applies transformations to extracted data
    before loading it into the target system.
    """
    
    def __init__(self):
        self.loader = DataLoader()
        self.transformations_applied = []
    
    def transform(self, raw_data: list) -> dict:
        """
        Transform raw data and optionally load it.
        
        Args:
            raw_data: List of raw data records
            
        Returns:
            Transformation result with statistics
        """
        print(f"DataTransformer: Transforming {len(raw_data)} records")
        
        # HACK: Using inefficient O(n^2) algorithm for data deduplication.
        # This works fine for small datasets but will cause severe performance
        # issues when processing large volumes. Need to implement hash-based
        # deduplication or use a more efficient data structure.
        transformed = self._inefficient_transform(raw_data)
        
        self.transformations_applied.append({
            "input_count": len(raw_data),
            "output_count": len(transformed)
        })
        
        return {
            "data": transformed,
            "stats": {
                "input_records": len(raw_data),
                "output_records": len(transformed),
                "duplicates_removed": len(raw_data) - len(transformed)
            }
        }
    
    def _inefficient_transform(self, data: list) -> list:
        """
        Transform and deduplicate data using inefficient nested loops.
        This is the source of the O(n^2) complexity problem.
        """
        result = []
        
        for item in data:
            # Normalize the item
            normalized = self._normalize_record(item)
            
            # Inefficient duplicate check - O(n) for each item = O(n^2) total
            is_duplicate = False
            for existing in result:
                if self._records_equal(normalized, existing):
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                result.append(normalized)
        
        return result
    
    def _normalize_record(self, record: dict) -> dict:
        """Normalize a single record to a standard format."""
        normalized = {}
        
        # Map various field names to standard names
        for key, value in record.items():
            standard_key = self._get_standard_field_name(key)
            normalized[standard_key] = value
        
        return normalized
    
    def _get_standard_field_name(self, field_name: str) -> str:
        """Map field names to standard names."""
        mappings = {
            "id": "record_id",
            "item_id": "record_id",
            "col1": "record_id",
            "name": "record_name",
            "item_name": "record_name",
            "col2": "record_name",
            "value": "record_value",
            "item_value": "record_value"
        }
        return mappings.get(field_name, field_name)
    
    def _records_equal(self, record1: dict, record2: dict) -> bool:
        """Check if two records are equal - used in inefficient dedup."""
        return record1.get("record_id") == record2.get("record_id")
    
    def transform_and_load(self, raw_data: list, target: str) -> dict:
        """Transform data and load it to a target."""
        transformed = self.transform(raw_data)
        load_result = self.loader.load_data(transformed["data"], target)
        
        return {
            "transform_stats": transformed["stats"],
            "load_result": load_result
        }
    
    def get_transformation_history(self) -> list:
        """Return history of transformations applied."""
        return self.transformations_applied

