# RQ1 Evaluation Suite

## Overview

This directory contains the evaluation suite for **RQ1: How can SATD instances be accurately detected and structured into propagation chains using program-level dependencies?**

The evaluation implements the experimental design described in the paper, including:
- **SID (SATD Instance Detection)** accuracy evaluation with precision, recall, and F1-score
- **IRD (Inter-SATD Relationship Discovery)** evaluation for dependency detection
- **Chain construction** accuracy and coherence assessment
- **Stratified sampling** for ground truth generation

## Directory Structure

```
eval/RQ1/
├── README.md                    # This documentation
├── utils.py                     # Shared utilities for all scripts
├── 01_data_collection.py        # Extract comments from repositories
├── 02_sid_evaluation.py         # Evaluate SATD detection accuracy
├── 03_baseline_comparison.py    # Compare with baseline detection methods
├── 03_ird_evaluation.py         # Evaluate relationship discovery
├── 04_chain_evaluation.py       # Evaluate chain construction
├── 05_generate_ground_truth.py  # Generate ground truth datasets
├── baselines/                   # Baseline SATD detection implementations
│   ├── __init__.py              # Baseline factory functions
│   ├── base_detector.py         # Abstract base class
│   ├── lexical_baseline.py      # Pattern-matching baseline
│   ├── debtfree/                # DebtFree semi-supervised detector
│   ├── gnn_based/               # GNN-based detector
│   ├── satdaug/                 # SATDAug with data augmentation
│   └── flan_t5/                 # Fine-tuned Flan-T5 detector
├── bridge/
│   ├── sid_bridge.js            # Node.js bridge for SID TypeScript module
│   └── ird_bridge.js            # Node.js bridge for IRD TypeScript module
├── ground_truth/                # Ground truth CSV files
│   ├── AC_ground_truth.csv
│   ├── RE_ground_truth.csv
│   └── SC_ground_truth.csv
├── requirements_baselines.txt   # Python dependencies for baselines
└── results/                     # Evaluation output files
    ├── *_all_comments.csv
    ├── sid_evaluation_*.json
    ├── ird_evaluation_*.json
    ├── chain_evaluation_*.json
    └── baseline_comparison_*.csv
```

## Prerequisites

### 1. Install Node.js Dependencies

```bash
cd /path/to/RapidPay
npm install
```

### 2. Compile TypeScript

```bash
npm run compile
```

### 3. Install Python Dependencies

```bash
pip install pandas  # Optional, for CSV handling
```

### 4. Set OpenAI API Key (Optional)

For LLM-based classification:

```bash
export OPENAI_API_KEY=your_api_key_here
```

Or add to the configuration in `eval/config.json`:

```json
{
  "experiments": {
    "rq1": {
      "openai_config": {
        "api_key_env": "OPENAI_API_KEY",
        "use_llm": true
      }
    }
  }
}
```

### 5. Clone Subject Repositories

Ensure the subject repositories are cloned in `eval/repos/`:

```bash
cd eval/repos
git clone --depth 1 https://github.com/apache/commons-lang.git AC
git clone --depth 1 https://github.com/facebook/react.git RE
git clone --depth 1 https://github.com/scipy/scipy.git SC
```

Or run with the `--clone` flag in step 1.

## Running the Evaluation

### Full Pipeline

Run the complete RQ1 evaluation pipeline:

```bash
# Step 1: Extract comments from repositories
python eval/RQ1/01_data_collection.py --clone

# Step 2: Generate ground truth datasets
python eval/RQ1/05_generate_ground_truth.py

# Step 3: Evaluate SID (SATD detection)
python eval/RQ1/02_sid_evaluation.py

# Step 4: Evaluate IRD (relationship discovery)
python eval/RQ1/03_ird_evaluation.py

# Step 5: Evaluate chain construction
python eval/RQ1/04_chain_evaluation.py
```

### Individual Scripts

#### 01_data_collection.py

Extracts all code comments from subject systems:

```bash
python eval/RQ1/01_data_collection.py [--repos AC,RE,SC] [--clone]
```

Options:
- `--repos`: Comma-separated list of repository IDs (default: from config)
- `--clone`: Clone repositories if they don't exist

Output:
- `results/[REPO]_all_comments.csv`: All extracted comments
- `results/data_collection_summary.json`: Summary statistics

#### 05_generate_ground_truth.py

Generates stratified samples for ground truth annotation:

```bash
python eval/RQ1/05_generate_ground_truth.py [--repos AC,RE,SC] [--template-only]
```

Options:
- `--repos`: Comma-separated list of repository IDs
- `--template-only`: Only generate templates for manual annotation

