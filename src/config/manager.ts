import * as vscode from 'vscode';
import type { ProviderConfig } from '../types';

const PROVIDERS_KEY = 'copilot-byok.providers';

export class ConfigManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async loadProviders(): Promise<ProviderConfig[]> {
    return this.context.workspaceState.get<ProviderConfig[]>(PROVIDERS_KEY) ?? [];
  }

  async saveProvider(provider: ProviderConfig): Promise<void> {
    const providers = await this.loadProviders();
    const index = providers.findIndex((p) => p.name === provider.name);
    if (index >= 0) {
      providers[index] = provider;
    } else {
      providers.push(provider);
    }
    await this.context.workspaceState.update(PROVIDERS_KEY, providers);
  }

  async deleteProvider(providerName: string): Promise<void> {
    const providers = await this.loadProviders();
    await this.context.workspaceState.update(PROVIDERS_KEY, providers.filter((p) => p.name !== providerName));
  }
}
