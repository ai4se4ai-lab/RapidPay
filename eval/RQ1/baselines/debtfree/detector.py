#!/usr/bin/env python3
"""
DebtFree Semi-Supervised SATD Detector

Implementation of semi-supervised learning approach for SATD detection
based on Tu et al. (2022) EMSE paper.

Key Features:
- Uses self-training classifier with TF-IDF features
- Iteratively expands training set with high-confidence predictions
- Designed for scenarios with limited labeled data
"""

import sys
import pickle
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from baselines.base_detector import BaseDetector, DetectionResult

# Check for scikit-learn availability
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.semi_supervised import SelfTrainingClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import Pipeline
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False


class DebtFreeDetector(BaseDetector):
    """
    DebtFree semi-supervised SATD detector.
    
    Uses self-training with a TF-IDF + Logistic Regression base classifier
    to leverage both labeled and unlabeled data.
    """
    
    def __init__(self, 
                 random_seed: int = 42,
                 max_iter: int = 10,
                 threshold: float = 0.7,
                 max_features: int = 5000,
                 ngram_range: Tuple[int, int] = (1, 2)):
        """
        Initialize the DebtFree detector.
        
        Args:
            random_seed: Random seed for reproducibility
            max_iter: Maximum self-training iterations
            threshold: Confidence threshold for pseudo-labeling
            max_features: Maximum number of TF-IDF features
            ngram_range: N-gram range for TF-IDF
        """
        super().__init__(random_seed)
        
        if not SKLEARN_AVAILABLE:
            raise ImportError("scikit-learn is required for DebtFreeDetector. "
                            "Install with: pip install scikit-learn")
        
        self.max_iter = max_iter
        self.threshold = threshold
        self.max_features = max_features
        self.ngram_range = ngram_range
        
        # Initialize components
        self._vectorizer = TfidfVectorizer(
            max_features=max_features,
            ngram_range=ngram_range,
            stop_words='english',
            lowercase=True,
            min_df=2
        )
        
        self._base_classifier = LogisticRegression(
            random_state=random_seed,
            max_iter=1000,
            solver='lbfgs',
            class_weight='balanced'
        )
        
        self._self_trainer = None
        self._pipeline = None
    
    @property
    def name(self) -> str:
        return "DebtFree"
    
    @property
    def year(self) -> str:
        return "2022"
    
    @property
    def description(self) -> str:
        return "Semi-supervised learning with self-training (Tu et al., EMSE 2022)"
    
    def train(self, 
              labeled_data: List[Dict], 
              unlabeled_data: Optional[List[Dict]] = None) -> None:
        """
        Train the model using labeled and optionally unlabeled data.
        
        Args:
            labeled_data: List of labeled comments with 'manual_label' field
            unlabeled_data: Optional list of unlabeled comments for self-training
        """
        if not labeled_data:
            raise ValueError("No labeled data provided for training")
        
        # Extract texts and labels from labeled data
        labeled_texts = []
        labels = []
        
        for item in labeled_data:
            content = item.get('content', '')
            label = str(item.get('manual_label', '')).lower()
            
            if content and label in ['satd', 'non-satd']:
                labeled_texts.append(content)
                labels.append(1 if label == 'satd' else 0)
        
        if len(labeled_texts) < 10:
            raise ValueError(f"Insufficient labeled data: {len(labeled_texts)} samples")
        
        # If unlabeled data is provided, use self-training
        if unlabeled_data and len(unlabeled_data) > 0:
            self._train_semi_supervised(labeled_texts, labels, unlabeled_data)
        else:
            self._train_supervised(labeled_texts, labels)
        
        self._is_trained = True
    
    def _train_supervised(self, texts: List[str], labels: List[int]) -> None:
        """Train using supervised learning only."""
        # Fit vectorizer
        X = self._vectorizer.fit_transform(texts)
        y = np.array(labels)
        
        # Train classifier
        self._base_classifier.fit(X, y)
    
    def _train_semi_supervised(self, 
                                labeled_texts: List[str], 
                                labels: List[int],
                                unlabeled_data: List[Dict]) -> None:
        """Train using semi-supervised self-training."""
        # Extract unlabeled texts
        unlabeled_texts = [item.get('content', '') for item in unlabeled_data 
                         if item.get('content', '')]
        
        # Combine labeled and unlabeled texts for vectorizer fitting
        all_texts = labeled_texts + unlabeled_texts
        
        # Fit vectorizer on all data
        self._vectorizer.fit(all_texts)
        
        # Transform data
        X_labeled = self._vectorizer.transform(labeled_texts)
        X_unlabeled = self._vectorizer.transform(unlabeled_texts)
        
        # Create combined feature matrix
        from scipy import sparse
        X_combined = sparse.vstack([X_labeled, X_unlabeled])
        
        # Labels: known for labeled data, -1 for unlabeled
        y_labeled = np.array(labels)
        y_unlabeled = np.full(len(unlabeled_texts), -1)  # -1 indicates unlabeled
        y_combined = np.concatenate([y_labeled, y_unlabeled])
        
        # Create self-training classifier
        self._self_trainer = SelfTrainingClassifier(
            base_estimator=LogisticRegression(
                random_state=self.random_seed,
                max_iter=1000,
                solver='lbfgs',
                class_weight='balanced'
            ),
            threshold=self.threshold,
            max_iter=self.max_iter,
            verbose=False
        )
        
        # Fit self-trainer
        self._self_trainer.fit(X_combined, y_combined)
    
    def detect(self, comments: List[Dict]) -> List[DetectionResult]:
        """
        Detect SATD in comments.
        
        Args:
            comments: List of comment dictionaries
            
        Returns:
            List of DetectionResult objects
        """
        if not self._is_trained:
            raise RuntimeError("Model must be trained before detection. Call train() first.")
        
        results = []
        
        # Extract texts
        texts = [c.get('content', '') for c in comments]
        
        if not texts:
            return results
        
        # Transform using fitted vectorizer
        X = self._vectorizer.transform(texts)
        
        # Get predictions and probabilities
        if self._self_trainer is not None:
            predictions = self._self_trainer.predict(X)
            proba = self._self_trainer.predict_proba(X)
        else:
            predictions = self._base_classifier.predict(X)
            proba = self._base_classifier.predict_proba(X)
        
        # Build results
        for i, comment in enumerate(comments):
            is_satd = bool(predictions[i] == 1)
            
            # Get confidence for the positive class
            confidence = float(proba[i, 1]) if proba.shape[1] > 1 else float(proba[i, 0])
            
            # Determine if explicit or implicit based on patterns
            content = comment.get('content', '')
            is_explicit = self._has_explicit_markers(content)
            is_implicit = is_satd and not is_explicit
            
            results.append(DetectionResult(
                id=comment.get('id', f'debtfree-{i}'),
                file=comment.get('file', ''),
                line=int(comment.get('line', 0)),
                content=content,
                is_satd=is_satd,
                is_explicit=is_satd and is_explicit,
                is_implicit=is_implicit,
                confidence=round(confidence, 4),
                satd_type='design' if is_satd else '',
                metadata={
                    'detection_method': 'debtfree_semi_supervised',
                    'raw_probability': confidence
                }
            ))
        
        return results
    
    def _has_explicit_markers(self, content: str) -> bool:
        """Check if content has explicit SATD markers."""
        import re
        explicit_patterns = [
            r'\bTODO\b', r'\bFIXME\b', r'\bHACK\b', r'\bXXX\b',
            r'\bBUG\b', r'\bKLUDGE\b', r'\bTEMP\b', r'\bDEPRECATED\b'
        ]
        for pattern in explicit_patterns:
            if re.search(pattern, content, re.IGNORECASE):
                return True
        return False
    
    def save_model(self, path: Path) -> None:
        """Save trained model to disk."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        
        model_data = {
            'vectorizer': self._vectorizer,
            'base_classifier': self._base_classifier,
            'self_trainer': self._self_trainer,
            'config': {
                'max_iter': self.max_iter,
                'threshold': self.threshold,
                'max_features': self.max_features,
                'ngram_range': self.ngram_range
            }
        }
        
        with open(path, 'wb') as f:
            pickle.dump(model_data, f)
    
    def load_model(self, path: Path) -> None:
        """Load trained model from disk."""
        with open(path, 'rb') as f:
            model_data = pickle.load(f)
        
        self._vectorizer = model_data['vectorizer']
        self._base_classifier = model_data['base_classifier']
        self._self_trainer = model_data.get('self_trainer')
        self._is_trained = True


if __name__ == "__main__":
    # Test the DebtFree detector
    print("DebtFree Detector Test")
    print("-" * 50)
    
    # Sample training data
    labeled_data = [
        {'content': 'TODO: fix this bug later', 'manual_label': 'satd'},
        {'content': 'FIXME: memory leak here', 'manual_label': 'satd'},
        {'content': 'This is a workaround for the issue', 'manual_label': 'satd'},
        {'content': 'Need to refactor this code', 'manual_label': 'satd'},
        {'content': 'Regular function documentation', 'manual_label': 'non-satd'},
        {'content': 'Returns the sum of two numbers', 'manual_label': 'non-satd'},
        {'content': 'Initialize the configuration', 'manual_label': 'non-satd'},
        {'content': 'Process the input data', 'manual_label': 'non-satd'},
        {'content': 'HACK: temporary solution', 'manual_label': 'satd'},
        {'content': 'This should be improved later', 'manual_label': 'satd'},
    ]
    
    # Test comments
    test_comments = [
        {'id': '1', 'file': 'test.py', 'line': 10, 'content': 'TODO: fix this later'},
        {'id': '2', 'file': 'test.py', 'line': 20, 'content': 'This is a regular comment'},
        {'id': '3', 'file': 'test.py', 'line': 30, 'content': 'Need to refactor this mess'},
    ]
    
    try:
        detector = DebtFreeDetector()
        detector.train(labeled_data)
        
        results = detector.detect(test_comments)
        
        for result in results:
            status = "SATD" if result.is_satd else "Non-SATD"
            print(f"[{status}] ({result.confidence:.2f}) {result.content[:40]}...")
    except ImportError as e:
        print(f"Error: {e}")

