/**
 * Phase 3B — Change recipe definitions.
 *
 * A recipe describes the *intent* of a change: what kind of modification
 * to apply to a symbol. The execution engine in applyVirtualEdit.ts turns
 * a recipe into modified source text. Simulation then rebuilds the semantic
 * state and reports the impact.
 *
 * First recipe (Phase 3B spike): add_required_param
 * Future recipes: remove_param, change_return_type, add_enum_member, remove_enum_member,
 *                 narrow_union, widen_union, move_export, rename_symbol
 */

export type RecipeKind =
  | 'add_required_param'
  | 'add_optional_param'
  | 'remove_param'
  | 'change_return_type'
  | 'add_enum_member'
  | 'remove_enum_member'
  | 'rename_symbol'
  | 'narrow_union'
  | 'widen_union';

export interface AddParamRecipe {
  kind: 'add_required_param' | 'add_optional_param';
  funcName: string;
  filePath: string;
  paramName: string;
  paramType: string;
}

export interface RemoveParamRecipe {
  kind: 'remove_param';
  funcName: string;
  filePath: string;
  paramName: string;
}

export interface ChangeReturnTypeRecipe {
  kind: 'change_return_type';
  funcName: string;
  filePath: string;
  newReturnType: string;
}

export interface AddEnumMemberRecipe {
  kind: 'add_enum_member';
  enumName: string;
  filePath: string;
  memberName: string;
  memberValue?: string;
}

export interface RemoveEnumMemberRecipe {
  kind: 'remove_enum_member';
  enumName: string;
  filePath: string;
  memberName: string;
}

export interface RenameSymbolRecipe {
  kind: 'rename_symbol';
  symbolName: string;
  filePath: string;
  newName: string;
}

export type ChangeRecipe =
  | AddParamRecipe
  | RemoveParamRecipe
  | ChangeReturnTypeRecipe
  | AddEnumMemberRecipe
  | RemoveEnumMemberRecipe
  | RenameSymbolRecipe;
