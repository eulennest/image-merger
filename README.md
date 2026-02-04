# 🎨 Bild-Kombinator

Eine kinderfreundliche Web-App zum Kombinieren von zwei Bildern mit KI-Power!

## Features

✨ **Einfach:** 2 Bilder hochladen → Kombinieren-Button drücken → Fertig!  
🤖 **KI-powered:** Nutzt GPT-4 Vision + DALL-E 3  
🎨 **Kreativ:** Kombiniert Farben, Formen und Stile beider Bilder  
👶 **Kinderfreundlich:** Buntes Design, große Buttons, Comic Sans!

## How it works

1. **Analyse:** GPT-4 Vision beschreibt beide Bilder
2. **Kombination:** DALL-E 3 generiert ein neues Bild basierend auf beiden Beschreibungen
3. **Magie:** Das Ergebnis ist eine kreative Verschmelzung beider Bilder!

## Setup

```bash
# Dependencies installieren
npm install

# OpenAI API Key setzen
export OPENAI_API_KEY="sk-..."

# Server starten
npm start
```

Dann öffne: http://localhost:3100

## Requirements

- Node.js >= 16
- OpenAI API Key (mit GPT-4 Vision + DALL-E 3 Zugriff)

## Tech Stack

- **Frontend:** Pure HTML/CSS/JS (kein Build nötig!)
- **Backend:** Node.js + Express
- **KI:** OpenAI GPT-4o + DALL-E 3

## Kosten

Pro Kombination:
- GPT-4o Vision (2 calls): ~$0.02
- DALL-E 3: ~$0.04
- **Total:** ~$0.06 pro Kombination

## License

MIT

---

Made with 🦉 by Kaspar Kastl
