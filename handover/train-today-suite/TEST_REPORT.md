# Testbericht der Übergabe

Datum: 30.10.2026. Ausschließlich isolierte lokale Kopie `train-today-handover` mit eigenen Volumes und Ports 35173 / 33080 / 33010 / 38025 / 35681. Keine produktiven Workflows geändert oder aktiviert.

| Prüfung | Ergebnis | Nachweis |
| --- | --- | --- |
| Koordinator, Aufgabenaktionen, Fristen, Gruppierung, MCP-Antworten, CRM-Metriken, Frontend-Authentifizierung und Validierung | **PASS – 62/62** | `test-evidence/unit-tests.tap` |
| Restore, Anmeldungen, persönliche Aufgaben, HR-Bericht, Rollen, CRM-Brücke, Mailbox und CRM-Snapshot | **PASS – 21/21** | `test-evidence/restore-verification.json` |
| Browser: Leitungsübersicht mit Diagramm, Team-Chat, CRM-Anmeldung und Dashboard | **PASS – 3/3** | `test-evidence/browser-results.json`; lokale Screenshots wurden visuell geprüft, nicht öffentlich beigelegt |
| Import aller Workflows in n8n 2.41.7 | **PASS – 14 importiert, 0 aktiv** | `test-evidence/workflow-import.json` |
| Docker-Build und Start von Portal-Frontend, Backend, Koordinator, CRM | **PASS** | Separate Compose-Installation gestartet; Login/API-/Browserprüfungen gegen diese Kopie |
| Restore aller drei PostgreSQL-Sicherungen in leere Volumes | **PASS** | `local-suite.py restore`; danach 17 Mitarbeiter, 433 Portal-Aufgaben, 58 CRM-Projekte und 858 CRM-Records erreichbar |
| Persistente Mailbox | **PASS** | 31 historische Nachrichten in separatem Mailpit nach Restore sichtbar |
| CRM-Agentenrolle | **PASS** | `SHOW default_transaction_read_only` als `crm_agent` ergibt `on` |
| 7z-Archivtest und Entschlüsselung | **PASS** | 5/5 entpackte Dateien stimmen per SHA-256 mit den Exportdateien überein |
| Bekannte lokale Passwörter/API-Schlüssel/Archivpasswort im öffentlichen Textbestand | **PASS** | Keine Treffer; `test-evidence/security-scan.json`. Keine Aussage über einen vollständigen externen Sicherheits-Audit. |
| Neue KI-Aufnahme, neues KI-Willkommen, vollständige Freigabe und Mitarbeiteraktivierung im wiederhergestellten n8n | **NOT TESTED** | Neue Credentials/MCP-Freigaben erforderlich; Workflows bewusst inaktiv |
| Externe Requesty/OpenAI-/Tavily-/Resend-Aufrufe | **NOT TESTED** | Keine Provider-Credentials kopiert, keine realen E-Mails verschickt |
| Jede historische CRM-Schreibfunktion / alle Backend-Regressionstests | **NOT TESTED** | Diese Übergabeprüfung ist kein vollständiger Regressionstest aller Komponenten |
| Mobile Bedienung und Produktionskompatibilität | **NOT TESTED** | Desktopprüfung; kein Zugriff auf Produktions-VPS |

## Während der Paketprüfung korrigiert

- Fehlende `coordinator/nodes/`-Quellmodule ergänzt. Die drei dadurch zunächst fehlgeschlagenen Modultests bestehen jetzt.
- `NODE_ENV=development` in der isolierten Compose-API ergänzt, damit die absichtlich lokale HTTP-Anmeldung nicht am Produktions-HTTPS-Schutz scheitert.
- Portal-Origin im Koordinator konfigurierbar gemacht, damit alternative Testports funktionieren. Der Standard bleibt `http://localhost:5173`.
- Eindeutige IDs für die neun CRM-Exporte ergänzt, nachdem der n8n-CLI-Import ohne ID abgewiesen wurde. Erneuter Import erfolgreich.
- CRM-Workflow-HTTP-Ziele in der Übergabekopie auf `http://crm:3080` gesetzt, damit sie keine laufende Host-Installation ansprechen.
- Zwei Testskript-Annahmen korrigiert: Antwortfeld heißt `responsibleGroups`; Leitung startet im CRM-Reiter, die Onboarding-Tabelle liegt im Reiter „Onboarding & Personal“. Diese waren Testfehler, keine verdeckten Anwendungsfehler.

## Reproduzierbare Modulprüfung

Im Verzeichnis dieser README mit Node 24 (oder passender Node-Version mit Type-Stripping):

```shell
node --test --test-reporter=tap coordinator/tests/*.test.mjs coordinator/mcp-response.test.mjs coordinator/responsible-groups.test.mjs coordinator/work-task.test.mjs crm/tests/leadership-report.test.mjs onboard/frontend/tests/*.test.mjs
```

Container-Build und Wiederherstellung stehen in [README.md](README.md). Die API-/Browserprüfung verwendet die separat verschlüsselten lokalen Testzugänge; sie sind nicht Bestandteil der öffentlichen Testprotokolle. Zum Nachprüfen als HR anmelden, Aufgaben und Mitarbeiterliste öffnen; als Leitung die beiden Reiter unter „Team & Fristen“ prüfen; als Jonas die IT-Berechtigung und als Vertriebsmitarbeiter die persönliche Sicht prüfen. CRM und Mailpit separat öffnen. Einladungslinks aus der alten Mailhistorie ersetzen keine neue Einladung.

Die älteren komponenteneigenen Prüfberichte können sich auf frühere Datenstände beziehen. Für diesen Upload gilt ausschließlich dieser Bericht mit den beigefügten aktuellen Nachweisen.
