import { GoogleGenAI, Type } from "@google/genai";
import { Rubric, EvaluationResult, GroundingResult, CodeAnalysis } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to wrap text/image/pdf for the API
const filePart = (base64Data: string, mimeType: string) => ({
  inlineData: {
    data: base64Data,
    mimeType: mimeType,
  },
});

// Helper to clean JSON output (strip markdown and locate JSON object)
const cleanJson = (text: string) => {
  // Remove markdown code block syntax if present
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "");
  
  // Locate the first '{' and the last '}' to handle potential preamble/postamble
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  
  // CRITICAL FIX: Truncate excessively long floating point numbers BEFORE parsing
  // This handles cases like 5.0000000000000000000018 which break JSON.parse in some envs
  // Regex finds: digit(s) . 6 digits (capture) then more digits (discard)
  cleaned = cleaned.replace(/(\d+\.\d{6})\d+/g, '$1');

  // CRITICAL FIX: Handle scientific notation with long mantissa that might have slipped through
  // e.g. 5.0000000000000018e+00 -> 5.00
  cleaned = cleaned.replace(/(\d+\.\d+)[eE][+-]?\d+/g, (match, numberPart) => {
     const dotIndex = numberPart.indexOf('.');
     if (dotIndex !== -1) {
         return numberPart.substring(0, dotIndex + 3); // Keep 2 decimal places
     }
     return numberPart;
  });
  
  return cleaned.trim();
};

// JSON Reviver to ensure all numbers are rounded to 2 decimal places during parsing
const jsonReviver = (key: string, value: any) => {
  if (typeof value === 'number') {
    return Math.round(value * 100) / 100;
  }
  return value;
};

/**
 * Generate a structured rubric from natural language using Gemini 3 Pro (High Reasoning)
 */
export const generateRubricFromText = async (
  description: string,
  assignmentContext?: { text: string; fileData?: string; mimeType?: string }
): Promise<Rubric> => {
  const parts: any[] = [{ text: `Create a structured evaluation rubric based on the following description. 
  The output must be a JSON object with a 'criteria' array. 
  Each criterion has: name, description, weight (0-1), max_score, good_performance, poor_performance.
  Ensure all numerical values are standard JSON numbers (no long floats).
  
  Rubric Description: ${description}` }];

  if (assignmentContext?.text) {
    parts.push({ text: `Assignment Context: ${assignmentContext.text}` });
  }
  if (assignmentContext?.fileData && assignmentContext?.mimeType) {
    parts.push(filePart(assignmentContext.fileData, assignmentContext.mimeType));
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                max_score: { type: Type.NUMBER },
                good_performance: { type: Type.STRING },
                poor_performance: { type: Type.STRING },
              },
              required: ["name", "weight", "max_score", "good_performance"]
            }
          }
        }
      }
    }
  });

  if (!response.text) throw new Error("No response from Gemini");

  try {
    const cleaned = cleanJson(response.text);
    return JSON.parse(cleaned, jsonReviver) as Rubric;
  } catch (e) {
    console.error("Failed to parse Rubric JSON", e);
    console.debug("Raw Rubric Response:", response.text);
    throw new Error("Failed to parse rubric structure. Please try again.");
  }
};

/**
 * Evaluate a single student submission against the rubric and assignment
 */
export const evaluateSubmission = async (
  submissionBase64: string,
  submissionMime: string,
  assignment: { text: string; fileData?: string; mimeType?: string },
  rubric: Rubric
): Promise<EvaluationResult> => {
  const parts: any[] = [];

  // System context / Task
  parts.push({
    text: `You are a strict university professor. Evaluate this student submission.
    
    Rubric:
    ${JSON.stringify(rubric)}
    
    Assignment Question:
    ${assignment.text}

    Important: 
    1. Also extract any external URLs (e.g., GitHub, Colab, Google Drive) mentioned in the submission text or footnotes.
    2. Output scores as standard numbers with maximum 2 decimal places (e.g., 8.5 or 9.25). Do NOT use excessive precision.
    `
  });

  // Attach Assignment PDF if exists
  if (assignment.fileData && assignment.mimeType) {
    parts.push({ text: "Assignment Reference Document:" });
    parts.push(filePart(assignment.fileData, assignment.mimeType));
  }

  // Attach Student Submission
  parts.push({ text: "Student Submission to Evaluate:" });
  parts.push(filePart(submissionBase64, submissionMime));

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview', // High reasoning for grading
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      // Thinking budget for deep analysis of the PDF content.
      // 4096 thinking tokens, leaving remainder of maxOutputTokens for the JSON.
      thinkingConfig: { thinkingBudget: 4096 }, 
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          student_id: { type: Type.STRING },
          criteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                score: { type: Type.NUMBER },
                max_score: { type: Type.NUMBER },
                comment: { type: Type.STRING }
              }
            }
          },
          final_score: { type: Type.NUMBER },
          overall_feedback: { type: Type.STRING },
          missing_concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
          external_links: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of all valid URLs found in the submission document" }
        }
      }
    }
  });

  if (!response.text) throw new Error("No evaluation generated");

  try {
    const cleaned = cleanJson(response.text);
    return JSON.parse(cleaned, jsonReviver) as EvaluationResult;
  } catch (e) {
    console.error("Failed to parse Evaluation JSON", e);
    console.debug("Raw Evaluation Response:", response.text);
    throw new Error("Failed to parse evaluation result. The model may have been interrupted or produced invalid JSON.");
  }
};

