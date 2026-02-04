#!/bin/bash
# Einfaches Icon mit ImageMagick/Convert

# Prüfe ob convert verfügbar ist
if ! command -v convert &> /dev/null; then
    echo "ImageMagick nicht installiert, überspringe Icon-Generierung"
    echo "Icons müssen manuell erstellt werden"
    exit 0
fi

# Erstelle simples Gradient-Icon mit Emoji
convert -size 512x512 \
    gradient:'#667eea-#764ba2' \
    -gravity center \
    -pointsize 320 \
    -font DejaVu-Sans \
    -fill white \
    -annotate +0+20 '🎨' \
    icon-512.png

convert icon-512.png -resize 192x192 icon-192.png

echo "Icons erstellt: icon-192.png, icon-512.png"