Output:
- `ground_truth/[REPO]_ground_truth_template.csv`: Template for annotation
- `ground_truth/[REPO]_ground_truth.csv`: Synthetic ground truth

#### 02_sid_evaluation.py

Evaluates SATD detection accuracy:

```bash
python eval/RQ1/02_sid_evaluation.py [--repos AC,RE,SC] [--use-llm] [--baseline]
```

Options:
- `--repos`: Comma-separated list of repository IDs
- `--use-llm`: Enable LLM classification (requires API key)
- `--baseline`: Include lexical-only baseline comparison

Output:
- `results/sid_evaluation_[REPO].json`: Per-repo results
- `results/sid_evaluation_summary.json`: Aggregated results

#### 03_ird_evaluation.py

Evaluates relationship discovery:

```bash
python eval/RQ1/03_ird_evaluation.py [--repos AC,RE,SC] [--sample-edges N]
```

Options:
- `--repos`: Comma-separated list of repository IDs
- `--sample-edges`: Number of edges to sample per repo (default: 100)

Output:
- `results/ird_evaluation_[REPO].json`: Per-repo results
- `results/ird_edge_samples_[REPO].csv`: Edge samples for review
- `results/ird_evaluation_summary.json`: Aggregated results

#### 04_chain_evaluation.py

Evaluates chain construction:

```bash
python eval/RQ1/04_chain_evaluation.py [--repos AC,RE,SC] [--sample-chains N]
```

Options:
- `--repos`: Comma-separated list of repository IDs
- `--sample-chains`: Number of chains to sample per repo (default: 10)

Output:
- `results/chain_evaluation_[REPO].json`: Per-repo results
- `results/chain_samples_[REPO].csv`: Chain samples for review
- `results/chain_evaluation_summary.json`: Aggregated results

## Configuration

All parameters are configurable in `eval/config.json` under the `rq1` experiment:

```json
{
  "experiments": {
    "rq1": {
      "subject_systems": ["AC", "RE", "SC"],
      "stratified_sampling": {
        "satd_sample_size": 200,
        "non_satd_sample_size": 200,
        "random_seed": 42,
        "line_tolerance": 5
      },
      "openai_config": {
        "api_key_env": "OPENAI_API_KEY",
        "model_name": "gpt-4o",
        "use_llm": false,
        "confidence_threshold": 0.7
      },
      "thresholds": {
        "precision_threshold": 0.80,
        "recall_threshold": 0.90,
        "edge_correctness_threshold": 0.87,
        "chain_coherence_threshold": 0.71
      }
    }
  }
}
```

## Ground Truth Format

### CSV Columns

| Column | Description |
|--------|-------------|
| `id` | Unique identifier |
| `file` | Source file path |
| `line` | Line number |
| `content` | Comment content |
| `predicted_label` | SID prediction ('satd' or 'non-satd') |
| `manual_label` | Human annotation ('satd' or 'non-satd') |
| `is_explicit` | Contains explicit SATD markers |
| `is_implicit` | Contains implicit SATD indicators |
| `annotator_1` | First annotator's label |
| `annotator_2` | Second annotator's label |
| `consensus` | Resolved label after discussion |
| `disagreement` | Whether annotators disagreed |
| `confidence_score` | Detection confidence (0-1) |
| `debt_type` | Type of technical debt |
| `notes` | Annotator notes |

## Evaluation Metrics

### SID Detection (Precision/Recall/F1)

Based on the paper's evaluation protocol:
- **Precision threshold**: ≥ 80%
- **Recall threshold**: ≥ 90%
- **F1 threshold**: ≥ 85%

### IRD Edge Correctness

Edge annotation categories:
- **Correct and relevant**: Dependency exists and is relevant to SATD
- **Correct but marginal**: Dependency exists but unlikely to matter
- **Incorrect**: No such dependency

Precision = (Correct + Marginal) / Total

### Chain Coherence

5-point Likert scale:
- 1: Not coherent at all
- 5: Highly coherent (would consider items together for refactoring)

Target: **71% of chains rated 4 or 5**

## Baseline Comparison

The evaluation includes comparison against four existing SATD detection methods:

### Available Baselines

| Method | Year | Description |
|--------|------|-------------|
| **Lexical-only** | --- | Pure pattern-matching baseline using keywords |
| **DebtFree** | 2022 | Semi-supervised learning with self-training (Tu et al.) |
| **GNN-based** | 2022 | Graph Neural Network approach (Yu et al.) |
| **SATDAug** | 2024 | Data augmentation with BERT (Sutoyo et al.) |
| **Fine-tuned Flan-T5** | 2024 | Seq2seq transformer (Sheikhaei et al.) |

### Running Baseline Comparison

