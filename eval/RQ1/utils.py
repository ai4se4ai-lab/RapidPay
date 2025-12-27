#!/usr/bin/env python3
"""
RQ1 Evaluation Utilities

Common utilities for file operations, metrics calculation, and Node.js bridge execution.
Used across all RQ1 evaluation scripts.
"""

import json
import subprocess
import os
import re
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass, asdict
from datetime import datetime


# ============================================================================
# Configuration Loading
# ============================================================================

def get_eval_dir() -> Path:
    """Get the eval directory path."""
    return Path(__file__).parent.parent


def get_rq1_dir() -> Path:
    """Get the RQ1 directory path."""
    return Path(__file__).parent


def get_project_root() -> Path:
    """Get the project root directory."""
    return get_eval_dir().parent


def load_config() -> Dict:
    """Load configuration from eval/config.json."""
    config_path = get_eval_dir() / "config.json"
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def get_rq1_config() -> Dict:
    """Get RQ1-specific configuration."""
    config = load_config()
    return config.get("experiments", {}).get("rq1", {})


def get_repository_config(repo_id: str) -> Dict:
    """Get configuration for a specific repository."""
    config = load_config()
    return config.get("repositories", {}).get(repo_id, {})


def get_satd_patterns() -> Dict[str, List[str]]:
    """Get SATD detection patterns."""
    config = load_config()
    return config.get("satd_patterns", {"explicit": [], "implicit": []})


def get_openai_config() -> Dict:
    """Get OpenAI configuration from RQ1 config."""
    rq1_config = get_rq1_config()
    return rq1_config.get("openai_config", {})


def get_openai_api_key() -> Optional[str]:
    """Get OpenAI API key from environment variable."""
    openai_config = get_openai_config()
    env_var = openai_config.get("api_key_env", "OPENAI_API_KEY")
    return os.environ.get(env_var)


# ============================================================================
# Metrics Calculation
# ============================================================================

@dataclass
class EvaluationMetrics:
    """Container for evaluation metrics."""
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: float
    recall: float
    f1_score: float
    
    def to_dict(self) -> Dict:
        return asdict(self)


def calculate_metrics(tp: int, fp: int, fn: int) -> EvaluationMetrics:
    """
    Calculate precision, recall, and F1-score from confusion matrix values.
    
    Args:
        tp: True positives
        fp: False positives
        fn: False negatives
        
    Returns:
        EvaluationMetrics object with calculated metrics
    """
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    
    return EvaluationMetrics(
        true_positives=tp,
        false_positives=fp,
        false_negatives=fn,
        precision=round(precision, 4),
        recall=round(recall, 4),
        f1_score=round(f1, 4)
    )


def calculate_spearman_correlation(ranking1: List[str], ranking2: List[str]) -> float:
    """
    Calculate Spearman rank correlation between two rankings.
    
    Args:
        ranking1: First ranking (list of IDs in ranked order)
        ranking2: Second ranking (list of IDs in ranked order)
        
    Returns:
        Spearman correlation coefficient (-1 to 1)
    """
    # Create rank maps
    rank1 = {item: i + 1 for i, item in enumerate(ranking1)}
    rank2 = {item: i + 1 for i, item in enumerate(ranking2)}
    
    # Find common items
    common = set(ranking1) & set(ranking2)
    n = len(common)
    
    if n < 2:
        return 0.0
    
    # Calculate sum of squared differences
    d2_sum = sum((rank1[item] - rank2[item]) ** 2 for item in common)
    
    # Spearman formula
    spearman = 1 - (6 * d2_sum) / (n * (n ** 2 - 1))
    return round(max(-1.0, min(1.0, spearman)), 4)


