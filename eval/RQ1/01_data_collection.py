#!/usr/bin/env python3
"""
01_data_collection.py - Data Collection for RQ1 Evaluation

Extracts all code comments from the subject systems (AC, RE, SC) and creates
CSV datasets for subsequent SATD analysis. This is the first step in the
RQ1 evaluation pipeline.

Usage:
    python 01_data_collection.py [--repos AC,RE,SC] [--clone]
    
Output:
    - results/[REPO]_all_comments.csv: All extracted comments
    - results/data_collection_summary.json: Summary statistics
"""

import os
import re
import sys
import csv
import subprocess
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Generator
from dataclasses import dataclass, asdict

# Add RQ1 directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils import (
    load_config, get_rq1_config, get_repository_config, get_satd_patterns,
    get_repos_dir, get_results_dir, get_subject_systems, get_excluded_directories,
    ensure_directory, save_json_report, log_progress, generate_comment_id,
    classify_satd_type, save_dicts_as_csv
)


# ============================================================================
# Comment Extraction Patterns
# ============================================================================

# Language-specific comment patterns
COMMENT_PATTERNS = {
    'java': {
        'single_line': r'//(.*)$',
        'multi_line_start': r'/\*',
        'multi_line_end': r'\*/',
        'extensions': ['.java']
    },
    'kotlin': {
        'single_line': r'//(.*)$',
        'multi_line_start': r'/\*',
        'multi_line_end': r'\*/',
        'extensions': ['.kt', '.kts']
    },
    'javascript': {
        'single_line': r'//(.*)$',
        'multi_line_start': r'/\*',
        'multi_line_end': r'\*/',
        'extensions': ['.js', '.jsx', '.mjs']
    },
    'typescript': {
        'single_line': r'//(.*)$',
        'multi_line_start': r'/\*',
        'multi_line_end': r'\*/',
        'extensions': ['.ts', '.tsx']
    },
    'python': {
        'single_line': r'#(.*)$',
        'multi_line_start': r'"""',
        'multi_line_end': r'"""',
        'extensions': ['.py', '.pyx']
    },
    'c': {
        'single_line': r'//(.*)$',
        'multi_line_start': r'/\*',
        'multi_line_end': r'\*/',
        'extensions': ['.c', '.h']
    },
    'cpp': {
        'single_line': r'//(.*)$',
        'multi_line_start': r'/\*',
        'multi_line_end': r'\*/',
        'extensions': ['.cpp', '.hpp', '.cc', '.cxx']
    }
}


@dataclass
class ExtractedComment:
    """Represents an extracted code comment."""
    id: str
    file: str
    line: int
    content: str
    is_multi_line: bool
    language: str
    is_explicit_satd: bool
    is_implicit_satd: bool
    matched_patterns: List[str]
    
    def to_dict(self) -> Dict:
        return {
            **asdict(self),
            'matched_patterns': ','.join(self.matched_patterns)
        }


# ============================================================================
# Repository Management
# ============================================================================

def clone_repository(repo_id: str, repo_config: Dict, repos_dir: Path) -> Path:
    """
    Clone a repository if it doesn't exist.
    
    Args:
        repo_id: Repository identifier (e.g., 'AC')
        repo_config: Repository configuration from config.json
        repos_dir: Directory to clone into
        
    Returns:
        Path to the repository
    """
    repo_path = repos_dir / repo_id
    
    if repo_path.exists():
        log_progress(f"Repository {repo_id} already exists at {repo_path}")
        return repo_path
    
    url = repo_config.get('url')
    if not url:
        raise ValueError(f"No URL configured for repository {repo_id}")
    
    config = load_config()
    depth = config.get('global_settings', {}).get('git_clone_depth', 1)
    
    log_progress(f"Cloning {repo_id} from {url}...")
    
    ensure_directory(repos_dir)
    
    cmd = ['git', 'clone', '--depth', str(depth), url, str(repo_path)]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        log_progress(f"Successfully cloned {repo_id}")
    except subprocess.CalledProcessError as e:
        log_progress(f"Failed to clone {repo_id}: {e.stderr}", level="ERROR")
        raise
    
    return repo_path


def get_language_for_extension(ext: str) -> Optional[str]:
    """Get the programming language for a file extension."""
    for lang, config in COMMENT_PATTERNS.items():
        if ext.lower() in config['extensions']:
            return lang
    return None


# ============================================================================
# Comment Extraction
# ============================================================================

