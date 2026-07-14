#!/usr/bin/env node

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const OpenAI = require('openai');
const Replicate = require('replicate');

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY
});

const app = express();
const PORT = process.env.PORT || 3100;
const LOG_FILE = path.join(__dirname, 'appdata', 'merge-logs.json');
const UPLOADS_DIR = path.join(__dirname, 'appdata', 'uploads');

// OpenAI API Key aus Environment
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

// Basic Auth Middleware
function basicAuth(req, res, next) {
  const auth = req.headers.authorization;
  
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  
  const [scheme, credentials] = auth.split(' ');
  if (scheme !== 'Basic') {
    return res.status(401).send('Invalid auth scheme');
  }
  
  const [username, password] = Buffer.from(credentials, 'base64').toString().split(':');
  
  // Admin credentials from env or default
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'merge2026';
  
  if (username === adminUser && password === adminPass) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('Invalid credentials');
  }
}

// Create uploads directory
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Save images and metadata
async function saveImageSet(ip, style, image1Base64, image2Base64, resultUrl, metadata) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionId = crypto.randomUUID();
  const sessionDir = path.join(UPLOADS_DIR, timestamp);
  
  fs.mkdirSync(sessionDir, { recursive: true });
  
  // Save source images (base64 -> file)
  const image1Path = path.join(sessionDir, `${sessionId}_source1.jpg`);
  const image2Path = path.join(sessionDir, `${sessionId}_source2.jpg`);
  const resultPath = path.join(sessionDir, `${sessionId}_result.jpg`);
  const metaPath = path.join(sessionDir, `${sessionId}_meta.json`);
  
  // Decode base64 and save
  fs.writeFileSync(image1Path, image1Base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  fs.writeFileSync(image2Path, image2Base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  
  // Download result image from DALL-E URL
  await downloadImage(resultUrl, resultPath);
  
  // Save metadata
  const meta = {
    sessionId: sessionId,
    timestamp: new Date().toISOString(),
    ip: ip,
    style: style,
    files: {
      source1: path.basename(image1Path),
      source2: path.basename(image2Path),
      result: path.basename(resultPath)
    },
    ...metadata
  };
  
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  
  return {
    sessionDir: timestamp,
    sessionId: sessionId,
    meta: meta
  };
}

// Download image from URL
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const fileStream = fs.createWriteStream(filepath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {}); // Delete partial file
      reject(err);
    });
  });
}

// Log merge activity
function logMerge(ip, style, sessionDir, sessionId) {
  const logs = readLogs();
  logs.push({
    timestamp: new Date().toISOString(),
    ip: ip,
    style: style,
    sessionDir: sessionDir,
    sessionId: sessionId
  });
  
  // Keep last 1000 entries
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }
  
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

function readLogs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading logs:', err);
  }
  return [];
}

// Style-Presets
const STYLE_PRESETS = {
  realistic: {
    name: 'Realistisch',
    suffix: 'Create a photorealistic image with detailed textures and natural lighting.'
  },
  toy: {
    name: 'Spielzeug',
    suffix: 'Create this as a cute, colorful toy or action figure with plastic/vinyl texture, rounded edges, and playful proportions. Think collectible toy style.'
  },
  cute_monster: {
    name: 'Niedliche Monster',
    suffix: 'Transform into cute/adorable anthropomorphic 3D character, giant googly eyes, exaggerated happy expressions, chubby rounded body, smooth 3D render, vibrant pastel colors, Pixar style.'
  },
  brainrot: {
    name: 'Brainrot (cursed)',
    suffix: 'Transform into ONE SINGLE cursed 3D creature. Style: Italy brainrot memes, uncanny valley, slightly wrong proportions, bulging eyes, unsettling smile, oversaturated colors. NOT cute - creepy. ONE creature only, centered, merged hybrid.'
  },
  fusion: {
    name: 'Kreatur-Fusion',
    suffix: 'Create ONE single hybrid creature that merges both concepts into a unified being. Single body, single head, genetic chimera style, centered composition.'
  }
};

