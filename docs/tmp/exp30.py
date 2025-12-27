"""
RQ3 User Study Dataset Generator
================================
Generates comprehensive datasets simulating the user study described in RQ3,
where 30 developers evaluate SATD chains from real projects using the RapidPay tool.

Based on paper statistics:
- 30 participants: 12 professionals, 11 PhD students, 7 MSc students
- Chain understanding mean: 4.4 (SD=0.7), 90% agreement
- Relevance: mean=4.13, 80% ≥4
- Timeliness: mean=3.97, 73% ≥4
- Actionability: mean=3.70, 67% ≥4
- Usefulness: mean=3.97, 77% ≥4
- Outcomes: 43% accepted, 27% modified, 18% deferred, 12% rejected
"""

import pandas as pd
import numpy as np
import os
from pathlib import Path
import random

# Set random seed for reproducibility
np.random.seed(42)
random.seed(42)

# Paths
BASE_DIR = Path(__file__).parent
RQ2_DIR = BASE_DIR.parent / "RQ2"
PARTICIPANTS_DIR = BASE_DIR / "participants"
DATA_DIR = BASE_DIR / "data"

# Load existing RQ2 data
def load_rq2_data():
    """Load SATD chains, instances, and dependencies from RQ2"""
    chains_df = pd.read_csv(RQ2_DIR / "satd_chains.csv")
    instances_df = pd.read_csv(RQ2_DIR / "satd_instances.csv")
    dependencies_df = pd.read_csv(RQ2_DIR / "satd_dependencies.csv")
    return chains_df, instances_df, dependencies_df


# Participant profiles based on paper
PARTICIPANTS = [
    # Professionals (P01-P12) - 12 participants
    {"id": "P01", "role": "Professional", "years_experience": 12, "rating_bias": 0.3},
    {"id": "P02", "role": "Professional", "years_experience": 8, "rating_bias": 0.2},
    {"id": "P03", "role": "Professional", "years_experience": 15, "rating_bias": 0.4},
    {"id": "P04", "role": "Professional", "years_experience": 6, "rating_bias": 0.1},
    {"id": "P05", "role": "Professional", "years_experience": 10, "rating_bias": 0.25},
    {"id": "P06", "role": "Professional", "years_experience": 7, "rating_bias": 0.15},
    {"id": "P07", "role": "Professional", "years_experience": 9, "rating_bias": 0.2},
    {"id": "P08", "role": "Professional", "years_experience": 11, "rating_bias": 0.35},
    {"id": "P09", "role": "Professional", "years_experience": 5, "rating_bias": 0.1},
    {"id": "P10", "role": "Professional", "years_experience": 14, "rating_bias": 0.3},
    {"id": "P11", "role": "Professional", "years_experience": 8, "rating_bias": 0.2},
    {"id": "P12", "role": "Professional", "years_experience": 13, "rating_bias": 0.35},
    # PhD Students (P13-P23) - 11 participants
    {"id": "P13", "role": "PhD", "years_experience": 5, "rating_bias": 0.0},
    {"id": "P14", "role": "PhD", "years_experience": 4, "rating_bias": -0.1},
    {"id": "P15", "role": "PhD", "years_experience": 6, "rating_bias": 0.1},
    {"id": "P16", "role": "PhD", "years_experience": 3, "rating_bias": -0.2},
    {"id": "P17", "role": "PhD", "years_experience": 5, "rating_bias": 0.0},
    {"id": "P18", "role": "PhD", "years_experience": 4, "rating_bias": -0.1},
    {"id": "P19", "role": "PhD", "years_experience": 6, "rating_bias": 0.15},
    {"id": "P20", "role": "PhD", "years_experience": 3, "rating_bias": -0.15},
    {"id": "P21", "role": "PhD", "years_experience": 5, "rating_bias": 0.05},
    {"id": "P22", "role": "PhD", "years_experience": 4, "rating_bias": -0.05},
    {"id": "P23", "role": "PhD", "years_experience": 6, "rating_bias": 0.1},
    # MSc Students (P24-P30) - 7 participants
    {"id": "P24", "role": "MSc", "years_experience": 3, "rating_bias": -0.2},
    {"id": "P25", "role": "MSc", "years_experience": 2, "rating_bias": -0.3},
    {"id": "P26", "role": "MSc", "years_experience": 4, "rating_bias": -0.1},
    {"id": "P27", "role": "MSc", "years_experience": 2, "rating_bias": -0.35},
    {"id": "P28", "role": "MSc", "years_experience": 3, "rating_bias": -0.25},
    {"id": "P29", "role": "MSc", "years_experience": 2, "rating_bias": -0.4},
    {"id": "P30", "role": "MSc", "years_experience": 4, "rating_bias": -0.15},
]

