-- Każde gospodarstwo ma co najmniej jednego domownika. Istniejące bazy (np. na NAS) powstały, zanim domownicy
-- trafili do aplikacji, więc dodajemy im jedną domyślną osobę; nazwę można potem zmienić w Ustawieniach.
-- Migracja jest bezpieczna do ponownego uruchomienia: gospodarstwa, które już mają domownika, są pomijane.
INSERT INTO "users" ("household_id", "name")
SELECT h."id", 'Ja'
FROM "households" h
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."household_id" = h."id");
