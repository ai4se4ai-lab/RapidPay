#!/usr/bin/env python3
"""
DebtFree Semi-Supervised SATD Detector

Implementation based on Tu et al. (2022) - "DebtFree: A Semi-Supervised 
Approach to Self-Admitted Technical Debt Detection"

This approach uses self-training with a base classifier (TF-IDF + Logistic Regression)
and iteratively labels unlabeled data to expand the training set.
"""

from .detector import DebtFreeDetector

__all__ = ['DebtFreeDetector']

