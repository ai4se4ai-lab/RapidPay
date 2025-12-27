# LLM Usage in RapidPay

This document explains how Large Language Models (LLMs) are integrated and used in RapidPay for SATD analysis.

## Overview

RapidPay uses OpenAI's GPT models (GPT-4o, GPT-4, GPT-3.5-turbo) in a **two-stage hybrid detection approach**:

1. **Stage 1: Lexical Filtering** - Fast pattern matching (no LLM)
2. **Stage 2: LLM Classification** - Intelligent validation and classification (uses LLM)

## Architecture

### Two-Stage Detection Pipeline

```
┌─────────────────────────────────────────────────────────┐
│ Stage 1: Lexical Filtering (Pattern Matching)          │
│ - Searches for SATD markers: TODO, FIXME, HACK, etc.   │
│ - Fast, no API calls                                    │
│ - High recall (>96%)                                    │
│ Output: Candidate comments C'                           │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 2: LLM Classification (Intelligent Validation)   │
│ - Validates each candidate using LLM                    │
│ - Provides confidence scores (0-1)                      │
│ - Filters by confidence threshold τ (default: 0.7)      │
│ Output: Confirmed SATD instances C*                    │
└─────────────────────────────────────────────────────────┘
```

## LLM Functions

### 1. `classifySATD()` - SATD Classification (Prompt 1)

**Purpose**: Classifies a code comment as SATD or non-SATD with confidence score.

**Location**: `src/utils/openaiClient.ts`

**Usage**:
```typescript
const result = await classifySATD(commentText, surroundingCode);
// Returns: { isSATD: boolean, confidence: number (0-1), rawResponse: string }
```

**Prompt Structure**:
- **System Message**: Defines the LLM as a SATD detection specialist
- **User Prompt**: Contains:
  - The comment text to classify
  - Surrounding code context (5 lines before/after)
  - Instructions to respond with TRUE/FALSE and confidence (0-100)

**Example**:
```typescript
// Input
commentText = "# FIXME: This is a magic number - should be configurable"
surroundingCode = `
def calculate_timeout():
    # FIXME: This is a magic number - should be configurable
    return 5000
`

// LLM Response
"CLASSIFICATION: TRUE
CONFIDENCE: 85"

// Parsed Result
{
  isSATD: true,
  confidence: 0.85,
  rawResponse: "CLASSIFICATION: TRUE\nCONFIDENCE: 85"
}
```

**Configuration**:
- **Model**: Configurable via `OPENAI_MODEL_NAME` (default: `gpt-4o`)
- **Temperature**: 0.1 (low for consistent classification)
- **Max Tokens**: 100 (short responses)
- **Retry Logic**: Exponential backoff (3 retries)

### 2. `assessFixPotential()` - Fix Potential Assessment (Prompt 2, CAIG)

**Purpose**: Assesses whether recent code changes enable resolution of technical debt.

**Location**: `src/utils/openaiClient.ts`

**Usage**:
```typescript
const result = await assessFixPotential(
  satdComment,
  filePath,
  lineNumber,
  diffContent,
  changedFiles
);
// Returns: { potential: FixPotential (HIGH/PARTIAL/LOW), value: number, justification: string }
```

**When Used**: 
- During Commit-Aware Insight Generation (CAIG)
- Analyzes if a commit addresses existing SATD

**Example**:
```typescript
// SATD: "# FIXME: Hardcoded timeout value"
// Recent commit changes timeout to use config variable

// LLM Response
"POTENTIAL: HIGH
VALUE: 0.9
JUSTIFICATION: The commit directly addresses the hardcoded timeout by introducing a configuration variable."
```

### 3. `analyzeTechnicalDebtComment()` - Enhanced Description

**Purpose**: Generates enhanced, human-readable descriptions of technical debt items.

**Location**: `src/utils/openaiClient.ts`

**Usage**:
```typescript
const description = await analyzeTechnicalDebtComment(commentText);
// Returns: Enhanced description string
```

