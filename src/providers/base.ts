import * as vscode from 'vscode';
import type { ProviderConfig } from '../types';

export abstract class BaseProvider
  implements vscode.LanguageModelChatProvider
{
  protected config: ProviderConfig;
  protected context: vscode.ExtensionContext;

  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    this.config = config;
    this.context = context;
  }

  abstract provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]>;

  abstract provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void>;

  abstract provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number>;

  protected async getApiKey(): Promise<string> {
    if (this.config.apiKeySecretKey) {
      const key = await this.context.secrets.get(this.config.apiKeySecretKey);
      return key ?? '';
    }
    return '';
  }

  protected async getApiKeyFromConfiguration(): Promise<string> {
    return '';
  }

  protected createErrorMessage(
    operation: string,
    error: unknown
  ): string {
    if (error instanceof Error) {
      return `${operation}: ${error.message}`;
    }
    return operation;
  }

  protected createLmError(message: string, _code: string): vscode.LanguageModelError {
    // @ts-expect-error - VS Code API değişkenlik gösterebilir
    return new vscode.LanguageModelError(message, '');
  }

  protected extractTextContent(message: vscode.LanguageModelChatRequestMessage): string {
    return message.content
      .filter((part): part is vscode.LanguageModelTextPart =>
        part instanceof vscode.LanguageModelTextPart
      )
      .map((part) => part.value)
      .join('');
  }
}