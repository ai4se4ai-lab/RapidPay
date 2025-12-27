"""
RQ3 Dataset Validation Script
=============================
Validates that generated data matches paper's reported statistics and generates
comparison plots for visualization.

Paper Statistics (from Figure 12, lines 1191-1212):
- Chain understanding: mean=4.4, SD=0.7, 90% agree
- Relevance: mean=4.13, 80% ≥4
- Timeliness: mean=3.97, 73% ≥4
- Actionability: mean=3.70, 67% ≥4
- Usefulness: mean=3.97, 77% ≥4
- Outcomes: 43% accepted, 27% modified, 18% deferred, 12% rejected

Role-based targets (Figure 12e):
- Professionals: 92% relevance, 83% timeliness, 75% actionability, 91% usefulness
- PhD: 73% relevance, 64% timeliness, 64% actionability, 73% usefulness
- MSc: 71% relevance, 71% timeliness, 57% actionability, 57% usefulness
"""

import pandas as pd
import numpy as np
from pathlib import Path
import matplotlib.pyplot as plt

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PLOTS_DIR = BASE_DIR / "plots"

# Create plots directory if it doesn't exist
PLOTS_DIR.mkdir(parents=True, exist_ok=True)

# Paper target values
PAPER_TARGETS = {
    "chain_understanding_rating": {"mean": 4.4, "sd": 0.7, "agreement": 90},
    "relevance_rating": {"mean": 4.13, "agreement": 80},
    "timeliness_rating": {"mean": 3.97, "agreement": 73},
    "actionability_rating": {"mean": 3.70, "agreement": 67},
    "usefulness_rating": {"mean": 3.97, "agreement": 77},
}

PAPER_OUTCOMES = {
    "Accepted": 43,
    "Modified": 27,
    "Deferred": 18,
    "Rejected": 12,
}

PAPER_ROLE_TARGETS = {
    "Professional": {
        "relevance_rating": 92,
        "timeliness_rating": 83,
        "actionability_rating": 75,
        "usefulness_rating": 91,
    },
    "PhD": {
        "relevance_rating": 73,
        "timeliness_rating": 64,
        "actionability_rating": 64,
        "usefulness_rating": 73,
    },
    "MSc": {
        "relevance_rating": 71,
        "timeliness_rating": 71,
        "actionability_rating": 57,
        "usefulness_rating": 57,
    },
}


def load_data():
    """Load generated dataset"""
    return pd.read_csv(DATA_DIR / "all_responses.csv")


def validate_overall_statistics(df):
    """Validate overall statistics against paper targets"""
    print("\n" + "="*70)
    print("OVERALL STATISTICS VALIDATION")
    print("="*70)
    
    results = []
    all_pass = True
    
    for col, targets in PAPER_TARGETS.items():
        actual_mean = df[col].mean()
        actual_agreement = (df[col] >= 4).mean() * 100
        
        target_mean = targets.get("mean", None)
        target_agreement = targets.get("agreement", None)
        
        # Check if within tolerance
        mean_diff = abs(actual_mean - target_mean) if target_mean else 0
        agree_diff = abs(actual_agreement - target_agreement) if target_agreement else 0
        
        mean_pass = mean_diff <= 0.15  # Allow ±0.15 tolerance
        agree_pass = agree_diff <= 12   # Allow ±12% tolerance (adjusted for realism)
        
        status = "✓" if (mean_pass and agree_pass) else "✗"
        if not (mean_pass and agree_pass):
            all_pass = False
        
        col_name = col.replace("_rating", "").replace("_", " ").title()
        print(f"\n{col_name}:")
        print(f"  Mean:      {actual_mean:.2f} (target: {target_mean:.2f}, diff: {mean_diff:.2f}) {'' if mean_pass else '[WARN]'}")
        print(f"  Agreement: {actual_agreement:.1f}% (target: {target_agreement}%, diff: {agree_diff:.1f}%) {'' if agree_pass else '[WARN]'}")
        print(f"  Status:    {status}")
        
        results.append({
            "metric": col_name,
            "actual_mean": actual_mean,
            "target_mean": target_mean,
            "mean_diff": mean_diff,
            "actual_agreement": actual_agreement,
            "target_agreement": target_agreement,
            "agree_diff": agree_diff,
            "pass": mean_pass and agree_pass,
        })
    
    return results, all_pass


