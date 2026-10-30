# Train Today – Onboard und CRM

Übergabestand vom 30.10.2026 für Sergiis Integrationsprüfung. Dieser Ordner enthält die aktuelle lokale Anwendung einschließlich Mitarbeiterportal, HR, Onboarding-Koordinator, CRM, Workflow-Exporten und einem verschlüsselten Datenbestand. Er ist eine **eigenständige Installation**, kein Ersatz für die Anwendung im Repository-Hauptverzeichnis.

## Was enthalten ist

| Ordner / Datei | Aufgabe |
| --- | --- |
| `onboard/frontend/` | React-Portal „Train Today Onboard“: HR, Mitarbeiter, Zugänge, Aufgaben, Team, Regeln, Chat und Leitungsübersichten |
| `onboard/backend/` | Node/TypeScript-API, Anmeldung, Rollen, Freigaben, Einladungen, Team-Chat, CRM-Brücke |
| `onboard/database/migrations/` | Sieben Migrationen für HR, Bearbeitungshistorie, Admin-Mitteilungen, Workspace, Chat und Leitung |
| `coordinator/` | Persistente Aufgabenpläne, konkrete Aufgabenaktionen, HR-Entscheidungen, Fristen, Mailhistorie, n8n-MCP-Anbindung |
| `crm/` | CRM mit Kunden, Projekten, Vertrieb, Service, Aufgaben, Zeiten, Prognosen, Auswertungen und lesendem Projekt-Assistenten |
| `workflow-exports/` | Fünf aktuelle Exporte der Onboarding- und Koordinator-Workflows |
| `crm/workflows/` | Neun CRM-Workflows aus dem lokalen Quellstand |
| `WORKFLOW-INVENTORY.json` | Exakte Namen, Dateien, IDs und Herkunft aller 14 Workflows |
| `train-today-datenbanken.7z` | Verschlüsselter Datenbestand samt lokalen Testzugängen und Mailpit-Verlauf |
| `compose.yaml`, `local-suite.py` | Getrennter lokaler Start mit eigenen Datenbank-Volumes und neuen Infrastruktur-Schlüsseln |

Enthalten sind auch die zuletzt ergänzten Bereichsaufgaben mit offenen, erledigten und überfälligen Zuständen, persönliche Zuordnungen, Projektgruppen und Gesprächsverläufe. Die simulierte Arbeit bleibt in der Datenhistorie als solche nachvollziehbar. Kennzahlen sind keine automatische Personalbewertung.

## Lokaler Start für Sergii

Voraussetzungen: Docker Desktop/Compose, Python 3, 7-Zip; Internet für das erstmalige Laden der Images und npm-Abhängigkeiten. Node muss auf dem Host nur für die Modultests vorhanden sein. Die Anwendungen verwenden Node 22 bzw. 24 in Docker, PostgreSQL 17 für HR/Koordinator und PostgreSQL 16 für CRM.

1. Den **Feature-Branch dieses Pull Requests** auschecken bzw. als ZIP herunterladen. In `handover/train-today-suite` wechseln. Nicht die alten Einzel-Startskripte in den Unterordnern verwenden.
2. Das Archiv `train-today-datenbanken.7z` mit 7-Zip in einen **privaten Ordner außerhalb des Repositorys** entpacken. Das Passwort erhältst du separat von Juri. Im entpackten Ordner liegen `onboard.dump`, `coordinator.dump`, `crm.dump`, `ZUGAENGE.txt` und `mailpit/`.
3. Die neue Konfiguration erzeugen:

   ```powershell
   py -3 local-suite.py configure
   ```

   Sind die Standardports belegt, stattdessen beispielsweise `py -3 local-suite.py configure --port-offset 30000` verwenden. Die Datei `.env` wird nur einmal angelegt und nicht überschrieben.

4. Daten in **neue, leere** Volumes importieren:

   ```powershell
   py -3 local-suite.py restore --data-dir "C:\Privat\Train-Today-Daten"
   py -3 local-suite.py up
   py -3 local-suite.py status
   ```

   Auf macOS/Linux `python3` statt `py -3` verwenden. `restore` verweigert den Import, wenn Anwendungstabellen bereits existieren. Es löscht keine vorhandenen Datenbanken.

5. Ohne Port-Offset: Portal `http://localhost:5173`, CRM `http://localhost:3080`, Mailpit `http://localhost:8025`. Mit Offset 30000: Portal `http://localhost:35173`, CRM `http://localhost:33080`, Mailpit `http://localhost:38025`. Anmeldedaten stehen ausschließlich in der entpackten `ZUGAENGE.txt`. HR und Mitarbeiter in getrennten Browserprofilen testen.
6. Für neue KI-gestützte Onboarding-Durchläufe die n8n-Einrichtung unter [CONFIGURATION.md](CONFIGURATION.md) durchführen. Die bestehenden Mitarbeiter, Aufgaben, Chatverläufe und CRM-Projekte sind bereits nach Schritt 4 verfügbar.

`py -3 local-suite.py stop` hält nur diese Übergabe-Installation an. `up` startet sie erneut. Die Daten bleiben in Docker-Volumes erhalten. Kein `down -v` verwenden, wenn die Daten erhalten bleiben sollen.

## Daten und Sicherheit

Das Repository ist öffentlich. Der Nutzer hat am 30.10.2026 ausdrücklich zugestimmt, die Datenbanken, lokalen Testzugänge und Mailbox-Historie als passwortgeschütztes Archiv hier zu veröffentlichen. Das 7z-Archiv verwendet AES-256 und verschlüsselte Dateinamen. **Das Archivpasswort und der entpackte Inhalt gehören nicht in GitHub, Issues oder PR-Kommentare.**

API-Schlüssel, ursprüngliche `.env`-Dateien und n8n-Credentials sind nicht enthalten. Das Startskript erstellt neue Datenbank- und Dienstschlüssel. Bestehende HR-/CRM-Sitzungen und HR-Einladungstoken werden nicht übernommen; alte Einladungslinks in archivierten E-Mails sind deshalb nicht als neue Aktivierung verwendbar. Neue Einladungen werden nach Prüfung erneut erstellt. Account-Passworthashes und die ausdrücklich gewünschten lokalen Testzugänge werden verschlüsselt übergeben.

Die Anwendung bindet Browserports nur an `127.0.0.1`. E-Mails gehen standardmäßig an das lokale Mailpit. Kein realer Versand, keine automatische Workflow-Aktivierung, keine Verbindung zu Produktionsservern. Die historischen Einzel-Anleitungen unter `crm/` und `onboard/` beziehen sich teilweise auf Juris ursprüngliche Installation; **diese Anleitung und die gemeinsame Compose-Datei sind für dieses Paket maßgeblich**.

## Prüfstand und nächste Schritte

Siehe [TEST_REPORT.md](TEST_REPORT.md), [CONFIGURATION.md](CONFIGURATION.md) und [INTEGRATION-READINESS.md](INTEGRATION-READINESS.md). Der Stand ist zur Integrationsprüfung vorgesehen. Ein GitHub-Upload ist keine Produktionsfreigabe. Vor Integration muss Sergiis Team insbesondere API-, Schema-, Rollen- und Webhook-Konflikte mit seinem tatsächlichen Produktionsstand prüfen.
