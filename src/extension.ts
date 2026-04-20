import * as vscode from "vscode";
import { ConfigManager } from "./config/manager";
import { QuickPickManager } from "./config/quickpick.js";
import { MainProvider } from "./providers/main";
import { PROVIDER_VENDOR_ID } from "./types";
import { ModalFormManager } from "./ui/modal-form.js";

export function activate(context: vscode.ExtensionContext): void {
  const configManager = new ConfigManager(context);
  const modalFormManager = new ModalFormManager(context);
  const quickPickManager = new QuickPickManager(context, configManager, modalFormManager);
  const mainProvider = new MainProvider(context, configManager, quickPickManager);
  const emitter = new vscode.EventEmitter<void>();

  vscode.lm.registerLanguageModelChatProvider(PROVIDER_VENDOR_ID, {
    onDidChangeLanguageModelChatInformation: emitter.event,
    provideLanguageModelChatInformation: mainProvider.provideLanguageModelChatInformation.bind(mainProvider),
    provideLanguageModelChatResponse: mainProvider.provideLanguageModelChatResponse.bind(mainProvider),
    provideTokenCount: mainProvider.provideTokenCount.bind(mainProvider),
  });

  const refresh = async (): Promise<void> => {
    await mainProvider.reload(await configManager.loadProviders());
    emitter.fire();
  };

  void refresh();

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-byok.addProvider", async () => {
      const name = await quickPickManager.showAddProvider();
      await refresh();
      if (name) {
        await vscode.commands.executeCommand("copilot-byok.addModel");
      }
    }),
    vscode.commands.registerCommand("copilot-byok.editProvider", async () => {
      await quickPickManager.showEditProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.deleteProvider", async () => {
      await quickPickManager.showDeleteProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.addModel", async () => {
      await quickPickManager.showAddModel();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.removeModel", async () => {
      await quickPickManager.showDeleteModel();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.editModel", async () => {
      await quickPickManager.showEditModel();
      await refresh();
    }),
  );
}

export function deactivate(): void {}
