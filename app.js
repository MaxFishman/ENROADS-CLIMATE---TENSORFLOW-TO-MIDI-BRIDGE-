const modelUrlInput = document.getElementById("model-url");
const loadModelButton = document.getElementById("load-model");
const enableMidiButton = document.getElementById("enable-midi");
const ccNumberInput = document.getElementById("cc-number");
const cameraHost = document.getElementById("camera-host");
const predictionText = document.getElementById("prediction-text");
const midiText = document.getElementById("midi-text");
const classMappingsPanel = document.getElementById("class-mappings");
const mappingBody = document.getElementById("mapping-body");
const midiStatusDot = document.getElementById("midi-status-dot");
const midiStatusLabel = document.getElementById("midi-status-label");

let model;
let webcam;
let animationFrameId;
let midiAccess;
let lastSentValue = null;

/** Per-class MIDI mapping: className → { outputId, channel, cc } */
const classMidiMap = new Map();

function normalizeModelBaseUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Please provide a model URL.");
  }

  if (trimmed.endsWith("model.json")) {
    return trimmed.slice(0, -"model.json".length);
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function parsePercentageFromClassName(className) {
  const match = String(className)
    .trim()
    .match(/^(0|5|[1-9]0|[1-9]5|100)\s*%$/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return value;
}

function defaultCcNumber() {
  const cc = Number(ccNumberInput.value);
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) {
    return 1;
  }
  return cc;
}

function getMidiOutputs() {
  return Array.from(midiAccess?.outputs.values() || []);
}

function buildOutputOptions(selectedId) {
  const outputs = getMidiOutputs();
  let html = '<option value="">— default (first available) —</option>';
  for (const output of outputs) {
    const label = output.name || output.manufacturer || output.id;
    const selected = output.id === selectedId ? " selected" : "";
    html += `<option value="${output.id}"${selected}>${label}</option>`;
  }
  return html;
}

function resolveOutputForClass(className) {
  const mapping = classMidiMap.get(className);
  const outputId = mapping?.outputId || "";

  if (outputId && midiAccess) {
    const out = midiAccess.outputs.get(outputId);
    if (out) return out;
  }

  const outputs = getMidiOutputs();
  return outputs.length ? outputs[0] : null;
}

function resolveChannelForClass(className) {
  const mapping = classMidiMap.get(className);
  const ch = mapping?.channel ?? 1;
  if (!Number.isInteger(ch) || ch < 1 || ch > 16) return 1;
  return ch;
}

function resolveCcForClass(className) {
  const mapping = classMidiMap.get(className);
  const cc = mapping?.cc ?? defaultCcNumber();
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) return defaultCcNumber();
  return cc;
}

function buildClassMappingRows(classNames) {
  classMidiMap.clear();
  mappingBody.innerHTML = "";

  const defaultCc = defaultCcNumber();
  for (const name of classNames) {
    classMidiMap.set(name, { outputId: "", channel: 1, cc: defaultCc });

    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = name;
    tr.appendChild(tdName);

    const tdPort = document.createElement("td");
    const portSelect = document.createElement("select");
    portSelect.innerHTML = buildOutputOptions("");
    portSelect.addEventListener("change", () => {
      classMidiMap.get(name).outputId = portSelect.value;
    });
    tdPort.appendChild(portSelect);
    tr.appendChild(tdPort);

    const tdChannel = document.createElement("td");
    const channelInput = document.createElement("input");
    channelInput.type = "number";
    channelInput.min = "1";
    channelInput.max = "16";
    channelInput.value = "1";
    channelInput.addEventListener("change", () => {
      const v = Number(channelInput.value);
      if (Number.isInteger(v) && v >= 1 && v <= 16) {
        classMidiMap.get(name).channel = v;
      }
    });
    tdChannel.appendChild(channelInput);
    tr.appendChild(tdChannel);

    const tdCc = document.createElement("td");
    const ccInput = document.createElement("input");
    ccInput.type = "number";
    ccInput.min = "0";
    ccInput.max = "127";
    ccInput.value = String(defaultCc);
    ccInput.addEventListener("change", () => {
      const v = Number(ccInput.value);
      if (Number.isInteger(v) && v >= 0 && v <= 127) {
        classMidiMap.get(name).cc = v;
      }
    });
    tdCc.appendChild(ccInput);
    tr.appendChild(tdCc);

    mappingBody.appendChild(tr);
  }

  classMappingsPanel.classList.add("visible");
}

