# 🧠 RapidPay - Self-Admitted Technical Debt Management

**RapidPay** is a comprehensive VS Code extension and CLI tool that helps developers track, analyze, and manage **Self-Admitted Technical Debt (SATD)** during software development. It implements a four-phase analysis pipeline leveraging OpenAI's GPT models to detect technical debt comments, discover relationships between them, calculate impact scores, and provide commit-aware recommendations.

## 🔍 What is Self-Admitted Technical Debt?

Self-Admitted Technical Debt (SATD) refers to instances where developers explicitly acknowledge shortcuts, workarounds, or incomplete implementations in their code through comments. These might include explicit markers like `TODO`, `FIXME`, `HACK`, or more subtle indicators like "this needs refactoring later" or "not an ideal solution."

## ⚡ Quick Start

### For VS Code Extension Users

1. **Install dependencies**: 
   ```bash
   npm install && npm run compile
   ```

2. **Set OpenAI API Key**: 
   - Add to VS Code settings: `RapidPay.openaiApiKey`
   - Or set environment variable: `OPENAI_API_KEY=your-key-here`

3. **Press F5** to launch extension in debug mode

4. **Run command**: "RapidPay: Initialize and Scan Repository"

### For CLI Users

```bash
# Install and compile
npm install && npm run compile

# Set API key
export OPENAI_API_KEY=your-key-here

# Analyze a repository
npm run cli -- analyze --repo /path/to/repo -o results.json
```

### For Docker Users

```bash
# Create .env file with OPENAI_API_KEY
echo "OPENAI_API_KEY=your-key-here" > .env

# Start services (Neo4j + RapidPay CLI)
docker-compose up -d

# View results
docker-compose logs rapidpay-cli
```

## 🚀 Features

RapidPay implements a comprehensive 4-phase analysis pipeline:

### Phase 1: SATD Instance Detection (SID)
- **Lexical Analysis**: Detects explicit markers like TODO, FIXME, HACK, XXX, BUG, etc.
- **LLM-based Classification**: Uses OpenAI GPT models to interpret and classify debt comments with confidence scores
- **Multi-language Support**: Python, JavaScript, TypeScript, Java, and more
- **Custom Patterns**: Define project-specific patterns via `.satdrc.json`
- **Location Mapping**: Maps each debt to its corresponding code entity (file, line, function, class)

### Phase 2: Inter-SATD Relationship Discovery (IRD)
- **Call Graph Analysis**: Identifies method/function call relationships between debt-affected code
- **Data Dependency Analysis**: Tracks data flow between debt-affected entities
- **Control Flow Analysis**: Examines execution paths influenced by debt
- **Module/File Dependency Analysis**: Determines high-level module dependencies
- **Weighted Dependency Graph**: Builds a directed graph with weighted edges based on dependency types
- **Chain Discovery**: Identifies weakly connected components (chains) in the dependency graph

### Phase 3: SATD Impact Ripple (SIR) Scoring
- **Quantitative Impact Assessment**: Calculates SIR scores to prioritize debt fixes
- **Three-Component Formula**: 
  - **Fanout_w**: Weighted out-degree (how many other debts are affected)
  - **ChainLen_w**: Maximum weighted path length (longest dependency chain)
  - **Reachability_w**: Sum of max path strengths to all reachable SATD nodes
- **Normalized Scores**: SIR scores normalized to [0, 1] for easy comparison
- **Ranking**: Automatically ranks debt items by impact

### Phase 4: Commit-Aware Insight Generation (CAIG)
- **Automatic Commit Monitoring**: Monitors git commits and detects relevant SATD opportunities
- **Developer Interest Scoring**: Tracks developer familiarity with code regions
- **Historical Effort Scoring**: Estimates resolution effort based on historical patterns
- **Fix Potential Assessment**: LLM-based assessment of whether a commit addresses specific debt
- **Ranked Recommendations**: Combines SIR, commit relevance, effort, and fix potential
- **Remediation Plans**: AI-generated step-by-step plans for addressing debt

### Additional Features
- 📊 **Interactive Visualization**: Displays debt relationships and chains in a dynamic, interactive graph
- 🔄 **Neo4j Integration**: Export analysis results to Neo4j graph database
- 📈 **Historical Analysis**: Tracks debt creation dates and evolution over time
- 🎯 **Configurable Thresholds**: Adjustable confidence thresholds and analysis parameters
- 🧪 **Evaluation Suite**: Comprehensive test suite with 128+ tests covering all phases

