# Architektura Silnika Fizycznego (v0.0.266+)

Dokument opisuje przejście z modelu synchronicznego CPU-GPU na architekturę **GPU-driven** opartą na zdarzeniach i asynchronicznych zapytaniach.

## 1. System Komend (Command Queue)

Zamiast przesyłać całe buforów (np. wszystkich cząsteczek) co klatkę, CPU działa jako reżyser wysyłający asynchroniczne polecenia.

- **Bufor Komend:** `commandBuffer` (4096 slotów na klatkę).
- **Typy operacji:** `ADD_PARTICLE`, `UPDATE_POS`, `SET_CONSTRAINT`, `REMOVE_OBJECT`.
- **Zaleta:** Drastyczne zmniejszenie obciążenia szyny PCI-e. CPU nie musi wiedzieć o stanie wszystkich cząsteczek, by wprowadzić zmianę w jednej.

## 2. Spatial Hashing (GPU-side)

Fizyka kolizji została zoptymalizowana z $O(N^2)$ do $O(1)$ (uśrednione) przy użyciu struktury **Linked-list Grid** na GPU.

- **Grid:** Tablica atomowa (Atomic Grid) przechowująca indeksy ostatnich cząsteczek w komórkach.
- **Next Node:** Bufor wiążący cząsteczki w listy wewnątrz komórek.
- **Wydajność:** Pozwala na symulację tysięcy cząsteczek bez spadku klatek.

## 3. Asynchroniczne Zapytania (Spatial Queries)

CPU jest "ślepe" na dokładne pozycje. Aby wejść w interakcję ze światem (np. edytor, myszka), używa zapytań:

- `findNearest(pos, radius)`: Znajduje najbliższą cząsteczkę.
- `raycast(origin, dir, dist)`: Wykrywa kolizję promienia z SDF (static) lub cząsteczkami.
- `queryRadius(pos, radius)`: Zwraca listę obiektów w obszarze.

**Przepływ:** Zapytanie wysyłane -> Przetwarzane na GPU -> Wynik dostępny przez `mapAsync` (opóźnienie ok. 1-2 klatki).

## 4. Strategia Synchronizacji (Readback)

Symulacja i renderowanie na GPU działają w trybie **Non-blocking**.

- Jeśli CPU nie zdąży odczytać danych (`isReadingBack == true`), GPU kontynuuje symulację w kolejnej klatce.
- CPU pobiera dane o pozycjach cząsteczek tylko dla celów wizualizacji w edytorze lub ECS, ale nie blokuje to potoku fizyki.
- Edytor używa lokalnych kopii parametrów (`transform`), które są asynchronicznie korygowane przez dane z GPU.

## 5. Flag i Optymalizacje

- **Sim-Always:** Cząsteczki z flagą `2u` (np. segmenty liny podczas budowania) są symulowane nawet gdy świat jest w pauzie.
- **Atomic Grid:** Czyszczenie i budowanie siatki odbywa się w każdej klatce za pomocą szybkich operacji atomowych w compute shaderze.