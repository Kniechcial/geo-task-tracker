# GeoTasker — jak działa aplikacja

Dokument tłumaczy prostym językiem **co** aplikacja robi, **jak** to robi i **dlaczego** tak,
a nie inaczej. Możesz go czytać obok kodu — w nawiasach podaję nazwy plików i funkcji.

---

## 1. Co to jest w jednym zdaniu

GeoTasker to lista zadań, w której **każde zadanie ma swoje miejsce na mapie**.
Do tego dochodzą trzy narzędzia „geograficzne": układanie **trasy** między zadaniami,
rysowanie **strefy** (obszaru) i **pomiar** odległości między dowolnymi punktami.
Wszystko działa w przeglądarce, bez żadnego serwera i bazy danych — dane siedzą
w pamięci przeglądarki (`localStorage`).

---

## 2. Z czego jest zbudowana i po co każda część

Aplikacja to trzy zwykłe pliki (HTML + CSS + JavaScript) i trzy biblioteki wczytywane z internetu (CDN):

- **Leaflet** — obsługa mapy: pokazywanie mapy, kafelki, markery (pinezki), linie, wielokąty, kliknięcia.
- **jQuery** — wygodne „chwytanie" elementów strony i reagowanie na zdarzenia (kliknięcia, wpisywanie tekstu).
  To dzięki niej budujemy listę zadań i łączymy panel z mapą.
- **Turf.js** — obliczenia geograficzne: prawdziwa odległość w kilometrach, pole powierzchni obszaru,
  sprawdzanie czy punkt leży w wielokącie. Turf operuje na standardzie **GeoJSON**.

**Dlaczego akurat tak?** To projekt do nauki tych czterech rzeczy (Leaflet, Turf, jQuery, localStorage),
więc celowo nie ma tu frameworka (React itp.) ani narzędzi budujących — ma być prosto i „na wierzchu".

---

## 3. Struktura plików

```
public/
├── index.html      – szkielet strony: panel boczny, mapa, formularz (modal), przyciski
├── css/style.css   – cały wygląd + układ mobilny (wysuwany panel)
└── js/
    ├── store.js    – „magazyn danych": zapisywanie/odczyt zadań z localStorage
    └── app.js      – cała logika: mapa, lista, tryby, obsługa kliknięć
```

Podział na `store.js` i `app.js` jest celowy: **dane** (jak je trzymać i zapisywać) są oddzielone
od **działania interfejsu** (co się dzieje po kliknięciu). Dzięki temu łatwiej się połapać.

Pliki są w folderze `public/`, bo projekt jest przygotowany pod **Firebase Hosting**
(to konfiguracja z `firebase.json`). Do samego działania aplikacji Firebase nie jest potrzebny.

---

## 4. Jak przechowywane są dane (to jest serce aplikacji)

### Jedno zadanie to zwykły obiekt (`store.js`, funkcja `add`)

```js
{
  id: "t_...",            // unikalny identyfikator
  title: "Odebrać paczkę",
  description: "Przy Rynku",
  category: "Zakupy",
  priority: "wysoki",     // wysoki | sredni | niski
  done: false,            // czy wykonane
  lat: 50.06, lng: 19.94, // współrzędne (szerokość, długość)
  createdAt: 1690000000   // czas dodania (do sortowania „najnowsze")
}
```

### Trwałość — `localStorage` (`store.js`)

- Wszystkie zadania trzymamy w jednej tablicy w pamięci (`var tasks`).
- Po **każdej** zmianie (dodanie, edycja, usunięcie, oznaczenie) wywołujemy `persist()`,
  które zapisuje całą tablicę jako tekst pod kluczem `geotasker.tasks.v1`.
- Przy starcie `load()` odczytuje ten tekst z powrotem.

**Dlaczego tak?** `localStorage` to najprostszy sposób, żeby dane **przeżyły odświeżenie strony**
bez serwera. Zapis i odczyt są owinięte w `try/catch`, bo w trybie prywatnym przeglądarki
zapis może się nie udać — wtedy aplikacja po prostu działa dalej bez zapisywania.

### GeoJSON — „język map" (`store.js`, funkcja `toFeature`)

Turf i Leaflet rozumieją standard **GeoJSON**. Funkcja `toFeature` zamienia nasze zadanie
na punkt GeoJSON. Ważny szczegół:

> W GeoJSON kolejność współrzędnych to **[długość, szerokość]** — czyli `[lng, lat]`,
> a w Leaflet odwrotnie: **[lat, lng]**. To najczęstsze źródło błędów przy mapach.
> W kodzie zawsze zwracam na to uwagę (w komentarzach też).