/**
 * Helper to fetch raw content from GitHub if possible (Handling CORS via raw.githubusercontent.com)
 */
const fetchGithubContent = async (url: string): Promise<string> => {
  try {
    // Attempt to convert github.com blob URL to raw.githubusercontent.com
    // Format: https://github.com/user/repo/blob/branch/path -> https://raw.githubusercontent.com/user/repo/branch/path
    let rawUrl = url;
    let isGithub = url.includes("github.com");
    
    if (isGithub && url.includes("/blob/")) {
      rawUrl = url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
    } else if (isGithub && !url.includes("/blob/") && !url.includes("/tree/")) {
       // Root URL provided, try to find a README
       // This is a guess, but often works for public repos
       rawUrl = url.replace("github.com", "raw.githubusercontent.com") + "/main/README.md";
       // Fallback to master if main fails? - we'll let Gemini handle the error content or we catch it.
    }

    const res = await fetch(rawUrl);
    if (!res.ok) return "";
    return await res.text();
  } catch (e) {
    console.warn("Could not fetch raw GitHub content (CORS or Private):", e);
    return "";
  }
};

/**
 * Deep analyze a code repository
 */
export const analyzeCodeRepository = async (
  repoUrl: string,
  rubric: Rubric
): Promise<CodeAnalysis> => {
  // 1. Attempt to fetch context (README or File content)
  const fetchedContext = await fetchGithubContent(repoUrl);
  
  // 2. Build Prompt
  const prompt = `
    Analyze the code repository at: ${repoUrl}
    
    Context retrieved from direct link (if empty, rely on Google Search):
    ${fetchedContext.slice(0, 5000)}... (truncated if too long)
    
    Task:
    1. "Visit" the repository using the Google Search tool to understand the file structure, find the README, and check implementation details.
    2. Explore back to the root if a specific file was linked, to understand the overall architecture.
    3. Verify if the code correctly implements the assignment requirements defined in the Rubric below.
    4. Provide EVIDENCE. Cite specific file names and line number ranges where the implementation is found or missing.
    5. Output all scores as numbers with maximum 2 decimal places.
    
    Rubric:
    ${JSON.stringify(rubric)}
  `;

  // 3. Call Gemini with Search Tool
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            repo_url: { type: Type.STRING },
            summary: { type: Type.STRING },
            implementation_score: { type: Type.NUMBER, description: "Score out of 10 based on code quality and correctness" },
            max_score: { type: Type.NUMBER, description: "Should be 10" },
            evidence: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  file: { type: Type.STRING },
                  line_numbers: { type: Type.STRING },
                  snippet: { type: Type.STRING, description: "Short relevant code snippet" },
                  comment: { type: Type.STRING }
                }
              }
            },
            status: { type: Type.STRING, enum: ["success", "failed"] }
          }
        }
      }
    });

    if (!response.text) throw new Error("No code analysis response");
    const cleaned = cleanJson(response.text);
    return JSON.parse(cleaned, jsonReviver) as CodeAnalysis;

  } catch (e) {
    console.error("Code Analysis Failed", e);
    return {
      repo_url: repoUrl,
      summary: "Failed to analyze repository due to access restrictions or model error.",
      implementation_score: 0,
      max_score: 10,
      evidence: [],
      status: 'failed',
      error_message: e instanceof Error ? e.message : "Unknown error"
    };
  }
};

/**
 * Transcribe Audio Notes using Gemini 2.5 Flash
 */
export const transcribeAudioNote = async (audioBase64: string, mimeType: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { text: "Transcribe this audio note accurately. Clean up filler words like 'um' or 'ah'." },
        filePart(audioBase64, mimeType)
      ]
    }
  });
  return response.text || "";
};

/**
 * Fact Check using Google Search Grounding
 */
export const checkFacts = async (query: string): Promise<GroundingResult> => {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Fact check this statement or answer this question: ${query}`,
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  // Defensive check: ensure groundingChunks is an array before mapping
  const sources = Array.isArray(groundingChunks) 
    ? groundingChunks.map((c: any) => ({
        uri: c.web?.uri || "",
        title: c.web?.title || "Source"
      })).filter((s: any) => s.uri)
    : [];

  return {
    query,
    sources,
    text: response.text || "No information found."
  };
};
