import { System_prompt, FRAME_TEMPLATE, render3DViewerHTML } from "./utils.js";
import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1";
import { openaiHelp } from "https://tools.s-anand.net/common/aiconfig.js";
import { bootstrapAlert } from "https://cdn.jsdelivr.net/npm/bootstrap-alert@1";

const $ = id => document.getElementById(id);
const DEFAULT_BASE_URLS = [
  "https://openrouter.ai/api/v1", "https://llmfoundry.straivedemo.com/openrouter/v1",
];

const S = {
  baseImage: null,
  selectedUrl: "",
  imageHistory: [],
  sourceCode: "",
  session: [],
  dimensions: { x: 5.0, y: 5.0, z: 5.0 },
  currentFrame: null,
  availableModels: [],
  selectedImageModel: null,
  referenceImageBase64: null,
  imageLoading: false,
  objectLoading: false
};

let imageLoadingTimer, objectLoadingTimer, viewerCounter = 0;

// Utility functions
const msg = type => (type === 'image' ? 
  ["Painting pixels...", "Talking to the muse...", "Polishing details...", "Finalizing masterpiece..."] :
  ["Crafting geometry...", "Shaping vertices...", "Building meshes...", "Rendering object..."]
)[Math.floor(Math.random() * 4)];

const hideDeletes = hide => document.querySelectorAll(".user-card .btn-close").forEach(b => b.classList.toggle("invisible", hide));

// Loading functions
const toggleLoading = (type, start) => {
  const isImage = type === 'image';
  const stateKey = isImage ? 'imageLoading' : 'objectLoading';
  const timerKey = isImage ? 'imageLoadingTimer' : 'objectLoadingTimer';
  
  if (S[stateKey] === start) return;
  S[stateKey] = start;
  
  if (start && isImage) {
    const log = $('image-chat-log');
    log.insertAdjacentHTML("beforeend",
      `<div id="image-loading-card" class="card mb-3 shadow-sm">
         <div class="card-body text-center py-4">
           <div class="spinner-border text-primary mb-2"></div>
           <div id="image-loading-msg">Generating ${type} (1-2 min)... ${msg(type)}</div>
         </div>
       </div>`);
    log.scrollTop = log.scrollHeight;
    window[timerKey] = setInterval(() => {
      const msgEl = $('image-loading-msg');
      if (msgEl) msgEl.textContent = `Generating ${type} (1-2 min)... ${msg(type)}`;
    }, 5000);
  } else if (!start && isImage) {
    clearInterval(window[timerKey]);
    $('image-loading-card')?.remove();
  }
  
  hideDeletes(start);
};

// Image conversion
const imageToBase64 = imageSource => new Promise((resolve, reject) => {
  if (imageSource instanceof File) {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(imageSource);
  } else if (typeof imageSource === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL('image/png'));
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

const updateReferenceImageBase64 = async () => {
  try {
    S.referenceImageBase64 = S.baseImage ? await imageToBase64(S.baseImage) :
                              S.selectedUrl ? await imageToBase64(S.selectedUrl) : null;
  } catch (error) {
    console.warn('Failed to convert reference image to base64:', error);
    S.referenceImageBase64 = null;
  }
};

// Model management
const loadModels = async () => {
  try {
    const config = await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, help: openaiHelp });
    if (config.models?.length) {
      S.availableModels = config.models.filter(model => {
        const m = model.toLowerCase();
        return m.includes("gemini") || m.includes("gpt-4") || m.includes("claude");
      });
      updateModelDropdowns();
      if (!S.selectedImageModel) {
        S.selectedImageModel = S.availableModels.find(m => 
          m.toLowerCase() === "google/gemini-2.5-flash-image-preview") || S.availableModels[0];
        if ($('image-model-select')) $('image-model-select').value = S.selectedImageModel;
      }
    }
  } catch (error) {
    console.warn('Failed to load models:', error);
  }
};

