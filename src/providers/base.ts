import * as vscode from "vscode";
import { type ProviderConfig } from "../types";

export abstract class BaseProvider implements vscode.LanguageModelChatProvider {
  protected config: ProviderConfig;
  protected context: vscode.ExtensionContext;

  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    this.config = config;
    this.context = context;
  }

  getConfig(): ProviderConfig {
    return this.config;
  }

  setConfig(config: ProviderConfig): void {
    this.config = config;
  }

  abstract provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]>;

  abstract provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void>;

  abstract provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Promise<number>;

  protected async getApiKey(): Promise<string | undefined> {
    if (this.config.apiKeySecretKey) {
      const key = await this.context.secrets.get(this.config.apiKeySecretKey);
      return key || undefined;
    }
    return undefined;
  }

  protected createErrorMessage(operation: string, error: unknown): string {
    if (error instanceof Error) {
      return `${operation}: ${error.message}`;
    }
    return operation;
  }

  protected createLmError(message: string, _code: string): vscode.LanguageModelError {
    // @ts-expect-error - VS Code API değişkenlik gösterebilir
    return new vscode.LanguageModelError(message, "");
  }

  protected extractTextContent(message: vscode.LanguageModelChatRequestMessage): string {
    return message.content
      .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
      .map((part) => part.value)
      .join("");
  }

  protected extractTextAndToolParts(message: vscode.LanguageModelChatRequestMessage): {
    text: string;
    toolCalls: vscode.LanguageModelToolCallPart[];
    toolResults: vscode.LanguageModelToolResultPart[];
  } {
    const textParts: string[] = [];
    const toolCalls: vscode.LanguageModelToolCallPart[] = [];
    const toolResults: vscode.LanguageModelToolResultPart[] = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push(part);
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push(part);
      }
    }

    return {
      text: textParts.join(""),
      toolCalls,
      toolResults,
    };
  }

  protected getRole(role: vscode.LanguageModelChatMessageRole): "user" | "assistant" {
    switch (role) {
      case vscode.LanguageModelChatMessageRole.Assistant:
        return "assistant";
      case vscode.LanguageModelChatMessageRole.User:
        return "user";
    }
  }
}