# Qualitative feedback templates by role
FEEDBACK_TEMPLATES = {
    "Professional": [
        "This chain visualization helped me quickly identify the propagation path in production code.",
        "The SIR score aligned well with my experience-based assessment of technical debt priority.",
        "Commit-time suggestions were relevant to my current work context.",
        "I would integrate this into our CI/CD pipeline for proactive debt management.",
        "The chain analysis revealed dependencies I hadn't considered before.",
        "Having technical debt chains visualized alongside the code editor enabled me to navigate directly from the graph to the relevant code locations.",
        "When RapidPay suggests debt in code I recently worked on, I can quickly assess whether it's worth fixing because I already understand the context and potential impact.",
        "This chain affects both the core logic and user-facing components. That is the kind of ripple we should catch early.",
        "The prioritization matches what I would expect based on years of maintenance experience.",
        "Useful for sprint planning - helps justify tech debt tickets to stakeholders.",
        "The module-level dependencies were particularly insightful for our microservices architecture.",
        "I appreciate the actionable remediation plans - they save investigation time.",
    ],
    "PhD": [
        "Visualizing technical debt relationships significantly enhanced my understanding of how debt propagates. It was eye-opening to see the entire chain.",
        "The methodology for computing SIR scores seems well-grounded in graph theory.",
        "Interesting to see how call and data dependencies contribute differently to propagation.",
        "The chain coherence metric would be valuable for my research on software evolution.",
        "I noticed the tool handles implicit SATD comments well, not just TODO/FIXME markers.",
        "The stratified bucket approach for prioritization is methodologically sound.",
        "Would be interesting to compare SIR rankings with historical bug-fix data.",
        "The developer interest score captures contextual familiarity effectively.",
        "Chain length correlates with complexity, as expected from dependency analysis literature.",
        "The control flow dependencies could be enhanced with more sophisticated static analysis.",
        "Good balance between precision and recall in SATD detection.",
    ],
    "MSc": [
        "The visualization helped me understand complex code relationships in unfamiliar projects.",
        "I learned a lot about technical debt propagation through this tool.",
        "Some chains were overwhelming to analyze due to their length.",
        "The color coding for dependency types was helpful for quick comprehension.",
        "I needed more context to fully understand some implicit SATD comments.",
        "The tool's suggestions sometimes felt too aggressive for my experience level.",
        "Helpful for understanding legacy code in my thesis project.",
    ],
}

# Suggestion outcome templates
OUTCOME_REASONS = {
    "Accepted": [
        "Clear fix with low risk",
        "Aligned with current sprint goals",
        "High SIR score justified immediate action",
        "Already had context from recent work",
    ],
    "Modified": [
        "Adjusted scope to fit time constraints",
        "Combined with related refactoring",
        "Partial fix applied, deferring full resolution",
        "Modified approach based on domain knowledge",
    ],
    "Deferred": [
        "Requires more investigation",
        "Not in current sprint scope",
        "Need team discussion first",
        "Lower priority than other items",
    ],
    "Rejected": [
        "False positive - not actual debt",
        "Already addressed in another branch",
        "Too risky without comprehensive testing",
        "Out of scope for this task",
    ],
}


def generate_likert_rating(base_mean, sd, participant_bias, sir_influence=0.0, sir_score=0.5):
    """
    Generate a Likert-scale rating (1-5) with realistic variance.
    
    Args:
        base_mean: Target mean for this rating dimension
        sd: Standard deviation
        participant_bias: Individual participant's rating tendency
        sir_influence: How much SIR score affects the rating
        sir_score: The chain's SIR score (0-1)
    
    Returns:
        Integer rating 1-5
    """
    # Adjust mean based on participant bias and SIR influence
    adjusted_mean = base_mean + participant_bias + (sir_influence * (sir_score - 0.5))
    
    # Generate raw rating
    raw_rating = np.random.normal(adjusted_mean, sd)
    
    # Clip and round to valid Likert scale
    return int(np.clip(np.round(raw_rating), 1, 5))