// Model Presets - separate from styles
const MODEL_PRESETS = {
  // Legacy value kept for old browsers with localStorage set to "dalle3".
  // Image generation must go through Replicate; OpenAI is used only for text/vision descriptions.
  dalle3: {
    name: 'Flux Schnell',
    provider: 'replicate',
    model: 'black-forest-labs/flux-schnell',
    inputDefaults: { aspect_ratio: '1:1', output_format: 'webp' }
  },
  flux_schnell: {
    name: 'Flux Schnell',
    provider: 'replicate',
    model: 'black-forest-labs/flux-schnell',
    inputDefaults: { aspect_ratio: '1:1', output_format: 'webp' }
  },
  flux_pro: {
    name: 'Flux Pro (HQ)',
    provider: 'replicate',
    model: 'black-forest-labs/flux-1.1-pro',
    inputDefaults: { aspect_ratio: '1:1', output_format: 'webp' }
  },
  flux_2_klein: {
    name: 'Flux 2 Klein',
    provider: 'replicate',
    model: 'black-forest-labs/flux-2-klein-4b',
    inputDefaults: { aspect_ratio: '1:1', output_format: 'webp' }
  },
  imagen: {
    name: 'Imagen 4 Fast',
    provider: 'replicate',
    model: 'google/imagen-4-fast',
    inputDefaults: { aspect_ratio: '1:1' }
  },
  qwen_image: {
    name: 'Qwen Image',
    provider: 'replicate',
    model: 'qwen/qwen-image',
    inputDefaults: { aspect_ratio: '1:1', output_format: 'webp' }
  },
  recraft_v3: {
    name: 'Recraft v3',
    provider: 'replicate',
    model: 'recraft-ai/recraft-v3',
    inputDefaults: { aspect_ratio: '1:1' }
  },
  ideogram_v3: {
    name: 'Ideogram v3 Turbo',
    provider: 'replicate',
    model: 'ideogram-ai/ideogram-v3-turbo',
    inputDefaults: { aspect_ratio: '1:1', magic_prompt_option: 'Auto' }
  },
  sd35_turbo: {
    name: 'Stable Diffusion 3.5 Turbo',
    provider: 'replicate',
    model: 'stability-ai/stable-diffusion-3.5-large-turbo',
    inputDefaults: { aspect_ratio: '1:1', output_format: 'webp' }
  },
  sdxl_lightning: {
    name: 'SDXL Lightning',
    provider: 'replicate',
    model: 'bytedance/sdxl-lightning-4step',
    inputDefaults: { width: 768, height: 768, num_outputs: 1 }
  },
  proteus_anime: {
    name: 'Proteus Anime',
    provider: 'replicate',
    model: 'datacte/proteus-v0.3',
    inputDefaults: { width: 768, height: 768, num_outputs: 1 }
  },
  realistic_vision: {
    name: 'Realistic Vision',
    provider: 'replicate',
    model: 'lucataco/realistic-vision-v5.1',
    inputDefaults: { width: 768, height: 768, num_outputs: 1 }
  },
  // Legacy value kept for old browsers with localStorage set to "playground".
  // Use the newest known Playground v2.5 version explicitly; naked model predictions can 404.
  playground: {
    name: 'Playground v2.5',
    provider: 'replicate',
    model: 'playgroundai/playground-v2.5-1024px-aesthetic:a45f82a1382bed5c7aeb861dac7c7d191b0fdf74d8d57c4a0e6ed7d4d0bf7d24',
    inputDefaults: { width: 1024, height: 1024, num_outputs: 1 }
  }
};


function extractReplicateImageUrl(output) {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first) {
    throw new Error('Replicate returned no image output');
  }
  if (typeof first === 'string') {
    return first;
  }
  if (typeof first.url === 'function') {
    return first.url().toString();
  }
  if (first.url && typeof first.url === 'string') {
    return first.url;
  }
  if (first.href && typeof first.href === 'string') {
    return first.href;
  }
  throw new Error(`Unsupported Replicate image output: ${JSON.stringify(first).slice(0, 200)}`);
}

async function generateImageWithReplicate(modelPreset, prompt) {
  if (!process.env.REPLICATE_API_KEY) {
    throw new Error('REPLICATE_API_KEY fehlt');
  }

  const input = {
    ...(modelPreset.inputDefaults || {}),
    prompt: prompt,
  };

  const output = await replicate.run(modelPreset.model, { input });
  const imageUrl = extractReplicateImageUrl(output);
  if (!/^https?:\/\//.test(imageUrl)) {
    throw new Error('Replicate returned an invalid image URL');
  }
  return imageUrl;
}

