---
name: paper-scout
description: Fetch trending LLM papers from AlphaXiv, let the user pick one, then produce a deep research-level analysis via the Gemini API. Trigger on: "paper scout", "find papers", "alphaxiv", "trending papers", "LLM papers", "find me a paper", "paper analysis".
---

# Paper Scout

Discover trending LLM papers on AlphaXiv and get a deep research-level analysis from Gemini.

## Prerequisites

`GEMINI_API_KEY` must be set in the environment. If missing, tell the user to add it to `.env`.

## Step 1 — Fetch Trending LLM Papers

Fetch ALL four URLs below in parallel — do not stop after the first one:

1. `https://www.alphaxiv.org/` — home page, usually shows trending/popular papers
2. `https://www.alphaxiv.org/arxiv-cs-LG` — ML papers by views
3. `https://www.alphaxiv.org/arxiv-cs-AI` — AI papers by views
4. `https://www.alphaxiv.org/arxiv-cs-CL` — NLP/LLM papers by views

For each fetch use the prompt: "List EVERY paper title visible on this page without truncating. For each paper include: arxiv ID (format: YYMM.NNNNN), authors, view/upvote counts, and a one-line description. List at least 10–20 papers if they are present."

Merge all results and deduplicate by arxiv ID. If the combined list has fewer than 10 LLM papers, also run:
```
WebSearch: site:alphaxiv.org LLM language model trending 2026
```

Filter results to keep only LLM-related papers. Keywords to match (case-insensitive): LLM, language model, transformer, GPT, fine-tuning, RLHF, SFT, instruction tuning, reasoning, alignment, agent, RAG, attention, pretraining, PEFT, LoRA, chain-of-thought, in-context learning, mixture of experts, MoE.

Present a numbered list of **exactly 10 papers** (or all if fewer than 10 found) in this format:
```
1. [Title]
   Authors: X, Y, Z | arxiv: 2501.12345
   [One-sentence summary]
```

End with: "Reply with a number (1–N) to get a deep analysis."

## Step 2 — Wait for User Selection

The user will reply with a number. Match it to the paper from your list.
Extract the arxiv ID (format: `YYMM.NNNNN` or `YYMM.NNNNN`).

## Step 3 — Fetch Paper Content

Fetch these two URLs and combine their content:

1. **AlphaXiv overview (primary — use this first):**
   - WebFetch `https://www.alphaxiv.org/overview/{arxiv_id}` with prompt: "Extract the complete text of every section on this page word for word: title, authors, abstract, introduction, methodology, experiments, results, ablations, conclusion, and any discussion sections. Do not summarize — reproduce as much text as possible."

2. **ArXiv abstract (for metadata):**
   - WebFetch `https://arxiv.org/abs/{arxiv_id}` with prompt: "Extract the full title, complete authors list, and abstract text."

3. **ArXiv HTML full text (fallback if AlphaXiv overview is too short < 800 chars):**
   - WebFetch `https://arxiv.org/html/{arxiv_id}` with prompt: "Extract the full paper text including all sections: introduction, related work, method, experiments, results, ablation, conclusion."

4. Combine into a single `PAPER_TEXT` block:
   ```
   Title: <title>
   Authors: <authors>
   ArXiv ID: <id>

   <alphaxiv overview content>

   <arxiv abstract>

   <arxiv html text if fetched>
   ```

## Step 4 — Call Gemini API

Write the prompt and paper to temp files to safely handle special characters, then call the API:

```bash
# Write paper content to temp file
cat > /tmp/paper_content.txt << 'PAPER_EOF'
<PAPER_TEXT>
PAPER_EOF

# Build the full prompt
cat > /tmp/gemini_prompt.txt << 'PROMPT_EOF'
You are a senior LLM researcher and ICML/NeurIPS reviewer.

Your task is to read the following paper carefully and explain it in a structured, research-level manner.

Do NOT summarize superficially. Instead, reconstruct the paper's logic and contribution as if preparing a deep research discussion.

Please organize your explanation into the following sections:

1. Research Motivation
   - What macro-level problem in LLM research does this paper address?
   - Why is this problem important now?
   - What gap in existing literature triggered this work?

2. Problem Formulation
   - What exact problem is being solved?
   - How is it formally defined?
   - What assumptions are made?

3. Prior Work and Limitations
   - What are the main previous approaches?
   - Where do they fall short?
   - What technical bottlenecks remain unresolved?

4. Core Contributions
   - What are the paper's key ideas?
   - What is genuinely novel vs incremental?
   - What is the central insight?

5. Methodology
   - Provide a step-by-step explanation of the method.
   - Include architecture, training strategy, objective functions, data pipeline, and inference scheme.
   - If relevant, explain algorithmic flow clearly.
   - Clarify how this differs mechanistically from prior work.

6. Experimental Design
   - What models are used?
   - What datasets are used?
   - What baselines are compared?
   - What evaluation metrics are reported?
   - Is the setup fair and controlled?

7. Results and Benchmark Analysis
   - What are the key numbers?
   - Where does it outperform and where does it not?
   - Are improvements statistically or practically meaningful?

8. Ablation and Mechanistic Analysis
   - What components are critical?
   - What design choices matter most?
   - Does the ablation truly validate the claims?

9. Limitations
   - What does the paper explicitly acknowledge?
   - What weaknesses are not discussed but evident?

10. Future Directions
    - What natural extensions follow?
    - How could this work be scaled or generalized?
    - What open research questions remain?

11. Reviewer-Style Evaluation
    - Strengths
    - Weaknesses
    - Novelty (1–10)
    - Technical depth (1–10)
    - Empirical rigor (1–10)
    - Acceptance likelihood at ICML/NeurIPS

Be precise, technical, and analytical. Avoid marketing language. Focus on reasoning and evidence.

---

PAPER:
PROMPT_EOF

# Append paper content
cat /tmp/paper_content.txt >> /tmp/gemini_prompt.txt

# Build JSON payload using jq
jq -n --rawfile text /tmp/gemini_prompt.txt \
  '{contents:[{parts:[{text:$text}]}],generationConfig:{maxOutputTokens:8192,temperature:0.3}}' \
  > /tmp/gemini_request.json

# Call Gemini API
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/gemini_request.json \
  > /tmp/gemini_response.json

# Extract the response text
jq -r '.candidates[0].content.parts[0].text // .error.message // "No response returned"' /tmp/gemini_response.json
```

## Step 5 — Return Analysis

Send the full Gemini response to the user.

If the response is longer than 4000 characters, send it in chunks — Telegram has a 4096-character message limit and NanoClaw splits automatically, but add a brief header like "**Analysis (part N/M):**" if splitting manually.

If the API returns an error (e.g. model not found, quota exceeded), report the full error message clearly so the user can diagnose it.

## Error Handling

| Problem | Action |
|---------|--------|
| AlphaXiv unreachable | Fall back to `WebSearch: site:alphaxiv.org trending LLM 2025` |
| arxiv HTML missing | Use abstract only, note the limitation |
| `GEMINI_API_KEY` not set | Tell user to add it to `.env` and `data/env/env`, then restart |
| Gemini API error | Show raw error; common causes: wrong model name, quota exceeded, invalid key |
| `jq` not found | Install with `apt-get install -y jq` then retry |
