#!/usr/bin/env python3
"""
SATDAug Data Augmentation-Based SATD Detector

Implementation of data augmentation approach for SATD detection
based on Sutoyo et al. (2024).

Key Features:
- Applies data augmentation to training data
- Uses DistilBERT for text classification
- Supports synonym replacement and random word operations
"""

import sys
import pickle
import random
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from baselines.base_detector import BaseDetector, DetectionResult

# Check for transformers availability
try:
    from transformers import (
        DistilBertTokenizer, 
        DistilBertForSequenceClassification,
        Trainer, 
        TrainingArguments,
        DataCollatorWithPadding
    )
    from datasets import Dataset
    import torch
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False

# Check for scikit-learn (fallback)
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    FALLBACK_AVAILABLE = True
except ImportError:
    FALLBACK_AVAILABLE = False

# Check for nltk (for augmentation)
try:
    import nltk
    from nltk.corpus import wordnet
    NLTK_AVAILABLE = True
except ImportError:
    NLTK_AVAILABLE = False


class DataAugmenter:
    """Text data augmentation utilities."""
    
    def __init__(self, random_seed: int = 42):
        self.random = random.Random(random_seed)
        
        # Download wordnet if available
        if NLTK_AVAILABLE:
            try:
                nltk.data.find('corpora/wordnet')
            except LookupError:
                try:
                    nltk.download('wordnet', quiet=True)
                except:
                    pass
    
    def synonym_replacement(self, text: str, n: int = 2) -> str:
        """Replace n words with synonyms."""
        if not NLTK_AVAILABLE:
            return text
        
        words = text.split()
        if len(words) < 3:
            return text
        
        new_words = words.copy()
        replaceable_indices = [
            i for i, w in enumerate(words) 
            if len(w) > 3 and w.isalpha()
        ]
        
        if not replaceable_indices:
            return text
        
        n = min(n, len(replaceable_indices))
        indices_to_replace = self.random.sample(replaceable_indices, n)
        
        for idx in indices_to_replace:
            word = words[idx]
            synonyms = self._get_synonyms(word)
            if synonyms:
                new_words[idx] = self.random.choice(synonyms)
        
        return ' '.join(new_words)
    
    def _get_synonyms(self, word: str) -> List[str]:
        """Get synonyms for a word using WordNet."""
        if not NLTK_AVAILABLE:
            return []
        
        synonyms = set()
        for syn in wordnet.synsets(word):
            for lemma in syn.lemmas():
                synonym = lemma.name().replace('_', ' ')
                if synonym.lower() != word.lower():
                    synonyms.add(synonym)
        
        return list(synonyms)[:5]
    
    def random_deletion(self, text: str, p: float = 0.1) -> str:
        """Randomly delete words with probability p."""
        words = text.split()
        if len(words) <= 3:
            return text
        
        new_words = [w for w in words if self.random.random() > p]
        
        if not new_words:
            return self.random.choice(words)
        
        return ' '.join(new_words)
    
    def random_swap(self, text: str, n: int = 1) -> str:
        """Randomly swap n pairs of words."""
        words = text.split()
        if len(words) < 4:
            return text
        
        new_words = words.copy()
        
        for _ in range(n):
            idx1, idx2 = self.random.sample(range(len(new_words)), 2)
            new_words[idx1], new_words[idx2] = new_words[idx2], new_words[idx1]
        
        return ' '.join(new_words)
    
    def random_insertion(self, text: str, n: int = 1) -> str:
        """Randomly insert synonyms n times."""
        if not NLTK_AVAILABLE:
            return text
        
        words = text.split()
        if not words:
            return text
        
        new_words = words.copy()
        
        for _ in range(n):
            random_word = self.random.choice(words)
            synonyms = self._get_synonyms(random_word)
            if synonyms:
                synonym = self.random.choice(synonyms)
                insert_idx = self.random.randint(0, len(new_words))
                new_words.insert(insert_idx, synonym)
        
        return ' '.join(new_words)
    
    def augment(self, text: str, num_augments: int = 4) -> List[str]:
        """Apply multiple augmentation techniques."""
        augmented = [text]  # Original text
        
        methods = [
            self.synonym_replacement,
            self.random_deletion,
            self.random_swap,
            self.random_insertion
        ]
        
        for _ in range(num_augments):
            method = self.random.choice(methods)
            aug_text = method(text)
            if aug_text != text:
                augmented.append(aug_text)
        
        return augmented


