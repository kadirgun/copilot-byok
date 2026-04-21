import type { LanguageModelResponsePart } from "vscode";

export const languageModelUsagePart = (promptTokens: number, completionTokens: number) => {
  return { kind: "usage", promptTokens, completionTokens } as unknown as LanguageModelResponsePart;
};
