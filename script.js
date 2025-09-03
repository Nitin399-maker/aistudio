import { System_prompt, FRAME_TEMPLATE, render3DViewerHTML } from "./utils.js";
import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1";
import { openaiHelp } from "https://tools.s-anand.net/common/aiconfig.js";
import { bootstrapAlert } from "https://cdn.jsdelivr.net/npm/bootstrap-alert@1";
const $ = id => document.getElementById(id);
const DEFAULT_BASE_URLS = [
  "https://api.openai.com/v1",
  "https://llmfoundry.straivedemo.com/openai/v1",
  "https://llmfoundry.straive.com/openai/v1",
];

// Global State
const S = {
  // Image generation state
  baseImage: null,
  selectedUrl: "",
  imageHistory: [],
  
  // 3D generation state
  sourceCode: "",
  session: [],
  dimensions: { x: 5.0, y: 5.0, z: 5.0 },
  currentFrame: null,
  frameReady: false,
  pendingCode: null,
  availableModels: [],
  selectedModel: null,
  referenceImageBase64: null, // Store base64 version for 3D generation
  
  // Loading states
  imageLoading: false,
  objectLoading: false
};
let imageLoadingTimer;
let objectLoadingTimer;
let viewerCounter = 0;
// Utility functions
const msg = (type = 'image') => {
  const messages = type === 'image' ? 
    ["Painting pixels...", "Talking to the muse...", "Polishing details...", "Finalizing masterpiece..."] :
    ["Crafting geometry...", "Shaping vertices...", "Building meshes...", "Rendering object..."];
  return `Generating ${type} (1-2 min)... ${messages[Math.floor(Math.random() * messages.length)]}`;
};
const hideDeletes = (hide) =>
  document.querySelectorAll(".user-card .btn-close").forEach((b) => b.classList.toggle("invisible", hide));
