# Pajonk Zyzio - Code Architecture Review

## 1. Aktualne Problemy (Stan Prototypowy)

### A. Ręczne Zarządzanie Zasobami
`WebPhysics` wymaga ręcznego wywoływania `alloc/free`. Brak automatyzacji przy usuwaniu encji z ECS prowadzi do wycieków pamięci w buforach GPU.

### B. Rozdźwięk ECS vs Fizyka
Fizyka żyje w `Float32Array`, a gra w ECS. Synchronizacja odbywa się poprzez luźne indeksy `particleIdx`. Brakuje systemu, który traktuje fizykę jako integralną część encji.

### C. Konflikty Wewnętrzne (Self-collisions)
Brak warstw kolizji sprawia, że elementy połączone więzami (jak głowa i tułów Zyzia) odpychają się z ogromną siłą, co niszczy stabilność XPBD.

### D. Brak Abstrakcji Rigid Body
Obecnie wszystko jest cząsteczką. Potrzebujemy struktur wyższego rzędu (Batches), które pozwolą budować złożone obiekty z wielu cząsteczek zachowujących się spójnie.
