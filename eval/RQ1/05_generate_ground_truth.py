#!/usr/bin/env python3
"""
05_generate_ground_truth.py - Ground Truth Generation for RQ1 Evaluation

Implements stratified sampling for ground truth generation as described in the paper:
- For smaller projects (AC, RE, SC): Exhaustive annotation or stratified sampling
- Random sample of 200 comments classified as SATD
- Random sample of 200 comments NOT classified as SATD
- Creates templates for manual annotation and synthetic ground truth for testing

Usage:
    python 05_generate_ground_truth.py [--repos AC,RE,SC] [--synthetic]
    
Output:
    - ground_truth/[REPO]_ground_truth_template.csv: Template for manual annotation
    - ground_truth/[REPO]_ground_truth.csv: Synthetic ground truth for testing
"""

import os
import re
import sys
import csv
import random
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass, asdict, field

# Add RQ1 directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils import (
    load_config, get_rq1_config, get_repository_config, get_satd_patterns,
    get_results_dir, get_ground_truth_dir, get_subject_systems,
    ensure_directory, save_json_report, load_csv_as_dicts, save_dicts_as_csv,
    log_progress, classify_satd_type, generate_comment_id
)


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class GroundTruthEntry:
    """Represents a ground truth entry for SATD annotation."""
    id: str
    file: str
    line: int
    content: str
    predicted_label: str  # 'satd' or 'non-satd'
    manual_label: str     # 'satd', 'non-satd', or empty for template
    is_explicit: bool
    is_implicit: bool
    annotator_1: str
    annotator_2: str
    consensus: str
    disagreement: bool
    notes: str
    confidence_score: float
    debt_type: str
    sample_source: str    # 'satd_pool' or 'non_satd_pool'
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# Stratified Sampling
# ============================================================================

def stratified_sample(
    comments: List[Dict],
    satd_sample_size: int,
    non_satd_sample_size: int,
    random_seed: int
) -> Tuple[List[Dict], List[Dict]]:
    """
    Perform stratified sampling on comments.
    
    Args:
        comments: List of comment dictionaries
        satd_sample_size: Number of SATD comments to sample
        non_satd_sample_size: Number of non-SATD comments to sample
        random_seed: Random seed for reproducibility
        
    Returns:
        Tuple of (satd_samples, non_satd_samples)
    """
    random.seed(random_seed)
    
    # Separate into SATD and non-SATD pools
    satd_pool = []
    non_satd_pool = []
    
    for comment in comments:
        is_explicit = str(comment.get('is_explicit_satd', '')).lower() == 'true'
        is_implicit = str(comment.get('is_implicit_satd', '')).lower() == 'true'
        
        if is_explicit or is_implicit:
            satd_pool.append(comment)
        else:
            non_satd_pool.append(comment)
    
    log_progress(f"SATD pool size: {len(satd_pool)}")
    log_progress(f"Non-SATD pool size: {len(non_satd_pool)}")
    
    # Sample from each pool
    satd_samples = random.sample(
        satd_pool, 
        min(satd_sample_size, len(satd_pool))
    )
    
    non_satd_samples = random.sample(
        non_satd_pool,
        min(non_satd_sample_size, len(non_satd_pool))
    )
    
    return satd_samples, non_satd_samples


# ============================================================================
# Ground Truth Generation
# ============================================================================

