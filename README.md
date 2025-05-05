# 🧠 SATD Helper Extension for VS Code

This VS Code extension helps developers track and manage **Self-Admitted Technical Debt (SATD)** during software development. It leverages OpenAI's GPT models to detect technical debt comments in your code, tracks them over time, and suggests potential fixes when your recent commits might address the debt.

## 🚀 Features

- 🔍 **Repository Analysis**: Scans your git repository to identify technical debt markers (TODO, FIXME, HACK, etc.)
- 🤖 **AI-Powered Description**: Uses OpenAI to provide clear descriptions of technical debt items
- 📊 **Technical Debt Tracking**: Maintains a list of all technical debt items with their location and creation information
- 🧠 **Commit Analysis**: Automatically analyzes new commits to check if they address existing technical debt
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

### Checking for Technical Debt Fixes

The extension automatically monitors your git commits and will:
1. Analyze new commits to check if they address existing technical debt
2. Show a notification when a potential fix is detected
3. Provide AI-generated suggestions for completely resolving the technical debt

## 🧩 How It Works

### Technical Debt Identification

The extension scans your repository for comments containing markers such as:
- TODO
- FIXME
- HACK
- XXX
- BUG
- ISSUE
- DEBT

For each marker, it:
1. Extracts the comment and surrounding context
2. Uses Git blame to determine when the debt was introduced
3. Uses OpenAI to generate a clear description of the technical debt

### Commit Analysis

When you make a new commit, the extension:
1. Retrieves the commit diff and message
2. For each technical debt item, it uses OpenAI to analyze if the commit addresses the debt
3. If a potential fix is detected, it provides suggestions for completely resolving the debt

## 🏗️ Project Structure

```
satd-helper/
│
├── src/                      # Source code directory
│   ├── extension.ts          # Main extension logic (updated)
│   ├── satdDetector.ts       # Technical debt detection logic (new)
│   └── models.ts             # Data models and interfaces (new)
│
├── .vscode/                  # VS Code configuration
│   ├── launch.json           # Debug configuration (updated)
│   └── tasks.json            # Build tasks (updated)
│
├── examples/                 # Example files
│   └── sample-satdrc.json    # Sample configuration
│
├── package.json              # Extension metadata (updated)
├── tsconfig.json             # TypeScript configuration (updated)
├── .gitignore                # Git ignore file
└── README.md                 # Documentation (updated)
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

## 🙏 Acknowledgements

- VS Code Extension API
- OpenAI API
- All contributors to this project