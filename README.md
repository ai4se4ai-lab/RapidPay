# 🧠 RapidPay Extension for VS Code

This VS Code extension helps developers track and manage **Self-Admitted Technical Debt (SATD)** during software development. It leverages OpenAI's GPT models to detect technical debt comments in your code, visualize the relationships between them, and suggests potential fixes when your commits might address the debt.

## 🔍 What is Self-Admitted Technical Debt?

Self-Admitted Technical Debt (SATD) refers to instances where developers explicitly acknowledge shortcuts, workarounds, or incomplete implementations in their code through comments. These might include TODOs, FIXMEs, or more subtle indicators like "this needs refactoring later" or "not an ideal solution."

## ⚡ Quick Start

### For VS Code Extension Users

1. **Install dependencies**: `npm install && npm run compile`
2. **Set OpenAI API Key**: Add to VS Code settings or environment variable
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

# Start services
docker-compose up -d

# View results
docker-compose logs rapidpay-cli
```

## 🚀 Features

- 🔍 **Repository Analysis**: Scans your git repository to identify technical debt markers (TODO, FIXME, HACK, etc.)
- 🧠 **AI-Powered Description**: Uses OpenAI to provide clear descriptions of technical debt items
- 📊 **Technical Debt Tracking**: Maintains a list of all technical debt items with their location and creation information
- 🔄 **Relationship Discovery**: Analyzes dependencies between debt items to discover chains and impacts
- 📈 **SIR Score Calculation**: Quantifies the impact of debt through SATD Impact Ripple scores
- 📊 **Interactive Visualization**: Displays debt relationships and chains in a dynamic, interactive graph
- 🤖 **Commit Analysis**: Automatically analyzes new commits to check if they address existing technical debt
- 💡 **Fix Suggestions**: Provides AI-generated suggestions for completely resolving technical debt based on your recent changes

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

#### Step 6: Build Docker Image Manually

```bash
# Build the Docker image
docker build -t rapidpay:latest .

# Run the container
docker run --rm \
  -v /path/to/repo:/workspace:ro \
  -e OPENAI_API_KEY=your-api-key-here \
  rapidpay:latest \
  node /app/out/cli/index.js analyze --repo /workspace
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

### Run Tests in Docker

```bash
# Run tests in a Docker container
docker run --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  node:18-alpine \
  sh -c "npm install && npm test"
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
```

#### SIR - SATD Impact Ripple Scoring

```bash
# Calculate SIR scores for all SATD instances
npm run cli -- sir --repo /path/to/repo

# Output to file
npm run cli -- sir --repo /path/to/repo -o sir-scores.json
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

## 🧩 How It Works

The RapidPay extension follows a comprehensive 4-phase approach to manage technical debt:

### Phase 1: Candidate SATD Instance Identification (CII)

The extension scans your repository for comments containing technical debt markers through:
- **Lexical Analysis**: Detects explicit markers like TODO, FIXME, HACK, etc.
- **NLP-based Classification**: Uses OpenAI to interpret and classify debt comments 
- **Location Mapping**: Maps each debt to its corresponding code entity

### Phase 2: Inter-SATD Relationship Discovery (IRD)

Discovers relationships between different SATD instances through:
- **Call Graph Analysis**: Identifies method/function call relationships
- **Data Dependency Analysis**: Tracks data flow between debt-affected code
- **Control Flow Analysis**: Examines execution paths influenced by debt
- **Module/File Dependency Analysis**: Determines high-level dependencies

### Phase 3: Chain Construction and Visualization

Formalizes and visualizes the technical debt landscape:
- **Graph Representation**: Models SATD instances as nodes in a graph
- **Chain Definition**: Identifies sequences or connected components in the graph
- **Interactive Visualization**: Provides a dynamic visualization allowing exploration of the debt network

### Phase 4: SATD Impact Ripple (SIR) Score

Quantifies the impact of technical debt to help prioritize fixes:
- **Intrinsic Severity (IS)**: Assesses the inherent severity of a debt item
- **Outgoing Chain Influence (OCI)**: Measures how many other debt items are affected by this item
- **Incoming Chain Dependency (ICD)**: Counts how many other debt items this depends on
- **Chain Length Factor (CLF)**: Considers the length of the longest chain this item participates in

## ⚙️ Configuration

You can customize the extension's behavior through VS Code settings:

```json
{
  "RapidPay.openaiApiKey": "your-api-key",
  "RapidPay.modelName": "gpt-4",
  "RapidPay.autoScanOnStartup": false,
  "RapidPay.relationshipAnalysisEnabled": true
}
```

## 📝 SATD Custom Patterns

You can define custom patterns to detect technical debt by creating a `.satdrc.json` file in your repository. Example:

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
    }
  }
}
```

## 🏗️ Project Structure

```
RapidPay/
│
├── src/                      # Source code directory
│   ├── extension.ts          # Main extension logic
│   ├── models.ts             # Data models and interfaces
│   ├── satdDetector.ts       # Technical debt detection logic
│   ├── satdRelationshipAnalyzer.ts # Relationship analyzer
│   ├── satdChainAnalyzer.ts  # Chain detection and SIR score calculator
│   ├── analyzers/            # Specialized analyzers
│   │   ├── callGraphAnalyzer.ts # Method call relationship analyzer
│   │   ├── dataDependencyAnalyzer.ts # Data dependency analyzer
│   │   ├── controlFlowAnalyzer.ts # Control flow analyzer
│   │   └── moduleDependencyAnalyzer.ts # Module dependency analyzer
│   ├── utils/                # Utility functions
│   │   ├── commitMonitor.ts  # Git commit monitoring
│   │   ├── debtScanner.ts    # Technical debt scanning
│   │   ├── gitUtils.ts       # Git utilities
│   │   ├── openaiClient.ts   # OpenAI API client
│   │   ├── uiUtils.ts        # UI utilities
│   │   └── visualizationUtils.ts # Visualization utilities
│   └── visualization/        # Visualization components
│       ├── satdGraphVisualizer.ts # Graph visualization
│       └── visualizationCommands.ts # Commands for visualization
│
├── resources/                # Resources directory
│   ├── overview/             # Overview documentation
│   └── templates/            # HTML templates for visualization
│
├── examples/                 # Example files
│   └── satdrc.json           # Sample configuration
│
├── package.json              # Extension metadata
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Webpack configuration
└── README.md                 # Documentation
```

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

### Getting Help

- Check the [Issues](https://github.com/ai4se4ai-lab/RapidPay/issues) page
- Review test files in `Test/` directory for usage examples
- Check the console output in VS Code (View > Output > RapidPay)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.