def calculate_kendall_tau(ranking1: List[str], ranking2: List[str]) -> float:
    """
    Calculate Kendall's Tau correlation between two rankings.
    
    Args:
        ranking1: First ranking (list of IDs in ranked order)
        ranking2: Second ranking (list of IDs in ranked order)
        
    Returns:
        Kendall's Tau coefficient (-1 to 1)
    """
    # Create rank maps
    rank1 = {item: i for i, item in enumerate(ranking1)}
    rank2 = {item: i for i, item in enumerate(ranking2)}
    
    # Find common items
    common = list(set(ranking1) & set(ranking2))
    n = len(common)
    
    if n < 2:
        return 0.0
    
    concordant = 0
    discordant = 0
    
    for i in range(n):
        for j in range(i + 1, n):
            item_i, item_j = common[i], common[j]
            order1 = rank1[item_i] < rank1[item_j]
            order2 = rank2[item_i] < rank2[item_j]
            
            if order1 == order2:
                concordant += 1
            else:
                discordant += 1
    
    total = concordant + discordant
    tau = (concordant - discordant) / total if total > 0 else 0.0
    return round(tau, 4)


# ============================================================================
# Node.js Bridge Execution
# ============================================================================

def call_node_bridge(bridge_script: str, args: Dict) -> Dict:
    """
    Execute a Node.js bridge script and return the JSON result.
    
    Args:
        bridge_script: Path to the bridge script (relative to RQ1/bridge/)
        args: Arguments to pass to the script as JSON
        
    Returns:
        Parsed JSON result from the bridge script
    """
    bridge_path = get_rq1_dir() / "bridge" / bridge_script
    project_root = get_project_root()
    
    if not bridge_path.exists():
        raise FileNotFoundError(f"Bridge script not found: {bridge_path}")
    
    # For large arguments (e.g., many SATD instances), use a temp file
    # Windows has a command line length limit (~8191 chars)
    args_json = json.dumps(args)
    use_temp_file = len(args_json) > 8000
    
    if use_temp_file:
        import tempfile
        temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
        temp_file.write(args_json)
        temp_file.close()
        
        # Pass file path instead
        cmd = ["node", str(bridge_path), f"@file:{temp_file.name}"]
    else:
        cmd = ["node", str(bridge_path), args_json]
    
    try:
        result = subprocess.run(
            cmd,
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout for large repos
        )
        
        # Clean up temp file if used
        if use_temp_file:
            try:
                os.unlink(temp_file.name)
            except:
                pass
        
        if result.returncode != 0:
            error_msg = result.stderr or "Unknown error"
            raise RuntimeError(f"Bridge script failed: {error_msg}")
        
        # Parse JSON output
        # The bridge may output debug messages before JSON, so extract the JSON part
        output = result.stdout.strip()
        if not output:
            return {"results": [], "error": "No output from bridge"}
        
        # Find the JSON object in the output (usually the last line or after debug messages)
        # Look for lines that start with { and try to parse them
        lines = output.split('\n')
        json_output = None
        
        # Try to find JSON starting from the end (most recent output)
        for line in reversed(lines):
            line = line.strip()
            if line.startswith('{'):
                try:
                    json_output = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
        
        # If no single-line JSON found, try parsing the entire output
        if json_output is None:
            try:
                json_output = json.loads(output)
            except json.JSONDecodeError:
                # Try to extract JSON from mixed output
                import re
                json_match = re.search(r'\{.*\}', output, re.DOTALL)
                if json_match:
                    json_output = json.loads(json_match.group(0))
                else:
                    raise ValueError(f"Could not extract JSON from bridge output: {output[:200]}")
        
        return json_output
        
    except subprocess.TimeoutExpired:
        raise TimeoutError(f"Bridge script timed out after 600 seconds")
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON from bridge script: {e}")


# ============================================================================
# Comment Matching and Analysis
# ============================================================================

@dataclass
class MatchResult:
    """Result of matching detected SATD to ground truth."""
    true_positives: List[Tuple[Dict, Dict]]  # (detected, expected) pairs
    false_positives: List[Dict]  # detected but not in ground truth
    false_negatives: List[Dict]  # in ground truth but not detected
    
    def get_metrics(self) -> EvaluationMetrics:
        return calculate_metrics(
            len(self.true_positives),
            len(self.false_positives),
            len(self.false_negatives)
        )


