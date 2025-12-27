# RapidPay CLI Usage Guide

This guide explains how to use the RapidPay command-line interface (CLI) to analyze Self-Admitted Technical Debt (SATD) in your codebase.

## Table of Contents

- [Installation & Setup](#installation--setup)
- [Basic Usage](#basic-usage)
- [Commands](#commands)
  - [SID - SATD Instance Detection](#sid---satd-instance-detection)
  - [IRD - Inter-SATD Relationship Discovery](#ird---inter-satd-relationship-discovery)
  - [SIR - SATD Impact Ripple Scoring](#sir---satd-impact-ripple-scoring)
  - [Analyze - Full Pipeline](#analyze---full-pipeline)
  - [Export - Export Results](#export---export-results)
- [Configuration](#configuration)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Installation & Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Git (optional, but recommended for better results)

### Building the CLI

1. Clone or navigate to the RapidPay repository:
   ```bash
   cd RapidPay
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile TypeScript:
   ```bash
   npm run compile
   ```

4. (Optional) Install globally:
   ```bash
   npm link
   ```

### Environment Setup

The CLI automatically loads environment variables from a `.env` file in the current working directory. Create a `.env` file in the project root (copy from `env.example`):

```bash
cp env.example .env
```

Edit `.env` and set your configuration:

```env
# Required for LLM-based analysis
OPENAI_API_KEY=your_openai_api_key_here

# Optional: OpenAI model name
OPENAI_MODEL_NAME=gpt-4o

# Optional: Neo4j configuration for graph storage
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password

# Optional: Custom thresholds
SATD_CONFIDENCE_THRESHOLD=0.7
MAX_DEPENDENCY_HOPS=5
```

**Note**: The CLI automatically loads the `.env` file when it starts. You can also set environment variables directly:

```bash
# Linux/macOS
export OPENAI_API_KEY=your_key_here

# Windows PowerShell
$env:OPENAI_API_KEY="your_key_here"

# Windows Command Prompt
set OPENAI_API_KEY=your_key_here
```

## Basic Usage

### Running the CLI

After compilation, you can run the CLI using:

```bash
# Using npm script
npm run cli <command> [options]

# Or directly with node
node ./out/cli/index.js <command> [options]

# If installed globally
rapidpay <command> [options]
```

### Common Options

Most commands support these options:

- `-r, --repo <path>`: Repository path (defaults to current directory)
- `-o, --output <file>`: Output file path (JSON format)
- `--help`: Show command help

## Commands

### SID - SATD Instance Detection

Detects SATD instances in your codebase using a two-stage approach:
1. **Lexical Filtering**: Searches for SATD markers (TODO, FIXME, HACK, etc.)
2. **LLM Classification**: Uses OpenAI to classify and validate SATD instances

#### Usage

```bash
rapidpay sid [options]
```

#### Options

- `-r, --repo <path>`: Repository path (default: current directory)
- `-t, --threshold <number>`: LLM confidence threshold (0-1, default: 0.7)
- `--quick`: Quick scan using lexical patterns only (no LLM, faster)
- `-o, --output <file>`: Save results to JSON file

#### Examples

```bash
# Quick scan (no LLM, fast)
rapidpay sid --quick

# Full scan with custom threshold
rapidpay sid --threshold 0.8

# Scan specific repository
rapidpay sid --repo /path/to/repo

# Save results to file
rapidpay sid --output satd-instances.json

# Combine options
rapidpay sid --repo ./my-project --threshold 0.75 --output results.json
```

#### Output

The command displays:
- Number of detected SATD instances
- First 20 instances with:
  - Debt type (Design, Requirement, etc.)
  - File path and line number
  - Comment content
  - Confidence score (if LLM was used)

### IRD - Inter-SATD Relationship Discovery

Discovers relationships between SATD instances by analyzing:
- Method calls
- Data dependencies
- Control flow
- Module dependencies

#### Usage

```bash
rapidpay ird [options]
```

#### Options

- `-r, --repo <path>`: Repository path (default: current directory)
- `-i, --input <file>`: Input file with SATD instances (from SID command)
- `-k, --hops <number>`: Maximum hop count for dependency analysis (1-5, default: 5)
- `-o, --output <file>`: Save results to JSON file

#### Examples

```bash
# Analyze relationships (runs SID first if no input provided)
rapidpay ird

# Use existing SID results
rapidpay ird --input satd-instances.json

# Limit dependency depth
rapidpay ird --hops 3

# Full example
rapidpay ird --repo ./my-project --hops 4 --output relationships.json
```

#### Output

The command displays:
- Number of relationships discovered
- Number of chains identified
- Sample relationships with:
  - Source and target SATD IDs
  - Relationship types
  - Relationship strength

### SIR - SATD Impact Ripple Scoring

Calculates SATD Impact Ripple (SIR) scores to prioritize technical debt items based on:
- **Fanout (α)**: How many other items are affected
- **Chain Length (β)**: Length of dependency chains
- **Reachability (γ)**: How many items can be reached

#### Usage

```bash
rapidpay sir [options]
```

#### Options

- `-r, --repo <path>`: Repository path (default: current directory)
- `-i, --input <file>`: Input file with IRD results (from IRD command)
- `-a, --alpha <number>`: Fanout weight (default: 0.4)
- `-b, --beta <number>`: Chain length weight (default: 0.3)
- `-g, --gamma <number>`: Reachability weight (default: 0.3)
- `-o, --output <file>`: Save results to JSON file

**Note**: Alpha, beta, and gamma should sum to 1.0

#### Examples

```bash
# Calculate SIR scores (runs SID and IRD first)
rapidpay sir

# Use existing IRD results
rapidpay sir --input relationships.json

# Custom weights
rapidpay sir --alpha 0.5 --beta 0.3 --gamma 0.2

# Full example
rapidpay sir --repo ./my-project --input ird-results.json --output sir-scores.json
```

#### Output

The command displays:
- Top 20 SATD instances ranked by SIR score
- SIR score components (Fanout, Chain Length, Reachability)

### Analyze - Full Pipeline

Runs the complete RapidPay analysis pipeline:
1. SID (SATD Instance Detection)
2. IRD (Inter-SATD Relationship Discovery)
3. SIR (SATD Impact Ripple Scoring)
4. Effort Scoring (Historical effort analysis)

#### Usage

```bash
rapidpay analyze [options]
```

#### Options

- `-r, --repo <path>`: Repository path (default: current directory)
- `-t, --threshold <number>`: LLM confidence threshold (default: 0.7)
- `--quick`: Quick mode (no LLM, faster)
- `-o, --output <file>`: Save results to JSON file
- `--neo4j <uri>`: Export results to Neo4j database

#### Examples

```bash
# Full analysis with LLM
rapidpay analyze

# Quick analysis (no LLM)
rapidpay analyze --quick

# Custom threshold
rapidpay analyze --threshold 0.8

# Save to file
rapidpay analyze --output full-analysis.json

# Export to Neo4j
rapidpay analyze --neo4j bolt://localhost:7687

# Complete example
rapidpay analyze --repo ./my-project --quick --output results.json
```

#### Output

The command displays:
- Summary statistics:
  - Total SATD instances
  - Total relationships
  - Total chains
- Top 10 SATD instances by SIR score
- Full results saved to JSON (if `--output` specified)

### Export - Export Results

Export analysis results to different formats.

#### Usage

```bash
rapidpay export [options]
```

#### Options

- `-i, --input <file>`: Input file with analysis results (default: `rapidpay-results.json`)
- `-f, --format <format>`: Output format (`json`, `csv`, `neo4j`, default: `json`)
- `--neo4j <uri>`: Neo4j connection URI (for Neo4j export)

#### Examples

```bash
# Export to CSV
rapidpay export --input results.json --format csv

# Export to Neo4j
rapidpay export --input results.json --format neo4j --neo4j bolt://localhost:7687
```

## Configuration

### Environment Variables

You can configure RapidPay using environment variables or a `.env` file:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `OPENAI_API_KEY` | OpenAI API key (required for LLM analysis) | - | Yes (for LLM) |
| `OPENAI_MODEL_NAME` | OpenAI model to use (`gpt-4o`, `gpt-4`, `gpt-3.5-turbo`) | `gpt-4o` | No |
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` | No |
| `NEO4J_USER` | Neo4j username | `neo4j` | No |
| `NEO4J_PASSWORD` | Neo4j password | - | No |
| `SATD_CONFIDENCE_THRESHOLD` | LLM confidence threshold | `0.7` | No |
| `MAX_DEPENDENCY_HOPS` | Maximum dependency hops | `5` | No |

**Note**: The CLI automatically loads these from a `.env` file in the current working directory.

### Custom SATD Patterns

Create a `.satdrc.json` file in your repository root to define custom SATD patterns:

```json
{
  "customPatterns": [
    "needs review",
    "refine later",
    "not ideal"
  ],
  "excludePatterns": [
    "test/",
    "node_modules/",
    "dist/"
  ]
}
```

## Examples

### Example 1: Quick Analysis

```bash
# Quick scan without LLM (fast, no API key needed)
rapidpay sid --quick --output quick-scan.json
```

### Example 2: Full Analysis Pipeline

```bash
# Step 1: Detect SATD instances
rapidpay sid --threshold 0.75 --output satd.json

# Step 2: Discover relationships
rapidpay ird --input satd.json --hops 5 --output relationships.json

# Step 3: Calculate SIR scores
rapidpay sir --input relationships.json --output sir-scores.json
```

### Example 3: One-Command Full Analysis

```bash
# Run everything in one command
rapidpay analyze --repo ./my-project --output full-results.json
```

### Example 4: Analysis with Neo4j Export

```bash
# Analyze and export to Neo4j
rapidpay analyze --neo4j bolt://localhost:7687 --output results.json
```

## Troubleshooting

### Common Issues

#### 1. "OPENAI_API_KEY not set" Error

**Problem**: Running full analysis without API key.

**Solution**: 
- Create a `.env` file in the current directory with `OPENAI_API_KEY=your_key_here`, or
- Set `OPENAI_API_KEY` environment variable, or
- Use `--quick` flag for lexical-only analysis (no API key needed)

```bash
# Option 1: Create .env file
echo "OPENAI_API_KEY=your_key_here" > .env

# Option 2: Set environment variable
export OPENAI_API_KEY=your_key_here  # Linux/macOS
$env:OPENAI_API_KEY="your_key_here"  # Windows PowerShell

# Option 3: Use quick mode (no LLM)
rapidpay sid --quick
```

#### 2. "No SATD instances detected"

**Problem**: No SATD found in repository.

**Possible causes**:
- No SATD markers (TODO, FIXME, etc.) in comments
- Files not tracked by Git (use filesystem fallback - should work automatically)
- Unsupported file extensions

**Solution**:
- Check that files contain SATD markers in comments
- Ensure files have supported extensions (`.py`, `.js`, `.ts`, `.java`, etc.)
- The CLI now automatically falls back to filesystem search if Git is unavailable

#### 3. "Git grep failed" Warning

**Problem**: Git commands failing.

**Solution**: 
- The CLI automatically falls back to filesystem search
- Ensure you're in a valid repository directory
- Or use a directory with source files (doesn't need to be Git repo)

#### 4. Rate Limiting (429 Errors)

**Problem**: OpenAI API rate limits.

**Solution**:
- Use `--quick` mode to avoid LLM calls
- Wait a few minutes and retry
- Check your OpenAI account quota
- Consider using a lower-tier model

#### 5. "Failed to initialize OpenAI client" Error

**Problem**: OpenAI client initialization fails.

**Possible causes**:
- Invalid API key format
- Network connectivity issues
- API key doesn't have proper permissions

**Solution**:
- Verify your API key is correct and active
- Check your OpenAI account has available credits
- Ensure you have internet connectivity
- Try using a different model: `OPENAI_MODEL_NAME=gpt-3.5-turbo`

```bash
# Test your API key
export OPENAI_API_KEY=your_key_here
rapidpay sid --repo ./test-project
```

#### 6. Neo4j Connection Errors

**Problem**: Cannot connect to Neo4j.

**Solution**:
- Ensure Neo4j is running: `docker-compose up -d` (if using Docker)
- Check connection URI in `.env` file
- Verify credentials are correct
- Check firewall settings

### Getting Help

```bash
# Show all commands
rapidpay --help

# Show help for specific command
rapidpay sid --help
rapidpay ird --help
rapidpay sir --help
rapidpay analyze --help
```

### Debug Mode

For more verbose output, check the console logs. The CLI provides detailed information about:
- Environment variable loading (`.env` file status)
- OpenAI client initialization status
- Files being scanned
- Patterns matched
- Relationships discovered
- SIR score calculations
- LLM API calls and responses

If you see "OpenAI client initialized successfully", the LLM integration is working correctly.

## Best Practices

1. **Start with Quick Scan**: Use `--quick` to get fast results without API costs
2. **Use Output Files**: Save intermediate results to avoid re-running expensive operations
3. **Incremental Analysis**: Run SID → IRD → SIR separately for better control
4. **Custom Thresholds**: Adjust confidence threshold based on your needs (higher = more strict)
5. **Hop Limits**: Use lower hop counts (2-3) for faster IRD analysis on large codebases

## Additional Resources

- See `README.md` for project overview
- Check `env.example` for all configuration options
- Review `examples/satdrc.json` for custom pattern examples

