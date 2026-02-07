/** Extract values set via `document.formName.field.value='...'` in script tags */
export function extractScriptValues(
  html: string,
  formName: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const re = new RegExp(
    `document\\.${formName}\\.(\\w+)\\.value\\s*=\\s*'([^']*)'`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    result[m[1]] = m[2];
  }
  return result;
}