class SATDAugDetector(BaseDetector):
    """
    SATDAug SATD detector with data augmentation.
    
    Uses data augmentation to expand training data and improve
    classifier robustness.
    """
    
    def __init__(self,
                 random_seed: int = 42,
                 num_augments: int = 4,
                 max_length: int = 128,
                 num_epochs: int = 3,
                 batch_size: int = 16,
                 use_fallback: bool = None):
        """
        Initialize the SATDAug detector.
        
        Args:
            random_seed: Random seed for reproducibility
            num_augments: Number of augmented samples per original
            max_length: Maximum token length for BERT
            num_epochs: Number of training epochs
            batch_size: Training batch size
            use_fallback: Force fallback mode (auto-detect if None)
        """
        super().__init__(random_seed)
        
        self.num_augments = num_augments
        self.max_length = max_length
        self.num_epochs = num_epochs
        self.batch_size = batch_size
        
        # Determine backend
        if use_fallback is None:
            self.use_fallback = not TRANSFORMERS_AVAILABLE
        else:
            self.use_fallback = use_fallback
        
        if not self.use_fallback and not TRANSFORMERS_AVAILABLE:
            raise ImportError("transformers not available and fallback disabled")
        
        if self.use_fallback and not FALLBACK_AVAILABLE:
            raise ImportError("Fallback requires scikit-learn")
        
        # Initialize components
        self._augmenter = DataAugmenter(random_seed)
        self._tokenizer = None
        self._model = None
        self._fallback_vectorizer = None
        self._fallback_classifier = None
        
        random.seed(random_seed)
        np.random.seed(random_seed)
        if not self.use_fallback:
            torch.manual_seed(random_seed)
    
    @property
    def name(self) -> str:
        return "SATDAug"
    
    @property
    def year(self) -> str:
        return "2024"
    
    @property
    def description(self) -> str:
        mode = "fallback" if self.use_fallback else "DistilBERT"
        return f"Data augmentation-based detection ({mode})"
    
    def train(self,
              labeled_data: List[Dict],
              unlabeled_data: Optional[List[Dict]] = None) -> None:
        """
        Train the model with augmented data.
        
        Args:
            labeled_data: List of labeled comments with 'manual_label' field
            unlabeled_data: Not used
        """
        if not labeled_data:
            raise ValueError("No labeled data provided for training")
        
        # Extract texts and labels
        texts = []
        labels = []
        
        for item in labeled_data:
            content = item.get('content', '')
            label = str(item.get('manual_label', '')).lower()
            
            if content and label in ['satd', 'non-satd']:
                texts.append(content)
                labels.append(1 if label == 'satd' else 0)
        
        if len(texts) < 10:
            raise ValueError(f"Insufficient labeled data: {len(texts)} samples")
        
        # Augment training data
        aug_texts, aug_labels = self._augment_data(texts, labels)
        
        if self.use_fallback:
            self._train_fallback(aug_texts, aug_labels)
        else:
            self._train_bert(aug_texts, aug_labels)
        
        self._is_trained = True
    
    def _augment_data(self, texts: List[str], labels: List[int]) -> Tuple[List[str], List[int]]:
        """Augment training data."""
        aug_texts = []
        aug_labels = []
        
        for text, label in zip(texts, labels):
            # Keep original
            aug_texts.append(text)
            aug_labels.append(label)
            
            # Add augmented versions
            augmented = self._augmenter.augment(text, self.num_augments)
            for aug_text in augmented[1:]:  # Skip original
                aug_texts.append(aug_text)
                aug_labels.append(label)
        
        return aug_texts, aug_labels
    
    def _train_fallback(self, texts: List[str], labels: List[int]) -> None:
        """Train using fallback TF-IDF + Random Forest."""
        self._fallback_vectorizer = TfidfVectorizer(
            max_features=5000,
            ngram_range=(1, 2),
            stop_words='english'
        )
        
        X = self._fallback_vectorizer.fit_transform(texts)
        y = np.array(labels)
        
        self._fallback_classifier = RandomForestClassifier(
            n_estimators=100,
            random_state=self.random_seed,
            class_weight='balanced'
        )
        self._fallback_classifier.fit(X, y)
    
    def _train_bert(self, texts: List[str], labels: List[int]) -> None:
        """Train using DistilBERT."""
        # Initialize tokenizer and model
        self._tokenizer = DistilBertTokenizer.from_pretrained('distilbert-base-uncased')
        self._model = DistilBertForSequenceClassification.from_pretrained(
            'distilbert-base-uncased',
            num_labels=2
        )
        
        # Create dataset
        def tokenize_function(examples):
            return self._tokenizer(
                examples['text'],
                padding='max_length',
                truncation=True,
                max_length=self.max_length
            )
        
        dataset = Dataset.from_dict({
            'text': texts,
            'label': labels
        })
        
        tokenized_dataset = dataset.map(tokenize_function, batched=True)
        tokenized_dataset = tokenized_dataset.remove_columns(['text'])
        tokenized_dataset = tokenized_dataset.rename_column('label', 'labels')
        tokenized_dataset.set_format('torch')
        
        # Split for validation
        split = tokenized_dataset.train_test_split(test_size=0.1, seed=self.random_seed)
        
        # Training arguments
        training_args = TrainingArguments(
            output_dir='./satdaug_results',
            num_train_epochs=self.num_epochs,
            per_device_train_batch_size=self.batch_size,
            per_device_eval_batch_size=self.batch_size,
            warmup_steps=100,
            weight_decay=0.01,
            logging_dir='./logs',
            logging_steps=10,
            evaluation_strategy='epoch',
            save_strategy='no',
            report_to='none',
            seed=self.random_seed
        )
        
        # Initialize trainer
        trainer = Trainer(
            model=self._model,
            args=training_args,
            train_dataset=split['train'],
            eval_dataset=split['test'],
            data_collator=DataCollatorWithPadding(tokenizer=self._tokenizer)
        )
        
        # Train
        trainer.train()
        
        # Set to eval mode
        self._model.eval()
    
    def detect(self, comments: List[Dict]) -> List[DetectionResult]:
        """
        Detect SATD in comments.
        
        Args:
            comments: List of comment dictionaries
            
        Returns:
            List of DetectionResult objects
        """
        if not self._is_trained:
            raise RuntimeError("Model must be trained before detection")
        
        results = []
        
        for i, comment in enumerate(comments):
            content = comment.get('content', '')
            
            if self.use_fallback:
                is_satd, confidence = self._predict_fallback(content)
            else:
                is_satd, confidence = self._predict_bert(content)
            
            # Determine explicit/implicit
            is_explicit = self._has_explicit_markers(content)
            is_implicit = is_satd and not is_explicit
            
            results.append(DetectionResult(
                id=comment.get('id', f'satdaug-{i}'),
                file=comment.get('file', ''),
                line=int(comment.get('line', 0)),
                content=content,
                is_satd=is_satd,
                is_explicit=is_satd and is_explicit,
                is_implicit=is_implicit,
                confidence=round(confidence, 4),
                satd_type='design' if is_satd else '',
                metadata={
                    'detection_method': 'satdaug',
                    'use_fallback': self.use_fallback
                }
            ))
        
        return results
    
    def _predict_fallback(self, text: str) -> Tuple[bool, float]:
        """Predict using fallback classifier."""
        X = self._fallback_vectorizer.transform([text])
        prediction = self._fallback_classifier.predict(X)[0]
        proba = self._fallback_classifier.predict_proba(X)[0]
        confidence = float(proba[1])
        
        return bool(prediction == 1), confidence
    
    def _predict_bert(self, text: str) -> Tuple[bool, float]:
        """Predict using BERT model."""
        inputs = self._tokenizer(
            text,
            padding='max_length',
            truncation=True,
            max_length=self.max_length,
            return_tensors='pt'
        )
        
        with torch.no_grad():
            outputs = self._model(**inputs)
            logits = outputs.logits
            proba = torch.softmax(logits, dim=1)
            
            prediction = logits.argmax(dim=1).item()
            confidence = float(proba[0, 1])
        
        return bool(prediction == 1), confidence
    
    def _has_explicit_markers(self, content: str) -> bool:
        """Check for explicit SATD markers."""
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
            'use_fallback': self.use_fallback,
            'config': {
                'num_augments': self.num_augments,
                'max_length': self.max_length
            }
        }
        
        if self.use_fallback:
            model_data['vectorizer'] = self._fallback_vectorizer
            model_data['classifier'] = self._fallback_classifier
        else:
            # For BERT, save the model separately
            model_path = path.parent / 'satdaug_bert_model'
            self._model.save_pretrained(str(model_path))
            self._tokenizer.save_pretrained(str(model_path))
            model_data['bert_model_path'] = str(model_path)
        
        with open(path, 'wb') as f:
            pickle.dump(model_data, f)
    
    def load_model(self, path: Path) -> None:
        """Load trained model from disk."""
        with open(path, 'rb') as f:
            model_data = pickle.load(f)
        
        self.use_fallback = model_data['use_fallback']
        
        if self.use_fallback:
            self._fallback_vectorizer = model_data['vectorizer']
            self._fallback_classifier = model_data['classifier']
        else:
            bert_path = model_data['bert_model_path']
            self._tokenizer = DistilBertTokenizer.from_pretrained(bert_path)
            self._model = DistilBertForSequenceClassification.from_pretrained(bert_path)
            self._model.eval()
        
        self._is_trained = True


if __name__ == "__main__":
    print("SATDAug Detector Test")
    print("-" * 50)
    print(f"Transformers available: {TRANSFORMERS_AVAILABLE}")
    print(f"Fallback available: {FALLBACK_AVAILABLE}")
    print(f"NLTK available: {NLTK_AVAILABLE}")
    
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
    ]
    
    test_comments = [
        {'id': '1', 'file': 'test.py', 'line': 10, 'content': 'TODO: fix this later'},
        {'id': '2', 'file': 'test.py', 'line': 20, 'content': 'This is a regular comment'},
    ]
    
    try:
        detector = SATDAugDetector(use_fallback=True, num_augments=2)
        detector.train(labeled_data)
        
        results = detector.detect(test_comments)
        
        for result in results:
            status = "SATD" if result.is_satd else "Non-SATD"
            print(f"[{status}] ({result.confidence:.2f}) {result.content[:40]}...")
    except Exception as e:
        print(f"Error: {e}")

