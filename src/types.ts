export interface ReactionStep {
  step: number;
  startingMaterials: string[];
  products: string[];
  reagentsAndCatalysts?: string;
  conditions?: string;
  yield?: string;
  summary: string;
}

export interface ExtractionResponse {
  success: boolean;
  paperTitle?: string;
  reactions: ReactionStep[];
  rawSummary?: string;
  error?: string;
}
