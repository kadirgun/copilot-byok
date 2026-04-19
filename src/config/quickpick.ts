import * as vscode from "vscode";
import type { ProviderConfig } from "../types";

export class QuickPickManager {
  private context: vscode.ExtensionContext;
  private configManager: {
    loadProviders: () => Promise<ProviderConfig[]>;
    saveProvider: (provider: ProviderConfig) => Promise<void>;
    deleteProvider: (providerId: string) => Promise<void>;
  };

  constructor(
    context: vscode.ExtensionContext,
    configManager: {
      loadProviders: () => Promise<ProviderConfig[]>;
      saveProvider: (provider: ProviderConfig) => Promise<void>;
      deleteProvider: (providerId: string) => Promise<void>;
    },
  ) {
    this.context = context;
    this.configManager = configManager;
  }

  async showAddProvider(): Promise<string | undefined> {
    const type = await vscode.window.showQuickPick(
      [
        { label: "OpenAI", value: "openai" },
        { label: "Anthropic", value: "anthropic" },
      ],
      { placeHolder: "Select provider type" },
    );

    if (!type) return undefined;

    const name = await vscode.window.showInputBox({
      placeHolder: "Provider name",
      prompt: "Enter a name for this provider",
      validateInput: (value) => (value.trim() ? null : "Name is required"),
      ignoreFocusOut: true,
    });

    if (!name) return undefined;

    const apiKey = await vscode.window.showInputBox({
      placeHolder: "sk-...",
      prompt: "Enter API key",
      ignoreFocusOut: true,
    });

    const baseURL = await vscode.window.showInputBox({
      placeHolder: "https://api.openai.com/v1 (leave empty for default)",
      prompt: "Enter custom base URL (optional)",
      ignoreFocusOut: true,
    });

    const providerId = `provider-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const secretKey = `copilot-byok-${providerId}-apikey`;

    if (apiKey) {
      await this.context.secrets.store(secretKey, apiKey);
    }

    const provider: ProviderConfig = {
      id: providerId,
      name,
      type: type.value as "openai" | "anthropic",
      baseURL: baseURL || undefined,
      apiKeySecretKey: secretKey,
      models: [],
      enabled: true,
    };

    await this.configManager.saveProvider(provider);
    vscode.window.showInformationMessage(`Provider "${name}" added.`);
    return name;
  }

  async showEditProvider(): Promise<void> {
    const providers = await this.configManager.loadProviders();

    if (providers.length === 0) {
      vscode.window.showInformationMessage('No providers configured. Run "Add Provider" command.');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      providers.map((p) => ({
        label: `${p.name} (${p.type})`,
        provider: p,
        description: p.enabled ? "Enabled" : "Disabled",
      })),
      { placeHolder: "Select provider to edit" },
    );

    if (!selected) return;

    const provider = selected.provider;

    const name = await vscode.window.showInputBox({
      value: provider.name,
      placeHolder: "Provider name",
      prompt: "Edit provider name",
      ignoreFocusOut: true,
    });

    if (name === undefined) return;

    const apiKeyAction = await vscode.window.showQuickPick(
      [
        { label: "Keep current API key", value: "keep" },
        { label: "Update API key", value: "update" },
        { label: "Delete API key", value: "delete" },
      ],
      { placeHolder: "Select API key action" },
    );

    if (!apiKeyAction) return;

    let newApiKey: string | undefined;
    if (apiKeyAction.value === "update") {
      newApiKey = await vscode.window.showInputBox({
        placeHolder: "sk-...",
        prompt: "Enter new API key",
        ignoreFocusOut: true,
      });
      if (!newApiKey) return;
    }

    const baseURL = await vscode.window.showInputBox({
      value: provider.baseURL || "",
      placeHolder: "Leave empty for default",
      prompt: "Edit base URL (optional)",
      ignoreFocusOut: true,
    });

    const enabled = await vscode.window.showQuickPick(
      [
        { label: "Enabled", value: true },
        { label: "Disabled", value: false },
      ],
      { placeHolder: "Enable/disable provider" },
    );

    if (!enabled) return;

    if (apiKeyAction.value === "delete") {
      if (provider.apiKeySecretKey) {
        await this.context.secrets.delete(provider.apiKeySecretKey);
      }
    } else if (apiKeyAction.value === "update" && newApiKey) {
      if (provider.apiKeySecretKey) {
        await this.context.secrets.store(provider.apiKeySecretKey, newApiKey);
      }
    }

    const updatedProvider: ProviderConfig = {
      ...provider,
      name: name || provider.name,
      baseURL: baseURL || provider.baseURL,
      enabled: enabled.value as boolean,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Provider "${name}" updated.`);
  }

  async showDeleteProvider(): Promise<string | undefined> {
    const providers = await this.configManager.loadProviders();

    if (providers.length === 0) {
      vscode.window.showInformationMessage("No providers configured.");
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      providers.map((p) => ({
        label: `${p.name} (${p.type})`,
        provider: p,
      })),
      { placeHolder: "Select provider to delete" },
    );

    if (!selected) return undefined;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${selected.provider.name}"?`,
      { modal: true },
      "Delete",
      "Cancel",
    );

    if (confirmed !== "Delete") return undefined;

    const deletedName = selected.provider.name;
    if (selected.provider.apiKeySecretKey) {
      await this.context.secrets.delete(selected.provider.apiKeySecretKey);
    }
    await this.configManager.deleteProvider(selected.provider.id);
    vscode.window.showInformationMessage(`Provider "${deletedName}" deleted.`);
    return deletedName;
  }

  async showAddModel(): Promise<void> {
    const providers = await this.configManager.loadProviders();

    if (providers.length === 0) {
      vscode.window.showInformationMessage('No providers configured. Run "Add Provider" first.');
      return;
    }

    const selectedProvider = await vscode.window.showQuickPick(
      providers.map((p) => ({
        label: `${p.name} (${p.type})`,
        provider: p,
      })),
      { placeHolder: "Select provider" },
    );

    if (!selectedProvider) return;

    const modelId = await vscode.window.showInputBox({
      placeHolder: "gpt-4o",
      prompt: "Enter model ID (e.g., gpt-4o)",
      validateInput: (value) => (value.trim() ? null : "Model ID is required"),
      ignoreFocusOut: true,
    });

    if (!modelId) return;

    const modelName = await vscode.window.showInputBox({
      placeHolder: modelId,
      prompt: "Enter model display name (optional)",
      ignoreFocusOut: true,
    });

    const provider = selectedProvider.provider;
    const existingModels = provider.models || [];
    const newModels = [...existingModels, modelId.trim()];

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: newModels,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model "${modelName || modelId}" added to "${provider.name}".`);
  }

  async showRemoveModel(): Promise<void> {
    const providers = await this.configManager.loadProviders();

    if (providers.length === 0) {
      vscode.window.showInformationMessage("No providers configured.");
      return;
    }

    const selectedProvider = await vscode.window.showQuickPick(
      providers.map((p) => ({
        label: `${p.name} (${p.type})`,
        provider: p,
      })),
      { placeHolder: "Select provider" },
    );

    if (!selectedProvider) return;

    const provider = selectedProvider.provider;

    if (!provider.models || provider.models.length === 0) {
      vscode.window.showInformationMessage("No models configured for this provider.");
      return;
    }

    const selectedModel = await vscode.window.showQuickPick(
      provider.models.map((m) => ({ label: m })),
      { placeHolder: "Select model to remove" },
    );

    if (!selectedModel) return;

    const newModels = provider.models.filter((m) => m !== selectedModel.label);

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: newModels,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model "${selectedModel.label}" removed.`);
  }
}
