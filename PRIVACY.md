# Polityka prywatności – Save Link to Notion

**Ostatnia aktualizacja:** 2025

## Zasady ogólne

Wtyczka **Save Link to Notion** jest zaprojektowana tak, aby minimalizować przetwarzanie danych i nie zbierać informacji o użytkowniku poza tym, co jest konieczne do działania funkcji zapisu do Notion i opcjonalnej rozmowy z AI.

## Przetwarzane dane

### Przechowywane lokalnie (na Twoim urządzeniu)

- **Klucz API Notion** oraz **ID bazy Notion** – używane wyłącznie do wysyłania zapisanych stron do Twojej bazy Notion.
- **Opcjonalnie:** klucz API do usługi AI (np. OpenRouter) – używany tylko do funkcji rozmowy z AI w rozszerzeniu.
- Wszystkie te dane są przechowywane w **chrome.storage.local** i **nie są wysyłane na serwery twórców wtyczki**.

### Wysyłane do zewnętrznych usług (przez Twoją przeglądarkę)

- **Notion (api.notion.com)** – gdy zapisujesz stronę, wtyczka wysyła do Notion: tytuł, adres URL, opis, tagi oraz ewentualne notatki/wyróżnienia. Dane trafiają wyłącznie do Twojej bazy Notion, do której dostęp masz dzięki podanemu kluczowi API.
- **OpenRouter (openrouter.ai)** – tylko wtedy, gdy włączysz i użyjesz funkcji rozmowy z AI; wtedy treść wiadomości jest wysyłana do wybranej przez Ciebie usługi AI (zgodnie z polityką tej usługi).

## Czego wtyczka nie robi

- **Nie zbiera** danych analitycznych ani statystyk o użytkowniku.
- **Nie wysyła** żadnych danych na serwery twórców wtyczki.
- **Nie śledzi** zachowania ani historii przeglądania poza akcjami wykonywanymi w samej wtyczce (np. zapis strony do Notion).

## Jednoznaczny cel wtyczki

Głównym celem wtyczki jest umożliwienie użytkownikowi **zapisywania linków i notatek do własnej bazy Notion** oraz opcjonalnie **korzystania z asystenta AI** w kontekście przeglądanej strony. Wszystkie dane są używane wyłącznie do realizacji tych funkcji.

## Kontakt

W razie pytań dotyczących prywatności lub przetwarzania danych możesz skontaktować się przez repozytorium projektu (np. Issues na GitHubie).
