#!/usr/bin/env python3
"""
Result Visualization Script

This script generates visualizations comparing the experimental results to the expected values
from the paper.

Requirements:
- pandas
- matplotlib
- seaborn
"""

import os
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

# Set style
sns.set(style="whitegrid")
plt.rcParams.update({'font.size': 12})

def load_results():
    """Load results from CSV files"""
    rel_precision = pd.read_csv("results/relationship_precision.csv")
    chain_chars = pd.read_csv("results/chain_characteristics.csv")
    rec_utility = pd.read_csv("results/recommendation_utility.csv")
    
    return rel_precision, chain_chars, rec_utility

def plot_relationship_precision(rel_precision):
    """Plot relationship precision results"""
    plt.figure(figsize=(15, 8))
    
    # Melt the dataframe for easier plotting
    melted = pd.melt(
        rel_precision, 
        id_vars=["category", "project"], 
        value_vars=["call_precision", "data_precision", "control_precision", "module_precision"],
        var_name="Relationship Type", 
        value_name="Precision"
    )
    
    # Replace column names for better display
    melted["Relationship Type"] = melted["Relationship Type"].str.replace("_precision", "").str.title()
    
    # Create the grouped bar chart
    ax = sns.barplot(
        x="project", 
        y="Precision", 
        hue="Relationship Type", 
        data=melted,
        palette="viridis"
    )
    
    # Customize the plot
    plt.title("Relationship Precision by Project and Type", fontsize=16)
    plt.xlabel("Project", fontsize=14)
    plt.ylabel("Precision", fontsize=14)
    plt.xticks(rotation=45, ha="right")
    plt.ylim(0, 1.0)
    plt.legend(title="Relationship Type", bbox_to_anchor=(1.05, 1), loc="upper left")
    plt.tight_layout()
    
    # Save the figure
    os.makedirs("visualizations", exist_ok=True)
    plt.savefig("visualizations/relationship_precision.png", dpi=300)
    plt.close()

def plot_chain_characteristics(chain_chars):
    """Plot chain characteristics results"""
    # Create a figure with 2x2 subplots
    fig, axs = plt.subplots(2, 2, figsize=(15, 12))
    
    # 1. Average Chain Length
    sns.barplot(
        x="project", 
        y="average_chain_length", 
        hue="category", 
        data=chain_chars,
        ax=axs[0, 0],
        palette="viridis"
    )
    axs[0, 0].set_title("Average Chain Length")
    axs[0, 0].set_xlabel("Project")
    axs[0, 0].set_ylabel("Average Length")
    axs[0, 0].tick_params(axis='x', rotation=45)
    
    # 2. Maximum Chain Length
    sns.barplot(
        x="project", 
        y="maximum_chain_length", 
        hue="category", 
        data=chain_chars,
        ax=axs[0, 1],
        palette="viridis"
    )
    axs[0, 1].set_title("Maximum Chain Length")
    axs[0, 1].set_xlabel("Project")
    axs[0, 1].set_ylabel("Maximum Length")
    axs[0, 1].tick_params(axis='x', rotation=45)
    
    # 3. Participation Rate
    chain_chars["participation_rate_pct"] = chain_chars["participation_rate"] * 100
    sns.barplot(
        x="project", 
        y="participation_rate_pct", 
        hue="category", 
        data=chain_chars,
        ax=axs[1, 0],
        palette="viridis"
    )
    axs[1, 0].set_title("SATD Participation Rate in Chains")
    axs[1, 0].set_xlabel("Project")
    axs[1, 0].set_ylabel("Participation Rate (%)")
    axs[1, 0].tick_params(axis='x', rotation=45)
    
    # 4. Cross-Module Chains
    chain_chars["cross_module_chains_pct"] = chain_chars["cross_module_chains"] * 100
    sns.barplot(
        x="project", 
        y="cross_module_chains_pct", 
        hue="category", 
        data=chain_chars,
        ax=axs[1, 1],
        palette="viridis"
    )
    axs[1, 1].set_title("Cross-Module Chains")
    axs[1, 1].set_xlabel("Project")
    axs[1, 1].set_ylabel("Cross-Module Rate (%)")
    axs[1, 1].tick_params(axis='x', rotation=45)
    
    # Remove duplicate legends
    handles, labels = axs[0, 0].get_legend_handles_labels()
    for ax in axs.flat:
        ax.get_legend().remove()
    
    fig.legend(handles, labels, title="Project Category", bbox_to_anchor=(0.5, 0.01), loc="lower center", ncol=3)
    plt.tight_layout()
    plt.subplots_adjust(bottom=0.10)
    
    # Save the figure
    os.makedirs("visualizations", exist_ok=True)
    plt.savefig("visualizations/chain_characteristics.png", dpi=300)
    plt.close()

