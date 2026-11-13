# 3Deep-Widget: Einrichtung und Bedienung (Stand Adapter Version 19, Darstellung Version 68)

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
- Links oben das Drop-Feld (siehe unten), daneben die Bookmark-Suche: Namen oder ID eingeben, „Suchen“, Treffer wählen, „Laden“.
- Häkchen „Schnell“: Produktstruktur mit einer Abfrage je Produkt lesen (expand); geht das nicht, liest das Widget automatisch Ebene für Ebene. Aus = immer Ebene für Ebene (zum Vergleich).
- Häkchen „Attribute“ (Standard an): liest die Attribute aller Strukturobjekte (z. B. Teilenummer, Reifegrad, Besitzer) mit einer einzigen Abfrage (Zone Query, `POST /cvservlet/zonequeries`). Klappt das nicht, geht es ohne diese Attribute weiter wie bisher; Ergebnis in der Diagnose unter „Zone Query (Attribute)“.
- Drop-Feld „⤓ Objekt hierher ziehen“: genau ein Objekt aus einer 3DEXPERIENCE-Suche (z. B. 3DSearch) hineinziehen. Physical Product: das Produkt mit seiner Struktur abwärts (nie nach oben). Bookmark: wie „Laden“. Issue: wie der Issue-Start. Person: ihre Issues (zugewiesen, Besitzer, mitwirkend) mit den betroffenen Objekten und ihre Aufgaben. Mehrere Objekte, andere Typen oder Dateien ergeben eine rote Warnung, es wird dann nichts geladen. Häkchen „Dokumente“, „Issues/Aufgaben“ und „Attribute“ gelten auch hier.
- Laden in Stufen (seit Adapter 29): Nach „Laden“ oder einem Drop erscheint zuerst der Bookmark mit der Produktstruktur (erstes Bild, Statuszeile „Bild steht …“). Damit kann sofort gearbeitet werden. Im Hintergrund kommen dazu: Attribute, Zeichnungen, Spezifikationen/Attachments, Issues mit Personen, Aufgaben. Bekannte Objekte bleiben dabei an ihrem Platz; Auswahl, Suche, Linkchain und Kamera bleiben erhalten. Ein neues Laden (anderer Bookmark, Drop, Häkchen) löst ein noch laufendes ab.
- Häkchen „Dokumente“, „Zeichnungen“, „Issues/Aufgaben“ (seit Adapter 29 alle standardmäßig an): legen fest, was im Hintergrund nachgeladen wird. Umschalten lädt das zuletzt geladene Objekt nach, ohne dass das Bild neu aufgebaut wird: Abgewähltes verschwindet, Neues kommt dazu. Beim Start über ein Issue werden dessen Objekte, Dokumente und Personen immer gelesen.
- Zwischenspeicher (seit Adapter 29, vorher nur Issue-Details): Alle gelesenen Daten bleiben 30 Minuten im Arbeitsspeicher des Widgets (nicht auf der Festplatte). Erneutes Laden, Umschalten der Häkchen und der Wechsel zurück zu einem schon gesehenen Bookmark gehen dadurch fast ohne Wartezeit; die Statuszeile nennt, wie viele Abfragen aus dem Zwischenspeicher kamen. Knopf „↻“ neben „Laden“: leert den Speicher und liest das geladene Objekt frisch von der Plattform (z. B. nach einer Änderung dort). Die Bookmark-Suche wird nie gespeichert. Unter „Diagnose“ gibt es zusätzlich „Zwischenspeicher leeren“.
- Issues zu den Objekten (seit Adapter 27): Das Widget fragt wie der Relational Explorer direkt, welche Issues auf die geladenen Objekte zeigen (betroffen oder Kontext), statt alle Issues der Plattform zu lesen. Klappt das nicht vollständig, liest es wie bisher alle Issues. Die Diagnose zeigt unter „Issues (dieses Laden)“ den gewählten Weg; der Abschnitt gilt nur für das letzte Laden.
- Dokumente (seit Adapter 29): Das Widget fragt zuerst in Paketen (wie der Relational Explorer), an welchen Objekten überhaupt Spezifikationen oder Attachments hängen. Nur für diese Objekte liest es danach wie bisher die Einzelheiten (Dateien, Beschreibung). Früher waren es drei Abfragen für jedes Objekt. Klappt der neue Weg nicht vollständig, liest das Widget wie bisher jedes Objekt einzeln. Diagnose-Abschnitt „Dokumente“ zeigt den Weg.
- Diagnose (seit Adapter 29): Abschnitt „Ablauf (dieses Laden)“ nennt die Stufen mit Zeit und Objektzahl; „Beziehungsübersicht“ listet für die ersten 25 Strukturobjekte alle Beziehungsarten der Plattform und markiert, welche das Widget noch nicht auswertet.
- Unter-Bookmarks (seit Adapter 25 über dieselbe Abfrage wie Bookmark Editor und Relational Explorer): Unterordner eines Bookmarks werden mit ihren Objekten mitgelesen, auch mehrere Ebenen tief. Was die Plattform geliefert hat, steht in der Diagnose unter „Bookmark-Ordner“.
- Häkchen nachträglich ändern (seit Adapter 21): Wird nach dem Laden ein Häkchen umgeschaltet, lädt das Widget das zuletzt geladene Objekt (Drop oder Bookmark) automatisch mit der neuen Einstellung neu; erneutes Ablegen ist nicht nötig. Mehrere Häkchen kurz hintereinander ergeben einen Ladevorgang.
- Häkchen „Zeichnungen“ (Standard an): Zeichnungen (Drawings) der Strukturobjekte suchen und als „Zeichnung“ mit Zeichnungslink zum Bauteil zeigen, auch CATIA-V5-Zeichnungen (CATDrawing) mit Download. Zwei Wege ohne Abfragen je Objekt: die Zone Query (native Zeichnungen) und die Zeigerbeziehung wie im Relational Explorer (in Paketen zu 25 Objekten). Nur wenn einer der beiden Wege nicht lesbar ist, fragt das Widget ersatzweise je Objekt.
- Dokument anklicken → „⬇ Datei herunterladen“.
- Bauteil oder Baugruppe anklicken → „⬇ Datei herunterladen“: zuerst die CAD-Datei (z. B. CATIA V5 .CATPart/.CATProduct), sonst ein abgeleitetes Format (STEP bevorzugt, dann 3DXML usw.). Gibt es beides nicht, meldet die Statuszeile das; Einzelheiten unter „Diagnose“ (Abschnitt „Downloads von Bauteilen/Baugruppen“).
- In die 3D-Ansicht klicken, dann W A S D bewegen, Maus umsehen, Leertaste/E hoch, Q/C runter, Umschalt schneller, Esc gibt die Maus frei.
- Security Context: wird automatisch gewählt (bevorzugter, sonst erster der eigenen Kontexte; reicht zum Lesen). Kein Auswahlfeld mehr; die Diagnose nennt den gewählten Kontext.

