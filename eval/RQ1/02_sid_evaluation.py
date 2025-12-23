#!/usr/bin/env python3
"""
02_sid_evaluation.py - SID (SATD Instance Detection) Evaluation for RQ1

Evaluates the accuracy of the SID component by comparing detected SATD instances
against ground truth annotations. Calculates precision, recall, and F1-score,
and compares the hybrid approach against a lexical-only baseline.

Usage:
    python 02_sid_evaluation.py [--repos AC,RE,SC] [--use-llm]
    
Output:
    - results/sid_evaluation_[REPO].json: Per-repository evaluation results
    - results/sid_evaluation_summary.json: Aggregated results across all repos
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, asdict

# Add RQ1 directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils import (
    load_config, get_rq1_config, get_repository_config, get_openai_config,
    get_repo_path, get_results_dir, get_ground_truth_dir, get_subject_systems,
    save_json_report, load_csv_as_dicts, log_progress, log_metrics,
    calculate_metrics, match_comments, EvaluationMetrics, MatchResult,
    call_node_bridge
)


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class SIDEvaluationResult:
    """Results from SID evaluation on a single repository."""
    repo_id: str
    repo_name: str
    detection_mode: str  # 'lexical' or 'hybrid'
    
    # Detection counts
    total_detected: int
    total_ground_truth: int
    
    # Metrics
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float
    recall: float
    f1_score: float
    
    # Breakdown by type
    explicit_satd_detected: int
    implicit_satd_detected: int
    explicit_satd_ground_truth: int
    implicit_satd_ground_truth: int
    
    # Analysis
    missed_satd: List[Dict]
    false_positives_list: List[Dict]
    
    # Timing
    detection_time_seconds: float
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# SID Invocation
# ============================================================================

def run_sid_detection(repo_path: Path, use_llm: bool = False) -> Tuple[List[Dict], float]:
    """
    Run SATD Instance Detection on a repository using the TypeScript SID module.
    
    Args:
        repo_path: Path to the repository
        use_llm: Whether to use LLM classification (hybrid mode)
        
    Returns:
        Tuple of (detected_satd_list, detection_time_seconds)
    """
    openai_config = get_openai_config()
    
    bridge_args = {
        'repo_path': str(repo_path),
        'config': {
            'use_llm': use_llm,
            'confidence_threshold': openai_config.get('confidence_threshold', 0.7),
            'model_name': openai_config.get('model_name', 'gpt-4o')
        }
    }
    
    # If using LLM, check for API key
    if use_llm:
        import os
        api_key = os.environ.get(openai_config.get('api_key_env', 'OPENAI_API_KEY'))
        if api_key:
            bridge_args['config']['openai_api_key'] = api_key
        else:
            log_progress("Warning: OPENAI_API_KEY not set, falling back to lexical-only", level="WARNING")
            bridge_args['config']['use_llm'] = False
    
    start_time = datetime.now()
    
    try:
        result = call_node_bridge('sid_bridge.js', bridge_args)
        
        if not result.get('success', False):
            raise RuntimeError(result.get('error', 'Unknown error from SID bridge'))
        
        detected = result.get('results', [])
        
    except Exception as e:
        log_progress(f"SID bridge failed: {e}", level="ERROR")
        detected = []
    
    detection_time = (datetime.now() - start_time).total_seconds()
    
    return detected, detection_time


def run_lexical_baseline(repo_path: Path) -> Tuple[List[Dict], float]:
    """
    Run lexical-only SATD detection as a baseline.
    
    Args:
        repo_path: Path to the repository
        
    Returns:
        Tuple of (detected_satd_list, detection_time_seconds)
    """
    return run_sid_detection(repo_path, use_llm=False)


# ============================================================================
# Ground Truth Loading
# ============================================================================

def load_ground_truth(repo_id: str) -> List[Dict]:
    """
    Load ground truth annotations for a repository.
    
    Args:
        repo_id: Repository identifier
        
    Returns:
        List of ground truth entries (only SATD-labeled entries)
    """
    ground_truth_dir = get_ground_truth_dir()
    gt_file = ground_truth_dir / f"{repo_id}_ground_truth.csv"
    
    if not gt_file.exists():
        log_progress(f"Ground truth file not found: {gt_file}", level="ERROR")
        return []
    
    entries = load_csv_as_dicts(gt_file)
    
    # Filter to only SATD entries
    satd_entries = [
        entry for entry in entries
        if entry.get('manual_label', '').lower() == 'satd'
    ]
    
    log_progress(f"Loaded {len(satd_entries)} SATD ground truth entries from {gt_file}")
    
    return satd_entries


def load_all_ground_truth(repo_id: str) -> List[Dict]:
    """
    Load all ground truth annotations (both SATD and non-SATD).
    
    Args:
        repo_id: Repository identifier
        
    Returns:
        List of all ground truth entries
    """
    ground_truth_dir = get_ground_truth_dir()
    gt_file = ground_truth_dir / f"{repo_id}_ground_truth.csv"
    
    if not gt_file.exists():
        return []
    
    return load_csv_as_dicts(gt_file)


# ============================================================================
# Evaluation Logic
# ============================================================================

def evaluate_detection(
    detected: List[Dict],
    ground_truth: List[Dict],
    line_tolerance: int = 5
) -> MatchResult:
    """
    Evaluate SATD detection against ground truth.
    
    Args:
        detected: List of detected SATD instances
        ground_truth: List of ground truth SATD entries
        line_tolerance: Maximum line difference for matching
        
    Returns:
        MatchResult with TP, FP, FN
    """
    return match_comments(detected, ground_truth, line_tolerance)


def classify_detection_types(detected: List[Dict]) -> Tuple[int, int]:
    """
    Count explicit and implicit SATD in detected instances.
    
    Args:
        detected: List of detected SATD instances
        
    Returns:
        Tuple of (explicit_count, implicit_count)
    """
    explicit = sum(1 for d in detected if d.get('is_explicit', False))
    implicit = sum(1 for d in detected if d.get('is_implicit', False) and not d.get('is_explicit', False))
    return explicit, implicit


def classify_ground_truth_types(ground_truth: List[Dict]) -> Tuple[int, int]:
    """
    Count explicit and implicit SATD in ground truth.
    
    Args:
        ground_truth: List of ground truth entries
        
    Returns:
        Tuple of (explicit_count, implicit_count)
    """
    explicit = sum(1 for g in ground_truth if str(g.get('is_explicit', '')).lower() == 'true')
    implicit = sum(1 for g in ground_truth if str(g.get('is_implicit', '')).lower() == 'true' 
                   and str(g.get('is_explicit', '')).lower() != 'true')
    return explicit, implicit


def analyze_missed_satd(match_result: MatchResult) -> List[Dict]:
    """
    Analyze false negatives (missed SATD instances).
    
    Args:
        match_result: Match result from evaluation
        
    Returns:
        List of missed SATD entries with analysis
    """
    missed = []
    for entry in match_result.false_negatives:
        missed.append({
            'id': entry.get('id', ''),
            'file': entry.get('file', ''),
            'line': entry.get('line', 0),
            'content': entry.get('content', '')[:200],
            'is_explicit': str(entry.get('is_explicit', '')).lower() == 'true',
            'is_implicit': str(entry.get('is_implicit', '')).lower() == 'true',
            'debt_type': entry.get('debt_type', '')
        })
    return missed


def analyze_false_positives(match_result: MatchResult) -> List[Dict]:
    """
    Analyze false positives (incorrectly detected as SATD).
    
    Args:
        match_result: Match result from evaluation
        
    Returns:
        List of false positive entries with analysis
    """
    fps = []
    for entry in match_result.false_positives:
        fps.append({
            'id': entry.get('id', ''),
            'file': entry.get('file', ''),
            'line': entry.get('line', 0),
            'content': entry.get('content', '')[:200],
            'is_explicit': entry.get('is_explicit', False),
            'is_implicit': entry.get('is_implicit', False),
            'detection_mode': entry.get('detection_mode', '')
        })
    return fps


# ============================================================================
# Repository Evaluation
# ============================================================================

def evaluate_repository(
    repo_id: str,
    use_llm: bool = False
) -> Optional[SIDEvaluationResult]:
    """
    Evaluate SID on a single repository.
    
    Args:
        repo_id: Repository identifier
        use_llm: Whether to use LLM classification
        
    Returns:
        SIDEvaluationResult or None if evaluation fails
    """
    log_progress(f"{'=' * 60}")
    log_progress(f"Evaluating SID for repository: {repo_id}")
    log_progress(f"{'=' * 60}")
    
    # Get repository configuration
    repo_config = get_repository_config(repo_id)
    if not repo_config:
        log_progress(f"Repository {repo_id} not configured", level="ERROR")
        return None
    
    repo_path = get_repo_path(repo_id)
    if not repo_path.exists():
        log_progress(f"Repository not found: {repo_path}", level="ERROR")
        return None
    
    # Load ground truth
    ground_truth = load_ground_truth(repo_id)
    if not ground_truth:
        log_progress(f"No ground truth available for {repo_id}", level="ERROR")
        return None
    
    # Get line tolerance from config
    rq1_config = get_rq1_config()
    line_tolerance = rq1_config.get('stratified_sampling', {}).get('line_tolerance', 5)
    
    # Load detected SATD from extracted comments (from step 1)
    # This is more reliable than calling the bridge and uses the same extraction method
    results_dir = get_results_dir()
    comments_file = results_dir / f'{repo_id}_all_comments.csv'
    
    detected = []
    detection_time = 0.0
    
    if comments_file.exists():
        log_progress(f"Loading SATD candidates from extracted comments...")
        comments = load_csv_as_dicts(comments_file)
        
        for i, c in enumerate(comments):
            is_explicit = str(c.get('is_explicit_satd', '')).lower() == 'true'
            is_implicit = str(c.get('is_implicit_satd', '')).lower() == 'true'
            if is_explicit or is_implicit:
                detected.append({
                    'id': c.get('id', f'satd-{i}'),
                    'file': c.get('file', ''),
                    'line': int(c.get('line', 0)),
                    'content': c.get('content', ''),
                    'is_explicit': is_explicit,
                    'is_implicit': is_implicit
                })
        
        detection_mode = 'lexical'  # Using lexical patterns from data collection
        log_progress(f"Loaded {len(detected)} SATD instances from extracted comments")
    else:
        # Fallback: Try bridge if comments file doesn't exist
        detection_mode = 'hybrid' if use_llm else 'lexical'
        log_progress(f"Comments file not found, running SID detection via bridge (mode: {detection_mode})...")
        detected, detection_time = run_sid_detection(repo_path, use_llm)
        log_progress(f"Detected {len(detected)} SATD instances in {detection_time:.2f}s")
    
    # Evaluate against ground truth
    match_result = evaluate_detection(detected, ground_truth, line_tolerance)
    metrics = match_result.get_metrics()
    
    # Get type breakdowns
    explicit_detected, implicit_detected = classify_detection_types(detected)
    explicit_gt, implicit_gt = classify_ground_truth_types(ground_truth)
    
    # Analyze misses and false positives
    missed = analyze_missed_satd(match_result)
    fps = analyze_false_positives(match_result)
    
    # Create result
    result = SIDEvaluationResult(
        repo_id=repo_id,
        repo_name=repo_config.get('name', repo_id),
        detection_mode=detection_mode,
        total_detected=len(detected),
        total_ground_truth=len(ground_truth),
        true_positives=metrics.true_positives,
        false_positives=metrics.false_positives,
        false_negatives=metrics.false_negatives,
        precision=metrics.precision,
        recall=metrics.recall,
        f1_score=metrics.f1_score,
        explicit_satd_detected=explicit_detected,
        implicit_satd_detected=implicit_detected,
        explicit_satd_ground_truth=explicit_gt,
        implicit_satd_ground_truth=implicit_gt,
        missed_satd=missed[:20],  # Limit to 20 examples
        false_positives_list=fps[:20],  # Limit to 20 examples
        detection_time_seconds=round(detection_time, 2)
    )
    
    # Log results
    log_progress(f"\nSID Evaluation Results for {repo_id}:")
    log_metrics(metrics, f"Detection Metrics ({detection_mode})")
    log_progress(f"Explicit SATD: detected={explicit_detected}, ground_truth={explicit_gt}")
    log_progress(f"Implicit SATD: detected={implicit_detected}, ground_truth={implicit_gt}")
    log_progress(f"Implicit %: {(implicit_gt / len(ground_truth) * 100):.1f}%" if ground_truth else "N/A")
    
    return result


def run_baseline_comparison(repo_id: str) -> Optional[Dict]:
    """
    Run baseline comparison for a repository.
    
    Compares lexical-only baseline against the full results.
    
    Args:
        repo_id: Repository identifier
        
    Returns:
        Comparison results dictionary
    """
    log_progress(f"\nRunning baseline comparison for {repo_id}...")
    
    ground_truth = load_ground_truth(repo_id)
    if not ground_truth:
        return None
    
    repo_path = get_repo_path(repo_id)
    if not repo_path.exists():
        return None
    
    rq1_config = get_rq1_config()
    line_tolerance = rq1_config.get('stratified_sampling', {}).get('line_tolerance', 5)
    
    # Run lexical-only baseline
    detected, _ = run_lexical_baseline(repo_path)
    match_result = evaluate_detection(detected, ground_truth, line_tolerance)
    baseline_metrics = match_result.get_metrics()
    
    return {
        'lexical_only': {
            'precision': baseline_metrics.precision,
            'recall': baseline_metrics.recall,
            'f1_score': baseline_metrics.f1_score,
            'detected_count': len(detected)
        }
    }


# ============================================================================
# Main Execution
# ============================================================================

def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Evaluate SID (SATD Instance Detection) for RQ1'
    )
    parser.add_argument(
        '--repos',
        type=str,
        default=None,
        help='Comma-separated list of repository IDs (default: from config)'
    )
    parser.add_argument(
        '--use-llm',
        action='store_true',
        help='Use LLM classification (hybrid mode)'
    )
    parser.add_argument(
        '--baseline',
        action='store_true',
        help='Include baseline comparison'
    )
    
    args = parser.parse_args()
    
    # Determine which repositories to evaluate
    if args.repos:
        repo_ids = [r.strip() for r in args.repos.split(',')]
    else:
        repo_ids = get_subject_systems()
    
    log_progress(f"RQ1 SID Evaluation - Repositories: {repo_ids}")
    log_progress(f"Detection mode: {'hybrid (with LLM)' if args.use_llm else 'lexical only'}")
    
    # Get thresholds from config
    rq1_config = get_rq1_config()
    thresholds = rq1_config.get('thresholds', {})
    precision_threshold = thresholds.get('precision_threshold', 0.80)
    recall_threshold = thresholds.get('recall_threshold', 0.90)
    
    # Evaluate each repository
    results = []
    summary = {
        'evaluation_mode': 'hybrid' if args.use_llm else 'lexical',
        'total_repos': len(repo_ids),
        'successful': 0,
        'failed': 0,
        'repositories': {},
        'aggregate_metrics': {
            'total_detected': 0,
            'total_ground_truth': 0,
            'total_true_positives': 0,
            'total_false_positives': 0,
            'total_false_negatives': 0,
            'total_explicit_detected': 0,
            'total_implicit_detected': 0
        },
        'thresholds': thresholds,
        'threshold_compliance': {}
    }
    
    for repo_id in repo_ids:
        result = evaluate_repository(repo_id, use_llm=args.use_llm)
        
        if result:
            summary['successful'] += 1
            results.append(result)
            
            # Aggregate metrics
            summary['aggregate_metrics']['total_detected'] += result.total_detected
            summary['aggregate_metrics']['total_ground_truth'] += result.total_ground_truth
            summary['aggregate_metrics']['total_true_positives'] += result.true_positives
            summary['aggregate_metrics']['total_false_positives'] += result.false_positives
            summary['aggregate_metrics']['total_false_negatives'] += result.false_negatives
            summary['aggregate_metrics']['total_explicit_detected'] += result.explicit_satd_detected
            summary['aggregate_metrics']['total_implicit_detected'] += result.implicit_satd_detected
            
            # Save individual result
            save_json_report(result.to_dict(), f'sid_evaluation_{repo_id}.json')
            
            # Add baseline comparison if requested
            if args.baseline:
                baseline = run_baseline_comparison(repo_id)
                if baseline:
                    result_dict = result.to_dict()
                    result_dict['baseline_comparison'] = baseline
                    summary['repositories'][repo_id] = result_dict
                else:
                    summary['repositories'][repo_id] = result.to_dict()
            else:
                summary['repositories'][repo_id] = result.to_dict()
        else:
            summary['failed'] += 1
            summary['repositories'][repo_id] = {'error': 'Evaluation failed'}
    
    # Calculate aggregate precision/recall/F1
    agg = summary['aggregate_metrics']
    if agg['total_detected'] > 0 or agg['total_ground_truth'] > 0:
        agg_metrics = calculate_metrics(
            agg['total_true_positives'],
            agg['total_false_positives'],
            agg['total_false_negatives']
        )
        
        summary['aggregate_metrics']['precision'] = agg_metrics.precision
        summary['aggregate_metrics']['recall'] = agg_metrics.recall
        summary['aggregate_metrics']['f1_score'] = agg_metrics.f1_score
        
        # Calculate implicit percentage
        total_satd = agg['total_explicit_detected'] + agg['total_implicit_detected']
        if total_satd > 0:
            summary['aggregate_metrics']['implicit_percentage'] = round(
                agg['total_implicit_detected'] / total_satd * 100, 1
            )
        
        # Check threshold compliance
        summary['threshold_compliance'] = {
            'precision_pass': agg_metrics.precision >= precision_threshold,
            'recall_pass': agg_metrics.recall >= recall_threshold,
            'overall_pass': (agg_metrics.precision >= precision_threshold and 
                           agg_metrics.recall >= recall_threshold)
        }
    
    # Calculate per-repo averages
    if results:
        summary['per_repo_averages'] = {
            'precision': round(sum(r.precision for r in results) / len(results), 4),
            'recall': round(sum(r.recall for r in results) / len(results), 4),
            'f1_score': round(sum(r.f1_score for r in results) / len(results), 4)
        }
    
    # Save summary report
    summary_path = save_json_report(summary, 'sid_evaluation_summary.json')
    log_progress(f"\nSummary saved to: {summary_path}")
    
    # Print final summary
    log_progress(f"\n{'=' * 60}")
    log_progress("SID EVALUATION COMPLETE")
    log_progress(f"{'=' * 60}")
    log_progress(f"Repositories evaluated: {summary['successful']}/{summary['total_repos']}")
    
    if 'precision' in agg:
        log_progress(f"\nAggregate Metrics:")
        log_progress(f"  Precision: {agg['precision']:.4f} (threshold: {precision_threshold})")
        log_progress(f"  Recall: {agg['recall']:.4f} (threshold: {recall_threshold})")
        log_progress(f"  F1-Score: {agg['f1_score']:.4f}")
        log_progress(f"  Implicit SATD: {agg.get('implicit_percentage', 0):.1f}%")
        
        compliance = summary['threshold_compliance']
        status = "PASSED" if compliance['overall_pass'] else "NEEDS IMPROVEMENT"
        log_progress(f"\nThreshold Compliance: {status}")
    
    return 0 if summary['failed'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

