import kebabCase from "lodash.kebabcase";
import * as vscode from "vscode";
import type { ModelConfig, ProviderConfig } from "../types";
import type { ConfigManager } from "./manager";

export class QuickPickManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configManager: ConfigManager,
  ) {}

  private async selectProvider(): Promise<ProviderConfig | undefined> {
    const providers = await this.configManager.loadProviders();
    if (providers.length === 0) {
      vscode.window.showInformationMessage('No providers configured. Run "Add Provider" first.');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      providers.map((p) => ({
        label: `${p.name} (${p.type})`,
        provider: p,
      })),
      { placeHolder: "Select provider" },
    );
    return selected?.provider;
  }

  private async promptApiKey() {
    const apiKey = await vscode.window.showInputBox({
      placeHolder: "sk-...",
      prompt: "Enter API key",
      ignoreFocusOut: true,
    });

    return apiKey;
  }

  private async promptBaseURL() {
    const baseURL = await vscode.window.showInputBox({
      placeHolder: "https://api.example.com",
      prompt: "Enter custom base URL",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return null;
        }

        try {
          new URL(value.trim());
          return null;
        } catch {
          return "Please enter a valid URL";
        }
      },
    });

    return baseURL;
  }

  private async collectModelDetails(
    provider: ProviderConfig,
    existingModel?: ModelConfig,
  ): Promise<ModelConfig | undefined> {
    const modelId = await vscode.window.showInputBox({
      value: existingModel?.id ?? "",
      placeHolder: "gpt-4o",
      prompt: "Enter model ID (e.g., gpt-4o)",
      validateInput: (value) => {
        if (!value.trim()) {
          return "Model ID is required";
        }
        if (provider.models.some((m) => m.id === value.trim() && m !== existingModel)) {
          return "Model ID must be unique within the provider";
        }
        return null;
      },
      ignoreFocusOut: true,
    });

    if (!modelId) {
      return;
    }

    const modelName = await vscode.window.showInputBox({
      value: existingModel?.name ?? modelId,
      placeHolder: "Model display name",
      prompt: "Enter model display name (optional)",
      ignoreFocusOut: true,
    });

    if (modelName === undefined) {
      return;
    }

    const maxInputTokens = await vscode.window.showInputBox({
      value: existingModel?.maxInputTokens ? String(existingModel.maxInputTokens) : "8192",
      title: "Max Input Tokens",
      placeHolder: "e.g., 8192",
      prompt: "Enter max input tokens (optional)",
      validateInput: (value) => {
        if (!value.trim()) {
          return null;
        }
        if (isNaN(Number(value.trim())) || Number(value.trim()) <= 0) {
          return "Please enter a valid positive number";
        }
        return null;
      },
      ignoreFocusOut: true,
    });

    if (maxInputTokens === undefined) {
      return;
    }

    const maxOutputTokens = await vscode.window.showInputBox({
      value: existingModel?.maxOutputTokens ? String(existingModel.maxOutputTokens) : "2048",
      title: "Max Output Tokens",
      placeHolder: "e.g., 2048",
      prompt: "Enter max output tokens (optional)",
      validateInput: (value) => {
        if (!value.trim()) {
          return null;
        }
        if (isNaN(Number(value.trim())) || Number(value.trim()) <= 0) {
          return "Please enter a valid positive number";
        }
        return null;
      },
      ignoreFocusOut: true,
    });

    if (maxOutputTokens === undefined) {
      return;
    }

    const capabilities = await vscode.window.showQuickPick<{ label: string; value: string; picked: boolean }>(
      [
        {
          label: "Supports Image Input",
          value: "imageInput" as const,
          picked: existingModel?.capabilities?.imageInput ?? false,
        },
        {
          label: "Supports Tool Calling",
          value: "toolCalling" as const,
          picked: !!existingModel?.capabilities?.toolCalling || false,
        },
        {
          label: "Supports Thinking",
          value: "thinking" as const,
          picked: existingModel?.capabilities?.thinking ?? false,
        },
      ],
      {
        placeHolder: "Select model capabilities (optional)",
        canPickMany: true,
        ignoreFocusOut: true,
        title: "Model Capabilities",
        prompt: "Select model capabilities (optional)",
      },
    );

    return {
      id: modelId.trim(),
      name: modelName?.trim() || modelId.trim(),
      maxInputTokens: maxInputTokens ? Number(maxInputTokens.trim()) : (existingModel?.maxInputTokens ?? 8192),
      maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens.trim()) : (existingModel?.maxOutputTokens ?? 2048),
      capabilities: {
        imageInput:
          capabilities?.some((c) => c.value === "imageInput") ?? existingModel?.capabilities?.imageInput ?? false,
        toolCalling:
          capabilities?.some((c) => c.value === "toolCalling") ?? existingModel?.capabilities?.toolCalling ?? false,
        thinking:
          capabilities?.some((c) => c.value === "thinking") ?? existingModel?.capabilities?.thinking ?? false,
      },
    };
  }

  async showAddProvider(): Promise<string | undefined> {
    const type = await vscode.window.showQuickPick<{ label: string; value: string }>(
      [
        { label: "OpenAI", value: "openai" },
        { label: "Anthropic", value: "anthropic" },
      ],
      { placeHolder: "Select provider type" },
    );

    if (!type) {
      return;
    }

    const providers = await this.configManager.loadProviders();

    const name = await vscode.window.showInputBox({
      placeHolder: "Provider name",
      prompt: "Enter a name for this provider",
      validateInput: (value) => {
        if (!value.trim()) {
          return "Provider name is required";
        } else if (providers.some((p) => p.name === value.trim())) {
          return "Provider name must be unique";
        }
        return null;
      },
      ignoreFocusOut: true,
    });

    if (!name) {
      return;
    }

    const baseURL = await this.promptBaseURL();

    if (!baseURL) {
      return;
    }

    const apiKey = await this.promptApiKey();

    const providerId = `provider-${kebabCase(name)}`;
    const secretKey = `copilot-byok-${providerId}-apikey`;

    if (apiKey) {
      await this.context.secrets.store(secretKey, apiKey);
    }

    const provider: ProviderConfig = {
      id: providerId,
      name: name,
      type: type.value as "openai" | "anthropic",
      baseURL: baseURL,
      apiKeySecretKey: secretKey,
      models: [],
    };

    await this.configManager.saveProvider(provider);
    vscode.window.showInformationMessage(`Provider "${name}" added.`);
    return name;
  }

  async showEditProvider(): Promise<void> {
    const existingProvider = await this.selectProvider();
    if (!existingProvider) {
      return;
    }

    const apiKeyAction = await vscode.window.showQuickPick(
      [
        { label: "Keep current API key", value: "keep" as const },
        { label: "Update API key", value: "update" as const },
        { label: "Delete API key", value: "delete" as const },
      ],
      { placeHolder: "Select API key action" },
    );

    if (!apiKeyAction) {
      return;
    }

    const baseURL = await vscode.window.showInputBox({
      value: existingProvider.baseURL || "",
      placeHolder: "Leave empty for default",
      prompt: "Edit base URL (optional)",
      ignoreFocusOut: true,
    });

    if (baseURL === undefined) {
      return;
    }

    if (apiKeyAction.value === "delete") {
      await this.context.secrets.delete(existingProvider.apiKeySecretKey);
    } else if (apiKeyAction.value === "update") {
      const apiKey = await this.promptApiKey();
      if (!apiKey) {
        return;
      }

      await this.context.secrets.store(existingProvider.apiKeySecretKey, apiKey);
    }

    const updatedProvider: ProviderConfig = {
      ...existingProvider,
      baseURL: baseURL,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Provider "${updatedProvider.name}" updated.`);
  }

  async showDeleteProvider(): Promise<string | undefined> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${provider.name}"?`,
      { modal: true },
      "Delete",
      "Cancel",
    );

    if (confirmed !== "Delete") {
      return;
    }

    const deletedName = provider.name;
    if (provider.apiKeySecretKey) {
      await this.context.secrets.delete(provider.apiKeySecretKey);
    }
    await this.configManager.deleteProvider(provider.id);
    vscode.window.showInformationMessage(`Provider "${deletedName}" deleted.`);
    return deletedName;
  }

  async showAddModel(): Promise<void> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    const model = await this.collectModelDetails(provider);
    if (!model) {
      return;
    }

    const newModels: ModelConfig[] = [...provider.models, model];

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: newModels,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model "${model.name}" added to "${provider.name}".`);
  }

  async showDeleteModel(): Promise<void> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    if (!provider.models || provider.models.length === 0) {
      vscode.window.showInformationMessage("No models configured for this provider.");
      return;
    }

    const selectedModel = await vscode.window.showQuickPick(
      provider.models.map((m) => ({
        label: m.name,
        value: m,
      })),
      { placeHolder: "Select model to remove" },
    );

    if (!selectedModel) {
      return;
    }

    const newModels = provider.models.filter((m) => m.id !== selectedModel.value.id);

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: newModels,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model "${selectedModel.label}" removed.`);
  }

  async showEditModel(): Promise<void> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    if (!provider.models || provider.models.length === 0) {
      vscode.window.showInformationMessage("No models configured for this provider.");
      return;
    }

    const selectedModel = await vscode.window.showQuickPick(
      provider.models.map((m) => ({
        label: m.name,
        value: m,
      })),
      { placeHolder: "Select model to edit" },
    );

    if (!selectedModel) {
      return;
    }

    const modelIndex = provider.models.findIndex((m) => m.id === selectedModel.value.id);
    const updatedModel = await this.collectModelDetails(provider, selectedModel.value);

    if (!updatedModel) {
      return;
    }

    const newModels = [...provider.models];
    newModels[modelIndex] = updatedModel;

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: newModels,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model updated to "${updatedModel.name}".`);
  }
}
