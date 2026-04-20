import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import type { ModalFormField, ModalFormOptions, ModalFormResult } from "../types";
import { normalizeModalFormSubmission } from "./modal-form-helpers";

interface WebviewMessage {
  type: "submit" | "cancel" | "validation-errors";
  values?: Record<string, unknown>;
  errors?: Record<string, string>;
}

interface RenderTemplateValues {
  title: string;
  mainClass: string;
  mainAttributes: string;
  content: string;
  state: string;
}

const FORM_VIEW_ID = "copilot-byok.formView";
const FORM_CONTAINER_COMMAND = "workbench.view.extension.copilot-byok";
const DEFAULT_VIEW_TITLE = "Copilot BYOK";

interface PendingFormRequest {
  fields: ModalFormField[];
  options: ModalFormOptions;
  resolve: (result: ModalFormResult | undefined) => void;
  settled: boolean;
}

export class ModalFormManager implements vscode.WebviewViewProvider {
  private readonly templateHtml: string;
  private webviewView: vscode.WebviewView | undefined;
  private pendingRequest: PendingFormRequest | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.templateHtml = readFileSync(this.context.asAbsolutePath("media/form-view.html"), "utf8");

    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(FORM_VIEW_ID, this, {
        webviewOptions: {
          retainContextWhenHidden: false,
        },
      }),
    );
  }

  async showFormModal(fields: ModalFormField[], options: ModalFormOptions = {}): Promise<ModalFormResult | undefined> {
    if (fields.length === 0) {
      return {};
    }

    return await new Promise<ModalFormResult | undefined>((resolve) => {
      if (this.pendingRequest) {
        this.finishPendingRequest(undefined);
      }

      this.pendingRequest = {
        fields,
        options,
        resolve,
        settled: false,
      };

      this.renderCurrentView();
      void this.revealView();
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(this.context.asAbsolutePath("media"))],
    };

    webviewView.onDidDispose(
      () => {
        if (this.webviewView === webviewView) {
          this.webviewView = undefined;
        }

        this.finishPendingRequest(undefined);
      },
      undefined,
      this.context.subscriptions,
    );

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message.type === "cancel") {
          this.finishPendingRequest(undefined);
          return;
        }

        if (message.type !== "submit" || !message.values) {
          return;
        }

        const pendingRequest = this.pendingRequest;
        if (!pendingRequest) {
          return;
        }

        const normalized = normalizeModalFormSubmission(pendingRequest.fields, message.values);
        if (Object.keys(normalized.errors).length > 0) {
          void webviewView.webview.postMessage({
            type: "validation-errors",
            errors: normalized.errors,
          } satisfies WebviewMessage);
          return;
        }

        this.finishPendingRequest(normalized.values);
      },
      undefined,
      this.context.subscriptions,
    );

    this.renderCurrentView();
  }

  private async revealView(): Promise<void> {
    if (this.webviewView) {
      this.webviewView.show(false);
      return;
    }

    try {
      await vscode.commands.executeCommand(FORM_CONTAINER_COMMAND);
    } catch (error) {
      console.error("Failed to open Copilot BYOK form view", error);
      this.finishPendingRequest(undefined);
    }
  }

  private finishPendingRequest(result: ModalFormResult | undefined): void {
    const request = this.pendingRequest;
    if (!request || request.settled) {
      return;
    }

    request.settled = true;
    this.pendingRequest = undefined;
    request.resolve(result);
    this.renderCurrentView();
  }

  private renderCurrentView(): void {
    const view = this.webviewView;
    if (!view) {
      return;
    }

    view.webview.html = this.pendingRequest
      ? this.buildHtml(view, this.pendingRequest.fields, this.pendingRequest.options)
      : this.buildIdleHtml(view);
  }

  private buildIdleHtml(view: vscode.WebviewView): string {
    return this.renderTemplate(view, {
      title: DEFAULT_VIEW_TITLE,
      mainClass: "idle-state",
      mainAttributes: 'aria-labelledby="idle-title"',
      content: this.buildIdleContent(),
      state: serializeJsonForScript({ fields: [], options: {} }),
    });
  }

  private buildHtml(view: vscode.WebviewView, fields: ModalFormField[], options: ModalFormOptions): string {
    const title = escapeHtml(options.title ?? "Form");
    const description = options.description ? escapeHtml(options.description) : "";
    const submitLabel = escapeHtml(options.submitLabel ?? "Submit");
    const cancelLabel = escapeHtml(options.cancelLabel ?? "Cancel");
    const state = serializeJsonForScript({ fields, options });
    const fieldMarkup = fields.map((field, index) => this.renderField(field, index, index === 0)).join("\n");

    return this.renderTemplate(view, {
      title,
      mainClass: "modal",
      mainAttributes: 'aria-labelledby="modal-title" aria-describedby="modal-description"',
      content: this.buildFormContent(fieldMarkup, title, description, submitLabel, cancelLabel),
      state,
    });
  }

  private buildIdleContent(): string {
    return `
    <section class="idle-card">
      <p class="idle-kicker">Copilot BYOK</p>
      <h1 class="idle-title" id="idle-title">Open a configuration form</h1>
      <p class="idle-description">Run Add Provider, Edit Provider, Add Model, or Edit Model to open the form in the side panel.</p>
      <p class="idle-tip">The panel stays available between requests so you can reopen it from the sidebar at any time.</p>
    </section>`;
  }

  private buildFormContent(
    fieldMarkup: string,
    title: string,
    description: string,
    submitLabel: string,
    cancelLabel: string,
  ): string {
    return `
    <header class="modal-header">
      <h1 class="modal-title" id="modal-title">${title}</h1>
      <p class="modal-description" id="modal-description">${description}</p>
    </header>
    <div class="modal-body">
      <p class="form-summary" id="form-summary" aria-live="polite"></p>
      <form id="modal-form" novalidate>
        <div class="form-fields">
${fieldMarkup}
        </div>
        <div class="modal-footer">
          <button type="button" class="button button-secondary" id="cancel-button">${cancelLabel}</button>
          <button type="submit" class="button button-primary">${submitLabel}</button>
        </div>
      </form>
    </div>`;
  }

  private renderTemplate(view: vscode.WebviewView, values: RenderTemplateValues): string {
    const styleUri = view.webview
      .asWebviewUri(vscode.Uri.file(this.context.asAbsolutePath("media/form-view.css")))
      .toString();
    const scriptUri = view.webview
      .asWebviewUri(vscode.Uri.file(this.context.asAbsolutePath("media/form-view.js")))
      .toString();

    return this.templateHtml
      .replaceAll("{{title}}", values.title)
      .replaceAll("{{cspSource}}", escapeHtml(view.webview.cspSource))
      .replaceAll("{{styleUri}}", escapeHtml(styleUri))
      .replaceAll("{{scriptUri}}", escapeHtml(scriptUri))
      .replaceAll("{{mainClass}}", values.mainClass)
      .replaceAll("{{mainAttributes}}", values.mainAttributes)
      .replaceAll("{{content}}", values.content)
      .replaceAll("{{state}}", values.state);
  }

  private renderField(field: ModalFormField, index: number, isFirst: boolean): string {
    const fieldId = `field-${index}`;
    const errorId = `${fieldId}-error`;
    const descriptionId = `${fieldId}-description`;
    const label = escapeHtml(field.label);
    const description = field.description
      ? `<p class="form-help" id="${descriptionId}">${escapeHtml(field.description)}</p>`
      : "";
    const requiredMark = field.required ? `<span class="form-required" aria-hidden="true">*</span>` : "";
    const describedBy = [field.description ? descriptionId : "", errorId].filter(Boolean).join(" ");
    const autofocus = field.autofocus || isFirst ? "autofocus" : "";

    switch (field.type) {
      case "text": {
        const attributes = [
          `value="${escapeHtml(field.value ?? "")}"`,
          field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
          autofocus,
          field.required ? 'aria-required="true"' : "",
          describedBy ? `aria-describedby="${describedBy}"` : "",
          field.maxLength !== undefined ? `maxlength="${field.maxLength}"` : "",
          field.minLength !== undefined ? `minlength="${field.minLength}"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `
          <div class="form-field" data-field-index="${index}">
            <label class="form-label" for="${fieldId}">${label}${requiredMark}</label>
            ${description}
            <input
              class="form-control"
              id="${fieldId}"
              data-field-control
              type="${field.password ? "password" : "text"}"
              ${attributes}
            />
            <p class="form-error" id="${errorId}" data-field-error aria-live="polite"></p>
          </div>`;
      }

      case "number": {
        const attributes = [
          `value="${field.value === undefined ? "" : escapeHtml(String(field.value))}"`,
          field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
          autofocus,
          field.required ? 'aria-required="true"' : "",
          describedBy ? `aria-describedby="${describedBy}"` : "",
          field.min !== undefined ? `min="${field.min}"` : "",
          field.max !== undefined ? `max="${field.max}"` : "",
          field.step !== undefined ? `step="${field.step}"` : field.integer ? 'step="1"' : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `
          <div class="form-field" data-field-index="${index}">
            <label class="form-label" for="${fieldId}">${label}${requiredMark}</label>
            ${description}
            <input
              class="form-control"
              id="${fieldId}"
              data-field-control
              type="number"
              ${attributes}
            />
            <p class="form-error" id="${errorId}" data-field-error aria-live="polite"></p>
          </div>`;
      }

      case "select": {
        const placeholderLabel = field.required ? "Select an option" : "Optional";
        const placeholderSelected = field.value === undefined || field.value === "" ? "selected" : "";
        const attributes = [
          autofocus,
          field.required ? 'aria-required="true"' : "",
          describedBy ? `aria-describedby="${describedBy}"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const options = field.options
          .map((option) => {
            const selected = option.value === field.value ? "selected" : "";
            return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
          })
          .join("");

        return `
          <div class="form-field" data-field-index="${index}">
            <label class="form-label" for="${fieldId}">${label}${requiredMark}</label>
            ${description}
            <select
              class="form-select"
              id="${fieldId}"
              data-field-control
              ${attributes}
            >
              <option value="" ${placeholderSelected}>${placeholderLabel}</option>
              ${options}
            </select>
            <p class="form-error" id="${errorId}" data-field-error aria-live="polite"></p>
          </div>`;
      }

      case "checkbox": {
        const attributes = [
          field.value ? "checked" : "",
          autofocus,
          field.required ? 'aria-required="true"' : "",
          describedBy ? `aria-describedby="${describedBy}"` : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `
          <div class="form-field form-field--checkbox" data-field-index="${index}">
            <label class="form-checkbox-row" for="${fieldId}">
              <input
                class="form-checkbox"
                id="${fieldId}"
                data-field-control
                type="checkbox"
                ${attributes}
              />
              <span class="form-label">${label}${requiredMark}</span>
            </label>
            ${description}
            <p class="form-error" id="${errorId}" data-field-error aria-live="polite"></p>
          </div>`;
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
