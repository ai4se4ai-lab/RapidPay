# RQ1/RQ2 SATD Chain Detection Evaluation

This test case provides a comprehensive evaluation of RapidPay's SATD detection and prioritization capabilities, addressing two key research questions:

## Research Questions

### RQ1: How can SATD instances be accurately detected and structured into propagation chains using program-level dependencies?

This evaluation assesses:
- **SATD Detection Accuracy**: Precision, recall, and F1 score of the SID (SATD Instance Detection) component
- **Chain Structure Discovery**: Accuracy of the IRD (Inter-SATD Relationship Discovery) in identifying dependency chains
- **Relationship Type Identification**: Correctness of call, data, control, and module dependency detection

### RQ2: How effective is the SIR scoring strategy in prioritizing high-impact SATD chains for developer attention?

This evaluation assesses:
- **Ranking Correlation**: Spearman and Kendall's Tau correlation between SIR rankings and expected developer priorities
- **Top-k Precision**: How well the highest-ranked SATD items match expected high-impact instances
- **Developer Alignment**: How well the prioritization matches developer judgment on severity and urgency

## Test Case Structure

```
Test/RQ_Evaluation/
├── README.md                    # This documentation
├── ground_truth.json           # Expected results and evaluation thresholds
├── run_evaluation.ts           # Evaluation runner script
├── evaluation_results.json     # Generated evaluation results
├── visualization.html          # Generated interactive visualization
│
│── Chain A: Payment Processing (4 nodes)
├── payment_gateway.py          # SATD1: Design debt (hardcoded provider)
├── transaction_processor.py    # SATD2: Implementation debt (no retry)
├── payment_validator.py        # SATD3: Test debt (missing tests)
├── receipt_generator.py        # SATD4: Documentation debt (undocumented API)
│
│── Chain B: Data Pipeline (3 nodes)
├── data_extractor.py           # SATD5: Architecture debt (tight coupling)
├── data_transformer.py         # SATD6: Implementation debt (O(n²) algorithm)
├── data_loader.py              # SATD7: Defect debt (race condition)
│
│── Chain C: Notification System (3 nodes)
├── notification_service.py     # SATD8: Design debt (no abstraction)
├── email_sender.py             # SATD9: Implementation debt (blocking I/O)
└── sms_sender.py               # SATD10: Requirement debt (incomplete feature)
```

## SATD Chain Descriptions

### Chain A: Payment Processing
A 4-node chain representing technical debt in a payment processing pipeline:
- **Root (SATD1)**: Hardcoded payment provider limits flexibility
- **SATD2**: Missing retry logic causes unnecessary transaction failures
- **SATD3**: Untested validation logic may contain hidden bugs
- **SATD4**: Undocumented API makes integration difficult

**Expected Dependencies**:
- `payment_gateway.py` → `transaction_processor.py` (call)
- `transaction_processor.py` → `payment_validator.py` (call)
- `transaction_processor.py` → `receipt_generator.py` (call)

### Chain B: Data Pipeline
A 3-node chain representing technical debt in an ETL pipeline:
- **Root (SATD5)**: Tight coupling prevents testing and component swapping
- **SATD6**: O(n²) deduplication causes performance issues at scale
- **SATD7**: Race condition in concurrent loading causes data corruption

**Expected Dependencies**:
- `data_extractor.py` → `data_transformer.py` (module, data)
- `data_transformer.py` → `data_loader.py` (call)

### Chain C: Notification System
A 3-node chain representing technical debt in a notification system:
- **Root (SATD8)**: No abstraction layer makes adding channels difficult
- **SATD9**: Blocking I/O causes thread starvation under load
- **SATD10**: International SMS support is incomplete

**Expected Dependencies**:
- `notification_service.py` → `email_sender.py` (module)
- `notification_service.py` → `sms_sender.py` (module)

## Running the Evaluation

### Prerequisites

1. Ensure RapidPay is built:
   ```bash
   npm run compile
   ```

2. (Optional) Set up Neo4j for graph export:
   ```bash
   # Start Neo4j using Docker
   docker-compose up -d neo4j
   ```

3. (Optional) Set OpenAI API key for LLM-enhanced detection:
   ```bash
   export OPENAI_API_KEY=your_key_here
   ```

### Running the Evaluation

**Basic evaluation (lexical patterns only):**
```bash
npx ts-node Test/RQ_Evaluation/run_evaluation.ts
```

**Verbose mode with detailed output:**
```bash
npx ts-node Test/RQ_Evaluation/run_evaluation.ts --verbose
```

**Export to Neo4j:**
```bash
npx ts-node Test/RQ_Evaluation/run_evaluation.ts --neo4j bolt://localhost:7687
```

**Save results to custom file:**
```bash
npx ts-node Test/RQ_Evaluation/run_evaluation.ts --output results/my_results.json
```

