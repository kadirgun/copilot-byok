import * as vscode from "vscode";
import { ConfigManager } from "./config/manager";
import { SidebarManager } from "./config/sidebar.js";
import { MainProvider } from "./providers/main";
import { PROVIDER_VENDOR_ID } from "./types";
import { ModalFormManager } from "./ui/modal-form.js";

export function activate(context: vscode.ExtensionContext): void {
  const configManager = new ConfigManager(context);
  const modalFormManager = new ModalFormManager(context);
  const sidebarManager = new SidebarManager(context, configManager, modalFormManager);
  const mainProvider = new MainProvider(context, configManager, sidebarManager);
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
      const name = await sidebarManager.showAddProvider();
      await refresh();
      if (name) {
        await vscode.commands.executeCommand("copilot-byok.addModel");
      }
    }),
    vscode.commands.registerCommand("copilot-byok.editProvider", async () => {
      await sidebarManager.showEditProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.deleteProvider", async () => {
      await sidebarManager.showDeleteProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.addModel", async () => {
      await sidebarManager.showAddModel();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.removeModel", async () => {
      await sidebarManager.showDeleteModel();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.editModel", async () => {
      await sidebarManager.showEditModel();
      await refresh();
    }),
  );
}

export function deactivate(): void {}
