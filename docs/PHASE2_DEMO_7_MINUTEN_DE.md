# 7-Minuten-Demo für Caroline Smith, Head of HR

**Sprache:** Deutsch, A2–B1. **Daten:** ausschließlich fiktiv. **Vorbereitung:** isolierte lokale Instanz und Testkonten, genehmigter Demo-AI-Zugang oder als Simulation gekennzeichneter Test. Die hier mitgelieferten Checklisten sind DEMO-Fixtures, nicht mit den originalen Train Today-Dokumenten abgeglichen. Vor der Vorführung immer die tatsächliche Systemkonfiguration prüfen.

**0:00–0:45 — Problem und Ziel**

„Guten Tag, Caroline Smith. Heute zeige ich unseren Smart Onboarding Coordinator. HR soll weniger Aufgaben manuell verteilen. Gleichzeitig behält HR die Kontrolle. Die KI hilft mit Informationen. Sie entscheidet nicht über Zugänge und Freigaben.“

**0:45–1:45 — Registrierung**

HR öffnet „Neuer Mitarbeiter“ und erfasst den fiktiven Mitarbeiter **Mia Beispiel**, Rolle **Marketing Specialist**, Abteilung **Marketing**, Start am **03.11.2026**, synthetische Adresse `mia.beispiel@example.invalid` (für Aktivierung stattdessen ausdrücklich genehmigten lokalen Mailpit-Modus nutzen). „Nach dem Speichern legt PostgreSQL automatisch die allgemeinen und Marketing-Aufgaben an. Die Aufgaben kommen aus Vorlagen, nicht aus einer freien KI-Antwort.“

**1:45–2:35 — Automatisierung und KI**

HR öffnet den Datensatz. „Die drei vorhandenen Agenten bleiben bestehen. Der Coordinator fragt den Info Agent und den Welcome Agent. Jetzt erstellt er zusätzlich einen persönlichen Vorschlag aus den vorhandenen Aufgaben. HR prüft den Text. Die KI kann die Aufgaben nicht selbst abschließen.“ Wenn n8n nicht fertig ist: tatsächlichen Status zeigen, kein Erfolg behaupten.

**2:35–3:40 — Checkliste und Verantwortliche**

Aufgabenliste im HR-Detail öffnen: „Wir sehen Aufgabe, Datum, Status und verantwortliche Rolle. Für Marketing kommen zusätzliche Aufgaben dazu. Die genaue Liste der Unterrichts-Checklisten müssen wir vor der Endabnahme noch abgleichen. Diese Daten hier sind als Demo gekennzeichnet.“ Allgemeine und Marketing-Anzahl aus UI ablesen.

**3:40–4:45 — Human in the Loop**

In einem bereits aktivierten synthetischen Employee-Konto „Meine Aufgaben“ öffnen. Eine gewöhnliche Aufgabe abschließen. Bei „Bedarf an Marketing-Tools zur Freigabe melden“ **HR-Freigabe anfragen** klicken. „Der Mitarbeiter kann nur eine Anfrage erstellen. Er kann keine Berechtigungen vergeben.“ HR-Ansicht aktualisieren und die Anfrage ausdrücklich freigeben. „Wir speichern den Namen des genehmigenden HR-Kontos und den Zeitpunkt.“

**4:45–5:35 — Sicherheit und Zuverlässigkeit**

Im Employee-Konto andere HR-Funktionen aufrufen (403) oder im Testbericht zeigen. „Jeder Benutzer sieht nur seine eigenen Aufgaben. Ein doppelter Klick führt nicht zu einer neuen Aufgabe. Ein zweiter Statuswechsel mit einer alten Version wird abgelehnt.“ Nur tatsächlich ausgeführte Prüfungen als beobachtet bezeichnen.

**5:35–6:20 — Persistenz und Kontrolle**

Browser aktualisieren. „Die Aufgaben werden in PostgreSQL gespeichert, nicht nur im Browser. Jede echte Statusänderung hat einen Eintrag in der Historie. Die KI kann keine Konten anlegen, keine Freigaben erteilen und keine E-Mail ohne HR-Freigabe verschicken.“ Bei vorhandener, autorisierter Testumgebung kontrollierten Neustart und Reload zeigen.

**6:20–7:00 — Fazit**

„Das System trennt drei Dinge: Regeln im Backend, Vorschläge von KI und Entscheidungen durch Menschen. Das macht Onboarding einfacher und kontrollierbar. Die nächsten Schritte sind die Freigabe der Original-Checklisten und die vollständigen lokalen Tests. Danach können wir über Erinnerungen und Kalender nachdenken.“

## Pre-demo guardrails

- Never use an actual employee email, private onboarding record or production API key.
- `example.invalid` is not a deliverable email. Use only isolated Mailpit capture for activation demonstrations; no real SMTP/Resend call.
- If AI or Postgres is unavailable, switch the demo to a **declared walkthrough**, not an invented successful run.
- Do not show stored passwords, session cookies, bearer secrets or n8n credentials on screen.
