# data_extractor.py
# Chain B: Data Pipeline - Node 1 (Root)
# This file handles data extraction from various sources

from data_transformer import DataTransformer

class DataExtractor:
    """
    DataExtractor retrieves data from multiple sources for the ETL pipeline.
    """
    
    def __init__(self):
        # TODO: This class is tightly coupled to specific data sources and the
        # DataTransformer class. Should implement a plugin architecture or 
        # dependency injection to allow different extractors/transformers.
        # The current architecture makes it impossible to test in isolation
        # or swap out components without modifying this class.
        self.transformer = DataTransformer()
        self.sources = {
            "database": self._extract_from_database,
            "api": self._extract_from_api,
            "file": self._extract_from_file
        }
    
    def extract_and_transform(self, source_type: str, source_config: dict) -> dict:
        """
        Extract data from a source and transform it.
        
        Args:
            source_type: Type of data source (database, api, file)
            source_config: Configuration for the source
            
        Returns:
            Transformed data
        """
        print(f"DataExtractor: Extracting from {source_type}")
        
        if source_type not in self.sources:
            raise ValueError(f"Unsupported source type: {source_type}")
        
        # Extract raw data
        raw_data = self.sources[source_type](source_config)
        
        # Transform using tightly-coupled transformer
        transformed_data = self.transformer.transform(raw_data)
        
        return transformed_data
    
    def _extract_from_database(self, config: dict) -> list:
        """Extract data from database - tightly coupled to specific DB format."""
        print(f"DataExtractor: Connecting to database {config.get('connection_string', 'default')}")
        
        # Simulated database extraction
        return [
            {"id": 1, "name": "Record 1", "value": 100},
            {"id": 2, "name": "Record 2", "value": 200},
            {"id": 3, "name": "Record 3", "value": 300}
        ]
    
    def _extract_from_api(self, config: dict) -> list:
        """Extract data from API - tightly coupled to specific API format."""
        print(f"DataExtractor: Calling API {config.get('endpoint', 'default')}")
        
        # Simulated API extraction
        return [
            {"item_id": "A", "item_name": "Item A", "item_value": 50},
            {"item_id": "B", "item_name": "Item B", "item_value": 75}
        ]
    
    def _extract_from_file(self, config: dict) -> list:
        """Extract data from file - tightly coupled to specific file format."""
        print(f"DataExtractor: Reading file {config.get('path', 'default.csv')}")
        
        # Simulated file extraction
        return [
            {"col1": "data1", "col2": "data2"},
            {"col1": "data3", "col2": "data4"}
        ]
    
    def get_supported_sources(self) -> list:
        """Return list of supported source types."""
        return list(self.sources.keys())
    
    def add_custom_source(self, source_type: str, extractor_func):
        """
        Add a custom source extractor - this is a workaround for the tight
        coupling issue but doesn't address the underlying architecture problem.
        """
        self.sources[source_type] = extractor_func


# Example usage
if __name__ == "__main__":
    extractor = DataExtractor()
    
    print("\n--- Test: Database Extraction ---")
    result = extractor.extract_and_transform("database", {"connection_string": "localhost:5432"})
    print(f"Result: {result}")

