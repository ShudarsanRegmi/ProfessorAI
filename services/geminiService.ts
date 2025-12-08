import { GoogleGenAI, Type } from "@google/genai";
import { Rubric, EvaluationResult, GroundingResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to wrap text/image/pdf for the API
const filePart = (base64Data: string, mimeType: string) => ({
  inlineData: {
    data: base64Data,
    mimeType: mimeType,
  },
});

// Helper to clean JSON output (strip markdown)
const cleanJson = (text: string) => {
  return text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
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
  return JSON.parse(cleanJson(response.text)) as Rubric;
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
      // Thinking budget for deep analysis of the PDF content
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
          missing_concepts: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }
    }
  });

  if (!response.text) throw new Error("No evaluation generated");
  return JSON.parse(cleanJson(response.text)) as EvaluationResult;
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

  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  const sources = groundingChunks?.map((c: any) => ({
    uri: c.web?.uri || "",
    title: c.web?.title || "Source"
  })).filter((s: any) => s.uri) || [];

  return {
    query,
    sources,
    text: response.text || "No information found."
  };
};