# Commit-Based SATD Chain Detection Test Scenarios

This directory contains test scenarios that simulate developer commits and demonstrate how RapidPay detects chains of technical debt as they evolve.

## Overview

Each scenario simulates a realistic developer commit that introduces or modifies technical debt, showing:
- **Before state**: The codebase before the commit
- **After state**: The codebase after the commit with new/modified files
- **Ground truth**: Expected SATD instances, relationships, and chains
- **Visualization**: Interactive web interface showing chain evolution

## Scenarios

### Scenario 1: Feature Rush - New Chain Introduction
- **Simulates**: Developer adding quick-and-dirty feature under deadline pressure
- **Initial State**: Clean `order_service.py`
- **Commit**: Adds inventory integration and caching without proper design
- **Result**: New 3-file chain (Order → Inventory → Cache) with 9+ SATD instances

**Files:**
```
scenario1/
├── before/
│   └── order_service.py          # Clean initial version
├── after/
│   ├── order_service.py          # With SATD (tight coupling, missing error handling)
│   ├── inventory_service.py      # New file with cache issues
│   └── cache_manager.py          # New file with memory/lock issues
└── ground_truth.json             # Expected detection results
```

### Scenario 2: Cascading Debt - Chain Extension
- **Simulates**: Adding new features that extend existing debt chains
- **Initial State**: Authentication module with 2 SATD instances
- **Commit**: Adds distributed session management
- **Result**: 2-node chain extends to 14-node chain across 4 files

**Files:**
```
scenario2/
├── before/
│   └── auth_handler.py           # Existing auth with 2 SATD
├── after/
│   ├── auth_handler.py           # Modified with session integration
│   ├── session_manager.py        # New - connected to auth
│   ├── permission_checker.py     # New - connected to sessions
│   └── audit_logger.py           # New - connected to permissions
└── ground_truth.json
```

### Scenario 3: Multi-Developer Collaboration - Chain Merge
- **Simulates**: Developer adding code that bridges two isolated chains
- **Initial State**: Two separate chains (logging and metrics)
- **Commit**: Adds observability aggregator connecting both chains
- **Result**: Two 4-node chains merge into one 18-node chain

**Files:**
```
scenario3/
├── before/
│   ├── log_service.py            # Logging chain (isolated)
│   ├── log_formatter.py          
│   ├── metrics_collector.py      # Metrics chain (isolated)
│   └── metrics_exporter.py       
├── after/
│   ├── log_service.py            # Modified with aggregator callback
│   ├── log_formatter.py          
│   ├── metrics_collector.py      # Modified with aggregator callback
│   ├── metrics_exporter.py       
│   └── observability_aggregator.py  # New - bridges both chains
└── ground_truth.json
```

## Running the Scenarios

### Prerequisites

1. Ensure RapidPay is built:
```bash
npm run compile
```

### Run a Single Scenario

```bash
npx ts-node Test/CommitScenarios/run_commit_scenario.ts --scenario 1
```

### Run All Scenarios

```bash
npx ts-node Test/CommitScenarios/run_commit_scenario.ts --all
```

### Verbose Mode

```bash
npx ts-node Test/CommitScenarios/run_commit_scenario.ts --all --verbose
```

### Custom Output File

```bash
npx ts-node Test/CommitScenarios/run_commit_scenario.ts --all --output results.json
```

## Viewing Results

### Web Visualization

After running the scenarios, open the visualization in a browser:

```bash
# On Windows
start Test/CommitScenarios/commit_visualization.html

# On macOS
open Test/CommitScenarios/commit_visualization.html

# On Linux
xdg-open Test/CommitScenarios/commit_visualization.html
```

The visualization shows:
- Side-by-side before/after dependency graphs
- Color-coded nodes by debt type
- Chain highlighting
- SIR score rankings
- Commit impact metrics

### Output Files

After running scenarios, you'll find:

| File | Description |
|------|-------------|
| `scenario_results.json` | Complete detection results with metrics |
| `visualization_data.json` | Data for the web visualization |

## SATD Types in Test Cases

Each scenario includes various types of technical debt:

| Type | Pattern | Example |
|------|---------|---------|
| **Design** | TODO | Tight coupling, missing abstractions |
| **Implementation** | HACK | Quick fixes, inefficient algorithms |
| **Defect** | FIXME, BUG | Race conditions, memory leaks |
| **Architecture** | TODO | Missing persistence, scalability issues |
| **Test** | TODO | Missing unit tests |
| **Documentation** | FIXME | Undocumented APIs |

## Evaluation Metrics

Each scenario compares detected results against ground truth:

### Detection Metrics (RQ1)
- **Precision**: TP / (TP + FP)
- **Recall**: TP / (TP + FN)
- **Chain Accuracy**: Correctly identified chains

### Prioritization Metrics (RQ2)
- **SIR Score Correlation**: Alignment with expected ranking
- **Top-K Precision**: High-impact items in top positions

## Adding New Scenarios

To create a new scenario:

1. Create directory structure:
```bash
mkdir -p Test/CommitScenarios/scenario4/{before,after}
```

2. Add Python files with SATD comments to `before/` and `after/`

3. Create `ground_truth.json` following the schema:
```json
{
  "metadata": {
    "scenario_id": "scenario4",
    "scenario_name": "Your Scenario Name",
    "description": "Description of the commit scenario",
    "commit_message": "feat: Your simulated commit message"
  },
  "before_state": { ... },
  "after_state": { ... },
  "expected_sir_ranking": { ... },
  "commit_analysis": { ... }
}
```

4. Run evaluation to verify:
```bash
npx ts-node Test/CommitScenarios/run_commit_scenario.ts --scenario 4 --verbose
```

## Troubleshooting

### Module Not Found Errors
Run `npm run compile` to build RapidPay first.

### No SATD Detected
- Verify Python files have SATD patterns (TODO, FIXME, HACK, BUG)
- Check that patterns are in comments (# ...)
- Enable verbose mode to see scanning details

### Visualization Not Loading
- Ensure `visualization_data.json` was generated
- Check browser console for errors
- Try running scenarios again with `--all`

## License

Part of the RapidPay project.

