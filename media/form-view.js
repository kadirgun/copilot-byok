(function () {
  const stateElement = document.getElementById("modal-form-state");
  const form = document.getElementById("modal-form");

  if (!stateElement || !form) {
    return;
  }

  const summary = document.getElementById("form-summary");
  const cancelButton = document.getElementById("cancel-button");

  if (!summary || !cancelButton) {
    return;
  }

  const vscode = acquireVsCodeApi();
  const rawState = stateElement.textContent || '{"fields":[]}';
  const state = JSON.parse(rawState);

  function getFieldElements(index) {
    const container = form.querySelector('[data-field-index="' + index + '"]');
    const control = container.querySelector("[data-field-control]");
    const error = container.querySelector("[data-field-error]");
    return { container, control, error };
  }

  function clearError(index) {
    const elements = getFieldElements(index);
    elements.container.classList.remove("has-error");
    elements.error.textContent = "";
  }

  function setError(index, message) {
    const elements = getFieldElements(index);
    elements.container.classList.add("has-error");
    elements.error.textContent = message;
  }

  function collectValues() {
    const values = {};
    state.fields.forEach(function (field, index) {
      const elements = getFieldElements(index);
      values[field.id] = field.type === "checkbox" ? elements.control.checked : elements.control.value;
    });
    return values;
  }

  function validateTextField(field, value) {
    const text = typeof value === "string" ? value : String(value ?? "");
    const normalized = field.trim === false ? text : text.trim();

    if (!normalized) {
      if (field.required) {
        return field.messages && field.messages.required ? field.messages.required : field.label + " is required";
      }

      return "";
    }

    if (field.minLength !== undefined && normalized.length < field.minLength) {
      return field.messages && field.messages.invalid
        ? field.messages.invalid
        : field.label + " must be at least " + field.minLength + " characters";
    }

    if (field.maxLength !== undefined && normalized.length > field.maxLength) {
      return field.messages && field.messages.invalid
        ? field.messages.invalid
        : field.label + " must be at most " + field.maxLength + " characters";
    }

    if (field.pattern) {
      let pattern;
      try {
        pattern = new RegExp(field.pattern);
      } catch (_error) {
        return field.messages && field.messages.pattern
          ? field.messages.pattern
          : field.label + " has an invalid pattern";
      }

      if (!pattern.test(normalized)) {
        return field.messages && field.messages.pattern ? field.messages.pattern : field.label + " is invalid";
      }
    }

    if (field.format === "url") {
      try {
        new URL(normalized);
      } catch (_error) {
        return field.messages && field.messages.format ? field.messages.format : field.label + " must be a valid URL";
      }
    }

    if (Array.isArray(field.notIn) && field.notIn.indexOf(normalized) >= 0) {
      return field.messages && field.messages.notIn ? field.messages.notIn : field.label + " must be unique";
    }

    return "";
  }

  function validateNumberField(field, value) {
    const text = typeof value === "string" ? value : String(value ?? "");
    const normalized = text.trim();

    if (!normalized) {
      if (field.required) {
        return field.messages && field.messages.required ? field.messages.required : field.label + " is required";
      }

      return "";
    }

    const numberValue = Number(normalized);
    if (!Number.isFinite(numberValue)) {
      return field.messages && field.messages.invalid
        ? field.messages.invalid
        : field.label + " must be a valid number";
    }

    if (field.integer && !Number.isInteger(numberValue)) {
      return field.messages && field.messages.integer ? field.messages.integer : field.label + " must be an integer";
    }

    if (field.min !== undefined && numberValue < field.min) {
      return field.messages && field.messages.min ? field.messages.min : field.label + " must be at least " + field.min;
    }

    if (field.max !== undefined && numberValue > field.max) {
      return field.messages && field.messages.max ? field.messages.max : field.label + " must be at most " + field.max;
    }

    return "";
  }

  function validateSelectField(field, value) {
    const text = typeof value === "string" ? value : String(value ?? "");
    const normalized = text.trim();

    if (!normalized) {
      if (field.required) {
        return field.messages && field.messages.required ? field.messages.required : field.label + " is required";
      }

      return "";
    }

    const exists = field.options.some(function (option) {
      return option.value === normalized;
    });

    if (!exists) {
      return field.messages && field.messages.invalid ? field.messages.invalid : field.label + " is invalid";
    }

    return "";
  }

  function validateCheckboxField(field, value) {
    const checked = value === true || value === "true" || value === "on" || value === 1 || value === "1";

    if (field.required && !checked) {
      return field.messages && field.messages.required ? field.messages.required : field.label + " must be checked";
    }

    return "";
  }

  function validateField(field, value) {
    switch (field.type) {
      case "text":
        return validateTextField(field, value);
      case "number":
        return validateNumberField(field, value);
      case "select":
        return validateSelectField(field, value);
      case "checkbox":
        return validateCheckboxField(field, value);
      default:
        return "";
    }
  }

  function applyValidation(values) {
    let firstInvalidIndex = -1;
    const errors = {};

    state.fields.forEach(function (field, index) {
      const error = validateField(field, values[field.id]);
      if (error) {
        errors[field.id] = error;
        setError(index, error);
        if (firstInvalidIndex === -1) {
          firstInvalidIndex = index;
        }
        return;
      }

      clearError(index);
    });

    if (Object.keys(errors).length > 0) {
      summary.textContent = "Please fix the highlighted fields.";
      summary.classList.add("has-error");
      getFieldElements(firstInvalidIndex).control.focus();
      return { valid: false, errors: errors };
    }

    summary.textContent = "";
    summary.classList.remove("has-error");
    return { valid: true, errors: {} };
  }

  function submitForm() {
    const values = collectValues();
    const validation = applyValidation(values);
    if (!validation.valid) {
      return;
    }

    vscode.postMessage({
      type: "submit",
      values: values,
    });
  }

  state.fields.forEach(function (field, index) {
    const elements = getFieldElements(index);
    const eventName = field.type === "checkbox" || field.type === "select" ? "change" : "input";
    elements.control.addEventListener(eventName, function () {
      clearError(index);
      summary.textContent = "";
      summary.classList.remove("has-error");
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    submitForm();
  });

  cancelButton.addEventListener("click", function () {
    vscode.postMessage({ type: "cancel" });
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      vscode.postMessage({ type: "cancel" });
    }
  });

  window.addEventListener("message", function (event) {
    const message = event.data;
    if (!message || message.type !== "validation-errors") {
      return;
    }

    Object.keys(message.errors || {}).forEach(function (fieldId) {
      const fieldIndex = state.fields.findIndex(function (field) {
        return field.id === fieldId;
      });

      if (fieldIndex >= 0) {
        setError(fieldIndex, message.errors[fieldId]);
      }
    });

    summary.textContent = "Please fix the highlighted fields.";
    summary.classList.add("has-error");
  });

  const initialFocusIndex = state.fields.findIndex(function (field) {
    return field.autofocus;
  });

  if (initialFocusIndex >= 0) {
    getFieldElements(initialFocusIndex).control.focus();
  } else if (state.fields.length > 0) {
    getFieldElements(0).control.focus();
  }
})();
