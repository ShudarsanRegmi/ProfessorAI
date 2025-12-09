export interface RubricCriterion {
  name: string;
  description: string;
  weight: number;
  max_score: number;
  good_performance: string;
  poor_performance: string;
}

export interface Rubric {
  criteria: RubricCriterion[];
}

export interface CodeEvidence {
  file: string;
  line_numbers: string;
  snippet: string;
  comment: string;
}

export interface CodeAnalysis {
  repo_url: string;
  summary: string;
  implementation_score: number; // 0-10 or scaled
  max_score: number;
  evidence: CodeEvidence[];
  status: 'success' | 'failed';
  error_message?: string;
}

export interface StudentSubmission {
  id: string;
  filename: string;
  fileData: string; // Base64
  mimeType: string;
  status: 'pending' | 'evaluating' | 'analyzing_code' | 'graded' | 'error';
  evaluation?: EvaluationResult;
}

export interface EvaluationResult {
  student_id: string;
  criteria: {
    name: string;
    score: number;
    max_score: number;
    comment: string;
  }[];
  final_score: number;
  overall_feedback: string;
  missing_concepts?: string[];
  external_links?: string[];
  code_analysis?: CodeAnalysis;
}

export interface AssignmentState {
  title: string;
  questionText: string;
  questionFile: string | null; // Base64
  questionMimeType: string | null;
  rubricText: string;
  structuredRubric: Rubric | null;
}

export interface GroundingResult {
  query: string;
  sources: { uri: string; title: string }[];
  text: string;
}