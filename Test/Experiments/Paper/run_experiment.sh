#!/bin/bash
# RapidPay Experiment Runner Script

set -e

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not found. Please install Python 3."
    exit 1
fi

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "Error: pip3 is required but not found. Please install pip3."
    exit 1
fi

# Create virtual environment
echo "Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install required packages
echo "Installing required packages..."
pip install pandas numpy matplotlib seaborn networkx openai

# Create repos directory if it doesn't exist
mkdir -p repos

# Check for OpenAI API key in environment or prompt user
if [ -z "$OPENAI_API_KEY" ]; then
    echo "OpenAI API key not found in environment."
    read -p "Do you want to use OpenAI API for enhanced analysis? (y/n) " use_openai
    
    if [ "$use_openai" = "y" ]; then
        read -p "Enter your OpenAI API key: " api_key
        openai_arg="--openai-api-key $api_key"
    else
        openai_arg=""
    fi
else
    echo "Using OpenAI API key from environment."
    openai_arg="--openai-api-key $OPENAI_API_KEY"
fi

# Ask if user wants to run full analysis or just generate results
read -p "Run full analysis (clone repos, analyze code) or just generate result files? (full/generate) " run_mode

if [ "$run_mode" = "full" ]; then
    # Ask which projects to analyze
    read -p "Enter projects to analyze (comma-separated, leave empty for all): " projects_input
    
    if [ -z "$projects_input" ]; then
        projects_arg=""
    else
        projects_arg="--projects ${projects_input//,/ }"
    fi
    
    # Run the experiment script
    echo "Running experiment with full analysis..."
    python3 experiment_code.py $projects_arg $openai_arg
else
    # Generate results without actual analysis
    echo "Generating results without analysis..."
    python3 experiment_code.py --generate-only
fi

# Generate visualizations
echo "Generating visualizations..."
python3 visualization_script.py

echo "Experiment completed. Results are available in the 'results' directory."
echo "Visualizations are available in the 'visualizations' directory."
