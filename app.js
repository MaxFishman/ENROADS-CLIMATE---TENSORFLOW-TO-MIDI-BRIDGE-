const modelUrlInput = document.getElementById("model-url");
const loadModelButton = document.getElementById("load-model");
const enableMidiButton = document.getElementById("enable-midi");
const midiOutputSelect = document.getElementById("midi-output");
const midiChannelInput = document.getElementById("midi-channel");
const ccNumberInput = document.getElementById("cc-number");
const cameraHost = document.getElementById("camera-host");
const predictionText = document.getElementById("prediction-text");
const midiText = document.getElementById("midi-text");

let model;
let webcam;
let animationFrameId;
let midiAccess;
let lastSentValue = null;

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

function selectedChannel() {
  const channel = Number(midiChannelInput.value);
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    throw new Error("MIDI channel must be an integer from 1 to 16.");
  }
  return channel;
}

function selectedCcNumber() {
  const cc = Number(ccNumberInput.value);
  if (!Number.isInteger(cc) || cc < 0 || cc > 127) {
    throw new Error("CC number must be an integer from 0 to 127.");
  }
  return cc;
}

function selectedMidiOutput() {
  const outputId = midiOutputSelect.value;
  if (!outputId) {
    return null;
  }

  return midiAccess.outputs.get(outputId) || null;
}

function updateMidiOutputs() {
  const outputs = Array.from(midiAccess?.outputs.values() || []);
  midiOutputSelect.innerHTML = "";

  if (!outputs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No MIDI outputs found";
    midiOutputSelect.append(option);
    midiOutputSelect.disabled = true;
    return;
  }

  for (const output of outputs) {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || output.manufacturer || output.id;
    midiOutputSelect.append(option);
  }

  midiOutputSelect.disabled = false;
}

function sendMidiValue(value, className, confidence) {
  const output = selectedMidiOutput();
  if (!output) {
    return;
  }

  const channel = selectedChannel();
  const cc = selectedCcNumber();
  const statusByte = 0xb0 + (channel - 1);
  output.send([statusByte, cc, value]);
  midiText.textContent = `Sent CC ${cc} value ${value} on channel ${channel} to ${output.name || output.id} (class ${className}, confidence ${(confidence * 100).toFixed(1)}%)`;
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
    updateMidiOutputs();
    midiAccess.onstatechange = updateMidiOutputs;
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