def plot_recommendation_utility(rec_utility):
    """Plot recommendation utility results"""
    plt.figure(figsize=(15, 8))
    
    # Melt the dataframe for easier plotting
    melted = pd.melt(
        rec_utility, 
        id_vars=["category", "project"], 
        value_vars=["usefulness_rating", "acceptance_rate", "implementation_rate", "baseline_implementation_rate"],
        var_name="Metric", 
        value_name="Value"
    )
    
    # Scale usefulness_rating to match rate metrics
    melted.loc[melted["Metric"] == "usefulness_rating", "Value"] = melted.loc[melted["Metric"] == "usefulness_rating", "Value"] / 5.0
    
    # Replace column names for better display
    melted["Metric"] = melted["Metric"].str.replace("_", " ").str.title()
    
    # Create the grouped bar chart
    ax = sns.barplot(
        x="project", 
        y="Value", 
        hue="Metric", 
        data=melted,
        palette="viridis"
    )
    
    # Customize the plot
    plt.title("Recommendation Utility Metrics by Project", fontsize=16)
    plt.xlabel("Project", fontsize=14)
    plt.ylabel("Value (Normalized)", fontsize=14)
    plt.xticks(rotation=45, ha="right")
    plt.ylim(0, 1.0)
    plt.legend(title="Metric", bbox_to_anchor=(1.05, 1), loc="upper left")
    
    # Add a note about usefulness_rating normalization
    plt.annotate(
        "Note: Usefulness Rating normalized from 1-5 scale to 0-1 for comparison",
        xy=(0.5, -0.15), 
        xycoords="axes fraction",
        ha="center",
        fontsize=10
    )
    
    plt.tight_layout()
    
    # Save the figure
    os.makedirs("visualizations", exist_ok=True)
    plt.savefig("visualizations/recommendation_utility.png", dpi=300)
    plt.close()