**Example**:
```typescript
// Input
"# FIXME: Magic number"

// Output
"This code uses a hardcoded numeric value (5000) that should be extracted to a configuration constant or environment variable for better maintainability and flexibility."
```

### 4. `batchClassifySATD()` - Batch Processing

**Purpose**: Classifies multiple comments efficiently with rate limiting.

**Location**: `src/utils/openaiClient.ts`

**Usage**:
```typescript
const results = await batchClassifySATD(comments, threshold);
// Returns: Map<string, SATDClassificationResult>
```

**Features**:
- Processes comments sequentially
- 2-second delay between requests (rate limiting)
- 5-second delay every 5 items (batch throttling)
- Handles errors gracefully

## Integration Points

### 1. SATD Instance Detection (SID)

**File**: `src/utils/debtScanner.ts`

**Function**: `llmClassification()`

**Process**:
1. Receives candidate comments from Stage 1 (lexical filtering)
2. Processes in batches of 10
3. Calls `classifySATD()` for each candidate
4. Applies confidence threshold (default: 0.7)
5. Only includes candidates with `confidence >= threshold`
6. Returns confirmed SATD instances

**Code Flow**:
```typescript
// Stage 1: Lexical filtering
const candidates = await lexicalFiltering(workspaceRoot);

// Stage 2: LLM classification
const satdInstances = await llmClassification(candidates, 0.7);
```

### 2. Commit-Aware Insight Generation (CAIG)

**File**: `src/utils/commitMonitor.ts` (likely)

**Process**:
1. Monitors new commits
2. For each SATD instance, calls `assessFixPotential()`
3. Determines if commit enables debt resolution
4. Generates insights and recommendations

### 3. Enhanced Debt Analysis

**File**: `src/utils/debtScanner.ts`

**Function**: `enhanceTechnicalDebtWithAI()`

**Process**:
1. Takes pre-filtered SATD items
2. Calls `classifySATD()` for validation
3. Calls `analyzeTechnicalDebtComment()` for descriptions
4. Returns enhanced items with confidence scores

## Configuration

### Environment Variables

```env
# Required for LLM functionality
OPENAI_API_KEY=your_api_key_here

# Optional: Model selection
OPENAI_MODEL_NAME=gpt-4o  # Options: gpt-4o, gpt-4, gpt-4-turbo, gpt-3.5-turbo

# Optional: Confidence threshold
SATD_CONFIDENCE_THRESHOLD=0.7  # 0.0 to 1.0
```

### Model Selection

| Model | Speed | Accuracy | Cost | Use Case |
|-------|-------|----------|------|----------|
| `gpt-4o` | Fast | Highest | Medium | **Recommended** - Best balance |
| `gpt-4` | Medium | High | High | High accuracy needed |
| `gpt-4-turbo` | Fast | High | Medium | Faster processing |
| `gpt-3.5-turbo` | Fastest | Good | Low | Large codebases, budget-conscious |

### Confidence Threshold

The confidence threshold (τ) determines which candidates are accepted:

- **τ = 0.7** (default): Balanced precision/recall
- **τ = 0.8-0.9**: Higher precision (fewer false positives)
- **τ = 0.5-0.6**: Higher recall (more candidates accepted)

## Error Handling

### Retry Logic

All LLM calls use exponential backoff retry:
- **Max Retries**: 3
- **Initial Delay**: 1 second
- **Backoff**: Exponential (1s, 2s, 4s)

### Rate Limiting

- **Between Requests**: 2 seconds
- **Between Batches**: 5 seconds (every 5 items)
- **Automatic**: Built into `batchClassifySATD()`

### Error Responses

When LLM calls fail:
- Returns `{ isSATD: false, confidence: 0, error: "error message" }`
- Logs error to console
- Continues processing other candidates
- Does not crash the entire analysis

## Performance Considerations

### Batch Processing

- Processes candidates in batches of 10
- Parallel processing within batches
- Sequential batches to respect rate limits