## 🛠️ Setup Instructions

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- **Git** (for repository analysis)
- **OpenAI API Key** (for AI-powered analysis)
- **Docker** and **Docker Compose** (optional, for containerized deployment)

---

## 📦 Installation & Running

### Option 1: Running Without Docker (Local Development)

#### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/ai4se4ai-lab/RapidPay.git
cd RapidPay

# Install dependencies
npm install

# Compile the TypeScript code
npm run compile
```

#### Step 2: Set your OpenAI API Key

You have two options for providing your OpenAI API key:

**Option A: VS Code Settings (Recommended for Extension)**
1. Open VS Code settings (File > Preferences > Settings)
2. Search for "RapidPay"
3. Enter your OpenAI API key in the "OpenAI API Key" field

**Option B: Environment Variable (Recommended for CLI)**
```bash
# On Linux/macOS
export OPENAI_API_KEY=your-api-key-here

# On Windows (PowerShell)
$env:OPENAI_API_KEY="your-api-key-here"

# On Windows (Command Prompt)
set OPENAI_API_KEY=your-api-key-here
```

Or create a `.env` file in the workspace root:
```
OPENAI_API_KEY=your-api-key-here
```

⚠️ **Security Note**: Your API key is only used to communicate with the OpenAI API and is not shared or transmitted elsewhere. If using an .env file, make sure it's included in your `.gitignore` file to prevent accidental commits.

#### Step 3: Run the VS Code Extension

1. Open the project in VS Code
2. Press `F5` to start debugging
3. A new VS Code window will open with the extension activated
4. Run the command "RapidPay: Initialize and Scan Repository" from the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)

#### Step 4: Run the CLI Tool (Optional)

```bash
# Show CLI help
npm run cli -- --help

# Analyze a repository
npm run cli -- analyze --repo /path/to/repo -o results.json

# Analyze with Neo4j integration
npm run cli -- analyze --repo /path/to/repo --neo4j bolt://localhost:7687
```

---

### Option 2: Running With Docker

#### Step 1: Prerequisites

Ensure you have Docker and Docker Compose installed:
```bash
# Check Docker installation
docker --version
docker-compose --version
```

#### Step 2: Set Environment Variables

Create a `.env` file in the project root:
```bash
# .env file
OPENAI_API_KEY=your-api-key-here
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=rapidpay123
```

#### Step 3: Build and Run with Docker Compose

```bash
# Start all services (Neo4j + RapidPay CLI)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

#### Step 4: Access Services

- **Neo4j Browser**: http://localhost:7474
  - Username: `neo4j`
  - Password: `rapidpay123`
- **RapidPay CLI**: Runs automatically and outputs to `/output/results.json`

#### Step 5: Run Custom Analysis

```bash
# Run analysis on a specific repository
docker run --rm \
  -v /path/to/your/repo:/workspace:ro \
  -v $(pwd)/output:/output \
  -e OPENAI_API_KEY=your-api-key-here \
  -e NEO4J_URI=bolt://host.docker.internal:7687 \
  rapidpay-cli \
  node /app/out/cli/index.js analyze --repo /workspace -o /output/results.json
```

---

## 🧪 Running Tests

### Run All Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Output

The test suite includes:
- **SID Tests**: SATD Instance Detection (25 tests)
- **IRD Tests**: Inter-SATD Relationship Discovery (25 tests)
- **SIR Tests**: SATD Impact Ripple Score Calculation (20 tests)
- **CAIG Tests**: Commit-Aware Insight Generation (20 tests)
- **Model Tests**: Type definitions and defaults (20 tests)
- **Integration Tests**: End-to-end workflows (15 tests)

**Total: 128 tests** covering all four phases of the RapidPay pipeline.

### Expected Test Results

```
Test Suites: 6 passed, 6 total
Tests:       128 passed, 128 total
Snapshots:   0 total
Time:        ~4-5 seconds
```

---

## 📋 Usage

### VS Code Extension Usage

#### Initializing the Extension

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run "RapidPay: Initialize and Scan Repository"
3. The extension will scan your repository and identify all technical debt items

#### Viewing Technical Debt

1. Open the Command Palette
2. Run "RapidPay: View Technical Debt Items"
3. A panel will open showing all identified technical debt items
4. Click on a file link to navigate directly to the debt location

#### Visualizing Technical Debt Relationships

1. Open the Command Palette
2. Run "RapidPay: Visualize Technical Debt Relationships"
3. A panel will open showing an interactive graph of debt relationships
4. Click on nodes or edges to see detailed information about debt items and their connections