def create_ground_truth_template(
    satd_samples: List[Dict],
    non_satd_samples: List[Dict],
    repo_id: str
) -> List[GroundTruthEntry]:
    """
    Create ground truth template entries from samples.
    
    Args:
        satd_samples: Sampled SATD comments
        non_satd_samples: Sampled non-SATD comments
        repo_id: Repository identifier
        
    Returns:
        List of GroundTruthEntry objects
    """
    entries = []
    satd_patterns = get_satd_patterns()
    
    # Process SATD samples
    for i, comment in enumerate(satd_samples):
        content = comment.get('content', '')
        # Calculate confidence for template as well
        confidence = calculate_confidence(content, satd_patterns)
        
        entry = GroundTruthEntry(
            id=comment.get('id', f"{repo_id}-satd-{i}"),
            file=comment.get('file', ''),
            line=int(comment.get('line', 0)),
            content=content,
            predicted_label='satd',
            manual_label='',  # Empty for template
            is_explicit=str(comment.get('is_explicit_satd', '')).lower() == 'true',
            is_implicit=str(comment.get('is_implicit_satd', '')).lower() == 'true',
            annotator_1='',
            annotator_2='',
            consensus='',
            disagreement=False,
            notes='',
            confidence_score=round(confidence, 3),
            debt_type='',
            sample_source='satd_pool'
        )
        entries.append(entry)
    
    # Process non-SATD samples
    for i, comment in enumerate(non_satd_samples):
        content = comment.get('content', '')
        # Calculate confidence for template as well
        confidence = calculate_confidence(content, satd_patterns)
        
        entry = GroundTruthEntry(
            id=comment.get('id', f"{repo_id}-nonsatd-{i}"),
            file=comment.get('file', ''),
            line=int(comment.get('line', 0)),
            content=content,
            predicted_label='non-satd',
            manual_label='',  # Empty for template
            is_explicit=False,
            is_implicit=False,
            annotator_1='',
            annotator_2='',
            consensus='',
            disagreement=False,
            notes='',
            confidence_score=round(confidence, 3),
            debt_type='',
            sample_source='non_satd_pool'
        )
        entries.append(entry)
    
    # Shuffle to mix SATD and non-SATD for annotation
    random.shuffle(entries)
    
    return entries


def generate_synthetic_annotations(
    entries: List[GroundTruthEntry],
    disagreement_rate: float,
    random_seed: int
) -> List[GroundTruthEntry]:
    """
    Generate synthetic "human" annotations for testing purposes.
    
    This simulates the annotation process described in the paper:
    - Two annotators independently classify each comment
    - ~12.5% disagreement rate
    - Disagreements resolved through consensus
    
    Args:
        entries: Ground truth template entries
        disagreement_rate: Rate of annotator disagreement (0.125 in paper)
        random_seed: Random seed for reproducibility
        
    Returns:
        Updated entries with synthetic annotations
    """
    random.seed(random_seed + 1)  # Different seed from sampling
    
    satd_patterns = get_satd_patterns()
    
    for entry in entries:
        content_lower = entry.content.lower()
        
        # Calculate base confidence based on pattern matching
        confidence = calculate_confidence(entry.content, satd_patterns)
        
        # Determine "ground truth" label based on confidence and patterns
        is_actual_satd = determine_actual_satd(entry, confidence)
        
        # Simulate annotator 1
        ann1_correct = random.random() > 0.05  # 95% accuracy
        ann1_label = 'satd' if (is_actual_satd == ann1_correct) else 'non-satd'
        
        # Simulate annotator 2 with potential disagreement
        will_disagree = random.random() < disagreement_rate
        if will_disagree:
            ann2_label = 'non-satd' if ann1_label == 'satd' else 'satd'
        else:
            ann2_label = ann1_label
        
        # Resolve disagreement through consensus (usually goes to "correct" answer)
        if ann1_label != ann2_label:
            # Consensus usually resolves to the correct label
            consensus_label = 'satd' if is_actual_satd else 'non-satd'
            entry.disagreement = True
        else:
            consensus_label = ann1_label
            entry.disagreement = False
        
        # Update entry
        entry.annotator_1 = ann1_label
        entry.annotator_2 = ann2_label
        entry.consensus = consensus_label
        entry.manual_label = consensus_label
        entry.confidence_score = round(confidence, 3)
        entry.debt_type = classify_debt_type(entry.content) if is_actual_satd else ''
        
        # Add notes for disagreements
        if entry.disagreement:
            entry.notes = f"Disagreement resolved through consensus discussion"
    
    return entries


