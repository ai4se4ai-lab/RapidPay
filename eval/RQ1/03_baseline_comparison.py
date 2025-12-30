#!/usr/bin/env python3
"""
03_baseline_comparison.py - Baseline Comparison for RQ1 Evaluation

Compares RapidPay's SID against existing SATD detection methods:
- Lexical-only baseline
- DebtFree (Tu et al., 2022)
- GNN-based (Yu et al., 2022)
- SATDAug (Sutoyo et al., 2024)
- Fine-tuned Flan-T5 (Sheikhaei et al., 2024)

Usage:
    python 03_baseline_comparison.py [--repos AC,RE,SC] [--methods all]
    
Output:
    - results/baseline_comparison_metrics.csv: Per-project metrics
    - results/baseline_comparison_summary.csv: Aggregated metrics
    - results/baseline_comparison_by_type.csv: Explicit vs Implicit breakdown
    - results/baseline_comparison_summary.json: Full JSON report
"""

import os
import sys
import argparse
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict, field

# Add RQ1 directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils import (
    load_config, get_rq1_config, get_results_dir, get_ground_truth_dir,
    get_subject_systems, save_json_report, load_csv_as_dicts, save_dicts_as_csv,
    log_progress, calculate_metrics, match_comments, EvaluationMetrics
)

from baselines import get_detector, list_available_detectors
from baselines.base_detector import BaseDetector, DetectionResult, EvaluationResult


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class BaselineComparisonResult:
    """Results from comparing multiple baseline methods."""
    method_name: str
    method_year: str
    project_id: str
    total_comments: int
    detected_satd: int
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float
    recall: float
    f1_score: float
    explicit_precision: float = 0.0
    explicit_recall: float = 0.0
    explicit_f1: float = 0.0
    implicit_precision: float = 0.0
    implicit_recall: float = 0.0
    implicit_f1: float = 0.0
    detection_time_seconds: float = 0.0
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass 
class AggregatedResult:
    """Aggregated results across all projects for a method."""
    method_name: str
    method_year: str
    avg_precision: float
    avg_recall: float
    avg_f1: float
    explicit_f1: float
    implicit_f1: float
    gap: float  # F1 gap between explicit and implicit
    total_detected: int
    total_ground_truth: int
    total_tp: int
    total_fp: int
    total_fn: int
    macro_precision: float  # Calculated from totals
    macro_recall: float
    macro_f1: float
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# Data Loading
# ============================================================================

def load_all_comments(repo_id: str) -> List[Dict]:
    """Load all extracted comments for a repository."""
    results_dir = get_results_dir()
    comments_file = results_dir / f'{repo_id}_all_comments.csv'
    
    if not comments_file.exists():
        log_progress(f"Comments file not found: {comments_file}", level="WARNING")
        return []
    
    comments = load_csv_as_dicts(comments_file)
    log_progress(f"Loaded {len(comments)} comments from {repo_id}")
    return comments


def load_ground_truth(repo_id: str) -> Tuple[List[Dict], List[Dict]]:
    """
    Load ground truth annotations.
    
    Returns:
        Tuple of (satd_entries, all_entries)
    """
    ground_truth_dir = get_ground_truth_dir()
    gt_file = ground_truth_dir / f"{repo_id}_ground_truth.csv"
    
    if not gt_file.exists():
        log_progress(f"Ground truth not found: {gt_file}", level="WARNING")
        return [], []
    
    all_entries = load_csv_as_dicts(gt_file)
    
    # Filter to SATD entries
    satd_entries = [
        entry for entry in all_entries
        if str(entry.get('manual_label', '')).lower() == 'satd'
    ]
    
    log_progress(f"Loaded ground truth: {len(satd_entries)} SATD out of {len(all_entries)} total")
    
    return satd_entries, all_entries


