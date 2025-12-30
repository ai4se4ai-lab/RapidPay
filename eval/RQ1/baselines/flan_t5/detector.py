#!/usr/bin/env python3
"""
Fine-tuned Flan-T5 SATD Detector

Implementation of fine-tuned Flan-T5 for SATD detection based on
Sheikhaei et al. (2024) EMSE paper.

Key Features:
- Uses Flan-T5 sequence-to-sequence model
- Formats SATD detection as text generation task
- Supports fine-tuning on labeled data
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
        T5Tokenizer,
        T5ForConditionalGeneration,
        Trainer,
        TrainingArguments,
        DataCollatorForSeq2Seq
    )
    from datasets import Dataset
    import torch
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False

# Check for scikit-learn (fallback)
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    FALLBACK_AVAILABLE = True
except ImportError:
    FALLBACK_AVAILABLE = False


class FlanT5Detector(BaseDetector):
    """
    Fine-tuned Flan-T5 SATD detector.
    
    Uses sequence-to-sequence learning with instruction-tuning
    for SATD classification.
    """
    
    def __init__(self,
                 random_seed: int = 42,
                 model_name: str = "google/flan-t5-small",
                 max_input_length: int = 256,
                 max_output_length: int = 8,
                 num_epochs: int = 3,
                 batch_size: int = 8,
                 learning_rate: float = 5e-5,
                 use_fallback: bool = None):
        """
        Initialize the Flan-T5 detector.
        
        Args:
            random_seed: Random seed for reproducibility
            model_name: Hugging Face model name (flan-t5-small/base/large)
            max_input_length: Maximum input token length
            max_output_length: Maximum output token length
            num_epochs: Number of fine-tuning epochs
            batch_size: Training batch size
            learning_rate: Learning rate for fine-tuning
            use_fallback: Force fallback mode (auto-detect if None)
        """
        super().__init__(random_seed)
        
        self.model_name = model_name
        self.max_input_length = max_input_length
        self.max_output_length = max_output_length
        self.num_epochs = num_epochs
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        
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
        self._tokenizer = None
        self._model = None
        self._fallback_vectorizer = None
        self._fallback_classifier = None
        
        # Prompt template for instruction-tuning
        self._prompt_template = (
            "Is the following code comment an instance of Self-Admitted Technical Debt (SATD)? "
            "SATD includes TODO, FIXME, HACK comments, or any comment indicating "
            "suboptimal code that should be improved later.\n\n"
            "Comment: {comment}\n\n"
            "Answer with 'yes' or 'no':"
        )
        
        random.seed(random_seed)
        np.random.seed(random_seed)
        if not self.use_fallback:
            torch.manual_seed(random_seed)
    
    @property
    def name(self) -> str:
        return "Fine-tuned Flan-T5"
    
    @property
    def year(self) -> str:
        return "2024"
    
    @property
    def description(self) -> str:
        mode = "fallback" if self.use_fallback else self.model_name
        return f"Fine-tuned Flan-T5 seq2seq ({mode})"
    
    def _format_input(self, comment: str) -> str:
        """Format comment as instruction-tuned input."""
        return self._prompt_template.format(comment=comment[:500])  # Truncate long comments
    
    def _format_output(self, is_satd: bool) -> str:
        """Format expected output."""
        return "yes" if is_satd else "no"
    
    def train(self,
              labeled_data: List[Dict],
              unlabeled_data: Optional[List[Dict]] = None) -> None:
        """
        Fine-tune the model on labeled data.
        
        Args:
            labeled_data: List of labeled comments with 'manual_label' field
            unlabeled_data: Not used
        """
        if not labeled_data:
            raise ValueError("No labeled data provided for training")
        
        # Extract texts and labels
        inputs = []
        outputs = []
        
        for item in labeled_data:
            content = item.get('content', '')
            label = str(item.get('manual_label', '')).lower()
            
            if content and label in ['satd', 'non-satd']:
                inputs.append(self._format_input(content))
                outputs.append(self._format_output(label == 'satd'))
        
        if len(inputs) < 10:
            raise ValueError(f"Insufficient labeled data: {len(inputs)} samples")
        
        if self.use_fallback:
            self._train_fallback(inputs, outputs)
        else:
            self._train_t5(inputs, outputs)
        
        self._is_trained = True
    
    def _train_fallback(self, inputs: List[str], outputs: List[str]) -> None:
        """Train using fallback TF-IDF + Logistic Regression."""
        self._fallback_vectorizer = TfidfVectorizer(
            max_features=5000,
            ngram_range=(1, 3),
            stop_words='english'
        )
        
        # Convert outputs to binary labels
        labels = [1 if o == 'yes' else 0 for o in outputs]
        
        X = self._fallback_vectorizer.fit_transform(inputs)
        y = np.array(labels)
        
        self._fallback_classifier = LogisticRegression(
            random_state=self.random_seed,
            max_iter=1000,
            class_weight='balanced'
        )
        self._fallback_classifier.fit(X, y)
    
    def _train_t5(self, inputs: List[str], outputs: List[str]) -> None:
        """Fine-tune Flan-T5 model."""
        # Initialize tokenizer and model
        self._tokenizer = T5Tokenizer.from_pretrained(self.model_name)
        self._model = T5ForConditionalGeneration.from_pretrained(self.model_name)
        
        # Create dataset
        def preprocess_function(examples):
            model_inputs = self._tokenizer(
                examples['input'],
                max_length=self.max_input_length,
                truncation=True,
                padding='max_length'
            )
            
            labels = self._tokenizer(
                examples['output'],
                max_length=self.max_output_length,
                truncation=True,
                padding='max_length'
            )
            
            model_inputs['labels'] = labels['input_ids']
            return model_inputs
        
        dataset = Dataset.from_dict({
            'input': inputs,
            'output': outputs
        })
        
        tokenized_dataset = dataset.map(
            preprocess_function,
            batched=True,
            remove_columns=['input', 'output']
        )
        
        # Split for validation
        split = tokenized_dataset.train_test_split(test_size=0.1, seed=self.random_seed)
        
        # Training arguments
        training_args = TrainingArguments(
            output_dir='./flan_t5_results',
            num_train_epochs=self.num_epochs,
            per_device_train_batch_size=self.batch_size,
            per_device_eval_batch_size=self.batch_size,
            warmup_steps=50,
            weight_decay=0.01,
            learning_rate=self.learning_rate,
            logging_dir='./logs',
            logging_steps=10,
            evaluation_strategy='epoch',
            save_strategy='no',
            report_to='none',
            seed=self.random_seed,
            fp16=torch.cuda.is_available()
        )
        
        # Data collator
        data_collator = DataCollatorForSeq2Seq(
            tokenizer=self._tokenizer,
            model=self._model
        )
        
        # Initialize trainer
        trainer = Trainer(
            model=self._model,
            args=training_args,
            train_dataset=split['train'],
            eval_dataset=split['test'],
            data_collator=data_collator
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
                is_satd, confidence = self._predict_t5(content)
            
            # Determine explicit/implicit
            is_explicit = self._has_explicit_markers(content)
            is_implicit = is_satd and not is_explicit
            
            results.append(DetectionResult(
                id=comment.get('id', f'flan_t5-{i}'),
                file=comment.get('file', ''),
                line=int(comment.get('line', 0)),
                content=content,
                is_satd=is_satd,
                is_explicit=is_satd and is_explicit,
                is_implicit=is_implicit,
                confidence=round(confidence, 4),
                satd_type='design' if is_satd else '',
                metadata={
                    'detection_method': 'flan_t5',
                    'use_fallback': self.use_fallback,
                    'model_name': self.model_name if not self.use_fallback else 'fallback'
                }
            ))
        
        return results
    
    def _predict_fallback(self, text: str) -> Tuple[bool, float]:
        """Predict using fallback classifier."""
        formatted_input = self._format_input(text)
        X = self._fallback_vectorizer.transform([formatted_input])
        
        prediction = self._fallback_classifier.predict(X)[0]
        proba = self._fallback_classifier.predict_proba(X)[0]
        confidence = float(proba[1])
        
        return bool(prediction == 1), confidence
    
    def _predict_t5(self, text: str) -> Tuple[bool, float]:
        """Predict using Flan-T5 model."""
        formatted_input = self._format_input(text)
        
        # Tokenize input
        inputs = self._tokenizer(
            formatted_input,
            max_length=self.max_input_length,
            truncation=True,
            return_tensors='pt'
        )
        
        # Move to same device as model
        device = next(self._model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        # Generate output
        with torch.no_grad():
            outputs = self._model.generate(
                **inputs,
                max_length=self.max_output_length,
                num_beams=1,
                do_sample=False,
                output_scores=True,
                return_dict_in_generate=True
            )
            
            # Decode output
            generated_text = self._tokenizer.decode(
                outputs.sequences[0],
                skip_special_tokens=True
            ).strip().lower()
            
            # Determine prediction
            is_satd = 'yes' in generated_text
            
            # Calculate confidence from generation scores if available
            if outputs.scores:
                # Get the first token's logits (yes/no decision)
                first_token_logits = outputs.scores[0][0]
                proba = torch.softmax(first_token_logits, dim=-1)
                
                # Find token IDs for 'yes' and 'no'
                yes_id = self._tokenizer.encode('yes', add_special_tokens=False)[0]
                no_id = self._tokenizer.encode('no', add_special_tokens=False)[0]
                
                yes_prob = float(proba[yes_id]) if yes_id < len(proba) else 0.5
                no_prob = float(proba[no_id]) if no_id < len(proba) else 0.5
                
                # Normalize
                total = yes_prob + no_prob
                confidence = yes_prob / total if total > 0 else 0.5
            else:
                confidence = 0.9 if is_satd else 0.1
        
        return is_satd, confidence
    
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
                'model_name': self.model_name,
                'max_input_length': self.max_input_length,
                'max_output_length': self.max_output_length
            }
        }
        
        if self.use_fallback:
            model_data['vectorizer'] = self._fallback_vectorizer
            model_data['classifier'] = self._fallback_classifier
        else:
            # Save T5 model separately
            model_path = path.parent / 'flan_t5_model'
            self._model.save_pretrained(str(model_path))
            self._tokenizer.save_pretrained(str(model_path))
            model_data['t5_model_path'] = str(model_path)
        
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
            t5_path = model_data['t5_model_path']
            self._tokenizer = T5Tokenizer.from_pretrained(t5_path)
            self._model = T5ForConditionalGeneration.from_pretrained(t5_path)
            self._model.eval()
        
        self._is_trained = True


if __name__ == "__main__":
    print("Flan-T5 Detector Test")
    print("-" * 50)
    print(f"Transformers available: {TRANSFORMERS_AVAILABLE}")
    print(f"Fallback available: {FALLBACK_AVAILABLE}")
    
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
        {'content': 'HACK: quick fix for demo', 'manual_label': 'satd'},
        {'content': 'Calculate the average score', 'manual_label': 'non-satd'},
    ]
    
    test_comments = [
        {'id': '1', 'file': 'test.py', 'line': 10, 'content': 'TODO: fix this later'},
        {'id': '2', 'file': 'test.py', 'line': 20, 'content': 'This is a regular comment'},
    ]
    
    try:
        detector = FlanT5Detector(use_fallback=True)
        detector.train(labeled_data)
        
        results = detector.detect(test_comments)
        
        for result in results:
            status = "SATD" if result.is_satd else "Non-SATD"
            print(f"[{status}] ({result.confidence:.2f}) {result.content[:40]}...")
    except Exception as e:
        print(f"Error: {e}")

