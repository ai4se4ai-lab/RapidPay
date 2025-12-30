#!/usr/bin/env python3
"""
Lexical-Only Baseline Detector

A pure pattern-matching baseline that detects SATD using keyword/regex patterns
without any semantic understanding. This represents traditional SATD detection
approaches like those from Potdar & Shihab (2014) and Maldonado & Shihab (2015).

This baseline typically achieves:
- High recall (catches most explicit markers)
- Lower precision (many false positives from ambiguous keywords)
"""

import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from .base_detector import BaseDetector, DetectionResult


class LexicalBaseline(BaseDetector):
    """
    Lexical-only SATD detector using pattern matching.
    
    This detector flags any comment containing SATD patterns (explicit or implicit)
    as technical debt, without applying semantic analysis.
    """
    
    def __init__(self, 
                 random_seed: int = 42,
                 explicit_patterns: Optional[List[str]] = None,
                 implicit_patterns: Optional[List[str]] = None,
                 use_implicit: bool = True):
        """
        Initialize the lexical baseline detector.
        
        Args:
            random_seed: Random seed for reproducibility
            explicit_patterns: List of regex patterns for explicit SATD
            implicit_patterns: List of regex patterns for implicit SATD
            use_implicit: Whether to use implicit patterns (default: True)
        """
        super().__init__(random_seed)
        
        # Load patterns from config if not provided
        if explicit_patterns is None or implicit_patterns is None:
            from utils import get_satd_patterns
            patterns = get_satd_patterns()
            self._explicit_patterns = explicit_patterns or patterns.get('explicit', [])
            self._implicit_patterns = implicit_patterns or patterns.get('implicit', [])
        else:
            self._explicit_patterns = explicit_patterns
            self._implicit_patterns = implicit_patterns
        
        self._use_implicit = use_implicit
        
        # Compile patterns for efficiency
        self._compiled_explicit = [re.compile(p, re.IGNORECASE) for p in self._explicit_patterns]
        self._compiled_implicit = [re.compile(p, re.IGNORECASE) for p in self._implicit_patterns]
        
        # This method doesn't require training
        self._is_trained = True
    
    @property
    def name(self) -> str:
        return "Lexical-only"
    
    @property
    def year(self) -> str:
        return "---"
    
    @property
    def description(self) -> str:
        return "Pattern-matching baseline using keyword detection"
    
    @property
    def requires_training(self) -> bool:
        return False
    
    def detect(self, comments: List[Dict]) -> List[DetectionResult]:
        """
        Detect SATD using pattern matching.
        
        Args:
            comments: List of comment dictionaries
            
        Returns:
            List of DetectionResult objects
        """
        results = []
        
        for comment in comments:
            comment_id = comment.get('id', '')
            file_path = comment.get('file', '')
            line = int(comment.get('line', 0))
            content = comment.get('content', '')
            
            # Check for pattern matches
            is_explicit, explicit_matches = self._check_explicit(content)
            is_implicit, implicit_matches = self._check_implicit(content) if self._use_implicit else (False, [])
            
            is_satd = is_explicit or is_implicit
            
            # Calculate confidence based on number of pattern matches
            total_matches = len(explicit_matches) + len(implicit_matches)
            confidence = min(1.0, 0.5 + (total_matches * 0.1)) if is_satd else 0.0
            
            # Determine SATD type based on patterns
            satd_type = self._determine_satd_type(explicit_matches, implicit_matches)
            
            results.append(DetectionResult(
                id=comment_id,
                file=file_path,
                line=line,
                content=content,
                is_satd=is_satd,
                is_explicit=is_explicit,
                is_implicit=is_implicit and not is_explicit,
                confidence=confidence,
                satd_type=satd_type,
                metadata={
                    'explicit_matches': explicit_matches,
                    'implicit_matches': implicit_matches,
                    'detection_method': 'lexical'
                }
            ))
        
        return results
    
    def _check_explicit(self, content: str) -> tuple:
        """Check for explicit SATD patterns."""
        matches = []
        for i, pattern in enumerate(self._compiled_explicit):
            if pattern.search(content):
                matches.append(self._explicit_patterns[i])
        return len(matches) > 0, matches
    
    def _check_implicit(self, content: str) -> tuple:
        """Check for implicit SATD patterns."""
        matches = []
        for i, pattern in enumerate(self._compiled_implicit):
            if pattern.search(content):
                matches.append(self._implicit_patterns[i])
        return len(matches) > 0, matches
    
    def _determine_satd_type(self, explicit_matches: List[str], implicit_matches: List[str]) -> str:
        """Determine the SATD type based on matched patterns."""
        all_matches = explicit_matches + implicit_matches
        
        if not all_matches:
            return ""
        
        # Simple heuristic based on common pattern types
        type_map = {
            'TODO': 'design',
            'FIXME': 'defect',
            'HACK': 'design',
            'XXX': 'defect',
            'BUG': 'defect',
            'TEMP': 'design',
            'workaround': 'design',
            'refactor': 'design',
            'optimize': 'design',
            'cleanup': 'design',
            'broken': 'defect',
            'incomplete': 'requirement',
            'missing': 'requirement',
            'placeholder': 'design',
            'hardcode': 'design'
        }
        
        for pattern in all_matches:
            pattern_lower = pattern.lower()
            for keyword, debt_type in type_map.items():
                if keyword.lower() in pattern_lower:
                    return debt_type
        
        return 'design'  # Default type
    
    def train(self, labeled_data: List[Dict], unlabeled_data: Optional[List[Dict]] = None) -> None:
        """No training needed for lexical baseline."""
        self._is_trained = True


if __name__ == "__main__":
    # Test the lexical baseline
    test_comments = [
        {'id': '1', 'file': 'test.py', 'line': 10, 'content': 'TODO: fix this later'},
        {'id': '2', 'file': 'test.py', 'line': 20, 'content': 'This is a regular comment'},
        {'id': '3', 'file': 'test.py', 'line': 30, 'content': 'FIXME: memory leak here'},
        {'id': '4', 'file': 'test.py', 'line': 40, 'content': 'This is a workaround for now'},
        {'id': '5', 'file': 'test.py', 'line': 50, 'content': 'Should be refactored in the future'},
    ]
    
    detector = LexicalBaseline()
    results = detector.detect(test_comments)
    
    print(f"Lexical Baseline Detector: {detector.description}")
    print("-" * 50)
    
    for result in results:
        status = "SATD" if result.is_satd else "Non-SATD"
        explicit = "(explicit)" if result.is_explicit else "(implicit)" if result.is_implicit else ""
        print(f"[{status}] {explicit} Line {result.line}: {result.content[:50]}...")