def compare_with_expected_values():
    """Compare results with expected values from the paper"""
    rel_precision, chain_chars, rec_utility = load_results()
    
    # Set up the figure and a color map
    fig, axs = plt.subplots(3, 1, figsize=(15, 18))
    cmap = plt.cm.RdYlGn
    
    # 1. Compare relationship precision
    expected_rel = {
        "Apache Commons": {"call": 0.94, "data": 0.89, "control": 0.82, "module": 0.95},
        "Spring": {"call": 0.93, "data": 0.88, "control": 0.81, "module": 0.94},
        "TensorFlow": {"call": 0.90, "data": 0.85, "control": 0.80, "module": 0.93},
        "React": {"call": 0.91, "data": 0.86, "control": 0.80, "module": 0.93},
        "SciPy": {"call": 0.92, "data": 0.87, "control": 0.82, "module": 0.95},
        "Android": {"call": 0.87, "data": 0.83, "control": 0.76, "module": 0.90},
        "Firefox": {"call": 0.89, "data": 0.84, "control": 0.78, "module": 0.91},
        "PostgreSQL": {"call": 0.91, "data": 0.85, "control": 0.80, "module": 0.92},
        "VSCode": {"call": 0.91, "data": 0.86, "control": 0.80, "module": 0.94},
        "Kubernetes": {"call": 0.89, "data": 0.84, "control": 0.78, "module": 0.92},
    }
    
    # Create a dataframe for the comparison
    diff_data = []
    
    for _, row in rel_precision.iterrows():
        project = row["project"]
        for rel_type in ["call", "data", "control", "module"]:
            col_name = f"{rel_type}_precision"
            actual = row[col_name]
            expected = expected_rel.get(project, {}).get(rel_type, 0)
            diff = actual - expected
            diff_data.append({
                "Project": project,
                "Metric": f"Relationship Precision ({rel_type.title()})",
                "Actual": actual,
                "Expected": expected,
                "Difference": diff
            })
    
    # 2. Compare chain characteristics
    expected_chain = {
        "Apache Commons": {"acl": 3.2, "mcl": 8, "pr": 0.45, "cmc": 0.30},
        "Spring": {"acl": 3.5, "mcl": 9, "pr": 0.48, "cmc": 0.33},
        "TensorFlow": {"acl": 3.6, "mcl": 10, "pr": 0.50, "cmc": 0.35},
        "React": {"acl": 3.3, "mcl": 8, "pr": 0.44, "cmc": 0.29},
        "SciPy": {"acl": 3.4, "mcl": 9, "pr": 0.47, "cmc": 0.32},
        "Android": {"acl": 4.5, "mcl": 16, "pr": 0.72, "cmc": 0.62},
        "Firefox": {"acl": 4.3, "mcl": 15, "pr": 0.69, "cmc": 0.58},
        "PostgreSQL": {"acl": 3.8, "mcl": 12, "pr": 0.64, "cmc": 0.52},
        "VSCode": {"acl": 3.9, "mcl": 13, "pr": 0.61, "cmc": 0.48},
        "Kubernetes": {"acl": 3.7, "mcl": 11, "pr": 0.57, "cmc": 0.42},
    }
    
    for _, row in chain_chars.iterrows():
        project = row["project"]
        
        # Average Chain Length
        actual = row["average_chain_length"]
        expected = expected_chain.get(project, {}).get("acl", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Average Chain Length",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
        
        # Maximum Chain Length
        actual = row["maximum_chain_length"]
        expected = expected_chain.get(project, {}).get("mcl", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Maximum Chain Length",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
        
        # Participation Rate
        actual = row["participation_rate"]
        expected = expected_chain.get(project, {}).get("pr", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Participation Rate",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
        
        # Cross Module Chains
        actual = row["cross_module_chains"]
        expected = expected_chain.get(project, {}).get("cmc", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Cross Module Chains",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
    
    # 3. Compare recommendation utility
    expected_util = {
        "Apache Commons": {"uf": 3.7, "ar": 0.74, "ir": 0.40},
        "Spring": {"uf": 3.9, "ar": 0.78, "ir": 0.44},
        "TensorFlow": {"uf": 3.8, "ar": 0.77, "ir": 0.43},
        "React": {"uf": 3.7, "ar": 0.75, "ir": 0.41},
        "SciPy": {"uf": 3.9, "ar": 0.76, "ir": 0.42},
        "Android": {"uf": 4.4, "ar": 0.85, "ir": 0.54},
        "Firefox": {"uf": 4.3, "ar": 0.84, "ir": 0.53},
        "PostgreSQL": {"uf": 4.2, "ar": 0.83, "ir": 0.52},
        "VSCode": {"uf": 4.2, "ar": 0.82, "ir": 0.48},
        "Kubernetes": {"uf": 4.0, "ar": 0.80, "ir": 0.46},
    }
    
    for _, row in rec_utility.iterrows():
        project = row["project"]
        
        # Usefulness Rating
        actual = row["usefulness_rating"]
        expected = expected_util.get(project, {}).get("uf", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Usefulness Rating",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
        
        # Acceptance Rate
        actual = row["acceptance_rate"]
        expected = expected_util.get(project, {}).get("ar", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Acceptance Rate",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
        
        # Implementation Rate
        actual = row["implementation_rate"]
        expected = expected_util.get(project, {}).get("ir", 0)
        diff = actual - expected
        diff_data.append({
            "Project": project,
            "Metric": "Implementation Rate",
            "Actual": actual,
            "Expected": expected,
            "Difference": diff
        })
    
    # Convert to dataframe
    diff_df = pd.DataFrame(diff_data)
    
    # Group dataframe by metric for plotting
    metrics = diff_df["Metric"].unique()
    metric_groups = [
        [m for m in metrics if "Relationship" in m],
        [m for m in metrics if "Chain" in m or m in ["Participation Rate", "Cross Module Chains"]],
        [m for m in metrics if m in ["Usefulness Rating", "Acceptance Rate", "Implementation Rate"]]
    ]
    
    # Plot differences for each group
    for i, group in enumerate(metric_groups):
        group_df = diff_df[diff_df["Metric"].isin(group)]
        
        # Create heatmap-style table
        pivot = group_df.pivot(index="Metric", columns="Project", values="Difference")
        
        # Create a mask for NaN values
        mask = pivot.isna()
        
        # Plot heatmap
        sns.heatmap(
            pivot, 
            annot=True, 
            fmt=".3f", 
            cmap=cmap,
            center=0,
            mask=mask,
            ax=axs[i],
            cbar_kws={"label": "Difference (Actual - Expected)"}
        )
        
        axs[i].set_title(f"Differences Between Actual and Expected Values - Group {i+1}", fontsize=14)
        axs[i].set_xlabel("Project", fontsize=12)
        axs[i].set_ylabel("Metric", fontsize=12)
        plt.setp(axs[i].get_xticklabels(), rotation=45, ha="right")
    
    plt.tight_layout()
    
    # Save the figure
    os.makedirs("visualizations", exist_ok=True)
    plt.savefig("visualizations/comparison_with_expected.png", dpi=300)
    plt.close()
    
    # Also save the difference data as CSV
    diff_df.to_csv("results/comparison_with_expected.csv", index=False)

def main():
    """Main function to generate visualizations"""
    try:
        rel_precision, chain_chars, rec_utility = load_results()
        
        # Create individual visualizations
        plot_relationship_precision(rel_precision)
        plot_chain_characteristics(chain_chars)
        plot_recommendation_utility(rec_utility)
        
        # Compare with expected values
        compare_with_expected_values()
        
        print("Visualizations created successfully in the 'visualizations' directory.")
        
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Please run the experiment script first to generate the result CSV files.")
    except Exception as e:
        print(f"Error generating visualizations: {e}")

if __name__ == "__main__":
    main()
