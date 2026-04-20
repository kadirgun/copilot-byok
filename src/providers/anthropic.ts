import Anthropic from "@anthropic-ai/sdk";
import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import { BaseProvider } from "./base";

interface ToolCallTracker {
  id: string;
  name: string;
  arguments: string;
}

export class AnthropicProvider extends BaseProvider {
  private client?: Anthropic;

  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    super(config, context);
  }

  private async getClient(): Promise<Anthropic> {
    if (this.client) {
      return this.client;
    }

    const apiKey = await this.getApiKey();

    this.client = new Anthropic({
      apiKey,
      baseURL: this.config.baseURL ?? "https://api.anthropic.com",
    });

    return this.client;
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
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

    const mappedMessages: Anthropic.MessageParam[] = [];
    for (const message of messages) {
      const text = this.extractTextContent(message);
      const role = message.role === vscode.LanguageModelChatMessageRole.User ? "user" : "assistant";

      const contentBlocks: Anthropic.ContentBlockParam[] = [];

      if (text) {
        contentBlocks.push({ type: "text", text } as Anthropic.TextBlockParam);
      }

      for (const part of message.content) {
        if (part instanceof vscode.LanguageModelToolCallPart) {
          contentBlocks.push({
            type: "tool_use",
            id: part.callId,
            name: part.name,
            input: part.input,
          } as Anthropic.ToolUseBlockParam);
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          const resultContent =
            typeof part.content === "string"
              ? part.content
              : part.content
                  .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
                  .map((p) => p.value)
                  .join("\n");

          contentBlocks.push({
            type: "tool_result",
            tool_use_id: part.callId,
            content: resultContent,
          } as Anthropic.ToolResultBlockParam);
        }
      }

      if (contentBlocks.length > 0) {
        mappedMessages.push({
          role: role as "user" | "assistant",
          content: contentBlocks,
        } as Anthropic.MessageParam);
      }
    }

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

    const stream = client.messages.stream({
      model: model.id,
      messages: mappedMessages,
      tools: tools?.length ? tools : undefined,
      max_tokens: model.maxOutputTokens || 8192,
    });

    let currentToolCall: ToolCallTracker | null = null;

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }

      if (chunk.type === "content_block_start") {
        if (chunk.content_block.type === "tool_use") {
          currentToolCall = {
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            arguments: "",
          };
        }
      } else if (chunk.type === "content_block_delta") {
        if (chunk.delta.type === "text_delta") {
          progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
        } else if (chunk.delta.type === "input_json_delta") {
          if (currentToolCall) {
            currentToolCall.arguments += chunk.delta.partial_json;
          }
        }
      } else if (chunk.type === "content_block_stop") {
        if (currentToolCall) {
          try {
            const args = JSON.parse(currentToolCall.arguments);
            progress.report(new vscode.LanguageModelToolCallPart(currentToolCall.id, currentToolCall.name, args));
          } catch {
            progress.report(new vscode.LanguageModelToolCallPart(currentToolCall.id, currentToolCall.name, {}));
          }
          currentToolCall = null;
        }
      } else if (chunk.type === "message_delta") {
        if (chunk.delta.stop_reason === "tool_use") {
          // All tool calls completed
        }
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const content =
      typeof text === "string"
        ? text
        : text.content
            .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
            .map((part) => part.value)
            .join("");

    return Math.ceil(content.length / 4);
  }
}