```bash
# Run comparison on all configured repositories
python eval/RQ1/03_baseline_comparison.py

# Run on specific repositories
python eval/RQ1/03_baseline_comparison.py --repos AC,RE,SC

# Run specific methods only
python eval/RQ1/03_baseline_comparison.py --methods lexical,debtfree

# Disable fallback (require full dependencies)
python eval/RQ1/03_baseline_comparison.py --no-fallback
```

### Baseline Output Files

- `baseline_comparison_metrics.csv`: Per-project metrics for each method
- `baseline_comparison_summary.csv`: Aggregated metrics across projects
- `baseline_comparison_by_type.csv`: Explicit vs Implicit SATD breakdown
- `baseline_comparison_summary.json`: Full JSON report

### Installing Baseline Dependencies

```bash
# Core dependencies (required)
pip install scikit-learn numpy scipy

# Optional: Full baseline support
pip install -r eval/RQ1/requirements_baselines.txt
```

### Fallback Mode

When optional dependencies (transformers, torch) are not available, the baselines
automatically fall back to simpler implementations:

- **GNN-based**: Uses NetworkX + MLP instead of PyTorch Geometric
- **SATDAug**: Uses TF-IDF + Random Forest instead of DistilBERT
- **Flan-T5**: Uses TF-IDF + Logistic Regression instead of T5

This allows running the comparison without GPU or heavy ML dependencies.

### Using Baselines in SID Evaluation

```bash
# Include full baseline comparison in SID evaluation
python eval/RQ1/02_sid_evaluation.py --include-baselines

# Or just lexical baseline comparison
python eval/RQ1/02_sid_evaluation.py --baseline
```

## Output Files

### Summary Reports

- `sid_evaluation_summary.json`: Aggregate SID metrics
- `ird_evaluation_summary.json`: Aggregate IRD metrics  
- `chain_evaluation_summary.json`: Aggregate chain metrics
- `baseline_comparison_summary.json`: Baseline comparison results

### Baseline Comparison Results

- `baseline_comparison_metrics.csv`: Per-project metrics
- `baseline_comparison_summary.csv`: Aggregated metrics
- `baseline_comparison_by_type.csv`: Explicit vs Implicit breakdown

### Per-Repository Results

- `sid_evaluation_[REPO].json`: Detection metrics
- `ird_evaluation_[REPO].json`: Relationship metrics
- `chain_evaluation_[REPO].json`: Chain metrics

### Samples for Manual Review

- `ird_edge_samples_[REPO].csv`: Sampled edges for annotation
- `chain_samples_[REPO].csv`: Sampled chains for coherence rating

## Troubleshooting

### "TypeScript not compiled" Error

Run:
```bash
npm run compile
```

### "Repository not found" Error

Ensure repositories are cloned:
```bash
python eval/RQ1/01_data_collection.py --clone
```

### "Ground truth not found" Error

Generate ground truth first:
```bash
python eval/RQ1/05_generate_ground_truth.py
```

### Bridge Script Timeout

For large repositories, increase timeout in `utils.py`:
```python
timeout=600  # Increase from default
```

### OpenAI API Errors

1. Check API key is set: `echo $OPENAI_API_KEY`
2. Verify quota/billing on OpenAI dashboard
3. Use `--use-llm=false` for lexical-only mode

### Baseline Comparison Errors

**"ImportError: scikit-learn is required"**
```bash
pip install scikit-learn
```

**"No labeled training data available"**
Ensure ground truth is generated first:
```bash
python eval/RQ1/05_generate_ground_truth.py
```

**Slow baseline training**
The fallback implementations are faster. Ensure you're not trying to use
full transformer models without GPU:
```bash
python eval/RQ1/03_baseline_comparison.py --fallback
```

## Extending the Evaluation

### Adding New Repositories

1. Add to `eval/config.json`:
```json
{
  "repositories": {
    "NEW": {
      "name": "New Repository",
      "url": "https://github.com/org/repo.git",
      "languages": ["python"],
      "extensions": [".py"],
      "enabled": true
    }
  }
}
```

2. Add to subject systems:
```json
{
  "experiments": {
    "rq1": {
      "subject_systems": ["AC", "RE", "SC", "NEW"]
    }
  }
}
```

3. Clone and run evaluation:
```bash
python eval/RQ1/01_data_collection.py --repos NEW --clone
python eval/RQ1/05_generate_ground_truth.py --repos NEW
# ... etc
```

### Custom SATD Patterns

Modify `satd_patterns` in `eval/config.json`:

```json
{
  "satd_patterns": {
    "explicit": ["\\bTODO\\b", "\\bFIXME\\b", ...],
    "implicit": ["\\bworkaround\\b", ...]
  }
}
```

## License

This evaluation suite is part of the RapidPay project and follows the same license.