#### Checking for Technical Debt Fixes

The extension automatically monitors your git commits and will:
1. Analyze new commits to check if they address existing technical debt
2. Show a notification when a potential fix is detected
3. Provide AI-generated suggestions for completely resolving the technical debt

You can also manually trigger this process:
1. Open the Command Palette
2. Run "RapidPay: Check Latest Commit for Debt Fixes"

#### Analyzing Commits for SATD Opportunities (CAIG)

1. Open the Command Palette
2. Run "RapidPay: Analyze Commit for SATD Opportunities (CAIG)"
3. View ranked recommendations based on commit relevance, SIR scores, and fix potential

#### Diagnostic Scan

For debugging without LLM calls:
1. Open the Command Palette
2. Run "RapidPay: Diagnostic Scan (Debug - No LLM)"
3. View lexical-only detection results

---

### CLI Usage

The RapidPay CLI provides command-line access to all analysis phases:

#### SID - SATD Instance Detection

```bash
# Quick scan (lexical patterns only, no LLM)
npm run cli -- sid --repo /path/to/repo --quick

# Full scan with LLM classification
npm run cli -- sid --repo /path/to/repo --threshold 0.7 -o results.json

# Analyze current directory
npm run cli -- sid --repo .
```

#### IRD - Inter-SATD Relationship Discovery

```bash
# Discover relationships between SATD instances
npm run cli -- ird --repo /path/to/repo --hops 5

# With custom hop limit
npm run cli -- ird --repo /path/to/repo --hops 3

# Using pre-detected SATD instances
npm run cli -- ird --repo /path/to/repo --input satd-instances.json
```

#### SIR - SATD Impact Ripple Scoring

```bash
# Calculate SIR scores for all SATD instances
npm run cli -- sir --repo /path/to/repo

# Output to file
npm run cli -- sir --repo /path/to/repo -o sir-scores.json

# With custom weights
npm run cli -- sir --repo /path/to/repo --alpha 0.5 --beta 0.3 --gamma 0.2
```

#### CAIG - Commit-Aware Insight Generation

```bash
# Analyze specific commit
npm run cli -- caig --repo /path/to/repo --commit abc1234

# Analyze latest commit
npm run cli -- caig --repo /path/to/repo
```

#### Full Analysis Pipeline

```bash
# Run complete analysis (SID → IRD → SIR → CAIG)
npm run cli -- analyze --repo /path/to/repo -o results.json

# With Neo4j integration
npm run cli -- analyze --repo /path/to/repo --neo4j bolt://localhost:7687

# Quick mode (no LLM, lexical only)
npm run cli -- analyze --repo /path/to/repo --quick -o results.json

# Export to Neo4j only
npm run cli -- export --format neo4j --neo4j bolt://localhost:7687
```

#### CLI Options

```bash
# Show help
npm run cli -- --help

# Show version
npm run cli -- --version

# Show command-specific help
npm run cli -- sid --help
```

#### CLI Environment Variables

```bash
# Required for LLM features
export OPENAI_API_KEY=your-api-key-here

# Optional Neo4j configuration
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=your-password
```

---

## 🧩 How It Works

The RapidPay extension follows a comprehensive 4-phase approach to manage technical debt:

### Phase 1: SATD Instance Detection (SID)

The extension scans your repository for comments containing technical debt markers through:

1. **Lexical Filtering**: Detects explicit markers like TODO, FIXME, HACK, XXX, BUG, ISSUE, DEBT, NOTE, OPTIMIZE, REVIEW, REVISIT
2. **Comment Detection**: Verifies that matches occur in actual comment lines (not code)
3. **LLM-based Classification**: Uses OpenAI GPT models to:
   - Classify whether a comment represents actual technical debt
   - Provide confidence scores (0-1)
   - Generate enhanced descriptions
   - Classify debt types (Design, Implementation, Documentation, Defect, Test, Requirement, Architecture)
4. **Threshold Filtering**: Filters results based on confidence threshold τ (default: 0.7)
5. **Location Mapping**: Maps each debt to its corresponding code entity (file, line, function, class)

### Phase 2: Inter-SATD Relationship Discovery (IRD)

Discovers relationships between different SATD instances through:

1. **Call Graph Analysis**: Identifies method/function call relationships using AST parsing
2. **Data Dependency Analysis**: Tracks data flow between debt-affected code entities
3. **Control Flow Analysis**: Examines execution paths influenced by debt
4. **Module/File Dependency Analysis**: Determines high-level dependencies between files/modules
5. **Dependency Weighting**: Assigns weights to relationships based on type:
   - Call: 0.7-0.9 (default: 0.8)
   - Data: 0.6-0.8 (default: 0.7)
   - Control: 0.5-0.7 (default: 0.6)
   - Module: 0.8-1.0 (default: 0.9)
6. **Hop Limit**: Analyzes dependencies up to k=5 hops (configurable)
7. **Graph Construction**: Builds a directed weighted graph G = (T, E) where T is SATD nodes and E is weighted edges

### Phase 3: Chain Construction and SIR Scoring

Formalizes and quantifies the technical debt landscape:

1. **Chain Discovery**: Identifies weakly connected components in the dependency graph
2. **SIR Score Calculation**: For each SATD instance t_i, calculates:
   ```
   SIR(t_i) = α·Fanout_w(t_i) + β·ChainLen_w(t_i) + γ·Reachability_w(t_i)
   ```
   Where:
   - **Fanout_w(t_i)**: Sum of weighted out-degrees (how many debts this affects)
   - **ChainLen_w(t_i)**: Maximum weighted path length via DFS (longest dependency chain)
   - **Reachability_w(t_i)**: Sum of max path strengths to all reachable SATD nodes
   - **Weights (α,β,γ)**: Default (0.4, 0.3, 0.3), configurable
3. **Normalization**: All components normalized to [0, 1] using min-max scaling
4. **Ranking**: Automatically ranks debt items by SIR score (highest impact first)

### Phase 4: Commit-Aware Insight Generation (CAIG)

Provides contextual recommendations based on recent commits:

1. **Commit Monitoring**: Monitors git commits in a sliding window (W=50 commits, configurable)
2. **Developer Interest Scoring**: Tracks developer familiarity with code regions based on commit history
3. **Historical Effort Scoring**: Estimates resolution effort S^t based on:
   - Resolution time for similar debt (RT_t)
   - File modification count / churn (FM_t)
   - Formula: `S^t = λ·(RT_t/max(RT)) + (1-λ)·(FM_t/max(FM))` where λ=0.5
4. **Commit Relevance Analysis**: LLM-based analysis of commit relevance to each SATD instance
5. **Fix Potential Assessment**: LLM-based assessment of whether a commit addresses specific debt (HIGH, PARTIAL, LOW)
6. **Ranking**: Combines multiple factors:
   ```
   Rank(t_i) = η1·SIR(t_i) + η2·CommitRel(t_i) + η3·(1-S^t) + η4·f_i
   ```
   Where:
   - **SIR(t_i)**: Impact ripple score
   - **CommitRel(t_i)**: Commit relevance score
   - **S^t**: Historical effort score (inverted - lower effort preferred)
   - **f_i**: Fix potential value (1.0, 0.5, or 0.0)
   - **Weights (η1,η2,η3,η4)**: Default (0.4, 0.3, 0.15, 0.15), configurable
7. **Remediation Plans**: AI-generated step-by-step plans for addressing debt

---

## ⚙️ Configuration

You can customize the extension's behavior through VS Code settings:

```json
{
  "RapidPay.openaiApiKey": "your-api-key",
  "RapidPay.modelName": "gpt-4o",
  "RapidPay.autoScanOnStartup": false,
  "RapidPay.relationshipAnalysisEnabled": true,
  "RapidPay.confidenceThreshold": 0.7,
  "RapidPay.maxDependencyHops": 5,
  "RapidPay.sirWeights": {
    "alpha": 0.4,
    "beta": 0.3,
    "gamma": 0.3
  },
  "RapidPay.caigWeights": {
    "eta1": 0.4,
    "eta2": 0.3,
    "eta3": 0.15,
    "eta4": 0.15
  },
  "RapidPay.commitWindowSize": 50
}
```

### Configuration Parameters

- **openaiApiKey**: OpenAI API key for LLM features
- **modelName**: OpenAI model to use (`gpt-4o`, `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`)
- **autoScanOnStartup**: Automatically scan repository when extension activates
- **relationshipAnalysisEnabled**: Enable IRD phase (relationship discovery)
- **confidenceThreshold**: LLM confidence threshold τ for SATD classification (0-1, default: 0.7)
- **maxDependencyHops**: Maximum hop count k for dependency analysis (1-10, default: 5)
- **sirWeights**: SIR score weights (α,β,γ) for Fanout_w, ChainLen_w, Reachability_w
- **caigWeights**: CAIG ranking weights (η1,η2,η3,η4) for SIR, CommitRel, Effort, FixPotential
- **commitWindowSize**: Sliding window size W for commit analysis (default: 50)

