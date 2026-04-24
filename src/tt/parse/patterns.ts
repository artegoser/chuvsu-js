export const LESSON_TYPE_PATTERN = "лк|пр|лб|зач|экз|конс";
export const FLEXIBLE_LESSON_TYPE_PATTERN =
  `${LESSON_TYPE_PATTERN}\\.?|Экз`;

export const LESSON_TYPE_RE = new RegExp(`\\((${LESSON_TYPE_PATTERN})\\)`);
export const LESSON_TYPE_RE_I = new RegExp(
  `\\((${LESSON_TYPE_PATTERN})\\)`,
  "i",
);
export const FLEXIBLE_LESSON_TYPE_RE_I = new RegExp(
  `\\((${FLEXIBLE_LESSON_TYPE_PATTERN})\\)`,
  "i",
);
export const LESSON_TYPE_GLOBAL_RE = new RegExp(
  `\\((${LESSON_TYPE_PATTERN})\\)`,
  "g",
);

export const WEEKS_RE = /\(([^)]*нед\.?[^)]*)\)/;
export const WEEKS_GLOBAL_RE = /\([^)]*нед\.?[^)]*\)/g;

export const SUBGROUP_RE = /(\d+)\s*подгруппа/;
export const SUBGROUP_ANNOTATION_RE = /\(\d+\s*подгруппа\)/g;
export const SUBGROUP_ANNOTATION_RE_I = /\s*\(\s*\d+\s*подгруппа\s*\)\s*/gi;