const updateModelDropdowns = () => {
  ['image-model-select', '3d-model-select'].forEach(id => {
    const select = $(id);
    if (select) {
      select.innerHTML = `<option value="">Select ${id.includes('image') ? 'Image' : id.includes('3d') ? '3D' : ''} Model...</option>`;
      S.availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model + 
          (model.toLowerCase().includes("image-preview") ? " (Recommended for Images)" :
           model.toLowerCase().includes("gemini-2.5-pro") && !model.toLowerCase().includes("image-preview") ? " (Recommended for 3D)" : "");
        select.appendChild(option);
      });
    }
  });
};

// UI utility functions
const addHover = card => {
  card.classList.add("cursor-pointer");
  card.addEventListener("mouseenter", () => card.classList.add("shadow"));
  card.addEventListener("mouseleave", () => card.classList.remove("shadow"));
};

const deleteFrom = (type, idx) => {
  const isImage = type === 'image';
  const log = $(isImage ? 'image-chat-log' : 'object-chat-log');
  let node = log.querySelector(`.user-card[data-index="${idx}"]`);
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
  
  if (isImage) {
    S.imageHistory.splice(idx);
    const lastImg = log.querySelector(".ai img:last-of-type");
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
    updateReferenceImageBase64();
  } else {
    S.session.splice(idx);
  }
};

const addUserCard = (type, text) => {
  const isImage = type === 'image';
  const log = $(isImage ? 'image-chat-log' : 'object-chat-log');
  const index = isImage ? S.imageHistory.length : S.session.length;
  
  log.insertAdjacentHTML("beforeend",
    `<div class="card mb-3 shadow-sm user-card" data-index="${index}">
       <div class="card-body d-flex">
         <h6 class="h6 mb-0 flex-grow-1">${text}</h6>
         <button class="btn-close ms-2" aria-label="Delete"></button>
       </div>
     </div>`);
     
  const card = log.lastElementChild;
  addHover(card);
  card.querySelector(".btn-close").addEventListener("click", () => deleteFrom(type, +card.dataset.index));
  log.scrollTop = log.scrollHeight;
  return card;
};

const addImageCard = url => {
  const log = $('image-chat-log');
  log.insertAdjacentHTML("beforeend",
    `<div class="card mb-3 shadow-sm ai">
       <img src="${url}" class="card-img-top img-fluid">
       <div class="card-body p-2">
         <a href="${url}" download class="btn btn-sm btn-outline-secondary">
           <i class="bi bi-download"></i>
         </a>
       </div>
     </div>`);
  addHover(log.lastElementChild);
  log.scrollTop = log.scrollHeight;
};

const add3DViewer = (code, viewerId) => {
  const log = $('object-chat-log');
  const frameId = `frame-${viewerId}`;
  const viewerCard = log.querySelector(`[data-viewer-id="${viewerId}"]`);
  
  if (viewerCard) {
    viewerCard.innerHTML = render3DViewerHTML(viewerId, frameId);
    const frame = $(frameId);
    frame.srcdoc = FRAME_TEMPLATE;
    
    const frameReadyHandler = e => {
      if (e.data.type === 'READY' && e.source === frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'RUN_CODE', code }, '*');
        S.currentFrame = frame;
      }
    };
    window.addEventListener('message', frameReadyHandler);
    setupViewerControls(viewerCard, frameId);
    log.scrollTop = log.scrollHeight;
  }
};

const setupViewerControls = (viewerCard, frameId) => {
  const frame = $(frameId);
  const controls = {
    '.reset-camera': () => frame.contentWindow.postMessage({ type: 'RESET_CAMERA' }, '*'),
    '.auto-rotate': e => {
      const isRotating = e.target.textContent === 'Stop Rotate';
      frame.contentWindow.postMessage({ type: 'TOGGLE_AUTO_ROTATE', value: !isRotating }, '*');
      e.target.textContent = isRotating ? 'Auto-Rotate' : 'Stop Rotate';
    },
    '.wireframe': e => {
      const isWireframe = e.target.textContent === 'Solid';
      frame.contentWindow.postMessage({ type: 'TOGGLE_WIREFRAME', value: !isWireframe }, '*');
      e.target.textContent = isWireframe ? 'Wireframe' : 'Solid';
    },
    '.export-obj-btn': e => {
      e.preventDefault();
      frame.contentWindow.postMessage({ type: 'EXPORT_OBJ' }, '*');
    }
  };
  
  Object.entries(controls).forEach(([selector, handler]) => {
    viewerCard.querySelector(selector)?.addEventListener('click', handler);
  });
};

