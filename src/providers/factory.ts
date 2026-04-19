import * as vscode from 'vscode';
import type { ProviderConfig } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

export function createProvider(
  config: ProviderConfig,
  context: vscode.ExtensionContext
): vscode.LanguageModelChatProvider {
  switch (config.type) {
    case 'openai':
      return new OpenAIProvider(config, context);
    case 'anthropic':
      return new AnthropicProvider(config, context);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