// Image Loading Functions
function startImageLoading() {
  if (S.imageLoading) return; // Prevent multiple loaders
  S.imageLoading = true;
  
  const log = $('image-chat-log');
  log.insertAdjacentHTML(
    "beforeend",
    `<div id="image-loading-card" class="card mb-3 shadow-sm">
       <div class="card-body text-center py-4">
         <div class="spinner-border text-primary mb-2" role="status"></div>
         <div id="image-loading-msg">${msg('image')}</div>
       </div>
     </div>`
  );
  
  log.scrollTop = log.scrollHeight;
  hideDeletes(true);
  
  imageLoadingTimer = setInterval(() => {
    const msgEl = document.getElementById('image-loading-msg');
    if (msgEl) msgEl.textContent = msg('image');
  }, 5000);
}
function stopImageLoading() {
  if (!S.imageLoading) return;
  S.imageLoading = false;
  
  clearInterval(imageLoadingTimer);
  const loadingCard = document.getElementById('image-loading-card');
  if (loadingCard) loadingCard.remove();
  hideDeletes(false);
}
// 3D Loading Functions  
function startObjectLoading() {
  if (S.objectLoading) return; // Prevent multiple loaders
  S.objectLoading = true;
  hideDeletes(true);
}
function stopObjectLoading() {
  if (!S.objectLoading) return;
  S.objectLoading = false;
  hideDeletes(false);
}
// Image to Base64 conversion utility
async function imageToBase64(imageSource) {
  return new Promise((resolve, reject) => {
    if (imageSource instanceof File) {
      // Handle file upload
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(imageSource);
    } else if (typeof imageSource === 'string') {
      // Handle URL - convert to base64
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Handle CORS
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        try {
          const base64 = canvas.toDataURL('image/png');
          resolve(base64);
        } catch (error) {
          reject(new Error('Failed to convert image to base64: ' + error.message));
        }
      };
      img.onerror = () => reject(new Error('Failed to load image from URL'));
      img.src = imageSource;
    } else {
      reject(new Error('Invalid image source'));
    }
  });
}
// Update reference image base64 when image changes
async function updateReferenceImageBase64() {
  try {
    if (S.baseImage) {
      S.referenceImageBase64 = await imageToBase64(S.baseImage);
    } else if (S.selectedUrl) {
      S.referenceImageBase64 = await imageToBase64(S.selectedUrl);
    } else {
      S.referenceImageBase64 = null;
    }
  } catch (error) {
    console.warn('Failed to convert reference image to base64:', error);
    S.referenceImageBase64 = null;
  }
}
// Model Management
async function loadModels() {
  try {
    const config = await openaiConfig({ 
      defaultBaseUrls: DEFAULT_BASE_URLS, 
      help: openaiHelp 
    });
    
    if (config.models && config.models.length > 0) {
      S.availableModels = config.models.filter(model => {
        const modelName = model.toLowerCase();
        return modelName=="models/gemini-2.5-pro";
      }); 
      updateModelDropdown();
      if (!S.selectedModel && S.availableModels.length > 0) {
        S.selectedModel = S.availableModels[0];
        $('model-select').value = S.selectedModel;
      }
    }
  } catch (error) {
    console.warn('Failed to load models:', error);
  }
}
function updateModelDropdown() {
  const select = $('model-select');
  select.innerHTML = '<option value="">Select Model...</option>';
  S.availableModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  });
}
// Image Generation Functions
const collectImageOptions = () => {
  const opts = { moderation: "low" };
  if ($('size').value !== "auto") opts.size = $('size').value;
  if ($('quality').value !== "auto") opts.quality = $('quality').value;
  if ($('output-format').value !== "png") opts.output_format = $('output-format').value;
  if ($('output-format').value !== "png") opts.output_compression = +$('output-compression').value;
  if ($('background').checked) opts.background = "transparent";
  return opts;
};
const restoreImagePrompt = (p) => {
  const input = $('image-prompt-input');
  input.value = input.value ? `${input.value}\n${p}` : p;
};
const restoreObjectPrompt = (p) => {
  const input = $('object-prompt-input');
  input.value = input.value ? `${input.value}\n${p}` : p;
};
function addHover(card) {
  card.classList.add("cursor-pointer");
  card.addEventListener("mouseenter", () => card.classList.add("shadow"));
  card.addEventListener("mouseleave", () => card.classList.remove("shadow"));
}
function deleteImageFrom(idx) {
  let node = $('image-chat-log').querySelector(`.user-card[data-index="${idx}"]`);
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
  S.imageHistory.splice(idx);
  const lastImg = $('image-chat-log').querySelector(".ai img:last-of-type");
  if (lastImg) {
    S.selectedUrl = lastImg.src;
    S.baseImage = null;
  } else if ($('upload-input').files[0]) {
    S.baseImage = $('upload-input').files[0];
    S.selectedUrl = "";
  } else {
    S.selectedUrl = $('image-url').value.trim();
    S.baseImage = null;
  }
  // Update base64 reference
  updateReferenceImageBase64();
}
function deleteObjectFrom(idx) {
  let node = $('object-chat-log').querySelector(`.user-card[data-index="${idx}"]`);
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
  S.session.splice(idx);
}
function addImageUserCard(text) {
  const log = $('image-chat-log');
  log.insertAdjacentHTML(
    "beforeend",
    `<div class="card mb-3 shadow-sm user-card" data-index="${S.imageHistory.length}">
       <div class="card-body d-flex">
         <h6 class="h6 mb-0 flex-grow-1">${text}</h6>
         <button class="btn-close ms-2" aria-label="Delete"></button>
       </div>
     </div>`,
  );
  const card = log.lastElementChild;
  addHover(card);
  card.querySelector(".btn-close").addEventListener("click", () => deleteImageFrom(+card.dataset.index));
  log.scrollTop = log.scrollHeight;
  return card;
}
function addObjectUserCard(text) {
  const log = $('object-chat-log');
  log.insertAdjacentHTML(
    "beforeend",
    `<div class="card mb-3 shadow-sm user-card" data-index="${S.session.length}">
       <div class="card-body d-flex">
         <h6 class="h6 mb-0 flex-grow-1">${text}</h6>
         <button class="btn-close ms-2" aria-label="Delete"></button>
       </div>
     </div>`,
  );
  const card = log.lastElementChild;
  addHover(card);
  card.querySelector(".btn-close").addEventListener("click", () => deleteObjectFrom(+card.dataset.index));
  log.scrollTop = log.scrollHeight;
  return card;
}
function addImageCard(url) {
  const log = $('image-chat-log');
  log.insertAdjacentHTML(
    "beforeend",
    `<div class="card mb-3 shadow-sm ai">
       <img src="${url}" class="card-img-top img-fluid">
       <div class="card-body p-2">
         <a href="${url}" download class="btn btn-sm btn-outline-secondary">
           <i class="bi bi-download"></i>
         </a>
       </div>
     </div>`,
  );
  addHover(log.lastElementChild);
  log.scrollTop = log.scrollHeight;
}
function addBlank3DViewer() {
  const log = $('object-chat-log');
  viewerCounter++;
  const viewerId = `viewer-${viewerCounter}`;
  
  log.insertAdjacentHTML(
    "beforeend",
    `<div class="object-viewer-card" data-viewer-id="${viewerId}">
       <div class="card mb-3 shadow-sm">
         <div class="card-body p-0">
           <div class="viewer-container">
             <div class="blank-template w-100 h-100">
               <div class="text-center">
                 <div class="spinner-border text-primary mb-2" role="status"></div>
                 <div>Generating 3D Object.... will take (1-2 min)...</div>
               </div>
             </div>
           </div>
         </div>
       </div>
     </div>`,
  );
  
  log.scrollTop = log.scrollHeight;
  return viewerId;
}
function add3DViewer(code, viewerId) {
  const log = $('object-chat-log');
  const frameId = `frame-${viewerId}`;
  
  const viewerCard = log.querySelector(`[data-viewer-id="${viewerId}"]`);
  if (!viewerCard) return;
  viewerCard.innerHTML = render3DViewerHTML(viewerId, frameId);
  const frame = document.getElementById(frameId);
  frame.srcdoc = FRAME_TEMPLATE;
  const frameReadyHandler = (e) => {
    if (e.data.type === 'READY' && e.source === frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'RUN_CODE', code }, '*');
      S.currentFrame = frame; // Update current frame reference
    }
  };
  window.addEventListener('message', frameReadyHandler);
  setupViewerControls(viewerCard, frameId);
  log.scrollTop = log.scrollHeight;
}
function setupViewerControls(viewerCard, frameId) {
  const frame = document.getElementById(frameId);
  
  viewerCard.querySelector('.reset-camera')?.addEventListener('click', () => {
    frame.contentWindow.postMessage({ type: 'RESET_CAMERA' }, '*');
  });
  
  viewerCard.querySelector('.auto-rotate')?.addEventListener('click', (e) => {
    const isRotating = e.target.textContent === 'Stop Rotate';
    frame.contentWindow.postMessage({ type: 'TOGGLE_AUTO_ROTATE', value: !isRotating }, '*');
    e.target.textContent = isRotating ? 'Auto-Rotate' : 'Stop Rotate';
  });
  
  viewerCard.querySelector('.wireframe')?.addEventListener('click', (e) => {
    const isWireframe = e.target.textContent === 'Solid';
    frame.contentWindow.postMessage({ type: 'TOGGLE_WIREFRAME', value: !isWireframe }, '*');
    e.target.textContent = isWireframe ? 'Wireframe' : 'Solid';
  });
  
  // Individual export button for each viewer
  viewerCard.querySelector('.export-obj-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    frame.contentWindow.postMessage({ type: 'EXPORT_OBJ' }, '*');
  });
}
function selectImage() {
  if (S.baseImage || S.selectedUrl) return true;
  S.selectedUrl = $('image-url').value.trim();
  if (!S.selectedUrl) return true;
  $('preview-image').src = S.selectedUrl;
  $('preview-image').classList.remove("d-none");
  return true;
}
const buildImagePrompt = (p) =>
  S.imageHistory.length ? `${p}.\n\nFor context, here are previous messages:\n\n${S.imageHistory.join("\n")}\n\n${p}` : p;
