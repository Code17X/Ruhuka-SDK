const MIME_TOKEN_SPECIALS = "!#$%&'*+-.^_`|~";

function isMimeTokenCharacter(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    MIME_TOKEN_SPECIALS.includes(character)
  );
}

function isOptionalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const firstParameter = value.indexOf(";");
  const mediaType = (
    firstParameter < 0 ? value : value.slice(0, firstParameter)
  ).trim();
  if (mediaType.toLowerCase() !== "application/json") return false;
  if (firstParameter < 0) return true;

  let index = firstParameter;
  while (index < value.length) {
    if (value[index] !== ";") return false;
    index++;
    while (isOptionalWhitespace(value[index])) index++;

    const parameterStart = index;
    while (index < value.length && isMimeTokenCharacter(value[index]!)) index++;
    if (index === parameterStart) return false;
    while (isOptionalWhitespace(value[index])) index++;
    if (value[index] !== "=") return false;
    index++;
    while (isOptionalWhitespace(value[index])) index++;

    if (value[index] === '"') {
      index++;
      let closed = false;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (value[index] === '"') {
          index++;
          closed = true;
          break;
        }
        if (value[index] === "\\") {
          index++;
          if (index >= value.length) return false;
          const escapedCode = value.charCodeAt(index);
          if (escapedCode !== 9 && (escapedCode < 32 || escapedCode > 126)) {
            return false;
          }
          index++;
          continue;
        }
        if (
          code !== 9 &&
          code !== 32 &&
          code !== 33 &&
          !(code >= 35 && code <= 91) &&
          !(code >= 93 && code <= 126)
        ) {
          return false;
        }
        index++;
      }
      if (!closed) return false;
    } else {
      const parameterValueStart = index;
      while (index < value.length && isMimeTokenCharacter(value[index]!))
        index++;
      if (index === parameterValueStart) return false;
    }

    while (isOptionalWhitespace(value[index])) index++;
    if (index < value.length && value[index] !== ";") return false;
  }
  return true;
}