### Caching

Currently, no caching is implemented. Each comment is classified on every run.

### Cost Optimization

1. **Use `--quick` mode**: Skips LLM entirely (lexical only)
2. **Adjust threshold**: Higher threshold = fewer API calls
3. **Use GPT-3.5-turbo**: Lower cost for large codebases
4. **Filter first**: Lexical filtering reduces candidates before LLM

## Example Workflow

```typescript
// 1. Initialize OpenAI client
initializeOpenAICLI(apiKey, 'gpt-4o');

// 2. Stage 1: Lexical filtering (no LLM)
const candidates = await lexicalFiltering(workspaceRoot);
// Found 50 candidate comments

// 3. Stage 2: LLM classification
const satdInstances = await llmClassification(candidates, 0.7);
// LLM validates each candidate
// Only 35 pass the confidence threshold
// Result: 35 confirmed SATD instances

// 4. Enhanced descriptions (optional)
for (const instance of satdInstances) {
  instance.description = await analyzeTechnicalDebtComment(instance.content);
}
```

## Prompt Engineering

### Prompt 1: SATD Classification

**System Message**:
```
You are a code analysis assistant specialized in detecting Self-Admitted 
Technical Debt (SATD) in source code comments. SATD includes TODO comments, 
FIXME notes, hack acknowledgments, workaround descriptions, and any developer-
written text acknowledging suboptimal code quality or implementation shortcuts.
```

**User Prompt Template**:
```
Given the following code comment and its surrounding code context, determine 
whether this comment represents a developer's acknowledgment of suboptimal 
implementation, technical shortcuts, or known limitations that constitute SATD. 
Consider comments that express concerns about code quality, temporary solutions, 
known issues, or areas needing improvement. Respond with 'TRUE' if the comment 
indicates SATD, or 'FALSE' otherwise. Also provide a confidence score from 0 to 100.

Comment: {commentText}

Code Context:
{surroundingCode}

Respond in the following format only:
CLASSIFICATION: TRUE or FALSE
CONFIDENCE: <number from 0 to 100>
```

### Prompt 2: Fix Potential Assessment

**Purpose**: Determine if recent changes address technical debt

**Template**:
```
Technical Debt: "{satdComment}" at {filePath}:{lineNumber}. 
Recent Changes: {diffContent} in [{changedFiles}]. 
Assess if changes enable debt resolution: HIGH (directly addresses), 
PARTIAL (related opportunity), LOW (unrelated). 
Respond: HIGH, PARTIAL, or LOW.

Also provide a brief justification (1-2 sentences).
```

## Best Practices

1. **Start with Quick Mode**: Use `--quick` to get fast results without API costs
2. **Adjust Threshold**: Tune confidence threshold based on your needs
3. **Monitor Costs**: Track API usage, especially for large codebases
4. **Use Appropriate Model**: Balance speed, accuracy, and cost
5. **Handle Errors Gracefully**: The system continues even if some LLM calls fail

## Troubleshooting

### "OpenAI client is not initialized"

**Cause**: API key not set or initialization failed

**Solution**: 
- Set `OPENAI_API_KEY` environment variable
- Check API key is valid
- Verify network connectivity

### Rate Limiting (429 errors)

**Cause**: Too many requests too quickly

**Solution**:
- The system automatically retries with backoff
- Use batch processing (already implemented)
- Consider using `--quick` mode for initial scans

### Low Confidence Scores

**Cause**: Comments are ambiguous or not clearly SATD

**Solution**:
- Lower confidence threshold (e.g., 0.6)
- Review and improve comment quality
- Some comments may legitimately be false positives

## Future Enhancements

Potential improvements:
- **Caching**: Cache LLM results to reduce API calls
- **Streaming**: Stream responses for better UX
- **Custom Prompts**: Allow user-defined prompts
- **Multi-Model**: Support for other LLM providers (Claude, Gemini)
- **Fine-tuning**: Fine-tuned models for better accuracy