const buildPrompt = (prompt, isImage) => 
  (isImage ? S.imageHistory : S.session.map(s => s.prompt)).length ? 
  `${prompt}.\n\nFor context, here are previous messages:\n\n${(isImage ? S.imageHistory : S.session.map(s => s.prompt)).join("\n")}\n\n${prompt}` : prompt;

// API calls
const llmGenerateImage = async ({ promptText, referenceImageBase64, isEdit }) => {
  const { apiKey, baseUrl } = await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, help: openaiHelp });
  if (!apiKey) throw new Error('OpenAI key missing. Please configure your key.');
  
  const imageModel = S.selectedImageModel || "google/gemini-2.5-flash-image-preview";
  const messages = [{
    role: "user",
    content: isEdit && referenceImageBase64 ? [
      {
        type: "text",
        text: `Please analyze this image and generate a new image with the following modifications: ${promptText}\n\nInstructions:\n- Carefully examine the provided image\n- Apply the requested modifications while maintaining the overall quality and style\n- Keep the composition coherent and visually appealing\n- Make the changes as natural and realistic as possible\n\nGenerate a new image that incorporates these changes.`
      },
      { type: "image_url", image_url: { url: referenceImageBase64 } }
    ] : [{
      type: "text",
      text: `Generate a high-quality image based on this description: ${promptText}\n\nPlease create a detailed, visually appealing image that accurately represents the described scene, object, or concept. Focus on:\n- High visual quality and detail\n- Proper composition and lighting\n- Realistic or appropriate artistic style\n- Clear representation of the described elements`
    }]
  }];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.origin,
      "X-Title": "Image Generator App"
    },
    body: JSON.stringify({ model: imageModel, messages })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  
  if (!message) throw new Error('No message received from API');
  
  if (message.images?.[0]?.image_url?.url) return message.images[0].image_url.url;
  if (message.content?.includes('data:image')) return message.content;
  if (message.content) throw new Error(`No image generated. API returned text: ${message.content.substring(0, 200)}...`);
  
  throw new Error('No image or content received from API');
};

const llmGenerate3D = async ({ promptText, priorCode, screenshotDataUrl }) => {
  const { apiKey, baseUrl } = await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, help: openaiHelp });
  if (!apiKey) throw new Error('OpenAI key missing. Please configure your key.');
  
  const threeDModel = "google/gemini-2.5-pro";
  const messages = [{ role: "system", content: System_prompt }];

  const content = priorCode && screenshotDataUrl ? [
    { type: "text", text: `Task: Modify the existing Three.js scene per: "${promptText}"\n\nCurrent code:\n${priorCode}\n\nA screenshot of the current render is attached. Please update the code so that the 3D object matches the requested modifications and target dimensions.` },
    { type: "image_url", image_url: { url: screenshotDataUrl } }
  ] : [{
    type: "text",
    text: `Task: Create a 3D scene per: "${promptText}"\nConstraints:\n- No imports; the runtime provides THREE, OrbitControls as parameters.\n- Add reasonable lights and camera framing of subject.\n- Use new OrbitControls(camera, renderer.domElement) if needed.\n- Return ONLY code for export default function renderScene({ THREE, scene, camera, renderer, controls, OrbitControls }) { ... }.\n- CRITICAL: Do NOT create any ground plane, base, floor, or platform. Create ONLY the requested 3D object floating in space.\n- Scale the object to match the target dimensions provided.\n- The scene already has a grid for reference - do not add PlaneGeometry or ground meshes.`
  }];

  if (S.referenceImageBase64) {
    content.push(
      { type: "text", text: "Additionally, a reference image is provided to guide the modifications. Focus only on the main object, not any ground or base elements." },
      { type: "image_url", image_url: { url: S.referenceImageBase64 } }
    );
  }
  
  messages.push({ role: "user", content });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: threeDModel, messages })
  });

  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  
  const data = await response.json();
  const content_result = data.choices?.[0]?.message?.content;
    if (!content_result) throw new Error('No content received from API');
  
  return content_result.replace(/^```(?:js|javascript)?\s*/i, "").replace(/```$/i, "").trim();
};