// API Endpoint für Bild-Kombination
app.post('/api/merge', async (req, res) => {
  try {
    const { image1, image2, style = 'realistic', model = 'flux_schnell' } = req.body;
    
    if (!image1 || !image2) {
      return res.status(400).json({ error: 'Beide Bilder erforderlich' });
    }
    
    const stylePreset = STYLE_PRESETS[style] || STYLE_PRESETS.realistic;
    const requestedModel = MODEL_PRESETS[model] ? model : 'flux_schnell';
    const modelPreset = MODEL_PRESETS[requestedModel] || MODEL_PRESETS.flux_schnell;
    console.log(`🎨 Stil: ${stylePreset.name} | 🤖 Model: ${modelPreset.name} via Replicate`);
        
    console.log('🎨 Analysiere Bild 1 mit GPT-4 Vision...');
    
    // Bild 1 analysieren
    const analysis1 = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Beschreibe dieses Bild in 2-3 prägnanten Sätzen. Fokussiere auf Hauptmerkmale, Farben, Stil und Objekte.'
            },
            {
              type: 'image_url',
              image_url: { url: image1 }
            }
          ]
        }
      ],
      max_tokens: 150
    });
    
    console.log('🎨 Analysiere Bild 2 mit GPT-4 Vision...');
    
    // Bild 2 analysieren
    const analysis2 = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Beschreibe dieses Bild in 2-3 prägnanten Sätzen. Fokussiere auf Hauptmerkmale, Farben, Stil und Objekte.'
            },
            {
              type: 'image_url',
              image_url: { url: image2 }
            }
          ]
        }
      ],
      max_tokens: 150
    });
    
    const desc1 = analysis1.choices[0].message.content;
    const desc2 = analysis2.choices[0].message.content;
    
    console.log('📝 Bild 1 (raw):', desc1);
    console.log('📝 Bild 2 (raw):', desc2);
    
    // Für Brainrot/Monster: Beschreibungen abstrahieren
    let concept1 = desc1;
    let concept2 = desc2;
    let gptConceptPrompt = "";
    let gptConceptSystemPrompt = '';
    let gptConceptUserPrompt = '';
    
    if (style === 'brainrot' || style === 'cute_monster' || style === 'fusion') {
      console.log('🧠 Erstelle kreatives Konzept...');
      
      gptConceptPrompt = `Du bist ein kreativer Monster-Designer. Erschaffe EIN NEUES Kreatur-Konzept inspiriert von beiden Beschreibungen.

WICHTIG:
- Erschaffe etwas NEUES, nicht "Objekt A mit Körper von B"
- Sei abstrakt und kreativ - lass dich INSPIRIEREN
- Variiere: mal dominiert A, mal B, mal was ganz Neues
- EIN kurzer Satz, max 15 Wörter

SCHLECHT: "Eine Eule mit Dosenkörper"
GUT: "Ein neongrüner Vogel aus flüssigem Metall mit leuchtenden Augen"
GUT: "Eine schwebende Dose mit Federflügeln und hypnotischem Blick"`;

      const conceptResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: gptConceptPrompt },
          { role: 'user', content: `Beschreibung 1: ${desc1}\n\nBeschreibung 2: ${desc2}\n\nErstelle EIN kreatives Konzept (max 15 Wörter):` }
        ],
        max_tokens: 60,
        temperature: 1.0
      });
      
      concept1 = conceptResponse.choices[0].message.content.trim().replace(/^["']|["']$/g, "");
      concept2 = "";
      console.log('💡 Kreatives Konzept:', concept1);
    }
    
    // Kombinations-Prompt generieren - als EIN vereintes Konzept, nicht als Collage/Kachelbild.
    const noTileInstructions = `
Composition rules (very important):
- Create ONE single final image, not two images.
- Do NOT make a split-screen, diptych, before/after comparison, two panels, collage, grid, contact sheet, or side-by-side layout.
- Do NOT place source image 1 on the left and source image 2 on the right.
- Fuse the subjects, colors, objects, mood, and visual ideas into one coherent scene or one coherent subject.
- The result must look like it was photographed/illustrated as one original image, not assembled from two references.`;
    let mergePrompt;
    
    if (style === 'brainrot' || style === 'cute_monster' || style === 'fusion') {
      // Monster/Fusion: Ein vereintes Konzept
      mergePrompt = `Create a new image from this fused concept:

Core concept: ${concept1}
Visual style: ${stylePreset.suffix}
${noTileInstructions}

Final output: one unified creature in one unified composition.`;
    } else {
      // Andere Stile: Auch als ein Konzept
      mergePrompt = `Create a new image that fuses these two source descriptions into ONE coherent result:

Source inspiration A: ${desc1}
Source inspiration B: ${desc2}
Visual style: ${stylePreset.suffix}
${noTileInstructions}

Final output: one unified image where the two inspirations are merged into the same subject/scene.`;
    }

    if (modelPreset.provider !== 'replicate') {
      throw new Error(`Bildgenerierung ist nur über Replicate erlaubt; unerlaubter Provider: ${modelPreset.provider}`);
    }

    console.log(`✨ Generiere kombiniertes Bild mit Replicate (${modelPreset.model})...`);
    const imageUrl = await generateImageWithReplicate(modelPreset, mergePrompt);
    
    console.log('✅ Bild erfolgreich via Replicate kombiniert!');
    
    // Save images and metadata
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const savedData = await saveImageSet(clientIp, style, image1, image2, imageUrl, {
      userAgent: userAgent,
      model: requestedModel,
      requestedModel: model,
      modelName: modelPreset.name,
      provider: modelPreset.provider,
      replicateModel: modelPreset.model || null,
      styleName: stylePreset.name,
      description1: desc1,
      description2: desc2,
      gptConceptPrompt: gptConceptPrompt || null,
      creativeConcept: concept1 !== desc1 ? concept1 : null,
      imagePrompt: mergePrompt,
      stylePromptSuffix: stylePreset.suffix
    });
    
    // Log the merge
    logMerge(clientIp, style, savedData.sessionDir, savedData.sessionId);
    
    res.json({
      imageUrl: imageUrl,
      meta: {
        style: style,
        styleName: stylePreset.name,
        model: requestedModel,
        requestedModel: model,
        modelName: modelPreset.name,
        provider: modelPreset.provider,
        description1: desc1,
        description2: desc2,
        creativeConcept: concept1 !== desc1 ? concept1 : null,
        gptConceptPrompt: gptConceptPrompt || null,
        imagePrompt: mergePrompt,
        stylePromptSuffix: stylePreset.suffix,
        sessionId: savedData.sessionId,
        sessionDir: savedData.sessionDir
      }
    });
    
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Admin routes
app.get('/admin/logs', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/logs/data', basicAuth, (req, res) => {
  const logs = readLogs();
  
  // Enrich logs with metadata
  const enrichedLogs = logs.map(log => {
    if (log.sessionDir && log.sessionId) {
      const metaPath = path.join(UPLOADS_DIR, log.sessionDir, `${log.sessionId}_meta.json`);
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          return { ...log, meta };
        }
      } catch (err) {
        console.error('Error reading meta:', err);
      }
    }
    return log;
  });
  
  res.json(enrichedLogs);
});

