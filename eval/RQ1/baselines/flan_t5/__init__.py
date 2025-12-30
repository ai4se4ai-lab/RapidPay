#!/usr/bin/env python3
"""
Fine-tuned Flan-T5 SATD Detector

Implementation based on Sheikhaei et al. (2024) - Using fine-tuned
Flan-T5 sequence-to-sequence model for SATD detection.

This approach uses the Flan-T5 model with instruction-tuning for
text classification formatted as a question-answering task.
"""

from .detector import FlanT5Detector

__all__ = ['FlanT5Detector']