// Generation functions
const generateImage = async () => {
  const prompt = $('image-prompt-input').value.trim();
  if (!prompt) return bootstrapAlert({ title: "Prompt missing", body: "Describe the image/modification", color: "warning" });
  if (!S.selectedImageModel) return bootstrapAlert({ title: "Model missing", body: "Please select a model for image generation", color: "warning" });

  const card = addUserCard('image', prompt);
  $('image-prompt-input').value = "";
  toggleLoading('image', true);

  try {
    const fullPrompt = buildPrompt(prompt, true);
    const isEdit = !!S.referenceImageBase64;
    const imageDataUrl = await llmGenerateImage({ promptText: fullPrompt, referenceImageBase64: S.referenceImageBase64, isEdit });

    if (imageDataUrl) {
      addImageCard(imageDataUrl);
      S.selectedUrl = imageDataUrl;
      S.baseImage = null;
      S.imageHistory.push(prompt);
      $('preview-image').src = imageDataUrl;
      $('preview-image').classList.remove('d-none');
      await updateReferenceImageBase64();
      bootstrapAlert({ title: "Success", body: "Image generated successfully", color: "success" });
    } else {
      throw new Error('No image data received');
    }
  } catch (error) {
    card.remove();
    $('image-prompt-input').value = prompt;
    bootstrapAlert({ title: "Generation error", body: error.message, color: "danger" });
  } finally {
    toggleLoading('image', false);
  }
};

const generate3DObject = async () => {
  const prompt = $('object-prompt-input').value.trim();
  if (!prompt) return bootstrapAlert({ title: "Prompt missing", body: "Describe the 3D object/modification", color: "warning" });
  const card = addUserCard('object', prompt);
  const viewerId = `viewer-${++viewerCounter}`;
  
  $('object-chat-log').insertAdjacentHTML("beforeend",
    `<div class="object-viewer-card" data-viewer-id="${viewerId}">
       <div class="card mb-3 shadow-sm">
         <div class="card-body p-0">
           <div class="viewer-container">
             <div class="blank-template w-100 h-100">
               <div class="text-center">
                 <div class="spinner-border text-primary mb-2"></div>
                 <div>Generating 3D Object.... will take (1-2 min)...</div>
               </div>
             </div>
           </div>
         </div>
       </div>
     </div>`);
  
  $('object-prompt-input').value = "";
  toggleLoading('object', true);

  try {
    let screenshotDataUrl = null;
    if (S.sourceCode && S.currentFrame) {
      try {
        screenshotDataUrl = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Screenshot timeout')), 10000);
          const handler = e => {
            if (e.data.type === 'SCREENSHOT' && e.source === S.currentFrame.contentWindow) {
              clearTimeout(timeout);
              window.removeEventListener('message', handler);
              resolve(e.data.dataUrl);
            }
          };
          window.addEventListener('message', handler);
          S.currentFrame.contentWindow.postMessage({ type: 'GET_SCREENSHOT' }, '*');
        });
      } catch (error) {
        console.warn('Failed to capture screenshot:', error);
      }
    }

    const code = await llmGenerate3D({ 
      promptText: buildPrompt(prompt, false), 
      priorCode: S.sourceCode, 
      screenshotDataUrl 
    });
    
    if (code) {
      S.sourceCode = code;
      add3DViewer(code, viewerId);
      S.session.push({ prompt, code, screenshot: screenshotDataUrl, referenceImage: S.referenceImageBase64, timestamp: Date.now() });
      bootstrapAlert({ title: "Success", body: "3D object generated successfully", color: "success" });
    } else {
      throw new Error('No code generated');
    }
  } catch (error) {
    card.remove();
    $('object-chat-log').querySelector(`[data-viewer-id="${viewerId}"]`)?.remove();
    $('object-prompt-input').value = prompt;
    bootstrapAlert({ title: "Generation error", body: error.message, color: "danger" });
  } finally {
    toggleLoading('object', false);
  }
};

