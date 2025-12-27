#!/usr/bin/env python3
"""Quick script to verify confidence scores in ground truth files."""
import csv
from pathlib import Path

gt_file = Path('eval/RQ1/ground_truth/AC_ground_truth_template.csv')

with open(gt_file, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

scores = [float(r.get('confidence_score', 0)) for r in rows]
zero_count = sum(1 for s in scores if s == 0.0)
non_zero_count = len(scores) - zero_count

print(f"Total entries: {len(rows)}")
print(f"Zero confidence scores: {zero_count}")
print(f"Non-zero confidence scores: {non_zero_count}")
print(f"Min confidence: {min(scores):.3f}")
print(f"Max confidence: {max(scores):.3f}")
print(f"Average confidence: {sum(scores)/len(scores):.3f}")

if zero_count > 0:
    print(f"\nSample entries with 0.0 confidence:")
    zero_entries = [r for r in rows if float(r.get('confidence_score', 0)) == 0.0]
    for r in zero_entries[:5]:
        print(f"  {r['id'][:30]}: {r['predicted_label']}, content: {r['content'][:60]}...")