// 🎨 Image Gallery Endpoint
app.get('/admin/images/gallery', basicAuth, (req, res) => {
  const logs = readLogs();
  
  const gallery = logs.map(log => {
    if (log.sessionDir && log.sessionId) {
      const metaPath = path.join(UPLOADS_DIR, log.sessionDir, `${log.sessionId}_meta.json`);
      const resultPath = path.join(UPLOADS_DIR, log.sessionDir, `${log.sessionId}_result.jpg`);
      
      try {
        if (fs.existsSync(metaPath) && fs.existsSync(resultPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          return {
            sessionId: log.sessionId,
            timestamp: log.timestamp,
            style: log.style || meta.style,
            model: meta.model || 'unknown',
            resultImage: `/admin/uploads/${log.sessionDir}/${log.sessionId}_result.jpg`,
            source1: `/admin/uploads/${log.sessionDir}/${log.sessionId}_source1.jpg`,
            source2: `/admin/uploads/${log.sessionDir}/${log.sessionId}_source2.jpg`
          };
        }
      } catch (err) {
        console.error('Error reading image meta:', err);
      }
    }
    return null;
  }).filter(item => item !== null);
  
  res.json(gallery.reverse()); // Newest first
});

// Serve uploaded images
app.use('/admin/uploads', basicAuth, express.static(UPLOADS_DIR));

// Public API endpoint for user gallery (source images + results)
app.get('/api/uploads/:sessionDir/:filename', (req, res) => {
  const { sessionDir, filename } = req.params;
  // Sanitize path to prevent directory traversal
  const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
  const filePath = path.join(UPLOADS_DIR, sessionDir, safeName);
  
  // Ensure file is within UPLOADS_DIR
  if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS_DIR))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

// Delete entry (with folder)
app.delete('/admin/logs/:sessionDir/:sessionId', basicAuth, (req, res) => {
  try {
    const { sessionDir, sessionId } = req.params;
    
    // Delete folder with all files
    const folderPath = path.join(UPLOADS_DIR, sessionDir);
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      console.log(`🗑️ Deleted folder: ${sessionDir}`);
    }
    
    // Remove from logs
    const logs = readLogs();
    const filteredLogs = logs.filter(log => 
      !(log.sessionDir === sessionDir && log.sessionId === sessionId)
    );
    fs.writeFileSync(LOG_FILE, JSON.stringify(filteredLogs, null, 2));
    
    res.json({ success: true, message: 'Eintrag gelöscht' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete old entry (log only, no folder)
app.delete('/admin/logs/old/:index', basicAuth, (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const logs = readLogs();
    
    if (index >= 0 && index < logs.length) {
      logs.splice(index, 1);
      fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
      console.log(`🗑️ Deleted old log entry at index ${index}`);
      res.json({ success: true, message: 'Log-Eintrag gelöscht' });
    } else {
      res.status(404).json({ error: 'Index not found' });
    }
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎨 Bild-Kombinator läuft auf http://localhost:${PORT}`);
  console.log('💡 OpenAI API Key (Beschreibungen):', process.env.OPENAI_API_KEY ? '✓ gesetzt' : '✗ fehlt');
  console.log('🖼️ Replicate API Key (Bildgenerierung):', process.env.REPLICATE_API_KEY ? '✓ gesetzt' : '✗ fehlt');
  console.log('🔒 Admin: https://merge.eulencode.de/admin/logs');
});
