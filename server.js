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
  dalle3: {
    name: 'DALL-E 3',
    provider: 'openai'
  },
  flux_schnell: {
    name: 'Flux Schnell',
    provider: 'replicate',
    model: 'black-forest-labs/flux-schnell'
  },
  flux_pro: {
    name: 'Flux Pro (HQ)',
    provider: 'replicate',
    model: 'black-forest-labs/flux-1.1-pro'
  },
  sdxl_lightning: {
    name: 'SDXL Lightning',
    provider: 'replicate',
    model: 'lucataco/sdxl-lightning-4step'
  },
  playground: {
    name: 'Playground v2.5',
    provider: 'replicate',
    model: 'playgroundai/playground-v2.5-1024px-aesthetic'
  },
  imagen: {
    name: 'Google Imagen 4',
    provider: 'replicate',
    model: 'google/imagen-4-fast'
  }
};

// API Endpoint für Bild-Kombination
app.post('/api/merge', async (req, res) => {
  try {
    const { image1, image2, style = 'realistic', model = 'dalle3' } = req.body;
    
    if (!image1 || !image2) {
      return res.status(400).json({ error: 'Beide Bilder erforderlich' });
    }
    
    const stylePreset = STYLE_PRESETS[style] || STYLE_PRESETS.realistic;
    const modelPreset = MODEL_PRESETS[model] || MODEL_PRESETS.dalle3;
    console.log(`🎨 Stil: ${stylePreset.name} | 🤖 Model: ${modelPreset.name}`);
        
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
        model: 'gpt-4o-mini',
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
    
    // Kombinations-Prompt generieren - als EIN vereintes Konzept
    let mergePrompt;
    
    if (style === 'brainrot' || style === 'cute_monster' || style === 'fusion') {
      // Monster/Fusion: Ein vereintes Konzept
      mergePrompt = `Create a creature based on this concept:

A single creature: ${concept1}. One unified creature, centered composition.`;
    } else {
      // Andere Stile: Auch als ein Konzept
      mergePrompt = `Create an image based on this concept:

${desc1}, ${desc2}. One unified image, creative fusion of both elements.`;
    }

    console.log('✨ Generiere kombiniertes Bild mit DALL-E 3...');

    
    // Mit DALL-E 3 kombiniertes Bild generieren
    const imageResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: mergePrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });
    
    const imageUrl = imageResponse.data[0].url;
    
    console.log('✅ Bild erfolgreich kombiniert!');
    
    // Save images and metadata
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const savedData = await saveImageSet(clientIp, style, image1, image2, imageUrl, {
      userAgent: userAgent,
      model: model,
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
        model: model,
        modelName: modelPreset.name,
        provider: modelPreset.provider,
        description1: desc1,
        description2: desc2,
        creativeConcept: concept1 !== desc1 ? concept1 : null,
        gptConceptPrompt: gptConceptPrompt || null,
        imagePrompt: mergePrompt,
        stylePromptSuffix: stylePreset.suffix,
        sessionId: savedData.sessionId
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

// Serve uploaded images
app.use('/admin/uploads', basicAuth, express.static(UPLOADS_DIR));

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
  console.log('💡 OpenAI API Key:', process.env.OPENAI_API_KEY ? '✓ gesetzt' : '✗ fehlt');
  console.log('🔒 Admin: https://merge.eulencode.de/admin/logs');
});