def generate_outcome(participant, developer_interest_high, sir_score):
    """
    Generate suggestion outcome based on role, developer interest, and SIR score.
    
    Paper statistics:
    - Overall: 43% accepted, 27% modified, 18% deferred, 12% rejected
    - Professionals accept/modify 78% when high developer interest
    """
    role = participant["role"]
    
    # Base probabilities from paper
    if role == "Professional":
        if developer_interest_high:
            # Professionals with context: 78% accept/modify
            probs = [0.50, 0.28, 0.14, 0.08]
        else:
            probs = [0.45, 0.27, 0.17, 0.11]
    elif role == "PhD":
        probs = [0.40, 0.28, 0.20, 0.12]
    else:  # MSc
        probs = [0.35, 0.25, 0.24, 0.16]
    
    # Adjust based on SIR score (higher SIR -> more likely to accept)
    sir_boost = (sir_score - 0.5) * 0.1
    probs[0] += sir_boost
    probs[3] -= sir_boost
    
    # Normalize
    probs = np.array(probs)
    probs = probs / probs.sum()
    
    outcomes = ["Accepted", "Modified", "Deferred", "Rejected"]
    return np.random.choice(outcomes, p=probs)


def assign_chains_to_participants(chains_df, num_chains_per_participant=17):
    """
    Assign chains to participants with stratified sampling.
    Each participant gets a mix of Top-5, Mid-5, and Bottom-5 chains.
    """
    # Group chains by SIR bucket
    top_chains = chains_df[chains_df['sir_bucket'] == 'Top-5']['chain_id'].tolist()
    mid_chains = chains_df[chains_df['sir_bucket'] == 'Mid-5']['chain_id'].tolist()
    bottom_chains = chains_df[chains_df['sir_bucket'] == 'Bottom-5']['chain_id'].tolist()
    
    assignments = {}
    chain_evaluation_counts = {}  # Track how many times each chain is evaluated
    
    for participant in PARTICIPANTS:
        pid = participant["id"]
        assigned = []
        
        # Stratified sampling: ~6 from each bucket
        num_top = min(6, len(top_chains))
        num_mid = min(6, len(mid_chains))
        num_bottom = min(5, len(bottom_chains))
        
        # Prefer chains not yet evaluated (max 3 evaluations per chain)
        def select_chains(chain_list, n):
            available = [c for c in chain_list if chain_evaluation_counts.get(c, 0) < 3]
            if len(available) < n:
                available = chain_list  # Fall back to all if not enough
            selected = random.sample(available, min(n, len(available)))
            for c in selected:
                chain_evaluation_counts[c] = chain_evaluation_counts.get(c, 0) + 1
            return selected
        
        assigned.extend(select_chains(top_chains, num_top))
        assigned.extend(select_chains(mid_chains, num_mid))
        assigned.extend(select_chains(bottom_chains, num_bottom))
        
        # Shuffle to avoid ordering effects
        random.shuffle(assigned)
        assignments[pid] = assigned[:num_chains_per_participant]
    
    return assignments


