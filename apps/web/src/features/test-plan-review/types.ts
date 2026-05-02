export interface TestPlanClarification {
  id: string;
  question: string;
  required: boolean;
  reason?: string;
}

export interface TestPlanClarificationAnswer {
  id: string;
  answer: string;
}

export interface TestPlanReviewModel {
  planMarkdown: string;
  clarifications: TestPlanClarification[];
  warnings?: string[];
}
