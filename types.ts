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

export interface StudentSubmission {
  id: string;
  filename: string;
  fileData: string; // Base64
  mimeType: string;
  status: 'pending' | 'evaluating' | 'graded' | 'error';
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
