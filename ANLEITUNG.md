# 3Deep-Widget: Einrichtung und Bedienung (Stand Adapter Version 16, Darstellung Version 68)

## Dateien (alle im selben Ordner auf GitHub Pages)
- `widget.html` – kleiner Lader für das 3DDashboard. **Diese Adresse** trägt man im Dashboard ein.
- `adapter.js` – Suchleiste und Adapter für die 3DEXPERIENCE-Schnittstellen.
- `datenraum3d.html` – die 3D-Darstellung (Version 68, auch lokal per Doppelklick nutzbar). Dieselbe Datei wie lokal und im Artifact; die Version steht unten im Panel.
- `index.html` – Testseite für den Browser mit Beispieldaten (nicht fürs Dashboard).

Hosting: Repository `kodoiii/3Deep` (öffentlich), Adresse `https://kodoiii.github.io/3Deep/`.

## Neue Version einspielen
1. Im Repository „Add file → Upload files“, geänderte Dateien hochladen, „Commit changes“.
2. Zwei bis drei Minuten warten.
3. `https://kodoiii.github.io/3Deep/` öffnen: Der Testmodus muss laufen.
4. Im Dashboard das Widget mit dem Kreispfeil neu laden. Die erste Zeile der Diagnose nennt Adapter- und Darstellungsversion, unten im Panel steht „Darstellung Version …“.

## Ins 3DDashboard aufnehmen
- Schnell: App „Run your App“ auf ein Tab ziehen, `https://kodoiii.github.io/3Deep/widget.html` eintragen, „Run“.
- Dauerhaft (Admin): Platform Management → Members → Additional Apps → Create Additional App, Typ Widget, Source code URL wie oben. (Noch nicht ausprobiert.)

## Bedienung
- Auswahl „Bookmark | Issue“: womit begonnen wird. Namen oder Titel eingeben, „Suchen“, Treffer wählen, „Laden“.
- Häkchen „Schnell“: Produktstruktur mit einer Abfrage je Produkt lesen (expand); geht das nicht, liest das Widget automatisch Ebene für Ebene. Aus = immer Ebene für Ebene (zum Vergleich).
- Häkchen „Attribute“ (Standard an): liest die Attribute aller Strukturobjekte (z. B. Teilenummer, Reifegrad, Besitzer) mit einer einzigen Abfrage (Zone Query, `POST /cvservlet/zonequeries`). Klappt das nicht, geht es ohne diese Attribute weiter wie bisher; Ergebnis in der Diagnose unter „Zone Query (Attribute)“.
- Drop-Feld „⤓ Objekt hierher ziehen“: genau ein Objekt aus einer 3DEXPERIENCE-Suche (z. B. 3DSearch) hineinziehen. Physical Product: das Produkt mit seiner Struktur abwärts (nie nach oben). Bookmark: wie „Laden“. Issue: wie der Issue-Start. Person: ihre Issues (zugewiesen, Besitzer, mitwirkend) mit den betroffenen Objekten und ihre Aufgaben. Mehrere Objekte, andere Typen oder Dateien ergeben eine rote Warnung, es wird dann nichts geladen. Häkchen „Dokumente“, „Issues/Aufgaben“ und „Attribute“ gelten auch hier.
- Häkchen „Dokumente“: Spezifikationen und Attachments mitlesen. „Issues/Aufgaben“: Issues, Aufgaben, Personen mitlesen. Beide sind seit Adapter 14 standardmäßig aus (schnell, nur Bookmark und Produktstruktur); bei Bedarf einschalten und neu laden. Beim Start über ein Issue werden dessen Objekte, Dokumente und Zuweisungen immer gelesen.
- Häkchen „Struktur“ (nur bei Start mit Issue): Produktstruktur der betroffenen Objekte abwärts.
- Knopf „Alle Issues“: Entwicklerfunktion für Performancetests, Zeitlimit 180 s.
- Dokument anklicken → „⬇ Datei herunterladen“.
- Bauteil oder Baugruppe anklicken → „⬇ Datei herunterladen“: zuerst die CAD-Datei (z. B. CATIA V5 .CATPart/.CATProduct), sonst ein abgeleitetes Format (STEP bevorzugt, dann 3DXML usw.). Gibt es beides nicht, meldet die Statuszeile das; Einzelheiten unter „Diagnose“ (Abschnitt „Downloads von Bauteilen/Baugruppen“).
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
| Download von Bauteilen/Baugruppen: CAD-Datei über `dsxcad … AuthoringFile/DownloadTicket`, sonst Derived Output über `dsdo:DerivedOutputs/Locate` | laut DS-SDK, nur mit Beispieldaten getestet |
| Produktstruktur in einer Abfrage (`dseng:EngItem/{ID}/expand`), Rückfall Ebene für Ebene | auf der Plattform bestätigt (ca. 2 s statt ca. 80 s) |
| Attribute über Zone Query (`/cvservlet/zonequeries`, Body laut Doku R2026x) | Aufruf laut Doku; Prädikate außer `ds6w:label`/`ds6w:type`, Adresse und Teilenummer vermutet, nur mit Beispieldaten getestet |
| Dokument-Beziehungen je Objekt gleichzeitig abfragen | mit Beispieldaten getestet |
| Drag & Drop (Format 3DXContent, Modul `DS/DataDragAndDrop` und Browser-Drop) | vermutet, nur mit Beispieldaten getestet |
| Person per Drop: Benutzername über `pno/person/{ID}` | vermutet, nur mit Beispieldaten getestet |
| Unterordner eines Bookmarks | vermutet |
| WASD mit eingefangener Maus, SpaceMouse im Dashboard | offen |