// Setup functions
const setupImageHandling = () => {
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
    await updateReferenceImageBase64();
  });

  $('samples')?.addEventListener('click', async e => {
    const card = e.target.closest('.sample');
    if (!card) return;
    S.selectedUrl = card.dataset.url;
    $('image-prompt-input').value = card.dataset.prompt;
    S.baseImage = null;
    uploadInput.value = "";
    urlInput.value = S.selectedUrl;
    preview.src = S.selectedUrl;
    preview.classList.remove('d-none');
    document.querySelectorAll('#samples .sample .card').forEach(c => c.classList.remove('border-primary'));
    card.querySelector('.card').classList.add('border-primary');
    await updateReferenceImageBase64();
  });
};

const setup3DControls = () => {
  ['x', 'y', 'z'].forEach(axis => {
    const slider = $(`dim-${axis}`);
    const value = $(`${axis}-value`);
    slider?.addEventListener('input', () => {
      S.dimensions[axis] = parseFloat(slider.value);
      value.textContent = S.dimensions[axis].toFixed(1);
    });
  });

  const modelHandlers = {
    'image-model-select': v => S.selectedImageModel = v
  };

  Object.entries(modelHandlers).forEach(([id, handler]) => {
    $(id)?.addEventListener('change', e => handler(e.target.value));
  });
};

// Message handler
const handleFrameMessages = e => {
  const { type, data, filename, mimeType, binary, count } = e.data;
  
  if (type === 'ERROR') {
    bootstrapAlert({ title: "3D Error", body: e.data.message, color: "danger" });
  } else if (type === 'OBJECTS_READY') {
    const activeViewer = $('object-chat-log').querySelector('.object-viewer-card:last-child');
    if (activeViewer && e.source === S.currentFrame?.contentWindow) {
      const exportBtn = activeViewer.querySelector('.export-obj-btn');
      if (exportBtn) exportBtn.disabled = count === 0;
      if (count > 0) bootstrapAlert({ title: "Success", body: `3D scene ready for export (${count} objects)`, color: "success" });
    }
  } else if (type === 'SIZE_UPDATE') {
    const activeViewer = $('object-chat-log').querySelector('.object-viewer-card:last-child');
    if (activeViewer && e.source === S.currentFrame?.contentWindow) {
      const { x, y, z } = e.data;
      activeViewer.querySelector('.size-x').textContent = x.toFixed(2);
      activeViewer.querySelector('.size-y').textContent = y.toFixed(2);
      activeViewer.querySelector('.size-z').textContent = z.toFixed(2);
    }
  } else if (type === 'DOWNLOAD') {
    try {
      const blob = binary ? 
        new Blob([new Uint8Array(atob(data).split('').map(c => c.charCodeAt(0)))], { type: mimeType }) :
        new Blob([data], { type: mimeType });
      
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      bootstrapAlert({ title: "Success", body: `${filename} downloaded successfully`, color: "success" });
    } catch (error) {
      bootstrapAlert({ title: "Download failed", body: error.message, color: "danger" });
    }
  }
};

// Load samples
const loadSamples = () => {
  fetch("config.json")
    .then(r => r.json())
    .then(({ samples }) => {
      const container = $('samples');
      samples.forEach(({ title, image, prompt }) => {
        container.insertAdjacentHTML("beforeend",
          `<div class="col sample" data-url="${image}" data-prompt="${prompt}">
             <div class="card h-100 shadow-sm cursor-pointer">
               <img src="${image}" class="card-img-top object-fit-cover" style="height:120px" alt="${title}">
               <div class="card-body p-2">
                 <small class="card-title">${title}</small>
               </div>
             </div>
           </div>`);
        addHover(container.lastElementChild.querySelector(".card"));
      });
    })
    .catch(err => bootstrapAlert({ title: "Config error", body: err.message, color: "danger" }));
};

// Initialize
(() => {
  $('openai-config-btn')?.addEventListener('click', async () => {
    await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, show: true, help: openaiHelp });
    await loadModels();
  });

  $('image-chat-form')?.addEventListener('submit', e => { e.preventDefault(); generateImage(); });
  $('object-chat-form')?.addEventListener('submit', e => { e.preventDefault(); generate3DObject(); });

  setupImageHandling();
  setup3DControls();
  loadSamples();
  loadModels();
  window.addEventListener('message', handleFrameMessages);
})();