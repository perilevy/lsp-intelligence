import type { QueryIR, SearchRecipe } from '../types.js';

export interface SearchAdapter {
  id: string;
  detect(ir: QueryIR): SearchRecipe[];
}
