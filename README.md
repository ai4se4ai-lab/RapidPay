# 🧠 SATD Helper Extension for VS Code

This VS Code extension helps developers track and manage **Self-Admitted Technical Debt (SATD)** during software development. It leverages OpenAI's GPT models to detect technical debt comments in your code, visualize the relationships between them, and suggests potential fixes when your commits might address the debt.

## 🔍 What is Self-Admitted Technical Debt?

Self-Admitted Technical Debt (SATD) refers to instances where developers explicitly acknowledge shortcuts, workarounds, or incomplete implementations in their code through comments. These might include TODOs, FIXMEs, or more subtle indicators like "this needs refactoring later" or "not an ideal solution."

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

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/ai4se4ai-lab/RapidPay.git
cd RapidPay

# Install dependencies
npm install

# Compile the extension
npm run compile
```

### 2. Set your OpenAI API Key

You have two options for providing your OpenAI API key:

#### Option 1: VS Code Settings (Recommended)
1. Open VS Code settings (File > Preferences > Settings)
2. Search for "SATD Helper"
3. Enter your OpenAI API key in the "OpenAI API Key" field

#### Option 2: Environment Variable
Set the `OPENAI_API_KEY` environment variable in your system or workspace.

For example:
```bash
# In your terminal before launching VS Code
export OPENAI_API_KEY=your-api-key-here
code .
```

Or add it to your VS Code's `.env` file in the workspace root:
```
OPENAI_API_KEY=your-api-key-here
```

⚠️ Your API key is only used to communicate with the OpenAI API and is not shared or transmitted elsewhere. If using an .env file, make sure it's included in your .gitignore file to prevent accidental commits.

### 3. Running the Extension

1. Press F5 to start debugging
2. A new VS Code window will open with the extension activated
3. Run the command "SATD Helper: Initialize and Scan Repository" from the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)

## 📋 Usage

### Initializing the Extension

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run "SATD Helper: Initialize and Scan Repository"
3. The extension will scan your repository and identify all technical debt items

### Viewing Technical Debt

1. Open the Command Palette
2. Run "SATD Helper: View Technical Debt Items"
3. A panel will open showing all identified technical debt items
4. Click on a file link to navigate directly to the debt location

### Visualizing Technical Debt Relationships

1. Open the Command Palette
2. Run "SATD Helper: Visualize Technical Debt Relationships"
3. A panel will open showing an interactive graph of debt relationships
4. Click on nodes or edges to see detailed information about debt items and their connections

### Checking for Technical Debt Fixes

The extension automatically monitors your git commits and will:
1. Analyze new commits to check if they address existing technical debt
2. Show a notification when a potential fix is detected
3. Provide AI-generated suggestions for completely resolving the technical debt

You can also manually trigger this process:
1. Open the Command Palette
2. Run "SATD Helper: Check Latest Commit for Debt Fixes"

## 🧩 How It Works

The SATD Helper extension follows a comprehensive 4-phase approach to manage technical debt:

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
satd-helper/
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
# Compile the extension
npm run compile

# Watch for changes
npm run watch
```

### Packaging the Extension

```bash
# Create a .vsix package
npm run package
```

### Running Tests

```bash
# Run tests
npm test
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.