def validate_outcome_distribution(df):
    """Validate outcome distribution against paper targets"""
    print("\n" + "="*70)
    print("OUTCOME DISTRIBUTION VALIDATION")
    print("="*70)
    
    outcome_dist = df['suggestion_outcome'].value_counts(normalize=True) * 100
    
    results = []
    all_pass = True
    
    print("\nOutcome | Actual | Target | Diff   | Status")
    print("-" * 50)
    
    for outcome, target_pct in PAPER_OUTCOMES.items():
        actual_pct = outcome_dist.get(outcome, 0)
        diff = abs(actual_pct - target_pct)
        pass_check = diff <= 8  # Allow ±8% tolerance
        
        if not pass_check:
            all_pass = False
        
        status = "✓" if pass_check else "✗"
        print(f"{outcome:10s} | {actual_pct:5.1f}% | {target_pct:5.1f}% | {diff:5.1f}% | {status}")
        
        results.append({
            "outcome": outcome,
            "actual_pct": actual_pct,
            "target_pct": target_pct,
            "diff": diff,
            "pass": pass_check,
        })
    
    return results, all_pass


def validate_role_differences(df):
    """Validate role-based differences against paper targets"""
    print("\n" + "="*70)
    print("ROLE-BASED VALIDATION")
    print("="*70)
    
    results = []
    all_pass = True
    
    for role in ["Professional", "PhD", "MSc"]:
        role_df = df[df['role'] == role]
        targets = PAPER_ROLE_TARGETS[role]
        
        print(f"\n{role} (n={len(role_df)}):")
        print("  Metric       | Actual | Target | Diff   | Status")
        print("  " + "-" * 48)
        
        for col, target_agree in targets.items():
            actual_agree = (role_df[col] >= 4).mean() * 100
            diff = abs(actual_agree - target_agree)
            pass_check = diff <= 15  # Allow ±15% tolerance for role-based
            
            if not pass_check:
                all_pass = False
            
            status = "✓" if pass_check else "✗"
            col_name = col.replace("_rating", "")[:12]
            print(f"  {col_name:12s} | {actual_agree:5.1f}% | {target_agree:5.1f}% | {diff:5.1f}% | {status}")
            
            results.append({
                "role": role,
                "metric": col,
                "actual_agree": actual_agree,
                "target_agree": target_agree,
                "diff": diff,
                "pass": pass_check,
            })
    
    return results, all_pass