def split_ground_truth_by_type(ground_truth: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """Split ground truth into explicit and implicit SATD."""
    explicit = [
        g for g in ground_truth 
        if str(g.get('is_explicit', '')).lower() == 'true'
    ]
    implicit = [
        g for g in ground_truth 
        if str(g.get('is_implicit', '')).lower() == 'true'
        and str(g.get('is_explicit', '')).lower() != 'true'
    ]
    return explicit, implicit


# ============================================================================
# Evaluation Logic
# ============================================================================

def evaluate_detector_on_project(
    detector: BaseDetector,
    comments: List[Dict],
    satd_ground_truth: List[Dict],
    all_ground_truth: List[Dict],
    project_id: str,
    line_tolerance: int = 5
) -> BaselineComparisonResult:
    """
    Evaluate a detector on a single project.
    
    Args:
        detector: The SATD detector to evaluate
        comments: All comments from the project
        satd_ground_truth: Ground truth SATD entries only
        all_ground_truth: All ground truth entries
        project_id: Project identifier
        line_tolerance: Line tolerance for matching
        
    Returns:
        BaselineComparisonResult with evaluation metrics
    """
    start_time = datetime.now()
    
    # Run detection
    results = detector.detect(comments)
    
    detection_time = (datetime.now() - start_time).total_seconds()
    
    # Get detected SATD
    detected = [r for r in results if r.is_satd]
    detected_dicts = [r.to_dict() for r in detected]
    
    # Overall metrics
    match_result = match_comments(detected_dicts, satd_ground_truth, line_tolerance)
    metrics = match_result.get_metrics()
    
    # Type-specific metrics
    explicit_gt, implicit_gt = split_ground_truth_by_type(satd_ground_truth)
    
    explicit_detected = [r.to_dict() for r in detected if r.is_explicit]
    implicit_detected = [r.to_dict() for r in detected if r.is_implicit and not r.is_explicit]
    
    # Explicit metrics
    if explicit_gt:
        explicit_match = match_comments(explicit_detected, explicit_gt, line_tolerance)
        explicit_metrics = explicit_match.get_metrics()
    else:
        explicit_metrics = EvaluationMetrics(0, 0, 0, 0.0, 0.0, 0.0)
    
    # Implicit metrics
    if implicit_gt:
        implicit_match = match_comments(implicit_detected, implicit_gt, line_tolerance)
        implicit_metrics = implicit_match.get_metrics()
    else:
        implicit_metrics = EvaluationMetrics(0, 0, 0, 0.0, 0.0, 0.0)
    
    return BaselineComparisonResult(
        method_name=detector.name,
        method_year=detector.year,
        project_id=project_id,
        total_comments=len(comments),
        detected_satd=len(detected),
        true_positives=metrics.true_positives,
        false_positives=metrics.false_positives,
        false_negatives=metrics.false_negatives,
        precision=metrics.precision,
        recall=metrics.recall,
        f1_score=metrics.f1_score,
        explicit_precision=explicit_metrics.precision,
        explicit_recall=explicit_metrics.recall,
        explicit_f1=explicit_metrics.f1_score,
        implicit_precision=implicit_metrics.precision,
        implicit_recall=implicit_metrics.recall,
        implicit_f1=implicit_metrics.f1_score,
        detection_time_seconds=round(detection_time, 2)
    )


def aggregate_results(results: List[BaselineComparisonResult]) -> AggregatedResult:
    """Aggregate results across projects for a single method."""
    if not results:
        raise ValueError("No results to aggregate")
    
    method_name = results[0].method_name
    method_year = results[0].method_year
    
    # Calculate averages
    avg_precision = sum(r.precision for r in results) / len(results)
    avg_recall = sum(r.recall for r in results) / len(results)
    avg_f1 = sum(r.f1_score for r in results) / len(results)
    
    # Type-specific averages
    explicit_f1 = sum(r.explicit_f1 for r in results) / len(results)
    implicit_f1 = sum(r.implicit_f1 for r in results) / len(results)
    gap = explicit_f1 - implicit_f1
    
    # Totals for macro calculation
    total_detected = sum(r.detected_satd for r in results)
    total_gt = sum(r.true_positives + r.false_negatives for r in results)
    total_tp = sum(r.true_positives for r in results)
    total_fp = sum(r.false_positives for r in results)
    total_fn = sum(r.false_negatives for r in results)
    
    # Macro metrics (calculated from totals)
    macro_metrics = calculate_metrics(total_tp, total_fp, total_fn)
    
    return AggregatedResult(
        method_name=method_name,
        method_year=method_year,
        avg_precision=round(avg_precision, 4),
        avg_recall=round(avg_recall, 4),
        avg_f1=round(avg_f1, 4),
        explicit_f1=round(explicit_f1, 4),
        implicit_f1=round(implicit_f1, 4),
        gap=round(gap, 4),
        total_detected=total_detected,
        total_ground_truth=total_gt,
        total_tp=total_tp,
        total_fp=total_fp,
        total_fn=total_fn,
        macro_precision=macro_metrics.precision,
        macro_recall=macro_metrics.recall,
        macro_f1=macro_metrics.f1_score
    )


# ============================================================================
# Training and Evaluation Pipeline
# ============================================================================

def prepare_training_data(repo_ids: List[str]) -> Tuple[List[Dict], List[Dict]]:
    """
    Prepare training data from ground truth.
    
    Uses labeled ground truth data for training supervised methods.
    Uses all comments (without labels) as unlabeled data.
    """
    labeled_data = []
    unlabeled_data = []
    
    for repo_id in repo_ids:
        # Load ground truth for labeled data
        gt_dir = get_ground_truth_dir()
        gt_file = gt_dir / f"{repo_id}_ground_truth.csv"
        
        if gt_file.exists():
            entries = load_csv_as_dicts(gt_file)
            for entry in entries:
                if entry.get('manual_label'):
                    labeled_data.append(entry)
        
        # Load all comments for unlabeled data
        comments = load_all_comments(repo_id)
        for comment in comments:
            unlabeled_data.append(comment)
    
    log_progress(f"Prepared training data: {len(labeled_data)} labeled, {len(unlabeled_data)} unlabeled")
    return labeled_data, unlabeled_data


def train_detector(detector: BaseDetector, 
                   labeled_data: List[Dict],
                   unlabeled_data: List[Dict]) -> None:
    """Train a detector with prepared data."""
    log_progress(f"Training {detector.name}...")
    
    try:
        detector.train(labeled_data, unlabeled_data)
        log_progress(f"  {detector.name} training completed")
    except Exception as e:
        log_progress(f"  {detector.name} training failed: {e}", level="ERROR")
        raise


def run_evaluation_pipeline(
    methods: List[str],
    repo_ids: List[str],
    use_fallback: bool = True
) -> Tuple[List[BaselineComparisonResult], Dict[str, AggregatedResult]]:
    """
    Run the full evaluation pipeline.
    
    Args:
        methods: List of method names to evaluate
        repo_ids: List of repository IDs to evaluate on
        use_fallback: Whether to use fallback implementations
        
    Returns:
        Tuple of (per_project_results, aggregated_results)
    """
    rq1_config = get_rq1_config()
    line_tolerance = rq1_config.get('stratified_sampling', {}).get('line_tolerance', 5)
    
    # Prepare training data
    labeled_data, unlabeled_data = prepare_training_data(repo_ids)
    
    if not labeled_data:
        log_progress("No labeled training data available!", level="ERROR")
        return [], {}
    
    # Initialize detectors
    detectors = {}
    for method in methods:
        try:
            if method == 'lexical':
                detector = get_detector(method)
            else:
                detector = get_detector(method, use_fallback=use_fallback)
            detectors[method] = detector
            log_progress(f"Initialized {detector.name} ({detector.year})")
        except Exception as e:
            log_progress(f"Failed to initialize {method}: {e}", level="ERROR")
    
    # Train detectors that require training
    for method, detector in detectors.items():
        if detector.requires_training and not detector.is_trained:
            try:
                train_detector(detector, labeled_data, unlabeled_data)
            except Exception as e:
                log_progress(f"Skipping {method} due to training failure", level="WARNING")
                del detectors[method]
    
    # Run evaluation
    all_results = []
    
    for repo_id in repo_ids:
        log_progress(f"\n{'=' * 60}")
        log_progress(f"Evaluating on {repo_id}")
        log_progress(f"{'=' * 60}")
        
        # Load data
        comments = load_all_comments(repo_id)
        satd_gt, all_gt = load_ground_truth(repo_id)
        
        if not comments or not satd_gt:
            log_progress(f"Skipping {repo_id}: insufficient data", level="WARNING")
            continue
        
        # Evaluate each detector
        for method, detector in detectors.items():
            try:
                result = evaluate_detector_on_project(
                    detector=detector,
                    comments=comments,
                    satd_ground_truth=satd_gt,
                    all_ground_truth=all_gt,
                    project_id=repo_id,
                    line_tolerance=line_tolerance
                )
                all_results.append(result)
                
                log_progress(
                    f"  {detector.name}: P={result.precision:.3f}, "
                    f"R={result.recall:.3f}, F1={result.f1_score:.3f}"
                )
            except Exception as e:
                log_progress(f"  {method} failed on {repo_id}: {e}", level="ERROR")
    
    # Aggregate results by method
    aggregated = {}
    for method in detectors.keys():
        method_results = [r for r in all_results if r.method_name == detectors[method].name]
        if method_results:
            aggregated[method] = aggregate_results(method_results)
    
    return all_results, aggregated


# ============================================================================
# Output Generation
# ============================================================================

def save_results_csv(results: List[BaselineComparisonResult], filename: str) -> Path:
    """Save per-project results to CSV."""
    results_dir = get_results_dir()
    output_path = results_dir / filename
    
    fieldnames = [
        'method_name', 'method_year', 'project_id',
        'precision', 'recall', 'f1_score',
        'explicit_precision', 'explicit_recall', 'explicit_f1',
        'implicit_precision', 'implicit_recall', 'implicit_f1',
        'true_positives', 'false_positives', 'false_negatives',
        'detected_satd', 'total_comments', 'detection_time_seconds'
    ]
    
    data = [r.to_dict() for r in results]
    save_dicts_as_csv(data, output_path, fieldnames)
    
    log_progress(f"Saved per-project results to {output_path}")
    return output_path


def save_summary_csv(aggregated: Dict[str, AggregatedResult], filename: str) -> Path:
    """Save aggregated summary to CSV."""
    results_dir = get_results_dir()
    output_path = results_dir / filename
    
    # Sort by F1 score descending
    sorted_methods = sorted(aggregated.values(), key=lambda x: x.avg_f1, reverse=True)
    
    fieldnames = [
        'method_name', 'method_year',
        'avg_precision', 'avg_recall', 'avg_f1',
        'explicit_f1', 'implicit_f1', 'gap',
        'macro_precision', 'macro_recall', 'macro_f1',
        'total_detected', 'total_ground_truth',
        'total_tp', 'total_fp', 'total_fn'
    ]
    
    data = [r.to_dict() for r in sorted_methods]
    save_dicts_as_csv(data, output_path, fieldnames)
    
    log_progress(f"Saved summary to {output_path}")
    return output_path


def save_type_breakdown_csv(results: List[BaselineComparisonResult], filename: str) -> Path:
    """Save explicit vs implicit breakdown to CSV."""
    results_dir = get_results_dir()
    output_path = results_dir / filename
    
    fieldnames = [
        'method_name', 'method_year', 'project_id',
        'explicit_precision', 'explicit_recall', 'explicit_f1',
        'implicit_precision', 'implicit_recall', 'implicit_f1'
    ]
    
    data = [{
        'method_name': r.method_name,
        'method_year': r.method_year,
        'project_id': r.project_id,
        'explicit_precision': r.explicit_precision,
        'explicit_recall': r.explicit_recall,
        'explicit_f1': r.explicit_f1,
        'implicit_precision': r.implicit_precision,
        'implicit_recall': r.implicit_recall,
        'implicit_f1': r.implicit_f1
    } for r in results]
    
    save_dicts_as_csv(data, output_path, fieldnames)
    
    log_progress(f"Saved type breakdown to {output_path}")
    return output_path


def print_comparison_table(aggregated: Dict[str, AggregatedResult]) -> None:
    """Print a formatted comparison table."""
    print("\n" + "=" * 80)
    print("BASELINE COMPARISON RESULTS")
    print("=" * 80)
    
    # Sort by F1 descending
    sorted_methods = sorted(aggregated.values(), key=lambda x: x.avg_f1, reverse=True)
    
    # Header
    print(f"{'Method':<25} {'Year':<6} {'Precision':<10} {'Recall':<10} {'F1-Score':<10} {'Gap':<8}")
    print("-" * 80)
    
    for result in sorted_methods:
        print(f"{result.method_name:<25} {result.method_year:<6} "
              f"{result.avg_precision:<10.4f} {result.avg_recall:<10.4f} "
              f"{result.avg_f1:<10.4f} {result.gap:<8.4f}")
    
    print("-" * 80)
    
    # Type-specific table
    print("\nExplicit vs Implicit SATD Performance (F1-Score)")
    print("-" * 60)
    print(f"{'Method':<25} {'Explicit':<12} {'Implicit':<12} {'Gap':<10}")
    print("-" * 60)
    
    for result in sorted_methods:
        print(f"{result.method_name:<25} {result.explicit_f1:<12.4f} "
              f"{result.implicit_f1:<12.4f} {result.gap:<10.4f}")
    
    print("=" * 80)


# ============================================================================
# Main Execution
# ============================================================================

def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Compare SATD detection baselines for RQ1'
    )
    parser.add_argument(
        '--repos',
        type=str,
        default=None,
        help='Comma-separated list of repository IDs (default: from config)'
    )
    parser.add_argument(
        '--methods',
        type=str,
        default='all',
        help='Comma-separated list of methods or "all" (default: all)'
    )
    parser.add_argument(
        '--fallback',
        action='store_true',
        default=True,
        help='Use fallback implementations when dependencies are missing'
    )
    parser.add_argument(
        '--no-fallback',
        action='store_true',
        help='Disable fallback mode (require all dependencies)'
    )
    
    args = parser.parse_args()
    
    # Determine repositories
    if args.repos:
        repo_ids = [r.strip() for r in args.repos.split(',')]
    else:
        repo_ids = get_subject_systems()
    
    # Determine methods
    if args.methods.lower() == 'all':
        methods = list_available_detectors()
    else:
        methods = [m.strip() for m in args.methods.split(',')]
    
    use_fallback = not args.no_fallback
    
    log_progress(f"RQ1 Baseline Comparison")
    log_progress(f"Repositories: {repo_ids}")
    log_progress(f"Methods: {methods}")
    log_progress(f"Fallback mode: {use_fallback}")
    
    # Run evaluation
    results, aggregated = run_evaluation_pipeline(
        methods=methods,
        repo_ids=repo_ids,
        use_fallback=use_fallback
    )
    
    if not results:
        log_progress("No results generated!", level="ERROR")
        return 1
    
    # Save outputs
    save_results_csv(results, 'baseline_comparison_metrics.csv')
    save_summary_csv(aggregated, 'baseline_comparison_summary.csv')
    save_type_breakdown_csv(results, 'baseline_comparison_by_type.csv')
    
    # Save JSON report
    summary = {
        'evaluation_date': datetime.now().isoformat(),
        'repositories': repo_ids,
        'methods': methods,
        'use_fallback': use_fallback,
        'per_project_results': [r.to_dict() for r in results],
        'aggregated_results': {k: v.to_dict() for k, v in aggregated.items()},
        'ranking': [
            {'rank': i + 1, 'method': r.method_name, 'f1': r.avg_f1}
            for i, r in enumerate(sorted(aggregated.values(), key=lambda x: x.avg_f1, reverse=True))
        ]
    }
    
    save_json_report(summary, 'baseline_comparison_summary.json')
    
    # Print results
    print_comparison_table(aggregated)
    
    log_progress("\nBaseline comparison complete!")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

