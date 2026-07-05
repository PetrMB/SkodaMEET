# Retuš — dávková AI retuš realitních fotek

Lokální aplikace: nahrajete desítky fotek, upraví je AI obrazový model (přes OpenRouter)
podle výchozího retušovacího promptu + vašeho upřesnění pro danou dávku.

## Spuštění

1. Získejte API klíč: na [openrouter.ai](https://openrouter.ai) se přihlaste,
   v sekci **Credits** nabijte kredit (např. $10) a v sekci **Keys** vytvořte klíč.
2. Spusťte server:
   ```
   node server.js
   ```
3. Otevřete http://localhost:8095 — pokud klíč chybí, appka si ho vyžádá
   a sama uloží do `.env` (alternativně: `cp .env.example .env` a klíč vložte ručně).

## Poznámky

- Výsledky se ukládají do `output/<název-dávky>/` s příponou `_retus.jpg`.
- HEIC fotky: Safari je umí, Chrome ne — v Chromu použijte JPEG.
- Cena: řádově $0.01–0.25 za fotku podle modelu a rozlišení; průběžná útrata se zobrazuje v horní liště.
- `.env`, `config.json` ani fotky se necommitují (viz `.gitignore`).
