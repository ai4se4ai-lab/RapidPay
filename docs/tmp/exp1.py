#!/usr/bin/env python3
"""
RapidPay SATD Dataset Generator
Extracts code comments from GitHub repositories and creates CSV datasets
for SATD (Self-Admitted Technical Debt) analysis.
"""

import os
import re
import csv
import ast
import json
import subprocess
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple, Dict, Any
import hashlib

# ============== Configuration ==============

class ConfigLoader:
    """Load and manage configuration from JSON file"""
    
    def __init__(self, config_path: str = "config.json"):
        # Resolve config path relative to script directory if not absolute
        config_path_obj = Path(config_path)
        if config_path_obj.is_absolute():
            self.config_path = config_path_obj
        else:
            # Try to resolve relative to script directory, fallback to current directory
            try:
                script_dir = Path(__file__).parent
                self.config_path = script_dir / config_path
            except NameError:
                # __file__ not available (e.g., interactive mode)
                self.config_path = Path(config_path).resolve()
        self.config: Dict[str, Any] = {}
        self.load_config()
    
    def load_config(self):
        """Load configuration from JSON file"""
        if not self.config_path.exists():
            raise FileNotFoundError(
                f"Configuration file not found: {self.config_path}\n"
                f"Please create a config.json file in the same directory as the script."
            )
        
        with open(self.config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
    
    def get_experiment_config(self, experiment_id: str = "exp1") -> Dict[str, Any]:
        """Get configuration for a specific experiment"""
        experiments = self.config.get("experiments", {})
        if experiment_id not in experiments:
            raise KeyError(f"Experiment '{experiment_id}' not found in configuration")
        return experiments[experiment_id]
    
    def get_repositories(self, enabled_only: bool = True) -> Dict[str, Dict[str, Any]]:
        """Get repository configurations"""
        repos = self.config.get("repositories", {})
        if enabled_only:
            return {k: v for k, v in repos.items() if v.get("enabled", True)}
        return repos
    
    def get_satd_patterns(self) -> Dict[str, List[str]]:
        """Get SATD patterns from configuration"""
        patterns = self.config.get("satd_patterns", {})
        # Convert string patterns to regex patterns
        return {
            "explicit": [re.compile(p) for p in patterns.get("explicit", [])],
            "implicit": [re.compile(p, re.IGNORECASE) for p in patterns.get("implicit", [])]
        }
    
    def get_global_setting(self, key: str, default: Any = None) -> Any:
        """Get a global setting value"""
        return self.config.get("global_settings", {}).get(key, default)
    
    def reload(self):
        """Reload configuration from file"""
        self.load_config()


# Global config loader instance (will be initialized in main)
_config_loader: Optional[ConfigLoader] = None
_config_path: Optional[str] = None

def get_config_loader(config_path: str = "config.json") -> ConfigLoader:
    """Get or create the global config loader instance"""
    global _config_loader, _config_path
    # Create new instance if path changed or doesn't exist
    if _config_loader is None or _config_path != config_path:
        _config_loader = ConfigLoader(config_path)
        _config_path = config_path
    return _config_loader

# ============== Data Classes ==============

@dataclass
class CommentRecord:
    """Represents a single extracted comment"""
    project_id: str
    project_name: str
    file_path: str
    file_name: str
    line_number: int
    end_line_number: int
    comment_type: str  # single, multi, docstring
    comment_text: str
    comment_hash: str
    containing_function: Optional[str]
    containing_class: Optional[str]
    is_explicit_satd: bool
    is_implicit_satd: bool
    satd_keywords_found: str
    language: str
    extraction_date: str
    

# ============== Comment Extractors ==============

class CommentExtractor:
    """Base class for comment extraction"""
    
    def __init__(self, project_id: str, project_name: str, language: str, config_loader: ConfigLoader):
        self.project_id = project_id
        self.project_name = project_name
        self.language = language
        self.config_loader = config_loader
        self.satd_patterns = config_loader.get_satd_patterns()
        
    def extract_comments(self, file_path: str, content: str) -> List[CommentRecord]:
        raise NotImplementedError
    
    def classify_satd(self, comment_text: str) -> Tuple[bool, bool, List[str]]:
        """Classify comment as explicit/implicit SATD"""
        explicit = False
        implicit = False
        keywords = []
        
        text_lower = comment_text.lower()
        
        for pattern in self.satd_patterns["explicit"]:
            match = pattern.search(comment_text)
            if match:
                explicit = True
                keywords.append(match.group())
                
        for pattern in self.satd_patterns["implicit"]:
            match = pattern.search(text_lower)
            if match:
                implicit = True
                keywords.append(match.group())
                    
        return explicit, implicit, keywords
    
    def create_record(self, file_path: str, line_num: int, end_line: int,
                     comment_type: str, text: str, 
                     func_name: Optional[str] = None,
                     class_name: Optional[str] = None) -> CommentRecord:
        """Create a CommentRecord from extracted comment"""
        
        explicit, implicit, keywords = self.classify_satd(text)
        
        hash_length = self.config_loader.get_global_setting("comment_hash_length", 12)
        
        return CommentRecord(
            project_id=self.project_id,
            project_name=self.project_name,
            file_path=file_path,
            file_name=os.path.basename(file_path),
            line_number=line_num,
            end_line_number=end_line,
            comment_type=comment_type,
            comment_text=text.strip(),
            comment_hash=hashlib.md5(text.encode()).hexdigest()[:hash_length],
            containing_function=func_name,
            containing_class=class_name,
            is_explicit_satd=explicit,
            is_implicit_satd=implicit,
            satd_keywords_found="|".join(keywords) if keywords else "",
            language=self.language,
            extraction_date=datetime.now().isoformat()
        )


class PythonExtractor(CommentExtractor):
    """Extract comments from Python files using AST"""
    
    def __init__(self, project_id: str, project_name: str, config_loader: ConfigLoader):
        super().__init__(project_id, project_name, "python", config_loader)
        
    def extract_comments(self, file_path: str, content: str) -> List[CommentRecord]:
        comments = []
        lines = content.split('\n')
        
        # Extract hash comments
        in_multiline_string = False
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            
            # Simple hash comment detection
            if '#' in line and not in_multiline_string:
                # Find the # that starts a comment (not inside a string)
                comment_match = re.search(r'(?<![\'\"])#(.*)$', line)
                if comment_match:
                    comment_text = comment_match.group(1).strip()
                    if comment_text:
                        comments.append(self.create_record(
                            file_path, i, i, "single", comment_text
                        ))
        
        # Extract docstrings using AST
        try:
            tree = ast.parse(content)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
                    docstring = ast.get_docstring(node)
                    if docstring:
                        func_name = getattr(node, 'name', None)
                        class_name = None
                        
                        if isinstance(node, ast.ClassDef):
                            class_name = node.name
                            func_name = None
                        
                        # Approximate line numbers
                        start_line = getattr(node, 'lineno', 1)
                        
                        comments.append(self.create_record(
                            file_path, start_line, start_line,
                            "docstring", docstring, func_name, class_name
                        ))
        except SyntaxError:
            pass  # Skip files with syntax errors
            
        return comments


class JavaScriptExtractor(CommentExtractor):
    """Extract comments from JavaScript/TypeScript files"""
    
    def __init__(self, project_id: str, project_name: str, config_loader: ConfigLoader, language: str = "javascript"):
        super().__init__(project_id, project_name, language, config_loader)
        
    def extract_comments(self, file_path: str, content: str) -> List[CommentRecord]:
        comments = []
        
        # Single-line comments: //
        single_pattern = r'//(.*)$'
        for match in re.finditer(single_pattern, content, re.MULTILINE):
            text = match.group(1).strip()
            if text:
                line_num = content[:match.start()].count('\n') + 1
                comments.append(self.create_record(
                    file_path, line_num, line_num, "single", text
                ))
        
        # Multi-line comments: /* ... */
        multi_pattern = r'/\*[\s\S]*?\*/'
        for match in re.finditer(multi_pattern, content):
            text = match.group()
            # Clean up comment markers
            text = re.sub(r'^/\*+\s*', '', text)
            text = re.sub(r'\s*\*+/$', '', text)
            text = re.sub(r'\n\s*\*\s?', '\n', text)
            text = text.strip()
            
            if text:
                start_line = content[:match.start()].count('\n') + 1
                end_line = content[:match.end()].count('\n') + 1
                comments.append(self.create_record(
                    file_path, start_line, end_line, "multi", text
                ))
                
        return comments


class CStyleExtractor(CommentExtractor):
    """Extract comments from C/C++/Java/Go files"""
    
    def __init__(self, project_id: str, project_name: str, language: str, config_loader: ConfigLoader):
        super().__init__(project_id, project_name, language, config_loader)
        
    def extract_comments(self, file_path: str, content: str) -> List[CommentRecord]:
        comments = []
        
        # Single-line comments: //
        single_pattern = r'//(.*)$'
        for match in re.finditer(single_pattern, content, re.MULTILINE):
            text = match.group(1).strip()
            if text:
                line_num = content[:match.start()].count('\n') + 1
                comments.append(self.create_record(
                    file_path, line_num, line_num, "single", text
                ))
        
        # Multi-line comments: /* ... */
        multi_pattern = r'/\*[\s\S]*?\*/'
        for match in re.finditer(multi_pattern, content):
            text = match.group()
            # Clean up
            text = re.sub(r'^/\*+\s*', '', text)
            text = re.sub(r'\s*\*+/$', '', text)
            text = re.sub(r'\n\s*\*\s?', '\n', text)
            text = text.strip()
            
            if text:
                start_line = content[:match.start()].count('\n') + 1
                end_line = content[:match.end()].count('\n') + 1
                comments.append(self.create_record(
                    file_path, start_line, end_line, "multi", text
                ))
                
        return comments


# ============== Main Dataset Generator ==============

class SATDDatasetGenerator:
    """Main class for generating SATD datasets from repositories"""
    
    def __init__(self, config_loader: ConfigLoader, experiment_id: str = "exp1"):
        self.config_loader = config_loader
        self.experiment_config = config_loader.get_experiment_config(experiment_id)
        self.repositories = config_loader.get_repositories(enabled_only=True)
        
        # Get directories from experiment config or use defaults
        self.output_dir = Path(self.experiment_config.get("output_dir", "./results"))
        self.repos_dir = Path(self.experiment_config.get("repos_dir", "./repos"))
        self.excluded_dirs = self.experiment_config.get("excluded_directories", [
            "test", "vendor", "node_modules", "third_party", "external", ".git"
        ])
        self.progress_interval = self.experiment_config.get("progress_report_interval", 100)
        self.git_clone_depth = config_loader.get_global_setting("git_clone_depth", 1)
        
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.repos_dir.mkdir(parents=True, exist_ok=True)
        
    def clone_repository(self, project_id: str, url: str) -> Path:
        """Clone a repository if not already cloned"""
        repo_path = self.repos_dir / project_id
        
        if repo_path.exists():
            print(f"  Repository already exists: {repo_path}")
            return repo_path
            
        print(f"  Cloning {url}...")
        clone_cmd = ["git", "clone", "--depth", str(self.git_clone_depth), url, str(repo_path)]
        subprocess.run(
            clone_cmd,
            check=True,
            capture_output=True
        )
        return repo_path
    
    def get_extractor(self, project_id: str, project_name: str, 
                      extension: str) -> Optional[CommentExtractor]:
        """Get appropriate extractor for file extension"""
        
        ext_map = {
            '.py': lambda: PythonExtractor(project_id, project_name, self.config_loader),
            '.pyx': lambda: PythonExtractor(project_id, project_name, self.config_loader),
            '.js': lambda: JavaScriptExtractor(project_id, project_name, self.config_loader, "javascript"),
            '.jsx': lambda: JavaScriptExtractor(project_id, project_name, self.config_loader, "javascript"),
            '.ts': lambda: JavaScriptExtractor(project_id, project_name, self.config_loader, "typescript"),
            '.tsx': lambda: JavaScriptExtractor(project_id, project_name, self.config_loader, "typescript"),
            '.java': lambda: CStyleExtractor(project_id, project_name, "java", self.config_loader),
            '.kt': lambda: CStyleExtractor(project_id, project_name, "kotlin", self.config_loader),
            '.c': lambda: CStyleExtractor(project_id, project_name, "c", self.config_loader),
            '.h': lambda: CStyleExtractor(project_id, project_name, "c", self.config_loader),
            '.cpp': lambda: CStyleExtractor(project_id, project_name, "cpp", self.config_loader),
            '.cc': lambda: CStyleExtractor(project_id, project_name, "cpp", self.config_loader),
            '.hpp': lambda: CStyleExtractor(project_id, project_name, "cpp", self.config_loader),
            '.go': lambda: CStyleExtractor(project_id, project_name, "go", self.config_loader),
        }
        
        if extension in ext_map:
            return ext_map[extension]()
        return None
    
    def process_file(self, file_path: Path, project_id: str, 
                    project_name: str) -> List[CommentRecord]:
        """Process a single file and extract comments"""
        
        extension = file_path.suffix.lower()
        extractor = self.get_extractor(project_id, project_name, extension)
        
        if not extractor:
            return []
            
        try:
            content = file_path.read_text(encoding='utf-8', errors='ignore')
            return extractor.extract_comments(str(file_path), content)
        except Exception as e:
            print(f"    Error processing {file_path}: {e}")
            return []
    
    def process_project(self, project_id: str, config: dict) -> List[CommentRecord]:
        """Process all files in a project"""
        
        print(f"\n{'='*60}")
        print(f"Processing: {config['name']} ({project_id})")
        print(f"{'='*60}")
        
        # Clone repository
        try:
            repo_path = self.clone_repository(project_id, config['url'])
        except subprocess.CalledProcessError as e:
            print(f"  Failed to clone repository: {e}")
            return []
        
        all_comments = []
        file_count = 0
        
        # Process files
        for ext in config['extensions']:
            files = list(repo_path.rglob(f"*{ext}"))
            print(f"  Found {len(files)} {ext} files")
            
            for file_path in files:
                # Skip excluded directories
                path_str = str(file_path).lower()
                if any(skip in path_str for skip in self.excluded_dirs):
                    continue
                    
                comments = self.process_file(file_path, project_id, config['name'])
                all_comments.extend(comments)
                file_count += 1
                
                if file_count % self.progress_interval == 0:
                    print(f"    Processed {file_count} files, {len(all_comments)} comments found")
        
        print(f"  Total: {file_count} files, {len(all_comments)} comments")
        
        # Filter to only SATD comments for main dataset
        satd_comments = [c for c in all_comments if c.is_explicit_satd or c.is_implicit_satd]
        print(f"  SATD comments: {len(satd_comments)} ({len([c for c in satd_comments if c.is_explicit_satd])} explicit, {len([c for c in satd_comments if c.is_implicit_satd and not c.is_explicit_satd])} implicit)")
        
        return all_comments
    
    def save_to_csv(self, comments: List[CommentRecord], 
                   project_id: str, include_all: bool = False):
        """Save comments to CSV file"""
        
        if not comments:
            print(f"  No comments to save for {project_id}")
            return
            
        # Create separate files for all comments and SATD-only
        if include_all:
            filename = self.output_dir / f"{project_id}_all_comments.csv"
            data = comments
        else:
            filename = self.output_dir / f"{project_id}_satd_comments.csv"
            data = [c for c in comments if c.is_explicit_satd or c.is_implicit_satd]
        
        if not data:
            print(f"  No data to save to {filename}")
            return
            
        fieldnames = [
            'project_id', 'project_name', 'file_path', 'file_name',
            'line_number', 'end_line_number', 'comment_type', 'comment_text',
            'comment_hash', 'containing_function', 'containing_class',
            'is_explicit_satd', 'is_implicit_satd', 'satd_keywords_found',
            'language', 'extraction_date'
        ]
        
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for comment in data:
                writer.writerow(asdict(comment))
                
        print(f"  Saved {len(data)} comments to {filename}")
    
    def generate_summary(self, all_results: dict):
        """Generate summary statistics CSV"""
        
        summary_file = self.output_dir / "dataset_summary.csv"
        
        with open(summary_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                'project_id', 'project_name', 'total_comments',
                'satd_comments', 'explicit_satd', 'implicit_satd',
                'python_comments', 'javascript_comments', 'java_comments',
                'c_cpp_comments', 'go_comments', 'other_comments'
            ])
            
            for project_id, comments in all_results.items():
                if not comments:
                    continue
                
                if project_id not in self.repositories:
                    continue
                    
                total = len(comments)
                satd = len([c for c in comments if c.is_explicit_satd or c.is_implicit_satd])
                explicit = len([c for c in comments if c.is_explicit_satd])
                implicit = len([c for c in comments if c.is_implicit_satd and not c.is_explicit_satd])
                
                python = len([c for c in comments if c.language == 'python'])
                js = len([c for c in comments if c.language in ['javascript', 'typescript']])
                java = len([c for c in comments if c.language in ['java', 'kotlin']])
                c_cpp = len([c for c in comments if c.language in ['c', 'cpp']])
                go = len([c for c in comments if c.language == 'go'])
                other = total - python - js - java - c_cpp - go
                
                project_name = self.repositories[project_id]['name']
                writer.writerow([
                    project_id, project_name, total,
                    satd, explicit, implicit,
                    python, js, java, c_cpp, go, other
                ])
                
        print(f"\nSummary saved to {summary_file}")
    
    def run(self, project_ids: Optional[List[str]] = None):
        """Run the dataset generation for specified projects"""
        
        if project_ids is None:
            project_ids = list(self.repositories.keys())
            
        all_results = {}
        
        for project_id in project_ids:
            if project_id not in self.repositories:
                print(f"Unknown project: {project_id}")
                continue
            
            if not self.repositories[project_id].get("enabled", True):
                print(f"Skipping disabled project: {project_id}")
                continue
                
            config = self.repositories[project_id]
            comments = self.process_project(project_id, config)
            all_results[project_id] = comments
            
            # Save individual project CSVs
            self.save_to_csv(comments, project_id, include_all=True)
            self.save_to_csv(comments, project_id, include_all=False)
        
        # Generate summary
        self.generate_summary(all_results)
        
        return all_results


