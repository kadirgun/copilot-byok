import Anthropic from "@anthropic-ai/sdk";
import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import { languageModelUsagePart } from "../utils/languageModelUsagePart";
import { BaseProvider } from "./base";

interface ToolCallTracker {
  toolId: string;
  name: string;
  jsonInput: string;
}

interface ThinkingTracker {
  thinking: string;
  signature: string;
}

class AnthropicTransport extends Anthropic {
  private readonly noAuth: boolean;

  constructor(options: ConstructorParameters<typeof Anthropic>[0] & { noAuth?: boolean }) {
    const { noAuth, ...rest } = options;
    super(rest);
    this.noAuth = !!noAuth;
  }

  protected override defaultHeaders(
    opts: Parameters<Anthropic["defaultHeaders"]>[0],
  ): Record<string, string | null | undefined> {
    const headers = super.defaultHeaders(opts);
    if (!this.noAuth) {
      return headers;
    }

    return Object.fromEntries(
      Object.entries(headers).filter(([name]) => {
        const lower = name.toLowerCase();
        return lower !== "authorization" && lower !== "x-api-key";
      }),
    ) as Record<string, string | null | undefined>;
  }
}

export class AnthropicProvider extends BaseProvider {
  private client?: Anthropic;

  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    super(config, context);
  }

  override setConfig(config: ProviderConfig): void {
    this.client = undefined;
    super.setConfig(config);
  }

  private async getClient(): Promise<Anthropic> {
    if (this.client) {
      return this.client;
    }

    const apiKey = await this.getApiKey();

    this.client = new AnthropicTransport({
      noAuth: !apiKey,
      apiKey: apiKey ?? "",
      baseURL: this.config.baseURL ?? "https://api.anthropic.com",
    });

    return this.client;
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void options;

    return this.config.models.map(
      (model) =>
        ({
          id: model.id,
          name: model.name || model.id,
          family: "Anthropic",
          detail: this.config.name,
          version: "1.0.0",
          maxInputTokens: model.maxInputTokens ?? 200000,
          maxOutputTokens: model.maxOutputTokens ?? 8192,
          isUserSelectable: true,
          capabilities: model.capabilities ?? {
            imageInput: true,
            toolCalling: true,
          },
          groupId: this.config.id,
        }) as vscode.LanguageModelChatInformation,
    );
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const client = await this.getClient();

    const mappedMessages = this.extractAnthropicMessages(messages);

    if (mappedMessages.length === 0) {
      mappedMessages.push({
        role: "user" as const,
        content: " ",
      } as Anthropic.MessageParam);
    }

    const tools = options.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      input_schema: tool.inputSchema ?? { type: "object", properties: {} },
    })) as unknown as Anthropic.Tool[];

    const thinkingBudget = this.getThinkingBudget(model);
    const thinking =
      model.capabilities?.thinking && thinkingBudget !== undefined
        ? {
            type: "enabled" as const,
            budget_tokens: thinkingBudget,
          }
        : undefined;

    const toolChoice = tools?.length
      ? options.toolMode === vscode.LanguageModelChatToolMode.Required
        ? { type: "any" as const, disable_parallel_tool_use: true }
        : { type: "auto" as const }
      : undefined;

    const stream = client.messages.stream({
      model: model.id,
      messages: mappedMessages,
      tools: tools?.length ? tools : undefined,
      max_tokens: model.maxOutputTokens || 8192,
      ...(thinking ? { thinking } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });

    const pendingToolCalls = new Map<number, ToolCallTracker>();
    const pendingThinking = new Map<number, ThinkingTracker>();
    const emittedThinking = new Map<number, string>();

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }

      if (chunk.type === "content_block_start") {
        if (chunk.content_block.type === "tool_use") {
          pendingToolCalls.set(chunk.index, {
            toolId: chunk.content_block.id,
            name: chunk.content_block.name,
            jsonInput: "",
          });
        } else if (chunk.content_block.type === "thinking") {
          pendingThinking.set(chunk.index, {
            thinking: "",
            signature: chunk.content_block.signature ?? "",
          });
        } else if (chunk.content_block.type === "redacted_thinking") {
          progress.report(new vscode.LanguageModelThinkingPart("", { redactedData: chunk.content_block.data }));
        }
      } else if (chunk.type === "content_block_delta") {
        if (chunk.delta.type === "text_delta") {
          progress.report(new vscode.LanguageModelTextPart(chunk.delta.text || ""));
        } else if (chunk.delta.type === "thinking_delta") {
          const tracker = pendingThinking.get(chunk.index);
          if (tracker) {
            tracker.thinking += chunk.delta.thinking || "";
            emittedThinking.set(chunk.index, tracker.thinking);
            progress.report(new vscode.LanguageModelThinkingPart(chunk.delta.thinking || ""));
          }
        } else if (chunk.delta.type === "signature_delta") {
          const tracker = pendingThinking.get(chunk.index);
          if (tracker) {
            tracker.signature += chunk.delta.signature || "";
          }
        } else if (chunk.delta.type === "input_json_delta") {
          const tracker = pendingToolCalls.get(chunk.index);
          if (!tracker) {
            continue;
          }

          tracker.jsonInput = (tracker.jsonInput || "") + (chunk.delta.partial_json || "");

          try {
            const parsedJson = JSON.parse(tracker.jsonInput);
            progress.report(new vscode.LanguageModelToolCallPart(tracker.toolId, tracker.name, parsedJson));
            pendingToolCalls.delete(chunk.index);
          } catch {
            // JSON not complete yet, continue accumulating
          }
        }
      } else if (chunk.type === "content_block_stop") {
        const toolCall = pendingToolCalls.get(chunk.index);
        if (toolCall) {
          this.flushToolCall(progress, toolCall);
          pendingToolCalls.delete(chunk.index);
          continue;
        }

        const thinking = pendingThinking.get(chunk.index);
        if (thinking) {
          const finalThinking = emittedThinking.get(chunk.index) ?? thinking.thinking;
          const finalPart = new vscode.LanguageModelThinkingPart("", {
            signature: thinking.signature,
            _completeThinking: finalThinking,
          });
          progress.report(finalPart);
          pendingThinking.delete(chunk.index);
          emittedThinking.delete(chunk.index);
        }
      } else if (chunk.type === "message_delta") {
        if (chunk.usage) {
          progress.report(languageModelUsagePart(chunk.usage.input_tokens, chunk.usage.output_tokens));
        }
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return Math.ceil(text.toString().length / 4);
  }

  private getThinkingBudget(model: vscode.LanguageModelChatInformation): number | undefined {
    const budget = Math.min(32000, model.maxOutputTokens - 1, Math.floor(model.maxOutputTokens * 0.25));
    return budget >= 1024 ? budget : undefined;
  }

  private flushToolCall(progress: vscode.Progress<vscode.LanguageModelResponsePart>, tracker: ToolCallTracker): void {
    try {
      progress.report(
        new vscode.LanguageModelToolCallPart(tracker.toolId, tracker.name, JSON.parse(tracker.jsonInput || "{}")),
      );
    } catch {
      progress.report(new vscode.LanguageModelToolCallPart(tracker.toolId, tracker.name, {}));
    }
  }

  private extractAnthropicMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
  ): Anthropic.MessageParam[] {
    const mappedMessages: Anthropic.MessageParam[] = [];

    for (const message of messages) {
      const role = message.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";
      const content: Anthropic.ContentBlockParam[] = [];

      for (const part of message.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ type: "text", text: part.value });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          content.push({ type: "tool_use", id: part.callId, name: part.name, input: part.input });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          content.push({
            type: "tool_result",
            tool_use_id: part.callId,
            content: part.content
              .map((item) =>
                item instanceof vscode.LanguageModelTextPart ? { type: "text", text: item.value } : undefined,
              )
              .filter((item): item is Anthropic.TextBlockParam => item !== undefined),
          });
        } else if (part instanceof vscode.LanguageModelDataPart) {
          if (part.mimeType.startsWith("image/")) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: part.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: Buffer.from(part.data).toString("base64"),
              },
            });
          }
        }
      }

      if (content.length > 0) {
        mappedMessages.push({ role, content });
      }
    }

    return mappedMessages;
  }
}
