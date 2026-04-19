import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import type { ProviderConfig } from '../types';
import { BaseProvider } from './base';

export class AnthropicProvider extends BaseProvider {
  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    super(config, context);
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return [];
    }

    return this.config.models.map((modelId) => ({
      id: modelId,
      name: modelId,
      family: modelId,
      version: '1.0.0',
      maxInputTokens: 200000,
      maxOutputTokens: 8192,
      capabilities: {
        imageInput: true,
        toolCalling: true,
      },
    }));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('API key not configured');
    }

    const client = new Anthropic({
      apiKey,
      baseURL: this.config.baseURL ?? 'https://api.anthropic.com',
    });

    const stream = await client.messages.stream({
        model: model.id,
      max_tokens: 8192,
      messages: messages.map((message) => ({
        role: String(message.role) === 'user' ? 'user' : 'assistant',
        content: message.content
          .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
          .map((part) => part.value)
          .join(''),
      })) as Anthropic.MessageParam[],
    });

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const content = typeof text === 'string' ? text : text.content
      .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
      .map((part) => part.value)
      .join('');
    return Math.ceil(content.length / 4);
  }
}