# ============== Entry Point ==============

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate SATD datasets from GitHub repositories')
    parser.add_argument('--projects', nargs='+', default=None,
                       help='Project IDs to process (default: all enabled)')
    parser.add_argument('--config', type=str, default='config.json',
                       help='Path to configuration file (default: config.json)')
    parser.add_argument('--experiment', type=str, default='exp1',
                       help='Experiment ID from config (default: exp1)')
    
    args = parser.parse_args()
    
    # Load configuration
    try:
        config_loader = get_config_loader(args.config)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("\nPlease create a config.json file. See the example configuration structure.")
        exit(1)
    except Exception as e:
        print(f"Error loading configuration: {e}")
        exit(1)
    
    # Create generator with config
    try:
        generator = SATDDatasetGenerator(config_loader, args.experiment)
    except KeyError as e:
        print(f"Error: {e}")
        exit(1)
    
    exp_config = config_loader.get_experiment_config(args.experiment)
    
    print("="*60)
    print(f"RapidPay SATD Dataset Generator - {exp_config.get('name', args.experiment)}")
    print("="*60)
    print(f"Configuration file: {args.config}")
    print(f"Experiment: {args.experiment}")
    print(f"Output directory: {generator.output_dir}")
    print(f"Repository directory: {generator.repos_dir}")
    print(f"Projects: {args.projects or 'All enabled'}")
    
    results = generator.run(args.projects)
    
    print("\n" + "="*60)
    print("Dataset Generation Complete!")
    print("="*60)