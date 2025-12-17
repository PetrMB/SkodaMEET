## Konfig pro agenty (Cursor)

Tento soubor shrnuje, jak pracovat s mými projekty přes Notion a Google Drive.

---

### 1. Google Drive – projekty

- **Root složka projektů (My Drive)**: `Projekty`
- **ID root složky**: `1KuGLtB3KwQK51lSjwpfAuobJBT3u5-Vj`
- **Konvence názvů podsložek**: `YYYYMMDD_Nazev_projektu`
  - příklady:
    - `20251216_Kostka_s_aktivitami`
    - `20251209_Gabbys_house_ouska`
    - `20251215_box_na_PEPO`

- **Sdílení**: pro každou podsložku je nastaveno
  - `type = anyone`, `role = reader` ("Anyone with the link – viewer").

- **Service account (pouze pro skripty, NE pro agenty mimo tento stroj)**
  - e‑mail: `cursormacsw@cursormac.iam.gserviceaccount.com`
  - JSON klíč (lokální cesta): `/Users/petrhoneger/Downloads/cursormac-3945d52dcf1a.json`
  - Povolené API: **Google Drive API**.

> Pozn.: Service account nemá vlastní storage kvótu, proto se přes něj řeší hlavně práce se složkami a ACL. Nahrávání souborů dělá skript přes OAuth na můj účet (`Petr.Honeger@gmail.com`).

---

### 2. Notion – databáze

#### 2.1 Evidence projektů

- **Název databáze**: `Evidence projektů`
- **Data source ID**: `2bf64878-09ec-808c-87b7-000b4d2baf65`
- **Důležité sloupce**:
  - `Název projektu` (title)
  - `Pro koho` (text)
  - `Typ projektu` (select) – hodnoty např. `3D tisk`, `Grafika`, `Laser`, `Kombinovaný`, `Jiný`
  - `Stav` (status) – např. `Zadáno`, `Rozpracováno`, `Dokončeno`, `Předáno`
  - `Datum zadání` (date)
  - `Termín dokončení` (date)
  - `Soubory` (url/text) – **odkaz na Google Drive složku projektu**

- **Vazba Notion ↔ Drive**:
  - Pro každý řádek projektu je složka v Drive: `Projekty/YYYYMMDD_Nazev_projektu`.
  - Sloupec `Soubory` obsahuje share link na danou složku, např.:  
    `https://drive.google.com/drive/folders/1zob5Plll1mlx_Px_tPTt43qzWDKU1ZaI`.

#### 2.2 Pezinská – databáze vstupních čipů

- **Název databáze**: `Pezinská`
- **Data source ID**: `dc94ef8e-1a03-49e9-9c75-c3ca340137e2`
- **Sloupce**:
  - `Příjmení` (title)
  - `Datum` (date)
  - `Čipy` (text; více čísel oddělených čárkou/čárkami)
  - `Poznámka` (text)

---

### 3. Lokální cesty na Macu

- **iCloud projekty (záloha)**:  
  `/Users/petrhoneger/Library/Mobile Documents/com~apple~CloudDocs/Projekty`

- **Google Drive (desktop klient)**:  
  My Drive je připojený přes Google Drive for desktop; složka `Projekty` je přímo v My Drive.

---

### 4. Skript pro upload projektů (OAuth)

Skript běží **lokálně** (nespouštět z jiných prostředí bez úprav):

- Soubor: doporučený název `upload_projekty.py` v `~/Documents`.
- Používá OAuth klienta (`client_secret_...json`) a token uložený v `token_projekty.json` v `~/Downloads`.
- Pro každý podadresář v iCloud složce `Projekty`:
  - najde/ vytvoří odpovídající složku v Google Drive `Projekty/…`,
  - nahraje všechny soubory a podsložky.

Pokud nějaký agent potřebuje pracovat s projekty:
- **nový projekt**: založit řádek v `Evidence projektů`, vytvořit složku v Drive (`Projekty/YYYYMMDD_Nazev_projektu`), doplnit share link do `Soubory`.
- **mazání**: smazat složku v Drive a buď projekt označit jako zrušený, nebo stránku přesunout mimo databázi / smazat ručně v Notion.
