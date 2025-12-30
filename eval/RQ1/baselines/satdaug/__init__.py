#!/usr/bin/env python3
"""
SATDAug Data Augmentation-Based SATD Detector

Implementation based on Sutoyo et al. (2024) - "SATDAug: Data Augmentation
for Self-Admitted Technical Debt Detection"

This approach uses data augmentation techniques (synonym replacement,
back-translation, paraphrasing) to improve classifier robustness.
"""

from .detector import SATDAugDetector

__all__ = ['SATDAugDetector']