def extract_comments_from_file(
    file_path: Path, 
    language: str,
    repo_root: Path
) -> Generator[ExtractedComment, None, None]:
    """
    Extract all comments from a source file.
    
    Args:
        file_path: Path to the source file
        language: Programming language of the file
        repo_root: Root directory of the repository
        
    Yields:
        ExtractedComment objects
    """
    patterns = COMMENT_PATTERNS.get(language)
    if not patterns:
        return
    
    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
            lines = content.split('\n')
    except Exception as e:
        log_progress(f"Error reading {file_path}: {e}", level="WARNING")
        return
    
    relative_path = str(file_path.relative_to(repo_root))
    
    # Extract single-line comments
    single_line_pattern = patterns['single_line']
    for line_num, line in enumerate(lines, 1):
        match = re.search(single_line_pattern, line)
        if match:
            comment_text = match.group(1).strip()
            if comment_text:
                is_explicit, is_implicit, matched = classify_satd_type(comment_text)
                
                yield ExtractedComment(
                    id=generate_comment_id(relative_path, line_num, comment_text),
                    file=relative_path,
                    line=line_num,
                    content=comment_text,
                    is_multi_line=False,
                    language=language,
                    is_explicit_satd=is_explicit,
                    is_implicit_satd=is_implicit,
                    matched_patterns=matched
                )
    
    # Extract multi-line comments
    multi_start = patterns['multi_line_start']
    multi_end = patterns['multi_line_end']
    
    # For Python docstrings, handle triple quotes
    if language == 'python':
        # Match both """ and '''
        multi_pattern = r'("""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\')'
    else:
        # For C-style comments
        multi_pattern = r'/\*[\s\S]*?\*/'
    
    for match in re.finditer(multi_pattern, content):
        comment_text = match.group(0)
        
        # Find the line number
        start_pos = match.start()
        line_num = content[:start_pos].count('\n') + 1
        
        # Clean up the comment (remove delimiters)
        if language == 'python':
            cleaned = comment_text.strip('"\'').strip()
        else:
            cleaned = comment_text[2:-2].strip()
        
        if cleaned:
            is_explicit, is_implicit, matched = classify_satd_type(cleaned)
            
            yield ExtractedComment(
                id=generate_comment_id(relative_path, line_num, cleaned[:100]),
                file=relative_path,
                line=line_num,
                content=cleaned,
                is_multi_line=True,
                language=language,
                is_explicit_satd=is_explicit,
                is_implicit_satd=is_implicit,
                matched_patterns=matched
            )


def extract_comments_from_repository(
    repo_path: Path,
    repo_config: Dict,
    excluded_dirs: List[str]
) -> List[ExtractedComment]:
    """
    Extract all comments from a repository.
    
    Args:
        repo_path: Path to the repository
        repo_config: Repository configuration
        excluded_dirs: Directories to exclude from scanning
        
    Returns:
        List of extracted comments
    """
    comments = []
    extensions = repo_config.get('extensions', [])
    
    # Build set of extensions to process
    ext_set = set(extensions)
    
    log_progress(f"Scanning repository: {repo_path}")
    log_progress(f"Extensions: {extensions}")
    log_progress(f"Excluded dirs: {excluded_dirs}")
    
    file_count = 0
    
    for root, dirs, files in os.walk(repo_path):
        # Skip excluded directories
        dirs[:] = [d for d in dirs if d not in excluded_dirs and not d.startswith('.')]
        
        for filename in files:
            ext = Path(filename).suffix.lower()
            if ext not in ext_set:
                continue
            
            file_path = Path(root) / filename
            language = get_language_for_extension(ext)
            
            if language:
                file_count += 1
                for comment in extract_comments_from_file(file_path, language, repo_path):
                    comments.append(comment)
                
                # Progress report
                if file_count % 100 == 0:
                    log_progress(f"Processed {file_count} files, found {len(comments)} comments so far")
    
    log_progress(f"Completed: {file_count} files, {len(comments)} comments extracted")
    return comments


# ============================================================================
# Main Execution
# ============================================================================