---

## 5. Jak działają poszczególne funkcje (krok po kroku)

### 5.1 Mapa i „gdzie jestem" (`app.js`: `initMap`, `locateUser`, `initialView`)

- Przy starcie tworzymy mapę Leaflet wyśrodkowaną na **Krakowie** i dokładamy kafelki z OpenStreetMap.
- `initialView` decyduje, co pokazać na start:
  - jest kilka zadań → **dopasuj widok tak, żeby zmieściły się wszystkie** (`fitAllTasks`),
  - jest jedno → pokaż je z bliska,
  - nie ma żadnego → spróbuj **geolokalizacji** (zapytaj przeglądarkę „gdzie jest użytkownik").
- Przycisk **„Moja lokalizacja"** w każdej chwili wyśrodkuje mapę na Tobie.

**Dlaczego tak?** Gdyby aplikacja przy każdym starcie pytała o lokalizację i przeskakiwała,
byłoby to irytujące — zwłaszcza gdy masz już zapisane zadania. Dlatego geolokalizacja włącza się
tylko wtedy, gdy nie ma czego pokazać. Flaga `hasInteracted` dodatkowo pilnuje, żeby spóźniona
geolokalizacja nie „wyrwała" widoku, gdy właśnie dodajesz zadanie.

### 5.2 Dodawanie zadania (`app.js`: `openModalForNew`, `handleSubmit`)

1. Klikasz w puste miejsce na mapie → w tym punkcie pojawia się kropka podglądu
   i otwiera się **okienko (modal)** z formularzem (tytuł, opis, kategoria, priorytet).
2. Klikasz „Zapisz" → `handleSubmit` tworzy zadanie (`TaskStore.add`), stawia pinezkę
   i dopisuje je do listy.
3. Mapa **delikatnie dosuwa** nowe zadanie do widoku i otwiera dymek — **bez gwałtownego skoku**.

**Dlaczego „delikatnie"?** Wcześniej po dodaniu mapa mocno przeskakiwała i przybliżała się.
Teraz przy dodawaniu używamy `panInside` (mały ruch, bez zmiany przybliżenia),
a dymki mają wyłączony auto-przesuw (`autoPan: false`), żeby nie „walczyły" z ruchem mapy.

### 5.3 Pinezki na mapie (`app.js`: `makeIcon`)

Pinezki rysujemy sami (jako `divIcon`), więc możemy je **kolorować według priorytetu**:
czerwony = wysoki, pomarańczowy = średni, zielony = niski, szary z „✓" = wykonane.
W trybie trasy pinezka pokazuje **numer przystanku**.

### 5.4 Lista w panelu i statystyki (`app.js`: `renderList`, `buildTaskItem`, `updateStats`)

- `renderList` czyści listę i buduje ją od nowa z aktualnych danych (za pomocą jQuery).
- Każda karta pokazuje tytuł, opis, znaczniki (kategoria, priorytet), „ptaszek" wykonania
  oraz ikony edycji i usuwania.
- W nagłówku widać licznik: ile zadań i ile ukończonych.

### 5.5 Powiązanie lista ↔ mapa (dwukierunkowe) (`app.js`: `setActive`, `focusTask`)

- Klik w kartę na liście → mapa **centruje się na tym zadaniu** i otwiera dymek.
- Klik w pinezkę na mapie → **podświetla się** odpowiednia karta na liście.

To właśnie „dwukierunkowa komunikacja": panel i mapa zawsze pokazują to samo.

### 5.6 Wykonane / edycja / usuwanie + „Cofnij" (`app.js`: `toggleDone`, `deleteTask`, `undoDelete`)

- Kliknięcie „ptaszka" oznacza zadanie jako wykonane (przekreślenie + szara pinezka).
- Edycja otwiera to samo okienko, ale wypełnione danymi zadania.
- Usuwanie **nie** pokazuje nudnego okienka „na pewno?". Zamiast tego znika zadanie,
  a na dole pojawia się **pasek z przyciskiem „Cofnij"** (toast). To bezpieczniejsze i przyjemniejsze —
  jak przypadkiem usuniesz, jednym kliknięciem przywracasz (`undoDelete` wstawia zadanie z powrotem
  z zachowaniem tego samego `id`).

### 5.7 Filtrowanie, szukanie, sortowanie (`app.js`: `visibleTasks`)

Zanim lista się narysuje, przepuszczamy zadania przez „sito" (`visibleTasks`):
- **Filtr**: Wszystkie / Aktywne / Wykonane.
- **Szukajka**: pokazuje tylko zadania, w których tytule/opisie/kategorii jest wpisany tekst.
- **Sortowanie**: Najnowsze, Priorytet, albo **Odległość ode mnie** (liczona przez `turf.distance`
  od Twojej pozycji — dlatego przy tej opcji aplikacja prosi o lokalizację).

### 5.8 Tryb TRASA (`app.js`: `toggleRouteMode`, `drawRoute`, `computeRouteKm`)

1. Włączasz „Trasa", potem klikasz zadania w wybranej kolejności.
2. Każde dodane zadanie dostaje **numer** (na liście i na pinezce), a między punktami
   rysuje się **linia**.
3. Turf liczy **rzeczywistą długość** tej łamanej (`turf.length` na linii GeoJSON) —
   pasek pokazuje np. „4,20 km · 3 przystanki".

**Po co Turf?** Bo prawdziwa odległość na kuli ziemskiej to nie zwykłe odejmowanie współrzędnych —
Turf robi to poprawnie.

### 5.9 Tryb STREFA (`app.js`: `toggleZoneMode`, `zonePolygon`, `tasksInZone`, `updateZoneInfo`)

1. Włączasz „Strefa" i klikasz na mapie punkty — od 3 punktów powstaje **wielokąt**.
2. Turf liczy **pole powierzchni** wielokąta (`turf.area`, przeliczane na m² / km²).
3. Turf sprawdza, **które zadania leżą wewnątrz** (`turf.booleanPointInPolygon`) —
   te zadania dostają fioletowy znacznik „w strefie", a pasek pokazuje ich liczbę.

To odpowiada na pytanie typu: „ile mam zadań w tej dzielnicy i jak duży to obszar".

### 5.10 Tryb POMIAR (`app.js`: `toggleMeasureMode`, `addMeasurePoint`, `computeMeasureKm`)

Najprostszy tryb: klikasz **dowolne** punkty na mapie (nie muszą to być zadania),
rysuje się linia i liczona jest **łączna odległość** (`turf.length`). Do szybkiego „ile stąd dotąd".

### Ważne: tryby wykluczają się wzajemnie (`app.js`: `exitOtherModes`)

Trasa, Strefa i Pomiar to trzy różne tryby klikania w mapę. Włączenie jednego **automatycznie wyłącza**
pozostałe, żeby kliknięcia nie robiły dwóch rzeczy naraz. W trybie trasy/strefy/pomiaru klik w pustą
mapę **nie** dodaje nowego zadania.

---

## 6. Widok na telefonie — wysuwany panel (`style.css`, sekcja `@media (max-width: 720px)`)

- Na wąskim ekranie mapa jest **na cały ekran**, a panel to **„szufladka" wysuwana od dołu**
  (najwyżej pół ekranu).
- U góry panelu jest **uchwyt** — tapnięcie **zwija** panel w dół (zostaje sam pasek,
  widać całą mapę) i **rozwija** z powrotem (`app.js`: `toggleSheet`).
- Zawartość panelu **przewija się**, więc żaden przycisk nie jest ucięty,
  a na dole jest zapas miejsca (również pod „wcięcie" na nowszych telefonach).

**Dlaczego panel jest „doklejony" (position: fixed), a nie ułożony flexem?**
Przy układzie flex nie dało się go płynnie zwijać do 44 px (element flexa w kolumnie broni się
przed zmniejszeniem poniżej swojej zawartości). Dlatego panel jest przyklejony do dołu ekranu
i po prostu **zjeżdża w dół** (`transform`), zostawiając widoczny sam uchwyt.

---

## 7. Jak to uruchomić

Aplikacja to statyczne pliki — wystarczy je udostępnić przez dowolny serwer stron
(np. `firebase deploy`, albo dowolny hosting statyczny). Otwarcie prosto z dysku też zadziała,
ale serwer jest pewniejszy (poprawne ścieżki). **Nie ma** własnego backendu ani bazy — wszystko
dzieje się w przeglądarce, a dane trzyma `localStorage`.

---

## 8. Skrót „co za co odpowiada"

| Wymaganie | Gdzie w kodzie |
|---|---|
| Mapa, geolokalizacja, markery, zdarzenia | `app.js`: `initMap`, `locateUser`, `addMarker`, `map.on("click")` |
| GeoJSON + odległość + pole + punkt w wielokącie | `store.js`: `toFeature`; `app.js`: `turf.length`, `turf.area`, `turf.booleanPointInPolygon` |
| jQuery: budowa listy, formularz, powiązanie z mapą | `app.js`: `renderList`, `handleSubmit`, `setActive` |
| localStorage: dodaj/edytuj/usuń + trwałość | `store.js`: `add`, `update`, `remove`, `persist`, `load` |
