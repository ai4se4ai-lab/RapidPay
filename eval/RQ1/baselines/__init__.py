#!/usr/bin/env python3
"""
RQ1 Baseline SATD Detectors Package

This package contains implementations of baseline SATD detection methods
for comparative evaluation against RapidPay's SID component.

Baseline Methods:
- LexicalBaseline: Pure pattern-matching baseline
- DebtFreeDetector: Semi-supervised learning with self-training
- GNNBasedDetector: Graph Neural Network-based detection
- SATDAugDetector: Data augmentation with BERT
- FlanT5Detector: Fine-tuned Flan-T5 transformer
"""

from .base_detector import BaseDetector, DetectionResult
from .lexical_baseline import LexicalBaseline

# Import other detectors conditionally (they may have heavy dependencies)
def get_detector(name: str, **kwargs):
    """
    Factory function to get a detector by name.
    
    Args:
        name: Name of the detector ('lexical', 'debtfree', 'gnn', 'satdaug', 'flan_t5', 'sid')
        **kwargs: Additional arguments to pass to the detector constructor
        
    Returns:
        BaseDetector instance
    """
    name = name.lower()
    
    # Filter out use_fallback for detectors that don't support it
    use_fallback = kwargs.pop('use_fallback', None)
    
    if name == 'lexical':
        return LexicalBaseline(**kwargs)
    elif name == 'debtfree':
        from .debtfree.detector import DebtFreeDetector
        # DebtFree doesn't use fallback (always uses sklearn)
        return DebtFreeDetector(**kwargs)
    elif name == 'gnn':
        from .gnn_based.detector import GNNBasedDetector
        if use_fallback is not None:
            kwargs['use_fallback'] = use_fallback
        return GNNBasedDetector(**kwargs)
    elif name == 'satdaug':
        from .satdaug.detector import SATDAugDetector
        if use_fallback is not None:
            kwargs['use_fallback'] = use_fallback
        return SATDAugDetector(**kwargs)
    elif name == 'flan_t5':
        from .flan_t5.detector import FlanT5Detector
        if use_fallback is not None:
            kwargs['use_fallback'] = use_fallback
        return FlanT5Detector(**kwargs)
    else:
        raise ValueError(f"Unknown detector: {name}")


def list_available_detectors():
    """List all available detector names."""
    return ['lexical', 'debtfree', 'gnn', 'satdaug', 'flan_t5']


__all__ = [
    'BaseDetector',
    'DetectionResult', 
    'LexicalBaseline',
    'get_detector',
    'list_available_detectors'
]