def process_repository(repo_id: str, clone: bool = False) -> Dict:
    """
    Process a single repository: clone if needed, extract comments, save CSV.
    
    Args:
        repo_id: Repository identifier
        clone: Whether to clone if not present
        
    Returns:
        Dictionary with processing results
    """
    log_progress(f"{'=' * 60}")
    log_progress(f"Processing repository: {repo_id}")
    log_progress(f"{'=' * 60}")
    
    # Get configuration
    repo_config = get_repository_config(repo_id)
    if not repo_config:
        log_progress(f"No configuration found for {repo_id}", level="ERROR")
        return {'error': f"Repository {repo_id} not configured"}
    
    repos_dir = get_repos_dir()
    repo_path = repos_dir / repo_id
    
    # Clone if needed
    if clone and not repo_path.exists():
        try:
            repo_path = clone_repository(repo_id, repo_config, repos_dir)
        except Exception as e:
            return {'error': str(e)}
    
    if not repo_path.exists():
        log_progress(f"Repository not found: {repo_path}", level="ERROR")
        return {'error': f"Repository {repo_id} not found at {repo_path}"}
    
    # Extract comments
    excluded_dirs = get_excluded_directories()
    start_time = datetime.now()
    
    comments = extract_comments_from_repository(repo_path, repo_config, excluded_dirs)
    
    duration = (datetime.now() - start_time).total_seconds()
    
    # Save to CSV
    results_dir = get_results_dir()
    csv_path = results_dir / f"{repo_id}_all_comments.csv"
    
    fieldnames = [
        'id', 'file', 'line', 'content', 'is_multi_line', 'language',
        'is_explicit_satd', 'is_implicit_satd', 'matched_patterns'
    ]
    
    comment_dicts = [c.to_dict() for c in comments]
    save_dicts_as_csv(comment_dicts, csv_path, fieldnames)
    
    log_progress(f"Saved {len(comments)} comments to {csv_path}")
    
    # Calculate statistics
    explicit_count = sum(1 for c in comments if c.is_explicit_satd)
    implicit_count = sum(1 for c in comments if c.is_implicit_satd)
    satd_count = sum(1 for c in comments if c.is_explicit_satd or c.is_implicit_satd)
    
    # Get unique patterns matched
    all_patterns = set()
    for c in comments:
        all_patterns.update(c.matched_patterns)
    
    result = {
        'repo_id': repo_id,
        'repo_name': repo_config.get('name', repo_id),
        'total_comments': len(comments),
        'satd_candidates': satd_count,
        'explicit_satd': explicit_count,
        'implicit_satd': implicit_count,
        'non_satd': len(comments) - satd_count,
        'satd_ratio': round(satd_count / len(comments), 4) if comments else 0,
        'output_file': str(csv_path),
        'processing_time_seconds': round(duration, 2),
        'languages': repo_config.get('languages', []),
        'unique_patterns_matched': list(all_patterns)
    }
    
    log_progress(f"Statistics for {repo_id}:")
    log_progress(f"  Total comments: {result['total_comments']}")
    log_progress(f"  SATD candidates: {result['satd_candidates']} ({result['satd_ratio']*100:.1f}%)")
    log_progress(f"  Explicit: {result['explicit_satd']}, Implicit: {result['implicit_satd']}")
    
    return result


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description='Extract comments from subject systems for RQ1 evaluation'
    )
    parser.add_argument(
        '--repos',
        type=str,
        default=None,
        help='Comma-separated list of repository IDs (default: from config)'
    )
    parser.add_argument(
        '--clone',
        action='store_true',
        help='Clone repositories if they do not exist'
    )
    
    args = parser.parse_args()
    
    # Determine which repositories to process
    if args.repos:
        repo_ids = [r.strip() for r in args.repos.split(',')]
    else:
        repo_ids = get_subject_systems()
    
    log_progress(f"RQ1 Data Collection - Processing repositories: {repo_ids}")
    
    # Process each repository
    results = {}
    summary = {
        'total_repos': len(repo_ids),
        'successful': 0,
        'failed': 0,
        'total_comments': 0,
        'total_satd_candidates': 0,
        'repositories': {}
    }
    
    for repo_id in repo_ids:
        result = process_repository(repo_id, clone=args.clone)
        results[repo_id] = result
        
        if 'error' in result:
            summary['failed'] += 1
        else:
            summary['successful'] += 1
            summary['total_comments'] += result.get('total_comments', 0)
            summary['total_satd_candidates'] += result.get('satd_candidates', 0)
        
        summary['repositories'][repo_id] = result
    
    # Save summary report
    summary_path = save_json_report(summary, 'data_collection_summary.json')
    log_progress(f"Summary saved to: {summary_path}")
    
    # Print final summary
    log_progress(f"\n{'=' * 60}")
    log_progress("DATA COLLECTION COMPLETE")
    log_progress(f"{'=' * 60}")
    log_progress(f"Repositories processed: {summary['successful']}/{summary['total_repos']}")
    log_progress(f"Total comments extracted: {summary['total_comments']}")
    log_progress(f"Total SATD candidates: {summary['total_satd_candidates']}")
    
    return 0 if summary['failed'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

