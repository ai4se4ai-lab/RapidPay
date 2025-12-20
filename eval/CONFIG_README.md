# Configuration File Guide

This document explains how to configure the SATD Dataset Generator using `config.json`.

## File Structure

The configuration file is organized into four main sections:

### 1. Experiments (`experiments`)

Defines experiment-specific settings. Each experiment has its own configuration:

```json
{
  "experiments": {
    "exp1": {
      "name": "SATD Dataset Generator",
      "description": "Description of the experiment",
      "output_dir": "./results",
      "repos_dir": "./repos",
      "excluded_directories": ["test", "vendor", "node_modules"],
      "progress_report_interval": 100
    }
  }
}
```

**Parameters:**
- `name`: Display name for the experiment
- `description`: Description of what the experiment does
- `output_dir`: Directory where CSV output files will be saved
- `repos_dir`: Directory where repositories will be cloned
- `excluded_directories`: List of directory names to skip during processing
- `progress_report_interval`: Number of files to process before printing progress

### 2. Repositories (`repositories`)

Defines the GitHub repositories to analyze. Each repository needs:

```json
{
  "REPO_ID": {
    "name": "Repository Display Name",
    "url": "https://github.com/user/repo.git",
    "languages": ["python", "java"],
    "extensions": [".py", ".java"],
    "enabled": true
  }
}
```

**Parameters:**
- `name`: Human-readable name of the repository
- `url`: Git clone URL
- `languages`: List of programming languages in the repository
- `extensions`: File extensions to process (must include the dot, e.g., `.py`)
- `enabled`: Set to `false` to skip this repository

**Adding a New Repository:**

1. Choose a unique ID (e.g., "NP" for a new project)
2. Add the repository configuration:
```json
"NP": {
  "name": "New Project",
  "url": "https://github.com/user/new-project.git",
  "languages": ["python"],
  "extensions": [".py"],
  "enabled": true
}
```

### 3. SATD Patterns (`satd_patterns`)

Defines regex patterns for detecting Self-Admitted Technical Debt:

```json
{
  "satd_patterns": {
    "explicit": ["\\bTODO\\b", "\\bFIXME\\b"],
    "implicit": ["\\bworkaround\\b", "\\bquick.?fix\\b"]
  }
}
```

**Pattern Types:**
- `explicit`: Patterns for explicit SATD markers (case-insensitive)
- `implicit`: Patterns for implicit SATD indicators (case-insensitive)

**Note:** Use double backslashes (`\\`) for regex escape sequences in JSON.

### 4. Global Settings (`global_settings`)

Settings that apply across all experiments:

```json
{
  "global_settings": {
    "git_clone_depth": 1,
    "default_encoding": "utf-8",
    "comment_hash_length": 12
  }
}
```

**Parameters:**
- `git_clone_depth`: Git clone depth (1 = shallow clone, saves space)
- `default_encoding`: File encoding for reading source files
- `comment_hash_length`: Length of comment hash in output

## Usage Examples

### Running with default config:
```bash
python exp1.py
```

### Running with custom config file:
```bash
python exp1.py --config my_config.json
```

### Running specific experiment:
```bash
python exp1.py --experiment exp1
```

### Processing specific repositories:
```bash
python exp1.py --projects AC SF TF
```

## Adding New Experiments

To add a new experiment configuration:

1. Add a new entry in the `experiments` section:
```json
"exp2": {
  "name": "My New Experiment",
  "description": "Description here",
  "output_dir": "./results_exp2",
  "repos_dir": "./repos",
  "excluded_directories": ["test", "vendor"],
  "progress_report_interval": 50
}
```

2. Run with the new experiment:
```bash
python exp1.py --experiment exp2
```

## Tips

- Set `enabled: false` for repositories you want to keep in config but skip during processing
- Adjust `progress_report_interval` based on repository size (smaller for large repos)
- Use absolute paths for `output_dir` and `repos_dir` if you want consistent locations
- Add custom SATD patterns to match your project's coding style