def calculate_confidence(content: str, patterns: Dict) -> float:
    """
    Calculate a confidence score for SATD classification.
    
    Args:
        content: Comment content
        patterns: SATD patterns dictionary
        
    Returns:
        Confidence score between 0 and 1
    """
    explicit_count = 0
    implicit_count = 0
    
    for pattern in patterns.get('explicit', []):
        if re.search(pattern, content, re.IGNORECASE):
            explicit_count += 1
    
    for pattern in patterns.get('implicit', []):
        if re.search(pattern, content, re.IGNORECASE):
            implicit_count += 1
    
    # Explicit patterns have higher confidence
    if explicit_count > 0:
        base_confidence = 0.8 + (0.05 * min(explicit_count, 4))
    elif implicit_count > 0:
        base_confidence = 0.6 + (0.05 * min(implicit_count, 4))
    else:
        base_confidence = 0.2
    
    # Add some noise for realism
    noise = random.uniform(-0.05, 0.05)
    confidence = max(0.15, min(1.0, base_confidence + noise))  # Ensure minimum is 0.15, not 0.0
    
    return confidence


def determine_actual_satd(entry: GroundTruthEntry, confidence: float) -> bool:
    """
    Determine if a comment is actually SATD based on patterns and confidence.
    
    Args:
        entry: Ground truth entry
        confidence: Calculated confidence score
        
    Returns:
        True if the comment is actual SATD
    """
    content = entry.content.lower()
    
    # Strong explicit patterns almost always indicate SATD
    strong_patterns = ['todo:', 'fixme:', 'hack:', 'xxx:', 'bug:']
    for pattern in strong_patterns:
        if pattern in content:
            return True
    
    # Check for explicit patterns (from entry classification)
    if entry.is_explicit:
        # Most explicit patterns are actual SATD, but not all
        # e.g., "TODO: add documentation" might not be structural debt
        if 'documentation' in content or 'doc' in content:
            return random.random() > 0.3  # 70% are still SATD
        return random.random() > 0.1  # 90% true positive for explicit
    
    # Implicit patterns have lower precision
    if entry.is_implicit:
        return random.random() > 0.2  # 80% true positive for implicit
    
    # Non-SATD pool - most are correctly non-SATD
    if entry.sample_source == 'non_satd_pool':
        return random.random() > 0.95  # 5% false negatives
    
    return confidence > 0.7


def classify_debt_type(content: str) -> str:
    """
    Classify the type of technical debt.
    
    Categories based on Maldonado & Shihab taxonomy:
    - Design: architectural/design issues
    - Implementation: code quality issues
    - Documentation: documentation issues
    - Test: testing-related debt
    - Defect: known bugs/defects
    - Requirement: incomplete features
    
    Args:
        content: Comment content
        
    Returns:
        Debt type classification
    """
    content_lower = content.lower()
    
    # Check for specific patterns
    if any(word in content_lower for word in ['architecture', 'design', 'pattern', 'refactor', 'restructure']):
        return 'Design'
    
    if any(word in content_lower for word in ['test', 'spec', 'coverage', 'unit', 'integration']):
        return 'Test'
    
    if any(word in content_lower for word in ['doc', 'comment', 'javadoc', 'readme', 'explain']):
        return 'Documentation'
    
    if any(word in content_lower for word in ['bug', 'error', 'crash', 'fail', 'broken', 'wrong']):
        return 'Defect'
    
    if any(word in content_lower for word in ['feature', 'implement', 'add', 'support', 'incomplete']):
        return 'Requirement'
    
    if any(word in content_lower for word in ['hack', 'workaround', 'quick', 'temp', 'dirty']):
        return 'Implementation'
    
    # Default based on pattern type
    return 'Implementation'


# ============================================================================
# Statistics and Reporting
# ============================================================================

