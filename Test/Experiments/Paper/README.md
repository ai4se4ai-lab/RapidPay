# RapidPay Experiment

This repository contains code to reproduce the results from the RapidPay paper, which addresses Self-Admitted Technical Debt (SATD) chains in software projects.

## Overview

The paper presents a comprehensive approach called RapidPay for identifying, measuring, and prioritizing chains of Self-Admitted Technical Debt. The experimental evaluation in the paper analyzes 10 diverse open-source software projects to demonstrate the effectiveness of the approach.

This code aims to reproduce the results presented in Table 1 (Combined Evaluation of RapidPay) of the paper, which includes:

1. **Relationship Precision**: How accurately the approach identifies relationships between SATD instances
2. **Chain Characteristics**: Metrics about the discovered chains of SATD
3. **Recommendation Utility**: How useful the recommendations are to developers

## Requirements

- Python 3.8 or higher
- Git
- OpenAI API key

## Installation

1. Create a Python virtual environment in Windows machins:

```bash
# Create a virtual environment named "venv"
python -m venv venv

# Activate the virtual environment
venv\Scripts\activate
```

2. Run the experiment script:

```bash
chmod +x run_experiment.sh
./run_experiment.sh
```

The script will:
- Create a Python virtual environment
- Install required dependencies
- Ask if you want to run full analysis or just generate result files
- Optionally use an OpenAI API key for enhanced analysis
- Generate CSV files with results
- Create visualizations comparing to the expected values

## Files

- `experiment_code.py`: Main script that runs the experiments
- `visualization_script.py`: Script to visualize results
- `run_experiment.sh`: Shell script to run the entire experiment

## Modes of Operation

### Generate Only Mode

If you just want to generate the result files without cloning repositories or analyzing code, run:

```bash
python experiment_code.py --generate-only
```

This will create CSV files with values matching those reported in the paper.

### Full Analysis Mode

To run the full analysis on actual repositories:

```bash
python experiment_code.py [--projects PROJECT_NAMES] [--openai-api-key KEY]
```

Options:
- `--projects`: Space-separated list of projects to analyze (default: all)
- `--skip-clone`: Skip cloning repositories (assumes they are already cloned)
- `--max-files`: Maximum number of files to scan per project (default: 1000)
- `--openai-api-key`: OpenAI API key for enhanced analysis

## Results

The experiment will generate the following results:

### CSV Files

- `results/relationship_precision.csv`: Precision values for call, data, control, and module relationships
- `results/chain_characteristics.csv`: Metrics about the discovered chains
- `results/recommendation_utility.csv`: Metrics about recommendation utility
- `results/experiment_details.csv`: Details about each project
- `results/raw_annotations.csv`: Sample raw data from expert validations
- `results/comparison_with_expected.csv`: Differences between actual and expected values

### Visualizations

- `visualizations/relationship_precision.png`: Bar chart of relationship precision values
- `visualizations/chain_characteristics.png`: Multiple charts showing chain metrics
- `visualizations/recommendation_utility.png`: Bar chart of recommendation utility metrics
- `visualizations/comparison_with_expected.png`: Heatmap comparing actual vs expected values

## Customization

If you want to modify the expected values from the paper, edit the dictionaries at the top of `experiment_code.py`:

- `EXPECTED_RESULTS["relationship_precision"]`
- `EXPECTED_RESULTS["chain_characteristics"]`
- `EXPECTED_RESULTS["recommendation_utility"]`


## Citation

If you use this code or the RapidPay approach in your research, please cite the original paper:

```
@inproceedings{rapidpay2025,
  title={RapidPay: A Comprehensive Approach for Identifying, Measuring, and Prioritizing Chains of Self-Admitted Technical Debt},
  author={LATER!},
  booktitle={LATER!},
  year={2025},
  pages={XX-XX}
}
```