---

## 📝 SATD Custom Patterns

You can define custom patterns to detect technical debt by creating a `.satdrc.json` file in your repository root. Example:

```json
{
  "customPatterns": [
    "needs review",
    "refine later",
    "not ideal",
    "revisit this"
  ],
  "excludePatterns": [
    "test/",
    "node_modules/",
    "dist/"
  ],
  "languages": {
    "javascript": {
      "explicit": ["REVIEW", "REVISIT"],
      "implicit": ["callback hell", "ugly solution"]
    },
    "typescript": {
      "explicit": ["REVIEW", "OPTIMIZE"],
      "implicit": ["as any", "ts-ignore"]
    },
    "python": {
      "explicit": ["OPTIMIZE", "REVIEW"],
      "implicit": ["type: ignore", "noqa"]
    },
    "java": {
      "explicit": ["REVIEW", "PERF"],
      "implicit": ["suppress warnings", "unchecked"]
    }
  }
}
```

See `examples/satdrc.json` for a complete example.

---

## 🏗️ Project Structure

```
RapidPay/
│
├── src/                      # Source code directory
│   ├── extension.ts          # Main extension logic
│   ├── models.ts             # Data models and interfaces
│   ├── satdDetector.ts       # Technical debt detection logic
│   ├── satdRelationshipAnalyzer.ts # Relationship analyzer (IRD)
│   ├── satdChainAnalyzer.ts  # Chain detection and SIR score calculator
│   ├── analyzers/            # Specialized analyzers
│   │   ├── callGraphAnalyzer.ts # Method call relationship analyzer
│   │   ├── dataDependencyAnalyzer.ts # Data dependency analyzer
│   │   ├── controlFlowAnalyzer.ts # Control flow analyzer
│   │   └── moduleDependencyAnalyzer.ts # Module dependency analyzer
│   ├── utils/                # Utility functions
│   │   ├── commitMonitor.ts  # Git commit monitoring (CAIG)
│   │   ├── debtScanner.ts     # Technical debt scanning
│   │   ├── effortScorer.ts   # Historical effort scoring
│   │   ├── gitUtils.ts        # Git utilities
│   │   ├── openaiClient.ts    # OpenAI API client
│   │   ├── uiUtils.ts         # UI utilities
│   │   └── visualizationUtils.ts # Visualization utilities
│   ├── visualization/        # Visualization components
│   │   ├── satdGraphVisualizer.ts # Graph visualization
│   │   └── visualizationCommands.ts # Commands for visualization
│   └── cli/                  # CLI implementation
│       ├── index.ts          # CLI entry point
│       └── neo4jClient.ts    # Neo4j integration
│
├── resources/                # Resources directory
│   ├── overview/             # Overview documentation
│   └── templates/            # HTML templates for visualization
│
├── examples/                 # Example files
│   └── satdrc.json           # Sample configuration
│
├── Test/                     # Test suite
│   ├── sid.test.ts           # SID tests
│   ├── ird.test.ts           # IRD tests
│   ├── sir.test.ts           # SIR tests
│   ├── caig.test.ts          # CAIG tests
│   ├── models.test.ts        # Model tests
│   └── integration.test.ts   # Integration tests
│
├── eval/                     # Evaluation suite
│   ├── RQ1/                  # Research Question 1 evaluation
│   ├── RQ2/                  # Research Question 2 evaluation
│   └── RQ3/                  # Research Question 3 evaluation
│
├── package.json              # Extension metadata
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js          # Webpack configuration
├── docker-compose.yml        # Docker Compose configuration
├── Dockerfile                # Docker image definition
└── README.md                 # This documentation
```

---

## 🔄 Development Workflow

### Building the Extension

```bash
# Compile TypeScript to JavaScript
npm run compile

# Watch for changes and auto-compile
npm run watch

# Lint the codebase
npm run lint
```

### Running Tests During Development

```bash
# Run all tests once
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests even if no tests are found (useful for CI)
npm test -- --passWithNoTests
```

### Packaging the Extension

```bash
# Install vsce (VS Code Extension Manager) if not already installed
npm install -g @vscode/vsce

# Create a .vsix package for distribution
vsce package

# This creates RapidPay-1.0.0.vsix which can be installed via:
# code --install-extension RapidPay-1.0.0.vsix
```

