#!/usr/bin/env node

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3100;

// OpenAI API Key aus Environment
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('.'));

// API Endpoint für Bild-Kombination
app.post('/api/merge', async (req, res) => {
  try {
    const { image1, image2 } = req.body;
    
    if (!image1 || !image2) {
      return res.status(400).json({ error: 'Beide Bilder erforderlich' });
    }
    
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
    
    console.log('📝 Bild 1:', desc1);
    console.log('📝 Bild 2:', desc2);
    
    // Kombinations-Prompt generieren
    const mergePrompt = `Create a creative combination that merges these two concepts into one cohesive image:

Image 1: ${desc1}
Image 2: ${desc2}

Combine the key features, colors, and style elements from both descriptions into a single, harmonious image. Be creative and fun!`;
    
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
    
    res.json({
      imageUrl: imageUrl,
      description1: desc1,
      description2: desc2,
      prompt: mergePrompt
    });
    
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎨 Bild-Kombinator läuft auf http://localhost:${PORT}`);
  console.log('💡 OpenAI API Key:', process.env.OPENAI_API_KEY ? '✓ gesetzt' : '✗ fehlt');
});
