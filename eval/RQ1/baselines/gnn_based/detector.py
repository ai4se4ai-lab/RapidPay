#!/usr/bin/env python3
"""
GNN-Based SATD Detector

Implementation of Graph Neural Network-based SATD detection based on
Yu et al. (2022) approach. This detector represents comments as word
co-occurrence graphs and uses graph convolution for classification.

If PyTorch Geometric is not available, falls back to a simplified
graph-based approach using NetworkX and scikit-learn.
"""

import sys
import pickle
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from baselines.base_detector import BaseDetector, DetectionResult

# Check for PyTorch Geometric availability
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch_geometric.data import Data, Batch
    from torch_geometric.nn import GCNConv, global_mean_pool
    TORCH_GEOMETRIC_AVAILABLE = True
except ImportError:
    TORCH_GEOMETRIC_AVAILABLE = False

# Check for scikit-learn (fallback)
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler
    import networkx as nx
    FALLBACK_AVAILABLE = True
except ImportError:
    FALLBACK_AVAILABLE = False


# Define SimpleGCN only if PyTorch Geometric is available
if TORCH_GEOMETRIC_AVAILABLE:
    class SimpleGCN(nn.Module):
        """Simple Graph Convolutional Network for text classification."""
        
        def __init__(self, input_dim: int, hidden_dim: int = 64, num_classes: int = 2):
            super(SimpleGCN, self).__init__()
            self.conv1 = GCNConv(input_dim, hidden_dim)
            self.conv2 = GCNConv(hidden_dim, hidden_dim)
            self.fc = nn.Linear(hidden_dim, num_classes)
        
        def forward(self, x, edge_index, batch):
            x = F.relu(self.conv1(x, edge_index))
            x = F.dropout(x, p=0.5, training=self.training)
            x = F.relu(self.conv2(x, edge_index))
            x = global_mean_pool(x, batch)
            x = self.fc(x)
            return x
else:
    # Placeholder when PyTorch Geometric is not available
    SimpleGCN = None