function refreshMappingPortSelects() {
  const selects = mappingBody.querySelectorAll("select");
  const rows = mappingBody.querySelectorAll("tr");
  rows.forEach((row, i) => {
    const className = row.querySelector("td:first-child")?.textContent;
    if (!className) return;
    const currentId = classMidiMap.get(className)?.outputId || "";
    selects[i].innerHTML = buildOutputOptions(currentId);
  });
}

function updateMidiStatus() {
  const outputs = getMidiOutputs();
  if (outputs.length) {
    midiStatusDot.classList.add("active");
    midiStatusLabel.textContent = `${outputs.length} MIDI output${outputs.length > 1 ? "s" : ""} available`;
  } else {
    midiStatusDot.classList.remove("active");
    midiStatusLabel.textContent = "No MIDI outputs found";
  }
}

function sendMidiValue(value, className, confidence) {
  const output = resolveOutputForClass(className);
  if (!output) {
    return;
  }

  const channel = resolveChannelForClass(className);
  const cc = resolveCcForClass(className);
  const statusByte = 0xb0 + (channel - 1);
  output.send([statusByte, cc, value]);
  midiText.textContent = `Sent CC ${cc} value ${value} on ch ${channel} → ${output.name || output.id} (class ${className}, ${(confidence * 100).toFixed(1)}%)`;
}

function stopLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

async function startPredictionLoop() {
  stopLoop();

  const loop = async () => {
    try {
      webcam.update();
      const predictions = await model.predict(webcam.canvas);
      if (!predictions?.length) {
        return;
      }

      const top = predictions.reduce((best, item) =>
        item.probability > best.probability ? item : best,
      );

      const percentageValue = parsePercentageFromClassName(top.className);
      const confidenceText = `${(top.probability * 100).toFixed(1)}%`;

      if (percentageValue === null) {
        predictionText.textContent = `Top class '${top.className}' (${confidenceText}) is not a valid 0-100 percentage in steps of 5.`;
      } else {
        predictionText.textContent =
          `Top class: ${top.className} (${confidenceText}) → MIDI value ${percentageValue}`;
        if (percentageValue !== lastSentValue) {
          sendMidiValue(percentageValue, top.className, top.probability);
          lastSentValue = percentageValue;
        }
      }
    } catch (error) {
      predictionText.textContent = `Prediction error: ${error.message}`;
    } finally {
      animationFrameId = requestAnimationFrame(loop);
    }
  };

  loop();
}

loadModelButton.addEventListener("click", async () => {
  try {
    loadModelButton.disabled = true;

    const modelBase = normalizeModelBaseUrl(modelUrlInput.value);
    model = await tmImage.load(`${modelBase}model.json`, `${modelBase}metadata.json`);

    const classNames = model.getClassLabels ? model.getClassLabels() : [];
    if (classNames.length) {
      buildClassMappingRows(classNames);
    }

    if (webcam) {
      await webcam.stop();
      cameraHost.innerHTML = "";
    }

    const flip = true;
    webcam = new tmImage.Webcam(320, 240, flip);
    await webcam.setup();
    await webcam.play();
    cameraHost.append(webcam.canvas);
    lastSentValue = null;

    await startPredictionLoop();
  } catch (error) {
    predictionText.textContent = `Error: ${error.message}`;
  } finally {
    loadModelButton.disabled = false;
  }
});

enableMidiButton.addEventListener("click", async () => {
  try {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI is not supported in this browser.");
    }

    midiAccess = await navigator.requestMIDIAccess();
    updateMidiStatus();
    refreshMappingPortSelects();
    midiAccess.onstatechange = () => {
      updateMidiStatus();
      refreshMappingPortSelects();
    };
    midiText.textContent = "MIDI enabled.";
  } catch (error) {
    midiText.textContent = `Error: ${error.message}`;
  }
});

window.addEventListener("beforeunload", () => {
  stopLoop();
  if (webcam) {
    webcam.stop();
  }
});