### Alternative: Using the CLI

You can also run the evaluation using RapidPay's CLI:

```bash
# Step 1: Run SID
npx ts-node src/cli/index.ts sid --repo Test/RQ_Evaluation --quick -o sid_results.json

# Step 2: Run IRD
npx ts-node src/cli/index.ts ird --repo Test/RQ_Evaluation -i sid_results.json -o ird_results.json

# Step 3: Run SIR
npx ts-node src/cli/index.ts sir --repo Test/RQ_Evaluation -i ird_results.json -o sir_results.json

# Or run full analysis
npx ts-node src/cli/index.ts analyze --repo Test/RQ_Evaluation --quick -o full_results.json
```

## Output Files

After running the evaluation, you'll find:

### evaluation_results.json
Complete evaluation results including:
- Pipeline performance metrics (duration, counts)
- RQ1 results (precision, recall, F1, chain accuracy)
- RQ2 results (Spearman correlation, Kendall's tau, top-k precision)
- Summary and overall assessment

### visualization.html
Interactive web visualization showing:
- SATD dependency graph with color-coded debt types
- Node sizes scaled by SIR score
- Chain highlighting
- Metrics dashboard with RQ1/RQ2 results
- SIR score ranking table

## Evaluation Metrics

### RQ1 Metrics

| Metric | Description | Threshold |
|--------|-------------|-----------|
| Precision | TP / (TP + FP) | ≥ 80% |
| Recall | TP / (TP + FN) | ≥ 90% |
| Chain Accuracy | Correctly identified chains | ≥ 85% |
| Relationship Identification | Correct dependency types | ≥ 70% |

### RQ2 Metrics

| Metric | Description | Threshold |
|--------|-------------|-----------|
| Spearman Correlation | Rank correlation with expected | ≥ 0.6 |
| Kendall's Tau | Concordant pair ratio | ≥ 0.5 |
| Top-3 Precision | High-impact items in top 3 | ≥ 67% |
| Developer Alignment | Priority category matching | - |

## Expected SIR Ranking

Based on the ground truth, the expected ranking of SATD instances by impact is:

| Rank | SATD | File | Rationale |
|------|------|------|-----------|
| 1 | SATD1 | payment_gateway.py | Root of longest chain, high fanout |
| 2 | SATD5 | data_extractor.py | Root of Chain B, tight coupling propagates |
| 3 | SATD8 | notification_service.py | Root of Chain C, affects all channels |
| 4 | SATD2 | transaction_processor.py | Middle node with 2 outgoing edges |
| 5 | SATD6 | data_transformer.py | Middle node, affects loader |
| 6 | SATD7 | data_loader.py | Critical defect but leaf node |
| 7 | SATD9 | email_sender.py | Implementation issue, connected to SMS |
| 8 | SATD10 | sms_sender.py | Leaf node, limited propagation |
| 9 | SATD3 | payment_validator.py | Leaf node, self-contained |
| 10 | SATD4 | receipt_generator.py | Leaf node, minimal propagation |

## Interpreting Results

### RQ1 Assessment

- **PASSED**: Detection precision ≥ 80% AND recall ≥ 90%, chain discovery working correctly
- **NEEDS IMPROVEMENT**: Lower metrics indicate detection or relationship discovery issues

### RQ2 Assessment

- **PASSED**: Spearman correlation ≥ 0.6, indicating strong alignment with expected prioritization
- **NEEDS IMPROVEMENT**: Lower correlation suggests SIR scoring needs refinement

## Neo4j Queries

After exporting to Neo4j, you can run these Cypher queries:

```cypher
-- View all SATD nodes
MATCH (s:SATD) RETURN s ORDER BY s.sirScore DESC

-- Find SATD chains
MATCH path = (s1:SATD)-[*]->(s2:SATD) 
RETURN path

-- Get highest impact SATD
MATCH (s:SATD) 
RETURN s.file, s.line, s.sirScore 
ORDER BY s.sirScore DESC 
LIMIT 5

-- Find relationships by type
MATCH (s1:SATD)-[r:CALL]->(s2:SATD) 
RETURN s1.file, s2.file, r.weight
```

## Troubleshooting

### Common Issues

1. **Module not found errors**: Run `npm run compile` first
2. **Neo4j connection failed**: Ensure Neo4j is running and credentials are correct
3. **Low detection recall**: Verify test files have proper SATD patterns in comments
4. **Zero relationships detected**: Check that analyzers can parse Python files

### Debug Mode

Enable verbose output to see detailed pipeline execution:
```bash
npx ts-node Test/RQ_Evaluation/run_evaluation.ts --verbose
```

## Contributing

To extend this test case:
1. Add new Python files following the naming pattern
2. Update `ground_truth.json` with new SATD instances and expected relationships
3. Run evaluation to verify changes

## License

This test case is part of the RapidPay project and follows the same license.