class GNNBasedDetector(BaseDetector):
    """
    GNN-based SATD detector using graph representations.
    
    Represents each comment as a word co-occurrence graph and uses
    graph neural networks for classification.
    """
    
    def __init__(self,
                 random_seed: int = 42,
                 hidden_dim: int = 64,
                 num_epochs: int = 50,
                 learning_rate: float = 0.01,
                 window_size: int = 3,
                 use_fallback: bool = None):
        """
        Initialize the GNN-based detector.
        
        Args:
            random_seed: Random seed for reproducibility
            hidden_dim: Hidden dimension for GNN layers
            num_epochs: Number of training epochs
            learning_rate: Learning rate for optimizer
            window_size: Window size for word co-occurrence
            use_fallback: Force fallback mode (auto-detect if None)
        """
        super().__init__(random_seed)
        
        self.hidden_dim = hidden_dim
        self.num_epochs = num_epochs
        self.learning_rate = learning_rate
        self.window_size = window_size
        
        # Determine which backend to use
        if use_fallback is None:
            self.use_fallback = not TORCH_GEOMETRIC_AVAILABLE
        else:
            self.use_fallback = use_fallback
        
        if not self.use_fallback and not TORCH_GEOMETRIC_AVAILABLE:
            raise ImportError("PyTorch Geometric not available and fallback disabled")
        
        if self.use_fallback and not FALLBACK_AVAILABLE:
            raise ImportError("Fallback requires scikit-learn and networkx")
        
        # Initialize components based on mode
        self._word_to_idx = {}
        self._model = None
        self._vectorizer = None
        self._fallback_classifier = None
        self._scaler = None
        
        np.random.seed(random_seed)
        if not self.use_fallback:
            torch.manual_seed(random_seed)
    
    @property
    def name(self) -> str:
        return "GNN-based"
    
    @property
    def year(self) -> str:
        return "2022"
    
    @property
    def description(self) -> str:
        mode = "fallback" if self.use_fallback else "PyTorch Geometric"
        return f"Graph Neural Network-based detection ({mode})"
    
    def train(self,
              labeled_data: List[Dict],
              unlabeled_data: Optional[List[Dict]] = None) -> None:
        """
        Train the GNN model.
        
        Args:
            labeled_data: List of labeled comments with 'manual_label' field
            unlabeled_data: Not used (supervised only)
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
        
        if self.use_fallback:
            self._train_fallback(texts, labels)
        else:
            self._train_gnn(texts, labels)
        
        self._is_trained = True
    
    def _train_fallback(self, texts: List[str], labels: List[int]) -> None:
        """Train using fallback MLP with graph features."""
        # Build vocabulary
        self._build_vocabulary(texts)
        
        # Extract graph-based features
        features = []
        for text in texts:
            feat = self._extract_graph_features(text)
            features.append(feat)
        
        X = np.array(features)
        y = np.array(labels)
        
        # Standardize features
        self._scaler = StandardScaler()
        X = self._scaler.fit_transform(X)
        
        # Train MLP classifier
        self._fallback_classifier = MLPClassifier(
            hidden_layer_sizes=(self.hidden_dim, self.hidden_dim // 2),
            max_iter=self.num_epochs * 10,
            random_state=self.random_seed,
            early_stopping=True,
            validation_fraction=0.1
        )
        self._fallback_classifier.fit(X, y)
    
    def _train_gnn(self, texts: List[str], labels: List[int]) -> None:
        """Train using PyTorch Geometric GNN."""
        # Build vocabulary
        self._build_vocabulary(texts)
        
        # Create graph data objects
        data_list = []
        for text, label in zip(texts, labels):
            graph_data = self._text_to_graph(text)
            graph_data.y = torch.tensor([label], dtype=torch.long)
            data_list.append(graph_data)
        
        # Initialize model
        input_dim = len(self._word_to_idx)
        self._model = SimpleGCN(input_dim, self.hidden_dim, num_classes=2)
        
        optimizer = torch.optim.Adam(self._model.parameters(), lr=self.learning_rate)
        criterion = nn.CrossEntropyLoss()
        
        # Training loop
        self._model.train()
        for epoch in range(self.num_epochs):
            total_loss = 0
            
            for data in data_list:
                optimizer.zero_grad()
                
                batch = torch.zeros(data.x.size(0), dtype=torch.long)
                out = self._model(data.x, data.edge_index, batch)
                
                loss = criterion(out, data.y)
                loss.backward()
                optimizer.step()
                
                total_loss += loss.item()
    
    def _build_vocabulary(self, texts: List[str]) -> None:
        """Build word vocabulary from texts."""
        word_counts = defaultdict(int)
        
        for text in texts:
            words = self._tokenize(text)
            for word in words:
                word_counts[word] += 1
        
        # Keep words that appear at least twice
        vocab = [w for w, c in word_counts.items() if c >= 2]
        self._word_to_idx = {w: i for i, w in enumerate(vocab)}
    
    def _tokenize(self, text: str) -> List[str]:
        """Simple word tokenization."""
        import re
        text = text.lower()
        words = re.findall(r'\b[a-z]+\b', text)
        return words
    
    def _text_to_graph(self, text: str) -> 'Data':
        """Convert text to PyTorch Geometric graph."""
        words = self._tokenize(text)
        word_indices = [self._word_to_idx[w] for w in words if w in self._word_to_idx]
        
        if not word_indices:
            # Empty graph - create minimal valid graph
            x = torch.zeros(1, len(self._word_to_idx))
            edge_index = torch.zeros(2, 0, dtype=torch.long)
            return Data(x=x, edge_index=edge_index)
        
        # Create node features (one-hot encoding)
        unique_indices = list(set(word_indices))
        x = torch.zeros(len(unique_indices), len(self._word_to_idx))
        for i, idx in enumerate(unique_indices):
            x[i, idx] = 1.0
        
        # Create edges based on word co-occurrence
        edges = []
        idx_to_node = {idx: i for i, idx in enumerate(unique_indices)}
        
        for i, wi in enumerate(word_indices):
            for j in range(max(0, i - self.window_size), min(len(word_indices), i + self.window_size + 1)):
                if i != j:
                    wj = word_indices[j]
                    if wi in idx_to_node and wj in idx_to_node:
                        edges.append([idx_to_node[wi], idx_to_node[wj]])
        
        if edges:
            edge_index = torch.tensor(edges, dtype=torch.long).t().contiguous()
        else:
            edge_index = torch.zeros(2, 0, dtype=torch.long)
        
        return Data(x=x, edge_index=edge_index)
    
    def _extract_graph_features(self, text: str) -> np.ndarray:
        """Extract graph-based features for fallback mode."""
        words = self._tokenize(text)
        word_indices = [self._word_to_idx[w] for w in words if w in self._word_to_idx]
        
        if not word_indices:
            return np.zeros(10)  # 10 graph-based features
        
        # Build co-occurrence graph
        G = nx.Graph()
        unique_words = list(set(word_indices))
        G.add_nodes_from(unique_words)
        
        for i, wi in enumerate(word_indices):
            for j in range(max(0, i - self.window_size), min(len(word_indices), i + self.window_size + 1)):
                if i != j:
                    wj = word_indices[j]
                    if G.has_node(wi) and G.has_node(wj):
                        if G.has_edge(wi, wj):
                            G[wi][wj]['weight'] += 1
                        else:
                            G.add_edge(wi, wj, weight=1)
        
        # Extract features
        features = []
        
        # Basic graph statistics
        features.append(G.number_of_nodes())
        features.append(G.number_of_edges())
        features.append(nx.density(G) if G.number_of_nodes() > 1 else 0)
        
        # Degree statistics
        degrees = [d for n, d in G.degree()]
        features.append(np.mean(degrees) if degrees else 0)
        features.append(np.max(degrees) if degrees else 0)
        features.append(np.std(degrees) if degrees else 0)
        
        # Clustering coefficient
        features.append(nx.average_clustering(G) if G.number_of_nodes() > 2 else 0)
        
        # Connected components
        features.append(nx.number_connected_components(G) if not G.is_directed() else 1)
        
        # Word coverage
        features.append(len(word_indices) / max(len(self._word_to_idx), 1))
        features.append(len(unique_words) / max(len(words), 1) if words else 0)
        
        return np.array(features)
    
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
                is_satd, confidence = self._predict_gnn(content)
            
            # Determine explicit/implicit
            is_explicit = self._has_explicit_markers(content)
            is_implicit = is_satd and not is_explicit
            
            results.append(DetectionResult(
                id=comment.get('id', f'gnn-{i}'),
                file=comment.get('file', ''),
                line=int(comment.get('line', 0)),
                content=content,
                is_satd=is_satd,
                is_explicit=is_satd and is_explicit,
                is_implicit=is_implicit,
                confidence=round(confidence, 4),
                satd_type='design' if is_satd else '',
                metadata={
                    'detection_method': 'gnn_based',
                    'use_fallback': self.use_fallback
                }
            ))
        
        return results
    
    def _predict_fallback(self, text: str) -> Tuple[bool, float]:
        """Predict using fallback classifier."""
        features = self._extract_graph_features(text).reshape(1, -1)
        features = self._scaler.transform(features)
        
        prediction = self._fallback_classifier.predict(features)[0]
        proba = self._fallback_classifier.predict_proba(features)[0]
        confidence = float(proba[1])
        
        return bool(prediction == 1), confidence
    
    def _predict_gnn(self, text: str) -> Tuple[bool, float]:
        """Predict using GNN model."""
        self._model.eval()
        
        with torch.no_grad():
            data = self._text_to_graph(text)
            batch = torch.zeros(data.x.size(0), dtype=torch.long)
            out = self._model(data.x, data.edge_index, batch)
            proba = F.softmax(out, dim=1)
            
            prediction = out.argmax(dim=1).item()
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
            'word_to_idx': self._word_to_idx,
            'use_fallback': self.use_fallback,
            'config': {
                'hidden_dim': self.hidden_dim,
                'window_size': self.window_size
            }
        }
        
        if self.use_fallback:
            model_data['fallback_classifier'] = self._fallback_classifier
            model_data['scaler'] = self._scaler
        else:
            model_data['model_state_dict'] = self._model.state_dict()
        
        with open(path, 'wb') as f:
            pickle.dump(model_data, f)
    
    def load_model(self, path: Path) -> None:
        """Load trained model from disk."""
        with open(path, 'rb') as f:
            model_data = pickle.load(f)
        
        self._word_to_idx = model_data['word_to_idx']
        self.use_fallback = model_data['use_fallback']
        
        if self.use_fallback:
            self._fallback_classifier = model_data['fallback_classifier']
            self._scaler = model_data['scaler']
        else:
            input_dim = len(self._word_to_idx)
            self._model = SimpleGCN(input_dim, self.hidden_dim, num_classes=2)
            self._model.load_state_dict(model_data['model_state_dict'])
        
        self._is_trained = True


if __name__ == "__main__":
    print("GNN-Based Detector Test")
    print("-" * 50)
    print(f"PyTorch Geometric available: {TORCH_GEOMETRIC_AVAILABLE}")
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
    ]
    
    test_comments = [
        {'id': '1', 'file': 'test.py', 'line': 10, 'content': 'TODO: fix this later'},
        {'id': '2', 'file': 'test.py', 'line': 20, 'content': 'This is a regular comment'},
    ]
    
    try:
        detector = GNNBasedDetector(use_fallback=True)
        detector.train(labeled_data)
        
        results = detector.detect(test_comments)
        
        for result in results:
            status = "SATD" if result.is_satd else "Non-SATD"
            print(f"[{status}] ({result.confidence:.2f}) {result.content[:40]}...")
    except Exception as e:
        print(f"Error: {e}")

