# 3Deep-Widget: Einrichtung

Diese Dateien gehören zusammen und müssen im selben Ordner liegen:

- `index.html` – Testseite für den Browser (Beispieldaten)
- `widget.html` und `widget2.html` – zwei Varianten des kleinen Laders für das 3DDashboard (feste Adresse `https://kodoiii.github.io/3Deep/`)
- `adapter.js` – Suchleiste und Adapter für die 3DEXPERIENCE-Schnittstellen
- `datenraum3d.html` – die 3D-Darstellung (Version 65, unverändert auch lokal nutzbar)

## 1. Auf GitHub Pages legen
1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `3deep-widget`. (Die Dateien enthalten nur das Programm, keine Daten.)
2. „Add file → Upload files“: alle Dateien hochladen, „Commit changes“.
3. „Settings → Pages“: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`, „Save“.
4. Nach ein bis zwei Minuten ist das Widget unter `https://DEIN-NAME.github.io/3deep-widget/` erreichbar.

## 2. Erst im Browser prüfen (Testmodus)
Die Adresse direkt im Browser öffnen. Oben steht „Testmodus: Beispieldaten“. „Suchen“, dann „Laden“ drücken: Es erscheint ein kleiner Beispiel-Bookmark mit 28 Objekten. Damit ist klar, dass Hosting und Darstellung funktionieren.

## 3. Ins 3DDashboard aufnehmen
1. Im Dashboard die App **„Run Your App“** auf ein Tab ziehen.
2. In den Einstellungen des Widgets die Adresse `https://kodoiii.github.io/3Deep/widget.html` eintragen (klappt das nicht: `widget2.html`) und speichern.
3. Falls nach vertrauenswürdig gefragt wird: zustimmen. Falls „Run Your App“ fehlt, braucht es den Plattform-Administrator (Platform Management → Additional Apps bzw. Rolle für eigene Widgets).

## 4. Benutzen
1. Bookmark-Namen (oder Teil davon) eingeben, „Suchen“.
2. Treffer wählen, „Laden“. Gelesen werden der Ordnerinhalt und die Produktstruktur aller Produkte darin, abwärts.
3. In die 3D-Ansicht klicken, dann **W A S D** bewegen, Maus umsehen, Leertaste/E hoch, Q/C runter, Umschalt schneller, Esc gibt die Maus frei.
4. Das Auswahlfeld rechts neben „Laden“ wählt den Security Context, wenn du mehrere hast.

Einstellungen des Widgets (Zahnrad/Preferences): Security Context fest vorgeben, Höchstzahl Objekte (Standard 1500), Adresse der Darstellung.

## 5. Wenn etwas nicht geht
Knopf **„Diagnose“** → „Kopieren“. Das Protokoll zeigt jeden Aufruf mit Ergebnis und die erste Antwort je Aufrufart. Vertrauliches prüfen und das Protokoll an Claude geben; damit lässt sich der Adapter gezielt anpassen.

## Stand der Schnittstellen
| Punkt | Stand |
|---|---|
| Anmeldung über `DS/WAFData`, 3DSpace-Adresse über `i3DXCompassServices`, Kopfzeile `SecurityContext`, Parameter `tenant` | von anderen Widgets auf Cloud-Tenants bestätigt, hier nur simuliert getestet |
| Bookmark-Suche `dsbks:Bookmark/search`, Inhalt mit `$mask=dsbks:BksMask.Items2` | dokumentiert, Antwortformat aus fremdem Widget übernommen |
| Engineering Item `dseng:EngItem/{ID}` (Maske `dsmveng:EngItemMask.Details`), Kinder über `dseng:EngInstance` (Maske `dsmveng:EngInstanceMask.Details`) | dokumentiert und von anderen auf einem Cloud-Tenant bestätigt |
| Security Context automatisch aus `pno/person` | vermutet (Feldnamen können abweichen; sonst von Hand eintragen) |
| Unterordner eines Bookmarks | vermutet: werden gelesen, wenn sie als Inhalt geliefert werden |
| Dokumenttitel über `documents/{ID}` | vermutet, Fehler werden übergangen |
| WASD-Maussteuerung (Mauszeiger einfangen) im Dashboard | offen; falls gesperrt: Maus ziehen zum Umsehen |
| SpaceMouse im Dashboard | vermutlich gesperrt (wie im Artifact) |
