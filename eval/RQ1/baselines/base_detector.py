#!/usr/bin/env python3
"""
Base Detector Abstract Class

Defines the common interface for all SATD detection methods.
All baseline implementations must inherit from BaseDetector and implement
the required methods.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple
from pathlib import Path
import time


@dataclass
class DetectionResult:
    """
    Result of SATD detection for a single comment.
    
    Attributes:
        id: Unique identifier for the comment
        file: Source file path
        line: Line number in the file
        content: The comment text
        is_satd: Whether detected as SATD
        is_explicit: Whether contains explicit SATD markers
        is_implicit: Whether contains implicit SATD indicators
        confidence: Detection confidence score (0-1)
        satd_type: Type of technical debt (if applicable)
        metadata: Additional method-specific information
    """
    id: str
    file: str
    line: int
    content: str
    is_satd: bool
    is_explicit: bool = False
    is_implicit: bool = False
    confidence: float = 1.0
    satd_type: str = ""
    metadata: Dict = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for serialization."""
        return asdict(self)


@dataclass
class EvaluationResult:
    """
    Aggregated evaluation results for a detector.
    
    Attributes:
        method_name: Name of the detection method
        method_year: Year the method was published
        total_comments: Total number of comments evaluated
        detected_satd: Number of comments detected as SATD
        true_positives: Correctly identified SATD
        false_positives: Incorrectly identified as SATD
        false_negatives: Missed SATD instances
        precision: Precision score
        recall: Recall score
        f1_score: F1 score
        explicit_f1: F1 for explicit SATD only
        implicit_f1: F1 for implicit SATD only
        detection_time: Time taken for detection (seconds)
    """
    method_name: str
    method_year: str
    total_comments: int = 0
    detected_satd: int = 0
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    explicit_f1: float = 0.0
    implicit_f1: float = 0.0
    detection_time: float = 0.0
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for serialization."""
        return asdict(self)


class BaseDetector(ABC):
    """
    Abstract base class for SATD detection methods.
    
    All baseline implementations must inherit from this class and implement:
    - name: Property returning the method name
    - year: Property returning the publication year
    - detect(): Method to detect SATD in comments
    - train(): Method to train the model (if applicable)
    """
    
    def __init__(self, random_seed: int = 42):
        """
        Initialize the detector.
        
        Args:
            random_seed: Random seed for reproducibility
        """
        self.random_seed = random_seed
        self._is_trained = False
        self._training_time = 0.0
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Return the name of the detection method."""
        pass
    
    @property
    @abstractmethod
    def year(self) -> str:
        """Return the publication year of the method."""
        pass
    
    @property
    def description(self) -> str:
        """Return a brief description of the method."""
        return f"{self.name} ({self.year})"
    
    @property
    def is_trained(self) -> bool:
        """Check if the model has been trained."""
        return self._is_trained
    
    @property
    def requires_training(self) -> bool:
        """Check if this method requires training before detection."""
        return True
    
    @abstractmethod
    def detect(self, comments: List[Dict]) -> List[DetectionResult]:
        """
        Detect SATD in a list of comments.
        
        Args:
            comments: List of comment dictionaries with keys:
                - id: Unique identifier
                - file: Source file path
                - line: Line number
                - content: Comment text
                - is_explicit_satd: (optional) Whether it's explicit SATD
                - is_implicit_satd: (optional) Whether it's implicit SATD
                
        Returns:
            List of DetectionResult objects
        """
        pass
    
    def train(self, 
              labeled_data: List[Dict], 
              unlabeled_data: Optional[List[Dict]] = None) -> None:
        """
        Train the model on labeled (and optionally unlabeled) data.
        
        Args:
            labeled_data: List of labeled comments with 'manual_label' field
            unlabeled_data: Optional list of unlabeled comments for semi-supervised methods
        """
        # Default implementation for methods that don't require training
        self._is_trained = True
    
    def detect_with_timing(self, comments: List[Dict]) -> Tuple[List[DetectionResult], float]:
        """
        Detect SATD with timing information.
        
        Args:
            comments: List of comment dictionaries
            
        Returns:
            Tuple of (detection_results, time_seconds)
        """
        start_time = time.time()
        results = self.detect(comments)
        elapsed = time.time() - start_time
        return results, elapsed
    
    def evaluate(self, 
                 comments: List[Dict], 
                 ground_truth: List[Dict],
                 line_tolerance: int = 5) -> EvaluationResult:
        """
        Evaluate the detector against ground truth.
        
        Args:
            comments: List of all comments to evaluate
            ground_truth: List of ground truth SATD annotations
            line_tolerance: Maximum line difference for matching
            
        Returns:
            EvaluationResult with computed metrics
        """
        # Run detection
        results, detection_time = self.detect_with_timing(comments)
        
        # Convert results to comparable format
        detected = [r for r in results if r.is_satd]
        
        # Calculate metrics
        from ..utils import match_comments, calculate_metrics
        
        # Convert DetectionResult to Dict for matching
        detected_dicts = [r.to_dict() for r in detected]
        
        match_result = match_comments(detected_dicts, ground_truth, line_tolerance)
        metrics = match_result.get_metrics()
        
        # Calculate type-specific metrics
        explicit_gt = [g for g in ground_truth if str(g.get('is_explicit', '')).lower() == 'true']
        implicit_gt = [g for g in ground_truth 
                      if str(g.get('is_implicit', '')).lower() == 'true' 
                      and str(g.get('is_explicit', '')).lower() != 'true']
        
        explicit_det = [r.to_dict() for r in detected if r.is_explicit]
        implicit_det = [r.to_dict() for r in detected if r.is_implicit and not r.is_explicit]
        
        explicit_match = match_comments(explicit_det, explicit_gt, line_tolerance)
        implicit_match = match_comments(implicit_det, implicit_gt, line_tolerance)
        
        explicit_f1 = explicit_match.get_metrics().f1_score if explicit_gt else 0.0
        implicit_f1 = implicit_match.get_metrics().f1_score if implicit_gt else 0.0
        
        return EvaluationResult(
            method_name=self.name,
            method_year=self.year,
            total_comments=len(comments),
            detected_satd=len(detected),
            true_positives=metrics.true_positives,
            false_positives=metrics.false_positives,
            false_negatives=metrics.false_negatives,
            precision=metrics.precision,
            recall=metrics.recall,
            f1_score=metrics.f1_score,
            explicit_f1=explicit_f1,
            implicit_f1=implicit_f1,
            detection_time=round(detection_time, 2)
        )
    
    def save_model(self, path: Path) -> None:
        """
        Save the trained model to disk.
        
        Args:
            path: Path to save the model
        """
        # Default implementation - override in subclasses
        pass
    
    def load_model(self, path: Path) -> None:
        """
        Load a trained model from disk.
        
        Args:
            path: Path to load the model from
        """
        # Default implementation - override in subclasses
        self._is_trained = True
    
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name='{self.name}', year='{self.year}')"