def match_comments(
    detected: List[Dict], 
    expected: List[Dict], 
    line_tolerance: int = 5
) -> MatchResult:
    """
    Match detected SATD instances to ground truth with line tolerance.
    
    Args:
        detected: List of detected SATD items (must have 'file' and 'line' keys)
        expected: List of expected SATD items from ground truth
        line_tolerance: Maximum line difference for a match
        
    Returns:
        MatchResult with TP, FP, FN classifications
    """
    true_positives = []
    false_positives = []
    
    matched_expected = set()
    
    for det in detected:
        det_file = det.get('file', '')
        det_line = int(det.get('line', 0))
        
        found_match = False
        for i, exp in enumerate(expected):
            if i in matched_expected:
                continue
                
            exp_file = exp.get('file', '')
            exp_line = int(exp.get('line', 0))
            
            # Check file match (may need path normalization)
            if normalize_path(det_file) == normalize_path(exp_file):
                if abs(det_line - exp_line) <= line_tolerance:
                    true_positives.append((det, exp))
                    matched_expected.add(i)
                    found_match = True
                    break
        
        if not found_match:
            false_positives.append(det)
    
    # False negatives: expected items not matched
    false_negatives = [exp for i, exp in enumerate(expected) if i not in matched_expected]
    
    return MatchResult(true_positives, false_positives, false_negatives)


def normalize_path(path: str) -> str:
    """Normalize a file path for comparison."""
    # Convert to forward slashes and remove leading ./
    normalized = path.replace('\\', '/').lstrip('./')
    # Get just the relative path from repo root
    parts = normalized.split('/')
    return '/'.join(parts)


# ============================================================================
# SATD Pattern Matching
# ============================================================================

def classify_satd_type(content: str) -> Tuple[bool, bool, List[str]]:
    """
    Classify whether a comment matches explicit or implicit SATD patterns.
    
    Args:
        content: The comment content to classify
        
    Returns:
        Tuple of (is_explicit, is_implicit, matched_patterns)
    """
    patterns = get_satd_patterns()
    matched = []
    is_explicit = False
    is_implicit = False
    
    # Check explicit patterns
    for pattern in patterns.get("explicit", []):
        if re.search(pattern, content, re.IGNORECASE):
            is_explicit = True
            matched.append(pattern)
    
    # Check implicit patterns
    for pattern in patterns.get("implicit", []):
        if re.search(pattern, content, re.IGNORECASE):
            is_implicit = True
            matched.append(pattern)
    
    return is_explicit, is_implicit, matched


def is_satd_candidate(content: str) -> bool:
    """Check if a comment is a potential SATD candidate."""
    is_explicit, is_implicit, _ = classify_satd_type(content)
    return is_explicit or is_implicit


# ============================================================================
# File and Directory Utilities
# ============================================================================