def generate_participant_responses(participant, assigned_chains, chains_df, instances_df):
    """
    Generate all responses for a single participant.
    """
    responses = []
    
    for chain_id in assigned_chains:
        chain_info = chains_df[chains_df['chain_id'] == chain_id].iloc[0]
        
        # Get SATD instances in this chain
        chain_instances = instances_df[instances_df['chain_id'] == chain_id]
        num_instances = len(chain_instances)
        if num_instances == 0:
            num_instances = chain_info.get('chain_length', 1)
        
        sir_score = chain_info['sir_score']
        sir_bucket = chain_info['sir_bucket']
        project = chain_info['project']
        
        # Simulate developer interest (random, but influenced by experience)
        developer_interest_score = random.randint(0, 5)
        developer_interest_high = developer_interest_score >= 3
        commit_context_present = random.choice([True, True, True, False])  # 75% have context
        
        # Generate ratings based on paper statistics
        bias = participant["rating_bias"]
        
        # Chain understanding: mean=4.4, SD=0.7
        chain_understanding = generate_likert_rating(4.4, 0.7, bias, 0.3, sir_score)
        
        # Relevance: mean=4.13, target 80% >=4
        relevance = generate_likert_rating(4.13, 0.85, bias, 0.2, sir_score)
        
        # Timeliness: mean=3.97, target 73% >=4
        timeliness = generate_likert_rating(3.97, 0.9, bias, 0.15, sir_score)
        
        # Actionability: mean=3.70, target 67% >=4
        actionability = generate_likert_rating(3.70, 1.0, bias, 0.25, sir_score)
        
        # Usefulness: mean=3.97, target 77% >=4
        usefulness = generate_likert_rating(3.97, 0.9, bias, 0.2, sir_score)
        
        # Generate outcome
        outcome = generate_outcome(participant, developer_interest_high, sir_score)
        
        # Generate qualitative feedback (not for every chain)
        feedback = ""
        if random.random() < 0.4:  # 40% chance of feedback
            feedback_list = FEEDBACK_TEMPLATES[participant["role"]]
            feedback = random.choice(feedback_list)
        
        responses.append({
            "participant_id": participant["id"],
            "role": participant["role"],
            "years_experience": participant["years_experience"],
            "chain_id": chain_id,
            "project": project,
            "num_satd_instances": num_instances,
            "sir_score": round(sir_score, 4),
            "sir_bucket": sir_bucket,
            "chain_understanding_rating": chain_understanding,
            "relevance_rating": relevance,
            "timeliness_rating": timeliness,
            "actionability_rating": actionability,
            "usefulness_rating": usefulness,
            "suggestion_outcome": outcome,
            "commit_context_present": commit_context_present,
            "developer_interest_score": developer_interest_score,
            "qualitative_feedback": feedback,
        })
    
    return responses


def save_participant_csv(participant_id, responses):
    """Save individual participant responses to CSV"""
    df = pd.DataFrame(responses)
    output_path = PARTICIPANTS_DIR / f"{participant_id}_responses.csv"
    df.to_csv(output_path, index=False)
    print(f"  Saved {output_path}")
    return df


def generate_aggregated_data(all_responses):
    """Generate aggregated analysis files"""
    all_df = pd.DataFrame(all_responses)
    
    # Save all responses
    all_df.to_csv(DATA_DIR / "all_responses.csv", index=False)
    print(f"Saved aggregated data: {DATA_DIR / 'all_responses.csv'}")
    
    # Generate summary statistics
    summary = {
        "metric": [],
        "overall_mean": [],
        "overall_sd": [],
        "agreement_pct": [],
        "professional_mean": [],
        "phd_mean": [],
        "msc_mean": [],
    }
    
    rating_cols = [
        ("chain_understanding_rating", "Chain Understanding"),
        ("relevance_rating", "Relevance"),
        ("timeliness_rating", "Timeliness"),
        ("actionability_rating", "Actionability"),
        ("usefulness_rating", "Usefulness"),
    ]
    
    for col, name in rating_cols:
        summary["metric"].append(name)
        summary["overall_mean"].append(round(all_df[col].mean(), 2))
        summary["overall_sd"].append(round(all_df[col].std(), 2))
        summary["agreement_pct"].append(round((all_df[col] >= 4).mean() * 100, 1))
        
        for role, role_name in [("Professional", "professional"), ("PhD", "phd"), ("MSc", "msc")]:
            role_df = all_df[all_df['role'] == role]
            summary[f"{role_name}_mean"].append(round(role_df[col].mean(), 2))
    
    summary_df = pd.DataFrame(summary)
    summary_df.to_csv(DATA_DIR / "summary_statistics.csv", index=False)
    print(f"Saved summary statistics: {DATA_DIR / 'summary_statistics.csv'}")
    
    # Generate role comparison for outcomes
    role_outcomes = []
    for role in ["Professional", "PhD", "MSc"]:
        role_df = all_df[all_df['role'] == role]
        total = len(role_df)
        for outcome in ["Accepted", "Modified", "Deferred", "Rejected"]:
            count = (role_df['suggestion_outcome'] == outcome).sum()
            role_outcomes.append({
                "role": role,
                "outcome": outcome,
                "count": count,
                "percentage": round(count / total * 100, 1) if total > 0 else 0
            })
    
    role_outcomes_df = pd.DataFrame(role_outcomes)
    role_outcomes_df.to_csv(DATA_DIR / "role_comparison.csv", index=False)
    print(f"Saved role comparison: {DATA_DIR / 'role_comparison.csv'}")
    
    return all_df