const buildObjectPrompt = (p) =>
  S.session.length ? `${p}.\n\nFor context, here are previous messages:\n\n${S.session.map(s => s.prompt).join("\n")}\n\n${p}` : p;
async function makeImageRequest(prompt, opts) {
  const { apiKey, baseUrl } = await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, help: openaiHelp });
  if (!apiKey) {
    bootstrapAlert({ title: "OpenAI key missing", body: "Configure your key", color: "warning" });
    return null;
  }
  const endpoint = S.baseImage || S.selectedUrl ? "edits" : "generations";
  if (endpoint === "edits") {
    const blob = S.baseImage || (await fetch(S.selectedUrl).then((r) => r.blob()));
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("n", "1");
    Object.entries(opts).forEach(([k, v]) => form.append(k, v));
    form.append("image", blob, "image.png");
    return fetch(`https://llmfoundry.straive.com/openai/v1/images/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  }
  return fetch(`https://llmfoundry.straive.com/openai/v1/images/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, ...opts }),
  });
}
async function handleImageResponse(resp, userCard, prompt) {
  if (!resp || !resp.ok) {
    const text = resp ? await resp.text() : "";
    userCard.remove();
    restoreImagePrompt(prompt);
    bootstrapAlert({ title: prompt, body: `${resp?.status || "?"}: ${text}`, color: "danger" });
    return null;
  }
  const data = await resp.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    userCard.remove();
    restoreImagePrompt(prompt);
    bootstrapAlert({ title: "Generation failed", body: JSON.stringify(data), color: "danger" });
    return null;
  }
  return `data:image/png;base64,${b64}`;
}
async function generateImage() {
  const prompt = $('image-prompt-input').value.trim();
  if (!prompt) {
    bootstrapAlert({ title: "Prompt missing", body: "Describe the image/modification", color: "warning" });
    return;
  }
  if (!selectImage()) return;
  const card = addImageUserCard(prompt);
  $('image-prompt-input').value = "";
  startImageLoading(); // Show loading inside image chat
  const opts = collectImageOptions();
  const fullPrompt = buildImagePrompt(prompt);
  try {
    const resp = await makeImageRequest(fullPrompt, opts);
    const url = await handleImageResponse(resp, card, prompt);
    if (!url) return;
    addImageCard(url);
    S.selectedUrl = url;
    S.baseImage = null;
    S.imageHistory.push(prompt);
    $('preview-image').src = url;
    $('preview-image').classList.remove('d-none');
    await updateReferenceImageBase64();
  } catch (err) {
    card.remove();
    restoreImagePrompt(prompt);
    bootstrapAlert({ title: "Generation error", body: err.message, color: "danger" });
  } finally {
    stopImageLoading(); // Hide loading from image chat
  }
}
// 3D Object Generation Functions - Modified to use base64
async function llmGenerate3D({ promptText, priorCode, screenshotDataUrl }) {
  const { apiKey, baseUrl } = await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, help: openaiHelp });
  if (!apiKey) throw new Error('OpenAI key missing. Please configure your key.');
  if (!S.selectedModel) {
    throw new Error('Please select a model for 3D generation.');
  }
  const messages = [{ role: "system", content: System_prompt }];
  if (priorCode && screenshotDataUrl) {
    const content = [
      {
        type: "text",
        text: `Task: Modify the existing Three.js scene per: "${promptText}"\n\nCurrent code:\n${priorCode}\n\nA screenshot of the current render is attached. Please update the code so that the 3D object matches the requested modifications and target dimensions.`
      },
      { type: "image_url", image_url: { url: screenshotDataUrl } }
    ];
    // Use base64 version for 3D generation
    if (S.referenceImageBase64) {
      content.push(
        {
          type: "text",
          text: "Additionally, a reference image is provided to guide the modifications. Focus only on the main object, not any ground or base elements."
        },
        {
          type: "image_url", image_url: { url: S.referenceImageBase64 }
        }
      );
    }
    messages.push({ role: "user", content });
  } else {
    const content = [
      {
        type: "text",
        text: `Task: Create a 3D scene per: "${promptText}"\nConstraints:\n- No imports; the runtime provides THREE, OrbitControls as parameters.\n- Add reasonable lights and camera framing of subject.\n- Use new OrbitControls(camera, renderer.domElement) if needed.\n- Return ONLY code for export default function renderScene({ THREE, scene, camera, renderer, controls, OrbitControls }) { ... }.\n- CRITICAL: Do NOT create any ground plane, base, floor, or platform. Create ONLY the requested 3D object floating in space.\n- Scale the object to match the target dimensions provided.\n- The scene already has a grid for reference - do not add PlaneGeometry or ground meshes.`
      }
    ];
    // Use base64 version for 3D generation
    if (S.referenceImageBase64) {
      content.push({ type: "image_url", image_url: { url: S.referenceImageBase64 } });
      content[0].text += "\n\nA reference image is provided to guide the 3D object creation. Focus only on the main object, ignoring any ground or base elements in the reference.";
    }
    messages.push({ role: "user", content });
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: S.selectedModel,
      messages,
    }),
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No content received from API');
  }
  return content.replace(/^```(?:js|javascript)?\s*/i, "").replace(/```$/i, "").trim();
}
const getScreenshot = (frame) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    window.removeEventListener('message', handler);
    reject(new Error('Screenshot timeout'));
  }, 10000);
  const handler = e => {
    if (e.data.type === 'SCREENSHOT' && e.source === frame.contentWindow) {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(e.data.dataUrl);
    }
  };
  window.addEventListener('message', handler);
  frame.contentWindow.postMessage({ type: 'GET_SCREENSHOT' }, '*');
});
async function generate3DObject() {
  const prompt = $('object-prompt-input').value.trim();
  if (!prompt) {
    bootstrapAlert({ title: "Prompt missing", body: "Describe the 3D object/modification", color: "warning" });
    return;
  }
  if (!S.selectedModel) {
    bootstrapAlert({ title: "Model missing", body: "Please select a model for 3D generation", color: "warning" });
    return;
  }
  const card = addObjectUserCard(prompt);
  const viewerId = addBlank3DViewer(); // This shows loading inside 3D chat
  $('object-prompt-input').value = "";
  startObjectLoading(); // Only sets loading state, no UI
  try {
    let screenshotDataUrl = null;
    if (S.sourceCode && S.currentFrame) {
      try {
        screenshotDataUrl = await getScreenshot(S.currentFrame);
      } catch (error) {
        console.warn('Failed to capture screenshot:', error);
      }
    }
    const fullPrompt = buildObjectPrompt(prompt);
    const code = await llmGenerate3D({ promptText: fullPrompt, priorCode: S.sourceCode, screenshotDataUrl });
    if (code) {
      S.sourceCode = code;
      add3DViewer(code, viewerId);
      S.session.push({
        prompt: prompt,
        code,
        screenshot: screenshotDataUrl,
        referenceImage: S.referenceImageBase64, // Store base64 version
        timestamp: Date.now()
      });
      bootstrapAlert({ title: "Success", body: "3D object generated successfully", color: "success" });
    } else {
      bootstrapAlert({ title: "Generation failed", body: "No code generated. Please try again.", color: "warning" });
    }
  } catch (error) {
    console.error('Generation error:', error);
    card.remove();
    // Remove the blank viewer too
    const viewerCard = $('object-chat-log').querySelector(`[data-viewer-id="${viewerId}"]`);
    if (viewerCard) viewerCard.remove();
    
    restoreObjectPrompt(prompt);
    bootstrapAlert({ title: "Generation error", body: error.message, color: "danger" });
  } finally {
    stopObjectLoading(); // Reset loading state
  }
}
// UI Setup Functions
function setupImageHandling() {
  const uploadInput = $('upload-input');
  const urlInput = $('image-url');
  const preview = $('preview-image');
  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    S.baseImage = file;
    S.selectedUrl = "";
    urlInput.value = "";
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('d-none');
    
    // Update base64 reference
    await updateReferenceImageBase64();
  });
  urlInput.addEventListener('input', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      preview.classList.add('d-none');
      S.selectedUrl = "";
      S.referenceImageBase64 = null;
      return;
    }
    S.selectedUrl = url;
    S.baseImage = null;
    uploadInput.value = "";
    preview.src = url;
    preview.classList.remove('d-none');
    
    // Update base64 reference
    await updateReferenceImageBase64();
  });
  // Sample images
  const samplesContainer = $('samples');
  samplesContainer.addEventListener('click', async (e) => {
    const card = e.target.closest('.sample');
    if (!card) return;
    S.selectedUrl = card.dataset.url;
    $('image-prompt-input').value = card.dataset.prompt;
    S.baseImage = null;
    uploadInput.value = "";
    urlInput.value = S.selectedUrl;
    preview.src = S.selectedUrl;
    preview.classList.remove('d-none');
    document.querySelectorAll('#samples .sample .card').forEach((c) => c.classList.remove('border-primary'));
    card.querySelector('.card').classList.add('border-primary');
    
    // Update base64 reference
    await updateReferenceImageBase64();
  });
}
function setup3DControls() {
  const dimX = $('dim-x');
  const dimY = $('dim-y');
  const dimZ = $('dim-z');
  const xValue = $('x-value');
  const yValue = $('y-value');
  const zValue = $('z-value');
  dimX.addEventListener('input', () => {
    S.dimensions.x = parseFloat(dimX.value);
    xValue.textContent = S.dimensions.x.toFixed(1);
  });
  dimY.addEventListener('input', () => {
    S.dimensions.y = parseFloat(dimY.value);
    yValue.textContent = S.dimensions.y.toFixed(1);
  });
  dimZ.addEventListener('input', () => {
    S.dimensions.z = parseFloat(dimZ.value);
    zValue.textContent = S.dimensions.z.toFixed(1);
  });
  // Model selection
  $('model-select').addEventListener('change', (e) => {
    S.selectedModel = e.target.value;
  });
}
// Frame Message Handler
const handleFrameMessages = e => {
  const { type, data, filename, mimeType, binary, count } = e.data;
  if (type === 'ERROR') {
    bootstrapAlert({ title: "3D Error", body: e.data.message, color: "danger" });
  } else if (type === 'OBJECTS_READY') {
    // Enable export button for the specific viewer that's ready
    const activeViewer = $('object-chat-log').querySelector('.object-viewer-card:last-child');
    if (activeViewer && e.source === S.currentFrame?.contentWindow) {
      const exportBtn = activeViewer.querySelector('.export-obj-btn');
      if (exportBtn) {
        exportBtn.disabled = count === 0;
      }
      if (count > 0) {
        bootstrapAlert({ title: "Success", body: `3D scene ready for export (${count} objects)`, color: "success" });
      }
    }
  } else if (type === 'SIZE_UPDATE') {
    // Update size display for the current active frame
    const activeViewer = $('object-chat-log').querySelector('.object-viewer-card:last-child');
    if (activeViewer && e.source === S.currentFrame?.contentWindow) {
      const { x, y, z } = e.data;
      activeViewer.querySelector('.size-x').textContent = x.toFixed(2);
      activeViewer.querySelector('.size-y').textContent = y.toFixed(2);
      activeViewer.querySelector('.size-z').textContent = z.toFixed(2);
    }
  } else if (type === 'DOWNLOAD') {
    try {
      let blob;
      if (binary) {
        const binaryString = window.atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: mimeType });
      } else {
        blob = new Blob([data], { type: mimeType });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      bootstrapAlert({ title: "Success", body: `${filename} downloaded successfully`, color: "success" });
    } catch (error) {
      console.error('Download error:', error);
      bootstrapAlert({ title: "Download failed", body: error.message, color: "danger" });
    }
  }
};
// Load Sample Images
function loadSamples() {
  fetch("config.json")
    .then((r) => r.json())
    .then(({ samples }) => {
      const samplesContainer = $('samples');
      samples.forEach(({ title, image, prompt }) => {
        samplesContainer.insertAdjacentHTML(
          "beforeend",
          `<div class="col sample" data-url="${image}" data-prompt="${prompt}">
             <div class="card h-100 shadow-sm cursor-pointer">
               <img src="${image}" class="card-img-top object-fit-cover" style="height:120px" alt="${title}">
               <div class="card-body p-2">
                 <small class="card-title">${title}</small>
               </div>
             </div>
           </div>`,
        );
        addHover(samplesContainer.lastElementChild.querySelector(".card"));
      });
    })
    .catch((err) => bootstrapAlert({ title: "Config error", body: err.message, color: "danger" }));
}
// Event Listeners
function addEventListeners() {
  $('openai-config-btn').addEventListener('click', async () => {
    await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, show: true, help: openaiHelp });
    await loadModels(); // Reload models after configuration
  });
  $('image-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    generateImage();
  });
  $('object-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    generate3DObject();
  });
}
// Initialize Application
function init() {
  addEventListeners();
  setupImageHandling();
  setup3DControls();
  loadSamples();
  loadModels();
  window.addEventListener('message', handleFrameMessages);
}
// Start the application
init();