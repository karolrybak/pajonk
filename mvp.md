Oto definicja MVP dla Twojej gry „Web-Builder 2D” na WebGPU:
1. Świat Gry (Środowisko)
Prostokątne „Akwarium”: Granice ekranu stanowią twarde kolizje.
Wektor Wiatru: Globalna zmienna uniform vec2 windForce, która co klatkę dodaje siłę do każdego wolnego węzła.
2. Fizyka (Compute Shader / PBD)
Użyjemy Position Based Dynamics, bo jest najbardziej stabilne dla sznurków i WebGPU.
Bufor Punktów (Particles): Każdy punkt ma: position, old_position, mass (0 dla punktów przytwierdzonych).
Bufor Wiązań (Constraints): Indeks punktu A, indeks punktu B, rest_length (długość spoczynkowa).
Krok Fizyki:
Aplikacja wiatru i grawitacji (nowa pozycja).
Rozwiązanie wiązań (pętla iteracyjna – pociąganie punktów ku sobie, by zachować rest_length).
Kolizja ze ścianami (jeśli pos.x < 0, to pos.x = 0).
3. Pająk (Gracz) – Logika i Sterowanie
Pająk jest specjalnym „super-węzłem” w systemie fizycznym. Ma dwa stany:
A. Stan: Chodzenie (On Wall/Ceiling)
Pająk jest „przyklejony” do ściany (jego masa w shaderze = 0, lub ignorujemy siły zewnętrzne).
Ruch: Zmieniamy jego współrzędne bezpośrednio na podstawie klawiszy (L/P/G/D).
Jump: Odlepia pająka od ściany, nadaje mu prędkość początkową i zmienia stan na IN_AIR.
B. Stan: Wiszenie/Lot (In Air)
Pająk staje się zwykłym punktem fizycznym podlegającym grawitacji i wiatrowi.
Wytwarzanie liny: Jeśli pająk skacze, automatycznie tworzy się pierwsze wiązanie między punktem na ścianie (kotwicą) a pająkiem.
4. Mechanika Liny (Dynamiczne Wiązania)
To jest serce gry. Musisz zarządzać listą węzłów liny, którą pająk „rozwija”.
Rozwijanie: Jeśli pająk oddali się od ostatniego węzła o więcej niż X metrów, shader/skrypt dodaje nowy węzeł w miejscu pająka i tworzy nowe wiązanie między pająkiem a tym nowym węzłem.
Zwijanie/Rozwijanie (Góra/Dół):
Zamiast dodawać węzły, zmieniasz parametr rest_length ostatniego odcinka (tego przy pająku).
Jeśli rest_length spadnie do 0 – usuwasz segment.
Jeśli wzrośnie powyżej limitu – dodajesz nowy segment.
Przypnij (Pin): Kiedy pająk dotknie dowolnej ściany podczas wiszenia na linie, ostatni węzeł (przy pająku) zostaje zamieniony na „kotwicę” (masa = 0). Lina zostaje w świecie, a pająk jest wolny.
5. Technologia (WebGPU + Three.js)
Compute Shader: Liczy wszystkie Constraints i Particle Positions.
Three.js: Używamy InstancedMesh (dla małych kulek-węzłów) oraz LineSegments do wizualizacji nici.
ProTip: WebGPU pozwala na Storage Buffer sharing. Oznacza to, że Compute Shader zapisuje pozycje prosto do bufora, który Three.js odczytuje jako bufor wierzchołków (Vertex Buffer) bez przesyłania danych przez CPU!
Scenariusz MVP (User Flow):
Pająk siedzi na lewej ścianie.
Gracz klika JUMP -> Pająk leci w prawo. Silnik tworzy „Kotwicę” na lewej ścianie i nitkę do pająka.
Pająk leci po łuku (wahadło). Gracz trzyma GÓRĘ -> lina się skraca, pająk podciąga się wyżej.
Pająk dolatuje do sufitu. Gracz klika PIN -> Nitka zostaje przymocowana do sufitu.
Mamy teraz nitkę rozpiętą między lewą ścianą a sufitem.
Pająk może teraz przejść po suficie i skoczyć z innego miejsca, budując kolejną nitkę.