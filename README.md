# ENROADS-CLIMATE---TENSORFLOW-TO-MIDI-BRIDGE-

Web app bridge from a Teachable Machine image model to Web MIDI.

## What it does

- Loads a Teachable Machine image model (`model.json` + `metadata.json`)
- Uses webcam inference in the browser
- Expects class names like `0%`, `5%`, `10%`, ... `100%`
- Finds the most confident class each frame
- Sends that percentage value directly as a MIDI CC data value (`0-100`, valid subset of MIDI `0-127`) on one selected channel and one selected output port
  - This is intentional so each model class maps 1:1 to its labeled percentage.

## Usage

1. Serve this folder with any static web server (or open `index.html` directly in a browser that supports required APIs).
2. Open the app in a Chromium-based browser with Web MIDI support.
3. Click **Enable MIDI** and select the desired MIDI output port.
4. Set channel and CC number.
5. Enter your Teachable Machine model URL and click **Load Model + Start Camera**.

Example model URL formats accepted:

- `https://teachablemachine.withgoogle.com/models/abc123/`
- `https://teachablemachine.withgoogle.com/models/abc123/model.json`
