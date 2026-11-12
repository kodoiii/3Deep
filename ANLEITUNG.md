# 3Deep-Widget: Einrichtung und Bedienung (Stand Adapter Version 10)

## Dateien (alle im selben Ordner auf GitHub Pages)
- `widget.html` – kleiner Lader für das 3DDashboard. **Diese Adresse** trägt man im Dashboard ein.
- `adapter.js` – Suchleiste und Adapter für die 3DEXPERIENCE-Schnittstellen.
- `datenraum3d.html` – die 3D-Darstellung (Version 66, auch lokal per Doppelklick nutzbar).
- `index.html` – Testseite für den Browser mit Beispieldaten (nicht fürs Dashboard).

Hosting: Repository `kodoiii/3Deep` (öffentlich), Adresse `https://kodoiii.github.io/3Deep/`.

## Neue Version einspielen
1. Im Repository „Add file → Upload files“, geänderte Dateien hochladen, „Commit changes“.
2. Zwei bis drei Minuten warten.
3. `https://kodoiii.github.io/3Deep/` öffnen: Der Testmodus muss laufen.
4. Im Dashboard das Widget mit dem Kreispfeil neu laden. Die erste Zeile der Diagnose nennt die Adapter-Version.

## Ins 3DDashboard aufnehmen
- Schnell: App „Run your App“ auf ein Tab ziehen, `https://kodoiii.github.io/3Deep/widget.html` eintragen, „Run“.
- Dauerhaft (Admin): Platform Management → Members → Additional Apps → Create Additional App, Typ Widget, Source code URL wie oben. (Noch nicht ausprobiert.)

## Bedienung
- Auswahl „Bookmark | Issue“: womit begonnen wird. Namen oder Titel eingeben, „Suchen“, Treffer wählen, „Laden“.
- Häkchen „Dokumente“: Spezifikationen und Attachments mitlesen. „Issues/Aufgaben“: Issues, Aufgaben, Personen mitlesen.
- Häkchen „Struktur“ (nur bei Start mit Issue): Produktstruktur der betroffenen Objekte abwärts.
- Knopf „Alle Issues“: Entwicklerfunktion für Performancetests, Zeitlimit 180 s.
- Dokument anklicken → „⬇ Datei herunterladen“.
- In die 3D-Ansicht klicken, dann W A S D bewegen, Maus umsehen, Leertaste/E hoch, Q/C runter, Umschalt schneller, Esc gibt die Maus frei.
- Auswahlfeld mit dem Security Context, falls mehrere vorhanden sind.

## Wenn etwas nicht geht
„Diagnose“ → „Kopieren“. Oben steht die Zusammenfassung, darunter alle Aufrufe und die erste Antwort je Aufrufart. Vor dem Weitergeben auf Vertrauliches prüfen.

## Stand der Schnittstellen
| Punkt | Stand |
|---|---|
| Laden in „Run your App“, Anmeldung, Security Context automatisch | auf der Plattform bestätigt |
| Bookmark, Produktstruktur | auf der Plattform bestätigt |
| Spezifikationen und Attachments an Teilen, Download | auf der Plattform bestätigt |
| Issues mit betroffenen Objekten (`$fields`), Personen aus Zuweisungen | auf der Plattform bestätigt |
| Start bei einem Issue, Attachments direkt am Issue, „Alle Issues“ | nur mit Beispieldaten getestet |
| Aufgaben mit Bezug zu einem Objekt | Abruf läuft, noch kein Treffer gesehen |
| Unterordner eines Bookmarks | vermutet |
| WASD mit eingefangener Maus, SpaceMouse im Dashboard | offen |