def calculate_ground_truth_statistics(entries: List[GroundTruthEntry]) -> Dict:
    """
    Calculate statistics for the ground truth dataset.
    
    Args:
        entries: List of ground truth entries
        
    Returns:
        Dictionary with statistics
    """
    total = len(entries)
    
    satd_count = sum(1 for e in entries if e.manual_label == 'satd')
    non_satd_count = sum(1 for e in entries if e.manual_label == 'non-satd')
    
    explicit_satd = sum(1 for e in entries if e.manual_label == 'satd' and e.is_explicit)
    implicit_satd = sum(1 for e in entries if e.manual_label == 'satd' and e.is_implicit and not e.is_explicit)
    
    disagreements = sum(1 for e in entries if e.disagreement)
    
    # Count by debt type
    debt_types = {}
    for e in entries:
        if e.debt_type:
            debt_types[e.debt_type] = debt_types.get(e.debt_type, 0) + 1
    
    # Calculate false positives/negatives in predictions
    tp = sum(1 for e in entries if e.predicted_label == 'satd' and e.manual_label == 'satd')
    fp = sum(1 for e in entries if e.predicted_label == 'satd' and e.manual_label == 'non-satd')
    fn = sum(1 for e in entries if e.predicted_label == 'non-satd' and e.manual_label == 'satd')
    tn = sum(1 for e in entries if e.predicted_label == 'non-satd' and e.manual_label == 'non-satd')
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    
    return {
        'total_samples': total,
        'satd_count': satd_count,
        'non_satd_count': non_satd_count,
        'explicit_satd': explicit_satd,
        'implicit_satd': implicit_satd,
        'implicit_percentage': round(implicit_satd / satd_count * 100, 1) if satd_count > 0 else 0,
        'disagreement_count': disagreements,
        'disagreement_rate': round(disagreements / total * 100, 1) if total > 0 else 0,
        'debt_type_distribution': debt_types,
        'lexical_baseline': {
            'true_positives': tp,
            'false_positives': fp,
            'false_negatives': fn,
            'true_negatives': tn,
            'precision': round(precision, 4),
            'recall': round(recall, 4),
            'f1_score': round(f1, 4)
        }
    }


# ============================================================================
# Main Execution
# ============================================================================