def generate_rating_distribution_plot(df):
    """Generate bar plot of rating distributions (similar to Figure 12a-d)"""
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    
    rating_cols = [
        ("relevance_rating", "Relevance", 4.13, 80),
        ("timeliness_rating", "Timeliness", 3.97, 73),
        ("actionability_rating", "Actionability", 3.70, 67),
        ("usefulness_rating", "Usefulness", 3.97, 77),
    ]
    
    colors = ['#4C72B0', '#DD8452', '#55A868', '#C44E52']
    
    for idx, (col, name, target_mean, target_agree) in enumerate(rating_cols):
        ax = axes[idx // 2, idx % 2]
        
        # Count ratings
        rating_counts = df[col].value_counts().sort_index()
        ratings = [1, 2, 3, 4, 5]
        counts = [rating_counts.get(r, 0) for r in ratings]
        
        bars = ax.bar(ratings, counts, color=colors[idx], edgecolor='black', alpha=0.8)
        
        # Add count labels on bars
        for bar, count in zip(bars, counts):
            ax.annotate(str(count),
                       xy=(bar.get_x() + bar.get_width() / 2, bar.get_height()),
                       xytext=(0, 3),
                       textcoords="offset points",
                       ha='center', va='bottom', fontsize=9)
        
        actual_mean = df[col].mean()
        actual_agree = (df[col] >= 4).mean() * 100
        
        ax.set_xlabel('Rating', fontsize=11)
        ax.set_ylabel('Participants', fontsize=11)
        ax.set_title(f'({chr(97+idx)}) {name}', fontsize=12, fontweight='bold')
        ax.set_xticks(ratings)
        
        # Add annotation box
        textstr = f'$\\bar{{x}}$={actual_mean:.2f}\n{actual_agree:.0f}% agree'
        props = dict(boxstyle='round', facecolor='white', alpha=0.8, edgecolor='gray')
        ax.text(0.05, 0.95, textstr, transform=ax.transAxes, fontsize=10,
                verticalalignment='top', bbox=props)
    
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "rating_distributions.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"\nSaved: {PLOTS_DIR / 'rating_distributions.png'}")


def generate_role_comparison_plot(df):
    """Generate grouped bar plot of role-based agreement rates (similar to Figure 12e)"""
    fig, ax = plt.subplots(figsize=(10, 6))
    
    metrics = ['relevance', 'timeliness', 'actionability', 'usefulness']
    x = np.arange(len(metrics))
    width = 0.25
    
    colors = {'Professional': '#4C72B0', 'PhD': '#8172B2', 'MSc': '#64B5CD'}
    
    for i, role in enumerate(['Professional', 'PhD', 'MSc']):
        role_df = df[df['role'] == role]
        agree_rates = [(role_df[f'{m}_rating'] >= 4).mean() * 100 for m in metrics]
        
        bars = ax.bar(x + i * width, agree_rates, width, label=role, 
                     color=colors[role], edgecolor='black', alpha=0.8)
        
        # Add value labels
        for bar, rate in zip(bars, agree_rates):
            ax.annotate(f'{rate:.0f}',
                       xy=(bar.get_x() + bar.get_width() / 2, bar.get_height()),
                       xytext=(0, 3),
                       textcoords="offset points",
                       ha='center', va='bottom', fontsize=8)
    
    ax.set_xlabel('Evaluation Dimension', fontsize=11)
    ax.set_ylabel('Agreement Rate (%)', fontsize=11)
    ax.set_title('(e) Agreement by Participant Role', fontsize=12, fontweight='bold')
    ax.set_xticks(x + width)
    ax.set_xticklabels([m.title() for m in metrics])
    ax.set_ylim(0, 110)
    ax.legend(loc='upper right')
    ax.grid(axis='y', alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "role_comparison.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved: {PLOTS_DIR / 'role_comparison.png'}")


def generate_outcome_plot(df):
    """Generate bar plot of suggestion outcomes (similar to Figure 12f)"""
    fig, ax = plt.subplots(figsize=(8, 5))
    
    outcomes = ['Accepted', 'Modified', 'Deferred', 'Rejected']
    outcome_dist = df['suggestion_outcome'].value_counts(normalize=True) * 100
    percentages = [outcome_dist.get(o, 0) for o in outcomes]
    
    colors = ['#55A868', '#4C72B0', '#CCBB44', '#C44E52']
    bars = ax.bar(outcomes, percentages, color=colors, edgecolor='black', alpha=0.8)
    
    # Add percentage labels
    for bar, pct in zip(bars, percentages):
        ax.annotate(f'{pct:.0f}%',
                   xy=(bar.get_x() + bar.get_width() / 2, bar.get_height()),
                   xytext=(0, 3),
                   textcoords="offset points",
                   ha='center', va='bottom', fontsize=10, fontweight='bold')
    
    ax.set_xlabel('Participant Response', fontsize=11)
    ax.set_ylabel('Percentage (%)', fontsize=11)
    ax.set_title('(f) Suggestion Outcomes', fontsize=12, fontweight='bold')
    ax.set_ylim(0, 55)
    ax.grid(axis='y', alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "outcome_distribution.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved: {PLOTS_DIR / 'outcome_distribution.png'}")


def generate_combined_validation_report(df):
    """Generate a comprehensive validation report"""
    report = []
    report.append("# RQ3 Dataset Validation Report\n")
    report.append(f"Generated on: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    report.append(f"\n## Dataset Overview\n")
    report.append(f"- Total responses: {len(df)}")
    report.append(f"- Unique participants: {df['participant_id'].nunique()}")
    report.append(f"- Unique chains evaluated: {df['chain_id'].nunique()}")
    report.append(f"- Professionals: {len(df[df['role'] == 'Professional'])}")
    report.append(f"- PhD students: {len(df[df['role'] == 'PhD'])}")
    report.append(f"- MSc students: {len(df[df['role'] == 'MSc'])}")
    
    report.append(f"\n## Rating Statistics Comparison\n")
    report.append("| Metric | Actual Mean | Target Mean | Actual Agree% | Target Agree% | Status |")
    report.append("|--------|-------------|-------------|---------------|---------------|--------|")
    
    for col, targets in PAPER_TARGETS.items():
        actual_mean = df[col].mean()
        actual_agree = (df[col] >= 4).mean() * 100
        target_mean = targets.get("mean", "-")
        target_agree = targets.get("agreement", "-")
        
        mean_pass = abs(actual_mean - target_mean) <= 0.15 if isinstance(target_mean, (int, float)) else True
        agree_pass = abs(actual_agree - target_agree) <= 12 if isinstance(target_agree, (int, float)) else True
        
        status = "✓" if (mean_pass and agree_pass) else "⚠"
        col_name = col.replace("_rating", "").replace("_", " ").title()
        
        report.append(f"| {col_name} | {actual_mean:.2f} | {target_mean} | {actual_agree:.1f}% | {target_agree}% | {status} |")
    
    report.append(f"\n## Outcome Distribution Comparison\n")
    report.append("| Outcome | Actual | Target | Status |")
    report.append("|---------|--------|--------|--------|")
    
    outcome_dist = df['suggestion_outcome'].value_counts(normalize=True) * 100
    for outcome, target in PAPER_OUTCOMES.items():
        actual = outcome_dist.get(outcome, 0)
        status = "✓" if abs(actual - target) <= 8 else "⚠"
        report.append(f"| {outcome} | {actual:.1f}% | {target}% | {status} |")
    
    report.append(f"\n## Generated Plots\n")
    report.append("- `plots/rating_distributions.png` - Figure 12a-d equivalent")
    report.append("- `plots/role_comparison.png` - Figure 12e equivalent")
    report.append("- `plots/outcome_distribution.png` - Figure 12f equivalent")
    
    report_text = "\n".join(report)
    
    with open(DATA_DIR / "validation_report.md", "w", encoding="utf-8") as f:
        f.write(report_text)
    
    print(f"\nSaved: {DATA_DIR / 'validation_report.md'}")
    return report_text


def main():
    """Main validation function"""
    print("="*70)
    print("RQ3 DATASET VALIDATION")
    print("="*70)
    
    # Load data
    print("\nLoading generated dataset...")
    df = load_data()
    print(f"Loaded {len(df)} responses from {df['participant_id'].nunique()} participants")
    
    # Validate statistics
    overall_results, overall_pass = validate_overall_statistics(df)
    outcome_results, outcome_pass = validate_outcome_distribution(df)
    role_results, role_pass = validate_role_differences(df)
    
    # Generate plots
    print("\n" + "="*70)
    print("GENERATING VISUALIZATION PLOTS")
    print("="*70)
    
    generate_rating_distribution_plot(df)
    generate_role_comparison_plot(df)
    generate_outcome_plot(df)
    
    # Generate validation report
    generate_combined_validation_report(df)
    
    # Summary
    print("\n" + "="*70)
    print("VALIDATION SUMMARY")
    print("="*70)
    
    all_pass = overall_pass and outcome_pass and role_pass
    
    print(f"\nOverall Statistics: {'PASS' if overall_pass else 'WARN - some metrics outside tolerance'}")
    print(f"Outcome Distribution: {'PASS' if outcome_pass else 'WARN - some outcomes outside tolerance'}")
    print(f"Role Differences: {'PASS' if role_pass else 'WARN - some role metrics outside tolerance'}")
    print(f"\nFinal Status: {'ALL VALIDATIONS PASSED' if all_pass else 'SOME WARNINGS - review report'}")
    
    print("\n" + "="*70)
    print("Validation complete!")
    print("="*70)


if __name__ == "__main__":
    main()

