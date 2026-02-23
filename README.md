# Save Link to Notion

Rozszerzenie do Chrome/Brave, które pozwala zapisywać linki, notatki i rozmawiać z AI na temat przeglądanej strony bezpośrednio do Notion.

## Instalacja

### Z Chrome Web Store (gdy wtyczka będzie opublikowana)

1. Wejdź na stronę wtyczki w [Chrome Web Store](https://chrome.google.com/webstore) (link zostanie dodany po publikacji).
2. Kliknij **Dodaj do Chrome** / **Add to Chrome**.

### Instalacja ręczna (tryb deweloperski)

1. Sklonuj repozytorium i zainstaluj zależności:
   ```bash
   npm install
   npm run build
   ```
2. Otwórz `chrome://extensions/` w Chrome lub Brave.
3. Włącz **Tryb deweloperski** (Developer mode).
4. Kliknij **Załaduj rozpakowane** (Load unpacked) i wskaż folder **`dist`** w projekcie.

## Rozwój

- **Uruchomienie w trybie deweloperskim:** `npm run dev` – potem załaduj folder `dist` w `chrome://extensions/` (odśwież po zmianach).
- **Build:** `npm run build`
- **Pakiet do Chrome Web Store:** `npm run pack` – tworzy plik `save-link-to-notion.zip` gotowy do wgrania w [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Publikacja w Chrome Web Store

Pełna instrukcja krok po kroku (rejestracja konta, przygotowanie ZIP, listing, prywatność, recenzja) znajduje się w **[docs/PUBLISHING.md](docs/PUBLISHING.md)**.  
Przewodnik jest oparty na tym samym podejściu co przy publikacji [Kick.com Chat Monitor](https://github.com/Mysttic/kick-bot-chrome-addon).

## Prywatność

Wtyczka przechowuje dane lokalnie (klucze API, ID bazy Notion) i wysyła je wyłącznie do Notion oraz opcjonalnie do wybranej usługi AI (np. OpenRouter). Nie zbiera ani nie wysyła danych do serwerów twórców. Szczegóły: **[PRIVACY.md](PRIVACY.md)**.

## Licencja

MIT (jeśli w projekcie jest plik LICENSE).