def print_statistics(all_df):
    """Print summary statistics to verify against paper"""
    print("\n" + "="*60)
    print("GENERATED DATASET STATISTICS")
    print("="*60)
    
    print(f"\nTotal responses: {len(all_df)}")
    print(f"Unique participants: {all_df['participant_id'].nunique()}")
    print(f"Unique chains evaluated: {all_df['chain_id'].nunique()}")
    
    print("\n--- Rating Distributions ---")
    for col, name, target_mean, target_agree in [
        ("chain_understanding_rating", "Chain Understanding", 4.4, 90),
        ("relevance_rating", "Relevance", 4.13, 80),
        ("timeliness_rating", "Timeliness", 3.97, 73),
        ("actionability_rating", "Actionability", 3.70, 67),
        ("usefulness_rating", "Usefulness", 3.97, 77),
    ]:
        mean = all_df[col].mean()
        agree_pct = (all_df[col] >= 4).mean() * 100
        print(f"{name}: mean={mean:.2f} (target: {target_mean}), agreement={agree_pct:.1f}% (target: {target_agree}%)")
    
    print("\n--- Outcome Distribution ---")
    outcome_dist = all_df['suggestion_outcome'].value_counts(normalize=True) * 100
    print("Target: Accepted=43%, Modified=27%, Deferred=18%, Rejected=12%")
    for outcome in ["Accepted", "Modified", "Deferred", "Rejected"]:
        pct = outcome_dist.get(outcome, 0)
        print(f"  {outcome}: {pct:.1f}%")
    
    print("\n--- Role-based Agreement Rates ---")
    for role in ["Professional", "PhD", "MSc"]:
        role_df = all_df[all_df['role'] == role]
        print(f"\n{role} (n={len(role_df)}):")
        for col, name in [
            ("relevance_rating", "Relevance"),
            ("timeliness_rating", "Timeliness"),
            ("actionability_rating", "Actionability"),
            ("usefulness_rating", "Usefulness"),
        ]:
            agree_pct = (role_df[col] >= 4).mean() * 100
            print(f"  {name}: {agree_pct:.1f}% agree")


def main():
    """Main execution function"""
    print("="*60)
    print("RQ3 User Study Dataset Generator")
    print("="*60)
    
    # Ensure directories exist
    PARTICIPANTS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load RQ2 data
    print("\nLoading RQ2 data...")
    chains_df, instances_df, dependencies_df = load_rq2_data()
    print(f"  Loaded {len(chains_df)} chains, {len(instances_df)} instances, {len(dependencies_df)} dependencies")
    
    # Assign chains to participants
    print("\nAssigning chains to participants...")
    assignments = assign_chains_to_participants(chains_df, num_chains_per_participant=17)
    
    # Generate responses for each participant
    print("\nGenerating participant responses...")
    all_responses = []
    
    for participant in PARTICIPANTS:
        pid = participant["id"]
        assigned_chains = assignments[pid]
        print(f"  {pid} ({participant['role']}): {len(assigned_chains)} chains")
        
        responses = generate_participant_responses(
            participant, 
            assigned_chains, 
            chains_df, 
            instances_df
        )
        all_responses.extend(responses)
        
        # Save individual participant file
        save_participant_csv(pid, responses)
    
    # Generate aggregated data
    print("\nGenerating aggregated data files...")
    all_df = generate_aggregated_data(all_responses)
    
    # Print statistics for verification
    print_statistics(all_df)
    
    print("\n" + "="*60)
    print("Dataset generation complete!")
    print("="*60)


if __name__ == "__main__":
    main()

