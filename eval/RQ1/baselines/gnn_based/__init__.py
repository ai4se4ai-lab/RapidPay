#!/usr/bin/env python3
"""
GNN-Based SATD Detector

Implementation based on Yu et al. (2022) - Graph Neural Network approach
for SATD detection that captures structural relationships in code comments.

This implementation provides a simplified GNN that represents comments as
graphs of word relationships and uses graph-level classification.
"""

from .detector import GNNBasedDetector

__all__ = ['GNNBasedDetector']