## Wenn etwas nicht geht
„Diagnose“ → „Kopieren“. Oben steht die Zusammenfassung, darunter alle Aufrufe und die erste Antwort je Aufrufart. Vor dem Weitergeben auf Vertrauliches prüfen.

## Stand der Schnittstellen
| Punkt | Stand |
|---|---|
| Laden in „Run your App“, Anmeldung, Security Context automatisch | auf der Plattform bestätigt |
| Bookmark, Produktstruktur | auf der Plattform bestätigt |
| Spezifikationen und Attachments an Teilen, Download | auf der Plattform bestätigt |
| Issues mit betroffenen Objekten (`$fields`), Personen aus Zuweisungen | auf der Plattform bestätigt |
| Zwischenspeicher der Issue-Details (Adapter 20) | auf der Plattform bestätigt |
| Laden in Stufen, Zwischenspeicher für alle Abfragen, „↻ Neu lesen“, Ablösen eines laufenden Ladens (Adapter 29) | nur mit Beispieldaten getestet |
| Dokumente über `getecosystem` ausgehend (`v6_specdoc_to`, `v6_annexdoc_to`; Namen aus dem Relational Explorer gesichert), Details weiter über die bestätigte Abfrage, aber nur für Objekte mit Dokumenten (Adapter 29) | nur mit Beispieldaten getestet |
| Beziehungsübersicht in der Diagnose über `getrelationcount` (Aufruf per Mitschnitt gesichert, Adapter 29) | nur mit Beispieldaten getestet |
| Issues zu den geladenen Objekten über `getecosystem` eingehend (Adapter 27, wie im Relational Explorer; Rückfall: alle Issues lesen) | nur mit Beispieldaten getestet |
| Start bei einem Issue (per Drag & Drop), Attachments direkt am Issue | nur mit Beispieldaten getestet |
| Drag & Drop | auf der Plattform bestätigt |
| Download CATPart/CATProduct (Ticket per POST) | auf der Plattform bestätigt |
| Zeichnungen: Zone Query (Repräsentation Typ Drawing), `dseng:EngRepInstance`, V5 über `dsxcad:…/dsxcad:Drawing`, Download `dsxcad:Drawing` | vermutet, nur mit Beispieldaten getestet |
| Aufgaben mit Bezug zu einem Objekt | Abruf läuft, noch kein Treffer gesehen |
| Download abgeleiteter Formate (Derived Output über `dsdo:DerivedOutputs/Locate`) | laut DS-SDK, nur mit Beispieldaten getestet |
| Produktstruktur in einer Abfrage (`dseng:EngItem/{ID}/expand`), Rückfall Ebene für Ebene | auf der Plattform bestätigt (ca. 2 s statt ca. 80 s) |
| Attribute über Zone Query (`/cvservlet/zonequeries`, Body laut Doku R2026x) | Aufruf laut Doku; Prädikate außer `ds6w:label`/`ds6w:type`, Adresse und Teilenummer vermutet, nur mit Beispieldaten getestet |
| Dokument-Beziehungen je Objekt gleichzeitig abfragen | mit Beispieldaten getestet |
| Person per Drop: Benutzername über `pno/person/{ID}` | vermutet, nur mit Beispieldaten getestet |
| Unterordner eines Bookmarks | vermutet |
| Vorschaubild in der Profilkarte (Feld `preview_url` aus getecosystem, Adresse auf dem FCS) | vermutet, nur mit Beispieldaten getestet; Diagnose „Vorschaubilder“ und Knopf „Bilder prüfen“ |
| WASD mit eingefangener Maus, SpaceMouse im Dashboard | offen |