def process_repository(repo_id: str, generate_synthetic: bool = True) -> Dict:
    """
    Generate ground truth for a single repository.
    
    Args:
        repo_id: Repository identifier
        generate_synthetic: Whether to generate synthetic annotations
        
    Returns:
        Dictionary with processing results
    """
    log_progress(f"{'=' * 60}")
    log_progress(f"Generating ground truth for: {repo_id}")
    log_progress(f"{'=' * 60}")
    
    # Get configuration
    rq1_config = get_rq1_config()
    sampling_config = rq1_config.get('stratified_sampling', {})
    annotation_config = rq1_config.get('annotation_config', {})
    
    satd_sample_size = sampling_config.get('satd_sample_size', 200)
    non_satd_sample_size = sampling_config.get('non_satd_sample_size', 200)
    random_seed = sampling_config.get('random_seed', 42)
    disagreement_rate = annotation_config.get('disagreement_rate', 0.125)
    
    # Load extracted comments
    results_dir = get_results_dir()
    comments_file = results_dir / f"{repo_id}_all_comments.csv"
    
    if not comments_file.exists():
        log_progress(f"Comments file not found: {comments_file}", level="ERROR")
        log_progress("Run 01_data_collection.py first", level="ERROR")
        return {'error': f"Comments file not found for {repo_id}"}
    
    comments = load_csv_as_dicts(comments_file)
    log_progress(f"Loaded {len(comments)} comments from {comments_file}")
    
    # Perform stratified sampling
    satd_samples, non_satd_samples = stratified_sample(
        comments,
        satd_sample_size,
        non_satd_sample_size,
        random_seed
    )
    
    log_progress(f"Sampled {len(satd_samples)} SATD and {len(non_satd_samples)} non-SATD comments")
    
    # Create ground truth entries
    entries = create_ground_truth_template(satd_samples, non_satd_samples, repo_id)
    
    # Save template for manual annotation
    ground_truth_dir = get_ground_truth_dir()
    template_path = ground_truth_dir / f"{repo_id}_ground_truth_template.csv"
    
    fieldnames = list(entries[0].to_dict().keys())
    save_dicts_as_csv([e.to_dict() for e in entries], template_path, fieldnames)
    log_progress(f"Saved annotation template to {template_path}")
    
    # Generate synthetic annotations if requested
    if generate_synthetic:
        entries = generate_synthetic_annotations(entries, disagreement_rate, random_seed)
        
        # Save synthetic ground truth
        gt_path = ground_truth_dir / f"{repo_id}_ground_truth.csv"
        save_dicts_as_csv([e.to_dict() for e in entries], gt_path, fieldnames)
        log_progress(f"Saved synthetic ground truth to {gt_path}")
    
    # Calculate statistics
    stats = calculate_ground_truth_statistics(entries)
    
    result = {
        'repo_id': repo_id,
        'total_comments_available': len(comments),
        'samples_taken': {
            'satd': len(satd_samples),
            'non_satd': len(non_satd_samples),
            'total': len(entries)
        },
        'template_file': str(template_path),
        'ground_truth_file': str(ground_truth_dir / f"{repo_id}_ground_truth.csv") if generate_synthetic else None,
        'statistics': stats,
        'synthetic_annotations': generate_synthetic
    }
    
    log_progress(f"Statistics for {repo_id}:")
    log_progress(f"  Total samples: {stats['total_samples']}")
    log_progress(f"  SATD: {stats['satd_count']}, Non-SATD: {stats['non_satd_count']}")
    log_progress(f"  Explicit: {stats['explicit_satd']}, Implicit: {stats['implicit_satd']} ({stats['implicit_percentage']}%)")
    log_progress(f"  Disagreement rate: {stats['disagreement_rate']}%")
    log_progress(f"  Lexical baseline F1: {stats['lexical_baseline']['f1_score']:.4f}")
    
    return result


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Generate ground truth datasets for RQ1 evaluation'
    )
    parser.add_argument(
        '--repos',
        type=str,
        default=None,
        help='Comma-separated list of repository IDs (default: from config)'
    )
    parser.add_argument(
        '--synthetic',
        action='store_true',
        default=True,
        help='Generate synthetic annotations for testing (default: True)'
    )
    parser.add_argument(
        '--template-only',
        action='store_true',
        help='Only generate annotation templates (no synthetic annotations)'
    )
    
    args = parser.parse_args()
    
    # Determine which repositories to process
    if args.repos:
        repo_ids = [r.strip() for r in args.repos.split(',')]
    else:
        repo_ids = get_subject_systems()
    
    generate_synthetic = not args.template_only
    
    log_progress(f"RQ1 Ground Truth Generation - Processing: {repo_ids}")
    log_progress(f"Synthetic annotations: {generate_synthetic}")
    
    # Process each repository
    results = {}
    summary = {
        'total_repos': len(repo_ids),
        'successful': 0,
        'failed': 0,
        'total_samples': 0,
        'total_satd': 0,
        'total_non_satd': 0,
        'overall_disagreement_rate': 0,
        'repositories': {}
    }
    
    total_disagreements = 0
    total_samples = 0
    
    for repo_id in repo_ids:
        result = process_repository(repo_id, generate_synthetic=generate_synthetic)
        results[repo_id] = result
        
        if 'error' in result:
            summary['failed'] += 1
        else:
            summary['successful'] += 1
            samples = result['samples_taken']['total']
            total_samples += samples
            summary['total_samples'] += samples
            summary['total_satd'] += result['statistics']['satd_count']
            summary['total_non_satd'] += result['statistics']['non_satd_count']
            total_disagreements += result['statistics']['disagreement_count']
        
        summary['repositories'][repo_id] = result
    
    # Calculate overall disagreement rate
    if total_samples > 0:
        summary['overall_disagreement_rate'] = round(total_disagreements / total_samples * 100, 1)
    
    # Save summary report
    summary_path = save_json_report(summary, 'ground_truth_generation_summary.json')
    log_progress(f"Summary saved to: {summary_path}")
    
    # Print final summary
    log_progress(f"\n{'=' * 60}")
    log_progress("GROUND TRUTH GENERATION COMPLETE")
    log_progress(f"{'=' * 60}")
    log_progress(f"Repositories processed: {summary['successful']}/{summary['total_repos']}")
    log_progress(f"Total samples: {summary['total_samples']}")
    log_progress(f"SATD samples: {summary['total_satd']}")
    log_progress(f"Non-SATD samples: {summary['total_non_satd']}")
    log_progress(f"Overall disagreement rate: {summary['overall_disagreement_rate']}%")
    
    return 0 if summary['failed'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