def ensure_directory(path: Path) -> Path:
    """Create directory if it doesn't exist."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_results_dir() -> Path:
    """Get the RQ1 results directory."""
    rq1_config = get_rq1_config()
    output_dir = rq1_config.get("output_dir", "./RQ1/results")
    results_dir = get_eval_dir() / output_dir.lstrip("./")
    return ensure_directory(results_dir)


def get_ground_truth_dir() -> Path:
    """Get the RQ1 ground truth directory."""
    rq1_config = get_rq1_config()
    gt_dir = rq1_config.get("ground_truth_dir", "./RQ1/ground_truth")
    ground_truth_dir = get_eval_dir() / gt_dir.lstrip("./")
    return ensure_directory(ground_truth_dir)


def get_repos_dir() -> Path:
    """Get the repositories directory."""
    rq1_config = get_rq1_config()
    repos_dir = rq1_config.get("repos_dir", "./repos")
    return get_eval_dir() / repos_dir.lstrip("./")


def get_repo_path(repo_id: str) -> Path:
    """Get the path to a specific repository."""
    return get_repos_dir() / repo_id


def generate_comment_id(file: str, line: int, content: str) -> str:
    """Generate a unique ID for a comment."""
    config = load_config()
    hash_length = config.get("global_settings", {}).get("comment_hash_length", 12)
    
    unique_string = f"{file}:{line}:{content}"
    hash_value = hashlib.md5(unique_string.encode()).hexdigest()[:hash_length]
    return f"satd-{hash_value}"


# ============================================================================
# Report Generation
# ============================================================================

def save_json_report(data: Dict, filename: str, subdir: Optional[str] = None) -> Path:
    """
    Save a JSON report to the results directory.
    
    Args:
        data: Dictionary to save as JSON
        filename: Name of the output file
        subdir: Optional subdirectory within results
        
    Returns:
        Path to the saved file
    """
    results_dir = get_results_dir()
    if subdir:
        results_dir = ensure_directory(results_dir / subdir)
    
    output_path = results_dir / filename
    
    # Add metadata
    data_with_meta = {
        "generated_at": datetime.now().isoformat(),
        "generator": "RQ1 Evaluation Suite",
        **data
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data_with_meta, f, indent=2, default=str)
    
    return output_path


def load_json_report(filename: str, subdir: Optional[str] = None) -> Dict:
    """
    Load a JSON report from the results directory.
    
    Args:
        filename: Name of the file to load
        subdir: Optional subdirectory within results
        
    Returns:
        Parsed JSON data
    """
    results_dir = get_results_dir()
    if subdir:
        results_dir = results_dir / subdir
    
    file_path = results_dir / filename
    
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


# ============================================================================
# Logging and Progress
# ============================================================================

def log_progress(message: str, level: str = "INFO"):
    """Log a progress message with timestamp."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level}] {message}")


def log_metrics(metrics: EvaluationMetrics, title: str = "Metrics"):
    """Log evaluation metrics in a formatted way."""
    print(f"\n{'=' * 50}")
    print(f"  {title}")
    print(f"{'=' * 50}")
    print(f"  True Positives:  {metrics.true_positives}")
    print(f"  False Positives: {metrics.false_positives}")
    print(f"  False Negatives: {metrics.false_negatives}")
    print(f"  Precision:       {metrics.precision:.4f}")
    print(f"  Recall:          {metrics.recall:.4f}")
    print(f"  F1-Score:        {metrics.f1_score:.4f}")
    print(f"{'=' * 50}\n")


# ============================================================================
# CSV Utilities
# ============================================================================

def load_csv_as_dicts(filepath: Path) -> List[Dict]:
    """Load a CSV file as a list of dictionaries."""
    import csv
    
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        return list(reader)


def save_dicts_as_csv(data: List[Dict], filepath: Path, fieldnames: Optional[List[str]] = None):
    """Save a list of dictionaries as a CSV file."""
    import csv
    
    if not data:
        return
    
    if fieldnames is None:
        fieldnames = list(data[0].keys())
    
    with open(filepath, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)


# ============================================================================
# Subject System Helpers
# ============================================================================

def get_subject_systems() -> List[str]:
    """Get list of subject systems to evaluate."""
    rq1_config = get_rq1_config()
    return rq1_config.get("subject_systems", ["AC", "RE", "SC"])


def get_excluded_directories() -> List[str]:
    """Get list of directories to exclude from scanning."""
    rq1_config = get_rq1_config()
    return rq1_config.get("excluded_directories", [
        "test", "vendor", "node_modules", "third_party", "external", ".git"
    ])


if __name__ == "__main__":
    # Test utilities
    print("RQ1 Utilities Module")
    print(f"Eval Directory: {get_eval_dir()}")
    print(f"RQ1 Directory: {get_rq1_dir()}")
    print(f"Project Root: {get_project_root()}")
    print(f"Subject Systems: {get_subject_systems()}")
    
    # Test metrics calculation
    metrics = calculate_metrics(tp=85, fp=10, fn=15)
    log_metrics(metrics, "Test Metrics")