### Development Checklist

Before committing changes:
1. ✅ Run `npm run compile` to ensure code compiles
2. ✅ Run `npm test` to ensure all tests pass
3. ✅ Run `npm run lint` to check for code style issues
4. ✅ Test the extension in VS Code (F5)
5. ✅ Test the CLI tool with a sample repository

---

## 🐛 Troubleshooting

### Common Issues

#### Issue: Tests Fail with "Cannot find module"

**Solution:**
```bash
# Clean install dependencies
rm -rf node_modules package-lock.json
npm install
npm run compile
npm test
```

#### Issue: Docker Compose Fails to Start Neo4j

**Solution:**
```bash
# Check if ports 7474 and 7687 are already in use
netstat -an | grep 7474
netstat -an | grep 7687

# Stop conflicting services or change ports in docker-compose.yml
docker-compose down
docker-compose up -d
```

#### Issue: OpenAI API Key Not Working

**Solution:**
- Verify the API key is set correctly: `echo $OPENAI_API_KEY`
- Check VS Code settings if using the extension
- Ensure the API key has sufficient credits
- Try using environment variable instead of VS Code settings
- Check the Developer Console (Ctrl+Shift+I) for error messages

#### Issue: TypeScript Compilation Errors

**Solution:**
```bash
# Clean and rebuild
rm -rf out/
npm run compile

# Check TypeScript version compatibility
npm list typescript
```

#### Issue: Neo4j Connection Failed in Docker

**Solution:**
```bash
# Wait for Neo4j to be fully ready (can take 30-60 seconds)
docker-compose logs neo4j

# Check Neo4j health
docker-compose ps

# Reset Neo4j if needed
docker-compose down -v
docker-compose up -d
```

#### Issue: Git Commands Fail in Docker

**Solution:**
- Ensure the repository is mounted correctly: `-v /path/to/repo:/workspace:ro`
- Check that Git is installed in the container: `docker run --rm rapidpay-cli git --version`
- Verify repository permissions

#### Issue: No SATD Items Found

**Solution:**
- Run the diagnostic scan: "RapidPay: Diagnostic Scan (Debug - No LLM)"
- Check Developer Console (Ctrl+Shift+I) for debug logs
- Verify files contain TODO/FIXME/HACK comments
- Ensure files are tracked by Git
- Check that files are in supported languages (Python, JavaScript, TypeScript, Java, etc.)

### Getting Help

- Check the [Issues](https://github.com/ai4se4ai-lab/RapidPay/issues) page
- Review test files in `Test/` directory for usage examples
- Check the console output in VS Code (View > Output > RapidPay)
- Review evaluation documentation in `eval/RQ1/README.md`

---

## 📊 Evaluation

RapidPay includes a comprehensive evaluation suite for research purposes:

### RQ1: SATD Detection and Chain Construction
- **Location**: `eval/RQ1/`
- **Purpose**: Evaluate SID accuracy, IRD relationship discovery, and chain construction
- **Metrics**: Precision, Recall, F1-score for detection; accuracy for relationships

### RQ2: Developer Validation
- **Location**: `eval/RQ2/`
- **Purpose**: Validate SATD chains and dependencies with developer ratings
- **Metrics**: Developer agreement scores, chain coherence ratings

### RQ3: Distribution Analysis
- **Location**: `eval/RQ3/`
- **Purpose**: Analyze SATD distribution patterns across repositories
- **Metrics**: Statistical distributions, pattern analysis

See `eval/RQ1/README.md` for detailed evaluation instructions.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Contribution Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run linter (`npm run lint`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 📚 References

RapidPay implements the research methodology described in:

> **RapidPay: A Four-Phase Framework for Self-Admitted Technical Debt Management**
> 
> The framework consists of:
> 1. **SID (SATD Instance Detection)**: Lexical filtering + LLM classification
> 2. **IRD (Inter-SATD Relationship Discovery)**: Multi-type dependency analysis
> 3. **SIR (SATD Impact Ripple Scoring)**: Quantitative impact assessment
> 4. **CAIG (Commit-Aware Insight Generation)**: Contextual recommendations

For more details, see the evaluation documentation in `eval/` directory.

---

## 🙏 Acknowledgments

- OpenAI for GPT models
- Neo4j for graph database support
- VS Code team for the extension API
- All contributors and testers

---

**Made with ❤️ by the AI4SE4AI Lab**
